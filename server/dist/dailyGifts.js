"use strict";
/**
 * Daily Gift System
 *
 * Only signed-in users can claim daily gifts.
 * 7-day cycle with increasing rewards.
 * Missing a day doesn't reset progress, just skips that day's reward.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.DAILY_GIFT_REWARDS = void 0;
exports.getDailyGiftStatus = getDailyGiftStatus;
exports.claimDailyGift = claimDailyGift;
exports.handleDailyGiftGet = handleDailyGiftGet;
exports.handleDailyGiftClaim = handleDailyGiftClaim;
const referrals_js_1 = require("./referrals.js");
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
function getTodayDate() {
    return new Date().toISOString().split('T')[0]; // YYYY-MM-DD
}
function getDailyGiftStatus(userId) {
    (0, referrals_js_1.ensureReferralStorage)();
    initSqlite();
    const row = db().prepare('SELECT last_claim_date, current_day, total_claims FROM daily_gifts WHERE user_id = ?').get(userId);
    const today = getTodayDate();
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
function claimDailyGift(userId) {
    (0, referrals_js_1.ensureReferralStorage)();
    initSqlite();
    const today = getTodayDate();
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
    console.log(`[rescue] Daily gift claimed by ${userId}: Day ${currentDay}, +${reward.tokens} RT`);
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
