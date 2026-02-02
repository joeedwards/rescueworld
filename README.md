# Adoptar.io – Pet Rescue/Adoption io game

Multiplayer browser game: rescue pets, adopt them out to grow your shelter, and earn money for boosts before matches.

**How to play:** You are a shelter. WASD or tap to move. Collect strays (brown) up to your size; bring them to the Adoption Center (green circle) to adopt out and grow. Green orbs = +size, blue = speed boost.

Each player starts the same size. As you adopt pets, you earn money and can buy boosts before matches.

When your shelter gets large enough to form its own adoption center, you become grounded (can’t move) and must rely on gravity to pull in strays and adopt out.

When you touch another shelter, you can ally or fight. At the end of the 5‑minute match, the largest shelter wins a bonus and the top 3 earn rewards.

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



## Build all

```bash
npm run build -w shared
npm run build -w server
npm run build -w client
```

## Production deployment (nginx)

**Browser = client.** When you open the game in a browser, that *is* the client. You do **not** run `dev:client` on the server; nginx serves the built static files from `client/dist/`.

To serve the game behind nginx (e.g. at `https://games.vo.ly/rescueworld/`):

1. **Build the client** (output: `client/dist/`):
   ```bash
   npm run build -w shared
   NODE_ENV=production npm run build -w client
   ```

2. **Add nginx config.** Merge the contents of [`nginx-rescueworld.conf`](nginx-rescueworld.conf) into the `games.vo.ly` server block in `/etc/nginx/sites-enabled/cdr` (after the "Block common attack" location, before the `/api` location). That adds:
   - `/ws-signaling` → proxy to `127.0.0.1:4000`
   - `/ws-game` → proxy to `127.0.0.1:4001`
   - `/rescueworld/` → static files from `client/dist/` with SPA fallback

3. **Run the game server** with the public WebSocket URL so the signaling server tells clients the correct game URL:
   ```bash
   GAME_WS_URL=wss://games.vo.ly/ws-game npm run start
   ```
   (Build server first: `npm run build -w server`.) Optional env: `SIGNALING_PORT=4000`, `GAME_WS_PORT=4001` (defaults).

4. **Reload nginx** and ensure the Node process is listening on 4000 and 4001:
   ```bash
   sudo nginx -t && sudo systemctl reload nginx
   ```

The client uses the current host for signaling (`wss://<host>/ws-signaling`); the game URL comes from the server, so `GAME_WS_URL` must match the public URL (scheme + host + path `/ws-game`).

**If you see 404 for `/src/main.ts`:** the dev `index.html` is being served instead of the built one. Ensure (1) the nginx `alias` for `/rescueworld/` points to `.../client/dist/` (not `.../client/`), and (2) the production build exists: run `NODE_ENV=production npm run build -w client` on the server and confirm `client/dist/index.html` contains a script tag like `src="/rescueworld/assets/index-....js"` (not `import('/src/main.ts')`).

## Google SSO (OAuth) setup

To enable "Sign in with Google", create OAuth 2.0 credentials and configure your app origin and redirect URIs.

