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
function aabbOverlap(ax, ay, ah, bx, by, bh) {
    return Math.abs(ax - bx) <= ah + bh && Math.abs(ay - by) <= ah + bh;
}
class World {
    /** Key "a,b" with a < b for ally pair. Both A→B and B→A must be 'ally'. */
    static allyPairsFromChoices(choices) {
        const pairs = new Set();
        const keys = new Set(choices.keys());
        for (const key of keys) {
            const [a, b] = key.split(',');
            if (!a || !b)
                continue;
            const rev = `${b},${a}`;
            if (choices.get(key) === 'ally' && choices.get(rev) === 'ally') {
                pairs.add(a < b ? key : rev);
            }
        }
        return pairs;
    }
    isAlly(a, b, allyPairs) {
        if (a === b)
            return false;
        const key = a < b ? `${a},${b}` : `${b},${a}`;
        return allyPairs.has(key);
    }
    static pairKey(a, b) {
        return a < b ? `${a},${b}` : `${b},${a}`;
    }
    getAdoptionIntervalTicks(p, groundedAdoption) {
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
        return interval;
    }
    constructor() {
        this.tick = 0;
        this.matchEndAt = 0;
        this.matchStarted = false;
        this.matchEndedEarly = false; // True if match ended due to domination
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
        this.eliminatedPlayerIds = new Set();
        this.lastAllyPairs = new Set();
        this.combatOverlapTicks = new Map();
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
    shelterInZoneAABB(p, zone) {
        const sr = shelterRadius(p.size);
        return Math.abs(p.x - zone.x) <= zone.radius + sr && Math.abs(p.y - zone.y) <= zone.radius + sr;
    }
    /** True when shelter CENTER is inside the zone square (for movement decisions, not adoption). */
    shelterCenterInZone(p, zone) {
        return Math.abs(p.x - zone.x) <= zone.radius && Math.abs(p.y - zone.y) <= zone.radius;
    }
    isInsideAdoptionZone(x, y) {
        for (const zone of this.adoptionZones) {
            if (Math.abs(x - zone.x) <= zone.radius && Math.abs(y - zone.y) <= zone.radius)
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
                if (Math.abs(x - zone.x) <= zone.radius + margin && Math.abs(y - zone.y) <= zone.radius + margin) {
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
    /** Simple hash of id for per-CPU variation (0–2). */
    static cpuStrategyIndex(id) {
        let h = 0;
        for (let i = 0; i < id.length; i++)
            h = (h * 31 + id.charCodeAt(i)) >>> 0;
        return h % 3;
    }
    /** Nearest point on zone square boundary; exitOutward = true offsets by sr so shelter clears the zone. */
    zoneSquareEdgeTarget(zone, px, py, sr, exitOutward) {
        const R = zone.radius;
        const zx = zone.x;
        const zy = zone.y;
        const inside = Math.abs(px - zx) <= R && Math.abs(py - zy) <= R;
        let tx;
        let ty;
        if (inside) {
            const toLeft = px - (zx - R);
            const toRight = zx + R - px;
            const toTop = py - (zy - R);
            const toBottom = zy + R - py;
            const minD = Math.min(toLeft, toRight, toTop, toBottom);
            if (minD === toLeft) {
                tx = zx - R;
                ty = py;
            }
            else if (minD === toRight) {
                tx = zx + R;
                ty = py;
            }
            else if (minD === toTop) {
                tx = px;
                ty = zy - R;
            }
            else {
                tx = px;
                ty = zy + R;
            }
            if (exitOutward) {
                const outX = tx === zx ? 0 : tx < zx ? -1 : 1;
                const outY = ty === zy ? 0 : ty < zy ? -1 : 1;
                tx += outX * sr;
                ty += outY * sr;
            }
        }
        else {
            const clampX = Math.max(zx - R, Math.min(zx + R, px));
            const clampY = Math.max(zy - R, Math.min(zy + R, py));
            const leftP = { x: zx - R, y: clampY };
            const rightP = { x: zx + R, y: clampY };
            const topP = { x: clampX, y: zy - R };
            const bottomP = { x: clampX, y: zy + R };
            const dLeft = dist(px, py, leftP.x, leftP.y);
            const dRight = dist(px, py, rightP.x, rightP.y);
            const dTop = dist(px, py, topP.x, topP.y);
            const dBottom = dist(px, py, bottomP.x, bottomP.y);
            const minD = Math.min(dLeft, dRight, dTop, dBottom);
            if (minD === dLeft) {
                tx = leftP.x;
                ty = leftP.y;
            }
            else if (minD === dRight) {
                tx = rightP.x;
                ty = rightP.y;
            }
            else if (minD === dTop) {
                tx = topP.x;
                ty = topP.y;
            }
            else {
                tx = bottomP.x;
                ty = bottomP.y;
            }
            if (exitOutward) {
                const outX = tx === zx ? 0 : tx < zx ? -1 : 1;
                const outY = ty === zy ? 0 : ty < zy ? -1 : 1;
                tx += outX * sr;
                ty += outY * sr;
            }
        }
        return { x: tx, y: ty };
    }
    cpuAI(p) {
        const zone = this.adoptionZones[0];
        if (!zone)
            return 0;
        const capacity = Math.floor(p.size);
        const sr = shared_1.SHELTER_BASE_RADIUS + p.size * shared_1.SHELTER_RADIUS_PER_SIZE;
        const touchingZone = this.shelterInZoneAABB(p, zone);
        // Stop to adopt if shelter touches zone and has pets
        if (touchingZone && p.petsInside.length > 0)
            return 0;
        // Go to zone edge if full and not touching yet
        if (p.petsInside.length >= capacity && !touchingZone) {
            const edge = this.zoneSquareEdgeTarget(zone, p.x, p.y, sr, false);
            return this.directionToward(p.x, p.y, edge.x, edge.y);
        }
        // Not full: look for strays/pickups across the ENTIRE map (not just interest radius)
        const strayCandidates = [];
        const pickupCandidates = [];
        for (const pet of this.pets.values()) {
            if (pet.insideShelterId !== null)
                continue;
            const d = dist(p.x, p.y, pet.x, pet.y);
            strayCandidates.push({ x: pet.x, y: pet.y, d });
        }
        strayCandidates.sort((a, b) => a.d - b.d);
        for (const u of this.pickups.values()) {
            const d = dist(p.x, p.y, u.x, u.y);
            pickupCandidates.push({ x: u.x, y: u.y, d });
        }
        pickupCandidates.sort((a, b) => a.d - b.d);
        const pickWithJitter = (arr) => {
            if (arr.length === 0)
                return null;
            if (arr.length === 1)
                return arr[0];
            const r = Math.random();
            const idx = r < 0.7 ? 0 : r < 0.85 ? 1 : Math.min(2, arr.length - 1);
            return arr[idx] ?? null;
        };
        const strayTarget = pickWithJitter(strayCandidates);
        const pickupTarget = pickWithJitter(pickupCandidates);
        // Prefer strays when not full, then pickups
        if (strayTarget) {
            return this.directionToward(p.x, p.y, strayTarget.x, strayTarget.y);
        }
        if (pickupTarget) {
            return this.directionToward(p.x, p.y, pickupTarget.x, pickupTarget.y);
        }
        // No strays or pickups on map: wander randomly (not toward zone)
        const wanderX = shared_1.MAP_WIDTH * (0.1 + Math.random() * 0.8);
        const wanderY = shared_1.MAP_HEIGHT * (0.1 + Math.random() * 0.8);
        return this.directionToward(p.x, p.y, wanderX, wanderY);
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
            // Base speed scales up for large shelters (200+)
            const baseSpeed = p.size >= shared_1.SHELTER_LARGE_SIZE_THRESHOLD ? shared_1.SHELTER_SPEED_LARGE : shared_1.SHELTER_SPEED;
            const speed = p.speedBoostUntil > this.tick ? baseSpeed * shared_1.SPEED_BOOST_MULTIPLIER : baseSpeed;
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
    tickWorld(fightAllyChoices) {
        if (!this.matchStarted)
            return;
        this.tick++;
        const now = this.tick;
        if (this.isMatchOver())
            return; // no movement, rescue, adoption, or spawns after match end
        const allyPairs = fightAllyChoices ? World.allyPairsFromChoices(fightAllyChoices) : new Set();
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
            if (this.eliminatedPlayerIds.has(p.id)) {
                p.vx = 0;
                p.vy = 0;
                continue;
            }
            let inputFlags = p.lastInputFlags ?? 0;
            if (p.id.startsWith('cpu-'))
                inputFlags = this.cpuAI(p);
            const grounded = this.isGrounded(p);
            const ported = this.autoJumpedPlayerIds.has(p.id);
            if (p.totalAdoptions < shared_1.AUTO_JUMP_ADOPTIONS)
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
                if (allyPairs && this.isAlly(p.id, other.id, allyPairs))
                    continue; // allies can overlap
                const or = shelterRadius(other.size);
                if (!aabbOverlap(nx, ny, radius, other.x, other.y, or))
                    continue;
                const penX = radius + or - Math.abs(nx - other.x);
                const penY = radius + or - Math.abs(ny - other.y);
                if (penX <= 0 || penY <= 0)
                    continue;
                if (penX <= penY) {
                    nx += nx > other.x ? penX : -penX;
                }
                else {
                    ny += ny > other.y ? penY : -penY;
                }
            }
            p.x = clamp(nx, radius, shared_1.MAP_WIDTH - radius);
            p.y = clamp(ny, radius, shared_1.MAP_HEIGHT - radius);
        }
        // Combat: overlapping shelters can fight after sustained overlap time
        const playerList = Array.from(this.players.values());
        const strayCount = Array.from(this.pets.values()).filter((p) => p.insideShelterId === null).length;
        for (let i = 0; i < playerList.length; i++) {
            const a = playerList[i];
            if (this.eliminatedPlayerIds.has(a.id))
                continue;
            for (let j = i + 1; j < playerList.length; j++) {
                const b = playerList[j];
                if (this.eliminatedPlayerIds.has(b.id))
                    continue;
                const key = World.pairKey(a.id, b.id);
                // Must be size 4+ to engage
                if (a.size < shared_1.COMBAT_MIN_SIZE || b.size < shared_1.COMBAT_MIN_SIZE) {
                    this.combatOverlapTicks.delete(key);
                    continue;
                }
                const ra = shelterRadius(a.size);
                const rb = shelterRadius(b.size);
                if (!aabbOverlap(a.x, a.y, ra, b.x, b.y, rb)) {
                    this.combatOverlapTicks.delete(key);
                    continue;
                }
                // Check ally: only ally if BOTH humans chose 'ally' for each other
                const aIsCpu = a.id.startsWith('cpu-');
                const bIsCpu = b.id.startsWith('cpu-');
                if (!aIsCpu && !bIsCpu && fightAllyChoices) {
                    const aToB = fightAllyChoices.get(`${a.id},${b.id}`);
                    const bToA = fightAllyChoices.get(`${b.id},${a.id}`);
                    if (aToB === 'ally' && bToA === 'ally') {
                        this.combatOverlapTicks.delete(key);
                        continue;
                    }
                }
                // Gradual combat: transfer 1 size per combat tick (territorial.io style)
                // Combat tick interval = faster player's adoption interval (faster adopters attack faster)
                const intervalA = this.getAdoptionIntervalTicks(a, false);
                const intervalB = this.getAdoptionIntervalTicks(b, false);
                const combatTickInterval = Math.max(1, Math.min(intervalA, intervalB));
                const nextTicks = (this.combatOverlapTicks.get(key) ?? 0) + 1;
                this.combatOverlapTicks.set(key, nextTicks);
                // Grace period: no combat damage until players have had time to click Ally
                if (nextTicks < shared_1.COMBAT_GRACE_TICKS)
                    continue;
                // Only resolve one "combat tick" per interval (after grace period)
                const ticksAfterGrace = nextTicks - shared_1.COMBAT_GRACE_TICKS;
                if (ticksAfterGrace % combatTickInterval !== 0)
                    continue;
                // Resolve combat with variance (size + pets carried + adopt speed)
                const strengthA = (a.size + a.petsInside.length * shared_1.COMBAT_PET_WEIGHT) * (shared_1.ADOPTION_TICKS_INTERVAL / intervalA);
                const strengthB = (b.size + b.petsInside.length * shared_1.COMBAT_PET_WEIGHT) * (shared_1.ADOPTION_TICKS_INTERVAL / intervalB);
                const baseChanceA = 0.5 + (strengthA - strengthB) * shared_1.COMBAT_STRENGTH_WEIGHT;
                const variance = Math.min(shared_1.COMBAT_MAX_VARIANCE, strayCount * shared_1.COMBAT_STRAY_VARIANCE);
                const jitter = (Math.random() - 0.5) * 2 * variance;
                const chanceA = clamp(baseChanceA + jitter, 0.1, 0.9);
                const winner = Math.random() < chanceA ? a : b;
                const loser = winner === a ? b : a;
                // Transfer 1 size per combat tick (gradual back-and-forth)
                const transfer = Math.min(1, Math.floor(loser.size));
                if (transfer > 0) {
                    winner.size += transfer;
                    loser.size -= transfer;
                }
                if (loser.size <= World.ELIMINATED_SIZE_THRESHOLD) {
                    this.eliminatedPlayerIds.add(loser.id);
                }
                // Eject excess pets from loser when capacity drops
                const loserCapacity = Math.floor(loser.size);
                while (loser.petsInside.length > Math.max(0, loserCapacity)) {
                    const ejectedId = loser.petsInside.pop();
                    if (ejectedId) {
                        const pet = this.pets.get(ejectedId);
                        if (pet) {
                            pet.insideShelterId = null;
                            pet.x = loser.x + (Math.random() - 0.5) * 100;
                            pet.y = loser.y + (Math.random() - 0.5) * 100;
                        }
                    }
                }
            }
        }
        // Check for map domination (only 1 non-eliminated player remaining AND they have significant size)
        // Minimum size 50 to prevent early-game false triggers
        const MIN_DOMINATION_SIZE = 50;
        if (!this.matchEndedEarly && this.players.size > 1) {
            const survivors = Array.from(this.players.values()).filter(p => !this.eliminatedPlayerIds.has(p.id) && p.size > World.ELIMINATED_SIZE_THRESHOLD);
            // Only trigger if exactly 1 survivor AND they have absorbed significant territory
            if (survivors.length === 1 && survivors[0].size >= MIN_DOMINATION_SIZE) {
                // One player has dominated the map - end match early
                this.matchEndedEarly = true;
                this.matchEndAt = this.tick; // End now - the tick recorded is the finish time
                console.log(`[rescue] Map domination by ${survivors[0].displayName} (size ${Math.floor(survivors[0].size)}) at tick ${this.tick}`);
            }
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
            if (this.eliminatedPlayerIds.has(p.id))
                continue;
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
            if (this.eliminatedPlayerIds.has(p.id))
                continue;
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
            const interval = this.getAdoptionIntervalTicks(p, groundedAdoption);
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
                if (!this.shelterInZoneAABB(p, zone))
                    continue;
                doAdopt(p, zone.x, zone.y);
                if (p.totalAdoptions >= shared_1.AUTO_JUMP_ADOPTIONS && !this.autoJumpedPlayerIds.has(p.id)) {
                    this.autoJumpedPlayerIds.add(p.id);
                    const r = shelterRadius(p.size);
                    let pos = this.randomPosOutsideAdoptionZoneWithMargin(r);
                    if (!pos) {
                        pos = { x: shared_1.MAP_WIDTH * 0.15, y: shared_1.MAP_HEIGHT * 0.15 };
                        if (Math.abs(pos.x - zone.x) <= zone.radius + r && Math.abs(pos.y - zone.y) <= zone.radius + r) {
                            pos = { x: shared_1.MAP_WIDTH * 0.85, y: shared_1.MAP_HEIGHT * 0.15 };
                        }
                        if (Math.abs(pos.x - zone.x) <= zone.radius + r && Math.abs(pos.y - zone.y) <= zone.radius + r) {
                            pos = { x: shared_1.MAP_WIDTH * 0.15, y: shared_1.MAP_HEIGHT * 0.85 };
                        }
                    }
                    p.x = clamp(pos.x, r, shared_1.MAP_WIDTH - r);
                    p.y = clamp(pos.y, r, shared_1.MAP_HEIGHT - r);
                }
            }
        }
        for (const p of this.players.values()) {
            if (this.eliminatedPlayerIds.has(p.id))
                continue;
            const groundedOrPorted = this.isGrounded(p) || this.autoJumpedPlayerIds.has(p.id);
            if (!groundedOrPorted || p.petsInside.length === 0)
                continue;
            doAdopt(p, p.x, p.y, true);
            if (p.totalAdoptions >= shared_1.AUTO_JUMP_ADOPTIONS && !this.autoJumpedPlayerIds.has(p.id)) {
                this.autoJumpedPlayerIds.add(p.id);
                const r = shelterRadius(p.size);
                let pos = this.randomPosOutsideAdoptionZoneWithMargin(r);
                if (!pos) {
                    const zone = this.adoptionZones[0];
                    pos = { x: shared_1.MAP_WIDTH * 0.15, y: shared_1.MAP_HEIGHT * 0.15 };
                    if (zone && Math.abs(pos.x - zone.x) <= zone.radius + r && Math.abs(pos.y - zone.y) <= zone.radius + r) {
                        pos = { x: shared_1.MAP_WIDTH * 0.85, y: shared_1.MAP_HEIGHT * 0.15 };
                    }
                    if (zone && Math.abs(pos.x - zone.x) <= zone.radius + r && Math.abs(pos.y - zone.y) <= zone.radius + r) {
                        pos = { x: shared_1.MAP_WIDTH * 0.15, y: shared_1.MAP_HEIGHT * 0.85 };
                    }
                }
                p.x = clamp(pos.x, r, shared_1.MAP_WIDTH - r);
                p.y = clamp(pos.y, r, shared_1.MAP_HEIGHT - r);
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
    getSnapshot() {
        return {
            tick: this.tick,
            matchEndAt: this.matchEndAt,
            players: Array.from(this.players.values()).map((p) => {
                const allies = [];
                for (const other of this.players.values()) {
                    if (other.id !== p.id && this.isAlly(p.id, other.id, this.lastAllyPairs))
                        allies.push(other.id);
                }
                return {
                    ...p,
                    petsInside: [...p.petsInside],
                    allies: allies.length ? allies : undefined,
                    eliminated: this.eliminatedPlayerIds.has(p.id) || undefined,
                };
            }),
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
World.ELIMINATED_SIZE_THRESHOLD = 5;
