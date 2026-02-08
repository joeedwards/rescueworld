/**
 * Game server: authoritative tick loop, accepts WebSocket connections for game channel.
 * Supports multiple isolated matches - each Solo game gets its own World.
 * FFA games share a lobby until enough players join.
 */

import type { WebSocket } from 'ws';
import { WebSocketServer } from 'ws';
import { World } from './game/World.js';
import { TICK_RATE, TICK_MS, MAX_FFA_PLAYERS, MAX_RT_PER_MATCH } from 'shared';
import { decodeInput, encodeSnapshot, MSG_INPUT } from 'shared';
import { registerServer, appendReplay, getNextGuestName } from './registry.js';
import { withdrawForMatch, withdrawForMatchSelective, depositAfterMatch, getInventory, type Inventory, type ItemSelection } from './inventory.js';
import { recordMatchWin, recordMatchLoss, updateReputationOnQuit, ensureGuestUser } from './leaderboard.js';
import { saveSavedMatch, getSavedMatch, deleteSavedMatch, insertMatchHistory, incrementGameCount, saveFfaMatch, getAllSavedFfaMatches, deleteSavedFfaMatch, getFriendsOf } from './referrals.js';
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
const EASTER_EGGS_ENABLED = process.env.ENABLE_EASTER_EGGS === 'true';
const DEBUG_LOGGING = process.env.DEBUG === 'true';

const FFA_COUNTDOWN_MS = 10000;

// Randomized bot names for CPU players
const BOT_NAMES = [
  'Whiskers', 'Buddy', 'Shadow', 'Luna', 'Milo', 'Daisy', 'Rocky', 'Bella',
  'Gizmo', 'Coco', 'Ziggy', 'Pepper', 'Biscuit', 'Noodle', 'Patches', 'Mocha',
  'Waffles', 'Sprout', 'Pickle', 'Muffin', 'Clover', 'Pebbles', 'Taco', 'Oreo',
  'Nugget', 'Maple', 'Bandit', 'Boots', 'Chip', 'Jellybean', 'Snickers', 'Rascal',
  'Bubbles', 'Truffle', 'Barkley', 'Domino', 'Pudding', 'Sage', 'Scooter', 'Mittens',
];

/** Pick a random bot name not already used in this match. */
function pickBotName(match: Match): string {
  const snapshot = match.world.getSnapshot();
  const usedNames = new Set(snapshot.players.map(p => p.displayName));
  const available = BOT_NAMES.filter(n => !usedNames.has(n));
  if (available.length > 0) {
    return available[Math.floor(Math.random() * available.length)];
  }
  // Fallback: append a number to a random name
  const base = BOT_NAMES[Math.floor(Math.random() * BOT_NAMES.length)];
  return `${base}${Math.floor(Math.random() * 99) + 1}`;
}

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
  /** Whether bots should fill empty slots in this match */
  botsEnabled?: boolean;
  /** Observers watching this match (no player entity, receive snapshots only) */
  observers: Map<string, WebSocket>;
  /** Team assignments for Teams mode: playerId -> 'red' | 'blue' */
  playerTeams?: Map<string, 'red' | 'blue'>;
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
        
        // Keep match frozen until a human player rejoins.
        // Do NOT call world.recordResume() here — the pause duration should
        // include server downtime + time waiting for a human to rejoin.
        
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
          frozen: true,
          playerUserIds: new Map(),
          fightAllyChoices: new Map(),
          allyRequests: new Map(),
          lastReplayTick: 0,
          playerStartingInventory: new Map(),
          observers: new Map(),
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
// Teams lobby match (waiting for players)
let teamsLobbyMatchId: string | null = null;

// Online presence tracking: userId -> Set of WebSocket connections (a user may have multiple tabs)
const onlineUsers = new Map<string, Set<WebSocket>>();

/** Register a user as online and notify their friends. */
function registerOnlineUser(userId: string, displayName: string, ws: WebSocket): void {
  let sockets = onlineUsers.get(userId);
  if (!sockets) {
    sockets = new Set();
    onlineUsers.set(userId, sockets);
  }
  const wasOffline = sockets.size === 0;
  sockets.add(ws);
  
  if (wasOffline) {
    // Notify users who have marked this user as a friend
    try {
      const friendOfUserIds = getFriendsOf(userId);
      const notifyMsg = JSON.stringify({ type: 'friendOnline', userId, displayName });
      for (const friendUserId of friendOfUserIds) {
        const friendSockets = onlineUsers.get(friendUserId);
        if (friendSockets) {
          for (const friendWs of friendSockets) {
            if (friendWs.readyState === 1) friendWs.send(notifyMsg);
          }
        }
      }
      if (friendOfUserIds.length > 0) {
        log(`Notified ${friendOfUserIds.length} friends that ${displayName} (${userId}) is online`);
      }
    } catch (e) {
      log(`Failed to notify friends of ${userId}: ${e}`);
    }
  }
}

/** Unregister a WebSocket from online presence. */
function unregisterOnlineUser(userId: string, ws: WebSocket): void {
  const sockets = onlineUsers.get(userId);
  if (sockets) {
    sockets.delete(ws);
    if (sockets.size === 0) {
      onlineUsers.delete(userId);
    }
  }
}

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

