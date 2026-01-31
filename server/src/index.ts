/**
 * Rescue server: starts signaling (matchmaking), game server, and auth API in one process.
 * Ensures storage (Redis or SQLite fallback) is ready before starting servers.
 */

import path from 'path';
import dotenv from 'dotenv';

// Load .env from repo root so it works regardless of cwd (e.g. systemd, pm2)
dotenv.config({ path: path.resolve(__dirname, '..', '..', '.env') });

async function main(): Promise<void> {
  const { ensureStorage } = await import('./registry.js');
  const status = await ensureStorage();
  if (!status.redis && !status.sqlite) {
    console.warn('Storage: Redis and SQLite unavailable. Guest names will use random fallback.');
  }

  await import('./SignalingServer.js');
  await import('./GameServer.js');
  await import('./authServer.js');
}

main().catch((err) => {
  console.error('Server failed to start:', err);
  process.exit(1);
});
