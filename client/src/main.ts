/**
 * Puppy Rescue client: browser-first, 8-directional movement, tap-to-move,
 * prediction for local player, interpolation for others. Connects via
 * signaling -> game WebSocket.
 */

import {
  TICK_RATE,
  TICK_MS,
  MAP_WIDTH,
  MAP_HEIGHT,
  SHELTER_SPEED,
  SHELTER_BASE_RADIUS,
  SHELTER_RADIUS_PER_SIZE,
  PET_RADIUS,
  ADOPTION_ZONE_RADIUS,
  GROWTH_ORB_RADIUS,
  SPEED_BOOST_MULTIPLIER,
  COMBAT_MIN_SIZE,
} from 'shared';
import { PICKUP_TYPE_GROWTH, PICKUP_TYPE_SPEED } from 'shared';
import {
  INPUT_LEFT,
  INPUT_RIGHT,
  INPUT_UP,
  INPUT_DOWN,
  encodeInput,
  decodeSnapshot,
  MSG_SNAPSHOT,
} from 'shared';
import type { GameSnapshot, PlayerState, PetState, AdoptionZoneState, PickupState } from 'shared';
import {
  playMusic,
  playWelcome,
  playPickupGrowth,
  playPickupSpeed,
  playAdoption,
  playStrayCollected,
  playMatchEnd,
  playAttackWarning,
  getMusicEnabled,
  setMusicEnabled,
  getSfxEnabled,
  setSfxEnabled,
} from './audio';

const SIGNALING_URL = (() => {
  const { protocol, host } = window.location;
  const wsProtocol = protocol === 'https:' ? 'wss:' : 'ws:';
  return `${wsProtocol}//${host}/ws-signaling`;
})();

// --- Input state ---
let inputFlags = 0;
let inputSeq = 0;
const keys: Record<string, boolean> = {};

// --- Virtual joystick state ---
let joystickActive = false;
let joystickOriginX = 0;
let joystickOriginY = 0;
let joystickCurrentX = 0;
let joystickCurrentY = 0;
const JOYSTICK_DEADZONE = 15; // pixels from center before movement starts
const JOYSTICK_MAX_RADIUS = 60; // max visual radius

// --- Network ---
let gameWs: WebSocket | null = null;
let myPlayerId: string | null = null;

// --- Game state (from server + interpolation) ---
let latestSnapshot: GameSnapshot | null = null;
const interpolatedPlayers = new Map<string, { prev: PlayerState; next: PlayerState; t: number }>();
const interpolatedPets = new Map<string, { prev: PetState; next: PetState; t: number }>();
const INTERP_BUFFER_MS = 100;

// --- Local prediction (for my player) ---
let predictedPlayer: PlayerState | null = null;
let lastProcessedInputSeq = -1;
let lastKnownSize = 0;
let lastTotalAdoptions = 0;
let lastPetsInsideLength = 0;
let lastSpeedBoostUntil = 0;
let matchEndPlayed = false;
let growthPopUntil = 0;
let currentRttMs = 0;
let highLatencySince = 0;
let pingIntervalId: ReturnType<typeof setInterval> | null = null;
const RTT_HIGH_MS = 200;
const RTT_HIGH_DURATION_MS = 5000;

// --- Render ---
const canvas = document.getElementById('game') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;
const minimap = document.getElementById('minimap') as HTMLCanvasElement;
const minimapCtx = minimap.getContext('2d')!;
const scoreEl = document.getElementById('score')!;
const carriedEl = document.getElementById('carried')!;
const tagCooldownEl = document.getElementById('tag-cooldown')!;
const timerEl = document.getElementById('timer')!;
const leaderboardEl = document.getElementById('leaderboard')!;
const connectionOverlayEl = document.getElementById('connection-overlay')!;
const howToPlayEl = document.getElementById('how-to-play')!;
const settingsBtnEl = document.getElementById('settings-btn')!;
const settingsPanelEl = document.getElementById('settings-panel')!;
const musicToggleEl = document.getElementById('music-toggle') as HTMLInputElement;
const sfxToggleEl = document.getElementById('sfx-toggle') as HTMLInputElement;
const settingsCloseEl = document.getElementById('settings-close')!;
const pingEl = document.getElementById('ping')!;
const switchServerEl = document.getElementById('switch-server')!;
const switchServerBtnEl = document.getElementById('switch-server-btn')!;
const authAreaEl = document.getElementById('auth-area')!;
const landingEl = document.getElementById('landing')!;
const gameWrapEl = document.getElementById('game-wrap')!;
const landingPlayBtn = document.getElementById('landing-play')!;
const landingNickInput = document.getElementById('landing-nick') as HTMLInputElement;
const landingMusicToggleEl = document.getElementById('landing-music-toggle') as HTMLInputElement | null;
const landingProfileName = document.getElementById('landing-profile-name')!;
const landingProfileAvatar = document.getElementById('landing-profile-avatar')!;
const landingProfileActions = document.getElementById('landing-profile-actions')!;
const landingAuthButtons = document.getElementById('landing-auth-buttons')!;
const cookieBannerEl = document.getElementById('cookie-banner')!;
const cookieAcceptBtn = document.getElementById('cookie-accept')!;
const cookieEssentialBtn = document.getElementById('cookie-essential')!;
const fightAllyOverlayEl = document.getElementById('fight-ally-overlay')!;
const fightAllyNameEl = document.getElementById('fight-ally-name')!;
const fightAllyFightBtn = document.getElementById('fight-ally-fight')!;
const fightAllyAllyBtn = document.getElementById('fight-ally-ally')!;
const cpuWarningEl = document.getElementById('cpu-warning')!;
const lobbyOverlayEl = document.getElementById('lobby-overlay')!;
const lobbyMessageEl = document.getElementById('lobby-message')!;
const lobbyCountdownEl = document.getElementById('lobby-countdown')!;
const lobbyReadyBtnEl = document.getElementById('lobby-ready-btn')!;
const lobbyBackBtnEl = document.getElementById('lobby-back-btn')!;

const COOKIE_CONSENT_KEY = 'cookieConsent';
const MODE_KEY = 'rescueworld_mode';
let fightAllyTargetId: string | null = null;
const fightAllyChosenTargets = new Set<string>();
let lastAttackWarnTime = 0;
const ATTACK_WARN_COOLDOWN_MS = 2000;
type MatchPhase = 'lobby' | 'countdown' | 'playing';
let matchPhase: MatchPhase = 'playing';
let countdownRemainingSec = 0;
let readyCount = 0;
let iAmReady = false;
const MONEY_KEY = 'rescueworld_money';
const BOOST_PRICES = { size: 50, speed: 30, adoptSpeed: 40 } as const;

type AuthMe = { displayName: string | null; signedIn: boolean };
let selectedMode: 'ffa' | 'teams' | 'solo' = 'ffa';
const pendingBoosts = { sizeBonus: 0, speedBoost: false, adoptSpeed: false };
let currentDisplayName: string | null = null;
let isSignedIn = false;

function getMoney(): number {
  return parseInt(localStorage.getItem(MONEY_KEY) || '0', 10);
}
function setMoney(n: number): void {
  localStorage.setItem(MONEY_KEY, String(Math.max(0, n)));
}
function updateLandingMoney(): void {
  const el = document.getElementById('landing-money');
  if (el) el.textContent = `Money: ${getMoney()}`;
  const m = getMoney();
  document.querySelectorAll('.landing-buy').forEach((btn) => {
    const b = (btn as HTMLElement).dataset.boost as keyof typeof BOOST_PRICES;
    if (!b || !(b in BOOST_PRICES)) return;
    const price = BOOST_PRICES[b as keyof typeof BOOST_PRICES];
    (btn as HTMLButtonElement).disabled = m < price || (b === 'speed' && pendingBoosts.speedBoost) || (b === 'adoptSpeed' && pendingBoosts.adoptSpeed);
  });
}

