/**
 * Puppy Rescue client: browser-first, 8-directional movement, tap-to-move,
 * prediction for local player, interpolation for others. Connects via
 * signaling -> game WebSocket.
 */

import {
  TICK_RATE,
  TICK_MS,
  MAP_WIDTH,
  MAP_HEIGHT,
  SHELTER_SPEED,
  SHELTER_BASE_RADIUS,
  SHELTER_RADIUS_PER_SIZE,
  PET_RADIUS,
  ADOPTION_ZONE_RADIUS,
  GROWTH_ORB_RADIUS,
  SPEED_BOOST_MULTIPLIER,
  COMBAT_MIN_SIZE,
} from 'shared';
import { PICKUP_TYPE_GROWTH, PICKUP_TYPE_SPEED, PICKUP_TYPE_PORT, PICKUP_TYPE_BREEDER, PICKUP_TYPE_SHELTER_PORT, VAN_MAX_CAPACITY } from 'shared';
import { PET_TYPE_CAT, PET_TYPE_DOG, PET_TYPE_BIRD, PET_TYPE_RABBIT, PET_TYPE_SPECIAL } from 'shared';
import {
  INPUT_LEFT,
  INPUT_RIGHT,
  INPUT_UP,
  INPUT_DOWN,
  encodeInput,
  decodeSnapshot,
  MSG_SNAPSHOT,
} from 'shared';

// Preload images - try multiple paths for different deployment scenarios
const breederMillImage = new Image();
let breederMillImageLoaded = false;

// Try loading from root first, fallback to BASE_URL if it fails
function loadBreederMillImage() {
  const paths = ['/breeder-mill.png', '/rescueworld/breeder-mill.png'];
  let pathIndex = 0;
  
  const tryNextPath = () => {
    if (pathIndex >= paths.length) {
      console.error('Failed to load breeder-mill.png from all paths');
      return;
    }
    breederMillImage.src = paths[pathIndex];
    pathIndex++;
  };
  
  breederMillImage.onload = () => { 
    breederMillImageLoaded = true;
  };
  breederMillImage.onerror = () => { 
    console.warn('Failed to load breeder-mill.png from', breederMillImage.src);
    tryNextPath();
  };
  
  tryNextPath();
}
loadBreederMillImage();

const adoptionEventImage = new Image();
let adoptionEventImageLoaded = false;
function loadAdoptionEventImage() {
  const paths = ['/adoption-event.png', '/rescueworld/adoption-event.png'];
  let pathIndex = 0;
  const tryNextPath = () => {
    if (pathIndex >= paths.length) {
      console.error('[AdoptionEvent] Failed to load adoption-event.png from all paths:', paths);
      return;
    }
    const currentPath = paths[pathIndex];
    console.log(`[AdoptionEvent] Attempting to load image from: ${currentPath}`);
    adoptionEventImage.src = currentPath;
    pathIndex++;
  };
  adoptionEventImage.onload = () => {
    adoptionEventImageLoaded = true;
    console.log(`[AdoptionEvent] Image loaded successfully from: ${adoptionEventImage.src} (${adoptionEventImage.width}x${adoptionEventImage.height})`);
  };
  adoptionEventImage.onerror = (e) => {
    console.error(`[AdoptionEvent] Failed to load from ${adoptionEventImage.src}:`, e);
    tryNextPath();
  };
  tryNextPath();
}
loadAdoptionEventImage();

import type { GameSnapshot, PlayerState, PetState, AdoptionZoneState, PickupState, ShelterState, BreederShelterState, AdoptionEvent } from 'shared';
import {
  playMusic,
  playWelcome,
  playPickupGrowth,
  playPickupSpeed,
  playAdoption,
  playStrayCollected,
  playMatchEnd,
  playAttackWarning,
  updateVanEngine,
  playSpeedBoostWhoosh,
  getMusicEnabled,
  setMusicEnabled,
  getSfxEnabled,
  setSfxEnabled,
} from './audio';

const SIGNALING_URL = (() => {
  const { protocol, host } = window.location;
  const wsProtocol = protocol === 'https:' ? 'wss:' : 'ws:';
  return `${wsProtocol}//${host}/ws-signaling`;
})();

// --- Input state ---
let inputFlags = 0;
let inputSeq = 0;
const keys: Record<string, boolean> = {};

// --- Virtual joystick state ---
let joystickActive = false;
let joystickOriginX = 0;
let joystickOriginY = 0;
let joystickCurrentX = 0;
let joystickCurrentY = 0;
const JOYSTICK_DEADZONE = 15; // pixels from center before movement starts
const JOYSTICK_MAX_RADIUS = 60; // max visual radius

// --- Network ---
let gameWs: WebSocket | null = null;
let myPlayerId: string | null = null;

// --- Game state (from server + interpolation) ---
let latestSnapshot: GameSnapshot | null = null;
const interpolatedPlayers = new Map<string, { prev: PlayerState; next: PlayerState; t: number }>();
const interpolatedPets = new Map<string, { prev: PetState; next: PetState; t: number }>();
const INTERP_BUFFER_MS = 100;

// --- Local prediction (for my player) ---
let predictedPlayer: PlayerState | null = null;
let lastProcessedInputSeq = -1;
let lastKnownSize = 0;
let lastTotalAdoptions = 0;
let lastPetsInsideLength = 0;
let lastShelterPortCharges = 0; // Track shelter port charges for toast notifications
/** Van's pet IDs from previous snapshot (to detect which pets were just adopted) */
let lastPetsInsideIds: string[] = [];
/** Our shelter's pet IDs from previous snapshot (for shelter adoptions) */
let lastShelterPetsInsideIds: string[] = [];
/** Pet ID -> pet type (from previous snapshot) so we can show correct type in adoption animation */
const lastPetTypesById = new Map<string, number>();
let lastSpeedBoostUntil = 0;
let matchEndPlayed = false;
let matchEndTokensAwarded = false;
let growthPopUntil = 0;
let currentRttMs = 0;
let highLatencySince = 0;
let pingIntervalId: ReturnType<typeof setInterval> | null = null;
let serverClockNextMidnightUtc: string | null = null;
let serverClockIntervalId: ReturnType<typeof setInterval> | null = null;
const RTT_HIGH_MS = 200;
const RTT_HIGH_DURATION_MS = 5000;

// --- Render ---
const canvas = document.getElementById('game') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;
const minimap = document.getElementById('minimap') as HTMLCanvasElement;
const minimapCtx = minimap.getContext('2d')!;
const scoreEl = document.getElementById('score')!;
const eventPanelEl = document.getElementById('event-panel')!;
const eventPanelListEl = document.getElementById('event-panel-list')!;
const carriedEl = document.getElementById('carried')!;
const tagCooldownEl = document.getElementById('tag-cooldown')!;
const timerEl = document.getElementById('timer')!;
const gameClockEl = document.getElementById('game-clock')!;
const leaderboardEl = document.getElementById('leaderboard')!;
const connectionOverlayEl = document.getElementById('connection-overlay')!;
const howToPlayEl = document.getElementById('how-to-play')!;
const settingsBtnEl = document.getElementById('settings-btn')!;
const settingsPanelEl = document.getElementById('settings-panel')!;
const exitToLobbyBtnEl = document.getElementById('exit-to-lobby-btn')!;
const musicToggleEl = document.getElementById('music-toggle') as HTMLInputElement;
const sfxToggleEl = document.getElementById('sfx-toggle') as HTMLInputElement;
const settingsCloseEl = document.getElementById('settings-close')!;
const fpsSelectEl = document.getElementById('fps-select') as HTMLSelectElement | null;
const pingEl = document.getElementById('ping')!;
const switchServerEl = document.getElementById('switch-server')!;
const switchServerBtnEl = document.getElementById('switch-server-btn')!;
const authAreaEl = document.getElementById('auth-area')!;
const landingEl = document.getElementById('landing')!;
const gameWrapEl = document.getElementById('game-wrap')!;
const landingPlayBtn = document.getElementById('landing-play')!;
const landingNickInput = document.getElementById('landing-nick') as HTMLInputElement;
const nickSaveBtn = document.getElementById('nick-save-btn') as HTMLButtonElement;
const nickHintEl = document.getElementById('nick-hint') as HTMLElement;
const landingMusicToggleEl = document.getElementById('landing-music-toggle') as HTMLInputElement | null;
const landingProfileName = document.getElementById('landing-profile-name')!;
const landingProfileAvatar = document.getElementById('landing-profile-avatar')!;
const landingProfileActions = document.getElementById('landing-profile-actions')!;
const landingAuthButtons = document.getElementById('landing-auth-buttons')!;
const referralStatusEl = document.getElementById('referral-status')!;
const referralLinkEl = document.getElementById('referral-link')!;
const referralCopyBtn = document.getElementById('referral-copy-btn') as HTMLButtonElement;
const referralClaimBtn = document.getElementById('referral-claim-btn') as HTMLButtonElement;
const cookieBannerEl = document.getElementById('cookie-banner')!;
const cookieAcceptBtn = document.getElementById('cookie-accept')!;
const cookieEssentialBtn = document.getElementById('cookie-essential')!;
const fightAllyOverlayEl = document.getElementById('fight-ally-overlay')!;
const fightAllyNameEl = document.getElementById('fight-ally-name')!;
const fightAllyFightBtn = document.getElementById('fight-ally-fight')!;
const fightAllyAllyBtn = document.getElementById('fight-ally-ally')!;
const cpuWarningEl = document.getElementById('cpu-warning')!;
const actionMenuEl = document.getElementById('action-menu')!;
const actionMenuCloseEl = document.getElementById('action-menu-close')!;
const actionSizeTextEl = document.getElementById('action-size-text')!;
const actionSizeBarEl = document.getElementById('action-size-bar')!;
const actionTokensTextEl = document.getElementById('action-tokens-text')!;
const actionTokensBarEl = document.getElementById('action-tokens-bar')!;
const actionBuildBtnEl = document.getElementById('action-build-btn') as HTMLButtonElement;
// Upgrade menu elements
const actionBuildShelterItemEl = document.getElementById('action-build-shelter')!;
const actionAdoptionCenterItemEl = document.getElementById('action-adoption-center')!;
const actionGravityItemEl = document.getElementById('action-gravity')!;
const actionAdvertisingItemEl = document.getElementById('action-advertising')!;
const actionVanSpeedItemEl = document.getElementById('action-van-speed')!;
const actionAdoptionBtnEl = document.getElementById('action-adoption-btn') as HTMLButtonElement;
const actionGravityBtnEl = document.getElementById('action-gravity-btn') as HTMLButtonElement;
const actionAdvertisingBtnEl = document.getElementById('action-advertising-btn') as HTMLButtonElement;
const actionVanSpeedBtnEl = document.getElementById('action-van-speed-btn') as HTMLButtonElement;
const groundBtnEl = document.getElementById('ground-btn')!;
const portBtnEl = document.getElementById('port-btn')!;
const shelterPortBtnEl = document.getElementById('shelter-port-btn')!;
const transferBtnEl = document.getElementById('transfer-btn')!;
const buildShelterBtnEl = document.getElementById('build-shelter-btn') as HTMLButtonElement;
const centerVanBtnEl = document.getElementById('center-van-btn')!;
const centerShelterBtnEl = document.getElementById('center-shelter-btn')!;
const gameTokensEl = document.getElementById('game-tokens')!;
const lobbyOverlayEl = document.getElementById('lobby-overlay')!;
const lobbyMessageEl = document.getElementById('lobby-message')!;
const lobbyPlayerListEl = document.getElementById('lobby-player-list')!;
const lobbyCountdownEl = document.getElementById('lobby-countdown')!;
const lobbyReadyBtnEl = document.getElementById('lobby-ready-btn')!;
const lobbyBackBtnEl = document.getElementById('lobby-back-btn')!;
const lobbyGiftBtnEl = document.getElementById('lobby-gift-btn')!;

// Breeder Mini-Game Elements
const breederMinigameEl = document.getElementById('breeder-minigame')!;
const breederTimerEl = document.getElementById('breeder-timer')!;
const breederTokensEl = document.getElementById('breeder-tokens')!;
const breederPetsEl = document.getElementById('breeder-pets')!;
const breederFoodsEl = document.getElementById('breeder-foods')!;
const breederResultEl = document.getElementById('breeder-result')!;
const breederResultTitleEl = document.getElementById('breeder-result-title')!;
const breederRewardsEl = document.getElementById('breeder-rewards')!;
const breederCloseBtnEl = document.getElementById('breeder-close-btn')!;

// Daily Gift Elements
const dailyGiftModalEl = document.getElementById('daily-gift-modal')!;
const dailyGiftCloseEl = document.getElementById('daily-gift-close')!;
const dailyGiftSubtitleEl = document.getElementById('daily-gift-subtitle')!;
const dailyGiftGridEl = document.getElementById('daily-gift-grid')!;
const dailyGiftClaimBtnEl = document.getElementById('daily-gift-claim-btn') as HTMLButtonElement;
const dailyGiftBtnEl = document.getElementById('daily-gift-btn')!;

// Server clock (lobby)
const serverClockTimeEl = document.getElementById('server-clock-time')!;
const serverClockNextGiftEl = document.getElementById('server-clock-next-gift')!;

// Leaderboard Elements
const leaderboardModalEl = document.getElementById('leaderboard-modal')!;
const leaderboardCloseEl = document.getElementById('leaderboard-close')!;
const leaderboardContentEl = document.getElementById('leaderboard-content')!;
const leaderboardMyRankEl = document.getElementById('leaderboard-my-rank')!;
const leaderboardBtnEl = document.getElementById('leaderboard-btn')!;
const lobbyLeaderboardContentEl = document.getElementById('lobby-leaderboard-content');

// Live lobby leaderboard: persistent signaling connection for real-time updates
let lobbyLeaderboardWs: WebSocket | null = null;
let lobbyLeaderboardReconnectAttempts = 0;
let lobbyLeaderboardReconnectTimer: ReturnType<typeof setTimeout> | null = null;
const LOBBY_LEADERBOARD_MAX_RECONNECT_DELAY = 30000; // 30 seconds max

// Equipment Panel Elements
const equipRtEl = document.getElementById('equip-rt')!;
const equipPortsEl = document.getElementById('equip-ports')!;
const equipSpeedEl = document.getElementById('equip-speed')!;
const equipSizeEl = document.getElementById('equip-size')!;
const equipNoteEl = document.getElementById('equip-note')!;

// Karma Points Elements (shared across games)
const karmaDisplayEl = document.getElementById('karma-display')!;
const karmaPointsEl = document.getElementById('karma-points')!;

// Karma state (from server)
let currentKarmaPoints = 0;

// Inventory state (from server)
interface Inventory {
  storedRt: number;
  portCharges: number;
  speedBoosts: number;
  sizeBoosts: number;
  signedIn: boolean;
}
let currentInventory: Inventory = { storedRt: 0, portCharges: 0, speedBoosts: 0, sizeBoosts: 0, signedIn: false };

// Breeder Mini-Game State
type PetType = 'dog' | 'cat' | 'horse' | 'bird' | 'rabbit';
type FoodType = 'apple' | 'carrot' | 'chicken' | 'seeds' | 'water' | 'bowl';
interface BreederPet {
  type: PetType;
  rescued: boolean;
}
interface BreederGameState {
  active: boolean;
  pets: BreederPet[];
  selectedPetIndex: number | null;
  timeLeft: number;
  timerInterval: ReturnType<typeof setInterval> | null;
  addPetInterval: ReturnType<typeof setInterval> | null;
  totalPets: number;
  rescuedCount: number;
  level: number;
  selectedIngredients: FoodType[];
  isMill?: boolean;
}
const breederGame: BreederGameState = {
  active: false,
  pets: [],
  selectedPetIndex: null,
  timeLeft: 30,
  timerInterval: null,
  addPetInterval: null,
  totalPets: 0,
  rescuedCount: 0,
  level: 1,
  selectedIngredients: [],
};

// Food costs and pet matching
const FOOD_COSTS: Record<FoodType, number> = {
  apple: 5,
  carrot: 8,
  chicken: 15,
  seeds: 5,
  water: 20,
  bowl: 20,
};

// Simple food matching for level 1-2 (single ingredient)
const FOOD_WORKS_ON: Record<FoodType, PetType[]> = {
  apple: ['horse', 'rabbit'],
  carrot: ['horse', 'bird', 'rabbit'],
  chicken: ['dog', 'cat'],
  seeds: ['bird'],
  water: [], // Water alone doesn't work - needs combination
  bowl: [],  // Bowl alone doesn't work - needs combination
};

// Meal recipes for higher level breeders
// Level 3-5: 2 ingredients, Level 6-9: 3 ingredients (water), Level 10+: 4 ingredients (bowl)
interface MealRecipe {
  ingredients: FoodType[];
  worksOn: PetType[];
}

const MEAL_RECIPES: { [ingredientCount: number]: MealRecipe[] } = {
  // Level 3-5: 2 ingredients
  2: [
    { ingredients: ['chicken', 'carrot'], worksOn: ['dog', 'cat'] },
    { ingredients: ['seeds', 'apple'], worksOn: ['bird'] },
    { ingredients: ['apple', 'carrot'], worksOn: ['horse', 'rabbit'] },
  ],
  // Level 6-9: 3 ingredients (add water)
  3: [
    { ingredients: ['water', 'chicken', 'carrot'], worksOn: ['dog', 'cat'] },
    { ingredients: ['water', 'seeds', 'apple'], worksOn: ['bird'] },
    { ingredients: ['water', 'apple', 'carrot'], worksOn: ['horse', 'rabbit'] },
  ],
  // Level 10+: 4 ingredients (add bowl)
  4: [
    { ingredients: ['bowl', 'water', 'chicken', 'carrot'], worksOn: ['dog', 'cat'] },
    { ingredients: ['bowl', 'water', 'seeds', 'apple'], worksOn: ['bird'] },
    { ingredients: ['bowl', 'water', 'apple', 'carrot'], worksOn: ['horse', 'rabbit'] },
  ],
};

// Get required ingredient count based on breeder level
function getRequiredIngredients(level: number): number {
  if (level <= 2) return 1;
  if (level <= 5) return 2;
  if (level <= 9) return 3;
  return 4; // level 10+
}
const PET_EMOJIS: Record<PetType, string> = {
  dog: '🐕',
  cat: '🐱',
  horse: '🐴',
  bird: '🐦',
  rabbit: '🐰',
};

const COOKIE_CONSENT_KEY = 'cookieConsent';
const MODE_KEY = 'rescueworld_mode';
const FPS_KEY = 'rescueworld_fps';
const REF_KEY = 'rescueworld_ref';
const SKIN_KEY = 'rescueworld_skin_unlocked';
let fightAllyTargetId: string | null = null;
const fightAllyChosenTargets = new Set<string>();
const sentAllyRequests = new Set<string>(); // Track ally requests we've sent (before overlap)
let lastAttackWarnTime = 0;
const ATTACK_WARN_COOLDOWN_MS = 2000;

// Van facing direction: 1 = right, -1 = left
// Persists when stopped so van keeps its last direction
const vanFacingDir = new Map<string, number>();

// Port animation state: tracks players who are porting
interface PortAnimation {
  startTime: number;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  phase: 'fadeOut' | 'fadeIn';
}
const portAnimations = new Map<string, PortAnimation>();
const PORT_ANIMATION_DURATION = 400; // ms for each phase

// Track previous positions to detect teleports
const prevPlayerPositions = new Map<string, { x: number; y: number }>();

// Adoption animation state: floating pets traveling to adoption center
interface AdoptionAnimation {
  id: string;
  startTime: number;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  /** Pet type (PET_TYPE_CAT etc.) so animation shows the actual adopted pet */
  petType: number;
}
const adoptionAnimations: AdoptionAnimation[] = [];
const ADOPTION_ANIMATION_DURATION = 800; // ms
/** Emoji per pet type (PET_TYPE_CAT=0, DOG=1, BIRD=2, RABBIT=3, SPECIAL=4) */
const ADOPTION_PET_EMOJIS: Record<number, string> = {
  [PET_TYPE_CAT]: '🐈',
  [PET_TYPE_DOG]: '🐕',
  [PET_TYPE_BIRD]: '🐦',
  [PET_TYPE_RABBIT]: '🐰',
  [PET_TYPE_SPECIAL]: '⭐',
};
let adoptionAnimationId = 0;

/** Trigger adoption animation with the actual pet types that were adopted (from van or shelter). */
function triggerAdoptionAnimation(fromX: number, fromY: number, toX: number, toY: number, petTypes: number[]): void {
  const now = Date.now();
  for (let i = 0; i < petTypes.length; i++) {
    const petType = petTypes[i] ?? PET_TYPE_CAT;
    const delay = i * 100;
    const offsetX = (Math.random() - 0.5) * 30;
    const offsetY = (Math.random() - 0.5) * 30;
    adoptionAnimations.push({
      id: `adopt-${adoptionAnimationId++}`,
      startTime: now + delay,
      fromX: fromX + offsetX,
      fromY: fromY + offsetY,
      toX,
      toY,
      petType,
    });
  }
}

type MatchPhase = 'lobby' | 'countdown' | 'playing';
let matchPhase: MatchPhase = 'playing';
let countdownRemainingSec = 0;
let readyCount = 0;
let iAmReady = false;
const TOKENS_KEY = 'rescueworld_tokens';
const COLOR_KEY = 'rescueworld_color';
const UNLOCKED_COLORS_KEY = 'rescueworld_unlocked_colors';
const BOOST_PRICES = { size: 50, speed: 30, adoptSpeed: 40 } as const;
const COLOR_PRICES = { preset: 50, custom: 200, gradient: 500 } as const;
const FREE_COLORS = ['#7bed9f', '#70a3ff', '#ff9f43'];
const PRESET_COLORS = ['#e74c3c', '#9b59b6', '#f1c40f', '#1abc9c', '#e91e63', '#00bcd4'];

type AuthMe = { displayName: string | null; signedIn: boolean; userId: string | null; shelterColor: string | null };
type ReferralInfo = {
  referralCode: string;
  referralCount: number;
  rewardEligible: boolean;
  rewardClaimed: boolean;
  rewardType: string;
  rewardThreshold: number;
  tokensBonus: number;
};
let selectedMode: 'ffa' | 'teams' | 'solo' = 'ffa';
let hasSavedMatch = false;
const pendingBoosts = { sizeBonus: 0, speedBoost: false, adoptSpeed: false };
let currentDisplayName: string | null = null;
let isSignedIn = false;
let currentUserId: string | null = null;
let currentShelterColor: string | null = null;

// Track active FFA/Teams match for rejoin
interface ActiveMultiplayerMatch {
  matchId: string;
  mode: 'ffa' | 'teams';
}
let activeMultiplayerMatch: ActiveMultiplayerMatch | null = null;
const ACTIVE_MP_MATCH_KEY = 'rescueworld_active_mp_match';

function getActiveMultiplayerMatch(): ActiveMultiplayerMatch | null {
  try {
    const stored = localStorage.getItem(ACTIVE_MP_MATCH_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      if (parsed.matchId && (parsed.mode === 'ffa' || parsed.mode === 'teams')) {
        return parsed;
      }
    }
  } catch { /* ignore */ }
  return null;
}

function setActiveMultiplayerMatch(match: ActiveMultiplayerMatch | null): void {
  activeMultiplayerMatch = match;
  if (match) {
    localStorage.setItem(ACTIVE_MP_MATCH_KEY, JSON.stringify(match));
  } else {
    localStorage.removeItem(ACTIVE_MP_MATCH_KEY);
  }
}

/** Get short match ID for display (last 6 chars of hash) */
function getShortMatchId(matchId: string): string {
  // Match ID format: match-xxxx-x, we want the unique part
  const parts = matchId.split('-');
  if (parts.length >= 2) {
    return parts.slice(1).join('-').toUpperCase().slice(-6);
  }
  return matchId.slice(-6).toUpperCase();
}

// Track current matchId for FFA/Teams
let currentMatchId: string | null = null;

function getTokens(): number {
  return parseInt(localStorage.getItem(TOKENS_KEY) || '0', 10);
}
function setTokens(n: number): void {
  localStorage.setItem(TOKENS_KEY, String(Math.max(0, n)));
}
function updateLandingTokens(): void {
  const el = document.getElementById('landing-tokens');
  if (el) el.textContent = `Tokens: ${getTokens()} RT`;
  const m = getTokens();
  document.querySelectorAll('.landing-buy').forEach((btn) => {
    const b = (btn as HTMLElement).dataset.boost as keyof typeof BOOST_PRICES;
    if (!b || !(b in BOOST_PRICES)) return;
    const price = BOOST_PRICES[b as keyof typeof BOOST_PRICES];
    (btn as HTMLButtonElement).disabled = m < price || (b === 'speed' && pendingBoosts.speedBoost) || (b === 'adoptSpeed' && pendingBoosts.adoptSpeed);
  });
}

// Color management
function getSelectedColor(): string {
  return localStorage.getItem(COLOR_KEY) || '#7bed9f';
}
function setSelectedColor(color: string): void {
  localStorage.setItem(COLOR_KEY, color);
  // Save to profile if signed in
  if (isSignedIn) {
    fetch('/auth/profile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ shelterColor: color }),
    }).catch(() => {}); // Ignore errors
  }
}
function getUnlockedColors(): { preset: boolean; custom: string | null; gradient: string | null } {
  try {
    const data = localStorage.getItem(UNLOCKED_COLORS_KEY);
    if (data) return JSON.parse(data);
  } catch { /* ignore */ }
  return { preset: false, custom: null, gradient: null };
}
function setUnlockedColors(data: { preset: boolean; custom: string | null; gradient: string | null }): void {
  localStorage.setItem(UNLOCKED_COLORS_KEY, JSON.stringify(data));
}
function updateColorUI(): void {
  const selected = getSelectedColor();
  const unlocked = getUnlockedColors();
  const m = getTokens();
  
  // Update free color buttons
  document.querySelectorAll('.color-btn').forEach((btn) => {
    const color = (btn as HTMLElement).dataset.color;
    btn.classList.toggle('selected', color === selected);
  });
  
  // Update preset colors row
  const presetRow = document.getElementById('preset-colors-row');
  if (presetRow) {
    presetRow.style.display = unlocked.preset ? 'flex' : 'none';
    presetRow.querySelectorAll('.preset-color').forEach((btn) => {
      const color = (btn as HTMLElement).dataset.color;
      btn.classList.toggle('selected', color === selected);
    });
  }
  
  // Update buy buttons
  document.querySelectorAll('.color-buy').forEach((btn) => {
    const colorType = (btn as HTMLElement).dataset.color as keyof typeof COLOR_PRICES;
    const price = COLOR_PRICES[colorType];
    const isUnlocked = colorType === 'preset' ? unlocked.preset : 
                       colorType === 'custom' ? !!unlocked.custom :
                       !!unlocked.gradient;
    (btn as HTMLButtonElement).disabled = isUnlocked || m < price;
    btn.classList.toggle('unlocked', isUnlocked);
    if (isUnlocked) {
      if (colorType === 'preset') (btn as HTMLElement).textContent = 'Preset Colors Unlocked';
      else if (colorType === 'custom') (btn as HTMLElement).textContent = 'Custom Color: Click to use';
      else if (colorType === 'gradient') (btn as HTMLElement).textContent = 'Gradient: Click to use';
    }
  });
}

let toastTimeout: ReturnType<typeof setTimeout> | null = null;
function showToast(message: string, type: 'success' | 'error' | 'info' = 'info', allowHtml: boolean = false): void {
  let toastEl = document.getElementById('toast');
  if (!toastEl) {
    toastEl = document.createElement('div');
    toastEl.id = 'toast';
    toastEl.className = 'toast';
    document.body.appendChild(toastEl);
  }
  
  // Use innerHTML if allowed (for server shutdown message), otherwise textContent for security
  if (allowHtml) {
    toastEl.innerHTML = message;
  } else {
    toastEl.textContent = message;
  }
  
  // Set color based on type
  toastEl.classList.remove('toast-success', 'toast-error', 'toast-info');
  toastEl.classList.add(`toast-${type}`);
  if (type === 'success') {
    toastEl.style.background = 'linear-gradient(135deg, #2ecc71 0%, #27ae60 100%)';
  } else if (type === 'error') {
    toastEl.style.background = 'linear-gradient(135deg, #e74c3c 0%, #c0392b 100%)';
  } else {
    toastEl.style.background = 'linear-gradient(135deg, #3498db 0%, #2980b9 100%)';
  }
  toastEl.classList.add('show');
  if (toastTimeout) clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => {
    toastEl!.classList.remove('show');
  }, 3000);
}

// Match-wide announcement system
const announcementQueue: string[] = [];
let announcementEl: HTMLElement | null = null;
let announcementAnimating = false;

function showAnnouncement(messages: string[]): void {
  // Limit queue size to prevent announcements from getting too stale
  // If queue is already backed up, drop older announcements
  const MAX_QUEUE_SIZE = 3;
  announcementQueue.push(...messages);
  while (announcementQueue.length > MAX_QUEUE_SIZE) {
    announcementQueue.shift(); // Drop oldest
  }
  processAnnouncementQueue();
}

/** Clear all pending announcements and hide the banner immediately (used when exiting to lobby) */
function clearAnnouncements(): void {
  announcementQueue.length = 0;
  announcementAnimating = false;
  if (announcementEl) {
    announcementEl.style.display = 'none';
    announcementEl.innerHTML = '';
  }
}

