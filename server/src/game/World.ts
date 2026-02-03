/**
 * Authoritative world: shelters (players) move, collect strays, adopt at zones to grow.
 */

import type { PlayerState, PetState, AdoptionZoneState, GameSnapshot, PickupState, ShelterState } from 'shared';

/** Timestamped log function for server output */
function log(message: string): void {
  const now = new Date();
  const timestamp = now.toISOString().replace('T', ' ').slice(0, 19);
  console.log(`[${timestamp}] [rescue] ${message}`);
}
import {
  MAP_WIDTH,
  MAP_HEIGHT,
  TICK_RATE,
  SHELTER_SPEED,
  SHELTER_SPEED_LARGE,
  SHELTER_LARGE_SIZE_THRESHOLD,
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
  COMBAT_MIN_SIZE,
  COMBAT_GRACE_TICKS,
  COMBAT_TRANSFER_SIZE_RATIO_DIVISOR,
  COMBAT_PET_WEIGHT,
  COMBAT_STRENGTH_WEIGHT,
  COMBAT_STRAY_VARIANCE,
  COMBAT_MAX_VARIANCE,
  EARLY_GAME_PROTECTION_SIZE,
  EARLY_GAME_PROTECTION_ADOPTIONS,
  EARLY_GAME_PROTECTION_TICKS,
  INITIAL_SHELTER_SIZE,
  STRAY_SPAWN_TICKS,
  STRAY_SPAWN_COUNT,
  GROWTH_ORB_RADIUS,
  GROWTH_ORB_VALUE,
  SPEED_BOOST_DURATION_TICKS,
  SPEED_BOOST_MULTIPLIER,
  PICKUP_SPAWN_TICKS,
  ADOPTION_MILESTONE_WIN,
  SCARCITY_TRIGGER_TICKS,
  SATELLITE_ZONE_MILESTONE,
  EVENT_MILESTONES,
  TOKENS_PER_ADOPTION,
  SHELTER_BUILD_COST,
  VAN_MAX_CAPACITY,
} from 'shared';
import { INPUT_LEFT, INPUT_RIGHT, INPUT_UP, INPUT_DOWN } from 'shared';
import { PICKUP_TYPE_GROWTH, PICKUP_TYPE_SPEED, PICKUP_TYPE_PORT, PICKUP_TYPE_BREEDER } from 'shared';

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function dist(ax: number, ay: number, bx: number, by: number): number {
  return Math.hypot(bx - ax, by - ay);
}

function shelterRadius(size: number): number {
  return SHELTER_BASE_RADIUS + size * SHELTER_RADIUS_PER_SIZE;
}

// Vans always have fixed collision radius - shelters are separate entities now
const VAN_FIXED_RADIUS = 30; // Fixed collision radius for vans
function effectiveRadius(_p: PlayerState): number {
  // All players (vans) use fixed radius - shelters are drawn/collided separately
  return VAN_FIXED_RADIUS;
}

function aabbOverlap(ax: number, ay: number, ah: number, bx: number, by: number, bh: number): boolean {
  return Math.abs(ax - bx) <= ah + bh && Math.abs(ay - by) <= ah + bh;
}

// Upgrade costs
const ADOPTION_CENTER_COST = 250;
const GRAVITY_COST = 300;
const ADVERTISING_COST = 200;
const VAN_SPEED_COST = 150;

// Shelter capacity and upkeep
// Shelter capacity scales with player size (minimum 25)
function shelterMaxPets(playerSize: number): number {
  return Math.max(25, Math.floor(playerSize));
}
const SHELTER_PET_UPKEEP = 2; // 2 RT per pet when delivered to shelter
const SHELTER_TOKENS_PER_ADOPTION = 10; // 10 RT when adopted from your shelter (vs 5 RT at main center)

export class World {
  private tick = 0;
  private matchStartTick = 0;
  private matchStartTime = Date.now(); // Real-time clock for match duration
  private matchEndAt = 0;
  private matchStarted = false;
  private matchEndedEarly = false; // True if match ended due to domination
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
  private groundedPlayerIds = new Set<string>(); // Players who chose to ground themselves
  private portCharges = new Map<string, number>(); // Port charges per player
  private playerColors = new Map<string, string>(); // Player shelter colors
  private playerMoney = new Map<string, number>(); // In-game money per player
  private eliminatedPlayerIds = new Set<string>();
  private lastAllyPairs = new Set<string>();
  private combatOverlapTicks = new Map<string, number>();
  
  // Shelter system: separate stationary buildings from vans
  private shelters = new Map<string, ShelterState>();
  private shelterIdSeq = 0;
  private playerShelterIds = new Map<string, string>(); // playerId -> shelterId
  private vanSpeedUpgrades = new Set<string>(); // playerIds with van speed upgrade
  private lastShelterAdoptTick = new Map<string, number>(); // shelterId -> last adopt tick
  
  // Timerless game mechanics
  private winnerId: string | null = null;
  private totalMatchAdoptions = 0;
  private lastGlobalAdoptionTick = 0;
  private scarcityLevel = 0;
  private triggeredEvents = new Set<number>();
  private satelliteZonesSpawned = false;
  private matchProcessed = false; // Whether match-end inventory/leaderboard has been processed
  
  // CPU AI target persistence to prevent diagonal jitter
  private cpuTargets = new Map<string, { x: number; y: number; type: 'stray' | 'pickup' | 'zone' | 'wander' }>();
  
  // Breeder wave spawning - about every minute (45-75s), spawn all 5 breeders of current level at once
  // Note: TICK_RATE is 25 ticks/second
  private breederSpawnCount = 0; // Total spawns at current level
  private breederCurrentLevel = 1; // Current breeder level
  private static readonly BREEDERS_PER_LEVEL = 5; // 5 breeders per wave
  private static readonly BREEDER_WAVE_MIN_TICKS = 1125; // Minimum 45 seconds between waves (45 * 25)
  private static readonly BREEDER_WAVE_MAX_TICKS = 1875; // Maximum 75 seconds between waves (75 * 25)
  private static readonly BREEDER_FIRST_WAVE_DELAY_TICKS = 250; // First wave after 10 seconds (10 * 25)
  private lastBreederWaveTick = 0; // When last wave spawned
  private nextBreederWaveInterval = 0; // Random interval until next wave
  private breederWaveSpawned = false; // Has the wave for current level been spawned?
  private pendingBreederMiniGames = new Map<string, { petCount: number; startTick: number; level: number }>();
  
  // Breeder camp tracking for growth mechanic
  private breederCamps = new Map<string, { x: number; y: number; spawnTick: number; level: number }>();
  private static readonly BREEDER_GROWTH_TICKS = 4500; // 3 minutes at 25 ticks/s before growing (3 * 60 * 25)
  private static readonly BREEDER_GROWTH_RADIUS = 80; // Distance to spawn new camp
  private static readonly BREEDER_SHELTER_LEVEL = 4; // Level at which breeders form a shelter
  private static readonly MAX_BREEDER_LEVEL = 8; // Maximum breeder level
  
  // Breeder shelters - formed when breeders grow too large
  private breederShelters = new Map<string, { 
    x: number; 
    y: number; 
    level: number; 
    lastSpawnTick: number;
    size: number; // Grows over time
  }>();
  private breederShelterId = 0;
  private static readonly BREEDER_SHELTER_SPAWN_INTERVAL = 125; // Spawn wild stray every 5 seconds (5 * 25 ticks)
  private static readonly BREEDER_STRAY_SPEED = 1.5; // Wild strays move 1.5x faster
  
