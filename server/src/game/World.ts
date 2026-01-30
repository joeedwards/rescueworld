/**
 * Authoritative world: shelters (players) move, collect strays, adopt at zones to grow.
 */

import type { PlayerState, PetState, AdoptionZoneState, GameSnapshot, PickupState } from 'shared';
import {
  MAP_WIDTH,
  MAP_HEIGHT,
  TICK_RATE,
  SHELTER_SPEED,
  SHELTER_BASE_RADIUS,
  SHELTER_RADIUS_PER_SIZE,
  RESCUE_RADIUS,
  PET_RADIUS,
  ADOPTION_ZONE_RADIUS,
  ADOPTION_TICKS_INTERVAL,
  ADOPTION_TICKS_INTERVAL_FAST,
  ADOPTION_TICKS_GROUNDED,
  ADOPTION_FAST_PET_THRESHOLD,
  GROWTH_PER_ADOPTION,
  INITIAL_SHELTER_SIZE,
  SESSION_DURATION_MS,
  STRAY_SPAWN_TICKS,
  STRAY_SPAWN_COUNT,
  GROUNDED_ZONE_RATIO,
  AUTO_JUMP_ADOPTIONS,
  GROWTH_ORB_RADIUS,
  GROWTH_ORB_VALUE,
  SPEED_BOOST_DURATION_TICKS,
  SPEED_BOOST_MULTIPLIER,
  PICKUP_SPAWN_TICKS,
} from 'shared';
import { INPUT_LEFT, INPUT_RIGHT, INPUT_UP, INPUT_DOWN } from 'shared';
import { PICKUP_TYPE_GROWTH, PICKUP_TYPE_SPEED } from 'shared';

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function dist(ax: number, ay: number, bx: number, by: number): number {
  return Math.hypot(bx - ax, by - ay);
}

function shelterRadius(size: number): number {
  return SHELTER_BASE_RADIUS + size * SHELTER_RADIUS_PER_SIZE;
}

export class World {
  private tick = 0;
  private matchEndAt = 0;
  private matchStarted = false;
  private players = new Map<string, PlayerState>();
  private pets = new Map<string, PetState>();
  private adoptionZones: AdoptionZoneState[] = [];
  private pickups = new Map<string, PickupState>();
  private petIdSeq = 0;
  private pickupIdSeq = 0;
  private spawnPetAt = 0;
  private spawnPickupAt = 0;
  private lastAdoptionTick = new Map<string, number>();
  private adoptSpeedPlayerIds = new Set<string>();
  private autoJumpedPlayerIds = new Set<string>();

  constructor() {
    this.spawnPetAt = 0;
    this.adoptionZones.push({
      id: 'adopt-1',
      x: MAP_WIDTH / 2,
      y: MAP_HEIGHT / 2,
      radius: ADOPTION_ZONE_RADIUS,
    });
  }

  addPlayer(id: string, displayName?: string): void {
    const name = displayName ?? `rescue${String(100 + Math.floor(Math.random() * 900))}`;
    const x = MAP_WIDTH * (0.2 + Math.random() * 0.6);
    const y = MAP_HEIGHT * (0.2 + Math.random() * 0.6);
    this.players.set(id, {
      id,
      displayName: name,
      x,
      y,
      vx: 0,
      vy: 0,
      size: INITIAL_SHELTER_SIZE,
      totalAdoptions: 0,
      petsInside: [],
      speedBoostUntil: 0,
      inputSeq: 0,
    });
  }

  private isInsideAdoptionZone(x: number, y: number): boolean {
    for (const zone of this.adoptionZones) {
      if (dist(x, y, zone.x, zone.y) <= zone.radius) return true;
    }
    return false;
  }

  private randomPosOutsideAdoptionZone(): { x: number; y: number } | null {
    return this.randomPosOutsideAdoptionZoneWithMargin(0);
  }

  private randomPosOutsideAdoptionZoneWithMargin(margin: number): { x: number; y: number } | null {
    for (let i = 0; i < 50; i++) {
      const x = MAP_WIDTH * Math.random();
      const y = MAP_HEIGHT * Math.random();
      let ok = true;
      for (const zone of this.adoptionZones) {
        if (dist(x, y, zone.x, zone.y) <= zone.radius + margin) {
          ok = false;
          break;
        }
      }
      if (ok) return { x, y };
    }
    return null;
  }

  removePlayer(id: string): void {
    const p = this.players.get(id);
    if (p) {
      for (const pid of p.petsInside) {
        const pet = this.pets.get(pid);
        if (pet) {
          pet.insideShelterId = null;
          pet.x = p.x;
          pet.y = p.y;
        }
      }
    }
    this.players.delete(id);
    this.lastAdoptionTick.delete(id);
    this.adoptSpeedPlayerIds.delete(id);
    this.autoJumpedPlayerIds.delete(id);
  }

