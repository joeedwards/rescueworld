/** Fixed tick rate (Hz). Server and client use same rate for prediction. */
export declare const TICK_RATE = 25;
/** Tick interval in ms */
export declare const TICK_MS: number;
/** Map size (world units). */
export declare const MAP_WIDTH = 2400;
export declare const MAP_HEIGHT = 2400;
/** Shelter (player) movement speed (units per second). */
export declare const SHELTER_SPEED = 220;
/** Shelter base radius at size 1; scales with size for drawing. */
export declare const SHELTER_BASE_RADIUS = 32;
/** Rescue radius: strays within this distance of shelter are collected (up to capacity). */
export declare const RESCUE_RADIUS = 70;
/** Stray (pet) radius for drawing and collision. */
export declare const PET_RADIUS = 16;
/** Adoption zone radius. */
export declare const ADOPTION_ZONE_RADIUS = 90;
/** Ticks between each adoption when shelter is in zone with pets (e.g. ~1 per 2 sec). */
export declare const ADOPTION_TICKS_INTERVAL = 50;
/** Size growth per adoption. */
export declare const GROWTH_PER_ADOPTION = 1;
/** Initial shelter size (capacity = size). */
export declare const INITIAL_SHELTER_SIZE = 1;
/** Session duration (ms) - 5 min. */
export declare const SESSION_DURATION_MS: number;
/** Max players per shard. */
export declare const MAX_PLAYERS_PER_SHARD = 100;
/** Stray spawn interval (ticks). */
export declare const STRAY_SPAWN_TICKS = 100;
/** Growth orb radius and value. */
export declare const GROWTH_ORB_RADIUS = 18;
export declare const GROWTH_ORB_VALUE = 0.5;
/** Speed boost duration (ticks). */
export declare const SPEED_BOOST_DURATION_TICKS = 750;
/** Speed multiplier when boosted. */
export declare const SPEED_BOOST_MULTIPLIER = 1.5;
/** Pickup spawn interval (ticks). */
export declare const PICKUP_SPAWN_TICKS = 200;
