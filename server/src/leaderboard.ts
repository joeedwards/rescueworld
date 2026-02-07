/**
 * Leaderboard module - tracks match wins, all-time stats, and daily leaderboard rewards
 */

import { ensureReferralStorage } from './referrals.js';
import { getSeasonLabel } from 'shared';

/** Subscriber interface for live leaderboard (e.g. WebSocket with send()). */
export type LeaderboardSubscriber = { send(data: string): void; readyState?: number };

const leaderboardSubscribers = new Set<LeaderboardSubscriber>();
const LIVE_BROADCAST_THROTTLE_MS = 2500;
let lastBroadcastTime = 0;
let broadcastScheduled: ReturnType<typeof setImmediate> | null = null;

export function subscribeToLeaderboard(ws: LeaderboardSubscriber): void {
  leaderboardSubscribers.add(ws);
  sendLeaderboardToSubscriber(ws);
}

export function unsubscribeFromLeaderboard(ws: LeaderboardSubscriber): void {
  leaderboardSubscribers.delete(ws);
}

function sendLeaderboardToSubscriber(ws: LeaderboardSubscriber): void {
  if (ws.readyState !== undefined && ws.readyState !== 1) return;
  try {
    const entries = getLeaderboard('daily', 10, 'score');
    ws.send(JSON.stringify({ type: 'leaderboardUpdate', entries }));
  } catch (err) {
    log('Leaderboard send error', err);
  }
}

/** Throttled broadcast to all lobby subscribers. Call after recordMatchWin/Loss/recordRtEarned. */
export function broadcastLeaderboardUpdate(): void {
  if (leaderboardSubscribers.size === 0) return;
  const now = Date.now();
  if (now - lastBroadcastTime < LIVE_BROADCAST_THROTTLE_MS) {
    if (!broadcastScheduled) {
      broadcastScheduled = setImmediate(() => {
        broadcastScheduled = null;
        lastBroadcastTime = Date.now();
        const entries = getLeaderboard('daily', 10, 'score');
        const payload = JSON.stringify({ type: 'leaderboardUpdate', entries });
        for (const ws of leaderboardSubscribers) {
          try {
            if (ws.readyState === 1) ws.send(payload);
          } catch {
            leaderboardSubscribers.delete(ws);
          }
        }
      });
    }
    return;
  }
  lastBroadcastTime = now;
  const entries = getLeaderboard('daily', 10, 'score');
  const payload = JSON.stringify({ type: 'leaderboardUpdate', entries });
  for (const ws of leaderboardSubscribers) {
    try {
      if ((ws.readyState ?? 1) === 1) ws.send(payload);
    } catch {
      leaderboardSubscribers.delete(ws);
    }
  }
}

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
  totalGamesPlayed?: number;
  totalLosses?: number;
  dailyWins: number;
  lastWinDate: string | null;
  dailyRtEarned?: number;
  lastPlayedDate?: string | null;
  adoptionScoreDaily?: number;
  adoptionScoreWeekly?: number;
  adoptionScoreSeason?: number;
  adoptionScoreAlltime?: number;
  weeklyScore?: number;
  seasonScore?: number;
  currentWeek?: string | null;
  currentSeason?: string | null;
};

export type LeaderboardEntry = {
  rank: number;
  userId: string;
  displayName: string;
  wins: number;
  rtEarned: number;
  gamesPlayed?: number;
  losses?: number;
  /** Adoption score used for ranking when available */
  adoptionScore?: number;
  shelterColor: string | null;
};

