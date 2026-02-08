/**
 * Strays entity — stray pets drawn as sprites from pre-rendered textures.
 * Uses a pool of PixiJS Sprites for efficient batch rendering.
 */

import { Container, Sprite, Texture } from 'pixi.js';
import { PET_TYPE_CAT } from 'shared';
import type { PetState } from 'shared';

const STRAY_PET_EMOJIS: Record<number, string> = {
  0: '🐱', // CAT
  1: '🐶', // DOG
  2: '🐦', // BIRD
  3: '🐰', // RABBIT
  4: '⭐', // SPECIAL
};

const STRAY_SPRITE_SIZE = 40;

// ---- Pre-rendered textures (emoji to texture) ----
const strayTextures = new Map<number, Texture>();

/** Pre-render stray emoji sprites to textures at startup */
export function prerenderStrayTextures(): void {
  for (const [typeStr, emoji] of Object.entries(STRAY_PET_EMOJIS)) {
    const petType = Number(typeStr);
    const c = document.createElement('canvas');
    c.width = STRAY_SPRITE_SIZE;
    c.height = STRAY_SPRITE_SIZE;
    const ctx = c.getContext('2d')!;
    ctx.font = '30px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = 'rgba(0,0,0,0.8)';
    ctx.shadowBlur = 4;
    ctx.fillText(emoji, STRAY_SPRITE_SIZE / 2, STRAY_SPRITE_SIZE / 2);
    if (petType === 4) { // SPECIAL
      ctx.shadowColor = '#ffd700';
      ctx.shadowBlur = 12;
      ctx.fillText(emoji, STRAY_SPRITE_SIZE / 2, STRAY_SPRITE_SIZE / 2);
    }
    strayTextures.set(petType, Texture.from(c));
  }
}

export function getStrayTexture(petType: number): Texture {
  return strayTextures.get(petType) ?? strayTextures.get(PET_TYPE_CAT)!;
}

// ---- Sprite pool ----
const spritePool: Sprite[] = [];
let activeCount = 0;

function getPooledSprite(parent: Container): Sprite {
  if (activeCount < spritePool.length) {
    const s = spritePool[activeCount];
    s.visible = true;
    activeCount++;
    return s;
  }
  const s = new Sprite();
  s.anchor.set(0.5);
  s.label = 'stray';
  parent.addChild(s);
  spritePool.push(s);
  activeCount++;
  return s;
}

/**
 * Update all visible strays. Uses sprite pooling for performance.
 * @param pets     Full pets array from snapshot
 * @param getInterpolatedPet  Function to get interpolated position
 * @param viewL/viewR/viewT/viewB  Viewport bounds
 * @param parent   Container to add sprites to
 */
export function updateStrays(
  pets: PetState[],
  getInterpolatedPet: (id: string) => PetState | null,
  viewL: number, viewR: number, viewT: number, viewB: number,
  parent: Container,
): void {
  // Reset pool
  activeCount = 0;

  const margin = 50;
  const strayL = viewL - margin;
  const strayR = viewR + margin;
  const strayT = viewT - margin;
  const strayB = viewB + margin;

  for (const pet of pets) {
    if (pet.insideShelterId !== null) continue;
    if (pet.x === 0 && pet.y === 0) continue;
    if (pet.x < strayL || pet.x > strayR || pet.y < strayT || pet.y > strayB) continue;

    const p = getInterpolatedPet(pet.id) ?? pet;
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;

    const sprite = getPooledSprite(parent);
    sprite.texture = getStrayTexture(pet.petType ?? PET_TYPE_CAT);
    sprite.position.set(p.x, p.y);
  }

  // Hide remaining unused sprites
  for (let i = activeCount; i < spritePool.length; i++) {
    spritePool[i].visible = false;
  }
}

export function clearStrays(): void {
  for (const s of spritePool) { s.removeFromParent(); s.destroy(); }
  spritePool.length = 0;
  activeCount = 0;
}
