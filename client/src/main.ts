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
  PET_RADIUS,
  ADOPTION_ZONE_RADIUS,
  GROWTH_ORB_RADIUS,
  SPEED_BOOST_MULTIPLIER,
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

const SIGNALING_URL = (() => {
  const { protocol, host } = window.location;
  const wsProtocol = protocol === 'https:' ? 'wss:' : 'ws:';
  return `${wsProtocol}//${host}/ws-signaling`;
})();

// --- Input state ---
let inputFlags = 0;
let inputSeq = 0;
const keys: Record<string, boolean> = {};
let touchTarget: { x: number; y: number } | null = null;

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
let growthPopUntil = 0;

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

function getTapDirection(): { dx: number; dy: number } {
  if (!touchTarget || !predictedPlayer) return { dx: 0, dy: 0 };
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  const tx = (touchTarget.x - rect.left) * scaleX;
  const ty = (touchTarget.y - rect.top) * scaleY;
  const cam = getCamera();
  const wx = tx - cam.x + cam.w / 2;
  const wy = ty - cam.y + cam.h / 2;
  const dx = wx - predictedPlayer.x;
  const dy = wy - predictedPlayer.y;
  const len = Math.hypot(dx, dy) || 1;
  return { dx: dx / len, dy: dy / len };
}

function applyTapToInput(): void {
  const { dx, dy } = getTapDirection();
  setInputFlag(INPUT_LEFT, dx < -0.3);
  setInputFlag(INPUT_RIGHT, dx > 0.3);
  setInputFlag(INPUT_UP, dy < -0.3);
  setInputFlag(INPUT_DOWN, dy > 0.3);
}

canvas.addEventListener('touchstart', (e) => {
  e.preventDefault();
  if (e.touches.length) touchTarget = { x: e.touches[0].clientX, y: e.touches[0].clientY };
});
canvas.addEventListener('touchmove', (e) => {
  e.preventDefault();
  if (e.touches.length) touchTarget = { x: e.touches[0].clientX, y: e.touches[0].clientY };
});
canvas.addEventListener('touchend', (e) => {
  e.preventDefault();
  touchTarget = null;
});
canvas.addEventListener('mousedown', (e) => {
  touchTarget = { x: e.clientX, y: e.clientY };
});
canvas.addEventListener('mousemove', (e) => {
  if (e.buttons) touchTarget = { x: e.clientX, y: e.clientY };
});
canvas.addEventListener('mouseup', () => {
  touchTarget = null;
});
window.addEventListener('keydown', onKeyDown);
window.addEventListener('keyup', onKeyUp);

// --- Camera (follow local player) ---
function getCamera(): { x: number; y: number; w: number; h: number } {
  const w = canvas.width;
  const h = canvas.height;
  const px = predictedPlayer?.x ?? MAP_WIDTH / 2;
  const py = predictedPlayer?.y ?? MAP_HEIGHT / 2;
  return {
    x: px - w / 2,
    y: py - h / 2,
    w,
    h,
  };
}

// --- Prediction: same movement as server ---
function predictPlayerTick(p: PlayerState, inputFlags: number): PlayerState {
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
    const perTick = speed / TICK_RATE;
    vx = (dx / len) * perTick;
    vy = (dy / len) * perTick;
  }
  const radius = SHELTER_BASE_RADIUS + p.size * 4;
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
async function connect(): Promise<void> {
  let gameUrl = 'ws://localhost:4001';
  const ws = new WebSocket(SIGNALING_URL);
  await new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => {
      ws.close();
      reject(new Error('Connection timeout. Is the server running? Run: npm run dev'));
    }, CONNECT_TIMEOUT_MS);
    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'join' }));
    };
    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === 'joined' && msg.gameUrl) {
          clearTimeout(t);
          gameUrl = msg.gameUrl;
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
  gameWsLocal.onopen = () => {
    gameWs = gameWsLocal;
  };
  gameWsLocal.onmessage = (e) => {
    if (typeof e.data === 'string') {
      const msg = JSON.parse(e.data);
      if (msg.type === 'welcome' && msg.playerId) myPlayerId = msg.playerId;
      return;
    }
    const buf = e.data as ArrayBuffer;
    if (buf.byteLength < 1) return;
    if (new DataView(buf).getUint8(0) === MSG_SNAPSHOT) {
      const snap = decodeSnapshot(buf);
      latestSnapshot = snap;
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
        }
        lastKnownSize = me.size;
        predictedPlayer = { ...me, petsInside: [...me.petsInside] };
        lastProcessedInputSeq = me.inputSeq;
      }
    }
  };
  gameWsLocal.onclose = () => {
    gameWs = null;
    myPlayerId = null;
    latestSnapshot = null;
    predictedPlayer = null;
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
}

