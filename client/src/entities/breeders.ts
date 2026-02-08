/**
 * Breeders entity — breeder shelter (mill) rendering.
 * Uses offscreen Canvas 2D rendered to PixiJS texture.
 * Animated elements (pulsing glow, flickering) require periodic re-rendering.
 */

import { Container, Sprite, Texture, Graphics } from 'pixi.js';
import type { BreederShelterState } from 'shared';

const BREEDER_CAGE_PETS = ['🐱', '🐶', '🐰', '🐦', '🐱', '🐶', '🐰', '🐱'];

function millRng(seed: number): () => number {
  let s = seed | 0;
  return () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return (s >>> 16) / 32768; };
}

function millSeed(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = ((h << 5) - h + id.charCodeAt(i)) | 0;
  return h;
}

// ---- Static sprite cache (non-animated parts) ----
const staticCache = new Map<string, { canvas: HTMLCanvasElement; tex: Texture }>();

function staticCacheKey(shelter: BreederShelterState): string {
  return `breeder-${shelter.id}-${shelter.level}-${shelter.size}`;
}

function renderBreederStatic(shelter: BreederShelterState): HTMLCanvasElement {
  const lvl = shelter.level ?? 1;
  const s = Math.min(2.2, 0.8 + lvl * 0.08);
  const foundW = 120 * s;
  const foundH = 100 * s;
  const rng = millRng(millSeed(shelter.id));

  const canvasW = Math.ceil(foundW + 60);
  const canvasH = Math.ceil(foundH + 80);
  const c = document.createElement('canvas');
  c.width = canvasW;
  c.height = canvasH;
  const ctx = c.getContext('2d')!;
  const cx = canvasW / 2;
  const cy = canvasH / 2;

  ctx.save();
  ctx.translate(cx, cy);

  // Foundation
  ctx.fillStyle = '#2a2018';
  ctx.beginPath();
  ctx.roundRect(-foundW / 2, -foundH / 2, foundW, foundH, 4);
  ctx.fill();
  ctx.strokeStyle = 'rgba(140,40,20,0.8)';
  ctx.lineWidth = 2.5;
  ctx.stroke();

  // Dirty floor stains
  ctx.fillStyle = 'rgba(80,40,20,0.3)';
  for (let i = 0; i < 7; i++) {
    const sx = -foundW / 2 + 12 + rng() * (foundW - 24);
    const sy = -foundH / 2 + 10 + rng() * (foundH - 20);
    ctx.beginPath();
    ctx.ellipse(sx, sy, 4 * s + rng() * 4 * s, 3 * s + rng() * 3 * s, rng() * 3, 0, Math.PI * 2);
    ctx.fill();
  }

  // Cage grid
  const cageW = 14 * s;
  const cageH = 12 * s;
  const cagePad = 2 * s;
  const cageCols = Math.min(6, 3 + Math.floor(lvl / 3));
  const cageRows = Math.min(5, 2 + Math.floor(lvl / 3));
  const cageBlockW = cageCols * (cageW + cagePad);
  const cageBlockH = cageRows * (cageH + cagePad);
  const cageStartX = -cageBlockW / 2;
  const cageStartY = -foundH / 2 + 10 * s;

  // Cell types
  const totalCells = cageCols * cageRows;
  const cells: string[] = [];
  for (let i = 0; i < totalCells; i++) {
    const r = rng();
    if (r < 0.55) cells.push('cage1');
    else if (r < 0.72) cells.push('cage2');
    else if (r < 0.78) cells.push('cage3');
    else if (r < 0.88) cells.push('crate');
    else if (r < 0.94) cells.push('empty');
    else cells.push('water');
  }
  const cellPets: number[] = [];
  for (let i = 0; i < totalCells; i++) cellPets.push(Math.floor(rng() * BREEDER_CAGE_PETS.length));

  // Cage room floor
  ctx.fillStyle = '#3d2e1e';
  ctx.beginPath();
  ctx.roundRect(cageStartX - 4 * s, cageStartY - 4 * s, cageBlockW + 8 * s, cageBlockH + 8 * s, 2);
  ctx.fill();

  // Draw cells
  const emojiSize = 7 * s;
  for (let row = 0; row < cageRows; row++) {
    for (let col = 0; col < cageCols; col++) {
      const idx = row * cageCols + col;
      const cellType = cells[idx];
      const kx = cageStartX + col * (cageW + cagePad);
      const ky = cageStartY + row * (cageH + cagePad);
      const petIdx = cellPets[idx];
      const petEmoji = BREEDER_CAGE_PETS[petIdx];
      const pet2Emoji = BREEDER_CAGE_PETS[(petIdx + 2) % BREEDER_CAGE_PETS.length];

      if (cellType === 'empty') {
        ctx.fillStyle = '#3a2a1a';
        ctx.fillRect(kx, ky, cageW, cageH);
      } else if (cellType === 'crate') {
        ctx.fillStyle = '#5a4228';
        ctx.fillRect(kx, ky, cageW, cageH);
        ctx.strokeStyle = '#7a5a38';
        ctx.lineWidth = 1;
        ctx.strokeRect(kx, ky, cageW, cageH);
      } else if (cellType === 'water') {
        ctx.fillStyle = '#3a2a1a';
        ctx.fillRect(kx, ky, cageW, cageH);
        ctx.fillStyle = '#4a5a3a';
        ctx.beginPath();
        ctx.ellipse(kx + cageW / 2, ky + cageH * 0.4, 4 * s, 2.5 * s, 0, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.fillStyle = '#4a3828';
        ctx.fillRect(kx, ky, cageW, cageH);
        ctx.strokeStyle = 'rgba(120,70,30,0.7)';
        ctx.lineWidth = 1;
        ctx.strokeRect(kx, ky, cageW, cageH);
        ctx.font = `${emojiSize}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.globalAlpha = 0.6;
        if (cellType === 'cage1') {
          ctx.fillText(petEmoji, kx + cageW / 2, ky + cageH / 2);
        } else if (cellType === 'cage2') {
          ctx.font = `${emojiSize * 0.8}px sans-serif`;
          ctx.fillText(petEmoji, kx + cageW * 0.32, ky + cageH * 0.45);
          ctx.fillText(pet2Emoji, kx + cageW * 0.68, ky + cageH * 0.6);
        } else {
          ctx.font = `${emojiSize * 0.7}px sans-serif`;
          ctx.fillText(petEmoji, kx + cageW * 0.28, ky + cageH * 0.35);
          ctx.fillText(pet2Emoji, kx + cageW * 0.72, ky + cageH * 0.35);
          const pet3Emoji = BREEDER_CAGE_PETS[(petIdx + 4) % BREEDER_CAGE_PETS.length];
          ctx.fillText(pet3Emoji, kx + cageW * 0.5, ky + cageH * 0.72);
        }
        ctx.globalAlpha = 1;
      }
    }
  }

  // Label
  ctx.fillStyle = '#ff3333';
  ctx.font = 'bold 12px Rubik, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.fillText(`Breeder Mill Lv${shelter.level}`, 0, -foundH / 2 - 10 * s);

  // Warning text
  ctx.fillStyle = '#ff8800';
  ctx.font = '10px Rubik, sans-serif';
  ctx.textBaseline = 'top';
  ctx.fillText('Spawning wild strays!', 0, foundH / 2 + 5 * s);

  ctx.restore();
  return c;
}

// ---- PixiJS pool ----
const pool = new Map<string, { container: Container; cacheKey: string }>();

export function updateBreeders(
  shelters: BreederShelterState[],
  parent: Container,
  viewL: number, viewR: number, viewT: number, viewB: number,
): void {
  const used = new Set<string>();

  for (const shelter of shelters) {
    const margin = 180;
    if (shelter.x + margin < viewL || shelter.x - margin > viewR || shelter.y + margin < viewT || shelter.y - margin > viewB) continue;

    used.add(shelter.id);
    const key = staticCacheKey(shelter);
    let entry = pool.get(shelter.id);

    if (!entry || entry.cacheKey !== key) {
      const canvas = renderBreederStatic(shelter);
      const tex = Texture.from(canvas);

      if (entry) {
        const sprite = entry.container.getChildByLabel('sprite') as Sprite;
        sprite.texture.destroy(true);
        sprite.texture = tex;
        entry.cacheKey = key;
      } else {
        const container = new Container();
        container.label = `breeder-${shelter.id}`;
        // Pulsing glow (animated)
        const glow = new Graphics();
        glow.label = 'glow';
        container.addChild(glow);
        const sprite = new Sprite(tex);
        sprite.anchor.set(0.5);
        sprite.label = 'sprite';
        container.addChild(sprite);
        parent.addChild(container);
        entry = { container, cacheKey: key };
        pool.set(shelter.id, entry);
      }

      const cache = staticCache.get(shelter.id);
      if (cache) cache.tex.destroy(true);
      staticCache.set(shelter.id, { canvas, tex });
    }

    entry.container.position.set(shelter.x, shelter.y);
    entry.container.visible = true;

    // Animate glow
    const pulse = 0.5 + 0.5 * Math.sin(Date.now() / 200);
    const glow = entry.container.getChildByLabel('glow') as Graphics;
    const s = Math.min(2.2, 0.8 + (shelter.level ?? 1) * 0.08);
    const foundW = 120 * s;
    const foundH = 100 * s;
    glow.clear();
    glow.rect(-foundW / 2 - 5, -foundH / 2 - 5, foundW + 10, foundH + 10);
    glow.fill({ color: 0xb41400, alpha: 0.15 + pulse * 0.1 });
  }

  for (const [id, entry] of pool) {
    if (!used.has(id)) entry.container.visible = false;
  }
}

export function clearBreeders(): void {
  for (const entry of pool.values()) { entry.container.removeFromParent(); entry.container.destroy(); }
  pool.clear();
  for (const entry of staticCache.values()) entry.tex.destroy(true);
  staticCache.clear();
}
