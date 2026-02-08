/**
 * Effects module — adoption animations, port teleport effects,
 * and seasonal particle systems (snowflakes, leaves, wind streaks).
 */

import { Container, Graphics, Text, TextStyle } from 'pixi.js';
import type { Season } from 'shared';
import { getWindMultiplier } from 'shared';

// ---- Port animation ----

export interface PortAnimation {
  startTime: number;
  fromX: number; fromY: number;
  toX: number; toY: number;
  phase: 'fadeOut' | 'fadeIn';
}

const PORT_ANIMATION_DURATION = 400;

const portGfxPool: Graphics[] = [];
let portGfxActive = 0;

function getPortGfx(parent: Container): Graphics {
  if (portGfxActive < portGfxPool.length) {
    const g = portGfxPool[portGfxActive];
    g.visible = true;
    portGfxActive++;
    return g;
  }
  const g = new Graphics();
  g.label = 'portEffect';
  parent.addChild(g);
  portGfxPool.push(g);
  portGfxActive++;
  return g;
}

export function renderPortEffects(
  animations: Map<string, PortAnimation>,
  parent: Container,
): void {
  portGfxActive = 0;

  for (const [, anim] of animations) {
    const elapsed = Date.now() - anim.startTime;
    const progress = Math.min(1, elapsed / PORT_ANIMATION_DURATION);

    if (anim.phase === 'fadeIn') {
      // Appearing effect
      const g = getPortGfx(parent);
      g.clear();
      const alpha = progress;
      const scale = 0.5 + progress * 0.5;
      g.circle(0, 0, 60 * scale);
      g.fill({ color: 0xb478ff, alpha: alpha * 0.3 });
      g.circle(0, 0, 60 * scale);
      g.setStrokeStyle({ width: 4, color: 0xc896ff, alpha: alpha * 0.8 });
      g.stroke();
      g.position.set(anim.toX, anim.toY);

      // Disappearing at old location
      if (progress < 0.5) {
        const g2 = getPortGfx(parent);
        g2.clear();
        const fadeAlpha = 1 - progress * 2;
        const fadeScale = 1 + progress;
        g2.circle(0, 0, 60 * fadeScale);
        g2.fill({ color: 0xb478ff, alpha: fadeAlpha * 0.3 });
        g2.position.set(anim.fromX, anim.fromY);
      }
    }
  }

  // Hide unused
  for (let i = portGfxActive; i < portGfxPool.length; i++) {
    portGfxPool[i].visible = false;
  }
}

// ---- Seasonal particles ----

interface Snowflake { x: number; y: number; r: number; speed: number; drift: number; }
interface Leaf { x: number; y: number; r: number; angle: number; speed: number; color: number; rotSpeed: number; }

const snowflakes: Snowflake[] = [];
const SNOWFLAKE_COUNT = 120;
for (let i = 0; i < SNOWFLAKE_COUNT; i++) {
  snowflakes.push({
    x: Math.random() * 2000, y: Math.random() * 2000,
    r: 1 + Math.random() * 2.5, speed: 20 + Math.random() * 40,
    drift: (Math.random() - 0.5) * 15,
  });
}

const leaves: Leaf[] = [];
const LEAF_COUNT = 80;
const LEAF_COLORS = [0xc0392b, 0xe67e22, 0xd4a017, 0xb8860b, 0x8b4513];
for (let i = 0; i < LEAF_COUNT; i++) {
  leaves.push({
    x: Math.random() * 2000, y: Math.random() * 2000,
    r: 2 + Math.random() * 3, angle: Math.random() * Math.PI * 2,
    speed: 30 + Math.random() * 50,
    color: LEAF_COLORS[Math.floor(Math.random() * LEAF_COLORS.length)],
    rotSpeed: (Math.random() - 0.5) * 4,
  });
}

let particleGfx: Graphics | null = null;

export function updateSeasonParticles(
  dt: number,
  cam: { x: number; y: number; w: number; h: number },
  season: Season,
  tick: number,
): void {
  if (season === 'winter') {
    for (const s of snowflakes) {
      s.y += s.speed * dt;
      s.x += s.drift * dt;
      if (s.y > cam.y + cam.h + 20) { s.y = cam.y - 20; s.x = cam.x + Math.random() * cam.w; }
      if (s.x < cam.x - 20) s.x = cam.x + cam.w + 10;
      if (s.x > cam.x + cam.w + 20) s.x = cam.x - 10;
    }
  }
  if (season === 'fall') {
    const wind = getWindMultiplier(tick);
    for (const l of leaves) {
      l.x += (l.speed * wind * 0.8 + Math.sin(l.angle) * 10) * dt;
      l.y += (l.speed * 0.4 + Math.cos(l.angle) * 5) * dt;
      l.angle += l.rotSpeed * dt;
      if (l.y > cam.y + cam.h + 20) { l.y = cam.y - 20; l.x = cam.x + Math.random() * cam.w; }
      if (l.x > cam.x + cam.w + 40) { l.x = cam.x - 30; l.y = cam.y + Math.random() * cam.h; }
      if (l.x < cam.x - 40) { l.x = cam.x + cam.w + 20; }
    }
  }
}

