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
import { recordMatchWin, recordMatchLoss, updateReputationOnQuit } from './leaderboard.js';
import { saveSavedMatch, getSavedMatch, deleteSavedMatch, insertMatchHistory, incrementGameCount, saveFfaMatch, getAllSavedFfaMatches, deleteSavedFfaMatch } from './referrals.js';
import { awardKarmaPoints } from './karmaService.js';

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

// Food costs for breeder mini-game - must match client FOOD_COSTS
const FOOD_COSTS: Record<string, number> = {
  apple: 5,
  carrot: 8,
  chicken: 15,
  seeds: 5,
  water: 20,
  bowl: 20,
};

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
  frozen?: boolean;
  soloUserId?: string;
  soloPlayerId?: string;
  soloDisplayName?: string;
  /** Active mill mini-games: playerId -> { lastAddPetTick } for server-authoritative +1 pet every 10s */
  activeMillGames?: Map<string, { lastAddPetTick: number }>;
  /** Last auto-save timestamp for solo matches (graceful shutdown / crash recovery) */
  lastAutoSave?: number;
}

const wss = new WebSocketServer({ port: GAME_WS_PORT });

// All active matches
const matches = new Map<string, Match>();

/** Restore saved FFA/Teams matches from database on server startup */
function restoreSavedFfaMatches(): void {
  try {
    const savedMatches = getAllSavedFfaMatches();
    for (const saved of savedMatches) {
      try {
        const world = World.deserialize(saved.world_state);
        // Skip matches that have already ended
        if (world.isMatchOver() || world.isStrayLoss()) {
          log(`Skipping ended FFA/Teams match ${saved.match_id}`);
          deleteSavedFfaMatch(saved.match_id);
          continue;
        }
        
        // Account for paused time since server shutdown
        world.recordResume();
        
        const playerUserIds: Array<{ playerId: string; userId: string }> = JSON.parse(saved.player_user_ids);
        
        const match: Match = {
          id: saved.match_id,
          world,
          phase: 'playing',
          mode: saved.mode as 'ffa' | 'teams',
          countdownEndAt: 0,
          players: new Map(),
          cpuIds: new Set(),
          readySet: new Set(),
          soloUserId: undefined,
          frozen: false,
          playerUserIds: new Map(),
          fightAllyChoices: new Map(),
          allyRequests: new Map(),
          lastReplayTick: 0,
          playerStartingInventory: new Map(),
        };
        
        // Restore player-userId mappings and set all players as disconnected
        for (const { playerId, userId } of playerUserIds) {
          match.playerUserIds.set(playerId, userId);
          // Add to user's match list (array)
          const userMatches = userIdToFfaMatches.get(userId) ?? [];
          userMatches.push({ matchId: saved.match_id, playerId });
          userIdToFfaMatches.set(userId, userMatches);
          world.setPlayerDisconnected(playerId, true);
        }
        
        // Identify CPU players
        const snapshot = world.getSnapshot();
        for (const p of snapshot.players) {
          if (p.id.startsWith('cpu-')) {
            match.cpuIds.add(p.id);
          }
        }
        
        matches.set(saved.match_id, match);
        log(`Restored FFA/Teams match ${saved.match_id} (mode=${saved.mode}, players=${playerUserIds.length})`);
        
        // Delete from saved matches since it's now in memory
        deleteSavedFfaMatch(saved.match_id);
      } catch (e) {
        log(`Failed to restore FFA/Teams match ${saved.match_id}: ${e}`);
        deleteSavedFfaMatch(saved.match_id);
      }
    }
  } catch (e) {
    log(`Failed to load saved FFA/Teams matches: ${e}`);
  }
}

// Map player ID -> match ID for quick lookup
const playerToMatch = new Map<string, string>();
// Solo: userId -> matchId for frozen matches (resume from memory)
const userIdToSoloMatchId = new Map<string, string>();
// FFA/Teams: userId -> array of { matchId, playerId } for disconnected players who can rejoin (max 5)
const userIdToFfaMatches = new Map<string, Array<{ matchId: string; playerId: string }>>();
const MAX_SIMULTANEOUS_MATCHES = 5;
// FFA lobby match (waiting for players)
let ffaLobbyMatchId: string | null = null;

// Restore saved FFA/Teams matches on startup (after maps are initialized)
restoreSavedFfaMatches();

/** Get all active FFA/Teams matches for a user (for API endpoint) */
export function getActiveMatchesForUser(userId: string): Array<{ matchId: string; playerId: string; mode: string }> {
  const result: Array<{ matchId: string; playerId: string; mode: string }> = [];
  const userMatches = userIdToFfaMatches.get(userId);
  if (userMatches) {
    // Filter out ended matches and build result
    const validMatches = userMatches.filter(info => {
      const match = matches.get(info.matchId);
      return match && match.phase === 'playing' && !match.world.isMatchOver();
    });
    // Update the map with only valid matches
    if (validMatches.length !== userMatches.length) {
      if (validMatches.length === 0) {
        userIdToFfaMatches.delete(userId);
      } else {
        userIdToFfaMatches.set(userId, validMatches);
      }
    }
    for (const info of validMatches) {
      const match = matches.get(info.matchId)!;
      result.push({ matchId: info.matchId, playerId: info.playerId, mode: match.mode });
    }
  }
  return result;
}

/** Get first active match info for a user (backward compatibility) */
export function getActiveMatchForUser(userId: string): { matchId: string; playerId: string; mode: string } | null {
  const allMatches = getActiveMatchesForUser(userId);
  if (allMatches.length > 0) {
    return allMatches[0];
  }
  
  // Check Solo frozen match
  const soloMatchId = userIdToSoloMatchId.get(userId);
  if (soloMatchId) {
    const match = matches.get(soloMatchId);
    if (match?.frozen && match.soloPlayerId) {
      return { matchId: soloMatchId, playerId: match.soloPlayerId, mode: 'solo' };
    }
  }
  
  return null;
}

/** Check if a match is currently paused (frozen) */
export function isMatchPaused(matchId: string): boolean {
  const match = matches.get(matchId);
  return match?.frozen ?? false;
}