function processAnnouncementQueue(): void {
  if (announcementAnimating || announcementQueue.length === 0) return;
  
  const message = announcementQueue.shift()!;
  announcementAnimating = true;
  
  // Determine if this is a positive (green) or negative (red) announcement
  // GREEN: rescuing pets, adoption events, shutting down camps - GOOD things
  // RED: breeders arriving, stray warnings, failed attempts - BAD things
  const positiveKeywords = [
    'rescued', 'shut down', 'destroyed', 'saved', 'stopped', 'is shutting down',
    'farmers market', 'school fair', 'petco', 'stadium', 'event started', 'partial win',
    'dropped off', 'instant adoption', 'won '
  ];
  const negativeKeywords = [
    'arrived', 'appeared', 'failed', 'formed', 'expanding', 'breeding',
    'warning', 'danger', 'urgent', 'critical', 'strays on the map', 'game over at'
  ];
  
  const msgLower = message.toLowerCase();
  const isPositive = positiveKeywords.some(kw => msgLower.includes(kw));
  const isNegative = negativeKeywords.some(kw => msgLower.includes(kw));
  
  // If explicitly positive, use green; if negative (warnings), use red; else green for neutral/event
  const useGreen = (isPositive && !isNegative) || (!isNegative && (msgLower.includes('event') || msgLower.includes('adoption')));
  
  // Colors based on message type
  const bgColor = useGreen ? 'rgba(46,204,113,' : 'rgba(255,107,107,'; // green or red
  const glowColor = useGreen ? 'rgba(46,204,113,0.8)' : 'rgba(255,107,107,0.8)';
  const icon = useGreen ? '✅' : '⚠️';
  
  // Create or get announcement container
  if (!announcementEl) {
    announcementEl = document.createElement('div');
    announcementEl.id = 'announcement-bar';
    document.body.appendChild(announcementEl);
  }
  
  // Update background color based on message type
  announcementEl.style.cssText = `
    position: fixed;
    top: 60px;
    left: 0;
    width: 100%;
    height: 40px;
    background: linear-gradient(90deg, ${bgColor}0) 0%, ${bgColor}0.4) 15%, ${bgColor}0.4) 85%, ${bgColor}0) 100%);
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
    z-index: 150;
    pointer-events: none;
  `;
  
  // Create scrolling text - 8s animation (slower for readability)
  const textEl = document.createElement('div');
  textEl.style.cssText = `
    white-space: nowrap;
    font: bold 18px 'Rubik', sans-serif;
    color: #fff;
    text-shadow: 2px 2px 4px rgba(0,0,0,0.8), 0 0 10px ${glowColor};
    animation: announcementScroll 8s linear forwards;
  `;
  textEl.textContent = `${icon} ${message} ${icon}`;
  
  // Add animation keyframes if not already added
  if (!document.getElementById('announcement-keyframes')) {
    const style = document.createElement('style');
    style.id = 'announcement-keyframes';
    style.textContent = `
      @keyframes announcementScroll {
        0% { transform: translateX(100vw); opacity: 0; }
        5% { opacity: 1; }
        95% { opacity: 1; }
        100% { transform: translateX(-100vw); opacity: 0; }
      }
    `;
    document.head.appendChild(style);
  }
  
  announcementEl.style.display = 'flex'; // Show bar when new announcement
  announcementEl.innerHTML = '';
  announcementEl.appendChild(textEl);
  
  // When animation ends, hide bar and process next in queue
  textEl.addEventListener('animationend', () => {
    announcementAnimating = false;
    // Hide the bar if no more announcements
    if (announcementQueue.length === 0 && announcementEl) {
      announcementEl.style.display = 'none';
    }
    processAnnouncementQueue();
  });
}

// --- Ally Request Popup ---
const allyRequestPopupEl = document.getElementById('ally-request-popup') as HTMLElement;
const allyRequesterNameEl = document.getElementById('ally-requester-name') as HTMLElement;
const allyAcceptBtnEl = document.getElementById('ally-accept-btn') as HTMLButtonElement;
const allyDenyBtnEl = document.getElementById('ally-deny-btn') as HTMLButtonElement;
let pendingAllyRequestFromId: string | null = null;
let allyRequestTimeout: ReturnType<typeof setTimeout> | null = null;

function showAllyRequestPopup(fromId: string, fromName: string): void {
  if (!allyRequestPopupEl || !allyRequesterNameEl) return;
  pendingAllyRequestFromId = fromId;
  allyRequesterNameEl.textContent = fromName;
  allyRequestPopupEl.classList.remove('hidden');
  
  // Auto-hide after 10 seconds
  if (allyRequestTimeout) clearTimeout(allyRequestTimeout);
  allyRequestTimeout = setTimeout(() => {
    hideAllyRequestPopup();
  }, 10000);
}

function hideAllyRequestPopup(): void {
  if (allyRequestPopupEl) allyRequestPopupEl.classList.add('hidden');
  pendingAllyRequestFromId = null;
  if (allyRequestTimeout) {
    clearTimeout(allyRequestTimeout);
    allyRequestTimeout = null;
  }
}

function respondToAllyRequest(accept: boolean): void {
  if (!pendingAllyRequestFromId || !gameWs || gameWs.readyState !== WebSocket.OPEN) return;
  gameWs.send(JSON.stringify({ 
    type: 'allyResponse', 
    targetId: pendingAllyRequestFromId, 
    accept 
  }));
  hideAllyRequestPopup();
}

if (allyAcceptBtnEl) {
  allyAcceptBtnEl.addEventListener('click', () => respondToAllyRequest(true));
}

// --- Transfer confirmation popup ---
const transferConfirmPopupEl = document.getElementById('transfer-confirm-popup') as HTMLElement;
const transferConfirmCountEl = document.getElementById('transfer-confirm-count') as HTMLElement;
const transferConfirmBtnEl = document.getElementById('transfer-confirm-btn') as HTMLButtonElement;
const transferCancelBtnEl = document.getElementById('transfer-cancel-btn') as HTMLButtonElement;
let pendingTransferShelterId: string | null = null;

function showTransferConfirmPopup(petCount: number, targetShelterId: string): void {
  if (!transferConfirmPopupEl || !transferConfirmCountEl) return;
  pendingTransferShelterId = targetShelterId;
  transferConfirmCountEl.textContent = String(petCount);
  transferConfirmPopupEl.classList.remove('hidden');
}

function hideTransferConfirmPopup(): void {
  if (transferConfirmPopupEl) transferConfirmPopupEl.classList.add('hidden');
  pendingTransferShelterId = null;
}

if (transferConfirmBtnEl) {
  transferConfirmBtnEl.addEventListener('click', () => {
    if (!gameWs || gameWs.readyState !== WebSocket.OPEN || !pendingTransferShelterId) return;
    gameWs.send(JSON.stringify({ type: 'transferPets', targetShelterId: pendingTransferShelterId }));
    hideTransferConfirmPopup();
  });
}
if (transferCancelBtnEl) {
  transferCancelBtnEl.addEventListener('click', hideTransferConfirmPopup);
}
if (allyDenyBtnEl) {
  allyDenyBtnEl.addEventListener('click', () => respondToAllyRequest(false));
}

// --- Abandon match confirmation popup ---
const abandonConfirmPopupEl = document.getElementById('abandon-confirm-popup') as HTMLElement;
const abandonConfirmBtnEl = document.getElementById('abandon-confirm-btn') as HTMLButtonElement;
const abandonCancelBtnEl = document.getElementById('abandon-cancel-btn') as HTMLButtonElement;
let pendingAbandonCallback: (() => void) | null = null;

function showAbandonConfirmPopup(onConfirm: () => void): void {
  if (!abandonConfirmPopupEl) return;
  pendingAbandonCallback = onConfirm;
  abandonConfirmPopupEl.classList.remove('hidden');
}

function hideAbandonConfirmPopup(): void {
  if (abandonConfirmPopupEl) abandonConfirmPopupEl.classList.add('hidden');
  pendingAbandonCallback = null;
}

if (abandonConfirmBtnEl) {
  abandonConfirmBtnEl.addEventListener('click', () => {
    if (pendingAbandonCallback) pendingAbandonCallback();
    hideAbandonConfirmPopup();
  });
}
if (abandonCancelBtnEl) {
  abandonCancelBtnEl.addEventListener('click', hideAbandonConfirmPopup);
}

function getReferralBasePath(): string {
  const pathname = window.location.pathname;
  if (pathname.includes('rescueworld')) return '/rescueworld/';
  const lastSlash = pathname.lastIndexOf('/');
  return lastSlash <= 0 ? '/' : pathname.slice(0, lastSlash + 1);
}

function storeReferralFromUrl(): void {
  try {
    const url = new URL(window.location.href);
    const ref = url.searchParams.get('ref');
    if (ref) {
      localStorage.setItem(REF_KEY, ref);
      url.searchParams.delete('ref');
      window.history.replaceState({}, document.title, url.toString());
    }
  } catch {
    // ignore
  }
}

function getStoredReferralCode(): string | null {
  try {
    const ref = localStorage.getItem(REF_KEY);
    return ref && ref.length ? ref : null;
  } catch {
    return null;
  }
}

function buildAuthUrl(path: string): string {
  const ref = getStoredReferralCode();
  return ref ? `${path}?ref=${encodeURIComponent(ref)}` : path;
}

function buildReferralLink(code: string): string {
  const base = getReferralBasePath();
  return `${window.location.origin}${base}?ref=${encodeURIComponent(code)}`;
}

let referralInfo: ReferralInfo | null = null;

async function fetchReferralInfo(): Promise<void> {
  if (!isSignedIn) {
    referralInfo = null;
    return;
  }
  try {
    const res = await fetch('/referrals/me', { credentials: 'include' });
    if (!res.ok) {
      referralInfo = null;
      return;
    }
    referralInfo = (await res.json()) as ReferralInfo;
  } catch {
    referralInfo = null;
  }
}

function updateReferralUI(): void {
  if (!isSignedIn || !referralInfo) {
    referralStatusEl.textContent = 'Sign in to get your referral link.';
    referralLinkEl.classList.add('referral-hidden');
    referralCopyBtn.classList.add('referral-hidden');
    referralClaimBtn.classList.add('referral-hidden');
    return;
  }

  const link = buildReferralLink(referralInfo.referralCode);
  referralStatusEl.textContent = `Referrals: ${referralInfo.referralCount}/${referralInfo.rewardThreshold} (OAuth signups)`;
  referralLinkEl.textContent = link;
  referralLinkEl.classList.remove('referral-hidden');
  referralCopyBtn.classList.remove('referral-hidden');

  const showClaim = referralInfo.rewardEligible && !referralInfo.rewardClaimed;
  if (showClaim) referralClaimBtn.classList.remove('referral-hidden');
  else referralClaimBtn.classList.add('referral-hidden');
}

async function fetchSavedMatchStatus(): Promise<void> {
  if (!currentUserId) {
    hasSavedMatch = false;
    updateResumeMatchUI();
    return;
  }
  try {
    const res = await fetch('/api/saved-match', { credentials: 'include' });
    const data = await res.json();
    hasSavedMatch = !!data.hasSavedMatch;
  } catch {
    hasSavedMatch = false;
  }
  updateResumeMatchUI();
}

function updateResumeMatchUI(): void {
  const resumeBtn = document.getElementById('resume-match-btn');
  const playBtn = document.getElementById('landing-play');
  if (!resumeBtn || !playBtn) return;
  
  // Check for solo saved match
  if (hasSavedMatch && selectedMode === 'solo') {
    resumeBtn.classList.remove('hidden');
    resumeBtn.textContent = 'Resume Match';
    playBtn.textContent = 'Start new game';
    return;
  }
  
  // Check for active FFA/Teams match (load from storage if needed)
  if (!activeMultiplayerMatch) {
    activeMultiplayerMatch = getActiveMultiplayerMatch();
  }
  
  // Show return button for FFA/Teams if there's an active match AND the selected mode matches
  if (activeMultiplayerMatch && isSignedIn && selectedMode === activeMultiplayerMatch.mode) {
    const shortId = getShortMatchId(activeMultiplayerMatch.matchId);
    resumeBtn.classList.remove('hidden');
    resumeBtn.textContent = `Return to Match '${shortId}'`;
    playBtn.textContent = 'Abandon & New Match';
    return;
  }
  
  // No active match to resume
  resumeBtn.classList.add('hidden');
  resumeBtn.textContent = 'Resume Match';
  playBtn.textContent = 'Play';
}

async function fetchAndRenderAuth(): Promise<void> {
  try {
    const res = await fetch('/auth/me', { credentials: 'include' });
    const data: AuthMe = await res.json();
    const { displayName, signedIn, userId, shelterColor } = data;
    const name = displayName ?? '';
    currentDisplayName = name || null;
    isSignedIn = signedIn;
    currentUserId = userId;
    currentShelterColor = shelterColor;
    // Apply shelter color from profile if signed in and color is set
    if (signedIn && shelterColor) {
      localStorage.setItem(COLOR_KEY, shelterColor);
    }
    if (signedIn && name) {
      authAreaEl.innerHTML = `
        <span class="auth-profile">${escapeHtml(name)}</span>
        <a href="/auth/signout" class="auth-link">Sign out</a>
      `;
      landingProfileName.textContent = name;
      landingProfileAvatar.textContent = name.charAt(0).toUpperCase();
      landingProfileActions.innerHTML = `<a href="/auth/signout" class="auth-link" style="font-size:12px">Sign out</a>`;
      // Hide "Sign in with Google" button when already signed in (sign out button is in profile actions)
      landingAuthButtons.innerHTML = '';
      if (landingNickInput) landingNickInput.placeholder = name;
    } else {
      const guestLabel = name ? `${escapeHtml(name)}` : 'Guest';
      authAreaEl.innerHTML = `
        <a href="${buildAuthUrl('/auth/google')}" class="auth-link">Sign in with Google</a>
        <span class="auth-guest">${guestLabel}</span>
      `;
      landingProfileName.textContent = name || 'Guest';
      landingProfileAvatar.textContent = name ? name.charAt(0).toUpperCase() : '?';
      landingProfileActions.innerHTML = '';
      landingAuthButtons.innerHTML = `
        <a href="${buildAuthUrl('/auth/google')}">Sign in with Google</a>
      `;
      if (landingNickInput) landingNickInput.placeholder = name || 'Nickname';
    }
    if (landingNickInput && name) landingNickInput.value = name;
  } catch {
    currentDisplayName = null;
    isSignedIn = false;
    authAreaEl.innerHTML = `
      <a href="${buildAuthUrl('/auth/google')}" class="auth-link">Sign in with Google</a>
      <span class="auth-guest">Guest</span>
    `;
    landingProfileName.textContent = 'Guest';
    landingProfileAvatar.textContent = '?';
    landingProfileActions.innerHTML = '';
    landingAuthButtons.innerHTML = `<a href="${buildAuthUrl('/auth/google')}">Sign in with Google</a>`;
    if (landingNickInput) landingNickInput.placeholder = 'Nickname';
  }
  await fetchReferralInfo();
  updateReferralUI();
  await fetchDailyGiftStatus();
  await fetchSavedMatchStatus();
  
  // Check for new registration (from OAuth redirect)
  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.get('registered') === '1' && isSignedIn) {
    // Show registration gift welcome message
    setTimeout(() => {
      showToast('Welcome! Registration gift: 50 RT + Day 1 gift claimed!', 'success');
      // Clean up the URL
      window.history.replaceState({}, '', window.location.pathname);
    }, 500);
  }
}

// Save nickname to profile
async function saveNickname(): Promise<void> {
  const nickname = landingNickInput?.value?.trim();
  if (!nickname || nickname.length < 1) {
    if (nickHintEl) nickHintEl.textContent = 'Enter a nickname first!';
    return;
  }
  
  if (isSignedIn) {
    try {
      const res = await fetch('/auth/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ nickname }),
      });
      const data = await res.json();
      if (data.success) {
        currentDisplayName = data.displayName;
        landingProfileName.textContent = data.displayName;
        landingProfileAvatar.textContent = data.displayName.charAt(0).toUpperCase();
        if (nickSaveBtn) {
          nickSaveBtn.textContent = 'Saved!';
          nickSaveBtn.classList.add('saved');
          setTimeout(() => {
            nickSaveBtn.textContent = 'Save';
            nickSaveBtn.classList.remove('saved');
          }, 2000);
        }
        if (nickHintEl) nickHintEl.textContent = '';
      }
    } catch {
      if (nickHintEl) nickHintEl.textContent = 'Failed to save';
    }
  } else {
    // Guest - just update locally
    currentDisplayName = nickname;
    landingProfileName.textContent = nickname;
    landingProfileAvatar.textContent = nickname.charAt(0).toUpperCase();
    if (nickSaveBtn) {
      nickSaveBtn.textContent = 'Saved!';
      nickSaveBtn.classList.add('saved');
      setTimeout(() => {
        nickSaveBtn.textContent = 'Save';
        nickSaveBtn.classList.remove('saved');
      }, 2000);
    }
    if (nickHintEl) nickHintEl.textContent = 'Sign in to save permanently';
  }
}

// Save button click
if (nickSaveBtn) {
  nickSaveBtn.addEventListener('click', saveNickname);
}

// Save on Enter key
if (landingNickInput) {
  landingNickInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      saveNickname();
    }
  });
}

async function getOrCreateDisplayName(): Promise<string> {
  // If user typed a nickname, use that
  const nickInput = landingNickInput?.value?.trim();
  if (nickInput) {
    // If signed in and nickname changed, save to profile
    if (isSignedIn && nickInput !== currentDisplayName) {
      try {
        await fetch('/auth/profile', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ nickname: nickInput }),
        });
      } catch {
        // Ignore errors
      }
    }
    currentDisplayName = nickInput;
    return nickInput;
  }
  // If we already have a name from /auth/me, use it
  if (currentDisplayName) {
    return currentDisplayName;
  }
  // Otherwise, create a guest name
  try {
    const res = await fetch('/auth/guest', { method: 'POST', credentials: 'include' });
    const data = await res.json();
    if (data.displayName) {
      currentDisplayName = data.displayName;
      // Update the UI
      landingProfileName.textContent = data.displayName;
      landingProfileAvatar.textContent = data.displayName.charAt(0).toUpperCase();
      return data.displayName;
    }
  } catch {
    // Fallback to random name
  }
  const fallback = `rescue${Date.now().toString(36)}`;
  currentDisplayName = fallback;
  return fallback;
}

function escapeHtml(s: string): string {
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}

function resize(): void {
  const w = window.innerWidth;
  const h = window.innerHeight;
  canvas.width = w;
  canvas.height = h;
}

// --- Input handling ---
function setInputFlag(flag: number, on: boolean): void {
  if (on) inputFlags |= flag;
  else inputFlags &= ~flag;
}

let wasPlayerObserver = false;
function isPlayerObserver(): boolean {
  const me = latestSnapshot?.players.find((p) => p.id === myPlayerId);
  return me?.eliminated === true;
}

function checkObserverModeStart(): void {
  const isObserver = isPlayerObserver();
  if (isObserver && !wasPlayerObserver) {
    // Just got eliminated - initialize observer camera at player's last position
    const me = latestSnapshot?.players.find((p) => p.id === myPlayerId);
    if (me) {
      observerCameraX = me.x;
      observerCameraY = me.y;
    }
  }
  wasPlayerObserver = isObserver;
}

function onKeyDown(e: KeyboardEvent): void {
  // Don't intercept keyboard events when typing in input fields
  const target = e.target as HTMLElement;
  if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
    return; // Let the input handle the key normally
  }
  
  keys[e.code] = true;
  
  // Block movement during breeder mini-game
  if (breederGame.active) {
    e.preventDefault();
    return;
  }
  
  // Observer mode: use keys for camera panning instead of movement
  if (isPlayerObserver()) {
    e.preventDefault();
    return; // Handle panning in tick loop
  }
  
  if (e.code === 'KeyW' || e.code === 'ArrowUp') setInputFlag(INPUT_UP, true);
  if (e.code === 'KeyS' || e.code === 'ArrowDown') setInputFlag(INPUT_DOWN, true);
  if (e.code === 'KeyA' || e.code === 'ArrowLeft') setInputFlag(INPUT_LEFT, true);
  if (e.code === 'KeyD' || e.code === 'ArrowRight') setInputFlag(INPUT_RIGHT, true);
  e.preventDefault();
}

function onKeyUp(e: KeyboardEvent): void {
  keys[e.code] = false;
  
  // Block movement during breeder mini-game
  if (breederGame.active) {
    e.preventDefault();
    return;
  }
  
  // Observer mode: don't change movement flags
  if (isPlayerObserver()) {
    e.preventDefault();
    return;
  }
  
  if (e.code === 'KeyW' || e.code === 'ArrowUp') setInputFlag(INPUT_UP, false);
  if (e.code === 'KeyS' || e.code === 'ArrowDown') setInputFlag(INPUT_DOWN, false);
  if (e.code === 'KeyA' || e.code === 'ArrowLeft') setInputFlag(INPUT_LEFT, false);
  if (e.code === 'KeyD' || e.code === 'ArrowRight') setInputFlag(INPUT_RIGHT, false);
  e.preventDefault();
}

function hasMovementKeyDown(): boolean {
  return !!(keys['KeyW'] || keys['KeyS'] || keys['KeyA'] || keys['KeyD'] ||
    keys['ArrowUp'] || keys['ArrowDown'] || keys['ArrowLeft'] || keys['ArrowRight']);
}

function applyJoystickToInput(): void {
  if (hasMovementKeyDown()) return;
  
  // Block joystick movement during breeder mini-game
  if (breederGame.active) {
    setInputFlag(INPUT_LEFT, false);
    setInputFlag(INPUT_RIGHT, false);
    setInputFlag(INPUT_UP, false);
    setInputFlag(INPUT_DOWN, false);
    return;
  }
  
  if (!joystickActive) {
    // Clear all movement flags when joystick is inactive
    setInputFlag(INPUT_LEFT, false);
    setInputFlag(INPUT_RIGHT, false);
    setInputFlag(INPUT_UP, false);
    setInputFlag(INPUT_DOWN, false);
    return;
  }
  const dx = joystickCurrentX - joystickOriginX;
  const dy = joystickCurrentY - joystickOriginY;
  const dist = Math.hypot(dx, dy);
  
  if (dist < JOYSTICK_DEADZONE) {
    // Inside deadzone - no movement
    setInputFlag(INPUT_LEFT, false);
    setInputFlag(INPUT_RIGHT, false);
    setInputFlag(INPUT_UP, false);
    setInputFlag(INPUT_DOWN, false);
    return;
  }
  
  // Normalize direction
  const nx = dx / dist;
  const ny = dy / dist;
  
  // Apply input based on direction (threshold at 0.3 for diagonal support)
  setInputFlag(INPUT_LEFT, nx < -0.3);
  setInputFlag(INPUT_RIGHT, nx > 0.3);
  setInputFlag(INPUT_UP, ny < -0.3);
  setInputFlag(INPUT_DOWN, ny > 0.3);
}

canvas.addEventListener('touchstart', (e) => {
  e.preventDefault();
  if (e.touches.length) {
    joystickActive = true;
    joystickOriginX = e.touches[0].clientX;
    joystickOriginY = e.touches[0].clientY;
    joystickCurrentX = joystickOriginX;
    joystickCurrentY = joystickOriginY;
  }
}, { passive: false });

canvas.addEventListener('touchmove', (e) => {
  e.preventDefault();
  if (e.touches.length && joystickActive) {
    joystickCurrentX = e.touches[0].clientX;
    joystickCurrentY = e.touches[0].clientY;
  }
}, { passive: false });

function sendInputImmediately(): void {
  if (gameWs?.readyState === WebSocket.OPEN) {
    const buf = encodeInput(inputFlags, inputSeq++);
    gameWs.send(buf);
  }
}

canvas.addEventListener('touchend', (e) => {
  e.preventDefault();
  if (e.touches.length === 0) {
    joystickActive = false;
    // Immediately clear input flags and send to server
    setInputFlag(INPUT_LEFT, false);
    setInputFlag(INPUT_RIGHT, false);
    setInputFlag(INPUT_UP, false);
    setInputFlag(INPUT_DOWN, false);
    sendInputImmediately(); // Send stop immediately to prevent momentum
  }
}, { passive: false });

canvas.addEventListener('touchcancel', (e) => {
  e.preventDefault();
  joystickActive = false;
  setInputFlag(INPUT_LEFT, false);
  setInputFlag(INPUT_RIGHT, false);
  setInputFlag(INPUT_UP, false);
  setInputFlag(INPUT_DOWN, false);
  sendInputImmediately(); // Send stop immediately to prevent momentum
}, { passive: false });
// Observer mode drag state
let observerDragging = false;
let observerDragStartX = 0;
let observerDragStartY = 0;

canvas.addEventListener('mousedown', (e) => {
  e.preventDefault();
  if (isPlayerObserver()) {
    observerDragging = true;
    observerDragStartX = e.clientX;
    observerDragStartY = e.clientY;
  }
});
canvas.addEventListener('mousemove', (e) => {
  e.preventDefault();
  if (isPlayerObserver() && observerDragging) {
    const dx = e.clientX - observerDragStartX;
    const dy = e.clientY - observerDragStartY;
    observerCameraX -= dx;
    observerCameraY -= dy;
    // Clamp to map bounds
    observerCameraX = Math.max(canvas.width / 2, Math.min(MAP_WIDTH - canvas.width / 2, observerCameraX));
    observerCameraY = Math.max(canvas.height / 2, Math.min(MAP_HEIGHT - canvas.height / 2, observerCameraY));
    observerDragStartX = e.clientX;
    observerDragStartY = e.clientY;
  }
});
canvas.addEventListener('mouseup', (e) => {
  e.preventDefault();
  observerDragging = false;
});
canvas.addEventListener('contextmenu', (e) => {
  e.preventDefault();
});

// --- Click/Tap on other shelters to send ally request ---
function handleAllyRequestAtPosition(screenX: number, screenY: number): void {
  if (!latestSnapshot || !myPlayerId || !gameWs || gameWs.readyState !== WebSocket.OPEN) return;
  const cam = getCamera();
  const worldX = screenX + cam.x;
  const worldY = screenY + cam.y;
  // Check if click is on another player's shelter
  for (const pl of latestSnapshot.players) {
    if (pl.id === myPlayerId) continue;
    if (pl.eliminated) continue;
    const half = SHELTER_BASE_RADIUS + pl.size * SHELTER_RADIUS_PER_SIZE;
    if (worldX >= pl.x - half && worldX <= pl.x + half && worldY >= pl.y - half && worldY <= pl.y + half) {
      // Clicked on this player's shelter - send ally request
      if (!sentAllyRequests.has(pl.id)) {
        gameWs.send(JSON.stringify({ type: 'allyRequest', targetId: pl.id }));
        sentAllyRequests.add(pl.id);
      }
      break;
    }
  }
}

canvas.addEventListener('click', (e) => {
  if (!latestSnapshot || !myPlayerId || !gameWs || gameWs.readyState !== WebSocket.OPEN) return;
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  const screenX = (e.clientX - rect.left) * scaleX;
  const screenY = (e.clientY - rect.top) * scaleY;
  handleAllyRequestAtPosition(screenX, screenY);
});

// Mobile touch support for ally requests
canvas.addEventListener('touchend', (e) => {
  if (!latestSnapshot || !myPlayerId || !gameWs || gameWs.readyState !== WebSocket.OPEN) return;
  // Only process single-finger taps (not joystick gestures)
  if (e.changedTouches.length !== 1) return;
  const touch = e.changedTouches[0];
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  const screenX = (touch.clientX - rect.left) * scaleX;
  const screenY = (touch.clientY - rect.top) * scaleY;
  handleAllyRequestAtPosition(screenX, screenY);
});

window.addEventListener('keydown', onKeyDown);
window.addEventListener('keyup', onKeyUp);

// --- Minimap click/drag to pan camera ---
let minimapDragging = false;

function panCameraToMinimapPos(clientX: number, clientY: number): void {
  const rect = minimap.getBoundingClientRect();
  const clickX = clientX - rect.left;
  const clickY = clientY - rect.top;
  const scale = MAP_WIDTH / 120; // minimap is 120px, map is MAP_WIDTH
  const worldX = clickX * scale;
  const worldY = clickY * scale;
  // Set camera offset to center view on clicked world position
  const playerX = predictedPlayer?.x ?? MAP_WIDTH / 2;
  const playerY = predictedPlayer?.y ?? MAP_HEIGHT / 2;
  cameraPanOffsetX = worldX - playerX;
  cameraPanOffsetY = worldY - playerY;
}

minimap.addEventListener('mousedown', (e) => {
  e.preventDefault();
  minimapDragging = true;
  panCameraToMinimapPos(e.clientX, e.clientY);
});

minimap.addEventListener('mousemove', (e) => {
  if (minimapDragging) {
    panCameraToMinimapPos(e.clientX, e.clientY);
  }
});

minimap.addEventListener('mouseup', () => {
  minimapDragging = false;
});

minimap.addEventListener('mouseleave', () => {
  minimapDragging = false;
});

// Touch support for minimap drag
minimap.addEventListener('touchstart', (e) => {
  e.preventDefault();
  minimapDragging = true;
  if (e.touches.length > 0) {
    panCameraToMinimapPos(e.touches[0].clientX, e.touches[0].clientY);
  }
}, { passive: false });

minimap.addEventListener('touchmove', (e) => {
  if (minimapDragging && e.touches.length > 0) {
    e.preventDefault();
    panCameraToMinimapPos(e.touches[0].clientX, e.touches[0].clientY);
  }
}, { passive: false });

minimap.addEventListener('touchend', () => {
  minimapDragging = false;
});

minimap.addEventListener('touchcancel', () => {
  minimapDragging = false;
});

// --- Camera (follow local player, smoothed; pannable by drag) ---
let cameraSmoothedX: number | null = null;
let cameraSmoothedY: number | null = null;
const CAMERA_SMOOTH = 0.22;
let cameraPanOffsetX = 0;
let cameraPanOffsetY = 0;
const PAN_THRESHOLD_PX = 10;
// Observer mode: camera position for eliminated players
let observerCameraX = MAP_WIDTH / 2;
let observerCameraY = MAP_HEIGHT / 2;
const OBSERVER_PAN_SPEED = 15; // pixels per frame
let isPanning = false;
let panStartClientX = 0;
let panStartClientY = 0;
let lastPanClientX = 0;
let lastPanClientY = 0;

// --- Local player display position (smoothed so shelter doesn't snap on server updates) ---
let playerDisplayX: number | null = null;
let playerDisplayY: number | null = null;
const PLAYER_DISPLAY_SMOOTH = 0.2; // Smoother camera follow (lower = more smoothing, less jitter)