export function renderSeasonParticles(
  cam: { x: number; y: number; w: number; h: number },
  season: Season,
  parent: Container,
): void {
  if (!particleGfx) {
    particleGfx = new Graphics();
    particleGfx.label = 'seasonParticles';
    parent.addChild(particleGfx);
  }
  const g = particleGfx;
  g.clear();

  if (season === 'winter') {
    for (const s of snowflakes) {
      if (s.x < cam.x - 10 || s.x > cam.x + cam.w + 10) continue;
      if (s.y < cam.y - 10 || s.y > cam.y + cam.h + 10) continue;
      g.circle(s.x, s.y, s.r);
    }
    g.fill({ color: 0xffffff, alpha: 0.8 });
  }

  if (season === 'fall') {
    for (const l of leaves) {
      if (l.x < cam.x - 10 || l.x > cam.x + cam.w + 10) continue;
      if (l.y < cam.y - 10 || l.y > cam.y + cam.h + 10) continue;
      // Simple leaf as small ellipse
      g.ellipse(l.x, l.y, l.r * 1.5, l.r);
      g.fill(l.color);
    }
  }
}

// ---- Adoption animation ----

interface AdopterAppearance {
  skin: string; skinStroke: string; hair: string;
  clothing: string; clothingStroke: string;
}

const ADOPTER_APPEARANCES: AdopterAppearance[] = [
  { skin: '#f5d0a9', skinStroke: '#d4a574', hair: '#4a3520', clothing: '#4a90d9', clothingStroke: '#2d6ab3' },
  { skin: '#d4a878', skinStroke: '#b08050', hair: '#1a1a1a', clothing: '#e85d5d', clothingStroke: '#c94040' },
  { skin: '#c68642', skinStroke: '#a06830', hair: '#3a2a1a', clothing: '#5ab87a', clothingStroke: '#3a8a5a' },
  { skin: '#ffe0bd', skinStroke: '#dfc0a0', hair: '#c4a882', clothing: '#9b59b6', clothingStroke: '#7d3c98' },
  { skin: '#8d5524', skinStroke: '#6b3a18', hair: '#000000', clothing: '#f39c12', clothingStroke: '#d68910' },
];

const ADOPTION_PET_EMOJIS: Record<number, string> = { 0: '🐱', 1: '🐶', 2: '🐦', 3: '🐰', 4: '⭐' };
const ADOPTION_ANIMATION_DURATION = 4000;

export interface AdoptionAnimation {
  fromX: number; fromY: number; toX: number; toY: number;
  petType: number; startTime: number; walkAngle: number;
  appearance: AdopterAppearance; isBird: boolean;
}

export const adoptionAnimations: AdoptionAnimation[] = [];

/** Spawn a new adoption animation */
export function spawnAdoption(fromX: number, fromY: number, petType: number, delay = 0): void {
  const angle = Math.random() * Math.PI * 2;
  const dist = 120 + Math.random() * 80;
  const isBird = petType === 2;
  adoptionAnimations.push({
    fromX, fromY,
    toX: fromX + Math.cos(angle) * dist,
    toY: fromY + Math.sin(angle) * dist,
    petType,
    startTime: Date.now() + delay,
    walkAngle: angle,
    appearance: ADOPTER_APPEARANCES[Math.floor(Math.random() * ADOPTER_APPEARANCES.length)],
    isBird,
  });
}

let adoptionGfx: Graphics | null = null;

export function renderAdoptionAnimations(parent: Container): void {
  if (!adoptionGfx) {
    adoptionGfx = new Graphics();
    adoptionGfx.label = 'adoptionAnims';
    parent.addChild(adoptionGfx);
  }
  const g = adoptionGfx;
  g.clear();

  const nowMs = Date.now();
  for (let i = adoptionAnimations.length - 1; i >= 0; i--) {
    const anim = adoptionAnimations[i];
    const elapsed = nowMs - anim.startTime;
    if (elapsed < 0) continue;
    if (elapsed > ADOPTION_ANIMATION_DURATION) {
      adoptionAnimations.splice(i, 1);
      continue;
    }
    const progress = elapsed / ADOPTION_ANIMATION_DURATION;
    const eased = 1 - Math.pow(1 - progress, 3);
    const alpha = progress < 0.8 ? 1 : 1 - (progress - 0.8) / 0.2;

    const px = anim.fromX + (anim.toX - anim.fromX) * eased;
    const py = anim.fromY + (anim.toY - anim.fromY) * eased;

    // Simple dot representation for adopter
    g.circle(px, py, 4);
    g.fill({ color: 0x4a90d9, alpha });

    // Heart periodically
    if (progress > 0.05 && progress < 0.6 && Math.sin(progress * 20) > 0.8) {
      g.circle(px, py - 14, 2);
      g.fill({ color: 0xff6b6b, alpha: alpha * 0.6 });
    }
  }
}

/** Remove stale animations */
export function clearEffects(): void {
  adoptionAnimations.length = 0;
  portGfxActive = 0;
  for (const g of portGfxPool) { g.visible = false; }
}
