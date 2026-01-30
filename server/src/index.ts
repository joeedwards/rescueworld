/**
 * Rescue server: starts signaling (matchmaking), game server, and auth API in one process.
 */

import path from 'path';
import dotenv from 'dotenv';

// Load .env from repo root so it works regardless of cwd (e.g. systemd, pm2)
dotenv.config({ path: path.resolve(__dirname, '..', '..', '.env') });

import { connectRegistry } from './registry.js';
import './SignalingServer';
import './GameServer';
import './authServer';

connectRegistry().catch(() => {});
