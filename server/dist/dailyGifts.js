"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.REGISTRATION_GIFT = exports.DAILY_GIFT_REWARDS = void 0;
exports.getDailyGiftStatus = getDailyGiftStatus;
exports.grantRegistrationGift = grantRegistrationGift;
exports.claimDailyGift = claimDailyGift;
exports.handleDailyGiftGet = handleDailyGiftGet;
exports.handleDailyGiftClaim = handleDailyGiftClaim;
const referrals_js_1 = require("./referrals.js");
const inventory_js_1 = require("./inventory.js");
/** Timestamped log function for server output */
function log(message) {
    const now = new Date();
    const timestamp = now.toISOString().replace('T', ' ').slice(0, 19);
    console.log(`[${timestamp}] [rescue] ${message}`);
}
const SQLITE_DB_PATH = process.env.SQLITE_DB_PATH || './rescueworld.db';
let sqlite = null;
function initSqlite() {
    if (sqlite)
        return;
    const Database = require('better-sqlite3');
    sqlite = new Database(SQLITE_DB_PATH);
}
function db() {
    initSqlite();
    return sqlite;
}
exports.DAILY_GIFT_REWARDS = [
    { tokens: 0 }, // Day 0 - unused
    { tokens: 15 }, // Day 1
    { tokens: 25, speedBoost: true }, // Day 2
    { tokens: 40 }, // Day 3
    { tokens: 50, sizeBonus: 3 }, // Day 4
    { tokens: 75, speedBoost: true }, // Day 5
    { tokens: 100, portCharge: true }, // Day 6
    { tokens: 150, sizeBonus: 5, speedBoost: true }, // Day 7
];
/** Current calendar date in UTC (YYYY-MM-DD). Game server uses UTC for daily reset. */
function getTodayDateUTC() {
    const d = new Date();
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}
/**
 * Deposit a gift reward into the player's inventory.
 * This actually stores the items in the database so they persist.
 */
function depositGiftReward(userId, reward) {
    // Ensure inventory row exists for this user
    (0, inventory_js_1.initializeInventory)(userId);
    // Deposit RT tokens
    if (reward.tokens > 0) {
        (0, inventory_js_1.addRt)(userId, reward.tokens);
    }
    // Deposit speed boost (1 boost item per gift)
    if (reward.speedBoost) {
        (0, inventory_js_1.addSpeedBoosts)(userId, 1);
    }
    // Deposit size bonus (stored as size boost count)
    if (reward.sizeBonus && reward.sizeBonus > 0) {
        (0, inventory_js_1.addSizeBoosts)(userId, reward.sizeBonus);
    }
    // Deposit port charge (1 random port per gift)
    if (reward.portCharge) {
        (0, inventory_js_1.addPortCharges)(userId, 1);
    }
}
function getDailyGiftStatus(userId) {
    (0, referrals_js_1.ensureReferralStorage)();
    initSqlite();
    const row = db().prepare('SELECT last_claim_date, current_day, total_claims FROM daily_gifts WHERE user_id = ?').get(userId);
    const today = getTodayDateUTC();
    if (!row) {
        // First time - user can claim day 1
        return {
            currentDay: 1,
            canClaimToday: true,
            lastClaimDate: null,
            totalClaims: 0,
            rewards: exports.DAILY_GIFT_REWARDS.slice(1), // Days 1-7
        };
    }
    const canClaimToday = row.last_claim_date !== today;
    return {
        currentDay: row.current_day,
        canClaimToday,
        lastClaimDate: row.last_claim_date,
        totalClaims: row.total_claims,
        rewards: exports.DAILY_GIFT_REWARDS.slice(1), // Days 1-7
    };
}
/** Registration gift for new users */
exports.REGISTRATION_GIFT = {
    tokens: 50,
    sizeBonus: 5,
    speedBoost: true,
};
/**
 * Grant a registration gift to a new user and auto-claim Day 1.
 * Call this when a user registers for the first time.
 */
function grantRegistrationGift(userId) {
    (0, referrals_js_1.ensureReferralStorage)();
    initSqlite();
    const today = getTodayDateUTC();
    // Check if user already has daily gifts (not a new registration)
    const existingRow = db().prepare('SELECT user_id FROM daily_gifts WHERE user_id = ?').get(userId);
    if (existingRow) {
        // User already exists, not eligible for registration gift
        return {
            success: false,
            registrationReward: { tokens: 0 },
            day1Reward: { tokens: 0 }
        };
    }
    // New user - grant registration gift AND Day 1 gift
    const day1Reward = exports.DAILY_GIFT_REWARDS[1]; // Day 1 reward
    const nextDay = 2; // Move to day 2
    // Insert with Day 1 already claimed
    db().prepare('INSERT INTO daily_gifts (user_id, last_claim_date, current_day, total_claims) VALUES (?, ?, ?, ?)').run(userId, today, nextDay, 1);
    // Actually deposit the rewards into the player's inventory (persistent storage)
    depositGiftReward(userId, exports.REGISTRATION_GIFT);
    depositGiftReward(userId, day1Reward);
    log(`Registration gift granted to ${userId}: +${exports.REGISTRATION_GIFT.tokens} RT (registration) + +${day1Reward.tokens} RT (Day 1) - deposited to inventory`);
    return {
        success: true,
        registrationReward: exports.REGISTRATION_GIFT,
        day1Reward,
    };
}
function claimDailyGift(userId) {
    (0, referrals_js_1.ensureReferralStorage)();
    initSqlite();
    const today = getTodayDateUTC();
    const row = db().prepare('SELECT last_claim_date, current_day, total_claims FROM daily_gifts WHERE user_id = ?').get(userId);
    if (row && row.last_claim_date === today) {
        return { success: false, nextDay: row.current_day, error: 'Already claimed today' };
    }
    const currentDay = row ? row.current_day : 1;
    const reward = exports.DAILY_GIFT_REWARDS[currentDay];
    const nextDay = currentDay >= 7 ? 1 : currentDay + 1;
    const totalClaims = (row?.total_claims ?? 0) + 1;
    if (row) {
        db().prepare('UPDATE daily_gifts SET last_claim_date = ?, current_day = ?, total_claims = ? WHERE user_id = ?').run(today, nextDay, totalClaims, userId);
    }
    else {
        db().prepare('INSERT INTO daily_gifts (user_id, last_claim_date, current_day, total_claims) VALUES (?, ?, ?, ?)').run(userId, today, nextDay, 1);
    }
    // Actually deposit the reward into the player's inventory (persistent storage)
    depositGiftReward(userId, reward);
    const rewardParts = [`+${reward.tokens} RT`];
    if (reward.speedBoost)
        rewardParts.push('+1 speed boost');
    if (reward.sizeBonus)
        rewardParts.push(`+${reward.sizeBonus} size boost`);
    if (reward.portCharge)
        rewardParts.push('+1 port charge');
    log(`Daily gift claimed by ${userId}: Day ${currentDay}, ${rewardParts.join(', ')} - deposited to inventory`);
    return { success: true, reward, nextDay };
}
// HTTP handlers for Express-like routing
function handleDailyGiftGet(req, res, userId) {
    res.setHeader('Content-Type', 'application/json');
    if (!userId) {
        res.statusCode = 401;
        res.end(JSON.stringify({ error: 'Must be signed in to view daily gifts' }));
        return;
    }
    const status = getDailyGiftStatus(userId);
    res.end(JSON.stringify(status));
}
function handleDailyGiftClaim(req, res, userId) {
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