  // Wild strays (from breeder shelters) - harder to catch, move around
  private wildStrayIds = new Set<string>();
  
  // Solo mode options
  private cpuCanShutdownBreeders = true; // Can be set via game options
  
  // Match-wide announcements queue
  private pendingAnnouncements: string[] = [];

  /** Key "a,b" with a < b for ally pair. Both A→B and B→A must be 'ally'. */
  private static allyPairsFromChoices(choices: Map<string, 'fight' | 'ally'>): Set<string> {
    const pairs = new Set<string>();
    const keys = new Set(choices.keys());
    for (const key of keys) {
      const [a, b] = key.split(',');
      if (!a || !b) continue;
      const rev = `${b},${a}`;
      if (choices.get(key) === 'ally' && choices.get(rev) === 'ally') {
        pairs.add(a < b ? key : rev);
      }
    }
    return pairs;
  }

  private isAlly(a: string, b: string, allyPairs: Set<string>): boolean {
    if (a === b) return false;
    const key = a < b ? `${a},${b}` : `${b},${a}`;
    return allyPairs.has(key);
  }

  private static pairKey(a: string, b: string): string {
    return a < b ? `${a},${b}` : `${b},${a}`;
  }

  /** Check if player is an underdog (below 50% of average adoptions) */
  private isUnderdog(playerId: string): boolean {
    const playerCount = this.players.size;
    if (playerCount <= 1) return false;
    const player = this.players.get(playerId);
    if (!player) return false;
    const totalAdoptions = Array.from(this.players.values()).reduce((sum, p) => sum + p.totalAdoptions, 0);
    const avgAdoptions = totalAdoptions / playerCount;
    return player.totalAdoptions < avgAdoptions * 0.5;
  }

  private getAdoptionIntervalTicks(p: PlayerState, groundedAdoption: boolean): number {
    let interval = groundedAdoption
      ? ADOPTION_TICKS_GROUNDED
      : (p.petsInside.length >= ADOPTION_FAST_PET_THRESHOLD ? ADOPTION_TICKS_INTERVAL_FAST : ADOPTION_TICKS_INTERVAL);
    if (!groundedAdoption) {
      interval = Math.max(8, Math.floor(interval / (1 + Math.floor(p.size) / 15)));
      if (this.adoptSpeedPlayerIds.has(p.id)) interval = Math.max(5, Math.floor(interval * 0.5));
    } else {
      interval = Math.max(15, Math.floor(interval / (1 + Math.floor(p.size) / 20)));
    }
    // Underdog buff: 10% faster adoption
    if (this.isUnderdog(p.id)) {
      interval = Math.floor(interval * 0.9);
    }
    return interval;
  }

  constructor() {
    this.spawnPetAt = 0;
    this.adoptionZones.push({
      id: 'adopt-1',
      x: MAP_WIDTH / 2,
      y: MAP_HEIGHT / 2,
      radius: ADOPTION_ZONE_RADIUS,
    });
  }

  addPlayer(id: string, displayName?: string, startingRT?: number, startingPorts?: number): void {
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
    // Initialize starting RT from inventory chest
    if (startingRT && startingRT > 0) {
      this.playerMoney.set(id, startingRT);
      log(`Player ${name} starting with ${startingRT} RT from chest`);
    }
    // Initialize starting port charges from inventory
    if (startingPorts && startingPorts > 0) {
      this.portCharges.set(id, startingPorts);
      log(`Player ${name} starting with ${startingPorts} port charges`);
    }
  }

  private shelterInZoneAABB(p: PlayerState, zone: AdoptionZoneState): boolean {
    const sr = effectiveRadius(p);
    return Math.abs(p.x - zone.x) <= zone.radius + sr && Math.abs(p.y - zone.y) <= zone.radius + sr;
  }

  /** True when shelter CENTER is inside the zone square (for movement decisions, not adoption). */
  private shelterCenterInZone(p: PlayerState, zone: AdoptionZoneState): boolean {
    return Math.abs(p.x - zone.x) <= zone.radius && Math.abs(p.y - zone.y) <= zone.radius;
  }

  private isInsideAdoptionZone(x: number, y: number): boolean {
    for (const zone of this.adoptionZones) {
      if (Math.abs(x - zone.x) <= zone.radius && Math.abs(y - zone.y) <= zone.radius) return true;
    }
    return false;
  }

  // Default spawn margin is half the adoption zone radius to prevent spawning too close
  private static readonly SPAWN_MARGIN = ADOPTION_ZONE_RADIUS * 0.5;
  
  private randomPosOutsideAdoptionZone(): { x: number; y: number } | null {
    return this.randomPosOutsideAdoptionZoneWithMargin(World.SPAWN_MARGIN);
  }