  private isGrounded(p: PlayerState): boolean {
    return shelterRadius(p.size) >= ADOPTION_ZONE_RADIUS * GROUNDED_ZONE_RATIO;
  }

  setInput(id: string, inputFlags: number, inputSeq: number): void {
    const p = this.players.get(id);
    if (!p) return;
    p.inputSeq = inputSeq;
    (p as PlayerState & { lastInputFlags?: number }).lastInputFlags = inputFlags;
  }

  applyStartingBoosts(id: string, boosts: { sizeBonus?: number; speedBoost?: boolean; adoptSpeed?: boolean }): void {
    const p = this.players.get(id);
    if (!p) return;
    if (typeof boosts.sizeBonus === 'number' && boosts.sizeBonus > 0) {
      p.size += boosts.sizeBonus;
    }
    if (boosts.speedBoost) {
      p.speedBoostUntil = this.tick + SPEED_BOOST_DURATION_TICKS;
    }
    if (boosts.adoptSpeed) {
      this.adoptSpeedPlayerIds.add(id);
    }
  }

  private directionToward(px: number, py: number, tx: number, ty: number): number {
    let flags = 0;
    const dx = tx - px;
    const dy = ty - py;
    if (Math.abs(dx) > 2) flags |= dx < 0 ? INPUT_LEFT : INPUT_RIGHT;
    if (Math.abs(dy) > 2) flags |= dy < 0 ? INPUT_UP : INPUT_DOWN;
    return flags;
  }

  private cpuAI(p: PlayerState): number {
    const zone = this.adoptionZones[0];
    if (!zone) return 0;
    const capacity = Math.floor(p.size);
    const shelterRadius = SHELTER_BASE_RADIUS + p.size * SHELTER_RADIUS_PER_SIZE;
    const rescueRadius = Math.max(RESCUE_RADIUS, shelterRadius + PET_RADIUS);
    const inZone = dist(p.x, p.y, zone.x, zone.y) <= zone.radius + shelterRadius;

    if (inZone && p.petsInside.length > 0) return 0;
    if (p.petsInside.length >= capacity && !inZone) {
      return this.directionToward(p.x, p.y, zone.x, zone.y);
    }
    let bestX = p.x;
    let bestY = p.y;
    let bestD = 1e9;
    for (const pet of this.pets.values()) {
      if (pet.insideShelterId !== null) continue;
      const d = dist(p.x, p.y, pet.x, pet.y);
      if (d < bestD && d < rescueRadius * 3) {
        bestD = d;
        bestX = pet.x;
        bestY = pet.y;
      }
    }
    for (const u of this.pickups.values()) {
      const d = dist(p.x, p.y, u.x, u.y);
      if (d < bestD) {
        bestD = d;
        bestX = u.x;
        bestY = u.y;
      }
    }
    if (bestD < 1e9) return this.directionToward(p.x, p.y, bestX, bestY);
    return this.directionToward(p.x, p.y, zone.x, zone.y);
  }

  private applyInput(p: PlayerState, inputFlags: number): void {
    let dx = 0,
      dy = 0;
    if (inputFlags & INPUT_LEFT) dx -= 1;
    if (inputFlags & INPUT_RIGHT) dx += 1;
    if (inputFlags & INPUT_UP) dy -= 1;
    if (inputFlags & INPUT_DOWN) dy += 1;
    if (dx !== 0 || dy !== 0) {
      const len = Math.hypot(dx, dy) || 1;
      const speed = p.speedBoostUntil > this.tick ? SHELTER_SPEED * SPEED_BOOST_MULTIPLIER : SHELTER_SPEED;
      const perTick = speed / TICK_RATE;
      p.vx = (dx / len) * perTick;
      p.vy = (dy / len) * perTick;
    } else {
      p.vx = 0;
      p.vy = 0;
    }
  }

  startMatch(): void {
    this.matchStarted = true;
    this.matchEndAt = this.tick + Math.ceil((SESSION_DURATION_MS / 1000) * TICK_RATE);
  }

