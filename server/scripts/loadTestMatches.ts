import WebSocket from 'ws';
import Database from 'better-sqlite3';
import path from 'path';
import { encodeInput } from 'shared';
import { INPUT_LEFT, INPUT_RIGHT, INPUT_UP, INPUT_DOWN, TICK_MS } from 'shared';

/**
 * Load Test Script for FFA Matches
 * 
 * Usage:
 *   npx tsx server/scripts/loadTestMatches.ts --matches 50 --url ws://localhost:4001
 *   npx tsx server/scripts/loadTestMatches.ts --cleanup  # Delete test data only
 * 
 * This script simulates real-world match creation by:
 * - Creating matches in waves with random delays
 * - Each match has 2-4 players
 * - Players simulate gameplay for 30-120 seconds
 * - Uses 'loadtest-' prefix for easy cleanup
 */

const TEST_PREFIX = 'loadtest-';

type ClientState = {
  id: string;
  ws: WebSocket;
  inputSeq: number;
  inputFlags: number;
  matchId: string | null;
  pingInterval?: NodeJS.Timeout;
  inputInterval?: NodeJS.Timeout;
  directionInterval?: NodeJS.Timeout;
};

type MatchGroup = {
  matchIndex: number;
  clients: ClientState[];
  startedAt: number;
  playDuration: number; // How long to play before disconnecting
};

function parseArgs(): Record<string, string | boolean> {
  const args: Record<string, string | boolean> = {};
  for (let i = 2; i < process.argv.length; i++) {
    const arg = process.argv[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = process.argv[i + 1];
      if (!next || next.startsWith('--')) {
        args[key] = true;
      } else {
        args[key] = next;
        i++;
      }
    }
  }
  return args;
}

function getNumberArg(args: Record<string, string | boolean>, key: string, fallback: number): number {
  const v = args[key];
  if (typeof v === 'string') {
    const n = Number(v);
    if (!Number.isNaN(n) && Number.isFinite(n)) return n;
  }
  return fallback;
}

function getStringArg(args: Record<string, string | boolean>, key: string, fallback: string): string {
  const v = args[key];
  return typeof v === 'string' && v.length ? v : fallback;
}

function printUsage(): void {
  console.log(`
Load Test Script for FFA Matches

Usage:
  npx tsx server/scripts/loadTestMatches.ts --matches 50 --url ws://localhost:4001
  npx tsx server/scripts/loadTestMatches.ts --cleanup  # Delete test data only

Options:
  --url         WebSocket URL (default: ws://localhost:4001)
  --matches     Number of matches to create (default: 50)
  --min-play    Min play duration in seconds (default: 30)
  --max-play    Max play duration in seconds (default: 120)
  --min-delay   Min delay between matches in seconds (default: 0.5)
  --max-delay   Max delay between matches in seconds (default: 3)
  --cleanup     Only run cleanup, no match creation
  --no-cleanup  Skip cleanup after test
  --db          Database path (default: ./rescueworld.db)
  --help        Show this help
`);
}

function computeInputFlags(dx: number, dy: number): number {
  let flags = 0;
  if (dx < -0.3) flags |= INPUT_LEFT;
  if (dx > 0.3) flags |= INPUT_RIGHT;
  if (dy < -0.3) flags |= INPUT_UP;
  if (dy > 0.3) flags |= INPUT_DOWN;
  return flags;
}

function randomDirection(): { dx: number; dy: number } {
  const angle = Math.random() * Math.PI * 2;
  return { dx: Math.cos(angle), dy: Math.sin(angle) };
}

