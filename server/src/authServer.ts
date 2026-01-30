/**
 * Auth API: guest names (rescueNNN), Google SSO. Uses .env for keys.
 */

import express, { Request, Response } from 'express';
import cookieParser from 'cookie-parser';

const API_PORT = Number(process.env.API_PORT) || 4002;
const SESSION_SECRET = process.env.SESSION_SECRET || 'change-me-in-production';
const API_ORIGIN = process.env.API_ORIGIN || 'http://localhost:3000';
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';

const app = express();
app.use(cookieParser(SESSION_SECRET));
app.use(express.json());

type User = { id: string; googleId: string; email: string; displayName: string };
const users = new Map<string, User>();
let userSeq = 0;

function generateGuestName(): string {
  return `rescue${String(100 + Math.floor(Math.random() * 900))}`;
}

app.get('/auth/me', (req, res) => {
  const userId = req.signedCookies?.session;
  if (userId) {
    const user = users.get(userId);
    if (user) {
      res.json({ displayName: user.displayName, signedIn: true });
      return;
    }
  }
  const guestName = req.signedCookies?.guest_name ?? req.cookies?.guest_name;
  if (guestName) {
    res.json({ displayName: guestName, signedIn: false });
    return;
  }
  res.json({ displayName: null, signedIn: false });
});

app.get('/auth/signout', (req: Request, res: Response) => {
  res.clearCookie('session');
  res.clearCookie('guest_name');
  const gamePath = API_ORIGIN.includes('localhost') ? '/' : '/rescueworld/';
  res.redirect(`${API_ORIGIN.replace(/\/$/, '')}${gamePath}`);
});

app.post('/auth/guest', (req: Request, res: Response) => {
  const displayName = generateGuestName();
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
    let user = Array.from(users.values()).find((u) => u.googleId === profile.id);
    if (!user) {
      user = {
        id: `u-${++userSeq}`,
        googleId: profile.id,
        email: profile.email ?? '',
        displayName: profile.name ?? profile.email ?? generateGuestName(),
      };
      users.set(user.id, user);
    }
    res.cookie('session', user.id, {
      httpOnly: true,
      maxAge: 30 * 24 * 60 * 60 * 1000,
      signed: true,
      sameSite: 'lax',
    });
    const gamePath = API_ORIGIN.includes('localhost') ? '/' : '/rescueworld/';
    res.redirect(`${API_ORIGIN.replace(/\/$/, '')}${gamePath}`);
  } catch {
    res.redirect(API_ORIGIN);
  }
});

app.listen(API_PORT, () => {
  console.log(`Auth API on http://localhost:${API_PORT}`);
});
