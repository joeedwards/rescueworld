/**
 * Shelters entity — tier 1-5 top-down floorplan rendering.
 *
 * Strategy: The shelter drawing logic is extremely detailed (rooms, yards,
 * workers, kennel cells with pet emojis, desks, medical equipment, etc.)
 * totaling ~600 lines of Canvas 2D. Rather than re-implementing all of this
 * in PixiJS Graphics (which would be enormous and slower for text/emoji),
 * we render each shelter to an offscreen canvas and convert to a PixiJS
 * Texture. The texture is cached and only re-rendered when the shelter
 * changes (size, tier, pets, etc.).
 *
 * This gives us the best of both worlds:
 * - Complex Canvas 2D rendering for the detailed shelter art
 * - GPU-accelerated batched sprite compositing via PixiJS
 */

import { Container, Sprite, Texture, Text, TextStyle } from 'pixi.js';
import { SHELTER_BASE_RADIUS, SHELTER_RADIUS_PER_SIZE } from 'shared';
import { PET_TYPE_CAT, PET_TYPE_DOG, PET_TYPE_BIRD, PET_TYPE_RABBIT, PET_TYPE_SPECIAL } from 'shared';
import type { ShelterState } from 'shared';

// ---- Shelter drawing on offscreen canvas (reuses original Canvas 2D code) ----

type ShelterRoomType = 'kennel' | 'medical' | 'reception' | 'corridor' | 'grooming' | 'catRoom' | 'birdRoom' | 'education' | 'community' | 'breakRoom';
interface ShelterRoom {
  rx: number; ry: number; w: number; h: number;
  type: ShelterRoomType; label?: string; kennelSlots?: number;
}
interface ShelterYard {
  rx: number; ry: number; w: number; h: number;
  label?: string; hasEquipment?: boolean; hasPath?: boolean;
}

const ROOM_FLOOR_COLORS: Record<ShelterRoomType, string> = {
  kennel: '#f5e6c8', medical: '#e0f0f5', reception: '#f0dbb8',
  corridor: '#d9d0c4', grooming: '#e6d8ef', catRoom: '#fce4d6',
  birdRoom: '#daf0e0', education: '#e2e8f0', community: '#fff5e0',
  breakRoom: '#e8f5e8',
};

const KENNEL_PET_EMOJIS: Record<number, string> = {
  [PET_TYPE_CAT]: '🐱', [PET_TYPE_DOG]: '🐶', [PET_TYPE_BIRD]: '🐦',
  [PET_TYPE_RABBIT]: '🐰', [PET_TYPE_SPECIAL]: '⭐',
};

/** Compact room layout generator (matches main.ts getShelterRooms) */
function getShelterRooms(tier: number, half: number): ShelterRoom[] {
  const rooms: ShelterRoom[] = [];
  const s = half / 100;
  rooms.push({ rx: -50*s, ry: -30*s, w: 35*s, h: 30*s, type: 'reception', label: 'Lobby' });
  rooms.push({ rx: -10*s, ry: -30*s, w: 55*s, h: 55*s, type: 'kennel', label: 'Kennels', kennelSlots: 6 });
  rooms.push({ rx: -52*s, ry: 2*s, w: 100*s, h: 12*s, type: 'corridor' });
  if (tier >= 2) {
    rooms.push({ rx: -10*s, ry: 16*s, w: 55*s, h: 45*s, type: 'kennel', label: 'Dog Wing', kennelSlots: 8 });
    rooms.push({ rx: -50*s, ry: 16*s, w: 35*s, h: 25*s, type: 'grooming', label: 'Grooming' });
  }
  if (tier >= 3) {
    rooms.push({ rx: -90*s, ry: -30*s, w: 36*s, h: 30*s, type: 'catRoom', label: 'Cat Room', kennelSlots: 5 });
    rooms.push({ rx: 50*s, ry: -30*s, w: 36*s, h: 30*s, type: 'birdRoom', label: 'Small Animals', kennelSlots: 4 });
    rooms.push({ rx: -90*s, ry: 2*s, w: 36*s, h: 25*s, type: 'medical', label: 'Medical' });
    rooms.push({ rx: -92*s, ry: 2*s, w: 40*s, h: 12*s, type: 'corridor' });
    rooms.push({ rx: 48*s, ry: 2*s, w: 40*s, h: 12*s, type: 'corridor' });
  }
  if (tier >= 4) {
    rooms.push({ rx: 50*s, ry: 16*s, w: 36*s, h: 35*s, type: 'education', label: 'Education' });
    rooms.push({ rx: -90*s, ry: 30*s, w: 36*s, h: 28*s, type: 'breakRoom', label: 'Staff Room' });
    rooms.push({ rx: -92*s, ry: 28*s, w: 182*s, h: 10*s, type: 'corridor' });
  }
  if (tier >= 5) {
    rooms.push({ rx: 90*s, ry: -30*s, w: 42*s, h: 40*s, type: 'community', label: 'Community' });
    rooms.push({ rx: 90*s, ry: 14*s, w: 42*s, h: 38*s, type: 'kennel', label: 'Overflow', kennelSlots: 6 });
    rooms.push({ rx: 86*s, ry: 2*s, w: 48*s, h: 12*s, type: 'corridor' });
    rooms.push({ rx: -45*s, ry: -68*s, w: 50*s, h: 34*s, type: 'reception', label: 'Adopt Events' });
    rooms.push({ rx: -47*s, ry: -34*s, w: 54*s, h: 6*s, type: 'corridor' });
    rooms.push({ rx: -90*s, ry: 60*s, w: 36*s, h: 26*s, type: 'medical', label: 'Quarantine' });
    rooms.push({ rx: -50*s, ry: 60*s, w: 35*s, h: 26*s, type: 'breakRoom', label: 'Supply' });
    rooms.push({ rx: -92*s, ry: 56*s, w: 182*s, h: 8*s, type: 'corridor' });
  }
  return rooms;
}

