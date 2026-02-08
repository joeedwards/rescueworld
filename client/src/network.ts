/**
 * Network module — WebSocket connection management, signaling,
 * message sending helpers. The actual message handlers remain in main.ts
 * because they touch too many game-state and UI concerns.
 */

import { encodeInput } from 'shared';

// ---- Signaling URL ----
const SIGNALING_HOST = window.location.hostname === 'localhost' ? 'ws://localhost:4000' : '';
export const SIGNALING_URL = SIGNALING_HOST
  ? SIGNALING_HOST
  : `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/ws-signaling`;

// ---- WebSocket refs ----
export let gameWs: WebSocket | null = null;
export let myPlayerId: string | null = null;
export let currentMatchId: string | null = null;

export function setGameWs(ws: WebSocket | null): void { gameWs = ws; }
export function setMyPlayerId(id: string | null): void { myPlayerId = id; }
export function setCurrentMatchId(id: string | null): void { currentMatchId = id; }

// ---- Input sequence ----
let inputSeq = 0;
export function getInputSeq(): number { return inputSeq; }
export function nextInputSeq(): number { return inputSeq++; }

// ---- Helpers ----
export function sendInput(flags: number): void {
  if (gameWs?.readyState === WebSocket.OPEN) {
    const buf = encodeInput(flags, inputSeq++);
    gameWs.send(buf);
  }
}

export function sendJson(msg: object): void {
  if (gameWs?.readyState === WebSocket.OPEN) {
    gameWs.send(JSON.stringify(msg));
  }
}

export function isConnected(): boolean {
  return gameWs !== null && gameWs.readyState === WebSocket.OPEN;
}

// ---- Connection timeout ----
export const CONNECT_TIMEOUT_MS = 10000;

// ---- Auto-reconnect state ----
export const MAX_RECONNECT_ATTEMPTS = 3;
export const RECONNECT_BASE_DELAY_MS = 1500;

export interface MatchDisconnectInfo {
  matchId: string;
  mode: 'ffa' | 'teams' | 'solo';
  attempts: number;
}

export let matchDisconnectInfo: MatchDisconnectInfo | null = null;
export let matchEndedNormally = false;
export let reconnectTimeoutId: number | null = null;

export function setMatchDisconnectInfo(info: MatchDisconnectInfo | null): void { matchDisconnectInfo = info; }
export function setMatchEndedNormally(v: boolean): void { matchEndedNormally = v; }
export function setReconnectTimeoutId(id: number | null): void { reconnectTimeoutId = id; }

// ---- RTT / latency tracking ----
export let currentRttMs = 0;
export let highLatencySince = 0;
export const RTT_HIGH_MS = 200;
export const RTT_HIGH_DURATION_MS = 5000;
export let pingIntervalId: ReturnType<typeof setInterval> | null = null;

export function setCurrentRttMs(v: number): void { currentRttMs = v; }
export function setHighLatencySince(v: number): void { highLatencySince = v; }
export function setPingIntervalId(id: ReturnType<typeof setInterval> | null): void { pingIntervalId = id; }

// ---- Lobby leaderboard WebSocket (real-time) ----
export let lobbyLeaderboardWs: WebSocket | null = null;
export let lobbyLeaderboardReconnectAttempts = 0;
export let lobbyLeaderboardReconnectTimer: ReturnType<typeof setTimeout> | null = null;
export const LOBBY_LEADERBOARD_MAX_RECONNECT_DELAY = 30000;

export function setLobbyLeaderboardWs(ws: WebSocket | null): void { lobbyLeaderboardWs = ws; }
export function setLobbyLeaderboardReconnectAttempts(n: number): void { lobbyLeaderboardReconnectAttempts = n; }
export function setLobbyLeaderboardReconnectTimer(t: ReturnType<typeof setTimeout> | null): void { lobbyLeaderboardReconnectTimer = t; }
