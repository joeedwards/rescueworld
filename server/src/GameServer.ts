/**
 * Game server: authoritative tick loop, accepts WebSocket connections for game channel.
 * Broadcasts snapshots every tick. Clients send input packets.
 */

import { WebSocketServer } from 'ws';
import { World } from './game/World.js';
import { TICK_RATE, TICK_MS } from 'shared';
import { decodeInput, encodeSnapshot, MSG_INPUT } from 'shared';

const GAME_WS_PORT = Number(process.env.GAME_WS_PORT) || 4001;

const wss = new WebSocketServer({ port: GAME_WS_PORT });
let world = new World();

const connections = new Map<string, WebSocket>();

function maybeResetWorld(): void {
  if (connections.size === 0) {
    world = new World();
  }
}

wss.on('connection', (ws) => {
  maybeResetWorld();
  const id = `p-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  world.addPlayer(id);
  connections.set(id, ws);
  ws.send(JSON.stringify({ type: 'welcome', playerId: id }));

  ws.binaryType = 'arraybuffer';
  ws.on('message', (data: Buffer | ArrayBuffer) => {
    const buf = data instanceof ArrayBuffer ? data : data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
    if (buf.byteLength < 1) return;
    const view = new DataView(buf);
    if (view.getUint8(0) === MSG_INPUT) {
      const { inputFlags, inputSeq } = decodeInput(buf);
      world.setInput(id, inputFlags, inputSeq);
    }
  });
  ws.on('close', () => {
    world.removePlayer(id);
    connections.delete(id);
    maybeResetWorld();
  });
  ws.on('error', () => {
    world.removePlayer(id);
    connections.delete(id);
    maybeResetWorld();
  });
});

// Fixed tick loop
setInterval(() => {
  try {
    world.tickWorld();
    const snapshot = world.getSnapshot();
    const buf = encodeSnapshot(snapshot);
    for (const ws of connections.values()) {
      if (ws.readyState === 1) ws.send(buf);
    }
  } catch (err) {
    console.error('Tick error:', err);
  }
}, TICK_MS);

console.log(`Game server (WebSocket) on ws://localhost:${GAME_WS_PORT}`);