async function fetchAndRenderAuth(): Promise<void> {
  try {
    const res = await fetch('/auth/me', { credentials: 'include' });
    const data: AuthMe = await res.json();
    const { displayName, signedIn } = data;
    const name = displayName ?? '';
    currentDisplayName = name || null;
    isSignedIn = signedIn;
    if (signedIn && name) {
      authAreaEl.innerHTML = `
        <span class="auth-profile">${escapeHtml(name)}</span>
        <a href="/auth/signout" class="auth-link">Sign out</a>
      `;
      landingProfileName.textContent = name;
      landingProfileAvatar.textContent = name.charAt(0).toUpperCase();
      landingProfileActions.innerHTML = `<a href="/auth/signout" class="auth-link" style="font-size:12px">Sign out</a>`;
      landingAuthButtons.innerHTML = `<a href="/auth/google" class="auth-link" style="display:inline-block">Sign in with Google</a> <a href="#" id="landing-facebook" style="opacity:0.7">Sign in with Facebook</a>`;
      if (landingNickInput) landingNickInput.placeholder = name;
    } else {
      const guestLabel = name ? `${escapeHtml(name)}` : 'Guest';
      authAreaEl.innerHTML = `
        <a href="/auth/google" class="auth-link">Sign in with Google</a>
        <span class="auth-guest">${guestLabel}</span>
      `;
      landingProfileName.textContent = name || 'Guest';
      landingProfileAvatar.textContent = name ? name.charAt(0).toUpperCase() : '?';
      landingProfileActions.innerHTML = '';
      landingAuthButtons.innerHTML = `
        <a href="/auth/google">Sign in with Google</a>
        <a href="#" id="landing-facebook" style="opacity:0.7">Sign in with Facebook</a>
      `;
      if (landingNickInput) landingNickInput.placeholder = name || 'Nickname';
    }
    if (landingNickInput && name) landingNickInput.value = name;
  } catch {
    currentDisplayName = null;
    isSignedIn = false;
    authAreaEl.innerHTML = `
      <a href="/auth/google" class="auth-link">Sign in with Google</a>
      <span class="auth-guest">Guest</span>
    `;
    landingProfileName.textContent = 'Guest';
    landingProfileAvatar.textContent = '?';
    landingProfileActions.innerHTML = '';
    landingAuthButtons.innerHTML = `<a href="/auth/google">Sign in with Google</a> <a href="#" id="landing-facebook" style="opacity:0.7">Sign in with Facebook</a>`;
    if (landingNickInput) landingNickInput.placeholder = 'Nickname';
  }
}

async function getOrCreateDisplayName(): Promise<string> {
  // If user typed a nickname, use that
  const nickInput = landingNickInput?.value?.trim();
  if (nickInput) {
    currentDisplayName = nickInput;
    return nickInput;
  }
  // If we already have a name from /auth/me, use it
  if (currentDisplayName) {
    return currentDisplayName;
  }
  // Otherwise, create a guest name
  try {
    const res = await fetch('/auth/guest', { method: 'POST', credentials: 'include' });
    const data = await res.json();
    if (data.displayName) {
      currentDisplayName = data.displayName;
      // Update the UI
      landingProfileName.textContent = data.displayName;
      landingProfileAvatar.textContent = data.displayName.charAt(0).toUpperCase();
      return data.displayName;
    }
  } catch {
    // Fallback to random name
  }
  const fallback = `rescue${Date.now().toString(36)}`;
  currentDisplayName = fallback;
  return fallback;
}

function escapeHtml(s: string): string {
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}

function resize(): void {
  const w = window.innerWidth;
  const h = window.innerHeight;
  canvas.width = w;
  canvas.height = h;
}

// --- Input handling ---
function setInputFlag(flag: number, on: boolean): void {
  if (on) inputFlags |= flag;
  else inputFlags &= ~flag;
}

function onKeyDown(e: KeyboardEvent): void {
  keys[e.code] = true;
  if (e.code === 'KeyW' || e.code === 'ArrowUp') setInputFlag(INPUT_UP, true);
  if (e.code === 'KeyS' || e.code === 'ArrowDown') setInputFlag(INPUT_DOWN, true);
  if (e.code === 'KeyA' || e.code === 'ArrowLeft') setInputFlag(INPUT_LEFT, true);
  if (e.code === 'KeyD' || e.code === 'ArrowRight') setInputFlag(INPUT_RIGHT, true);
  e.preventDefault();
}

function onKeyUp(e: KeyboardEvent): void {
  keys[e.code] = false;
  if (e.code === 'KeyW' || e.code === 'ArrowUp') setInputFlag(INPUT_UP, false);
  if (e.code === 'KeyS' || e.code === 'ArrowDown') setInputFlag(INPUT_DOWN, false);
  if (e.code === 'KeyA' || e.code === 'ArrowLeft') setInputFlag(INPUT_LEFT, false);
  if (e.code === 'KeyD' || e.code === 'ArrowRight') setInputFlag(INPUT_RIGHT, false);
  e.preventDefault();
}

function hasMovementKeyDown(): boolean {
  return !!(keys['KeyW'] || keys['KeyS'] || keys['KeyA'] || keys['KeyD'] ||
    keys['ArrowUp'] || keys['ArrowDown'] || keys['ArrowLeft'] || keys['ArrowRight']);
}

function applyJoystickToInput(): void {
  if (hasMovementKeyDown()) return;
  if (!joystickActive) {
    // Clear all movement flags when joystick is inactive
    setInputFlag(INPUT_LEFT, false);
    setInputFlag(INPUT_RIGHT, false);
    setInputFlag(INPUT_UP, false);
    setInputFlag(INPUT_DOWN, false);
    return;
  }
  const dx = joystickCurrentX - joystickOriginX;
  const dy = joystickCurrentY - joystickOriginY;
  const dist = Math.hypot(dx, dy);
  
  if (dist < JOYSTICK_DEADZONE) {
    // Inside deadzone - no movement
    setInputFlag(INPUT_LEFT, false);
    setInputFlag(INPUT_RIGHT, false);
    setInputFlag(INPUT_UP, false);
    setInputFlag(INPUT_DOWN, false);
    return;
  }
  
  // Normalize direction
  const nx = dx / dist;
  const ny = dy / dist;
  
  // Apply input based on direction (threshold at 0.3 for diagonal support)
  setInputFlag(INPUT_LEFT, nx < -0.3);
  setInputFlag(INPUT_RIGHT, nx > 0.3);
  setInputFlag(INPUT_UP, ny < -0.3);
  setInputFlag(INPUT_DOWN, ny > 0.3);
}

canvas.addEventListener('touchstart', (e) => {
  e.preventDefault();
  if (e.touches.length) {
    joystickActive = true;
    joystickOriginX = e.touches[0].clientX;
    joystickOriginY = e.touches[0].clientY;
    joystickCurrentX = joystickOriginX;
    joystickCurrentY = joystickOriginY;
  }
}, { passive: false });

canvas.addEventListener('touchmove', (e) => {
  e.preventDefault();
  if (e.touches.length && joystickActive) {
    joystickCurrentX = e.touches[0].clientX;
    joystickCurrentY = e.touches[0].clientY;
  }
}, { passive: false });

function sendInputImmediately(): void {
  if (gameWs?.readyState === WebSocket.OPEN) {
    const buf = encodeInput(inputFlags, inputSeq++);
    gameWs.send(buf);
  }
}

canvas.addEventListener('touchend', (e) => {
  e.preventDefault();
  if (e.touches.length === 0) {
    joystickActive = false;
    // Immediately clear input flags and send to server
    setInputFlag(INPUT_LEFT, false);
    setInputFlag(INPUT_RIGHT, false);
    setInputFlag(INPUT_UP, false);
    setInputFlag(INPUT_DOWN, false);
    sendInputImmediately(); // Send stop immediately to prevent momentum
  }
}, { passive: false });

