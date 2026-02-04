"use strict";
/**
 * Karma Service - Shared karma points system for cross-game integration (Rescue World / Shelter Sim)
 *
 * Karma Points (KP) are awarded for match wins and can be used across connected games.
 * - 1 KP per match win in FFA/Teams modes
 * - No KP deducted for losses
 * - Shared via API for Shelter Sim integration
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.getKarmaBalance = getKarmaBalance;
exports.getKarmaInfo = getKarmaInfo;
exports.awardKarmaPoints = awardKarmaPoints;
exports.getKarmaHistory = getKarmaHistory;
exports.ensureKarmaTables = ensureKarmaTables;
const referrals_js_1 = require("./referrals.js");
// Timestamp helper for logging
function log(...args) {
    const ts = new Date().toISOString();
    console.log(`[${ts}] [Karma]`, ...args);
}
let sqlite = null;
function db() {
    if (!sqlite) {
        (0, referrals_js_1.ensureReferralStorage)(); // This initializes SQLite with all tables including karma_points column
        const Database = require('better-sqlite3');
        const SQLITE_DB_PATH = process.env.SQLITE_DB_PATH || require('path').join(__dirname, '..', 'rescueworld.db');
        sqlite = new Database(SQLITE_DB_PATH);
    }
    return sqlite;
}
/**
 * Get user's karma balance
 */
function getKarmaBalance(userId) {
    const row = db().prepare(`
    SELECT karma_points FROM player_stats WHERE user_id = ?
  `).get(userId);
    return row?.karma_points ?? 0;
}
/**
 * Get full karma info including display name
 */
function getKarmaInfo(userId) {
    const row = db().prepare(`
    SELECT ps.karma_points, u.display_name, u.id
    FROM player_stats ps
    JOIN users u ON ps.user_id = u.id
    WHERE ps.user_id = ?
  `).get(userId);
    if (!row)
        return null;
    return {
        userId: row.id,
        displayName: row.display_name,
        karmaPoints: row.karma_points,
    };
}
/**
 * Ensure player_stats row exists for user
 */
function ensurePlayerStats(userId) {
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
function awardKarmaPoints(userId, amount, reason, source = 'rescueworld') {
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
function getKarmaHistory(userId, limit = 20) {
    const rows = db().prepare(`
    SELECT id, user_id, amount, reason, source, created_at
    FROM karma_transactions
    WHERE user_id = ?
    ORDER BY created_at DESC
    LIMIT ?
  `).all(userId, limit);
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
function ensureKarmaTables() {
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
