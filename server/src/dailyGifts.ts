/**
 * Daily Gift System
 *
 * Only signed-in users can claim daily gifts.
 * 7-day cycle with increasing rewards.
 * Missing a day doesn't reset progress, just skips that day's reward.
 *
 * All dates use UTC (GMT/UTC 0). The "day" rolls over at midnight UTC, so e.g.
 * PST players (UTC-8) can claim the next day's gift at 5pm PST (01:00 UTC next day).
 */

import type { IncomingMessage, ServerResponse } from 'http';
import { ensureReferralStorage, getUserByProvider } from './referrals.js';

/** Timestamped log function for server output */
function log(message: string): void {
  const now = new Date();
  const timestamp = now.toISOString().replace('T', ' ').slice(0, 19);
  console.log(`[${timestamp}] [rescue] ${message}`);
}

const SQLITE_DB_PATH = process.env.SQLITE_DB_PATH || './rescueworld.db';

let sqlite: import('better-sqlite3').Database | null = null;

function initSqlite(): void {
  if (sqlite) return;
  const Database = require('better-sqlite3') as new (path: string) => import('better-sqlite3').Database;
  sqlite = new Database(SQLITE_DB_PATH);
}

function db(): import('better-sqlite3').Database {
  initSqlite();
  return sqlite!;
}

// Gift rewards for each day (1-indexed, day 0 unused)
export interface DailyGiftReward {
  tokens: number;
  sizeBonus?: number;
  speedBoost?: boolean;
  portCharge?: boolean;
}

export const DAILY_GIFT_REWARDS: DailyGiftReward[] = [
  { tokens: 0 }, // Day 0 - unused
  { tokens: 15 }, // Day 1
  { tokens: 25, speedBoost: true }, // Day 2
  { tokens: 40 }, // Day 3
  { tokens: 50, sizeBonus: 3 }, // Day 4
  { tokens: 75, speedBoost: true }, // Day 5
  { tokens: 100, portCharge: true }, // Day 6
  { tokens: 150, sizeBonus: 5, speedBoost: true }, // Day 7
];

export interface DailyGiftStatus {
  currentDay: number; // 1-7
  canClaimToday: boolean;
  lastClaimDate: string | null;
  totalClaims: number;
  rewards: DailyGiftReward[];
  isNewUser?: boolean; // True if this is a new user with registration gift pending
}

