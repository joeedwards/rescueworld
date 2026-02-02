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
// Vans always have fixed collision radius - shelters are separate entities now
const VAN_FIXED_RADIUS = 30; // Fixed collision radius for vans
function effectiveRadius(_p) {
    // All players (vans) use fixed radius - shelters are drawn/collided separately
    return VAN_FIXED_RADIUS;
}
function aabbOverlap(ax, ay, ah, bx, by, bh) {
    return Math.abs(ax - bx) <= ah + bh && Math.abs(ay - by) <= ah + bh;
}
// Upgrade costs
const ADOPTION_CENTER_COST = 250;
const GRAVITY_COST = 300;
const ADVERTISING_COST = 200;
const VAN_SPEED_COST = 150;
// Shelter capacity and upkeep
// Shelter capacity scales with player size (minimum 25)
function shelterMaxPets(playerSize) {
    return Math.max(25, Math.floor(playerSize));
}
const SHELTER_PET_UPKEEP = 2; // 2 RT per pet when delivered to shelter
const SHELTER_TOKENS_PER_ADOPTION = 10; // 10 RT when adopted from your shelter (vs 5 RT at main center)
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
    /** Check if player is an underdog (below 50% of average adoptions) */
    isUnderdog(playerId) {
        const playerCount = this.players.size;
        if (playerCount <= 1)
            return false;
        const player = this.players.get(playerId);
        if (!player)
            return false;
        const totalAdoptions = Array.from(this.players.values()).reduce((sum, p) => sum + p.totalAdoptions, 0);
        const avgAdoptions = totalAdoptions / playerCount;
        return player.totalAdoptions < avgAdoptions * 0.5;
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
        // Underdog buff: 10% faster adoption
        if (this.isUnderdog(p.id)) {
            interval = Math.floor(interval * 0.9);
        }
        return interval;
    }
    constructor() {
        this.tick = 0;
        this.matchStartTick = 0;
        this.matchStartTime = Date.now(); // Real-time clock for match duration
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
        this.groundedPlayerIds = new Set(); // Players who chose to ground themselves
        this.portCharges = new Map(); // Port charges per player
        this.playerColors = new Map(); // Player shelter colors
        this.playerMoney = new Map(); // In-game money per player
        this.eliminatedPlayerIds = new Set();
        this.lastAllyPairs = new Set();
        this.combatOverlapTicks = new Map();
        // Shelter system: separate stationary buildings from vans
        this.shelters = new Map();
        this.shelterIdSeq = 0;
        this.playerShelterIds = new Map(); // playerId -> shelterId
        this.vanSpeedUpgrades = new Set(); // playerIds with van speed upgrade
        this.lastShelterAdoptTick = new Map(); // shelterId -> last adopt tick
        // Timerless game mechanics
        this.winnerId = null;
        this.totalMatchAdoptions = 0;
        this.lastGlobalAdoptionTick = 0;
        this.scarcityLevel = 0;
        this.triggeredEvents = new Set();
        this.satelliteZonesSpawned = false;
        // CPU AI target persistence to prevent diagonal jitter
        this.cpuTargets = new Map();
        // Breeder mini-game spawning - 5 spawns per level, continues throughout match
        this.breederSpawnCount = 0; // Spawns at current level
        this.breederCurrentLevel = 1; // Current breeder level
        this.lastBreederCheckTick = 0;
        this.pendingBreederMiniGames = new Map();
        // Breeder camp tracking for growth mechanic
        this.breederCamps = new Map();
        // Breeder shelters - formed when breeders grow too large
        this.breederShelters = new Map();
        this.breederShelterId = 0;
        // Wild strays (from breeder shelters) - harder to catch, move around
        this.wildStrayIds = new Set();
        // Solo mode options
        this.cpuCanShutdownBreeders = true; // Can be set via game options
        // Match-wide announcements queue
        this.pendingAnnouncements = [];
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
        const sr = effectiveRadius(p);
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
        return this.randomPosOutsideAdoptionZoneWithMargin(World.SPAWN_MARGIN);
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
        this.groundedPlayerIds.delete(id);
        this.portCharges.delete(id);
        this.playerColors.delete(id);
    }
    isGrounded(p) {
        // Legacy: grounded players are stationary. With new shelter system, players are never grounded.
        return this.groundedPlayerIds.has(p.id);
    }
    /** Player has a shelter (separate from van) */
    hasShelter(playerId) {
        return this.playerShelterIds.has(playerId);
    }
    /** Get player's shelter */
    getPlayerShelter(playerId) {
        const shelterId = this.playerShelterIds.get(playerId);
        return shelterId ? this.shelters.get(shelterId) : undefined;
    }
    /** Build a shelter at player's current location - requires size >= 50, 250 RT */
    buildShelter(id) {
        const p = this.players.get(id);
        if (!p)
            return { success: false, reason: 'Player not found' };
        if (this.eliminatedPlayerIds.has(id))
            return { success: false, reason: 'Player eliminated' };
        if (this.hasShelter(id))
            return { success: false, reason: 'Already have a shelter' };
        if (p.size < 50)
            return { success: false, reason: 'Size must be 50 or higher' };
        const currentMoney = this.playerMoney.get(id) ?? 0;
        if (currentMoney < shared_1.SHELTER_BUILD_COST) {
            return { success: false, reason: `Need ${shared_1.SHELTER_BUILD_COST} RT (have ${currentMoney} RT)` };
        }
        // Check distance from central adoption center
        const zone = this.adoptionZones[0];
        if (zone) {
            const dx = p.x - zone.x;
            const dy = p.y - zone.y;
            const distance = Math.sqrt(dx * dx + dy * dy);
            const minDistance = zone.radius + 100;
            if (distance < minDistance) {
                return { success: false, reason: 'Too close to adoption center' };
            }
        }
        // Create shelter at player's current position
        const shelterId = `shelter-${++this.shelterIdSeq}`;
        const shelter = {
            id: shelterId,
            ownerId: id,
            x: p.x,
            y: p.y,
            hasAdoptionCenter: false,
            hasGravity: false,
            hasAdvertising: false,
            petsInside: [],
            size: 10, // Initial shelter size
            totalAdoptions: 0,
        };
        this.shelters.set(shelterId, shelter);
        this.playerShelterIds.set(id, shelterId);
        this.playerMoney.set(id, currentMoney - shared_1.SHELTER_BUILD_COST);
        console.log(`[rescue] Player ${p.displayName} built shelter at (${p.x.toFixed(0)}, ${p.y.toFixed(0)})`);
        return { success: true };
    }
    /** Buy adoption center upgrade for player's shelter */
    buyAdoptionCenter(id) {
        const shelter = this.getPlayerShelter(id);
        if (!shelter)
            return { success: false, reason: 'No shelter built' };
        if (shelter.hasAdoptionCenter)
            return { success: false, reason: 'Already have adoption center' };
        const currentMoney = this.playerMoney.get(id) ?? 0;
        if (currentMoney < ADOPTION_CENTER_COST) {
            return { success: false, reason: `Need ${ADOPTION_CENTER_COST} RT (have ${currentMoney} RT)` };
        }
        shelter.hasAdoptionCenter = true;
        this.playerMoney.set(id, currentMoney - ADOPTION_CENTER_COST);
        console.log(`[rescue] Player ${id} bought adoption center`);
        return { success: true };
    }
    /** Buy gravity pull upgrade for player's shelter */
    buyGravity(id) {
        const shelter = this.getPlayerShelter(id);
        if (!shelter)
            return { success: false, reason: 'No shelter built' };
        if (shelter.hasGravity)
            return { success: false, reason: 'Already have gravity' };
        const currentMoney = this.playerMoney.get(id) ?? 0;
        if (currentMoney < GRAVITY_COST) {
            return { success: false, reason: `Need ${GRAVITY_COST} RT (have ${currentMoney} RT)` };
        }
        shelter.hasGravity = true;
        this.playerMoney.set(id, currentMoney - GRAVITY_COST);
        console.log(`[rescue] Player ${id} bought gravity pull`);
        return { success: true };
    }
    /** Buy advertising upgrade for player's shelter */
    buyAdvertising(id) {
        const shelter = this.getPlayerShelter(id);
        if (!shelter)
            return { success: false, reason: 'No shelter built' };
        if (shelter.hasAdvertising)
            return { success: false, reason: 'Already have advertising' };
        const currentMoney = this.playerMoney.get(id) ?? 0;
        if (currentMoney < ADVERTISING_COST) {
            return { success: false, reason: `Need ${ADVERTISING_COST} RT (have ${currentMoney} RT)` };
        }
        shelter.hasAdvertising = true;
        this.playerMoney.set(id, currentMoney - ADVERTISING_COST);
        console.log(`[rescue] Player ${id} bought advertising`);
        return { success: true };
    }
    /** Buy permanent van speed upgrade */
    buyVanSpeed(id) {
        const p = this.players.get(id);
        if (!p)
            return { success: false, reason: 'Player not found' };
        if (this.vanSpeedUpgrades.has(id))
            return { success: false, reason: 'Already have van speed upgrade' };
        const currentMoney = this.playerMoney.get(id) ?? 0;
        if (currentMoney < VAN_SPEED_COST) {
            return { success: false, reason: `Need ${VAN_SPEED_COST} RT (have ${currentMoney} RT)` };
        }
        this.vanSpeedUpgrades.add(id);
        this.playerMoney.set(id, currentMoney - VAN_SPEED_COST);
        console.log(`[rescue] Player ${id} bought van speed upgrade`);
        return { success: true };
    }
    /** Check if player has a shelter (legacy compatibility for isPlayerGrounded) */
    isPlayerGrounded(id) {
        return this.hasShelter(id);
    }
    /** Legacy groundPlayer for backward compatibility - now calls buildShelter */
    groundPlayer(id) {
        return this.buildShelter(id);
    }
    /** Set player's shelter color */
    setPlayerColor(id, color) {
        if (this.players.has(id)) {
            this.playerColors.set(id, color);
        }
    }
    /** Use a port charge to teleport to a random location */
    usePort(id) {
        const p = this.players.get(id);
        if (!p || this.eliminatedPlayerIds.has(id))
            return false;
        const charges = this.portCharges.get(id) ?? 0;
        if (charges <= 0)
            return false;
        // Find a random position outside adoption zones
        const r = effectiveRadius(p);
        let pos = this.randomPosOutsideAdoptionZoneWithMargin(r);
        if (!pos) {
            // Fallback positions
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
        this.portCharges.set(id, charges - 1);
        // Porting ungrounds the player
        this.groundedPlayerIds.delete(id);
        return true;
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
        // Vans (not grounded) are capped at VAN_MAX_CAPACITY
        const isGrounded = this.groundedPlayerIds.has(p.id);
        const capacity = isGrounded ? Math.floor(p.size) : Math.min(Math.floor(p.size), shared_1.VAN_MAX_CAPACITY);
        const sr = shared_1.SHELTER_BASE_RADIUS + p.size * shared_1.SHELTER_RADIUS_PER_SIZE;
        const touchingZone = this.shelterInZoneAABB(p, zone);
        // PRIORITY: Flee from enemy shelters - don't approach them
        for (const shelter of this.shelters.values()) {
            if (shelter.ownerId === p.id)
                continue;
            if (this.isAlly(p.id, shelter.ownerId, this.lastAllyPairs))
                continue;
            const shelterR = shelterRadius(shelter.size);
            const dangerRadius = shelterR + 100; // Stay away from enemy shelters
            const d = dist(p.x, p.y, shelter.x, shelter.y);
            if (d < dangerRadius) {
                // Flee away from enemy shelter
                const dx = p.x - shelter.x;
                const dy = p.y - shelter.y;
                const len = Math.hypot(dx, dy) || 1;
                const fleeX = clamp(p.x + (dx / len) * 200, 50, shared_1.MAP_WIDTH - 50);
                const fleeY = clamp(p.y + (dy / len) * 200, 50, shared_1.MAP_HEIGHT - 50);
                this.cpuTargets.set(p.id, { x: fleeX, y: fleeY, type: 'wander' });
                return this.directionToward(p.x, p.y, fleeX, fleeY);
            }
        }
        // Stop to adopt if shelter touches zone and has pets
        if (touchingZone && p.petsInside.length > 0) {
            this.cpuTargets.delete(p.id); // Clear target while adopting
            return 0;
        }
        // Go to zone edge if full and not touching yet
        // But first check if we have an ally with a shelter to deliver to
        if (p.petsInside.length >= capacity && !touchingZone) {
            // Check for ally shelters to deliver to
            for (const other of this.players.values()) {
                if (other.id === p.id)
                    continue;
                if (!this.isAlly(p.id, other.id, this.lastAllyPairs))
                    continue;
                const allyShelter = this.getPlayerShelter(other.id);
                if (allyShelter && allyShelter.petsInside.length < shelterMaxPets(other.size)) {
                    this.cpuTargets.set(p.id, { x: allyShelter.x, y: allyShelter.y, type: 'zone' });
                    return this.directionToward(p.x, p.y, allyShelter.x, allyShelter.y);
                }
            }
            // No ally shelter, go to adoption zone
            const edge = this.zoneSquareEdgeTarget(zone, p.x, p.y, sr, false);
            this.cpuTargets.set(p.id, { x: edge.x, y: edge.y, type: 'zone' });
            return this.directionToward(p.x, p.y, edge.x, edge.y);
        }
        // Check if current target is still valid
        const currentTarget = this.cpuTargets.get(p.id);
        const TARGET_REACH_DIST = 30; // Distance threshold to consider target reached
        if (currentTarget) {
            const distToTarget = dist(p.x, p.y, currentTarget.x, currentTarget.y);
            // Target reached - clear it
            if (distToTarget < TARGET_REACH_DIST) {
                this.cpuTargets.delete(p.id);
            }
            else {
                // Check if target is still valid (stray/pickup still exists at location)
                let targetValid = false;
                if (currentTarget.type === 'stray') {
                    for (const pet of this.pets.values()) {
                        if (pet.insideShelterId === null && dist(pet.x, pet.y, currentTarget.x, currentTarget.y) < 20) {
                            targetValid = true;
                            break;
                        }
                    }
                }
                else if (currentTarget.type === 'pickup') {
                    for (const u of this.pickups.values()) {
                        if (dist(u.x, u.y, currentTarget.x, currentTarget.y) < 20) {
                            targetValid = true;
                            break;
                        }
                    }
                }
                else if (currentTarget.type === 'wander') {
                    // Wander targets are always valid until reached
                    targetValid = true;
                }
                if (targetValid) {
                    return this.directionToward(p.x, p.y, currentTarget.x, currentTarget.y);
                }
                else {
                    this.cpuTargets.delete(p.id);
                }
            }
        }
        // Need new target - look for strays/pickups across the ENTIRE map
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
            // Skip breeder camps if CPU is not allowed to shut them down
            if (u.type === shared_3.PICKUP_TYPE_BREEDER && !this.cpuCanShutdownBreeders)
                continue;
            const d = dist(p.x, p.y, u.x, u.y);
            pickupCandidates.push({ x: u.x, y: u.y, d });
        }
        pickupCandidates.sort((a, b) => a.d - b.d);
        // Pick target with slight randomness (but persist it)
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
            this.cpuTargets.set(p.id, { x: strayTarget.x, y: strayTarget.y, type: 'stray' });
            return this.directionToward(p.x, p.y, strayTarget.x, strayTarget.y);
        }
        if (pickupTarget) {
            this.cpuTargets.set(p.id, { x: pickupTarget.x, y: pickupTarget.y, type: 'pickup' });
            return this.directionToward(p.x, p.y, pickupTarget.x, pickupTarget.y);
        }
        // No strays or pickups on map: wander randomly (not toward zone)
        const wanderX = shared_1.MAP_WIDTH * (0.1 + Math.random() * 0.8);
        const wanderY = shared_1.MAP_HEIGHT * (0.1 + Math.random() * 0.8);
        this.cpuTargets.set(p.id, { x: wanderX, y: wanderY, type: 'wander' });
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
            // Base van speed (vans no longer grow, so use constant speed)
            let baseSpeed = shared_1.SHELTER_SPEED;
            // Underdog buff: 10% faster movement
            if (this.isUnderdog(p.id)) {
                baseSpeed *= 1.1;
            }
            // Van speed upgrade: permanent 20% boost
            if (this.vanSpeedUpgrades.has(p.id)) {
                baseSpeed *= 1.2;
            }
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
        this.matchStartTick = this.tick;
        this.matchStartTime = Date.now(); // Reset clock when match starts
        // No timer - game ends only via adoption milestone or domination
        // Use max Uint32 value to avoid protocol overflow (Uint32 can't hold Number.MAX_SAFE_INTEGER)
        this.matchEndAt = 0xFFFFFFFF;
        // Initialize anti-stall tracking
        this.lastGlobalAdoptionTick = this.tick;
        this.scarcityLevel = 0;
        this.totalMatchAdoptions = 0;
        this.triggeredEvents.clear();
        this.satelliteZonesSpawned = false;
        this.winnerId = null;
        // Reset shelter system
        this.shelters.clear();
        this.playerShelterIds.clear();
        this.vanSpeedUpgrades.clear();
        this.lastShelterAdoptTick.clear();
        // Reset CPU AI targets
        this.cpuTargets.clear();
        // Reset breeder spawn tracking
        this.breederSpawnCount = 0;
        this.breederCurrentLevel = 1;
        this.pendingBreederMiniGames.clear();
        this.breederCamps.clear();
        this.breederShelters.clear();
        this.wildStrayIds.clear();
        this.pendingAnnouncements = [];
    }
    /** Set whether CPU players can attempt to shut down breeders (solo mode option) */
    setCpuBreederBehavior(canShutdown) {
        this.cpuCanShutdownBreeders = canShutdown;
    }
    tickWorld(fightAllyChoices, allyRequests) {
        if (!this.matchStarted)
            return;
        this.tick++;
        const now = this.tick;
        if (this.isMatchOver())
            return; // no movement, rescue, adoption, or spawns after match end
        const allyPairs = fightAllyChoices ? World.allyPairsFromChoices(fightAllyChoices) : new Set();
        // Helper to check if both players have mutual ally requests (clicked ally on each other before overlap)
        const hasMutualAllyRequest = (aId, bId) => {
            if (!allyRequests)
                return false;
            const aRequests = allyRequests.get(aId);
            const bRequests = allyRequests.get(bId);
            return !!(aRequests?.has(bId) && bRequests?.has(aId));
        };
        // Anti-stall: Scarcity escalation when no adoptions for too long
        const ticksSinceAdoption = now - this.lastGlobalAdoptionTick;
        if (this.lastGlobalAdoptionTick > 0 && ticksSinceAdoption > shared_1.SCARCITY_TRIGGER_TICKS) {
            const newScarcityLevel = Math.min(3, Math.floor(ticksSinceAdoption / shared_1.SCARCITY_TRIGGER_TICKS));
            if (newScarcityLevel > this.scarcityLevel) {
                this.scarcityLevel = newScarcityLevel;
                console.log(`[rescue] Scarcity level ${this.scarcityLevel} activated at tick ${now}`);
                // Level 2+: Spawn bonus strays outside adoption zone
                if (this.scarcityLevel >= 2) {
                    const bonusCount = this.scarcityLevel * 5;
                    for (let i = 0; i < bonusCount; i++) {
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
            }
            // Level 1+: Drift strays toward center (slowly) but stop at adoption zone edge
            if (this.scarcityLevel >= 1) {
                const centerX = shared_1.MAP_WIDTH / 2;
                const centerY = shared_1.MAP_HEIGHT / 2;
                const driftSpeed = this.scarcityLevel * 0.5;
                const stopDistance = shared_1.ADOPTION_ZONE_RADIUS + World.SPAWN_MARGIN; // Don't drift into adoption zone
                for (const pet of this.pets.values()) {
                    if (pet.insideShelterId !== null)
                        continue;
                    if (this.wildStrayIds.has(pet.id))
                        continue; // Wild strays don't drift
                    const dx = centerX - pet.x;
                    const dy = centerY - pet.y;
                    const d = Math.hypot(dx, dy);
                    if (d > stopDistance) {
                        pet.x += (dx / d) * driftSpeed;
                        pet.y += (dy / d) * driftSpeed;
                    }
                }
            }
        }
        // Wild strays (from breeder shelters) move around randomly - harder to catch!
        for (const petId of this.wildStrayIds) {
            const pet = this.pets.get(petId);
            if (!pet || pet.insideShelterId !== null) {
                this.wildStrayIds.delete(petId); // No longer wild if caught
                continue;
            }
            // Random movement with occasional direction changes
            if (this.tick % 30 === 0 || (pet.vx === 0 && pet.vy === 0)) {
                // Change direction randomly
                const angle = Math.random() * Math.PI * 2;
                const speed = World.BREEDER_STRAY_SPEED;
                pet.vx = Math.cos(angle) * speed;
                pet.vy = Math.sin(angle) * speed;
            }
            // Apply movement
            pet.x = clamp(pet.x + pet.vx, 50, shared_1.MAP_WIDTH - 50);
            pet.y = clamp(pet.y + pet.vy, 50, shared_1.MAP_HEIGHT - 50);
            // Bounce off edges
            if (pet.x <= 50 || pet.x >= shared_1.MAP_WIDTH - 50)
                pet.vx *= -1;
            if (pet.y <= 50 || pet.y >= shared_1.MAP_HEIGHT - 50)
                pet.vy *= -1;
        }
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
                // Check if we should spawn a breeder event (12% chance, continues throughout match)
                // Also guarantee first breeder after 15 seconds if none have spawned at level 1
                const ticksSinceStart = this.tick - this.matchStartTick;
                const guaranteeBreeder = this.breederCurrentLevel === 1 &&
                    this.breederSpawnCount === 0 &&
                    ticksSinceStart >= World.BREEDER_GUARANTEED_SPAWN_TICKS;
                const shouldSpawnBreeder = guaranteeBreeder || Math.random() < World.BREEDER_SPAWN_CHANCE;
                if (shouldSpawnBreeder) {
                    const level = this.breederCurrentLevel;
                    this.pickups.set(uid, {
                        id: uid,
                        x: pos.x,
                        y: pos.y,
                        type: shared_3.PICKUP_TYPE_BREEDER,
                        level,
                    });
                    this.breederSpawnCount++;
                    // Track the breeder camp for growth mechanic
                    this.breederCamps.set(uid, { x: pos.x, y: pos.y, spawnTick: this.tick, level });
                    // Always announce breeder spawns
                    this.pendingAnnouncements.push(`Level ${level} breeder camp appeared!`);
                    // Check if we should advance to next level
                    if (this.breederSpawnCount >= World.BREEDERS_PER_LEVEL) {
                        this.breederSpawnCount = 0;
                        this.breederCurrentLevel++;
                        console.log(`[rescue] Breeder level ${level} completed (advancing to level ${this.breederCurrentLevel})`);
                    }
                    else {
                        console.log(`[rescue] Breeder event spawned (level ${level}, ${this.breederSpawnCount}/${World.BREEDERS_PER_LEVEL})`);
                    }
                }
                else {
                    // Regular pickup: 60% growth, 25% speed, 15% port
                    const roll = Math.random();
                    const type = roll < 0.6 ? shared_3.PICKUP_TYPE_GROWTH : roll < 0.85 ? shared_3.PICKUP_TYPE_SPEED : shared_3.PICKUP_TYPE_PORT;
                    this.pickups.set(uid, {
                        id: uid,
                        x: pos.x,
                        y: pos.y,
                        type,
                    });
                }
            }
        }
        // Breeder camp growth: if a camp isn't shut down, spawn another next to it
        // Breeders can outgrow players and eventually form breeder shelters!
        for (const [uid, camp] of Array.from(this.breederCamps.entries())) {
            // Only grow if still exists in pickups (wasn't collected)
            if (!this.pickups.has(uid)) {
                this.breederCamps.delete(uid);
                continue;
            }
            const ticksAlive = this.tick - camp.spawnTick;
            // Check every BREEDER_GROWTH_TICKS (level doesn't slow growth anymore - breeders are aggressive!)
            const growthThreshold = World.BREEDER_GROWTH_TICKS;
            if (ticksAlive >= growthThreshold) {
                const newLevel = camp.level + 1;
                // At level 4+, convert to a breeder shelter!
                if (newLevel >= World.BREEDER_SHELTER_LEVEL) {
                    // Remove the camp pickup and create a breeder shelter
                    this.pickups.delete(uid);
                    this.breederCamps.delete(uid);
                    const shelterId = `breeder-shelter-${++this.breederShelterId}`;
                    this.breederShelters.set(shelterId, {
                        x: camp.x,
                        y: camp.y,
                        level: newLevel,
                        lastSpawnTick: this.tick,
                        size: 50 + (newLevel - World.BREEDER_SHELTER_LEVEL) * 20,
                    });
                    this.pendingAnnouncements.push(`⚠️ BREEDER SHELTER FORMED! They're now breeding more strays!`);
                    console.log(`[rescue] Breeder shelter formed at (${Math.round(camp.x)}, ${Math.round(camp.y)}) - level ${newLevel}`);
                }
                else {
                    // Spawn a new camp next to this one (no limit on camps now!)
                    const angle = Math.random() * Math.PI * 2;
                    const newX = clamp(camp.x + Math.cos(angle) * World.BREEDER_GROWTH_RADIUS, 50, shared_1.MAP_WIDTH - 50);
                    const newY = clamp(camp.y + Math.sin(angle) * World.BREEDER_GROWTH_RADIUS, 50, shared_1.MAP_HEIGHT - 50);
                    const newUid = `pickup-${++this.pickupIdSeq}`;
                    this.pickups.set(newUid, {
                        id: newUid,
                        x: newX,
                        y: newY,
                        type: shared_3.PICKUP_TYPE_BREEDER,
                        level: newLevel,
                    });
                    this.breederSpawnCount++;
                    this.breederCamps.set(newUid, { x: newX, y: newY, spawnTick: this.tick, level: newLevel });
                    // Update original camp's spawn tick so it doesn't immediately grow again
                    camp.spawnTick = this.tick;
                    camp.level = newLevel;
                    // Also update the pickup's level so client can render it
                    const originalPickup = this.pickups.get(uid);
                    if (originalPickup) {
                        originalPickup.level = newLevel;
                    }
                    // Announce the growth
                    this.pendingAnnouncements.push(`Level ${newLevel} breeders are expanding! More camps have appeared!`);
                    console.log(`[rescue] Breeder camp grew! Level ${newLevel} spawned at (${Math.round(newX)}, ${Math.round(newY)})`);
                }
            }
        }
        // Breeder shelters spawn wild strays that are harder to catch
        for (const [shelterId, shelter] of this.breederShelters.entries()) {
            // Grow the shelter over time
            if (shelter.level < World.MAX_BREEDER_LEVEL) {
                const growthCheck = this.tick % (World.BREEDER_GROWTH_TICKS * 2) === 0;
                if (growthCheck) {
                    shelter.level++;
                    shelter.size += 20;
                    console.log(`[rescue] Breeder shelter ${shelterId} grew to level ${shelter.level}`);
                }
            }
            // Spawn wild strays (2x spawn rate compared to normal)
            const spawnInterval = World.BREEDER_SHELTER_SPAWN_INTERVAL / 2; // 2x faster
            if (this.tick - shelter.lastSpawnTick >= spawnInterval) {
                shelter.lastSpawnTick = this.tick;
                // Spawn 1-2 wild strays around the shelter
                const numStrays = 1 + (shelter.level >= 6 ? 1 : 0);
                for (let i = 0; i < numStrays; i++) {
                    const angle = Math.random() * Math.PI * 2;
                    const dist = 50 + Math.random() * 100;
                    const sx = clamp(shelter.x + Math.cos(angle) * dist, 50, shared_1.MAP_WIDTH - 50);
                    const sy = clamp(shelter.y + Math.sin(angle) * dist, 50, shared_1.MAP_HEIGHT - 50);
                    const petId = `pet-${++this.petIdSeq}`;
                    this.pets.set(petId, {
                        id: petId,
                        x: sx,
                        y: sy,
                        vx: (Math.random() - 0.5) * 2,
                        vy: (Math.random() - 0.5) * 2,
                        insideShelterId: null,
                    });
                    this.wildStrayIds.add(petId); // Mark as wild stray
                }
            }
        }
        // Shelter vs Breeder Shelter combat
        // Player shelters always win, but lose pets based on breeder level
        const destroyedBreederShelters = [];
        for (const [breederShelterId, breederShelter] of this.breederShelters.entries()) {
            for (const playerShelter of this.shelters.values()) {
                const bsr = 40 + breederShelter.size * 0.5; // Breeder shelter radius
                const psr = shelterRadius(playerShelter.size);
                if (!aabbOverlap(breederShelter.x, breederShelter.y, bsr, playerShelter.x, playerShelter.y, psr))
                    continue;
                // Combat! Player shelter always wins, but loses pets based on breeder level
                let petLoss = 0;
                if (breederShelter.level >= 10) {
                    petLoss = 3 * breederShelter.level; // 3x at level 10+
                }
                else if (breederShelter.level >= 3) {
                    petLoss = breederShelter.level; // 1x at level 3-9
                }
                // Level 1-2: no pet loss
                // Apply pet loss
                for (let i = 0; i < petLoss && playerShelter.petsInside.length > 0; i++) {
                    const petId = playerShelter.petsInside.pop();
                    if (petId)
                        this.pets.delete(petId);
                }
                // Mark breeder shelter for destruction
                destroyedBreederShelters.push(breederShelterId);
                const owner = this.players.get(playerShelter.ownerId);
                const lossText = petLoss > 0 ? ` (lost ${petLoss} pets)` : '';
                this.pendingAnnouncements.push(`${owner?.displayName ?? 'A shelter'} destroyed a Level ${breederShelter.level} breeder shelter!${lossText}`);
                console.log(`[rescue] Player ${owner?.displayName} destroyed level ${breederShelter.level} breeder shelter (lost ${petLoss} pets)`);
                break; // One combat per breeder shelter per tick
            }
        }
        // Remove destroyed breeder shelters
        for (const id of destroyedBreederShelters) {
            this.breederShelters.delete(id);
        }
        // Event system: trigger global events at adoption milestones
        for (const milestone of shared_1.EVENT_MILESTONES) {
            if (this.totalMatchAdoptions >= milestone && !this.triggeredEvents.has(milestone)) {
                this.triggeredEvents.add(milestone);
                console.log(`[rescue] Event triggered at ${milestone} total adoptions`);
                const centerX = shared_1.MAP_WIDTH / 2;
                const centerY = shared_1.MAP_HEIGHT / 2;
                if (milestone === 50) {
                    // Donation Surge: spawn extra pickups across the map
                    for (let i = 0; i < 10; i++) {
                        const pos = this.randomPosOutsideAdoptionZone();
                        if (pos) {
                            const uid = `pickup-${++this.pickupIdSeq}`;
                            this.pickups.set(uid, { id: uid, x: pos.x, y: pos.y, type: shared_3.PICKUP_TYPE_GROWTH });
                        }
                    }
                }
                else if (milestone === 100) {
                    // Celebrity Pet: high-value strays spawn outside adoption zone
                    for (let i = 0; i < 8; i++) {
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
                else if (milestone === 200) {
                    // Stray Flood: 20 bonus strays spawn across map
                    for (let i = 0; i < 20; i++) {
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
                else if (milestone === 300) {
                    // Final push: spawn bonus strays and pickups everywhere
                    for (let i = 0; i < 15; i++) {
                        const pos = this.randomPosOutsideAdoptionZone();
                        if (pos) {
                            const pid = `pet-${++this.petIdSeq}`;
                            this.pets.set(pid, { id: pid, x: pos.x, y: pos.y, vx: 0, vy: 0, insideShelterId: null });
                        }
                    }
                    for (let i = 0; i < 8; i++) {
                        const pos = this.randomPosOutsideAdoptionZone();
                        if (pos) {
                            const uid = `pickup-${++this.pickupIdSeq}`;
                            const type = Math.random() < 0.5 ? shared_3.PICKUP_TYPE_GROWTH : shared_3.PICKUP_TYPE_SPEED;
                            this.pickups.set(uid, { id: uid, x: pos.x, y: pos.y, type });
                        }
                    }
                }
            }
        }
        // Satellite adoption zones disabled - only one central adoption center
        // if (this.totalMatchAdoptions >= SATELLITE_ZONE_MILESTONE && !this.satelliteZonesSpawned) {
        //   this.satelliteZonesSpawned = true;
        //   const satelliteRadius = ADOPTION_ZONE_RADIUS * 0.7;
        //   this.adoptionZones.push({ id: 'adopt-2', x: MAP_WIDTH * 0.2, y: MAP_HEIGHT * 0.2, radius: satelliteRadius });
        //   this.adoptionZones.push({ id: 'adopt-3', x: MAP_WIDTH * 0.8, y: MAP_HEIGHT * 0.8, radius: satelliteRadius });
        // }
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
            if (grounded) {
                p.vx = 0;
                p.vy = 0;
            }
            else {
                this.applyInput(p, inputFlags);
            }
            let nx = p.x + p.vx;
            let ny = p.y + p.vy;
            const radius = effectiveRadius(p);
            nx = clamp(nx, radius, shared_1.MAP_WIDTH - radius);
            ny = clamp(ny, radius, shared_1.MAP_HEIGHT - radius);
            // Vans can pass through each other (no van-van collision)
            // Vans only collide with stationary shelters (not other vans)
            for (const shelter of this.shelters.values()) {
                if (shelter.ownerId === p.id)
                    continue; // Don't collide with own shelter
                const sr = shelterRadius(shelter.size);
                if (!aabbOverlap(nx, ny, radius, shelter.x, shelter.y, sr))
                    continue;
                const penX = radius + sr - Math.abs(nx - shelter.x);
                const penY = radius + sr - Math.abs(ny - shelter.y);
                if (penX <= 0 || penY <= 0)
                    continue;
                // Push in the direction of least penetration, but respect map bounds
                if (penX <= penY) {
                    const pushDir = nx > shelter.x ? 1 : -1;
                    const newNx = nx + pushDir * penX;
                    // Only apply if it keeps us in bounds
                    if (newNx >= radius && newNx <= shared_1.MAP_WIDTH - radius) {
                        nx = newNx;
                    }
                }
                else {
                    const pushDir = ny > shelter.y ? 1 : -1;
                    const newNy = ny + pushDir * penY;
                    // Only apply if it keeps us in bounds
                    if (newNy >= radius && newNy <= shared_1.MAP_HEIGHT - radius) {
                        ny = newNy;
                    }
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
                // Must be size 10+ to engage
                if (a.size < shared_1.COMBAT_MIN_SIZE || b.size < shared_1.COMBAT_MIN_SIZE) {
                    this.combatOverlapTicks.delete(key);
                    continue;
                }
                // Only shelters can engage in combat - vans cannot attack
                const shelterA = this.getPlayerShelter(a.id);
                const shelterB = this.getPlayerShelter(b.id);
                if (!shelterA || !shelterB) {
                    this.combatOverlapTicks.delete(key);
                    continue;
                }
                // Use shelter positions and sizes for combat detection
                const ra = shelterRadius(shelterA.size);
                const rb = shelterRadius(shelterB.size);
                if (!aabbOverlap(shelterA.x, shelterA.y, ra, shelterB.x, shelterB.y, rb)) {
                    this.combatOverlapTicks.delete(key);
                    continue;
                }
                // Check ally: only ally if BOTH chose 'ally' for each other
                const aIsCpu = a.id.startsWith('cpu-');
                const bIsCpu = b.id.startsWith('cpu-');
                if (fightAllyChoices) {
                    const aToB = fightAllyChoices.get(`${a.id},${b.id}`);
                    const bToA = fightAllyChoices.get(`${b.id},${a.id}`);
                    // CPU ally logic: if human chose ally towards CPU, CPU randomly decides
                    // CPU has 40% base chance to ally, higher if human is larger (they're safer)
                    if (aIsCpu && !bIsCpu && bToA === 'ally' && aToB === undefined) {
                        const cpuAllyChance = 0.4 + (b.size > a.size ? 0.2 : 0);
                        fightAllyChoices.set(`${a.id},${b.id}`, Math.random() < cpuAllyChance ? 'ally' : 'fight');
                    }
                    if (bIsCpu && !aIsCpu && aToB === 'ally' && bToA === undefined) {
                        const cpuAllyChance = 0.4 + (a.size > b.size ? 0.2 : 0);
                        fightAllyChoices.set(`${b.id},${a.id}`, Math.random() < cpuAllyChance ? 'ally' : 'fight');
                    }
                    // Re-check after CPU decision
                    const aToBFinal = fightAllyChoices.get(`${a.id},${b.id}`);
                    const bToAFinal = fightAllyChoices.get(`${b.id},${a.id}`);
                    if (aToBFinal === 'ally' && bToAFinal === 'ally') {
                        this.combatOverlapTicks.delete(key);
                        continue;
                    }
                }
                // Check for mutual ally requests (clicked ally on each other before overlap)
                if (!aIsCpu && !bIsCpu && hasMutualAllyRequest(a.id, b.id)) {
                    this.combatOverlapTicks.delete(key);
                    continue;
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
                // Transfer scales with winner size so large vs small is nearly instant (within ~2 adopt intervals)
                const transferCap = Math.max(1, Math.floor(winner.size / shared_1.COMBAT_TRANSFER_SIZE_RATIO_DIVISOR));
                let transfer = Math.min(Math.floor(loser.size), transferCap);
                // Early-game protection: no elimination below EARLY_GAME_PROTECTION_SIZE until conditions met
                const matchAgeTicks = this.tick - this.matchStartTick;
                const maxAdoptions = Math.max(...Array.from(this.players.values()).map(p => p.totalAdoptions));
                const earlyGameActive = matchAgeTicks < shared_1.EARLY_GAME_PROTECTION_TICKS && maxAdoptions < shared_1.EARLY_GAME_PROTECTION_ADOPTIONS;
                if (earlyGameActive) {
                    // Cap transfer so loser doesn't drop below protection threshold
                    const maxTransfer = Math.max(0, Math.floor(loser.size) - shared_1.EARLY_GAME_PROTECTION_SIZE);
                    transfer = Math.min(transfer, maxTransfer);
                }
                if (transfer > 0) {
                    winner.size += transfer;
                    loser.size -= transfer;
                    // Risk-on-carry: Raid drop - loser drops 50% of carried strays as loose strays
                    const dropCount = Math.floor(loser.petsInside.length * 0.5);
                    for (let i = 0; i < dropCount; i++) {
                        const droppedId = loser.petsInside.pop();
                        if (droppedId) {
                            const pet = this.pets.get(droppedId);
                            if (pet) {
                                pet.insideShelterId = null;
                                // Drop strays nearby so others can steal them
                                pet.x = loser.x + (Math.random() - 0.5) * 150;
                                pet.y = loser.y + (Math.random() - 0.5) * 150;
                            }
                        }
                    }
                }
                if (loser.size <= World.ELIMINATED_SIZE_THRESHOLD) {
                    this.eliminatedPlayerIds.add(loser.id);
                }
                // Eject excess pets from loser when capacity drops below what they're holding
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
        // Van-vs-Shelter combat: track attacking vans per shelter
        const attackersPerShelter = new Map(); // shelterId -> [vanIds]
        for (const p of this.players.values()) {
            if (this.eliminatedPlayerIds.has(p.id))
                continue;
            for (const shelter of this.shelters.values()) {
                if (shelter.ownerId === p.id)
                    continue;
                if (this.isAlly(p.id, shelter.ownerId, this.lastAllyPairs))
                    continue;
                const sr = shelterRadius(shelter.size);
                const vanR = VAN_FIXED_RADIUS;
                // Van is attacking if within shelter radius
                if (!aabbOverlap(p.x, p.y, vanR, shelter.x, shelter.y, sr))
                    continue;
                const attackers = attackersPerShelter.get(shelter.id) ?? [];
                attackers.push(p.id);
                attackersPerShelter.set(shelter.id, attackers);
            }
        }
        // Resolve van-vs-shelter combat
        for (const [shelterId, attackerIds] of attackersPerShelter.entries()) {
            const shelter = this.shelters.get(shelterId);
            if (!shelter)
                continue;
            const owner = this.players.get(shelter.ownerId);
            if (!owner)
                continue;
            const sr = shelterRadius(shelter.size);
            // Single attacker always loses against shelter
            if (attackerIds.length === 1) {
                const attacker = this.players.get(attackerIds[0]);
                if (attacker) {
                    // Attacker takes damage: lose 5 size, drop all pets near shelter
                    attacker.size = Math.max(1, attacker.size - 5);
                    while (attacker.petsInside.length > 0) {
                        const petId = attacker.petsInside.pop();
                        const pet = this.pets.get(petId);
                        if (pet) {
                            pet.insideShelterId = null;
                            pet.x = shelter.x + (Math.random() - 0.5) * sr;
                            pet.y = shelter.y + (Math.random() - 0.5) * sr;
                        }
                    }
                    console.log(`[rescue] Van ${attacker.displayName} attacked shelter alone and lost!`);
                }
            }
            else {
                // 2+ attackers: can steal shelter's pets
                // Combined attack strength (each van contributes 50 + pets carried)
                let attackStrength = 0;
                for (const id of attackerIds) {
                    const att = this.players.get(id);
                    if (att)
                        attackStrength += 50 + att.petsInside.length;
                }
                const shelterStrength = shelter.size + shelter.petsInside.length;
                // If attackers combined are stronger, steal pets
                if (attackStrength > shelterStrength) {
                    const stealCount = Math.min(shelter.petsInside.length, attackerIds.length * 5);
                    for (let i = 0; i < stealCount; i++) {
                        const petId = shelter.petsInside.pop();
                        if (!petId)
                            break;
                        // Give to random attacker (if they have space)
                        const randomAttId = attackerIds[Math.floor(Math.random() * attackerIds.length)];
                        const att = this.players.get(randomAttId);
                        if (att && att.petsInside.length < shared_1.VAN_MAX_CAPACITY) {
                            att.petsInside.push(petId);
                            const pet = this.pets.get(petId);
                            if (pet)
                                pet.insideShelterId = att.id;
                        }
                        else {
                            // Attacker full, drop pet nearby
                            const pet = this.pets.get(petId);
                            if (pet) {
                                pet.insideShelterId = null;
                                pet.x = shelter.x + (Math.random() - 0.5) * sr * 2;
                                pet.y = shelter.y + (Math.random() - 0.5) * sr * 2;
                            }
                        }
                    }
                    console.log(`[rescue] ${attackerIds.length} vans raided shelter and stole ${stealCount} pets!`);
                }
                else {
                    // Attackers not strong enough, they all take damage
                    for (const id of attackerIds) {
                        const att = this.players.get(id);
                        if (att) {
                            att.size = Math.max(1, att.size - 3);
                        }
                    }
                    console.log(`[rescue] ${attackerIds.length} vans attacked shelter but failed!`);
                }
            }
        }
        // Domination check: game ends when 1 shelter covers 51% of the actual MAP AREA
        // This is a huge challenge - shelters must grow large through combat and adoptions
        if (!this.matchEndedEarly && this.shelters.size > 0) {
            const mapArea = shared_1.MAP_WIDTH * shared_1.MAP_HEIGHT; // 4800 * 4800 = 23,040,000
            const dominationThreshold = 0.51; // 51% of map
            for (const shelter of this.shelters.values()) {
                if (!shelter.hasAdoptionCenter)
                    continue; // Must have adoption center to win
                const r = shelterRadius(shelter.size);
                const shelterArea = Math.PI * r * r;
                const percent = shelterArea / mapArea;
                if (percent >= dominationThreshold) {
                    this.matchEndedEarly = true;
                    this.matchEndAt = this.tick;
                    this.winnerId = shelter.ownerId;
                    const p = this.players.get(shelter.ownerId);
                    console.log(`[rescue] Map domination by ${p?.displayName ?? shelter.ownerId} - shelter covers ${(percent * 100).toFixed(1)}% of map (radius ${Math.round(r)}, size ${shelter.size}) at tick ${this.tick}`);
                    break;
                }
            }
        }
        // Shelters with gravity upgrade pull strays toward them
        for (const shelter of this.shelters.values()) {
            if (!shelter.hasGravity)
                continue;
            const sr = shelterRadius(shelter.size);
            const gravityRadius = sr + 550;
            const pullPerTick = 3;
            for (const pet of this.pets.values()) {
                if (pet.insideShelterId !== null)
                    continue;
                const d = dist(shelter.x, shelter.y, pet.x, pet.y);
                if (d > gravityRadius || d < 1)
                    continue;
                const dx = (shelter.x - pet.x) / d;
                const dy = (shelter.y - pet.y) / d;
                pet.x += dx * pullPerTick;
                pet.y += dy * pullPerTick;
            }
        }
        // Shelter auto-collect: shelters with adoption center collect strays directly
        for (const shelter of this.shelters.values()) {
            if (!shelter.hasAdoptionCenter)
                continue;
            const owner = this.players.get(shelter.ownerId);
            const maxPets = owner ? shelterMaxPets(owner.size) : 25;
            if (shelter.petsInside.length >= maxPets)
                continue;
            const sr = shelterRadius(shelter.size);
            const collectRadius = sr + 30; // Slightly larger than visual
            for (const pet of this.pets.values()) {
                if (pet.insideShelterId !== null)
                    continue;
                if (shelter.petsInside.length >= maxPets)
                    break;
                const d = dist(shelter.x, shelter.y, pet.x, pet.y);
                if (d <= collectRadius) {
                    // Check owner can afford upkeep
                    const ownerMoney = this.playerMoney.get(shelter.ownerId) ?? 0;
                    if (ownerMoney < SHELTER_PET_UPKEEP)
                        continue;
                    // Collect the pet
                    pet.insideShelterId = shelter.id;
                    shelter.petsInside.push(pet.id);
                    this.playerMoney.set(shelter.ownerId, ownerMoney - SHELTER_PET_UPKEEP);
                }
            }
        }
        // Pet delivery: vans can deliver to their own shelter OR an ally's shelter
        for (const p of this.players.values()) {
            if (this.eliminatedPlayerIds.has(p.id))
                continue;
            if (p.petsInside.length === 0)
                continue;
            // Check all shelters for delivery (own or ally's)
            for (const shelter of this.shelters.values()) {
                const isOwn = shelter.ownerId === p.id;
                const isAlly = this.isAlly(p.id, shelter.ownerId, this.lastAllyPairs);
                if (!isOwn && !isAlly)
                    continue;
                const vanRadius = VAN_FIXED_RADIUS;
                const shelterR = shelterRadius(shelter.size);
                const deliveryDistance = vanRadius + shelterR + 20;
                const d = dist(p.x, p.y, shelter.x, shelter.y);
                if (d > deliveryDistance)
                    continue;
                const shelterOwner = this.players.get(shelter.ownerId);
                const maxPets = shelterOwner ? shelterMaxPets(shelterOwner.size) : 25;
                if (shelter.petsInside.length >= maxPets)
                    continue;
                // Transfer pets with split cost for allies
                while (p.petsInside.length > 0 && shelter.petsInside.length < maxPets) {
                    const delivererMoney = this.playerMoney.get(p.id) ?? 0;
                    const ownerMoney = this.playerMoney.get(shelter.ownerId) ?? 0;
                    if (isOwn) {
                        // Own shelter: owner pays full upkeep
                        if (ownerMoney < SHELTER_PET_UPKEEP)
                            break;
                        this.playerMoney.set(shelter.ownerId, ownerMoney - SHELTER_PET_UPKEEP);
                    }
                    else {
                        // Ally shelter: split cost 1 RT each
                        if (delivererMoney < 1 || ownerMoney < 1)
                            break;
                        this.playerMoney.set(p.id, delivererMoney - 1);
                        this.playerMoney.set(shelter.ownerId, ownerMoney - 1);
                    }
                    const petId = p.petsInside.pop();
                    shelter.petsInside.push(petId);
                }
                break; // Only deliver to one shelter per tick
            }
        }
        for (const p of this.players.values()) {
            if (this.eliminatedPlayerIds.has(p.id))
                continue;
            const radius = effectiveRadius(p);
            for (const [uid, u] of Array.from(this.pickups.entries())) {
                if (dist(p.x, p.y, u.x, u.y) > radius + shared_1.GROWTH_ORB_RADIUS)
                    continue;
                this.pickups.delete(uid);
                if (u.type === shared_3.PICKUP_TYPE_BREEDER) {
                    // Get level before removing from camps tracking
                    const camp = this.breederCamps.get(uid);
                    const level = camp?.level ?? 1;
                    // Higher level = more pets to rescue
                    const basePets = 3 + Math.floor(Math.random() * 3); // 3-5 base
                    const levelBonus = Math.floor((level - 1) / 2); // +1 pet every 2 levels
                    const petCount = Math.min(basePets + levelBonus, 8); // Cap at 8 pets
                    // Breeder mini-game - track for this player with level
                    this.pendingBreederMiniGames.set(p.id, {
                        petCount,
                        startTick: now,
                        level,
                    });
                    // Remove from breeder camps tracking (prevents growth)
                    this.breederCamps.delete(uid);
                    // Announce breeder takedown attempt
                    this.pendingAnnouncements.push(`${p.displayName} is shutting down a Level ${level} breeder camp!`);
                    console.log(`[rescue] Player ${p.displayName} triggered level ${level} breeder mini-game`);
                }
                else {
                    p.speedBoostUntil = 0; // end speed boost when picking up any boost
                    if (u.type === shared_3.PICKUP_TYPE_GROWTH) {
                        p.size += shared_1.GROWTH_ORB_VALUE;
                    }
                    else if (u.type === shared_3.PICKUP_TYPE_SPEED) {
                        p.speedBoostUntil = now + shared_1.SPEED_BOOST_DURATION_TICKS;
                    }
                    else if (u.type === shared_3.PICKUP_TYPE_PORT) {
                        const current = this.portCharges.get(p.id) ?? 0;
                        this.portCharges.set(p.id, current + 1);
                    }
                }
            }
        }
        for (const p of this.players.values()) {
            if (this.eliminatedPlayerIds.has(p.id))
                continue;
            // Vans (not grounded) are capped at VAN_MAX_CAPACITY; shelters use full size capacity
            const isGrounded = this.groundedPlayerIds.has(p.id);
            const capacity = isGrounded ? Math.floor(p.size) : Math.min(Math.floor(p.size), shared_1.VAN_MAX_CAPACITY);
            const sr = effectiveRadius(p);
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
        // Adoption at central adoption zone (van delivers pets there)
        const doAdopt = (p, zoneX, zoneY) => {
            if (p.petsInside.length === 0)
                return;
            const last = this.lastAdoptionTick.get(p.id) ?? 0;
            const interval = this.getAdoptionIntervalTicks(p, false);
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
            const currentMoney = this.playerMoney.get(p.id) ?? 0;
            this.playerMoney.set(p.id, currentMoney + shared_1.TOKENS_PER_ADOPTION);
            this.lastAdoptionTick.set(p.id, now);
            this.totalMatchAdoptions++;
            this.lastGlobalAdoptionTick = now;
            this.scarcityLevel = 0;
        };
        // Shelter adoption (shelter with adoption center adopts pets inside it)
        const doShelterAdopt = (shelter, playerId) => {
            if (shelter.petsInside.length === 0)
                return;
            if (!shelter.hasAdoptionCenter)
                return; // Need adoption center upgrade
            const last = this.lastShelterAdoptTick.get(shelter.id) ?? 0;
            const interval = Math.max(15, Math.floor(shared_1.ADOPTION_TICKS_GROUNDED / (1 + shelter.size / 20)));
            if (now - last < interval)
                return;
            const pid = shelter.petsInside.pop();
            const pet = this.pets.get(pid);
            if (pet) {
                pet.insideShelterId = null;
                pet.x = shelter.x;
                pet.y = shelter.y;
            }
            this.pets.delete(pid);
            shelter.totalAdoptions++;
            shelter.size += shared_1.GROWTH_PER_ADOPTION;
            // Player also gets credit for adoptions
            const p = this.players.get(playerId);
            if (p) {
                p.totalAdoptions++;
                p.size += shared_1.GROWTH_PER_ADOPTION;
                // Shelter adoption gives MORE tokens (10 RT) than main center (5 RT)
                const currentMoney = this.playerMoney.get(playerId) ?? 0;
                this.playerMoney.set(playerId, currentMoney + SHELTER_TOKENS_PER_ADOPTION);
            }
            this.lastShelterAdoptTick.set(shelter.id, now);
            this.totalMatchAdoptions++;
            this.lastGlobalAdoptionTick = now;
            this.scarcityLevel = 0;
            // Victory check moved to domination - 51% of total shelter influence
        };
        // Adoption in central adoption zones (van delivers directly)
        for (const zone of this.adoptionZones) {
            for (const p of this.players.values()) {
                if (!this.shelterInZoneAABB(p, zone))
                    continue;
                doAdopt(p, zone.x, zone.y);
            }
        }
        // Shelter adoption: shelters with adoption center adopt their pets
        for (const shelter of this.shelters.values()) {
            if (shelter.petsInside.length > 0 && shelter.hasAdoptionCenter) {
                doShelterAdopt(shelter, shelter.ownerId);
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
            matchEndedEarly: this.matchEndedEarly || undefined,
            winnerId: this.winnerId || undefined,
            totalMatchAdoptions: this.totalMatchAdoptions,
            scarcityLevel: this.scarcityLevel > 0 ? this.scarcityLevel : undefined,
            matchDurationMs: this.matchStarted ? Date.now() - this.matchStartTime : 0,
            players: Array.from(this.players.values()).map((p) => {
                const eliminated = this.eliminatedPlayerIds.has(p.id);
                const hasShelter = this.hasShelter(p.id);
                const portCount = this.portCharges.get(p.id) ?? 0;
                const color = this.playerColors.get(p.id);
                const allies = [];
                for (const other of this.players.values()) {
                    if (other.id !== p.id && this.isAlly(p.id, other.id, this.lastAllyPairs))
                        allies.push(other.id);
                }
                const money = this.playerMoney.get(p.id) ?? 0;
                const shelterId = this.playerShelterIds.get(p.id);
                const hasVanSpeed = this.vanSpeedUpgrades.has(p.id);
                return {
                    ...p,
                    size: eliminated ? 0 : p.size,
                    petsInside: eliminated ? [] : [...p.petsInside],
                    allies: allies.length ? allies : undefined,
                    eliminated: eliminated || undefined,
                    grounded: hasShelter || undefined, // Legacy: grounded means has shelter
                    portCharges: portCount > 0 ? portCount : undefined,
                    shelterColor: color || undefined,
                    money: money > 0 ? money : undefined,
                    shelterId: shelterId || undefined,
                    vanSpeedUpgrade: hasVanSpeed || undefined,
                };
            }),
            pets: Array.from(this.pets.values()),
            adoptionZones: this.adoptionZones.map((z) => ({ ...z })),
            pickups: Array.from(this.pickups.values()),
            shelters: this.shelters.size > 0 ? Array.from(this.shelters.values()) : undefined,
            breederShelters: this.breederShelters.size > 0
                ? Array.from(this.breederShelters.entries()).map(([id, s]) => ({
                    id,
                    x: s.x,
                    y: s.y,
                    level: s.level,
                    size: s.size,
                }))
                : undefined,
        };
    }
    isMatchOver() {
        return this.tick >= this.matchEndAt;
    }
    /** Deduct tokens from a player (for breeder mini-game food purchases) */
    deductTokens(playerId, amount) {
        const current = this.playerMoney.get(playerId) ?? 0;
        if (current < amount)
            return false;
        this.playerMoney.set(playerId, current - amount);
        return true;
    }
    /** Check if a player has a pending breeder mini-game */
    getPendingBreederMiniGame(playerId) {
        return this.pendingBreederMiniGames.get(playerId) ?? null;
    }
    /** Clear a player's pending breeder mini-game (after they acknowledge it) */
    clearPendingBreederMiniGame(playerId) {
        this.pendingBreederMiniGames.delete(playerId);
    }
    /** Get pending match-wide announcements */
    getPendingAnnouncements() {
        return this.pendingAnnouncements;
    }
    /** Clear pending announcements after broadcasting */
    clearPendingAnnouncements() {
        this.pendingAnnouncements = [];
    }
    /** Complete a breeder mini-game and award rewards or apply penalties */
    completeBreederMiniGame(playerId, rescuedCount, totalPets) {
        this.pendingBreederMiniGames.delete(playerId);
        const player = this.players.get(playerId);
        if (!player)
            return { tokenBonus: 0, rewards: [] };
        const unrescuedCount = totalPets - rescuedCount;
        const rewards = [];
        // PENALTY: Un-rescued pets escape and cost van capacity (size reduction)
        // Penalty scales with breeder level (more pets = higher level)
        // 2 size per unrescued pet for level 1 (3-4 pets), 4 for level 2 (5+ pets)
        if (unrescuedCount > 0) {
            const penaltyPerPet = totalPets >= 5 ? 4 : 2;
            const sizePenalty = unrescuedCount * penaltyPerPet;
            player.size = Math.max(1, player.size - sizePenalty); // Don't go below size 1
            rewards.push({ type: 'penalty', amount: sizePenalty });
            console.log(`[rescue] Player ${player.displayName} failed to rescue ${unrescuedCount} pets, -${sizePenalty} size`);
        }
        // Only give rewards if at least 1 pet was rescued
        if (rescuedCount === 0) {
            console.log(`[rescue] Player ${player.displayName} rescued 0/${totalPets} - no rewards, only penalty`);
            return { tokenBonus: 0, rewards };
        }
        // Calculate rewards based on performance
        const successRate = rescuedCount / totalPets;
        const baseTokens = 30 + Math.floor(successRate * 50); // 30-80 RT
        const tokenBonus = baseTokens;
        // Award tokens
        const currentTokens = this.playerMoney.get(playerId) ?? 0;
        this.playerMoney.set(playerId, currentTokens + tokenBonus);
        // Random item rewards (1-2 items based on success)
        const numItems = rescuedCount >= totalPets ? 2 : 1;
        for (let i = 0; i < numItems; i++) {
            const roll = Math.random();
            if (roll < 0.4) {
                // Size bonus
                player.size += 5;
                rewards.push({ type: 'size', amount: 5 });
            }
            else if (roll < 0.7) {
                // Speed boost
                player.speedBoostUntil = this.tick + shared_1.SPEED_BOOST_DURATION_TICKS * 2;
                rewards.push({ type: 'speed', amount: 1 });
            }
            else {
                // Port charge
                const current = this.portCharges.get(playerId) ?? 0;
                this.portCharges.set(playerId, current + 1);
                rewards.push({ type: 'port', amount: 1 });
            }
        }
        // Announce breeder defeat
        if (rescuedCount > 0) {
            this.pendingAnnouncements.push(`${player.displayName} rescued ${rescuedCount} pets from breeders!`);
        }
        else if (unrescuedCount > 0) {
            this.pendingAnnouncements.push(`${player.displayName} failed to rescue any pets from breeders!`);
        }
        console.log(`[rescue] Player ${player.displayName} completed breeder mini-game: ${rescuedCount}/${totalPets} rescued, +${tokenBonus} RT`);
        return { tokenBonus, rewards };
    }
}
exports.World = World;
World.BREEDERS_PER_LEVEL = 5; // 5 spawns before level increases
World.BREEDER_SPAWN_CHANCE = 0.20; // 20% chance per pickup spawn cycle
World.BREEDER_GUARANTEED_SPAWN_TICKS = 900; // Guarantee first breeder after 15 seconds
World.BREEDER_GROWTH_TICKS = 10800; // 3 minutes at 60 ticks/s before growing
World.BREEDER_GROWTH_RADIUS = 80; // Distance to spawn new camp
World.BREEDER_SHELTER_LEVEL = 4; // Level at which breeders form a shelter
World.MAX_BREEDER_LEVEL = 8; // Maximum breeder level
World.BREEDER_SHELTER_SPAWN_INTERVAL = 300; // Spawn wild stray every 5 seconds
World.BREEDER_STRAY_SPEED = 1.5; // Wild strays move 1.5x faster
// Default spawn margin is half the adoption zone radius to prevent spawning too close
World.SPAWN_MARGIN = shared_1.ADOPTION_ZONE_RADIUS * 0.5;
World.ELIMINATED_SIZE_THRESHOLD = 10;
