/**
 * Texture generation — pre-renders emoji / shape sprites to PIXI.Textures
 * via offscreen Canvas 2D elements then converts to WebGL textures.
 *
 * Replaces prerenderStraySprites, prerenderBossMillSprites, and
 * prerenderBreederCampSprites from the old Canvas 2D codebase.
 */

import { Texture } from 'pixi.js';
import {
  PET_TYPE_CAT,
  PET_TYPE_DOG,
  PET_TYPE_BIRD,
  PET_TYPE_RABBIT,
  PET_TYPE_SPECIAL,
  BOSS_MILL_HORSE,
  BOSS_MILL_CAT,
  BOSS_MILL_DOG,
  BOSS_MILL_BIRD,
  BOSS_MILL_RABBIT,
  BOSS_MILL_RADIUS,
} from 'shared';

// ---- Stray pet emojis (same as original) ----
const STRAY_PET_EMOJIS: Record<number, string> = {
  [PET_TYPE_CAT]: '🐱',
  [PET_TYPE_DOG]: '🐶',
  [PET_TYPE_BIRD]: '🐦',
  [PET_TYPE_RABBIT]: '🐰',
  [PET_TYPE_SPECIAL]: '⭐',
};

export const STRAY_SPRITE_SIZE = 40;

// ---- Stray textures ----
const strayTextures = new Map<number, Texture>();

export function prerenderStrayTextures(): void {
  for (const [typeStr, emoji] of Object.entries(STRAY_PET_EMOJIS)) {
    const petType = Number(typeStr);
    const c = document.createElement('canvas');
    c.width = STRAY_SPRITE_SIZE;
    c.height = STRAY_SPRITE_SIZE;
    const sctx = c.getContext('2d')!;
    sctx.font = '30px sans-serif';
    sctx.textAlign = 'center';
    sctx.textBaseline = 'middle';
    // Bake a subtle shadow into the sprite
    sctx.shadowColor = 'rgba(0,0,0,0.4)';
    sctx.shadowBlur = 5;
    sctx.shadowOffsetX = 1;
    sctx.shadowOffsetY = 1;
    sctx.fillText(emoji, STRAY_SPRITE_SIZE / 2, STRAY_SPRITE_SIZE / 2);
    strayTextures.set(petType, Texture.from(c));
  }
}

export function getStrayTexture(petType: number): Texture {
  return strayTextures.get(petType) ?? strayTextures.get(PET_TYPE_CAT)!;
}

// ---- Boss mill textures keyed by "petType-state" ----
type BossMillVisualState = 'normal' | 'completed' | 'rebuilding';

const BOSS_MILL_SPRITE_W = 220;
const BOSS_MILL_SPRITE_H = 280;
const bossMillTextures = new Map<string, Texture>();

const BOSS_MILL_EMOJIS: Record<number, string> = {
  [BOSS_MILL_HORSE]: '🐴',
  [BOSS_MILL_CAT]: '🐈',
  [BOSS_MILL_DOG]: '🐕',
  [BOSS_MILL_BIRD]: '🐦',
  [BOSS_MILL_RABBIT]: '🐰',
};