/** Check if a match has bots enabled */
export function isMatchBotsEnabled(matchId: string): boolean {
  const match = matches.get(matchId);
  return match?.botsEnabled ?? false;
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
  const world = new World();
  world.setMatchMode(mode); // Set match mode for boss mode trigger in solo
  const match: Match = {
    id: generateMatchId(),
    world,
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
    observers: new Map(),
    playerTeams: mode === 'teams' ? new Map() : undefined,
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
  // Close observer connections
  for (const obsWs of match.observers.values()) {
    try { obsWs.close(); } catch { /* ignore */ }
  }
  match.observers.clear();
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
  if (teamsLobbyMatchId === matchId) teamsLobbyMatchId = null;
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

/** Add a bot to a specific team in a Teams match. */
function addBotToTeam(match: Match, team: 'red' | 'blue'): void {
  const idx = match.cpuIds.size + 1;
  const cid = `cpu-${idx}`;
  if (!match.cpuIds.has(cid)) {
    match.world.addPlayer(cid, pickBotName(match));
    match.cpuIds.add(cid);
    if (match.playerTeams) {
      match.playerTeams.set(cid, team);
      match.world.setPlayerTeam(cid, team);
    }
    log(`Bot ${cid} added to team ${team} in match ${match.id}`);
  }
}

function ensureCpusForMatch(match: Match): void {
  if (match.mode === 'solo') {
    for (let i = 1; i <= 3; i++) {
      const cid = `cpu-${i}`;
      if (!match.cpuIds.has(cid)) {
        match.world.addPlayer(cid, pickBotName(match));
        match.cpuIds.add(cid);
      }
    }
  } else if (match.mode === 'teams' && match.botsEnabled && match.playerTeams) {
    // Teams mode: balance teams so each has at least 2 players, and both sides are equal
    const redCount = Array.from(match.playerTeams.values()).filter(t => t === 'red').length;
    const blueCount = Array.from(match.playerTeams.values()).filter(t => t === 'blue').length;
    const targetPerTeam = Math.max(2, Math.max(redCount, blueCount));
    // Fill red team
    while (Array.from(match.playerTeams.values()).filter(t => t === 'red').length < targetPerTeam) {
      addBotToTeam(match, 'red');
    }
    // Fill blue team
    while (Array.from(match.playerTeams.values()).filter(t => t === 'blue').length < targetPerTeam) {
      addBotToTeam(match, 'blue');
    }
  } else if (match.mode === 'ffa' && match.botsEnabled) {
    // With bots enabled, fill up to a reasonable count (at least 1 bot, up to 3)
    const totalPlayers = getMatchTotalPlayers(match);
    const botsToAdd = Math.min(3, MAX_FFA_PLAYERS - totalPlayers);
    for (let i = 0; i < botsToAdd; i++) {
      const idx = match.cpuIds.size + 1;
      const cid = `cpu-${idx}`;
      if (!match.cpuIds.has(cid) && getMatchTotalPlayers(match) < MAX_FFA_PLAYERS) {
        match.world.addPlayer(cid, pickBotName(match));
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
  playerCount: number;
  botsEnabled?: boolean;
  players?: Array<{ id: string; displayName: string; team?: 'red' | 'blue' }>;
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
      const userId = match.playerUserIds.get(id) ?? undefined;
      const team = match.playerTeams?.get(id);
      return { id, displayName: p?.displayName ?? 'Unknown', userId, team };
    });
  
  return {
    type: 'matchState',
    phase: match.phase,
    ...(countdownRemainingSec !== undefined && { countdownRemainingSec }),
    readyCount: match.readySet.size,
    playerCount: humanPlayers.length,
    botsEnabled: match.botsEnabled,
    players: humanPlayers.length > 0 ? humanPlayers : undefined,
  };
}

/** Get total player count in a match (humans + bots). */
function getMatchTotalPlayers(match: Match): number {
  return match.players.size + match.cpuIds.size;
}

function transitionToPlaying(match: Match): void {
  if (match.phase !== 'playing') {
    match.phase = 'playing';
    // Teams mode: auto-form alliances between all same-team players before match starts
    if (match.mode === 'teams') {
      match.world.formTeamAlliances();
    }
    match.world.startMatch();
    log(`match started id=${match.id} players=${match.players.size}`);
    // Send player userId map so clients can identify friends/foes
    broadcastPlayerMap(match);
  }
}

/** Broadcast playerId -> userId mapping to all connected players in a match. */
function broadcastPlayerMap(match: Match): void {
  const snapshot = match.world.getSnapshot();
  const entries: Array<{ playerId: string; userId?: string; displayName: string }> = [];
  for (const p of snapshot.players) {
    if (p.id.startsWith('cpu-')) continue;
    const userId = match.playerUserIds.get(p.id) ?? undefined;
    entries.push({ playerId: p.id, userId, displayName: p.displayName });
  }
  const msg = JSON.stringify({ type: 'playerMap', players: entries });
  for (const ws of match.players.values()) {
    if (ws.readyState === 1) ws.send(msg);
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
    
    const adoptSpeedBoosts = isStrayLoss ? 0 : match.world.getAdoptSpeedBoosts(playerId);
    if (finalRT > 0 || portCharges > 0 || shelterPortCharges > 0 || adoptSpeedBoosts > 0) {
      depositAfterMatch(userId, finalRT, portCharges, shelterPortCharges, 0, 0, adoptSpeedBoosts);
      log(`Solo match ended on leave - deposited ${finalRT} RT, ${portCharges} ports, ${adoptSpeedBoosts} adopt speed for ${userId}`);
    }
    
    // Ensure guest users have a users row so they appear on leaderboards
    if (userId.startsWith('guest-') && playerState) {
      ensureGuestUser(userId, playerState.displayName);
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
    // Only pause if there are NO bots; bots keep the match running on their own
    const humanPlayerIds = [...match.playerUserIds.keys()].filter(id => !id.startsWith('cpu-'));
    const anyHumanConnected = humanPlayerIds.some(id => match.players.has(id));
    const hasBots = match.cpuIds.size > 0;
    if (!anyHumanConnected && !hasBots && !match.frozen) {
      match.world.recordPause();
      match.frozen = true;
      log(`FFA/Teams match ${matchId} paused - all human players disconnected (no bots)`);
    }
    return;
  }

  if (!match.frozen) {
    // Refund RT and items if leaving before match started (lobby/countdown phase)
    if (userId && match.phase !== 'playing') {
      const startInv = match.playerStartingInventory.get(playerId);
      if (startInv && (startInv.storedRt > 0 || startInv.portCharges > 0 || startInv.shelterPortCharges > 0 || startInv.speedBoosts > 0 || startInv.sizeBoosts > 0 || startInv.adoptSpeedBoosts > 0)) {
        depositAfterMatch(userId, startInv.storedRt, startInv.portCharges, startInv.shelterPortCharges, startInv.speedBoosts, startInv.sizeBoosts, startInv.adoptSpeedBoosts);
        log(`Refunded pre-match inventory for ${userId}: ${startInv.storedRt} RT, ${startInv.portCharges} ports, ${startInv.shelterPortCharges} home ports, ${startInv.speedBoosts} speed, ${startInv.sizeBoosts} size, ${startInv.adoptSpeedBoosts} adopt speed`);
      }
    }
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
      const adoptSpeedBoosts = match.world.getAdoptSpeedBoosts(playerId);
      if (playerMoney > 0 || portCharges > 0 || shelterPortCharges > 0 || adoptSpeedBoosts > 0) {
        depositAfterMatch(userId, playerMoney, portCharges, shelterPortCharges, 0, 0, adoptSpeedBoosts);
        log(`Player ${playerId} disconnected - deposited ${playerMoney} RT, ${portCharges} ports, ${shelterPortCharges} home ports, ${adoptSpeedBoosts} adopt speed for ${userId}`);
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
  // Pending no-bots prompt: stored when player has bots enabled but a no-bots lobby exists
  let pendingNoBotsInfo: { mode: 'ffa' | 'teams'; displayName: string } | null = null;
  
  const addPlayerToMatch = (match: Match, name: string) => {
    if (playerAdded) return;
    displayName = name;
    playerAdded = true;
    
    // Withdraw RT only (capped at MAX_RT_PER_MATCH) - items are deferred until client sends selectedItems
    if (playerUserId && !startingInventory) {
      // Only withdraw RT now; items withdrawn when client sends selectedItems
      const prevGuestRt = startingRT; // Save guest localStorage fallback RT
      startingInventory = withdrawForMatchSelective(playerUserId, MAX_RT_PER_MATCH, {});
      if (startingInventory.storedRt > 0) {
        startingRT = startingInventory.storedRt;
        log(`User ${playerUserId} withdrawing RT from inventory: ${startingRT} (capped at ${MAX_RT_PER_MATCH})`);
      } else if (prevGuestRt > 0 && playerUserId.startsWith('guest-')) {
        // Guest with no server inventory yet: use localStorage RT fallback
        startingRT = prevGuestRt;
        log(`Guest ${playerUserId} using localStorage fallback RT: ${startingRT}`);
      } else {
        startingRT = 0;
        log(`User ${playerUserId} has no RT to withdraw`);
      }
    }
    if (playerUserId) {
      match.playerUserIds.set(effectivePlayerId, playerUserId);
      if (startingInventory) {
        match.playerStartingInventory.set(effectivePlayerId, startingInventory);
      }
    }
    
    log(`player joined match id=${match.id} playerId=${effectivePlayerId} displayName=${name} startingRT=${startingRT}`);
    match.world.addPlayer(effectivePlayerId, name, startingRT, startingPorts, startingShelterTier3Boosts, 0);
    match.players.set(effectivePlayerId, ws);
    playerToMatch.set(effectivePlayerId, match.id);
    currentMatchId = match.id;
    
    // Get remaining inventory so client can show what's left in chest
    const remainingInventory = playerUserId ? getInventory(playerUserId) : null;
    ws.send(JSON.stringify({ 
      type: 'welcome', 
      playerId: effectivePlayerId, 
      displayName, 
      matchId: match.id, 
      mode: match.mode,
      startingRT, 
      startingPorts: 0, 
      adoptSpeedBoosts: 0,
      remainingInventory: remainingInventory ? {
        storedRt: remainingInventory.storedRt,
        portCharges: remainingInventory.portCharges,
        speedBoosts: remainingInventory.speedBoosts,
        sizeBoosts: remainingInventory.sizeBoosts,
        adoptSpeedBoosts: remainingInventory.adoptSpeedBoosts,
        shelterTier3Boosts: remainingInventory.shelterTier3Boosts,
      } : null,
    }));
    
    // Register online presence for friend notifications
    if (playerUserId) {
      registerOnlineUser(playerUserId, name, ws);
    }
    
    // If joining a match already in progress, broadcast updated player map
    if (match.phase === 'playing') {
      broadcastPlayerMap(match);
    }
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
      mode: match.mode,
      startingRT: rt,
      startingPorts: ports,
      shelterPortCharges: shelterPorts,
      resumed: true,
    }));
    log(`Solo match resumed for ${match.soloUserId} playerId=${effectivePlayerId}`);
    // Register online presence for friend notifications
    if (match.soloUserId) {
      registerOnlineUser(match.soloUserId, displayName ?? 'Player', ws);
    }
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
          
          // Check if client sent userId (registered user or guest with guest_id)
          // NOTE: Don't withdraw inventory here! We need to validate the match first.
          // Inventory withdrawal happens in addPlayerToMatch after confirming match is valid.
          if (typeof msg.userId === 'string' && (msg.userId.startsWith('u-') || msg.userId.startsWith('guest-'))) {
            playerUserId = msg.userId as string;
            if (msg.userId.startsWith('u-')) {
              log(`Registered user ${playerUserId} connecting...`);
            } else {
              log(`Guest ${playerUserId} connecting...`);
              // Accept guest localStorage RT as fallback (used if server inventory is empty)
              if (typeof msg.guestStartingRt === 'number' && msg.guestStartingRt > 0) {
                startingRT = Math.min(Math.floor(msg.guestStartingRt), MAX_RT_PER_MATCH);
              }
            }
          } else {
            // Anonymous guest without guest_id: accept starting RT from client
            if (typeof msg.guestStartingRt === 'number' && msg.guestStartingRt > 0) {
              startingRT = Math.min(Math.floor(msg.guestStartingRt), MAX_RT_PER_MATCH);
            } else if (typeof msg.startingRT === 'number' && msg.startingRT > 0) {
              // Backwards compat fallback
              startingRT = Math.min(Math.floor(msg.startingRT), MAX_RT_PER_MATCH);
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
                        observers: new Map(),
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
                        mode: match.mode,
                        startingRT: rt,
                        startingPorts: ports,
                        shelterPortCharges: shelterPorts,
                        resumed: true,
                      }));
                      log(`Solo match loaded from DB for ${playerUserId} matchId=${match.id}`);
                      // Register online presence for friend notifications
                      if (playerUserId) {
                        registerOnlineUser(playerUserId, match.soloDisplayName ?? displayNameToUse, ws);
                      }
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
                    
                    const ffaAdoptStatus = existingMatch.world.getAdoptSpeedBoostStatus(ffaInfo.playerId);
                    ws.send(JSON.stringify({
                      type: 'welcome',
                      playerId: ffaInfo.playerId,
                      displayName: p?.displayName ?? displayNameToUse,
                      matchId: existingMatch.id,
                      mode: existingMatch.mode,
                      startingRT: rt,
                      startingPorts: ports,
                      shelterPortCharges: shelterPorts,
                      adoptSpeedBoosts: ffaAdoptStatus.remainingBoosts,
                      adoptSpeedActiveUntilTick: ffaAdoptStatus.activeUntilTick,
                      adoptSpeedUsedSeconds: ffaAdoptStatus.usedSeconds,
                      resumed: true,
                    }));
                    log(`FFA match rejoined by ${playerUserId} playerId=${ffaInfo.playerId} matchId=${existingMatch.id}`);
                    // Register online presence for friend notifications
                    if (playerUserId) {
                      registerOnlineUser(playerUserId, p?.displayName ?? displayNameToUse, ws);
                    }
                    // Send updated player map to all players (so they know about rejoining player's userId)
                    broadcastPlayerMap(existingMatch);
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
              
              const clientBotsEnabled = !!msg.botsEnabled;
              
              // Check if player has bots enabled but there's a no-bots lobby with waiting players
              if (clientBotsEnabled) {
                const existingLobby = ffaLobbyMatchId ? matches.get(ffaLobbyMatchId) : null;
                if (existingLobby && existingLobby.phase === 'lobby' && !existingLobby.botsEnabled && existingLobby.players.size > 0) {
                  // Prompt the player: there's a no-bots match waiting
                  pendingNoBotsInfo = { mode: 'ffa', displayName: displayNameToUse };
                  const waitingCount = existingLobby.players.size;
                  ws.send(JSON.stringify({ type: 'pendingNoBots', mode: 'ffa', playerCount: waitingCount }));
                  log(`FFA no-bots lobby prompt sent to ${displayNameToUse} (${waitingCount} waiting)`);
                  return;
                }
              }
              
              // Join lobby or create one (no mid-match joining — only original players can rejoin via rejoinMatchId)
              let match = ffaLobbyMatchId ? matches.get(ffaLobbyMatchId) : null;
              if (!match || match.phase === 'playing') {
                // Create new lobby if none exists or current is already playing
                match = createMatch('ffa');
                ffaLobbyMatchId = match.id;
              }
              if (clientBotsEnabled) match.botsEnabled = true;
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
                    
                    const teamsAdoptStatus = existingMatch.world.getAdoptSpeedBoostStatus(teamsInfo.playerId);
                    ws.send(JSON.stringify({
                      type: 'welcome',
                      playerId: teamsInfo.playerId,
                      displayName: p?.displayName ?? displayNameToUse,
                      matchId: existingMatch.id,
                      mode: existingMatch.mode,
                      startingRT: rt,
                      startingPorts: ports,
                      shelterPortCharges: shelterPorts,
                      adoptSpeedBoosts: teamsAdoptStatus.remainingBoosts,
                      adoptSpeedActiveUntilTick: teamsAdoptStatus.activeUntilTick,
                      adoptSpeedUsedSeconds: teamsAdoptStatus.usedSeconds,
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
              
              const teamsBotsEnabled = !!msg.botsEnabled;
              // Team selection: player picks 'red' or 'blue' (default 'red')
              const chosenTeam: 'red' | 'blue' = msg.team === 'blue' ? 'blue' : 'red';
              
              // Check if player has bots enabled but there's a no-bots lobby with waiting players
              if (teamsBotsEnabled) {
                const existingLobby = teamsLobbyMatchId ? matches.get(teamsLobbyMatchId) : null;
                if (existingLobby && existingLobby.phase === 'lobby' && !existingLobby.botsEnabled && existingLobby.players.size > 0) {
                  pendingNoBotsInfo = { mode: 'teams', displayName: displayNameToUse };
                  const waitingCount = existingLobby.players.size;
                  ws.send(JSON.stringify({ type: 'pendingNoBots', mode: 'teams', playerCount: waitingCount }));
                  log(`Teams no-bots lobby prompt sent to ${displayNameToUse} (${waitingCount} waiting)`);
                  return;
                }
              }
              
              // Join teams lobby or create one (no mid-match joining — only original players can rejoin via rejoinMatchId)
              let match = teamsLobbyMatchId ? matches.get(teamsLobbyMatchId) : null;
              if (!match || match.phase === 'playing') {
                match = createMatch('teams');
                teamsLobbyMatchId = match.id;
              }
              if (teamsBotsEnabled) match.botsEnabled = true;
              addPlayerToMatch(match, displayNameToUse);
              // Assign team after player is added
              if (match.playerTeams) {
                match.playerTeams.set(effectivePlayerId, chosenTeam);
                match.world.setPlayerTeam(effectivePlayerId, chosenTeam);
                log(`Player ${displayNameToUse} joined team ${chosenTeam} in match ${match.id}`);
              }
              
              // Start countdown when 2+ humans have joined (need at least 1 per team or bots will fill)
              if (match.players.size >= 2 && match.phase === 'lobby') {
                ensureCpusForMatch(match);
                match.phase = 'countdown';
                match.countdownEndAt = Date.now() + FFA_COUNTDOWN_MS;
                match.readySet.clear();
              }
            }
          })();
          return;
        }
        
        // Handle response to no-bots lobby prompt
        if (msg.type === 'joinNoBotsResponse' && pendingNoBotsInfo) {
          const info = pendingNoBotsInfo;
          pendingNoBotsInfo = null;
          
          const joinNoBots = !!msg.join;
          const lobbyId = info.mode === 'ffa' ? ffaLobbyMatchId : teamsLobbyMatchId;
          
          if (joinNoBots) {
            // Re-check that the no-bots lobby still exists and is valid
            const lobby = lobbyId ? matches.get(lobbyId) : null;
            if (lobby && lobby.phase === 'lobby' && !lobby.botsEnabled) {
              // Join the existing no-bots lobby
              addPlayerToMatch(lobby, info.displayName);
              if (lobby.players.size >= 2 && lobby.phase === 'lobby') {
                ensureCpusForMatch(lobby);
                lobby.phase = 'countdown';
                lobby.countdownEndAt = Date.now() + FFA_COUNTDOWN_MS;
                lobby.readySet.clear();
              }
              log(`Player ${info.displayName} joined no-bots ${info.mode} lobby`);
              return;
            }
            // Lobby gone — fall through to create a new one (without bots since they chose to join no-bots)
            let match: Match;
            if (info.mode === 'ffa') {
              match = createMatch('ffa');
              ffaLobbyMatchId = match.id;
            } else {
              match = createMatch('teams');
              teamsLobbyMatchId = match.id;
            }
            addPlayerToMatch(match, info.displayName);
            log(`No-bots lobby expired, created new ${info.mode} lobby for ${info.displayName}`);
          } else {
            // Player declined — start with bots as originally intended
            let match: Match;
            if (info.mode === 'ffa') {
              let existing = ffaLobbyMatchId ? matches.get(ffaLobbyMatchId) : null;
              // Don't join the no-bots lobby they declined; create a separate bots lobby
              if (!existing || existing.phase === 'playing' || !existing.botsEnabled) {
                match = createMatch('ffa');
                // Don't overwrite ffaLobbyMatchId if a no-bots lobby is still waiting
                if (!existing || existing.phase === 'playing') {
                  ffaLobbyMatchId = match.id;
                }
              } else {
                match = existing;
              }
            } else {
              let existing = teamsLobbyMatchId ? matches.get(teamsLobbyMatchId) : null;
              if (!existing || existing.phase === 'playing' || !existing.botsEnabled) {
                match = createMatch('teams');
                if (!existing || existing.phase === 'playing') {
                  teamsLobbyMatchId = match.id;
                }
              } else {
                match = existing;
              }
            }
            match.botsEnabled = true;
            addPlayerToMatch(match, info.displayName);
            
            // Single player with bots — they can press "Ready with Bots" from the lobby
            log(`Player ${info.displayName} declined no-bots, created ${info.mode} lobby with bots`);
          }
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
          // "Ready with Bots": single player in lobby with bots enabled
          if (match.phase === 'lobby' && match.botsEnabled && (match.mode === 'ffa' || match.mode === 'teams')) {
            const humanCount = Array.from(match.players.keys()).filter(id => !id.startsWith('cpu-')).length;
            if (humanCount >= 1) {
              if (match.mode === 'teams' && match.playerTeams) {
                // Teams mode: ensure both teams have players, fill with bots
                // If a team has no players at all, ensure at least the opposing team exists
                const redCount = Array.from(match.playerTeams.values()).filter(t => t === 'red').length;
                const blueCount = Array.from(match.playerTeams.values()).filter(t => t === 'blue').length;
                // Make sure the opposing team has at least 2 bots
                if (blueCount === 0) { addBotToTeam(match, 'blue'); addBotToTeam(match, 'blue'); }
                if (redCount === 0) { addBotToTeam(match, 'red'); addBotToTeam(match, 'red'); }
                // Balance teams: ensure both sides have equal counts (at least 2 each)
                ensureCpusForMatch(match);
              } else {
                // FFA mode: add a bot to make it a 2-player match
                const botId = `cpu-${match.cpuIds.size + 1}`;
                match.world.addPlayer(botId, pickBotName(match), 0, 0, 0, 0);
                match.cpuIds.add(botId);
                ensureCpusForMatch(match);
              }
              transitionToPlaying(match);
              if (ffaLobbyMatchId === match.id) ffaLobbyMatchId = null;
              if (teamsLobbyMatchId === match.id) teamsLobbyMatchId = null;
              log(`Ready with bots: match ${match.id} started with ${humanCount} human(s) + ${match.cpuIds.size} bot(s)`);
            }
          }
          return;
        }
        
        // Handle team change during lobby phase (Teams mode)
        if (msg.type === 'changeTeam' && (msg.team === 'red' || msg.team === 'blue')) {
          if (match.mode === 'teams' && match.phase === 'lobby' && match.playerTeams) {
            const newTeam = msg.team as 'red' | 'blue';
            match.playerTeams.set(playerId, newTeam);
            match.world.setPlayerTeam(playerId, newTeam);
            log(`Player ${playerId} changed team to ${newTeam} in match ${match.id}`);
            // Broadcast updated match state so all players see the change
            const matchState = getMatchState(match);
            for (const ws of match.players.values()) {
              if (ws.readyState === 1) ws.send(JSON.stringify(matchState));
            }
          }
          return;
        }
        
        if (msg.type === 'fightAlly' && typeof msg.targetId === 'string' && (msg.choice === 'fight' || msg.choice === 'ally')) {
          if (match.mode === 'teams') return; // Teams mode: no manual fight/ally
          match.fightAllyChoices.set(`${playerId},${msg.targetId}`, msg.choice);
          return;
        }

        if (msg.type === 'allyRequest' && typeof msg.targetId === 'string') {
          if (match.mode === 'teams') return; // Teams mode: alliances are automatic
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
        
        // Handle ally response (accept/deny) - not used in Teams mode
        if (msg.type === 'allyResponse' && typeof msg.targetId === 'string' && typeof msg.accept === 'boolean') {
          if (match.mode === 'teams') return; // Teams mode: alliances are automatic
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
        
        if (msg.type === 'startingBoosts' && (typeof msg.sizeBonus === 'number' || msg.speedBoost || typeof msg.adoptSpeedBoosts === 'number')) {
          match.world.applyStartingBoosts(effectivePlayerId, {
            sizeBonus: typeof msg.sizeBonus === 'number' ? msg.sizeBonus : 0,
            speedBoost: !!msg.speedBoost,
            adoptSpeedBoosts: typeof msg.adoptSpeedBoosts === 'number' ? msg.adoptSpeedBoosts : 0,
          });
          return;
        }
        
        // Handle selected items from equipment chest (sent after item selection modal)
        if (msg.type === 'selectedItems') {
          if (playerUserId) {
            // Withdraw only the selected items from inventory (RT was already withdrawn)
            const selection: ItemSelection = {
              portCharges: typeof msg.portCharges === 'number' ? Math.max(0, Math.floor(msg.portCharges)) : 0,
              shelterPortCharges: typeof msg.shelterPortCharges === 'number' ? Math.max(0, Math.floor(msg.shelterPortCharges)) : 0,
              speedBoosts: typeof msg.speedBoosts === 'number' ? Math.max(0, Math.floor(msg.speedBoosts)) : 0,
              sizeBoosts: typeof msg.sizeBoosts === 'number' ? Math.max(0, Math.floor(msg.sizeBoosts)) : 0,
              shelterTier3Boosts: typeof msg.shelterTier3Boosts === 'number' ? Math.max(0, Math.floor(msg.shelterTier3Boosts)) : 0,
              adoptSpeedBoosts: typeof msg.adoptSpeedBoosts === 'number' ? Math.max(0, Math.floor(msg.adoptSpeedBoosts)) : 0,
            };
            const withdrawn = withdrawForMatchSelective(playerUserId, 0, selection);
            log(`Player ${playerUserId} selected items: ${withdrawn.portCharges} ports, ${withdrawn.speedBoosts} speed, ${withdrawn.sizeBoosts} size, ${withdrawn.adoptSpeedBoosts} adopt speed, ${withdrawn.shelterTier3Boosts} tier3`);
            
            // Apply the withdrawn items to the player
            if (withdrawn.portCharges > 0) {
              const currentPorts = match.world.getPortCharges(effectivePlayerId);
              match.world.setPortCharges(effectivePlayerId, currentPorts + withdrawn.portCharges);
            }
            if (withdrawn.shelterPortCharges > 0) {
              const currentShelterPorts = match.world.getShelterPortCharges(effectivePlayerId);
              match.world.setShelterPortCharges(effectivePlayerId, currentShelterPorts + withdrawn.shelterPortCharges);
            }
            if (withdrawn.shelterTier3Boosts > 0) {
              match.world.setShelterTier3Boosts(effectivePlayerId, withdrawn.shelterTier3Boosts);
            }
            match.world.applyStartingBoosts(effectivePlayerId, {
              sizeBonus: withdrawn.sizeBoosts,
              speedBoost: withdrawn.speedBoosts > 0,
              adoptSpeedBoosts: withdrawn.adoptSpeedBoosts,
            });
            
            // Update the starting inventory record to include items for deposit-back tracking
            const existingInv = match.playerStartingInventory.get(effectivePlayerId);
            if (existingInv) {
              existingInv.portCharges += withdrawn.portCharges;
              existingInv.shelterPortCharges += withdrawn.shelterPortCharges;
              existingInv.speedBoosts += withdrawn.speedBoosts;
              existingInv.sizeBoosts += withdrawn.sizeBoosts;
              existingInv.shelterTier3Boosts += withdrawn.shelterTier3Boosts;
              existingInv.adoptSpeedBoosts += withdrawn.adoptSpeedBoosts;
            }
            
            // Send confirmation with what was actually applied
            ws.send(JSON.stringify({
              type: 'itemsApplied',
              portCharges: withdrawn.portCharges,
              shelterPortCharges: withdrawn.shelterPortCharges,
              speedBoosts: withdrawn.speedBoosts,
              sizeBoosts: withdrawn.sizeBoosts,
              adoptSpeedBoosts: withdrawn.adoptSpeedBoosts,
              shelterTier3Boosts: withdrawn.shelterTier3Boosts,
            }));
          }
          return;
        }
        
        // Use adopt speed boost during match
        if (msg.type === 'useBoost' && msg.boostType === 'adoptSpeed') {
          const result = match.world.useAdoptSpeedBoost(effectivePlayerId);
          ws.send(JSON.stringify({
            type: 'boostUsed',
            boostType: 'adoptSpeed',
            success: result.success,
            remainingBoosts: result.remainingBoosts,
            activeUntilTick: result.activeUntilTick,
            usedSeconds: result.usedSeconds,
          }));
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

        // Boss Mode: Enter/Exit mills is now handled automatically via proximity detection in World.updateBossMillProximity()

        // Easter egg: Force enter boss mode (Ctrl+Shift+B)
        if (msg.type === 'easterEggBossMode') {
          if (!EASTER_EGGS_ENABLED) {
            ws.send(JSON.stringify({ type: 'easterEggBossModeResult', success: false, reason: 'easter eggs disabled' }));
            return;
          }
          if (DEBUG_LOGGING) log(`Easter egg boss mode trigger requested by ${effectivePlayerId}`);
          const success = match.world.debugEnterBossMode();
          if (DEBUG_LOGGING) log(`Easter egg boss mode result: ${success}`);
          ws.send(JSON.stringify({ type: 'easterEggBossModeResult', success }));
          return;
        }
        // Legacy support for old message name
        if (msg.type === 'debugBossMode') {
          if (!EASTER_EGGS_ENABLED) {
            ws.send(JSON.stringify({ type: 'debugBossModeResult', success: false, reason: 'easter eggs disabled' }));
            return;
          }
          if (DEBUG_LOGGING) log(`Easter egg boss mode (legacy) trigger requested by ${effectivePlayerId}`);
          const success = match.world.debugEnterBossMode();
          ws.send(JSON.stringify({ type: 'debugBossModeResult', success }));
          return;
        }

        // Boss Mode: Purchase ingredient
        if (msg.type === 'bossPurchase' && typeof msg.ingredient === 'string' && typeof msg.amount === 'number') {
          if (DEBUG_LOGGING) log(`bossPurchase received: ingredient=${msg.ingredient}, amount=${msg.amount}`);
          const result = match.world.purchaseBossIngredient(effectivePlayerId, msg.ingredient, msg.amount);
          if (DEBUG_LOGGING) log(`bossPurchase result: ${JSON.stringify(result)}`);
          ws.send(JSON.stringify({ type: 'bossPurchaseResult', ...result }));
          return;
        }

        // Boss Mode: Submit meal to rescue pets
        if (msg.type === 'bossSubmitMeal') {
          const result = match.world.submitBossMeal(effectivePlayerId);
          ws.send(JSON.stringify({ type: 'bossSubmitMealResult', ...result }));
          
          // If full victory (5 mills cleared), award Karma Point
          if (result.kpAwarded) {
            const userId = match.playerUserIds.get(effectivePlayerId);
            if (userId) {
              try {
                awardKarmaPoints(userId, 1, 'boss_mode_victory');
                log(`Awarded 1 KP to ${userId} for boss mode victory`);
                ws.send(JSON.stringify({ type: 'karmaAwarded', amount: 1, reason: 'boss_mode_victory' }));
              } catch (e) {
                log(`Failed to award boss mode KP: ${e}`);
              }
            }
          }
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
    // Unregister online presence
    if (playerUserId) {
      unregisterOnlineUser(playerUserId, ws);
    }
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
        // Only pause if there are NO bots; bots keep the match running on their own
        if (match.mode === 'ffa' || match.mode === 'teams') {
          const humanPlayerIds = [...match.playerUserIds.keys()].filter(id => !id.startsWith('cpu-'));
          const allDisconnected = humanPlayerIds.length > 0 && humanPlayerIds.every(id => !match.players.has(id));
          const hasBots = match.cpuIds.size > 0;
          
          if (allDisconnected && !hasBots && !match.frozen) {
            // Pause the match - all humans disconnected and no bots to keep playing
            match.world.recordPause();
            match.frozen = true;
            log(`FFA/Teams match ${matchId} paused - all human players disconnected (no bots)`);
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
        
        // Send binary snapshots every 2nd tick (12.5 Hz) — halves encode + network cost
        // Game logic still runs at 25 Hz; client interpolation (100ms buffer) smooths the gap
        if (snapshot.tick % 2 === 0) {
          const buf = encodeSnapshot(snapshot);
          for (const ws of match.players.values()) {
            if (ws.readyState === 1) ws.send(buf);
          }
          // Broadcast to observers too
          for (const [obsId, obsWs] of match.observers.entries()) {
            if (obsWs.readyState === 1) {
              obsWs.send(buf);
            } else {
              match.observers.delete(obsId);
            }
          }
        }
        
        // Promote first observer if a player slot opened up
        if (match.observers.size > 0 && getMatchTotalPlayers(match) < MAX_FFA_PLAYERS) {
          const [obsId, obsWs] = match.observers.entries().next().value as [string, WebSocket];
          if (obsWs.readyState === 1) {
            match.observers.delete(obsId);
            // Create a real player for this observer
            const newPlayerId = `p-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
            match.world.addPlayer(newPlayerId, `Player`, 0, 0, 0, 0);
            match.players.set(newPlayerId, obsWs);
            playerToMatch.set(newPlayerId, match.id);
            obsWs.send(JSON.stringify({ type: 'promoted', playerId: newPlayerId, matchId: match.id }));
            log(`Observer ${obsId} promoted to player ${newPlayerId} in match ${match.id}`);
          }
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
          // Teams mode: determine winning team for reward scaling
          const winningTeam = match.mode === 'teams' ? match.world.getWinningTeam() : null;
          
          for (const [pid, userId] of match.playerUserIds.entries()) {
            const playerState = snapshot.players.find(p => p.id === pid);
            if (!playerState) continue;
            
            // Ensure guest users have a users row so they appear on leaderboards
            if (userId.startsWith('guest-')) {
              ensureGuestUser(userId, playerState.displayName);
            }
            
            // Teams mode: losing team gets 1/3 rewards
            const playerTeam = match.mode === 'teams' ? match.world.getPlayerTeam(pid) : undefined;
            const isOnWinningTeam = match.mode === 'teams' && playerTeam === winningTeam;
            const isOnLosingTeam = match.mode === 'teams' && playerTeam != null && playerTeam !== winningTeam;
            const rewardMultiplier = isOnLosingTeam ? (1 / 3) : 1;
            
            const rawRT = isStrayLoss ? 0 : (playerState.money ?? 0);
            const finalRT = Math.floor(rawRT * rewardMultiplier);
            const rawPortCharges = isStrayLoss ? 0 : match.world.getPortCharges(pid);
            const portCharges = Math.floor(rawPortCharges * rewardMultiplier);
            const rawShelterPortCharges = isStrayLoss ? 0 : match.world.getShelterPortCharges(pid);
            const shelterPortCharges = Math.floor(rawShelterPortCharges * rewardMultiplier);
            const rawAdoptSpeedBoosts = isStrayLoss ? 0 : match.world.getAdoptSpeedBoosts(pid);
            const adoptSpeedBoosts = Math.floor(rawAdoptSpeedBoosts * rewardMultiplier);
            if (finalRT > 0 || portCharges > 0 || shelterPortCharges > 0 || adoptSpeedBoosts > 0) {
              depositAfterMatch(userId, finalRT, portCharges, shelterPortCharges, 0, 0, adoptSpeedBoosts);
              log(`Deposited for ${userId}: ${finalRT} RT, ${portCharges} ports, ${shelterPortCharges} home ports, ${adoptSpeedBoosts} adopt speed${isOnLosingTeam ? ' (losing team 1/3)' : ''}`);
            }
            
            // Determine winner status
            let isWinner: boolean;
            if (match.mode === 'teams') {
              isWinner = !isStrayLoss && isOnWinningTeam;
            } else {
              isWinner = !isStrayLoss && snapshot.winnerId === pid;
            }
            
            const adoptions = playerState.totalAdoptions ?? 0;
            let karmaAwarded = 0;
            if (isStrayLoss) {
              recordMatchLoss(userId, 0);
            } else {
              if (isWinner) {
                recordMatchWin(userId, finalRT);
                log(`Recorded win for ${userId}${match.mode === 'teams' ? ` (team ${playerTeam})` : ''}`);
              } else {
                recordMatchLoss(userId, finalRT);
              }
              // KP award logic differs by mode:
              // FFA: 1 KP for 50+ adoptions
              // Teams: 1 KP for each member of the winning team
              if (match.mode === 'teams') {
                if (isOnWinningTeam) {
                  awardKarmaPoints(userId, 1, `Teams match ${matchId} (team ${playerTeam} won)`);
                  karmaAwarded = 1;
                  log(`Awarded 1 KP to ${userId} (winning team ${playerTeam})`);
                }
              } else if (match.mode !== 'solo' && adoptions >= 50) {
                awardKarmaPoints(userId, 1, `Match ${matchId} (${adoptions} adoptions)`);
                karmaAwarded = 1;
                log(`Awarded 1 KP to ${userId} for ${adoptions} adoptions`);
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
                isWinner,
                strayLoss: isStrayLoss,
                karmaAwarded,
                winningTeam: winningTeam || undefined,
                myTeam: playerTeam || undefined,
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