function getCamera(): { x: number; y: number; w: number; h: number } {
  const w = canvas.width;
  const h = canvas.height;
  
  // Check if player is eliminated (observer mode)
  const me = latestSnapshot?.players.find((p) => p.id === myPlayerId);
  const isObserver = me?.eliminated === true;
  
  if (isObserver) {
    // Observer mode: free camera panning
    const camX = Math.max(0, Math.min(MAP_WIDTH - w, observerCameraX - w / 2));
    const camY = Math.max(0, Math.min(MAP_HEIGHT - h, observerCameraY - h / 2));
    return { x: camX, y: camY, w, h };
  }
  
  let px = predictedPlayer?.x ?? MAP_WIDTH / 2;
  let py = predictedPlayer?.y ?? MAP_HEIGHT / 2;
  if (!Number.isFinite(px) || !Number.isFinite(py)) {
    px = MAP_WIDTH / 2;
    py = MAP_HEIGHT / 2;
  }
  let targetX = px - w / 2 + cameraPanOffsetX;
  let targetY = py - h / 2 + cameraPanOffsetY;
  targetX = Math.max(0, Math.min(MAP_WIDTH - w, targetX));
  targetY = Math.max(0, Math.min(MAP_HEIGHT - h, targetY));
  if (predictedPlayer == null) {
    cameraSmoothedX = null;
    cameraSmoothedY = null;
    return { x: targetX, y: targetY, w, h };
  }
  if (cameraSmoothedX == null || cameraSmoothedY == null || !Number.isFinite(cameraSmoothedX) || !Number.isFinite(cameraSmoothedY)) {
    cameraSmoothedX = targetX;
    cameraSmoothedY = targetY;
  } else {
    cameraSmoothedX += (targetX - cameraSmoothedX) * CAMERA_SMOOTH;
    cameraSmoothedY += (targetY - cameraSmoothedY) * CAMERA_SMOOTH;
  }
  let cx = cameraSmoothedX;
  let cy = cameraSmoothedY;
  if (!Number.isFinite(cx) || !Number.isFinite(cy)) {
    cx = targetX;
    cy = targetY;
    cameraSmoothedX = cx;
    cameraSmoothedY = cy;
  }
  cx = Math.max(0, Math.min(MAP_WIDTH - w, cx));
  cy = Math.max(0, Math.min(MAP_HEIGHT - h, cy));
  return { x: cx, y: cy, w, h };
}

function applyPanDelta(deltaScreenX: number, deltaScreenY: number): void {
  cameraPanOffsetX -= deltaScreenX;
  cameraPanOffsetY -= deltaScreenY;
  const w = canvas.width;
  const h = canvas.height;
  const px = predictedPlayer?.x ?? MAP_WIDTH / 2;
  const py = predictedPlayer?.y ?? MAP_HEIGHT / 2;
  const maxX = Math.max(0, MAP_WIDTH - w);
  const maxY = Math.max(0, MAP_HEIGHT - h);
  const minOffsetX = -(px - w / 2);
  const maxOffsetX = maxX - (px - w / 2);
  const minOffsetY = -(py - h / 2);
  const maxOffsetY = maxY - (py - h / 2);
  cameraPanOffsetX = Math.max(minOffsetX, Math.min(maxOffsetX, cameraPanOffsetX));
  cameraPanOffsetY = Math.max(minOffsetY, Math.min(maxOffsetY, cameraPanOffsetY));
}

// --- Prediction: advance by one server tick (used when sending input) ---
function predictPlayerTick(p: PlayerState, inputFlags: number): PlayerState {
  return predictPlayerByDt(p, inputFlags, 1 / TICK_RATE);
}

// Fixed radius for van collision - matches server VAN_FIXED_RADIUS
const VAN_FIXED_RADIUS = 30;

// --- Prediction: advance by dt seconds (per-frame for smooth camera) ---
function predictPlayerByDt(p: PlayerState, inputFlags: number, dtSec: number): PlayerState {
  let dx = 0,
    dy = 0;
  if (inputFlags & INPUT_LEFT) dx -= 1;
  if (inputFlags & INPUT_RIGHT) dx += 1;
  if (inputFlags & INPUT_UP) dy -= 1;
  if (inputFlags & INPUT_DOWN) dy += 1;
  let vx = 0,
    vy = 0;
  if (dx !== 0 || dy !== 0) {
    const len = Math.hypot(dx, dy) || 1;
    const speed = (p.speedBoostUntil ?? 0) > 0 ? SHELTER_SPEED * SPEED_BOOST_MULTIPLIER : SHELTER_SPEED;
    const step = speed * dtSec;
    vx = (dx / len) * step;
    vy = (dy / len) * step;
  }
  // Use fixed van radius for map edge clamping (vans don't grow, shelters are separate)
  const radius = VAN_FIXED_RADIUS;
  let x = p.x + vx;
  let y = p.y + vy;
  x = Math.max(radius, Math.min(MAP_WIDTH - radius, x));
  y = Math.max(radius, Math.min(MAP_HEIGHT - radius, y));
  return {
    ...p,
    x,
    y,
    vx,
    vy,
    petsInside: [...p.petsInside],
    speedBoostUntil: p.speedBoostUntil ?? 0,
  };
}

const CONNECT_TIMEOUT_MS = 10000;

function showConnectionError(message: string): void {
  connectionOverlayEl.classList.remove('hidden');
  connectionOverlayEl.innerHTML = `
    <h2>Could not connect</h2>
    <p class="error">${message}</p>
    <p>The game server is not running or not reachable.</p>
    <p><strong>To start the game:</strong></p>
    <p>From the project root folder, run: <code>npm run dev</code></p>
    <p>That starts both the server (ports 4000, 4001) and the client. Wait a few seconds, then refresh this page.</p>
    <p>Or run in two terminals: first <code>npm run dev:server</code>, then <code>npm run dev:client</code>.</p>
  `;
}

// --- Connect flow ---
async function connect(options?: { latency?: number; mode?: 'ffa' | 'teams' | 'solo'; abandon?: boolean }): Promise<void> {
  disconnectLobbyLeaderboard();
  stopGameStatsPolling();
  if (pingIntervalId) {
    clearInterval(pingIntervalId);
    pingIntervalId = null;
  }
  switchServerEl.classList.add('hidden');
  const isLocalhost = (url: string) => /^wss?:\/\/localhost(\b|:|\/|$)/i.test(url) || /^wss?:\/\/127\.0\.0\.1(\b|:|\/|$)/i.test(url);
  const gameUrlFromPage = () => {
    const { protocol, host } = window.location;
    const wsProtocol = protocol === 'https:' ? 'wss:' : 'ws:';
    return `${wsProtocol}//${host}/ws-game`;
  };
  let gameUrl = isLocalhost(window.location.href) ? 'ws://localhost:4001' : gameUrlFromPage();
  const ws = new WebSocket(SIGNALING_URL);
  await new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => {
      ws.close();
      reject(new Error('Connection timeout. Is the server running? Run: npm run dev'));
    }, CONNECT_TIMEOUT_MS);
    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'join', latency: options?.latency, mode: options?.mode ?? 'ffa' }));
    };
    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === 'joined' && msg.gameUrl) {
          clearTimeout(t);
          gameUrl = msg.gameUrl;
          if (!isLocalhost(window.location.href) && isLocalhost(gameUrl)) gameUrl = gameUrlFromPage();
          resolve();
        }
      } catch {
        // ignore
      }
    };
    ws.onerror = () => {
      clearTimeout(t);
      reject(new Error('WebSocket error. Server not running?'));
    };
    ws.onclose = () => {
      clearTimeout(t);
      if (ws.readyState !== WebSocket.OPEN) reject(new Error('Signaling connection closed. Run: npm run dev'));
    };
  });
  const gameWsLocal = new WebSocket(gameUrl);
  gameWsLocal.binaryType = 'arraybuffer';
  gameWsLocal.onopen = async () => {
    gameWs = gameWsLocal;
    const displayName = await getOrCreateDisplayName();
    // Withdraw inventory for this match (registered users only)
    const inventory = await withdrawInventory();
    const startingRT = inventory.rt;
    const startingPorts = inventory.ports;
    if (startingRT > 0) {
      showToast(`Starting with ${startingRT} RT from chest!`, 'success');
    }
    gameWs.send(JSON.stringify({ 
      type: 'mode', 
      mode: options?.mode ?? 'ffa', 
      displayName,
      startingRT,
      startingPorts,
      userId: currentUserId, // For inventory tracking
    }));
    if (pendingBoosts.sizeBonus > 0 || pendingBoosts.speedBoost || pendingBoosts.adoptSpeed) {
      gameWs.send(JSON.stringify({
        type: 'startingBoosts',
        sizeBonus: pendingBoosts.sizeBonus,
        speedBoost: pendingBoosts.speedBoost,
        adoptSpeed: pendingBoosts.adoptSpeed,
      }));
      pendingBoosts.sizeBonus = 0;
      pendingBoosts.speedBoost = false;
      pendingBoosts.adoptSpeed = false;
    }
    // Send selected color
    const selectedColor = getSelectedColor();
    if (selectedColor) {
      gameWs.send(JSON.stringify({ type: 'setColor', color: selectedColor }));
    }
    // Send CPU breeder behavior option for solo mode
    if (options?.mode === 'solo' && cpuShutdownBreedersEl) {
      gameWs.send(JSON.stringify({ 
        type: 'setCpuBreederBehavior', 
        canShutdown: cpuShutdownBreedersEl.checked 
      }));
    }
  };
  gameWsLocal.onmessage = (e) => {
    if (typeof e.data === 'string') {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === 'welcome' && msg.playerId) {
          myPlayerId = msg.playerId;
          // Track current matchId for FFA/Teams rejoin capability
          if (msg.matchId && (selectedMode === 'ffa' || selectedMode === 'teams')) {
            // If resumed, clear the stored match (we're back in it)
            if (msg.resumed) {
              setActiveMultiplayerMatch(null);
              showToast(`Rejoined match ${getShortMatchId(msg.matchId)}!`, 'success');
            }
            // Store current match info for potential rejoin later
            currentMatchId = msg.matchId;
          }
          playWelcome();
        }
        if (msg.type === 'savedMatchExpired') {
          hasSavedMatch = false;
          updateResumeMatchUI();
          fetchSavedMatchStatus();
          const reason = typeof msg.reason === 'string' ? msg.reason : 'Match already ended';
          showToast(reason, 'info');
          if (gameWs) {
            gameWs.close();
            gameWs = null;
          }
          // Return to lobby
          myPlayerId = null;
          latestSnapshot = null;
          currentMatchId = null;
          setActiveMultiplayerMatch(null);
          leaderboardEl.classList.remove('show');
          matchEndPlayed = false;
          matchEndTokensAwarded = false;
          clearAnnouncements();
          gameWrapEl.classList.remove('visible');
          landingEl.classList.remove('hidden');
          authAreaEl.classList.remove('hidden');
          updateLandingTokens();
          restoreModeSelection();
          connectionOverlayEl?.classList.add('hidden');
          startServerClockWhenOnLobby();
          connectLobbyLeaderboard();
          startGameStatsPolling();
        }
        if (msg.type === 'serverShutdown') {
          const message = typeof msg.message === 'string' ? msg.message : 'Server is updating. Your progress has been saved.';
          showToast(message, 'info', true); // Allow HTML for clickable link
          if (gameWs) {
            gameWs.close();
            gameWs = null;
          }
          myPlayerId = null;
          latestSnapshot = null;
          currentMatchId = null;
          setActiveMultiplayerMatch(null);
          leaderboardEl.classList.remove('show');
          matchEndPlayed = false;
          matchEndTokensAwarded = false;
          clearAnnouncements();
          gameWrapEl.classList.remove('visible');
          landingEl.classList.remove('hidden');
          authAreaEl.classList.remove('hidden');
          updateLandingTokens();
          restoreModeSelection();
          updateResumeMatchUI();
          fetchSavedMatchStatus();
          connectionOverlayEl?.classList.add('hidden');
          startServerClockWhenOnLobby();
          connectLobbyLeaderboard();
        }
        if (msg.type === 'matchState' && typeof msg.phase === 'string') {
          matchPhase = msg.phase as MatchPhase;
          countdownRemainingSec = typeof msg.countdownRemainingSec === 'number' ? msg.countdownRemainingSec : 0;
          readyCount = typeof msg.readyCount === 'number' ? msg.readyCount : 0;
          
          // Update player list (only show human players in FFA lobby)
          if (Array.isArray(msg.players) && msg.players.length > 0) {
            lobbyPlayerListEl.innerHTML = msg.players
              .map((p: { displayName: string }) => `<div class="lobby-player">${escapeHtml(p.displayName)}</div>`)
              .join('');
          } else {
            lobbyPlayerListEl.innerHTML = '';
          }
          
          if (matchPhase === 'lobby') {
            if (selectedMode === 'solo') {
              lobbyOverlayEl.classList.add('hidden');
            } else {
              lobbyOverlayEl.classList.remove('hidden');
              lobbyMessageEl.textContent = 'Waiting for another player…';
              lobbyCountdownEl.classList.add('hidden');
              lobbyReadyBtnEl.classList.add('hidden');
            }
          } else if (matchPhase === 'countdown') {
            lobbyOverlayEl.classList.remove('hidden');
            lobbyMessageEl.textContent = 'Match starting soon';
            lobbyCountdownEl.classList.remove('hidden');
            lobbyCountdownEl.textContent = countdownRemainingSec > 0 ? `Starting in ${countdownRemainingSec}s…` : 'Starting…';
            lobbyReadyBtnEl.classList.remove('hidden');
            if (iAmReady) lobbyReadyBtnEl.textContent = 'Ready!';
            else lobbyReadyBtnEl.textContent = 'Ready';
          } else {
            lobbyOverlayEl.classList.add('hidden');
            lobbyPlayerListEl.innerHTML = ''; // Clear when match starts
          }
        }
        if (msg.type === 'pong' && typeof msg.ts === 'number') {
          currentRttMs = Math.round(Date.now() - msg.ts);
          if (currentRttMs > RTT_HIGH_MS) highLatencySince = highLatencySince || Date.now();
          else highLatencySince = 0;
        }
        if (msg.type === 'groundFailed' && typeof msg.reason === 'string') {
          showToast(msg.reason);
        }
        // Breeder mini-game messages
        if (msg.type === 'breederStart' && typeof msg.petCount === 'number') {
          const level = typeof msg.level === 'number' ? msg.level : 1;
          const isMill = !!msg.isMill;
          const timeLimitSeconds = typeof msg.timeLimitSeconds === 'number' ? msg.timeLimitSeconds : undefined;
          const addPetIntervalSeconds = typeof msg.addPetIntervalSeconds === 'number' ? msg.addPetIntervalSeconds : undefined;
          startBreederMiniGame(msg.petCount, level, { isMill, timeLimitSeconds, addPetIntervalSeconds });
        }
        if (msg.type === 'breederAddPet') {
          if (breederGame.active) {
            const petTypes: PetType[] = ['dog', 'cat', 'horse', 'bird', 'rabbit'];
            const type = petTypes[Math.floor(Math.random() * petTypes.length)];
            breederGame.pets.push({ type, rescued: false });
            breederGame.totalPets++;
            renderBreederPets();
            renderSelectedIngredients();
          }
        }
        if (msg.type === 'breederRewards') {
          const tokenBonus = typeof msg.tokenBonus === 'number' ? msg.tokenBonus : 0;
          const rewards = Array.isArray(msg.rewards) ? msg.rewards : [];
          showBreederRewards(tokenBonus, rewards);
        }
        // Match end inventory notification - match has ended, saved match cleared
        if (msg.type === 'matchEndInventory') {
          hasSavedMatch = false;
          updateResumeMatchUI();
          // Refresh inventory display if we're showing lobby soon
          fetchSavedMatchStatus();
          // Show karma notification if awarded
          if (typeof msg.karmaAwarded === 'number' && msg.karmaAwarded > 0) {
            showToast(`+${msg.karmaAwarded} Karma Point!`, 'success');
            // Refresh karma display
            fetchKarma();
          }
        }
        // Match-wide announcements
        if (msg.type === 'announcement' && Array.isArray(msg.messages)) {
          showAnnouncement(msg.messages);
        }
        // Incoming ally request from another player
        if (msg.type === 'allyRequestReceived' && typeof msg.fromId === 'string' && typeof msg.fromName === 'string') {
          showAllyRequestPopup(msg.fromId, msg.fromName);
        }
        // Pet transfer result
        if (msg.type === 'transferResult') {
          hideTransferConfirmPopup();
          if (msg.success && typeof msg.count === 'number') {
            showToast(`Transferred ${msg.count} pets! You +${msg.senderScore ?? 0} score, ally +${msg.receiverScore ?? 0}`);
          } else if (typeof msg.reason === 'string') {
            showToast(msg.reason);
          }
        }
      } catch {
        // ignore
      }
      return;
    }
    const buf = e.data as ArrayBuffer;
    if (buf.byteLength < 1) return;
    if (new DataView(buf).getUint8(0) === MSG_SNAPSHOT) {
      const snap = decodeSnapshot(buf);
      latestSnapshot = snap;
      if (matchPhase !== 'playing') {
        matchPhase = 'playing';
        lobbyOverlayEl.classList.add('hidden');
      }
      for (const p of snap.players) {
        const prev = interpolatedPlayers.get(p.id)?.next ?? p;
        interpolatedPlayers.set(p.id, { prev, next: { ...p }, t: 0 });
        
        // Detect teleport (large position change) and trigger port animation
        const prevPos = prevPlayerPositions.get(p.id);
        if (prevPos) {
          const dx = p.x - prevPos.x;
          const dy = p.y - prevPos.y;
          const dist = Math.hypot(dx, dy);
          // If moved more than 200 units in one tick, it's a teleport
          if (dist > 200 && !portAnimations.has(p.id)) {
            portAnimations.set(p.id, {
              startTime: Date.now(),
              fromX: prevPos.x,
              fromY: prevPos.y,
              toX: p.x,
              toY: p.y,
              phase: 'fadeIn', // Start appearing at new location
            });
          }
        }
        prevPlayerPositions.set(p.id, { x: p.x, y: p.y });
      }
      // Toast when shelter port charges increase
      const meForPorts = snap.players.find((p) => p.id === myPlayerId);
      if (meForPorts) {
        const currentShelterPorts = meForPorts.shelterPortCharges ?? 0;
        if (currentShelterPorts > lastShelterPortCharges) {
          const diff = currentShelterPorts - lastShelterPortCharges;
          showToast(`+${diff} Home Port${diff > 1 ? 's' : ''} 🏠`, 'success');
        }
        lastShelterPortCharges = currentShelterPorts;
      }
      for (const pet of snap.pets) {
        const prev = interpolatedPets.get(pet.id)?.next ?? pet;
        interpolatedPets.set(pet.id, { prev, next: { ...pet }, t: 0 });
      }
      const me = snap.players.find((q) => q.id === myPlayerId);
      if (me) {
        // Only show +1 Size popup if:
        // - Size increased (me.size > lastKnownSize)
        // - Van doesn't have a shelter (size growth goes to van)
        // - Van size is under 50
        const hasShelter = !!me.shelterId;
        if (me.size > lastKnownSize && !hasShelter && me.size < 50) {
          growthPopUntil = Date.now() + 1500;
          playPickupGrowth();
        } else if (me.size > lastKnownSize) {
          // Still play sound but don't show popup
          playPickupGrowth();
        }
        if ((me.speedBoostUntil ?? 0) > lastSpeedBoostUntil) {
          playPickupSpeed();
          playSpeedBoostWhoosh();
        }
        lastSpeedBoostUntil = me.speedBoostUntil ?? 0;
        if (me.totalAdoptions > lastTotalAdoptions) {
          playAdoption();
          const adoptionCount = me.totalAdoptions - lastTotalAdoptions;
          const myShelter = latestSnapshot?.shelters?.find(s => s.ownerId === myPlayerId);
          // Which pet IDs were just adopted? (they were in our van/shelter last frame, now gone)
          let adoptedIds: string[];
          if (myShelter?.hasAdoptionCenter) {
            adoptedIds = lastShelterPetsInsideIds.filter((id) => !myShelter.petsInside.includes(id)).slice(0, adoptionCount);
            const types = adoptedIds.map((id) => lastPetTypesById.get(id) ?? PET_TYPE_CAT);
            triggerAdoptionAnimation(myShelter.x, myShelter.y, myShelter.x, myShelter.y - 100, types);
          } else {
            adoptedIds = lastPetsInsideIds.filter((id) => !me.petsInside.includes(id)).slice(0, adoptionCount);
            const types = adoptedIds.map((id) => lastPetTypesById.get(id) ?? PET_TYPE_CAT);
            const zone = latestSnapshot?.adoptionZones?.[0];
            if (zone) triggerAdoptionAnimation(me.x, me.y, zone.x, zone.y, types);
          }
        }
        lastTotalAdoptions = me.totalAdoptions;
        if (me.petsInside.length > lastPetsInsideLength) playStrayCollected();
        lastPetsInsideLength = me.petsInside.length;
        // Track van and shelter pet IDs + all pet types for next frame (so we know types of adopted pets)
        lastPetsInsideIds = [...me.petsInside];
        const mySh = latestSnapshot?.shelters?.find((s) => s.ownerId === myPlayerId);
        lastShelterPetsInsideIds = mySh ? [...mySh.petsInside] : [];
        for (const p of snap.pets) lastPetTypesById.set(p.id, p.petType ?? PET_TYPE_CAT);
        lastKnownSize = me.size;
        const prevX = predictedPlayer?.x ?? me.x;
        const prevY = predictedPlayer?.y ?? me.y;
        predictedPlayer = { ...me, petsInside: [...me.petsInside] };
        lastProcessedInputSeq = me.inputSeq;
        const jump = Math.hypot(me.x - prevX, me.y - prevY);
        if (jump > 300) {
          cameraSmoothedX = null;
          cameraSmoothedY = null;
          cameraPanOffsetX = 0;
          cameraPanOffsetY = 0;
          playerDisplayX = me.x;
          playerDisplayY = me.y;
        }
      }
    }
  };
  gameWsLocal.onclose = () => {
    gameWs = null;
    myPlayerId = null;
    latestSnapshot = null;
    lastShelterPortCharges = 0;
    predictedPlayer = null;
    matchPhase = 'playing';
    sentAllyRequests.clear();
    iAmReady = false;
  };
  await new Promise<void>((resolve, reject) => {
    const deadline = Date.now() + CONNECT_TIMEOUT_MS;
    const check = () => {
      if (gameWs?.readyState === WebSocket.OPEN) resolve();
      else if (Date.now() > deadline) reject(new Error('Game server connection timeout'));
      else setTimeout(check, 50);
    };
    check();
  });
  connectionOverlayEl.classList.add('hidden');
  // How-to-play is now on the landing page, no need to show in-game
  howToPlayEl.classList.add('hidden');
  playMusic();
  pingIntervalId = setInterval(() => {
    if (gameWs?.readyState === WebSocket.OPEN) {
      gameWs.send(JSON.stringify({ type: 'ping', ts: Date.now() }));
    }
  }, 2000);
}

// --- Tick: send input at server tick rate, advance prediction every frame for smooth camera ---
// Frame rate: user choice (30 or 60), persisted in localStorage
function getStoredFps(): 30 | 60 {
  const v = localStorage.getItem(FPS_KEY);
  if (v === '60') return 60;
  return 30;
}
let targetFps: 30 | 60 = getStoredFps();
let targetFrameMs = 1000 / targetFps;
let lastTickTime = 0;
let lastInputSendTime = 0;
let lastRenderTime = 0;

function tick(now: number): void {
  // Schedule next frame immediately to maintain timing accuracy
  requestAnimationFrame(tick);
  
  // Frame rate limiting - skip if not enough time has passed
  if (lastRenderTime && now - lastRenderTime < targetFrameMs - 1) {
    return; // Skip this frame, wait for next
  }
  
  if (!lastTickTime) lastTickTime = now;
  const dt = Math.min((now - lastTickTime) / 1000, 0.1);
  lastTickTime = now;
  lastRenderTime = now;

  applyJoystickToInput();
  
  // Check if player just became an observer (eliminated)
  checkObserverModeStart();
  
  // Observer mode: pan camera with WASD/arrows when eliminated
  if (isPlayerObserver()) {
    if (keys['KeyW'] || keys['ArrowUp']) observerCameraY -= OBSERVER_PAN_SPEED;
    if (keys['KeyS'] || keys['ArrowDown']) observerCameraY += OBSERVER_PAN_SPEED;
    if (keys['KeyA'] || keys['ArrowLeft']) observerCameraX -= OBSERVER_PAN_SPEED;
    if (keys['KeyD'] || keys['ArrowRight']) observerCameraX += OBSERVER_PAN_SPEED;
    // Clamp to map bounds
    observerCameraX = Math.max(canvas.width / 2, Math.min(MAP_WIDTH - canvas.width / 2, observerCameraX));
    observerCameraY = Math.max(canvas.height / 2, Math.min(MAP_HEIGHT - canvas.height / 2, observerCameraY));
  }

  const matchOver = latestSnapshot != null && latestSnapshot.matchEndAt > 0 && latestSnapshot.tick >= latestSnapshot.matchEndAt;
  const meForActive = latestSnapshot?.players.find((p) => p.id === myPlayerId);
  const gameActive = matchPhase === 'playing' && !matchOver && !meForActive?.eliminated;
  const canMove = gameActive && !breederGame.active; // Can't move during breeder minigame

  // Send input at server tick rate (only when match is playing and not over, and not in minigame)
  if (canMove && gameWs?.readyState === WebSocket.OPEN && now - lastInputSendTime >= TICK_MS) {
    lastInputSendTime = now;
    const buf = encodeInput(inputFlags, inputSeq++);
    gameWs.send(buf);
  }

  // Van engine: subtle rumble when moving, off when stopped
  const isMoving = (inputFlags & (INPUT_LEFT | INPUT_RIGHT | INPUT_UP | INPUT_DOWN)) !== 0;
  if (canMove && myPlayerId) {
    updateVanEngine(isMoving);
  } else {
    updateVanEngine(false);
  }

  // Advance local player prediction every frame (smooth movement and camera) — freeze when lobby/countdown, match over, or in minigame
  if (canMove && predictedPlayer && myPlayerId) {
    const prevX = predictedPlayer.x;
    const prevY = predictedPlayer.y;
    predictedPlayer = predictPlayerByDt(predictedPlayer, inputFlags, dt);
    // Vans can pass through each other - collision is only between shelters (handled by server)
    // No client-side van-van collision check needed
    // Smoothed display position so shelter doesn't jitter when server snapshots overwrite predictedPlayer
    let tx = predictedPlayer.x;
    let ty = predictedPlayer.y;
    if (!Number.isFinite(tx) || !Number.isFinite(ty)) {
      tx = MAP_WIDTH / 2;
      ty = MAP_HEIGHT / 2;
    }
    if (playerDisplayX == null || playerDisplayY == null) {
      playerDisplayX = tx;
      playerDisplayY = ty;
    } else {
      playerDisplayX += (tx - playerDisplayX) * PLAYER_DISPLAY_SMOOTH;
      playerDisplayY += (ty - playerDisplayY) * PLAYER_DISPLAY_SMOOTH;
    }
    if (!Number.isFinite(playerDisplayX) || !Number.isFinite(playerDisplayY)) {
      playerDisplayX = tx;
      playerDisplayY = ty;
    }
    // Show Fight/Ally when my SHELTER overlaps another player's SHELTER — vans cannot attack
    // Show CPU warning when overlapping a CPU shelter (no prompt)
    let overlappingId: string | null = null;
    let cpuOverlapping = false;
    if (latestSnapshot) {
      const me = latestSnapshot.players.find(p => p.id === myPlayerId);
      const myShelter = me?.shelterId ? latestSnapshot.shelters?.find(s => s.id === me.shelterId) : null;
      
      // Only show combat if I have a shelter
      if (myShelter) {
        const myR = SHELTER_BASE_RADIUS + myShelter.size * SHELTER_RADIUS_PER_SIZE;
        
        for (const pl of latestSnapshot.players) {
          if (pl.id === myPlayerId) continue;
          
          // Other player must also have a shelter for combat
          const otherShelter = pl.shelterId ? latestSnapshot.shelters?.find(s => s.id === pl.shelterId) : null;
          if (!otherShelter) continue;
          
          const or = SHELTER_BASE_RADIUS + otherShelter.size * SHELTER_RADIUS_PER_SIZE;
          // Use SHELTER positions for overlap detection
          const overlap = Math.abs(myShelter.x - otherShelter.x) <= myR + or && 
                          Math.abs(myShelter.y - otherShelter.y) <= myR + or;
          if (!overlap) continue;
          
          // Combat only starts at size 10+
          if (myShelter.size < COMBAT_MIN_SIZE || otherShelter.size < COMBAT_MIN_SIZE) continue;
          
          if (pl.id.startsWith('cpu-')) {
            cpuOverlapping = true;
            continue;
          }
          if (!fightAllyChosenTargets.has(pl.id)) {
            overlappingId = pl.id;
            break;
          }
        }
      }
    }
    if (overlappingId) {
      const other = latestSnapshot!.players.find((p) => p.id === overlappingId);
      fightAllyTargetId = overlappingId;
      fightAllyNameEl.textContent = other?.displayName ?? overlappingId;
      const wasHidden = fightAllyOverlayEl.classList.contains('hidden');
      fightAllyOverlayEl.classList.remove('hidden');
      // Play attack warning when first showing human fight overlay
      if (wasHidden && Date.now() - lastAttackWarnTime > ATTACK_WARN_COOLDOWN_MS) {
        lastAttackWarnTime = Date.now();
        playAttackWarning();
      }
    } else {
      fightAllyOverlayEl.classList.add('hidden');
      fightAllyTargetId = null;
      // Reset choices when not overlapping anyone - allows changing mind on next encounter
      fightAllyChosenTargets.clear();
    }
    if (cpuOverlapping) {
      const wasHidden = cpuWarningEl.classList.contains('hidden');
      cpuWarningEl.classList.remove('hidden');
      // Play attack warning when first showing CPU warning
      if (wasHidden && Date.now() - lastAttackWarnTime > ATTACK_WARN_COOLDOWN_MS) {
        lastAttackWarnTime = Date.now();
        playAttackWarning();
      }
    } else {
      cpuWarningEl.classList.add('hidden');
    }
  } else {
    playerDisplayX = null;
    playerDisplayY = null;
    fightAllyOverlayEl.classList.add('hidden');
    fightAllyTargetId = null;
    cpuWarningEl.classList.add('hidden');
  }

  const interpStep = dt * (1000 / INTERP_BUFFER_MS);
  for (const entry of interpolatedPlayers.values()) {
    entry.t = Math.min(1, entry.t + interpStep);
  }
  for (const entry of interpolatedPets.values()) {
    entry.t = Math.min(1, entry.t + interpStep);
  }

  render(dt);
  // Note: requestAnimationFrame is now called at the start of tick() for frame rate limiting
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Lerp toward target angle taking the shortest path around the circle; t in [0,1]. */
function lerpAngle(from: number, to: number, t: number): number {
  let diff = to - from;
  while (diff > Math.PI) diff -= 2 * Math.PI;
  while (diff < -Math.PI) diff += 2 * Math.PI;
  return from + diff * t;
}

function getInterpolatedPlayer(id: string): PlayerState | null {
  const entry = interpolatedPlayers.get(id);
  if (!entry) return null;
  const t = entry.t;
  return {
    ...entry.next,
    x: lerp(entry.prev.x, entry.next.x, t),
    y: lerp(entry.prev.y, entry.next.y, t),
    vx: lerp(entry.prev.vx, entry.next.vx, t),
    vy: lerp(entry.prev.vy, entry.next.vy, t),
  };
}

function getInterpolatedPet(id: string): PetState | null {
  const entry = interpolatedPets.get(id);
  if (!entry) return null;
  const t = entry.t;
  return {
    ...entry.next,
    x: lerp(entry.prev.x, entry.next.x, t),
    y: lerp(entry.prev.y, entry.next.y, t),
  };
}

// --- World rendering (agar.io / territorial.io style) ---
const DOT_SPACING = 36;
const DOT_R = 1.8;

function hashColor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  const hue = (h % 360);
  return `hsl(${hue}, 72%, 58%)`;
}

