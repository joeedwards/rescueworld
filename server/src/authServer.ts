/**
 * Auth API: guest names (rescueNNN from registry), Google SSO. Uses .env for keys.
 */

import express, { Request, Response } from 'express';
import cookieParser from 'cookie-parser';
import { getNextGuestName, getStorageStatus } from './registry.js';
import {
  ensureReferralStorage,
  getOrCreateUser,
  getUserById,
  getUserByReferralCode,
  getReferralStats,
  recordReferral,
  claimReward,
  updateUserNickname,
  updateUserShelterColor,
} from './referrals.js';
import { getDailyGiftStatus, claimDailyGift, grantRegistrationGift, REGISTRATION_GIFT } from './dailyGifts.js';
import { getLeaderboard, getUserRank } from './leaderboard.js';
import { getInventory, depositAfterMatch, withdrawForMatch } from './inventory.js';
import { recordMatchWin, recordRtEarned } from './leaderboard.js';

/** Timestamped log function for server output */
function log(message: string): void {
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

const app = express();
app.use(cookieParser(SESSION_SECRET));
app.use(express.json());
ensureReferralStorage();

function setRefCookie(req: Request, res: Response): void {
  const ref = typeof req.query.ref === 'string' ? req.query.ref.trim() : '';
  if (!ref) return;
  res.cookie('ref_code', ref, {
    httpOnly: true,
    maxAge: 7 * 24 * 60 * 60 * 1000,
    signed: true,
    sameSite: 'lax',
  });
}

function clearRefCookie(res: Response): void {
  res.clearCookie('ref_code');
}

app.get('/health', (_req: Request, res: Response) => {
  res.json(getStorageStatus());
});

app.get('/auth/me', (req, res) => {
  const userId = req.signedCookies?.session;
  if (userId) {
    const user = getUserById(userId);
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
app.post('/auth/profile', (req: Request, res: Response) => {
  const userId = req.signedCookies?.session;
  if (!userId) {
    res.status(401).json({ error: 'not_signed_in' });
    return;
  }
  
  const { nickname, shelterColor } = req.body as { nickname?: string; shelterColor?: string };
  
  let nicknameUpdated = false;
  let colorUpdated = false;
  
  if (typeof nickname === 'string' && nickname.trim().length > 0) {
    nicknameUpdated = updateUserNickname(userId, nickname);
    if (nicknameUpdated) {
      log(`User ${userId} updated nickname to: ${nickname.trim().slice(0, 20)}`);
    }
  }
  
  if (typeof shelterColor === 'string' && shelterColor.length > 0) {
    colorUpdated = updateUserShelterColor(userId, shelterColor);
    if (colorUpdated) {
      log(`User ${userId} updated shelter color to: ${shelterColor}`);
    }
  }
  
  const user = getUserById(userId);
  res.json({ 
    success: nicknameUpdated || colorUpdated,
    displayName: user?.display_name ?? null,
    shelterColor: user?.shelter_color ?? null,
  });
});

app.get('/auth/signout', (req: Request, res: Response) => {
  res.clearCookie('session');
  res.clearCookie('guest_name');
  //const gamePath = API_ORIGIN.includes('localhost') ? '/' : '/rescueworld/';
  const gamePath = '/';
  res.redirect(`${API_ORIGIN.replace(/\/$/, '')}${gamePath}`);
});

app.post('/auth/guest', async (req: Request, res: Response) => {
  const displayName = await getNextGuestName();
  log(`auth guest assigned displayName=${displayName}`);
  res.cookie('guest_name', displayName, {
    httpOnly: true,
    maxAge: 365 * 24 * 60 * 60 * 1000,
    signed: true,
    sameSite: 'lax',
  });
  res.json({ displayName });
});

app.get('/auth/google', (req: Request, res: Response) => {
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

app.get('/auth/google/callback', async (req: Request, res: Response) => {
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
    const tokens = (await tokenRes.json()) as { access_token?: string };
    if (!tokens.access_token) {
      res.redirect(API_ORIGIN);
      return;
    }
    const profileRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    const profile = (await profileRes.json()) as { id: string; email?: string; name?: string };
    const displayName = profile.name ?? profile.email ?? (await getNextGuestName());
    const { user, created } = getOrCreateUser('google', profile.id, profile.email ?? '', displayName);
    // If new user, grant registration gift and check for referral
    if (created) {
      const refCode = req.signedCookies?.ref_code ?? req.cookies?.ref_code;
      if (refCode) {
        const referrer = getUserByReferralCode(refCode);
        if (referrer) await recordReferral(referrer.id, user.id);
      }
      // Grant registration gift (includes Day 1)
      grantRegistrationGift(user.id);
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

  } catch {
    res.redirect(API_ORIGIN);
  }
});

app.get('/auth/facebook', (req: Request, res: Response) => {
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

app.get('/auth/facebook/callback', async (req: Request, res: Response) => {
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
    const tokens = (await tokenRes.json()) as { access_token?: string };
    if (!tokens.access_token) {
      res.redirect(API_ORIGIN);
      return;
    }
    const profileRes = await fetch(`https://graph.facebook.com/me?fields=id,name,email&access_token=${encodeURIComponent(tokens.access_token)}`);
    const profile = (await profileRes.json()) as { id: string; email?: string; name?: string };
    const displayName = profile.name ?? profile.email ?? (await getNextGuestName());
    const { user, created } = getOrCreateUser('facebook', profile.id, profile.email ?? '', displayName);
    // If new user, grant registration gift and check for referral
    if (created) {
      const refCode = req.signedCookies?.ref_code ?? req.cookies?.ref_code;
      if (refCode) {
        const referrer = getUserByReferralCode(refCode);
        if (referrer) await recordReferral(referrer.id, user.id);
      }
      // Grant registration gift (includes Day 1)
      grantRegistrationGift(user.id);
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
  } catch {
    res.redirect(API_ORIGIN);
  }
});

app.get('/referrals/me', async (req: Request, res: Response) => {
  const userId = req.signedCookies?.session;
  if (!userId) {
    res.status(401).json({ error: 'not_signed_in' });
    return;
  }
  const stats = await getReferralStats(userId);
  res.json(stats);
});

app.post('/referrals/claim', async (req: Request, res: Response) => {
  const userId = req.signedCookies?.session;
  if (!userId) {
    res.status(401).json({ error: 'not_signed_in' });
    return;
  }
  const result = await claimReward(userId);
  res.json(result);
});

// Daily Gift endpoints
app.get('/api/daily-gift', (req: Request, res: Response) => {
  const userId = req.signedCookies?.session;
  if (!userId) {
    res.status(401).json({ error: 'not_signed_in', message: 'Sign in to access daily gifts' });
    return;
  }
  const status = getDailyGiftStatus(userId);
  res.json(status);
});

app.post('/api/daily-gift/claim', (req: Request, res: Response) => {
  const userId = req.signedCookies?.session;
  if (!userId) {
    res.status(401).json({ error: 'not_signed_in', message: 'Sign in to claim daily gifts' });
    return;
  }
  const result = claimDailyGift(userId);
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

// Leaderboard endpoints
app.get('/api/leaderboard', (req: Request, res: Response) => {
  const type = req.query.type === 'daily' ? 'daily' : 'alltime';
  const limit = Math.min(Math.max(parseInt(String(req.query.limit)) || 10, 1), 100);
  const entries = getLeaderboard(type, limit);
  res.json({ type, entries });
});

app.get('/api/leaderboard/my-rank', (req: Request, res: Response) => {
  const userId = req.signedCookies?.session;
  if (!userId) {
    res.json({ alltime: { rank: 0, stats: null }, daily: { rank: 0, stats: null } });
    return;
  }
  const alltime = getUserRank(userId, 'alltime');
  const daily = getUserRank(userId, 'daily');
  res.json({ alltime, daily });
});

// Inventory endpoints
app.get('/api/inventory', (req: Request, res: Response) => {
  const userId = req.signedCookies?.session;
  if (!userId) {
    res.json({ storedRt: 0, portCharges: 0, speedBoosts: 0, sizeBoosts: 0, signedIn: false });
    return;
  }
  const inventory = getInventory(userId);
  res.json({ ...inventory, signedIn: true });
});

// Withdraw inventory for match start (clears stored items)
app.post('/api/inventory/withdraw', (req: Request, res: Response) => {
  const userId = req.signedCookies?.session;
  if (!userId) {
    res.json({ storedRt: 0, portCharges: 0, speedBoosts: 0, sizeBoosts: 0, signedIn: false });
    return;
  }
  const inventory = withdrawForMatch(userId);
  log(`Inventory withdrawn for ${userId}: ${inventory.storedRt} RT`);
  res.json({ ...inventory, signedIn: true });
});

// Deposit after match end (auto-save all RT and items)
app.post('/api/inventory/deposit', (req: Request, res: Response) => {
  const userId = req.signedCookies?.session;
  if (!userId) {
    res.status(401).json({ error: 'not_signed_in' });
    return;
  }
  
  const { rt, portCharges, speedBoosts, sizeBoosts, isWinner } = req.body as {
    rt?: number;
    portCharges?: number;
    speedBoosts?: number;
    sizeBoosts?: number;
    isWinner?: boolean;
  };
  
  const rtAmount = typeof rt === 'number' && rt > 0 ? Math.floor(rt) : 0;
  const ports = typeof portCharges === 'number' && portCharges > 0 ? Math.floor(portCharges) : 0;
  const speeds = typeof speedBoosts === 'number' && speedBoosts > 0 ? Math.floor(speedBoosts) : 0;
  const sizes = typeof sizeBoosts === 'number' && sizeBoosts > 0 ? Math.floor(sizeBoosts) : 0;
  
  const inventory = depositAfterMatch(userId, rtAmount, ports, speeds, sizes);
  
  // Record to leaderboard
  if (isWinner) {
    recordMatchWin(userId, rtAmount);
  } else if (rtAmount > 0) {
    recordRtEarned(userId, rtAmount);
  }
  
  log(`Inventory deposited for ${userId}: ${rtAmount} RT, winner=${isWinner}`);
  res.json({ success: true, inventory });
});

app.listen(API_PORT, () => {
  log(`Auth API on http://localhost:${API_PORT}`);
});
