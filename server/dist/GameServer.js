"use strict";
/**
 * Game server: authoritative tick loop, accepts WebSocket connections for game channel.
 * Broadcasts snapshots every tick. Clients send input packets.
 */
Object.defineProperty(exports, "__esModule", { value: true });
const ws_1 = require("ws");
const World_js_1 = require("./game/World.js");
const shared_1 = require("shared");
const shared_2 = require("shared");
const registry_js_1 = require("./registry.js");
const GAME_WS_PORT = Number(process.env.GAME_WS_PORT) || 4001;
const GAME_WS_URL = process.env.GAME_WS_URL || `ws://localhost:${GAME_WS_PORT}`;
const SERVER_ID = process.env.SERVER_ID || `game-${GAME_WS_PORT}`;
const FFA_COUNTDOWN_MS = 10000;
const wss = new ws_1.WebSocketServer({ port: GAME_WS_PORT });
let world = new World_js_1.World();
const cpuIdsAdded = new Set();
let guestCounter = 0;
const connections = new Map();
const connectionMode = new Map();
let matchPhase = 'lobby';
let matchMode = 'ffa';
let countdownEndAt = 0;
const readySet = new Set();
setInterval(() => {
    (0, registry_js_1.registerServer)(SERVER_ID, GAME_WS_URL, connections.size).catch(() => { });
}, 10000);
function maybeResetWorld() {
    if (connections.size === 0) {
        world = new World_js_1.World();
        cpuIdsAdded.clear();
        guestCounter = 0;
        matchPhase = 'lobby';
        matchMode = 'ffa';
        countdownEndAt = 0;
        readySet.clear();
        connectionMode.clear();
    }
}
function getMatchState() {
    const readyCount = readySet.size;
    let countdownRemainingSec;
    if (matchPhase === 'countdown' && countdownEndAt > 0) {
        countdownRemainingSec = Math.max(0, Math.ceil((countdownEndAt - Date.now()) / 1000));
    }
    return {
        type: 'matchState',
        phase: matchPhase,
        ...(countdownRemainingSec !== undefined && { countdownRemainingSec }),
        readyCount,
    };
}
function ensureMinPlayers(mode) {
    const snapshot = world.getSnapshot();
    const humanCount = connections.size;
    if (mode === 'solo') {
        for (let i = 1; i <= 3; i++) {
            const cid = `cpu-${i}`;
            if (!cpuIdsAdded.has(cid)) {
                world.addPlayer(cid, `CPU-${i}`);
                cpuIdsAdded.add(cid);
            }
        }
        return;
    }
    if ((mode === 'ffa' || !mode) && humanCount === 2 && snapshot.players.filter((p) => !p.id.startsWith('cpu-')).length < 3) {
        const cid = 'cpu-1';
        if (!cpuIdsAdded.has(cid)) {
            world.addPlayer(cid, 'CPU-1');
            cpuIdsAdded.add(cid);
        }
    }
}
function transitionToPlaying() {
    if (matchPhase !== 'playing') {
        matchPhase = 'playing';
        world.startMatch();
    }
}
wss.on('connection', (ws) => {
    maybeResetWorld();
    guestCounter += 1;
    const id = `p-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const displayName = `rescue${guestCounter}`;
    world.addPlayer(id, displayName);
    connections.set(id, ws);
    if (matchPhase === 'lobby' && connections.size >= 2 && matchMode === 'ffa') {
        ensureMinPlayers('ffa');
        matchPhase = 'countdown';
        countdownEndAt = Date.now() + FFA_COUNTDOWN_MS;
        readySet.clear();
    }
    ws.send(JSON.stringify({ type: 'welcome', playerId: id, displayName }));
    ws.binaryType = 'arraybuffer';
    ws.on('message', (data) => {
        if (typeof data.toString === 'function') {
            try {
                const raw = data.toString();
                const msg = JSON.parse(raw);
                if (msg.type === 'ping' && typeof msg.ts === 'number') {
                    const snapshot = world.getSnapshot();
                    ws.send(JSON.stringify({ type: 'pong', ts: msg.ts, serverTick: snapshot.tick }));
                    return;
                }
                if (msg.type === 'mode' && typeof msg.mode === 'string') {
                    connectionMode.set(id, msg.mode);
                    const humanCount = connections.size;
                    if (msg.mode === 'solo') {
                        matchMode = 'solo';
                        matchPhase = 'playing';
                        ensureMinPlayers('solo');
                        world.startMatch();
                    }
                    else if (msg.mode === 'ffa' || !msg.mode) {
                        matchMode = 'ffa';
                        if (humanCount === 1) {
                            matchPhase = 'lobby';
                        }
                        else if (humanCount >= 2 && matchPhase === 'lobby') {
                            ensureMinPlayers('ffa');
                            matchPhase = 'countdown';
                            countdownEndAt = Date.now() + FFA_COUNTDOWN_MS;
                            readySet.clear();
                        }
                    }
                    return;
                }
                if (msg.type === 'ready') {
                    readySet.add(id);
                    if (matchPhase === 'countdown' && readySet.size >= 2) {
                        transitionToPlaying();
                    }
                    return;
                }
                if (msg.type === 'startingBoosts' && (typeof msg.sizeBonus === 'number' || msg.speedBoost || msg.adoptSpeed)) {
                    world.applyStartingBoosts(id, {
                        sizeBonus: typeof msg.sizeBonus === 'number' ? msg.sizeBonus : 0,
                        speedBoost: !!msg.speedBoost,
                        adoptSpeed: !!msg.adoptSpeed,
                    });
                    return;
                }
            }
            catch {
                // not JSON, fall through to binary
            }
        }
        const buf = data instanceof ArrayBuffer ? data : data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
        if (buf.byteLength < 1)
            return;
        const view = new DataView(buf);
        if (view.getUint8(0) === shared_2.MSG_INPUT) {
            const { inputFlags, inputSeq } = (0, shared_2.decodeInput)(buf);
            world.setInput(id, inputFlags, inputSeq);
        }
    });
    ws.on('close', () => {
        world.removePlayer(id);
        connections.delete(id);
        connectionMode.delete(id);
        readySet.delete(id);
        maybeResetWorld();
    });
    ws.on('error', () => {
        world.removePlayer(id);
        connections.delete(id);
        connectionMode.delete(id);
        readySet.delete(id);
        maybeResetWorld();
    });
});
let lastReplayTick = 0;
setInterval(() => {
    try {
        if (matchPhase === 'countdown') {
            if (Date.now() >= countdownEndAt) {
                transitionToPlaying();
            }
            const matchState = getMatchState();
            for (const ws of connections.values()) {
                if (ws.readyState === 1)
                    ws.send(JSON.stringify(matchState));
            }
        }
        else if (matchPhase === 'lobby') {
            const matchState = getMatchState();
            for (const ws of connections.values()) {
                if (ws.readyState === 1)
                    ws.send(JSON.stringify(matchState));
            }
        }
        else {
            world.tickWorld();
            const snapshot = world.getSnapshot();
            if (snapshot.tick - lastReplayTick >= 50) {
                lastReplayTick = snapshot.tick;
                const hash = snapshot.stateHash ?? String(snapshot.tick);
                (0, registry_js_1.appendReplay)(SERVER_ID, snapshot.tick, hash).catch(() => { });
            }
            const buf = (0, shared_2.encodeSnapshot)(snapshot);
            for (const ws of connections.values()) {
                if (ws.readyState === 1)
                    ws.send(buf);
            }
        }
    }
    catch (err) {
        console.error('Tick error:', err);
    }
}, shared_1.TICK_MS);
console.log(`Game server (WebSocket) on ws://localhost:${GAME_WS_PORT}`);
