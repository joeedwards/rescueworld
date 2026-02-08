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
  shelter_color: string | null;
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
      created_at INTEGER NOT NULL,
      shelter_color TEXT
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
    CREATE TABLE IF NOT EXISTS player_stats (
      user_id TEXT PRIMARY KEY,
      total_wins INTEGER NOT NULL DEFAULT 0,
      total_rt_earned INTEGER NOT NULL DEFAULT 0,
      daily_wins INTEGER NOT NULL DEFAULT 0,
      last_win_date TEXT,
      daily_rt_earned INTEGER NOT NULL DEFAULT 0,
      last_played_date TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );
    CREATE TABLE IF NOT EXISTS inventory (
      user_id TEXT PRIMARY KEY,
      stored_rt INTEGER NOT NULL DEFAULT 0,
      port_charges INTEGER NOT NULL DEFAULT 0,
      shelter_port_charges INTEGER NOT NULL DEFAULT 0,
      speed_boosts INTEGER NOT NULL DEFAULT 0,
      size_boosts INTEGER NOT NULL DEFAULT 0,
      shelter_tier3_boosts INTEGER NOT NULL DEFAULT 0,
      adopt_speed_boosts INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );
    CREATE TABLE IF NOT EXISTS daily_leaderboard_rewards (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      reward_date TEXT NOT NULL,
      rank INTEGER NOT NULL,
      claimed_at INTEGER,
      UNIQUE(user_id, reward_date)
    );
  `);
  
  // Migration: add shelter_color column if missing
  try {
    sqlite.exec(`ALTER TABLE users ADD COLUMN shelter_color TEXT`);
  } catch {
    // Column already exists, ignore
  }
  
  // Migration: add shelter_port_charges column to inventory if missing
  try {
    sqlite.exec(`ALTER TABLE inventory ADD COLUMN shelter_port_charges INTEGER NOT NULL DEFAULT 0`);
  } catch {
    // Column already exists, ignore
  }

  // Migration: add shelter_tier3_boosts column to inventory if missing
  try {
    sqlite.exec(`ALTER TABLE inventory ADD COLUMN shelter_tier3_boosts INTEGER NOT NULL DEFAULT 0`);
  } catch {
    // Column already exists, ignore
  }

  // Migration: add adopt_speed_boosts column to inventory if missing
  try {
    sqlite.exec(`ALTER TABLE inventory ADD COLUMN adopt_speed_boosts INTEGER NOT NULL DEFAULT 0`);
  } catch {
    // Column already exists, ignore
  }
  
  // Migration: add daily_rt_earned column to player_stats if missing
  try {
    sqlite.exec(`ALTER TABLE player_stats ADD COLUMN daily_rt_earned INTEGER NOT NULL DEFAULT 0`);
  } catch {
    // Column already exists, ignore
  }
  
  // Migration: add last_played_date column to player_stats if missing
  try {
    sqlite.exec(`ALTER TABLE player_stats ADD COLUMN last_played_date TEXT`);
  } catch {
    // Column already exists, ignore
  }

  // Migration: adoption score columns
  for (const col of ['adoption_score_daily', 'adoption_score_weekly', 'adoption_score_season', 'adoption_score_alltime']) {
    try {
      sqlite.exec(`ALTER TABLE player_stats ADD COLUMN ${col} INTEGER NOT NULL DEFAULT 0`);
    } catch {
      // Column already exists, ignore
    }
  }
  try {
    sqlite.exec(`ALTER TABLE player_stats ADD COLUMN diversity_pets_today TEXT`);
  } catch {
    // Column already exists, ignore
  }
  try {
    sqlite.exec(`ALTER TABLE player_stats ADD COLUMN perfect_days_streak INTEGER NOT NULL DEFAULT 0`);
  } catch {
    // Column already exists, ignore
  }
  try {
    sqlite.exec(`ALTER TABLE player_stats ADD COLUMN last_adoption_date TEXT`);
  } catch {
    // Column already exists, ignore
  }

  // Migration: weekly/season leaderboard columns
  try {
    sqlite.exec(`ALTER TABLE player_stats ADD COLUMN weekly_score INTEGER NOT NULL DEFAULT 0`);
  } catch {
    // Column already exists, ignore
  }
  try {
    sqlite.exec(`ALTER TABLE player_stats ADD COLUMN season_score INTEGER NOT NULL DEFAULT 0`);
  } catch {
    // Column already exists, ignore
  }
  try {
    sqlite.exec(`ALTER TABLE player_stats ADD COLUMN current_week TEXT`);
  } catch {
    // Column already exists, ignore
  }
  try {
    sqlite.exec(`ALTER TABLE player_stats ADD COLUMN current_season TEXT`);
  } catch {
    // Column already exists, ignore
  }

  // Migration: games played and losses for leaderboard combo score
  try {
    sqlite.exec(`ALTER TABLE player_stats ADD COLUMN total_games_played INTEGER NOT NULL DEFAULT 0`);
  } catch {
    // Column already exists, ignore
  }
  try {
    sqlite.exec(`ALTER TABLE player_stats ADD COLUMN total_losses INTEGER NOT NULL DEFAULT 0`);
  } catch {
    // Column already exists, ignore
  }

  // Migration: Formula B reputation [0-100], default 50
  try {
    sqlite.exec(`ALTER TABLE player_stats ADD COLUMN reputation INTEGER NOT NULL DEFAULT 50`);
  } catch {
    // Column already exists, ignore
  }

  // Migration: Karma Points for cross-game currency (Shelter Sim integration)
  try {
    sqlite.exec(`ALTER TABLE player_stats ADD COLUMN karma_points INTEGER NOT NULL DEFAULT 0`);
  } catch {
    // Column already exists, ignore
  }

  // Karma transactions table for audit trail (cross-game integration)
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS karma_transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      amount INTEGER NOT NULL,
      reason TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'rescueworld',
      created_at INTEGER NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );
    CREATE INDEX IF NOT EXISTS karma_transactions_user_id_idx ON karma_transactions(user_id);
    CREATE INDEX IF NOT EXISTS karma_transactions_created_at_idx ON karma_transactions(created_at DESC);
  `);

  // Saved matches for solo persistence (resume later)
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS saved_matches (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      mode TEXT NOT NULL,
      world_state TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );
  `);

  // Match history for past games (leaderboard / profile)
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS match_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      match_id TEXT NOT NULL,
      mode TEXT NOT NULL,
      result TEXT NOT NULL,
      rt_earned INTEGER NOT NULL DEFAULT 0,
      adoptions INTEGER NOT NULL DEFAULT 0,
      duration_seconds INTEGER NOT NULL DEFAULT 0,
      played_at INTEGER NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );
    CREATE INDEX IF NOT EXISTS match_history_user_id_idx ON match_history(user_id);
    CREATE INDEX IF NOT EXISTS match_history_played_at_idx ON match_history(played_at DESC);
  `);
  
  // FFA/Teams match persistence (matches continue even without players)
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS saved_ffa_matches (
      match_id TEXT PRIMARY KEY,
      mode TEXT NOT NULL,
      world_state TEXT NOT NULL,
      player_user_ids TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);

  // Player relationships (friend/foe) table
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS player_relationships (
      user_id TEXT NOT NULL,
      target_user_id TEXT NOT NULL,
      relationship TEXT NOT NULL CHECK(relationship IN ('friend', 'foe')),
      created_at INTEGER NOT NULL,
      PRIMARY KEY (user_id, target_user_id)
    );
    CREATE INDEX IF NOT EXISTS idx_rel_target ON player_relationships(target_user_id);
  `);

  // Game counts table for tracking all games (including guests) - mode-agnostic totals
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS game_counts (
      mode TEXT PRIMARY KEY,
      total_games INTEGER NOT NULL DEFAULT 0
    );
  `);
  // Initialize counters if not present
  sqlite.prepare(`INSERT OR IGNORE INTO game_counts (mode, total_games) VALUES ('solo', 0)`).run();
  sqlite.prepare(`INSERT OR IGNORE INTO game_counts (mode, total_games) VALUES ('ffa', 0)`).run();
  sqlite.prepare(`INSERT OR IGNORE INTO game_counts (mode, total_games) VALUES ('teams', 0)`).run();
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
    shelter_color: null,
  };
  conn.prepare(
    'INSERT INTO users (id, provider, provider_id, email, display_name, referral_code, created_at, shelter_color) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(
    user.id,
    user.provider,
    user.provider_id,
    user.email,
    user.display_name,
    user.referral_code,
    user.created_at,
    user.shelter_color,
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

/** Update a user's nickname (display name) */
export function updateUserNickname(userId: string, nickname: string): boolean {
  const trimmed = nickname.trim().slice(0, 20); // Max 20 chars
  if (trimmed.length < 1) return false;
  
  const result = db().prepare(
    'UPDATE users SET display_name = ? WHERE id = ?'
  ).run(trimmed, userId);
  return result.changes > 0;
}

/** Update a user's shelter color */
export function updateUserShelterColor(userId: string, color: string): boolean {
  const result = db().prepare(
    'UPDATE users SET shelter_color = ? WHERE id = ?'
  ).run(color, userId);
  return result.changes > 0;
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

// --- Saved matches (solo persistence) ---

export interface SavedMatchRow {
  id: string;
  user_id: string;
  mode: string;
  world_state: string;
  created_at: number;
  updated_at: number;
}

export function saveSavedMatch(userId: string, mode: string, worldState: string, matchId: string): void {
  const now = Date.now();
  const conn = db();
  const existing = conn.prepare('SELECT created_at FROM saved_matches WHERE user_id = ?').get(userId) as { created_at: number } | undefined;
  const created_at = existing?.created_at ?? now;
  conn.prepare('DELETE FROM saved_matches WHERE user_id = ?').run(userId);
  conn.prepare(
    'INSERT INTO saved_matches (id, user_id, mode, world_state, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(matchId, userId, mode, worldState, created_at, now);
}

export function getSavedMatch(userId: string): SavedMatchRow | null {
  const row = db().prepare(
    'SELECT id, user_id, mode, world_state, created_at, updated_at FROM saved_matches WHERE user_id = ?',
  ).get(userId) as SavedMatchRow | undefined;
  return row ?? null;
}

export function deleteSavedMatch(userId: string): void {
  db().prepare('DELETE FROM saved_matches WHERE user_id = ?').run(userId);
}

// --- FFA/Teams match persistence ---

export interface SavedFfaMatchRow {
  match_id: string;
  mode: string;
  world_state: string;
  player_user_ids: string; // JSON array of { playerId, userId }
  created_at: number;
  updated_at: number;
}

/** Save an FFA/Teams match state (called on graceful shutdown and periodically) */
export function saveFfaMatch(
  matchId: string,
  mode: string,
  worldState: string,
  playerUserIds: Array<{ playerId: string; userId: string }>
): void {
  const now = Date.now();
  const conn = db();
  const existing = conn.prepare('SELECT created_at FROM saved_ffa_matches WHERE match_id = ?').get(matchId) as { created_at: number } | undefined;
  const created_at = existing?.created_at ?? now;
  conn.prepare('DELETE FROM saved_ffa_matches WHERE match_id = ?').run(matchId);
  conn.prepare(
    'INSERT INTO saved_ffa_matches (match_id, mode, world_state, player_user_ids, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(matchId, mode, worldState, JSON.stringify(playerUserIds), created_at, now);
}

/** Get all saved FFA/Teams matches (for server restart restore) */
export function getAllSavedFfaMatches(): SavedFfaMatchRow[] {
  return db().prepare(
    'SELECT match_id, mode, world_state, player_user_ids, created_at, updated_at FROM saved_ffa_matches'
  ).all() as SavedFfaMatchRow[];
}

/** Delete a saved FFA/Teams match (when it ends) */
export function deleteSavedFfaMatch(matchId: string): void {
  db().prepare('DELETE FROM saved_ffa_matches WHERE match_id = ?').run(matchId);
}

/** Purge all bot matches from the DB (empty player_user_ids = bot-only match).
 *  Returns the number of rows deleted and the match IDs that were purged. */
export function purgeSavedBotMatches(): { deleted: number; matchIds: string[] } {
  const conn = db();
  // Find bot matches: player_user_ids is '[]' (empty JSON array)
  const rows = conn.prepare(
    "SELECT match_id, mode FROM saved_ffa_matches WHERE player_user_ids = '[]'"
  ).all() as Array<{ match_id: string; mode: string }>;
  const matchIds = rows.map(r => r.match_id);
  if (matchIds.length > 0) {
    const result = conn.prepare(
      "DELETE FROM saved_ffa_matches WHERE player_user_ids = '[]'"
    ).run();
    return { deleted: result.changes, matchIds };
  }
  return { deleted: 0, matchIds: [] };
}

// --- Match history ---

export type MatchHistoryResult = 'win' | 'loss' | 'stray_loss' | 'quit';

export interface MatchHistoryRow {
  id: number;
  user_id: string;
  match_id: string;
  mode: string;
  result: MatchHistoryResult;
  rt_earned: number;
  adoptions: number;
  duration_seconds: number;
  played_at: number;
}

export function insertMatchHistory(
  userId: string,
  matchId: string,
  mode: string,
  result: MatchHistoryResult,
  rtEarned: number,
  adoptions: number,
  durationSeconds: number,
): void {
  const now = Date.now();
  db().prepare(
    `INSERT INTO match_history (user_id, match_id, mode, result, rt_earned, adoptions, duration_seconds, played_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(userId, matchId, mode, result, rtEarned, adoptions, durationSeconds, now);
}

export function getMatchHistory(userId: string, limit: number = 50): MatchHistoryRow[] {
  const rows = db().prepare(
    `SELECT id, user_id, match_id, mode, result, rt_earned, adoptions, duration_seconds, played_at
     FROM match_history WHERE user_id = ? ORDER BY played_at DESC LIMIT ?`,
  ).all(userId, limit) as MatchHistoryRow[];
  return rows;
}

/**
 * Increment the total games counter for a mode (called for ALL games including guests)
 */
export function incrementGameCount(mode: 'solo' | 'ffa' | 'teams'): void {
  db().prepare(
    `UPDATE game_counts SET total_games = total_games + 1 WHERE mode = ?`,
  ).run(mode);
}

/**
 * Get total game counts by mode (includes all games, not just authenticated users)
 */
export function getGameCounts(): { solo: number; ffa: number; teams: number } {
  const rows = db().prepare(
    `SELECT mode, total_games FROM game_counts`,
  ).all() as Array<{ mode: string; total_games: number }>;
  
  const result = { solo: 0, ffa: 0, teams: 0 };
  for (const row of rows) {
    if (row.mode === 'solo') result.solo = row.total_games;
    else if (row.mode === 'ffa') result.ffa = row.total_games;
    else if (row.mode === 'teams') result.teams = row.total_games;
  }
  return result;
}

// --- Player Relationships (friend/foe) ---

export type RelationshipType = 'friend' | 'foe';

export interface RelationshipRow {
  user_id: string;
  target_user_id: string;
  relationship: RelationshipType;
  created_at: number;
}

/** Get all relationships for a user, joined with target display names. */
export function getRelationships(userId: string): Array<{ targetUserId: string; displayName: string; relationship: RelationshipType }> {
  const rows = db().prepare(
    `SELECT pr.target_user_id, u.display_name, pr.relationship
     FROM player_relationships pr
     LEFT JOIN users u ON u.id = pr.target_user_id
     WHERE pr.user_id = ?`,
  ).all(userId) as Array<{ target_user_id: string; display_name: string | null; relationship: RelationshipType }>;
  return rows.map(r => ({
    targetUserId: r.target_user_id,
    displayName: r.display_name ?? 'Unknown',
    relationship: r.relationship,
  }));
}

/** Set (upsert) a relationship. */
export function setRelationship(userId: string, targetUserId: string, relationship: RelationshipType): void {
  if (userId === targetUserId) return; // Can't mark yourself
  db().prepare(
    `INSERT INTO player_relationships (user_id, target_user_id, relationship, created_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(user_id, target_user_id) DO UPDATE SET relationship = excluded.relationship`,
  ).run(userId, targetUserId, relationship, Date.now());
}

/** Remove a relationship. */
export function removeRelationship(userId: string, targetUserId: string): void {
  db().prepare(
    `DELETE FROM player_relationships WHERE user_id = ? AND target_user_id = ?`,
  ).run(userId, targetUserId);
}

/** Get all userIds who have marked this user as a friend (for online notifications). */
export function getFriendsOf(targetUserId: string): string[] {
  const rows = db().prepare(
    `SELECT user_id FROM player_relationships WHERE target_user_id = ? AND relationship = 'friend'`,
  ).all(targetUserId) as Array<{ user_id: string }>;
  return rows.map(r => r.user_id);
}
