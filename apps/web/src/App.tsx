import { useEffect, useMemo, useRef, useState } from "react";

const apiBase = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8787";
type Screen = "lobby" | "room" | "game";
type PlayerSlot = "P1" | "P2";
type PieceSnapshot = {
  row: number;
  col: number;
  type: "pawn" | "knight" | "rook" | "bishop" | "queen" | "king" | "custom" | "none";
  color: "white" | "black" | "none";
};
type GameState = {
  seq: number;
  turn: PlayerSlot;
  pieces: PieceSnapshot[];
};
const POLL_INTERVAL_MS = 1_500;

export function App(): JSX.Element {
  const [screen, setScreen] = useState<Screen>("lobby");
  const [playerId, setPlayerId] = useState("p1");
  const [roomId, setRoomId] = useState("room-1");
  const [token, setToken] = useState("");
  const [status, setStatus] = useState("idle");
  const [lastError, setLastError] = useState("");
  const [messages, setMessages] = useState<string[]>([]);
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [playerSlot, setPlayerSlot] = useState<PlayerSlot | null>(null);
  const [moveCommand, setMoveCommand] = useState("");
  const [commandError, setCommandError] = useState("");
  const socketRef = useRef<WebSocket | null>(null);
  const pollingRunRef = useRef(0);

  const log = (message: string): void => {
    setMessages((prev) => [message, ...prev].slice(0, 12));
  };

  const wsBase = apiBase.startsWith("https://")
    ? apiBase.replace("https://", "wss://")
    : apiBase.replace("http://", "ws://");

  const resolveToken = (): string => {
    const authToken = token.trim();
    if (!authToken) {
      setStatus("missing-token");
      throw new Error("Session token is required.");
    }
    return authToken;
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
      const authToken = resolveToken();
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
      setCommandError("");
      const authToken = resolveToken();
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
          const parsed = JSON.parse(data) as
            | { type?: "error"; code?: string }
            | { type?: "welcome"; player?: PlayerSlot; state?: GameState }
            | { type?: "state"; state?: GameState };
          if (parsed.type === "error") {
            setLastError(parsed.code ?? "UNKNOWN_ERROR");
            return;
          }
          if (parsed.type === "welcome") {
            if (parsed.player) {
              setPlayerSlot(parsed.player);
            }
            if (parsed.state) {
              setGameState(parsed.state);
            }
            return;
          }
          if (parsed.type === "state" && parsed.state) {
            setGameState(parsed.state);
          }
        } catch {
          setLastError("BAD_EVENT_PAYLOAD");
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

  const sendMoveCommand = (): void => {
    try {
      const ws = socketRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        throw new Error("NOT_CONNECTED");
      }
      const move = parseMoveCommand(moveCommand);
      ws.send(
        JSON.stringify({
          type: "move",
          seq: gameState?.seq,
          move
        })
      );
      setMoveCommand("");
      setCommandError("");
      log(`move sent -> ${JSON.stringify(move)}`);
    } catch (error) {
      setCommandError(String(error));
    }
  };

  const boardRows = useMemo(() => toBoardRows(gameState?.pieces ?? []), [gameState?.pieces]);
  const playerColor = playerSlot === "P1" ? "white" : playerSlot === "P2" ? "black" : "unknown";

  return (
    <main className="app-shell">
      <h1>AstraChess Multiplayer</h1>
      <p>Backend API base: <code>{apiBase}</code></p>
      <label>
        Session token
        <input value={token} onChange={(event) => setToken(event.target.value)} placeholder="paste your session token" />
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
          <p>Your color: {playerColor}</p>
          <p>Turn: {gameState?.turn ?? "unknown"}</p>
          <label>
            Move command
            <input
              value={moveCommand}
              onChange={(event) => setMoveCommand(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  sendMoveCommand();
                }
              }}
              placeholder="a2 a4"
            />
          </label>
          <button onClick={sendMoveCommand}>Send Move</button>
          {commandError ? <p className="error">{commandError}</p> : <p className="ok">Command ready</p>}
          <h3>Board</h3>
          <pre className="board">{boardRows.map((row) => row.join(" ")).join("\n")}</pre>
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

function parseMoveCommand(command: string): { fromRow: number; fromCol: number; toRow: number; toCol: number } {
  const normalized = command.trim().toLowerCase().replace(/\s+/g, "").replace("->", "").replace("-", "");
  const match = normalized.match(/^([a-h])([1-8])([a-h])([1-8])$/);
  if (!match) {
    throw new Error("Invalid move command. Use format like: a2 a4");
  }
  const [, fromColLetter, fromRow, toColLetter, toRow] = match;
  return {
    fromRow: Number(fromRow),
    fromCol: colLetterToNumber(fromColLetter),
    toRow: Number(toRow),
    toCol: colLetterToNumber(toColLetter)
  };
}

function colLetterToNumber(letter: string): number {
  return letter.charCodeAt(0) - 96;
}

function toBoardRows(pieces: PieceSnapshot[]): string[][] {
  const board = Array.from({ length: 8 }, () => Array.from({ length: 8 }, () => "0"));
  for (const piece of pieces) {
    if (piece.type === "none" || piece.color === "none") {
      continue;
    }
    if (piece.row < 1 || piece.row > 8 || piece.col < 1 || piece.col > 8) {
      continue;
    }
    const base = piece.type.charAt(0);
    const symbol = piece.color === "white" ? base.toUpperCase() : base.toLowerCase();
    board[8 - piece.row][piece.col - 1] = symbol;
  }
  return board;
}
