/**
 * Input module — keyboard, mouse, touch, and virtual joystick handling.
 * Provides input flags consumed by the game loop and network module.
 */

import { INPUT_LEFT, INPUT_RIGHT, INPUT_UP, INPUT_DOWN, MAP_WIDTH, MAP_HEIGHT } from 'shared';

// ---- Input flags (bitfield) ----
export let inputFlags = 0;
export const keys: Record<string, boolean> = {};

export function setInputFlag(flag: number, on: boolean): void {
  if (on) inputFlags |= flag;
  else inputFlags &= ~flag;
}

export function clearAllInputFlags(): void {
  inputFlags = 0;
}

// ---- Virtual joystick state ----
export let joystickActive = false;
export let joystickOriginX = 0;
export let joystickOriginY = 0;
export let joystickCurrentX = 0;
export let joystickCurrentY = 0;
export const JOYSTICK_DEADZONE = 15;
export const JOYSTICK_MAX_RADIUS = 60;

export function setJoystickActive(v: boolean): void { joystickActive = v; }
export function setJoystickOrigin(x: number, y: number): void { joystickOriginX = x; joystickOriginY = y; }
export function setJoystickCurrent(x: number, y: number): void { joystickCurrentX = x; joystickCurrentY = y; }

// ---- Observer mode drag state ----
export let observerDragging = false;
export let observerDragStartX = 0;
export let observerDragStartY = 0;

export function setObserverDragging(v: boolean): void { observerDragging = v; }
export function setObserverDragStart(x: number, y: number): void { observerDragStartX = x; observerDragStartY = y; }

// ---- Camera panning state ----
export let isPanning = false;
export let panStartClientX = 0;
export let panStartClientY = 0;
export let lastPanClientX = 0;
export let lastPanClientY = 0;
export const PAN_THRESHOLD_PX = 10;

// ---- Minimap drag state ----
export let minimapDragging = false;
export function setMinimapDragging(v: boolean): void { minimapDragging = v; }

// ---- Mobile detection ----
export const isMobileBrowser = (() => {
  const ua = navigator.userAgent || navigator.vendor || '';
  return /android|webos|iphone|ipad|ipod|blackberry|iemobile|opera mini/i.test(ua.toLowerCase()) ||
    ('ontouchstart' in window && window.innerWidth < 1024);
})();

export const isIOS = (() => {
  const ua = navigator.userAgent || navigator.vendor || '';
  return /iphone|ipad|ipod/i.test(ua) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
})();

// ---- Helpers ----
export function hasMovementKeyDown(): boolean {
  return !!(keys['KeyW'] || keys['KeyS'] || keys['KeyA'] || keys['KeyD'] ||
    keys['ArrowUp'] || keys['ArrowDown'] || keys['ArrowLeft'] || keys['ArrowRight']);
}

/**
 * Apply joystick direction to input flags.
 * Called every frame when joystick is in use.
 */
export function applyJoystickToInput(breederActive: boolean): void {
  if (hasMovementKeyDown()) return;

  if (breederActive) {
    setInputFlag(INPUT_LEFT, false);
    setInputFlag(INPUT_RIGHT, false);
    setInputFlag(INPUT_UP, false);
    setInputFlag(INPUT_DOWN, false);
    return;
  }

  if (!joystickActive) {
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
    setInputFlag(INPUT_LEFT, false);
    setInputFlag(INPUT_RIGHT, false);
    setInputFlag(INPUT_UP, false);
    setInputFlag(INPUT_DOWN, false);
    return;
  }

  const nx = dx / dist;
  const ny = dy / dist;
  setInputFlag(INPUT_LEFT, nx < -0.3);
  setInputFlag(INPUT_RIGHT, nx > 0.3);
  setInputFlag(INPUT_UP, ny < -0.3);
  setInputFlag(INPUT_DOWN, ny > 0.3);
}

// ---- Fullscreen helpers ----
export function enterMobileFullscreen(): void {
  if (!isMobileBrowser || isIOS) return;
  const docEl = document.documentElement;
  try {
    if (docEl.requestFullscreen) {
      docEl.requestFullscreen({ navigationUI: 'hide' }).catch(() => {});
    } else if ((docEl as any).webkitRequestFullscreen) {
      (docEl as any).webkitRequestFullscreen();
    }
  } catch { /* ignore */ }
}

export function exitMobileFullscreen(): void {
  if (!isMobileBrowser || isIOS) return;
  try {
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    } else if ((document as any).webkitFullscreenElement) {
      (document as any).webkitExitFullscreen?.();
    }
  } catch { /* ignore */ }
}

// ---- Wake Lock ----
let wakeLockSentinel: WakeLockSentinel | null = null;

export async function requestWakeLock(): Promise<void> {
  if (!('wakeLock' in navigator)) return;
  try {
    wakeLockSentinel = await navigator.wakeLock.request('screen');
    wakeLockSentinel.addEventListener('release', () => { wakeLockSentinel = null; });
  } catch { /* ignore */ }
}

export function releaseWakeLock(): void {
  wakeLockSentinel?.release();
  wakeLockSentinel = null;
}
