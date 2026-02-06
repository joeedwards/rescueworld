"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.INGREDIENT_TREAT = exports.INGREDIENT_SEEDS = exports.INGREDIENT_CHICKEN = exports.INGREDIENT_APPLE = exports.INGREDIENT_CARROT = exports.INGREDIENT_WATER = exports.INGREDIENT_BOWL = exports.BOSS_MILL_RABBIT = exports.BOSS_MILL_BIRD = exports.BOSS_MILL_DOG = exports.BOSS_MILL_CAT = exports.BOSS_MILL_HORSE = exports.PET_TYPE_SPECIAL = exports.PET_TYPE_RABBIT = exports.PET_TYPE_BIRD = exports.PET_TYPE_DOG = exports.PET_TYPE_CAT = exports.PICKUP_TYPE_SHELTER_PORT = exports.PICKUP_TYPE_BREEDER = exports.PICKUP_TYPE_PORT = exports.PICKUP_TYPE_SPEED = exports.PICKUP_TYPE_GROWTH = exports.INPUT_INTERACT = exports.INPUT_DOWN = exports.INPUT_UP = exports.INPUT_RIGHT = exports.INPUT_LEFT = void 0;
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
// Boss Mode types
exports.BOSS_MILL_HORSE = 0;
exports.BOSS_MILL_CAT = 1;
exports.BOSS_MILL_DOG = 2;
exports.BOSS_MILL_BIRD = 3;
exports.BOSS_MILL_RABBIT = 4;
/** Ingredient types for boss mode recipes */
exports.INGREDIENT_BOWL = 'bowl';
exports.INGREDIENT_WATER = 'water';
exports.INGREDIENT_CARROT = 'carrot';
exports.INGREDIENT_APPLE = 'apple';
exports.INGREDIENT_CHICKEN = 'chicken';
exports.INGREDIENT_SEEDS = 'seeds';
exports.INGREDIENT_TREAT = 'treat'; // New premium ingredient for cats/dogs
