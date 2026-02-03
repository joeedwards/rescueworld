/**
 * Optional world registry (Redis): game servers register URL + player count.
 * Signaling reads from registry to pick best server. Replay: optional stream for durability.
 * Guest names: Redis INCR or SQLite fallback for unique rescueNNN.
 */

import path from 'path';

/** Timestamped log function for server output */
function log(message: string): void {
  const now = new Date();
  const timestamp = now.toISOString().replace('T', ' ').slice(0, 19);
  console.log(`[${timestamp}] [rescue] ${message}`);
}

const REDIS_URL = process.env.REDIS_URL || '';
const SQLITE_DB_PATH = process.env.SQLITE_DB_PATH || path.join(__dirname, '..', 'rescueworld.db');
const REGISTRY_KEY = 'rescueworld:servers';
const REGISTRY_TTL = 30;
const REPLAY_STREAM_KEY = 'rescueworld:replay';
const GUEST_COUNTER_KEY = 'rescueworld:guest_counter';

let redis: import('ioredis').Redis | null = null;
let sqlite: import('better-sqlite3').Database | null = null;

/** Unique per-process suffix so SQLite-backed names never collide across instances (no shared Redis). */
const INSTANCE_SUFFIX = `i${Math.random().toString(36).slice(2, 10)}`;

export type StorageStatus = { redis: boolean; sqlite: boolean };

async function tryConnectRedis(): Promise<boolean> {
  if (!REDIS_URL) return false;
  try {
    const { default: Redis } = await import('ioredis');
    redis = new Redis(REDIS_URL, { maxRetriesPerRequest: 2 });
    redis.on('error', () => {});
    await redis.ping();
    return true;
  } catch {
    redis = null;
    return false;
  }
}

function initSqlite(): boolean {
  try {
    const Database = require('better-sqlite3') as new (path: string) => import('better-sqlite3').Database;
    sqlite = new Database(SQLITE_DB_PATH);
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS kv (
        key TEXT PRIMARY KEY,
        value INTEGER NOT NULL DEFAULT 0
      );
      INSERT OR IGNORE INTO kv (key, value) VALUES ('guest_counter', 0);
    `);
    return true;
  } catch {
    sqlite = null;
    return false;
  }
}

/**
 * Ensures storage is ready: tries Redis first; if unavailable, initializes SQLite for guest counter.
 * Returns status and logs one line. Call before starting servers.
 */
export async function ensureStorage(): Promise<StorageStatus> {
  const redisOk = await tryConnectRedis();
  let sqliteOk = false;
  if (!redisOk) {
    sqliteOk = initSqlite();
    if (sqliteOk) {
      log('Redis unavailable; using SQLite for guest names.');
    } else {
      log('Redis unavailable; SQLite init failed. Guest names will use random fallback.');
    }
  } else {
    log('Redis connected.');
  }
  log(`ensureStorage redis=${redisOk} sqlite=${sqliteOk} REDIS_URL=${REDIS_URL ? 'set' : 'unset'}`);
  return { redis: redisOk, sqlite: sqliteOk };
}

/** Returns current storage status for health checks. */
export function getStorageStatus(): StorageStatus {
  return {
    redis: redis != null,
    sqlite: sqlite != null,
  };
}

/** @deprecated Use ensureStorage() for startup. Kept for compatibility. */
export async function connectRegistry(): Promise<boolean> {
  return (await ensureStorage()).redis;
}

export function getRedis(): import('ioredis').Redis | null {
  return redis;
}

export async function registerServer(serverId: string, url: string, playerCount: number): Promise<void> {
  if (!redis) return;
  try {
    const payload = JSON.stringify({ url, playerCount });
    await redis.hset(REGISTRY_KEY, serverId, payload);
    await redis.expire(REGISTRY_KEY, REGISTRY_TTL);
  } catch {
    // ignore
  }
}

export async function getGameServers(): Promise<{ url: string; playerCount: number }[]> {
  if (!redis) return [];
  try {
    const map = await redis.hgetall(REGISTRY_KEY);
    const list: { url: string; playerCount: number }[] = [];
    for (const v of Object.values(map)) {
      try {
        const o = JSON.parse(v);
        if (o.url && typeof o.playerCount === 'number') list.push(o);
      } catch {
        // skip
      }
    }
    return list.sort((a, b) => a.playerCount - b.playerCount);
  } catch {
    return [];
  }
}

export async function appendReplay(serverId: string, tick: number, hash: string): Promise<void> {
  if (!redis) return;
  try {
    await redis.xadd(REPLAY_STREAM_KEY, '*', 'server', serverId, 'tick', String(tick), 'hash', hash);
  } catch {
    // ignore
  }
}

/** Atomic next guest id from SQLite (used when Redis is unavailable). */
function getNextGuestIdSqlite(): number {
  if (!sqlite) return 0;
  try {
    const next = sqlite.transaction(() => {
      const row = sqlite!
        .prepare("SELECT value FROM kv WHERE key = 'guest_counter'")
        .get() as { value: number } | undefined;
      const val = (row?.value ?? 0) + 1;
      sqlite!.prepare("INSERT OR REPLACE INTO kv (key, value) VALUES ('guest_counter', ?)").run(val);
      return val;
    })();
    return next;
  } catch {
    return 0;
  }
}

/** Returns a unique guest display name. Redis: rescueNNN. SQLite (multi-instance): rescueNNN-INSTANCE. Else random. */
export async function getNextGuestName(): Promise<string> {
  if (redis) {
    try {
      const n = await redis.incr(GUEST_COUNTER_KEY);
      return `rescue${n}`;
    } catch {
      return `rescue${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    }
  }
  if (sqlite) {
    const n = getNextGuestIdSqlite();
    if (n > 0) return `rescue${n}-${INSTANCE_SUFFIX}`;
  }
  return `rescue${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}