function getShelterYards(tier: number, half: number): ShelterYard[] {
  const yards: ShelterYard[] = [];
  const s = half / 100;
  if (tier < 2) yards.push({ rx: -50*s, ry: 16*s, w: 35*s, h: 30*s, label: 'Yard' });
  if (tier >= 2 && tier < 4) {
    yards.push({ rx: 50*s, ry: 16*s, w: 36*s, h: 40*s, label: 'Dog Walk', hasEquipment: true, hasPath: true });
    yards.push({ rx: -50*s, ry: 44*s, w: 35*s, h: 22*s, label: 'Yard' });
  }
  if (tier >= 3 && tier < 5) {
    yards.push({ rx: -90*s, ry: -65*s, w: 36*s, h: 30*s, label: 'Cat Yard' });
    yards.push({ rx: 50*s, ry: -65*s, w: 36*s, h: 30*s, label: 'Play Area', hasEquipment: true });
  }
  if (tier >= 4) {
    yards.push({ rx: 50*s, ry: 55*s, w: 36*s, h: 30*s, label: 'Dog Walk', hasEquipment: true, hasPath: true });
    yards.push({ rx: -90*s, ry: 62*s, w: 36*s, h: 22*s, label: 'Garden', hasPath: true });
    yards.push({ rx: -50*s, ry: 44*s, w: 35*s, h: 12*s, label: 'Yard' });
  }
  if (tier >= 5) {
    yards.push({ rx: -10*s, ry: 64*s, w: 55*s, h: 24*s, label: 'Courtyard', hasPath: true });
    yards.push({ rx: -90*s, ry: -100*s, w: 222*s, h: 28*s, label: 'Entrance Gardens', hasPath: true });
    yards.push({ rx: -90*s, ry: -68*s, w: 40*s, h: 34*s, label: 'Cat Yard' });
    yards.push({ rx: 90*s, ry: -68*s, w: 42*s, h: 34*s, label: 'Play Area', hasEquipment: true });
    yards.push({ rx: 90*s, ry: 56*s, w: 42*s, h: 30*s, label: 'Agility', hasEquipment: true, hasPath: true });
    yards.push({ rx: -90*s, ry: 88*s, w: 36*s, h: 20*s, label: 'Garden', hasPath: true });
  }
  return yards;
}

// ---- Cache key for shelter texture ----
function shelterCacheKey(s: ShelterState): string {
  return `${s.id}-${s.tier}-${s.size}-${s.petsInside.length}-${s.hasAdoptionCenter ? 1 : 0}-${s.hasGravity ? 1 : 0}-${s.hasAdvertising ? 1 : 0}`;
}

// ---- Offscreen canvas cache ----
const shelterCanvasCache = new Map<string, { canvas: HTMLCanvasElement; tex: Texture; w: number; h: number }>();