canvas.addEventListener('touchcancel', (e) => {
  e.preventDefault();
  joystickActive = false;
  setInputFlag(INPUT_LEFT, false);
  setInputFlag(INPUT_RIGHT, false);
  setInputFlag(INPUT_UP, false);
  setInputFlag(INPUT_DOWN, false);
  sendInputImmediately(); // Send stop immediately to prevent momentum
}, { passive: false });
canvas.addEventListener('mousedown', (e) => {
  e.preventDefault();
});
canvas.addEventListener('mousemove', (e) => {
  e.preventDefault();
});
canvas.addEventListener('mouseup', (e) => {
  e.preventDefault();
});
canvas.addEventListener('contextmenu', (e) => {
  e.preventDefault();
});
window.addEventListener('keydown', onKeyDown);
window.addEventListener('keyup', onKeyUp);

// --- Minimap click/drag to pan camera ---
let minimapDragging = false;

function panCameraToMinimapPos(clientX: number, clientY: number): void {
  const rect = minimap.getBoundingClientRect();
  const clickX = clientX - rect.left;
  const clickY = clientY - rect.top;
  const scale = MAP_WIDTH / 120; // minimap is 120px, map is MAP_WIDTH
  const worldX = clickX * scale;
  const worldY = clickY * scale;
  // Set camera offset to center view on clicked world position
  const playerX = predictedPlayer?.x ?? MAP_WIDTH / 2;
  const playerY = predictedPlayer?.y ?? MAP_HEIGHT / 2;
  cameraPanOffsetX = worldX - playerX;
  cameraPanOffsetY = worldY - playerY;
}

minimap.addEventListener('mousedown', (e) => {
  e.preventDefault();
  minimapDragging = true;
  panCameraToMinimapPos(e.clientX, e.clientY);
});

minimap.addEventListener('mousemove', (e) => {
  if (minimapDragging) {
    panCameraToMinimapPos(e.clientX, e.clientY);
  }
});

minimap.addEventListener('mouseup', () => {
  minimapDragging = false;
});

minimap.addEventListener('mouseleave', () => {
  minimapDragging = false;
});

// Touch support for minimap drag
minimap.addEventListener('touchstart', (e) => {
  e.preventDefault();
  minimapDragging = true;
  if (e.touches.length > 0) {
    panCameraToMinimapPos(e.touches[0].clientX, e.touches[0].clientY);
  }
}, { passive: false });

minimap.addEventListener('touchmove', (e) => {
  if (minimapDragging && e.touches.length > 0) {
    e.preventDefault();
    panCameraToMinimapPos(e.touches[0].clientX, e.touches[0].clientY);
  }
}, { passive: false });

minimap.addEventListener('touchend', () => {
  minimapDragging = false;
});

minimap.addEventListener('touchcancel', () => {
  minimapDragging = false;
});

// --- Camera (follow local player, smoothed; pannable by drag) ---
let cameraSmoothedX: number | null = null;
let cameraSmoothedY: number | null = null;
const CAMERA_SMOOTH = 0.22;
let cameraPanOffsetX = 0;
let cameraPanOffsetY = 0;
const PAN_THRESHOLD_PX = 10;
let isPanning = false;
let panStartClientX = 0;
let panStartClientY = 0;
let lastPanClientX = 0;
let lastPanClientY = 0;

// --- Local player display position (smoothed so shelter doesn't snap on server updates) ---
let playerDisplayX: number | null = null;
let playerDisplayY: number | null = null;
const PLAYER_DISPLAY_SMOOTH = 0.28; // lerp toward predicted position per frame

function getCamera(): { x: number; y: number; w: number; h: number } {
  const w = canvas.width;
  const h = canvas.height;
  let px = predictedPlayer?.x ?? MAP_WIDTH / 2;
  let py = predictedPlayer?.y ?? MAP_HEIGHT / 2;
  if (!Number.isFinite(px) || !Number.isFinite(py)) {
    px = MAP_WIDTH / 2;
    py = MAP_HEIGHT / 2;
  }
  let targetX = px - w / 2 + cameraPanOffsetX;
  let targetY = py - h / 2 + cameraPanOffsetY;
  targetX = Math.max(0, Math.min(MAP_WIDTH - w, targetX));
  targetY = Math.max(0, Math.min(MAP_HEIGHT - h, targetY));
  if (predictedPlayer == null) {
    cameraSmoothedX = null;
    cameraSmoothedY = null;
    return { x: targetX, y: targetY, w, h };
  }
  if (cameraSmoothedX == null || cameraSmoothedY == null || !Number.isFinite(cameraSmoothedX) || !Number.isFinite(cameraSmoothedY)) {
    cameraSmoothedX = targetX;
    cameraSmoothedY = targetY;
  } else {
    cameraSmoothedX += (targetX - cameraSmoothedX) * CAMERA_SMOOTH;
    cameraSmoothedY += (targetY - cameraSmoothedY) * CAMERA_SMOOTH;
  }
  let cx = cameraSmoothedX;
  let cy = cameraSmoothedY;
  if (!Number.isFinite(cx) || !Number.isFinite(cy)) {
    cx = targetX;
    cy = targetY;
    cameraSmoothedX = cx;
    cameraSmoothedY = cy;
  }
  cx = Math.max(0, Math.min(MAP_WIDTH - w, cx));
  cy = Math.max(0, Math.min(MAP_HEIGHT - h, cy));
  return { x: cx, y: cy, w, h };
}

function applyPanDelta(deltaScreenX: number, deltaScreenY: number): void {
  cameraPanOffsetX -= deltaScreenX;
  cameraPanOffsetY -= deltaScreenY;
  const w = canvas.width;
  const h = canvas.height;
  const px = predictedPlayer?.x ?? MAP_WIDTH / 2;
  const py = predictedPlayer?.y ?? MAP_HEIGHT / 2;
  const maxX = Math.max(0, MAP_WIDTH - w);
  const maxY = Math.max(0, MAP_HEIGHT - h);
  const minOffsetX = -(px - w / 2);
  const maxOffsetX = maxX - (px - w / 2);
  const minOffsetY = -(py - h / 2);
  const maxOffsetY = maxY - (py - h / 2);
  cameraPanOffsetX = Math.max(minOffsetX, Math.min(maxOffsetX, cameraPanOffsetX));
  cameraPanOffsetY = Math.max(minOffsetY, Math.min(maxOffsetY, cameraPanOffsetY));
}

// --- Prediction: advance by one server tick (used when sending input) ---
function predictPlayerTick(p: PlayerState, inputFlags: number): PlayerState {
  return predictPlayerByDt(p, inputFlags, 1 / TICK_RATE);
}

// --- Prediction: advance by dt seconds (per-frame for smooth camera) ---
function predictPlayerByDt(p: PlayerState, inputFlags: number, dtSec: number): PlayerState {
  let dx = 0,
    dy = 0;
  if (inputFlags & INPUT_LEFT) dx -= 1;
  if (inputFlags & INPUT_RIGHT) dx += 1;
  if (inputFlags & INPUT_UP) dy -= 1;
  if (inputFlags & INPUT_DOWN) dy += 1;
  let vx = 0,
    vy = 0;
  if (dx !== 0 || dy !== 0) {
    const len = Math.hypot(dx, dy) || 1;
    const speed = (p.speedBoostUntil ?? 0) > 0 ? SHELTER_SPEED * SPEED_BOOST_MULTIPLIER : SHELTER_SPEED;
    const step = speed * dtSec;
    vx = (dx / len) * step;
    vy = (dy / len) * step;
  }
  const radius = SHELTER_BASE_RADIUS + p.size * SHELTER_RADIUS_PER_SIZE;
  let x = p.x + vx;
  let y = p.y + vy;
  x = Math.max(radius, Math.min(MAP_WIDTH - radius, x));
  y = Math.max(radius, Math.min(MAP_HEIGHT - radius, y));
  return {
    ...p,
    x,
    y,
    vx,
    vy,
    petsInside: [...p.petsInside],
    speedBoostUntil: p.speedBoostUntil ?? 0,
  };
}

