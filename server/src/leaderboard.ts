/**
 * Leaderboard module - tracks match wins, all-time stats, and daily leaderboard rewards
 */

import { ensureReferralStorage } from './referrals.js';

// Timestamp helper for logging
function log(...args: unknown[]): void {
  const ts = new Date().toISOString();
  console.log(`[${ts}]`, ...args);
}

type DbModule = typeof import('better-sqlite3');
let sqlite: import('better-sqlite3').Database | null = null;

function db(): import('better-sqlite3').Database {
  if (!sqlite) {
    ensureReferralStorage(); // This initializes SQLite with all tables
    const Database = require('better-sqlite3') as DbModule;
    const SQLITE_DB_PATH = process.env.SQLITE_DB_PATH || require('path').join(__dirname, '..', 'rescueworld.db');
    sqlite = new (Database as unknown as new (path: string) => import('better-sqlite3').Database)(SQLITE_DB_PATH);
  }
  return sqlite!;
}

export type PlayerStats = {
  userId: string;
  displayName: string;
  totalWins: number;
  totalRtEarned: number;
  dailyWins: number;
  lastWinDate: string | null;
};

export type LeaderboardEntry = {
  rank: number;
  userId: string;
  displayName: string;
  wins: number;
  rtEarned: number;
  shelterColor: string | null;
};

/**
 * Record a match win for a user
 */
export function recordMatchWin(userId: string, rtEarned: number): void {
  const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
  const conn = db();
  
  // Check if user has stats row
  const existing = conn.prepare('SELECT * FROM player_stats WHERE user_id = ?').get(userId) as {
    user_id: string;
    total_wins: number;
    total_rt_earned: number;
    daily_wins: number;
    last_win_date: string | null;
  } | undefined;
  
  if (existing) {
    // Reset daily wins if it's a new day
    const newDailyWins = existing.last_win_date === today ? existing.daily_wins + 1 : 1;
    
    conn.prepare(`
      UPDATE player_stats 
      SET total_wins = total_wins + 1, 
          total_rt_earned = total_rt_earned + ?, 
          daily_wins = ?,
          last_win_date = ?
      WHERE user_id = ?
    `).run(rtEarned, newDailyWins, today, userId);
  } else {
    conn.prepare(`
      INSERT INTO player_stats (user_id, total_wins, total_rt_earned, daily_wins, last_win_date)
      VALUES (?, 1, ?, 1, ?)
    `).run(userId, rtEarned, today);
  }
  
  log(`Recorded win for user ${userId}: +${rtEarned} RT`);
}

/**
 * Record RT earned (even without winning)
 */
export function recordRtEarned(userId: string, rtEarned: number): void {
  const conn = db();
  
  const existing = conn.prepare('SELECT user_id FROM player_stats WHERE user_id = ?').get(userId);
  
  if (existing) {
    conn.prepare(`
      UPDATE player_stats 
      SET total_rt_earned = total_rt_earned + ?
      WHERE user_id = ?
    `).run(rtEarned, userId);
  } else {
    conn.prepare(`
      INSERT INTO player_stats (user_id, total_wins, total_rt_earned, daily_wins, last_win_date)
      VALUES (?, 0, ?, 0, NULL)
    `).run(userId, rtEarned);
  }
}

/**
 * Get leaderboard (all-time or daily)
 */
export function getLeaderboard(type: 'alltime' | 'daily', limit: number = 10): LeaderboardEntry[] {
  const conn = db();
  const today = new Date().toISOString().split('T')[0];
  
  let query: string;
  if (type === 'daily') {
    query = `
      SELECT ps.user_id, u.display_name, u.shelter_color, ps.daily_wins as wins, ps.total_rt_earned as rt_earned
      FROM player_stats ps
      JOIN users u ON ps.user_id = u.id
      WHERE ps.last_win_date = ?
      ORDER BY ps.daily_wins DESC, ps.total_rt_earned DESC
      LIMIT ?
    `;
  } else {
    query = `
      SELECT ps.user_id, u.display_name, u.shelter_color, ps.total_wins as wins, ps.total_rt_earned as rt_earned
      FROM player_stats ps
      JOIN users u ON ps.user_id = u.id
      ORDER BY ps.total_wins DESC, ps.total_rt_earned DESC
      LIMIT ?
    `;
  }
  
  const rows = type === 'daily' 
    ? conn.prepare(query).all(today, limit) as Array<{ user_id: string; display_name: string; shelter_color: string | null; wins: number; rt_earned: number }>
    : conn.prepare(query).all(limit) as Array<{ user_id: string; display_name: string; shelter_color: string | null; wins: number; rt_earned: number }>;
  
  return rows.map((row, index) => ({
    rank: index + 1,
    userId: row.user_id,
    displayName: row.display_name,
    wins: row.wins,
    rtEarned: row.rt_earned,
    shelterColor: row.shelter_color,
  }));
}

