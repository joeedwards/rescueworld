/**
 * Authoritative world: shelters (players) move, collect strays, adopt at zones to grow.
 */

import type { PlayerState, PetState, AdoptionZoneState, GameSnapshot, PickupState, ShelterState, AdoptionEvent, BossModeState, BossMill } from 'shared';

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
  // Boss Mode constants
  BOSS_MODE_TIME_LIMIT_TICKS,
  BOSS_TYCOON_DWELL_TICKS,
  BOSS_TYCOON_SPEED,
  BOSS_TYCOON_DETECTION_RADIUS,
  BOSS_INGREDIENT_COSTS,
  BOSS_MILL_PET_COUNTS,
  BOSS_MILL_NAMES,
  BOSS_MILL_RECIPES,
  BOSS_PETMALL_RADIUS,
  BOSS_MILL_RADIUS,
  BOSS_MODE_REWARDS,
  BOSS_CAUGHT_PENALTY,
  BOSS_TYCOON_REBUILD_TICKS,
  // Season constants
  getCurrentSeason,
  SEASON_SPEED_MULTIPLIER,
  SPRING_VEGETATION_SPEED,
  isInVegetationPatch,
  getWindMultiplier,
} from 'shared';
import { INPUT_LEFT, INPUT_RIGHT, INPUT_UP, INPUT_DOWN } from 'shared';
import { SpatialGrid } from './SpatialGrid';
import { PICKUP_TYPE_GROWTH, PICKUP_TYPE_SPEED, PICKUP_TYPE_PORT, PICKUP_TYPE_BREEDER, PICKUP_TYPE_SHELTER_PORT } from 'shared';
import { PET_TYPE_CAT, PET_TYPE_DOG, PET_TYPE_BIRD, PET_TYPE_RABBIT } from 'shared';
import { BOSS_MILL_HORSE, BOSS_MILL_CAT, BOSS_MILL_DOG, BOSS_MILL_BIRD, BOSS_MILL_RABBIT } from 'shared';

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/** Get random pet type with weighted distribution: 35% cat, 35% dog, 15% bird, 15% rabbit (no special) */
function randomPetType(): number {
  const roll = Math.random();
  if (roll < 0.35) return PET_TYPE_CAT;
  if (roll < 0.70) return PET_TYPE_DOG;
  if (roll < 0.85) return PET_TYPE_BIRD;
  return PET_TYPE_RABBIT;
}

function dist(ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  return Math.sqrt(dx * dx + dy * dy);
}

/** Squared distance — use instead of dist() when comparing against a radius. */
function distSq(ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  return dx * dx + dy * dy;
}

function shelterRadius(size: number): number {
  return SHELTER_BASE_RADIUS + size * SHELTER_RADIUS_PER_SIZE;
}

/** Calculate shelter tier from size (1-5, capped at 5 for visual purposes) */
function calculateShelterTier(size: number): number {
  if (size < 100) return 1;
  if (size < 250) return 2;
  if (size < 500) return 3;
  if (size < 1000) return 4;
  return 5; // Max tier
}