  tickWorld(): void {
    if (!this.matchStarted) return;
    this.tick++;
    const now = this.tick;

    if (this.isMatchOver()) return; // no movement, rescue, adoption, or spawns after match end

    if (now >= this.spawnPetAt) {
      this.spawnPetAt = now + STRAY_SPAWN_TICKS;
      for (let i = 0; i < STRAY_SPAWN_COUNT; i++) {
        const pos = this.randomPosOutsideAdoptionZone();
        if (pos) {
          const pid = `pet-${++this.petIdSeq}`;
          this.pets.set(pid, {
            id: pid,
            x: pos.x,
            y: pos.y,
            vx: 0,
            vy: 0,
            insideShelterId: null,
          });
        }
      }
    }
    if (now >= this.spawnPickupAt) {
      this.spawnPickupAt = now + PICKUP_SPAWN_TICKS;
      const pos = this.randomPosOutsideAdoptionZone();
      if (pos) {
        const uid = `pickup-${++this.pickupIdSeq}`;
        const type = Math.random() < 0.7 ? PICKUP_TYPE_GROWTH : PICKUP_TYPE_SPEED;
        this.pickups.set(uid, {
          id: uid,
          x: pos.x,
          y: pos.y,
          type,
        });
      }
    }

    for (const p of this.players.values()) {
      let inputFlags = (p as PlayerState & { lastInputFlags?: number }).lastInputFlags ?? 0;
      if (p.id.startsWith('cpu-')) inputFlags = this.cpuAI(p);
      const grounded = this.isGrounded(p);
      const ported = this.autoJumpedPlayerIds.has(p.id);
      if (p.size < AUTO_JUMP_ADOPTIONS) this.autoJumpedPlayerIds.delete(p.id);
      if (grounded || (ported && p.size >= AUTO_JUMP_ADOPTIONS)) {
        p.vx = 0;
        p.vy = 0;
      } else {
        this.applyInput(p, inputFlags);
      }
      let nx = p.x + p.vx;
      let ny = p.y + p.vy;
      const radius = shelterRadius(p.size);
      nx = clamp(nx, radius, MAP_WIDTH - radius);
      ny = clamp(ny, radius, MAP_HEIGHT - radius);
      for (const other of this.players.values()) {
        if (other.id === p.id) continue;
        const or = shelterRadius(other.size);
        const minDist = radius + or;
        const dNew = dist(nx, ny, other.x, other.y);
        if (dNew < minDist && dNew > 0) {
          const push = minDist - dNew;
          const ux = (nx - other.x) / dNew;
          const uy = (ny - other.y) / dNew;
          nx += ux * push;
          ny += uy * push;
        }
      }
      p.x = clamp(nx, radius, MAP_WIDTH - radius);
      p.y = clamp(ny, radius, MAP_HEIGHT - radius);
    }
    for (const p of this.players.values()) {
      const groundedOrPorted = this.isGrounded(p) || this.autoJumpedPlayerIds.has(p.id);
      if (!groundedOrPorted) continue;
      const sr = shelterRadius(p.size);
      const gravityRadius = sr + 550;
      const pullPerTick = this.autoJumpedPlayerIds.has(p.id) ? 5 : 2;
      for (const pet of this.pets.values()) {
        if (pet.insideShelterId !== null) continue;
        const d = dist(p.x, p.y, pet.x, pet.y);
        if (d > gravityRadius || d < 1) continue;
        const dx = (p.x - pet.x) / d;
        const dy = (p.y - pet.y) / d;
        pet.x += dx * pullPerTick;
        pet.y += dy * pullPerTick;
      }
    }

    for (const p of this.players.values()) {
      const radius = shelterRadius(p.size);
      for (const [uid, u] of Array.from(this.pickups.entries())) {
        if (dist(p.x, p.y, u.x, u.y) > radius + GROWTH_ORB_RADIUS) continue;
        this.pickups.delete(uid);
        p.speedBoostUntil = 0; // end speed boost when picking up any boost
        if (u.type === PICKUP_TYPE_GROWTH) {
          p.size += GROWTH_ORB_VALUE;
        } else if (u.type === PICKUP_TYPE_SPEED) {
          p.speedBoostUntil = now + SPEED_BOOST_DURATION_TICKS;
        }
      }
    }

    for (const p of this.players.values()) {
      const capacity = Math.floor(p.size);
      const sr = shelterRadius(p.size);
      const rescueRadius = Math.max(RESCUE_RADIUS, sr + PET_RADIUS);
      while (p.petsInside.length < capacity) {
        let best: PetState | null = null;
        let bestD = rescueRadius + 1;
        for (const pet of this.pets.values()) {
          if (pet.insideShelterId !== null) continue;
          const d = dist(p.x, p.y, pet.x, pet.y);
          if (d < bestD) {
            bestD = d;
            best = pet;
          }
        }
        if (!best) break;
        best.insideShelterId = p.id;
        p.petsInside.push(best.id);
        p.speedBoostUntil = 0; // end speed boost when picking up a stray
      }
    }

    const doAdopt = (p: PlayerState, zoneX: number, zoneY: number, groundedAdoption = false): void => {
      if (p.petsInside.length === 0) return;
      const last = this.lastAdoptionTick.get(p.id) ?? 0;
      let interval = groundedAdoption
        ? ADOPTION_TICKS_GROUNDED
        : (p.petsInside.length >= ADOPTION_FAST_PET_THRESHOLD ? ADOPTION_TICKS_INTERVAL_FAST : ADOPTION_TICKS_INTERVAL);
      if (!groundedAdoption) {
        interval = Math.max(8, Math.floor(interval / (1 + Math.floor(p.size) / 15)));
        if (this.adoptSpeedPlayerIds.has(p.id)) interval = Math.max(5, Math.floor(interval * 0.5));
      } else {
        interval = Math.max(15, Math.floor(interval / (1 + Math.floor(p.size) / 20)));
      }
      if (now - last < interval) return;
      const pid = p.petsInside.pop()!;
      const pet = this.pets.get(pid);
      if (pet) {
        pet.insideShelterId = null;
        pet.x = zoneX;
        pet.y = zoneY;
      }
      this.pets.delete(pid);
      p.totalAdoptions++;
      p.size += GROWTH_PER_ADOPTION;
      this.lastAdoptionTick.set(p.id, now);
    };

    for (const zone of this.adoptionZones) {
      for (const p of this.players.values()) {
        const sr = shelterRadius(p.size);
        if (dist(p.x, p.y, zone.x, zone.y) > zone.radius + sr) continue;
        doAdopt(p, zone.x, zone.y);
        if (p.totalAdoptions >= AUTO_JUMP_ADOPTIONS && !this.autoJumpedPlayerIds.has(p.id)) {
          this.autoJumpedPlayerIds.add(p.id);
          const r = shelterRadius(p.size);
          let pos = this.randomPosOutsideAdoptionZoneWithMargin(r);
          if (!pos) {
            // Guarantee a spot far from center so we never stay stuck (e.g. corner)
            pos = { x: MAP_WIDTH * 0.15, y: MAP_HEIGHT * 0.15 };
            if (dist(pos.x, pos.y, zone.x, zone.y) <= zone.radius + r) {
              pos = { x: MAP_WIDTH * 0.85, y: MAP_HEIGHT * 0.15 };
            }
            if (dist(pos.x, pos.y, zone.x, zone.y) <= zone.radius + r) {
              pos = { x: MAP_WIDTH * 0.15, y: MAP_HEIGHT * 0.85 };
            }
          }
          p.x = clamp(pos.x, r, MAP_WIDTH - r);
          p.y = clamp(pos.y, r, MAP_HEIGHT - r);
        }
      }
    }

    for (const p of this.players.values()) {
      const groundedOrPorted = this.isGrounded(p) || this.autoJumpedPlayerIds.has(p.id);
      if (!groundedOrPorted || p.petsInside.length === 0) continue;
      doAdopt(p, p.x, p.y, true);
      if (p.totalAdoptions >= AUTO_JUMP_ADOPTIONS && !this.autoJumpedPlayerIds.has(p.id)) {
        this.autoJumpedPlayerIds.add(p.id);
        const r = shelterRadius(p.size);
        let pos = this.randomPosOutsideAdoptionZoneWithMargin(r);
        if (!pos) {
          const zone = this.adoptionZones[0];
          pos = { x: MAP_WIDTH * 0.15, y: MAP_HEIGHT * 0.15 };
          if (zone && dist(pos.x, pos.y, zone.x, zone.y) <= zone.radius + r) {
            pos = { x: MAP_WIDTH * 0.85, y: MAP_HEIGHT * 0.15 };
          }
          if (zone && dist(pos.x, pos.y, zone.x, zone.y) <= zone.radius + r) {
            pos = { x: MAP_WIDTH * 0.15, y: MAP_HEIGHT * 0.85 };
          }
        }
        p.x = clamp(pos.x, r, MAP_WIDTH - r);
        p.y = clamp(pos.y, r, MAP_HEIGHT - r);
      }
    }

    for (const p of this.players.values()) {
      for (const pid of p.petsInside) {
        const pet = this.pets.get(pid);
        if (pet) {
          pet.x = p.x;
          pet.y = p.y;
          pet.vx = p.vx;
          pet.vy = p.vy;
        }
      }
    }
  }

  getSnapshot(): GameSnapshot {
    return {
      tick: this.tick,
      matchEndAt: this.matchEndAt,
      players: Array.from(this.players.values()).map((p) => ({
        ...p,
        petsInside: [...p.petsInside],
      })),
      pets: Array.from(this.pets.values()),
      adoptionZones: this.adoptionZones.map((z) => ({ ...z })),
      pickups: Array.from(this.pickups.values()),
    };
  }

  isMatchOver(): boolean {
    return this.tick >= this.matchEndAt;
  }
}
