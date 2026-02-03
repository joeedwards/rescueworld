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
import { withdrawForMatch, depositAfterMatch, getInventory, type Inventory } from './inventory.js';
import { recordMatchWin, recordRtEarned } from './leaderboard.js';

/** Timestamped log function for server output */
function log(message: string): void {
  const now = new Date();
  const timestamp = now.toISOString().replace('T', ' ').slice(0, 19);
  console.log(`[${timestamp}] [rescue] ${message}`);
}

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
  allyRequests: Map<string, Set<string>>;
  lastReplayTick: number;
  // Track authenticated user IDs for inventory/leaderboard
  playerUserIds: Map<string, string>; // playerId -> userId (for registered users)
  playerStartingInventory: Map<string, Inventory>; // playerId -> inventory withdrawn at start
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
    allyRequests: new Map(),
    lastReplayTick: 0,
    playerUserIds: new Map(),
    playerStartingInventory: new Map(),
  };
  matches.set(match.id, match);
  log(`match created id=${match.id} mode=${mode}`);
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
  log(`match destroyed id=${matchId}`);
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

function getMatchState(match: Match): { 
  type: string; 
  phase: MatchPhase; 
  countdownRemainingSec?: number; 
  readyCount: number;
  players?: Array<{ id: string; displayName: string }>;
} {
  let countdownRemainingSec: number | undefined;
  if (match.phase === 'countdown' && match.countdownEndAt > 0) {
    countdownRemainingSec = Math.max(0, Math.ceil((match.countdownEndAt - Date.now()) / 1000));
  }
  
  // Get human player list (exclude CPUs) for lobby display
  const snapshot = match.world.getSnapshot();
  const humanPlayers = Array.from(match.players.keys())
    .filter(id => !id.startsWith('cpu-'))
    .map(id => {
      const p = snapshot.players.find(pl => pl.id === id);
      return { id, displayName: p?.displayName ?? 'Unknown' };
    });
  
  return {
    type: 'matchState',
    phase: match.phase,
    ...(countdownRemainingSec !== undefined && { countdownRemainingSec }),
    readyCount: match.readySet.size,
    players: humanPlayers.length > 0 ? humanPlayers : undefined,
  };
}

function transitionToPlaying(match: Match): void {
  if (match.phase !== 'playing') {
    match.phase = 'playing';
    match.world.startMatch();
    log(`match started id=${match.id} players=${match.players.size}`);
  }
}

