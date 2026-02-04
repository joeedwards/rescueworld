"use strict";
/**
 * Signaling + matchmaking server (WebSocket).
 * Assigns player to game server; reads from Redis registry if REDIS_URL set.
 */
Object.defineProperty(exports, "__esModule", { value: true });
const ws_1 = require("ws");
const registry_js_1 = require("./registry.js");
const leaderboard_js_1 = require("./leaderboard.js");
/** Timestamped log function for server output */
function log(message) {
    const now = new Date();
    const timestamp = now.toISOString().replace('T', ' ').slice(0, 19);
    console.log(`[${timestamp}] [rescue] ${message}`);
}
const SIGNALING_PORT = Number(process.env.SIGNALING_PORT) || 4000;
const GAME_WS_URL = process.env.GAME_WS_URL || 'ws://localhost:4001';
const GAME_WS_URL_ALT = process.env.GAME_WS_URL_ALT || '';
const wss = new ws_1.WebSocketServer({ port: SIGNALING_PORT });
wss.on('connection', (ws) => {
    ws.on('close', () => {
        (0, leaderboard_js_1.unsubscribeFromLeaderboard)(ws);
    });
    ws.on('message', (raw) => {
        try {
            const msg = JSON.parse(raw.toString());
            if (msg.type === 'subscribeLeaderboard') {
                (0, leaderboard_js_1.subscribeToLeaderboard)(ws);
                return;
            }
            if (msg.type === 'join') {
                (async () => {
                    const servers = await (0, registry_js_1.getGameServers)();
                    const latency = typeof msg.latency === 'number' ? msg.latency : 0;
                    let gameUrl;
                    if (servers.length > 0) {
                        gameUrl = servers[0].url;
                    }
                    else if (latency > 150 && GAME_WS_URL_ALT) {
                        gameUrl = GAME_WS_URL_ALT;
                    }
                    else {
                        gameUrl = GAME_WS_URL;
                    }
                    ws.send(JSON.stringify({ type: 'joined', gameUrl }));
                })();
            }
        }
        catch {
            // ignore
        }
    });
});
log(`Signaling server on ws://localhost:${SIGNALING_PORT}`);
