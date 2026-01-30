/**
 * Optional world registry (Redis): game servers register URL + player count.
 * Signaling reads from registry to pick best server. Replay: optional stream for durability.
 */

const REDIS_URL = process.env.REDIS_URL || '';
const REGISTRY_KEY = 'rescueworld:servers';
const REGISTRY_TTL = 30;
const REPLAY_STREAM_KEY = 'rescueworld:replay';

let redis: import('ioredis').Redis | null = null;

export async function connectRegistry(): Promise<boolean> {
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