const CONNECT_TIMEOUT_MS = 10000;

function showConnectionError(message: string): void {
  connectionOverlayEl.classList.remove('hidden');
  connectionOverlayEl.innerHTML = `
    <h2>Could not connect</h2>
    <p class="error">${message}</p>
    <p>The game server is not running or not reachable.</p>
    <p><strong>To start the game:</strong></p>
    <p>From the project root folder, run: <code>npm run dev</code></p>
    <p>That starts both the server (ports 4000, 4001) and the client. Wait a few seconds, then refresh this page.</p>
    <p>Or run in two terminals: first <code>npm run dev:server</code>, then <code>npm run dev:client</code>.</p>
  `;
}

// --- Connect flow ---
async function connect(options?: { latency?: number; mode?: 'ffa' | 'teams' | 'solo' }): Promise<void> {
  if (pingIntervalId) {
    clearInterval(pingIntervalId);
    pingIntervalId = null;
  }
  switchServerEl.classList.add('hidden');
  const isLocalhost = (url: string) => /^wss?:\/\/localhost(\b|:|\/|$)/i.test(url) || /^wss?:\/\/127\.0\.0\.1(\b|:|\/|$)/i.test(url);
  const gameUrlFromPage = () => {
    const { protocol, host } = window.location;
    const wsProtocol = protocol === 'https:' ? 'wss:' : 'ws:';
    return `${wsProtocol}//${host}/ws-game`;
  };
  let gameUrl = isLocalhost(window.location.href) ? 'ws://localhost:4001' : gameUrlFromPage();
  const ws = new WebSocket(SIGNALING_URL);
  await new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => {
      ws.close();
      reject(new Error('Connection timeout. Is the server running? Run: npm run dev'));
    }, CONNECT_TIMEOUT_MS);
    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'join', latency: options?.latency, mode: options?.mode ?? 'ffa' }));
    };
    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === 'joined' && msg.gameUrl) {
          clearTimeout(t);
          gameUrl = msg.gameUrl;
          if (!isLocalhost(window.location.href) && isLocalhost(gameUrl)) gameUrl = gameUrlFromPage();
          resolve();
        }
      } catch {
        // ignore
      }
    };
    ws.onerror = () => {
      clearTimeout(t);
      reject(new Error('WebSocket error. Server not running?'));
    };
    ws.onclose = () => {
      clearTimeout(t);
      if (ws.readyState !== WebSocket.OPEN) reject(new Error('Signaling connection closed. Run: npm run dev'));
    };
  });
  const gameWsLocal = new WebSocket(gameUrl);
  gameWsLocal.binaryType = 'arraybuffer';
  gameWsLocal.onopen = async () => {
    gameWs = gameWsLocal;
    const displayName = await getOrCreateDisplayName();
    gameWs.send(JSON.stringify({ type: 'mode', mode: options?.mode ?? 'ffa', displayName }));
    if (pendingBoosts.sizeBonus > 0 || pendingBoosts.speedBoost || pendingBoosts.adoptSpeed) {
      gameWs.send(JSON.stringify({
        type: 'startingBoosts',
        sizeBonus: pendingBoosts.sizeBonus,
        speedBoost: pendingBoosts.speedBoost,
        adoptSpeed: pendingBoosts.adoptSpeed,
      }));
      pendingBoosts.sizeBonus = 0;
      pendingBoosts.speedBoost = false;
      pendingBoosts.adoptSpeed = false;
    }
  };
  gameWsLocal.onmessage = (e) => {
    if (typeof e.data === 'string') {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === 'welcome' && msg.playerId) {
          myPlayerId = msg.playerId;
          playWelcome();
        }
        if (msg.type === 'matchState' && typeof msg.phase === 'string') {
          matchPhase = msg.phase as MatchPhase;
          countdownRemainingSec = typeof msg.countdownRemainingSec === 'number' ? msg.countdownRemainingSec : 0;
          readyCount = typeof msg.readyCount === 'number' ? msg.readyCount : 0;
          if (matchPhase === 'lobby') {
            if (selectedMode === 'solo') {
              lobbyOverlayEl.classList.add('hidden');
            } else {
              lobbyOverlayEl.classList.remove('hidden');
              lobbyMessageEl.textContent = 'Waiting for another player…';
              lobbyCountdownEl.classList.add('hidden');
              lobbyReadyBtnEl.classList.add('hidden');
            }
          } else if (matchPhase === 'countdown') {
            lobbyOverlayEl.classList.remove('hidden');
            lobbyMessageEl.textContent = 'Match starting soon';
            lobbyCountdownEl.classList.remove('hidden');
            lobbyCountdownEl.textContent = countdownRemainingSec > 0 ? `Starting in ${countdownRemainingSec}s…` : 'Starting…';
            lobbyReadyBtnEl.classList.remove('hidden');
            if (iAmReady) lobbyReadyBtnEl.textContent = 'Ready!';
            else lobbyReadyBtnEl.textContent = 'Ready';
          } else {
            lobbyOverlayEl.classList.add('hidden');
          }
        }
        if (msg.type === 'pong' && typeof msg.ts === 'number') {
          currentRttMs = Math.round(Date.now() - msg.ts);
          if (currentRttMs > RTT_HIGH_MS) highLatencySince = highLatencySince || Date.now();
          else highLatencySince = 0;
        }
      } catch {
        // ignore
      }
      return;
    }
    const buf = e.data as ArrayBuffer;
    if (buf.byteLength < 1) return;
    if (new DataView(buf).getUint8(0) === MSG_SNAPSHOT) {
      const snap = decodeSnapshot(buf);
      latestSnapshot = snap;
      if (matchPhase !== 'playing') {
        matchPhase = 'playing';
        lobbyOverlayEl.classList.add('hidden');
      }
      for (const p of snap.players) {
        const prev = interpolatedPlayers.get(p.id)?.next ?? p;
        interpolatedPlayers.set(p.id, { prev, next: { ...p }, t: 0 });
      }
      for (const pet of snap.pets) {
        const prev = interpolatedPets.get(pet.id)?.next ?? pet;
        interpolatedPets.set(pet.id, { prev, next: { ...pet }, t: 0 });
      }
      const me = snap.players.find((q) => q.id === myPlayerId);
      if (me) {
        if (me.size > lastKnownSize) {
          growthPopUntil = Date.now() + 1500;
          playPickupGrowth();
        }
        if ((me.speedBoostUntil ?? 0) > lastSpeedBoostUntil) playPickupSpeed();
        lastSpeedBoostUntil = me.speedBoostUntil ?? 0;
        if (me.totalAdoptions > lastTotalAdoptions) playAdoption();
        lastTotalAdoptions = me.totalAdoptions;
        if (me.petsInside.length > lastPetsInsideLength) playStrayCollected();
        lastPetsInsideLength = me.petsInside.length;
        lastKnownSize = me.size;
        const prevX = predictedPlayer?.x ?? me.x;
        const prevY = predictedPlayer?.y ?? me.y;
        predictedPlayer = { ...me, petsInside: [...me.petsInside] };
        lastProcessedInputSeq = me.inputSeq;
        const jump = Math.hypot(me.x - prevX, me.y - prevY);
        if (jump > 300) {
          cameraSmoothedX = null;
          cameraSmoothedY = null;
          cameraPanOffsetX = 0;
          cameraPanOffsetY = 0;
          playerDisplayX = me.x;
          playerDisplayY = me.y;
        }
      }
    }
  };
  gameWsLocal.onclose = () => {
    gameWs = null;
    myPlayerId = null;
    latestSnapshot = null;
    predictedPlayer = null;
    matchPhase = 'playing';
    iAmReady = false;
  };
  await new Promise<void>((resolve, reject) => {
    const deadline = Date.now() + CONNECT_TIMEOUT_MS;
    const check = () => {
      if (gameWs?.readyState === WebSocket.OPEN) resolve();
      else if (Date.now() > deadline) reject(new Error('Game server connection timeout'));
      else setTimeout(check, 50);
    };
    check();
  });
  connectionOverlayEl.classList.add('hidden');
  howToPlayEl.classList.remove('hidden');
  setTimeout(() => howToPlayEl.classList.add('hidden'), 12000);
  playMusic();
  pingIntervalId = setInterval(() => {
    if (gameWs?.readyState === WebSocket.OPEN) {
      gameWs.send(JSON.stringify({ type: 'ping', ts: Date.now() }));
    }
  }, 2000);
}

