"use strict";
/**
 * Game Stats module - provides real-time and historical metrics for game analytics.
 * Used for backend/advertising and performance monitoring.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getHistoricalStats = getHistoricalStats;
exports.getGameStats = getGameStats;
const path_1 = __importDefault(require("path"));
const referrals_js_1 = require("./referrals.js");
const SQLITE_DB_PATH = process.env.SQLITE_DB_PATH || path_1.default.join(__dirname, '..', 'rescueworld.db');
let sqlite = null;
function initSqlite() {
    if (sqlite)
        return;
    const Database = require('better-sqlite3');
    sqlite = new Database(SQLITE_DB_PATH);
}
function db() {
    (0, referrals_js_1.ensureReferralStorage)(); // Ensure tables exist
    initSqlite();
    return sqlite;
}
/**
 * Get games count grouped by mode from game_counts table (includes all games, not just authenticated users)
 */
function getGamesByMode() {
    const conn = db();
    const rows = conn.prepare(`
    SELECT mode, total_games as count 
    FROM game_counts
  `).all();
    const result = { solo: 0, ffa: 0, teams: 0 };
    for (const row of rows) {
        if (row.mode === 'solo')
            result.solo = row.count;
        else if (row.mode === 'ffa')
            result.ffa = row.count;
        else if (row.mode === 'teams')
            result.teams = row.count;
    }
    return result;
}
/**
 * Get total games played across all modes (includes all games, not just authenticated users)
 */
function getTotalGamesPlayed() {
    const conn = db();
    const row = conn.prepare('SELECT SUM(total_games) as count FROM game_counts').get();
    return row.count ?? 0;
}
/**
 * Determine the most popular game mode
 */
function getMostPopularMode(gamesByMode) {
    const entries = Object.entries(gamesByMode);
    if (entries.every(([, count]) => count === 0))
        return null;
    entries.sort((a, b) => b[1] - a[1]);
    return entries[0][0];
}
/**
 * Get count of new users registered today (UTC)
 */
function getNewUsersToday() {
    const conn = db();
    const todayStart = new Date();
    todayStart.setUTCHours(0, 0, 0, 0);
    const todayStartMs = todayStart.getTime();
    const row = conn.prepare(`
    SELECT COUNT(*) as count 
    FROM users 
    WHERE created_at >= ?
  `).get(todayStartMs);
    return row.count;
}
/**
 * Get new user registrations for each of the last 7 days
 */
function getNewUsersLast7Days() {
    const conn = db();
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setUTCHours(0, 0, 0, 0);
    sevenDaysAgo.setUTCDate(sevenDaysAgo.getUTCDate() - 6); // Include today
    const sevenDaysAgoMs = sevenDaysAgo.getTime();
    const rows = conn.prepare(`
    SELECT DATE(created_at / 1000, 'unixepoch') as day, COUNT(*) as count 
    FROM users 
    WHERE created_at >= ?
    GROUP BY day 
    ORDER BY day DESC
  `).all(sevenDaysAgoMs);
    return rows.map(row => ({ date: row.day, count: row.count }));
}
/**
 * Get retention stats - compare average games played by new users (<7 days old)
 * vs established users (>= 7 days old)
 */
function getRetentionStats() {
    const conn = db();
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setUTCHours(0, 0, 0, 0);
    sevenDaysAgo.setUTCDate(sevenDaysAgo.getUTCDate() - 7);
    const cutoffMs = sevenDaysAgo.getTime();
    // Average games for new users (registered in last 7 days)
    const newRow = conn.prepare(`
    SELECT AVG(COALESCE(ps.total_games_played, 0)) as avg_games
    FROM users u
    LEFT JOIN player_stats ps ON u.id = ps.user_id
    WHERE u.created_at >= ?
  `).get(cutoffMs);
    // Average games for established users (registered more than 7 days ago)
    const establishedRow = conn.prepare(`
    SELECT AVG(COALESCE(ps.total_games_played, 0)) as avg_games
    FROM users u
    LEFT JOIN player_stats ps ON u.id = ps.user_id
    WHERE u.created_at < ?
  `).get(cutoffMs);
    return {
        newUsersAvgGames: Math.round((newRow.avg_games ?? 0) * 100) / 100,
        establishedUsersAvgGames: Math.round((establishedRow.avg_games ?? 0) * 100) / 100,
    };
}
/**
 * Get all historical stats from the database
 */
function getHistoricalStats() {
    const gamesByMode = getGamesByMode();
    return {
        totalGamesPlayed: getTotalGamesPlayed(),
        gamesByMode,
        mostPopularMode: getMostPopularMode(gamesByMode),
        newUsersToday: getNewUsersToday(),
        newUsersLast7Days: getNewUsersLast7Days(),
        retention: getRetentionStats(),
    };
}
/**
 * Get combined game stats (realtime + historical)
 * @param getRealtimeStatsFn - Function to get realtime stats from GameServer
 */
function getGameStats(getRealtimeStatsFn) {
    return {
        realtime: getRealtimeStatsFn(),
        historical: getHistoricalStats(),
    };
}