export function prerenderBossMillTextures(): void {
  const petTypes = [BOSS_MILL_HORSE, BOSS_MILL_CAT, BOSS_MILL_DOG, BOSS_MILL_BIRD, BOSS_MILL_RABBIT];
  const states: BossMillVisualState[] = ['normal', 'completed', 'rebuilding'];

  for (const pt of petTypes) {
    for (const state of states) {
      const c = document.createElement('canvas');
      c.width = BOSS_MILL_SPRITE_W;
      c.height = BOSS_MILL_SPRITE_H;
      const sctx = c.getContext('2d')!;
      const cx = BOSS_MILL_SPRITE_W / 2;
      const bh = BOSS_MILL_RADIUS * 1.2;

      // Building base (rounded rect)
      const bw = BOSS_MILL_RADIUS * 1.8;
      const by = BOSS_MILL_SPRITE_H / 2 - bh / 2;

      if (state === 'completed') {
        sctx.fillStyle = '#2a4a2a';
        sctx.shadowColor = 'rgba(0,200,0,0.3)';
      } else if (state === 'rebuilding') {
        sctx.fillStyle = '#4a2020';
        sctx.shadowColor = 'rgba(200,0,0,0.4)';
      } else {
        sctx.fillStyle = '#3a2010';
        sctx.shadowColor = 'rgba(0,0,0,0.4)';
      }
      sctx.shadowBlur = 14;
      sctx.beginPath();
      sctx.roundRect(cx - bw / 2, by, bw, bh, 8);
      sctx.fill();
      sctx.shadowBlur = 0;

      // Building outline
      sctx.strokeStyle = state === 'completed' ? '#4a8a4a' : state === 'rebuilding' ? '#8a3030' : '#6a4020';
      sctx.lineWidth = 3;
      sctx.stroke();

      // Roof
      const roofY = by - 20;
      sctx.fillStyle = state === 'completed' ? '#3a6a3a' : state === 'rebuilding' ? '#5a2020' : '#5a3018';
      sctx.beginPath();
      sctx.moveTo(cx, roofY);
      sctx.lineTo(cx - bw / 2 - 10, by + 5);
      sctx.lineTo(cx + bw / 2 + 10, by + 5);
      sctx.closePath();
      sctx.fill();
      sctx.strokeStyle = state === 'completed' ? '#5a9a5a' : '#7a5028';
      sctx.lineWidth = 2;
      sctx.stroke();

      // Pet emoji
      const emoji = BOSS_MILL_EMOJIS[pt] ?? '🐾';
      sctx.font = 'bold 40px sans-serif';
      sctx.textAlign = 'center';
      sctx.textBaseline = 'middle';
      sctx.fillText(emoji, cx, BOSS_MILL_SPRITE_H / 2);

      // State overlays
      if (state === 'completed') {
        sctx.fillStyle = 'rgba(0,200,0,0.15)';
        sctx.fillRect(cx - bw / 2, by, bw, bh);
        sctx.font = 'bold 28px sans-serif';
        sctx.fillStyle = '#7bed9f';
        sctx.fillText('✓', cx, BOSS_MILL_SPRITE_H / 2 + 40);
      } else if (state === 'rebuilding') {
        sctx.fillStyle = 'rgba(200,0,0,0.1)';
        sctx.fillRect(cx - bw / 2, by, bw, bh);
        sctx.font = 'bold 20px sans-serif';
        sctx.fillStyle = '#ff6666';
        sctx.fillText('⚠ Rebuilding', cx, BOSS_MILL_SPRITE_H / 2 + 40);
      }

      // Mill name label
      const millNames: Record<number, string> = {
        [BOSS_MILL_HORSE]: 'Horse Stable',
        [BOSS_MILL_CAT]: 'Cat Boutique',
        [BOSS_MILL_DOG]: 'Dog Depot',
        [BOSS_MILL_BIRD]: 'Bird Barn',
        [BOSS_MILL_RABBIT]: 'Rabbit Hutch',
      };
      sctx.font = 'bold 14px Rubik, sans-serif';
      sctx.fillStyle = '#fff';
      sctx.shadowColor = 'rgba(0,0,0,0.7)';
      sctx.shadowBlur = 4;
      sctx.fillText(millNames[pt] ?? 'Mill', cx, by - 30);
      sctx.shadowBlur = 0;

      const key = `${pt}-${state}`;
      bossMillTextures.set(key, Texture.from(c));
    }
  }
}

export function getBossMillTexture(petType: number, state: BossMillVisualState): Texture {
  const key = `${petType}-${state}`;
  return bossMillTextures.get(key) ?? bossMillTextures.get(`${BOSS_MILL_CAT}-normal`)!;
}

// ---- Breeder camp textures (levels 1-20) ----
const CAMP_SPRITE_W = 150;
const CAMP_SPRITE_H = 120;
const breederCampTextures = new Map<number, Texture>();