/** Get match duration in milliseconds for a given match ID */
export function getMatchDurationMs(matchId: string): number {
  const match = matches.get(matchId);
  if (!match || !match.world.isMatchStarted()) return 0;
  return match.world.getMatchDurationMs();
}

/** Get real-time game stats for the public API */
export function getRealtimeStats(): {
  onlinePlayers: number;
  ffaWaiting: number;
  playingSolo: number;
  playingFfa: number;
  playingTeams: number;
} {
  let onlinePlayers = 0;
  let ffaWaiting = 0;
  let playingSolo = 0;
  let playingFfa = 0;
  let playingTeams = 0;

  for (const match of matches.values()) {
    const humanCount = match.players.size;
    onlinePlayers += humanCount;

    if (match.mode === 'solo') {
      playingSolo += humanCount;
    } else if (match.phase === 'lobby' || match.phase === 'countdown') {
      ffaWaiting += humanCount;
    } else if (match.mode === 'ffa') {
      playingFfa += humanCount;
    } else if (match.mode === 'teams') {
      playingTeams += humanCount;
    }
  }

  return { onlinePlayers, ffaWaiting, playingSolo, playingFfa, playingTeams };
}

/** Graceful shutdown: save solo matches, deposit FFA/Teams RT, notify players, close connections */
export async function gracefulShutdown(): Promise<void> {
  log('Graceful shutdown initiated...');

  // 1. Stop accepting new connections
  wss.close();

  // 2. Notify all connected players
  const SITE_URL = process.env.SITE_URL || '/';
  const message = `<a href="#" style="color:#fff;text-decoration:underline;display:block;width:100%;" onclick="window.location.reload();return false;">Server updating, your match will be saved. Click here to refresh the page.</a>`;
  for (const [, match] of matches) {
    for (const [, ws] of match.players) {
      if (ws.readyState === 1) {
        try {
          ws.send(JSON.stringify({
            type: 'serverShutdown',
            message: message,
          }));
        } catch {
          // ignore send errors
        }
      }
    }
  }

  // 3. Save all active solo matches (playing or frozen)
  for (const [matchId, match] of matches) {
    if (match.mode === 'solo' && match.phase === 'playing') {
      const userId = match.soloUserId ?? match.playerUserIds.values().next().value;
      if (userId) {
        try {
          const worldState = match.world.serialize();
          saveSavedMatch(userId, 'solo', worldState, matchId);
          log(`Auto-saved solo match ${matchId} for ${userId}`);
        } catch (e) {
          log(`Auto-save failed for solo match ${matchId}: ${e}`);
        }
      }
    }
  }

  // 4. Save FFA/Teams matches so they can continue after restart
  for (const [matchId, match] of matches) {
    if ((match.mode === 'ffa' || match.mode === 'teams') && match.phase === 'playing' && !match.world.isMatchOver()) {
      try {
        // Record pause time before saving so match duration is accurate on resume
        if (!match.frozen) {
          match.world.recordPause();
        }
        const worldState = match.world.serialize();
        const playerUserIds = Array.from(match.playerUserIds.entries()).map(([playerId, userId]) => ({ playerId, userId }));
        saveFfaMatch(matchId, match.mode, worldState, playerUserIds);
        log(`Saved FFA/Teams match ${matchId} with ${playerUserIds.length} players`);
      } catch (e) {
        log(`Failed to save FFA/Teams match ${matchId}: ${e}`);
      }
    }
  }

  // 5. Close all WebSocket connections
  for (const match of matches.values()) {
    for (const ws of match.players.values()) {
      try {
        ws.close(1001, 'Server shutting down');
      } catch {
        // ignore
      }
    }
  }

  log('Graceful shutdown complete');
}

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
  if (match.frozen && match.soloPlayerId) {
    match.world.removePlayer(match.soloPlayerId);
    if (match.soloUserId) userIdToSoloMatchId.delete(match.soloUserId);
  }
  for (const playerId of match.players.keys()) {
    playerToMatch.delete(playerId);
  }
  // Clean up FFA/Teams rejoin tracking for any users in this match
  for (const [userId, userMatches] of userIdToFfaMatches.entries()) {
    const filtered = userMatches.filter(info => info.matchId !== matchId);
    if (filtered.length === 0) {
      userIdToFfaMatches.delete(userId);
    } else if (filtered.length !== userMatches.length) {
      userIdToFfaMatches.set(userId, filtered);
    }
  }
  // Delete saved FFA/Teams match from database
  deleteSavedFfaMatch(matchId);
  matches.delete(matchId);
  if (ffaLobbyMatchId === matchId) ffaLobbyMatchId = null;
  log(`match destroyed id=${matchId}`);
}

function destroySoloMatchForUser(userId: string): void {
  const matchId = userIdToSoloMatchId.get(userId);
  if (!matchId) return;
  const match = matches.get(matchId);
  if (match?.frozen) destroyMatch(matchId);
  userIdToSoloMatchId.delete(userId);
}

