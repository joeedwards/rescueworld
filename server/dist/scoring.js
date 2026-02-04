"use strict";
/**
 * Adoption score calculation - Formula B (reputation-weighted) from design doc.
 * Per-adoption: Points = BASE * Q * E. Leaderboard: TotalPoints * (1 + Reputation/100).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.calculateAdoptionScoreFormulaB = calculateAdoptionScoreFormulaB;
exports.getLeaderboardScore = getLeaderboardScore;
exports.calculateAdoptionScore = calculateAdoptionScore;
exports.getQualityMultiplier = getQualityMultiplier;
exports.getDiversityBonus = getDiversityBonus;
exports.getStreakBonus = getStreakBonus;
exports.getEventMultiplier = getEventMultiplier;
exports.getAntiGrindFactor = getAntiGrindFactor;
/** Clamp a value between min and max */
function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}
const FORMULA_B_BASE = 10;
/**
 * Formula B: per-adoption points = BASE * Q * E (no diversity, streak, anti-grind).
 */
function calculateAdoptionScoreFormulaB(params) {
    const { qualityMultiplier, eventMultiplier } = params;
    return Math.floor(FORMULA_B_BASE * qualityMultiplier * eventMultiplier);
}
/**
 * Leaderboard score with reputation multiplier: TotalPoints * (1 + Reputation/100).
 */
function getLeaderboardScore(totalPoints, reputation) {
    return Math.floor(totalPoints * (1 + reputation / 100));
}
/** Legacy: kept for any callers that still use Formula A-style params */
function calculateAdoptionScore(params) {
    return Math.floor(params.basePoints * params.qualityMultiplier * params.diversityBonus * params.streakBonus * params.eventMultiplier * params.antiGrindFactor);
}
/**
 * Quality multiplier: 0.6-2.0
 * - Base random variance 0.8-1.2
 * - Event requirements met: 1.5-2.0
 * - Pet type matching (future: dog lovers etc.) can add more
 */
function getQualityMultiplier(options) {
    const base = clamp(options.randomVariance ?? 0.8 + Math.random() * 0.4, 0.6, 2.0);
    if (options.eventRequirementMet) {
        return clamp(base * (1.2 + Math.random() * 0.3), 1.0, 2.0); // 1.2-1.5 extra when event met
    }
    return base;
}
/**
 * Diversity bonus: 1.0 - 1.35 based on variety of pet types adopted today
 * More unique types = higher bonus
 */
function getDiversityBonus(uniquePetTypesAdoptedToday) {
    // 1 type = 1.0, 2 = 1.08, 3 = 1.16, 4 = 1.24, 5 = 1.35
    const bonus = 1.0 + (uniquePetTypesAdoptedToday - 1) * 0.0875;
    return clamp(bonus, 1.0, 1.35);
}
/**
 * Streak bonus: 1.0 - 1.30 for consecutive days with adoptions
 */
function getStreakBonus(perfectDaysStreak) {
    // Cap at 7 days for max 1.30
    const capped = Math.min(perfectDaysStreak, 7);
    const bonus = 1.0 + capped * 0.04286; // ~1.30 at 7
    return clamp(bonus, 1.0, 1.30);
}
/**
 * Event multiplier: 1.0 - 3.0 when adoption counts toward active event
 */
function getEventMultiplier(participatingInEvent, tier) {
    if (!participatingInEvent)
        return 1.0;
    switch (tier) {
        case 'top1': return 2.5 + Math.random() * 0.5; // 2.5-3.0
        case 'top2': return 2.0 + Math.random() * 0.3; // 2.0-2.3
        case 'top3': return 1.5 + Math.random() * 0.3; // 1.5-1.8
        case 'participation':
        default: return 1.2 + Math.random() * 0.2; // 1.2-1.4
    }
}
/**
 * Anti-grind factor: 0.5 - 1.0
 * Decreases with many adoptions in same session/day to discourage grinding
 */
function getAntiGrindFactor(adoptionsThisSession, adoptionsToday) {
    const sessionPenalty = Math.max(0, adoptionsThisSession - 20) * 0.005; // After 20, -0.5% each
    const dayPenalty = Math.max(0, adoptionsToday - 50) * 0.003; // After 50 today, -0.3% each
    const factor = 1.0 - sessionPenalty - dayPenalty;
    return clamp(factor, 0.5, 1.0);
}
