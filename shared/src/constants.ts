/** Fixed tick rate (Hz). Server and client use same rate for prediction. */
export const TICK_RATE = 25;

/** Tick interval in ms */
export const TICK_MS = 1000 / TICK_RATE;

/** Map size (world units). */
export const MAP_WIDTH = 2400;
export const MAP_HEIGHT = 2400;

/** Shelter (player) movement speed (units per second). */
export const SHELTER_SPEED = 280;

/** Shelter base radius at size 1; scales with size for drawing. */
export const SHELTER_BASE_RADIUS = 32;
/** Radius growth per size point (smaller = more shelters fit in adoption center). */
export const SHELTER_RADIUS_PER_SIZE = 2.5;

/** Rescue radius: strays within this distance of shelter are collected (up to capacity). */
export const RESCUE_RADIUS = 70;

/** Stray (pet) radius for drawing and collision. */
export const PET_RADIUS = 16;

/** Adoption zone radius. */
export const ADOPTION_ZONE_RADIUS = 90;
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
export const GROWTH_PER_ADOPTION = 1.5;

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
