/**
 * Game server: authoritative tick loop, accepts WebSocket connections for game channel.
 * Supports multiple isolated matches - each Solo game gets its own World.
 * FFA games share a lobby until enough players join.
 */

import type { WebSocket } from 'ws';
import { WebSocketServer } from 'ws';
import { World } from './game/World.js';
import { TICK_RATE, TICK_MS } from 'shared';
import { decodeInput, encodeSnapshot, MSG_INPUT } from 'shared';
import { registerServer, appendReplay, getNextGuestName } from './registry.js';

const GAME_WS_PORT = Number(process.env.GAME_WS_PORT) || 4001;
const GAME_WS_URL = process.env.GAME_WS_URL || `ws://localhost:${GAME_WS_PORT}`;
const SERVER_ID = process.env.SERVER_ID || `game-${GAME_WS_PORT}`;

const FFA_COUNTDOWN_MS = 10000;

type MatchPhase = 'lobby' | 'countdown' | 'playing';

interface Match {
  id: string;
  world: World;
  phase: MatchPhase;
  mode: 'ffa' | 'solo' | 'teams';
  countdownEndAt: number;
  players: Map<string, WebSocket>;
  cpuIds: Set<string>;
  readySet: Set<string>;
  fightAllyChoices: Map<string, 'fight' | 'ally'>;
  lastReplayTick: number;
}

const wss = new WebSocketServer({ port: GAME_WS_PORT });

// All active matches
const matches = new Map<string, Match>();
// Map player ID -> match ID for quick lookup
const playerToMatch = new Map<string, string>();
// FFA lobby match (waiting for players)
let ffaLobbyMatchId: string | null = null;

let matchIdCounter = 0;
function generateMatchId(): string {
  return `match-${Date.now().toString(36)}-${(++matchIdCounter).toString(36)}`;
}

setInterval(() => {
  const totalPlayers = Array.from(matches.values()).reduce((sum, m) => sum + m.players.size, 0);
  registerServer(SERVER_ID, GAME_WS_URL, totalPlayers).catch(() => {});
}, 10000);

function createMatch(mode: 'ffa' | 'solo' | 'teams'): Match {
  const match: Match = {
    id: generateMatchId(),
    world: new World(),
    phase: 'lobby',
    mode,
    countdownEndAt: 0,
    players: new Map(),
    cpuIds: new Set(),
    readySet: new Set(),
    fightAllyChoices: new Map(),
    lastReplayTick: 0,
  };
  matches.set(match.id, match);
  console.log(`[rescue] match created id=${match.id} mode=${mode}`);
  return match;
}

function destroyMatch(matchId: string): void {
  const match = matches.get(matchId);
  if (!match) return;
  // Remove player mappings
  for (const playerId of match.players.keys()) {
    playerToMatch.delete(playerId);
  }
  matches.delete(matchId);
  if (ffaLobbyMatchId === matchId) ffaLobbyMatchId = null;
  console.log(`[rescue] match destroyed id=${matchId}`);
}

function ensureCpusForMatch(match: Match): void {
  if (match.mode === 'solo') {
    for (let i = 1; i <= 3; i++) {
      const cid = `cpu-${i}`;
      if (!match.cpuIds.has(cid)) {
        match.world.addPlayer(cid, `CPU-${i}`);
        match.cpuIds.add(cid);
      }
    }
  } else if (match.mode === 'ffa' && match.players.size >= 2) {
    const humanCount = match.players.size;
    const snapshot = match.world.getSnapshot();
    if (humanCount === 2 && snapshot.players.filter((p) => !p.id.startsWith('cpu-')).length < 3) {
      const cid = 'cpu-1';
      if (!match.cpuIds.has(cid)) {
        match.world.addPlayer(cid, 'CPU-1');
        match.cpuIds.add(cid);
      }
    }
  }
}

