"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BOSS_MODE_TIME_LIMIT_TICKS = exports.BOSS_MODE_TIME_LIMIT_SECONDS = exports.VAN_MAX_CAPACITY = exports.VAN_BASE_SIZE = exports.SHELTER_BUILD_COST = exports.TOKENS_PER_ADOPTION = exports.EVENT_MILESTONES = exports.SATELLITE_ZONE_MILESTONE = exports.SCARCITY_TRIGGER_TICKS = exports.ADOPTION_MILESTONE_WIN = exports.PICKUP_SPAWN_TICKS = exports.SPEED_BOOST_MULTIPLIER = exports.SPEED_BOOST_DURATION_TICKS = exports.GROWTH_ORB_VALUE = exports.GROWTH_ORB_RADIUS = exports.STRAY_SPAWN_COUNT = exports.STRAY_SPAWN_TICKS = exports.MAX_PLAYERS_PER_SHARD = exports.SESSION_DURATION_MS = exports.INITIAL_SHELTER_SIZE = exports.EARLY_GAME_PROTECTION_TICKS = exports.EARLY_GAME_PROTECTION_ADOPTIONS = exports.EARLY_GAME_PROTECTION_SIZE = exports.COMBAT_MAX_VARIANCE = exports.COMBAT_STRAY_VARIANCE = exports.COMBAT_STRENGTH_WEIGHT = exports.COMBAT_PET_WEIGHT = exports.COMBAT_TRANSFER_SIZE_RATIO_DIVISOR = exports.COMBAT_TRANSFER_PER_WIN = exports.COMBAT_GRACE_TICKS = exports.COMBAT_MIN_SIZE = exports.GROWTH_PER_ADOPTION = exports.ADOPTION_TICKS_GROUNDED = exports.ADOPTION_FAST_PET_THRESHOLD = exports.ADOPTION_TICKS_INTERVAL_FAST = exports.ADOPTION_TICKS_INTERVAL = exports.AUTO_JUMP_ADOPTIONS = exports.GROUNDED_ZONE_RATIO = exports.ADOPTION_ZONE_RADIUS = exports.PET_RADIUS = exports.RESCUE_RADIUS = exports.SHELTER_RADIUS_PER_SIZE = exports.SHELTER_BASE_RADIUS = exports.SHELTER_LARGE_SIZE_THRESHOLD = exports.SHELTER_SPEED_LARGE = exports.SHELTER_SPEED = exports.MAP_HEIGHT = exports.MAP_WIDTH = exports.TICK_MS = exports.TICK_RATE = void 0;
exports.BOSS_CAUGHT_PENALTY = exports.BOSS_MODE_REWARDS = exports.BOSS_MILL_RADIUS = exports.BOSS_PETMALL_RADIUS = exports.BOSS_MILL_RECIPES = exports.BOSS_MILL_NAMES = exports.BOSS_MILL_PET_COUNTS = exports.BOSS_INGREDIENT_COSTS = exports.BOSS_TYCOON_DETECTION_RADIUS = exports.BOSS_TYCOON_WARNING_SECONDS = exports.BOSS_TYCOON_SPEED = exports.BOSS_TYCOON_DWELL_TICKS = exports.BOSS_TYCOON_DWELL_SECONDS = void 0;
/** Fixed tick rate (Hz). Server and client use same rate for prediction. */
exports.TICK_RATE = 25;
/** Tick interval in ms */
exports.TICK_MS = 1000 / exports.TICK_RATE;
/** Map size (world units). */
exports.MAP_WIDTH = 4800;
exports.MAP_HEIGHT = 4800;
/** Shelter (player) movement speed (units per second). */
exports.SHELTER_SPEED = 280;
/** Faster movement speed for large shelters (size 200+). */
exports.SHELTER_SPEED_LARGE = 420;
/** Size threshold for faster movement. */
exports.SHELTER_LARGE_SIZE_THRESHOLD = 200;
/** Shelter base radius at size 1; scales with size for drawing. */
exports.SHELTER_BASE_RADIUS = 32;
/** Radius growth per size point (smaller = more shelters fit in adoption center). */
exports.SHELTER_RADIUS_PER_SIZE = 2.5;
/** Rescue radius: strays within this distance of shelter are collected (up to capacity). */
exports.RESCUE_RADIUS = 70;
/** Stray (pet) radius for drawing and collision. */
exports.PET_RADIUS = 16;
/** Adoption zone radius. */
exports.ADOPTION_ZONE_RADIUS = 140;
/** When shelter radius >= 2x zone radius, shelter is grounded (no move, gravity pulls strays). */
exports.GROUNDED_ZONE_RATIO = 2;
/** Auto-jump to new area when total adoptions reach this. */
exports.AUTO_JUMP_ADOPTIONS = 50;
/** Ticks between each adoption when shelter is in zone with pets (base). */
exports.ADOPTION_TICKS_INTERVAL = 50;
/** When shelter has 10+ pets, adopt faster (shorter interval). */
exports.ADOPTION_TICKS_INTERVAL_FAST = 20;
exports.ADOPTION_FAST_PET_THRESHOLD = 10;
/** Slower adoption when grounded/ported (own shelter) — longer interval. */
exports.ADOPTION_TICKS_GROUNDED = 80;
/** Size growth per adoption (higher = faster growth). */
exports.GROWTH_PER_ADOPTION = 1;
/** Combat: minimum size to engage (size 10+). No attacks below this size! */
exports.COMBAT_MIN_SIZE = 10;
/** Combat: grace period ticks before combat starts (gives time to click Ally). */
exports.COMBAT_GRACE_TICKS = 50; // 2 seconds at 25Hz
/** Combat: size units transferred per resolved fight (base). */
exports.COMBAT_TRANSFER_PER_WIN = 2;
/** Combat: winner size divisor for scaling transfer (e.g. 10 → 200 vs 20 transfers 20 in one tick). */
exports.COMBAT_TRANSFER_SIZE_RATIO_DIVISOR = 10;
/** Combat: weight for pets carried when computing strength. */
exports.COMBAT_PET_WEIGHT = 2;
/** Combat: strength to win-probability weight. */
exports.COMBAT_STRENGTH_WEIGHT = 0.15;
/** Combat: per-stray variance weight (adds randomness). */
exports.COMBAT_STRAY_VARIANCE = 0.005;
/** Combat: maximum variance applied to win chance. */
exports.COMBAT_MAX_VARIANCE = 0.2;
/** Early-game protection: minimum size before elimination is allowed. */
exports.EARLY_GAME_PROTECTION_SIZE = 10;
/** Early-game protection ends when someone reaches this many adoptions. */
exports.EARLY_GAME_PROTECTION_ADOPTIONS = 50;
/** Early-game protection ends after this many ticks (60 seconds at 25 Hz). */
exports.EARLY_GAME_PROTECTION_TICKS = 60 * 25;
/** Initial shelter size (capacity = size). */
exports.INITIAL_SHELTER_SIZE = 1;
/** Session duration (ms) - 5 min. */
exports.SESSION_DURATION_MS = 5 * 60 * 1000;
/** Max players per shard. */
exports.MAX_PLAYERS_PER_SHARD = 100;
/** Stray spawn interval (ticks); spawn multiple per tick for a race feel. */
exports.STRAY_SPAWN_TICKS = 25;
/** Strays spawned per spawn event. */
exports.STRAY_SPAWN_COUNT = 3;
/** Growth orb radius and value. */
exports.GROWTH_ORB_RADIUS = 18;
/** Each +size pickup adds 1 to size (and thus +1 capacity). */
exports.GROWTH_ORB_VALUE = 1;
/** Speed boost duration (ticks). */
exports.SPEED_BOOST_DURATION_TICKS = 750; // 30s at 25 Hz
/** Speed multiplier when boosted. */
exports.SPEED_BOOST_MULTIPLIER = 1.5;
/** Pickup spawn interval (ticks). */
exports.PICKUP_SPAWN_TICKS = 200;
/** Adoption milestone to win the match. */
exports.ADOPTION_MILESTONE_WIN = 150;
/** Anti-stall: ticks without any adoption before scarcity kicks in (30 seconds). */
exports.SCARCITY_TRIGGER_TICKS = 30 * 25;
/** Total match adoptions milestone to spawn satellite adoption zones. */
exports.SATELLITE_ZONE_MILESTONE = 75;
/** Event milestones for global events. */
exports.EVENT_MILESTONES = [50, 100, 200, 300];
/** Rescue Tokens earned per pet adopted out. */
exports.TOKENS_PER_ADOPTION = 5;
/** Cost to build a shelter (ground at location). */
exports.SHELTER_BUILD_COST = 250;
/** Van base size for drawing (fixed, doesn't grow). */
exports.VAN_BASE_SIZE = 50;
/** Max pets a van can carry (before building shelter). */
exports.VAN_MAX_CAPACITY = 50;
// ============================================
// BOSS MODE CONSTANTS
// ============================================
/** Boss mode time limit in seconds (5 minutes). */
exports.BOSS_MODE_TIME_LIMIT_SECONDS = 180; // 3 minutes
/** Boss mode time limit in ticks. */
exports.BOSS_MODE_TIME_LIMIT_TICKS = exports.BOSS_MODE_TIME_LIMIT_SECONDS * exports.TICK_RATE;
/** Tycoon patrol time at each mill (seconds). */
exports.BOSS_TYCOON_DWELL_SECONDS = 10;
/** Tycoon patrol time at each mill (ticks). */
exports.BOSS_TYCOON_DWELL_TICKS = exports.BOSS_TYCOON_DWELL_SECONDS * exports.TICK_RATE;
/** Tycoon movement speed (units per tick). */
exports.BOSS_TYCOON_SPEED = 8;
/** Warning time before tycoon arrives (seconds). */
exports.BOSS_TYCOON_WARNING_SECONDS = 3;
/** Tycoon detection radius at mill. */
exports.BOSS_TYCOON_DETECTION_RADIUS = 150;
/** Ingredient costs in RT. */
exports.BOSS_INGREDIENT_COSTS = {
    bowl: 20,
    water: 20,
    carrot: 8,
    apple: 5,
    chicken: 15,
    seeds: 5,
    treat: 25, // Premium ingredient for cats/dogs
};
/** Pet counts per mill. */
exports.BOSS_MILL_PET_COUNTS = {
    0: 5, // Horse
    1: 6, // Cat
    2: 6, // Dog
    3: 5, // Bird
    4: 5, // Rabbit
};
/** Mill names for display. */
exports.BOSS_MILL_NAMES = {
    0: 'Horse Stable',
    1: 'Cat Boutique',
    2: 'Dog Depot',
    3: 'Bird Barn',
    4: 'Rabbit Hutch',
};
/** Recipes per pet for each mill type (ingredient -> amount per pet). */
exports.BOSS_MILL_RECIPES = {
    0: { bowl: 1, water: 2, carrot: 2, apple: 1 }, // Horse: 6 ingredients per pet
    1: { bowl: 1, water: 2, chicken: 2, treat: 1 }, // Cat: 6 ingredients per pet
    2: { bowl: 1, water: 2, chicken: 2, treat: 1 }, // Dog: 6 ingredients per pet
    3: { bowl: 1, water: 1, seeds: 2, carrot: 1 }, // Bird: 5 ingredients per pet
    4: { bowl: 1, water: 2, carrot: 2, apple: 1 }, // Rabbit: 6 ingredients per pet
};
/** PetMall radius (mills arranged around center). */
exports.BOSS_PETMALL_RADIUS = 400;
/** Mill visual radius. */
exports.BOSS_MILL_RADIUS = 100;
/** Rewards for boss mode completion. */
exports.BOSS_MODE_REWARDS = {
    /** KP awarded for clearing all 5 mills. */
    fullClearKP: 1,
    /** RT bonus for clearing all 5 mills. */
    fullClearRT: 100,
    /** RT bonus per mill cleared (3-4 mills). */
    partialClearRT: 50,
    /** RT bonus per mill cleared (1-2 mills). */
    minimalClearRT: 25,
    /** Speed bonus for clearing a mill in under 30 seconds. */
    speedBonusRT: 20,
    /** Combo multiplier for consecutive mill clears. */
    comboMultiplier: 1.5,
};
/** Penalty for being caught by tycoon (lose this fraction of purchased ingredients). */
exports.BOSS_CAUGHT_PENALTY = 0.5;
