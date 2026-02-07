/** Fixed tick rate (Hz). Server and client use same rate for prediction. */
export declare const TICK_RATE = 25;
/** Tick interval in ms */
export declare const TICK_MS: number;
/** Map size (world units). */
export declare const MAP_WIDTH = 4800;
export declare const MAP_HEIGHT = 4800;
/** Shelter (player) movement speed (units per second). */
export declare const SHELTER_SPEED = 280;
/** Faster movement speed for large shelters (size 200+). */
export declare const SHELTER_SPEED_LARGE = 420;
/** Size threshold for faster movement. */
export declare const SHELTER_LARGE_SIZE_THRESHOLD = 200;
/** Shelter base radius at size 1; scales with size for drawing. */
export declare const SHELTER_BASE_RADIUS = 32;
/** Radius growth per size point (smaller = more shelters fit in adoption center). */
export declare const SHELTER_RADIUS_PER_SIZE = 2.5;
/** Rescue radius: strays within this distance of shelter are collected (up to capacity). */
export declare const RESCUE_RADIUS = 70;
/** Stray (pet) radius for drawing and collision. */
export declare const PET_RADIUS = 16;
/** Adoption zone radius. */
export declare const ADOPTION_ZONE_RADIUS = 140;
/** When shelter radius >= 2x zone radius, shelter is grounded (no move, gravity pulls strays). */
export declare const GROUNDED_ZONE_RATIO = 2;
/** Auto-jump to new area when total adoptions reach this. */
export declare const AUTO_JUMP_ADOPTIONS = 50;
/** Ticks between each adoption when shelter is in zone with pets (base). */
export declare const ADOPTION_TICKS_INTERVAL = 50;
/** When shelter has 10+ pets, adopt faster (shorter interval). */
export declare const ADOPTION_TICKS_INTERVAL_FAST = 20;
export declare const ADOPTION_FAST_PET_THRESHOLD = 10;
/** Slower adoption when grounded/ported (own shelter) — longer interval. */
export declare const ADOPTION_TICKS_GROUNDED = 80;
/** Size growth per adoption (higher = faster growth). */
export declare const GROWTH_PER_ADOPTION = 1;
/** Combat: minimum size to engage (size 10+). No attacks below this size! */
export declare const COMBAT_MIN_SIZE = 10;
/** Combat: grace period ticks before combat starts (gives time to click Ally). */
export declare const COMBAT_GRACE_TICKS = 50;
/** Combat: size units transferred per resolved fight (base). */
export declare const COMBAT_TRANSFER_PER_WIN = 2;
/** Combat: winner size divisor for scaling transfer (e.g. 10 → 200 vs 20 transfers 20 in one tick). */
export declare const COMBAT_TRANSFER_SIZE_RATIO_DIVISOR = 10;
/** Combat: weight for pets carried when computing strength. */
export declare const COMBAT_PET_WEIGHT = 2;
/** Combat: strength to win-probability weight. */
export declare const COMBAT_STRENGTH_WEIGHT = 0.15;
/** Combat: per-stray variance weight (adds randomness). */
export declare const COMBAT_STRAY_VARIANCE = 0.005;
/** Combat: maximum variance applied to win chance. */
export declare const COMBAT_MAX_VARIANCE = 0.2;
/** Early-game protection: minimum size before elimination is allowed. */
export declare const EARLY_GAME_PROTECTION_SIZE = 10;
/** Early-game protection ends when someone reaches this many adoptions. */
export declare const EARLY_GAME_PROTECTION_ADOPTIONS = 50;
/** Early-game protection ends after this many ticks (60 seconds at 25 Hz). */
export declare const EARLY_GAME_PROTECTION_TICKS: number;
/** Initial shelter size (capacity = size). */
export declare const INITIAL_SHELTER_SIZE = 1;
/** Session duration (ms) - 5 min. */
export declare const SESSION_DURATION_MS: number;
/** Max players per shard. */
export declare const MAX_PLAYERS_PER_SHARD = 100;
/** Max players per FFA/Teams match (including bots). */
export declare const MAX_FFA_PLAYERS = 8;
/** Stray spawn interval (ticks); spawn multiple per tick for a race feel. */
export declare const STRAY_SPAWN_TICKS = 25;
/** Strays spawned per spawn event. */
export declare const STRAY_SPAWN_COUNT = 3;
/** Growth orb radius and value. */
export declare const GROWTH_ORB_RADIUS = 18;
/** Each +size pickup adds 1 to size (and thus +1 capacity). */
export declare const GROWTH_ORB_VALUE = 1;
/** Speed boost duration (ticks). */
export declare const SPEED_BOOST_DURATION_TICKS = 750;
/** Speed multiplier when boosted. */
export declare const SPEED_BOOST_MULTIPLIER = 1.5;
/** Pickup spawn interval (ticks). */
export declare const PICKUP_SPAWN_TICKS = 200;
/** Adoption milestone to win the match. */
export declare const ADOPTION_MILESTONE_WIN = 150;
/** Anti-stall: ticks without any adoption before scarcity kicks in (30 seconds). */
export declare const SCARCITY_TRIGGER_TICKS: number;
/** Total match adoptions milestone to spawn satellite adoption zones. */
export declare const SATELLITE_ZONE_MILESTONE = 75;
/** Event milestones for global events. */
export declare const EVENT_MILESTONES: readonly [50, 100, 200, 300];
/** Rescue Tokens earned per pet adopted out. */
export declare const TOKENS_PER_ADOPTION = 5;
/** Cost to build a shelter (ground at location). */
export declare const SHELTER_BUILD_COST = 250;
/** Van base size for drawing (fixed, doesn't grow). */
export declare const VAN_BASE_SIZE = 50;
/** Max pets a van can carry (before building shelter). */
export declare const VAN_MAX_CAPACITY = 50;
/** Boss mode time limit in seconds (5 minutes). */
export declare const BOSS_MODE_TIME_LIMIT_SECONDS = 180;
/** Boss mode time limit in ticks. */
export declare const BOSS_MODE_TIME_LIMIT_TICKS: number;
/** Tycoon patrol time at each mill (seconds). */
export declare const BOSS_TYCOON_DWELL_SECONDS = 10;
/** Tycoon patrol time at each mill (ticks). */
export declare const BOSS_TYCOON_DWELL_TICKS: number;
/** Tycoon movement speed (units per tick). */
export declare const BOSS_TYCOON_SPEED = 8;
/** Warning time before tycoon arrives (seconds). */
export declare const BOSS_TYCOON_WARNING_SECONDS = 3;
/** Tycoon detection radius at mill. */
export declare const BOSS_TYCOON_DETECTION_RADIUS = 150;
/** Ingredient costs in RT. */
export declare const BOSS_INGREDIENT_COSTS: {
    [ingredient: string]: number;
};
/** Pet counts per mill. */
export declare const BOSS_MILL_PET_COUNTS: {
    [millType: number]: number;
};
/** Mill names for display. */
export declare const BOSS_MILL_NAMES: {
    [millType: number]: string;
};
/** Recipes per pet for each mill type (ingredient -> amount per pet). */
export declare const BOSS_MILL_RECIPES: {
    [millType: number]: {
        [ingredient: string]: number;
    };
};
/** PetMall radius (mills arranged around center). */
export declare const BOSS_PETMALL_RADIUS = 400;
/** Mill visual radius. */
export declare const BOSS_MILL_RADIUS = 100;
/** Rewards for boss mode completion. */
export declare const BOSS_MODE_REWARDS: {
    /** KP awarded for clearing all 5 mills. */
    fullClearKP: number;
    /** RT bonus for clearing all 5 mills. */
    fullClearRT: number;
    /** RT bonus per mill cleared (3-4 mills). */
    partialClearRT: number;
    /** RT bonus per mill cleared (1-2 mills). */
    minimalClearRT: number;
    /** Speed bonus for clearing a mill in under 30 seconds. */
    speedBonusRT: number;
    /** Combo multiplier for consecutive mill clears. */
    comboMultiplier: number;
};
/** Penalty for being caught by tycoon (lose this fraction of purchased ingredients). */
export declare const BOSS_CAUGHT_PENALTY = 0.5;
/** Time for tycoon to rebuild a cleared mill (seconds). */
export declare const BOSS_TYCOON_REBUILD_SECONDS = 10;
/** Time for tycoon to rebuild a cleared mill (ticks). */
export declare const BOSS_TYCOON_REBUILD_TICKS: number;
