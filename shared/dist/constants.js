"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PICKUP_SPAWN_TICKS = exports.SPEED_BOOST_MULTIPLIER = exports.SPEED_BOOST_DURATION_TICKS = exports.GROWTH_ORB_VALUE = exports.GROWTH_ORB_RADIUS = exports.STRAY_SPAWN_COUNT = exports.STRAY_SPAWN_TICKS = exports.MAX_PLAYERS_PER_SHARD = exports.SESSION_DURATION_MS = exports.INITIAL_SHELTER_SIZE = exports.COMBAT_MAX_VARIANCE = exports.COMBAT_STRAY_VARIANCE = exports.COMBAT_STRENGTH_WEIGHT = exports.COMBAT_PET_WEIGHT = exports.COMBAT_TRANSFER_PER_WIN = exports.COMBAT_GRACE_TICKS = exports.COMBAT_MIN_SIZE = exports.GROWTH_PER_ADOPTION = exports.ADOPTION_TICKS_GROUNDED = exports.ADOPTION_FAST_PET_THRESHOLD = exports.ADOPTION_TICKS_INTERVAL_FAST = exports.ADOPTION_TICKS_INTERVAL = exports.AUTO_JUMP_ADOPTIONS = exports.GROUNDED_ZONE_RATIO = exports.ADOPTION_ZONE_RADIUS = exports.PET_RADIUS = exports.RESCUE_RADIUS = exports.SHELTER_RADIUS_PER_SIZE = exports.SHELTER_BASE_RADIUS = exports.SHELTER_LARGE_SIZE_THRESHOLD = exports.SHELTER_SPEED_LARGE = exports.SHELTER_SPEED = exports.MAP_HEIGHT = exports.MAP_WIDTH = exports.TICK_MS = exports.TICK_RATE = void 0;
/** Fixed tick rate (Hz). Server and client use same rate for prediction. */
exports.TICK_RATE = 25;
/** Tick interval in ms */
exports.TICK_MS = 1000 / exports.TICK_RATE;
/** Map size (world units). */
exports.MAP_WIDTH = 2400;
exports.MAP_HEIGHT = 2400;
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
exports.ADOPTION_ZONE_RADIUS = 90;
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
/** Combat: minimum size to engage (size 4+). */
exports.COMBAT_MIN_SIZE = 4;
/** Combat: grace period ticks before combat starts (gives time to click Ally). */
exports.COMBAT_GRACE_TICKS = 50; // 2 seconds at 25Hz
/** Combat: size units transferred per resolved fight. */
exports.COMBAT_TRANSFER_PER_WIN = 2;
/** Combat: weight for pets carried when computing strength. */
exports.COMBAT_PET_WEIGHT = 2;
/** Combat: strength to win-probability weight. */
exports.COMBAT_STRENGTH_WEIGHT = 0.15;
/** Combat: per-stray variance weight (adds randomness). */
exports.COMBAT_STRAY_VARIANCE = 0.005;
/** Combat: maximum variance applied to win chance. */
exports.COMBAT_MAX_VARIANCE = 0.2;
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