/** Get human player id from serialized world state (first non-cpu player). */
function getHumanPlayerIdFromState(worldStateJson: string): string | null {
  try {
    const state = JSON.parse(worldStateJson) as { players?: [string, unknown][] };
    const players = state.players;
    if (!Array.isArray(players)) return null;
    for (const [id] of players) {
      if (typeof id === 'string' && !id.startsWith('cpu-')) return id;
    }
  } catch {
    // ignore
  }
  return null;
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

  const userId = match.playerUserIds.get(playerId);

  // Solo: save match and freeze instead of removing/destroying (no deposit, no quit penalty)
  // But DON'T save if the match is already over (stray loss, win, or time expired)
  const matchOver = match.world.isMatchOver() || match.world.isStrayLoss();
  
  // Solo mode: if match is over, process as proper win/loss before player leaves
  if (match.mode === 'solo' && userId && match.phase === 'playing' && matchOver && !match.world.isMatchProcessed()) {
    match.world.markMatchProcessed();
    const isStrayLoss = match.world.isStrayLoss();
    const snap = match.world.getSnapshot();
    const playerState = snap.players.find(p => p.id === playerId);
    const finalRT = isStrayLoss ? 0 : (playerState?.money ?? 0);
    const portCharges = isStrayLoss ? 0 : match.world.getPortCharges(playerId);
    const shelterPortCharges = isStrayLoss ? 0 : match.world.getShelterPortCharges(playerId);
    const adoptions = playerState?.totalAdoptions ?? 0;
    const durationSeconds = Math.floor((snap.matchDurationMs ?? 0) / 1000);
    const isWinner = !isStrayLoss && snap.winnerId === playerId;
    
    if (finalRT > 0 || portCharges > 0 || shelterPortCharges > 0) {
      depositAfterMatch(userId, finalRT, portCharges, shelterPortCharges, 0, 0);
      log(`Solo match ended on leave - deposited ${finalRT} RT, ${portCharges} ports for ${userId}`);
    }
    
    if (isStrayLoss) {
      recordMatchLoss(userId, 0);
      insertMatchHistory(userId, matchId, match.mode, 'stray_loss', 0, adoptions, durationSeconds);
    } else if (isWinner) {
      recordMatchWin(userId, finalRT);
      insertMatchHistory(userId, matchId, match.mode, 'win', finalRT, adoptions, durationSeconds);
      log(`Recorded win for ${userId} on solo match end`);
    } else {
      recordMatchLoss(userId, finalRT);
      insertMatchHistory(userId, matchId, match.mode, 'loss', finalRT, adoptions, durationSeconds);
    }
    
    deleteSavedMatch(userId);
    userIdToSoloMatchId.delete(userId);
    match.playerUserIds.delete(playerId);
    match.playerStartingInventory.delete(playerId);
    match.world.removePlayer(playerId);
    match.players.delete(playerId);
    playerToMatch.delete(playerId);
    destroyMatch(matchId);
    return;
  }
  
  if (match.mode === 'solo' && userId && match.phase === 'playing' && !matchOver) {
    try {
      match.world.recordPause(); // Record pause time for accurate match duration
      const worldState = match.world.serialize();
      saveSavedMatch(userId, 'solo', worldState, match.id);
      match.frozen = true;
      match.soloUserId = userId;
      match.soloPlayerId = playerId;
      const snap = match.world.getSnapshot();
      const p = snap.players.find((x) => x.id === playerId);
      match.soloDisplayName = p?.displayName ?? 'Player';
      userIdToSoloMatchId.set(userId, match.id);
      match.players.delete(playerId);
      match.readySet.delete(playerId);
      playerToMatch.delete(playerId);
      // Keep playerUserIds/playerStartingInventory so resume can reattach
      log(`Solo match saved for ${userId}, frozen matchId=${match.id}`);
    } catch (e) {
      log(`Solo save failed: ${e}`);
      // Fall through to normal remove
    }
  }

  // FFA/Teams: van stops, shelter continues; do not remove from world or deposit
  // Track userId -> matchId so player can rejoin
  if ((match.mode === 'ffa' || match.mode === 'teams') && match.phase === 'playing') {
    match.world.setPlayerDisconnected(playerId, true);
    match.players.delete(playerId);
    match.readySet.delete(playerId);
    playerToMatch.delete(playerId);
    // Save userId -> matchId mapping for rejoin capability
    if (userId) {
      const userMatches = userIdToFfaMatches.get(userId) ?? [];
      // Only add if not already in the list
      if (!userMatches.some(m => m.matchId === matchId)) {
        userMatches.push({ matchId, playerId });
        userIdToFfaMatches.set(userId, userMatches);
      }
      log(`FFA/Teams player ${playerId} (userId=${userId}) disconnected - can rejoin matchId=${matchId} (${userMatches.length} active matches)`);
    } else {
      log(`FFA/Teams player ${playerId} disconnected - no userId, cannot rejoin`);
    }
    
    // Check if all human players are now disconnected - pause match if so
    const humanPlayerIds = [...match.playerUserIds.keys()].filter(id => !id.startsWith('cpu-'));
    const anyHumanConnected = humanPlayerIds.some(id => match.players.has(id));
    if (!anyHumanConnected && !match.frozen) {
      match.world.recordPause();
      match.frozen = true;
      log(`FFA/Teams match ${matchId} paused - all human players disconnected`);
    }
    return;
  }

  if (!match.frozen) {
    // Solo save failed or other mode: full remove
    // Don't deposit again if match end was already processed (prevents duplicate RT)
    if (userId && match.phase === 'playing' && !match.world.isMatchProcessed()) {
      const playerMoney = match.world.getPlayerMoney(playerId);
      const portCharges = match.world.getPortCharges(playerId);
      const shelterPortCharges = match.world.getShelterPortCharges(playerId);
      const snap = match.world.getSnapshot();
      const quitPlayerState = snap.players.find(p => p.id === playerId);
      const adoptions = quitPlayerState?.totalAdoptions ?? 0;
      const durationSeconds = Math.floor((snap.matchDurationMs ?? 0) / 1000);
      if (playerMoney > 0 || portCharges > 0 || shelterPortCharges > 0) {
        depositAfterMatch(userId, playerMoney, portCharges, shelterPortCharges, 0, 0);
        log(`Player ${playerId} disconnected - deposited ${playerMoney} RT, ${portCharges} ports, ${shelterPortCharges} home ports for ${userId}`);
      }
      if (playerMoney > 0) {
        recordMatchLoss(userId, playerMoney);
      }
      updateReputationOnQuit(userId);
      insertMatchHistory(userId, matchId, match.mode, 'quit', playerMoney, adoptions, durationSeconds);
    }
    match.playerUserIds.delete(playerId);
    match.playerStartingInventory.delete(playerId);
    match.world.removePlayer(playerId);
    match.players.delete(playerId);
    match.readySet.delete(playerId);
    playerToMatch.delete(playerId);
    if (match.players.size === 0) {
      destroyMatch(matchId);
    }
  }
}

