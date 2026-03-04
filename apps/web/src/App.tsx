const apiBase = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8787";

export function App(): JSX.Element {
  return (
    <main className="app-shell">
      <h1>AstraChess Multiplayer</h1>
      <p>Frontend workspace scaffolded in this repository.</p>
      <p>
        Backend API base: <code>{apiBase}</code>
      </p>
    </main>
  );
}