function getMatchState(match: Match): { type: string; phase: MatchPhase; countdownRemainingSec?: number; readyCount: number } {
  let countdownRemainingSec: number | undefined;
  if (match.phase === 'countdown' && match.countdownEndAt > 0) {
    countdownRemainingSec = Math.max(0, Math.ceil((match.countdownEndAt - Date.now()) / 1000));
  }
  return {
    type: 'matchState',
    phase: match.phase,
    ...(countdownRemainingSec !== undefined && { countdownRemainingSec }),
    readyCount: match.readySet.size,
  };
}

function transitionToPlaying(match: Match): void {
  if (match.phase !== 'playing') {
    match.phase = 'playing';
    match.world.startMatch();
    console.log(`[rescue] match started id=${match.id} players=${match.players.size}`);
  }
}

function removePlayerFromMatch(playerId: string, matchId: string): void {
  const match = matches.get(matchId);
  if (!match) return;
  match.world.removePlayer(playerId);
  match.players.delete(playerId);
  match.readySet.delete(playerId);
  playerToMatch.delete(playerId);
  
  // Destroy match if no human players left
  if (match.players.size === 0) {
    destroyMatch(matchId);
  }
}

wss.on('connection', async (ws) => {
  const playerId = `p-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  let displayName: string | null = null;
  let playerAdded = false;
  let currentMatchId: string | null = null;
  
  const addPlayerToMatch = (match: Match, name: string) => {
    if (playerAdded) return;
    displayName = name;
    playerAdded = true;
    
    console.log(`[rescue] player joined match id=${match.id} playerId=${playerId} displayName=${name}`);
    match.world.addPlayer(playerId, name);
    match.players.set(playerId, ws);
    playerToMatch.set(playerId, match.id);
    currentMatchId = match.id;
    
    ws.send(JSON.stringify({ type: 'welcome', playerId, displayName, matchId: match.id }));
  };
  
  // Timeout: if client doesn't send mode in 5s, use FFA
  const timeout = setTimeout(async () => {
    if (!playerAdded) {
      const fallback = await getNextGuestName();
      // Default to FFA lobby
      let match = ffaLobbyMatchId ? matches.get(ffaLobbyMatchId) : null;
      if (!match) {
        match = createMatch('ffa');
        ffaLobbyMatchId = match.id;
      }
      addPlayerToMatch(match, fallback);
    }
  }, 5000);

  ws.binaryType = 'arraybuffer';
  ws.on('message', (data: Buffer | ArrayBuffer) => {
    if (typeof (data as { toString?: () => string }).toString === 'function') {
      try {
        const raw = (data as Buffer).toString();
        const msg = JSON.parse(raw);
        
        if (msg.type === 'ping' && typeof msg.ts === 'number') {
          if (currentMatchId) {
            const match = matches.get(currentMatchId);
            const tick = match ? match.world.getSnapshot().tick : 0;
            ws.send(JSON.stringify({ type: 'pong', ts: msg.ts, serverTick: tick }));
          }
          return;
        }
        
        if (msg.type === 'mode' && typeof msg.mode === 'string') {
          clearTimeout(timeout);
          const mode = msg.mode as 'ffa' | 'solo' | 'teams';
          const name = typeof msg.displayName === 'string' && msg.displayName ? msg.displayName : null;
          
          (async () => {
            const displayNameToUse = name || await getNextGuestName();
            
            if (mode === 'solo') {
              // Solo: create a new isolated match for this player
              const match = createMatch('solo');
              addPlayerToMatch(match, displayNameToUse);
              ensureCpusForMatch(match);
              match.phase = 'playing';
              match.world.startMatch();
            } else if (mode === 'ffa') {
              // FFA: join the lobby match or create one
              let match = ffaLobbyMatchId ? matches.get(ffaLobbyMatchId) : null;
              if (!match || match.phase === 'playing') {
                // Create new lobby if none exists or current is already playing
                match = createMatch('ffa');
                ffaLobbyMatchId = match.id;
              }
              addPlayerToMatch(match, displayNameToUse);
              
              if (match.players.size >= 2 && match.phase === 'lobby') {
                ensureCpusForMatch(match);
                match.phase = 'countdown';
                match.countdownEndAt = Date.now() + FFA_COUNTDOWN_MS;
                match.readySet.clear();
              }
            } else {
              // Teams: similar to FFA for now
              let match = ffaLobbyMatchId ? matches.get(ffaLobbyMatchId) : null;
              if (!match) {
                match = createMatch('teams');
                ffaLobbyMatchId = match.id;
              }
              addPlayerToMatch(match, displayNameToUse);
            }
          })();
          return;
        }
        
        if (!currentMatchId) return;
        const match = matches.get(currentMatchId);
        if (!match) return;
        
        if (msg.type === 'ready') {
          match.readySet.add(playerId);
          if (match.phase === 'countdown' && match.readySet.size >= 2) {
            transitionToPlaying(match);
          }
          return;
        }
        
        if (msg.type === 'fightAlly' && typeof msg.targetId === 'string' && (msg.choice === 'fight' || msg.choice === 'ally')) {
          match.fightAllyChoices.set(`${playerId},${msg.targetId}`, msg.choice);
          return;
        }
        
        if (msg.type === 'startingBoosts' && (typeof msg.sizeBonus === 'number' || msg.speedBoost || msg.adoptSpeed)) {
          match.world.applyStartingBoosts(playerId, {
            sizeBonus: typeof msg.sizeBonus === 'number' ? msg.sizeBonus : 0,
            speedBoost: !!msg.speedBoost,
            adoptSpeed: !!msg.adoptSpeed,
          });
          return;
        }
      } catch {
        // not JSON, fall through to binary
      }
    }
    
    if (!currentMatchId) return;
    const match = matches.get(currentMatchId);
    if (!match) return;
    
    const buf = data instanceof ArrayBuffer ? data : (data as Buffer).buffer.slice((data as Buffer).byteOffset, (data as Buffer).byteOffset + (data as Buffer).byteLength) as ArrayBuffer;
    if (buf.byteLength < 1) return;
    const view = new DataView(buf);
    if (view.getUint8(0) === MSG_INPUT) {
      const { inputFlags, inputSeq } = decodeInput(buf as ArrayBuffer);
      match.world.setInput(playerId, inputFlags, inputSeq);
    }
  });
  
  ws.on('close', () => {
    clearTimeout(timeout);
    console.log(`[rescue] player disconnected playerId=${playerId} displayName=${displayName}`);
    if (currentMatchId) {
      removePlayerFromMatch(playerId, currentMatchId);
    }
  });
  
  ws.on('error', () => {
    clearTimeout(timeout);
    console.log(`[rescue] player error playerId=${playerId} displayName=${displayName}`);
    if (currentMatchId) {
      removePlayerFromMatch(playerId, currentMatchId);
    }
  });
});

// Main tick loop: tick all active matches
setInterval(() => {
  try {
    for (const [matchId, match] of matches) {
      if (match.phase === 'countdown') {
        if (Date.now() >= match.countdownEndAt) {
          transitionToPlaying(match);
        }
        const matchState = getMatchState(match);
        for (const ws of match.players.values()) {
          if (ws.readyState === 1) ws.send(JSON.stringify(matchState));
        }
      } else if (match.phase === 'lobby') {
        const matchState = getMatchState(match);
        for (const ws of match.players.values()) {
          if (ws.readyState === 1) ws.send(JSON.stringify(matchState));
        }
      } else if (match.phase === 'playing') {
        match.world.tickWorld(match.fightAllyChoices);
        const snapshot = match.world.getSnapshot();
        
        if (snapshot.tick - match.lastReplayTick >= 50) {
          match.lastReplayTick = snapshot.tick;
          const hash = snapshot.stateHash ?? String(snapshot.tick);
          appendReplay(matchId, snapshot.tick, hash).catch(() => {});
        }
        
        const buf = encodeSnapshot(snapshot);
        for (const ws of match.players.values()) {
          if (ws.readyState === 1) ws.send(buf);
        }
      }
    }
  } catch (err) {
    console.error('Tick error:', err);
  }
}, TICK_MS);

console.log(`Game server (WebSocket) on ws://localhost:${GAME_WS_PORT}`);
