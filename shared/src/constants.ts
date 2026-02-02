/** Fixed tick rate (Hz). Server and client use same rate for prediction. */
export const TICK_RATE = 25;

/** Tick interval in ms */
export const TICK_MS = 1000 / TICK_RATE;

/** Map size (world units). */
export const MAP_WIDTH = 4800;
export const MAP_HEIGHT = 4800;

/** Shelter (player) movement speed (units per second). */
export const SHELTER_SPEED = 280;
/** Faster movement speed for large shelters (size 200+). */
export const SHELTER_SPEED_LARGE = 420;
/** Size threshold for faster movement. */
export const SHELTER_LARGE_SIZE_THRESHOLD = 200;

/** Shelter base radius at size 1; scales with size for drawing. */
export const SHELTER_BASE_RADIUS = 32;
/** Radius growth per size point (smaller = more shelters fit in adoption center). */
export const SHELTER_RADIUS_PER_SIZE = 2.5;

/** Rescue radius: strays within this distance of shelter are collected (up to capacity). */
export const RESCUE_RADIUS = 70;

/** Stray (pet) radius for drawing and collision. */
export const PET_RADIUS = 16;

/** Adoption zone radius. */
export const ADOPTION_ZONE_RADIUS = 140;
/** When shelter radius >= 2x zone radius, shelter is grounded (no move, gravity pulls strays). */
export const GROUNDED_ZONE_RATIO = 2;
/** Auto-jump to new area when total adoptions reach this. */
export const AUTO_JUMP_ADOPTIONS = 50;

/** Ticks between each adoption when shelter is in zone with pets (base). */
export const ADOPTION_TICKS_INTERVAL = 50;
/** When shelter has 10+ pets, adopt faster (shorter interval). */
export const ADOPTION_TICKS_INTERVAL_FAST = 20;
export const ADOPTION_FAST_PET_THRESHOLD = 10;

/** Slower adoption when grounded/ported (own shelter) — longer interval. */
export const ADOPTION_TICKS_GROUNDED = 80;

/** Size growth per adoption (higher = faster growth). */
export const GROWTH_PER_ADOPTION = 1;

/** Combat: minimum size to engage (size 10+). No attacks below this size! */
export const COMBAT_MIN_SIZE = 10;
/** Combat: grace period ticks before combat starts (gives time to click Ally). */
export const COMBAT_GRACE_TICKS = 50; // 2 seconds at 25Hz
/** Combat: size units transferred per resolved fight (base). */
export const COMBAT_TRANSFER_PER_WIN = 2;
/** Combat: winner size divisor for scaling transfer (e.g. 10 → 200 vs 20 transfers 20 in one tick). */
export const COMBAT_TRANSFER_SIZE_RATIO_DIVISOR = 10;
/** Combat: weight for pets carried when computing strength. */
export const COMBAT_PET_WEIGHT = 2;
/** Combat: strength to win-probability weight. */
export const COMBAT_STRENGTH_WEIGHT = 0.15;
/** Combat: per-stray variance weight (adds randomness). */
export const COMBAT_STRAY_VARIANCE = 0.005;
/** Combat: maximum variance applied to win chance. */
export const COMBAT_MAX_VARIANCE = 0.2;

/** Early-game protection: minimum size before elimination is allowed. */
export const EARLY_GAME_PROTECTION_SIZE = 10;
/** Early-game protection ends when someone reaches this many adoptions. */
export const EARLY_GAME_PROTECTION_ADOPTIONS = 50;
/** Early-game protection ends after this many ticks (60 seconds at 25 Hz). */
export const EARLY_GAME_PROTECTION_TICKS = 60 * 25;

/** Initial shelter size (capacity = size). */
export const INITIAL_SHELTER_SIZE = 1;

/** Session duration (ms) - 5 min. */
export const SESSION_DURATION_MS = 5 * 60 * 1000;

/** Max players per shard. */
export const MAX_PLAYERS_PER_SHARD = 100;

/** Stray spawn interval (ticks); spawn multiple per tick for a race feel. */
export const STRAY_SPAWN_TICKS = 25;
/** Strays spawned per spawn event. */
export const STRAY_SPAWN_COUNT = 3;

/** Growth orb radius and value. */
export const GROWTH_ORB_RADIUS = 18;
/** Each +size pickup adds 1 to size (and thus +1 capacity). */
export const GROWTH_ORB_VALUE = 1;

/** Speed boost duration (ticks). */
export const SPEED_BOOST_DURATION_TICKS = 750; // 30s at 25 Hz

/** Speed multiplier when boosted. */
export const SPEED_BOOST_MULTIPLIER = 1.5;

/** Pickup spawn interval (ticks). */
export const PICKUP_SPAWN_TICKS = 200;

/** Adoption milestone to win the match. */
export const ADOPTION_MILESTONE_WIN = 150;

/** Anti-stall: ticks without any adoption before scarcity kicks in (30 seconds). */
export const SCARCITY_TRIGGER_TICKS = 30 * 25;

/** Total match adoptions milestone to spawn satellite adoption zones. */
export const SATELLITE_ZONE_MILESTONE = 75;

/** Event milestones for global events. */
export const EVENT_MILESTONES = [50, 100, 200, 300] as const;

/** Rescue Tokens earned per pet adopted out. */
export const TOKENS_PER_ADOPTION = 5;

/** Cost to build a shelter (ground at location). */
export const SHELTER_BUILD_COST = 250;

/** Van base size for drawing (fixed, doesn't grow). */
export const VAN_BASE_SIZE = 50;

/** Max pets a van can carry (before building shelter). */
export const VAN_MAX_CAPACITY = 50;