// --- Tick: send input at server tick rate, advance prediction every frame for smooth camera ---
let lastTickTime = 0;
let lastInputSendTime = 0;
function tick(now: number): void {
  if (!lastTickTime) lastTickTime = now;
  const dt = Math.min((now - lastTickTime) / 1000, 0.1);
  lastTickTime = now;

  applyJoystickToInput();

  const matchOver = latestSnapshot != null && latestSnapshot.matchEndAt > 0 && latestSnapshot.tick >= latestSnapshot.matchEndAt;
  const meForActive = latestSnapshot?.players.find((p) => p.id === myPlayerId);
  const gameActive = matchPhase === 'playing' && !matchOver && !meForActive?.eliminated;

  // Send input at server tick rate (only when match is playing and not over)
  if (gameActive && gameWs?.readyState === WebSocket.OPEN && now - lastInputSendTime >= TICK_MS) {
    lastInputSendTime = now;
    const buf = encodeInput(inputFlags, inputSeq++);
    gameWs.send(buf);
  }

  // Advance local player prediction every frame (smooth movement and camera) — freeze when lobby/countdown or match over
  if (gameActive && predictedPlayer && myPlayerId) {
    const prevX = predictedPlayer.x;
    const prevY = predictedPlayer.y;
    predictedPlayer = predictPlayerByDt(predictedPlayer, inputFlags, dt);
    const myR = SHELTER_BASE_RADIUS + predictedPlayer.size * SHELTER_RADIUS_PER_SIZE;
    if (latestSnapshot) {
      for (const pl of latestSnapshot.players) {
        if (pl.id === myPlayerId) continue;
        const other = getInterpolatedPlayer(pl.id) ?? pl;
        const or = SHELTER_BASE_RADIUS + other.size * SHELTER_RADIUS_PER_SIZE;
        const overlap =
          Math.abs(predictedPlayer.x - other.x) <= myR + or && Math.abs(predictedPlayer.y - other.y) <= myR + or;
        if (overlap) {
          predictedPlayer = { ...predictedPlayer, x: prevX, y: prevY };
          break;
        }
      }
    }
    // Smoothed display position so shelter doesn't jitter when server snapshots overwrite predictedPlayer
    let tx = predictedPlayer.x;
    let ty = predictedPlayer.y;
    if (!Number.isFinite(tx) || !Number.isFinite(ty)) {
      tx = MAP_WIDTH / 2;
      ty = MAP_HEIGHT / 2;
    }
    if (playerDisplayX == null || playerDisplayY == null) {
      playerDisplayX = tx;
      playerDisplayY = ty;
    } else {
      playerDisplayX += (tx - playerDisplayX) * PLAYER_DISPLAY_SMOOTH;
      playerDisplayY += (ty - playerDisplayY) * PLAYER_DISPLAY_SMOOTH;
    }
    if (!Number.isFinite(playerDisplayX) || !Number.isFinite(playerDisplayY)) {
      playerDisplayX = tx;
      playerDisplayY = ty;
    }
    // Show Fight/Ally when my shelter overlaps another HUMAN player — AABB to match server
    // Show CPU warning when overlapping a CPU (no prompt)
    let overlappingId: string | null = null;
    let cpuOverlapping = false;
    if (latestSnapshot) {
      const myX = playerDisplayX ?? predictedPlayer.x;
      const myY = playerDisplayY ?? predictedPlayer.y;
      const mySize = predictedPlayer.size;
      const myR = SHELTER_BASE_RADIUS + mySize * SHELTER_RADIUS_PER_SIZE;
      for (const pl of latestSnapshot.players) {
        if (pl.id === myPlayerId) continue;
        const other = getInterpolatedPlayer(pl.id) ?? pl;
        const or = SHELTER_BASE_RADIUS + other.size * SHELTER_RADIUS_PER_SIZE;
        const overlap = Math.abs(myX - other.x) <= myR + or && Math.abs(myY - other.y) <= myR + or;
        if (!overlap) continue;
        // Combat only starts at size 4+
        if (mySize < COMBAT_MIN_SIZE || other.size < COMBAT_MIN_SIZE) continue;
        if (pl.id.startsWith('cpu-')) {
          cpuOverlapping = true;
          continue;
        }
        if (!fightAllyChosenTargets.has(pl.id)) {
          overlappingId = pl.id;
          break;
        }
      }
    }
    if (overlappingId) {
      const other = latestSnapshot!.players.find((p) => p.id === overlappingId);
      fightAllyTargetId = overlappingId;
      fightAllyNameEl.textContent = other?.displayName ?? overlappingId;
      const wasHidden = fightAllyOverlayEl.classList.contains('hidden');
      fightAllyOverlayEl.classList.remove('hidden');
      // Play attack warning when first showing human fight overlay
      if (wasHidden && Date.now() - lastAttackWarnTime > ATTACK_WARN_COOLDOWN_MS) {
        lastAttackWarnTime = Date.now();
        playAttackWarning();
      }
    } else {
      fightAllyOverlayEl.classList.add('hidden');
      fightAllyTargetId = null;
      // Reset choices when not overlapping anyone - allows changing mind on next encounter
      fightAllyChosenTargets.clear();
    }
    if (cpuOverlapping) {
      const wasHidden = cpuWarningEl.classList.contains('hidden');
      cpuWarningEl.classList.remove('hidden');
      // Play attack warning when first showing CPU warning
      if (wasHidden && Date.now() - lastAttackWarnTime > ATTACK_WARN_COOLDOWN_MS) {
        lastAttackWarnTime = Date.now();
        playAttackWarning();
      }
    } else {
      cpuWarningEl.classList.add('hidden');
    }
  } else {
    playerDisplayX = null;
    playerDisplayY = null;
    fightAllyOverlayEl.classList.add('hidden');
    fightAllyTargetId = null;
    cpuWarningEl.classList.add('hidden');
  }

  const interpStep = dt * (1000 / INTERP_BUFFER_MS);
  for (const entry of interpolatedPlayers.values()) {
    entry.t = Math.min(1, entry.t + interpStep);
  }
  for (const entry of interpolatedPets.values()) {
    entry.t = Math.min(1, entry.t + interpStep);
  }

  render(dt);
  requestAnimationFrame(tick);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function getInterpolatedPlayer(id: string): PlayerState | null {
  const entry = interpolatedPlayers.get(id);
  if (!entry) return null;
  const t = entry.t;
  return {
    ...entry.next,
    x: lerp(entry.prev.x, entry.next.x, t),
    y: lerp(entry.prev.y, entry.next.y, t),
    vx: lerp(entry.prev.vx, entry.next.vx, t),
    vy: lerp(entry.prev.vy, entry.next.vy, t),
  };
}

function getInterpolatedPet(id: string): PetState | null {
  const entry = interpolatedPets.get(id);
  if (!entry) return null;
  const t = entry.t;
  return {
    ...entry.next,
    x: lerp(entry.prev.x, entry.next.x, t),
    y: lerp(entry.prev.y, entry.next.y, t),
  };
}

// --- World rendering (agar.io / territorial.io style) ---
const DOT_SPACING = 36;
const DOT_R = 1.8;

function hashColor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  const hue = (h % 360);
  return `hsl(${hue}, 72%, 58%)`;
}

