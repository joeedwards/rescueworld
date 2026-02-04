export type Vec2 = { x: number; y: number };

export type InputFlags = number;
export const INPUT_LEFT = 1 << 0;
export const INPUT_RIGHT = 1 << 1;
export const INPUT_UP = 1 << 2;
export const INPUT_DOWN = 1 << 3;
export const INPUT_INTERACT = 1 << 4;  // unused for now; adopt is automatic in zone

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

export const PICKUP_TYPE_GROWTH = 0;
export const PICKUP_TYPE_SPEED = 1;
export const PICKUP_TYPE_PORT = 2; // Random port
export const PICKUP_TYPE_BREEDER = 3;
export const PICKUP_TYPE_SHELTER_PORT = 4; // Teleport to shelter

// Pet types for variety system
export const PET_TYPE_CAT = 0;
export const PET_TYPE_DOG = 1;
export const PET_TYPE_BIRD = 2;
export const PET_TYPE_RABBIT = 3;
export const PET_TYPE_SPECIAL = 4; // Rare golden pet

export interface PickupState {
  id: string;
  x: number;
  y: number;
  type: number; // PICKUP_TYPE_GROWTH | PICKUP_TYPE_SPEED | PICKUP_TYPE_PORT | PICKUP_TYPE_BREEDER
  level?: number; // For breeder camps - their current level
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
  /** Required pets to complete event */
  requirements: { petType: number; count: number }[];
  /** Current progress per player: playerId -> pet type contributions */
  contributions: { [playerId: string]: { [petType: number]: number } };
  /** Tick when event started */
  startTick: number;
  /** Duration in ticks (2-4 minutes at 25 ticks/sec = 3000-6000 ticks) */
  durationTicks: number;
  /** Score rewards for top contributors */
  rewards: { top1: number; top2: number; top3: number; participation: number };
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
  stateHash?: string;
}