  private randomPosOutsideAdoptionZoneWithMargin(margin: number): { x: number; y: number } | null {
    const BREEDER_CAMP_AVOID_RADIUS = 80; // Avoid spawning within 80px of breeder camps
    
    for (let i = 0; i < 50; i++) {
      const x = MAP_WIDTH * Math.random();
      const y = MAP_HEIGHT * Math.random();
      let ok = true;
      
      // Check adoption zones
      for (const zone of this.adoptionZones) {
        if (Math.abs(x - zone.x) <= zone.radius + margin && Math.abs(y - zone.y) <= zone.radius + margin) {
          ok = false;
          break;
        }
      }
      
      // Check breeder camps (pickups of type BREEDER)
      if (ok) {
        for (const pickup of this.pickups.values()) {
          if (pickup.type === PICKUP_TYPE_BREEDER) {
            const dx = x - pickup.x;
            const dy = y - pickup.y;
            if (dx * dx + dy * dy < BREEDER_CAMP_AVOID_RADIUS * BREEDER_CAMP_AVOID_RADIUS) {
              ok = false;
              break;
            }
          }
        }
      }
      
      // Check breeder shelters
      if (ok) {
        for (const shelter of this.breederShelters.values()) {
          const shelterRadius = 40 + shelter.size * 0.5 + 50; // Shelter radius + margin
          const dx = x - shelter.x;
          const dy = y - shelter.y;
          if (dx * dx + dy * dy < shelterRadius * shelterRadius) {
            ok = false;
            break;
          }
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
    this.groundedPlayerIds.delete(id);
    this.portCharges.delete(id);
    this.playerColors.delete(id);
  }

  private isGrounded(p: PlayerState): boolean {
    // Legacy: grounded players are stationary. With new shelter system, players are never grounded.
    return this.groundedPlayerIds.has(p.id);
  }

  /** Player has a shelter (separate from van) */
  private hasShelter(playerId: string): boolean {
    return this.playerShelterIds.has(playerId);
  }

  /** Get player's shelter */
  private getPlayerShelter(playerId: string): ShelterState | undefined {
    const shelterId = this.playerShelterIds.get(playerId);
    return shelterId ? this.shelters.get(shelterId) : undefined;
  }

  /** Build a shelter at player's current location - requires size >= 50, 250 RT */
  buildShelter(id: string): { success: boolean; reason?: string } {
    const p = this.players.get(id);
    if (!p) return { success: false, reason: 'Player not found' };
    if (this.eliminatedPlayerIds.has(id)) return { success: false, reason: 'Player eliminated' };
    if (this.hasShelter(id)) return { success: false, reason: 'Already have a shelter' };
    if (p.size < 50) return { success: false, reason: 'Size must be 50 or higher' };
    
    const currentMoney = this.playerMoney.get(id) ?? 0;
    if (currentMoney < SHELTER_BUILD_COST) {
      return { success: false, reason: `Need ${SHELTER_BUILD_COST} RT (have ${currentMoney} RT)` };
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
    const shelter: ShelterState = {
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
    this.playerMoney.set(id, currentMoney - SHELTER_BUILD_COST);
    log(`Player ${p.displayName} built shelter at (${p.x.toFixed(0)}, ${p.y.toFixed(0)})`);
    return { success: true };
  }

  /** Buy adoption center upgrade for player's shelter */
  buyAdoptionCenter(id: string): { success: boolean; reason?: string } {
    const shelter = this.getPlayerShelter(id);
    if (!shelter) return { success: false, reason: 'No shelter built' };
    if (shelter.hasAdoptionCenter) return { success: false, reason: 'Already have adoption center' };
    
    const currentMoney = this.playerMoney.get(id) ?? 0;
    if (currentMoney < ADOPTION_CENTER_COST) {
      return { success: false, reason: `Need ${ADOPTION_CENTER_COST} RT (have ${currentMoney} RT)` };
    }
    
    shelter.hasAdoptionCenter = true;
    this.playerMoney.set(id, currentMoney - ADOPTION_CENTER_COST);
    log(`Player ${id} bought adoption center`);
    return { success: true };
  }

  /** Buy gravity pull upgrade for player's shelter */
  buyGravity(id: string): { success: boolean; reason?: string } {
    const shelter = this.getPlayerShelter(id);
    if (!shelter) return { success: false, reason: 'No shelter built' };
    if (shelter.hasGravity) return { success: false, reason: 'Already have gravity' };
    
    const currentMoney = this.playerMoney.get(id) ?? 0;
    if (currentMoney < GRAVITY_COST) {
      return { success: false, reason: `Need ${GRAVITY_COST} RT (have ${currentMoney} RT)` };
    }
    
    shelter.hasGravity = true;
    this.playerMoney.set(id, currentMoney - GRAVITY_COST);
    log(`Player ${id} bought gravity pull`);
    return { success: true };
  }

  /** Buy advertising upgrade for player's shelter */
  buyAdvertising(id: string): { success: boolean; reason?: string } {
    const shelter = this.getPlayerShelter(id);
    if (!shelter) return { success: false, reason: 'No shelter built' };
    if (shelter.hasAdvertising) return { success: false, reason: 'Already have advertising' };
    
    const currentMoney = this.playerMoney.get(id) ?? 0;
    if (currentMoney < ADVERTISING_COST) {
      return { success: false, reason: `Need ${ADVERTISING_COST} RT (have ${currentMoney} RT)` };
    }
    
    shelter.hasAdvertising = true;
    this.playerMoney.set(id, currentMoney - ADVERTISING_COST);
    log(`Player ${id} bought advertising`);
    return { success: true };
  }

  /** Buy permanent van speed upgrade */
  buyVanSpeed(id: string): { success: boolean; reason?: string } {
    const p = this.players.get(id);
    if (!p) return { success: false, reason: 'Player not found' };
    if (this.vanSpeedUpgrades.has(id)) return { success: false, reason: 'Already have van speed upgrade' };
    
    const currentMoney = this.playerMoney.get(id) ?? 0;
    if (currentMoney < VAN_SPEED_COST) {
      return { success: false, reason: `Need ${VAN_SPEED_COST} RT (have ${currentMoney} RT)` };
    }
    
    this.vanSpeedUpgrades.add(id);
    this.playerMoney.set(id, currentMoney - VAN_SPEED_COST);
    log(`Player ${id} bought van speed upgrade`);
    return { success: true };
  }

  /** Check if player has a shelter (legacy compatibility for isPlayerGrounded) */
  isPlayerGrounded(id: string): boolean {
    return this.hasShelter(id);
  }

  /** Legacy groundPlayer for backward compatibility - now calls buildShelter */
  groundPlayer(id: string): { success: boolean; reason?: string } {
    return this.buildShelter(id);
  }

  /** Set player's shelter color */
  setPlayerColor(id: string, color: string): void {
    if (this.players.has(id)) {
      this.playerColors.set(id, color);
    }
  }

  /** Use a port charge to teleport to a random location */
  usePort(id: string): boolean {
    const p = this.players.get(id);
    if (!p || this.eliminatedPlayerIds.has(id)) return false;
    const charges = this.portCharges.get(id) ?? 0;
    if (charges <= 0) return false;
    
    // Find a random position outside adoption zones
    const r = effectiveRadius(p);
    let pos = this.randomPosOutsideAdoptionZoneWithMargin(r);
    if (!pos) {
      // Fallback positions
      const zone = this.adoptionZones[0];
      pos = { x: MAP_WIDTH * 0.15, y: MAP_HEIGHT * 0.15 };
      if (zone && Math.abs(pos.x - zone.x) <= zone.radius + r && Math.abs(pos.y - zone.y) <= zone.radius + r) {
        pos = { x: MAP_WIDTH * 0.85, y: MAP_HEIGHT * 0.15 };
      }
      if (zone && Math.abs(pos.x - zone.x) <= zone.radius + r && Math.abs(pos.y - zone.y) <= zone.radius + r) {
        pos = { x: MAP_WIDTH * 0.15, y: MAP_HEIGHT * 0.85 };
      }
    }
    
    p.x = clamp(pos.x, r, MAP_WIDTH - r);
    p.y = clamp(pos.y, r, MAP_HEIGHT - r);
    this.portCharges.set(id, charges - 1);
    // Porting ungrounds the player
    this.groundedPlayerIds.delete(id);
    return true;
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

  /** Simple hash of id for per-CPU variation (0–2). */
  private static cpuStrategyIndex(id: string): number {
    let h = 0;
    for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
    return h % 3;
  }

  /** Nearest point on zone square boundary; exitOutward = true offsets by sr so shelter clears the zone. */
  private zoneSquareEdgeTarget(
    zone: AdoptionZoneState,
    px: number,
    py: number,
    sr: number,
    exitOutward: boolean
  ): { x: number; y: number } {
    const R = zone.radius;
    const zx = zone.x;
    const zy = zone.y;
    const inside = Math.abs(px - zx) <= R && Math.abs(py - zy) <= R;
    let tx: number;
    let ty: number;
    if (inside) {
      const toLeft = px - (zx - R);
      const toRight = zx + R - px;
      const toTop = py - (zy - R);
      const toBottom = zy + R - py;
      const minD = Math.min(toLeft, toRight, toTop, toBottom);
      if (minD === toLeft) {
        tx = zx - R;
        ty = py;
      } else if (minD === toRight) {
        tx = zx + R;
        ty = py;
      } else if (minD === toTop) {
        tx = px;
        ty = zy - R;
      } else {
        tx = px;
        ty = zy + R;
      }
      if (exitOutward) {
        const outX = tx === zx ? 0 : tx < zx ? -1 : 1;
        const outY = ty === zy ? 0 : ty < zy ? -1 : 1;
        tx += outX * sr;
        ty += outY * sr;
      }
    } else {
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
      } else if (minD === dRight) {
        tx = rightP.x;
        ty = rightP.y;
      } else if (minD === dTop) {
        tx = topP.x;
        ty = topP.y;
      } else {
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

  private cpuAI(p: PlayerState): number {
    const zone = this.adoptionZones[0];
    if (!zone) return 0;
    // Vans (not grounded) are capped at VAN_MAX_CAPACITY
    const isGrounded = this.groundedPlayerIds.has(p.id);
    const capacity = isGrounded ? Math.floor(p.size) : Math.min(Math.floor(p.size), VAN_MAX_CAPACITY);
    const sr = SHELTER_BASE_RADIUS + p.size * SHELTER_RADIUS_PER_SIZE;
    const touchingZone = this.shelterInZoneAABB(p, zone);

    // PRIORITY: Flee from enemy shelters - don't approach them
    for (const shelter of this.shelters.values()) {
      if (shelter.ownerId === p.id) continue;
      if (this.isAlly(p.id, shelter.ownerId, this.lastAllyPairs)) continue;
      
      const shelterR = shelterRadius(shelter.size);
      const dangerRadius = shelterR + 100; // Stay away from enemy shelters
      const d = dist(p.x, p.y, shelter.x, shelter.y);
      if (d < dangerRadius) {
        // Flee away from enemy shelter
        const dx = p.x - shelter.x;
        const dy = p.y - shelter.y;
        const len = Math.hypot(dx, dy) || 1;
        const fleeX = clamp(p.x + (dx / len) * 200, 50, MAP_WIDTH - 50);
        const fleeY = clamp(p.y + (dy / len) * 200, 50, MAP_HEIGHT - 50);
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
        if (other.id === p.id) continue;
        if (!this.isAlly(p.id, other.id, this.lastAllyPairs)) continue;
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
      } else {
        // Check if target is still valid (stray/pickup still exists at location)
        let targetValid = false;
        if (currentTarget.type === 'stray') {
          for (const pet of this.pets.values()) {
            if (pet.insideShelterId === null && dist(pet.x, pet.y, currentTarget.x, currentTarget.y) < 20) {
              targetValid = true;
              break;
            }
          }
        } else if (currentTarget.type === 'pickup') {
          for (const u of this.pickups.values()) {
            if (dist(u.x, u.y, currentTarget.x, currentTarget.y) < 20) {
              targetValid = true;
              break;
            }
          }
        } else if (currentTarget.type === 'wander') {
          // Wander targets are always valid until reached
          targetValid = true;
        }
        
        if (targetValid) {
          return this.directionToward(p.x, p.y, currentTarget.x, currentTarget.y);
        } else {
          this.cpuTargets.delete(p.id);
        }
      }
    }

    // Need new target - look for strays/pickups across the ENTIRE map
    const strayCandidates: { x: number; y: number; d: number }[] = [];
    const pickupCandidates: { x: number; y: number; d: number }[] = [];

    for (const pet of this.pets.values()) {
      if (pet.insideShelterId !== null) continue;
      const d = dist(p.x, p.y, pet.x, pet.y);
      strayCandidates.push({ x: pet.x, y: pet.y, d });
    }
    strayCandidates.sort((a, b) => a.d - b.d);

    for (const u of this.pickups.values()) {
      // Skip breeder camps if CPU is not allowed to shut them down
      if (u.type === PICKUP_TYPE_BREEDER && !this.cpuCanShutdownBreeders) continue;
      const d = dist(p.x, p.y, u.x, u.y);
      pickupCandidates.push({ x: u.x, y: u.y, d });
    }
    pickupCandidates.sort((a, b) => a.d - b.d);

    // Pick target with slight randomness (but persist it)
    const pickWithJitter = <T extends { x: number; y: number; d: number }>(arr: T[]): T | null => {
      if (arr.length === 0) return null;
      if (arr.length === 1) return arr[0];
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
    const wanderX = MAP_WIDTH * (0.1 + Math.random() * 0.8);
    const wanderY = MAP_HEIGHT * (0.1 + Math.random() * 0.8);
    this.cpuTargets.set(p.id, { x: wanderX, y: wanderY, type: 'wander' });
    return this.directionToward(p.x, p.y, wanderX, wanderY);
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
      // Base van speed (vans no longer grow, so use constant speed)
      let baseSpeed = SHELTER_SPEED;
      // Underdog buff: 10% faster movement
      if (this.isUnderdog(p.id)) {
        baseSpeed *= 1.1;
      }
      // Van speed upgrade: permanent 20% boost
      if (this.vanSpeedUpgrades.has(p.id)) {
        baseSpeed *= 1.2;
      }
      const speed = p.speedBoostUntil > this.tick ? baseSpeed * SPEED_BOOST_MULTIPLIER : baseSpeed;
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
    this.lastBreederWaveTick = 0;
    this.nextBreederWaveInterval = 0;
    this.breederWaveSpawned = false;
    this.pendingBreederMiniGames.clear();
    this.breederCamps.clear();
    this.breederShelters.clear();
    this.wildStrayIds.clear();
    this.pendingAnnouncements = [];
  }
  
  /** Set whether CPU players can attempt to shut down breeders (solo mode option) */
  setCpuBreederBehavior(canShutdown: boolean): void {
    this.cpuCanShutdownBreeders = canShutdown;
  }

  private static readonly ELIMINATED_SIZE_THRESHOLD = 10;

  tickWorld(fightAllyChoices?: Map<string, 'fight' | 'ally'>, allyRequests?: Map<string, Set<string>>): void {
    if (!this.matchStarted) return;
    this.tick++;
    const now = this.tick;

    if (this.isMatchOver()) return; // no movement, rescue, adoption, or spawns after match end

    const allyPairs = fightAllyChoices ? World.allyPairsFromChoices(fightAllyChoices) : new Set<string>();

    // Helper to check if both players have mutual ally requests (clicked ally on each other before overlap)
    const hasMutualAllyRequest = (aId: string, bId: string): boolean => {
      if (!allyRequests) return false;
      const aRequests = allyRequests.get(aId);
      const bRequests = allyRequests.get(bId);
      return !!(aRequests?.has(bId) && bRequests?.has(aId));
    };

    // Anti-stall: Scarcity escalation when no adoptions for too long
    const ticksSinceAdoption = now - this.lastGlobalAdoptionTick;
    if (this.lastGlobalAdoptionTick > 0 && ticksSinceAdoption > SCARCITY_TRIGGER_TICKS) {
      const newScarcityLevel = Math.min(3, Math.floor(ticksSinceAdoption / SCARCITY_TRIGGER_TICKS));
      if (newScarcityLevel > this.scarcityLevel) {
        this.scarcityLevel = newScarcityLevel;
        log(`Scarcity level ${this.scarcityLevel} activated at tick ${now}`);
        
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
        const centerX = MAP_WIDTH / 2;
        const centerY = MAP_HEIGHT / 2;
        const driftSpeed = this.scarcityLevel * 0.5;
        const stopDistance = ADOPTION_ZONE_RADIUS + World.SPAWN_MARGIN; // Don't drift into adoption zone
        for (const pet of this.pets.values()) {
          if (pet.insideShelterId !== null) continue;
          if (this.wildStrayIds.has(pet.id)) continue; // Wild strays don't drift
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
      pet.x = clamp(pet.x + pet.vx, 50, MAP_WIDTH - 50);
      pet.y = clamp(pet.y + pet.vy, 50, MAP_HEIGHT - 50);
      
      // Bounce off edges
      if (pet.x <= 50 || pet.x >= MAP_WIDTH - 50) pet.vx *= -1;
      if (pet.y <= 50 || pet.y >= MAP_HEIGHT - 50) pet.vy *= -1;
    }

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
    // Spawn regular pickups (not breeders - those are wave-based now)
    if (now >= this.spawnPickupAt) {
      this.spawnPickupAt = now + PICKUP_SPAWN_TICKS;
      const pos = this.randomPosOutsideAdoptionZone();
      if (pos) {
        const uid = `pickup-${++this.pickupIdSeq}`;
        // Regular pickup: 60% growth, 25% speed, 15% port
        const roll = Math.random();
        const type = roll < 0.6 ? PICKUP_TYPE_GROWTH : roll < 0.85 ? PICKUP_TYPE_SPEED : PICKUP_TYPE_PORT;
        this.pickups.set(uid, {
          id: uid,
          x: pos.x,
          y: pos.y,
          type,
        });
      }
    }
    
    // Breeder wave spawning: about every minute (45-75s), spawn all 5 breeders of current level at random locations
    const ticksSinceStart = now - this.matchStartTick;
    const ticksSinceLastWave = now - this.lastBreederWaveTick;
    
    // Determine if it's time for a new wave
    const isFirstWave = this.lastBreederWaveTick === 0 && ticksSinceStart >= World.BREEDER_FIRST_WAVE_DELAY_TICKS;
    const isNextWave = this.lastBreederWaveTick > 0 && this.breederWaveSpawned && 
                       this.nextBreederWaveInterval > 0 && ticksSinceLastWave >= this.nextBreederWaveInterval;
    
    if (isFirstWave || isNextWave) {
      // Advance level if this isn't the first wave
      if (isNextWave) {
        this.breederCurrentLevel++;
        this.breederSpawnCount = 0;
      }
      
      const level = this.breederCurrentLevel;
      this.lastBreederWaveTick = now;
      this.breederWaveSpawned = false;
      
      // Set random interval for the NEXT wave (45-75 seconds)
      this.nextBreederWaveInterval = World.BREEDER_WAVE_MIN_TICKS + 
        Math.floor(Math.random() * (World.BREEDER_WAVE_MAX_TICKS - World.BREEDER_WAVE_MIN_TICKS));
      
      // Spawn all 5 breeders at random locations
      let spawnedCount = 0;
      for (let i = 0; i < World.BREEDERS_PER_LEVEL; i++) {
        const pos = this.randomPosOutsideAdoptionZone();
        if (pos) {
          const uid = `pickup-${++this.pickupIdSeq}`;
          this.pickups.set(uid, {
            id: uid,
            x: pos.x,
            y: pos.y,
            type: PICKUP_TYPE_BREEDER,
            level,
          });
          this.breederCamps.set(uid, { x: pos.x, y: pos.y, spawnTick: now, level });
          this.breederSpawnCount++;
          spawnedCount++;
        }
      }
      
      this.breederWaveSpawned = true;
      this.pendingAnnouncements.push(`Level ${level} breeders have arrived! (${spawnedCount} camps)`);
      log(`Breeder wave ${level} spawned: ${spawnedCount} camps at random locations`);
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
          
          this.pendingAnnouncements.push(`⚠️ BREEDER MILL FORMED! They're now breeding more strays!`);
          log(`Breeder mill formed at (${Math.round(camp.x)}, ${Math.round(camp.y)}) - level ${newLevel}`);
        } else {
          // Spawn a new camp next to this one (no limit on camps now!)
          const angle = Math.random() * Math.PI * 2;
          const newX = clamp(camp.x + Math.cos(angle) * World.BREEDER_GROWTH_RADIUS, 50, MAP_WIDTH - 50);
          const newY = clamp(camp.y + Math.sin(angle) * World.BREEDER_GROWTH_RADIUS, 50, MAP_HEIGHT - 50);
          
          const newUid = `pickup-${++this.pickupIdSeq}`;
          
          this.pickups.set(newUid, {
            id: newUid,
            x: newX,
            y: newY,
            type: PICKUP_TYPE_BREEDER,
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
          log(`Breeder camp grew! Level ${newLevel} spawned at (${Math.round(newX)}, ${Math.round(newY)})`);
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
          log(`Breeder mill ${shelterId} grew to level ${shelter.level}`);
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
          const sx = clamp(shelter.x + Math.cos(angle) * dist, 50, MAP_WIDTH - 50);
          const sy = clamp(shelter.y + Math.sin(angle) * dist, 50, MAP_HEIGHT - 50);
          
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
    const destroyedBreederShelters: string[] = [];
    for (const [breederShelterId, breederShelter] of this.breederShelters.entries()) {
      for (const playerShelter of this.shelters.values()) {
        const bsr = 40 + breederShelter.size * 0.5; // Breeder shelter radius
        const psr = shelterRadius(playerShelter.size);
        
        if (!aabbOverlap(breederShelter.x, breederShelter.y, bsr, 
                         playerShelter.x, playerShelter.y, psr)) continue;
        
        // Combat! Player shelter always wins, but loses pets based on breeder level
        let petLoss = 0;
        if (breederShelter.level >= 10) {
          petLoss = 3 * breederShelter.level; // 3x at level 10+
        } else if (breederShelter.level >= 3) {
          petLoss = breederShelter.level; // 1x at level 3-9
        }
        // Level 1-2: no pet loss
        
        // Apply pet loss
        for (let i = 0; i < petLoss && playerShelter.petsInside.length > 0; i++) {
          const petId = playerShelter.petsInside.pop();
          if (petId) this.pets.delete(petId);
        }
        
        // Mark breeder shelter for destruction
        destroyedBreederShelters.push(breederShelterId);
        
        const owner = this.players.get(playerShelter.ownerId);
        const lossText = petLoss > 0 ? ` (lost ${petLoss} pets)` : '';
        this.pendingAnnouncements.push(
          `${owner?.displayName ?? 'A shelter'} destroyed a Level ${breederShelter.level} breeder mill!${lossText}`
        );
        log(`Player ${owner?.displayName} destroyed level ${breederShelter.level} breeder mill (lost ${petLoss} pets)`);
        break; // One combat per breeder shelter per tick
      }
    }
    
    // Remove destroyed breeder shelters
    for (const id of destroyedBreederShelters) {
      this.breederShelters.delete(id);
    }

    // Event system: trigger global events at adoption milestones
    for (const milestone of EVENT_MILESTONES) {
      if (this.totalMatchAdoptions >= milestone && !this.triggeredEvents.has(milestone)) {
        this.triggeredEvents.add(milestone);
        log(`Event triggered at ${milestone} total adoptions`);
        const centerX = MAP_WIDTH / 2;
        const centerY = MAP_HEIGHT / 2;
        
        if (milestone === 50) {
          // Donation Surge: spawn extra pickups across the map
          for (let i = 0; i < 10; i++) {
            const pos = this.randomPosOutsideAdoptionZone();
            if (pos) {
              const uid = `pickup-${++this.pickupIdSeq}`;
              this.pickups.set(uid, { id: uid, x: pos.x, y: pos.y, type: PICKUP_TYPE_GROWTH });
            }
          }
        } else if (milestone === 100) {
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
        } else if (milestone === 200) {
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
        } else if (milestone === 300) {
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
              const type = Math.random() < 0.5 ? PICKUP_TYPE_GROWTH : PICKUP_TYPE_SPEED;
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
      let inputFlags = (p as PlayerState & { lastInputFlags?: number }).lastInputFlags ?? 0;
      if (p.id.startsWith('cpu-')) inputFlags = this.cpuAI(p);
      const grounded = this.isGrounded(p);
      if (grounded) {
        p.vx = 0;
        p.vy = 0;
      } else {
        this.applyInput(p, inputFlags);
      }
      let nx = p.x + p.vx;
      let ny = p.y + p.vy;
      const radius = effectiveRadius(p);
      nx = clamp(nx, radius, MAP_WIDTH - radius);
      ny = clamp(ny, radius, MAP_HEIGHT - radius);
      
      // Vans can pass through each other (no van-van collision)
      // Vans only collide with stationary shelters (not other vans)
      for (const shelter of this.shelters.values()) {
        if (shelter.ownerId === p.id) continue; // Don't collide with own shelter
        const sr = shelterRadius(shelter.size);
        if (!aabbOverlap(nx, ny, radius, shelter.x, shelter.y, sr)) continue;
        const penX = radius + sr - Math.abs(nx - shelter.x);
        const penY = radius + sr - Math.abs(ny - shelter.y);
        if (penX <= 0 || penY <= 0) continue;
        // Push in the direction of least penetration, but respect map bounds
        if (penX <= penY) {
          const pushDir = nx > shelter.x ? 1 : -1;
          const newNx = nx + pushDir * penX;
          // Only apply if it keeps us in bounds
          if (newNx >= radius && newNx <= MAP_WIDTH - radius) {
            nx = newNx;
          }
        } else {
          const pushDir = ny > shelter.y ? 1 : -1;
          const newNy = ny + pushDir * penY;
          // Only apply if it keeps us in bounds
          if (newNy >= radius && newNy <= MAP_HEIGHT - radius) {
            ny = newNy;
          }
        }
      }
      p.x = clamp(nx, radius, MAP_WIDTH - radius);
      p.y = clamp(ny, radius, MAP_HEIGHT - radius);
    }

    // Combat: overlapping shelters can fight after sustained overlap time
    const playerList = Array.from(this.players.values());
    const strayCount = Array.from(this.pets.values()).filter((p) => p.insideShelterId === null).length;
    for (let i = 0; i < playerList.length; i++) {
      const a = playerList[i];
      if (this.eliminatedPlayerIds.has(a.id)) continue;
      for (let j = i + 1; j < playerList.length; j++) {
        const b = playerList[j];
        if (this.eliminatedPlayerIds.has(b.id)) continue;
        const key = World.pairKey(a.id, b.id);
        // Must be size 10+ to engage
        if (a.size < COMBAT_MIN_SIZE || b.size < COMBAT_MIN_SIZE) {
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
        if (nextTicks < COMBAT_GRACE_TICKS) continue;
        
        // Only resolve one "combat tick" per interval (after grace period)
        const ticksAfterGrace = nextTicks - COMBAT_GRACE_TICKS;
        if (ticksAfterGrace % combatTickInterval !== 0) continue;

        // Resolve combat with variance (size + pets carried + adopt speed)
        const strengthA = (a.size + a.petsInside.length * COMBAT_PET_WEIGHT) * (ADOPTION_TICKS_INTERVAL / intervalA);
        const strengthB = (b.size + b.petsInside.length * COMBAT_PET_WEIGHT) * (ADOPTION_TICKS_INTERVAL / intervalB);
        const baseChanceA = 0.5 + (strengthA - strengthB) * COMBAT_STRENGTH_WEIGHT;
        const variance = Math.min(COMBAT_MAX_VARIANCE, strayCount * COMBAT_STRAY_VARIANCE);
        const jitter = (Math.random() - 0.5) * 2 * variance;
        const chanceA = clamp(baseChanceA + jitter, 0.1, 0.9);
        const winner = Math.random() < chanceA ? a : b;
        const loser = winner === a ? b : a;

        // Transfer scales with winner size so large vs small is nearly instant (within ~2 adopt intervals)
        const transferCap = Math.max(1, Math.floor(winner.size / COMBAT_TRANSFER_SIZE_RATIO_DIVISOR));
        let transfer = Math.min(Math.floor(loser.size), transferCap);

        // Early-game protection: no elimination below EARLY_GAME_PROTECTION_SIZE until conditions met
        const matchAgeTicks = this.tick - this.matchStartTick;
        const maxAdoptions = Math.max(...Array.from(this.players.values()).map(p => p.totalAdoptions));
        const earlyGameActive = matchAgeTicks < EARLY_GAME_PROTECTION_TICKS && maxAdoptions < EARLY_GAME_PROTECTION_ADOPTIONS;
        if (earlyGameActive) {
          // Cap transfer so loser doesn't drop below protection threshold
          const maxTransfer = Math.max(0, Math.floor(loser.size) - EARLY_GAME_PROTECTION_SIZE);
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
    const attackersPerShelter = new Map<string, string[]>(); // shelterId -> [vanIds]
    
    for (const p of this.players.values()) {
      if (this.eliminatedPlayerIds.has(p.id)) continue;
      
      for (const shelter of this.shelters.values()) {
        if (shelter.ownerId === p.id) continue;
        if (this.isAlly(p.id, shelter.ownerId, this.lastAllyPairs)) continue;
        
        const sr = shelterRadius(shelter.size);
        const vanR = VAN_FIXED_RADIUS;
        // Van is attacking if within shelter radius
        if (!aabbOverlap(p.x, p.y, vanR, shelter.x, shelter.y, sr)) continue;
        
        const attackers = attackersPerShelter.get(shelter.id) ?? [];
        attackers.push(p.id);
        attackersPerShelter.set(shelter.id, attackers);
      }
    }
    
    // Resolve van-vs-shelter combat
    for (const [shelterId, attackerIds] of attackersPerShelter.entries()) {
      const shelter = this.shelters.get(shelterId);
      if (!shelter) continue;
      
      const owner = this.players.get(shelter.ownerId);
      if (!owner) continue;
      
      const sr = shelterRadius(shelter.size);
      
      // Single attacker always loses against shelter
      if (attackerIds.length === 1) {
        const attacker = this.players.get(attackerIds[0]);
        if (attacker) {
          // Attacker takes damage: lose 5 size, drop all pets near shelter
          attacker.size = Math.max(1, attacker.size - 5);
          while (attacker.petsInside.length > 0) {
            const petId = attacker.petsInside.pop()!;
            const pet = this.pets.get(petId);
            if (pet) {
              pet.insideShelterId = null;
              pet.x = shelter.x + (Math.random() - 0.5) * sr;
              pet.y = shelter.y + (Math.random() - 0.5) * sr;
            }
          }
          log(`Van ${attacker.displayName} attacked shelter alone and lost!`);
        }
      } else {
        // 2+ attackers: can steal shelter's pets
        // Combined attack strength (each van contributes 50 + pets carried)
        let attackStrength = 0;
        for (const id of attackerIds) {
          const att = this.players.get(id);
          if (att) attackStrength += 50 + att.petsInside.length;
        }
        
        const shelterStrength = shelter.size + shelter.petsInside.length;
        
        // If attackers combined are stronger, steal pets
        if (attackStrength > shelterStrength) {
          const stealCount = Math.min(shelter.petsInside.length, attackerIds.length * 5);
          for (let i = 0; i < stealCount; i++) {
            const petId = shelter.petsInside.pop();
            if (!petId) break;
            // Give to random attacker (if they have space)
            const randomAttId = attackerIds[Math.floor(Math.random() * attackerIds.length)];
            const att = this.players.get(randomAttId);
            if (att && att.petsInside.length < VAN_MAX_CAPACITY) {
              att.petsInside.push(petId);
              const pet = this.pets.get(petId);
              if (pet) pet.insideShelterId = att.id;
            } else {
              // Attacker full, drop pet nearby
              const pet = this.pets.get(petId);
              if (pet) {
                pet.insideShelterId = null;
                pet.x = shelter.x + (Math.random() - 0.5) * sr * 2;
                pet.y = shelter.y + (Math.random() - 0.5) * sr * 2;
              }
            }
          }
          log(`${attackerIds.length} vans raided shelter and stole ${stealCount} pets!`);
        } else {
          // Attackers not strong enough, they all take damage
          for (const id of attackerIds) {
            const att = this.players.get(id);
            if (att) {
              att.size = Math.max(1, att.size - 3);
            }
          }
          log(`${attackerIds.length} vans attacked shelter but failed!`);
        }
      }
    }
    
    // Domination check: game ends when 1 shelter covers 51% of the actual MAP AREA
    // This is a huge challenge - shelters must grow large through combat and adoptions
    if (!this.matchEndedEarly && this.shelters.size > 0) {
      const mapArea = MAP_WIDTH * MAP_HEIGHT; // 4800 * 4800 = 23,040,000
      const dominationThreshold = 0.51; // 51% of map
      
      for (const shelter of this.shelters.values()) {
        if (!shelter.hasAdoptionCenter) continue; // Must have adoption center to win
        
        const r = shelterRadius(shelter.size);
        const shelterArea = Math.PI * r * r;
        const percent = shelterArea / mapArea;
        
        if (percent >= dominationThreshold) {
          this.matchEndedEarly = true;
          this.matchEndAt = this.tick;
          this.winnerId = shelter.ownerId;
          const p = this.players.get(shelter.ownerId);
          log(`Map domination by ${p?.displayName ?? shelter.ownerId} - shelter covers ${(percent * 100).toFixed(1)}% of map (radius ${Math.round(r)}, size ${shelter.size}) at tick ${this.tick}`);
          break;
        }
      }
    }
    
    // Shelters with gravity upgrade pull strays toward them
    for (const shelter of this.shelters.values()) {
      if (!shelter.hasGravity) continue;
      const sr = shelterRadius(shelter.size);
      const gravityRadius = sr + 550;
      const pullPerTick = 3;
      for (const pet of this.pets.values()) {
        if (pet.insideShelterId !== null) continue;
        const d = dist(shelter.x, shelter.y, pet.x, pet.y);
        if (d > gravityRadius || d < 1) continue;
        const dx = (shelter.x - pet.x) / d;
        const dy = (shelter.y - pet.y) / d;
        pet.x += dx * pullPerTick;
        pet.y += dy * pullPerTick;
      }
    }
    
    // Shelter auto-collect: shelters with adoption center collect strays directly
    for (const shelter of this.shelters.values()) {
      if (!shelter.hasAdoptionCenter) continue;
      const owner = this.players.get(shelter.ownerId);
      const maxPets = owner ? shelterMaxPets(owner.size) : 25;
      if (shelter.petsInside.length >= maxPets) continue;
      
      const sr = shelterRadius(shelter.size);
      const collectRadius = sr + 30; // Slightly larger than visual
      
      for (const pet of this.pets.values()) {
        if (pet.insideShelterId !== null) continue;
        if (shelter.petsInside.length >= maxPets) break;
        
        const d = dist(shelter.x, shelter.y, pet.x, pet.y);
        if (d <= collectRadius) {
          // Check owner can afford upkeep
          const ownerMoney = this.playerMoney.get(shelter.ownerId) ?? 0;
          if (ownerMoney < SHELTER_PET_UPKEEP) continue;
          
          // Collect the pet
          pet.insideShelterId = shelter.id;
          shelter.petsInside.push(pet.id);
          this.playerMoney.set(shelter.ownerId, ownerMoney - SHELTER_PET_UPKEEP);
        }
      }
    }
    
    // Pet delivery: vans can deliver to their own shelter OR an ally's shelter
    for (const p of this.players.values()) {
      if (this.eliminatedPlayerIds.has(p.id)) continue;
      if (p.petsInside.length === 0) continue;
      
      // Check all shelters for delivery (own or ally's)
      for (const shelter of this.shelters.values()) {
        const isOwn = shelter.ownerId === p.id;
        const isAlly = this.isAlly(p.id, shelter.ownerId, this.lastAllyPairs);
        if (!isOwn && !isAlly) continue;
        
        const vanRadius = VAN_FIXED_RADIUS;
        const shelterR = shelterRadius(shelter.size);
        const deliveryDistance = vanRadius + shelterR + 20;
        const d = dist(p.x, p.y, shelter.x, shelter.y);
        if (d > deliveryDistance) continue;
        const shelterOwner = this.players.get(shelter.ownerId);
        const maxPets = shelterOwner ? shelterMaxPets(shelterOwner.size) : 25;
        if (shelter.petsInside.length >= maxPets) continue;
        
        // Transfer pets with split cost for allies
        while (p.petsInside.length > 0 && shelter.petsInside.length < maxPets) {
          const delivererMoney = this.playerMoney.get(p.id) ?? 0;
          const ownerMoney = this.playerMoney.get(shelter.ownerId) ?? 0;
          
          if (isOwn) {
            // Own shelter: owner pays full upkeep
            if (ownerMoney < SHELTER_PET_UPKEEP) break;
            this.playerMoney.set(shelter.ownerId, ownerMoney - SHELTER_PET_UPKEEP);
          } else {
            // Ally shelter: split cost 1 RT each
            if (delivererMoney < 1 || ownerMoney < 1) break;
            this.playerMoney.set(p.id, delivererMoney - 1);
            this.playerMoney.set(shelter.ownerId, ownerMoney - 1);
          }
          
          const petId = p.petsInside.pop()!;
          shelter.petsInside.push(petId);
        }
        break; // Only deliver to one shelter per tick
      }
    }

    for (const p of this.players.values()) {
      if (this.eliminatedPlayerIds.has(p.id)) continue;
      const radius = effectiveRadius(p);
      for (const [uid, u] of Array.from(this.pickups.entries())) {
        if (dist(p.x, p.y, u.x, u.y) > radius + GROWTH_ORB_RADIUS) continue;
        this.pickups.delete(uid);
        
        if (u.type === PICKUP_TYPE_BREEDER) {
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
          log(`Player ${p.displayName} triggered level ${level} breeder mini-game`);
        } else {
          p.speedBoostUntil = 0; // end speed boost when picking up any boost
          if (u.type === PICKUP_TYPE_GROWTH) {
            p.size += GROWTH_ORB_VALUE;
          } else if (u.type === PICKUP_TYPE_SPEED) {
            p.speedBoostUntil = now + SPEED_BOOST_DURATION_TICKS;
          } else if (u.type === PICKUP_TYPE_PORT) {
            const current = this.portCharges.get(p.id) ?? 0;
            this.portCharges.set(p.id, current + 1);
          }
        }
      }
    }

    for (const p of this.players.values()) {
      if (this.eliminatedPlayerIds.has(p.id)) continue;
      // Vans (not grounded) are capped at VAN_MAX_CAPACITY; shelters use full size capacity
      const isGrounded = this.groundedPlayerIds.has(p.id);
      const capacity = isGrounded ? Math.floor(p.size) : Math.min(Math.floor(p.size), VAN_MAX_CAPACITY);
      const sr = effectiveRadius(p);
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

    // Adoption at central adoption zone (van delivers pets there)
    const doAdopt = (p: PlayerState, zoneX: number, zoneY: number): void => {
      if (p.petsInside.length === 0) return;
      const last = this.lastAdoptionTick.get(p.id) ?? 0;
      const interval = this.getAdoptionIntervalTicks(p, false);
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
      const currentMoney = this.playerMoney.get(p.id) ?? 0;
      this.playerMoney.set(p.id, currentMoney + TOKENS_PER_ADOPTION);
      this.lastAdoptionTick.set(p.id, now);
      
      this.totalMatchAdoptions++;
      this.lastGlobalAdoptionTick = now;
      this.scarcityLevel = 0;
    };

    // Shelter adoption (shelter with adoption center adopts pets inside it)
    const doShelterAdopt = (shelter: ShelterState, playerId: string): void => {
      if (shelter.petsInside.length === 0) return;
      if (!shelter.hasAdoptionCenter) return; // Need adoption center upgrade
      
      const last = this.lastShelterAdoptTick.get(shelter.id) ?? 0;
      const interval = Math.max(15, Math.floor(ADOPTION_TICKS_GROUNDED / (1 + shelter.size / 20)));
      if (now - last < interval) return;
      
      const pid = shelter.petsInside.pop()!;
      const pet = this.pets.get(pid);
      if (pet) {
        pet.insideShelterId = null;
        pet.x = shelter.x;
        pet.y = shelter.y;
      }
      this.pets.delete(pid);
      shelter.totalAdoptions++;
      shelter.size += GROWTH_PER_ADOPTION;
      
      // Player also gets credit for adoptions
      const p = this.players.get(playerId);
      if (p) {
        p.totalAdoptions++;
        p.size += GROWTH_PER_ADOPTION;
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
        if (!this.shelterInZoneAABB(p, zone)) continue;
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

  getSnapshot(): GameSnapshot {
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
        const allies: string[] = [];
        for (const other of this.players.values()) {
          if (other.id !== p.id && this.isAlly(p.id, other.id, this.lastAllyPairs)) allies.push(other.id);
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

  isMatchOver(): boolean {
    return this.tick >= this.matchEndAt;
  }
  
  /** Deduct tokens from a player (for breeder mini-game food purchases) */
  deductTokens(playerId: string, amount: number): boolean {
    const current = this.playerMoney.get(playerId) ?? 0;
    if (current < amount) return false;
    this.playerMoney.set(playerId, current - amount);
    return true;
  }
  
  /** Check if a player has a pending breeder mini-game */
  getPendingBreederMiniGame(playerId: string): { petCount: number; startTick: number; level: number } | null {
    return this.pendingBreederMiniGames.get(playerId) ?? null;
  }
  
  /** Clear a player's pending breeder mini-game (after they acknowledge it) */
  clearPendingBreederMiniGame(playerId: string): void {
    this.pendingBreederMiniGames.delete(playerId);
  }
  
  /** Get pending match-wide announcements */
  getPendingAnnouncements(): string[] {
    return this.pendingAnnouncements;
  }
  
  /** Clear pending announcements after broadcasting */
  clearPendingAnnouncements(): void {
    this.pendingAnnouncements = [];
  }
  
  /** Complete a breeder mini-game and award rewards or apply penalties */
  completeBreederMiniGame(playerId: string, rescuedCount: number, totalPets: number, level: number = 1): { 
    tokenBonus: number; 
    rewards: Array<{ type: 'size' | 'speed' | 'port' | 'penalty'; amount: number }> 
  } {
    this.pendingBreederMiniGames.delete(playerId);
    const player = this.players.get(playerId);
    if (!player) return { tokenBonus: 0, rewards: [] };
    
    const unrescuedCount = totalPets - rescuedCount;
    const rewards: Array<{ type: 'size' | 'speed' | 'port' | 'penalty'; amount: number }> = [];
    
    // PENALTY: Un-rescued pets escape and cost van capacity (size reduction)
    // Penalty scales with breeder level
    if (unrescuedCount > 0) {
      const penaltyPerPet = Math.min(2 + level, 10); // 3 for lv1, 4 for lv2, up to 10
      const sizePenalty = unrescuedCount * penaltyPerPet;
      player.size = Math.max(1, player.size - sizePenalty); // Don't go below size 1
      rewards.push({ type: 'penalty', amount: sizePenalty });
      log(`Player ${player.displayName} failed to rescue ${unrescuedCount} pets (lv${level}), -${sizePenalty} size`);
    }
    
    // Only give rewards if at least 1 pet was rescued
    if (rescuedCount === 0) {
      log(`Player ${player.displayName} rescued 0/${totalPets} lv${level} - no rewards, only penalty`);
      return { tokenBonus: 0, rewards };
    }
    
    // Calculate rewards based on performance AND level
    // RT scales with level: base + (level * 15)
    // Lv1: 30-80, Lv2: 45-95, Lv3: 60-110, ... Lv7: 120-170, Lv10: 165-215
    const successRate = rescuedCount / totalPets;
    const levelBonus = (level - 1) * 15;
    const baseTokens = 30 + levelBonus + Math.floor(successRate * 50);
    const tokenBonus = baseTokens;
    
    // Award tokens
    const currentTokens = this.playerMoney.get(playerId) ?? 0;
    this.playerMoney.set(playerId, currentTokens + tokenBonus);
    
    // Random item rewards scale with level:
    // Lv1-2: 2 boosts, Lv3-6: 2 boosts, Lv7+: 3 boosts
    const numItems = level >= 7 ? 3 : 2;
    
    for (let i = 0; i < numItems; i++) {
      const roll = Math.random();
      // Size bonus scales with level
      const sizeAmount = 5 + Math.floor(level / 2); // 5 at lv1, 6 at lv2-3, 7 at lv4-5, etc.
      if (roll < 0.4) {
        // Size bonus
        player.size += sizeAmount;
        rewards.push({ type: 'size', amount: sizeAmount });
      } else if (roll < 0.7) {
        // Speed boost
        player.speedBoostUntil = this.tick + SPEED_BOOST_DURATION_TICKS * 2;
        rewards.push({ type: 'speed', amount: 1 });
      } else {
        // Port charge
        const current = this.portCharges.get(playerId) ?? 0;
        this.portCharges.set(playerId, current + 1);
        rewards.push({ type: 'port', amount: 1 });
      }
    }
    
    // Announce breeder defeat
    if (rescuedCount > 0) {
      this.pendingAnnouncements.push(`${player.displayName} rescued ${rescuedCount} pets from level ${level} breeders!`);
    } else if (unrescuedCount > 0) {
      this.pendingAnnouncements.push(`${player.displayName} failed to rescue any pets from breeders!`);
    }
    
    log(`Player ${player.displayName} completed lv${level} breeder: ${rescuedCount}/${totalPets} rescued, +${tokenBonus} RT, ${numItems} boosts`);
    return { tokenBonus, rewards };
  }
  
  /** Check if match-end has been processed (for inventory/leaderboard) */
  isMatchProcessed(): boolean {
    return this.matchProcessed;
  }
  
  /** Mark match as processed so we don't double-deposit inventory */
  markMatchProcessed(): void {
    this.matchProcessed = true;
  }
  
  /** Get a player's current port charges */
  getPortCharges(playerId: string): number {
    return this.portCharges.get(playerId) ?? 0;
  }
  
  /** Get a player's current money/RT */
  getPlayerMoney(playerId: string): number {
    return this.playerMoney.get(playerId) ?? 0;
  }
}
