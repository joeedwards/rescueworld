/**
 * Signaling + matchmaking server (WebSocket).
 * Assigns player to game server; reads from Redis registry if REDIS_URL set.
 */

import { WebSocketServer } from 'ws';
import { getGameServers } from './registry.js';

const SIGNALING_PORT = Number(process.env.SIGNALING_PORT) || 4000;
const GAME_WS_URL = process.env.GAME_WS_URL || 'ws://localhost:4001';
const GAME_WS_URL_ALT = process.env.GAME_WS_URL_ALT || '';

const wss = new WebSocketServer({ port: SIGNALING_PORT });

wss.on('connection', (ws) => {
  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      if (msg.type === 'join') {
        (async () => {
          const servers = await getGameServers();
          const latency = typeof msg.latency === 'number' ? msg.latency : 0;
          let gameUrl: string;
          if (servers.length > 0) {
            gameUrl = servers[0].url;
          } else if (latency > 150 && GAME_WS_URL_ALT) {
            gameUrl = GAME_WS_URL_ALT;
          } else {
            gameUrl = GAME_WS_URL;
          }
          ws.send(JSON.stringify({ type: 'joined', gameUrl }));
        })();
      }
    } catch {
      // ignore
    }
  });
});

console.log(`Signaling server on ws://localhost:${SIGNALING_PORT}`);