/** Visual radius capped at tier 5 (~1000 size) to prevent screen-filling shelters */
function shelterVisualRadius(size: number): number {
  const cappedSize = Math.min(size, 1000); // Cap at tier 5
  return SHELTER_BASE_RADIUS + cappedSize * SHELTER_RADIUS_PER_SIZE;
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
  private pausedDurationMs = 0; // Total time spent paused (for accurate match duration)
  private frozenAtMs: number | null = null; // When the match was last frozen (null if not frozen)
  private matchEndAt = 0;
  private matchStarted = false;
  private matchEndedEarly = false; // True if match ended due to domination
  private players = new Map<string, PlayerState>();
  private pets = new Map<string, PetState>();
  /** Reusable array of outdoor strays for snapshots (avoids per-tick allocation) */
  private snapshotStrays: PetState[] = [];
  private adoptionZones: AdoptionZoneState[] = [];
  private pickups = new Map<string, PickupState>();
  private petIdSeq = 0;
  private pickupIdSeq = 0;
  private spawnPetAt = 0;
  private spawnPickupAt = 0;
  private lastAdoptionTick = new Map<string, number>();
  /** Adopt speed boost: playerId -> tick when boost expires (0 = no active boost) */
  private adoptSpeedUntil = new Map<string, number>();
  /** Cumulative adopt speed usage per player (cap at 300 seconds = 7500 ticks) */
  private adoptSpeedUsedSeconds = new Map<string, number>();
  /** In-match adopt speed boost inventory: playerId -> number of boosts available */
  private playerAdoptSpeedBoosts = new Map<string, number>();
  private groundedPlayerIds = new Set<string>(); // Players who chose to ground themselves
  private portCharges = new Map<string, number>(); // Random port charges per player
  private shelterPortCharges = new Map<string, number>(); // Shelter port charges per player
  private shelterTier3Boosts = new Map<string, number>(); // Pre-match tier-3 shelter boosts per player
  private playerColors = new Map<string, string>(); // Player shelter colors
  private playerMoney = new Map<string, number>(); // In-game money per player
  private eliminatedPlayerIds = new Set<string>();
  private disconnectedPlayerIds = new Set<string>();
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
  private strayLoss = false; // True when match ended due to >2000 strays (no RT, no bonus)
  private totalMatchAdoptions = 0;
  private lastGlobalAdoptionTick = 0;
  private scarcityLevel = 0;
  private triggeredEvents = new Set<number>();
  private satelliteZonesSpawned = false;
  private matchProcessed = false; // Whether match-end inventory/leaderboard has been processed
  
  // CPU AI target persistence to prevent diagonal jitter
  private cpuTargets = new Map<string, { x: number; y: number; type: 'stray' | 'pickup' | 'zone' | 'wander'; breederClaimId?: string }>();
  /** CPU retarget cooldown: tick when bot can pick a new target (simulates reaction time) */
  private cpuRetargetCooldown = new Map<string, number>();
  /** CPU hesitation: tick until which bot stands still (simulates thinking) */
  private cpuHesitateTill = new Map<string, number>();
  
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
  private pendingBreederMiniGames = new Map<string, { petCount: number; startTick: number; level: number; isMill?: boolean; breederShelterId?: string; breederUid?: string; campData?: { x: number; y: number; spawnTick: number }; startSent?: boolean }>();
  /** CPU at breeder: must stay min time before starting simulated mini-game */
  private cpuAtBreeder = new Map<string, { breederUid: string; level: number; arrivalTick: number }>();
  /** Delayed CPU breeder completions: resolved at completeAtTick with RT-based win/loss */
  private pendingCpuBreederCompletions = new Map<string, { level: number; petCount: number; completeAtTick: number }>();
  /** Only one van can engage a breeder: breederUid -> playerId */
  private breederClaimedBy = new Map<string, string>();
  /** Cooldown preventing CPU from targeting breeders after abandoning one: cpuId -> tick when they can target again */
  private cpuBreederCooldown = new Map<string, number>();
  /** Cooldown after a human player retreats from a camp/mill: playerId -> tick when they can engage again */
  private retreatCooldownUntilTick = new Map<string, number>();
  
  // Breeder camp tracking for growth mechanic
  private breederCamps = new Map<string, { x: number; y: number; spawnTick: number; level: number }>();
  private static readonly BREEDER_GROWTH_TICKS = 4500; // 3 minutes at 25 ticks/s before growing (3 * 60 * 25)
  private static readonly BREEDER_GROWTH_RADIUS = 80; // Distance to spawn new camp
  private static readonly BREEDER_SHELTER_LEVEL = 4; // Level at which breeders form a shelter
  private static readonly MAX_BREEDER_LEVEL = 20; // Maximum breeder level; match ends when all level 20+ cleared
  /** Only spawn random strays during first 5 minutes; after that only breeders spawn strays */
  private static readonly INITIAL_SPAWN_PERIOD_TICKS = 25 * 60 * 5; // 5 minutes at 25 tps
  
  // Breeder shelters - formed when breeders grow too large
  private breederShelters = new Map<string, { 
    x: number; 
    y: number; 
    level: number; 
    lastSpawnTick: number;
    size: number; // Grows over time
  }>();
  private breederShelterId = 0;
  /** Mills (breeder shelters) currently in van mini-game; cleared when game completes. */
  private millInCombat = new Set<string>();
  /** Player ID -> breederShelterId for active mill games (so we know which shelter to remove on 100%). */
  private activeMillByPlayer = new Map<string, string>();
  private static readonly BREEDER_SHELTER_SPAWN_INTERVAL = 125; // Spawn wild stray every 5 seconds (5 * 25 ticks)
  private static readonly BREEDER_STRAY_SPEED = 3.5; // Wild strays move fast and spread across the map
  /** No strays inside this radius of breeder camps or shelters (clean map). */
  private static readonly BREEDER_NO_STRAY_RADIUS = 100;
  private static readonly BREEDER_STRAY_MIN_SPAWN_DIST = 200; // Min distance from breeder shelter when spawning wild strays
  
  // Wild strays (from breeder shelters) - harder to catch, move around
  private wildStrayIds = new Set<string>();
  
  // Spatial grid for fast proximity queries (rebuilt every tick)
  private petGrid = new SpatialGrid<PetState>(200);
  /** Reusable buffer for spatial-grid query results (avoids per-query allocation) */
  private gridQueryBuf: PetState[] = [];
  
  // Solo mode options
  private cpuCanShutdownBreeders = true; // Can be set via game options
  private matchMode: 'ffa' | 'solo' | 'teams' = 'ffa'; // Match mode (set by GameServer)
  
  // Teams mode: team assignments and scores
  private playerTeams = new Map<string, 'red' | 'blue'>(); // playerId -> team
  private teamScores = new Map<string, number>([['red', 0], ['blue', 0]]); // team -> score
  private winningTeam: 'red' | 'blue' | null = null; // Set when match ends in Teams mode
  
  // Boss Mode state
  private bossMode: {
    active: boolean;
    startTick: number;
    timeLimit: number;
    mills: Array<{
      id: number;
      petType: number;
      petCount: number;
      recipe: { [ingredient: string]: number };
      purchased: { [ingredient: string]: number };
      completed: boolean;
      x: number;
      y: number;
    }>;
    tycoonX: number;
    tycoonY: number;
    tycoonTargetMill: number;
    tycoonMoveAtTick: number;
    millsCleared: number;
    mallX: number;
    mallY: number;
    playerAtMill: number;
    lastMillClearTick: number; // For combo bonus tracking
    rebuildingMill: number; // Which mill tycoon is rebuilding (-1 = none)
    rebuildStartTick: number; // When rebuild started
    visitedMills: number[]; // Track visit history to avoid immediate repeats
  } | null = null;
  
  // Match-wide announcements queue
  private pendingAnnouncements: string[] = [];
  /** Stray count thresholds for which we have already shown a warning (400, 1000, 1700). */
  private strayWarnings = new Set<number>();

  // Adoption events - timed events with pet type requirements
  private adoptionEvents = new Map<string, AdoptionEvent>();
  private adoptionEventIdSeq = 0;
  private nextAdoptionEventSpawnTick = 0;
  private static readonly ADOPTION_EVENT_RADIUS_MAX = 350;    // Maximum radius (current size)
  private static readonly ADOPTION_EVENT_RADIUS_MIN = 150;    // Minimum radius
  private static readonly ADOPTION_EVENT_DURATION_MIN = 1500; // 60s at 25 tps
  private static readonly ADOPTION_EVENT_DURATION_MAX = 3750; // 150s at 25 tps
  private static readonly ADOPTION_EVENT_NEEDED_MIN = 70;     // Min pets needed to rescue
  private static readonly ADOPTION_EVENT_NEEDED_MAX = 300;    // Max pets needed to rescue
  private static readonly ADOPTION_EVENT_SPAWN_DELAY_MIN = 1500; // 1 min before first event
  private static readonly ADOPTION_EVENT_SPAWN_DELAY_MAX = 3750; // 2.5 min between events

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
      // Adopt speed boost: check if currently active (tick < adoptSpeedUntil)
      const adoptSpeedUntil = this.adoptSpeedUntil.get(p.id) ?? 0;
      if (this.tick < adoptSpeedUntil) {
        interval = Math.max(5, Math.floor(interval * 0.5));
      }
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

  addPlayer(id: string, displayName?: string, startingRT?: number, startingPorts?: number, shelterTier3Boosts?: number, adoptSpeedBoosts?: number): void {
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
    // Pre-match tier-3 shelter boosts (shelter starts at size 250 when built)
    if (shelterTier3Boosts && shelterTier3Boosts > 0) {
      this.shelterTier3Boosts.set(id, shelterTier3Boosts);
      log(`Player ${name} starting with ${shelterTier3Boosts} tier-3 shelter boost(s)`);
    }
    // Adopt speed boosts from inventory (use during match for 60s each, max 5 min)
    if (adoptSpeedBoosts && adoptSpeedBoosts > 0) {
      this.playerAdoptSpeedBoosts.set(id, adoptSpeedBoosts);
      log(`Player ${name} starting with ${adoptSpeedBoosts} adopt speed boost(s)`);
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
    
    for (let i = 0; i < 200; i++) {
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
          const breederShelterR = 40 + shelter.size * 0.5 + 50; // Shelter radius + margin
          const dx = x - shelter.x;
          const dy = y - shelter.y;
          if (dx * dx + dy * dy < breederShelterR * breederShelterR) {
            ok = false;
            break;
          }
        }
      }
      
      // Check player shelters - don't spawn inside or near them
      if (ok) {
        for (const shelter of this.shelters.values()) {
          // Cap avoidance radius so breeder camps can still spawn on large maps with big shelters
          const playerShelterR = Math.min(shelterVisualRadius(shelter.size) + 100, 800);
          const dx = x - shelter.x;
          const dy = y - shelter.y;
          if (dx * dx + dy * dy < playerShelterR * playerShelterR) {
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
    this.adoptSpeedUntil.delete(id);
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
    const hasTier3Boost = (this.shelterTier3Boosts.get(id) ?? 0) > 0;
    const initialSize = hasTier3Boost ? 250 : 10; // Tier 3 = size >= 250
    const initialTier = calculateShelterTier(initialSize);

    const shelter: ShelterState = {
      id: shelterId,
      ownerId: id,
      x: p.x,
      y: p.y,
      hasAdoptionCenter: false,
      hasGravity: false,
      hasAdvertising: false,
      petsInside: [],
      size: initialSize,
      totalAdoptions: 0,
      tier: initialTier,
    };

    if (hasTier3Boost) {
      const remaining = (this.shelterTier3Boosts.get(id) ?? 1) - 1;
      if (remaining <= 0) this.shelterTier3Boosts.delete(id);
      else this.shelterTier3Boosts.set(id, remaining);
      log(`Player ${p.displayName} used tier-3 shelter boost: shelter built at size ${initialSize} (tier ${initialTier})`);
    }

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
    if (!shelter.hasAdoptionCenter) return { success: false, reason: 'Need adoption center first' };
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
  
  /** Use a shelter port charge to teleport to own shelter */
  useShelterPort(id: string): boolean {
    const p = this.players.get(id);
    if (!p || this.eliminatedPlayerIds.has(id)) return false;
    const charges = this.shelterPortCharges.get(id) ?? 0;
    if (charges <= 0) return false;
    
    // Find player's shelter
    const shelter = this.getPlayerShelter(id);
    if (!shelter) return false; // No shelter to port to
    
    p.x = shelter.x;
    p.y = shelter.y;
    this.shelterPortCharges.set(id, charges - 1);
    // Porting ungrounds the player (they arrive at shelter but can move)
    this.groundedPlayerIds.delete(id);
    return true;
  }
  
  /** Transfer pets from van to allied shelter. Returns count transferred and adoption score earned. */
  transferPetsToAlliedShelter(vanPlayerId: string, targetShelterId: string): { success: boolean; count: number; senderScore: number; receiverScore: number; reason?: string } {
    const van = this.players.get(vanPlayerId);
    if (!van || this.eliminatedPlayerIds.has(vanPlayerId)) {
      return { success: false, count: 0, senderScore: 0, receiverScore: 0, reason: 'Invalid player' };
    }
    
    const targetShelter = this.shelters.get(targetShelterId);
    if (!targetShelter) {
      return { success: false, count: 0, senderScore: 0, receiverScore: 0, reason: 'Shelter not found' };
    }
    
    // Check if target shelter owner is allied
    if (!this.isAlly(vanPlayerId, targetShelter.ownerId, this.lastAllyPairs)) {
      return { success: false, count: 0, senderScore: 0, receiverScore: 0, reason: 'Must be allied to transfer' };
    }
    
    // Check if van is near the shelter (within transfer range)
    const sr = Math.min(shelterVisualRadius(targetShelter.size), 300);
    const transferRange = sr + 100; // Can transfer from slightly outside shelter
    const dx = van.x - targetShelter.x;
    const dy = van.y - targetShelter.y;
    if (Math.hypot(dx, dy) > transferRange) {
      return { success: false, count: 0, senderScore: 0, receiverScore: 0, reason: 'Too far from shelter' };
    }
    
    // Transfer all pets from van to shelter
    const petsToTransfer = van.petsInside.length;
    if (petsToTransfer === 0) {
      return { success: false, count: 0, senderScore: 0, receiverScore: 0, reason: 'No pets to transfer' };
    }
    
    // Move pets to shelter
    for (const petId of van.petsInside) {
      targetShelter.petsInside.push(petId);
      const pet = this.pets.get(petId);
      if (pet) {
        pet.insideShelterId = targetShelter.id;
        pet.x = targetShelter.x;
        pet.y = targetShelter.y;
      }
    }
    van.petsInside = [];
    
    // Calculate adoption scores: 30% to sender, 70% to receiver (per design doc)
    const baseScore = petsToTransfer * 10; // 10 points per pet
    const senderScore = Math.floor(baseScore * 0.3);
    const receiverScore = Math.floor(baseScore * 0.7);
    
    log(`Player ${van.displayName} transferred ${petsToTransfer} pets to allied shelter (sender: +${senderScore}, receiver: +${receiverScore})`);
    
    return { success: true, count: petsToTransfer, senderScore, receiverScore };
  }
  
  /** Get shelter IDs of allied players that this player can transfer to */
  getAlliedShelters(playerId: string): string[] {
    const result: string[] = [];
    for (const shelter of this.shelters.values()) {
      if (shelter.ownerId === playerId) continue; // Skip own shelter
      if (this.isAlly(playerId, shelter.ownerId, this.lastAllyPairs)) {
        result.push(shelter.id);
      }
    }
    return result;
  }

  setInput(id: string, inputFlags: number, inputSeq: number): void {
    const p = this.players.get(id);
    if (!p) return;
    p.inputSeq = inputSeq;
    (p as PlayerState & { lastInputFlags?: number }).lastInputFlags = inputFlags;
  }

  setPlayerDisconnected(id: string, disconnected: boolean): void {
    if (disconnected) this.disconnectedPlayerIds.add(id);
    else this.disconnectedPlayerIds.delete(id);
  }

  applyStartingBoosts(id: string, boosts: { sizeBonus?: number; speedBoost?: boolean; adoptSpeedBoosts?: number }): void {
    const p = this.players.get(id);
    if (!p) return;
    if (typeof boosts.sizeBonus === 'number' && boosts.sizeBonus > 0) {
      p.size += boosts.sizeBonus;
    }
    if (boosts.speedBoost) {
      p.speedBoostUntil = this.tick + SPEED_BOOST_DURATION_TICKS;
    }
    if (typeof boosts.adoptSpeedBoosts === 'number' && boosts.adoptSpeedBoosts > 0) {
      const current = this.playerAdoptSpeedBoosts.get(id) ?? 0;
      this.playerAdoptSpeedBoosts.set(id, current + boosts.adoptSpeedBoosts);
    }
  }

  /** Use one adopt speed boost: 60 seconds duration, max 5 minutes (300s) cumulative per match */
  useAdoptSpeedBoost(playerId: string): { success: boolean; remainingBoosts: number; activeUntilTick: number; usedSeconds: number } {
    const available = this.playerAdoptSpeedBoosts.get(playerId) ?? 0;
    const usedSeconds = this.adoptSpeedUsedSeconds.get(playerId) ?? 0;
    const currentUntil = this.adoptSpeedUntil.get(playerId) ?? 0;
    
    if (available <= 0) {
      return { success: false, remainingBoosts: 0, activeUntilTick: currentUntil, usedSeconds };
    }
    
    if (usedSeconds >= 300) {
      // Max 5 minutes already used this match
      return { success: false, remainingBoosts: available, activeUntilTick: currentUntil, usedSeconds };
    }
    
    // Consume 1 boost, extend timer by 60 seconds (1500 ticks at 25Hz)
    this.playerAdoptSpeedBoosts.set(playerId, available - 1);
    const BOOST_DURATION_TICKS = 1500; // 60 seconds at 25 ticks/second
    const newUntil = Math.max(currentUntil, this.tick) + BOOST_DURATION_TICKS;
    this.adoptSpeedUntil.set(playerId, newUntil);
    this.adoptSpeedUsedSeconds.set(playerId, usedSeconds + 60);
    
    return { 
      success: true, 
      remainingBoosts: available - 1, 
      activeUntilTick: newUntil,
      usedSeconds: usedSeconds + 60,
    };
  }

  /** Get adopt speed boost status for a player */
  getAdoptSpeedBoostStatus(playerId: string): { remainingBoosts: number; activeUntilTick: number; usedSeconds: number; isActive: boolean } {
    const remainingBoosts = this.playerAdoptSpeedBoosts.get(playerId) ?? 0;
    const activeUntilTick = this.adoptSpeedUntil.get(playerId) ?? 0;
    const usedSeconds = this.adoptSpeedUsedSeconds.get(playerId) ?? 0;
    const isActive = this.tick < activeUntilTick;
    return { remainingBoosts, activeUntilTick, usedSeconds, isActive };
  }

  /** Get remaining adopt speed boosts for a player (for deposit back to inventory) */
  getAdoptSpeedBoosts(playerId: string): number {
    return this.playerAdoptSpeedBoosts.get(playerId) ?? 0;
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

  /** Set CPU target and release any previous breeder claim if changing targets */
  private setCpuTarget(playerId: string, target: { x: number; y: number; type: 'stray' | 'pickup' | 'zone' | 'wander'; breederClaimId?: string }): void {
    const oldTarget = this.cpuTargets.get(playerId);
    // Release old breeder claim if we're switching to a different target
    if (oldTarget?.breederClaimId && oldTarget.breederClaimId !== target.breederClaimId) {
      this.breederClaimedBy.delete(oldTarget.breederClaimId);
    }
    this.cpuTargets.set(playerId, target);
  }

  private cpuAI(p: PlayerState): number {
    const zone = this.adoptionZones[0];
    if (!zone) return 0;

    // Bot imperfection: occasional hesitation (stand still for ~0.5-1.5s simulating thinking)
    const hesitateUntil = this.cpuHesitateTill.get(p.id) ?? 0;
    if (this.tick < hesitateUntil) return 0; // Stand still during hesitation
    // ~2% chance per tick to hesitate for 12-38 ticks (0.5-1.5s)
    if (Math.random() < 0.02) {
      const duration = 12 + Math.floor(Math.random() * 26);
      this.cpuHesitateTill.set(p.id, this.tick + duration);
    }

    // Vans (not grounded) are capped at VAN_MAX_CAPACITY
    const isGrounded = this.groundedPlayerIds.has(p.id);
    const capacity = isGrounded ? Math.floor(p.size) : Math.min(Math.floor(p.size), VAN_MAX_CAPACITY);
    const sr = SHELTER_BASE_RADIUS + p.size * SHELTER_RADIUS_PER_SIZE;
    const touchingZone = this.shelterInZoneAABB(p, zone);

    // PRIORITY: Flee from enemy shelters - don't approach them
    for (const shelter of this.shelters.values()) {
      if (shelter.ownerId === p.id) continue;
      if (this.isAlly(p.id, shelter.ownerId, this.lastAllyPairs)) continue;
      
      const shelterR = Math.min(shelterVisualRadius(shelter.size), 400);
      const dangerRadius = shelterR + 100; // Stay away from enemy shelters
      const d = dist(p.x, p.y, shelter.x, shelter.y);
      if (d < dangerRadius) {
        // Flee away from enemy shelter
        const dx = p.x - shelter.x;
        const dy = p.y - shelter.y;
        const len = Math.hypot(dx, dy) || 1;
        const fleeX = clamp(p.x + (dx / len) * 200, 50, MAP_WIDTH - 50);
        const fleeY = clamp(p.y + (dy / len) * 200, 50, MAP_HEIGHT - 50);
        this.setCpuTarget(p.id, { x: fleeX, y: fleeY, type: 'wander' });
        return this.directionToward(p.x, p.y, fleeX, fleeY);
      }
    }

    // Stop to adopt if shelter touches zone and has pets
    if (touchingZone && p.petsInside.length > 0) {
      this.cpuTargets.delete(p.id); // Clear target while adopting
      return 0;
    }

    // Stop at ally shelter to deliver pets if within delivery range
    if (p.petsInside.length > 0) {
      for (const other of this.players.values()) {
        if (other.id === p.id) continue;
        if (!this.isAlly(p.id, other.id, this.lastAllyPairs)) continue;
        const allyShelter = this.getPlayerShelter(other.id);
        if (allyShelter && allyShelter.petsInside.length < shelterMaxPets(other.size)) {
          const shelterR = Math.min(shelterVisualRadius(allyShelter.size), 300);
          const d = dist(p.x, p.y, allyShelter.x, allyShelter.y);
          if (d <= shelterR) {
            // At ally shelter - stop to let pet transfer happen
            this.cpuTargets.delete(p.id);
            return 0;
          }
        }
      }
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
          this.setCpuTarget(p.id, { x: allyShelter.x, y: allyShelter.y, type: 'zone' });
          return this.directionToward(p.x, p.y, allyShelter.x, allyShelter.y);
        }
      }
      // No ally shelter, go to adoption zone
      const edge = this.zoneSquareEdgeTarget(zone, p.x, p.y, sr, false);
      this.setCpuTarget(p.id, { x: edge.x, y: edge.y, type: 'zone' });
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
              // If this is a breeder target, re-check RT and cooldown
              if (currentTarget.breederClaimId && u.type === PICKUP_TYPE_BREEDER) {
                const cpuRt = this.playerMoney.get(p.id) ?? 0;
                const cooldownEnd = this.cpuBreederCooldown.get(p.id) ?? 0;
                const breederLevel = this.breederCamps.get(u.id)?.level ?? 1;
                const minRt = World.minRtForBreederLevel(breederLevel);
                // Invalid if on cooldown or can't afford
                if (this.tick < cooldownEnd || cpuRt < minRt) {
                  targetValid = false;
                  break;
                }
              }
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
          // Target is gone - release any breeder claim
          if (currentTarget.breederClaimId) {
            this.breederClaimedBy.delete(currentTarget.breederClaimId);
          }
          this.cpuTargets.delete(p.id);
        }
      }
    }

    // Bot imperfection: retarget cooldown (don't pick a new target immediately)
    const cooldownUntil = this.cpuRetargetCooldown.get(p.id) ?? 0;
    if (this.tick < cooldownUntil) {
      // Wander aimlessly during cooldown
      return 0;
    }
    // Set a short cooldown before next retarget (15-40 ticks = 0.6-1.6s)
    this.cpuRetargetCooldown.set(p.id, this.tick + 15 + Math.floor(Math.random() * 25));

    // Need new target - look for strays/pickups across the ENTIRE map
    const strayCandidates: { x: number; y: number; d: number }[] = [];
    const pickupCandidates: { x: number; y: number; d: number; type: number; id: string; level?: number }[] = [];

    for (const pet of this.pets.values()) {
      if (pet.insideShelterId !== null) continue;
      const d = dist(p.x, p.y, pet.x, pet.y);
      strayCandidates.push({ x: pet.x, y: pet.y, d });
    }
    strayCandidates.sort((a, b) => a.d - b.d);

    const cpuRt = this.playerMoney.get(p.id) ?? 0;
    const breederCooldownEnd = this.cpuBreederCooldown.get(p.id) ?? 0;
    const canTargetBreeders = this.tick >= breederCooldownEnd;
    
    for (const u of this.pickups.values()) {
      // Skip breeder camps if CPU is not allowed to shut them down
      if (u.type === PICKUP_TYPE_BREEDER && !this.cpuCanShutdownBreeders) continue;
      // Skip breeder camps that are already claimed by another player (human or CPU physically at breeder)
      if (u.type === PICKUP_TYPE_BREEDER) {
        // Check if breeder is claimed by someone physically at it
        const claim = this.breederClaimedBy.get(u.id);
        if (claim !== undefined && claim !== p.id) continue;
        // Check if another CPU is targeting this breeder (to prevent multiple CPUs heading to same one)
        let anotherCpuTargeting = false;
        for (const [cpuId, target] of this.cpuTargets) {
          if (cpuId !== p.id && target.breederClaimId === u.id) {
            anotherCpuTargeting = true;
            break;
          }
        }
        if (anotherCpuTargeting) continue;
        // Skip if CPU is on breeder cooldown
        if (!canTargetBreeders) continue;
        // Skip if CPU doesn't have enough RT for this breeder level
        const breederLevel = this.breederCamps.get(u.id)?.level ?? 1;
        const minRt = World.minRtForBreederLevel(breederLevel);
        if (cpuRt < minRt) continue;
      }
      const d = dist(p.x, p.y, u.x, u.y);
      const level = u.type === PICKUP_TYPE_BREEDER ? (this.breederCamps.get(u.id)?.level ?? 1) : undefined;
      pickupCandidates.push({ x: u.x, y: u.y, d, type: u.type, id: u.id, level });
    }
    pickupCandidates.sort((a, b) => a.d - b.d);

    // Pick target with significant randomness (bots are good but not optimal)
    const pickWithJitter = <T extends { x: number; y: number; d: number }>(arr: T[]): T | null => {
      if (arr.length === 0) return null;
      if (arr.length === 1) return arr[0];
      // 50% nearest, 25% second nearest, 15% third, 10% random further
      const r = Math.random();
      let idx: number;
      if (r < 0.50) idx = 0;
      else if (r < 0.75) idx = Math.min(1, arr.length - 1);
      else if (r < 0.90) idx = Math.min(2, arr.length - 1);
      else idx = Math.min(Math.floor(Math.random() * Math.min(5, arr.length)), arr.length - 1);
      return arr[idx] ?? null;
    };

    // PRIORITY: Attack breeders aggressively when allowed
    if (this.cpuCanShutdownBreeders) {
      const breederCandidates = pickupCandidates.filter(c => c.type === PICKUP_TYPE_BREEDER);
      if (breederCandidates.length > 0) {
        // Always prioritize if 2+ breeders, or 60% chance with 1 breeder
        if (breederCandidates.length >= 2 || Math.random() < 0.6) {
          const target = breederCandidates[0]; // Nearest UNCLAIMED breeder
          // Note: Don't set breederClaimedBy here - that blocks human players
          // The breederClaimId in cpuTargets is enough to prevent other CPUs from targeting
          // Actual claim happens when CPU physically arrives at the breeder
          this.setCpuTarget(p.id, { x: target.x, y: target.y, type: 'pickup', breederClaimId: target.id });
          return this.directionToward(p.x, p.y, target.x, target.y);
        }
      }
    }

    const strayTarget = pickWithJitter(strayCandidates);
    const pickupTarget = pickWithJitter(pickupCandidates);

    // Prefer strays when not full, then pickups
    if (strayTarget) {
      this.setCpuTarget(p.id, { x: strayTarget.x, y: strayTarget.y, type: 'stray' });
      return this.directionToward(p.x, p.y, strayTarget.x, strayTarget.y);
    }
    if (pickupTarget) {
      this.setCpuTarget(p.id, { x: pickupTarget.x, y: pickupTarget.y, type: 'pickup' });
      return this.directionToward(p.x, p.y, pickupTarget.x, pickupTarget.y);
    }

    // No strays or pickups on map: wander randomly (not toward zone)
    const wanderX = MAP_WIDTH * (0.1 + Math.random() * 0.8);
    const wanderY = MAP_HEIGHT * (0.1 + Math.random() * 0.8);
    this.setCpuTarget(p.id, { x: wanderX, y: wanderY, type: 'wander' });
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
      // Season speed modifier
      const season = getCurrentSeason();
      baseSpeed *= SEASON_SPEED_MULTIPLIER[season];
      // Spring: extra slow in thick vegetation patches
      if (season === 'spring' && isInVegetationPatch(p.x, p.y)) {
        baseSpeed *= SPRING_VEGETATION_SPEED;
      }
      // Fall: random wind gusts (deterministic from tick)
      if (season === 'fall') {
        baseSpeed *= getWindMultiplier(this.tick);
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
    this.cpuAtBreeder.clear();
    this.pendingCpuBreederCompletions.clear();
    this.breederClaimedBy.clear();
    this.cpuBreederCooldown.clear();
    this.retreatCooldownUntilTick.clear();
    this.breederCamps.clear();
    this.breederShelters.clear();
    this.millInCombat.clear();
    this.activeMillByPlayer.clear();
    this.wildStrayIds.clear();
    this.pendingAnnouncements = [];
    this.strayWarnings.clear();
    this.adoptionEvents.clear();
    this.nextAdoptionEventSpawnTick = this.tick + World.ADOPTION_EVENT_SPAWN_DELAY_MIN;
    // Reset adopt speed boost tracking (but NOT playerAdoptSpeedBoosts which is loaded from inventory)
    this.adoptSpeedUntil.clear();
    this.adoptSpeedUsedSeconds.clear();
  }
  
  private spawnAdoptionEvent(now: number): void {
    const eventTypes: AdoptionEvent['type'][] = ['school_fair', 'farmers_market', 'petco_weekend', 'stadium_night'];
    const type = eventTypes[Math.floor(Math.random() * eventTypes.length)];
    const x = 200 + Math.random() * (MAP_WIDTH - 400);
    const y = 200 + Math.random() * (MAP_HEIGHT - 400);
    
    // Randomize radius between min and max
    const radius = World.ADOPTION_EVENT_RADIUS_MIN + 
      Math.floor(Math.random() * (World.ADOPTION_EVENT_RADIUS_MAX - World.ADOPTION_EVENT_RADIUS_MIN));
    
    // Randomize total pets needed to rescue (70-300)
    const totalNeeded = World.ADOPTION_EVENT_NEEDED_MIN +
      Math.floor(Math.random() * (World.ADOPTION_EVENT_NEEDED_MAX - World.ADOPTION_EVENT_NEEDED_MIN + 1));
    
    // Keep requirements for variety tracking, but main goal is totalNeeded
    const numReqs = 1 + Math.floor(Math.random() * 2); // 1-2 requirement types
    const requirements: { petType: number; count: number }[] = [];
    const usedTypes = new Set<number>();
    for (let i = 0; i < numReqs; i++) {
      let pt = Math.floor(Math.random() * 5); // 0-4
      while (usedTypes.has(pt)) pt = Math.floor(Math.random() * 5);
      usedTypes.add(pt);
      requirements.push({ petType: pt, count: 2 + Math.floor(Math.random() * 4) }); // 2-5 each
    }
    
    // Randomize duration between 60s-150s
    const durationTicks = World.ADOPTION_EVENT_DURATION_MIN + 
      Math.floor(Math.random() * (World.ADOPTION_EVENT_DURATION_MAX - World.ADOPTION_EVENT_DURATION_MIN));
    
    const eid = `event-${++this.adoptionEventIdSeq}`;
    const ev: AdoptionEvent = {
      id: eid,
      type,
      x,
      y,
      radius,
      requirements,
      totalNeeded,
      totalRescued: 0,
      contributions: {},
      startTick: now,
      durationTicks,
      rewards: { top1: 100, top2: 50, top3: 25, participation: 10 },
    };
    this.adoptionEvents.set(eid, ev);
    const typeName = type.replace(/_/g, ' ');
    log(`Adoption event started: ${typeName} at (${Math.round(x)}, ${Math.round(y)}) radius=${radius} need=${totalNeeded} for ${Math.round(durationTicks / 25)}s`);
    this.pendingAnnouncements.push(`📢 ${typeName.replace(/\b\w/g, c => c.toUpperCase())} - rescue ${totalNeeded} pets!`);
  }
  
  private resolveAdoptionEvent(eid: string, ev: AdoptionEvent): void {
    const totals: { playerId: string; total: number }[] = [];
    for (const [playerId, contrib] of Object.entries(ev.contributions)) {
      let total = 0;
      for (const count of Object.values(contrib)) total += count;
      if (total > 0) totals.push({ playerId, total });
    }
    totals.sort((a, b) => b.total - a.total);
    const top1 = this.players.get(totals[0]?.playerId ?? '');
    const top2 = this.players.get(totals[1]?.playerId ?? '');
    const top3 = this.players.get(totals[2]?.playerId ?? '');
    if (top1) this.playerMoney.set(top1.id, (this.playerMoney.get(top1.id) ?? 0) + ev.rewards.top1);
    if (top2) this.playerMoney.set(top2.id, (this.playerMoney.get(top2.id) ?? 0) + ev.rewards.top2);
    if (top3) this.playerMoney.set(top3.id, (this.playerMoney.get(top3.id) ?? 0) + ev.rewards.top3);
    for (let i = 3; i < totals.length; i++) {
      const p = this.players.get(totals[i].playerId);
      if (p) this.playerMoney.set(p.id, (this.playerMoney.get(p.id) ?? 0) + ev.rewards.participation);
    }
    if (top1) {
      this.pendingAnnouncements.push(`${top1.displayName} won ${ev.type.replace(/_/g, ' ')} event! +${ev.rewards.top1} RT`);
      log(`Event ${eid} ended - winner: ${top1.displayName}`);
    }
  }
  
  private recordEventContribution(playerId: string, petType: number, x: number, y: number): void {
    for (const ev of this.adoptionEvents.values()) {
      const d = Math.hypot(ev.x - x, ev.y - y);
      if (d <= ev.radius) {
        if (!ev.contributions[playerId]) ev.contributions[playerId] = {};
        ev.contributions[playerId][petType] = (ev.contributions[playerId][petType] ?? 0) + 1;
        ev.totalRescued += 1; // Track total rescues toward the goal
      }
    }
  }
  
  /** Set whether CPU players can attempt to shut down breeders (solo mode option) */
  setCpuBreederBehavior(canShutdown: boolean): void {
    this.cpuCanShutdownBreeders = canShutdown;
  }
  
  /** Set the match mode (ffa, solo, teams) */
  setMatchMode(mode: 'ffa' | 'solo' | 'teams'): void {
    this.matchMode = mode;
  }
  
  /** Get the current match mode */
  getMatchMode(): 'ffa' | 'solo' | 'teams' {
    return this.matchMode;
  }
  
  /** Check if boss mode is currently active */
  isBossModeActive(): boolean {
    return this.bossMode?.active ?? false;
  }
  
  /** Form an alliance between two players */
  formAlliance(playerId1: string, playerId2: string): void {
    if (playerId1 === playerId2) return;
    const key = playerId1 < playerId2 ? `${playerId1},${playerId2}` : `${playerId2},${playerId1}`;
    if (this.lastAllyPairs.has(key)) return; // Already allied
    this.lastAllyPairs.add(key);
    log(`Alliance formed between ${playerId1} and ${playerId2}`);
  }

  /** Assign a player to a team (Teams mode only). */
  setPlayerTeam(playerId: string, team: 'red' | 'blue'): void {
    this.playerTeams.set(playerId, team);
  }

  /** Get a player's team assignment. */
  getPlayerTeam(playerId: string): 'red' | 'blue' | undefined {
    return this.playerTeams.get(playerId);
  }

  /** Get the current team scores. */
  getTeamScores(): { red: number; blue: number } {
    return {
      red: this.teamScores.get('red') ?? 0,
      blue: this.teamScores.get('blue') ?? 0,
    };
  }

  /** Get the winning team (set after match ends in Teams mode). */
  getWinningTeam(): 'red' | 'blue' | null {
    return this.winningTeam;
  }

  /** Auto-form alliances between all players on the same team (call once at match start or when teams change). */
  formTeamAlliances(): void {
    const redPlayers: string[] = [];
    const bluePlayers: string[] = [];
    for (const [pid, team] of this.playerTeams) {
      if (team === 'red') redPlayers.push(pid);
      else bluePlayers.push(pid);
    }
    // Ally all red players with each other
    for (let i = 0; i < redPlayers.length; i++) {
      for (let j = i + 1; j < redPlayers.length; j++) {
        this.formAlliance(redPlayers[i], redPlayers[j]);
      }
    }
    // Ally all blue players with each other
    for (let i = 0; i < bluePlayers.length; i++) {
      for (let j = i + 1; j < bluePlayers.length; j++) {
        this.formAlliance(bluePlayers[i], bluePlayers[j]);
      }
    }
  }

  private static readonly ELIMINATED_SIZE_THRESHOLD = 10;

  /** Time limit in seconds for breeder camp mini-game by level (human and CPU). */
  private static getBreederTimeLimitSeconds(level: number): number {
    if (level <= 5) return 15;
    if (level <= 9) return 30;
    if (level <= 14) return 40;
    return 45;
  }

  /** Time limit in seconds for mill (breeder shelter) mini-game: 60 + level*2. */
  private static getBreederMillTimeLimitSeconds(level: number): number {
    return 60 + level * 2;
  }

  /** Min seconds CPU must stay at breeder before starting (5 + level). */
  private static getBreederMinStaySeconds(level: number): number {
    return 5 + level;
  }
  
  /** Time CPU waits after "starting" breeder before completion (instant result, just 1 second pause). */
  private static readonly CPU_BREEDER_COMPLETION_SECONDS = 1;

  /** True if player is in any breeder state (mini-game or CPU at/during breeder) - van must not move. */
  private isPlayerInBreederState(playerId: string): boolean {
    return this.pendingBreederMiniGames.has(playerId)
      || this.cpuAtBreeder.has(playerId)
      || this.pendingCpuBreederCompletions.has(playerId);
  }

  /** Estimated RT cost to complete breeder (petCount meals × ingredients × avg cost). */
  private static estimatedBreederRtCost(level: number, petCount: number): number {
    let ingredientCount = 1;
    let avgCost = 10;
    if (level >= 10) {
      ingredientCount = 4;
      avgCost = 13;
    } else if (level >= 6) {
      ingredientCount = 3;
      avgCost = 11;
    } else if (level >= 3) {
      ingredientCount = 2;
      avgCost = 10;
    }
    return petCount * ingredientCount * avgCost;
  }

  /** Minimum RT required to attempt a breeder of given level (used for early CPU checks). */
  private static minRtForBreederLevel(level: number): number {
    // Conservative estimate: assume average pet count and add buffer
    // Level 1-2: ~45 RT, Level 3-5: ~80 RT, Level 6-9: ~120 RT, Level 10+: ~200 RT
    if (level >= 10) return 200;
    if (level >= 6) return 120;
    if (level >= 3) return 80;
    return 45; // Level 1-2 minimum
  }

  tickWorld(fightAllyChoices?: Map<string, 'fight' | 'ally'>, allyRequests?: Map<string, Set<string>>, cpuIds?: Set<string>): void {
    if (!this.matchStarted) return;
    this.tick++;
    const now = this.tick;

    if (this.isMatchOver()) return; // no movement, rescue, adoption, or spawns after match end

    // Update boss mode if active
    if (this.bossMode?.active) {
      this.updateBossMode();
      // During boss mode, skip normal gameplay (spawning, breeders, etc.)
      // Only allow player movement and boss mode interaction
    }

    const allyPairs = fightAllyChoices ? World.allyPairsFromChoices(fightAllyChoices) : new Set<string>();

    // Teams mode: reinforce alliances between teammates every tick
    if (this.matchMode === 'teams') {
      this.formTeamAlliances();
    }

    // Helper to check if both players have mutual ally requests (clicked ally on each other before overlap)
    const hasMutualAllyRequest = (aId: string, bId: string): boolean => {
      if (!allyRequests) return false;
      const aRequests = allyRequests.get(aId);
      const bRequests = allyRequests.get(bId);
      return !!(aRequests?.has(bId) && bRequests?.has(aId));
    };

    // Anti-stall: Scarcity escalation when no adoptions for too long (only during initial 5 min; goal is zero strays after)
    const ticksSinceStartForScarcity = now - this.matchStartTick;
    const ticksSinceAdoption = now - this.lastGlobalAdoptionTick;
    if (ticksSinceStartForScarcity < World.INITIAL_SPAWN_PERIOD_TICKS && this.lastGlobalAdoptionTick > 0 && ticksSinceAdoption > SCARCITY_TRIGGER_TICKS) {
      const newScarcityLevel = Math.min(3, Math.floor(ticksSinceAdoption / SCARCITY_TRIGGER_TICKS));
      if (newScarcityLevel > this.scarcityLevel) {
        this.scarcityLevel = newScarcityLevel;
        log(`Scarcity level ${this.scarcityLevel} activated at tick ${now}`);
        
        // Level 2+: Spawn bonus strays outside adoption zone (only in initial period)
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
                petType: randomPetType(),
              });
            }
          }
        }
      }
      // No gravity toward adoption center — only shelter gravity applies (see shelter hasGravity loop below)
    }
    
    // Wild strays (from breeder shelters) move around randomly - harder to catch!
    // Direction changes are staggered across ticks so we don't spike CPU every 75th tick
    const tickMod75 = this.tick % 75;
    for (const petId of this.wildStrayIds) {
      const pet = this.pets.get(petId);
      if (!pet || pet.insideShelterId !== null) {
        this.wildStrayIds.delete(petId); // No longer wild if caught
        continue;
      }
      
      // Staggered direction change: use pet's sequence number to distribute across 75 ticks
      const seq = parseInt(petId.slice(4), 10) || 0; // "pet-123" → 123
      if ((seq % 75) === tickMod75 || (pet.vx === 0 && pet.vy === 0)) {
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
    
    // Rebuild spatial grid for outdoor pets (used by all proximity queries below)
    this.petGrid.clear();
    for (const pet of this.pets.values()) {
      if (pet.insideShelterId === null) {
        this.petGrid.insert(pet);
      }
    }

    // Keep strays outside breeder camp/shelter radius (clean map)
    // Inverted loop: iterate breeders and query nearby pets from spatial grid
    const R = World.BREEDER_NO_STRAY_RADIUS;
    const buf = this.gridQueryBuf;
    for (const pickup of this.pickups.values()) {
      if (pickup.type !== PICKUP_TYPE_BREEDER) continue;
      buf.length = 0;
      this.petGrid.queryRadius(pickup.x, pickup.y, R, buf);
      for (let i = 0; i < buf.length; i++) {
        const pet = buf[i];
        const d = dist(pet.x, pet.y, pickup.x, pickup.y);
        if (d > 0) {
          const dx = (pet.x - pickup.x) / d;
          const dy = (pet.y - pickup.y) / d;
          pet.x = pickup.x + dx * R;
          pet.y = pickup.y + dy * R;
        }
      }
    }
    for (const shelter of this.breederShelters.values()) {
      buf.length = 0;
      this.petGrid.queryRadius(shelter.x, shelter.y, R, buf);
      for (let i = 0; i < buf.length; i++) {
        const pet = buf[i];
        const d = dist(pet.x, pet.y, shelter.x, shelter.y);
        if (d > 0) {
          const dx = (pet.x - shelter.x) / d;
          const dy = (pet.y - shelter.y) / d;
          pet.x = shelter.x + dx * R;
          pet.y = shelter.y + dy * R;
        }
      }
    }
    
    // Adoption events: spawn up to 2 at a time
    if (now >= this.nextAdoptionEventSpawnTick && this.adoptionEvents.size < 2) {
      this.spawnAdoptionEvent(now);
      this.nextAdoptionEventSpawnTick = now + World.ADOPTION_EVENT_SPAWN_DELAY_MIN +
        Math.floor(Math.random() * (World.ADOPTION_EVENT_SPAWN_DELAY_MAX - World.ADOPTION_EVENT_SPAWN_DELAY_MIN));
    }
    const expiredEventIds: string[] = [];
    for (const [eid, ev] of this.adoptionEvents.entries()) {
      // Event ends when time runs out OR when goal is reached
      if (now >= ev.startTick + ev.durationTicks || ev.totalRescued >= ev.totalNeeded) {
        this.resolveAdoptionEvent(eid, ev);
        expiredEventIds.push(eid);
      }
    }
    for (const eid of expiredEventIds) this.adoptionEvents.delete(eid);

    // Regular stray spawn only during first 5 minutes; after that only breeders spawn strays
    if ((now - this.matchStartTick) < World.INITIAL_SPAWN_PERIOD_TICKS && now >= this.spawnPetAt) {
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
            petType: randomPetType(),
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
        // Regular pickup: 60% growth, 25% speed, 10% random port, 5% shelter port
        const roll = Math.random();
        const type = roll < 0.6 ? PICKUP_TYPE_GROWTH : 
                     roll < 0.85 ? PICKUP_TYPE_SPEED : 
                     roll < 0.95 ? PICKUP_TYPE_PORT : PICKUP_TYPE_SHELTER_PORT;
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
    
    // Check if victory conditions are met (don't spawn new waves if we've won)
    let currentStrayCount = 0;
    for (const pet of this.pets.values()) { if (pet.insideShelterId === null) currentStrayCount++; }
    const allBreedersClearedNow = this.breederShelters.size === 0 && this.breederCamps.size === 0;
    const victoryConditionsMet = this.shelters.size > 0 && currentStrayCount === 0 && allBreedersClearedNow;
    
    // Determine if it's time for a new wave
    const isFirstWave = this.lastBreederWaveTick === 0 && ticksSinceStart >= World.BREEDER_FIRST_WAVE_DELAY_TICKS;
    const isNextWave = this.lastBreederWaveTick > 0 && this.breederWaveSpawned && 
                       this.nextBreederWaveInterval > 0 && ticksSinceLastWave >= this.nextBreederWaveInterval;
    
    // Don't spawn new waves if victory conditions are met
    if ((isFirstWave || isNextWave) && !victoryConditionsMet) {
      // Advance level if this isn't the first wave (cap at MAX_BREEDER_LEVEL)
      if (isNextWave) {
        this.breederCurrentLevel = Math.min(this.breederCurrentLevel + 1, World.MAX_BREEDER_LEVEL);
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
          // Try multiple angles to find a valid position not inside a player shelter
          let newX = 0, newY = 0, validPosition = false;
          for (let attempt = 0; attempt < 8; attempt++) {
            const angle = Math.random() * Math.PI * 2;
            newX = clamp(camp.x + Math.cos(angle) * World.BREEDER_GROWTH_RADIUS, 50, MAP_WIDTH - 50);
            newY = clamp(camp.y + Math.sin(angle) * World.BREEDER_GROWTH_RADIUS, 50, MAP_HEIGHT - 50);
            
            // Check if position is inside a player shelter
            let insideShelter = false;
            for (const shelter of this.shelters.values()) {
              const playerShelterR = Math.min(shelterVisualRadius(shelter.size), 400) + 50; // Capped for gameplay
              const dx = newX - shelter.x;
              const dy = newY - shelter.y;
              if (dx * dx + dy * dy < playerShelterR * playerShelterR) {
                insideShelter = true;
                break;
              }
            }
            if (!insideShelter) {
              validPosition = true;
              break;
            }
          }
          
          // Only spawn if we found a valid position
          if (validPosition) {
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
            
            // Announce the growth
            this.pendingAnnouncements.push(`Level ${newLevel} breeders are expanding! More camps have appeared!`);
            log(`Breeder camp grew! Level ${newLevel} spawned at (${Math.round(newX)}, ${Math.round(newY)})`);
          }
          
          // Update original camp's spawn tick so it doesn't immediately grow again
          camp.spawnTick = this.tick;
          camp.level = newLevel;
          // Also update the pickup's level so client can render it
          const originalPickup = this.pickups.get(uid);
          if (originalPickup) {
            originalPickup.level = newLevel;
          }
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
      const spawnInterval = Math.round(World.BREEDER_SHELTER_SPAWN_INTERVAL / 1.7); // ~1.7x (15% fewer strays than 2x rate)
      if (this.tick - shelter.lastSpawnTick >= spawnInterval) {
        shelter.lastSpawnTick = this.tick;
        
        // Spawn 1-2 wild strays around the shelter
        const numStrays = 1 + (shelter.level >= 6 ? 1 : 0);
        for (let i = 0; i < numStrays; i++) {
          const angle = Math.random() * Math.PI * 2;
          const dist = World.BREEDER_STRAY_MIN_SPAWN_DIST + Math.random() * 300; // 200-500 units from mill
          const sx = clamp(shelter.x + Math.cos(angle) * dist, 50, MAP_WIDTH - 50);
          const sy = clamp(shelter.y + Math.sin(angle) * dist, 50, MAP_HEIGHT - 50);
          
          // Bias initial velocity AWAY from mill so strays naturally disperse
          const awayAngle = Math.atan2(sy - shelter.y, sx - shelter.x);
          const petId = `pet-${++this.petIdSeq}`;
          this.pets.set(petId, {
            id: petId,
            x: sx,
            y: sy,
            vx: Math.cos(awayAngle) * World.BREEDER_STRAY_SPEED,
            vy: Math.sin(awayAngle) * World.BREEDER_STRAY_SPEED,
            insideShelterId: null,
            petType: randomPetType(),
          });
          // Cap wandering strays at 300 — excess spawn as stationary (no client interp cost)
          if (this.wildStrayIds.size < 300) {
            this.wildStrayIds.add(petId);
          } else {
            // Spawn as stationary stray (no velocity)
            const pet = this.pets.get(petId);
            if (pet) { pet.vx = 0; pet.vy = 0; }
          }
        }
      }
    }
    
    // Van vs breeder shelter (mill): start mill mini-game when van overlaps mill (and mill not in combat)
    for (const [shelterId, breederShelter] of this.breederShelters.entries()) {
      if (this.millInCombat.has(shelterId)) continue;
      const bsr = 40 + breederShelter.size * 0.5;
      const basePetCount = 5 + Math.floor(breederShelter.level);
      const petCount = Math.min(basePetCount, 20);
      for (const p of this.players.values()) {
        if (this.eliminatedPlayerIds.has(p.id)) continue;
        if (this.pendingBreederMiniGames.has(p.id)) continue;
        if (this.cpuAtBreeder.has(p.id) || this.pendingCpuBreederCompletions.has(p.id)) continue;
        if (p.id.startsWith('cpu-')) continue; // CPUs don't start mill minigame from van (they use camps)
        // Skip if player is on retreat cooldown (just retreated from a camp/mill)
        const millRetreatEnd = this.retreatCooldownUntilTick.get(p.id) ?? 0;
        if (this.tick < millRetreatEnd) continue;
        const d2 = distSq(p.x, p.y, breederShelter.x, breederShelter.y);
        const combatR = VAN_FIXED_RADIUS + bsr;
        if (d2 > combatR * combatR) continue;
        this.millInCombat.add(shelterId);
        this.activeMillByPlayer.set(p.id, shelterId);
        this.pendingBreederMiniGames.set(p.id, {
          petCount,
          startTick: now,
          level: breederShelter.level,
          isMill: true,
          breederShelterId: shelterId,
        });
        // Don't announce start - only announce win/lose
        log(`Player ${p.displayName} started mill mini-game vs ${shelterId} (lv${breederShelter.level})`);
        break; // one van per mill
      }
    }
    
    // Shelter vs Breeder Shelter combat (skip mills currently in van minigame)
    const destroyedBreederShelters: string[] = [];
    for (const [breederShelterId, breederShelter] of this.breederShelters.entries()) {
      if (this.millInCombat.has(breederShelterId)) continue;
      for (const playerShelter of this.shelters.values()) {
        const bsr = 40 + breederShelter.size * 0.5; // Breeder shelter radius
        const psr = Math.min(shelterVisualRadius(playerShelter.size), 400); // Capped for gameplay
        
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
          // Celebrity Pet: bonus strays spawn outside adoption zone (random types, no special)
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
                petType: randomPetType(),
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
                petType: randomPetType(),
              });
            }
          }
        } else if (milestone === 300) {
          // Final push: spawn bonus strays and pickups everywhere
          for (let i = 0; i < 15; i++) {
            const pos = this.randomPosOutsideAdoptionZone();
            if (pos) {
              const pid = `pet-${++this.petIdSeq}`;
              this.pets.set(pid, { id: pid, x: pos.x, y: pos.y, vx: 0, vy: 0, insideShelterId: null, petType: randomPetType() });
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
      if (this.disconnectedPlayerIds.has(p.id)) inputFlags = 0;
      else if (p.id.startsWith('cpu-')) inputFlags = this.cpuAI(p);
      const grounded = this.isGrounded(p);
      const inBreeder = this.isPlayerInBreederState(p.id);
      if (grounded || inBreeder) {
        p.vx = 0;
        p.vy = 0;
      }
      if (!grounded && !inBreeder) {
        this.applyInput(p, inputFlags);
      }
      let nx = p.x + p.vx;
      let ny = p.y + p.vy;
      const radius = effectiveRadius(p);
      nx = clamp(nx, radius, MAP_WIDTH - radius);
      ny = clamp(ny, radius, MAP_HEIGHT - radius);
      
      // Vans pass through all player shelters — no van-shelter collision
      // Shelters interact via the combat system, not physical collision
      p.x = clamp(nx, radius, MAP_WIDTH - radius);
      p.y = clamp(ny, radius, MAP_HEIGHT - radius);
    }

    // Combat: overlapping shelters can fight after sustained overlap time
    const playerList = Array.from(this.players.values());
    let strayCountForCombat = 0;
    for (const pet of this.pets.values()) {
      if (pet.insideShelterId === null) strayCountForCombat++;
    }
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
        const ra = Math.min(shelterVisualRadius(shelterA.size), 400);
        const rb = Math.min(shelterVisualRadius(shelterB.size), 400);
        if (!aabbOverlap(shelterA.x, shelterA.y, ra, shelterB.x, shelterB.y, rb)) {
          this.combatOverlapTicks.delete(key);
          continue;
        }
        // Teams mode: teammates never fight (already allied); skip combat entirely for same team
        if (this.matchMode === 'teams') {
          const teamA = this.playerTeams.get(a.id);
          const teamB = this.playerTeams.get(b.id);
          if (teamA && teamB && teamA === teamB) {
            this.combatOverlapTicks.delete(key);
            continue;
          }
          // Opponents in Teams mode always fight - no ally popup, no ally negotiation
          if (teamA && teamB && teamA !== teamB) {
            // Skip ally logic entirely - go straight to combat
          }
        }
        // Check ally: only ally if BOTH chose 'ally' for each other (FFA/Solo only in practice)
        const aIsCpu = a.id.startsWith('cpu-');
        const bIsCpu = b.id.startsWith('cpu-');
        if (fightAllyChoices && this.matchMode !== 'teams') {
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
        // Check for mutual ally requests (clicked ally on each other before overlap) - not in Teams
        if (!aIsCpu && !bIsCpu && this.matchMode !== 'teams' && hasMutualAllyRequest(a.id, b.id)) {
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
        const variance = Math.min(COMBAT_MAX_VARIANCE, strayCountForCombat * COMBAT_STRAY_VARIANCE);
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
          // Clean up CPU state when eliminated
          const cpuTarget = this.cpuTargets.get(loser.id);
          if (cpuTarget?.breederClaimId) {
            this.breederClaimedBy.delete(cpuTarget.breederClaimId);
          }
          this.cpuTargets.delete(loser.id);
          this.cpuAtBreeder.delete(loser.id);
          this.pendingCpuBreederCompletions.delete(loser.id);
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
    
    // Shelters are protected - no van-vs-shelter combat (removed for cooperative gameplay)
    // Vans can push each other away from shelters but cannot attack
    
    // Stray count for loss and warnings
    let strayCountVictory = 0;
    for (const pet of this.pets.values()) { if (pet.insideShelterId === null) strayCountVictory++; }
    if (!this.matchEndedEarly) {
      if (strayCountVictory >= 400 && !this.strayWarnings.has(400)) {
        this.strayWarnings.add(400);
        this.pendingAnnouncements.push('Warning: 400 strays on the map! Rescue more pets!');
      }
      if (strayCountVictory >= 1000 && !this.strayWarnings.has(1000)) {
        this.strayWarnings.add(1000);
        this.pendingAnnouncements.push('Danger: 1,000 strays! The situation is getting critical!');
      }
      if (strayCountVictory >= 1700 && !this.strayWarnings.has(1700)) {
        this.strayWarnings.add(1700);
        this.pendingAnnouncements.push('URGENT: 1,700 strays! Hurry and rescue more - game over at 2,000!');
      }
    }
    // Loss check: >2000 strays = match over, no RT, no bonus
    if (!this.matchEndedEarly && strayCountVictory > 2000) {
      this.matchEndedEarly = true;
      this.matchEndAt = this.tick;
      this.winnerId = null;
      this.strayLoss = true;
      log(`Match end: too many strays (${strayCountVictory}) - loss for all, no RT`);
    }
    // Victory check: zero strays AND all breeders cleared (no camps, no mills)
    // Triggers boss mode in ALL match modes (solo, ffa, teams)
    if (!this.matchEndedEarly && this.shelters.size > 0 && !this.bossMode?.active) {
      const allBreedersCleared = this.breederShelters.size === 0 && this.breederCamps.size === 0;
      if (strayCountVictory === 0 && allBreedersCleared) {
        this.enterBossMode();
        log(`Boss Mode triggered in ${this.matchMode} match at tick ${this.tick}`);
      }
    }
    
    // Shelters with gravity upgrade pull strays toward them (spatial-grid accelerated)
    for (const shelter of this.shelters.values()) {
      if (!shelter.hasGravity) continue;
      const sr = shelterVisualRadius(shelter.size);
      const gravityRadius = Math.min(sr + 550, 900);
      const pullPerTick = 3;
      buf.length = 0;
      this.petGrid.queryRadius(shelter.x, shelter.y, gravityRadius, buf);
      for (let i = 0; i < buf.length; i++) {
        const pet = buf[i];
        const d = dist(shelter.x, shelter.y, pet.x, pet.y);
        if (d < 1) continue;
        const dx = (shelter.x - pet.x) / d;
        const dy = (shelter.y - pet.y) / d;
        pet.x += dx * pullPerTick;
        pet.y += dy * pullPerTick;
      }
    }
    
    // Shelter auto-collect: shelters with adoption center collect strays directly (spatial-grid accelerated)
    for (const shelter of this.shelters.values()) {
      if (!shelter.hasAdoptionCenter) continue;
      const owner = this.players.get(shelter.ownerId);
      const maxPets = owner ? shelterMaxPets(owner.size) : 25;
      if (shelter.petsInside.length >= maxPets) continue;
      
      const sr = shelterVisualRadius(shelter.size);
      const collectRadius = Math.min(sr + 30, 350); // Capped so large shelters don't vacuum the whole map
      
      buf.length = 0;
      this.petGrid.queryRadius(shelter.x, shelter.y, collectRadius, buf);
      for (let i = 0; i < buf.length; i++) {
        const pet = buf[i];
        if (pet.insideShelterId !== null) continue; // may have been collected by another shelter this tick
        if (shelter.petsInside.length >= maxPets) break;
        
        // Check owner can afford upkeep
        const ownerMoney = this.playerMoney.get(shelter.ownerId) ?? 0;
        if (ownerMoney < SHELTER_PET_UPKEEP) continue;
        
        // Collect the pet
        pet.insideShelterId = shelter.id;
        shelter.petsInside.push(pet.id);
        this.playerMoney.set(shelter.ownerId, ownerMoney - SHELTER_PET_UPKEEP);
      }
    }
    
    // Pet delivery: vans must physically reach shelter (or port there) to drop off pets
    for (const p of this.players.values()) {
      if (this.eliminatedPlayerIds.has(p.id)) continue;
      if (p.petsInside.length === 0) continue;
      
      // Check all shelters for delivery (own or ally's)
      for (const shelter of this.shelters.values()) {
        const isOwn = shelter.ownerId === p.id;
        const isAlly = this.isAlly(p.id, shelter.ownerId, this.lastAllyPairs);
        if (!isOwn && !isAlly) continue;
        
        // Van must be physically close to the shelter building to deliver (not the full territory radius)
        const deliveryDistance = Math.min(shelterVisualRadius(shelter.size), 300);
        if (distSq(p.x, p.y, shelter.x, shelter.y) > deliveryDistance * deliveryDistance) continue;
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

    // Resolve delayed CPU breeder completions (simulated puzzle finished)
    for (const [playerId, data] of Array.from(this.pendingCpuBreederCompletions.entries())) {
      if (now < data.completeAtTick) continue;
      this.pendingCpuBreederCompletions.delete(playerId);
      const cost = World.estimatedBreederRtCost(data.level, data.petCount);
      const currentRt = this.playerMoney.get(playerId) ?? 0;
      const rescuedCount = currentRt >= cost ? data.petCount : 0;
      if (rescuedCount > 0) {
        this.playerMoney.set(playerId, currentRt - cost);
      }
      this.completeBreederMiniGame(playerId, rescuedCount, data.petCount, data.level);
    }

    // Advance CPU-at-breeder: remove if out of range; if stayed min time, start delayed completion
    for (const [playerId, data] of Array.from(this.cpuAtBreeder.entries())) {
      const u = this.pickups.get(data.breederUid);
      const player = this.players.get(playerId);
      if (!u || !player || u.type !== PICKUP_TYPE_BREEDER) {
        this.cpuAtBreeder.delete(playerId);
        this.breederClaimedBy.delete(data.breederUid);
        continue;
      }
      const radius = effectiveRadius(player);
      const cpuBreederR = radius + GROWTH_ORB_RADIUS;
      if (distSq(player.x, player.y, u.x, u.y) > cpuBreederR * cpuBreederR) {
        this.cpuAtBreeder.delete(playerId);
        this.breederClaimedBy.delete(data.breederUid);
        continue;
      }
      const minStayTicks = World.getBreederMinStaySeconds(data.level) * TICK_RATE;
      if (now - data.arrivalTick < minStayTicks) continue;
      const camp = this.breederCamps.get(data.breederUid);
      const level = camp?.level ?? data.level;
      const basePets = 3 + Math.floor(Math.random() * 3);
      const levelBonus = Math.floor((level - 1) / 2);
      const petCount = Math.min(basePets + levelBonus, 15); // Cap 15 for high-level breeders
      
      // Check if CPU has enough RT to attempt - if not, they can't start
      const cost = World.estimatedBreederRtCost(level, petCount);
      const currentRt = this.playerMoney.get(playerId) ?? 0;
      if (currentRt < cost) {
        // CPU doesn't have enough RT - they leave the breeder camp alone
        this.cpuAtBreeder.delete(playerId);
        this.breederClaimedBy.delete(data.breederUid);
        // Add cooldown before CPU can target breeders again (30 seconds)
        this.cpuBreederCooldown.set(playerId, now + TICK_RATE * 30);
        // Clear the CPU's target so they find something else
        const cpuTarget = this.cpuTargets.get(playerId);
        if (cpuTarget?.breederClaimId) {
          this.cpuTargets.delete(playerId);
        }
        log(`CPU ${player.displayName} can't afford level ${level} breeder (need ${cost} RT, have ${currentRt}) - cooldown 30s`);
        continue;
      }
      
      // CPU has enough RT - proceed with the attempt
      this.pickups.delete(data.breederUid);
      this.breederCamps.delete(data.breederUid);
      this.breederClaimedBy.delete(data.breederUid);
      this.cpuAtBreeder.delete(playerId);
      this.pendingCpuBreederCompletions.set(playerId, {
        level,
        petCount,
        completeAtTick: now + World.CPU_BREEDER_COMPLETION_SECONDS * TICK_RATE,
      });
      // Don't announce start - only announce win/lose
      log(`CPU ${player.displayName} started level ${level} breeder (resolves in ${World.CPU_BREEDER_COMPLETION_SECONDS}s)`);
    }

    for (const p of this.players.values()) {
      if (this.eliminatedPlayerIds.has(p.id)) continue;
      const radius = effectiveRadius(p);
      for (const [uid, u] of Array.from(this.pickups.entries())) {
        const pickupR = radius + GROWTH_ORB_RADIUS;
        if (distSq(p.x, p.y, u.x, u.y) > pickupR * pickupR) continue;
        if (u.type === PICKUP_TYPE_BREEDER) {
          const isCpu = cpuIds?.has(p.id);
          if (isCpu) {
            // Skip if this CPU is already processing a breeder
            if (this.cpuAtBreeder.has(p.id) || this.pendingCpuBreederCompletions.has(p.id)) continue;
            const existingClaim = this.breederClaimedBy.get(uid);
            if (existingClaim !== undefined && existingClaim !== p.id) continue; // Another van already attacking
            
            // Skip if CPU is on breeder cooldown
            const cooldownEnd = this.cpuBreederCooldown.get(p.id) ?? 0;
            if (now < cooldownEnd) continue;
            
            // Skip if CPU doesn't have enough RT for this breeder level
            const camp = this.breederCamps.get(uid);
            const level = camp?.level ?? 1;
            const cpuRt = this.playerMoney.get(p.id) ?? 0;
            const minRt = World.minRtForBreederLevel(level);
            if (cpuRt < minRt) continue;
            
            // Check if any human player is already in a minigame for this specific breeder
            let breederAlreadyBeingAttacked = false;
            for (const [, miniGame] of this.pendingBreederMiniGames) {
              if (miniGame.breederUid === uid) {
                breederAlreadyBeingAttacked = true;
                break;
              }
            }
            if (breederAlreadyBeingAttacked) continue;
            
            this.breederClaimedBy.set(uid, p.id);
            this.cpuAtBreeder.set(p.id, { breederUid: uid, level, arrivalTick: now });
            continue;
          }
          // Human players: don't allow if already attempting a breeder
          if (this.pendingBreederMiniGames.has(p.id)) continue;
          // Skip if player is on retreat cooldown (just retreated from a camp/mill)
          const retreatEnd = this.retreatCooldownUntilTick.get(p.id) ?? 0;
          if (this.tick < retreatEnd) continue;
          
          // Check if another player (human or CPU) has claimed this breeder
          const existingClaim = this.breederClaimedBy.get(uid);
          if (existingClaim !== undefined && existingClaim !== p.id) continue;
          
          // Check if any player is already in a minigame for this specific breeder
          let breederAlreadyBeingAttacked = false;
          for (const [, miniGame] of this.pendingBreederMiniGames) {
            if (miniGame.breederUid === uid) {
              breederAlreadyBeingAttacked = true;
              break;
            }
          }
          if (breederAlreadyBeingAttacked) continue;
          
          // Set claim immediately to prevent race conditions
          this.breederClaimedBy.set(uid, p.id);
        }
        this.pickups.delete(uid);
        
        if (u.type === PICKUP_TYPE_BREEDER) {
          // Get camp data before removing from camps tracking
          const camp = this.breederCamps.get(uid);
          const level = camp?.level ?? 1;
          // Higher level = more pets to rescue
          const basePets = 3 + Math.floor(Math.random() * 3); // 3-5 base
          const levelBonus = Math.floor((level - 1) / 2); // +1 pet every 2 levels
          const petCount = Math.min(basePets + levelBonus, 15); // Cap 15 for high-level breeders
          
          // Store camp data for potential retreat/restoration
          const campData = camp ? { x: camp.x, y: camp.y, spawnTick: camp.spawnTick } : undefined;
          
          // Breeder mini-game - track for this player with level AND breeder UID
          this.pendingBreederMiniGames.set(p.id, {
            petCount,
            startTick: now,
            level,
            breederUid: uid,
            campData,
          });
          // Remove from breeder camps tracking (prevents growth)
          this.breederCamps.delete(uid);
          // Claim is kept until minigame completes
          // Don't announce start - only announce win/lose
          log(`Player ${p.displayName} triggered level ${level} breeder mini-game (breeder ${uid})`);
        } else {
          p.speedBoostUntil = 0; // end speed boost when picking up any boost
          if (u.type === PICKUP_TYPE_GROWTH) {
            p.size += GROWTH_ORB_VALUE;
          } else if (u.type === PICKUP_TYPE_SPEED) {
            p.speedBoostUntil = now + SPEED_BOOST_DURATION_TICKS;
          } else if (u.type === PICKUP_TYPE_PORT) {
            const current = this.portCharges.get(p.id) ?? 0;
            this.portCharges.set(p.id, current + 1);
          } else if (u.type === PICKUP_TYPE_SHELTER_PORT) {
            const current = this.shelterPortCharges.get(p.id) ?? 0;
            this.shelterPortCharges.set(p.id, current + 1);
          }
        }
      }
    }

    // Van rescue: pick up nearby strays (spatial-grid accelerated)
    for (const p of this.players.values()) {
      if (this.eliminatedPlayerIds.has(p.id)) continue;
      // Vans (not grounded) are capped at VAN_MAX_CAPACITY; shelters use full size capacity
      const isGrounded = this.groundedPlayerIds.has(p.id);
      const capacity = isGrounded ? Math.floor(p.size) : Math.min(Math.floor(p.size), VAN_MAX_CAPACITY);
      if (p.petsInside.length >= capacity) continue;
      const sr = effectiveRadius(p);
      const rescueRadius = Math.max(RESCUE_RADIUS, sr + PET_RADIUS);
      buf.length = 0;
      this.petGrid.queryRadius(p.x, p.y, rescueRadius, buf);
      // Sort candidates by distance (nearest first) so rescue order matches old behaviour
      const px = p.x, py = p.y;
      if (buf.length > 1) {
        buf.sort((a, b) => {
          const da = (a.x - px) * (a.x - px) + (a.y - py) * (a.y - py);
          const db = (b.x - px) * (b.x - px) + (b.y - py) * (b.y - py);
          return da - db;
        });
      }
      let pickedAny = false;
      for (let i = 0; i < buf.length && p.petsInside.length < capacity; i++) {
        const pet = buf[i];
        if (pet.insideShelterId !== null) continue; // may have been collected by another van/shelter this tick
        pet.insideShelterId = p.id;
        p.petsInside.push(pet.id);
        pickedAny = true;
      }
      if (pickedAny) p.speedBoostUntil = 0; // end speed boost when picking up strays
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
        this.recordEventContribution(p.id, pet.petType, zoneX, zoneY);
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
      // Teams mode: add score to player's team
      if (this.matchMode === 'teams') {
        const team = this.playerTeams.get(p.id);
        if (team) this.teamScores.set(team, (this.teamScores.get(team) ?? 0) + 1);
      }
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
        this.recordEventContribution(playerId, pet.petType, shelter.x, shelter.y);
        pet.insideShelterId = null;
        pet.x = shelter.x;
        pet.y = shelter.y;
      }
      this.pets.delete(pid);
      shelter.totalAdoptions++;
      shelter.size += GROWTH_PER_ADOPTION;
      shelter.tier = calculateShelterTier(shelter.size); // Update tier
      
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
      // Teams mode: add score to player's team
      if (this.matchMode === 'teams') {
        const team = this.playerTeams.get(playerId);
        if (team) this.teamScores.set(team, (this.teamScores.get(team) ?? 0) + 1);
      }
      
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

    // Instant adoption at adoption events: van in event radius = drop all van pets for instant adoption
    for (const ev of this.adoptionEvents.values()) {
      if (now >= ev.startTick + ev.durationTicks) continue;
      for (const p of this.players.values()) {
        if (this.eliminatedPlayerIds.has(p.id)) continue;
        if (p.petsInside.length === 0) continue;
        if (distSq(p.x, p.y, ev.x, ev.y) > ev.radius * ev.radius) continue;
        while (p.petsInside.length > 0) {
          const pid = p.petsInside.pop()!;
          const pet = this.pets.get(pid);
          if (pet) {
            this.recordEventContribution(p.id, pet.petType, ev.x, ev.y);
            this.pets.delete(pid);
          }
          p.totalAdoptions++;
          p.size += GROWTH_PER_ADOPTION;
          const currentMoney = this.playerMoney.get(p.id) ?? 0;
          this.playerMoney.set(p.id, currentMoney + TOKENS_PER_ADOPTION);
          this.totalMatchAdoptions++;
          this.lastGlobalAdoptionTick = now;
          this.scarcityLevel = 0;
          // Teams mode: add score to player's team
          if (this.matchMode === 'teams') {
            const pTeam = this.playerTeams.get(p.id);
            if (pTeam) this.teamScores.set(pTeam, (this.teamScores.get(pTeam) ?? 0) + 1);
          }
        }
        // Removed announcement - too spammy
        break; // One van per event per tick
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

    // Periodic cleanup of expired cooldowns (once per minute to prevent memory growth)
    if (now % 1500 === 0) {
      for (const [cpuId, cooldownEnd] of Array.from(this.cpuBreederCooldown.entries())) {
        if (now >= cooldownEnd) {
          this.cpuBreederCooldown.delete(cpuId);
        }
      }
      for (const [pid, cooldownEnd] of Array.from(this.retreatCooldownUntilTick.entries())) {
        if (now >= cooldownEnd) {
          this.retreatCooldownUntilTick.delete(pid);
        }
      }
    }
  }

  isStrayLoss(): boolean {
    return this.strayLoss;
  }

  /** True outdoor stray count (before snapshot cap). */
  private outdoorStrayCount = 0;
  /** Max strays included in a single snapshot (caps decode + network cost). */
  private static readonly SNAPSHOT_STRAY_CAP = 500;

  /** Build reusable array of outdoor strays only (pets not inside any shelter).
   *  Capped at SNAPSHOT_STRAY_CAP to keep snapshots small; prioritises strays near players. */
  private getSnapshotStrays(): PetState[] {
    this.snapshotStrays.length = 0;
    for (const pet of this.pets.values()) {
      if (pet.insideShelterId === null) {
        this.snapshotStrays.push(pet);
      }
    }
    this.outdoorStrayCount = this.snapshotStrays.length;

    // If within cap, send everything
    if (this.snapshotStrays.length <= World.SNAPSHOT_STRAY_CAP) {
      return this.snapshotStrays;
    }

    // Too many strays — keep only those nearest to any player van.
    // Score each stray by squared distance to its closest player.
    const players = Array.from(this.players.values()).filter(
      p => !this.eliminatedPlayerIds.has(p.id)
    );
    if (players.length === 0) {
      // No active players — just truncate
      this.snapshotStrays.length = World.SNAPSHOT_STRAY_CAP;
      return this.snapshotStrays;
    }

    // Compute min-squared-distance to any player for each stray
    const len = this.snapshotStrays.length;
    // Reuse a typed array to avoid allocations (grown once, persisted on class)
    if (!this._strayScores || this._strayScores.length < len) {
      this._strayScores = new Float64Array(len);
    }
    const scores = this._strayScores;
    for (let i = 0; i < len; i++) {
      const s = this.snapshotStrays[i];
      let minD2 = Infinity;
      for (let j = 0; j < players.length; j++) {
        const dx = s.x - players[j].x;
        const dy = s.y - players[j].y;
        const d2 = dx * dx + dy * dy;
        if (d2 < minD2) minD2 = d2;
      }
      scores[i] = minD2;
    }

    // Partial sort: keep the SNAPSHOT_STRAY_CAP closest strays
    // Use selection-style partitioning via index sorting
    const indices = this._strayIndices && this._strayIndices.length >= len
      ? this._strayIndices
      : (this._strayIndices = new Uint32Array(len));
    for (let i = 0; i < len; i++) indices[i] = i;
    // Sort indices by score ascending (closest first)
    const idxSlice = Array.from(indices.subarray(0, len));
    idxSlice.sort((a, b) => scores[a] - scores[b]);
    // Build capped array
    const cap = World.SNAPSHOT_STRAY_CAP;
    const capped: PetState[] = new Array(cap);
    for (let i = 0; i < cap; i++) {
      capped[i] = this.snapshotStrays[idxSlice[i]];
    }
    // Overwrite the reusable array
    this.snapshotStrays.length = 0;
    for (let i = 0; i < cap; i++) this.snapshotStrays.push(capped[i]);
    return this.snapshotStrays;
  }
  private _strayScores: Float64Array | null = null;
  private _strayIndices: Uint32Array | null = null;

  getSnapshot(): GameSnapshot {
    return {
      tick: this.tick,
      matchEndAt: this.matchEndAt,
      matchEndedEarly: this.matchEndedEarly || undefined,
      winnerId: this.winnerId || undefined,
      strayLoss: this.strayLoss || undefined,
      totalMatchAdoptions: this.totalMatchAdoptions,
      scarcityLevel: this.scarcityLevel > 0 ? this.scarcityLevel : undefined,
      matchDurationMs: this.getMatchDurationMs(),
      totalOutdoorStrays: this.outdoorStrayCount,
      players: Array.from(this.players.values()).map((p) => {
        const eliminated = this.eliminatedPlayerIds.has(p.id);
        const hasShelter = this.hasShelter(p.id);
        const portCount = this.portCharges.get(p.id) ?? 0;
        const shelterPortCount = this.shelterPortCharges.get(p.id) ?? 0;
        const color = this.playerColors.get(p.id);
        const allies: string[] = [];
        for (const other of this.players.values()) {
          if (other.id !== p.id && this.isAlly(p.id, other.id, this.lastAllyPairs)) allies.push(other.id);
        }
        const money = this.playerMoney.get(p.id) ?? 0;
        const shelterId = this.playerShelterIds.get(p.id);
        const hasVanSpeed = this.vanSpeedUpgrades.has(p.id);
        const disconnected = this.disconnectedPlayerIds.has(p.id);
        const team = this.playerTeams.get(p.id);
        return {
          ...p,
          size: eliminated ? 0 : p.size,
          petsInside: eliminated ? [] : [...p.petsInside],
          allies: allies.length ? allies : undefined,
          eliminated: eliminated || undefined,
          grounded: hasShelter || undefined, // Legacy: grounded means has shelter
          disconnected: disconnected || undefined,
          portCharges: portCount > 0 ? portCount : undefined,
          shelterPortCharges: shelterPortCount > 0 ? shelterPortCount : undefined,
          shelterColor: color || undefined,
          money: money > 0 ? money : undefined,
          shelterId: shelterId || undefined,
          vanSpeedUpgrade: hasVanSpeed || undefined,
          team: team || undefined,
        };
      }),
      pets: this.getSnapshotStrays(),
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
      adoptionEvents: this.adoptionEvents.size > 0 ? Array.from(this.adoptionEvents.values()) : undefined,
      bossMode: this.getBossModeState(),
      teamScores: this.matchMode === 'teams' ? this.getTeamScores() : undefined,
      winningTeam: this.winningTeam || undefined,
    };
  }

  isMatchOver(): boolean {
    return this.tick >= this.matchEndAt;
  }

  isMatchStarted(): boolean {
    return this.matchStarted;
  }

  /** Record that the match is being paused (frozen). Call before serializing. */
  recordPause(): void {
    if (this.frozenAtMs === null) {
      this.frozenAtMs = Date.now();
    }
  }

  /** Record that the match is being resumed. Call when unfreezing. */
  recordResume(): void {
    if (this.frozenAtMs !== null) {
      this.pausedDurationMs += Date.now() - this.frozenAtMs;
      this.frozenAtMs = null;
    }
  }
  
  /** Get accurate match duration in milliseconds, accounting for paused state. */
  getMatchDurationMs(): number {
    if (!this.matchStarted) return 0;
    // If paused, use frozenAtMs as the reference point
    if (this.frozenAtMs !== null) {
      return this.frozenAtMs - this.matchStartTime - this.pausedDurationMs;
    }
    // If running, use current time
    return Date.now() - this.matchStartTime - this.pausedDurationMs;
  }
  
  /** Deduct tokens from a player (for breeder mini-game food purchases) */
  deductTokens(playerId: string, amount: number): boolean {
    const current = this.playerMoney.get(playerId) ?? 0;
    if (current < amount) return false;
    this.playerMoney.set(playerId, current - amount);
    return true;
  }
  
  /** Check if a player has a pending breeder mini-game */
  getPendingBreederMiniGame(playerId: string): { petCount: number; startTick: number; level: number; isMill?: boolean; breederShelterId?: string; startSent?: boolean } | null {
    return this.pendingBreederMiniGames.get(playerId) ?? null;
  }
  
  /** Mark breederStart as sent (prevents resending, but keeps entry for retreat/complete) */
  markBreederStartSent(playerId: string): void {
    const pending = this.pendingBreederMiniGames.get(playerId);
    if (pending) {
      pending.startSent = true;
    }
  }

  /** Mill time limit in seconds: 60 + level*2. */
  getBreederMillTimeLimitSeconds(level: number): number {
    return World.getBreederMillTimeLimitSeconds(level);
  }
  
  /** Clear a player's pending breeder mini-game (after they acknowledge it) */
  clearPendingBreederMiniGame(playerId: string): void {
    // Clear breeder claim before deleting the minigame entry
    const miniGame = this.pendingBreederMiniGames.get(playerId);
    if (miniGame?.breederUid) {
      this.breederClaimedBy.delete(miniGame.breederUid);
    }
    this.pendingBreederMiniGames.delete(playerId);
  }
  
  /** Handle player retreating from a breeder camp - restores the camp so it can be attacked again */
  retreatFromBreederCamp(playerId: string): void {
    const miniGame = this.pendingBreederMiniGames.get(playerId);
    if (!miniGame) return;
    
    // Only restore camps (not mills) - mills are persistent shelters
    if (!miniGame.isMill && miniGame.breederUid && miniGame.campData) {
      const uid = miniGame.breederUid;
      const { x, y, spawnTick } = miniGame.campData;
      const level = miniGame.level;
      
      // Restore the breeder camp
      this.breederCamps.set(uid, { x, y, spawnTick, level });
      
      // Restore the pickup (PickupState doesn't have spawnTick, it uses level)
      this.pickups.set(uid, { id: uid, x, y, type: PICKUP_TYPE_BREEDER, level });
      
      // Move van away from camp to prevent immediate re-trigger
      const player = this.players.get(playerId);
      if (player) {
        const dx = player.x - x;
        const dy = player.y - y;
        const dist = Math.hypot(dx, dy);
        const pushDistance = 80; // Push van 80 units away from camp
        if (dist > 0) {
          player.x += (dx / dist) * pushDistance;
          player.y += (dy / dist) * pushDistance;
        } else {
          // Van exactly on camp, push in random direction
          player.x += pushDistance;
        }
        // Clamp to world bounds
        player.x = clamp(player.x, 0, MAP_WIDTH);
        player.y = clamp(player.y, 0, MAP_HEIGHT);
      }
      
      log(`Player ${playerId} retreated from breeder camp ${uid} - camp restored, van pushed away`);
    } else if (miniGame.isMill) {
      // For mills, just push the van away without restoring (mill is permanent)
      const player = this.players.get(playerId);
      const millShelterId = miniGame.breederShelterId;
      const mill = millShelterId ? this.breederShelters.get(millShelterId) : null;
      if (player && mill) {
        const dx = player.x - mill.x;
        const dy = player.y - mill.y;
        const dist = Math.hypot(dx, dy);
        const pushDistance = 100; // Push van 100 units away from mill
        if (dist > 0) {
          player.x += (dx / dist) * pushDistance;
          player.y += (dy / dist) * pushDistance;
        } else {
          player.x += pushDistance;
        }
        player.x = clamp(player.x, 0, MAP_WIDTH);
        player.y = clamp(player.y, 0, MAP_HEIGHT);
        log(`Player ${playerId} retreated from mill ${millShelterId} - van pushed away`);
      }
      // Clear mill combat state so the mill can be re-engaged
      if (millShelterId) {
        this.millInCombat.delete(millShelterId);
      }
      this.activeMillByPlayer.delete(playerId);
    }
    
    // Clear the claim and pending minigame
    if (miniGame.breederUid) {
      this.breederClaimedBy.delete(miniGame.breederUid);
    }
    this.pendingBreederMiniGames.delete(playerId);
    
    // Set 2-second cooldown so the van can't immediately re-engage a camp/mill
    this.retreatCooldownUntilTick.set(playerId, this.tick + TICK_RATE * 2);
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
    rewards: Array<{ type: 'size' | 'speed' | 'port' | 'shelterPort' | 'penalty' | 'adoptSpeed'; amount: number }> 
  } {
    // Clear breeder claim before deleting the minigame entry
    const miniGame = this.pendingBreederMiniGames.get(playerId);
    if (miniGame?.breederUid) {
      this.breederClaimedBy.delete(miniGame.breederUid);
    }
    this.pendingBreederMiniGames.delete(playerId);
    const millShelterId = this.activeMillByPlayer.get(playerId);
    const isMill = !!millShelterId;
    if (isMill) this.activeMillByPlayer.delete(playerId);
    const player = this.players.get(playerId);
    if (!player) return { tokenBonus: 0, rewards: [] };

    const unrescuedCount = totalPets - rescuedCount;
    const rewards: Array<{ type: 'size' | 'speed' | 'port' | 'shelterPort' | 'penalty' | 'adoptSpeed'; amount: number }> = [];
    
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
    
    const successRate = rescuedCount / totalPets;
    const isFullWin = successRate >= 1;
    // 51% ≤ rate < 100%: smaller boost (half level scaling); 100%: full level-scaled rewards
    const levelBonus = (level - 1) * 15;
    const fullTokens = 30 + levelBonus + 50; // 100% = 80 + levelBonus
    const smallTokens = 30 + Math.floor(levelBonus * 0.5) + Math.floor(successRate * 25); // smaller tier
    const tokenBonus = isFullWin ? fullTokens : Math.max(15, smallTokens);
    
    const currentTokens = this.playerMoney.get(playerId) ?? 0;
    this.playerMoney.set(playerId, currentTokens + tokenBonus);
    
    // Teams mode: breeder takedown adds rescued count to team score
    if (this.matchMode === 'teams') {
      const team = this.playerTeams.get(playerId);
      if (team) this.teamScores.set(team, (this.teamScores.get(team) ?? 0) + rescuedCount);
    }
    
    // Item rewards: full win = level-based count; 51% tier = 1 item
    const numItems = isFullWin ? (level >= 7 ? 3 : 2) : 1;
    const sizeAmount = 5 + Math.floor(level / 2);
    for (let i = 0; i < numItems; i++) {
      const roll = Math.random();
      // Level 7+: include home port as a possible reward
      // Reward distribution for level 7+: 30% size, 25% speed, 25% port, 20% home port
      // Reward distribution for level 1-6: 40% size, 30% speed, 30% port
      if (level >= 7) {
        if (roll < 0.30) {
          player.size += sizeAmount;
          rewards.push({ type: 'size', amount: sizeAmount });
        } else if (roll < 0.55) {
          player.speedBoostUntil = this.tick + SPEED_BOOST_DURATION_TICKS * 2;
          rewards.push({ type: 'speed', amount: 1 });
        } else if (roll < 0.80) {
          const current = this.portCharges.get(playerId) ?? 0;
          this.portCharges.set(playerId, current + 1);
          rewards.push({ type: 'port', amount: 1 });
        } else {
          // Home port reward (20% chance for level 7+)
          const current = this.shelterPortCharges.get(playerId) ?? 0;
          this.shelterPortCharges.set(playerId, current + 1);
          rewards.push({ type: 'shelterPort', amount: 1 });
        }
      } else {
        if (roll < 0.4) {
          player.size += sizeAmount;
          rewards.push({ type: 'size', amount: sizeAmount });
        } else if (roll < 0.7) {
          player.speedBoostUntil = this.tick + SPEED_BOOST_DURATION_TICKS * 2;
          rewards.push({ type: 'speed', amount: 1 });
        } else {
          const current = this.portCharges.get(playerId) ?? 0;
          this.portCharges.set(playerId, current + 1);
          rewards.push({ type: 'port', amount: 1 });
        }
      }
    }
    
    // Mill: clear "in combat" so mill can be attacked again; only remove shelter on 100% rescue
    if (isMill && millShelterId) {
      this.millInCombat.delete(millShelterId);
      if (rescuedCount === totalPets) {
        this.breederShelters.delete(millShelterId);
        // Only announce when a mill is fully shut down
        this.pendingAnnouncements.push(`${player.displayName} shut down a Level ${level} breeder mill!`);
        log(`Mill ${millShelterId} shut down by ${player.displayName}`);
      }
      // No announcements for partial rescue or failure on mills
    }
    
    // Award adopt speed boost for level 15+ on 100% rescue (camps or mills)
    if (level >= 15 && rescuedCount === totalPets) {
      const currentBoosts = this.playerAdoptSpeedBoosts.get(playerId) ?? 0;
      this.playerAdoptSpeedBoosts.set(playerId, currentBoosts + 1);
      rewards.push({ type: 'adoptSpeed', amount: 1 });
      log(`Player ${player.displayName} earned adopt speed boost from lv${level} breeder shutdown!`);
    }
    
    // No announcements for breeder camps (too spammy)
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

  /** Set a player's port charges */
  setPortCharges(playerId: string, count: number): void {
    this.portCharges.set(playerId, count);
  }
  
  /** Get a player's current shelter port charges */
  getShelterPortCharges(playerId: string): number {
    return this.shelterPortCharges.get(playerId) ?? 0;
  }

  /** Set a player's shelter port charges */
  setShelterPortCharges(playerId: string, count: number): void {
    this.shelterPortCharges.set(playerId, count);
  }

  /** Set a player's tier-3 shelter boosts */
  setShelterTier3Boosts(playerId: string, count: number): void {
    this.shelterTier3Boosts.set(playerId, count);
  }
  
  /** Get a player's current money/RT */
  getPlayerMoney(playerId: string): number {
    return this.playerMoney.get(playerId) ?? 0;
  }

  /** Deduct money/RT from a player */
  deductPlayerMoney(playerId: string, amount: number): void {
    const current = this.playerMoney.get(playerId) ?? 0;
    this.playerMoney.set(playerId, Math.max(0, current - amount));
  }

  /** Add money to a player's balance */
  addPlayerMoney(playerId: string, amount: number): void {
    const current = this.playerMoney.get(playerId) ?? 0;
    this.playerMoney.set(playerId, current + amount);
  }

  /** Get a player's shelter info (public wrapper for private getPlayerShelter) */
  getPlayerShelterInfo(playerId: string): { id: string; tier: number; size: number } | undefined {
    const shelter = this.getPlayerShelter(playerId);
    if (!shelter) return undefined;
    return { id: shelter.id, tier: shelter.tier, size: shelter.size };
  }

  // ============================================
  // BOSS MODE METHODS
  // ============================================

  /** Easter egg: Force enter boss mode */
  debugEnterBossMode(): boolean {
    if (this.bossMode?.active) return false;
    this.enterBossMode();
    return true;
  }

  /** Enter boss mode - called when solo player clears all strays and breeders */
  private enterBossMode(): void {
    if (this.bossMode?.active) return; // Already in boss mode

    // Find map center for PetMall
    const mallX = MAP_WIDTH / 2;
    const mallY = MAP_HEIGHT / 2;

    // Create 5 mills arranged in a pentagon around the center
    const mills: typeof this.bossMode extends null ? never : NonNullable<typeof this.bossMode>['mills'] = [];
    const millTypes = [BOSS_MILL_HORSE, BOSS_MILL_CAT, BOSS_MILL_DOG, BOSS_MILL_BIRD, BOSS_MILL_RABBIT];
    
    for (let i = 0; i < 5; i++) {
      const angle = (i / 5) * Math.PI * 2 - Math.PI / 2; // Start from top
      const x = mallX + Math.cos(angle) * BOSS_PETMALL_RADIUS;
      const y = mallY + Math.sin(angle) * BOSS_PETMALL_RADIUS;
      const petType = millTypes[i];
      const petCount = BOSS_MILL_PET_COUNTS[petType] ?? 5;
      const recipePerPet = BOSS_MILL_RECIPES[petType] ?? {};
      
      // Calculate total recipe (per pet * pet count)
      const recipe: { [ingredient: string]: number } = {};
      for (const [ing, amount] of Object.entries(recipePerPet)) {
        recipe[ing] = amount * petCount;
      }

      mills.push({
        id: i,
        petType,
        petCount,
        recipe,
        purchased: {},
        completed: false,
        x,
        y,
      });
    }

    // Initialize boss mode state - tycoon starts at PetMall center, picks random first target
    const firstTarget = Math.floor(Math.random() * 5);
    this.bossMode = {
      active: true,
      startTick: this.tick,
      timeLimit: BOSS_MODE_TIME_LIMIT_TICKS,
      mills,
      tycoonX: mallX,
      tycoonY: mallY,
      tycoonTargetMill: firstTarget,
      tycoonMoveAtTick: this.tick + BOSS_TYCOON_DWELL_TICKS,
      millsCleared: 0,
      mallX,
      mallY,
      playerAtMill: -1,
      lastMillClearTick: 0,
      rebuildingMill: -1,
      rebuildStartTick: 0,
      visitedMills: [],
    };

    this.pendingAnnouncements.push('BOSS MODE: The Breeder Tycoon has arrived with the PetMall! Prepare meals to rescue the pets!');
    log(`Boss Mode started at tick ${this.tick}. PetMall at (${mallX}, ${mallY})`);
  }

  /** Update boss mode each tick */
  private updateBossMode(): void {
    if (!this.bossMode?.active) return;

    const bm = this.bossMode;
    const elapsed = this.tick - bm.startTick;

    // Check for timeout
    if (elapsed >= bm.timeLimit) {
      this.endBossMode(false);
      return;
    }

    // Check for full clear
    if (bm.millsCleared >= 5) {
      this.endBossMode(true);
      return;
    }

    // Auto-detect player entering/exiting boss mills (proximity-based, like breeder camps)
    this.updateBossMillProximity();

    // Update tycoon patrol
    this.updateTycoonPatrol();
  }

  /** Check if player van is near a boss mill and update playerAtMill accordingly */
  private updateBossMillProximity(): void {
    if (!this.bossMode?.active) return;
    const bm = this.bossMode;

    // Find ANY human player (non-CPU) near a boss mill
    let nearMillId = -1;
    let nearPlayer: { id: string; x: number; y: number } | null = null;
    for (const p of this.players.values()) {
      if (p.id.startsWith('cpu-') || this.eliminatedPlayerIds.has(p.id)) continue;
      for (let i = 0; i < bm.mills.length; i++) {
        const mill = bm.mills[i];
        if (mill.completed) continue;
        const bossMillR = BOSS_MILL_RADIUS + VAN_FIXED_RADIUS;
        if (distSq(p.x, p.y, mill.x, mill.y) <= bossMillR * bossMillR) {
          nearMillId = i;
          nearPlayer = p;
          break;
        }
      }
      if (nearMillId >= 0) break;
    }

    // Update playerAtMill state
    if (nearMillId >= 0 && bm.playerAtMill !== nearMillId) {
      // Player entered a new mill
      bm.playerAtMill = nearMillId;
      log(`Player ${nearPlayer!.id} entered boss mill ${nearMillId} (${BOSS_MILL_NAMES[bm.mills[nearMillId].petType]})`);
    } else if (nearMillId < 0 && bm.playerAtMill >= 0) {
      // Player left the mill
      log(`Player exited boss mill`);
      bm.playerAtMill = -1;
    }
  }

  /** Pick a random mill index different from the current target, avoiding recent visits */
  private pickRandomMill(currentMill: number): number {
    if (!this.bossMode) return 0;
    const bm = this.bossMode;
    
    // Build candidates: all mills except current
    const candidates = [0, 1, 2, 3, 4].filter(i => i !== currentMill);
    
    // Prefer mills not recently visited (avoid immediate back-and-forth)
    const notRecent = candidates.filter(i => !bm.visitedMills.includes(i));
    const pool = notRecent.length > 0 ? notRecent : candidates;
    
    const chosen = pool[Math.floor(Math.random() * pool.length)];
    
    // Track visit history (keep last 2)
    bm.visitedMills.push(chosen);
    if (bm.visitedMills.length > 2) bm.visitedMills.shift();
    
    return chosen;
  }

  /** Update the Breeder Tycoon patrol behavior */
  private updateTycoonPatrol(): void {
    if (!this.bossMode) return;
    const bm = this.bossMode;

    // Handle active rebuild: tycoon stays at mill and rebuilds it
    if (bm.rebuildingMill >= 0) {
      const rebuildElapsed = this.tick - bm.rebuildStartTick;
      if (rebuildElapsed >= BOSS_TYCOON_REBUILD_TICKS) {
        // Rebuild complete - restore the mill
        const mill = bm.mills[bm.rebuildingMill];
        if (mill && mill.completed) {
          mill.completed = false;
          mill.purchased = {}; // Reset ingredients
          bm.millsCleared = Math.max(0, bm.millsCleared - 1);
          this.pendingAnnouncements.push(`The Breeder Tycoon rebuilt ${BOSS_MILL_NAMES[mill.petType] ?? 'a mill'}!`);
          log(`Tycoon rebuilt mill ${bm.rebuildingMill} (${BOSS_MILL_NAMES[mill.petType]}). Mills cleared: ${bm.millsCleared}`);
        }
        bm.rebuildingMill = -1;
        // Pick next random target and leave
        bm.tycoonTargetMill = this.pickRandomMill(bm.tycoonTargetMill);
        bm.tycoonMoveAtTick = this.tick + BOSS_TYCOON_DWELL_TICKS;
      }
      // While rebuilding, still check if player arrives (caught!)
      if (bm.playerAtMill === bm.tycoonTargetMill) {
        this.handleTycoonCatchPlayer();
      }
      return; // Don't move while rebuilding
    }

    // Check if tycoon should move to next mill (dwell expired)
    if (this.tick >= bm.tycoonMoveAtTick) {
      // Pick a random mill (different from current)
      bm.tycoonTargetMill = this.pickRandomMill(bm.tycoonTargetMill);
      bm.tycoonMoveAtTick = this.tick + BOSS_TYCOON_DWELL_TICKS;
    }

    // Move tycoon toward target mill
    const targetMill = bm.mills[bm.tycoonTargetMill];
    if (targetMill) {
      const dx = targetMill.x - bm.tycoonX;
      const dy = targetMill.y - bm.tycoonY;
      const d = Math.hypot(dx, dy);
      
      if (d > BOSS_TYCOON_SPEED) {
        // Move toward target
        bm.tycoonX += (dx / d) * BOSS_TYCOON_SPEED;
        bm.tycoonY += (dy / d) * BOSS_TYCOON_SPEED;
      } else {
        // Arrived at mill
        bm.tycoonX = targetMill.x;
        bm.tycoonY = targetMill.y;
        
        // Check if player is at this mill (caught!)
        if (bm.playerAtMill === bm.tycoonTargetMill) {
          this.handleTycoonCatchPlayer();
        }
        
        // If this mill was cleared, start rebuilding it
        if (targetMill.completed && bm.rebuildingMill < 0) {
          bm.rebuildingMill = bm.tycoonTargetMill;
          bm.rebuildStartTick = this.tick;
          log(`Tycoon starting rebuild of mill ${bm.tycoonTargetMill} (${BOSS_MILL_NAMES[targetMill.petType]})`);
        }
      }
    }
  }

  /** Handle player being caught by tycoon at a mill */
  private handleTycoonCatchPlayer(): void {
    if (!this.bossMode) return;
    const bm = this.bossMode;
    const mill = bm.mills[bm.playerAtMill];
    if (!mill) return;

    // Lose 50% of purchased ingredients
    for (const ing of Object.keys(mill.purchased)) {
      mill.purchased[ing] = Math.floor(mill.purchased[ing] * (1 - BOSS_CAUGHT_PENALTY));
      if (mill.purchased[ing] <= 0) {
        delete mill.purchased[ing];
      }
    }

    // Force player out of mill
    bm.playerAtMill = -1;
    
    this.pendingAnnouncements.push('Caught by the Breeder Tycoon! You lost half your prepared ingredients!');
    log(`Player caught by tycoon at mill ${mill.id}, lost ${BOSS_CAUGHT_PENALTY * 100}% ingredients`);
  }

  /** End boss mode with victory or timeout */
  private endBossMode(victory: boolean): void {
    if (!this.bossMode) return;
    
    const bm = this.bossMode;
    bm.active = false;
    
    // Calculate rewards
    let rtBonus = 0;
    if (bm.millsCleared >= 5) {
      rtBonus = BOSS_MODE_REWARDS.fullClearRT;
    } else if (bm.millsCleared >= 3) {
      rtBonus = bm.millsCleared * BOSS_MODE_REWARDS.partialClearRT;
    } else if (bm.millsCleared >= 1) {
      rtBonus = bm.millsCleared * BOSS_MODE_REWARDS.minimalClearRT;
    }

    if (bm.millsCleared > 0) {
      // Partial or full victory: award RT to ALL human players, end match as win
      for (const p of this.players.values()) {
        if (!p.id.startsWith('cpu-') && !p.id.startsWith('cpu_')) {
          this.addPlayerMoney(p.id, rtBonus);
        }
      }

      this.matchEndedEarly = true;
      this.matchEndAt = this.tick;
      
      // Determine winner: player with most adoptions (works for solo, ffa, teams)
      if (this.matchMode === 'teams') {
        const redScore = this.teamScores.get('red') ?? 0;
        const blueScore = this.teamScores.get('blue') ?? 0;
        this.winningTeam = redScore >= blueScore ? 'red' : 'blue';
        let winnerId: string | null = null;
        let maxAdoptions = 0;
        for (const p of this.players.values()) {
          const team = this.playerTeams.get(p.id);
          if (team === this.winningTeam && p.totalAdoptions > maxAdoptions) {
            maxAdoptions = p.totalAdoptions;
            winnerId = p.id;
          }
        }
        this.winnerId = winnerId;
      } else {
        let winnerId: string | null = null;
        let maxAdoptions = 0;
        for (const p of this.players.values()) {
          if (p.totalAdoptions > maxAdoptions) {
            maxAdoptions = p.totalAdoptions;
            winnerId = p.id;
          }
        }
        this.winnerId = winnerId;
      }

      if (victory) {
        this.pendingAnnouncements.push(`VICTORY! All pets rescued from the PetMall! Bonus: ${rtBonus} RT + 1 Karma Point!`);
        log(`Boss Mode ended with FULL VICTORY. Awarded ${rtBonus} RT + 1 KP`);
      } else {
        this.pendingAnnouncements.push(`Time's up! Rescued pets from ${bm.millsCleared} mills. Bonus: ${rtBonus} RT`);
        log(`Boss Mode ended with partial victory (${bm.millsCleared}/5 mills). Awarded ${rtBonus} RT`);
      }
    } else {
      // LOSS: 0 mills cleared - game continues, boss mode can re-trigger
      this.bossMode = null;
      this.pendingAnnouncements.push(`You lost the boss! The Breeder Tycoon escaped with all the pets.`);
      log(`Boss Mode ended with LOSS (0 mills cleared). Game continues.`);
    }
  }

  // Player enters/exits boss mills automatically via proximity detection in updateBossMillProximity()

  /** Purchase an ingredient for the current boss mill */
  purchaseBossIngredient(playerId: string, ingredient: string, amount: number): { success: boolean; message: string } {
    if (!this.bossMode?.active) return { success: false, message: 'Boss mode not active' };
    
    const millId = this.bossMode.playerAtMill;
    if (millId < 0) return { success: false, message: 'Not at a mill' };
    
    const mill = this.bossMode.mills[millId];
    if (!mill || mill.completed) return { success: false, message: 'Mill completed or invalid' };
    
    // Check if ingredient is in recipe
    const needed = mill.recipe[ingredient] ?? 0;
    if (needed <= 0) return { success: false, message: 'Ingredient not needed for this mill' };
    
    // Check how many more we need
    const purchased = mill.purchased[ingredient] ?? 0;
    const remaining = needed - purchased;
    if (remaining <= 0) return { success: false, message: 'Already have enough of this ingredient' };
    
    // Clamp amount to remaining needed
    const actualAmount = Math.min(amount, remaining);
    
    // Check cost
    const costPer = BOSS_INGREDIENT_COSTS[ingredient] ?? 10;
    const totalCost = costPer * actualAmount;
    const playerMoney = this.getPlayerMoney(playerId);
    
    if (playerMoney < totalCost) {
      return { success: false, message: `Not enough RT (need ${totalCost}, have ${playerMoney})` };
    }
    
    // Deduct money and add ingredient
    this.deductPlayerMoney(playerId, totalCost);
    mill.purchased[ingredient] = purchased + actualAmount;
    
    log(`Player ${playerId} purchased ${actualAmount}x ${ingredient} for ${totalCost} RT at mill ${millId}`);
    return { success: true, message: `Purchased ${actualAmount}x ${ingredient}` };
  }

  /** Submit the prepared meal to rescue pets from current mill */
  submitBossMeal(playerId: string): { success: boolean; message: string; rtBonus: number; kpAwarded: boolean } {
    if (!this.bossMode?.active) return { success: false, message: 'Boss mode not active', rtBonus: 0, kpAwarded: false };
    
    const millId = this.bossMode.playerAtMill;
    if (millId < 0) return { success: false, message: 'Not at a mill', rtBonus: 0, kpAwarded: false };
    
    const mill = this.bossMode.mills[millId];
    if (!mill || mill.completed) return { success: false, message: 'Mill completed or invalid', rtBonus: 0, kpAwarded: false };
    
    // Check if all ingredients are purchased
    for (const [ing, needed] of Object.entries(mill.recipe)) {
      const purchased = mill.purchased[ing] ?? 0;
      if (purchased < needed) {
        return { success: false, message: `Need ${needed - purchased} more ${ing}`, rtBonus: 0, kpAwarded: false };
      }
    }
    
    // Success! Mark mill as completed
    mill.completed = true;
    this.bossMode.millsCleared++;
    this.bossMode.playerAtMill = -1;
    
    // Cancel any in-progress rebuild of this mill
    if (this.bossMode.rebuildingMill === millId) {
      this.bossMode.rebuildingMill = -1;
    }
    
    // Calculate bonus (speed bonus if cleared quickly)
    let rtBonus = 0;
    const ticksSinceStart = this.tick - this.bossMode.startTick;
    const timeSinceLastClear = this.tick - this.bossMode.lastMillClearTick;
    
    // Speed bonus: cleared within 30 seconds (750 ticks) of entering
    if (timeSinceLastClear < 750 && this.bossMode.lastMillClearTick > 0) {
      rtBonus += BOSS_MODE_REWARDS.speedBonusRT;
    }
    
    this.bossMode.lastMillClearTick = this.tick;
    
    // Check for full clear victory
    const kpAwarded = this.bossMode.millsCleared >= 5;
    
    if (rtBonus > 0) {
      this.addPlayerMoney(playerId, rtBonus);
    }
    
    const millName = BOSS_MILL_NAMES[mill.petType] ?? 'Mill';
    this.pendingAnnouncements.push(`${millName} cleared! (${this.bossMode.millsCleared}/5)`);
    log(`Player ${playerId} cleared mill ${millId} (${millName}). Total cleared: ${this.bossMode.millsCleared}/5. Bonus RT: ${rtBonus}`);
    
    return { success: true, message: `${millName} rescued!`, rtBonus, kpAwarded };
  }

  /** Get boss mode state for snapshot */
  getBossModeState(): BossModeState | undefined {
    if (!this.bossMode?.active) return undefined;
    const bm = this.bossMode;
    return {
      active: bm.active,
      startTick: bm.startTick,
      timeLimit: bm.timeLimit,
      mills: bm.mills.map(m => ({
        id: m.id,
        petType: m.petType,
        petCount: m.petCount,
        recipe: { ...m.recipe },
        purchased: { ...m.purchased },
        completed: m.completed,
        x: m.x,
        y: m.y,
      })),
      tycoonX: bm.tycoonX,
      tycoonY: bm.tycoonY,
      tycoonTargetMill: bm.tycoonTargetMill,
      millsCleared: bm.millsCleared,
      mallX: bm.mallX,
      mallY: bm.mallY,
      playerAtMill: bm.playerAtMill,
      rebuildingMill: bm.rebuildingMill >= 0 ? bm.rebuildingMill : undefined,
    };
  }

  /** Check if boss mode resulted in a full victory (for KP award) */
  isBossModeFullVictory(): boolean {
    return this.bossMode !== null && this.bossMode.millsCleared >= 5;
  }

  /** Serialize world state for persistence (solo save/resume). */
  serialize(): string {
    const state = {
      tick: this.tick,
      matchStartTick: this.matchStartTick,
      matchStartTime: this.matchStartTime,
      pausedDurationMs: this.pausedDurationMs,
      frozenAtMs: this.frozenAtMs,
      matchEndAt: this.matchEndAt,
      matchStarted: this.matchStarted,
      matchEndedEarly: this.matchEndedEarly,
      winnerId: this.winnerId,
      strayLoss: this.strayLoss,
      disconnectedPlayerIds: Array.from(this.disconnectedPlayerIds),
      players: Array.from(this.players.entries()),
      pets: Array.from(this.pets.entries()),
      adoptionZones: this.adoptionZones,
      pickups: Array.from(this.pickups.entries()),
      petIdSeq: this.petIdSeq,
      pickupIdSeq: this.pickupIdSeq,
      spawnPetAt: this.spawnPetAt,
      spawnPickupAt: this.spawnPickupAt,
      lastAdoptionTick: Array.from(this.lastAdoptionTick.entries()),
      adoptSpeedUntil: Array.from(this.adoptSpeedUntil.entries()),
      adoptSpeedUsedSeconds: Array.from(this.adoptSpeedUsedSeconds.entries()),
      playerAdoptSpeedBoosts: Array.from(this.playerAdoptSpeedBoosts.entries()),
      groundedPlayerIds: Array.from(this.groundedPlayerIds),
      portCharges: Array.from(this.portCharges.entries()),
      shelterPortCharges: Array.from(this.shelterPortCharges.entries()),
      shelterTier3Boosts: Array.from(this.shelterTier3Boosts.entries()),
      playerColors: Array.from(this.playerColors.entries()),
      playerMoney: Array.from(this.playerMoney.entries()),
      eliminatedPlayerIds: Array.from(this.eliminatedPlayerIds),
      lastAllyPairs: Array.from(this.lastAllyPairs),
      combatOverlapTicks: Array.from(this.combatOverlapTicks.entries()),
      shelters: Array.from(this.shelters.entries()),
      shelterIdSeq: this.shelterIdSeq,
      playerShelterIds: Array.from(this.playerShelterIds.entries()),
      vanSpeedUpgrades: Array.from(this.vanSpeedUpgrades),
      lastShelterAdoptTick: Array.from(this.lastShelterAdoptTick.entries()),
      totalMatchAdoptions: this.totalMatchAdoptions,
      lastGlobalAdoptionTick: this.lastGlobalAdoptionTick,
      scarcityLevel: this.scarcityLevel,
      triggeredEvents: Array.from(this.triggeredEvents),
      satelliteZonesSpawned: this.satelliteZonesSpawned,
      matchProcessed: this.matchProcessed,
      breederSpawnCount: this.breederSpawnCount,
      breederCurrentLevel: this.breederCurrentLevel,
      lastBreederWaveTick: this.lastBreederWaveTick,
      nextBreederWaveInterval: this.nextBreederWaveInterval,
      breederWaveSpawned: this.breederWaveSpawned,
      pendingBreederMiniGames: Array.from(this.pendingBreederMiniGames.entries()),
      cpuAtBreeder: Array.from(this.cpuAtBreeder.entries()),
      pendingCpuBreederCompletions: Array.from(this.pendingCpuBreederCompletions.entries()),
      breederClaimedBy: Array.from(this.breederClaimedBy.entries()),
      breederCamps: Array.from(this.breederCamps.entries()),
      breederShelters: Array.from(this.breederShelters.entries()),
      breederShelterId: this.breederShelterId,
      wildStrayIds: Array.from(this.wildStrayIds),
      cpuCanShutdownBreeders: this.cpuCanShutdownBreeders,
      pendingAnnouncements: [...this.pendingAnnouncements],
      adoptionEvents: Array.from(this.adoptionEvents.entries()),
      adoptionEventIdSeq: this.adoptionEventIdSeq,
      nextAdoptionEventSpawnTick: this.nextAdoptionEventSpawnTick,
      matchMode: this.matchMode,
      bossMode: this.bossMode,
      playerTeams: Array.from(this.playerTeams.entries()),
      teamScores: Array.from(this.teamScores.entries()),
      winningTeam: this.winningTeam,
    };
    return JSON.stringify(state);
  }

  /** Restore world from serialized state (for solo resume). */
  static deserialize(json: string): World {
    const w = new World();
    const state = JSON.parse(json) as {
      tick: number; matchStartTick: number; matchStartTime: number; matchEndAt: number;
      pausedDurationMs?: number; frozenAtMs?: number | null;
      matchStarted: boolean; matchEndedEarly: boolean; winnerId: string | null;
      players: [string, PlayerState][]; pets: [string, PetState][]; adoptionZones: AdoptionZoneState[];
      pickups: [string, PickupState][]; petIdSeq: number; pickupIdSeq: number;
      spawnPetAt: number; spawnPickupAt: number; lastAdoptionTick: [string, number][];
      adoptSpeedUntil?: [string, number][]; adoptSpeedUsedSeconds?: [string, number][]; playerAdoptSpeedBoosts?: [string, number][];
      groundedPlayerIds: string[];
      portCharges: [string, number][]; shelterPortCharges: [string, number][]; shelterTier3Boosts?: [string, number][];
      playerColors: [string, string][]; playerMoney: [string, number][];
      eliminatedPlayerIds: string[]; lastAllyPairs: string[]; combatOverlapTicks: [string, number][];
      shelters: [string, ShelterState][]; shelterIdSeq: number; playerShelterIds: [string, string][];
      vanSpeedUpgrades: string[]; lastShelterAdoptTick: [string, number][];
      totalMatchAdoptions: number; lastGlobalAdoptionTick: number; scarcityLevel: number;
      triggeredEvents: number[]; satelliteZonesSpawned: boolean; matchProcessed: boolean;
      breederSpawnCount: number; breederCurrentLevel: number; lastBreederWaveTick: number;
      nextBreederWaveInterval: number; breederWaveSpawned: boolean;
      pendingBreederMiniGames: [string, { petCount: number; startTick: number; level: number; isMill?: boolean; breederShelterId?: string; breederUid?: string; campData?: { x: number; y: number; spawnTick: number }; startSent?: boolean }][];
      cpuAtBreeder: [string, { breederUid: string; level: number; arrivalTick: number }][];
      pendingCpuBreederCompletions: [string, { level: number; petCount: number; completeAtTick: number }][];
      breederClaimedBy: [string, string][];
      breederCamps: [string, { x: number; y: number; spawnTick: number; level: number }][];
      breederShelters: [string, { x: number; y: number; level: number; lastSpawnTick: number; size: number }][];
      breederShelterId: number; wildStrayIds: string[]; cpuCanShutdownBreeders: boolean;
      pendingAnnouncements: string[]; adoptionEvents: [string, AdoptionEvent][];
      adoptionEventIdSeq: number; nextAdoptionEventSpawnTick: number;
      strayLoss?: boolean; disconnectedPlayerIds?: string[];
      playerTeams?: [string, 'red' | 'blue'][];
      teamScores?: [string, number][];
      winningTeam?: 'red' | 'blue' | null;
    };
    w.tick = state.tick;
    w.matchStartTick = state.matchStartTick;
    w.matchStartTime = state.matchStartTime;
    w.pausedDurationMs = state.pausedDurationMs ?? 0;
    w.frozenAtMs = state.frozenAtMs ?? null;
    w.matchEndAt = state.matchEndAt;
    w.matchStarted = state.matchStarted;
    w.matchEndedEarly = state.matchEndedEarly;
    w.winnerId = state.winnerId ?? null;
    w.strayLoss = state.strayLoss ?? false;
    w.disconnectedPlayerIds = new Set(state.disconnectedPlayerIds ?? []);
    w.players = new Map(state.players);
    w.pets = new Map(state.pets);
    w.adoptionZones = state.adoptionZones;
    w.pickups = new Map(state.pickups);
    w.petIdSeq = state.petIdSeq;
    w.pickupIdSeq = state.pickupIdSeq;
    w.spawnPetAt = state.spawnPetAt;
    w.spawnPickupAt = state.spawnPickupAt;
    w.lastAdoptionTick = new Map(state.lastAdoptionTick);
    w.adoptSpeedUntil = new Map(state.adoptSpeedUntil ?? []);
    w.adoptSpeedUsedSeconds = new Map(state.adoptSpeedUsedSeconds ?? []);
    w.playerAdoptSpeedBoosts = new Map(state.playerAdoptSpeedBoosts ?? []);
    w.groundedPlayerIds = new Set(state.groundedPlayerIds);
    w.portCharges = new Map(state.portCharges);
    w.shelterPortCharges = new Map(state.shelterPortCharges);
    w.shelterTier3Boosts = new Map(state.shelterTier3Boosts ?? []);
    w.playerColors = new Map(state.playerColors);
    w.playerMoney = new Map(state.playerMoney);
    w.eliminatedPlayerIds = new Set(state.eliminatedPlayerIds);
    w.lastAllyPairs = new Set(state.lastAllyPairs);
    w.combatOverlapTicks = new Map(state.combatOverlapTicks);
    w.shelters = new Map(state.shelters);
    w.shelterIdSeq = state.shelterIdSeq;
    w.playerShelterIds = new Map(state.playerShelterIds);
    w.vanSpeedUpgrades = new Set(state.vanSpeedUpgrades);
    w.lastShelterAdoptTick = new Map(state.lastShelterAdoptTick);
    w.totalMatchAdoptions = state.totalMatchAdoptions;
    w.lastGlobalAdoptionTick = state.lastGlobalAdoptionTick;
    w.scarcityLevel = state.scarcityLevel;
    w.triggeredEvents = new Set(state.triggeredEvents);
    w.satelliteZonesSpawned = state.satelliteZonesSpawned;
    w.matchProcessed = state.matchProcessed;
    w.breederSpawnCount = state.breederSpawnCount;
    w.breederCurrentLevel = state.breederCurrentLevel;
    w.lastBreederWaveTick = state.lastBreederWaveTick;
    w.nextBreederWaveInterval = state.nextBreederWaveInterval;
    w.breederWaveSpawned = state.breederWaveSpawned;
    w.pendingBreederMiniGames = new Map(state.pendingBreederMiniGames);
    w.cpuAtBreeder = new Map(state.cpuAtBreeder);
    w.pendingCpuBreederCompletions = new Map(state.pendingCpuBreederCompletions);
    w.breederClaimedBy = new Map(state.breederClaimedBy);
    w.breederCamps = new Map(state.breederCamps);
    w.breederShelters = new Map(state.breederShelters);
    w.breederShelterId = state.breederShelterId;
    w.wildStrayIds = new Set(state.wildStrayIds);
    w.cpuCanShutdownBreeders = state.cpuCanShutdownBreeders;
    w.pendingAnnouncements = state.pendingAnnouncements;
    w.adoptionEvents = new Map(state.adoptionEvents);
    w.adoptionEventIdSeq = state.adoptionEventIdSeq;
    w.nextAdoptionEventSpawnTick = state.nextAdoptionEventSpawnTick;
    w.matchMode = (state as { matchMode?: 'ffa' | 'solo' | 'teams' }).matchMode ?? 'ffa';
    w.bossMode = (state as { bossMode?: typeof w.bossMode }).bossMode ?? null;
    if (state.playerTeams) w.playerTeams = new Map(state.playerTeams);
    if (state.teamScores) w.teamScores = new Map(state.teamScores);
    w.winningTeam = state.winningTeam ?? null;
    return w;
  }
}
