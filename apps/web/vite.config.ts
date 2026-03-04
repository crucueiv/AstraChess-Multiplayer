import { defineConfig } from "vite";

const base = process.env.GITHUB_PAGES === "true" ? "/AstraChess-Multiplayer/" : "/";

export default defineConfig({
  base
});
