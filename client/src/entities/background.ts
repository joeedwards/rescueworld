/**
 * Background entity — map background, grid dots, and seasonal terrain patches.
 * Uses PixiJS Graphics for all drawing; rebuilt when season changes.
 */

import { Container, Graphics } from 'pixi.js';
import { MAP_WIDTH, MAP_HEIGHT, isInVegetationPatch } from 'shared';
import type { Season } from 'shared';

const DOT_SPACING = 36;
const DOT_R = 1.8;

/** Season background colors */
const SEASON_BG: Record<Season, number> = {
  winter: 0xb8cce0,
  spring: 0x2d7a2d,
  summer: 0x5a7a3d,
  fall: 0x4a6b3d,
};

/** Season dot colors */
const SEASON_DOT: Record<Season, { color: number; alpha: number }> = {
  winter: { color: 0xffffff, alpha: 0.5 },
  spring: { color: 0xffffff, alpha: 0.3 },
  summer: { color: 0xffffe0, alpha: 0.3 },
  fall: { color: 0xfff0dc, alpha: 0.3 },
};

/** Deterministic hash for terrain patch placement */
function patchHash(x: number, y: number): number {
  const h = Math.sin(x * 0.017 + y * 0.013) * 43758.5453;
  return h - Math.floor(h);
}

export class BackgroundLayer {
  readonly container = new Container();

  /** Full-map background fill (single colored rect). */
  private bgRect = new Graphics();
  /** Static grid dots (batched). */
  private dotsGfx = new Graphics();
  /** Seasonal terrain patches. */
  private patchesGfx = new Graphics();

  private builtSeason: Season | null = null;

  constructor() {
    this.container.addChild(this.bgRect, this.patchesGfx, this.dotsGfx);
    this.container.label = 'background';
  }

  /** Rebuild static geometry when season changes (or on first call). */
  build(season: Season): void {
    if (season === this.builtSeason) return;
    this.builtSeason = season;

    // ---- Background fill ----
    this.bgRect.clear();
    this.bgRect.rect(0, 0, MAP_WIDTH, MAP_HEIGHT);
    this.bgRect.fill(SEASON_BG[season]);

    // ---- Grid dots ----
    this.dotsGfx.clear();
    const dot = SEASON_DOT[season];
    for (let y = 0; y <= MAP_HEIGHT; y += DOT_SPACING) {
      for (let x = 0; x <= MAP_WIDTH; x += DOT_SPACING) {
        this.dotsGfx.rect(x - DOT_R, y - DOT_R, DOT_R * 2, DOT_R * 2);
      }
    }
    this.dotsGfx.fill({ color: dot.color, alpha: dot.alpha });

    // ---- Terrain patches ----
    this.patchesGfx.clear();
    this.buildPatches(season);
  }

  private buildPatches(season: Season): void {
    const g = this.patchesGfx;

    if (season === 'winter') {
      const spacing = 300;
      for (let py = 0; py <= MAP_HEIGHT; py += spacing) {
        for (let px = 0; px <= MAP_WIDTH; px += spacing) {
          const t = patchHash(px, py);
          if (t > 0.55) continue;
          const r = 30 + t * 60;
          const offX = ((Math.sin(px * 0.017 + py * 0.013) * 43758.5453 * 7) % spacing) * 0.5;
          const offY = ((Math.sin(px * 0.017 + py * 0.013) * 43758.5453 * 13) % spacing) * 0.5;
          const alpha = t > 0.3 ? 0.4 : 0.3;
          const color = t > 0.3 ? 0xdcebf8 : 0xc8dcf0;
          g.ellipse(px + offX, py + offY, r, r * 0.7);
          g.fill({ color, alpha });
        }
      }
    } else if (season === 'spring') {
      // Thick vegetation patches
      const vegSpacing = 60;
      for (let vy = 0; vy <= MAP_HEIGHT; vy += vegSpacing) {
        for (let vx = 0; vx <= MAP_WIDTH; vx += vegSpacing) {
          if (isInVegetationPatch(vx, vy)) {
            g.rect(vx - vegSpacing / 2, vy - vegSpacing / 2, vegSpacing, vegSpacing);
            g.fill({ color: 0x145a14, alpha: 0.25 });
          }
        }
      }
      // Flower dots
      const flowerSpacing = 150;
      const flowerColors = [0xff69b4, 0xff6347, 0xffd700, 0xda70d6, 0xffffff];
      for (let fy = 0; fy <= MAP_HEIGHT; fy += flowerSpacing) {
        for (let fx = 0; fx <= MAP_WIDTH; fx += flowerSpacing) {
          const fHash = Math.sin(fx * 0.031 + fy * 0.023) * 43758.5453;
          const ft = fHash - Math.floor(fHash);
          if (ft > 0.4) continue;
          const color = flowerColors[Math.floor(ft * 5 * flowerColors.length) % flowerColors.length];
          const fOx = (fHash * 11) % flowerSpacing * 0.6;
          const fOy = (fHash * 17) % flowerSpacing * 0.6;
          g.circle(fx + fOx, fy + fOy, 2);
          g.fill(color);
        }
      }
    } else if (season === 'summer') {
      const spacing = 280;
      for (let dy = 0; dy <= MAP_HEIGHT; dy += spacing) {
        for (let dx = 0; dx <= MAP_WIDTH; dx += spacing) {
          const dHash = Math.sin(dx * 0.019 + dy * 0.011) * 43758.5453;
          const dt = dHash - Math.floor(dHash);
          if (dt > 0.45) continue;
          const r = 25 + dt * 55;
          const doX = (dHash * 9) % spacing * 0.4;
          const doY = (dHash * 15) % spacing * 0.4;
          const alpha = dt > 0.25 ? 0.2 : 0.15;
          const color = dt > 0.25 ? 0xa08c50 : 0x8c783c;
          g.ellipse(dx + doX, dy + doY, r, r * 0.65);
          g.fill({ color, alpha });
        }
      }
    } else if (season === 'fall') {
      const spacing = 200;
      for (let ay = 0; ay <= MAP_HEIGHT; ay += spacing) {
        for (let ax = 0; ax <= MAP_WIDTH; ax += spacing) {
          const aHash = Math.sin(ax * 0.021 + ay * 0.017) * 43758.5453;
          const at = aHash - Math.floor(aHash);
          if (at > 0.5) continue;
          const r = 20 + at * 40;
          const aoX = (aHash * 7) % spacing * 0.5;
          const aoY = (aHash * 11) % spacing * 0.5;
          const alpha = at > 0.3 ? 0.12 : 0.1;
          const color = at > 0.3 ? 0xb47832 : 0xa06428;
          g.ellipse(ax + aoX, ay + aoY, r, r * 0.7);
          g.fill({ color, alpha });
        }
      }
    }
  }
}
