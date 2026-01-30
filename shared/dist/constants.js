"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PICKUP_SPAWN_TICKS = exports.SPEED_BOOST_MULTIPLIER = exports.SPEED_BOOST_DURATION_TICKS = exports.GROWTH_ORB_VALUE = exports.GROWTH_ORB_RADIUS = exports.STRAY_SPAWN_TICKS = exports.MAX_PLAYERS_PER_SHARD = exports.SESSION_DURATION_MS = exports.INITIAL_SHELTER_SIZE = exports.GROWTH_PER_ADOPTION = exports.ADOPTION_TICKS_INTERVAL = exports.ADOPTION_ZONE_RADIUS = exports.PET_RADIUS = exports.RESCUE_RADIUS = exports.SHELTER_BASE_RADIUS = exports.SHELTER_SPEED = exports.MAP_HEIGHT = exports.MAP_WIDTH = exports.TICK_MS = exports.TICK_RATE = void 0;
/** Fixed tick rate (Hz). Server and client use same rate for prediction. */
exports.TICK_RATE = 25;
/** Tick interval in ms */
exports.TICK_MS = 1000 / exports.TICK_RATE;
/** Map size (world units). */
exports.MAP_WIDTH = 2400;
exports.MAP_HEIGHT = 2400;
/** Shelter (player) movement speed (units per second). */
exports.SHELTER_SPEED = 220;
/** Shelter base radius at size 1; scales with size for drawing. */
exports.SHELTER_BASE_RADIUS = 32;
/** Rescue radius: strays within this distance of shelter are collected (up to capacity). */
exports.RESCUE_RADIUS = 70;
/** Stray (pet) radius for drawing and collision. */
exports.PET_RADIUS = 16;
/** Adoption zone radius. */
exports.ADOPTION_ZONE_RADIUS = 90;
/** Ticks between each adoption when shelter is in zone with pets (e.g. ~1 per 2 sec). */
exports.ADOPTION_TICKS_INTERVAL = 50;
/** Size growth per adoption. */
exports.GROWTH_PER_ADOPTION = 1;
/** Initial shelter size (capacity = size). */
exports.INITIAL_SHELTER_SIZE = 1;
/** Session duration (ms) - 5 min. */
exports.SESSION_DURATION_MS = 5 * 60 * 1000;
/** Max players per shard. */
exports.MAX_PLAYERS_PER_SHARD = 100;
/** Stray spawn interval (ticks). */
exports.STRAY_SPAWN_TICKS = 100;
/** Growth orb radius and value. */
exports.GROWTH_ORB_RADIUS = 18;
exports.GROWTH_ORB_VALUE = 0.5;
/** Speed boost duration (ticks). */
exports.SPEED_BOOST_DURATION_TICKS = 750; // 30s at 25 Hz
/** Speed multiplier when boosted. */
exports.SPEED_BOOST_MULTIPLIER = 1.5;
/** Pickup spawn interval (ticks). */
exports.PICKUP_SPAWN_TICKS = 200;
