/** Fixed tick rate (Hz). Server and client use same rate for prediction. */
export const TICK_RATE = 25;

/** Tick interval in ms */
export const TICK_MS = 1000 / TICK_RATE;

/** Map size (world units). */
export const MAP_WIDTH = 2400;
export const MAP_HEIGHT = 2400;

/** Shelter (player) movement speed (units per second). */
export const SHELTER_SPEED = 220;

/** Shelter base radius at size 1; scales with size for drawing. */
export const SHELTER_BASE_RADIUS = 32;

/** Rescue radius: strays within this distance of shelter are collected (up to capacity). */
export const RESCUE_RADIUS = 70;

/** Stray (pet) radius for drawing and collision. */
export const PET_RADIUS = 16;

/** Adoption zone radius. */
export const ADOPTION_ZONE_RADIUS = 90;

/** Ticks between each adoption when shelter is in zone with pets (e.g. ~1 per 2 sec). */
export const ADOPTION_TICKS_INTERVAL = 50;

/** Size growth per adoption. */
export const GROWTH_PER_ADOPTION = 1;

/** Initial shelter size (capacity = size). */
export const INITIAL_SHELTER_SIZE = 1;

/** Session duration (ms) - 5 min. */
export const SESSION_DURATION_MS = 5 * 60 * 1000;

/** Max players per shard. */
export const MAX_PLAYERS_PER_SHARD = 100;

/** Stray spawn interval (ticks). */
export const STRAY_SPAWN_TICKS = 100;

/** Growth orb radius and value. */
export const GROWTH_ORB_RADIUS = 18;
export const GROWTH_ORB_VALUE = 0.5;

/** Speed boost duration (ticks). */
export const SPEED_BOOST_DURATION_TICKS = 750; // 30s at 25 Hz

/** Speed multiplier when boosted. */
export const SPEED_BOOST_MULTIPLIER = 1.5;

/** Pickup spawn interval (ticks). */
export const PICKUP_SPAWN_TICKS = 200;