function randomBetween(min: number, max: number): number {
  return Math.random() * (max - min) + min;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function log(msg: string): void {
  const now = new Date();
  const timestamp = now.toISOString().replace('T', ' ').slice(0, 19);
  console.log(`[${timestamp}] [loadtest] ${msg}`);
}

// Get the default database path (same as server uses)
function getDefaultDbPath(): string {
  // Check environment variable first, then fall back to server's default location
  if (process.env.SQLITE_DB_PATH) {
    return process.env.SQLITE_DB_PATH;
  }
  // Default: server/dist/../rescueworld.db = server/rescueworld.db
  return path.join(__dirname, '..', 'rescueworld.db');
}

// Check if a table exists
function tableExists(db: Database.Database, tableName: string): boolean {
  const result = db.prepare(`
    SELECT name FROM sqlite_master WHERE type='table' AND name=?
  `).get(tableName) as { name: string } | undefined;
  return !!result;
}

// Database cleanup functions
function cleanupTestData(dbPath: string): void {
  log(`Cleaning up test data from ${dbPath}...`);
  
  // Check if database file exists
  const fs = require('fs');
  if (!fs.existsSync(dbPath)) {
    log(`Database file not found: ${dbPath}`);
    return;
  }
  
  const db = new Database(dbPath);
  
  try {
    // Delete saved FFA matches created by test users
    if (tableExists(db, 'saved_ffa_matches')) {
      const deleted = db.prepare(`
        DELETE FROM saved_ffa_matches 
        WHERE player_user_ids LIKE '%${TEST_PREFIX}%'
      `).run();
      log(`Deleted ${deleted.changes} saved FFA matches`);
    } else {
      log('Table saved_ffa_matches does not exist');
    }
    
    // Delete match history entries for test users
    if (tableExists(db, 'match_history')) {
      const historyDeleted = db.prepare(`
        DELETE FROM match_history 
        WHERE user_id LIKE '${TEST_PREFIX}%'
      `).run();
      log(`Deleted ${historyDeleted.changes} match history entries`);
    } else {
      log('Table match_history does not exist');
    }
    
    // Delete player stats for test users
    if (tableExists(db, 'player_stats')) {
      const statsDeleted = db.prepare(`
        DELETE FROM player_stats 
        WHERE user_id LIKE '${TEST_PREFIX}%'
      `).run();
      log(`Deleted ${statsDeleted.changes} player stats entries`);
    } else {
      log('Table player_stats does not exist');
    }
    
    log('Cleanup complete');
  } finally {
    db.close();
  }
}

async function createMatch(
  matchIndex: number,
  url: string,
  playersCount: number,
  playDurationSec: number,
): Promise<MatchGroup> {
  const matchGroup: MatchGroup = {
    matchIndex,
    clients: [],
    startedAt: Date.now(),
    playDuration: playDurationSec * 1000,
  };
  
  log(`Match ${matchIndex}: Creating with ${playersCount} players, play duration ${playDurationSec}s`);
  
  // Create all clients for this match
  const clientPromises: Promise<ClientState>[] = [];
  
  for (let i = 0; i < playersCount; i++) {
    const clientId = `${TEST_PREFIX}m${matchIndex}-p${i}-${Math.random().toString(36).slice(2, 6)}`;
    clientPromises.push(createClient(clientId, url, matchGroup));
    // Small delay between clients in same match (50-150ms)
    await sleep(randomBetween(50, 150));
  }
  
  const clients = await Promise.all(clientPromises);
  matchGroup.clients = clients;
  
  return matchGroup;
}

function createClient(id: string, url: string, matchGroup: MatchGroup): Promise<ClientState> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const state: ClientState = {
      id,
      ws,
      inputSeq: 0,
      inputFlags: 0,
      matchId: null,
    };
    
    const timeout = setTimeout(() => {
      ws.close();
      reject(new Error(`Connection timeout for ${id}`));
    }, 10000);
    
    ws.binaryType = 'arraybuffer';
    
    ws.on('open', () => {
      clearTimeout(timeout);
      // Send mode message to join FFA
      ws.send(JSON.stringify({ 
        type: 'mode', 
        mode: 'ffa', 
        displayName: id,
        userId: id, // Use test ID as userId for tracking
      }));
      
      // Start input simulation
      state.directionInterval = setInterval(() => {
        const { dx, dy } = randomDirection();
        state.inputFlags = computeInputFlags(dx, dy);
      }, 1200);
      
      state.inputInterval = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          const buf = encodeInput(state.inputFlags, state.inputSeq++);
          ws.send(buf);
        }
      }, TICK_MS);
      
      // Ping to keep connection alive
      state.pingInterval = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'ping', ts: Date.now() }));
        }
      }, 1000);
      
      resolve(state);
    });
    
    ws.on('message', (data: WebSocket.RawData) => {
      if (typeof data === 'string') {
        try {
          const msg = JSON.parse(data);
          if (msg.type === 'welcome' && msg.matchId) {
            state.matchId = msg.matchId;
            log(`Match ${matchGroup.matchIndex}: Client ${id} joined matchId=${msg.matchId}`);
          }
        } catch {
          // ignore
        }
      }
    });
    
    ws.on('error', (err) => {
      clearTimeout(timeout);
      log(`Client ${id} error: ${err.message}`);
    });
    
    ws.on('close', () => {
      if (state.pingInterval) clearInterval(state.pingInterval);
      if (state.inputInterval) clearInterval(state.inputInterval);
      if (state.directionInterval) clearInterval(state.directionInterval);
    });
  });
}