/** Current calendar date in UTC (YYYY-MM-DD). Game server uses UTC for daily reset. */
function getTodayDateUTC(): string {
  const d = new Date();
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function getDailyGiftStatus(userId: string): DailyGiftStatus {
  ensureReferralStorage();
  initSqlite();
  
  const row = db().prepare(
    'SELECT last_claim_date, current_day, total_claims FROM daily_gifts WHERE user_id = ?'
  ).get(userId) as { last_claim_date: string; current_day: number; total_claims: number } | undefined;
  
  const today = getTodayDateUTC();
  
  if (!row) {
    // First time - user can claim day 1
    return {
      currentDay: 1,
      canClaimToday: true,
      lastClaimDate: null,
      totalClaims: 0,
      rewards: DAILY_GIFT_REWARDS.slice(1), // Days 1-7
    };
  }
  
  const canClaimToday = row.last_claim_date !== today;
  
  return {
    currentDay: row.current_day,
    canClaimToday,
    lastClaimDate: row.last_claim_date,
    totalClaims: row.total_claims,
    rewards: DAILY_GIFT_REWARDS.slice(1), // Days 1-7
  };
}

/** Registration gift for new users */
export const REGISTRATION_GIFT: DailyGiftReward = {
  tokens: 50,
  sizeBonus: 5,
  speedBoost: true,
};

/**
 * Grant a registration gift to a new user and auto-claim Day 1.
 * Call this when a user registers for the first time.
 */
export function grantRegistrationGift(userId: string): { 
  success: boolean; 
  registrationReward: DailyGiftReward;
  day1Reward: DailyGiftReward;
} {
  ensureReferralStorage();
  initSqlite();
  
  const today = getTodayDateUTC();
  
  // Check if user already has daily gifts (not a new registration)
  const existingRow = db().prepare(
    'SELECT user_id FROM daily_gifts WHERE user_id = ?'
  ).get(userId);
  
  if (existingRow) {
    // User already exists, not eligible for registration gift
    return { 
      success: false, 
      registrationReward: { tokens: 0 }, 
      day1Reward: { tokens: 0 } 
    };
  }
  
  // New user - grant registration gift AND Day 1 gift
  const day1Reward = DAILY_GIFT_REWARDS[1]; // Day 1 reward
  const nextDay = 2; // Move to day 2
  
  // Insert with Day 1 already claimed
  db().prepare(
    'INSERT INTO daily_gifts (user_id, last_claim_date, current_day, total_claims) VALUES (?, ?, ?, ?)'
  ).run(userId, today, nextDay, 1);
  
  log(`Registration gift granted to ${userId}: +${REGISTRATION_GIFT.tokens} RT (registration) + +${day1Reward.tokens} RT (Day 1)`);
  
  return { 
    success: true, 
    registrationReward: REGISTRATION_GIFT,
    day1Reward,
  };
}

export function claimDailyGift(userId: string): { 
  success: boolean; 
  reward?: DailyGiftReward; 
  nextDay: number;
  error?: string;
} {
  ensureReferralStorage();
  initSqlite();
  
  const today = getTodayDateUTC();
  
  const row = db().prepare(
    'SELECT last_claim_date, current_day, total_claims FROM daily_gifts WHERE user_id = ?'
  ).get(userId) as { last_claim_date: string; current_day: number; total_claims: number } | undefined;
  
  if (row && row.last_claim_date === today) {
    return { success: false, nextDay: row.current_day, error: 'Already claimed today' };
  }
  
  const currentDay = row ? row.current_day : 1;
  const reward = DAILY_GIFT_REWARDS[currentDay];
  const nextDay = currentDay >= 7 ? 1 : currentDay + 1;
  const totalClaims = (row?.total_claims ?? 0) + 1;
  
  if (row) {
    db().prepare(
      'UPDATE daily_gifts SET last_claim_date = ?, current_day = ?, total_claims = ? WHERE user_id = ?'
    ).run(today, nextDay, totalClaims, userId);
  } else {
    db().prepare(
      'INSERT INTO daily_gifts (user_id, last_claim_date, current_day, total_claims) VALUES (?, ?, ?, ?)'
    ).run(userId, today, nextDay, 1);
  }
  
  log(`Daily gift claimed by ${userId}: Day ${currentDay}, +${reward.tokens} RT`);
  
  return { success: true, reward, nextDay };
}

// HTTP handlers for Express-like routing
export function handleDailyGiftGet(
  req: IncomingMessage, 
  res: ServerResponse, 
  userId: string | null
): void {
  res.setHeader('Content-Type', 'application/json');
  
  if (!userId) {
    res.statusCode = 401;
    res.end(JSON.stringify({ error: 'Must be signed in to view daily gifts' }));
    return;
  }
  
  const status = getDailyGiftStatus(userId);
  res.end(JSON.stringify(status));
}

export function handleDailyGiftClaim(
  req: IncomingMessage, 
  res: ServerResponse, 
  userId: string | null
): void {
  res.setHeader('Content-Type', 'application/json');
  
  if (!userId) {
    res.statusCode = 401;
    res.end(JSON.stringify({ error: 'Must be signed in to claim daily gifts' }));
    return;
  }
  
  const result = claimDailyGift(userId);
  
  if (!result.success) {
    res.statusCode = 400;
    res.end(JSON.stringify({ error: result.error }));
    return;
  }
  
  res.end(JSON.stringify({
    success: true,
    reward: result.reward,
    nextDay: result.nextDay,
  }));
}
