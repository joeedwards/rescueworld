/**
 * Minimap module — extracts minimap rendering logic.
 * Kept as Canvas 2D (120x120px) since GPU acceleration isn't needed
 * for this small overlay.
 */

import {
  MAP_WIDTH, MAP_HEIGHT,
  ADOPTION_ZONE_RADIUS,
  SHELTER_BASE_RADIUS, SHELTER_RADIUS_PER_SIZE,
  BOSS_PETMALL_RADIUS, BOSS_MILL_RADIUS,
} from 'shared';
import { PICKUP_TYPE_GROWTH, PICKUP_TYPE_BREEDER, PICKUP_TYPE_PORT, PICKUP_TYPE_SHELTER_PORT } from 'shared';
import type { Season, GameSnapshot } from 'shared';

const DOT_SPACING = 36;

/** Hash a string to an HSL color */
function hashColor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return `hsl(${h % 360}, 72%, 58%)`;
}

const minimapBg: Record<Season, string> = {
  winter: 'rgba(140,160,180,0.85)',
  spring: 'rgba(30,80,30,0.85)',
  summer: 'rgba(70,90,45,0.85)',
  fall: 'rgba(55,75,45,0.85)',
};

export function drawMinimap(
  minimapCtx: CanvasRenderingContext2D,
  snapshot: GameSnapshot | null,
  myPlayerId: string | null,
  season: Season,
  hideStraysOnMinimap: boolean,
  cam: { x: number; y: number; w: number; h: number },
  predictedX: number | null,
  predictedY: number | null,
): void {
  const scale = 120 / MAP_WIDTH;

  // Background
  minimapCtx.fillStyle = minimapBg[season];
  minimapCtx.fillRect(0, 0, 120, 120);

  // Grid dots
  for (let yy = 0; yy <= MAP_HEIGHT; yy += DOT_SPACING * 3) {
    for (let xx = 0; xx <= MAP_WIDTH; xx += DOT_SPACING * 3) {
      minimapCtx.fillStyle = 'rgba(255,255,255,0.15)';
      minimapCtx.fillRect(xx * scale - 0.8, yy * scale - 0.8, 1.6, 1.6);
    }
  }

  if (!snapshot) return;

  // Adoption zones
  const zones = snapshot.adoptionZones.length > 0
    ? snapshot.adoptionZones
    : [{ id: 'adopt-fallback', x: MAP_WIDTH / 2, y: MAP_HEIGHT / 2, radius: ADOPTION_ZONE_RADIUS }];
  for (const z of zones) {
    const r = Math.max(3, ((z.radius || ADOPTION_ZONE_RADIUS) * scale) | 0);
    minimapCtx.fillStyle = 'rgba(123,237,159,0.6)';
    minimapCtx.fillRect(z.x * scale - r, z.y * scale - r, r * 2, r * 2);
  }

  // Strays
  if (!hideStraysOnMinimap) {
    minimapCtx.fillStyle = '#c9a86c';
    const petCount = snapshot.pets.length;
    const step = petCount > 1000 ? 4 : petCount > 500 ? 2 : 1;
    for (let pi = 0; pi < petCount; pi += step) {
      const pet = snapshot.pets[pi];
      if (pet.insideShelterId !== null || (pet.x === 0 && pet.y === 0)) continue;
      minimapCtx.fillRect(pet.x * scale - 2, pet.y * scale - 2, 4, 4);
    }
  }

  // Pickups
  for (const u of snapshot.pickups ?? []) {
    const px = u.x * scale;
    const py = u.y * scale;
    if (u.type === PICKUP_TYPE_BREEDER) {
      minimapCtx.fillStyle = '#8B4513';
      minimapCtx.beginPath();
      minimapCtx.arc(px, py, 4, 0, Math.PI * 2);
      minimapCtx.fill();
    } else {
      minimapCtx.fillStyle = u.type === PICKUP_TYPE_GROWTH ? '#7bed9f' :
        u.type === PICKUP_TYPE_PORT ? '#c77dff' :
          u.type === PICKUP_TYPE_SHELTER_PORT ? '#10b981' : '#70a3ff';
      minimapCtx.fillRect(px - 2, py - 2, 4, 4);
    }
  }

  // Shelters
  for (const shelter of snapshot.shelters ?? []) {
    const isOwner = shelter.ownerId === myPlayerId;
    const sx = shelter.x * scale;
    const sy = shelter.y * scale;
    const iconHalf = 4;
    minimapCtx.fillStyle = isOwner ? '#e8d5b7' : '#d4c4a8';
    minimapCtx.fillRect(sx - iconHalf, sy - iconHalf, iconHalf * 2, iconHalf * 2);
    minimapCtx.strokeStyle = isOwner ? '#7bed9f' : '#8B4513';
    minimapCtx.lineWidth = 1;
    minimapCtx.strokeRect(sx - iconHalf, sy - iconHalf, iconHalf * 2, iconHalf * 2);
    if (isOwner) {
      minimapCtx.fillStyle = '#7bed9f';
      minimapCtx.beginPath();
      minimapCtx.moveTo(sx, sy - iconHalf - 4);
      minimapCtx.lineTo(sx - 5, sy - iconHalf + 1);
      minimapCtx.lineTo(sx + 5, sy - iconHalf + 1);
      minimapCtx.closePath();
      minimapCtx.fill();
    }
  }

  // Breeder shelters
  for (const bs of snapshot.breederShelters ?? []) {
    const bx = bs.x * scale;
    const by = bs.y * scale;
    const bHalf = Math.max(10, (40 + bs.size * 0.5) * scale);
    minimapCtx.fillStyle = '#cc2222';
    minimapCtx.fillRect(bx - bHalf, by - bHalf, bHalf * 2, bHalf * 2);
  }

  // Boss mode
  if (snapshot.bossMode?.active) {
    const bm = snapshot.bossMode;
    minimapCtx.save();
    minimapCtx.strokeStyle = '#ffd700';
    minimapCtx.lineWidth = 2;
    minimapCtx.setLineDash([4, 4]);
    minimapCtx.beginPath();
    minimapCtx.arc(bm.mallX * scale, bm.mallY * scale, BOSS_PETMALL_RADIUS * scale * 0.6, 0, Math.PI * 2);
    minimapCtx.stroke();
    minimapCtx.setLineDash([]);
    for (const mill of bm.mills) {
      const mx = mill.x * scale;
      const my = mill.y * scale;
      const mr = Math.max(6, BOSS_MILL_RADIUS * scale * 0.5);
      minimapCtx.fillStyle = mill.completed ? 'rgba(100,255,100,0.6)' : 'rgba(139,69,19,0.7)';
      minimapCtx.beginPath();
      minimapCtx.arc(mx, my, mr, 0, Math.PI * 2);
      minimapCtx.fill();
    }
    minimapCtx.restore();
  }

  // Players
  for (const pl of snapshot.players) {
    let mapColor = pl.id === myPlayerId ? '#7bed9f' : hashColor(pl.id);
    if (pl.shelterColor?.startsWith('gradient:')) mapColor = pl.shelterColor.split(':')[1] || mapColor;
    else if (pl.shelterColor) mapColor = pl.shelterColor;
    minimapCtx.fillStyle = mapColor;
    const r = 50 * scale;
    const half = Math.max(2, r);
    const px = pl.id === myPlayerId && predictedX != null ? predictedX : pl.x;
    const py = pl.id === myPlayerId && predictedY != null ? predictedY : pl.y;
    minimapCtx.fillRect(px * scale - half, py * scale - half, half * 2, half * 2);
  }

  // Viewport indicator
  minimapCtx.strokeStyle = 'rgba(255,255,255,0.6)';
  minimapCtx.lineWidth = 1.5;
  minimapCtx.strokeRect(cam.x * scale, cam.y * scale, cam.w * scale, cam.h * scale);
  minimapCtx.strokeStyle = 'rgba(255,255,255,0.2)';
  minimapCtx.lineWidth = 1;
  minimapCtx.strokeRect(0.5, 0.5, 119, 119);
}
