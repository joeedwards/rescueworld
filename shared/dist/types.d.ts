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
}
export declare const PICKUP_TYPE_GROWTH = 0;
export declare const PICKUP_TYPE_SPEED = 1;
export interface PickupState {
    id: string;
    x: number;
    y: number;
    type: number;
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
}
/** Fixed adoption zone: shelter enters with pets → adopt out → grow. */
export interface AdoptionZoneState {
    id: string;
    x: number;
    y: number;
    radius: number;
}
export interface GameSnapshot {
    tick: number;
    matchEndAt: number;
    players: PlayerState[];
    pets: PetState[];
    adoptionZones: AdoptionZoneState[];
    pickups: PickupState[];
    stateHash?: string;
}
