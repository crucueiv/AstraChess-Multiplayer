import { useEffect, useRef, useState } from "react";

const apiBase = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8787";
type Screen = "lobby" | "room" | "game";
const POLL_INTERVAL_MS = 1_500;

export function App(): JSX.Element {
  const [screen, setScreen] = useState<Screen>("lobby");
  const [apiKey, setApiKey] = useState("");
  const [playerId, setPlayerId] = useState("p1");
  const [roomId, setRoomId] = useState("room-1");
  const [token, setToken] = useState("");
  const [status, setStatus] = useState("idle");
  const [lastError, setLastError] = useState("");
  const [messages, setMessages] = useState<string[]>([]);
  const socketRef = useRef<WebSocket | null>(null);
  const pollingRunRef = useRef(0);

  const log = (message: string): void => {
    setMessages((prev) => [message, ...prev].slice(0, 8));
  };

  const wsBase = apiBase.startsWith("https://")
    ? apiBase.replace("https://", "wss://")
    : apiBase.replace("http://", "ws://");

  const requestSessionToken = async (): Promise<string> => {
    if (!apiKey) {
      setStatus("missing-api-key");
      throw new Error("API key is required.");
    }
    const response = await fetch(`${apiBase}/auth/session`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey
      },
      body: JSON.stringify({ playerId })
    });
    if (!response.ok) {
      throw new Error(`Session token request failed (${response.status})`);
    }
    const payload = (await response.json()) as { token: string };
    setToken(payload.token);
    return payload.token;
  };

  const stopMatchmakingPolling = (): void => {
    pollingRunRef.current += 1;
  };

  const pollMatchmakingStatus = async (authToken: string, requestId: string, expiresAt?: number): Promise<void> => {
    const runId = pollingRunRef.current;
    log(`matchmaking/status polling started (requestId=${requestId})`);
    let attempt = 0;
    while (pollingRunRef.current === runId) {
      if (expiresAt && Date.now() >= expiresAt) {
        setStatus("timed_out");
        log(`matchmaking/status terminal -> ${JSON.stringify({ status: "timed_out", requestId })}`);
        return;
      }
      attempt += 1;
      const response = await fetch(`${apiBase}/matchmaking/status?requestId=${encodeURIComponent(requestId)}`, {
        headers: {
          authorization: `Bearer ${authToken}`
        }
      });
      const payload = (await response.json()) as { found?: boolean; status?: string; roomId?: string; requestId?: string; error?: string };
      if (!response.ok) {
        throw new Error(payload.error ?? payload.status ?? `Status failed (${response.status})`);
      }
      log(`matchmaking/status #${attempt} -> ${JSON.stringify(payload)}`);
      if (!payload.found || !payload.status || payload.status === "queued") {
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
        continue;
      }
      if (payload.roomId) {
        setRoomId(payload.roomId);
      }
      setStatus(payload.status);
      log(`matchmaking/status terminal -> ${JSON.stringify(payload)}`);
      return;
    }
    log("matchmaking/status polling stopped");
  };

  useEffect(() => () => stopMatchmakingPolling(), []);

  const findMatch = async (): Promise<void> => {
    try {
      stopMatchmakingPolling();
      setStatus("matchmaking");
      const authToken = token || (await requestSessionToken());
      const response = await fetch(`${apiBase}/matchmaking/join`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${authToken}`
        },
        body: JSON.stringify({ playerId })
      });
      const payload = (await response.json()) as {
        matched: boolean;
        roomId?: string;
        status?: string;
        requestId?: string;
        expiresAt?: number;
      };
      if (!response.ok) {
        throw new Error(payload.status ?? `Join failed (${response.status})`);
      }
      if (payload.roomId) {
        setRoomId(payload.roomId);
      }
      const nextStatus = payload.matched ? "matched" : (payload.status ?? "queued");
      setStatus(nextStatus);
      log(`matchmaking/join -> ${JSON.stringify(payload)}`);
      if (!payload.matched && nextStatus === "queued" && payload.requestId) {
        const runId = pollingRunRef.current + 1;
        pollingRunRef.current = runId;
        await pollMatchmakingStatus(authToken, payload.requestId, payload.expiresAt);
      }
    } catch (error) {
      stopMatchmakingPolling();
      setStatus("error");
      setLastError(String(error));
      log(`matchmaking/join error -> ${String(error)}`);
    }
  };

  const connectRoom = async (): Promise<void> => {
    try {
      setStatus("connecting");
      const authToken = token || (await requestSessionToken());
      socketRef.current?.close();
      const ws = new WebSocket(
        `${wsBase}/room/${encodeURIComponent(roomId)}?playerId=${encodeURIComponent(playerId)}&roomId=${encodeURIComponent(roomId)}&access_token=${encodeURIComponent(authToken)}`
      );
      socketRef.current = ws;
      ws.onopen = () => {
        setStatus("connected");
        ws.send(JSON.stringify({ type: "join", playerId }));
        log("room websocket connected + join sent");
      };
      ws.onmessage = (event) => {
        const data = String(event.data);
        log(`room event -> ${data}`);
        try {
          const parsed = JSON.parse(data) as { type?: string; code?: string };
          if (parsed.type === "error") {
            setLastError(parsed.code ?? "UNKNOWN_ERROR");
          }
        } catch {
          // no-op
        }
      };
      ws.onclose = () => {
        setStatus("disconnected");
        log("room websocket disconnected");
      };
      ws.onerror = () => {
        setStatus("error");
        setLastError("WEBSOCKET_ERROR");
        log("room websocket error");
      };
    } catch (error) {
      setStatus("error");
      setLastError(String(error));
      log(`room connect error -> ${String(error)}`);
    }
  };

  const reconnectRoom = async (): Promise<void> => {
    setStatus("reconnecting");
    await connectRoom();
  };

  const sendInvalidMove = (): void => {
    const ws = socketRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      setLastError("NOT_CONNECTED");
      return;
    }
    ws.send(
      JSON.stringify({
        type: "move",
        seq: 999,
        move: { fromRow: 1, fromCol: 1, toRow: 2, toCol: 1 }
      })
    );
    log("invalid move sent");
  };

  return (
    <main className="app-shell">
      <h1>AstraChess Multiplayer</h1>
      <p>Backend API base: <code>{apiBase}</code></p>
      <label>
        API key
        <input value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder="paste API_KEY from .dev.vars" />
      </label>
      <label>
        Session token
        <input value={token} onChange={(event) => setToken(event.target.value)} placeholder="paste Bearer token to avoid API key in browser calls" />
      </label>
      <label>
        Player ID
        <input value={playerId} onChange={(event) => setPlayerId(event.target.value)} />
      </label>
      <div className="actions">
        <button onClick={() => setScreen("lobby")}>Lobby</button>
        <button onClick={() => setScreen("room")}>Room</button>
        <button onClick={() => setScreen("game")}>Game HUD</button>
      </div>
      {screen === "lobby" && (
        <section className="panel">
          <h2>Lobby</h2>
          <p>Status: {status}</p>
          <button onClick={() => void requestSessionToken()}>Get Session Token</button>
          <button onClick={() => void findMatch()}>Find Match</button>
        </section>
      )}
      {screen === "room" && (
        <section className="panel">
          <h2>Room</h2>
          <label>
            Room ID
            <input value={roomId} onChange={(event) => setRoomId(event.target.value)} />
          </label>
          <div className="actions">
            <button onClick={() => void connectRoom()}>Connect</button>
            <button onClick={() => void reconnectRoom()}>Reconnect</button>
          </div>
          <p>Status: {status}</p>
        </section>
      )}
      {screen === "game" && (
        <section className="panel">
          <h2>Game HUD</h2>
          <p>Turn: P1</p>
          <div className="actions">
            <button onClick={sendInvalidMove}>Trigger Protocol Error</button>
            <button onClick={() => setLastError("")}>Clear Error</button>
          </div>
          {lastError ? <p className="error">Protocol error: {lastError}</p> : <p className="ok">No protocol errors</p>}
        </section>
      )}
      <section className="panel">
        <h2>Network log</h2>
        {messages.length === 0
          ? <p className="ok">No messages yet</p>
          : messages.map((line, index) => <p key={`${index}-${line}`}>{line}</p>)}
      </section>
    </main>
  );
}
