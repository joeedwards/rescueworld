"use strict";
/**
 * Auth API: guest names (rescueNNN from registry), Google SSO. Uses .env for keys.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cookie_parser_1 = __importDefault(require("cookie-parser"));
const registry_js_1 = require("./registry.js");
const referrals_js_1 = require("./referrals.js");
const dailyGifts_js_1 = require("./dailyGifts.js");
const leaderboard_js_1 = require("./leaderboard.js");
const inventory_js_1 = require("./inventory.js");
const leaderboard_js_2 = require("./leaderboard.js");
const gameStats_js_1 = require("./gameStats.js");
const karmaService_js_1 = require("./karmaService.js");
const GameServer_js_1 = require("./GameServer.js");
/** Timestamped log function for server output */
function log(message) {
    const now = new Date();
    const timestamp = now.toISOString().replace('T', ' ').slice(0, 19);
    console.log(`[${timestamp}] [rescue] ${message}`);
}
const API_PORT = Number(process.env.API_PORT) || 4002;
const SESSION_SECRET = process.env.SESSION_SECRET || 'change-me-in-production';
const API_ORIGIN = process.env.API_ORIGIN || 'http://localhost:3000';
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';
const FACEBOOK_APP_ID = process.env.FACEBOOK_APP_ID || '';
const FACEBOOK_APP_SECRET = process.env.FACEBOOK_APP_SECRET || '';
const app = (0, express_1.default)();
app.use((0, cookie_parser_1.default)(SESSION_SECRET));
app.use(express_1.default.json());
(0, referrals_js_1.ensureReferralStorage)();
function setRefCookie(req, res) {
    const ref = typeof req.query.ref === 'string' ? req.query.ref.trim() : '';
    if (!ref)
        return;
    res.cookie('ref_code', ref, {
        httpOnly: true,
        maxAge: 7 * 24 * 60 * 60 * 1000,
        signed: true,
        sameSite: 'lax',
    });
}
function clearRefCookie(res) {
    res.clearCookie('ref_code');
}
app.get('/health', (_req, res) => {
    res.json((0, registry_js_1.getStorageStatus)());
});
// Public game stats endpoint for analytics and advertising
app.get('/api/game-stats', (_req, res) => {
    const stats = (0, gameStats_js_1.getGameStats)(GameServer_js_1.getRealtimeStats);
    res.json(stats);
});
app.get('/auth/me', (req, res) => {
    const userId = req.signedCookies?.session;
    if (userId) {
        const user = (0, referrals_js_1.getUserById)(userId);
        if (user) {
            log(`auth/me signed-in displayName=${user.display_name}`);
            res.json({
                displayName: user.display_name,
                signedIn: true,
                userId: user.id,
                shelterColor: user.shelter_color ?? null,
            });
            return;
        }
    }
    const guestName = req.signedCookies?.guest_name ?? req.cookies?.guest_name;
    if (guestName) {
        log(`auth/me guest cookie displayName=${guestName}`);
        res.json({ displayName: guestName, signedIn: false, userId: null, shelterColor: null });
        return;
    }
    log('auth/me no session');
    res.json({ displayName: null, signedIn: false, userId: null, shelterColor: null });
});
// Update user profile (nickname and/or shelter color)
app.post('/auth/profile', (req, res) => {
    const userId = req.signedCookies?.session;
    if (!userId) {
        res.status(401).json({ error: 'not_signed_in' });
        return;
    }
    const { nickname, shelterColor } = req.body;
    let nicknameUpdated = false;
    let colorUpdated = false;
    if (typeof nickname === 'string' && nickname.trim().length > 0) {
        nicknameUpdated = (0, referrals_js_1.updateUserNickname)(userId, nickname);
        if (nicknameUpdated) {
            log(`User ${userId} updated nickname to: ${nickname.trim().slice(0, 20)}`);
        }
    }
    if (typeof shelterColor === 'string' && shelterColor.length > 0) {
        colorUpdated = (0, referrals_js_1.updateUserShelterColor)(userId, shelterColor);
        if (colorUpdated) {
            log(`User ${userId} updated shelter color to: ${shelterColor}`);
        }
    }
    const user = (0, referrals_js_1.getUserById)(userId);
    res.json({
        success: nicknameUpdated || colorUpdated,
        displayName: user?.display_name ?? null,
        shelterColor: user?.shelter_color ?? null,
    });
});
app.get('/auth/signout', (req, res) => {
    res.clearCookie('session');
    res.clearCookie('guest_name');
    //const gamePath = API_ORIGIN.includes('localhost') ? '/' : '/rescueworld/';
    const gamePath = '/';
    res.redirect(`${API_ORIGIN.replace(/\/$/, '')}${gamePath}`);
});
app.post('/auth/guest', async (req, res) => {
    const displayName = await (0, registry_js_1.getNextGuestName)();
    log(`auth guest assigned displayName=${displayName}`);
    res.cookie('guest_name', displayName, {
        httpOnly: true,
        maxAge: 365 * 24 * 60 * 60 * 1000,
        signed: true,
        sameSite: 'lax',
    });
    res.json({ displayName });
});
app.get('/auth/google', (req, res) => {
    if (!GOOGLE_CLIENT_ID) {
        res.status(503).send('Google sign-in not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env');
        return;
    }
    setRefCookie(req, res);
    const redirectUri = `${API_ORIGIN.replace(/\/$/, '')}/auth/google/callback`;
    const scope = encodeURIComponent('email profile');
    const url = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${GOOGLE_CLIENT_ID}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${scope}`;
    res.redirect(url);
});
app.get('/auth/google/callback', async (req, res) => {
    if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
        res.redirect(API_ORIGIN);
        return;
    }
    const { code } = req.query;
    if (typeof code !== 'string') {
        res.redirect(API_ORIGIN);
        return;
    }
    const redirectUri = `${API_ORIGIN.replace(/\/$/, '')}/auth/google/callback`;
    try {
        const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                code,
                client_id: GOOGLE_CLIENT_ID,
                client_secret: GOOGLE_CLIENT_SECRET,
                redirect_uri: redirectUri,
                grant_type: 'authorization_code',
            }),
        });
        const tokens = (await tokenRes.json());
        if (!tokens.access_token) {
            res.redirect(API_ORIGIN);
            return;
        }
        const profileRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
            headers: { Authorization: `Bearer ${tokens.access_token}` },
        });
        const profile = (await profileRes.json());
        const displayName = profile.name ?? profile.email ?? (await (0, registry_js_1.getNextGuestName)());
        const { user, created } = (0, referrals_js_1.getOrCreateUser)('google', profile.id, profile.email ?? '', displayName);
        // If new user, grant registration gift and check for referral
        if (created) {
            const refCode = req.signedCookies?.ref_code ?? req.cookies?.ref_code;
            if (refCode) {
                const referrer = (0, referrals_js_1.getUserByReferralCode)(refCode);
                if (referrer)
                    await (0, referrals_js_1.recordReferral)(referrer.id, user.id);
            }
            // Grant registration gift (includes Day 1)
            (0, dailyGifts_js_1.grantRegistrationGift)(user.id);
            log(`New user ${displayName} registered via Google, granted registration gift`);
        }
        clearRefCookie(res);
        res.cookie('session', user.id, {
            httpOnly: true,
            maxAge: 30 * 24 * 60 * 60 * 1000,
            signed: true,
            sameSite: 'lax',
        });
        const gamePath = '/';
        res.redirect(`${API_ORIGIN.replace(/\/$/, '')}${gamePath}?registered=${created ? '1' : '0'}`);
    }
    catch {
        res.redirect(API_ORIGIN);
    }
});
app.get('/auth/facebook', (req, res) => {
    if (!FACEBOOK_APP_ID || !FACEBOOK_APP_SECRET) {
        res.status(503).send('Facebook sign-in not configured. Set FACEBOOK_APP_ID and FACEBOOK_APP_SECRET in .env');
        return;
    }
    setRefCookie(req, res);
    const redirectUri = `${API_ORIGIN.replace(/\/$/, '')}/auth/facebook/callback`;
    const state = Math.random().toString(36).slice(2);
    res.cookie('fb_state', state, {
        httpOnly: true,
        maxAge: 10 * 60 * 1000,
        signed: true,
        sameSite: 'lax',
    });
    const scope = encodeURIComponent('email public_profile');
    const url = `https://www.facebook.com/v18.0/dialog/oauth?client_id=${FACEBOOK_APP_ID}&redirect_uri=${encodeURIComponent(redirectUri)}&state=${state}&scope=${scope}`;
    res.redirect(url);
});
app.get('/auth/facebook/callback', async (req, res) => {
    if (!FACEBOOK_APP_ID || !FACEBOOK_APP_SECRET) {
        res.redirect(API_ORIGIN);
        return;
    }
    const { code, state } = req.query;
    const savedState = req.signedCookies?.fb_state ?? req.cookies?.fb_state;
    if (typeof code !== 'string' || typeof state !== 'string' || !savedState || state !== savedState) {
        res.redirect(API_ORIGIN);
        return;
    }
    const redirectUri = `${API_ORIGIN.replace(/\/$/, '')}/auth/facebook/callback`;
    try {
        const tokenRes = await fetch(`https://graph.facebook.com/v18.0/oauth/access_token?client_id=${FACEBOOK_APP_ID}&redirect_uri=${encodeURIComponent(redirectUri)}&client_secret=${FACEBOOK_APP_SECRET}&code=${encodeURIComponent(code)}`);
        const tokens = (await tokenRes.json());
        if (!tokens.access_token) {
            res.redirect(API_ORIGIN);
            return;
        }
        const profileRes = await fetch(`https://graph.facebook.com/me?fields=id,name,email&access_token=${encodeURIComponent(tokens.access_token)}`);
        const profile = (await profileRes.json());
        const displayName = profile.name ?? profile.email ?? (await (0, registry_js_1.getNextGuestName)());
        const { user, created } = (0, referrals_js_1.getOrCreateUser)('facebook', profile.id, profile.email ?? '', displayName);
        // If new user, grant registration gift and check for referral
        if (created) {
            const refCode = req.signedCookies?.ref_code ?? req.cookies?.ref_code;
            if (refCode) {
                const referrer = (0, referrals_js_1.getUserByReferralCode)(refCode);
                if (referrer)
                    await (0, referrals_js_1.recordReferral)(referrer.id, user.id);
            }
            // Grant registration gift (includes Day 1)
            (0, dailyGifts_js_1.grantRegistrationGift)(user.id);
            log(`New user ${displayName} registered via Facebook, granted registration gift`);
        }
        clearRefCookie(res);
        res.clearCookie('fb_state');
        res.cookie('session', user.id, {
            httpOnly: true,
            maxAge: 30 * 24 * 60 * 60 * 1000,
            signed: true,
            sameSite: 'lax',
        });
        const gamePath = '/';
        res.redirect(`${API_ORIGIN.replace(/\/$/, '')}${gamePath}?registered=${created ? '1' : '0'}`);
    }
    catch {
        res.redirect(API_ORIGIN);
    }
});
app.get('/referrals/me', async (req, res) => {
    const userId = req.signedCookies?.session;
    if (!userId) {
        res.status(401).json({ error: 'not_signed_in' });
        return;
    }
    const stats = await (0, referrals_js_1.getReferralStats)(userId);
    res.json(stats);
});
app.post('/referrals/claim', async (req, res) => {
    const userId = req.signedCookies?.session;
    if (!userId) {
        res.status(401).json({ error: 'not_signed_in' });
        return;
    }
    const result = await (0, referrals_js_1.claimReward)(userId);
    res.json(result);
});
// Daily Gift endpoints
app.get('/api/daily-gift', (req, res) => {
    const userId = req.signedCookies?.session;
    if (!userId) {
        res.status(401).json({ error: 'not_signed_in', message: 'Sign in to access daily gifts' });
        return;
    }
    const status = (0, dailyGifts_js_1.getDailyGiftStatus)(userId);
    res.json(status);
});
app.post('/api/daily-gift/claim', (req, res) => {
    const userId = req.signedCookies?.session;
    if (!userId) {
        res.status(401).json({ error: 'not_signed_in', message: 'Sign in to claim daily gifts' });
        return;
    }
    const result = (0, dailyGifts_js_1.claimDailyGift)(userId);
    if (!result.success) {
        res.status(400).json({ error: result.error });
        return;
    }
    res.json({
        success: true,
        reward: result.reward,
        nextDay: result.nextDay,
    });
});
// Server time (UTC). Daily gift resets at 00:00 UTC.
app.get('/api/server-time', (_req, res) => {
    const now = new Date();
    const utc = now.toISOString();
    const nextMidnight = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
    const nextMidnightUtc = nextMidnight.toISOString();
    res.json({ utc, nextMidnightUtc });
});
// Saved match (solo): check for existing match to resume
app.get('/api/saved-match', (req, res) => {
    const userId = req.signedCookies?.session;
    if (!userId) {
        res.json({ hasSavedMatch: false });
        return;
    }
    const saved = (0, referrals_js_1.getSavedMatch)(userId);
    res.json({
        hasSavedMatch: !!saved,
        matchId: saved?.id ?? null,
        createdAt: saved?.created_at ?? null,
    });
});
// Abandon saved solo match (applies quit penalty)
app.delete('/api/saved-match', (req, res) => {
    const userId = req.signedCookies?.session;
    if (!userId) {
        res.status(401).json({ error: 'not_signed_in' });
        return;
    }
    (0, referrals_js_1.deleteSavedMatch)(userId);
    (0, leaderboard_js_2.updateReputationOnQuit)(userId);
    res.json({ success: true });
});
// Leaderboard endpoints
app.get('/api/leaderboard', (req, res) => {
    const q = req.query.type;
    const type = (q === 'daily' || q === 'weekly' || q === 'season' || q === 'alltime' || q === 'games') ? q : 'alltime';
    const limit = Math.min(Math.max(parseInt(String(req.query.limit)) || 10, 1), 100);
    const sortQ = req.query.sort;
    const sort = (sortQ === 'wins' || sortQ === 'losses' || sortQ === 'games' || sortQ === 'score') ? sortQ : 'score';
    const entries = (0, leaderboard_js_1.getLeaderboard)(type, limit, sort);
    res.json({ type, entries });
});
app.get('/api/leaderboard/my-rank', (req, res) => {
    const userId = req.signedCookies?.session;
    if (!userId) {
        res.json({ alltime: { rank: 0, stats: null }, daily: { rank: 0, stats: null } });
        return;
    }
    const alltime = (0, leaderboard_js_1.getUserRank)(userId, 'alltime');
    const daily = (0, leaderboard_js_1.getUserRank)(userId, 'daily');
    res.json({ alltime, daily });
});
// Match history - current user
app.get('/api/match-history', (req, res) => {
    const userId = req.signedCookies?.session;
    if (!userId) {
        res.json({ matches: [] });
        return;
    }
    const limit = Math.min(Math.max(parseInt(String(req.query.limit)) || 50, 1), 100);
    const matches = (0, referrals_js_1.getMatchHistory)(userId, limit);
    res.json({ matches });
});
// Match history for a specific user (e.g. for leaderboard profile)
app.get('/api/user/:userId/matches', (req, res) => {
    const targetUserId = req.params.userId;
    if (!targetUserId) {
        res.status(400).json({ error: 'user_id_required' });
        return;
    }
    const limit = Math.min(Math.max(parseInt(String(req.query.limit)) || 20, 1), 50);
    const matches = (0, referrals_js_1.getMatchHistory)(targetUserId, limit);
    res.json({ matches });
});
// Inventory endpoints
app.get('/api/inventory', (req, res) => {
    const userId = req.signedCookies?.session;
    if (!userId) {
        res.json({ storedRt: 0, portCharges: 0, speedBoosts: 0, sizeBoosts: 0, signedIn: false });
        return;
    }
    const inventory = (0, inventory_js_1.getInventory)(userId);
    res.json({ ...inventory, signedIn: true });
});
// Withdraw inventory for match start (clears stored items)
app.post('/api/inventory/withdraw', (req, res) => {
    const userId = req.signedCookies?.session;
    if (!userId) {
        res.json({ storedRt: 0, portCharges: 0, speedBoosts: 0, sizeBoosts: 0, signedIn: false });
        return;
    }
    const inventory = (0, inventory_js_1.withdrawForMatch)(userId);
    log(`Inventory withdrawn for ${userId}: ${inventory.storedRt} RT`);
    res.json({ ...inventory, signedIn: true });
});
// Deposit after match end (auto-save all RT and items)
app.post('/api/inventory/deposit', (req, res) => {
    const userId = req.signedCookies?.session;
    if (!userId) {
        res.status(401).json({ error: 'not_signed_in' });
        return;
    }
    const { rt, portCharges, speedBoosts, sizeBoosts, isWinner } = req.body;
    const rtAmount = typeof rt === 'number' && rt > 0 ? Math.floor(rt) : 0;
    const ports = typeof portCharges === 'number' && portCharges > 0 ? Math.floor(portCharges) : 0;
    const speeds = typeof speedBoosts === 'number' && speedBoosts > 0 ? Math.floor(speedBoosts) : 0;
    const sizes = typeof sizeBoosts === 'number' && sizeBoosts > 0 ? Math.floor(sizeBoosts) : 0;
    const inventory = (0, inventory_js_1.depositAfterMatch)(userId, rtAmount, ports, speeds, sizes);
    // Record to leaderboard
    if (isWinner) {
        (0, leaderboard_js_2.recordMatchWin)(userId, rtAmount);
    }
    else if (rtAmount > 0) {
        (0, leaderboard_js_2.recordRtEarned)(userId, rtAmount);
    }
    log(`Inventory deposited for ${userId}: ${rtAmount} RT, winner=${isWinner}`);
    res.json({ success: true, inventory });
});
// Karma Points API - shared across games (Rescue World / Shelter Sim)
// Get current user's karma balance
app.get('/api/karma', (req, res) => {
    const userId = req.signedCookies?.session;
    if (!userId) {
        res.json({ karmaPoints: 0, signedIn: false });
        return;
    }
    const karmaInfo = (0, karmaService_js_1.getKarmaInfo)(userId);
    if (!karmaInfo) {
        res.json({ karmaPoints: 0, signedIn: true, userId });
        return;
    }
    res.json({
        karmaPoints: karmaInfo.karmaPoints,
        displayName: karmaInfo.displayName,
        userId: karmaInfo.userId,
        signedIn: true
    });
});
// Get karma transaction history for current user
// NOTE: Must be defined before /api/karma/:userId to avoid route conflict
app.get('/api/karma/history', (req, res) => {
    const userId = req.signedCookies?.session;
    if (!userId) {
        res.status(401).json({ error: 'not_signed_in' });
        return;
    }
    const limit = Math.min(Math.max(parseInt(String(req.query.limit)) || 20, 1), 100);
    const history = (0, karmaService_js_1.getKarmaHistory)(userId, limit);
    res.json({ history });
});
// Get karma for a specific user (server-to-server / Shelter Sim integration)
app.get('/api/karma/:userId', (req, res) => {
    const targetUserId = req.params.userId;
    if (!targetUserId) {
        res.status(400).json({ error: 'user_id_required' });
        return;
    }
    const karmaInfo = (0, karmaService_js_1.getKarmaInfo)(targetUserId);
    if (!karmaInfo) {
        res.status(404).json({ error: 'user_not_found' });
        return;
    }
    res.json(karmaInfo);
});
// Award karma points (authenticated, for Shelter Sim server-to-server use)
// Requires API key in header for server-to-server calls
app.post('/api/karma/award', (req, res) => {
    // Check for API key or session
    const apiKey = req.headers['x-api-key'];
    const expectedApiKey = process.env.KARMA_API_KEY;
    const userId = req.signedCookies?.session;
    // Allow either session auth OR API key auth
    const { targetUserId, amount, reason, source } = req.body;
    // Determine which user to award karma to
    let awardToUserId = null;
    if (apiKey && expectedApiKey && apiKey === expectedApiKey) {
        // Server-to-server call with API key - use targetUserId
        if (!targetUserId) {
            res.status(400).json({ error: 'target_user_id_required' });
            return;
        }
        awardToUserId = targetUserId;
    }
    else if (userId) {
        // Session auth - can only award to self (for future client-side features)
        awardToUserId = userId;
    }
    else {
        res.status(401).json({ error: 'unauthorized' });
        return;
    }
    if (typeof amount !== 'number' || amount <= 0) {
        res.status(400).json({ error: 'amount_must_be_positive' });
        return;
    }
    // TypeScript guard - should never reach here with null userId due to returns above
    if (!awardToUserId) {
        res.status(401).json({ error: 'unauthorized' });
        return;
    }
    const karmaReason = typeof reason === 'string' ? reason : 'External award';
    const karmaSource = typeof source === 'string' ? source : 'sheltersim';
    const newBalance = (0, karmaService_js_1.awardKarmaPoints)(awardToUserId, Math.floor(amount), karmaReason, karmaSource);
    log(`Karma awarded: ${amount} KP to ${awardToUserId} (${karmaSource}: ${karmaReason})`);
    res.json({ success: true, userId: awardToUserId, karmaPoints: newBalance });
});
app.listen(API_PORT, () => {
    log(`Auth API on http://localhost:${API_PORT}`);
});
