# Puppy Rescue

.io-style multiplayer browser game: find pets, carry them to shelters, score points. Phase 1 MVP per the game design plan.

## Architecture

- **Signaling server** (WebSocket, port 4000): matchmaking; returns game server URL.
- **Game server** (WebSocket, port 4001): authoritative tick loop; clients send input, server broadcasts snapshots.
- **Client** (Vite, port 3000): browser; 8-directional movement, tap-to-move, prediction/interpolation.

## Prerequisites

- Node.js 18+
- npm (or pnpm/yarn with workspaces)

## Setup

```bash
npm install
npm run build -w shared
```

## Run

**Important:** The game needs both the server (ports 4000, 4001) and the client (port 3000). If you only run the client, the browser will show "Could not connect" and Vite may log `ECONNREFUSED 127.0.0.1:4000`.

Build shared once (required for server):
```bash
npm run build -w shared
```

**Option A – one command (from repo root; starts server and client together):**
```bash
npm run dev
```
Then open http://localhost:3000. Wait a few seconds for both processes to be ready before refreshing.

**Option B – two terminals:**

Terminal 1 – start the server first (signaling + game):
```bash
npm run dev:server
```
Wait until you see "Signaling server on ws://localhost:4000" and "Game server (WebSocket) on ws://localhost:4001".

Terminal 2 – then start the client:
```bash
npm run dev:client
```

Open http://localhost:3000.

**How to play:** You are a shelter. WASD or tap to move. Collect strays (brown) up to your size; bring them to the Adoption Center (green circle) to adopt out and grow. Green orbs = +size, blue = speed boost.

## Build all

```bash
npm run build -w shared
npm run build -w server
npm run build -w client
```

## Project layout

- `shared/` – constants, types, binary protocol (input + snapshot).
- `server/` – signaling (WebSocket) + game server (WebSocket, authoritative tick loop).
- `client/` – browser client (Vite, canvas 2D, prediction + interpolation).