function renderShelterToCanvas(
  shelter: ShelterState,
  isOwner: boolean,
  ownerColor: string | undefined,
  petTypesById: Map<string, number>,
): { canvas: HTMLCanvasElement; w: number; h: number } {
  const baseSize = SHELTER_BASE_RADIUS + shelter.size * SHELTER_RADIUS_PER_SIZE;
  const half = Math.min(200, Math.max(100, baseSize));
  const tier = shelter.tier ?? 1;
  const s = half / 100;
  const foundW = (tier >= 5 ? 240 : tier >= 4 ? 185 : tier >= 3 ? 185 : 110) * s;
  const foundH = (tier >= 5 ? 200 : tier >= 4 ? 120 : tier >= 3 ? 100 : 55) * s;
  const foundX = (tier >= 3 ? -95 : -55) * s;
  const foundY = (tier >= 5 ? -105 : tier >= 3 ? -70 : -35) * s;
  const canvasW = Math.ceil(foundW + Math.abs(foundX) + 80);
  const canvasH = Math.ceil(foundH + Math.abs(foundY) + 80);
  const cx = canvasW / 2;
  const cy = canvasH / 2;

  const c = document.createElement('canvas');
  c.width = canvasW;
  c.height = canvasH;
  const ctx = c.getContext('2d')!;
  ctx.translate(cx, cy);

  let accentColor: string;
  if (ownerColor?.startsWith('gradient:')) accentColor = ownerColor.split(':')[1] || '#7bed9f';
  else if (ownerColor) accentColor = ownerColor;
  else accentColor = isOwner ? '#7bed9f' : '#888';

  // Foundation
  ctx.shadowColor = 'rgba(0,0,0,0.25)';
  ctx.shadowBlur = 18;
  ctx.shadowOffsetX = 4;
  ctx.shadowOffsetY = 4;
  ctx.fillStyle = '#e8e0d8';
  ctx.beginPath();
  ctx.roundRect(foundX, foundY, foundW, foundH, 6);
  ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;
  ctx.strokeStyle = accentColor;
  ctx.lineWidth = 2;
  ctx.stroke();

  // Yards
  const yards = getShelterYards(tier, half);
  for (const yard of yards) {
    ctx.fillStyle = '#90c67c';
    ctx.beginPath();
    ctx.roundRect(yard.rx, yard.ry, yard.w, yard.h, 4);
    ctx.fill();
    if (yard.label) {
      ctx.fillStyle = 'rgba(40,80,30,0.5)';
      ctx.font = '6px Rubik, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText(yard.label, yard.rx + yard.w / 2, yard.ry + 3);
    }
  }

  // Rooms
  const rooms = getShelterRooms(tier, half);
  let petIdx = 0;
  for (const room of rooms) {
    ctx.fillStyle = ROOM_FLOOR_COLORS[room.type] || '#d9d0c4';
    ctx.beginPath();
    ctx.roundRect(room.rx, room.ry, room.w, room.h, 3);
    ctx.fill();
    ctx.strokeStyle = '#8a7b6b';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    if (room.label) {
      ctx.fillStyle = 'rgba(100,80,60,0.55)';
      ctx.font = '7px Rubik, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(room.label, room.rx + room.w / 2, room.ry + room.h / 2);
    }
    // Kennel cells
    if (room.kennelSlots && room.kennelSlots > 0) {
      const cellW = 14, cellH = 14, pad = 3;
      const cols = Math.max(1, Math.floor((room.w - 6) / (cellW + pad)));
      for (let i = 0; i < room.kennelSlots; i++) {
        const row = Math.floor(i / cols);
        const col = i % cols;
        const kx = room.rx + 4 + col * (cellW + pad);
        const ky = room.ry + 4 + row * (cellH + pad);
        if (ky + cellH > room.ry + room.h - 2) break;
        const pi = petIdx + i;
        const hasPet = pi < shelter.petsInside.length;
        ctx.fillStyle = hasPet ? '#f5e0b8' : '#e0d8cc';
        ctx.fillRect(kx, ky, cellW, cellH);
        ctx.strokeStyle = hasPet ? '#8a7050' : '#b0a898';
        ctx.lineWidth = 0.8;
        ctx.strokeRect(kx, ky, cellW, cellH);
        if (hasPet) {
          const petId = shelter.petsInside[pi];
          const petType = petTypesById.get(petId) ?? PET_TYPE_CAT;
          const emoji = KENNEL_PET_EMOJIS[petType] ?? KENNEL_PET_EMOJIS[PET_TYPE_CAT];
          ctx.font = '9px sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(emoji, kx + cellW / 2, ky + cellH / 2);
        }
      }
      petIdx += room.kennelSlots;
    }
  }

  // Banner
  const bannerY = foundY - 14;
  ctx.fillStyle = accentColor;
  ctx.globalAlpha = 0.85;
  const ownerLabel = isOwner ? 'Your Shelter' : 'Shelter';
  ctx.font = 'bold 11px Rubik, sans-serif';
  ctx.textAlign = 'center';
  const labelW = ctx.measureText(ownerLabel).width + 14;
  ctx.beginPath();
  ctx.roundRect(-labelW / 2, bannerY - 10, labelW, 16, 4);
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.fillStyle = '#fff';
  ctx.textBaseline = 'middle';
  ctx.fillText(ownerLabel, 0, bannerY - 2);

  // Tier badge
  const tierColors = ['#888', '#7bed9f', '#70a3ff', '#c77dff', '#ffd700'];
  const tierColor = tierColors[Math.min(tier - 1, 4)];
  const badgeX = foundX + foundW - 8;
  const badgeY2 = foundY + 8;
  ctx.fillStyle = tierColor;
  ctx.beginPath();
  ctx.arc(badgeX, badgeY2, 12, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = tier >= 5 ? '#333' : '#fff';
  ctx.font = 'bold 11px Rubik, sans-serif';
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  ctx.fillText(tier >= 5 ? '★' + tier : String(tier), badgeX, badgeY2);

  // Stats
  const statsY = foundY + foundH + 10;
  ctx.fillStyle = '#fff';
  ctx.font = '10px Rubik, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.shadowColor = 'rgba(0,0,0,0.6)';
  ctx.shadowBlur = 3;
  ctx.fillText(`Pets: ${shelter.petsInside.length}`, 0, statsY);
  ctx.fillStyle = '#7bed9f';
  ctx.fillText(`Adoptions: ${shelter.totalAdoptions}`, 0, statsY + 13);

  return { canvas: c, w: canvasW, h: canvasH };
}

// ---- PixiJS Pool ----
const shelterPool = new Map<string, { container: Container; cacheKey: string }>();

/**
 * Update all shelters in the scene.
 */
export function updateShelters(
  shelters: ShelterState[],
  myPlayerId: string | null,
  players: { id: string; shelterColor?: string }[],
  petTypesById: Map<string, number>,
  parent: Container,
  viewL: number, viewR: number, viewT: number, viewB: number,
): void {
  const used = new Set<string>();

  for (const shelter of shelters) {
    const shelterHalf = Math.min(200, Math.max(100, SHELTER_BASE_RADIUS + shelter.size * SHELTER_RADIUS_PER_SIZE)) + 50;
    if (shelter.x + shelterHalf < viewL || shelter.x - shelterHalf > viewR || shelter.y + shelterHalf < viewT || shelter.y - shelterHalf > viewB) continue;

    used.add(shelter.id);
    const isOwner = shelter.ownerId === myPlayerId;
    const owner = players.find(p => p.id === shelter.ownerId);
    const ownerColor = owner?.shelterColor;
    const key = shelterCacheKey(shelter);

    let entry = shelterPool.get(shelter.id);
    if (!entry || entry.cacheKey !== key) {
      // Render to offscreen canvas
      const { canvas, w, h } = renderShelterToCanvas(shelter, isOwner, ownerColor, petTypesById);
      const tex = Texture.from(canvas);

      if (entry) {
        // Update existing
        const sprite = entry.container.getChildByLabel('sprite') as Sprite;
        sprite.texture.destroy(true);
        sprite.texture = tex;
        sprite.width = w;
        sprite.height = h;
        sprite.anchor.set(0.5);
        entry.cacheKey = key;
      } else {
        // Create new
        const container = new Container();
        container.label = `shelter-${shelter.id}`;
        const sprite = new Sprite(tex);
        sprite.anchor.set(0.5);
        sprite.label = 'sprite';
        container.addChild(sprite);
        parent.addChild(container);
        entry = { container, cacheKey: key };
        shelterPool.set(shelter.id, entry);
      }

      // Cache the canvas for potential texture update
      const oldCache = shelterCanvasCache.get(shelter.id);
      if (oldCache) oldCache.tex.destroy(true);
      shelterCanvasCache.set(shelter.id, { canvas, tex, w, h });
    }

    entry.container.position.set(shelter.x, shelter.y);
    entry.container.visible = true;
  }

  // Hide unused
  for (const [id, entry] of shelterPool) {
    if (!used.has(id)) {
      entry.container.visible = false;
    }
  }
}

/** Remove all shelter containers */
export function clearShelters(): void {
  for (const entry of shelterPool.values()) { entry.container.removeFromParent(); entry.container.destroy(); }
  shelterPool.clear();
  for (const entry of shelterCanvasCache.values()) { entry.tex.destroy(true); }
  shelterCanvasCache.clear();
}
