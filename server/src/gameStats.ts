/**
 * Game Stats module - provides real-time and historical metrics for game analytics.
 * Used for backend/advertising and performance monitoring.
 */

import path from 'path';
import { ensureReferralStorage } from './referrals.js';

const SQLITE_DB_PATH = process.env.SQLITE_DB_PATH || path.join(__dirname, '..', 'rescueworld.db');

let sqlite: import('better-sqlite3').Database | null = null;

function initSqlite(): void {
  if (sqlite) return;
  const Database = require('better-sqlite3') as new (path: string) => import('better-sqlite3').Database;
  sqlite = new Database(SQLITE_DB_PATH);
}

function db(): import('better-sqlite3').Database {
  ensureReferralStorage(); // Ensure tables exist
  initSqlite();
  return sqlite!;
}

export interface RealtimeStats {
  onlinePlayers: number;
  ffaWaiting: number;
  playingSolo: number;
  playingFfa: number;
  playingTeams: number;
}

export interface HistoricalStats {
  totalGamesPlayed: number;
  gamesByMode: { solo: number; ffa: number; teams: number };
  mostPopularMode: 'solo' | 'ffa' | 'teams' | null;
  newUsersToday: number;
  newUsersLast7Days: Array<{ date: string; count: number }>;
  retention: {
    newUsersAvgGames: number;
    establishedUsersAvgGames: number;
  };
}

export interface GameStats {
  realtime: RealtimeStats;
  historical: HistoricalStats;
}

/**
 * Get games count grouped by mode from match_history table
 */
function getGamesByMode(): { solo: number; ffa: number; teams: number } {
  const conn = db();
  const rows = conn.prepare(`
    SELECT mode, COUNT(*) as count 
    FROM match_history 
    GROUP BY mode
  `).all() as Array<{ mode: string; count: number }>;

  const result = { solo: 0, ffa: 0, teams: 0 };
  for (const row of rows) {
    if (row.mode === 'solo') result.solo = row.count;
    else if (row.mode === 'ffa') result.ffa = row.count;
    else if (row.mode === 'teams') result.teams = row.count;
  }
  return result;
}

/**
 * Get total games played across all modes
 */
function getTotalGamesPlayed(): number {
  const conn = db();
  const row = conn.prepare('SELECT COUNT(*) as count FROM match_history').get() as { count: number };
  return row.count;
}

/**
 * Determine the most popular game mode
 */
function getMostPopularMode(gamesByMode: { solo: number; ffa: number; teams: number }): 'solo' | 'ffa' | 'teams' | null {
  const entries = Object.entries(gamesByMode) as Array<['solo' | 'ffa' | 'teams', number]>;
  if (entries.every(([, count]) => count === 0)) return null;
  
  entries.sort((a, b) => b[1] - a[1]);
  return entries[0][0];
}

/**
 * Get count of new users registered today (UTC)
 */
function getNewUsersToday(): number {
  const conn = db();
  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);
  const todayStartMs = todayStart.getTime();

  const row = conn.prepare(`
    SELECT COUNT(*) as count 
    FROM users 
    WHERE created_at >= ?
  `).get(todayStartMs) as { count: number };

  return row.count;
}

/**
 * Get new user registrations for each of the last 7 days
 */
function getNewUsersLast7Days(): Array<{ date: string; count: number }> {
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
  `).all(sevenDaysAgoMs) as Array<{ day: string; count: number }>;

  return rows.map(row => ({ date: row.day, count: row.count }));
}

/**
 * Get retention stats - compare average games played by new users (<7 days old)
 * vs established users (>= 7 days old)
 */
function getRetentionStats(): { newUsersAvgGames: number; establishedUsersAvgGames: number } {
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
  `).get(cutoffMs) as { avg_games: number | null };

  // Average games for established users (registered more than 7 days ago)
  const establishedRow = conn.prepare(`
    SELECT AVG(COALESCE(ps.total_games_played, 0)) as avg_games
    FROM users u
    LEFT JOIN player_stats ps ON u.id = ps.user_id
    WHERE u.created_at < ?
  `).get(cutoffMs) as { avg_games: number | null };

  return {
    newUsersAvgGames: Math.round((newRow.avg_games ?? 0) * 100) / 100,
    establishedUsersAvgGames: Math.round((establishedRow.avg_games ?? 0) * 100) / 100,
  };
}

/**
 * Get all historical stats from the database
 */
export function getHistoricalStats(): HistoricalStats {
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
export function getGameStats(getRealtimeStatsFn: () => RealtimeStats): GameStats {
  return {
    realtime: getRealtimeStatsFn(),
    historical: getHistoricalStats(),
  };
}
