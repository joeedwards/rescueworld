/**
 * Karma Service - Shared karma points system for cross-game integration (Rescue World / Shelter Sim)
 * 
 * Karma Points (KP) are awarded for match wins and can be used across connected games.
 * - 1 KP per match win in FFA/Teams modes
 * - No KP deducted for losses
 * - Shared via API for Shelter Sim integration
 */

import { ensureReferralStorage } from './referrals.js';

// Timestamp helper for logging
function log(...args: unknown[]): void {
  const ts = new Date().toISOString();
  console.log(`[${ts}] [Karma]`, ...args);
}

type DbModule = typeof import('better-sqlite3');
let sqlite: import('better-sqlite3').Database | null = null;

function db(): import('better-sqlite3').Database {
  if (!sqlite) {
    ensureReferralStorage(); // This initializes SQLite with all tables including karma_points column
    const Database = require('better-sqlite3') as DbModule;
    const SQLITE_DB_PATH = process.env.SQLITE_DB_PATH || require('path').join(__dirname, '..', 'rescueworld.db');
    sqlite = new (Database as unknown as new (path: string) => import('better-sqlite3').Database)(SQLITE_DB_PATH);
  }
  return sqlite!;
}

export type KarmaBalance = {
  userId: string;
  displayName: string;
  karmaPoints: number;
};

export type KarmaTransaction = {
  id: number;
  userId: string;
  amount: number;
  reason: string;
  source: string; // 'rescueworld' | 'sheltersim'
  createdAt: number;
};

/**
 * Get user's karma balance
 */
export function getKarmaBalance(userId: string): number {
  const row = db().prepare(`
    SELECT karma_points FROM player_stats WHERE user_id = ?
  `).get(userId) as { karma_points: number } | undefined;
  
  return row?.karma_points ?? 0;
}

/**
 * Get full karma info including display name
 */
export function getKarmaInfo(userId: string): KarmaBalance | null {
  const row = db().prepare(`
    SELECT ps.karma_points, u.display_name, u.id
    FROM player_stats ps
    JOIN users u ON ps.user_id = u.id
    WHERE ps.user_id = ?
  `).get(userId) as { karma_points: number; display_name: string; id: string } | undefined;
  
  if (!row) return null;
  
  return {
    userId: row.id,
    displayName: row.display_name,
    karmaPoints: row.karma_points,
  };
}

/**
 * Ensure player_stats row exists for user
 */
function ensurePlayerStats(userId: string): void {
  // Guest users don't have a row in the users table; skip to avoid FK violation
  if (userId.startsWith('guest-')) return;
  db().prepare(`
    INSERT OR IGNORE INTO player_stats (user_id, total_wins, total_rt_earned, daily_wins, karma_points)
    VALUES (?, 0, 0, 0, 0)
  `).run(userId);
}

/**
 * Award karma points to a user (always positive, never deducts)
 * @param userId User ID to award karma to
 * @param amount Amount of karma to award (must be positive)
 * @param reason Reason for the award (e.g., "Match win: abc123")
 * @param source Source game ('rescueworld' | 'sheltersim')
 * @returns New karma balance
 */
export function awardKarmaPoints(
  userId: string, 
  amount: number, 
  reason: string,
  source: string = 'rescueworld'
): number {
  // Guest users don't have a row in the users table; skip to avoid FK violation
  if (userId.startsWith('guest-')) return 0;
  if (amount <= 0) {
    log(`Attempted to award non-positive karma (${amount}) to ${userId} - ignored`);
    return getKarmaBalance(userId);
  }
  
  ensurePlayerStats(userId);
  
  const conn = db();
  
  // Update karma balance
  conn.prepare(`
    UPDATE player_stats 
    SET karma_points = karma_points + ? 
    WHERE user_id = ?
  `).run(amount, userId);
  
  // Log the transaction (optional audit trail)
  conn.prepare(`
    INSERT INTO karma_transactions (user_id, amount, reason, source, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(userId, amount, reason, source, Date.now());
  
  const newBalance = getKarmaBalance(userId);
  log(`Awarded ${amount} KP to ${userId} (${reason}). New balance: ${newBalance}`);
  
  return newBalance;
}

/**
 * Get karma transaction history for a user
 * @param userId User ID
 * @param limit Max number of transactions to return
 * @returns Array of karma transactions, most recent first
 */
export function getKarmaHistory(userId: string, limit: number = 20): KarmaTransaction[] {
  const rows = db().prepare(`
    SELECT id, user_id, amount, reason, source, created_at
    FROM karma_transactions
    WHERE user_id = ?
    ORDER BY created_at DESC
    LIMIT ?
  `).all(userId, limit) as Array<{
    id: number;
    user_id: string;
    amount: number;
    reason: string;
    source: string;
    created_at: number;
  }>;
  
  return rows.map(row => ({
    id: row.id,
    userId: row.user_id,
    amount: row.amount,
    reason: row.reason,
    source: row.source,
    createdAt: row.created_at,
  }));
}

/**
 * Initialize karma tables (called from ensureReferralStorage migrations)
 * This creates the karma_transactions table for audit trail
 */
export function ensureKarmaTables(): void {
  db().exec(`
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
}
