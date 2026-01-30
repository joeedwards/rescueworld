"use strict";
/**
 * Authoritative world: shelters (players) move, collect strays, adopt at zones to grow.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.World = void 0;
const shared_1 = require("shared");
const shared_2 = require("shared");
const shared_3 = require("shared");
function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}
function dist(ax, ay, bx, by) {
    return Math.hypot(bx - ax, by - ay);
}
function shelterRadius(size) {
    return shared_1.SHELTER_BASE_RADIUS + size * shared_1.SHELTER_RADIUS_PER_SIZE;
}
class World {
    constructor() {
        this.tick = 0;
        this.matchEndAt = 0;
        this.matchStarted = false;
        this.players = new Map();
        this.pets = new Map();
        this.adoptionZones = [];
        this.pickups = new Map();
        this.petIdSeq = 0;
        this.pickupIdSeq = 0;
        this.spawnPetAt = 0;
        this.spawnPickupAt = 0;
        this.lastAdoptionTick = new Map();
        this.adoptSpeedPlayerIds = new Set();
        this.autoJumpedPlayerIds = new Set();
        this.spawnPetAt = 0;
        this.adoptionZones.push({
            id: 'adopt-1',
            x: shared_1.MAP_WIDTH / 2,
            y: shared_1.MAP_HEIGHT / 2,
            radius: shared_1.ADOPTION_ZONE_RADIUS,
        });
    }
    addPlayer(id, displayName) {
        const name = displayName ?? `rescue${String(100 + Math.floor(Math.random() * 900))}`;
        const x = shared_1.MAP_WIDTH * (0.2 + Math.random() * 0.6);
        const y = shared_1.MAP_HEIGHT * (0.2 + Math.random() * 0.6);
        this.players.set(id, {
            id,
            displayName: name,
            x,
            y,
            vx: 0,
            vy: 0,
            size: shared_1.INITIAL_SHELTER_SIZE,
            totalAdoptions: 0,
            petsInside: [],
            speedBoostUntil: 0,
            inputSeq: 0,
        });
    }
    isInsideAdoptionZone(x, y) {
        for (const zone of this.adoptionZones) {
            if (dist(x, y, zone.x, zone.y) <= zone.radius)
                return true;
        }
        return false;
    }
    randomPosOutsideAdoptionZone() {
        return this.randomPosOutsideAdoptionZoneWithMargin(0);
    }
    randomPosOutsideAdoptionZoneWithMargin(margin) {
        for (let i = 0; i < 50; i++) {
            const x = shared_1.MAP_WIDTH * Math.random();
            const y = shared_1.MAP_HEIGHT * Math.random();
            let ok = true;
            for (const zone of this.adoptionZones) {
                if (dist(x, y, zone.x, zone.y) <= zone.radius + margin) {
                    ok = false;
                    break;
                }
            }
            if (ok)
                return { x, y };
        }
        return null;
    }
    removePlayer(id) {
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
    isGrounded(p) {
        return shelterRadius(p.size) >= shared_1.ADOPTION_ZONE_RADIUS * shared_1.GROUNDED_ZONE_RATIO;
    }
    setInput(id, inputFlags, inputSeq) {
        const p = this.players.get(id);
        if (!p)
            return;
        p.inputSeq = inputSeq;
        p.lastInputFlags = inputFlags;
    }
    applyStartingBoosts(id, boosts) {
        const p = this.players.get(id);
        if (!p)
            return;
        if (typeof boosts.sizeBonus === 'number' && boosts.sizeBonus > 0) {
            p.size += boosts.sizeBonus;
        }
        if (boosts.speedBoost) {
            p.speedBoostUntil = this.tick + shared_1.SPEED_BOOST_DURATION_TICKS;
        }
        if (boosts.adoptSpeed) {
            this.adoptSpeedPlayerIds.add(id);
        }
    }
    directionToward(px, py, tx, ty) {
        let flags = 0;
        const dx = tx - px;
        const dy = ty - py;
        if (Math.abs(dx) > 2)
            flags |= dx < 0 ? shared_2.INPUT_LEFT : shared_2.INPUT_RIGHT;
        if (Math.abs(dy) > 2)
            flags |= dy < 0 ? shared_2.INPUT_UP : shared_2.INPUT_DOWN;
        return flags;
    }
    cpuAI(p) {
        const zone = this.adoptionZones[0];
        if (!zone)
            return 0;
        const capacity = Math.floor(p.size);
        const shelterRadius = shared_1.SHELTER_BASE_RADIUS + p.size * shared_1.SHELTER_RADIUS_PER_SIZE;
        const rescueRadius = Math.max(shared_1.RESCUE_RADIUS, shelterRadius + shared_1.PET_RADIUS);
        const inZone = dist(p.x, p.y, zone.x, zone.y) <= zone.radius + shelterRadius;
        if (inZone && p.petsInside.length > 0)
            return 0;
        if (p.petsInside.length >= capacity && !inZone) {
            return this.directionToward(p.x, p.y, zone.x, zone.y);
        }
        let bestX = p.x;
        let bestY = p.y;
        let bestD = 1e9;
        for (const pet of this.pets.values()) {
            if (pet.insideShelterId !== null)
                continue;
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
        if (bestD < 1e9)
            return this.directionToward(p.x, p.y, bestX, bestY);
        return this.directionToward(p.x, p.y, zone.x, zone.y);
    }
    applyInput(p, inputFlags) {
        let dx = 0, dy = 0;
        if (inputFlags & shared_2.INPUT_LEFT)
            dx -= 1;
        if (inputFlags & shared_2.INPUT_RIGHT)
            dx += 1;
        if (inputFlags & shared_2.INPUT_UP)
            dy -= 1;
        if (inputFlags & shared_2.INPUT_DOWN)
            dy += 1;
        if (dx !== 0 || dy !== 0) {
            const len = Math.hypot(dx, dy) || 1;
            const speed = p.speedBoostUntil > this.tick ? shared_1.SHELTER_SPEED * shared_1.SPEED_BOOST_MULTIPLIER : shared_1.SHELTER_SPEED;
            const perTick = speed / shared_1.TICK_RATE;
            p.vx = (dx / len) * perTick;
            p.vy = (dy / len) * perTick;
        }
        else {
            p.vx = 0;
            p.vy = 0;
        }
    }
    startMatch() {
        this.matchStarted = true;
        this.matchEndAt = this.tick + Math.ceil((shared_1.SESSION_DURATION_MS / 1000) * shared_1.TICK_RATE);
    }
    tickWorld() {
        if (!this.matchStarted)
            return;
        this.tick++;
        const now = this.tick;
        if (this.isMatchOver())
            return; // no movement, rescue, adoption, or spawns after match end
        if (now >= this.spawnPetAt) {
            this.spawnPetAt = now + shared_1.STRAY_SPAWN_TICKS;
            for (let i = 0; i < shared_1.STRAY_SPAWN_COUNT; i++) {
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
            this.spawnPickupAt = now + shared_1.PICKUP_SPAWN_TICKS;
            const pos = this.randomPosOutsideAdoptionZone();
            if (pos) {
                const uid = `pickup-${++this.pickupIdSeq}`;
                const type = Math.random() < 0.7 ? shared_3.PICKUP_TYPE_GROWTH : shared_3.PICKUP_TYPE_SPEED;
                this.pickups.set(uid, {
                    id: uid,
                    x: pos.x,
                    y: pos.y,
                    type,
                });
            }
        }
        for (const p of this.players.values()) {
            let inputFlags = p.lastInputFlags ?? 0;
            if (p.id.startsWith('cpu-'))
                inputFlags = this.cpuAI(p);
            const grounded = this.isGrounded(p);
            const ported = this.autoJumpedPlayerIds.has(p.id);
            if (p.size < shared_1.AUTO_JUMP_ADOPTIONS)
                this.autoJumpedPlayerIds.delete(p.id);
            if (grounded || (ported && p.size >= shared_1.AUTO_JUMP_ADOPTIONS)) {
                p.vx = 0;
                p.vy = 0;
            }
            else {
                this.applyInput(p, inputFlags);
            }
            let nx = p.x + p.vx;
            let ny = p.y + p.vy;
            const radius = shelterRadius(p.size);
            nx = clamp(nx, radius, shared_1.MAP_WIDTH - radius);
            ny = clamp(ny, radius, shared_1.MAP_HEIGHT - radius);
            for (const other of this.players.values()) {
                if (other.id === p.id)
                    continue;
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
            p.x = clamp(nx, radius, shared_1.MAP_WIDTH - radius);
            p.y = clamp(ny, radius, shared_1.MAP_HEIGHT - radius);
        }
        for (const p of this.players.values()) {
            const groundedOrPorted = this.isGrounded(p) || this.autoJumpedPlayerIds.has(p.id);
            if (!groundedOrPorted)
                continue;
            const sr = shelterRadius(p.size);
            const gravityRadius = sr + 550;
            const pullPerTick = this.autoJumpedPlayerIds.has(p.id) ? 5 : 2;
            for (const pet of this.pets.values()) {
                if (pet.insideShelterId !== null)
                    continue;
                const d = dist(p.x, p.y, pet.x, pet.y);
                if (d > gravityRadius || d < 1)
                    continue;
                const dx = (p.x - pet.x) / d;
                const dy = (p.y - pet.y) / d;
                pet.x += dx * pullPerTick;
                pet.y += dy * pullPerTick;
            }
        }
        for (const p of this.players.values()) {
            const radius = shelterRadius(p.size);
            for (const [uid, u] of Array.from(this.pickups.entries())) {
                if (dist(p.x, p.y, u.x, u.y) > radius + shared_1.GROWTH_ORB_RADIUS)
                    continue;
                this.pickups.delete(uid);
                p.speedBoostUntil = 0; // end speed boost when picking up any boost
                if (u.type === shared_3.PICKUP_TYPE_GROWTH) {
                    p.size += shared_1.GROWTH_ORB_VALUE;
                }
                else if (u.type === shared_3.PICKUP_TYPE_SPEED) {
                    p.speedBoostUntil = now + shared_1.SPEED_BOOST_DURATION_TICKS;
                }
            }
        }
        for (const p of this.players.values()) {
            const capacity = Math.floor(p.size);
            const sr = shelterRadius(p.size);
            const rescueRadius = Math.max(shared_1.RESCUE_RADIUS, sr + shared_1.PET_RADIUS);
            while (p.petsInside.length < capacity) {
                let best = null;
                let bestD = rescueRadius + 1;
                for (const pet of this.pets.values()) {
                    if (pet.insideShelterId !== null)
                        continue;
                    const d = dist(p.x, p.y, pet.x, pet.y);
                    if (d < bestD) {
                        bestD = d;
                        best = pet;
                    }
                }
                if (!best)
                    break;
                best.insideShelterId = p.id;
                p.petsInside.push(best.id);
                p.speedBoostUntil = 0; // end speed boost when picking up a stray
            }
        }
        const doAdopt = (p, zoneX, zoneY, groundedAdoption = false) => {
            if (p.petsInside.length === 0)
                return;
            const last = this.lastAdoptionTick.get(p.id) ?? 0;
            let interval = groundedAdoption
                ? shared_1.ADOPTION_TICKS_GROUNDED
                : (p.petsInside.length >= shared_1.ADOPTION_FAST_PET_THRESHOLD ? shared_1.ADOPTION_TICKS_INTERVAL_FAST : shared_1.ADOPTION_TICKS_INTERVAL);
            if (!groundedAdoption) {
                interval = Math.max(8, Math.floor(interval / (1 + Math.floor(p.size) / 15)));
                if (this.adoptSpeedPlayerIds.has(p.id))
                    interval = Math.max(5, Math.floor(interval * 0.5));
            }
            else {
                interval = Math.max(15, Math.floor(interval / (1 + Math.floor(p.size) / 20)));
            }
            if (now - last < interval)
                return;
            const pid = p.petsInside.pop();
            const pet = this.pets.get(pid);
            if (pet) {
                pet.insideShelterId = null;
                pet.x = zoneX;
                pet.y = zoneY;
            }
            this.pets.delete(pid);
            p.totalAdoptions++;
            p.size += shared_1.GROWTH_PER_ADOPTION;
            this.lastAdoptionTick.set(p.id, now);
        };
        for (const zone of this.adoptionZones) {
            for (const p of this.players.values()) {
                const sr = shelterRadius(p.size);
                if (dist(p.x, p.y, zone.x, zone.y) > zone.radius + sr)
                    continue;
                doAdopt(p, zone.x, zone.y);
                if (p.totalAdoptions >= shared_1.AUTO_JUMP_ADOPTIONS && !this.autoJumpedPlayerIds.has(p.id)) {
                    this.autoJumpedPlayerIds.add(p.id);
                    const r = shelterRadius(p.size);
                    let pos = this.randomPosOutsideAdoptionZoneWithMargin(r);
                    if (!pos) {
                        // Guarantee a spot far from center so we never stay stuck (e.g. corner)
                        pos = { x: shared_1.MAP_WIDTH * 0.15, y: shared_1.MAP_HEIGHT * 0.15 };
                        if (dist(pos.x, pos.y, zone.x, zone.y) <= zone.radius + r) {
                            pos = { x: shared_1.MAP_WIDTH * 0.85, y: shared_1.MAP_HEIGHT * 0.15 };
                        }
                        if (dist(pos.x, pos.y, zone.x, zone.y) <= zone.radius + r) {
                            pos = { x: shared_1.MAP_WIDTH * 0.15, y: shared_1.MAP_HEIGHT * 0.85 };
                        }
                    }
                    p.x = clamp(pos.x, r, shared_1.MAP_WIDTH - r);
                    p.y = clamp(pos.y, r, shared_1.MAP_HEIGHT - r);
                }
            }
        }
        for (const p of this.players.values()) {
            const groundedOrPorted = this.isGrounded(p) || this.autoJumpedPlayerIds.has(p.id);
            if (!groundedOrPorted || p.petsInside.length === 0)
                continue;
            doAdopt(p, p.x, p.y, true);
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
    getSnapshot() {
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
    isMatchOver() {
        return this.tick >= this.matchEndAt;
    }
}
exports.World = World;
