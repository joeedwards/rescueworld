"use strict";
/**
 * Optional world registry (Redis): game servers register URL + player count.
 * Signaling reads from registry to pick best server. Replay: optional stream for durability.
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.connectRegistry = connectRegistry;
exports.getRedis = getRedis;
exports.registerServer = registerServer;
exports.getGameServers = getGameServers;
exports.appendReplay = appendReplay;
const REDIS_URL = process.env.REDIS_URL || '';
const REGISTRY_KEY = 'rescueworld:servers';
const REGISTRY_TTL = 30;
const REPLAY_STREAM_KEY = 'rescueworld:replay';
let redis = null;
async function connectRegistry() {
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
