/**
 * Game state module — prediction, interpolation, snapshot handling,
 * game-phase tracking, and player state management.
 */

import {
  TICK_RATE,
  MAP_WIDTH,
  MAP_HEIGHT,
  SHELTER_SPEED,
  SPEED_BOOST_MULTIPLIER,
  getCurrentSeason,
} from 'shared';
import type { GameSnapshot, PlayerState, PetState, Season } from 'shared';

// ---- Current season ----
export let currentSeason: Season = getCurrentSeason();
export function setCurrentSeason(s: Season): void { currentSeason = s; }

// ---- Game snapshot ----
export let latestSnapshot: GameSnapshot | null = null;
export function setLatestSnapshot(s: GameSnapshot | null): void { latestSnapshot = s; }

// ---- Interpolation buffers ----
export const interpolatedPlayers = new Map<string, { prev: PlayerState; next: PlayerState; t: number }>();
export const interpolatedPets = new Map<string, { prev: PetState; next: PetState; startTime: number; gen: number }>();
export let interpPetGen = 0;
export const INTERP_BUFFER_MS = 100;
export function bumpInterpPetGen(): number { return ++interpPetGen; }

// ---- Local prediction ----
export let predictedPlayer: PlayerState | null = null;
export let lastProcessedInputSeq = -1;
export let lastKnownSize = 0;
export let lastTotalAdoptions = 0;
export let lastPetsInsideLength = 0;
export let lastShelterPortCharges = 0;
export let lastPetsInsideIds: string[] = [];
export let lastShelterPetsInsideIds: string[] = [];
export const lastPetTypesById = new Map<string, number>();
export let lastSpeedBoostUntil = 0;
export let growthPopUntil = 0;

export function setPredictedPlayer(p: PlayerState | null): void { predictedPlayer = p; }
export function setLastProcessedInputSeq(v: number): void { lastProcessedInputSeq = v; }
export function setLastKnownSize(v: number): void { lastKnownSize = v; }
export function setLastTotalAdoptions(v: number): void { lastTotalAdoptions = v; }
export function setLastPetsInsideLength(v: number): void { lastPetsInsideLength = v; }
export function setLastShelterPortCharges(v: number): void { lastShelterPortCharges = v; }
export function setLastPetsInsideIds(ids: string[]): void { lastPetsInsideIds = ids; }
export function setLastShelterPetsInsideIds(ids: string[]): void { lastShelterPetsInsideIds = ids; }
export function setLastSpeedBoostUntil(v: number): void { lastSpeedBoostUntil = v; }
export function setGrowthPopUntil(v: number): void { growthPopUntil = v; }

// ---- Match end state ----
export let matchEndPlayed = false;
export let matchEndTokensAwarded = false;
export let matchEndWasStrayLoss = false;
export function setMatchEndPlayed(v: boolean): void { matchEndPlayed = v; }
export function setMatchEndTokensAwarded(v: boolean): void { matchEndTokensAwarded = v; }
export function setMatchEndWasStrayLoss(v: boolean): void { matchEndWasStrayLoss = v; }

// ---- Match phase ----
export type MatchPhase = 'lobby' | 'countdown' | 'playing';
export let matchPhase: MatchPhase = 'playing';
export let countdownRemainingSec = 0;
export let readyCount = 0;
export let iAmReady = false;
export let isObserver = false;
export let observerFollowIndex = 0;
export function setMatchPhase(p: MatchPhase): void { matchPhase = p; }
export function setCountdownRemainingSec(v: number): void { countdownRemainingSec = v; }
export function setReadyCount(v: number): void { readyCount = v; }
export function setIAmReady(v: boolean): void { iAmReady = v; }
export function setIsObserver(v: boolean): void { isObserver = v; }
export function setObserverFollowIndex(v: number): void { observerFollowIndex = v; }

// ---- Player display smoothing ----
export let playerDisplayX: number | null = null;
export let playerDisplayY: number | null = null;
export const PLAYER_DISPLAY_SMOOTH = 0.2;
export function setPlayerDisplayPos(x: number | null, y: number | null): void { playerDisplayX = x; playerDisplayY = y; }

// ---- Van facing direction ----
export const vanFacingDir = new Map<string, number>();

// ---- Port animation state ----
export interface PortAnimation {
  startTime: number;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  phase: 'fadeOut' | 'fadeIn';
}
export const portAnimations = new Map<string, PortAnimation>();
export const PORT_ANIMATION_DURATION = 400;
export const prevPlayerPositions = new Map<string, { x: number; y: number }>();

// ---- Fixed van collision radius (matches server) ----
export const VAN_FIXED_RADIUS = 30;