1. **Create credentials**
   - Go to [Google Cloud Console](https://console.cloud.google.com/) and create or select a project.
   - Open **APIs & Services** → **Credentials** → **Create credentials** → **OAuth client ID**.
   - If prompted, configure the OAuth consent screen (User type: External; add your app name and support email).
   - Application type: **Web application**.

2. **Authorized JavaScript origins**
   - Add every origin where the game client is loaded (scheme + host, no path, no trailing slash).
   - Examples:
     - Local dev: `http://localhost:3000`
     - Production: `https://games.vo.ly` (or your game host)

3. **Authorized redirect URIs**
   - The auth server uses: `{API_ORIGIN}/auth/google/callback`.
   - Add the exact callback URL for each environment:
     - Local dev (client and API proxy on 3000): `http://localhost:3000/auth/google/callback`
     - Production (if API is at same host as game): `https://games.vo.ly/auth/google/callback`  
   - Use your real `API_ORIGIN` value (see below). No trailing slash.

4. **Copy Client ID and Client secret** into `.env`:
   ```env
   GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
   GOOGLE_CLIENT_SECRET=your-client-secret
   API_ORIGIN=https://games.vo.ly
   ```
   - **Local:** `API_ORIGIN=http://localhost:3000` (so the client at localhost:3000 and the callback URL match).
   - **Production:** `API_ORIGIN` must be the public origin of the game (e.g. `https://games.vo.ly`). The auth API must be reachable at `{API_ORIGIN}/auth/*` (proxy `/auth` to the API server, e.g. port 4002).

5. **Proxy `/auth` in production**  
   In nginx (or your reverse proxy), proxy `/auth` to the same process that serves the auth API (e.g. `http://127.0.0.1:4002`), so that `https://games.vo.ly/auth/google` and `https://games.vo.ly/auth/google/callback` hit the auth server.

**If you get "Google sign-in not configured" (503):** The server loads `.env` from the **repo root** (the directory that contains `server/` and `client/`). Ensure `.env` is there with `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` set (no quotes, no extra spaces). Restart the server after changing `.env`. If you start the process from another directory (e.g. systemd), the server still looks for `.env` relative to its own file path, so it should find the repo-root `.env`.

## Facebook Login (OAuth) setup

To enable "Sign in with Facebook", create a Facebook App and configure OAuth.

1. **Create an app**
   - Go to [Meta for Developers](https://developers.facebook.com/) and create an app.
   - Add **Facebook Login** as a product.

2. **Valid OAuth redirect URIs**
   - The auth server uses: `{API_ORIGIN}/auth/facebook/callback`
   - Add the exact callback URL for each environment:
     - Local dev: `http://localhost:3000/auth/facebook/callback`
     - Production: `https://games.vo.ly/auth/facebook/callback`

3. **Set env vars in `.env`**
   ```env
   FACEBOOK_APP_ID=your-app-id
   FACEBOOK_APP_SECRET=your-app-secret
   API_ORIGIN=https://games.vo.ly
   ```

4. **Proxy `/auth` in production**  
   Same as Google: ensure `/auth/*` routes go to the auth API server (port 4002).

## Redis and database setup

### Redis

Redis is used for the **world registry** (game server list for matchmaking) and optional **replay stream**. Copy [`.env.example`](.env.example) to `.env` and set:

```env
REDIS_URL=redis://localhost:6379
```

- **Default (no auth):** `redis://localhost:6379`
- **With password:** `redis://:yourpassword@localhost:6379`
- **Remote:** `redis://user:password@host:6379` (use your host and credentials).

If `REDIS_URL` is empty or unset, the app runs without Redis (single game server, no registry).

**Confirm Redis is running**

- **Ping:**  
  `redis-cli ping`  
  Expected: `PONG`.

- **Info (optional):**  
  `redis-cli INFO server`  
  Shows version and uptime.

- **System service (Linux):**  
  `systemctl status redis` or `systemctl status redis-server`  
  Should show `active (running)`.

**SQLite fallback:** When Redis is not configured or not running, the server creates a SQLite database (default: `server/rescueworld.db`) for the guest name counter. Set `SQLITE_DB_PATH` in `.env` to use a different path. A **health endpoint** is available at `GET /health` on the auth API (same port as `/auth/*`); it returns `{ redis: boolean, sqlite: boolean }` so you can confirm which storage is in use.

### Database (optional)

The auth API uses SQLite for referral/user metadata. You can add a separate database (e.g. Postgres) for users, sessions, match results, and world leaderboard. In `.env`:

```env
DATABASE_URL=postgresql://user:password@localhost:5432/rescueworld
```

(Replace with your driver format and credentials; e.g. `postgres://...` for Node Postgres clients.) The app does not use `DATABASE_URL` until you add DB-backed auth or leaderboard code; the variable is reserved for that.

## Project layout

- `shared/` – constants, types, binary protocol (input + snapshot).
- `server/` – signaling (WebSocket), game server (WebSocket), auth API (Express, port 4002), Redis registry/replay, referral tracking (SQLite + Redis).
- `client/` – browser client (Vite, canvas 2D, prediction + interpolation, audio, settings, ping/switch-server UI).

## Referral system (OAuth signups)

- Referral code is generated per OAuth user
- Shareable link: `?ref=CODE`
- Confirmed signup = Google or Facebook OAuth login
- Rewards: every 5 confirmed signups → special skin + money bonus
