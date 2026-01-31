"use strict";
/**
 * Optional world registry (Redis): game servers register URL + player count.
 * Signaling reads from registry to pick best server. Replay: optional stream for durability.
 * Guest names: Redis INCR or SQLite fallback for unique rescueNNN.
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ensureStorage = ensureStorage;
exports.getStorageStatus = getStorageStatus;
exports.connectRegistry = connectRegistry;
exports.getRedis = getRedis;
exports.registerServer = registerServer;
exports.getGameServers = getGameServers;
exports.appendReplay = appendReplay;
exports.getNextGuestName = getNextGuestName;
const path_1 = __importDefault(require("path"));
const REDIS_URL = process.env.REDIS_URL || '';
const SQLITE_DB_PATH = process.env.SQLITE_DB_PATH || path_1.default.join(__dirname, '..', 'rescueworld.db');
const REGISTRY_KEY = 'rescueworld:servers';
const REGISTRY_TTL = 30;
const REPLAY_STREAM_KEY = 'rescueworld:replay';
const GUEST_COUNTER_KEY = 'rescueworld:guest_counter';
let redis = null;
let sqlite = null;
/** Unique per-process suffix so SQLite-backed names never collide across instances (no shared Redis). */
const INSTANCE_SUFFIX = `i${Math.random().toString(36).slice(2, 10)}`;
async function tryConnectRedis() {
    if (!REDIS_URL)
        return false;
    try {
        const { default: Redis } = await Promise.resolve().then(() => __importStar(require('ioredis')));
        redis = new Redis(REDIS_URL, { maxRetriesPerRequest: 2 });
        redis.on('error', () => { });
        await redis.ping();
        return true;
    }
    catch {
        redis = null;
        return false;
    }
}
function initSqlite() {
    try {
        const Database = require('better-sqlite3');
        sqlite = new Database(SQLITE_DB_PATH);
        sqlite.exec(`
      CREATE TABLE IF NOT EXISTS kv (
        key TEXT PRIMARY KEY,
        value INTEGER NOT NULL DEFAULT 0
      );
      INSERT OR IGNORE INTO kv (key, value) VALUES ('guest_counter', 0);
    `);
        return true;
    }
    catch {
        sqlite = null;
        return false;
    }
}
/**
 * Ensures storage is ready: tries Redis first; if unavailable, initializes SQLite for guest counter.
 * Returns status and logs one line. Call before starting servers.
 */
async function ensureStorage() {
    const redisOk = await tryConnectRedis();
    let sqliteOk = false;
    if (!redisOk) {
        sqliteOk = initSqlite();
        if (sqliteOk) {
            console.log('Redis unavailable; using SQLite for guest names.');
        }
        else {
            console.log('Redis unavailable; SQLite init failed. Guest names will use random fallback.');
        }
    }
    else {
        console.log('Redis connected.');
    }
    console.log(`[rescue] ensureStorage redis=${redisOk} sqlite=${sqliteOk} REDIS_URL=${REDIS_URL ? 'set' : 'unset'}`);
    return { redis: redisOk, sqlite: sqliteOk };
}
/** Returns current storage status for health checks. */
function getStorageStatus() {
    return {
        redis: redis != null,
        sqlite: sqlite != null,
    };
}
/** @deprecated Use ensureStorage() for startup. Kept for compatibility. */
async function connectRegistry() {
    return (await ensureStorage()).redis;
}
function getRedis() {
    return redis;
}
async function registerServer(serverId, url, playerCount) {
    if (!redis)
        return;
    try {
        const payload = JSON.stringify({ url, playerCount });
        await redis.hset(REGISTRY_KEY, serverId, payload);
        await redis.expire(REGISTRY_KEY, REGISTRY_TTL);
    }
    catch {
        // ignore
    }
}
async function getGameServers() {
    if (!redis)
        return [];
    try {
        const map = await redis.hgetall(REGISTRY_KEY);
        const list = [];
        for (const v of Object.values(map)) {
            try {
                const o = JSON.parse(v);
                if (o.url && typeof o.playerCount === 'number')
                    list.push(o);
            }
            catch {
                // skip
            }
        }
        return list.sort((a, b) => a.playerCount - b.playerCount);
    }
    catch {
        return [];
    }
}
async function appendReplay(serverId, tick, hash) {
    if (!redis)
        return;
    try {
        await redis.xadd(REPLAY_STREAM_KEY, '*', 'server', serverId, 'tick', String(tick), 'hash', hash);
    }
    catch {
        // ignore
    }
}
/** Atomic next guest id from SQLite (used when Redis is unavailable). */
function getNextGuestIdSqlite() {
    if (!sqlite)
        return 0;
    try {
        const next = sqlite.transaction(() => {
            const row = sqlite
                .prepare("SELECT value FROM kv WHERE key = 'guest_counter'")
                .get();
            const val = (row?.value ?? 0) + 1;
            sqlite.prepare("INSERT OR REPLACE INTO kv (key, value) VALUES ('guest_counter', ?)").run(val);
            return val;
        })();
        return next;
    }
    catch {
        return 0;
    }
}
/** Returns a unique guest display name. Redis: rescueNNN. SQLite (multi-instance): rescueNNN-INSTANCE. Else random. */
async function getNextGuestName() {
    if (redis) {
        try {
            const n = await redis.incr(GUEST_COUNTER_KEY);
            return `rescue${n}`;
        }
        catch {
            return `rescue${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
        }
    }
    if (sqlite) {
        const n = getNextGuestIdSqlite();
        if (n > 0)
            return `rescue${n}-${INSTANCE_SUFFIX}`;
    }
    return `rescue${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}