export function prerenderBreederCampTextures(): void {
  for (let level = 1; level <= 20; level++) {
    const c = document.createElement('canvas');
    c.width = CAMP_SPRITE_W;
    c.height = CAMP_SPRITE_H;
    const sctx = c.getContext('2d')!;

    const seed0 = ((level * 101) | 0) >>> 0;
    const cx = CAMP_SPRITE_W / 2;
    const cy = CAMP_SPRITE_H / 2;

    // Shadow baked
    sctx.shadowColor = 'rgba(0,0,0,0.3)';
    sctx.shadowBlur = 8;
    sctx.shadowOffsetY = 2;

    // Tent base
    sctx.fillStyle = '#8B6914';
    sctx.beginPath();
    sctx.moveTo(cx - 50, cy + 30);
    sctx.lineTo(cx, cy - 30);
    sctx.lineTo(cx + 50, cy + 30);
    sctx.closePath();
    sctx.fill();
    sctx.shadowBlur = 0;

    // Tent stripes
    sctx.strokeStyle = 'rgba(0,0,0,0.15)';
    sctx.lineWidth = 1;
    for (let i = -2; i <= 2; i++) {
      sctx.beginPath();
      sctx.moveTo(cx + i * 10, cy - 25);
      sctx.lineTo(cx + i * 18, cy + 30);
      sctx.stroke();
    }

    // Cage bars
    const cageCount = Math.min(4, 1 + Math.floor(level / 3));
    const cageW = 16;
    const cageH = 14;
    const startX = cx - (cageCount * (cageW + 4)) / 2;

    for (let i = 0; i < cageCount; i++) {
      const kx = startX + i * (cageW + 4);
      const ky = cy + 5;
      sctx.fillStyle = '#4a3828';
      sctx.fillRect(kx, ky, cageW, cageH);
      sctx.strokeStyle = '#6a5030';
      sctx.lineWidth = 1;
      sctx.strokeRect(kx, ky, cageW, cageH);

      // Bars
      sctx.strokeStyle = 'rgba(100,60,25,0.5)';
      sctx.lineWidth = 0.6;
      for (let b = 1; b < 3; b++) {
        sctx.beginPath();
        sctx.moveTo(kx + (b * cageW) / 3, ky);
        sctx.lineTo(kx + (b * cageW) / 3, ky + cageH);
        sctx.stroke();
      }

      // Pet emoji
      const emojis = ['🐱', '🐶', '🐰', '🐦'];
      const eidx = (seed0 + i * 3) % emojis.length;
      sctx.font = '8px sans-serif';
      sctx.textAlign = 'center';
      sctx.textBaseline = 'middle';
      sctx.fillText(emojis[eidx], kx + cageW / 2, ky + cageH / 2);
    }

    // Level badge
    sctx.fillStyle = '#cc3333';
    sctx.beginPath();
    sctx.arc(cx + 40, cy - 20, 10, 0, Math.PI * 2);
    sctx.fill();
    sctx.fillStyle = '#fff';
    sctx.font = 'bold 10px Rubik, sans-serif';
    sctx.textAlign = 'center';
    sctx.textBaseline = 'middle';
    sctx.fillText(String(level), cx + 40, cy - 20);

    breederCampTextures.set(level, Texture.from(c));
  }
}

export function getBreederCampTexture(level: number): Texture {
  const clamped = Math.max(1, Math.min(20, level));
  return breederCampTextures.get(clamped) ?? breederCampTextures.get(1)!;
}

// ---- Preload external images as textures ----
export let breederMillTexture: Texture | null = null;
export let adoptionEventTexture: Texture | null = null;

function loadImageAsTexture(paths: string[]): Promise<Texture | null> {
  return new Promise((resolve) => {
    let idx = 0;
    const img = new Image();
    const tryNext = () => {
      if (idx >= paths.length) { resolve(null); return; }
      img.src = paths[idx++];
    };
    img.onload = () => resolve(Texture.from(img));
    img.onerror = () => tryNext();
    tryNext();
  });
}

export async function loadExternalImages(): Promise<void> {
  breederMillTexture = await loadImageAsTexture(['/breeder-mill.png', '/rescueworld/breeder-mill.png']);
  adoptionEventTexture = await loadImageAsTexture(['/adoption-event.png', '/rescueworld/adoption-event.png']);
}

/**
 * Call once at startup to build all pre-rendered textures.
 */
export async function initSprites(): Promise<void> {
  prerenderStrayTextures();
  prerenderBossMillTextures();
  prerenderBreederCampTextures();
  await loadExternalImages();
}