wss.on('connection', async (ws) => {
  const playerId = `p-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  let effectivePlayerId = playerId; // May be set to soloPlayerId on resume
  let displayName: string | null = null;
  let playerAdded = false;
  let currentMatchId: string | null = null;
  let playerUserId: string | null = null; // Auth user ID for inventory
  
  let startingRT = 0;
  let startingPorts = 0;
  let startingShelterTier3Boosts = 0;
  let startingInventory: Inventory | null = null;
  
  const addPlayerToMatch = (match: Match, name: string) => {
    if (playerAdded) return;
    displayName = name;
    playerAdded = true;
    
    if (playerUserId) {
      match.playerUserIds.set(effectivePlayerId, playerUserId);
      if (startingInventory) {
        match.playerStartingInventory.set(effectivePlayerId, startingInventory);
        startingShelterTier3Boosts = startingInventory.shelterTier3Boosts ?? 0;
      }
    }
    
    log(`player joined match id=${match.id} playerId=${effectivePlayerId} displayName=${name} startingRT=${startingRT}`);
    match.world.addPlayer(effectivePlayerId, name, startingRT, startingPorts, startingShelterTier3Boosts);
    match.players.set(effectivePlayerId, ws);
    playerToMatch.set(effectivePlayerId, match.id);
    currentMatchId = match.id;
    
    ws.send(JSON.stringify({ type: 'welcome', playerId: effectivePlayerId, displayName, matchId: match.id, startingRT, startingPorts }));
  };

  const resumeSoloMatch = (match: Match) => {
    if (playerAdded || !match.soloPlayerId) return;
    effectivePlayerId = match.soloPlayerId;
    displayName = match.soloDisplayName ?? displayName ?? 'Player';
    playerAdded = true;
    match.players.set(effectivePlayerId, ws);
    playerToMatch.set(effectivePlayerId, match.id);
    currentMatchId = match.id;
    match.frozen = false;
    match.world.recordResume(); // Account for paused time in match duration
    const snap = match.world.getSnapshot();
    const p = snap.players.find((x) => x.id === effectivePlayerId);
    const rt = p?.money ?? 0;
    const ports = match.world.getPortCharges(effectivePlayerId);
    const shelterPorts = match.world.getShelterPortCharges(effectivePlayerId);
    ws.send(JSON.stringify({
      type: 'welcome',
      playerId: effectivePlayerId,
      displayName,
      matchId: match.id,
      startingRT: rt,
      startingPorts: ports,
      shelterPortCharges: shelterPorts,
      resumed: true,
    }));
    log(`Solo match resumed for ${match.soloUserId} playerId=${effectivePlayerId}`);
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
          const rejoinMatchId = typeof msg.rejoinMatchId === 'string' ? msg.rejoinMatchId : null;
          
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
              const abandon = !!msg.abandon && !!playerUserId;
              if (abandon && playerUserId) {
                deleteSavedMatch(playerUserId);
                destroySoloMatchForUser(playerUserId);
              }
              if (playerUserId && !abandon) {
                const frozenMatchId = userIdToSoloMatchId.get(playerUserId);
                const frozenMatch = frozenMatchId ? matches.get(frozenMatchId) : null;
                if (frozenMatch?.frozen) {
                  resumeSoloMatch(frozenMatch);
                  return;
                }
                const saved = getSavedMatch(playerUserId);
                if (saved) {
                  try {
                    const world = World.deserialize(saved.world_state);
                    world.recordResume(); // Account for paused time in match duration
                    // Match already ended - delete stale save and don't resume
                    if (world.isMatchOver() || world.isStrayLoss()) {
                      deleteSavedMatch(playerUserId);
                      ws.send(JSON.stringify({ type: 'savedMatchExpired', reason: 'Match already ended' }));
                      log(`Solo saved match expired for ${playerUserId} - match already ended, deleted from DB`);
                      return;
                    }
                    const humanId = getHumanPlayerIdFromState(saved.world_state);
                    if (humanId) {
                      const match: Match = {
                        id: saved.id,
                        world,
                        phase: 'playing',
                        mode: 'solo',
                        countdownEndAt: 0,
                        players: new Map(),
                        cpuIds: new Set(world.getSnapshot().players.filter((pl) => pl.id.startsWith('cpu-')).map((pl) => pl.id)),
                        readySet: new Set(),
                        fightAllyChoices: new Map(),
                        allyRequests: new Map(),
                        lastReplayTick: 0,
                        playerUserIds: new Map([[humanId, playerUserId]]),
                        playerStartingInventory: new Map(),
                        soloUserId: playerUserId,
                        soloPlayerId: humanId,
                        soloDisplayName: world.getSnapshot().players.find((pl) => pl.id === humanId)?.displayName ?? displayNameToUse,
                      };
                      match.players.set(humanId, ws);
                      playerToMatch.set(humanId, match.id);
                      matches.set(match.id, match);
                      userIdToSoloMatchId.set(playerUserId, match.id);
                      effectivePlayerId = humanId;
                      displayName = match.soloDisplayName ?? displayNameToUse;
                      playerAdded = true;
                      currentMatchId = match.id;
                      const snap = match.world.getSnapshot();
                      const p = snap.players.find((x) => x.id === humanId);
                      const rt = p?.money ?? 0;
                      const ports = match.world.getPortCharges(humanId);
                      const shelterPorts = match.world.getShelterPortCharges(humanId);
                      ws.send(JSON.stringify({
                        type: 'welcome',
                        playerId: humanId,
                        displayName: match.soloDisplayName,
                        matchId: match.id,
                        startingRT: rt,
                        startingPorts: ports,
                        shelterPortCharges: shelterPorts,
                        resumed: true,
                      }));
                      log(`Solo match loaded from DB for ${playerUserId} matchId=${match.id}`);
                      return;
                    }
                  } catch (e) {
                    log(`Solo load from DB failed: ${e}`);
                  }
                }
              }
              const match = createMatch('solo');
              addPlayerToMatch(match, displayNameToUse);
              ensureCpusForMatch(match);
              match.phase = 'playing';
              match.world.startMatch();
            } else if (mode === 'ffa') {
              // Check if player wants to rejoin a specific FFA match
              if (playerUserId && rejoinMatchId) {
                const userMatches = userIdToFfaMatches.get(playerUserId) ?? [];
                // Only rejoin if rejoinMatchId is explicitly provided
                let ffaInfo = userMatches.find(m => m.matchId === rejoinMatchId);
                if (ffaInfo) {
                  const existingMatch = matches.get(ffaInfo.matchId);
                  if (existingMatch && existingMatch.phase === 'playing' && !existingMatch.world.isMatchOver()) {
                    // Rejoin existing match with same playerId
                    effectivePlayerId = ffaInfo.playerId;
                    displayName = displayNameToUse;
                    playerAdded = true;
                    currentMatchId = existingMatch.id;
                    
                    existingMatch.world.setPlayerDisconnected(ffaInfo.playerId, false);
                    existingMatch.players.set(ffaInfo.playerId, ws);
                    playerToMatch.set(ffaInfo.playerId, existingMatch.id);
                    // Remove this match from user's pending list
                    const updatedMatches = userMatches.filter(m => m.matchId !== ffaInfo!.matchId);
                    if (updatedMatches.length === 0) {
                      userIdToFfaMatches.delete(playerUserId);
                    } else {
                      userIdToFfaMatches.set(playerUserId, updatedMatches);
                    }
                    
                    // Resume match if it was frozen (all players were disconnected)
                    if (existingMatch.frozen) {
                      existingMatch.world.recordResume();
                      existingMatch.frozen = false;
                      log(`FFA match ${existingMatch.id} resumed - player reconnected`);
                    }
                    
                    const snap = existingMatch.world.getSnapshot();
                    const p = snap.players.find((x) => x.id === ffaInfo.playerId);
                    const rt = p?.money ?? 0;
                    const ports = existingMatch.world.getPortCharges(ffaInfo.playerId);
                    const shelterPorts = existingMatch.world.getShelterPortCharges(ffaInfo.playerId);
                    
                    ws.send(JSON.stringify({
                      type: 'welcome',
                      playerId: ffaInfo.playerId,
                      displayName: p?.displayName ?? displayNameToUse,
                      matchId: existingMatch.id,
                      startingRT: rt,
                      startingPorts: ports,
                      shelterPortCharges: shelterPorts,
                      resumed: true,
                    }));
                    log(`FFA match rejoined by ${playerUserId} playerId=${ffaInfo.playerId} matchId=${existingMatch.id}`);
                    return;
                  } else {
                    // Match ended or doesn't exist, clean up
                    const updatedMatches = userMatches.filter(m => m.matchId !== ffaInfo!.matchId);
                    if (updatedMatches.length === 0) {
                      userIdToFfaMatches.delete(playerUserId);
                    } else {
                      userIdToFfaMatches.set(playerUserId, updatedMatches);
                    }
                  }
                }
                
                // Check if user has reached max matches
                const currentMatches = getActiveMatchesForUser(playerUserId);
                if (currentMatches.length >= MAX_SIMULTANEOUS_MATCHES) {
                  ws.send(JSON.stringify({ type: 'error', message: 'Maximum matches reached (5)' }));
                  ws.close();
                  return;
                }
              }
              
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
              // Teams: check if player wants to rejoin a specific teams match
              if (playerUserId && rejoinMatchId) {
                const userMatches = userIdToFfaMatches.get(playerUserId) ?? [];
                // Only rejoin if rejoinMatchId is explicitly provided
                let teamsInfo = userMatches.find(m => m.matchId === rejoinMatchId);
                if (teamsInfo) {
                  const existingMatch = matches.get(teamsInfo.matchId);
                  if (existingMatch && existingMatch.mode === 'teams' && existingMatch.phase === 'playing' && !existingMatch.world.isMatchOver()) {
                    // Rejoin existing match with same playerId
                    effectivePlayerId = teamsInfo.playerId;
                    displayName = displayNameToUse;
                    playerAdded = true;
                    currentMatchId = existingMatch.id;
                    
                    existingMatch.world.setPlayerDisconnected(teamsInfo.playerId, false);
                    existingMatch.players.set(teamsInfo.playerId, ws);
                    playerToMatch.set(teamsInfo.playerId, existingMatch.id);
                    // Remove this match from user's pending list
                    const updatedMatches = userMatches.filter(m => m.matchId !== teamsInfo!.matchId);
                    if (updatedMatches.length === 0) {
                      userIdToFfaMatches.delete(playerUserId);
                    } else {
                      userIdToFfaMatches.set(playerUserId, updatedMatches);
                    }
                    
                    // Resume match if it was frozen (all players were disconnected)
                    if (existingMatch.frozen) {
                      existingMatch.world.recordResume();
                      existingMatch.frozen = false;
                      log(`Teams match ${existingMatch.id} resumed - player reconnected`);
                    }
                    
                    const snap = existingMatch.world.getSnapshot();
                    const p = snap.players.find((x) => x.id === teamsInfo.playerId);
                    const rt = p?.money ?? 0;
                    const ports = existingMatch.world.getPortCharges(teamsInfo.playerId);
                    const shelterPorts = existingMatch.world.getShelterPortCharges(teamsInfo.playerId);
                    
                    ws.send(JSON.stringify({
                      type: 'welcome',
                      playerId: teamsInfo.playerId,
                      displayName: p?.displayName ?? displayNameToUse,
                      matchId: existingMatch.id,
                      startingRT: rt,
                      startingPorts: ports,
                      shelterPortCharges: shelterPorts,
                      resumed: true,
                    }));
                    log(`Teams match rejoined by ${playerUserId} playerId=${teamsInfo.playerId} matchId=${existingMatch.id}`);
                    return;
                  } else {
                    // Match ended or doesn't exist, clean up
                    const updatedMatches = userMatches.filter(m => m.matchId !== teamsInfo!.matchId);
                    if (updatedMatches.length === 0) {
                      userIdToFfaMatches.delete(playerUserId);
                    } else {
                      userIdToFfaMatches.set(playerUserId, updatedMatches);
                    }
                  }
                }
                
                // Check if user has reached max matches
                const currentMatches = getActiveMatchesForUser(playerUserId);
                if (currentMatches.length >= MAX_SIMULTANEOUS_MATCHES) {
                  ws.send(JSON.stringify({ type: 'error', message: 'Maximum matches reached (5)' }));
                  ws.close();
                  return;
                }
              }
              
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
          
          // Notify the target player about the ally request
          const snapshot = match.world.getSnapshot();
          const requesterPlayer = snapshot.players.find(p => p.id === playerId);
          const requesterName = requesterPlayer?.displayName ?? 'Player';
          for (const [otherId, otherWs] of match.players.entries()) {
            if (otherId === msg.targetId) {
              otherWs.send(JSON.stringify({ 
                type: 'allyRequestReceived', 
                fromId: effectivePlayerId, 
                fromName: requesterName 
              }));
              break;
            }
          }
          return;
        }
        
        // Handle ally response (accept/deny)
        if (msg.type === 'allyResponse' && typeof msg.targetId === 'string' && typeof msg.accept === 'boolean') {
          if (msg.accept) {
            // Check if the target also requested to ally with us (mutual)
            const targetRequests = match.allyRequests.get(msg.targetId);
            if (targetRequests?.has(playerId)) {
              // Mutual ally request - form alliance
              match.world.formAlliance(playerId, msg.targetId);
            } else {
              // We accepted their request - store our acceptance
              let requests = match.allyRequests.get(playerId);
              if (!requests) {
                requests = new Set();
                match.allyRequests.set(playerId, requests);
              }
              requests.add(msg.targetId);
              // Check if they already requested us
              const theirRequests = match.allyRequests.get(msg.targetId);
              if (theirRequests?.has(playerId)) {
                // Both have requested each other - form alliance
                match.world.formAlliance(playerId, msg.targetId);
              }
            }
          }
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
          const result = match.world.buildShelter(effectivePlayerId);
          if (!result.success && result.reason) {
            ws.send(JSON.stringify({ type: 'buildFailed', reason: result.reason }));
          }
          return;
        }

        if (msg.type === 'buyAdoptionCenter') {
          const result = match.world.buyAdoptionCenter(effectivePlayerId);
          if (!result.success && result.reason) {
            ws.send(JSON.stringify({ type: 'upgradeFailed', upgrade: 'adoptionCenter', reason: result.reason }));
          }
          return;
        }

        if (msg.type === 'buyGravity') {
          const result = match.world.buyGravity(effectivePlayerId);
          if (!result.success && result.reason) {
            ws.send(JSON.stringify({ type: 'upgradeFailed', upgrade: 'gravity', reason: result.reason }));
          }
          return;
        }

        if (msg.type === 'buyAdvertising') {
          const result = match.world.buyAdvertising(effectivePlayerId);
          if (!result.success && result.reason) {
            ws.send(JSON.stringify({ type: 'upgradeFailed', upgrade: 'advertising', reason: result.reason }));
          }
          return;
        }

        if (msg.type === 'buyVanSpeed') {
          const result = match.world.buyVanSpeed(effectivePlayerId);
          if (!result.success && result.reason) {
            ws.send(JSON.stringify({ type: 'upgradeFailed', upgrade: 'vanSpeed', reason: result.reason }));
          }
          return;
        }

        if (msg.type === 'usePort') {
          match.world.usePort(effectivePlayerId);
          return;
        }
        
        if (msg.type === 'useShelterPort') {
          match.world.useShelterPort(effectivePlayerId);
          return;
        }
        
        if (msg.type === 'transferPets' && typeof msg.targetShelterId === 'string') {
          const result = match.world.transferPetsToAlliedShelter(effectivePlayerId, msg.targetShelterId);
          ws.send(JSON.stringify({ 
            type: 'transferResult', 
            success: result.success, 
            count: result.count,
            senderScore: result.senderScore,
            receiverScore: result.receiverScore,
            reason: result.reason 
          }));
          return;
        }

        if (msg.type === 'setColor' && typeof msg.color === 'string') {
          match.world.setPlayerColor(effectivePlayerId, msg.color);
          return;
        }
        
        if (msg.type === 'setCpuBreederBehavior' && typeof msg.canShutdown === 'boolean') {
          if (match.mode === 'solo') {
            match.world.setCpuBreederBehavior(msg.canShutdown);
          }
          return;
        }
        
        if (msg.type === 'startingBoosts' && (typeof msg.sizeBonus === 'number' || msg.speedBoost || msg.adoptSpeed)) {
          match.world.applyStartingBoosts(effectivePlayerId, {
            sizeBonus: typeof msg.sizeBonus === 'number' ? msg.sizeBonus : 0,
            speedBoost: !!msg.speedBoost,
            adoptSpeed: !!msg.adoptSpeed,
          });
          return;
        }
        
        // Breeder mini-game messages - deduct RT for food used
        if (msg.type === 'breederUseFood' && typeof msg.food === 'string') {
          const cost = FOOD_COSTS[msg.food];
          if (cost && cost > 0) {
            match.world.deductTokens(effectivePlayerId, cost);
          }
          return;
        }
        
        if (msg.type === 'breederComplete' && typeof msg.rescuedCount === 'number' && typeof msg.totalPets === 'number') {
          const level = typeof msg.level === 'number' ? msg.level : 1;
          const result = match.world.completeBreederMiniGame(effectivePlayerId, msg.rescuedCount, msg.totalPets, level);
          match.activeMillGames?.delete(effectivePlayerId);
          ws.send(JSON.stringify({
            type: 'breederRewards',
            tokenBonus: result.tokenBonus,
            rewards: result.rewards,
          }));
          return;
        }

        // Player chose to retreat from breeder camp/mill before starting (insufficient RT warning)
        if (msg.type === 'breederRetreat') {
          // Retreat and restore the breeder camp (if applicable)
          match.world.retreatFromBreederCamp(effectivePlayerId);
          // Clear any pending mill game for this player
          match.activeMillGames?.delete(effectivePlayerId);
          // No penalty for retreating before the fight starts
          log(`Player ${effectivePlayerId} retreated from breeder camp/mill`);
          return;
        }

        // Instant rescue for mills and camps at any level - requires tier 3+ shelter
        if (msg.type === 'instantRescue' && typeof msg.cost === 'number' && typeof msg.totalPets === 'number') {
          const level = typeof msg.level === 'number' ? msg.level : 1;
          const isMill = !!msg.isMill;
          const cost = msg.cost;
          
          // Validate player has a tier 3+ shelter
          const shelter = match.world.getPlayerShelterInfo(effectivePlayerId);
          if (!shelter || shelter.tier < 3) {
            log(`Instant rescue rejected: player ${effectivePlayerId} doesn't have tier 3+ shelter`);
            return;
          }
          
          // Validate player has enough RT
          const playerRt = match.world.getPlayerMoney(effectivePlayerId);
          if (playerRt < cost) {
            log(`Instant rescue rejected: player ${effectivePlayerId} has ${playerRt} RT but needs ${cost}`);
            return;
          }
          
          // Deduct the cost
          match.world.deductPlayerMoney(effectivePlayerId, cost);
          
          // Complete the minigame with full success
          const result = match.world.completeBreederMiniGame(effectivePlayerId, msg.totalPets, msg.totalPets, level);
          match.activeMillGames?.delete(effectivePlayerId);
          
          // Instant rescue guarantees you get your money back + 20% bonus
          // The normal rescue rewards are separate (size, port charges, etc.)
          const instantRescueBonus = Math.floor(cost * 0.2); // 20% bonus
          const guaranteedTokens = cost + instantRescueBonus;
          const extraTokens = Math.max(0, guaranteedTokens - result.tokenBonus);
          if (extraTokens > 0) {
            match.world.addPlayerMoney(effectivePlayerId, extraTokens);
          }
          const finalTokenBonus = result.tokenBonus + extraTokens;
          
          log(`Instant rescue used by ${effectivePlayerId}: ${cost} RT for ${msg.totalPets} pets at level ${level}, bonus: ${finalTokenBonus} RT`);
          
          ws.send(JSON.stringify({
            type: 'breederRewards',
            tokenBonus: finalTokenBonus,
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
      match.world.setInput(effectivePlayerId, inputFlags, inputSeq);
    }
  });
  
  ws.on('close', () => {
    clearTimeout(timeout);
    log(`player disconnected playerId=${effectivePlayerId} displayName=${displayName}`);
    if (currentMatchId) {
      removePlayerFromMatch(effectivePlayerId, currentMatchId);
    }
  });
  
  ws.on('error', () => {
    clearTimeout(timeout);
    log(`player error playerId=${effectivePlayerId} displayName=${displayName}`);
    if (currentMatchId) {
      removePlayerFromMatch(effectivePlayerId, currentMatchId);
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
        // FFA/Teams: check if all human players are disconnected - pause if so
        if (match.mode === 'ffa' || match.mode === 'teams') {
          const humanPlayerIds = [...match.playerUserIds.keys()].filter(id => !id.startsWith('cpu-'));
          const allDisconnected = humanPlayerIds.length > 0 && humanPlayerIds.every(id => !match.players.has(id));
          
          if (allDisconnected && !match.frozen) {
            // Pause the match - all humans disconnected
            match.world.recordPause();
            match.frozen = true;
            log(`FFA/Teams match ${matchId} paused - all human players disconnected`);
          } else if (!allDisconnected && match.frozen) {
            // Resume when someone connects
            match.world.recordResume();
            match.frozen = false;
            log(`FFA/Teams match ${matchId} resumed - human player connected`);
          }
          
          if (match.frozen) {
            // Skip ticking this match, but still auto-save
            const now = Date.now();
            const AUTO_SAVE_INTERVAL_MS = 30000;
            if (!match.lastAutoSave || now - match.lastAutoSave >= AUTO_SAVE_INTERVAL_MS) {
              try {
                const playerUserIds = Array.from(match.playerUserIds.entries()).map(([playerId, userId]) => ({ playerId, userId }));
                saveFfaMatch(match.id, match.mode, match.world.serialize(), playerUserIds);
                match.lastAutoSave = now;
              } catch {
                // ignore save errors
              }
            }
            continue;
          }
        }
        
        // Solo frozen match: do not tick until resumed
        if (match.frozen) {
          continue;
        }
        // Periodic auto-save for solo matches (crash recovery)
        if (match.mode === 'solo') {
          const now = Date.now();
          const AUTO_SAVE_INTERVAL_MS = 30000;
          if (!match.lastAutoSave || now - match.lastAutoSave >= AUTO_SAVE_INTERVAL_MS) {
            const userId = match.soloUserId ?? match.playerUserIds.values().next().value;
            if (userId) {
              try {
                saveSavedMatch(userId, 'solo', match.world.serialize(), match.id);
                match.lastAutoSave = now;
              } catch {
                // ignore save errors, will retry next interval
              }
            }
          }
        }
        
        // Periodic auto-save for FFA/Teams matches (crash recovery / server restart)
        if (match.mode === 'ffa' || match.mode === 'teams') {
          const now = Date.now();
          const AUTO_SAVE_INTERVAL_MS = 30000;
          if (!match.lastAutoSave || now - match.lastAutoSave >= AUTO_SAVE_INTERVAL_MS) {
            try {
              // Record pause before save so time is accurate on crash recovery
              match.world.recordPause();
              const playerUserIds = Array.from(match.playerUserIds.entries()).map(([playerId, userId]) => ({ playerId, userId }));
              saveFfaMatch(match.id, match.mode, match.world.serialize(), playerUserIds);
              // Resume immediately since match is still active
              match.world.recordResume();
              match.lastAutoSave = now;
            } catch {
              // ignore save errors, will retry next interval
              match.world.recordResume(); // Make sure to resume even on error
            }
          }
        }

        match.world.tickWorld(match.fightAllyChoices, match.allyRequests, match.cpuIds);
        const snapshot = match.world.getSnapshot();
        
        // CPU ally offers: randomly offer to ally with nearby human players
        for (const cpuId of match.cpuIds) {
          if (Math.random() < 0.002) { // ~12% per second at 60 ticks
            const cpuPlayer = snapshot.players.find(p => p.id === cpuId);
            if (!cpuPlayer || cpuPlayer.eliminated) continue;
            
            // Find nearby human players
            for (const [humanId, humanWs] of match.players.entries()) {
              if (humanId.startsWith('cpu-')) continue;
              const humanPlayer = snapshot.players.find(p => p.id === humanId);
              if (!humanPlayer || humanPlayer.eliminated) continue;
              
              // Check if already allied
              if (humanPlayer.allies?.includes(cpuId)) continue;
              
              // Check distance (within 400 units)
              const dx = cpuPlayer.x - humanPlayer.x;
              const dy = cpuPlayer.y - humanPlayer.y;
              const dist = Math.sqrt(dx * dx + dy * dy);
              if (dist > 400) continue;
              
              // Add ally request from CPU
              let requests = match.allyRequests.get(cpuId);
              if (!requests) {
                requests = new Set();
                match.allyRequests.set(cpuId, requests);
              }
              if (!requests.has(humanId)) {
                requests.add(humanId);
                // Notify the human player
                if (humanWs.readyState === 1) {
                  humanWs.send(JSON.stringify({ 
                    type: 'allyRequestReceived', 
                    fromId: cpuId, 
                    fromName: cpuPlayer.displayName ?? 'CPU' 
                  }));
                }
              }
              break; // Only offer to one player per tick
            }
          }
        }
        
        if (snapshot.tick - match.lastReplayTick >= 50) {
          match.lastReplayTick = snapshot.tick;
          const hash = snapshot.stateHash ?? String(snapshot.tick);
          appendReplay(matchId, snapshot.tick, hash).catch(() => {});
        }
        
        // Check for pending breeder mini-games and send start messages
        const ADD_PET_INTERVAL_TICKS = 25 * 10; // 10 seconds at 25 tps
        for (const [playerId, ws] of match.players.entries()) {
          const pending = match.world.getPendingBreederMiniGame(playerId);
          // Only send breederStart if not already sent (startSent flag)
          if (pending && !pending.startSent && ws.readyState === 1) {
            const isMill = !!pending.isMill;
            const timeLimitSeconds = isMill
              ? match.world.getBreederMillTimeLimitSeconds(pending.level)
              : undefined; // client uses camp time limit for non-mill
            ws.send(JSON.stringify({
              type: 'breederStart',
              petCount: pending.petCount,
              level: pending.level,
              isMill: isMill || undefined,
              timeLimitSeconds: timeLimitSeconds ?? undefined,
              addPetIntervalSeconds: isMill ? 10 : undefined,
            }));
            if (isMill) {
              if (!match.activeMillGames) match.activeMillGames = new Map();
              match.activeMillGames.set(playerId, { lastAddPetTick: snapshot.tick });
            }
            // Mark as sent instead of clearing - pending entry stays for retreat/complete
            match.world.markBreederStartSent(playerId);
          }
        }
        // Server-authoritative: every 10s during mill game, tell client to add one pet
        if (match.activeMillGames) {
          for (const [playerId, state] of match.activeMillGames.entries()) {
            if (snapshot.tick - state.lastAddPetTick >= ADD_PET_INTERVAL_TICKS) {
              const ws = match.players.get(playerId);
              if (ws?.readyState === 1) {
                ws.send(JSON.stringify({ type: 'breederAddPet' }));
                state.lastAddPetTick = snapshot.tick;
              }
            }
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
        
        // Check for match end and process inventory/leaderboard (victory or stray loss)
        const matchEnded = (snapshot.winnerId != null || snapshot.strayLoss) && !match.world.isMatchProcessed();
        if (matchEnded) {
          match.world.markMatchProcessed();
          // Track game in stats (includes all games, not just authenticated users)
          incrementGameCount(match.mode);
          const isStrayLoss = !!snapshot.strayLoss;
          if (isStrayLoss) {
            log(`Match ${matchId} ended - too many strays (loss for all, no RT)`);
          } else {
            log(`Match ${matchId} ended - winner: ${snapshot.winnerId}`);
          }
          if (match.mode === 'solo' && match.soloUserId) {
            deleteSavedMatch(match.soloUserId);
            userIdToSoloMatchId.delete(match.soloUserId);
          }
          const durationSeconds = Math.floor((snapshot.matchDurationMs ?? 0) / 1000);
          for (const [pid, userId] of match.playerUserIds.entries()) {
            const playerState = snapshot.players.find(p => p.id === pid);
            if (!playerState) continue;
            const finalRT = isStrayLoss ? 0 : (playerState.money ?? 0);
            const portCharges = isStrayLoss ? 0 : match.world.getPortCharges(pid);
            const shelterPortCharges = isStrayLoss ? 0 : match.world.getShelterPortCharges(pid);
            if (finalRT > 0 || portCharges > 0 || shelterPortCharges > 0) {
              depositAfterMatch(userId, finalRT, portCharges, shelterPortCharges, 0, 0);
              log(`Deposited for ${userId}: ${finalRT} RT, ${portCharges} ports, ${shelterPortCharges} home ports`);
            }
            const isWinner = !isStrayLoss && snapshot.winnerId === pid;
            let karmaAwarded = 0;
            if (isStrayLoss) {
              recordMatchLoss(userId, 0);
            } else {
              if (isWinner) {
                recordMatchWin(userId, finalRT);
                // Award 1 Karma Point for match win (FFA/Teams only, not solo)
                if (match.mode !== 'solo') {
                  awardKarmaPoints(userId, 1, `Match win: ${matchId}`);
                  karmaAwarded = 1;
                }
                log(`Recorded win for ${userId}${karmaAwarded ? ' +1 KP' : ''}`);
              } else {
                recordMatchLoss(userId, finalRT);
              }
            }
            insertMatchHistory(
              userId,
              matchId,
              match.mode,
              isStrayLoss ? 'stray_loss' : isWinner ? 'win' : 'loss',
              finalRT,
              playerState.totalAdoptions ?? 0,
              durationSeconds,
            );
            const ws = match.players.get(pid);
            if (ws?.readyState === 1) {
              ws.send(JSON.stringify({
                type: 'matchEndInventory',
                deposited: { rt: finalRT, portCharges },
                isWinner: !isStrayLoss && snapshot.winnerId === pid,
                strayLoss: isStrayLoss,
                karmaAwarded,
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