function removePlayerFromMatch(playerId: string, matchId: string): void {
  const match = matches.get(matchId);
  if (!match) return;
  
  // Save inventory for registered users who disconnect mid-match
  const userId = match.playerUserIds.get(playerId);
  if (userId && match.phase === 'playing') {
    const playerMoney = match.world.getPlayerMoney(playerId);
    const portCharges = match.world.getPortCharges(playerId);
    if (playerMoney > 0 || portCharges > 0) {
      depositAfterMatch(userId, playerMoney, portCharges, 0, 0);
      log(`Player ${playerId} disconnected - deposited ${playerMoney} RT, ${portCharges} ports for ${userId}`);
    }
  }
  match.playerUserIds.delete(playerId);
  match.playerStartingInventory.delete(playerId);
  
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
  let playerUserId: string | null = null; // Auth user ID for inventory
  
  let startingRT = 0;
  let startingPorts = 0;
  let startingInventory: Inventory | null = null;
  
  const addPlayerToMatch = (match: Match, name: string) => {
    if (playerAdded) return;
    displayName = name;
    playerAdded = true;
    
    // If we have a userId, track it for match-end deposit
    if (playerUserId) {
      match.playerUserIds.set(playerId, playerUserId);
      if (startingInventory) {
        match.playerStartingInventory.set(playerId, startingInventory);
      }
    }
    
    log(`player joined match id=${match.id} playerId=${playerId} displayName=${name} startingRT=${startingRT}`);
    match.world.addPlayer(playerId, name, startingRT, startingPorts);
    match.players.set(playerId, ws);
    playerToMatch.set(playerId, match.id);
    currentMatchId = match.id;
    
    ws.send(JSON.stringify({ type: 'welcome', playerId, displayName, matchId: match.id, startingRT, startingPorts }));
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
          
          // Check if client sent userId for registered user
          if (typeof msg.userId === 'string' && msg.userId.startsWith('u-')) {
            const userId = msg.userId as string;
            playerUserId = userId;
            // Withdraw inventory from database
            startingInventory = withdrawForMatch(userId);
            startingRT = startingInventory.storedRt;
            startingPorts = startingInventory.portCharges;
            log(`Registered user ${userId} withdrawing: ${startingRT} RT, ${startingPorts} ports`);
          } else {
            // Fallback: accept from client for backwards compatibility (guests)
            if (typeof msg.startingRT === 'number' && msg.startingRT > 0) {
              startingRT = Math.floor(msg.startingRT);
            }
            if (typeof msg.startingPorts === 'number' && msg.startingPorts > 0) {
              startingPorts = Math.floor(msg.startingPorts);
            }
          }
          
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

        if (msg.type === 'allyRequest' && typeof msg.targetId === 'string') {
          let requests = match.allyRequests.get(playerId);
          if (!requests) {
            requests = new Set();
            match.allyRequests.set(playerId, requests);
          }
          requests.add(msg.targetId);
          return;
        }

        if (msg.type === 'ground') {
          // Legacy: ground is now buildShelter
          const result = match.world.buildShelter(playerId);
          if (!result.success && result.reason) {
            ws.send(JSON.stringify({ type: 'groundFailed', reason: result.reason }));
          }
          return;
        }

        if (msg.type === 'buildShelter') {
          const result = match.world.buildShelter(playerId);
          if (!result.success && result.reason) {
            ws.send(JSON.stringify({ type: 'buildFailed', reason: result.reason }));
          }
          return;
        }

        if (msg.type === 'buyAdoptionCenter') {
          const result = match.world.buyAdoptionCenter(playerId);
          if (!result.success && result.reason) {
            ws.send(JSON.stringify({ type: 'upgradeFailed', upgrade: 'adoptionCenter', reason: result.reason }));
          }
          return;
        }

        if (msg.type === 'buyGravity') {
          const result = match.world.buyGravity(playerId);
          if (!result.success && result.reason) {
            ws.send(JSON.stringify({ type: 'upgradeFailed', upgrade: 'gravity', reason: result.reason }));
          }
          return;
        }

        if (msg.type === 'buyAdvertising') {
          const result = match.world.buyAdvertising(playerId);
          if (!result.success && result.reason) {
            ws.send(JSON.stringify({ type: 'upgradeFailed', upgrade: 'advertising', reason: result.reason }));
          }
          return;
        }

        if (msg.type === 'buyVanSpeed') {
          const result = match.world.buyVanSpeed(playerId);
          if (!result.success && result.reason) {
            ws.send(JSON.stringify({ type: 'upgradeFailed', upgrade: 'vanSpeed', reason: result.reason }));
          }
          return;
        }

        if (msg.type === 'usePort') {
          match.world.usePort(playerId);
          return;
        }

        if (msg.type === 'setColor' && typeof msg.color === 'string') {
          match.world.setPlayerColor(playerId, msg.color);
          return;
        }
        
        // Solo mode option: CPU breeder shutdown behavior
        if (msg.type === 'setCpuBreederBehavior' && typeof msg.canShutdown === 'boolean') {
          if (match.mode === 'solo') {
            match.world.setCpuBreederBehavior(msg.canShutdown);
          }
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
        
        // Breeder mini-game messages
        // NOTE: Food costs are NOT deducted when used - the only penalty for wrong meals is wasted time
        // Tokens are only deducted for successful rescues (via breederComplete)
        if (msg.type === 'breederUseFood' && typeof msg.food === 'string') {
          // No token deduction - wrong meals only waste time
          return;
        }
        
        if (msg.type === 'breederComplete' && typeof msg.rescuedCount === 'number' && typeof msg.totalPets === 'number') {
          const level = typeof msg.level === 'number' ? msg.level : 1;
          const result = match.world.completeBreederMiniGame(playerId, msg.rescuedCount, msg.totalPets, level);
          ws.send(JSON.stringify({
            type: 'breederRewards',
            tokenBonus: result.tokenBonus,
            rewards: result.rewards,
          }));
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
    log(`player disconnected playerId=${playerId} displayName=${displayName}`);
    if (currentMatchId) {
      removePlayerFromMatch(playerId, currentMatchId);
    }
  });
  
  ws.on('error', () => {
    clearTimeout(timeout);
    log(`player error playerId=${playerId} displayName=${displayName}`);
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
        match.world.tickWorld(match.fightAllyChoices, match.allyRequests);
        const snapshot = match.world.getSnapshot();
        
        if (snapshot.tick - match.lastReplayTick >= 50) {
          match.lastReplayTick = snapshot.tick;
          const hash = snapshot.stateHash ?? String(snapshot.tick);
          appendReplay(matchId, snapshot.tick, hash).catch(() => {});
        }
        
        // Check for pending breeder mini-games and send start messages
        for (const [playerId, ws] of match.players.entries()) {
          const pending = match.world.getPendingBreederMiniGame(playerId);
          if (pending && ws.readyState === 1) {
            ws.send(JSON.stringify({
              type: 'breederStart',
              petCount: pending.petCount,
              level: pending.level,
            }));
            match.world.clearPendingBreederMiniGame(playerId);
          }
        }
        
        // Broadcast match-wide announcements
        const announcements = match.world.getPendingAnnouncements();
        if (announcements.length > 0) {
          const announcementMsg = JSON.stringify({ type: 'announcement', messages: announcements });
          for (const ws of match.players.values()) {
            if (ws.readyState === 1) ws.send(announcementMsg);
          }
          match.world.clearPendingAnnouncements();
        }
        
        const buf = encodeSnapshot(snapshot);
        for (const ws of match.players.values()) {
          if (ws.readyState === 1) ws.send(buf);
        }
        
        // Check for match end and process inventory/leaderboard
        if (snapshot.winnerId && !match.world.isMatchProcessed()) {
          match.world.markMatchProcessed();
          log(`Match ${matchId} ended - winner: ${snapshot.winnerId}`);
          
          // Process all registered players
          for (const [pid, userId] of match.playerUserIds.entries()) {
            const playerState = snapshot.players.find(p => p.id === pid);
            if (!playerState) continue;
            
            // Get player's final RT
            const finalRT = playerState.money ?? 0;
            const portCharges = match.world.getPortCharges(pid);
            
            // Deposit to inventory
            if (finalRT > 0 || portCharges > 0) {
              depositAfterMatch(userId, finalRT, portCharges, 0, 0);
              log(`Deposited for ${userId}: ${finalRT} RT, ${portCharges} ports`);
            }
            
            // Record win/stats for leaderboard
            const isWinner = snapshot.winnerId === pid;
            if (isWinner) {
              recordMatchWin(userId, finalRT);
              log(`Recorded win for ${userId}`);
            } else {
              recordRtEarned(userId, finalRT);
            }
            
            // Send deposit confirmation to player
            const ws = match.players.get(pid);
            if (ws?.readyState === 1) {
              ws.send(JSON.stringify({
                type: 'matchEndInventory',
                deposited: { rt: finalRT, portCharges },
                isWinner,
              }));
            }
          }
        }
      }
    }
  } catch (err) {
    console.error('Tick error:', err);
  }
}, TICK_MS);

log(`Game server (WebSocket) on ws://localhost:${GAME_WS_PORT}`);
