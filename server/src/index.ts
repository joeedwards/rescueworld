/**
 * Rescue server: starts signaling (matchmaking), game server, and auth API in one process.
 * Ensures storage (Redis or SQLite fallback) is ready before starting servers.
 */

import path from 'path';
import dotenv from 'dotenv';

// Load .env from repo root so it works regardless of cwd (e.g. systemd, pm2)
dotenv.config({ path: path.resolve(__dirname, '..', '..', '.env') });

// Game server uses UTC for daily reset (daily gifts, leaderboards). Set TZ so Date logic is consistent.
if (!process.env.TZ) process.env.TZ = 'UTC';

async function main(): Promise<void> {
  const { ensureStorage } = await import('./registry.js');
  const status = await ensureStorage();
  if (!status.redis && !status.sqlite) {
    console.warn('Storage: Redis and SQLite unavailable. Guest names will use random fallback.');
  }

  await import('./SignalingServer.js');
  await import('./GameServer.js');
  await import('./authServer.js');

  // Graceful shutdown: save solo matches, deposit FFA/Teams RT, close connections
  const onShutdown = async (): Promise<void> => {
    const { gracefulShutdown } = await import('./GameServer.js');
    await gracefulShutdown();
    process.exit(0);
  };
  process.on('SIGTERM', onShutdown);
  process.on('SIGINT', onShutdown);
}

main().catch((err) => {
  console.error('Server failed to start:', err);
  process.exit(1);
});
