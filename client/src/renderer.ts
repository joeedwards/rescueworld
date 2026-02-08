/**
 * PixiJS WebGL Renderer — Application init, scene graph containers,
 * resize handling, camera management.
 */

import { Application, Container } from 'pixi.js';
import { MAP_WIDTH, MAP_HEIGHT } from 'shared';

// ---- Scene graph layer containers (draw-order) ----
export const worldContainer = new Container();
export const bgLayer = new Container();
export const zoneLayer = new Container();
export const pickupLayer = new Container();
export const shelterLayer = new Container();
export const bossLayer = new Container();
export const strayLayer = new Container();
export const playerLayer = new Container();
export const effectLayer = new Container();
export const hudContainer = new Container();

// Build scene hierarchy
worldContainer.addChild(bgLayer, zoneLayer, pickupLayer, shelterLayer, bossLayer, strayLayer, playerLayer, effectLayer);

// ---- Application singleton ----
let app: Application | null = null;

/** The PIXI Application (available after initRenderer). */
export function getApp(): Application {
  if (!app) throw new Error('Renderer not initialised – call initRenderer() first');
  return app;
}

/** Screen width / height (updated on resize). */
export let screenW = 0;
export let screenH = 0;

/**
 * Create the PixiJS Application, mount it into `#game-container`, and
 * wire up the resize handler.  Returns when the GPU context is ready.
 */
export async function initRenderer(): Promise<HTMLCanvasElement> {
  const container = document.getElementById('game-container');
  if (!container) throw new Error('#game-container element not found');

  app = new Application();
  await app.init({
    background: '#5a7a3d',          // default summer background
    resizeTo: window,
    antialias: false,               // faster
    autoDensity: true,
    resolution: window.devicePixelRatio || 1,
    // PixiJS v8: prefer WebGL2, fall back to WebGL1
    preference: 'webgl',
  });

  // Append the canvas PixiJS created
  container.appendChild(app.canvas);
  app.canvas.id = 'game';
  app.canvas.style.display = 'block';

  // Build the top-level stage
  app.stage.addChild(worldContainer, hudContainer);

  // Initial size
  screenW = app.screen.width;
  screenH = app.screen.height;

  // Listen for window resize
  window.addEventListener('resize', handleResize);
  handleResize();

  // Disable the built-in ticker — we drive rendering manually from
  // the game's own requestAnimationFrame loop.
  app.ticker.stop();

  return app.canvas as HTMLCanvasElement;
}

function handleResize(): void {
  if (!app) return;
  app.renderer.resize(window.innerWidth, window.innerHeight);
  screenW = app.screen.width;
  screenH = app.screen.height;
}

// ---- Camera ----

/** Smoothed camera state. */
let cameraSmoothedX: number | null = null;
let cameraSmoothedY: number | null = null;
const CAMERA_SMOOTH = 0.22;

export let cameraPanOffsetX = 0;
export let cameraPanOffsetY = 0;

export function setCameraPanOffset(x: number, y: number): void {
  cameraPanOffsetX = x;
  cameraPanOffsetY = y;
}

// Observer mode camera
export let observerCameraX = MAP_WIDTH / 2;
export let observerCameraY = MAP_HEIGHT / 2;
export const OBSERVER_PAN_SPEED = 15;

export function setObserverCamera(x: number, y: number): void {
  observerCameraX = x;
  observerCameraY = y;
}

export interface Camera {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Compute the camera viewport rect and update `worldContainer.position`
 * so that all children in world-space scroll correctly.
 */
export function updateCamera(opts: {
  predictedX: number | null;
  predictedY: number | null;
  isObserver: boolean;
  isFullSpectator: boolean;
  spectatorPlayers?: { x: number; y: number }[];
  spectatorIndex?: number;
  isEliminated: boolean;
}): Camera {
  const w = screenW;
  const h = screenH;

  // Full spectator mode
  if (opts.isFullSpectator && opts.spectatorPlayers && opts.spectatorPlayers.length > 0) {
    const idx = (opts.spectatorIndex ?? 0) % opts.spectatorPlayers.length;
    const target = opts.spectatorPlayers[idx];
    observerCameraX = target.x;
    observerCameraY = target.y;
    const camX = Math.max(0, Math.min(MAP_WIDTH - w, observerCameraX - w / 2));
    const camY = Math.max(0, Math.min(MAP_HEIGHT - h, observerCameraY - h / 2));
    worldContainer.position.set(-camX, -camY);
    return { x: camX, y: camY, w, h };
  }

  // Eliminated observer mode
  if (opts.isEliminated) {
    const camX = Math.max(0, Math.min(MAP_WIDTH - w, observerCameraX - w / 2));
    const camY = Math.max(0, Math.min(MAP_HEIGHT - h, observerCameraY - h / 2));
    worldContainer.position.set(-camX, -camY);
    return { x: camX, y: camY, w, h };
  }

  // Normal player-follow mode
  let px = opts.predictedX ?? MAP_WIDTH / 2;
  let py = opts.predictedY ?? MAP_HEIGHT / 2;
  if (!Number.isFinite(px) || !Number.isFinite(py)) {
    px = MAP_WIDTH / 2;
    py = MAP_HEIGHT / 2;
  }

  let targetX = px - w / 2 + cameraPanOffsetX;
  let targetY = py - h / 2 + cameraPanOffsetY;
  targetX = Math.max(0, Math.min(MAP_WIDTH - w, targetX));
  targetY = Math.max(0, Math.min(MAP_HEIGHT - h, targetY));

  if (opts.predictedX == null) {
    cameraSmoothedX = null;
    cameraSmoothedY = null;
    worldContainer.position.set(-targetX, -targetY);
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

  worldContainer.position.set(-cx, -cy);
  return { x: cx, y: cy, w, h };
}

/** Snap camera (e.g. after teleport). */
export function resetCameraSmoothing(): void {
  cameraSmoothedX = null;
  cameraSmoothedY = null;
  cameraPanOffsetX = 0;
  cameraPanOffsetY = 0;
}

/**
 * Clamp pan offsets so the viewport stays within map bounds.
 */
export function applyPanDelta(deltaScreenX: number, deltaScreenY: number, predictedX: number, predictedY: number): void {
  cameraPanOffsetX -= deltaScreenX;
  cameraPanOffsetY -= deltaScreenY;
  const w = screenW;
  const h = screenH;
  const px = predictedX;
  const py = predictedY;
  const maxX = Math.max(0, MAP_WIDTH - w);
  const maxY = Math.max(0, MAP_HEIGHT - h);
  const minOffsetX = -(px - w / 2);
  const maxOffsetX = maxX - (px - w / 2);
  const minOffsetY = -(py - h / 2);
  const maxOffsetY = maxY - (py - h / 2);
  cameraPanOffsetX = Math.max(minOffsetX, Math.min(maxOffsetX, cameraPanOffsetX));
  cameraPanOffsetY = Math.max(minOffsetY, Math.min(maxOffsetY, cameraPanOffsetY));
}

/**
 * Call `app.render()` manually — we drive the render loop ourselves.
 */
export function renderFrame(): void {
  if (!app) return;
  app.render();
}