function drawMapBackground(cam: { x: number; y: number; w: number; h: number }): void {
  const pad = DOT_SPACING * 2;
  const x0 = Math.floor((cam.x - pad) / DOT_SPACING) * DOT_SPACING;
  const y0 = Math.floor((cam.y - pad) / DOT_SPACING) * DOT_SPACING;
  const x1 = Math.ceil((cam.x + cam.w + pad) / DOT_SPACING) * DOT_SPACING;
  const y1 = Math.ceil((cam.y + cam.h + pad) / DOT_SPACING) * DOT_SPACING;
  ctx.fillStyle = '#3d6b3d';
  ctx.fillRect(cam.x, cam.y, cam.w, cam.h);
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  for (let yy = y0; yy <= y1; yy += DOT_SPACING) {
    for (let xx = x0; xx <= x1; xx += DOT_SPACING) {
      ctx.fillRect(xx - DOT_R, yy - DOT_R, DOT_R * 2, DOT_R * 2);
    }
  }
}

function drawAdoptionZone(z: AdoptionZoneState): void {
  const cx = z.x;
  const cy = z.y;
  const r = z.radius;
  ctx.save();
  ctx.strokeStyle = 'rgba(123, 237, 159, 0.6)';
  ctx.lineWidth = 4;
  ctx.setLineDash([8, 8]);
  ctx.strokeRect(cx - r, cy - r, r * 2, r * 2);
  ctx.setLineDash([]);
  ctx.fillStyle = 'rgba(74, 124, 89, 0.2)';
  ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
  ctx.fillStyle = '#7bed9f';
  ctx.font = 'bold 14px Rubik, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('ADOPTION CENTER', cx, cy - r - 8);
  ctx.fillText('Bring pets here to adopt out', cx, cy);
  ctx.restore();
}

function drawPlayerShelter(p: PlayerState, isMe: boolean): void {
  const half = SHELTER_BASE_RADIUS + p.size * SHELTER_RADIUS_PER_SIZE;
  const cx = p.x;
  const cy = p.y;
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.4)';
  ctx.shadowBlur = 10;
  const color = isMe ? '#7bed9f' : hashColor(p.id);
  ctx.fillStyle = color;
  ctx.fillRect(cx - half, cy - half, half * 2, half * 2);
  ctx.strokeStyle = isMe ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.5)';
  ctx.lineWidth = isMe ? 3 : 2;
  ctx.strokeRect(cx - half, cy - half, half * 2, half * 2);
  ctx.fillStyle = '#2d2d2d';
  ctx.font = 'bold 12px Rubik, sans-serif';
  ctx.textAlign = 'center';
  const label = isMe ? 'You' : (p.displayName ?? p.id);
  ctx.fillText(label, cx, cy - half - 6);
  ctx.fillText(`Pets: ${p.petsInside.length}/${Math.floor(p.size)}`, cx, cy + 4);
  ctx.restore();
}

