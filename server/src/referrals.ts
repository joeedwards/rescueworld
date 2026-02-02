import path from 'path';
import { getRedis } from './registry.js';

type DbUser = {
  id: string;
  provider: string;
  provider_id: string;
  email: string;
  display_name: string;
  referral_code: string;
  created_at: number;
};

export type ReferralStats = {
  referralCode: string;
  referralCount: number;
  rewardEligible: boolean;
  rewardClaimed: boolean;
  rewardType: string;
  rewardThreshold: number;
  moneyBonus: number;
};

const SQLITE_DB_PATH = process.env.SQLITE_DB_PATH || path.join(__dirname, '..', 'rescueworld.db');
const REFERRAL_COUNT_KEY = (userId: string) => `referrals:count:${userId}`;
const REWARD_TYPE = 'special_skin';
const REWARD_THRESHOLD = 5;
const REWARD_MONEY_BONUS = 200;

let sqlite: import('better-sqlite3').Database | null = null;

function initSqlite(): void {
  if (sqlite) return;
  const Database = require('better-sqlite3') as new (path: string) => import('better-sqlite3').Database;
  sqlite = new Database(SQLITE_DB_PATH);
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      provider_id TEXT NOT NULL,
      email TEXT,
      display_name TEXT NOT NULL,
      referral_code TEXT NOT NULL UNIQUE,
      created_at INTEGER NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS users_provider_idx ON users(provider, provider_id);
    CREATE TABLE IF NOT EXISTS referrals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      referrer_user_id TEXT NOT NULL,
      referred_user_id TEXT NOT NULL UNIQUE,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS rewards (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      reward_type TEXT NOT NULL,
      granted_at INTEGER NOT NULL,
      claimed_at INTEGER,
      UNIQUE(user_id, reward_type)
    );
    CREATE TABLE IF NOT EXISTS daily_gifts (
      user_id TEXT PRIMARY KEY,
      last_claim_date TEXT NOT NULL,
      current_day INTEGER NOT NULL DEFAULT 1,
      total_claims INTEGER NOT NULL DEFAULT 0
    );
  `);
}

export function ensureReferralStorage(): void {
  initSqlite();
}

function db(): import('better-sqlite3').Database {
  initSqlite();
  return sqlite!;
}

function randomCode(): string {
  return Math.random().toString(36).slice(2, 10);
}

function generateUniqueCode(): string {
  const conn = db();
  for (let i = 0; i < 6; i++) {
    const code = randomCode();
    const row = conn.prepare('SELECT id FROM users WHERE referral_code = ?').get(code) as { id: string } | undefined;
    if (!row) return code;
  }
  return `${randomCode()}${Date.now().toString(36).slice(2, 4)}`;
}

export function getUserById(id: string): DbUser | null {
  const row = db().prepare('SELECT * FROM users WHERE id = ?').get(id) as DbUser | undefined;
  return row ?? null;
}

export function getUserByProvider(provider: string, providerId: string): DbUser | null {
  const row = db()
    .prepare('SELECT * FROM users WHERE provider = ? AND provider_id = ?')
    .get(provider, providerId) as DbUser | undefined;
  return row ?? null;
}

export function getUserByReferralCode(code: string): DbUser | null {
  const row = db().prepare('SELECT * FROM users WHERE referral_code = ?').get(code) as DbUser | undefined;
  return row ?? null;
}

export function createUser(provider: string, providerId: string, email: string, displayName: string): DbUser {
  const conn = db();
  const user: DbUser = {
    id: `u-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    provider,
    provider_id: providerId,
    email,
    display_name: displayName,
    referral_code: generateUniqueCode(),
    created_at: Date.now(),
  };
  conn.prepare(
    'INSERT INTO users (id, provider, provider_id, email, display_name, referral_code, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run(
    user.id,
    user.provider,
    user.provider_id,
    user.email,
    user.display_name,
    user.referral_code,
    user.created_at,
  );
  return user;
}

export function getOrCreateUser(
  provider: string,
  providerId: string,
  email: string,
  displayName: string,
): { user: DbUser; created: boolean } {
  const existing = getUserByProvider(provider, providerId);
  if (existing) return { user: existing, created: false };
  return { user: createUser(provider, providerId, email, displayName), created: true };
}

export async function recordReferral(referrerId: string, referredId: string): Promise<boolean> {
  if (referrerId === referredId) return false;
  try {
    db().prepare(
      'INSERT OR IGNORE INTO referrals (referrer_user_id, referred_user_id, created_at) VALUES (?, ?, ?)',
    ).run(referrerId, referredId, Date.now());
  } catch {
    return false;
  }

  const redis = getRedis();
  if (redis) {
    try {
      await redis.incr(REFERRAL_COUNT_KEY(referrerId));
    } catch {
      // ignore
    }
  }
  return true;
}

function getReferralCountSql(userId: string): number {
  const row = db()
    .prepare('SELECT COUNT(*) as cnt FROM referrals WHERE referrer_user_id = ?')
    .get(userId) as { cnt: number } | undefined;
  return row?.cnt ?? 0;
}

export async function getReferralCount(userId: string): Promise<number> {
  const redis = getRedis();
  if (redis) {
    try {
      const v = await redis.get(REFERRAL_COUNT_KEY(userId));
      if (v) return Number(v) || 0;
    } catch {
      // ignore
    }
  }
  const count = getReferralCountSql(userId);
  if (redis) {
    try {
      await redis.set(REFERRAL_COUNT_KEY(userId), String(count));
    } catch {
      // ignore
    }
  }
  return count;
}

function getRewardRow(userId: string): { claimed_at?: number } | null {
  const row = db()
    .prepare('SELECT claimed_at FROM rewards WHERE user_id = ? AND reward_type = ?')
    .get(userId, REWARD_TYPE) as { claimed_at?: number } | undefined;
  return row ?? null;
}

export async function getReferralStats(userId: string): Promise<ReferralStats> {
  const user = getUserById(userId);
  if (!user) {
    return {
      referralCode: '',
      referralCount: 0,
      rewardEligible: false,
      rewardClaimed: false,
      rewardType: REWARD_TYPE,
      rewardThreshold: REWARD_THRESHOLD,
      moneyBonus: REWARD_MONEY_BONUS,
    };
  }
  const count = await getReferralCount(userId);
  const rewardRow = getRewardRow(userId);
  const rewardClaimed = !!(rewardRow && rewardRow.claimed_at);
  return {
    referralCode: user.referral_code,
    referralCount: count,
    rewardEligible: count >= REWARD_THRESHOLD,
    rewardClaimed,
    rewardType: REWARD_TYPE,
    rewardThreshold: REWARD_THRESHOLD,
    moneyBonus: REWARD_MONEY_BONUS,
  };
}

export async function claimReward(userId: string): Promise<{ ok: boolean; reason?: string; moneyBonus?: number }> {
  const count = await getReferralCount(userId);
  if (count < REWARD_THRESHOLD) return { ok: false, reason: 'not_eligible' };
  const rewardRow = getRewardRow(userId);
  if (rewardRow && rewardRow.claimed_at) return { ok: false, reason: 'already_claimed' };

  const now = Date.now();
  db().prepare(
    'INSERT OR IGNORE INTO rewards (user_id, reward_type, granted_at, claimed_at) VALUES (?, ?, ?, ?)',
  ).run(userId, REWARD_TYPE, now, now);
  db().prepare(
    'UPDATE rewards SET claimed_at = ? WHERE user_id = ? AND reward_type = ?',
  ).run(now, userId, REWARD_TYPE);
  return { ok: true, moneyBonus: REWARD_MONEY_BONUS };
}
