"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PET_TYPE_SPECIAL = exports.PET_TYPE_RABBIT = exports.PET_TYPE_BIRD = exports.PET_TYPE_DOG = exports.PET_TYPE_CAT = exports.PICKUP_TYPE_SHELTER_PORT = exports.PICKUP_TYPE_BREEDER = exports.PICKUP_TYPE_PORT = exports.PICKUP_TYPE_SPEED = exports.PICKUP_TYPE_GROWTH = exports.INPUT_INTERACT = exports.INPUT_DOWN = exports.INPUT_UP = exports.INPUT_RIGHT = exports.INPUT_LEFT = void 0;
exports.INPUT_LEFT = 1 << 0;
exports.INPUT_RIGHT = 1 << 1;
exports.INPUT_UP = 1 << 2;
exports.INPUT_DOWN = 1 << 3;
exports.INPUT_INTERACT = 1 << 4; // unused for now; adopt is automatic in zone
exports.PICKUP_TYPE_GROWTH = 0;
exports.PICKUP_TYPE_SPEED = 1;
exports.PICKUP_TYPE_PORT = 2; // Random port
exports.PICKUP_TYPE_BREEDER = 3;
exports.PICKUP_TYPE_SHELTER_PORT = 4; // Teleport to shelter
// Pet types for variety system
exports.PET_TYPE_CAT = 0;
exports.PET_TYPE_DOG = 1;
exports.PET_TYPE_BIRD = 2;
exports.PET_TYPE_RABBIT = 3;
exports.PET_TYPE_SPECIAL = 4; // Rare golden pet