function drawStray(x: number, y: number): void {
  ctx.save();
  ctx.fillStyle = '#c9a86c';
  ctx.beginPath();
  ctx.arc(x, y, PET_RADIUS, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#8B4513';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.font = '10px Rubik, sans-serif';
  ctx.fillStyle = '#333';
  ctx.textAlign = 'center';
  ctx.fillText('Stray', x, y + PET_RADIUS + 10);
  ctx.restore();
}

function drawPickup(u: PickupState): void {
  const isGrowth = u.type === PICKUP_TYPE_GROWTH;
  const h = GROWTH_ORB_RADIUS;
  ctx.save();
  ctx.fillStyle = isGrowth ? '#7bed9f' : '#70a3ff';
  ctx.fillRect(u.x - h, u.y - h, h * 2, h * 2);
  ctx.strokeStyle = isGrowth ? '#2d5a38' : '#2d4a6e';
  ctx.lineWidth = 2;
  ctx.strokeRect(u.x - h, u.y - h, h * 2, h * 2);
  ctx.fillStyle = '#333';
  ctx.font = '10px Rubik, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(isGrowth ? '+Size' : 'Speed', u.x, u.y + GROWTH_ORB_RADIUS + 10);
  ctx.restore();
}

function render(dt: number): void {
  try {
    const cam = getCamera();
    const camX = Number.isFinite(cam.x) ? Math.max(0, Math.min(MAP_WIDTH - cam.w, cam.x)) : 0;
    const camY = Number.isFinite(cam.y) ? Math.max(0, Math.min(MAP_HEIGHT - cam.h, cam.y)) : 0;
    const safeCam = { x: camX, y: camY, w: cam.w, h: cam.h };
    ctx.save();
    ctx.translate(-safeCam.x, -safeCam.y);
    drawMapBackground(safeCam);

  if (latestSnapshot) {
    for (const z of latestSnapshot.adoptionZones) {
      drawAdoptionZone(z);
    }
    for (const u of latestSnapshot.pickups ?? []) {
      drawPickup(u);
    }
  }

  for (const pet of latestSnapshot?.pets ?? []) {
    if (pet.insideShelterId !== null) continue;
    const p = getInterpolatedPet(pet.id) ?? pet;
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
    drawStray(p.x, p.y);
  }

  // Sort players by size so larger ones render on top
  const sortedPlayers = [...(latestSnapshot?.players ?? [])].sort((a, b) => a.size - b.size);
  for (const pl of sortedPlayers) {
    const isMe = pl.id === myPlayerId;
    let p: PlayerState;
    if (isMe && predictedPlayer) {
      // Use smoothed display position for local player so shelter doesn't snap on server updates
      let drawX = playerDisplayX ?? predictedPlayer.x;
      let drawY = playerDisplayY ?? predictedPlayer.y;
      if (!Number.isFinite(drawX) || !Number.isFinite(drawY)) {
        drawX = predictedPlayer.x;
        drawY = predictedPlayer.y;
      }
      if (!Number.isFinite(drawX) || !Number.isFinite(drawY)) {
        drawX = MAP_WIDTH / 2;
        drawY = MAP_HEIGHT / 2;
      }
      p = { ...predictedPlayer, x: drawX, y: drawY };
    } else {
      p = getInterpolatedPlayer(pl.id) ?? pl;
    }
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
    drawPlayerShelter(p, isMe);
    if (isMe && growthPopUntil > Date.now()) {
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      const sx = canvas.width / 2;
      const sy = canvas.height / 2 - 60;
      ctx.fillStyle = '#7bed9f';
      ctx.font = 'bold 28px Rubik, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('+1 Size!', sx, sy);
      ctx.restore();
    }
  }

  ctx.restore();

  const scale = 120 / MAP_WIDTH;
  minimapCtx.fillStyle = '#2d4a2d';
  minimapCtx.fillRect(0, 0, 120, 120);
  for (let yy = 0; yy <= MAP_HEIGHT; yy += DOT_SPACING * 3) {
    for (let xx = 0; xx <= MAP_WIDTH; xx += DOT_SPACING * 3) {
      minimapCtx.fillStyle = 'rgba(255,255,255,0.15)';
      minimapCtx.fillRect(xx * scale - 0.8, yy * scale - 0.8, 1.6, 1.6);
    }
  }
  if (latestSnapshot) {
    for (const z of latestSnapshot.adoptionZones) {
      const r = (z.radius * scale) | 0;
      minimapCtx.fillStyle = 'rgba(123, 237, 159, 0.6)';
      minimapCtx.fillRect(z.x * scale - r, z.y * scale - r, r * 2, r * 2);
    }
    for (const pet of latestSnapshot.pets) {
      if (pet.insideShelterId !== null) continue;
      minimapCtx.fillStyle = '#c9a86c';
      minimapCtx.fillRect(pet.x * scale - 2, pet.y * scale - 2, 4, 4);
    }
    for (const u of latestSnapshot.pickups ?? []) {
      minimapCtx.fillStyle = u.type === PICKUP_TYPE_GROWTH ? '#7bed9f' : '#70a3ff';
      minimapCtx.fillRect(u.x * scale - 2, u.y * scale - 2, 4, 4);
    }
    for (const pl of latestSnapshot.players) {
      minimapCtx.fillStyle = pl.id === myPlayerId ? '#7bed9f' : hashColor(pl.id);
      const r = (SHELTER_BASE_RADIUS + pl.size * SHELTER_RADIUS_PER_SIZE) * scale;
      const half = Math.max(2, r);
      minimapCtx.fillRect(pl.x * scale - half, pl.y * scale - half, half * 2, half * 2);
    }
  }
  // Draw viewport indicator on minimap
  const vpX = safeCam.x * scale;
  const vpY = safeCam.y * scale;
  const vpW = safeCam.w * scale;
  const vpH = safeCam.h * scale;
  minimapCtx.strokeStyle = 'rgba(255,255,255,0.6)';
  minimapCtx.lineWidth = 1.5;
  minimapCtx.strokeRect(vpX, vpY, vpW, vpH);
  
  minimapCtx.strokeStyle = 'rgba(255,255,255,0.2)';
  minimapCtx.lineWidth = 1;
  minimapCtx.strokeRect(0.5, 0.5, 119, 119);

  // Draw virtual joystick on main canvas when active
  if (joystickActive) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const originX = (joystickOriginX - rect.left) * scaleX;
    const originY = (joystickOriginY - rect.top) * scaleY;
    const currentX = (joystickCurrentX - rect.left) * scaleX;
    const currentY = (joystickCurrentY - rect.top) * scaleY;
    
    // Clamp joystick knob to max radius
    const dx = currentX - originX;
    const dy = currentY - originY;
    const dist = Math.hypot(dx, dy);
    const clampedDist = Math.min(dist, JOYSTICK_MAX_RADIUS * scaleX);
    const knobX = dist > 0 ? originX + (dx / dist) * clampedDist : originX;
    const knobY = dist > 0 ? originY + (dy / dist) * clampedDist : originY;
    
    // Outer ring (base)
    ctx.save();
    ctx.globalAlpha = 0.3;
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(originX, originY, JOYSTICK_MAX_RADIUS * scaleX, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.1)';
    ctx.fill();
    
    // Inner knob
    ctx.globalAlpha = 0.6;
    ctx.fillStyle = '#7bed9f';
    ctx.beginPath();
    ctx.arc(knobX, knobY, 20 * scaleX, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();
  }

  // UI
  const me = latestSnapshot?.players.find((p) => p.id === myPlayerId) ?? predictedPlayer;
  const capacity = me ? Math.floor(me.size) : 0;
  const inside = me?.petsInside.length ?? 0;
  const strayCount = latestSnapshot?.pets.filter((p) => p.insideShelterId === null).length ?? 0;
  scoreEl.textContent = `Size: ${capacity}`;
  carriedEl.textContent = `Pets: ${inside}/${capacity}`;
  const nowTick = latestSnapshot?.tick ?? 0;
  const tickRate = TICK_RATE;
  const speedBoostRemain = me && (me.speedBoostUntil ?? 0) > nowTick ? ((me.speedBoostUntil! - nowTick) / tickRate).toFixed(1) : '';
  if (tagCooldownEl) tagCooldownEl.textContent = me ? `Adoptions: ${me.totalAdoptions}  •  Strays: ${strayCount}${speedBoostRemain ? `  •  Speed: ${speedBoostRemain}s` : ''}` : '';
  const matchEndAt = latestSnapshot?.matchEndAt ?? 0;
  const remainingTicks = Math.max(0, matchEndAt - nowTick);
  const remainingSec = remainingTicks / tickRate;
  timerEl.textContent = remainingSec > 0 ? `${Math.floor(remainingSec / 60)}:${String(Math.floor(remainingSec % 60)).padStart(2, '0')}` : '0:00';
  const iAmEliminated = !!(me?.eliminated);
  if ((remainingSec <= 0 || iAmEliminated) && latestSnapshot?.players.length) {
    if (!matchEndPlayed) {
      matchEndPlayed = true;
      playMatchEnd();
    }
    leaderboardEl.classList.add('show');
    const sorted = [...latestSnapshot.players].sort((a, b) => b.size - a.size);
    const meResult = sorted.find((p) => p.id === myPlayerId);
    const mySize = meResult ? Math.floor(meResult.size) : 0;
    const placementBonus = [100, 50, 25];
    const myRank = meResult ? sorted.findIndex((p) => p.id === myPlayerId) + 1 : 0;
    const bonus = myRank > 0 && myRank <= placementBonus.length ? placementBonus[myRank - 1] : 0;
    const earned = iAmEliminated ? 0 : mySize + bonus;
    const newMoney = getMoney() + earned;
    if (remainingSec <= 0) setMoney(newMoney);
    const bonusLabel = myRank === 1 ? 'Win bonus' : myRank === 2 ? '2nd place' : myRank === 3 ? '3rd place' : myRank > 0 ? `${myRank}th place` : '';
    const moneyLines = earned > 0
      ? `<br><br><strong>Total: ${newMoney.toLocaleString()}</strong>${bonusLabel ? `<br>${bonusLabel}: +${bonus}` : ''}`
      : iAmEliminated
        ? `<br><br><strong>Total: ${getMoney().toLocaleString()}</strong>`
        : '';
    const title = iAmEliminated ? 'You were consumed' : 'Match over';
    leaderboardEl.innerHTML = `<strong>${title}</strong><br><br>` + sorted.map((p, i) => `${i + 1}. ${p.id === myPlayerId ? 'You' : (p.displayName ?? p.id)}: size ${Math.floor(p.size)} (${p.totalAdoptions} adoptions)`).join('<br>') + moneyLines + '<br><br><button type="button" id="play-again-btn" class="fight-ally-btn ally-btn" style="margin-right:8px">Play again</button><button type="button" id="lobby-btn" class="fight-ally-btn fight-btn">Back to lobby</button>';
  } else {
    leaderboardEl.classList.remove('show');
  }
  } catch (err) {
    console.error('Render error:', err);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#3d6b3d';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.restore();
  }
}

// --- End match menu (delegated: Play again, Back to lobby) ---
function handleLeaderboardButton(btn: HTMLButtonElement): void {
  if (btn.id === 'play-again-btn') {
    if (gameWs) {
      gameWs.close();
      gameWs = null;
    }
    leaderboardEl.classList.remove('show');
    matchEndPlayed = false;
    latestSnapshot = null;
    connectionOverlayEl.classList.remove('hidden');
    connectionOverlayEl.innerHTML = selectedMode === 'ffa'
      ? '<h2>Connecting…</h2><p>Joining FFA lobby…</p>'
      : '<h2>Connecting…</h2><p>Starting new match.</p>';
    authAreaEl.classList.add('hidden');
    connect({ mode: selectedMode })
      .then(() => {
        connectionOverlayEl.classList.add('hidden');
        connectionOverlayEl.innerHTML = '';
        gameWrapEl.classList.add('visible');
        requestAnimationFrame(tick);
      })
      .catch((err: Error) => showConnectionError(err.message || 'Connection failed.'));
  } else if (btn.id === 'lobby-btn') {
    if (gameWs) {
      gameWs.close();
      gameWs = null;
    }
    leaderboardEl.classList.remove('show');
    matchEndPlayed = false;
    latestSnapshot = null;
    gameWrapEl.classList.remove('visible');
    landingEl.classList.remove('hidden');
    authAreaEl.classList.remove('hidden');
    updateLandingMoney();
    restoreModeSelection();
  }
}

leaderboardEl.addEventListener('click', (e) => {
  const target = e.target as HTMLElement;
  const btn = target.closest('button') as HTMLButtonElement | null;
  if (!btn) return;
  e.preventDefault();
  e.stopPropagation();
  handleLeaderboardButton(btn);
});

leaderboardEl.addEventListener('touchend', (e) => {
  const target = e.target as HTMLElement;
  const btn = target.closest('button') as HTMLButtonElement | null;
  if (!btn) return;
  e.preventDefault();
  e.stopPropagation();
  handleLeaderboardButton(btn);
}, { passive: false });

// --- Lobby: Ready button ---
lobbyReadyBtnEl.addEventListener('click', () => {
  if (iAmReady || matchPhase !== 'countdown' || !gameWs || gameWs.readyState !== WebSocket.OPEN) return;
  iAmReady = true;
  gameWs.send(JSON.stringify({ type: 'ready' }));
  lobbyReadyBtnEl.textContent = 'Ready!';
  lobbyMessageEl.textContent = "You're ready! Waiting for other player(s)…";
});

// --- Lobby: Back to lobby (same as end-match lobby button) ---
lobbyBackBtnEl.addEventListener('click', () => {
  if (gameWs) {
    gameWs.close();
    gameWs = null;
  }
  lobbyOverlayEl.classList.add('hidden');
  gameWrapEl.classList.remove('visible');
  landingEl.classList.remove('hidden');
  authAreaEl.classList.remove('hidden'); // Show auth when returning to lobby
  updateLandingMoney();
  restoreModeSelection(); // Restore sticky mode
});

// --- Fight / Ally ---
function sendFightAllyChoice(choice: 'fight' | 'ally'): void {
  if (!fightAllyTargetId || !gameWs || gameWs.readyState !== WebSocket.OPEN) return;
  gameWs.send(JSON.stringify({ type: 'fightAlly', targetId: fightAllyTargetId, choice }));
  fightAllyChosenTargets.add(fightAllyTargetId);
  fightAllyOverlayEl.classList.add('hidden');
  fightAllyTargetId = null;
}
fightAllyFightBtn.addEventListener('click', () => sendFightAllyChoice('fight'));
fightAllyAllyBtn.addEventListener('click', () => sendFightAllyChoice('ally'));

// --- Settings ---
musicToggleEl.checked = getMusicEnabled();
sfxToggleEl.checked = getSfxEnabled();
musicToggleEl.addEventListener('change', () => {
  setMusicEnabled(musicToggleEl.checked);
  if (musicToggleEl.checked) playMusic();
});
sfxToggleEl.addEventListener('change', () => setSfxEnabled(sfxToggleEl.checked));
settingsBtnEl.addEventListener('click', () => settingsPanelEl.classList.toggle('hidden'));
settingsCloseEl.addEventListener('click', () => settingsPanelEl.classList.add('hidden'));
switchServerBtnEl.addEventListener('click', () => {
  if (gameWs) {
    gameWs.close();
    gameWs = null;
  }
  connectionOverlayEl.classList.remove('hidden');
  connectionOverlayEl.innerHTML = '<h2>Switching server…</h2><p>Reconnecting to a closer server.</p>';
  authAreaEl.classList.add('hidden');
  connect({ latency: currentRttMs, mode: selectedMode })
    .then(() => {
      connectionOverlayEl.classList.add('hidden');
      connectionOverlayEl.innerHTML = '';
    })
    .catch((err: Error) => {
      showConnectionError(err.message || 'Switch failed.');
      authAreaEl.classList.remove('hidden');
    });
});

// --- Landing: mode selector ---
function restoreModeSelection(): void {
  document.querySelectorAll('.mode-option').forEach((b) => {
    const mode = (b as HTMLElement).dataset.mode;
    if (mode === selectedMode) {
      b.classList.add('selected');
    } else {
      b.classList.remove('selected');
    }
  });
}
const savedMode = localStorage.getItem(MODE_KEY);
if (savedMode === 'ffa' || savedMode === 'teams' || savedMode === 'solo') {
  selectedMode = savedMode;
}
restoreModeSelection();
document.querySelectorAll('.mode-option').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.mode-option').forEach((b) => b.classList.remove('selected'));
    btn.classList.add('selected');
    selectedMode = (btn as HTMLElement).dataset.mode as 'ffa' | 'teams' | 'solo';
    localStorage.setItem(MODE_KEY, selectedMode);
  });
});