function drawMapBackground(cam: { x: number; y: number; w: number; h: number }): void {
  const pad = DOT_SPACING * 2;
  const x0 = Math.floor((cam.x - pad) / DOT_SPACING) * DOT_SPACING;
  const y0 = Math.floor((cam.y - pad) / DOT_SPACING) * DOT_SPACING;
  const x1 = Math.ceil((cam.x + cam.w + pad) / DOT_SPACING) * DOT_SPACING;
  const y1 = Math.ceil((cam.y + cam.h + pad) / DOT_SPACING) * DOT_SPACING;
  ctx.fillStyle = '#3d6b3d';
  ctx.fillRect(cam.x, cam.y, cam.w, cam.h);
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  for (let yy = y0; yy <= y1; yy += DOT_SPACING) {
    for (let xx = x0; xx <= x1; xx += DOT_SPACING) {
      ctx.fillRect(xx - DOT_R, yy - DOT_R, DOT_R * 2, DOT_R * 2);
    }
  }
}

function drawAdoptionZone(z: AdoptionZoneState): void {
  const cx = z.x;
  const cy = z.y;
  const r = z.radius || ADOPTION_ZONE_RADIUS; // Fallback if radius is missing
  if (!Number.isFinite(cx) || !Number.isFinite(cy) || !Number.isFinite(r)) return;
  ctx.save();
  ctx.strokeStyle = 'rgba(123, 237, 159, 0.6)';
  ctx.lineWidth = 4;
  ctx.setLineDash([8, 8]);
  ctx.strokeRect(cx - r, cy - r, r * 2, r * 2);
  ctx.setLineDash([]);
  ctx.fillStyle = 'rgba(74, 124, 89, 0.2)';
  ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
  ctx.fillStyle = '#7bed9f';
  ctx.font = 'bold 14px Rubik, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('ADOPTION CENTER', cx, cy - r - 8);
  ctx.fillText('Bring pets here to adopt out', cx, cy);
  ctx.restore();
}

function drawAdoptionEvent(ev: AdoptionEvent, nowTick: number): void {
  const cx = ev.x;
  const cy = ev.y;
  const r = ev.radius; // Use event's randomized radius
  const remaining = Math.max(0, ev.startTick + ev.durationTicks - nowTick);
  const secLeft = Math.ceil(remaining / 25);
  const imgSize = 100; // Larger for better visibility
  
  // Pulsing effect based on tick
  const pulse = 0.8 + 0.2 * Math.sin(nowTick * 0.15);
  
  // Check if player is nearby (for enhanced glow)
  const me = latestSnapshot?.players.find(p => p.id === myPlayerId);
  const playerDist = me ? Math.hypot(me.x - cx, me.y - cy) : Infinity;
  const isNearby = playerDist <= r;

  ctx.save();
  
  // Draw outer glow when nearby (pulsing)
  if (isNearby) {
    ctx.fillStyle = `rgba(255, 193, 7, ${0.15 * pulse})`;
    ctx.beginPath();
    ctx.arc(cx, cy, r + 20, 0, Math.PI * 2);
    ctx.fill();
  }
  
  // Draw main event image or fallback
  if (adoptionEventImageLoaded) {
    ctx.drawImage(adoptionEventImage, cx - imgSize / 2, cy - imgSize / 2, imgSize, imgSize);
  } else {
    // Fallback: bright yellow circle with icon
    ctx.fillStyle = `rgba(255, 193, 7, ${0.5 * pulse})`;
    ctx.beginPath();
    ctx.arc(cx, cy, imgSize / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#ffc107';
    ctx.lineWidth = 4;
    ctx.stroke();
    // Draw a tent/event icon
    ctx.fillStyle = '#1a1a2e';
    ctx.font = 'bold 36px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('🎪', cx, cy);
  }
  
  // Draw radius circle (dashed border)
  ctx.strokeStyle = isNearby ? `rgba(123, 237, 159, ${0.9 * pulse})` : `rgba(255, 193, 7, ${0.8 * pulse})`;
  ctx.lineWidth = isNearby ? 6 : 4;
  ctx.setLineDash([12, 8]);
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);
  
  // Semi-transparent fill
  ctx.fillStyle = isNearby ? `rgba(123, 237, 159, 0.15)` : `rgba(255, 193, 7, 0.15)`;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  
  // Event name label (above the radius)
  ctx.fillStyle = isNearby ? '#7bed9f' : '#ffc107';
  ctx.font = 'bold 16px Rubik, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  const typeName = ev.type.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  ctx.fillText(`📢 ${typeName}`, cx, cy - r - 12);
  
  // Timer and progress label (below the image)
  ctx.font = 'bold 14px Rubik, sans-serif';
  const totalNeeded = ev.totalNeeded ?? 100;
  const totalRescued = ev.totalRescued ?? 0;
  const progressText = `${totalRescued}/${totalNeeded} rescued`;
  const timerText = isNearby ? `${secLeft}s - DROP PETS HERE!` : `${secLeft}s left - bring pets here!`;
  ctx.fillText(timerText, cx, cy + imgSize / 2 + 18);
  ctx.fillText(progressText, cx, cy + imgSize / 2 + 36);
  
  ctx.restore();
}