function disconnectMatch(matchGroup: MatchGroup): void {
  log(`Match ${matchGroup.matchIndex}: Disconnecting ${matchGroup.clients.length} clients after ${Math.round((Date.now() - matchGroup.startedAt) / 1000)}s`);
  
  for (const client of matchGroup.clients) {
    if (client.pingInterval) clearInterval(client.pingInterval);
    if (client.inputInterval) clearInterval(client.inputInterval);
    if (client.directionInterval) clearInterval(client.directionInterval);
    
    try {
      client.ws.close();
    } catch {
      // ignore
    }
  }
}

async function main(): Promise<void> {
  const args = parseArgs();
  
  if (args.help) {
    printUsage();
    return;
  }
  
  const url = getStringArg(args, 'url', 'ws://localhost:4001');
  const matchCount = getNumberArg(args, 'matches', 50);
  const minPlaySec = getNumberArg(args, 'min-play', 30);
  const maxPlaySec = getNumberArg(args, 'max-play', 120);
  const minDelaySec = getNumberArg(args, 'min-delay', 0.5);
  const maxDelaySec = getNumberArg(args, 'max-delay', 3);
  const cleanupOnly = !!args.cleanup;
  const noCleanup = !!args['no-cleanup'];
  const dbPath = getStringArg(args, 'db', getDefaultDbPath());
  
  // If cleanup only, just run cleanup and exit
  if (cleanupOnly) {
    cleanupTestData(dbPath);
    return;
  }
  
  log(`Starting load test: ${matchCount} matches, URL: ${url}`);
  log(`Play duration: ${minPlaySec}-${maxPlaySec}s, Delay: ${minDelaySec}-${maxDelaySec}s`);
  
  const activeMatches: MatchGroup[] = [];
  let completedMatches = 0;
  
  // Main loop: create matches with random delays
  for (let i = 0; i < matchCount; i++) {
    // Random delay before starting this match
    const delaySec = randomBetween(minDelaySec, maxDelaySec);
    await sleep(delaySec * 1000);
    
    // Random number of players (2-4)
    const playersCount = Math.floor(randomBetween(2, 5)); // 2, 3, or 4
    
    // Random play duration
    const playDurationSec = randomBetween(minPlaySec, maxPlaySec);
    
    try {
      const matchGroup = await createMatch(i + 1, url, playersCount, playDurationSec);
      activeMatches.push(matchGroup);
    } catch (err) {
      log(`Match ${i + 1}: Failed to create - ${(err as Error).message}`);
    }
    
    // Check if any matches should be disconnected
    const now = Date.now();
    for (let j = activeMatches.length - 1; j >= 0; j--) {
      const match = activeMatches[j];
      if (now - match.startedAt >= match.playDuration) {
        disconnectMatch(match);
        activeMatches.splice(j, 1);
        completedMatches++;
      }
    }
    
    log(`Progress: ${i + 1}/${matchCount} created, ${activeMatches.length} active, ${completedMatches} completed`);
  }
  
  log('All matches created, waiting for remaining matches to complete...');
  
  // Wait for remaining matches to complete
  while (activeMatches.length > 0) {
    await sleep(1000);
    const now = Date.now();
    for (let j = activeMatches.length - 1; j >= 0; j--) {
      const match = activeMatches[j];
      if (now - match.startedAt >= match.playDuration) {
        disconnectMatch(match);
        activeMatches.splice(j, 1);
        completedMatches++;
      }
    }
    if (activeMatches.length > 0) {
      log(`Waiting: ${activeMatches.length} matches still active`);
    }
  }
  
  log(`Load test complete: ${completedMatches} matches completed`);
  
  // Cleanup unless --no-cleanup
  if (!noCleanup) {
    log('Waiting 5 seconds before cleanup...');
    await sleep(5000);
    cleanupTestData(dbPath);
  } else {
    log('Skipping cleanup (--no-cleanup flag)');
  }
}

main().catch((err) => {
  console.error('[loadtest] Fatal error:', err);
  process.exit(1);
});
