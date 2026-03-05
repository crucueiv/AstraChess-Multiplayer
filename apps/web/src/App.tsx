import { useState } from "react";

const apiBase = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8787";
type Screen = "lobby" | "room" | "game";

export function App(): JSX.Element {
  const [screen, setScreen] = useState<Screen>("lobby");
  const [roomId, setRoomId] = useState("room-1");
  const [status, setStatus] = useState("idle");
  const [lastError, setLastError] = useState("");

  return (
    <main className="app-shell">
      <h1>AstraChess Multiplayer</h1>
      <p>Backend API base: <code>{apiBase}</code></p>
      <div className="actions">
        <button onClick={() => setScreen("lobby")}>Lobby</button>
        <button onClick={() => setScreen("room")}>Room</button>
        <button onClick={() => setScreen("game")}>Game HUD</button>
      </div>
      {screen === "lobby" && (
        <section className="panel">
          <h2>Lobby</h2>
          <p>Status: {status}</p>
          <button onClick={() => setStatus("matchmaking")}>Find Match</button>
          <button onClick={() => setStatus("queued-timeout")}>Simulate Timeout</button>
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
            <button onClick={() => setStatus("connected")}>Connect</button>
            <button onClick={() => setStatus("reconnecting")}>Reconnect</button>
          </div>
          <p>Status: {status}</p>
        </section>
      )}
      {screen === "game" && (
        <section className="panel">
          <h2>Game HUD</h2>
          <p>Turn: P1</p>
          <div className="actions">
            <button onClick={() => setLastError("INVALID_MOVE")}>Trigger Protocol Error</button>
            <button onClick={() => setLastError("")}>Clear Error</button>
          </div>
          {lastError ? <p className="error">Protocol error: {lastError}</p> : <p className="ok">No protocol errors</p>}
        </section>
      )}
    </main>
  );
}