// ---- Frame rate ----
const FPS_KEY = 'rescueworld_fps';
export function getStoredFps(): 30 | 60 {
  const v = localStorage.getItem(FPS_KEY);
  if (v === '60') return 60;
  return 30;
}
export let targetFps: 30 | 60 = getStoredFps();
export let targetFrameMs = 1000 / targetFps;
export function setTargetFps(fps: 30 | 60): void {
  targetFps = fps;
  targetFrameMs = 1000 / fps;
  localStorage.setItem(FPS_KEY, String(fps));
}

/** Cached performance.now() for the current frame. */
export let frameNow = 0;
export function setFrameNow(v: number): void { frameNow = v; }

// ---- Prediction helpers ----
export function predictPlayerByDt(p: PlayerState, inputFlags: number, dtSec: number): PlayerState {
  const INPUT_LEFT = 1, INPUT_RIGHT = 2, INPUT_UP = 4, INPUT_DOWN = 8;
  let dx = 0, dy = 0;
  if (inputFlags & INPUT_LEFT) dx -= 1;
  if (inputFlags & INPUT_RIGHT) dx += 1;
  if (inputFlags & INPUT_UP) dy -= 1;
  if (inputFlags & INPUT_DOWN) dy += 1;
  let vx = 0, vy = 0;
  if (dx !== 0 || dy !== 0) {
    const len = Math.hypot(dx, dy) || 1;
    const speed = (p.speedBoostUntil ?? 0) > 0 ? SHELTER_SPEED * SPEED_BOOST_MULTIPLIER : SHELTER_SPEED;
    const step = speed * dtSec;
    vx = (dx / len) * step;
    vy = (dy / len) * step;
  }
  const radius = VAN_FIXED_RADIUS;
  let x = p.x + vx;
  let y = p.y + vy;
  x = Math.max(radius, Math.min(MAP_WIDTH - radius, x));
  y = Math.max(radius, Math.min(MAP_HEIGHT - radius, y));
  return {
    ...p,
    x, y, vx, vy,
    petsInside: [...p.petsInside],
    speedBoostUntil: p.speedBoostUntil ?? 0,
  };
}

export function predictPlayerTick(p: PlayerState, inputFlags: number): PlayerState {
  return predictPlayerByDt(p, inputFlags, 1 / TICK_RATE);
}

// ---- Interpolation helpers ----
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function lerpAngle(from: number, to: number, t: number): number {
  let diff = to - from;
  while (diff > Math.PI) diff -= 2 * Math.PI;
  while (diff < -Math.PI) diff += 2 * Math.PI;
  return from + diff * t;
}

export function getInterpolatedPlayer(id: string): PlayerState | null {
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

const _interpPetBuf: PetState = { id: '', x: 0, y: 0, vx: 0, vy: 0, insideShelterId: null, petType: 0 };
export function getInterpolatedPet(id: string): PetState | null {
  const entry = interpolatedPets.get(id);
  if (!entry) return null;
  const t = Math.min(1, (frameNow - entry.startTime) / INTERP_BUFFER_MS);
  const n = entry.next;
  _interpPetBuf.id = n.id;
  _interpPetBuf.x = lerp(entry.prev.x, n.x, t);
  _interpPetBuf.y = lerp(entry.prev.y, n.y, t);
  _interpPetBuf.vx = n.vx;
  _interpPetBuf.vy = n.vy;
  _interpPetBuf.insideShelterId = n.insideShelterId;
  _interpPetBuf.petType = n.petType;
  return _interpPetBuf;
}

// ---- Color helpers ----
export function hashColor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  const hue = h % 360;
  return `hsl(${hue}, 72%, 58%)`;
}

export function escapeHtml(s: string): string {
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}

/** Reset all game state when disconnecting / returning to lobby */
export function resetGameState(): void {
  latestSnapshot = null;
  predictedPlayer = null;
  playerDisplayX = null;
  playerDisplayY = null;
  lastKnownSize = 0;
  lastTotalAdoptions = 0;
  lastPetsInsideLength = 0;
  lastShelterPortCharges = 0;
  lastPetsInsideIds = [];
  lastShelterPetsInsideIds = [];
  lastPetTypesById.clear();
  lastSpeedBoostUntil = 0;
  matchEndPlayed = false;
  matchEndTokensAwarded = false;
  matchEndWasStrayLoss = false;
  matchPhase = 'playing';
  iAmReady = false;
  vanFacingDir.clear();
  portAnimations.clear();
  prevPlayerPositions.clear();
  interpolatedPlayers.clear();
  interpolatedPets.clear();
}