// --- Landing: Facebook placeholder (no nav) ---
landingAuthButtons.addEventListener('click', (e) => {
  const a = (e.target as HTMLElement).closest('a[href="#"]');
  if (a) e.preventDefault();
});

// --- Landing: Play ---
landingPlayBtn.addEventListener('click', () => {
  playMusic(); // Start music on user gesture (required for autoplay)
  landingEl.classList.add('hidden');
  connectionOverlayEl.classList.remove('hidden');
  connectionOverlayEl.innerHTML = '<h2>Connecting…</h2><p>Waiting for game server.</p>';
  // Hide auth buttons during match
  authAreaEl.classList.add('hidden');
  connect({ mode: selectedMode })
    .then(() => {
      connectionOverlayEl.classList.add('hidden');
      gameWrapEl.classList.add('visible');
      if (musicToggleEl) musicToggleEl.checked = getMusicEnabled();
      requestAnimationFrame(tick);
    })
    .catch((err: Error) => {
      showConnectionError(err.message || 'Connection failed.');
      authAreaEl.classList.remove('hidden'); // Show auth on error
    });
});

// --- Cookie consent banner ---
if (!localStorage.getItem(COOKIE_CONSENT_KEY)) {
  cookieBannerEl.classList.remove('hidden');
}
cookieAcceptBtn.addEventListener('click', () => {
  localStorage.setItem(COOKIE_CONSENT_KEY, 'full');
  cookieBannerEl.classList.add('hidden');
});
cookieEssentialBtn.addEventListener('click', () => {
  localStorage.setItem(COOKIE_CONSENT_KEY, 'essential');
  cookieBannerEl.classList.add('hidden');
});

// --- Landing: money and shop ---
updateLandingMoney();
document.querySelectorAll('.landing-buy').forEach((btn) => {
  btn.addEventListener('click', () => {
    const boost = (btn as HTMLElement).dataset.boost as keyof typeof BOOST_PRICES;
    if (!boost || !(boost in BOOST_PRICES)) return;
    const price = BOOST_PRICES[boost as keyof typeof BOOST_PRICES];
    const m = getMoney();
    if (m < price) return;
    setMoney(m - price);
    if (boost === 'size') pendingBoosts.sizeBonus += 1;
    else if (boost === 'speed') pendingBoosts.speedBoost = true;
    else if (boost === 'adoptSpeed') pendingBoosts.adoptSpeed = true;
    updateLandingMoney();
  });
});

// --- Landing: music toggle + play on load ---
if (landingMusicToggleEl) {
  landingMusicToggleEl.checked = getMusicEnabled();
  landingMusicToggleEl.addEventListener('change', () => {
    setMusicEnabled(landingMusicToggleEl!.checked);
    if (landingMusicToggleEl!.checked) playMusic();
  });
}
// Start music when the first page loads (may be blocked by browser until user interaction)
if (getMusicEnabled()) playMusic();

// --- Start ---
fetchAndRenderAuth();
updateLandingMoney();
window.addEventListener('resize', resize);
resize();