// --- Tick: send input at server tick rate, advance prediction and interpolation ---
let lastTickTime = 0;
let lastInputSendTime = 0;
function tick(now: number): void {
  if (!lastTickTime) lastTickTime = now;
  const dt = Math.min((now - lastTickTime) / 1000, 0.1);
  lastTickTime = now;

  if (touchTarget) applyTapToInput();

  if (gameWs?.readyState === WebSocket.OPEN && now - lastInputSendTime >= TICK_MS) {
    lastInputSendTime = now;
    const buf = encodeInput(inputFlags, inputSeq++);
    gameWs.send(buf);
    if (predictedPlayer && myPlayerId) {
      predictedPlayer = predictPlayerTick(predictedPlayer, inputFlags);
    }
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
      ctx.beginPath();
      ctx.arc(xx, yy, DOT_R, 0, Math.PI * 2);
      ctx.fill();
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
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = 'rgba(74, 124, 89, 0.2)';
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#7bed9f';
  ctx.font = 'bold 14px Rubik, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('ADOPTION CENTER', cx, cy - r - 8);
  ctx.fillText('Bring pets here to adopt out', cx, cy);
  ctx.restore();
}

function drawPlayerShelter(p: PlayerState, isMe: boolean): void {
  const radius = SHELTER_BASE_RADIUS + p.size * 4;
  const cx = p.x;
  const cy = p.y;
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.4)';
  ctx.shadowBlur = 10;
  const color = isMe ? '#7bed9f' : hashColor(p.id);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = isMe ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.5)';
  ctx.lineWidth = isMe ? 3 : 2;
  ctx.stroke();
  ctx.fillStyle = '#2d2d2d';
  ctx.font = 'bold 12px Rubik, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(isMe ? 'You' : `Size ${Math.floor(p.size)}`, cx, cy - radius - 6);
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
  ctx.save();
  ctx.fillStyle = isGrowth ? '#7bed9f' : '#70a3ff';
  ctx.beginPath();
  ctx.arc(u.x, u.y, GROWTH_ORB_RADIUS, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = isGrowth ? '#2d5a38' : '#2d4a6e';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = '#333';
  ctx.font = '10px Rubik, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(isGrowth ? '+Size' : 'Speed', u.x, u.y + GROWTH_ORB_RADIUS + 10);
  ctx.restore();
}

function render(dt: number): void {
  try {
    const cam = getCamera();
    ctx.save();
    ctx.translate(-cam.x, -cam.y);
    drawMapBackground(cam);

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
    drawStray(p.x, p.y);
  }

  for (const pl of latestSnapshot?.players ?? []) {
    const isMe = pl.id === myPlayerId;
    const p = isMe && predictedPlayer ? predictedPlayer : getInterpolatedPlayer(pl.id) ?? pl;
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
      minimapCtx.beginPath();
      minimapCtx.arc(xx * scale, yy * scale, 0.8, 0, Math.PI * 2);
      minimapCtx.fill();
    }
  }
  if (latestSnapshot) {
    for (const z of latestSnapshot.adoptionZones) {
      minimapCtx.fillStyle = 'rgba(123, 237, 159, 0.6)';
      minimapCtx.beginPath();
      minimapCtx.arc(z.x * scale, z.y * scale, (z.radius * scale) | 0, 0, Math.PI * 2);
      minimapCtx.fill();
    }
    for (const pet of latestSnapshot.pets) {
      if (pet.insideShelterId !== null) continue;
      minimapCtx.fillStyle = '#c9a86c';
      minimapCtx.beginPath();
      minimapCtx.arc(pet.x * scale, pet.y * scale, 2, 0, Math.PI * 2);
      minimapCtx.fill();
    }
    for (const u of latestSnapshot.pickups ?? []) {
      minimapCtx.fillStyle = u.type === PICKUP_TYPE_GROWTH ? '#7bed9f' : '#70a3ff';
      minimapCtx.beginPath();
      minimapCtx.arc(u.x * scale, u.y * scale, 2, 0, Math.PI * 2);
      minimapCtx.fill();
    }
    for (const pl of latestSnapshot.players) {
      minimapCtx.fillStyle = pl.id === myPlayerId ? '#7bed9f' : hashColor(pl.id);
      const r = (SHELTER_BASE_RADIUS + pl.size * 4) * scale;
      minimapCtx.beginPath();
      minimapCtx.arc(pl.x * scale, pl.y * scale, Math.max(2, r), 0, Math.PI * 2);
      minimapCtx.fill();
    }
  }
  minimapCtx.strokeStyle = 'rgba(255,255,255,0.2)';
  minimapCtx.lineWidth = 1;
  minimapCtx.strokeRect(0.5, 0.5, 119, 119);

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
  if (remainingSec <= 0 && latestSnapshot?.players.length) {
    leaderboardEl.classList.add('show');
    const sorted = [...latestSnapshot.players].sort((a, b) => b.size - a.size);
    leaderboardEl.innerHTML = '<strong>Match over</strong><br><br>' + sorted.map((p, i) => `${i + 1}. ${p.id === myPlayerId ? 'You' : 'Shelter'}: size ${Math.floor(p.size)} (${p.totalAdoptions} adoptions)`).join('<br>');
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

// --- Start ---
window.addEventListener('resize', resize);
resize();
connect()
  .then(() => {
    requestAnimationFrame(tick);
  })
  .catch((err: Error) => {
    showConnectionError(err.message || 'Connection failed.');
  });
