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
  RESCUE_RADIUS,
  ADOPTION_ZONE_RADIUS,
  ADOPTION_TICKS_INTERVAL,
  GROWTH_PER_ADOPTION,
  INITIAL_SHELTER_SIZE,
  SESSION_DURATION_MS,
  STRAY_SPAWN_TICKS,
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

export class World {
  private tick = 0;
  private matchEndAt = 0;
  private players = new Map<string, PlayerState>();
  private pets = new Map<string, PetState>();
  private adoptionZones: AdoptionZoneState[] = [];
  private pickups = new Map<string, PickupState>();
  private petIdSeq = 0;
  private pickupIdSeq = 0;
  private spawnPetAt = 0;
  private spawnPickupAt = 0;
  private lastAdoptionTick = new Map<string, number>();

  constructor() {
    this.matchEndAt = Math.ceil((SESSION_DURATION_MS / 1000) * TICK_RATE);
    this.spawnPetAt = 0;
    this.adoptionZones.push({
      id: 'adopt-1',
      x: MAP_WIDTH / 2,
      y: MAP_HEIGHT / 2,
      radius: ADOPTION_ZONE_RADIUS,
    });
  }

  addPlayer(id: string): void {
    const x = MAP_WIDTH * (0.2 + Math.random() * 0.6);
    const y = MAP_HEIGHT * (0.2 + Math.random() * 0.6);
    this.players.set(id, {
      id,
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
  }

  setInput(id: string, inputFlags: number, inputSeq: number): void {
    const p = this.players.get(id);
    if (!p) return;
    p.inputSeq = inputSeq;
    (p as PlayerState & { lastInputFlags?: number }).lastInputFlags = inputFlags;
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

  tickWorld(): void {
    this.tick++;
    const now = this.tick;

    if (now >= this.spawnPetAt) {
      this.spawnPetAt = now + STRAY_SPAWN_TICKS;
      const pid = `pet-${++this.petIdSeq}`;
      this.pets.set(pid, {
        id: pid,
        x: MAP_WIDTH * Math.random(),
        y: MAP_HEIGHT * Math.random(),
        vx: 0,
        vy: 0,
        insideShelterId: null,
      });
    }
    if (now >= this.spawnPickupAt) {
      this.spawnPickupAt = now + PICKUP_SPAWN_TICKS;
      const uid = `pickup-${++this.pickupIdSeq}`;
      const type = Math.random() < 0.7 ? PICKUP_TYPE_GROWTH : PICKUP_TYPE_SPEED;
      this.pickups.set(uid, {
        id: uid,
        x: MAP_WIDTH * Math.random(),
        y: MAP_HEIGHT * Math.random(),
        type,
      });
    }

    for (const p of this.players.values()) {
      const inputFlags = (p as PlayerState & { lastInputFlags?: number }).lastInputFlags ?? 0;
      this.applyInput(p, inputFlags);
      const radius = SHELTER_BASE_RADIUS + p.size * 4;
      p.x = clamp(p.x + p.vx, radius, MAP_WIDTH - radius);
      p.y = clamp(p.y + p.vy, radius, MAP_HEIGHT - radius);
    }

    for (const p of this.players.values()) {
      const radius = SHELTER_BASE_RADIUS + p.size * 4;
      for (const [uid, u] of Array.from(this.pickups.entries())) {
        if (dist(p.x, p.y, u.x, u.y) > radius + GROWTH_ORB_RADIUS) continue;
        this.pickups.delete(uid);
        if (u.type === PICKUP_TYPE_GROWTH) {
          p.size += GROWTH_ORB_VALUE;
        } else if (u.type === PICKUP_TYPE_SPEED) {
          p.speedBoostUntil = now + SPEED_BOOST_DURATION_TICKS;
        }
      }
    }

    for (const p of this.players.values()) {
      const capacity = Math.floor(p.size);
      while (p.petsInside.length < capacity) {
        let best: PetState | null = null;
        let bestD = RESCUE_RADIUS + 1;
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
      }
    }

    for (const zone of this.adoptionZones) {
      for (const p of this.players.values()) {
        if (dist(p.x, p.y, zone.x, zone.y) > zone.radius) continue;
        if (p.petsInside.length === 0) continue;
        const last = this.lastAdoptionTick.get(p.id) ?? 0;
        if (now - last < ADOPTION_TICKS_INTERVAL) continue;
        const pid = p.petsInside.pop()!;
        const pet = this.pets.get(pid);
        if (pet) {
          pet.insideShelterId = null;
          pet.x = zone.x;
          pet.y = zone.y;
        }
        this.pets.delete(pid);
        p.totalAdoptions++;
        p.size += GROWTH_PER_ADOPTION;
        this.lastAdoptionTick.set(p.id, now);
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