/** Draw teleport/port effect at a location */
function drawPortEffect(x: number, y: number, progress: number, isAppearing: boolean): void {
  ctx.save();
  
  const radius = 60;
  const alpha = isAppearing ? progress : (1 - progress);
  const scale = isAppearing ? (0.5 + progress * 0.5) : (1 + progress * 0.5);
  
  ctx.translate(x, y);
  ctx.scale(scale, scale);
  
  // Outer ring
  ctx.beginPath();
  ctx.arc(0, 0, radius, 0, Math.PI * 2);
  ctx.strokeStyle = `rgba(200, 150, 255, ${alpha * 0.8})`;
  ctx.lineWidth = 4;
  ctx.stroke();
  
  // Inner glow
  const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, radius);
  gradient.addColorStop(0, `rgba(180, 120, 255, ${alpha * 0.6})`);
  gradient.addColorStop(0.5, `rgba(140, 80, 220, ${alpha * 0.3})`);
  gradient.addColorStop(1, 'rgba(100, 50, 180, 0)');
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(0, 0, radius, 0, Math.PI * 2);
  ctx.fill();
  
  // Sparkles
  const sparkleCount = 8;
  const time = Date.now() / 100;
  for (let i = 0; i < sparkleCount; i++) {
    const angle = (i / sparkleCount) * Math.PI * 2 + time * 0.5;
    const dist = radius * 0.6 * (0.8 + Math.sin(time + i) * 0.2);
    const sx = Math.cos(angle) * dist;
    const sy = Math.sin(angle) * dist;
    const sparkleSize = 3 + Math.sin(time * 2 + i) * 1.5;
    
    ctx.beginPath();
    ctx.arc(sx, sy, sparkleSize, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(255, 255, 255, ${alpha * 0.9})`;
    ctx.fill();
  }
  
  ctx.restore();
}

/** Draw animated fire/boost flames behind the van when speed boost is active
 * @param facingDir 1 = facing right, -1 = facing left
 * @param size 'small' for permanent 20% upgrade, 'large' for temporary boost */
function drawSpeedBoostFire(cx: number, cy: number, vanHalf: number, facingDir: number, size: 'small' | 'large' = 'large'): void {
  ctx.save();
  
  // Scale factors based on flame size
  const scale = size === 'small' ? 0.5 : 1.0;
  const alphaMultiplier = size === 'small' ? 0.6 : 1.0;
  
  // Fire is at the back of the van (opposite of facing direction)
  const fireDistance = vanHalf + 8 * scale;
  const fireX = cx - facingDir * fireDistance; // Back is opposite of facing
  const fireY = cy;
  
  // Animated flame effect using time
  const time = Date.now() / 100;
  const flicker = Math.sin(time * 3) * 0.3 + 0.7;
  const flicker2 = Math.cos(time * 4) * 0.2 + 0.8;
  
  // Outer glow
  const glowRadius = 25 * scale;
  const gradient = ctx.createRadialGradient(fireX, fireY, 0, fireX, fireY, glowRadius);
  gradient.addColorStop(0, `rgba(255, 200, 50, ${0.6 * flicker * alphaMultiplier})`);
  gradient.addColorStop(0.5, `rgba(255, 100, 20, ${0.4 * flicker * alphaMultiplier})`);
  gradient.addColorStop(1, 'rgba(255, 50, 0, 0)');
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(fireX, fireY, glowRadius, 0, Math.PI * 2);
  ctx.fill();
  
  // Main flame (pointing away from van, in the back direction)
  const baseFlameLength = 18 * scale;
  const baseFlameWidth = 10 * scale;
  const flameLength = baseFlameLength + Math.sin(time * 5) * 4 * scale;
  const flameWidth = baseFlameWidth + Math.cos(time * 6) * 2 * scale;
  
  // Translate to fire position
  ctx.translate(fireX, fireY);
  // Rotate to point away from van (left if facing right, right if facing left)
  if (facingDir > 0) {
    ctx.rotate(Math.PI); // Point left (backward)
  }
  // If facing left, flame already points right (backward)
  
  // Draw flame pointing in +X direction
  ctx.beginPath();
  ctx.moveTo(-5, -flameWidth / 2);
  ctx.quadraticCurveTo(
    flameLength * 0.6, -flameWidth * 0.3 * flicker2,
    flameLength, 0
  );
  ctx.quadraticCurveTo(
    flameLength * 0.6, flameWidth * 0.3 * flicker2,
    -5, flameWidth / 2
  );
  ctx.closePath();
  
  const flameGrad = ctx.createLinearGradient(-5, 0, flameLength, 0);
  flameGrad.addColorStop(0, '#FFD700');
  flameGrad.addColorStop(0.3, '#FF8C00');
  flameGrad.addColorStop(0.7, '#FF4500');
  flameGrad.addColorStop(1, 'rgba(255, 69, 0, 0.3)');
  ctx.fillStyle = flameGrad;
  ctx.fill();
  
  // Inner bright flame
  const innerLength = flameLength * 0.6;
  const innerWidth = flameWidth * 0.5;
  ctx.beginPath();
  ctx.moveTo(-5, -innerWidth / 2);
  ctx.quadraticCurveTo(
    innerLength * 0.5, -innerWidth * 0.2,
    innerLength, 0
  );
  ctx.quadraticCurveTo(
    innerLength * 0.5, innerWidth * 0.2,
    -5, innerWidth / 2
  );
  ctx.closePath();
  ctx.fillStyle = '#FFFF80';
  ctx.fill();
  
  ctx.restore();
}

function drawPlayerShelter(p: PlayerState, isMe: boolean): void {
  // Vans are ALWAYS fixed size - shelters are now separate entities drawn by drawShelter()
  const VAN_FIXED_SIZE = 50;
  const half = VAN_FIXED_SIZE; // Vans never grow visually
  const cx = p.x;
  const cy = p.y;
  
  // Handle port animation
  const portAnim = portAnimations.get(p.id);
  let portAlpha = 1;
  if (portAnim) {
    const elapsed = Date.now() - portAnim.startTime;
    if (portAnim.phase === 'fadeIn') {
      // Fading in at new location
      portAlpha = Math.min(1, elapsed / PORT_ANIMATION_DURATION);
      if (elapsed >= PORT_ANIMATION_DURATION) {
        portAnimations.delete(p.id);
        portAlpha = 1;
      }
    }
  }
  
  // Facing direction: 1 = right, -1 = left (updated in render() based on vx)
  const speed = Math.hypot(p.vx, p.vy);
  const facingDir = vanFacingDir.get(p.id) ?? 1; // Default to facing right
  
  // Bobbing: when moving, add a small vertical bounce (shocks)
  const bobAmplitude = 3;
  const bobFreq = 0.012;
  const drawCy = speed > 0.01 ? cy + Math.sin(Date.now() * bobFreq) * bobAmplitude : cy;
  
  ctx.save();
  ctx.globalAlpha = portAlpha;
  ctx.shadowColor = 'rgba(0,0,0,0.4)';
  ctx.shadowBlur = 10;
  
  // Check if speed boost is active (temporary or permanent)
  const nowTick = latestSnapshot?.tick ?? 0;
  const hasTemporaryBoost = (p.speedBoostUntil ?? 0) > nowTick;
  const hasPermanentSpeed = !!p.vanSpeedUpgrade;
  
  // Draw speed boost fire effect behind van (before van body)
  // Large flame for temporary boost, small flame for permanent 20% upgrade
  if (!p.eliminated) {
    if (hasTemporaryBoost) {
      drawSpeedBoostFire(cx, drawCy, half, facingDir, 'large');
    } else if (hasPermanentSpeed) {
      drawSpeedBoostFire(cx, drawCy, half, facingDir, 'small');
    }
  }
  
  // Determine fill color/gradient
  let fillStyle: string | CanvasGradient;
  let baseColor = isMe ? '#7bed9f' : hashColor(p.id);
  if (p.eliminated) {
    fillStyle = 'rgba(100,100,100,0.5)';
    baseColor = '#666';
  } else if (p.shelterColor) {
    if (p.shelterColor.startsWith('gradient:')) {
      const parts = p.shelterColor.split(':');
      const color1 = parts[1] || '#ff5500';
      const color2 = parts[2] || '#00aaff';
      fillStyle = color1; // Will create gradient after transform
      baseColor = color1;
    } else {
      fillStyle = p.shelterColor;
      baseColor = p.shelterColor;
    }
  } else {
    fillStyle = baseColor;
  }
  
  // Van dimensions - always van shape (shelters are separate entities now)
  const vanWidth = half * 2;
  const vanHeight = half * 1.2; // Van is elongated rectangle
  const cornerRadius = Math.min(12, half * 0.3);
  const wheelRadius = Math.min(10, half * 0.25);
  
  // Translate to center - NO rotation, just horizontal flip based on facing direction
  ctx.translate(cx, drawCy);
  // Flip horizontally if facing left (wheels always stay at bottom)
  if (facingDir < 0) {
    ctx.scale(-1, 1);
  }
  
  // Handle gradient
  if (p.shelterColor?.startsWith('gradient:') && !p.eliminated) {
    const parts = p.shelterColor.split(':');
    const color1 = parts[1] || '#ff5500';
    const color2 = parts[2] || '#00aaff';
    const grad = ctx.createLinearGradient(-half, 0, half, 0);
    grad.addColorStop(0, color1);
    grad.addColorStop(1, color2);
    fillStyle = grad;
  }
  
  // Draw van body relative to origin (rounded rectangle)
  // Van is drawn pointing right (+x is front), horizontal flip handles left direction
  ctx.fillStyle = fillStyle;
  ctx.beginPath();
  ctx.roundRect(-half, -vanHeight * 0.5, vanWidth, vanHeight, cornerRadius);
  ctx.fill();
  
  // Van cabin (front section - darker) - front is on the right (+x direction)
  const cabinWidth = vanWidth * 0.3;
  ctx.fillStyle = 'rgba(0,0,0,0.15)';
  ctx.beginPath();
  ctx.roundRect(-half + vanWidth - cabinWidth, -vanHeight * 0.5, cabinWidth, vanHeight, [0, cornerRadius, cornerRadius, 0]);
  ctx.fill();
  
  // Window (in cabin)
  const windowPad = 4;
  const windowWidth = cabinWidth - windowPad * 2;
  const windowHeight = vanHeight * 0.4;
  ctx.fillStyle = 'rgba(135,206,250,0.7)';
  ctx.beginPath();
  ctx.roundRect(-half + vanWidth - cabinWidth + windowPad, -vanHeight * 0.5 + windowPad, windowWidth, windowHeight, 4);
  ctx.fill();
  
  // Van border (draw before wheels so border is on body only)
  const hasAllyRequest = !isMe && sentAllyRequests.has(p.id);
  if (hasAllyRequest) {
    ctx.strokeStyle = '#7bed9f';
    ctx.lineWidth = 3;
    ctx.setLineDash([6, 4]);
  } else {
    ctx.strokeStyle = isMe ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.5)';
    ctx.lineWidth = isMe ? 3 : 2;
  }
  ctx.beginPath();
  ctx.roundRect(-half, -vanHeight * 0.5, vanWidth, vanHeight, cornerRadius);
  ctx.stroke();
  ctx.setLineDash([]);
  
  // Wheels (always at bottom - wheels stay on ground/south)
  ctx.fillStyle = '#333';
  // Front wheel (right side in local coordinates, which is the front)
  const frontWheelX = half - vanWidth * 0.3;
  // Rear wheel (left side in local coordinates)
  const rearWheelX = -half + vanWidth * 0.3;
  // Wheels are below the van body (always at bottom/south)
  const wheelY = vanHeight * 0.5 + wheelRadius * 0.3;
  ctx.beginPath();
  ctx.arc(rearWheelX, wheelY, wheelRadius, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(frontWheelX, wheelY, wheelRadius, 0, Math.PI * 2);
  ctx.fill();
  // Wheel hubcaps
  ctx.fillStyle = '#888';
  ctx.beginPath();
  ctx.arc(rearWheelX, wheelY, wheelRadius * 0.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(frontWheelX, wheelY, wheelRadius * 0.4, 0, Math.PI * 2);
  ctx.fill();
  
  // Undo horizontal flip so text is always readable
  if (facingDir < 0) {
    ctx.scale(-1, 1);
  }
  
  // Pet count label (move into center of van with white font)
  const displayCapacity = Math.min(Math.floor(p.size), VAN_MAX_CAPACITY);
  ctx.fillStyle = '#fff'; // Use white for in-van label
  ctx.font = 'bold 13px Rubik, sans-serif';
  //we need this to align under the window - add 10px to the y position
  const yOffset = 10;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(`Pets: ${p.petsInside.length}/${displayCapacity}`, 0, yOffset); // center of van
  // Show player name only for other players (not "You" for local player)
  if (!isMe) {
    ctx.fillText(p.displayName ?? p.id, 0, -half - 24);
  }
  if (hasAllyRequest) {
    ctx.fillStyle = '#7bed9f';
    ctx.fillText('\uD83E\uDD1D', half + 10, -half);
    ctx.fillStyle = '#2d2d2d';
  }
  if (p.eliminated) {
    ctx.font = '18px sans-serif';
    ctx.fillText('\uD83D\uDC7B', 0, 0);
    ctx.font = 'bold 12px Rubik, sans-serif';
  }
  ctx.restore();
}

/** Draw a stationary pet shelter building */
function drawShelter(shelter: ShelterState, isOwner: boolean, ownerColor?: string): void {
  const cx = shelter.x;
  const cy = shelter.y;
  // Cap visual size to 400px to prevent overflow (logical size can be larger for win condition)
  const baseSize = SHELTER_BASE_RADIUS + shelter.size * SHELTER_RADIUS_PER_SIZE;
  const half = Math.min(400, Math.max(40, baseSize));
  
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.4)';
  ctx.shadowBlur = 12;
  
  // Main building body - use owner's van color (including gradients)
  let buildingFill: string | CanvasGradient;
  if (ownerColor?.startsWith('gradient:')) {
    const parts = ownerColor.split(':');
    const color1 = parts[1] || '#7bed9f';
    const color2 = parts[2] || '#3cb371';
    const grad = ctx.createLinearGradient(cx - half, cy, cx + half, cy);
    grad.addColorStop(0, color1);
    grad.addColorStop(1, color2);
    buildingFill = grad;
  } else if (ownerColor) {
    buildingFill = ownerColor;
  } else {
    buildingFill = isOwner ? '#7bed9f' : hashColor(shelter.ownerId);
  }
  ctx.fillStyle = buildingFill;
  const buildingW = half * 2;
  const buildingH = half * 1.4;
  const buildingL = cx - half;
  const buildingT = cy - buildingH * 0.4;
  ctx.beginPath();
  ctx.roundRect(buildingL, buildingT, buildingW, buildingH, 6);
  ctx.fill();
  
  // Roof (triangle/peaked roof)
  ctx.fillStyle = '#8B4513'; // Brown roof
  ctx.beginPath();
  ctx.moveTo(buildingL - 10, buildingT);
  ctx.lineTo(cx, buildingT - half * 0.5);
  ctx.lineTo(buildingL + buildingW + 10, buildingT);
  ctx.closePath();
  ctx.fill();
  
  // Roof outline
  ctx.strokeStyle = '#654321';
  ctx.lineWidth = 2;
  ctx.stroke();
  
  // Door
  const doorW = buildingW * 0.2;
  const doorH = buildingH * 0.5;
  ctx.fillStyle = '#654321';
  ctx.fillRect(cx - doorW / 2, buildingT + buildingH - doorH, doorW, doorH);
  
  // Kennels/cages (small squares representing pet cages)
  const kennelSize = 12;
  const kennelPad = 4;
  const kennelsPerRow = Math.floor((buildingW - 40) / (kennelSize + kennelPad));
  const numKennels = Math.min(shelter.petsInside.length + 2, kennelsPerRow * 2);
  
  for (let i = 0; i < numKennels; i++) {
    const row = Math.floor(i / kennelsPerRow);
    const col = i % kennelsPerRow;
    const kx = buildingL + 20 + col * (kennelSize + kennelPad);
    const ky = buildingT + 15 + row * (kennelSize + kennelPad);
    
    // Kennel background
    const hasPet = i < shelter.petsInside.length;
    ctx.fillStyle = hasPet ? '#c9a86c' : '#aaa';
    ctx.fillRect(kx, ky, kennelSize, kennelSize);
    
    // Kennel bars
    ctx.strokeStyle = '#666';
    ctx.lineWidth = 1;
    ctx.strokeRect(kx, ky, kennelSize, kennelSize);
  }
  
  // Fence around building
  ctx.setLineDash([5, 5]);
  ctx.strokeStyle = isOwner ? '#7bed9f' : 'rgba(255,255,255,0.5)';
  ctx.lineWidth = 2;
  const fenceMargin = 15;
  ctx.strokeRect(
    buildingL - fenceMargin,
    buildingT - half * 0.5 - fenceMargin,
    buildingW + fenceMargin * 2,
    buildingH + half * 0.5 + fenceMargin * 2
  );
  ctx.setLineDash([]);
  
  // Upgrade indicators (icons)
  const iconY = buildingT - half * 0.5 - 25;
  let iconX = cx - 30;
  ctx.font = '14px sans-serif';
  ctx.textAlign = 'center';
  
  if (shelter.hasAdoptionCenter) {
    ctx.fillText('🐾', iconX, iconY); // Paw for adoption center
    iconX += 20;
  }
  if (shelter.hasGravity) {
    ctx.fillText('🧲', iconX, iconY); // Magnet for gravity
    iconX += 20;
  }
  if (shelter.hasAdvertising) {
    ctx.fillText('📢', iconX, iconY); // Megaphone for advertising
    iconX += 20;
  }
  
  // Owner label
  ctx.fillStyle = '#333';
  ctx.font = 'bold 11px Rubik, sans-serif';
  ctx.textAlign = 'center';
  const ownerLabel = isOwner ? 'Your Shelter' : `Shelter`;
  ctx.fillText(ownerLabel, cx, buildingT - half * 0.5 - 8);
  
  // Tier badge - shows tier 1-5 with stars, or level number for higher
  const tier = shelter.tier ?? 1;
  const tierColors = ['#888', '#7bed9f', '#70a3ff', '#c77dff', '#ffd700']; // Gray, Green, Blue, Purple, Gold
  const tierColor = tierColors[Math.min(tier - 1, 4)];
  
  // Draw tier badge (top-right corner of shelter)
  const badgeX = cx + half * 0.8;
  const badgeY = buildingT - half * 0.3;
  
  // Badge background circle
  ctx.fillStyle = tierColor;
  ctx.beginPath();
  ctx.arc(badgeX, badgeY, 14, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 2;
  ctx.stroke();
  
  // Tier number or star
  ctx.fillStyle = tier >= 5 ? '#333' : '#fff';
  ctx.font = 'bold 12px Rubik, sans-serif';
  ctx.textBaseline = 'middle';
  if (tier >= 5) {
    ctx.fillText('★' + tier, badgeX, badgeY);
  } else {
    ctx.fillText(String(tier), badgeX, badgeY);
  }
  ctx.textBaseline = 'alphabetic';
  
  // Pet count
  ctx.fillStyle = '#fff';
  ctx.font = '10px Rubik, sans-serif';
  ctx.fillText(`Pets: ${shelter.petsInside.length}`, cx, buildingT + buildingH + 12);
  
  // Adoptions count
  ctx.fillStyle = '#7bed9f';
  ctx.fillText(`Adoptions: ${shelter.totalAdoptions}`, cx, buildingT + buildingH + 24);
  
  ctx.restore();
}

/** Draw a breeder mill - enemy structure that spawns wild strays */
function drawBreederShelter(shelter: BreederShelterState): void {
  const cx = shelter.x;
  const cy = shelter.y;
  const baseSize = 80 + shelter.size * 0.8; // Size scales with level
  
  ctx.save();
  
  // Pulsing red glow effect
  const pulse = 0.5 + 0.5 * Math.sin(Date.now() / 200);
  ctx.shadowColor = `rgba(255, 0, 0, ${0.4 + pulse * 0.3})`;
  ctx.shadowBlur = 20 + pulse * 10;
  
  // Draw the breeder mill image if loaded, otherwise fallback to shape
  if (breederMillImageLoaded) {
    const imgW = baseSize * 1.5;
    const imgH = baseSize * 1.2;
    ctx.drawImage(breederMillImage, cx - imgW / 2, cy - imgH / 2, imgW, imgH);
  } else {
    // Fallback: draw a simple building shape
    ctx.fillStyle = '#4a1a1a';
    ctx.beginPath();
    ctx.roundRect(cx - baseSize / 2, cy - baseSize / 2.5, baseSize, baseSize * 0.8, 6);
    ctx.fill();
    
    ctx.strokeStyle = `rgba(255, 68, 68, ${0.6 + pulse * 0.4})`;
    ctx.lineWidth = 3;
    ctx.stroke();
  }
  
  // Reset shadow for text
  ctx.shadowBlur = 0;
  
  // Label above
  ctx.fillStyle = '#ff4444';
  ctx.font = 'bold 12px Rubik, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.fillText(`Breeder Mill Lv${shelter.level}`, cx, cy - baseSize / 2 - 5);
  
  // Warning text below
  ctx.fillStyle = '#ffaa00';
  ctx.font = '10px Rubik, sans-serif';
  ctx.textBaseline = 'top';
  ctx.fillText('Spawning wild strays!', cx, cy + baseSize / 2.5 + 5);
  
  ctx.restore();
}

/** Pet type emojis for map strays (same as adoption drop-off graphic) */
const STRAY_PET_EMOJIS: Record<number, string> = {
  [PET_TYPE_CAT]: '🐈',
  [PET_TYPE_DOG]: '🐕',
  [PET_TYPE_BIRD]: '🐦',
  [PET_TYPE_RABBIT]: '🐰',
  [PET_TYPE_SPECIAL]: '⭐',
};

/** Draw a stray on the map using the same graphic as adoption drop-off (emoji by type). Only boosts use circles. */
function drawStray(x: number, y: number, petType: number = PET_TYPE_CAT): void {
  ctx.save();
  ctx.globalAlpha = 1;
  const emoji = STRAY_PET_EMOJIS[petType] ?? STRAY_PET_EMOJIS[PET_TYPE_CAT];
  ctx.font = '30px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = 'rgba(0,0,0,0.8)';
  ctx.shadowBlur = 4;
  ctx.fillText(emoji, x, y);
  if (petType === PET_TYPE_SPECIAL) {
    ctx.shadowColor = '#ffd700';
    ctx.shadowBlur = 12;
    ctx.fillText(emoji, x, y);
  }
  ctx.shadowBlur = 0;
  ctx.restore();
}

/** Draw a breeder camp: bigger tent, small enclosed pen, random pets breeding inside */
function drawBreederCamp(x: number, y: number, level: number = 1): void {
  const campRadius = 35;
  const penRadius = 14; // Small enclosed fence (animal pen)
  const postCount = 10; // Short fence posts around pen
  const postHeight = 8;
  const postWidth = 3;
  
  ctx.save();
  ctx.translate(x, y);
  
  // Ground circle (dirt floor)
  ctx.beginPath();
  ctx.arc(0, 0, campRadius - 4, 0, Math.PI * 2);
  ctx.fillStyle = '#5a4a3a';
  ctx.fill();
  
  // Small enclosed fence (animal pen) - low rails around pen area
  ctx.fillStyle = '#8B4513';
  ctx.strokeStyle = '#5a3810';
  ctx.lineWidth = 1;
  for (let i = 0; i < postCount; i++) {
    const angle = (i / postCount) * Math.PI * 2;
    const px = Math.cos(angle) * penRadius;
    const py = Math.sin(angle) * penRadius;
    ctx.fillRect(px - postWidth / 2, py - postHeight / 2, postWidth, postHeight);
  }
  ctx.beginPath();
  ctx.arc(0, 0, penRadius, 0, Math.PI * 2);
  ctx.strokeStyle = '#6d4c35';
  ctx.lineWidth = 2;
  ctx.stroke();
  
  // Random pets inside the pen (deterministic from x, y, level)
  const seed = ((x * 7 + y * 31 + level * 101) | 0) >>> 0;
  const petColors = ['#ff9f43', '#a17851', '#74b9ff', '#dfe6e9']; // cat, dog, bird, rabbit
  const nPets = 2 + (seed % 3); // 2-4 pets
  for (let i = 0; i < nPets; i++) {
    const s = (seed + i * 17) >>> 0;
    const px = ((s % 17) - 8) * 0.9;
    const py = (((s >> 4) % 17) - 8) * 0.9;
    ctx.beginPath();
    ctx.arc(px, py, 4, 0, Math.PI * 2);
    ctx.fillStyle = petColors[(s >> 8) % petColors.length];
    ctx.fill();
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 0.8;
    ctx.stroke();
  }
  
  // Bigger tent (main structure) - larger triangle
  ctx.beginPath();
  ctx.moveTo(-20, 12);
  ctx.lineTo(0, -18);
  ctx.lineTo(20, 12);
  ctx.closePath();
  ctx.fillStyle = '#D2B48C';
  ctx.fill();
  ctx.strokeStyle = '#8B7355';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(-7, 12);
  ctx.lineTo(0, 4);
  ctx.lineTo(7, 12);
  ctx.fillStyle = '#4a3a2a';
  ctx.fill();
  
  ctx.restore();
  
  // Level badge (white box with level number)
  const badgeX = x + campRadius - 10;
  const badgeY = y - campRadius + 5;
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.roundRect(badgeX - 10, badgeY - 8, 20, 16, 3);
  ctx.fill();
  ctx.strokeStyle = '#333';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.fillStyle = '#000';
  ctx.font = 'bold 11px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(`${level}`, badgeX, badgeY);
  
  // Calculate estimated RT cost to beat this camp
  const basePets = 3 + Math.min(2, Math.floor(level / 2));
  const petCount = Math.min(basePets + Math.floor(level / 2), 8);
  let ingredientCount = 1;
  let avgIngredientCost = 8;
  if (level >= 10) {
    ingredientCount = 4;
    avgIngredientCost = 13;
  } else if (level >= 6) {
    ingredientCount = 3;
    avgIngredientCost = 11;
  } else if (level >= 3) {
    ingredientCount = 2;
  }
  const estimatedRtCost = petCount * ingredientCount * avgIngredientCost;
  
  ctx.font = 'bold 10px Rubik, sans-serif';
  ctx.fillStyle = '#ff6b6b';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(`Lv${level} ~${estimatedRtCost}RT`, x, y + campRadius + 12);
}

function drawPickup(u: PickupState): void {
  const h = GROWTH_ORB_RADIUS;
  ctx.save();
  
  // Breeder camps get special detailed rendering
  if (u.type === PICKUP_TYPE_BREEDER) {
    drawBreederCamp(u.x, u.y, u.level ?? 1);
    ctx.restore();
    return;
  }
  
  // Color by type: green=growth, blue=speed, purple=random port, teal=shelter port
  let fillColor = '#7bed9f';
  let strokeColor = '#2d5a38';
  let label = '+Size';
  if (u.type === PICKUP_TYPE_SPEED) {
    fillColor = '#70a3ff';
    strokeColor = '#2d4a6e';
    label = 'Speed';
  } else if (u.type === PICKUP_TYPE_PORT) {
    fillColor = '#c77dff';
    strokeColor = '#6a3d7a';
    label = 'Random';
  } else if (u.type === PICKUP_TYPE_SHELTER_PORT) {
    fillColor = '#10b981';
    strokeColor = '#047857';
    label = 'Home';
  }
  ctx.fillStyle = fillColor;
  ctx.fillRect(u.x - h, u.y - h, h * 2, h * 2);
  ctx.strokeStyle = strokeColor;
  ctx.lineWidth = 2;
  ctx.strokeRect(u.x - h, u.y - h, h * 2, h * 2);
  ctx.fillStyle = '#333';
  ctx.font = '10px Rubik, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(label, u.x, u.y + GROWTH_ORB_RADIUS + 10);
  ctx.restore();
}

function render(dt: number): void {
  try {
    // Update van facing direction (left/right) based on horizontal velocity
    if (latestSnapshot) {
      for (const p of latestSnapshot.players) {
        // Only update direction when there's significant horizontal movement
        if (Math.abs(p.vx) > 0.5) {
          vanFacingDir.set(p.id, p.vx > 0 ? 1 : -1);
        }
        // When stopped or moving mostly vertically, keep last facing direction
      }
    }

    const cam = getCamera();
    const camX = Number.isFinite(cam.x) ? Math.max(0, Math.min(MAP_WIDTH - cam.w, cam.x)) : 0;
    const camY = Number.isFinite(cam.y) ? Math.max(0, Math.min(MAP_HEIGHT - cam.h, cam.y)) : 0;
    const safeCam = { x: camX, y: camY, w: cam.w, h: cam.h };
    ctx.save();
    ctx.translate(-safeCam.x, -safeCam.y);
    drawMapBackground(safeCam);

  if (latestSnapshot) {
    // Draw adoption zones - fallback to center zone if empty
    const zones = latestSnapshot.adoptionZones.length > 0 
      ? latestSnapshot.adoptionZones 
      : [{ id: 'adopt-fallback', x: MAP_WIDTH / 2, y: MAP_HEIGHT / 2, radius: ADOPTION_ZONE_RADIUS }];
    for (const z of zones) {
      drawAdoptionZone(z);
    }
    for (const ev of latestSnapshot.adoptionEvents ?? []) {
      drawAdoptionEvent(ev, latestSnapshot.tick);
    }
    for (const u of latestSnapshot.pickups ?? []) {
      drawPickup(u);
    }
    // Draw player-built shelters (stationary buildings)
    for (const shelter of latestSnapshot.shelters ?? []) {
      const isOwner = shelter.ownerId === myPlayerId;
      const owner = latestSnapshot.players.find(p => p.id === shelter.ownerId);
      const ownerColor = owner?.shelterColor;
      drawShelter(shelter, isOwner, ownerColor);
    }
    // Draw breeder shelters (enemy structures)
    for (const breederShelter of latestSnapshot.breederShelters ?? []) {
      drawBreederShelter(breederShelter);
    }
  }

  for (const pet of latestSnapshot?.pets ?? []) {
    if (pet.insideShelterId !== null) continue;
    const p = getInterpolatedPet(pet.id) ?? pet;
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
    // Skip uninitialized pets at (0,0) - ghost stray fix
    if (p.x === 0 && p.y === 0) continue;
    drawStray(p.x, p.y, pet.petType ?? PET_TYPE_CAT);
  }

  // Sort players by size so larger ones render on top
  const sortedPlayers = [...(latestSnapshot?.players ?? [])].sort((a, b) => a.size - b.size);
  for (const pl of sortedPlayers) {
    const isMe = pl.id === myPlayerId;
    let p: PlayerState;
    if (isMe && predictedPlayer) {
      // Use smoothed display position for local player so shelter doesn't snap on server updates
      let drawX = playerDisplayX ?? predictedPlayer.x;
      let drawY = playerDisplayY ?? predictedPlayer.y;
      if (!Number.isFinite(drawX) || !Number.isFinite(drawY)) {
        drawX = predictedPlayer.x;
        drawY = predictedPlayer.y;
      }
      if (!Number.isFinite(drawX) || !Number.isFinite(drawY)) {
        drawX = MAP_WIDTH / 2;
        drawY = MAP_HEIGHT / 2;
      }
      p = { ...predictedPlayer, x: drawX, y: drawY };
    } else {
      p = getInterpolatedPlayer(pl.id) ?? pl;
    }
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
    drawPlayerShelter(p, isMe);
    if (isMe && growthPopUntil > Date.now()) {
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      const sx = canvas.width / 2;
      const sy = canvas.height / 2 - 60;
      ctx.fillStyle = '#7bed9f';
      ctx.font = 'bold 28px Rubik, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('+1 Size!', sx, sy);
      ctx.restore();
    }
  }
  
  // Draw adoption animations (pets traveling to adoption center)
  const nowMs = Date.now();
  for (let i = adoptionAnimations.length - 1; i >= 0; i--) {
    const anim = adoptionAnimations[i];
    const elapsed = nowMs - anim.startTime;
    
    if (elapsed < 0) continue; // Hasn't started yet (staggered)
    
    if (elapsed > ADOPTION_ANIMATION_DURATION) {
      // Animation finished, remove it
      adoptionAnimations.splice(i, 1);
      continue;
    }
    
    const progress = elapsed / ADOPTION_ANIMATION_DURATION;
    // Ease out curve for smooth deceleration
    const easedProgress = 1 - Math.pow(1 - progress, 3);
    
    // Interpolate position
    const x = anim.fromX + (anim.toX - anim.fromX) * easedProgress;
    const y = anim.fromY + (anim.toY - anim.fromY) * easedProgress - Math.sin(progress * Math.PI) * 50; // Arc upward
    
    // Fade out near the end
    const alpha = progress < 0.8 ? 1 : 1 - (progress - 0.8) / 0.2;
    
    // Draw the pet emoji
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.font = 'bold 32px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(ADOPTION_PET_EMOJIS[anim.petType] ?? '🐾', x, y);
    ctx.restore();
  }

  // Draw port animations (teleport effects at old locations)
  for (const [playerId, anim] of portAnimations) {
    const elapsed = Date.now() - anim.startTime;
    const progress = Math.min(1, elapsed / PORT_ANIMATION_DURATION);
    
    if (anim.phase === 'fadeIn') {
      // Draw appearing effect at new location
      drawPortEffect(anim.toX, anim.toY, progress, true);
      
      // Also draw disappearing effect at old location (only in first half)
      if (progress < 0.5) {
        drawPortEffect(anim.fromX, anim.fromY, progress * 2, false);
      }
    }
  }

  ctx.restore();

  const scale = 120 / MAP_WIDTH;
  minimapCtx.fillStyle = '#2d4a2d';
  minimapCtx.fillRect(0, 0, 120, 120);
  for (let yy = 0; yy <= MAP_HEIGHT; yy += DOT_SPACING * 3) {
    for (let xx = 0; xx <= MAP_WIDTH; xx += DOT_SPACING * 3) {
      minimapCtx.fillStyle = 'rgba(255,255,255,0.15)';
      minimapCtx.fillRect(xx * scale - 0.8, yy * scale - 0.8, 1.6, 1.6);
    }
  }
  if (latestSnapshot) {
    // Draw adoption zones on minimap - fallback to center zone if empty
    const minimapZones = latestSnapshot.adoptionZones.length > 0 
      ? latestSnapshot.adoptionZones 
      : [{ id: 'adopt-fallback', x: MAP_WIDTH / 2, y: MAP_HEIGHT / 2, radius: ADOPTION_ZONE_RADIUS }];
    for (const z of minimapZones) {
      const zRadius = z.radius || ADOPTION_ZONE_RADIUS;
      const r = Math.max(3, (zRadius * scale) | 0); // At least 3 pixels visible
      minimapCtx.fillStyle = 'rgba(123, 237, 159, 0.6)';
      minimapCtx.fillRect(z.x * scale - r, z.y * scale - r, r * 2, r * 2);
    }
    for (const pet of latestSnapshot.pets) {
      if (pet.insideShelterId !== null) continue;
      // Skip uninitialized pets at (0,0)
      if (pet.x === 0 && pet.y === 0) continue;
      minimapCtx.fillStyle = '#c9a86c';
      minimapCtx.fillRect(pet.x * scale - 2, pet.y * scale - 2, 4, 4);
    }
    for (const u of latestSnapshot.pickups ?? []) {
      const px = u.x * scale;
      const py = u.y * scale;
      
      if (u.type === PICKUP_TYPE_BREEDER) {
        // Breeder camps: brown with pulsing glow effect
        const glowIntensity = 0.5 + 0.5 * Math.sin(Date.now() / 200);
        const glowRadius = 8 + glowIntensity * 4;
        
        // Draw glow layers
        minimapCtx.save();
        minimapCtx.shadowColor = '#ff4444';
        minimapCtx.shadowBlur = glowRadius;
        minimapCtx.fillStyle = '#8B4513'; // Brown
        minimapCtx.beginPath();
        minimapCtx.arc(px, py, 4, 0, Math.PI * 2);
        minimapCtx.fill();
        
        // Draw border glow
        minimapCtx.strokeStyle = `rgba(255, 68, 68, ${0.7 + glowIntensity * 0.3})`;
        minimapCtx.lineWidth = 2;
        minimapCtx.stroke();
        minimapCtx.restore();
      } else {
        minimapCtx.fillStyle = u.type === PICKUP_TYPE_GROWTH ? '#7bed9f' : 
                               u.type === PICKUP_TYPE_PORT ? '#c77dff' : 
                               u.type === PICKUP_TYPE_SHELTER_PORT ? '#10b981' : '#70a3ff';
        minimapCtx.fillRect(px - 2, py - 2, 4, 4);
      }
    }
    // Draw shelters on minimap (buildings)
    for (const shelter of latestSnapshot.shelters ?? []) {
      const isOwner = shelter.ownerId === myPlayerId;
      const sx = shelter.x * scale;
      const sy = shelter.y * scale;
      
      // Calculate the coverage radius (actual shelter size)
      const cappedSize = Math.min(shelter.size, 2000);
      const shelterSize = (SHELTER_BASE_RADIUS + cappedSize * SHELTER_RADIUS_PER_SIZE) * scale;
      const coverageRadius = Math.min(60, Math.max(4, shelterSize));
      
      // Draw small fixed-size building icon (doesn't grow)
      const iconHalf = 4;
      minimapCtx.fillStyle = isOwner ? '#e8d5b7' : '#d4c4a8';
      minimapCtx.fillRect(sx - iconHalf, sy - iconHalf, iconHalf * 2, iconHalf * 2);
      minimapCtx.strokeStyle = isOwner ? '#7bed9f' : '#8B4513';
      minimapCtx.lineWidth = 1;
      minimapCtx.strokeRect(sx - iconHalf, sy - iconHalf, iconHalf * 2, iconHalf * 2);
      
      // Draw home icon for player's own shelter
      if (isOwner) {
        // Draw a small house roof shape
        minimapCtx.fillStyle = '#7bed9f';
        minimapCtx.beginPath();
        minimapCtx.moveTo(sx, sy - iconHalf - 4); // Top of roof
        minimapCtx.lineTo(sx - 5, sy - iconHalf + 1); // Left corner
        minimapCtx.lineTo(sx + 5, sy - iconHalf + 1); // Right corner
        minimapCtx.closePath();
        minimapCtx.fill();
        // House body indicator
        minimapCtx.fillRect(sx - 3, sy - iconHalf + 1, 6, 5);
        
        // Draw pulsing radar coverage if shelter has grown beyond base size
        if (coverageRadius > 8) {
          minimapCtx.save();
          
          // Pulsing radar effect - expanding ring
          const pulseTime = Date.now() / 1500; // Slower pulse (1.5s cycle)
          const pulseProgress = pulseTime % 1;
          const pulseRadius = coverageRadius * pulseProgress;
          const pulseAlpha = 0.6 * (1 - pulseProgress);
          
          minimapCtx.strokeStyle = `rgba(123, 237, 159, ${pulseAlpha})`;
          minimapCtx.lineWidth = 2;
          minimapCtx.beginPath();
          minimapCtx.arc(sx, sy, pulseRadius, 0, Math.PI * 2);
          minimapCtx.stroke();
          
          // Second pulse offset by half cycle for continuous effect
          const pulse2Progress = (pulseTime + 0.5) % 1;
          const pulse2Radius = coverageRadius * pulse2Progress;
          const pulse2Alpha = 0.6 * (1 - pulse2Progress);
          
          minimapCtx.strokeStyle = `rgba(123, 237, 159, ${pulse2Alpha})`;
          minimapCtx.beginPath();
          minimapCtx.arc(sx, sy, pulse2Radius, 0, Math.PI * 2);
          minimapCtx.stroke();
          
          // Static dashed outline showing max coverage
          minimapCtx.strokeStyle = 'rgba(123, 237, 159, 0.4)';
          minimapCtx.lineWidth = 1;
          minimapCtx.setLineDash([3, 3]);
          minimapCtx.beginPath();
          minimapCtx.arc(sx, sy, coverageRadius, 0, Math.PI * 2);
          minimapCtx.stroke();
          minimapCtx.setLineDash([]);
          
          minimapCtx.restore();
        }
      }
    }
    // Draw breeder shelters (mills) on minimap - prominent so they're easily seen
    for (const breederShelter of latestSnapshot.breederShelters ?? []) {
      const bx = breederShelter.x * scale;
      const by = breederShelter.y * scale;
      const bHalf = Math.max(10, (40 + breederShelter.size * 0.5) * scale); // Min 10px so mill is always visible
      const pulse = 0.5 + 0.5 * Math.sin(Date.now() / 200);
      minimapCtx.save();
      minimapCtx.shadowColor = '#ff0000';
      minimapCtx.shadowBlur = 8 + pulse * 8;
      minimapCtx.fillStyle = '#cc2222';
      minimapCtx.fillRect(bx - bHalf, by - bHalf, bHalf * 2, bHalf * 2);
      minimapCtx.strokeStyle = `rgba(255, 50, 50, ${0.9 + pulse * 0.1})`;
      minimapCtx.lineWidth = 2.5;
      minimapCtx.strokeRect(bx - bHalf, by - bHalf, bHalf * 2, bHalf * 2);
      minimapCtx.restore();
    }
    // Draw adoption events on minimap (pulsing teal ring for visibility)
    for (const ev of latestSnapshot.adoptionEvents ?? []) {
      const ex = ev.x * scale;
      const ey = ev.y * scale;
      const r = Math.min(12, ev.radius * scale);
      
      // Pulsing effect - creates an expanding ring animation
      const pulseTime = Date.now() % 2000; // 2 second cycle
      const pulseProgress = pulseTime / 2000;
      const pulseRadius = r + pulseProgress * 8; // Expands outward
      const pulseAlpha = 1 - pulseProgress; // Fades out as it expands
      
      minimapCtx.save();
      
      // Draw expanding pulse ring
      minimapCtx.strokeStyle = `rgba(94, 234, 212, ${pulseAlpha * 0.8})`;
      minimapCtx.lineWidth = 3 - pulseProgress * 2;
      minimapCtx.beginPath();
      minimapCtx.arc(ex, ey, pulseRadius, 0, Math.PI * 2);
      minimapCtx.stroke();
      
      // Draw second pulse ring (offset timing for continuous effect)
      const pulse2Time = (Date.now() + 1000) % 2000;
      const pulse2Progress = pulse2Time / 2000;
      const pulse2Radius = r + pulse2Progress * 8;
      const pulse2Alpha = 1 - pulse2Progress;
      minimapCtx.strokeStyle = `rgba(94, 234, 212, ${pulse2Alpha * 0.8})`;
      minimapCtx.lineWidth = 3 - pulse2Progress * 2;
      minimapCtx.beginPath();
      minimapCtx.arc(ex, ey, pulse2Radius, 0, Math.PI * 2);
      minimapCtx.stroke();
      
      // Draw glowing center
      minimapCtx.shadowColor = '#5eead4';
      minimapCtx.shadowBlur = 6 + Math.sin(Date.now() * 0.005) * 3;
      
      // Main event circle
      minimapCtx.strokeStyle = '#5eead4';
      minimapCtx.lineWidth = 2;
      minimapCtx.setLineDash([4, 4]);
      minimapCtx.beginPath();
      minimapCtx.arc(ex, ey, r, 0, Math.PI * 2);
      minimapCtx.stroke();
      minimapCtx.setLineDash([]);
      
      // Filled center
      minimapCtx.fillStyle = 'rgba(94, 234, 212, 0.4)';
      minimapCtx.fill();
      
      // Draw event icon in center
      minimapCtx.fillStyle = '#5eead4';
      minimapCtx.font = 'bold 8px sans-serif';
      minimapCtx.textAlign = 'center';
      minimapCtx.textBaseline = 'middle';
      minimapCtx.fillText('📢', ex, ey);
      
      minimapCtx.restore();
    }
    // Sort players by adoption count for leader visibility scaling
    const sortedByAdoptions = [...latestSnapshot.players].sort((a, b) => b.totalAdoptions - a.totalAdoptions);
    for (const pl of latestSnapshot.players) {
      let mapColor = pl.id === myPlayerId ? '#7bed9f' : hashColor(pl.id);
      if (pl.shelterColor) {
        if (pl.shelterColor.startsWith('gradient:')) {
          // Use first gradient color for minimap
          mapColor = pl.shelterColor.split(':')[1] || mapColor;
        } else {
          mapColor = pl.shelterColor;
        }
      }
      minimapCtx.fillStyle = mapColor;
      // Vans are always fixed size on minimap (shelters are drawn separately)
      const VAN_MINIMAP_SIZE = 50;
      const r = VAN_MINIMAP_SIZE * scale;
      // Leader visibility: scale up dots based on adoption rank
      const adoptionRank = sortedByAdoptions.indexOf(pl);
      const leaderScale = adoptionRank === 0 ? 1.5 : adoptionRank <= 2 ? 1.2 : 1.0;
      const half = Math.max(2, r) * leaderScale;
      minimapCtx.fillRect(pl.x * scale - half, pl.y * scale - half, half * 2, half * 2);
      // Draw crown indicator for the leader
      if (adoptionRank === 0 && latestSnapshot.players.length > 1) {
        minimapCtx.fillStyle = '#ffd700';
        minimapCtx.beginPath();
        minimapCtx.arc(pl.x * scale, pl.y * scale - half - 3, 3, 0, Math.PI * 2);
        minimapCtx.fill();
      }
    }
  }
  // Draw viewport indicator on minimap
  const vpX = safeCam.x * scale;
  const vpY = safeCam.y * scale;
  const vpW = safeCam.w * scale;
  const vpH = safeCam.h * scale;
  minimapCtx.strokeStyle = 'rgba(255,255,255,0.6)';
  minimapCtx.lineWidth = 1.5;
  minimapCtx.strokeRect(vpX, vpY, vpW, vpH);
  
  minimapCtx.strokeStyle = 'rgba(255,255,255,0.2)';
  minimapCtx.lineWidth = 1;
  minimapCtx.strokeRect(0.5, 0.5, 119, 119);

  // Draw shelter locator arrow when player has a shelter and it's off-screen
  const shelterLocatorMe = latestSnapshot?.players.find(p => p.id === myPlayerId);
  const myShelterForLocator = shelterLocatorMe?.shelterId 
    ? (latestSnapshot?.shelters?.find(s => s.id === shelterLocatorMe.shelterId) ?? null) 
    : null;
  
  if (myShelterForLocator && shelterLocatorMe && !shelterLocatorMe.eliminated) {
    const vanX = predictedPlayer?.x ?? shelterLocatorMe.x;
    const vanY = predictedPlayer?.y ?? shelterLocatorMe.y;
    const shelterX = myShelterForLocator.x;
    const shelterY = myShelterForLocator.y;
    
    // Check if shelter is visible on screen
    const screenLeft = safeCam.x;
    const screenRight = safeCam.x + safeCam.w;
    const screenTop = safeCam.y;
    const screenBottom = safeCam.y + safeCam.h;
    
    const isOnScreen = shelterX >= screenLeft && shelterX <= screenRight && 
                       shelterY >= screenTop && shelterY <= screenBottom;
    
    if (!isOnScreen) {
      // Calculate angle from center of screen to shelter
      const screenCenterX = safeCam.x + safeCam.w / 2;
      const screenCenterY = safeCam.y + safeCam.h / 2;
      const angle = Math.atan2(shelterY - screenCenterY, shelterX - screenCenterX);
      
      // Calculate distance to shelter from van
      const distToShelter = Math.hypot(shelterX - vanX, shelterY - vanY);
      
      // Calculate position on screen edge for the indicator
      const margin = 60; // Distance from edge
      const halfW = canvas.width / 2 - margin;
      const halfH = canvas.height / 2 - margin;
      
      // Find intersection with screen edge
      let indicatorX = canvas.width / 2 + Math.cos(angle) * halfW;
      let indicatorY = canvas.height / 2 + Math.sin(angle) * halfH;
      
      // Clamp to screen bounds
      const aspectRatio = halfW / halfH;
      if (Math.abs(Math.cos(angle)) > Math.abs(Math.sin(angle)) * aspectRatio) {
        // Hits left or right edge
        indicatorX = canvas.width / 2 + Math.sign(Math.cos(angle)) * halfW;
        indicatorY = canvas.height / 2 + Math.tan(angle) * Math.sign(Math.cos(angle)) * halfW;
      } else {
        // Hits top or bottom edge
        indicatorY = canvas.height / 2 + Math.sign(Math.sin(angle)) * halfH;
        indicatorX = canvas.width / 2 + (1 / Math.tan(angle)) * Math.sign(Math.sin(angle)) * halfH;
      }
      
      // Clamp final position
      indicatorX = Math.max(margin, Math.min(canvas.width - margin, indicatorX));
      indicatorY = Math.max(margin, Math.min(canvas.height - margin, indicatorY));
      
      // Draw shelter indicator
      ctx.save();
      
      // Pulsing effect
      const pulse = 0.7 + 0.3 * Math.sin(Date.now() / 300);
      
      // Draw arrow pointing toward shelter
      ctx.translate(indicatorX, indicatorY);
      ctx.rotate(angle);
      
      // Arrow body
      ctx.fillStyle = `rgba(123, 237, 159, ${pulse})`;
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
      ctx.lineWidth = 2;
      
      // Arrow shape (pointing right, will be rotated)
      ctx.beginPath();
      ctx.moveTo(20, 0);      // Arrow tip
      ctx.lineTo(5, -10);     // Top back
      ctx.lineTo(5, -5);      // Top notch
      ctx.lineTo(-15, -5);    // Back top
      ctx.lineTo(-15, 5);     // Back bottom
      ctx.lineTo(5, 5);       // Bottom notch
      ctx.lineTo(5, 10);      // Bottom back
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      
      ctx.restore();
      
      // Draw shelter icon next to arrow
      ctx.save();
      const iconOffsetX = -Math.cos(angle) * 35;
      const iconOffsetY = -Math.sin(angle) * 35;
      const iconX = indicatorX + iconOffsetX;
      const iconY = indicatorY + iconOffsetY;
      
      // Draw house icon
      ctx.fillStyle = `rgba(232, 213, 183, ${pulse})`;
      ctx.strokeStyle = 'rgba(123, 237, 159, 0.9)';
      ctx.lineWidth = 2;
      
      // House body
      ctx.fillRect(iconX - 12, iconY - 8, 24, 18);
      ctx.strokeRect(iconX - 12, iconY - 8, 24, 18);
      
      // Roof
      ctx.fillStyle = `rgba(123, 237, 159, ${pulse})`;
      ctx.beginPath();
      ctx.moveTo(iconX, iconY - 20);     // Peak
      ctx.lineTo(iconX - 16, iconY - 8); // Left
      ctx.lineTo(iconX + 16, iconY - 8); // Right
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      
      // Door
      ctx.fillStyle = 'rgba(139, 90, 43, 0.8)';
      ctx.fillRect(iconX - 4, iconY, 8, 10);
      
      // Distance text
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 12px Rubik, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      const distText = distToShelter >= 1000 
        ? `${(distToShelter / 1000).toFixed(1)}k` 
        : `${Math.round(distToShelter)}`;
      ctx.fillText(distText, iconX, iconY + 14);
      
      ctx.restore();
    }
  }

  // Draw virtual joystick on main canvas when active
  if (joystickActive) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const originX = (joystickOriginX - rect.left) * scaleX;
    const originY = (joystickOriginY - rect.top) * scaleY;
    const currentX = (joystickCurrentX - rect.left) * scaleX;
    const currentY = (joystickCurrentY - rect.top) * scaleY;
    
    // Clamp joystick knob to max radius
    const dx = currentX - originX;
    const dy = currentY - originY;
    const dist = Math.hypot(dx, dy);
    const clampedDist = Math.min(dist, JOYSTICK_MAX_RADIUS * scaleX);
    const knobX = dist > 0 ? originX + (dx / dist) * clampedDist : originX;
    const knobY = dist > 0 ? originY + (dy / dist) * clampedDist : originY;
    
    // Outer ring (base)
    ctx.save();
    ctx.globalAlpha = 0.3;
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(originX, originY, JOYSTICK_MAX_RADIUS * scaleX, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.1)';
    ctx.fill();
    
    // Inner knob
    ctx.globalAlpha = 0.6;
    ctx.fillStyle = '#7bed9f';
    ctx.beginPath();
    ctx.arc(knobX, knobY, 20 * scaleX, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();
  }

  // UI
  const me = latestSnapshot?.players.find((p) => p.id === myPlayerId) ?? predictedPlayer;
  const rawCapacity = me ? Math.floor(me.size) : 0;
  // Vans always capped at VAN_MAX_CAPACITY (shelter capacity shown on shelter building)
  const capacity = Math.min(rawCapacity, VAN_MAX_CAPACITY);
  const inside = me?.petsInside.length ?? 0;
  const strayCount = latestSnapshot?.pets.filter((p) => p.insideShelterId === null).length ?? 0;
  scoreEl.textContent = me?.eliminated ? 'Observer Mode' : `Size: ${rawCapacity}`;
  carriedEl.textContent = me?.eliminated ? 'WASD to pan | Drag to move' : `Pets: ${inside}/${capacity}`;
  
  // Show/hide build shelter button - requires size >= 50 and tokens >= 250
  const hasShelter = !!(me?.shelterId);
  const isEliminated = !!(me?.eliminated);
  const playerTokens = me?.money ?? 0;
  const canBuildShelter = me && me.size >= 50 && !hasShelter && !isEliminated && matchPhase === 'playing';
  
  // Update tokens display
  gameTokensEl.textContent = `${playerTokens} RT`;
  
  // Menu button - show when in match and not eliminated (always available, even after building shelter)
  const showMenuButton = me && !isEliminated && matchPhase === 'playing';
  if (showMenuButton) {
    buildShelterBtnEl.classList.remove('hidden');
    buildShelterBtnEl.disabled = false;
    buildShelterBtnEl.textContent = `Menu [E]`;
  } else {
    buildShelterBtnEl.classList.add('hidden');
  }
  
  // Update action menu if open
  if (actionMenuOpen) {
    if (!showMenuButton) {
      // Close menu if player is eliminated
      actionMenuOpen = false;
      actionMenuEl.classList.add('hidden');
    } else {
      updateActionMenu();
    }
  }
  
  // Hide old ground button (replaced by build shelter)
  groundBtnEl.classList.add('hidden');
  
  // Random port button - show when player has port charges
  const portCount = me?.portCharges ?? 0;
  if (me && portCount > 0 && !isEliminated && matchPhase === 'playing') {
    portBtnEl.textContent = `Random [P] (${portCount})`;
    portBtnEl.classList.remove('hidden');
  } else {
    portBtnEl.classList.add('hidden');
  }
  
  // Shelter port button - show when player has shelter port charges
  // If no shelter yet, show but indicate it needs a shelter
  const shelterPortCount = Math.max(me?.shelterPortCharges ?? 0, lastShelterPortCharges);
  if (me && shelterPortCount > 0 && !isEliminated) {
    if (hasShelter) {
      shelterPortBtnEl.textContent = `Home [H] (${shelterPortCount})`;
      (shelterPortBtnEl as HTMLButtonElement).disabled = false;
      shelterPortBtnEl.setAttribute('aria-disabled', 'false');
      shelterPortBtnEl.style.opacity = '1';
      shelterPortBtnEl.style.cursor = 'pointer';
    } else {
      // Show the button but indicate it's not usable without a shelter
      shelterPortBtnEl.textContent = `Home [H] (${shelterPortCount}) 🔒`;
      (shelterPortBtnEl as HTMLButtonElement).disabled = false;
      shelterPortBtnEl.setAttribute('aria-disabled', 'true');
      shelterPortBtnEl.style.opacity = '0.6';
      shelterPortBtnEl.style.cursor = 'not-allowed';
    }
    shelterPortBtnEl.classList.remove('hidden');
  } else {
    shelterPortBtnEl.classList.add('hidden');
  }
  
  // Transfer button - show when near allied shelter and carrying pets
  let nearbyAlliedShelter: ShelterState | null = null;
  if (me && me.petsInside.length > 0 && !isEliminated && matchPhase === 'playing') {
    // Check if near any allied shelter
    for (const shelter of latestSnapshot?.shelters ?? []) {
      if (shelter.ownerId === myPlayerId) continue; // Skip own shelter
      // Check if allied (by looking at allies list)
      const owner = latestSnapshot?.players.find(p => p.id === shelter.ownerId);
      const isAllied = me.allies?.includes(shelter.ownerId) || false;
      if (!isAllied) continue;
      
      // Check distance
      const dx = (predictedPlayer?.x ?? me.x) - shelter.x;
      const dy = (predictedPlayer?.y ?? me.y) - shelter.y;
      const dist = Math.hypot(dx, dy);
      const cappedSize = Math.min(shelter.size, 1000); // Match server visual cap
      const shelterRadius = SHELTER_BASE_RADIUS + cappedSize * SHELTER_RADIUS_PER_SIZE;
      const transferRange = shelterRadius + 100;
      
      if (dist <= transferRange) {
        nearbyAlliedShelter = shelter;
        break;
      }
    }
  }
  
  if (nearbyAlliedShelter) {
    transferBtnEl.textContent = `Transfer [T] 🤝`;
    transferBtnEl.classList.remove('hidden');
    (transferBtnEl as HTMLButtonElement).dataset.targetShelterId = nearbyAlliedShelter.id;
  } else {
    transferBtnEl.classList.add('hidden');
    delete (transferBtnEl as HTMLButtonElement).dataset.targetShelterId;
  }
  
  // Show "Center Van" and "Center Shelter" buttons when camera is panned away
  const isPanned = Math.abs(cameraPanOffsetX) > 50 || Math.abs(cameraPanOffsetY) > 50;
  const myShelter = me?.shelterId ? (latestSnapshot?.shelters?.find(s => s.id === me.shelterId) ?? null) : null;
  
  if (me && !isEliminated && matchPhase === 'playing' && isPanned) {
    centerVanBtnEl.classList.remove('hidden');
  } else {
    centerVanBtnEl.classList.add('hidden');
  }
  
  // Show shelter button if player has a shelter and is panned (or not near shelter)
  if (me && !isEliminated && matchPhase === 'playing' && myShelter) {
    const distToShelter = Math.hypot(
      (myShelter.x - (predictedPlayer?.x ?? 0)) - cameraPanOffsetX,
      (myShelter.y - (predictedPlayer?.y ?? 0)) - cameraPanOffsetY
    );
    // Show if camera isn't already centered on shelter
    if (distToShelter > 100) {
      centerShelterBtnEl.classList.remove('hidden');
    } else {
      centerShelterBtnEl.classList.add('hidden');
    }
  } else {
    centerShelterBtnEl.classList.add('hidden');
  }
  
  const nowTick = latestSnapshot?.tick ?? 0;
  const tickRate = TICK_RATE;
  const speedBoostRemain = me && (me.speedBoostUntil ?? 0) > nowTick ? ((me.speedBoostUntil! - nowTick) / tickRate).toFixed(1) : '';
  if (tagCooldownEl) tagCooldownEl.textContent = me ? `Adoptions: ${me.totalAdoptions}  •  Strays: ${strayCount}${speedBoostRemain ? `  •  Speed: ${speedBoostRemain}s` : ''}` : '';
  const matchEndAt = latestSnapshot?.matchEndAt ?? 0;
  const remainingTicks = Math.max(0, matchEndAt - nowTick);
  const remainingSec = remainingTicks / tickRate;
  // Show domination progress - calculate shelter area as % of map area
  const shelters = latestSnapshot?.shelters ?? [];
  const mapArea = MAP_WIDTH * MAP_HEIGHT; // 4800 * 4800 = 23,040,000
  const leaderShelter = shelters.reduce<ShelterState | null>((best, s) => !best || s.size > best.size ? s : best, null);
  // Calculate shelter area: π * r² where r = SHELTER_BASE_RADIUS + size * SHELTER_RADIUS_PER_SIZE
  // Cap size calculation to prevent overflow at very high sizes
  const cappedSize = Math.min(leaderShelter?.size ?? 0, 10000);
  const leaderRadius = leaderShelter ? SHELTER_BASE_RADIUS + cappedSize * SHELTER_RADIUS_PER_SIZE : 0;
  const leaderArea = Math.PI * leaderRadius * leaderRadius;
  const leaderPercent = mapArea > 0 ? Math.min(100, Math.floor((leaderArea / mapArea) * 100)) : 0;
  const leaderPlayer = latestSnapshot?.players.find(p => p.shelterId === leaderShelter?.id);
  const points = me?.totalAdoptions ?? 0;
  timerEl.textContent = matchPhase === 'playing' ? `Points: ${points}` : '';
  
  // Update game clock (stop updating when match is over)
  const matchIsOver = latestSnapshot != null && latestSnapshot.matchEndAt > 0 && latestSnapshot.tick >= latestSnapshot.matchEndAt;
  if (!matchIsOver) {
    const durationMs = latestSnapshot?.matchDurationMs ?? 0;
    const totalSec = Math.floor(durationMs / 1000);
    const hours = Math.floor(totalSec / 3600);
    const mins = Math.floor((totalSec % 3600) / 60);
    const secs = totalSec % 60;
    gameClockEl.textContent = `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  
  // Adoption events panel
  const events = latestSnapshot?.adoptionEvents ?? [];
  const snap = latestSnapshot;
  if (eventPanelEl && eventPanelListEl) {
    if (events.length > 0 && matchPhase === 'playing' && snap) {
      eventPanelListEl.innerHTML = events.map(ev => {
        const typeName = ev.type.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
        const remainingTicks = Math.max(0, ev.startTick + ev.durationTicks - snap.tick);
        const remainingSec = Math.ceil(remainingTicks / 25);
        const totalNeeded = ev.totalNeeded ?? 100;
        const totalRescued = ev.totalRescued ?? 0;
        const progress = `${totalRescued}/${totalNeeded}`;
        return `<div class="event-item"><div class="event-name">${escapeHtml(typeName)}</div><div class="event-reqs">Need: ${progress} pets rescued</div><div class="event-time">${remainingSec}s left</div></div>`;
      }).join('');
      eventPanelEl.classList.remove('hidden');
    } else {
      eventPanelEl.classList.add('hidden');
    }
  }
  
  const iAmEliminated = !!(me?.eliminated);
  if ((remainingSec <= 0 || iAmEliminated) && latestSnapshot?.players.length) {
    // Close any active breeder minigame when match ends
    if (breederGame.active) {
      endBreederMiniGame(false);
    }
    if (!matchEndPlayed) {
      matchEndPlayed = true;
      playMatchEnd();
    }
    leaderboardEl.classList.add('show');
    const matchEndedByTime = remainingSec <= 0 && !latestSnapshot?.matchEndedEarly;
    const sorted = [...latestSnapshot.players].sort((a, b) => {
      if (matchEndedByTime) {
        return b.size - a.size || b.totalAdoptions - a.totalAdoptions;
      }
      if (a.eliminated !== b.eliminated) return (a.eliminated ? 1 : 0) - (b.eliminated ? 1 : 0);
      if (!a.eliminated) return b.size - a.size || b.totalAdoptions - a.totalAdoptions;
      return a.totalAdoptions - b.totalAdoptions;
    });
    const strayLoss = !!(latestSnapshot?.strayLoss);
    const meResult = sorted.find((p) => p.id === myPlayerId);
    const mySize = meResult && !meResult.eliminated ? Math.floor(meResult.size) : 0;
    const placementBonus = [100, 50, 25];
    const myRank = meResult ? sorted.findIndex((p) => p.id === myPlayerId) + 1 : 0;
    const bonus = myRank > 0 && myRank <= placementBonus.length && !iAmEliminated && !strayLoss ? placementBonus[myRank - 1] : 0;
    const earned = strayLoss || iAmEliminated ? 0 : mySize + bonus;
    // Only calculate newTokens once when match ends (matchEndPlayed was just set to true above)
    const newTokens = matchEndPlayed && !matchEndTokensAwarded ? getTokens() + earned : getTokens();
    if (!matchEndTokensAwarded) {
      setTokens(newTokens);
      matchEndTokensAwarded = true;
      // Server is authoritative for deposits - no client-side deposit call
    }
    const bonusLabel = myRank === 1 ? 'Win bonus' : myRank === 2 ? '2nd place' : myRank === 3 ? '3rd place' : myRank > 0 ? `${myRank}th place` : '';
    const tokenLines = earned > 0
      ? `<br><br><strong>Total: ${newTokens.toLocaleString()} RT</strong>${bonusLabel ? `<br>${bonusLabel}: +${bonus} RT` : ''}`
      : strayLoss
        ? `<br><br>No RT — too many strays! <strong>Total: ${getTokens().toLocaleString()} RT</strong>`
        : iAmEliminated
          ? `<br><br><strong>Total: ${getTokens().toLocaleString()} RT</strong>`
          : '';
    // Determine win title
    let title = 'Match over';
    if (latestSnapshot?.strayLoss) {
      title = 'Match lost — too many strays!';
    } else if (iAmEliminated) {
      title = 'You were consumed';
    } else if (latestSnapshot && latestSnapshot.winnerId) {
      const winnerId = latestSnapshot.winnerId;
      const winnerPlayer = latestSnapshot.players.find(p => p.id === winnerId);
      const winnerName = winnerPlayer?.id === myPlayerId ? 'You' : (winnerPlayer?.displayName ?? 'Someone');
      title = `${winnerName} won!`;
    }
    const adHtml = `
      <div class="match-ads">
        <div class="match-ad-slot">
          <h4>Sponsored</h4>
          <div id="match-ad-slot" class="match-ad-placeholder">Ad placeholder</div>
        </div>
        <div class="match-self-promo">
          <h4>Boost your shelter</h4>
          <p>Earn Rescue Tokens each match to buy boosts. Invite friends with your referral link. For every 5 confirmed signups, unlock a special shelter skin.</p>
        </div>
      </div>
    `;
    const sizeLabel = (p: PlayerState) => (p.eliminated ? '—' : `${Math.floor(p.size)}`);
    leaderboardEl.innerHTML = `<strong>${title}</strong><br><br>` + sorted.map((p, i) => `${i + 1}. ${p.id === myPlayerId ? 'You' : (p.displayName ?? p.id)}: size ${sizeLabel(p)} (${p.totalAdoptions} adoptions)`).join('<br>') + tokenLines + adHtml + '<button type="button" id="play-again-btn" class="fight-ally-btn ally-btn" style="margin-right:8px">Play again</button><button type="button" id="lobby-btn" class="fight-ally-btn fight-btn">Back to lobby</button>';
  } else {
    leaderboardEl.classList.remove('show');
  }
  } catch (err) {
    console.error('Render error:', err);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#3d6b3d';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.restore();
  }
}

