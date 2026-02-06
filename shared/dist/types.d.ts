export type Vec2 = {
    x: number;
    y: number;
};
export type InputFlags = number;
export declare const INPUT_LEFT: number;
export declare const INPUT_RIGHT: number;
export declare const INPUT_UP: number;
export declare const INPUT_DOWN: number;
export declare const INPUT_INTERACT: number;
/** Shelter = moving player. Size = capacity. petsInside = strays collected. */
export interface PlayerState {
    id: string;
    /** Display name (e.g. rescueNNN for guests). */
    displayName: string;
    x: number;
    y: number;
    vx: number;
    vy: number;
    /** Shelter size; capacity = size. Grows when pets are adopted out. */
    size: number;
    /** Total adoptions (for leaderboard). */
    totalAdoptions: number;
    /** Pet ids currently inside this shelter. */
    petsInside: string[];
    /** Tick until speed boost expires (0 = no boost). */
    speedBoostUntil: number;
    inputSeq: number;
    /** Ally player ids (can overlap; no push-apart). Sent by server. */
    allies?: string[];
    /** True if consumed/eliminated (size <= threshold). */
    eliminated?: boolean;
    /** True if player has grounded themselves at a location. */
    grounded?: boolean;
    /** True if player disconnected (van stops, shelter continues). */
    disconnected?: boolean;
    /** Number of random port charges the player has (teleport ability). */
    portCharges?: number;
    /** Number of shelter port charges (teleport to own shelter). */
    shelterPortCharges?: number;
    /** Shelter color (hex like #ff9f43 or gradient like gradient:#color1:#color2). */
    shelterColor?: string;
    /** In-game money earned from adoptions. */
    money?: number;
    /** ID of player's built shelter (if any). */
    shelterId?: string;
    /** True if player has purchased permanent van speed upgrade. */
    vanSpeedUpgrade?: boolean;
}
export declare const PICKUP_TYPE_GROWTH = 0;
export declare const PICKUP_TYPE_SPEED = 1;
export declare const PICKUP_TYPE_PORT = 2;
export declare const PICKUP_TYPE_BREEDER = 3;
export declare const PICKUP_TYPE_SHELTER_PORT = 4;
export declare const PET_TYPE_CAT = 0;
export declare const PET_TYPE_DOG = 1;
export declare const PET_TYPE_BIRD = 2;
export declare const PET_TYPE_RABBIT = 3;
export declare const PET_TYPE_SPECIAL = 4;
export interface PickupState {
    id: string;
    x: number;
    y: number;
    type: number;
    level?: number;
}
/** Stray: in world (insideShelterId null) or inside a shelter. */
export interface PetState {
    id: string;
    x: number;
    y: number;
    vx: number;
    vy: number;
    /** Which shelter holds this pet, or null if stray in world. */
    insideShelterId: string | null;
    /** Pet type (0=cat, 1=dog, 2=bird, 3=rabbit, 4=special). */
    petType: number;
}
/** Fixed adoption zone: shelter enters with pets → adopt out → grow. */
export interface AdoptionZoneState {
    id: string;
    x: number;
    y: number;
    radius: number;
}
/** Stationary shelter building built by player. Van delivers pets here. */
export interface ShelterState {
    id: string;
    ownerId: string;
    x: number;
    y: number;
    /** Has adoption center upgrade - enables adopting at shelter. */
    hasAdoptionCenter: boolean;
    /** Has gravity upgrade - pulls strays toward shelter. */
    hasGravity: boolean;
    /** Has advertising upgrade - increases stray spawn near shelter. */
    hasAdvertising: boolean;
    /** Pet ids currently inside this shelter waiting for adoption. */
    petsInside: string[];
    /** Shelter size - grows with adoptions. */
    size: number;
    /** Total adoptions at this shelter. */
    totalAdoptions: number;
    /** Shelter tier (1-5) - determines visual size cap. Tier 5 is max visual. */
    tier: number;
}
/** Breeder shelter - formed when breeders grow too large, spawns wild strays */
export interface BreederShelterState {
    id: string;
    x: number;
    y: number;
    level: number;
    size: number;
}
/** Adoption event - timed event with specific pet requirements */
export interface AdoptionEvent {
    id: string;
    /** Event type determines name and icon */
    type: 'school_fair' | 'farmers_market' | 'petco_weekend' | 'stadium_night';
    x: number;
    y: number;
    /** Event radius (randomized per event) */
    radius: number;
    /** Required pets to complete event */
    requirements: {
        petType: number;
        count: number;
    }[];
    /** Total pets needed to rescue for this event (70-300) */
    totalNeeded: number;
    /** Total pets rescued so far */
    totalRescued: number;
    /** Current progress per player: playerId -> pet type contributions */
    contributions: {
        [playerId: string]: {
            [petType: number]: number;
        };
    };
    /** Tick when event started */
    startTick: number;
    /** Duration in ticks (60-150 seconds at 25 ticks/sec = 1500-3750 ticks) */
    durationTicks: number;
    /** Score rewards for top contributors */
    rewards: {
        top1: number;
        top2: number;
        top3: number;
        participation: number;
    };
}
/** Karma balance info (shared across games) */
export interface KarmaBalance {
    userId: string;
    displayName: string;
    karmaPoints: number;
}
export declare const BOSS_MILL_HORSE = 0;
export declare const BOSS_MILL_CAT = 1;
export declare const BOSS_MILL_DOG = 2;
export declare const BOSS_MILL_BIRD = 3;
export declare const BOSS_MILL_RABBIT = 4;
/** Ingredient types for boss mode recipes */
export declare const INGREDIENT_BOWL = "bowl";
export declare const INGREDIENT_WATER = "water";
export declare const INGREDIENT_CARROT = "carrot";
export declare const INGREDIENT_APPLE = "apple";
export declare const INGREDIENT_CHICKEN = "chicken";
export declare const INGREDIENT_SEEDS = "seeds";
export declare const INGREDIENT_TREAT = "treat";
/** A single boss mill in the PetMall */
export interface BossMill {
    id: number;
    /** Pet type for this mill (BOSS_MILL_*) */
    petType: number;
    /** Number of pets to rescue */
    petCount: number;
    /** Recipe required per pet: { ingredient: amount } */
    recipe: {
        [ingredient: string]: number;
    };
    /** Ingredients purchased so far */
    purchased: {
        [ingredient: string]: number;
    };
    /** True when all pets rescued */
    completed: boolean;
    /** Position in the PetMall */
    x: number;
    y: number;
}
/** Boss Mode state for solo matches */
export interface BossMode {
    /** Whether boss mode is active */
    active: boolean;
    /** Tick when boss mode started */
    startTick: number;
    /** Time limit in ticks (5 minutes = 7500 ticks at 25Hz) */
    timeLimit: number;
    /** The 5 boss mills */
    mills: BossMill[];
    /** Tycoon patrol position */
    tycoonX: number;
    tycoonY: number;
    /** Which mill the tycoon is currently at or heading to (0-4) */
    tycoonTargetMill: number;
    /** Tick when tycoon will move to next mill */
    tycoonMoveAtTick: number;
    /** Number of mills cleared */
    millsCleared: number;
    /** PetMall center position */
    mallX: number;
    mallY: number;
    /** Which mill the player is currently interacting with (-1 = none) */
    playerAtMill: number;
}
/** Boss Mode state sent to client (subset for rendering) */
export interface BossModeState {
    active: boolean;
    startTick: number;
    timeLimit: number;
    mills: BossMill[];
    tycoonX: number;
    tycoonY: number;
    tycoonTargetMill: number;
    millsCleared: number;
    mallX: number;
    mallY: number;
    playerAtMill: number;
}
/** Match end inventory message (sent via WebSocket JSON) */
export interface MatchEndInventoryMessage {
    type: 'matchEndInventory';
    deposited: {
        rt: number;
        portCharges: number;
    };
    isWinner: boolean;
    strayLoss: boolean;
    /** Karma points awarded (1 for winner in FFA/Teams, 0 otherwise) */
    karmaAwarded?: number;
}
export interface GameSnapshot {
    tick: number;
    matchEndAt: number;
    /** True if match ended by domination or milestone; false or undefined if ended by time. */
    matchEndedEarly?: boolean;
    /** ID of the winner (reached adoption milestone). */
    winnerId?: string;
    /** True if match ended due to >3000 strays (loss for all, no RT). */
    strayLoss?: boolean;
    /** Total adoptions across all players in this match. */
    totalMatchAdoptions?: number;
    /** Current scarcity level (0-3). */
    scarcityLevel?: number;
    /** Match duration in milliseconds since start. */
    matchDurationMs?: number;
    players: PlayerState[];
    pets: PetState[];
    adoptionZones: AdoptionZoneState[];
    pickups: PickupState[];
    /** Player-built shelters (separate from vans). */
    shelters?: ShelterState[];
    /** Breeder shelters - enemy structures that spawn wild strays */
    breederShelters?: BreederShelterState[];
    /** Active adoption events */
    adoptionEvents?: AdoptionEvent[];
    /** Boss mode state (solo only) */
    bossMode?: BossModeState;
    stateHash?: string;
}