/** Today's date in UTC (YYYY-MM-DD). Game server uses UTC for all date boundaries. */
function getTodayUTC(): string {
  const d = new Date();
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** ISO week string in UTC e.g. 2026-W05 */
function getCurrentWeekUTC(): string {
  const d = new Date();
  const thursday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 4 - (d.getUTCDay() || 7)));
  const yearStart = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((thursday.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return `${thursday.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

/** Season string in UTC e.g. "2026-Winter" (uses Northern Hemisphere seasons). */
function getCurrentSeasonUTC(): string {
  return getSeasonLabel();
}

const REPUTATION_MIN = 0;
const REPUTATION_MAX = 100;
const REPUTATION_DEFAULT = 50;

function clampReputation(value: number): number {
  return Math.max(REPUTATION_MIN, Math.min(REPUTATION_MAX, Math.round(value)));
}

/**
 * Formula B: on adoption, Reputation += 2*(Q - 1). Ideal matches raise it, poor lower it.
 * Returns new reputation after update.
 */
export function updateReputationOnAdoption(userId: string, qualityMultiplier: number): number {
  const conn = db();
  const row = conn.prepare('SELECT reputation FROM player_stats WHERE user_id = ?').get(userId) as { reputation: number } | undefined;
  const current = row ? clampReputation(row.reputation) : REPUTATION_DEFAULT;
  const delta = 2 * (qualityMultiplier - 1);
  const next = clampReputation(current + delta);
  if (row) {
    conn.prepare('UPDATE player_stats SET reputation = ? WHERE user_id = ?').run(next, userId);
  } else {
    conn.prepare(
      'INSERT INTO player_stats (user_id, total_wins, total_rt_earned, total_games_played, total_losses, reputation) VALUES (?, 0, 0, 0, 0, ?)'
    ).run(userId, next);
  }
  return next;
}

/**
 * Formula B: on player quit, Reputation -= 8.
 * Returns new reputation after update.
 */
export function updateReputationOnQuit(userId: string): number {
  const conn = db();
  const row = conn.prepare('SELECT reputation FROM player_stats WHERE user_id = ?').get(userId) as { reputation: number } | undefined;
  const current = row ? clampReputation(row.reputation) : REPUTATION_DEFAULT;
  const next = clampReputation(current - 8);
  if (row) {
    conn.prepare('UPDATE player_stats SET reputation = ? WHERE user_id = ?').run(next, userId);
  } else {
    conn.prepare(
      'INSERT INTO player_stats (user_id, total_wins, total_rt_earned, total_games_played, total_losses, reputation) VALUES (?, 0, 0, 0, 0, ?)'
    ).run(userId, next);
  }
  log(`Reputation on quit: ${userId} ${current} -> ${next}`);
  return next;
}

/**
 * Formula B: on event top-3 finish, Reputation += 3.
 * Returns new reputation after update.
 */
export function updateReputationOnEventPodium(userId: string): number {
  const conn = db();
  const row = conn.prepare('SELECT reputation FROM player_stats WHERE user_id = ?').get(userId) as { reputation: number } | undefined;
  const current = row ? clampReputation(row.reputation) : REPUTATION_DEFAULT;
  const next = clampReputation(current + 3);
  if (row) {
    conn.prepare('UPDATE player_stats SET reputation = ? WHERE user_id = ?').run(next, userId);
  } else {
    conn.prepare(
      'INSERT INTO player_stats (user_id, total_wins, total_rt_earned, total_games_played, total_losses, reputation) VALUES (?, 0, 0, 0, 0, ?)'
    ).run(userId, next);
  }
  return next;
}

/**
 * Record a match win for a user
 */
export function recordMatchWin(userId: string, rtEarned: number): void {
  const today = getTodayUTC();
  const conn = db();
  
  const thisWeek = getCurrentWeekUTC();
  const thisSeason = getCurrentSeasonUTC();
  
  // Check if user has stats row (include total_games_played, total_losses for migration compatibility)
  const existing = conn.prepare('SELECT * FROM player_stats WHERE user_id = ?').get(userId) as {
    user_id: string;
    total_wins: number;
    total_rt_earned: number;
    total_games_played?: number;
    total_losses?: number;
    daily_wins: number;
    last_win_date: string | null;
    daily_rt_earned: number;
    last_played_date: string | null;
    current_week: string | null;
    current_season: string | null;
    weekly_score: number;
    season_score: number;
  } | undefined;
  
  if (existing) {
    const newDailyWins = existing.last_win_date === today ? existing.daily_wins + 1 : 1;
    const newDailyRt = existing.last_played_date === today ? (existing.daily_rt_earned ?? 0) + rtEarned : rtEarned;
    const newWeeklyScore = existing.current_week === thisWeek ? (existing.weekly_score ?? 0) + rtEarned : rtEarned;
    const newSeasonScore = existing.current_season === thisSeason ? (existing.season_score ?? 0) + rtEarned : rtEarned;
    
    conn.prepare(`
      UPDATE player_stats 
      SET total_wins = total_wins + 1, 
          total_games_played = COALESCE(total_games_played, 0) + 1,
          total_rt_earned = total_rt_earned + ?, 
          daily_wins = ?,
          last_win_date = ?,
          daily_rt_earned = ?,
          last_played_date = ?,
          current_week = ?,
          weekly_score = ?,
          current_season = ?,
          season_score = ?
      WHERE user_id = ?
    `).run(rtEarned, newDailyWins, today, newDailyRt, today, thisWeek, newWeeklyScore, thisSeason, newSeasonScore, userId);
  } else {
    conn.prepare(`
      INSERT INTO player_stats (user_id, total_wins, total_rt_earned, total_games_played, total_losses, daily_wins, last_win_date, daily_rt_earned, last_played_date, current_week, weekly_score, current_season, season_score)
      VALUES (?, 1, ?, 1, 0, 1, ?, ?, ?, ?, ?, ?, ?)
    `).run(userId, rtEarned, today, rtEarned, today, thisWeek, rtEarned, thisSeason, rtEarned);
  }
  
  log(`Recorded win for user ${userId}: +${rtEarned} RT`);
}

/**
 * Record RT earned (even without winning) - also tracks daily participation
 */
export function recordRtEarned(userId: string, rtEarned: number): void {
  const today = getTodayUTC();
  const thisWeek = getCurrentWeekUTC();
  const thisSeason = getCurrentSeasonUTC();
  const conn = db();
  
  const existing = conn.prepare('SELECT user_id, last_played_date, current_week, current_season, weekly_score, season_score FROM player_stats WHERE user_id = ?').get(userId) as {
    user_id: string;
    last_played_date: string | null;
    current_week: string | null;
    current_season: string | null;
    weekly_score: number;
    season_score: number;
  } | undefined;
  
  if (existing) {
    const sameDay = existing.last_played_date === today;
    const newWeeklyScore = existing.current_week === thisWeek ? (existing.weekly_score ?? 0) + rtEarned : rtEarned;
    const newSeasonScore = existing.current_season === thisSeason ? (existing.season_score ?? 0) + rtEarned : rtEarned;
    
    if (sameDay) {
      conn.prepare(`
        UPDATE player_stats 
        SET total_rt_earned = total_rt_earned + ?,
            daily_rt_earned = daily_rt_earned + ?,
            current_week = ?, weekly_score = ?,
            current_season = ?, season_score = ?
        WHERE user_id = ?
      `).run(rtEarned, rtEarned, thisWeek, newWeeklyScore, thisSeason, newSeasonScore, userId);
    } else {
      conn.prepare(`
        UPDATE player_stats 
        SET total_rt_earned = total_rt_earned + ?,
            daily_rt_earned = ?,
            last_played_date = ?,
            current_week = ?, weekly_score = ?,
            current_season = ?, season_score = ?
        WHERE user_id = ?
      `).run(rtEarned, rtEarned, today, thisWeek, newWeeklyScore, thisSeason, newSeasonScore, userId);
    }
  } else {
    conn.prepare(`
      INSERT INTO player_stats (user_id, total_wins, total_rt_earned, daily_wins, last_win_date, daily_rt_earned, last_played_date, current_week, weekly_score, current_season, season_score)
      VALUES (?, 0, ?, 0, NULL, ?, ?, ?, ?, ?, ?)
    `).run(userId, rtEarned, rtEarned, today, thisWeek, rtEarned, thisSeason, rtEarned);
  }
  
  log(`Recorded ${rtEarned} RT for user ${userId}`);
}

/**
 * Record a match loss (or quit): increment games_played, losses, and add RT earned.
 */
export function recordMatchLoss(userId: string, rtEarned: number): void {
  const today = getTodayUTC();
  const thisWeek = getCurrentWeekUTC();
  const thisSeason = getCurrentSeasonUTC();
  const conn = db();

  const existing = conn.prepare('SELECT user_id, last_played_date, current_week, current_season, weekly_score, season_score, total_games_played, total_losses FROM player_stats WHERE user_id = ?').get(userId) as {
    user_id: string;
    last_played_date: string | null;
    current_week: string | null;
    current_season: string | null;
    weekly_score: number;
    season_score: number;
    total_games_played?: number;
    total_losses?: number;
  } | undefined;

  if (existing) {
    const sameDay = existing.last_played_date === today;
    const newWeeklyScore = existing.current_week === thisWeek ? (existing.weekly_score ?? 0) + rtEarned : rtEarned;
    const newSeasonScore = existing.current_season === thisSeason ? (existing.season_score ?? 0) + rtEarned : rtEarned;

    if (sameDay) {
      conn.prepare(`
        UPDATE player_stats 
        SET total_games_played = COALESCE(total_games_played, 0) + 1,
            total_losses = COALESCE(total_losses, 0) + 1,
            total_rt_earned = total_rt_earned + ?,
            daily_rt_earned = daily_rt_earned + ?,
            current_week = ?, weekly_score = ?,
            current_season = ?, season_score = ?
        WHERE user_id = ?
      `).run(rtEarned, rtEarned, thisWeek, newWeeklyScore, thisSeason, newSeasonScore, userId);
    } else {
      conn.prepare(`
        UPDATE player_stats 
        SET total_games_played = COALESCE(total_games_played, 0) + 1,
            total_losses = COALESCE(total_losses, 0) + 1,
            total_rt_earned = total_rt_earned + ?,
            daily_rt_earned = ?,
            last_played_date = ?,
            current_week = ?, weekly_score = ?,
            current_season = ?, season_score = ?
        WHERE user_id = ?
      `).run(rtEarned, rtEarned, today, thisWeek, newWeeklyScore, thisSeason, newSeasonScore, userId);
    }
  } else {
    conn.prepare(`
      INSERT INTO player_stats (user_id, total_wins, total_rt_earned, total_games_played, total_losses, daily_wins, last_win_date, daily_rt_earned, last_played_date, current_week, weekly_score, current_season, season_score)
      VALUES (?, 0, ?, 1, 1, 0, NULL, ?, ?, ?, ?, ?, ?)
    `).run(userId, rtEarned, rtEarned, today, thisWeek, rtEarned, thisSeason, rtEarned);
  }

  log(`Recorded loss for user ${userId}: +${rtEarned} RT, games_played+1, losses+1`);
  broadcastLeaderboardUpdate();
}

/**
 * Get leaderboard (daily, weekly, season, all-time, or games)
 * Optional sort: wins, losses, games, score (composite/default)
 */
export function getLeaderboard(
  type: 'alltime' | 'daily' | 'weekly' | 'season' | 'games',
  limit: number = 10,
  sort: 'wins' | 'losses' | 'games' | 'score' = 'score'
): LeaderboardEntry[] {
  const conn = db();
  const today = getTodayUTC();
  const thisWeek = getCurrentWeekUTC();
  const thisSeason = getCurrentSeasonUTC();

  type Row = { user_id: string; display_name: string; shelter_color: string | null; wins: number; rt_earned: number; adoption_score?: number; games_played?: number; losses?: number };

  let rows: Row[];

  if (type === 'games') {
    rows = conn.prepare(`
      SELECT ps.user_id, u.display_name, u.shelter_color, ps.total_wins as wins, ps.total_rt_earned as rt_earned,
             COALESCE(ps.adoption_score_alltime, ps.total_rt_earned) as adoption_score,
             COALESCE(ps.total_games_played, 0) as games_played, COALESCE(ps.total_losses, 0) as losses
      FROM player_stats ps
      JOIN users u ON ps.user_id = u.id
      ORDER BY COALESCE(ps.total_games_played, 0) DESC, ps.total_wins DESC
      LIMIT ?
    `).all(limit) as Row[];
  } else if (type === 'daily') {
    rows = conn.prepare(`
      SELECT ps.user_id, u.display_name, u.shelter_color, ps.daily_wins as wins, ps.daily_rt_earned as rt_earned,
             COALESCE(ps.adoption_score_daily, ps.daily_rt_earned) as adoption_score,
             COALESCE(ps.total_games_played, 0) as games_played, COALESCE(ps.total_losses, 0) as losses
      FROM player_stats ps
      JOIN users u ON ps.user_id = u.id
      WHERE ps.last_played_date = ?
      ORDER BY COALESCE(ps.adoption_score_daily, ps.daily_rt_earned) DESC, ps.daily_wins DESC
      LIMIT ?
    `).all(today, limit) as Row[];
  } else if (type === 'weekly') {
    rows = conn.prepare(`
      SELECT ps.user_id, u.display_name, u.shelter_color, ps.daily_wins as wins, ps.weekly_score as rt_earned,
             ps.weekly_score as adoption_score,
             COALESCE(ps.total_games_played, 0) as games_played, COALESCE(ps.total_losses, 0) as losses
      FROM player_stats ps
      JOIN users u ON ps.user_id = u.id
      WHERE ps.current_week = ?
      ORDER BY ps.weekly_score DESC
      LIMIT ?
    `).all(thisWeek, limit) as Row[];
  } else if (type === 'season') {
    rows = conn.prepare(`
      SELECT ps.user_id, u.display_name, u.shelter_color, ps.daily_wins as wins, ps.season_score as rt_earned,
             ps.season_score as adoption_score,
             COALESCE(ps.total_games_played, 0) as games_played, COALESCE(ps.total_losses, 0) as losses
      FROM player_stats ps
      JOIN users u ON ps.user_id = u.id
      WHERE ps.current_season = ?
      ORDER BY ps.season_score DESC
      LIMIT ?
    `).all(thisSeason, limit) as Row[];
  } else {
    // All-time: support sort = wins | losses | games | score (Formula B: score uses reputation-weighted)
    const baseScore = 'COALESCE(ps.adoption_score_alltime, ps.total_rt_earned)';
    const rep = 'COALESCE(ps.reputation, 50)';
    const weightedScore = `(${baseScore} * (1 + ${rep} / 100.0))`;
    const orderBy = sort === 'wins'
      ? 'ORDER BY ps.total_wins DESC, ps.total_rt_earned DESC'
      : sort === 'losses'
        ? 'ORDER BY COALESCE(ps.total_losses, 0) DESC, ps.total_wins DESC'
        : sort === 'games'
          ? 'ORDER BY COALESCE(ps.total_games_played, 0) DESC, ps.total_wins DESC'
          : `ORDER BY ${weightedScore} DESC, ps.total_wins DESC`;
    rows = conn.prepare(`
      SELECT ps.user_id, u.display_name, u.shelter_color, ps.total_wins as wins, ps.total_rt_earned as rt_earned,
             COALESCE(ps.adoption_score_alltime, ps.total_rt_earned) as adoption_score,
             COALESCE(ps.total_games_played, 0) as games_played, COALESCE(ps.total_losses, 0) as losses
      FROM player_stats ps
      JOIN users u ON ps.user_id = u.id
      ${orderBy}
      LIMIT ?
    `).all(limit) as Row[];
  }

  return rows.map((row, index) => ({
    rank: index + 1,
    userId: row.user_id,
    displayName: row.display_name,
    wins: row.wins,
    rtEarned: row.rt_earned,
    gamesPlayed: row.games_played,
    losses: row.losses,
    adoptionScore: row.adoption_score,
    shelterColor: row.shelter_color,
  }));
}

/**
 * Get a user's rank on the leaderboard
 */
export function getUserRank(userId: string, type: 'alltime' | 'daily'): { rank: number; stats: PlayerStats | null } {
  const conn = db();
  const today = getTodayUTC();
  
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
  const d = new Date();
  const yesterdayDate = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - 1));
  const yesterday = `${yesterdayDate.getUTCFullYear()}-${String(yesterdayDate.getUTCMonth() + 1).padStart(2, '0')}-${String(yesterdayDate.getUTCDate()).padStart(2, '0')}`;
  const conn = db();
  
  // Get yesterday's top 10 (UTC day)
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