// --- End match menu (delegated: Play again, Back to lobby) ---
let leaderboardActionInProgress = false;
function handleLeaderboardButton(btn: HTMLButtonElement): void {
  // Prevent double actions from multiple event handlers
  if (leaderboardActionInProgress) return;
  leaderboardActionInProgress = true;
  setTimeout(() => { leaderboardActionInProgress = false; }, 500);
  
  if (btn.id === 'play-again-btn') {
    if (gameWs) {
      gameWs.close();
      gameWs = null;
    }
    leaderboardEl.classList.remove('show');
    matchEndPlayed = false;
    wasPlayerObserver = false; // Reset observer state for new match
    latestSnapshot = null;
    connectionOverlayEl.classList.remove('hidden');
    connectionOverlayEl.innerHTML = selectedMode === 'ffa'
      ? '<h2>Connecting…</h2><p>Joining FFA lobby…</p>'
      : '<h2>Connecting…</h2><p>Starting new match.</p>';
    authAreaEl.classList.add('hidden');
    connect({ mode: selectedMode })
      .then(() => {
        connectionOverlayEl.classList.add('hidden');
        connectionOverlayEl.innerHTML = '';
        gameWrapEl.classList.add('visible');
        requestAnimationFrame(tick);
      })
      .catch((err: Error) => showConnectionError(err.message || 'Connection failed.'));
  } else if (btn.id === 'lobby-btn') {
    if (gameWs) {
      gameWs.close();
      gameWs = null;
    }
    leaderboardEl.classList.remove('show');
    matchEndPlayed = false;
    matchEndTokensAwarded = false;
    latestSnapshot = null;
    currentMatchId = null;
    gameWrapEl.classList.remove('visible');
    landingEl.classList.remove('hidden');
    authAreaEl.classList.remove('hidden');
    updateLandingTokens();
    restoreModeSelection();
    // Clear saved match state since match ended
    hasSavedMatch = false;
    // Clear active FFA/Teams match since match ended properly
    setActiveMultiplayerMatch(null);
    updateResumeMatchUI();
    fetchSavedMatchStatus(); // Sync with server
    startServerClockWhenOnLobby();
    connectLobbyLeaderboard();
  }
}

// Desktop click handler for leaderboard buttons (capture phase to ensure we get the event)
leaderboardEl.addEventListener('click', (e) => {
  const target = e.target as HTMLElement;
  const btn = target.closest('button') as HTMLButtonElement | null;
  if (!btn) return;
  e.preventDefault();
  e.stopPropagation();
  handleLeaderboardButton(btn);
}, true); // Use capture phase

// Desktop mouseup handler as fallback (more reliable than click on some systems)
leaderboardEl.addEventListener('mouseup', (e) => {
  const target = e.target as HTMLElement;
  const btn = target.closest('button') as HTMLButtonElement | null;
  if (!btn) return;
  // Only trigger on primary button (left click)
  if (e.button !== 0) return;
  e.preventDefault();
  e.stopPropagation();
  handleLeaderboardButton(btn);
}, true);

// Mobile touch handler
leaderboardEl.addEventListener('touchend', (e) => {
  const target = e.target as HTMLElement;
  const btn = target.closest('button') as HTMLButtonElement | null;
  if (!btn) return;
  e.preventDefault();
  e.stopPropagation();
  handleLeaderboardButton(btn);
}, { passive: false, capture: true });

// --- Lobby: Ready button ---
lobbyReadyBtnEl.addEventListener('click', () => {
  if (iAmReady || matchPhase !== 'countdown' || !gameWs || gameWs.readyState !== WebSocket.OPEN) return;
  iAmReady = true;
  gameWs.send(JSON.stringify({ type: 'ready' }));
  lobbyReadyBtnEl.textContent = 'Ready!';
  lobbyMessageEl.textContent = "You're ready! Waiting for other player(s)…";
});

// --- Lobby: Back to lobby (same as end-match lobby button) ---
lobbyBackBtnEl.addEventListener('click', () => {
  if (gameWs) {
    gameWs.close();
    gameWs = null;
  }
  lobbyOverlayEl.classList.add('hidden');
  gameWrapEl.classList.remove('visible');
  landingEl.classList.remove('hidden');
  authAreaEl.classList.remove('hidden'); // Show auth when returning to lobby
  updateLandingTokens();
  restoreModeSelection(); // Restore sticky mode
  startServerClockWhenOnLobby();
  connectLobbyLeaderboard();
});

// --- Fight / Ally ---
function sendFightAllyChoice(choice: 'fight' | 'ally'): void {
  if (!fightAllyTargetId || !gameWs || gameWs.readyState !== WebSocket.OPEN) return;
  gameWs.send(JSON.stringify({ type: 'fightAlly', targetId: fightAllyTargetId, choice }));
  fightAllyChosenTargets.add(fightAllyTargetId);
  fightAllyOverlayEl.classList.add('hidden');
  fightAllyTargetId = null;
}
fightAllyFightBtn.addEventListener('click', () => sendFightAllyChoice('fight'));
fightAllyAllyBtn.addEventListener('click', () => sendFightAllyChoice('ally'));

// --- Ground button ---
groundBtnEl.addEventListener('click', () => {
  if (!gameWs || gameWs.readyState !== WebSocket.OPEN) return;
  gameWs.send(JSON.stringify({ type: 'ground' }));
  groundBtnEl.classList.add('hidden');
});

// --- Random Port button ---
portBtnEl.addEventListener('click', () => {
  if (breederGame.active) return; // Don't allow porting during mini-game
  if (!gameWs || gameWs.readyState !== WebSocket.OPEN) return;
  gameWs.send(JSON.stringify({ type: 'usePort' }));
});

// --- Shelter Port button ---
shelterPortBtnEl.addEventListener('click', () => {
  if (breederGame.active) return; // Don't allow porting during mini-game
  if (!gameWs || gameWs.readyState !== WebSocket.OPEN) return;
  const me = latestSnapshot?.players.find((pl) => pl.id === myPlayerId);
  if (!me) return;
  if ((me.shelterPortCharges ?? 0) <= 0) return;
  if (!me.shelterId) {
    showToast('Build a shelter first!', 'info');
    return;
  }
  if (me.eliminated || matchPhase !== 'playing') return;
  gameWs.send(JSON.stringify({ type: 'useShelterPort' }));
});

// --- Transfer Pets button ---
transferBtnEl.addEventListener('click', () => {
  if (breederGame.active) return; // Don't allow during mini-game
  if (!gameWs || gameWs.readyState !== WebSocket.OPEN) return;
  const targetShelterId = (transferBtnEl as HTMLButtonElement).dataset.targetShelterId;
  if (!targetShelterId) return;
  gameWs.send(JSON.stringify({ type: 'transferPets', targetShelterId }));
});

// --- Center Van button - resets camera pan to follow the van ---
centerVanBtnEl.addEventListener('click', () => {
  cameraPanOffsetX = 0;
  cameraPanOffsetY = 0;
  centerVanBtnEl.classList.add('hidden');
});

// --- Center Shelter button - pans camera to player's shelter ---
centerShelterBtnEl.addEventListener('click', () => {
  const me = latestSnapshot?.players.find((p) => p.id === myPlayerId);
  const shelter = me?.shelterId ? latestSnapshot?.shelters?.find(s => s.id === me.shelterId) : null;
  if (shelter && predictedPlayer) {
    // Calculate offset to center camera on shelter
    cameraPanOffsetX = shelter.x - predictedPlayer.x;
    cameraPanOffsetY = shelter.y - predictedPlayer.y;
  }
  centerShelterBtnEl.classList.add('hidden');
});

// --- Build shelter button - opens action menu ---
buildShelterBtnEl.addEventListener('click', () => {
  toggleActionMenu();
});

// --- E key for action menu toggle ---
let actionMenuOpen = false;
function toggleActionMenu(): void {
  if (matchPhase !== 'playing') return;
  const me = latestSnapshot?.players.find((p) => p.id === myPlayerId);
  if (!me || me.eliminated) return;
  actionMenuOpen = !actionMenuOpen;
  if (actionMenuOpen) {
    actionMenuEl.classList.remove('hidden');
    updateActionMenu();
  } else {
    actionMenuEl.classList.add('hidden');
  }
}

function getPlayerShelter(): { hasAdoptionCenter: boolean; hasGravity: boolean; hasAdvertising: boolean } | null {
  if (!latestSnapshot) return null;
  const me = latestSnapshot.players.find((p) => p.id === myPlayerId);
  if (!me?.shelterId) return null;
  const shelter = latestSnapshot.shelters?.find((s) => s.id === me.shelterId);
  return shelter ?? null;
}

function updateActionMenu(): void {
  const me = latestSnapshot?.players.find((p) => p.id === myPlayerId);
  if (!me) return;
  const size = Math.floor(me.size);
  const tokens = me.money ?? 0;
  const hasShelter = !!me.shelterId;
  const shelter = getPlayerShelter();
  const hasVanSpeed = !!me.vanSpeedUpgrade;
  
  // Show/hide sections based on shelter ownership
  if (hasShelter) {
    actionBuildShelterItemEl.classList.add('hidden');
    actionAdoptionCenterItemEl.classList.remove('hidden');
    actionGravityItemEl.classList.remove('hidden');
    actionAdvertisingItemEl.classList.remove('hidden');
  } else {
    actionBuildShelterItemEl.classList.remove('hidden');
    actionAdoptionCenterItemEl.classList.add('hidden');
    actionGravityItemEl.classList.add('hidden');
    actionAdvertisingItemEl.classList.add('hidden');
  }
  
  // Update build shelter progress
  const sizeProgress = Math.min(100, (size / 50) * 100);
  const tokensProgress = Math.min(100, (tokens / 250) * 100);
  actionSizeTextEl.textContent = `${size}/50`;
  actionSizeBarEl.style.width = `${sizeProgress}%`;
  actionTokensTextEl.textContent = `${tokens}/250 RT`;
  actionTokensBarEl.style.width = `${tokensProgress}%`;
  const canBuild = size >= 50 && tokens >= 250 && !hasShelter;
  actionBuildBtnEl.disabled = !canBuild;
  if (canBuild) {
    actionBuildBtnEl.textContent = 'Build Shelter';
    actionBuildBtnEl.classList.add('ready');
  } else if (hasShelter) {
    actionBuildBtnEl.textContent = 'Already Built';
    actionBuildBtnEl.classList.remove('ready');
  } else {
    const needs: string[] = [];
    if (size < 50) needs.push(`Size ${size}/50`);
    if (tokens < 250) needs.push(`${tokens}/250 RT`);
    actionBuildBtnEl.textContent = `Need: ${needs.join(' & ')}`;
    actionBuildBtnEl.classList.remove('ready');
  }
  
  // Update upgrade buttons
  const canBuyAdoption = hasShelter && !shelter?.hasAdoptionCenter && tokens >= 250;
  const canBuyGravity = hasShelter && !shelter?.hasGravity && tokens >= 300;
  const canBuyAdvertising = hasShelter && !shelter?.hasAdvertising && tokens >= 200;
  const canBuyVanSpeed = !hasVanSpeed && tokens >= 150;
  
  actionAdoptionBtnEl.disabled = !canBuyAdoption;
  actionAdoptionBtnEl.textContent = shelter?.hasAdoptionCenter ? 'Owned' : 'Buy';
  if (canBuyAdoption) actionAdoptionBtnEl.classList.add('ready');
  else actionAdoptionBtnEl.classList.remove('ready');
  if (shelter?.hasAdoptionCenter) actionAdoptionCenterItemEl.classList.add('owned');
  else actionAdoptionCenterItemEl.classList.remove('owned');
  
  actionGravityBtnEl.disabled = !canBuyGravity;
  actionGravityBtnEl.textContent = shelter?.hasGravity ? 'Owned' : 'Buy';
  if (canBuyGravity) actionGravityBtnEl.classList.add('ready');
  else actionGravityBtnEl.classList.remove('ready');
  if (shelter?.hasGravity) actionGravityItemEl.classList.add('owned');
  else actionGravityItemEl.classList.remove('owned');
  
  actionAdvertisingBtnEl.disabled = !canBuyAdvertising;
  actionAdvertisingBtnEl.textContent = shelter?.hasAdvertising ? 'Owned' : 'Buy';
  if (canBuyAdvertising) actionAdvertisingBtnEl.classList.add('ready');
  else actionAdvertisingBtnEl.classList.remove('ready');
  if (shelter?.hasAdvertising) actionAdvertisingItemEl.classList.add('owned');
  else actionAdvertisingItemEl.classList.remove('owned');
  
  actionVanSpeedBtnEl.disabled = !canBuyVanSpeed;
  actionVanSpeedBtnEl.textContent = hasVanSpeed ? 'Owned' : 'Buy';
  if (canBuyVanSpeed) actionVanSpeedBtnEl.classList.add('ready');
  else actionVanSpeedBtnEl.classList.remove('ready');
  if (hasVanSpeed) actionVanSpeedItemEl.classList.add('owned');
  else actionVanSpeedItemEl.classList.remove('owned');
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'e' || e.key === 'E') {
    toggleActionMenu();
  }
  if (e.key === 'p' || e.key === 'P') {
    // Use random port charge (not during breeder mini-game)
    if (breederGame.active) return;
    if (gameWs && gameWs.readyState === WebSocket.OPEN) {
      const me = latestSnapshot?.players.find((pl) => pl.id === myPlayerId);
      if (me && (me.portCharges ?? 0) > 0 && !me.eliminated && matchPhase === 'playing') {
        gameWs.send(JSON.stringify({ type: 'usePort' }));
      }
    }
  }
  if (e.key === 'h' || e.key === 'H') {
    // Use shelter port charge (not during breeder mini-game)
    if (breederGame.active) return;
    if (gameWs && gameWs.readyState === WebSocket.OPEN) {
      const me = latestSnapshot?.players.find((pl) => pl.id === myPlayerId);
      if (!me) return;
      if ((me.shelterPortCharges ?? 0) <= 0) return;
      if (!me.shelterId) {
        showToast('Build a shelter first!', 'info');
        return;
      }
      if (me.eliminated || matchPhase !== 'playing') return;
      gameWs.send(JSON.stringify({ type: 'useShelterPort' }));
    }
  }
});
actionMenuCloseEl.addEventListener('click', () => {
  actionMenuOpen = false;
  actionMenuEl.classList.add('hidden');
});
actionBuildBtnEl.addEventListener('click', () => {
  if (!gameWs || gameWs.readyState !== WebSocket.OPEN) return;
  const me = latestSnapshot?.players.find((p) => p.id === myPlayerId);
  if (!me || me.eliminated || me.shelterId) return;
  if (me.size < 50 || (me.money ?? 0) < 250) return;
  gameWs.send(JSON.stringify({ type: 'buildShelter' }));
  updateActionMenu();
});
actionAdoptionBtnEl.addEventListener('click', () => {
  if (!gameWs || gameWs.readyState !== WebSocket.OPEN) return;
  gameWs.send(JSON.stringify({ type: 'buyAdoptionCenter' }));
  updateActionMenu();
});
actionGravityBtnEl.addEventListener('click', () => {
  if (!gameWs || gameWs.readyState !== WebSocket.OPEN) return;
  gameWs.send(JSON.stringify({ type: 'buyGravity' }));
  updateActionMenu();
});
actionAdvertisingBtnEl.addEventListener('click', () => {
  if (!gameWs || gameWs.readyState !== WebSocket.OPEN) return;
  gameWs.send(JSON.stringify({ type: 'buyAdvertising' }));
  updateActionMenu();
});
actionVanSpeedBtnEl.addEventListener('click', () => {
  if (!gameWs || gameWs.readyState !== WebSocket.OPEN) return;
  gameWs.send(JSON.stringify({ type: 'buyVanSpeed' }));
  updateActionMenu();
});

// --- Settings ---
musicToggleEl.checked = getMusicEnabled();
sfxToggleEl.checked = getSfxEnabled();
musicToggleEl.addEventListener('change', () => {
  setMusicEnabled(musicToggleEl.checked);
  if (musicToggleEl.checked) playMusic();
});
sfxToggleEl.addEventListener('change', () => setSfxEnabled(sfxToggleEl.checked));
settingsBtnEl.addEventListener('click', () => settingsPanelEl.classList.toggle('hidden'));
settingsCloseEl.addEventListener('click', () => settingsPanelEl.classList.add('hidden'));

