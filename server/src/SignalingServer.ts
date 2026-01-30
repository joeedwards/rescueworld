/**
 * Signaling + matchmaking server (WebSocket).
 * For MVP: assigns player to game server and returns game server URL.
 * Later: SDP/ICE exchange for WebRTC; for now game traffic is WebSocket to game server.
 */

import { WebSocketServer } from 'ws';

const SIGNALING_PORT = Number(process.env.SIGNALING_PORT) || 4000;
const GAME_WS_URL = process.env.GAME_WS_URL || 'ws://localhost:4001';

const wss = new WebSocketServer({ port: SIGNALING_PORT });

wss.on('connection', (ws) => {
  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      if (msg.type === 'join') {
        // Matchmaking: for MVP we have one game server; just return its URL
        ws.send(
          JSON.stringify({
            type: 'joined',
            gameUrl: GAME_WS_URL,
          })
        );
      }
    } catch {
      // ignore
    }
  });
});

console.log(`Signaling server on ws://localhost:${SIGNALING_PORT}`);