/**
 * Get a user's rank on the leaderboard
 */
export function getUserRank(userId: string, type: 'alltime' | 'daily'): { rank: number; stats: PlayerStats | null } {
  const conn = db();
  const today = new Date().toISOString().split('T')[0];
  
  // Get user stats
  const userRow = conn.prepare(`
    SELECT ps.*, u.display_name
    FROM player_stats ps
    JOIN users u ON ps.user_id = u.id
    WHERE ps.user_id = ?
  `).get(userId) as {
    user_id: string;
    display_name: string;
    total_wins: number;
    total_rt_earned: number;
    daily_wins: number;
    last_win_date: string | null;
  } | undefined;
  
  if (!userRow) {
    return { rank: 0, stats: null };
  }
  
  const stats: PlayerStats = {
    userId: userRow.user_id,
    displayName: userRow.display_name,
    totalWins: userRow.total_wins,
    totalRtEarned: userRow.total_rt_earned,
    dailyWins: userRow.last_win_date === today ? userRow.daily_wins : 0,
    lastWinDate: userRow.last_win_date,
  };
  
  // Count users with more wins
  let rank: number;
  if (type === 'daily') {
    const countRow = conn.prepare(`
      SELECT COUNT(*) as cnt FROM player_stats
      WHERE last_win_date = ? AND (daily_wins > ? OR (daily_wins = ? AND total_rt_earned > ?))
    `).get(today, stats.dailyWins, stats.dailyWins, stats.totalRtEarned) as { cnt: number };
    rank = countRow.cnt + 1;
  } else {
    const countRow = conn.prepare(`
      SELECT COUNT(*) as cnt FROM player_stats
      WHERE total_wins > ? OR (total_wins = ? AND total_rt_earned > ?)
    `).get(stats.totalWins, stats.totalWins, stats.totalRtEarned) as { cnt: number };
    rank = countRow.cnt + 1;
  }
  
  return { rank, stats };
}

/**
 * Check and grant daily leaderboard rewards (call at end of day or on demand)
 * Top 10 daily winners get a gift chest
 */
export function grantDailyRewards(): Array<{ userId: string; rank: number; reward: string }> {
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  const conn = db();
  
  // Get yesterday's top 10
  const topPlayers = conn.prepare(`
    SELECT ps.user_id, ps.daily_wins
    FROM player_stats ps
    WHERE ps.last_win_date = ?
    ORDER BY ps.daily_wins DESC, ps.total_rt_earned DESC
    LIMIT 10
  `).all(yesterday) as Array<{ user_id: string; daily_wins: number }>;
  
  const rewards: Array<{ userId: string; rank: number; reward: string }> = [];
  
  for (let i = 0; i < topPlayers.length; i++) {
    const player = topPlayers[i];
    const rank = i + 1;
    
    // Check if already rewarded
    const existing = conn.prepare(`
      SELECT id FROM daily_leaderboard_rewards 
      WHERE user_id = ? AND reward_date = ?
    `).get(player.user_id, yesterday);
    
    if (!existing) {
      // Grant reward: Add to inventory (RT bonus based on rank)
      const rtBonus = rank === 1 ? 500 : rank <= 3 ? 300 : rank <= 5 ? 200 : 100;
      
      // Record the reward
      conn.prepare(`
        INSERT INTO daily_leaderboard_rewards (user_id, reward_date, rank, claimed_at)
        VALUES (?, ?, ?, ?)
      `).run(player.user_id, yesterday, rank, Date.now());
      
      // Add to inventory
      conn.prepare(`
        INSERT INTO inventory (user_id, stored_rt, port_charges, speed_boosts, size_boosts)
        VALUES (?, ?, 1, 1, 1)
        ON CONFLICT(user_id) DO UPDATE SET 
          stored_rt = stored_rt + ?,
          port_charges = port_charges + 1,
          speed_boosts = speed_boosts + 1,
          size_boosts = size_boosts + 1
      `).run(player.user_id, rtBonus, rtBonus);
      
      rewards.push({
        userId: player.user_id,
        rank,
        reward: `${rtBonus} RT + Gift Chest (port, speed, size boost)`,
      });
      
      log(`Granted daily reward to rank ${rank}: ${player.user_id} -> ${rtBonus} RT + boosts`);
    }
  }
  
  return rewards;
}

/**
 * Reset daily wins (call at midnight)
 */
export function resetDailyWins(): void {
  // We don't actually need to reset - the daily_wins counter resets when last_win_date changes
  // But we can grant rewards for the previous day
  grantDailyRewards();
  log('Daily leaderboard rewards processed');
}