// FPS setting: persist and apply
if (fpsSelectEl) {
  fpsSelectEl.value = String(targetFps);
  fpsSelectEl.addEventListener('change', () => {
    const v = fpsSelectEl.value === '60' ? 60 : 30;
    targetFps = v;
    targetFrameMs = 1000 / targetFps;
    localStorage.setItem(FPS_KEY, String(v));
  });
}
exitToLobbyBtnEl.addEventListener('click', async () => {
  const wasConnected = gameWs?.readyState === WebSocket.OPEN;
  
  // Show appropriate toast if connection is still open
  if (wasConnected) {
    if (selectedMode === 'solo') {
      showToast('Your match has been saved.', 'success');
    } else if (selectedMode === 'ffa' || selectedMode === 'teams') {
      // Check if player has a shelter yet
      const me = latestSnapshot?.players.find(p => p.id === myPlayerId);
      const myShelter = me?.shelterId ? latestSnapshot?.shelters?.find(s => s.id === me.shelterId) : null;
      if (myShelter) {
        showToast('Your van will stop but your shelter continues. Return to rejoin!', 'info');
      } else {
        showToast('Your van will stop. Return to rejoin the match!', 'info');
      }
    }
  }
  
  // Always close and return to lobby (even if WebSocket is already closed)
  settingsPanelEl.classList.add('hidden');
  if (gameWs) {
    gameWs.close();
    gameWs = null;
  }
  myPlayerId = null;
  latestSnapshot = null;
  leaderboardEl.classList.remove('show');
  matchEndPlayed = false;
  matchEndTokensAwarded = false;
  // Clear any pending announcements/banners immediately
  clearAnnouncements();
  gameWrapEl.classList.remove('visible');
  landingEl.classList.remove('hidden');
  authAreaEl.classList.remove('hidden');
  updateLandingTokens();
  restoreModeSelection();
  // For solo mode with active connection, show Resume button (we know we just saved)
  if (selectedMode === 'solo' && wasConnected) {
    hasSavedMatch = true;
    updateResumeMatchUI();
  } else if ((selectedMode === 'ffa' || selectedMode === 'teams') && currentMatchId && isSignedIn) {
    // For FFA/Teams, store the match info for rejoin (only if signed in)
    setActiveMultiplayerMatch({ matchId: currentMatchId, mode: selectedMode });
    updateResumeMatchUI();
  } else {
    // Match already ended or unknown state - fetch from server
    fetchSavedMatchStatus();
  }
  currentMatchId = null;
  startServerClockWhenOnLobby();
  connectLobbyLeaderboard();
  startGameStatsPolling();
});
switchServerBtnEl.addEventListener('click', () => {
  if (gameWs) {
    gameWs.close();
    gameWs = null;
  }
  connectionOverlayEl.classList.remove('hidden');
  connectionOverlayEl.innerHTML = '<h2>Switching server…</h2><p>Reconnecting to a closer server.</p>';
  authAreaEl.classList.add('hidden');
  connect({ latency: currentRttMs, mode: selectedMode })
    .then(() => {
      connectionOverlayEl.classList.add('hidden');
      connectionOverlayEl.innerHTML = '';
    })
    .catch((err: Error) => {
      showConnectionError(err.message || 'Switch failed.');
      authAreaEl.classList.remove('hidden');
    });
});

// --- Landing: mode selector ---
function restoreModeSelection(): void {
  document.querySelectorAll('.mode-option').forEach((b) => {
    const mode = (b as HTMLElement).dataset.mode;
    if (mode === selectedMode) {
      b.classList.add('selected');
    } else {
      b.classList.remove('selected');
    }
  });
}
const savedMode = localStorage.getItem(MODE_KEY);
if (savedMode === 'ffa' || savedMode === 'teams' || savedMode === 'solo') {
  selectedMode = savedMode;
}
restoreModeSelection();
const soloOptionsEl = document.getElementById('solo-options');
const cpuShutdownBreedersEl = document.getElementById('cpu-shutdown-breeders') as HTMLInputElement | null;

function updateSoloOptionsVisibility(): void {
  if (soloOptionsEl) {
    if (selectedMode === 'solo') {
      soloOptionsEl.classList.remove('hidden');
    } else {
      soloOptionsEl.classList.add('hidden');
    }
  }
}

document.querySelectorAll('.mode-option').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.mode-option').forEach((b) => b.classList.remove('selected'));
    btn.classList.add('selected');
    selectedMode = (btn as HTMLElement).dataset.mode as 'ffa' | 'teams' | 'solo';
    localStorage.setItem(MODE_KEY, selectedMode);
    updateSoloOptionsVisibility();
    updateResumeMatchUI();
  });
});

updateSoloOptionsVisibility();

// --- Landing: Referral actions ---
referralCopyBtn.addEventListener('click', async () => {
  if (!referralInfo || !referralInfo.referralCode) return;
  const link = buildReferralLink(referralInfo.referralCode);
  try {
    await navigator.clipboard.writeText(link);
    referralStatusEl.textContent = 'Referral link copied.';
  } catch {
    const input = document.createElement('input');
    input.value = link;
    document.body.appendChild(input);
    input.select();
    document.execCommand('copy');
    document.body.removeChild(input);
    referralStatusEl.textContent = 'Referral link copied.';
  }
});

referralClaimBtn.addEventListener('click', async () => {
  try {
    const res = await fetch('/referrals/claim', { method: 'POST', credentials: 'include' });
    const data = await res.json();
    if (data.ok) {
      const bonus = typeof data.moneyBonus === 'number' ? data.moneyBonus : 0;
      if (bonus > 0) setTokens(getTokens() + bonus);
      localStorage.setItem(SKIN_KEY, '1');
      referralStatusEl.textContent = 'Reward claimed. Special skin unlocked.';
      await fetchReferralInfo();
      updateReferralUI();
      updateLandingTokens();
    } else {
      referralStatusEl.textContent = 'Reward not available yet.';
    }
  } catch {
    referralStatusEl.textContent = 'Unable to claim reward. Try again.';
  }
});

function startConnect(options: { mode: 'ffa' | 'teams' | 'solo'; abandon?: boolean; resume?: boolean }): void {
  playMusic();
  stopServerClock();
  landingEl.classList.add('hidden');
  connectionOverlayEl.classList.remove('hidden');
  connectionOverlayEl.innerHTML = options.resume
    ? '<h2>Resuming…</h2><p>Loading your saved match.</p>'
    : '<h2>Connecting…</h2><p>Waiting for game server.</p>';
  authAreaEl.classList.add('hidden');
  connect({ mode: options.mode, abandon: options.abandon })
    .then(() => {
      connectionOverlayEl.classList.add('hidden');
      gameWrapEl.classList.add('visible');
      if (musicToggleEl) musicToggleEl.checked = getMusicEnabled();
      requestAnimationFrame(tick);
    })
    .catch((err: Error) => {
      showConnectionError(err.message || 'Connection failed.');
      authAreaEl.classList.remove('hidden');
    });
}

const resumeMatchBtnEl = document.getElementById('resume-match-btn');
if (resumeMatchBtnEl) {
  resumeMatchBtnEl.addEventListener('click', () => {
    if (selectedMode === 'solo' && hasSavedMatch) {
      startConnect({ mode: 'solo', resume: true });
      return;
    }
    // FFA/Teams rejoin - just start connect with the mode, server will handle rejoin
    if (activeMultiplayerMatch && selectedMode === activeMultiplayerMatch.mode) {
      startConnect({ mode: selectedMode });
      return;
    }
  });
}

// --- Landing: Play ---
landingPlayBtn.addEventListener('click', () => {
  if (selectedMode === 'solo' && hasSavedMatch) {
    showAbandonConfirmPopup(() => {
      fetch('/api/saved-match', { method: 'DELETE', credentials: 'include' })
        .then(() => {
          hasSavedMatch = false;
          updateResumeMatchUI();
          startConnect({ mode: 'solo', abandon: true });
        })
        .catch(() => showToast('Failed to abandon saved match.', 'error'));
    });
    return;
  }
  // FFA/Teams: if there's an active match, confirm abandon before starting new
  if (activeMultiplayerMatch && selectedMode === activeMultiplayerMatch.mode) {
    showAbandonConfirmPopup(() => {
      // Clear the stored match and start new
      setActiveMultiplayerMatch(null);
      updateResumeMatchUI();
      startConnect({ mode: selectedMode });
    });
    return;
  }
  startConnect({ mode: selectedMode });
});

// --- Cookie consent banner ---
if (!localStorage.getItem(COOKIE_CONSENT_KEY)) {
  cookieBannerEl.classList.remove('hidden');
}
cookieAcceptBtn.addEventListener('click', () => {
  localStorage.setItem(COOKIE_CONSENT_KEY, 'full');
  cookieBannerEl.classList.add('hidden');
});
cookieEssentialBtn.addEventListener('click', () => {
  localStorage.setItem(COOKIE_CONSENT_KEY, 'essential');
  cookieBannerEl.classList.add('hidden');
});

// --- Landing: tokens and shop ---
updateLandingTokens();
document.querySelectorAll('.landing-buy').forEach((btn) => {
  btn.addEventListener('click', () => {
    const boost = (btn as HTMLElement).dataset.boost as keyof typeof BOOST_PRICES;
    if (!boost || !(boost in BOOST_PRICES)) return;
    const price = BOOST_PRICES[boost as keyof typeof BOOST_PRICES];
    const m = getTokens();
    if (m < price) return;
    setTokens(m - price);
    if (boost === 'size') pendingBoosts.sizeBonus += 1;
    else if (boost === 'speed') pendingBoosts.speedBoost = true;
    else if (boost === 'adoptSpeed') pendingBoosts.adoptSpeed = true;
    updateLandingTokens();
  });
});

// --- Color selection ---
updateColorUI();
// Free color buttons
document.querySelectorAll('.color-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    const color = (btn as HTMLElement).dataset.color;
    if (color) {
      setSelectedColor(color);
      updateColorUI();
    }
  });
});
// Preset color buttons
document.querySelectorAll('.preset-color').forEach((btn) => {
  btn.addEventListener('click', () => {
    const color = (btn as HTMLElement).dataset.color;
    if (color && getUnlockedColors().preset) {
      setSelectedColor(color);
      updateColorUI();
    }
  });
});
// Color purchase buttons
const colorPickerModal = document.getElementById('color-picker-modal');
const colorPickerInput = document.getElementById('color-picker-input') as HTMLInputElement;
const colorPickerInput2 = document.getElementById('color-picker-input2') as HTMLInputElement;
const colorPickerTitle = document.getElementById('color-picker-title');
const colorPickerCancel = document.getElementById('color-picker-cancel');
const colorPickerConfirm = document.getElementById('color-picker-confirm');
let colorPickerMode: 'custom' | 'gradient' = 'custom';

document.querySelectorAll('.color-buy').forEach((btn) => {
  btn.addEventListener('click', () => {
    const colorType = (btn as HTMLElement).dataset.color as keyof typeof COLOR_PRICES;
    const price = COLOR_PRICES[colorType];
    const unlocked = getUnlockedColors();
    const m = getTokens();
    
    if (colorType === 'preset') {
      if (unlocked.preset) return; // Already unlocked
      if (m < price) return;
      setTokens(m - price);
      setUnlockedColors({ ...unlocked, preset: true });
      updateLandingTokens();
      updateColorUI();
    } else if (colorType === 'custom') {
      if (unlocked.custom) {
        // Already unlocked - use it
        setSelectedColor(unlocked.custom);
        updateColorUI();
        return;
      }
      if (m < price) return;
      // Show color picker
      colorPickerMode = 'custom';
      if (colorPickerTitle) colorPickerTitle.textContent = 'Pick Your Custom Color';
      if (colorPickerInput2) colorPickerInput2.style.display = 'none';
      colorPickerModal?.classList.remove('hidden');
    } else if (colorType === 'gradient') {
      if (unlocked.gradient) {
        // Already unlocked - use it
        setSelectedColor(unlocked.gradient);
        updateColorUI();
        return;
      }
      if (m < price) return;
      // Show gradient picker
      colorPickerMode = 'gradient';
      if (colorPickerTitle) colorPickerTitle.textContent = 'Pick Gradient Colors';
      if (colorPickerInput2) colorPickerInput2.style.display = 'block';
      colorPickerModal?.classList.remove('hidden');
    }
  });
});

colorPickerCancel?.addEventListener('click', () => {
  colorPickerModal?.classList.add('hidden');
});

colorPickerConfirm?.addEventListener('click', () => {
  const unlocked = getUnlockedColors();
  const m = getTokens();
  
  if (colorPickerMode === 'custom') {
    const color = colorPickerInput?.value || '#ff5500';
    setTokens(m - COLOR_PRICES.custom);
    setUnlockedColors({ ...unlocked, custom: color });
    setSelectedColor(color);
  } else {
    const color1 = colorPickerInput?.value || '#ff5500';
    const color2 = colorPickerInput2?.value || '#00aaff';
    const gradientColor = `gradient:${color1}:${color2}`;
    setTokens(m - COLOR_PRICES.gradient);
    setUnlockedColors({ ...unlocked, gradient: gradientColor });
    setSelectedColor(gradientColor);
  }
  
  colorPickerModal?.classList.add('hidden');
  updateLandingTokens();
  updateColorUI();
});

// --- Landing: music toggle + play on load ---
if (landingMusicToggleEl) {
  landingMusicToggleEl.checked = getMusicEnabled();
  landingMusicToggleEl.addEventListener('change', () => {
    setMusicEnabled(landingMusicToggleEl!.checked);
    if (landingMusicToggleEl!.checked) playMusic();
  });
}
// Start music when the first page loads (may be blocked by browser until user interaction)
if (getMusicEnabled()) playMusic();

// --- Breeder Mini-Game Functions ---
/** Time limit in seconds for breeder camp mini-game by level: 1-5 → 15s, 6-9 → 30s, 10-14 → 40s, 15+ → 45s */
function getBreederTimeLimitSeconds(level: number): number {
  if (level <= 5) return 15;
  if (level <= 9) return 30;
  if (level <= 14) return 40;
  return 45;
}

interface BreederStartOptions {
  isMill?: boolean;
  timeLimitSeconds?: number;
  addPetIntervalSeconds?: number;
}

function startBreederMiniGame(petCount: number, level: number = 1, opts: BreederStartOptions = {}): void {
  breederGame.active = true;
  
  // Clear all movement input flags to stop the van when minigame opens
  // This prevents the bug where holding a key when hitting a breeder camp
  // would cause the minigame dialog to continue moving
  setInputFlag(INPUT_LEFT, false);
  setInputFlag(INPUT_RIGHT, false);
  setInputFlag(INPUT_UP, false);
  setInputFlag(INPUT_DOWN, false);
  sendInputImmediately(); // Send stop to server immediately
  
  breederGame.pets = [];
  breederGame.selectedPetIndex = null;
  breederGame.timeLeft = typeof opts.timeLimitSeconds === 'number' ? opts.timeLimitSeconds : getBreederTimeLimitSeconds(level);
  breederGame.totalPets = petCount;
  breederGame.rescuedCount = 0;
  breederGame.level = level;
  breederGame.selectedIngredients = [];
  breederGame.isMill = !!opts.isMill;
  if (breederGame.addPetInterval) {
    clearInterval(breederGame.addPetInterval);
    breederGame.addPetInterval = null;
  }
  // Mill: server sends breederAddPet every 10s; no client-side add-pet interval needed

  // Generate random pets
  const petTypes: PetType[] = ['dog', 'cat', 'horse', 'bird', 'rabbit'];
  for (let i = 0; i < petCount; i++) {
    const type = petTypes[Math.floor(Math.random() * petTypes.length)];
    breederGame.pets.push({ type, rescued: false });
  }

  // Update UI to show level-appropriate foods
  updateFoodButtonsForLevel(level);

  // Render pets
  renderBreederPets();
  updateBreederTokensDisplay();
  renderSelectedIngredients();

  // Hide result, show game
  breederResultEl.classList.add('hidden');
  breederFoodsEl.style.display = 'flex';
  breederMinigameEl.classList.add('show');

  // Update header: mill vs camp
  const titleEl = breederMinigameEl.querySelector('.breeder-title');
  if (titleEl) {
    titleEl.textContent = breederGame.isMill ? '🛑 Stop the Mill!' : `🚨 Stop Level ${level} Breeders!`;
  }

  // Update instructions based on level
  const inst1 = document.getElementById('breeder-instruction-1');
  const inst2 = document.getElementById('breeder-instruction-2');
  const requiredCount = getRequiredIngredients(level);

  if (inst1 && inst2) {
    if (requiredCount === 1) {
      inst1.textContent = '1. Click a pet to select it';
      inst2.textContent = '2. Click the matching food to rescue it!';
    } else {
      inst1.textContent = `1. Click ${requiredCount} ingredients to make a meal`;
      inst2.textContent = '2. Select a pet - if the meal matches, they\'re rescued!';
    }
  }

  // Setup instant rescue button (only for mills and tier 3+ shelters)
  setupInstantRescueButton();

  // Start timer
  breederGame.timerInterval = setInterval(() => {
    breederGame.timeLeft--;
    breederTimerEl.textContent = `${breederGame.timeLeft}s`;
    if (breederGame.timeLeft <= 0) {
      endBreederMiniGame(false);
    }
  }, 1000);
}

/** Calculate the total RT cost to instantly rescue all remaining pets */
function calculateInstantRescueCost(): number {
  const remainingPets = breederGame.pets.filter(p => !p.rescued).length;
  const ingredientsPerMeal = getRequiredIngredients(breederGame.level);
  // Average cost per ingredient based on level
  // Level 1-2: avg ~8 RT (apple 5, carrot 8, chicken 15, seeds 5 = avg 8.25)
  // Level 3-5: avg ~8 RT (same)
  // Level 6-9: avg ~10 RT (add water 20)
  // Level 10+: avg ~12 RT (add bowl 20)
  let avgCostPerIngredient = 8;
  if (breederGame.level >= 10) avgCostPerIngredient = 12;
  else if (breederGame.level >= 6) avgCostPerIngredient = 10;
  
  return remainingPets * ingredientsPerMeal * avgCostPerIngredient;
}

/** Setup the instant rescue button visibility and click handler */
function setupInstantRescueButton(): void {
  const btn = document.getElementById('instant-rescue-btn') as HTMLButtonElement | null;
  if (!btn) return;

  // Only show for mills and tier 3+ shelters
  const me = latestSnapshot?.players.find(p => p.id === myPlayerId);
  const myShelter = latestSnapshot?.shelters?.find(s => s.ownerId === myPlayerId);
  const shelterTier = myShelter?.tier ?? 0;
  
  // Show instant rescue for mills and camps at any level, requires tier 3+ shelter
  if (shelterTier < 3) {
    btn.classList.add('hidden');
    return;
  }

  const cost = calculateInstantRescueCost();
  const currentRt = me?.money ?? 0;
  const canAfford = currentRt >= cost;

  btn.textContent = `⚡ Instant Rescue (${cost} RT)`;
  btn.disabled = !canAfford;
  btn.classList.remove('hidden');

  // Remove old event listener and add new one
  const newBtn = btn.cloneNode(true) as HTMLButtonElement;
  btn.parentNode?.replaceChild(newBtn, btn);
  
  newBtn.addEventListener('click', () => {
    if (!canAfford) {
      showToast(`Not enough RT! Need ${cost}`, 'error');
      return;
    }
    // Send instant rescue request to server
    sendInstantRescue();
  });
}

/** Send instant rescue request to server */
function sendInstantRescue(): void {
  if (!gameWs || gameWs.readyState !== WebSocket.OPEN) return;
  
  const cost = calculateInstantRescueCost();
  gameWs.send(JSON.stringify({
    type: 'instantRescue',
    cost,
    totalPets: breederGame.totalPets,
    level: breederGame.level,
    isMill: breederGame.isMill
  }));
  
  // Immediately end the minigame with full success (server will validate)
  breederGame.rescuedCount = breederGame.totalPets;
  breederGame.pets.forEach(p => p.rescued = true);
  endBreederMiniGame(true);
}

/** Show/hide water and bowl buttons based on breeder level */
function updateFoodButtonsForLevel(level: number): void {
  const waterBtn = breederFoodsEl.querySelector('[data-food="water"]') as HTMLElement | null;
  const bowlBtn = breederFoodsEl.querySelector('[data-food="bowl"]') as HTMLElement | null;
  
  // Water is needed for level 6+
  if (waterBtn) {
    waterBtn.style.display = level >= 6 ? 'flex' : 'none';
  }
  // Bowl is needed for level 10+
  if (bowlBtn) {
    bowlBtn.style.display = level >= 10 ? 'flex' : 'none';
  }
}

/** Render currently selected ingredients for meal building */
function renderSelectedIngredients(): void {
  const requiredCount = getRequiredIngredients(breederGame.level);
  
  // Find or create the ingredients display area
  let ingredientsEl = document.getElementById('breeder-selected-ingredients');
  if (!ingredientsEl) {
    ingredientsEl = document.createElement('div');
    ingredientsEl.id = 'breeder-selected-ingredients';
    ingredientsEl.className = 'breeder-ingredients';
    // Insert before food buttons
    breederFoodsEl.parentNode?.insertBefore(ingredientsEl, breederFoodsEl);
  }
  
  if (requiredCount <= 1) {
    // Single ingredient mode - hide this area
    ingredientsEl.style.display = 'none';
    return;
  }
  
  ingredientsEl.style.display = 'flex';
  
  const FOOD_ICONS: Record<FoodType, string> = {
    apple: '🍎', carrot: '🥕', chicken: '🍗', seeds: '🌻', water: '💧', bowl: '🥣'
  };
  
  // Show selected ingredients and empty slots
  const slots: string[] = [];
  for (let i = 0; i < requiredCount; i++) {
    if (i < breederGame.selectedIngredients.length) {
      const food = breederGame.selectedIngredients[i];
      slots.push(`<div class="ingredient-slot filled">${FOOD_ICONS[food]}</div>`);
    } else {
      slots.push(`<div class="ingredient-slot empty">?</div>`);
    }
  }
  
  ingredientsEl.innerHTML = `
    <span class="ingredients-label">Building meal (${breederGame.selectedIngredients.length}/${requiredCount}):</span>
    <div class="ingredient-slots">${slots.join('')}</div>
    ${breederGame.selectedIngredients.length > 0 ? '<button type="button" class="clear-ingredients-btn" id="clear-ingredients">Clear</button>' : ''}
  `;
  
  // Add clear button handler
  const clearBtn = document.getElementById('clear-ingredients');
  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      breederGame.selectedIngredients = [];
      renderSelectedIngredients();
      updateBreederTokensDisplay();
    });
  }
}

function renderBreederPets(): void {
  breederPetsEl.innerHTML = breederGame.pets.map((pet, i) => `
    <div class="breeder-pet${pet.rescued ? ' rescued' : ''}${breederGame.selectedPetIndex === i ? ' selected' : ''}" 
         data-index="${i}">
      <span>${PET_EMOJIS[pet.type]}</span>
      <span class="breeder-pet-label">${pet.type}</span>
    </div>
  `).join('');
  
  // Add click handlers to select pets
  breederPetsEl.querySelectorAll('.breeder-pet:not(.rescued)').forEach((el) => {
    el.addEventListener('click', () => {
      const index = parseInt((el as HTMLElement).dataset.index ?? '-1', 10);
      if (index >= 0 && !breederGame.pets[index].rescued) {
        breederGame.selectedPetIndex = index;
        renderBreederPets();
        updateBreederTokensDisplay(); // Update food button states
      }
    });
  });
}

function updateBreederTokensDisplay(): void {
  const me = latestSnapshot?.players.find((p) => p.id === myPlayerId);
  const tokens = me?.money ?? 0;
  breederTokensEl.textContent = `Your Tokens: ${tokens} RT`;
  
  const requiredCount = getRequiredIngredients(breederGame.level);
  
  // Update button states based on available tokens and level requirements
  breederFoodsEl.querySelectorAll('.breeder-food-btn').forEach((btn) => {
    const food = (btn as HTMLElement).dataset.food as FoodType;
    const cost = FOOD_COSTS[food];
    
    // For single ingredient mode, need a pet selected
    // For meal mode, can add ingredients anytime but need a pet to complete the meal
    const canAfford = tokens >= cost;
    const alreadyAdded = breederGame.selectedIngredients.includes(food);
    
    if (requiredCount === 1) {
      // Single ingredient mode - need pet selected
      (btn as HTMLButtonElement).disabled = !canAfford || breederGame.selectedPetIndex === null;
    } else {
      // Meal mode - can add ingredients if affordable and not already added
      (btn as HTMLButtonElement).disabled = !canAfford || alreadyAdded;
    }
  });
}

/** Check if selected ingredients form a valid meal for a pet type */
function checkMealMatch(ingredients: FoodType[], petType: PetType): boolean {
  const ingredientCount = getRequiredIngredients(breederGame.level);
  const recipes = MEAL_RECIPES[ingredientCount];
  if (!recipes) return false;
  
  // Sort ingredients for comparison
  const sortedIngredients = [...ingredients].sort();
  
  for (const recipe of recipes) {
    if (!recipe.worksOn.includes(petType)) continue;
    
    const sortedRecipe = [...recipe.ingredients].sort();
    if (sortedIngredients.length !== sortedRecipe.length) continue;
    
    let matches = true;
    for (let i = 0; i < sortedIngredients.length; i++) {
      if (sortedIngredients[i] !== sortedRecipe[i]) {
        matches = false;
        break;
      }
    }
    if (matches) return true;
  }
  return false;
}

function useFood(food: FoodType): void {
  const cost = FOOD_COSTS[food];
  const me = latestSnapshot?.players.find((p) => p.id === myPlayerId);
  const tokens = me?.money ?? 0;
  
  if (tokens < cost) return;
  
  const requiredCount = getRequiredIngredients(breederGame.level);
  
  // Level 1-2: Single ingredient mode (original behavior)
  if (requiredCount === 1) {
    if (breederGame.selectedPetIndex === null) return;
    
    const pet = breederGame.pets[breederGame.selectedPetIndex];
    if (!pet || pet.rescued) return;
    
    // Send food use to server (will deduct tokens)
    if (gameWs?.readyState === WebSocket.OPEN) {
      const worksOn = FOOD_WORKS_ON[food];
      const success = worksOn.includes(pet.type);
      
      gameWs.send(JSON.stringify({
        type: 'breederUseFood',
        food,
        petIndex: breederGame.selectedPetIndex,
        petType: pet.type,
        success,
      }));
      
      if (success) {
        pet.rescued = true;
        breederGame.rescuedCount++;
        breederGame.selectedPetIndex = null;
        playPickupGrowth();
        
        if (breederGame.rescuedCount >= breederGame.totalPets) {
          endBreederMiniGame(true);
        } else {
          renderBreederPets();
        }
      } else {
        playAttackWarning();
      }
      
      updateBreederTokensDisplay();
    }
    return;
  }
  
  // Level 3+: Meal combination mode
  // Check if ingredient already added
  if (breederGame.selectedIngredients.includes(food)) {
    showToast('Already added to meal!');
    return;
  }
  
  // Deduct tokens immediately when adding ingredient
  if (gameWs?.readyState === WebSocket.OPEN) {
    gameWs.send(JSON.stringify({
      type: 'breederUseFood',
      food,
      petIndex: -1, // Not targeting a specific pet yet
      petType: 'ingredient',
      success: false, // Will validate when meal is complete
    }));
  }
  
  // Add ingredient to the meal
  breederGame.selectedIngredients.push(food);
  renderSelectedIngredients();
  updateBreederTokensDisplay();
  
  // Check if we have all required ingredients
  if (breederGame.selectedIngredients.length >= requiredCount) {
    // Now validate against the selected pet
    if (breederGame.selectedPetIndex === null) {
      showToast('Select a pet to feed this meal to!');
      return;
    }
    
    const pet = breederGame.pets[breederGame.selectedPetIndex];
    if (!pet || pet.rescued) {
      breederGame.selectedIngredients = [];
      renderSelectedIngredients();
      return;
    }
    
    const success = checkMealMatch(breederGame.selectedIngredients, pet.type);
    
    if (success) {
      pet.rescued = true;
      breederGame.rescuedCount++;
      breederGame.selectedPetIndex = null;
      breederGame.selectedIngredients = [];
      playPickupGrowth();
      showToast('Meal complete! Pet rescued!', 'success');
      
      if (breederGame.rescuedCount >= breederGame.totalPets) {
        endBreederMiniGame(true);
      } else {
        renderBreederPets();
        renderSelectedIngredients();
      }
    } else {
      // Wrong meal - only lose time, not tokens
      breederGame.selectedIngredients = [];
      playAttackWarning();
      showToast('Wrong meal! Try again.', 'error');
      renderSelectedIngredients();
    }
    
    updateBreederTokensDisplay();
  }
}

function endBreederMiniGame(completed: boolean): void {
  if (breederGame.timerInterval) {
    clearInterval(breederGame.timerInterval);
    breederGame.timerInterval = null;
  }
  if (breederGame.addPetInterval) {
    clearInterval(breederGame.addPetInterval);
    breederGame.addPetInterval = null;
  }
  
  // Send completion to server
  if (gameWs?.readyState === WebSocket.OPEN) {
    gameWs.send(JSON.stringify({
      type: 'breederComplete',
      rescuedCount: breederGame.rescuedCount,
      totalPets: breederGame.totalPets,
      level: breederGame.level,
    }));
  }
  
  // Show result (will be updated when server responds with rewards)
  breederFoodsEl.style.display = 'none';
  breederResultEl.classList.remove('hidden');
  breederResultTitleEl.textContent = completed 
    ? 'All Pets Rescued!' 
    : `Time's Up! (${breederGame.rescuedCount}/${breederGame.totalPets})`;
  breederRewardsEl.innerHTML = '<p style="color:rgba(255,255,255,0.7)">Calculating rewards...</p>';
}

function showBreederRewards(tokenBonus: number, rewards: Array<{ type: string; amount: number }>): void {
  const hasPenalty = rewards.some(r => r.type === 'penalty');
  const hasRewards = tokenBonus > 0 || rewards.some(r => r.type !== 'penalty');
  
  const rewardLines: string[] = [];
  
  // Show penalty first (in red)
  const penaltyReward = rewards.find(r => r.type === 'penalty');
  if (penaltyReward) {
    rewardLines.push(`<div class="breeder-reward-item" style="color:#ff6b6b;">-${penaltyReward.amount} Size (pets escaped!)</div>`);
  }
  
  // Show positive rewards
  if (tokenBonus > 0) {
    rewardLines.push(`<div class="breeder-reward-item">+${tokenBonus} RT</div>`);
  }
  
  rewards.forEach(r => {
    if (r.type === 'size') rewardLines.push(`<div class="breeder-reward-item">+${r.amount} Size</div>`);
    if (r.type === 'speed') rewardLines.push(`<div class="breeder-reward-item">Speed Boost!</div>`);
    if (r.type === 'port') rewardLines.push(`<div class="breeder-reward-item">+${r.amount} Port Charge</div>`);
    if (r.type === 'shelterPort') rewardLines.push(`<div class="breeder-reward-item">+${r.amount} Home Port 🏠</div>`);
  });
  
  const title = hasRewards 
    ? '🎁 Rescue Chest' 
    : (hasPenalty ? '❌ Breeder Escape!' : 'No Rewards');
  const titleColor = hasRewards ? '#ffd93d' : '#ff6b6b';
  
  breederRewardsEl.innerHTML = `
    <div class="breeder-result-title" style="color:${titleColor};margin-bottom:8px;">${title}</div>
    ${rewardLines.join('')}
  `;
}

function closeBreederMiniGame(): void {
  breederGame.active = false;
  breederMinigameEl.classList.remove('show');
}

// Breeder Mini-Game Event Listeners
breederFoodsEl.querySelectorAll('.breeder-food-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    const food = (btn as HTMLElement).dataset.food as FoodType;
    if (food) useFood(food);
  });
});

breederCloseBtnEl.addEventListener('click', closeBreederMiniGame);

// --- Daily Gift System ---
interface DailyGiftReward {
  tokens: number;
  sizeBonus?: number;
  speedBoost?: boolean;
  portCharge?: boolean;
}

interface DailyGiftStatus {
  currentDay: number;
  canClaimToday: boolean;
  lastClaimDate: string | null;
  totalClaims: number;
  rewards: DailyGiftReward[];
}

let dailyGiftStatus: DailyGiftStatus | null = null;

const GIFT_ICONS: Record<number, string> = {
  1: '🎁',
  2: '⚡',
  3: '💰',
  4: '📦',
  5: '⚡',
  6: '🌀',
  7: '🏆',
};

function formatGiftReward(reward: DailyGiftReward): string {
  const parts: string[] = [];
  if (reward.tokens > 0) parts.push(`${reward.tokens} RT`);
  if (reward.sizeBonus) parts.push(`+${reward.sizeBonus} Size`);
  if (reward.speedBoost) parts.push('Speed');
  if (reward.portCharge) parts.push('Random Port');
  return parts.join(' + ');
}

function renderDailyGiftGrid(): void {
  if (!dailyGiftStatus) return;
  
  const { currentDay, canClaimToday, rewards } = dailyGiftStatus;
  
  let html = '';
  
  // For non-signed-in users, show all days as locked/greyed out
  const showAsLocked = !isSignedIn;
  
  for (let i = 0; i < 7; i++) {
    const day = i + 1;
    const reward = rewards[i];
    
    let isCurrent = false;
    let isClaimed = false;
    let isLocked = true;
    
    if (!showAsLocked) {
      isCurrent = day === currentDay && canClaimToday;
      isClaimed = day < currentDay; // Only days BEFORE currentDay are claimed
      isLocked = day > currentDay || (day === currentDay && !canClaimToday); // Future days OR current when can't claim
    }
    
    const classes = [
      'daily-gift-day',
      isCurrent ? 'current' : '',
      isClaimed ? 'claimed' : '',
      isLocked || showAsLocked ? 'locked' : '',
      day === 7 ? 'daily-gift-day7' : '',
    ].filter(Boolean).join(' ');
    
    // Use different icons: ✓ for claimed, 🔓 for claimable, 🔒 for locked
    const icon = isClaimed ? '✓' : (isCurrent ? '🔓' : '🔒');
    
    html += `
      <div class="${classes}">
        <div class="daily-gift-day-label">Day ${day}</div>
        <div class="daily-gift-day-icon">${icon}</div>
        <div class="daily-gift-day-reward">${formatGiftReward(reward)}</div>
      </div>
    `;
  }
  
  // Add sign-in overlay for non-signed-in users
  if (!isSignedIn) {
    html = `
      <div class="daily-gift-signin-overlay">
        <div class="daily-gift-signin-message">Sign in for daily gifts!</div>
        <div class="daily-gift-signin-buttons">
          <a href="${buildAuthUrl('/auth/google')}" class="daily-gift-signin-btn google">Sign in with Google</a>
        </div>
      </div>
      <div class="daily-gift-grid-greyed">${html}</div>
    `;
    dailyGiftGridEl.innerHTML = html;
    dailyGiftClaimBtnEl.classList.add('hidden');
    dailyGiftSubtitleEl.textContent = '';
  } else {
    dailyGiftGridEl.innerHTML = html;
    dailyGiftClaimBtnEl.classList.remove('hidden');
    
    if (canClaimToday) {
      dailyGiftClaimBtnEl.disabled = false;
      dailyGiftClaimBtnEl.textContent = `Claim Day ${currentDay} Gift`;
      dailyGiftSubtitleEl.textContent = 'Play to unlock today\'s gift!';
    } else {
      dailyGiftClaimBtnEl.disabled = true;
      dailyGiftClaimBtnEl.textContent = 'Come back tomorrow!';
      dailyGiftSubtitleEl.textContent = `Next gift: Day ${currentDay > 7 ? 1 : currentDay}`;
    }
  }
}

async function fetchDailyGiftStatus(): Promise<void> {
  // Always show daily gift button, but only fetch status if signed in
  dailyGiftBtnEl.classList.remove('hidden');
  
  if (!isSignedIn) {
    // Show default day 1 for non-signed-in users (they can view but not claim)
    dailyGiftStatus = {
      currentDay: 1,
      canClaimToday: true, // They can "try" to claim but will be prompted to sign in
      lastClaimDate: null,
      totalClaims: 0,
      rewards: [
        { tokens: 15 },
        { tokens: 25, speedBoost: true },
        { tokens: 40 },
        { tokens: 50, sizeBonus: 3 },
        { tokens: 75, speedBoost: true },
        { tokens: 100, portCharge: true },
        { tokens: 150, sizeBonus: 5, speedBoost: true },
      ],
    };
    dailyGiftBtnEl.classList.add('has-gift');
    return;
  }
  
  try {
    const res = await fetch('/api/daily-gift', { credentials: 'include' });
    if (!res.ok) {
      // Default fallback status for signed-in users when API fails
      dailyGiftStatus = {
        currentDay: 1,
        canClaimToday: true,
        lastClaimDate: null,
        totalClaims: 0,
        rewards: [
          { tokens: 15 },
          { tokens: 25, speedBoost: true },
          { tokens: 40 },
          { tokens: 50, sizeBonus: 3 },
          { tokens: 75, speedBoost: true },
          { tokens: 100, portCharge: true },
          { tokens: 150, sizeBonus: 5, speedBoost: true },
        ],
      };
      dailyGiftBtnEl.classList.add('has-gift');
      return;
    }
    
    dailyGiftStatus = await res.json();
    
    // Add pulsing animation if gift is available
    if (dailyGiftStatus?.canClaimToday) {
      dailyGiftBtnEl.classList.add('has-gift');
    } else {
      dailyGiftBtnEl.classList.remove('has-gift');
    }
  } catch {
    // Default fallback status for signed-in users when API fails
    dailyGiftStatus = {
      currentDay: 1,
      canClaimToday: true,
      lastClaimDate: null,
      totalClaims: 0,
      rewards: [
        { tokens: 15 },
        { tokens: 25, speedBoost: true },
        { tokens: 40 },
        { tokens: 50, sizeBonus: 3 },
        { tokens: 75, speedBoost: true },
        { tokens: 100, portCharge: true },
        { tokens: 150, sizeBonus: 5, speedBoost: true },
      ],
    };
    dailyGiftBtnEl.classList.add('has-gift');
  }
  
  // Update lobby gift button too
  updateLobbyGiftButton();
}

function openDailyGiftModal(): void {
  if (!dailyGiftStatus) return;
  renderDailyGiftGrid();
  dailyGiftModalEl.classList.add('show');
}

function closeDailyGiftModal(): void {
  dailyGiftModalEl.classList.remove('show');
}

async function claimDailyGiftAction(): Promise<void> {
  // Check if user is signed in first
  if (!isSignedIn) {
    showToast('Sign in to collect daily rewards!');
    closeDailyGiftModal();
    return;
  }
  
  if (!dailyGiftStatus?.canClaimToday) return;
  
  try {
    const res = await fetch('/api/daily-gift/claim', {
      method: 'POST',
      credentials: 'include',
    });
    
    if (!res.ok) {
      const data = await res.json();
      showToast(data.error || 'Failed to claim gift');
      return;
    }
    
    const data = await res.json();
    
    // Award tokens locally
    if (data.reward?.tokens) {
      setTokens(getTokens() + data.reward.tokens);
      updateLandingTokens();
    }
    
    // Update status
    await fetchDailyGiftStatus();
    renderDailyGiftGrid();
    
    // Show success message
    const rewardText = formatGiftReward(data.reward);
    showToast(`Gift claimed: ${rewardText}`, 'success');
    
  } catch {
    showToast('Failed to claim gift');
  }
}

// Daily Gift Event Listeners
dailyGiftBtnEl.addEventListener('click', openDailyGiftModal);
dailyGiftCloseEl.addEventListener('click', closeDailyGiftModal);
dailyGiftClaimBtnEl.addEventListener('click', claimDailyGiftAction);
lobbyGiftBtnEl.addEventListener('click', openDailyGiftModal);

// ========== Live Lobby Leaderboard (WebSocket) ==========

function renderLobbyLeaderboard(entries: { rank: number; userId?: string; displayName: string; adoptionScore?: number; rtEarned?: number; shelterColor?: string | null }[]): void {
  if (!lobbyLeaderboardContentEl) return;
  if (entries.length === 0) {
    lobbyLeaderboardContentEl.innerHTML = '<div class="lobby-leaderboard-loading">No scores yet. Play to appear!</div>';
    return;
  }
  const myId = currentUserId ?? '';
  lobbyLeaderboardContentEl.innerHTML = entries.map((entry) => {
    const score = entry.adoptionScore ?? entry.rtEarned ?? 0;
    const highlight = entry.userId === myId ? ' highlight' : '';
    const rankClass = entry.rank === 1 ? 'gold' : entry.rank === 2 ? 'silver' : entry.rank === 3 ? 'bronze' : '';
    const colorSpan = entry.shelterColor
      ? `<span class="leaderboard-color" style="background:${escapeHtml(entry.shelterColor)}"></span>`
      : '';
    return `<div class="lobby-leaderboard-entry${highlight}">
      <span class="lobby-leaderboard-rank ${rankClass}">#${entry.rank}</span>
      ${colorSpan}
      <span class="lobby-leaderboard-name">${escapeHtml(entry.displayName)}</span>
      <span class="lobby-leaderboard-score">${score}</span>
    </div>`;
  }).join('');
}

function connectLobbyLeaderboard(): void {
  if (!lobbyLeaderboardContentEl) return;
  if (lobbyLeaderboardWs?.readyState === WebSocket.OPEN) return;
  if (lobbyLeaderboardWs) {
    try { lobbyLeaderboardWs.close(); } catch { /* ignore */ }
    lobbyLeaderboardWs = null;
  }
  // Clear any pending reconnect timer
  if (lobbyLeaderboardReconnectTimer) {
    clearTimeout(lobbyLeaderboardReconnectTimer);
    lobbyLeaderboardReconnectTimer = null;
  }
  lobbyLeaderboardContentEl.innerHTML = '<div class="lobby-leaderboard-loading">Connecting…</div>';
  const ws = new WebSocket(SIGNALING_URL);
  lobbyLeaderboardWs = ws;
  ws.onopen = () => {
    lobbyLeaderboardReconnectAttempts = 0; // Reset on successful connection
    ws.send(JSON.stringify({ type: 'subscribeLeaderboard' }));
  };
  ws.onmessage = (e) => {
    try {
      const msg = JSON.parse(e.data as string);
      if (msg.type === 'leaderboardUpdate' && Array.isArray(msg.entries)) {
        renderLobbyLeaderboard(msg.entries);
      }
    } catch {
      // ignore
    }
  };
  ws.onerror = () => {
    if (lobbyLeaderboardContentEl) lobbyLeaderboardContentEl.innerHTML = '<div class="lobby-leaderboard-loading">Connection error</div>';
  };
  ws.onclose = () => {
    if (lobbyLeaderboardWs === ws) {
      lobbyLeaderboardWs = null;
      // Schedule reconnect with exponential backoff
      scheduleLeaderboardReconnect();
    }
  };
}

function scheduleLeaderboardReconnect(): void {
  // Only reconnect if we're on the lobby screen (landing visible)
  const landing = document.getElementById('landing');
  if (!landing || landing.style.display === 'none') return;
  
  lobbyLeaderboardReconnectAttempts++;
  const delay = Math.min(1000 * Math.pow(2, lobbyLeaderboardReconnectAttempts - 1), LOBBY_LEADERBOARD_MAX_RECONNECT_DELAY);
  
  if (lobbyLeaderboardContentEl) {
    lobbyLeaderboardContentEl.innerHTML = `<div class="lobby-leaderboard-loading">Reconnecting in ${Math.round(delay / 1000)}s…</div>`;
  }
  
  lobbyLeaderboardReconnectTimer = setTimeout(() => {
    lobbyLeaderboardReconnectTimer = null;
    connectLobbyLeaderboard();
  }, delay);
}

function disconnectLobbyLeaderboard(): void {
  // Clear any pending reconnect timer
  if (lobbyLeaderboardReconnectTimer) {
    clearTimeout(lobbyLeaderboardReconnectTimer);
    lobbyLeaderboardReconnectTimer = null;
  }
  lobbyLeaderboardReconnectAttempts = 0;
  if (lobbyLeaderboardWs) {
    try { lobbyLeaderboardWs.close(); } catch { /* ignore */ }
    lobbyLeaderboardWs = null;
  }
  if (lobbyLeaderboardContentEl) {
    lobbyLeaderboardContentEl.innerHTML = '<div class="lobby-leaderboard-loading">Connecting…</div>';
  }
}

// ========== Game Stats ==========
const gameStatsContentEl = document.getElementById('game-stats-content');
let gameStatsIntervalId: ReturnType<typeof setInterval> | null = null;

async function fetchGameStats(): Promise<void> {
  if (!gameStatsContentEl) return;
  try {
    const res = await fetch('/api/game-stats', { credentials: 'include' });
    if (!res.ok) throw new Error('Failed to fetch stats');
    const stats = await res.json();
    renderGameStats(stats);
  } catch {
    gameStatsContentEl.innerHTML = '<div style="color:rgba(255,255,255,0.6)">Stats unavailable</div>';
  }
}

function renderGameStats(stats: {
  realtime: { onlinePlayers: number; ffaWaiting: number; playingSolo: number; playingFfa: number; playingTeams: number };
  historical: { totalGamesPlayed: number; gamesByMode: { solo: number; ffa: number; teams: number }; mostPopularMode: string | null; newUsersToday: number };
}): void {
  if (!gameStatsContentEl) return;
  const { realtime, historical } = stats;
  const html = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px 12px;margin-bottom:8px">
      <div><span style="color:#7bed9f;font-weight:700">${realtime.onlinePlayers}</span> online now</div>
      <div><span style="color:#ffd93d;font-weight:700">${realtime.ffaWaiting}</span> in FFA queue</div>
      <div><span style="color:#70a3ff">${realtime.playingSolo}</span> playing Solo</div>
      <div><span style="color:#c77dff">${realtime.playingFfa}</span> playing FFA</div>
      <div><span style="color:#ff9f43">${realtime.playingTeams}</span> playing Teams</div>
    </div>
    <div style="border-top:1px solid rgba(255,255,255,0.15);padding-top:6px;margin-top:4px">
      <div><span style="font-weight:700">${historical.totalGamesPlayed.toLocaleString()}</span> total games played</div>
      <div>Popular mode: <span style="color:#7bed9f;font-weight:600">${historical.mostPopularMode ?? 'N/A'}</span></div>
      <div><span style="color:#5eead4">${historical.newUsersToday}</span> new players today</div>
    </div>
  `;
  gameStatsContentEl.innerHTML = html;
}

function startGameStatsPolling(): void {
  if (gameStatsIntervalId) return;
  fetchGameStats();
  gameStatsIntervalId = setInterval(fetchGameStats, 10000); // Refresh every 10 seconds
}

function stopGameStatsPolling(): void {
  if (gameStatsIntervalId) {
    clearInterval(gameStatsIntervalId);
    gameStatsIntervalId = null;
  }
}

// ========== Leaderboard System ==========

type LeaderboardEntry = {
  rank: number;
  userId: string;
  displayName: string;
  wins: number;
  rtEarned: number;
  gamesPlayed?: number;
  losses?: number;
  adoptionScore?: number;
  shelterColor: string | null;
};

type LeaderboardType = 'alltime' | 'daily' | 'weekly' | 'season' | 'games' | 'history';
type LeaderboardSort = 'wins' | 'losses' | 'games' | 'score';
let currentLeaderboardType: LeaderboardType = 'alltime';
let currentLeaderboardSort: LeaderboardSort = 'score';

interface MatchHistoryEntry {
  id: number;
  user_id: string;
  match_id: string;
  mode: string;
  result: string;
  rt_earned: number;
  adoptions: number;
  duration_seconds: number;
  played_at: number;
}

const leaderboardSortEl = document.getElementById('leaderboard-sort') as HTMLSelectElement | null;

async function fetchMatchHistory(limit?: number): Promise<MatchHistoryEntry[]> {
  try {
    const limitParam = limit ? `?limit=${limit}` : '';
    const res = await fetch(`/api/match-history${limitParam}`, { credentials: 'include' });
    if (!res.ok) return [];
    const data = await res.json();
    return data.matches ?? [];
  } catch {
    return [];
  }
}

async function fetchLeaderboard(type: LeaderboardType, sort?: LeaderboardSort): Promise<LeaderboardEntry[]> {
  try {
    const sortParam = (type === 'alltime' || type === 'games') && sort ? `&sort=${sort}` : '';
    const res = await fetch(`/api/leaderboard?type=${type}${sortParam}`, { credentials: 'include' });
    if (!res.ok) return [];
    const data = await res.json();
    return data.entries ?? [];
  } catch {
    return [];
  }
}

async function fetchMyRank(): Promise<{ alltime: { rank: number }; daily: { rank: number } }> {
  try {
    const res = await fetch('/api/leaderboard/my-rank', { credentials: 'include' });
    if (!res.ok) return { alltime: { rank: 0 }, daily: { rank: 0 } };
    return await res.json();
  } catch {
    return { alltime: { rank: 0 }, daily: { rank: 0 } };
  }
}

function formatMatchHistoryDate(ts: number): string {
  const d = new Date(ts);
  const now = Date.now();
  const diff = now - ts;
  if (diff < 60000) return 'Just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: d.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined });
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s ? `${m}m ${s}s` : `${m}m`;
}

function renderMatchHistory(matches: MatchHistoryEntry[]): void {
  if (matches.length === 0) {
    leaderboardContentEl.innerHTML = '<div class="leaderboard-empty">No match history yet. Play matches to see them here!</div>';
    leaderboardMyRankEl.innerHTML = isSignedIn ? 'Your recent matches' : 'Sign in to see your match history';
    return;
  }
  const resultLabels: Record<string, string> = { win: 'Win', loss: 'Loss', stray_loss: 'Stray loss', quit: 'Quit' };
  leaderboardContentEl.innerHTML = matches.map(m => {
    const resultLabel = resultLabels[m.result] ?? m.result;
    const resultClass = m.result === 'win' ? 'history-win' : m.result === 'stray_loss' ? 'history-stray' : m.result === 'quit' ? 'history-quit' : 'history-loss';
    return `
      <div class="match-history-entry">
        <span class="match-history-result ${resultClass}">${resultLabel}</span>
        <span class="match-history-mode">${escapeHtml(m.mode)}</span>
        <span class="match-history-rt">${m.rt_earned} RT</span>
        <span class="match-history-adopt">${m.adoptions} adoptions</span>
        <span class="match-history-dur">${formatDuration(m.duration_seconds)}</span>
        <span class="match-history-date">${formatMatchHistoryDate(m.played_at)}</span>
      </div>
    `;
  }).join('');
  leaderboardMyRankEl.innerHTML = `Your last ${matches.length} matches`;
}

function renderLeaderboard(entries: LeaderboardEntry[], myRank: number): void {
  if (entries.length === 0) {
    leaderboardContentEl.innerHTML = '<div class="leaderboard-empty">No rankings yet. Play to be the first!</div>';
    leaderboardMyRankEl.innerHTML = '';
    return;
  }
  
  leaderboardContentEl.innerHTML = entries.map(entry => {
    const rankClass = entry.rank === 1 ? 'gold' : entry.rank === 2 ? 'silver' : entry.rank === 3 ? 'bronze' : '';
    const highlight = entry.displayName === currentDisplayName ? 'highlight' : '';
    const colorBadge = entry.shelterColor 
      ? `<span class="leaderboard-color" style="background:${entry.shelterColor}"></span>` 
      : '';
    return `
      <div class="leaderboard-entry ${highlight}">
        <div class="leaderboard-rank ${rankClass}">#${entry.rank}</div>
        ${colorBadge}
        <div class="leaderboard-name">${escapeHtml(entry.displayName)}</div>
        <div class="leaderboard-stats">
          <span class="wins">${entry.wins} wins</span>${typeof entry.gamesPlayed === 'number' ? ` · ${entry.gamesPlayed} games` : ''}${typeof entry.losses === 'number' ? ` · ${entry.losses} losses` : ''}<br>
          ${entry.rtEarned} RT
        </div>
      </div>
    `;
  }).join('');
  
  if (myRank > 0 && myRank <= 10) {
    leaderboardMyRankEl.innerHTML = `Your rank: <strong>#${myRank}</strong> (Top 10 gets daily rewards!)`;
  } else if (myRank > 10) {
    leaderboardMyRankEl.innerHTML = `Your rank: <strong>#${myRank}</strong> - Get into top 10 for daily rewards!`;
  } else {
    leaderboardMyRankEl.innerHTML = 'Win matches to appear on the leaderboard!';
  }
}

async function openLeaderboardModal(): Promise<void> {
  leaderboardModalEl.classList.add('show');
  await refreshLeaderboard();
}

function closeLeaderboardModal(): void {
  leaderboardModalEl.classList.remove('show');
}

async function refreshLeaderboard(): Promise<void> {
  const sortElParent = leaderboardSortEl?.closest('.leaderboard-sort');
  if (currentLeaderboardType === 'history') {
    sortElParent?.classList.add('hidden');
    const matches = await fetchMatchHistory(50);
    renderMatchHistory(matches);
    return;
  }
  sortElParent?.classList.remove('hidden');
  const sort = currentLeaderboardType === 'games' ? (currentLeaderboardSort === 'score' ? 'games' : currentLeaderboardSort) : currentLeaderboardSort;
  const entries = await fetchLeaderboard(currentLeaderboardType, sort);
  let myRank: number;
  if (currentLeaderboardType === 'alltime' || currentLeaderboardType === 'daily') {
    const myRanks = await fetchMyRank();
    myRank = currentLeaderboardType === 'alltime' ? myRanks.alltime.rank : myRanks.daily.rank;
  } else {
    const me = entries.find(e => e.displayName === currentDisplayName);
    myRank = me ? me.rank : 0;
  }
  renderLeaderboard(entries, myRank);
}

// Leaderboard tab switching
document.querySelectorAll('.leaderboard-tab').forEach(tab => {
  tab.addEventListener('click', async () => {
    document.querySelectorAll('.leaderboard-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    currentLeaderboardType = (tab as HTMLElement).dataset.type as LeaderboardType;
    await refreshLeaderboard();
  });
});

// Leaderboard sort (all-time and games)
if (leaderboardSortEl) {
  leaderboardSortEl.addEventListener('change', async () => {
    currentLeaderboardSort = leaderboardSortEl.value as LeaderboardSort;
    await refreshLeaderboard();
  });
}

// Leaderboard Event Listeners
leaderboardBtnEl.addEventListener('click', openLeaderboardModal);
leaderboardCloseEl.addEventListener('click', closeLeaderboardModal);

// ========== Equipment/Inventory System ==========

async function fetchInventory(): Promise<void> {
  try {
    const res = await fetch('/api/inventory', { credentials: 'include' });
    if (!res.ok) return;
    currentInventory = await res.json();
    updateEquipmentPanel();
  } catch {
    // Ignore errors
  }
}

async function fetchKarma(): Promise<void> {
  try {
    const res = await fetch('/api/karma', { credentials: 'include' });
    if (!res.ok) return;
    const data = await res.json();
    if (data.signedIn && typeof data.karmaPoints === 'number') {
      currentKarmaPoints = data.karmaPoints;
      updateKarmaDisplay();
    }
  } catch {
    // Ignore errors
  }
}

function updateKarmaDisplay(): void {
  if (isSignedIn) {
    karmaDisplayEl.classList.remove('hidden');
    karmaPointsEl.textContent = String(currentKarmaPoints);
  } else {
    karmaDisplayEl.classList.add('hidden');
  }
}

function updateEquipmentPanel(): void {
  equipRtEl.textContent = String(currentInventory.storedRt);
  equipPortsEl.textContent = String(currentInventory.portCharges);
  equipSpeedEl.textContent = String(currentInventory.speedBoosts);
  equipSizeEl.textContent = String(currentInventory.sizeBoosts);
  
  if (currentInventory.signedIn) {
    if (currentInventory.storedRt > 0 || currentInventory.portCharges > 0) {
      equipNoteEl.textContent = 'Items will be used next match';
    } else {
      equipNoteEl.textContent = 'Earn items by winning matches!';
    }
    equipNoteEl.classList.add('signed-in');
  } else {
    equipNoteEl.textContent = 'Sign in to save equipment';
    equipNoteEl.classList.remove('signed-in');
  }
}

/** Withdraw inventory before match starts, returns starting RT and ports */
async function withdrawInventory(): Promise<{ rt: number; ports: number }> {
  if (!isSignedIn) return { rt: 0, ports: 0 };
  
  try {
    const res = await fetch('/api/inventory/withdraw', {
      method: 'POST',
      credentials: 'include',
    });
    if (!res.ok) return { rt: 0, ports: 0 };
    const data = await res.json();
    currentInventory = { storedRt: 0, portCharges: 0, speedBoosts: 0, sizeBoosts: 0, signedIn: true };
    updateEquipmentPanel();
    return { rt: data.storedRt ?? 0, ports: data.portCharges ?? 0 };
  } catch {
    return { rt: 0, ports: 0 };
  }
}

/** Deposit RT and items after match ends */
async function depositInventory(rt: number, portCharges: number = 0, isWinner: boolean = false): Promise<void> {
  if (!isSignedIn || rt <= 0) return;
  
  try {
    await fetch('/api/inventory/deposit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ rt, portCharges, isWinner }),
    });
    // Refresh inventory display
    await fetchInventory();
  } catch {
    // Ignore errors
  }
}

/** Update the lobby gift button visibility and animation */
function updateLobbyGiftButton(): void {
  if (dailyGiftStatus) {
    lobbyGiftBtnEl.classList.remove('hidden');
    if (dailyGiftStatus.canClaimToday || !isSignedIn) {
      lobbyGiftBtnEl.classList.add('has-gift');
    } else {
      lobbyGiftBtnEl.classList.remove('has-gift');
    }
  } else {
    lobbyGiftBtnEl.classList.add('hidden');
  }
}

/** Game server clock (UTC). Daily gift resets at 00:00 UTC. */
async function fetchServerTimeForClock(): Promise<void> {
  try {
    const res = await fetch('/api/server-time', { credentials: 'include' });
    if (!res.ok) return;
    const data = await res.json();
    if (typeof data.nextMidnightUtc === 'string') serverClockNextMidnightUtc = data.nextMidnightUtc;
  } catch {
    // ignore
  }
}

function updateServerClockDisplay(): void {
  const now = new Date();
  const h = now.getUTCHours();
  const m = now.getUTCMinutes();
  const s = now.getUTCSeconds();
  serverClockTimeEl.textContent = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')} UTC`;
  if (serverClockNextMidnightUtc) {
    const nextMs = new Date(serverClockNextMidnightUtc).getTime();
    let rem = Math.max(0, nextMs - Date.now());
    const hours = Math.floor(rem / 3600000);
    rem %= 3600000;
    const mins = Math.floor(rem / 60000);
    serverClockNextGiftEl.textContent = `Next daily gift: in ${hours}h ${mins}m`;
  } else {
    serverClockNextGiftEl.textContent = 'Next daily gift: at 00:00 UTC';
  }
}

function startServerClockWhenOnLobby(): void {
  if (serverClockIntervalId) return;
  fetchServerTimeForClock();
  updateServerClockDisplay();
  serverClockIntervalId = setInterval(() => {
    updateServerClockDisplay();
  }, 1000);
  // Refresh next midnight from server every 30s
  setInterval(() => fetchServerTimeForClock(), 30000);
  connectLobbyLeaderboard();
  startGameStatsPolling();
}

function stopServerClock(): void {
  if (serverClockIntervalId) {
    clearInterval(serverClockIntervalId);
    serverClockIntervalId = null;
  }
}

// --- Start ---
storeReferralFromUrl();
fetchAndRenderAuth().then(() => { fetchInventory(); fetchKarma(); });
updateLandingTokens();
startServerClockWhenOnLobby();
window.addEventListener('resize', resize);
resize();
