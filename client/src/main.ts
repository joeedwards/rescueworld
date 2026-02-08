/**
 * Adoptar.io client: browser-first, 8-directional movement, tap-to-move,
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
  // Boss Mode constants
  BOSS_PETMALL_RADIUS,
  BOSS_MILL_RADIUS,
  BOSS_MILL_NAMES,
  BOSS_INGREDIENT_COSTS,
  BOSS_MODE_TIME_LIMIT_TICKS,
  BOSS_TYCOON_DETECTION_RADIUS,
  // Season constants
  getCurrentSeason,
  getSeasonLabel,
  isInVegetationPatch,
  getWindMultiplier,
  MAX_RT_PER_MATCH,
} from 'shared';
import type { Season } from 'shared';
import { PICKUP_TYPE_GROWTH, PICKUP_TYPE_SPEED, PICKUP_TYPE_PORT, PICKUP_TYPE_BREEDER, PICKUP_TYPE_SHELTER_PORT, VAN_MAX_CAPACITY } from 'shared';
import { PET_TYPE_CAT, PET_TYPE_DOG, PET_TYPE_BIRD, PET_TYPE_RABBIT, PET_TYPE_SPECIAL } from 'shared';
import { BOSS_MILL_HORSE, BOSS_MILL_CAT, BOSS_MILL_DOG, BOSS_MILL_BIRD, BOSS_MILL_RABBIT } from 'shared';
import type { BossModeState, BossMill } from 'shared';
import {
  INPUT_LEFT,
  INPUT_RIGHT,
  INPUT_UP,
  INPUT_DOWN,
  encodeInput,
  decodeSnapshot,
  MSG_SNAPSHOT,
} from 'shared';

// Current season (computed at page load; can be cycled with Ctrl+Shift+Alt+8 easter egg)
let currentSeason: Season = getCurrentSeason();

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
  playPickupBoost,
  playStrayCollected,
  playMatchEnd,
  playAttackWarning,
  playPort,
  playAdoptionSounds,
  getMusicEnabled,
  setMusicEnabled,
  getSfxEnabled,
  setSfxEnabled,
  getShelterAdoptSfxEnabled,
  setShelterAdoptSfxEnabled,
  getVanSoundType,
  setVanSoundType,
  updateEngineState,
  updateEngineThrottle,
  stopEngineLoop,
  playBossMusic,
  stopBossMusic,
  isBossMusicPlaying,
  type VanSoundType,
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

// --- Mobile detection and fullscreen ---
const isMobileBrowser = (() => {
  const ua = navigator.userAgent || navigator.vendor || '';
  return /android|webos|iphone|ipad|ipod|blackberry|iemobile|opera mini/i.test(ua.toLowerCase()) ||
    ('ontouchstart' in window && window.innerWidth < 1024);
})();

// iOS doesn't support Fullscreen API for web pages (only for video elements)
const isIOS = (() => {
  const ua = navigator.userAgent || navigator.vendor || '';
  return /iphone|ipad|ipod/i.test(ua) || 
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1); // iPad on iOS 13+
})();

/** Request fullscreen on mobile browsers when entering a match */
function enterMobileFullscreen(): void {
  // Skip on desktop or iOS (iOS doesn't support Fullscreen API for web pages)
  if (!isMobileBrowser || isIOS) return;
  
  const docEl = document.documentElement;
  try {
    // Try standard API first, then vendor prefixes
    if (docEl.requestFullscreen) {
      docEl.requestFullscreen({ navigationUI: 'hide' }).catch(() => { /* user denied or not supported */ });
    } else if ((docEl as any).webkitRequestFullscreen) {
      // Chrome, Safari, Edge on Android
      (docEl as any).webkitRequestFullscreen();
    } else if ((docEl as any).webkitEnterFullscreen) {
      // Older webkit
      (docEl as any).webkitEnterFullscreen();
    } else if ((docEl as any).mozRequestFullScreen) {
      // Firefox
      (docEl as any).mozRequestFullScreen();
    } else if ((docEl as any).msRequestFullscreen) {
      // IE/Edge legacy
      (docEl as any).msRequestFullscreen();
    }
  } catch {
    // Fullscreen not supported or denied
  }
}

/** Exit fullscreen when returning to lobby on mobile */
function exitMobileFullscreen(): void {
  releaseWakeLock();
  if (!isMobileBrowser || isIOS) return;
  try {
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => { /* ignore */ });
    } else if ((document as any).webkitFullscreenElement) {
      (document as any).webkitExitFullscreen?.();
    } else if ((document as any).webkitExitFullscreen) {
      (document as any).webkitExitFullscreen();
    } else if ((document as any).mozFullScreenElement) {
      (document as any).mozCancelFullScreen?.();
    } else if ((document as any).msFullscreenElement) {
      (document as any).msExitFullscreen?.();
    }
  } catch {
    // Fullscreen exit failed
  }
}

// --- Screen Wake Lock (prevent mobile sleep during gameplay) ---
let wakeLockSentinel: WakeLockSentinel | null = null;

async function requestWakeLock(): Promise<void> {
  if (!('wakeLock' in navigator)) return;
  try {
    wakeLockSentinel = await navigator.wakeLock.request('screen');
    wakeLockSentinel.addEventListener('release', () => {
      wakeLockSentinel = null;
    });
  } catch {
    // Wake lock request failed (low battery, etc.) - not critical
  }
}

function releaseWakeLock(): void {
  wakeLockSentinel?.release();
  wakeLockSentinel = null;
}

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
const interpolatedPets = new Map<string, { prev: PetState; next: PetState; startTime: number; gen: number }>();
let interpPetGen = 0; // Incremented each snapshot; entries with old gen are stale
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
/** Set when matchEndInventory has strayLoss: true; used so match-over UI shows 0 RT even if snapshot lacked the field. */
let matchEndWasStrayLoss = false;
let growthPopUntil = 0;
let currentRttMs = 0;
let highLatencySince = 0;
let pingIntervalId: ReturnType<typeof setInterval> | null = null;
let serverClockNextMidnightUtc: string | null = null;
let serverClockIntervalId: ReturnType<typeof setInterval> | null = null;
const RTT_HIGH_MS = 200;
const RTT_HIGH_DURATION_MS = 5000;

// --- PixiJS rendering modules ---
import {
  renderFrame,
  worldContainer, bgLayer, zoneLayer, pickupLayer,
  shelterLayer, bossLayer, strayLayer, playerLayer,
  effectLayer, hudContainer,
  updateCamera as pixiUpdateCamera,
  screenW as pixiScreenW, screenH as pixiScreenH,
  type Camera,
} from './renderer';
import { adoptionEventTexture } from './sprites';
import { getBreederCampTexture } from './sprites';
import { BackgroundLayer } from './entities/background';
import { updateAdoptionZones, updateAdoptionEvents, clearZones } from './entities/zones';
import { updatePickups, clearPickups } from './entities/pickups';
import { updateShelters, clearShelters } from './entities/shelters';
import { updateVans, clearVans } from './entities/vans';
import { updateStrays as pixiUpdateStrays, clearStrays } from './entities/strays';
import { updateBreeders, clearBreeders } from './entities/breeders';
import { updateBossMode as pixiUpdateBossMode, clearBoss } from './entities/boss';
import {
  renderPortEffects, renderSeasonParticles as pixiRenderSeasonParticles,
  renderAdoptionAnimations as pixiRenderAdoptionAnimations,
  updateSeasonParticles as pixiUpdateSeasonParticles,
  spawnAdoption as pixiSpawnAdoption,
  adoptionAnimations as pixiAdoptionAnimations,
  clearEffects,
  type PortAnimation as PixiPortAnimation,
} from './effects';
import { drawMinimap as pixiDrawMinimap } from './minimap';
import { renderJoystick, renderGrowthPopup, renderShelterLocator } from './hud';
import { Texture } from 'pixi.js';

// PixiJS background layer instance
const _bgLayer = new BackgroundLayer();
bgLayer.addChild(_bgLayer.container);

// --- Render ---
const canvas = document.getElementById('game') as HTMLCanvasElement;
// ctx is no longer used for rendering — all rendering goes through PixiJS WebGL.
// Kept as a no-op reference for legacy Canvas 2D drawing functions (dead code).
const ctx = (null as unknown as CanvasRenderingContext2D);
const minimap = document.getElementById('minimap') as HTMLCanvasElement;
const minimapCtx = minimap.getContext('2d')!;
const scoreEl = document.getElementById('score')!;
const eventPanelEl = document.getElementById('event-panel')!;
const eventPanelListEl = document.getElementById('event-panel-list')!;
const eventToggleBtnEl = document.getElementById('event-toggle-btn')!;
let eventPanelOpen = false;
const carriedEl = document.getElementById('carried')!;
const tagCooldownEl = document.getElementById('tag-cooldown')!;
const timerEl = document.getElementById('timer')!;
const gameClockEl = document.getElementById('game-clock')!;
const seasonBadgeEl = document.getElementById('season-badge')!;

// Initialize season badge
{
  const SEASON_ICONS: Record<Season, string> = { winter: '\u2744', spring: '\u2740', summer: '\u2600', fall: '\u2741' };
  const SEASON_NAMES: Record<Season, string> = { winter: 'Winter', spring: 'Spring', summer: 'Summer', fall: 'Fall' };
  seasonBadgeEl.textContent = `${SEASON_ICONS[currentSeason]} ${SEASON_NAMES[currentSeason]}`;
  seasonBadgeEl.className = `season-badge ${currentSeason}`;
  // Update the Season leaderboard tab to show the season name
  const seasonTab = document.querySelector('.leaderboard-tab[data-type="season"]') as HTMLElement | null;
  if (seasonTab) seasonTab.textContent = `${SEASON_NAMES[currentSeason]}`;
}
const leaderboardEl = document.getElementById('leaderboard')!;
const connectionOverlayEl = document.getElementById('connection-overlay')!;
const howToPlayEl = document.getElementById('how-to-play')!;
const settingsBtnEl = document.getElementById('settings-btn')!;
const settingsPanelEl = document.getElementById('settings-panel')!;
const exitToLobbyBtnEl = document.getElementById('exit-to-lobby-btn')!;
const musicToggleEl = document.getElementById('music-toggle') as HTMLInputElement;
const sfxToggleEl = document.getElementById('sfx-toggle') as HTMLInputElement;
const shelterAdoptSfxToggleEl = document.getElementById('shelter-adopt-sfx-toggle') as HTMLInputElement;
const vanSoundSelectEl = document.getElementById('van-sound-select') as HTMLSelectElement;
const hideStraysToggleEl = document.getElementById('hide-strays-toggle') as HTMLInputElement;
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
const adoptSpeedBtnEl = document.getElementById('adopt-speed-btn')!;
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
const teamSelectEl = document.getElementById('team-select')!;
const teamRedBtnEl = document.getElementById('team-red-btn')!;
const teamBlueBtnEl = document.getElementById('team-blue-btn')!;
const teamScoreHudEl = document.getElementById('team-score-hud')!;
const teamScoreRedEl = document.getElementById('team-score-red')!;
const teamScoreBlueEl = document.getElementById('team-score-blue')!;
const observerOverlayEl = document.getElementById('observer-overlay')!;
const observerBackBtnEl = document.getElementById('observer-back-btn')!;

// Breeder Mini-Game Elements
const breederMinigameEl = document.getElementById('breeder-minigame')!;
const breederTimerEl = document.getElementById('breeder-timer')!;
const breederTokensEl = document.getElementById('breeder-tokens')!;
const breederPetsEl = document.getElementById('breeder-pets')!;
// Breeder Warning Popup Elements
const breederWarningPopupEl = document.getElementById('breeder-warning-popup')!;
const breederWarningTextEl = document.getElementById('breeder-warning-text')!;
const breederWarningStatsEl = document.getElementById('breeder-warning-stats')!;
const breederWarningContinueEl = document.getElementById('breeder-warning-continue')!;
const breederWarningRetreatEl = document.getElementById('breeder-warning-retreat')!;
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
const equipAdoptSpeedEl = document.getElementById('equip-adopt-speed')!;
const equipNoteEl = document.getElementById('equip-note')!;

// Karma Points Elements (shared across games)
const karmaDisplayEl = document.getElementById('karma-display')!;
const karmaPointsEl = document.getElementById('karma-points')!;

// Item Selection Modal Elements
const itemSelectOverlayEl = document.getElementById('item-select-overlay')!;
const itemSelectConfirmBtn = document.getElementById('item-select-confirm-btn')!;
const itemSelectSkipBtn = document.getElementById('item-select-skip-btn')!;

// Karma state (from server)
let currentKarmaPoints = 0;

// Item selection state
interface ItemSelection {
  portCharges: number;
  shelterPortCharges: number;
  speedBoosts: number;
  sizeBoosts: number;
  adoptSpeedBoosts: number;
  shelterTier3Boosts: number;
}
let pendingItemSelection: ItemSelection | null = null;

// Inventory state (from server)
interface Inventory {
  storedRt: number;
  portCharges: number;
  speedBoosts: number;
  sizeBoosts: number;
  adoptSpeedBoosts: number;
  shelterTier3Boosts?: number;
  signedIn: boolean;
}
let currentInventory: Inventory = { storedRt: 0, portCharges: 0, speedBoosts: 0, sizeBoosts: 0, adoptSpeedBoosts: 0, signedIn: false };

// In-match adopt speed boost state
let inMatchAdoptSpeedBoosts = 0;  // Number of boosts available in current match
let adoptSpeedActiveUntilTick = 0;  // Tick when current boost expires (0 = not active)
let adoptSpeedUsedSeconds = 0;  // Total seconds used this match (max 300)

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

// Pending breeder game state (for when warning popup is shown)
interface PendingBreederGame {
  petCount: number;
  level: number;
  opts: { isMill?: boolean; timeLimitSeconds?: number; addPetIntervalSeconds?: number };
}
let pendingBreederGame: PendingBreederGame | null = null;
let breederWarningVisible = false; // Track when warning popup is visible (blocks movement)

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

/** Calculate minimum RT needed to rescue all pets in a breeder camp/mill
 * Based on cheapest possible recipes per level:
 * - Level 1-2: 5 RT (seeds or apple for single ingredient)
 * - Level 3-5: 10 RT (seeds + apple = 10)
 * - Level 6-9: 30 RT (water + seeds + apple = 20+5+5)
 * - Level 10+: 50 RT (bowl + water + seeds + apple = 20+20+5+5)
 */
function getMinimumRTPerPet(level: number): number {
  if (level <= 2) return 5;   // Single cheapest ingredient
  if (level <= 5) return 10;  // seeds + apple
  if (level <= 9) return 30;  // water + seeds + apple
  return 50; // bowl + water + seeds + apple
}

function calculateMinimumRTNeeded(petCount: number, level: number): number {
  return petCount * getMinimumRTPerPet(level);
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

// Diverse adopter appearances: skin tones, hair, and clothing for adoption animations
interface AdopterAppearance {
  skin: string;
  skinStroke: string;
  hair: string;
  clothing: string;
  clothingStroke: string;
}
const ADOPTER_APPEARANCES: AdopterAppearance[] = [
  { skin: '#f5d5b8', skinStroke: '#c8a888', hair: '#6a4030', clothing: '#d4784a', clothingStroke: '#b05830' }, // light
  { skin: '#f0c8a0', skinStroke: '#c8a080', hair: '#4a3020', clothing: '#5a8ab0', clothingStroke: '#3a6a90' }, // light-medium
  { skin: '#c89060', skinStroke: '#a07048', hair: '#2a1a10', clothing: '#7a5a9a', clothingStroke: '#5a3a7a' }, // medium
  { skin: '#a06838', skinStroke: '#805028', hair: '#1a1010', clothing: '#c85050', clothingStroke: '#a03030' }, // medium-dark
  { skin: '#704020', skinStroke: '#503010', hair: '#0a0808', clothing: '#4aaa70', clothingStroke: '#2a8a50' }, // dark
  { skin: '#4a2a10', skinStroke: '#3a1a08', hair: '#050404', clothing: '#e0a040', clothingStroke: '#c08020' }, // very dark
  { skin: '#d4a878', skinStroke: '#b08858', hair: '#8a6040', clothing: '#6080c0', clothingStroke: '#4060a0' }, // olive/tan
  { skin: '#e8c498', skinStroke: '#c0a070', hair: '#c89050', clothing: '#50b0a0', clothingStroke: '#309080' }, // warm light (blonde)
];

// Adoption animation state: people walking away with adopted pets
interface AdoptionAnimation {
  id: string;
  startTime: number;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  /** Pet type (PET_TYPE_CAT etc.) so animation shows the actual adopted pet */
  petType: number;
  /** Direction the adopter walks away (radians) */
  walkAngle: number;
  /** True if bird — flies free instead of leash walk */
  isBird: boolean;
  /** Randomized appearance (skin tone, hair, clothing) */
  appearance: AdopterAppearance;
}
const adoptionAnimations: AdoptionAnimation[] = [];
const ADOPTION_ANIMATION_DURATION = 2500; // ms - walking away is slower and more cinematic
/** Emoji per pet type (PET_TYPE_CAT=0, DOG=1, BIRD=2, RABBIT=3, SPECIAL=4) */
const ADOPTION_PET_EMOJIS: Record<number, string> = {
  [PET_TYPE_CAT]: '🐈',
  [PET_TYPE_DOG]: '🐕',
  [PET_TYPE_BIRD]: '🐦',
  [PET_TYPE_RABBIT]: '🐰',
  [PET_TYPE_SPECIAL]: '⭐',
};
let adoptionAnimationId = 0;

/** Trigger adoption animation: people walk away from shelter/center with their pet. */
function triggerAdoptionAnimation(fromX: number, fromY: number, _toX: number, _toY: number, petTypes: number[]): void {
  const now = Date.now();
  const count = petTypes.length;
  for (let i = 0; i < count; i++) {
    const petType = petTypes[i] ?? PET_TYPE_CAT;
    const delay = i * 150; // stagger so people leave one at a time
    // Spread adopters evenly around the shelter with some jitter
    const baseAngle = (i / Math.max(1, count)) * Math.PI * 2;
    const jitter = (Math.random() - 0.5) * 0.8; // +/- 0.4 radians
    const walkAngle = baseAngle + jitter;
    // Walk 200px outward from shelter
    const walkDist = 180 + Math.random() * 40;
    const toX = fromX + Math.cos(walkAngle) * walkDist;
    const toY = fromY + Math.sin(walkAngle) * walkDist;
    const offsetX = (Math.random() - 0.5) * 15;
    const offsetY = (Math.random() - 0.5) * 15;
    adoptionAnimations.push({
      id: `adopt-${adoptionAnimationId++}`,
      startTime: now + delay,
      fromX: fromX + offsetX,
      fromY: fromY + offsetY,
      toX,
      toY,
      petType,
      walkAngle,
      isBird: petType === PET_TYPE_BIRD,
      appearance: ADOPTER_APPEARANCES[Math.floor(Math.random() * ADOPTER_APPEARANCES.length)],
    });
  }
}

type MatchPhase = 'lobby' | 'countdown' | 'playing';
let matchPhase: MatchPhase = 'playing';
let countdownRemainingSec = 0;
let readyCount = 0;
let iAmReady = false;
let isObserver = false;
let observerFollowIndex = 0;
const TOKENS_KEY = 'rescueworld_tokens';
const COLOR_KEY = 'rescueworld_color';
const UNLOCKED_COLORS_KEY = 'rescueworld_unlocked_colors';
// Base prices for speed and adopt speed boosts
const BOOST_PRICES = { speed: 30 } as const;

// Scaling prices for size boosts based on current pending size bonus
function getSizeBoostPrice(currentSizeBonus: number): number {
  if (currentSizeBonus < 5) return 50;
  if (currentSizeBonus < 10) return 80;
  if (currentSizeBonus < 15) return 120;
  if (currentSizeBonus < 20) return 160;
  if (currentSizeBonus < 30) return 250;
  if (currentSizeBonus < 40) return 350;
  return 1000; // 40-50
}
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
let currentMatchMode: 'ffa' | 'teams' | 'solo' = 'ffa'; // Actual mode from server (vs selectedMode which is UI state)
let selectedTeam: 'red' | 'blue' = 'red';
let hasSavedMatch = false;
const pendingBoosts = { sizeBonus: 0, speedBoost: false };  // adoptSpeed is now inventory-based
let currentDisplayName: string | null = null;
let isSignedIn = false;
let currentUserId: string | null = null;
let currentShelterColor: string | null = null;

// --- Friend/Foe relationships ---
type RelationshipType = 'friend' | 'foe';
const playerRelationships = new Map<string, RelationshipType>(); // targetUserId -> relationship
const playerRelationshipNames = new Map<string, string>(); // targetUserId -> displayName
// playerId (per-match) -> userId (persistent) mapping, populated from matchState/playerMap messages
const playerIdToUserId = new Map<string, string>();

async function fetchRelationships(): Promise<void> {
  if (!isSignedIn) return;
  try {
    const res = await fetch('/auth/relationships', { credentials: 'include' });
    if (!res.ok) return;
    const data = await res.json();
    playerRelationships.clear();
    playerRelationshipNames.clear();
    for (const r of data.relationships ?? []) {
      playerRelationships.set(r.targetUserId, r.relationship);
      playerRelationshipNames.set(r.targetUserId, r.displayName);
    }
  } catch {
    // ignore
  }
}

async function setPlayerRelationship(targetUserId: string, relationship: RelationshipType, displayName: string): Promise<boolean> {
  try {
    const res = await fetch('/auth/relationships', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ targetUserId, relationship }),
    });
    if (res.ok) {
      playerRelationships.set(targetUserId, relationship);
      playerRelationshipNames.set(targetUserId, displayName);
      return true;
    }
  } catch {
    // ignore
  }
  return false;
}

async function removePlayerRelationship(targetUserId: string): Promise<boolean> {
  try {
    const res = await fetch(`/auth/relationships/${encodeURIComponent(targetUserId)}`, {
      method: 'DELETE',
      credentials: 'include',
    });
    if (res.ok) {
      playerRelationships.delete(targetUserId);
      playerRelationshipNames.delete(targetUserId);
      return true;
    }
  } catch {
    // ignore
  }
  return false;
}

/** Get relationship for a player by their per-match playerId. */
function getRelationshipByPlayerId(playerId: string): RelationshipType | undefined {
  const userId = playerIdToUserId.get(playerId);
  if (!userId) return undefined;
  return playerRelationships.get(userId);
}

/** Get userId from playerId mapping. */
function getUserIdByPlayerId(playerId: string): string | undefined {
  return playerIdToUserId.get(playerId);
}

// --- Relationship context popup (used in lobby, leaderboard, fight/ally overlay) ---
let relPopupEl: HTMLDivElement | null = null;

function hideRelPopup(): void {
  if (relPopupEl) {
    relPopupEl.remove();
    relPopupEl = null;
  }
}

function showRelPopup(targetUserId: string, displayName: string, anchorX: number, anchorY: number): void {
  hideRelPopup();
  const current = playerRelationships.get(targetUserId);
  const popup = document.createElement('div');
  popup.className = 'rel-popup';
  // Position off-screen first so we can measure, then clamp into viewport
  popup.style.left = '0px';
  popup.style.top = '0px';
  popup.style.visibility = 'hidden';
  
  let html = `<div class="rel-popup-name">${escapeHtml(displayName)}</div><div class="rel-popup-actions">`;
  if (current !== 'friend') {
    html += `<button class="rel-popup-btn rel-popup-friend" data-action="friend">Mark Friend</button>`;
  }
  if (current !== 'foe') {
    html += `<button class="rel-popup-btn rel-popup-foe" data-action="foe">Mark Foe</button>`;
  }
  if (current) {
    html += `<button class="rel-popup-btn rel-popup-remove" data-action="remove">Remove</button>`;
  }
  html += `</div>`;
  popup.innerHTML = html;
  
  popup.addEventListener('click', async (e) => {
    const btn = (e.target as HTMLElement).closest('[data-action]') as HTMLElement | null;
    if (!btn) return;
    const action = btn.dataset.action;
    if (action === 'friend' || action === 'foe') {
      const ok = await setPlayerRelationship(targetUserId, action, displayName);
      if (ok) showToast(`Marked ${displayName} as ${action}`, 'success');
    } else if (action === 'remove') {
      const ok = await removePlayerRelationship(targetUserId);
      if (ok) showToast(`Removed mark for ${displayName}`, 'info');
    }
    hideRelPopup();
  });
  
  document.body.appendChild(popup);
  // Clamp popup within viewport so it doesn't go off-screen on mobile
  const popupRect = popup.getBoundingClientRect();
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  let px = anchorX;
  let py = anchorY;
  // If it would overflow right edge, move to left of anchor
  if (px + popupRect.width > vw - 8) {
    px = Math.max(8, anchorX - popupRect.width - 16);
  }
  // Clamp vertically
  if (py + popupRect.height > vh - 8) {
    py = Math.max(8, vh - popupRect.height - 8);
  }
  popup.style.left = `${px}px`;
  popup.style.top = `${py}px`;
  popup.style.visibility = 'visible';
  relPopupEl = popup;
  
  // Close on click outside
  setTimeout(() => {
    const closeHandler = (ev: MouseEvent) => {
      if (relPopupEl && !relPopupEl.contains(ev.target as Node)) {
        hideRelPopup();
        document.removeEventListener('click', closeHandler);
      }
    };
    document.addEventListener('click', closeHandler);
  }, 0);
}

// --- Friends panel ---
function renderFriendsPanel(): void {
  const listEl = document.getElementById('friends-list');
  if (!listEl) return;
  
  const friends: Array<{ userId: string; name: string }> = [];
  const foes: Array<{ userId: string; name: string }> = [];
  
  for (const [userId, rel] of playerRelationships) {
    const name = playerRelationshipNames.get(userId) ?? 'Unknown';
    if (rel === 'friend') friends.push({ userId, name });
    else foes.push({ userId, name });
  }
  
  let html = '';
  if (friends.length > 0) {
    html += '<div class="friends-section"><h4 class="friends-section-title friends-title">Friends</h4>';
    for (const f of friends) {
      html += `<div class="friends-row">
        <span class="rel-dot rel-dot-friend"></span>
        <span class="friends-name">${escapeHtml(f.name)}</span>
        <button class="friends-remove-btn" data-user-id="${escapeHtml(f.userId)}" title="Remove">&#10005;</button>
      </div>`;
    }
    html += '</div>';
  }
  if (foes.length > 0) {
    html += '<div class="friends-section"><h4 class="friends-section-title foes-title">Foes</h4>';
    for (const f of foes) {
      html += `<div class="friends-row">
        <span class="rel-dot rel-dot-foe"></span>
        <span class="friends-name">${escapeHtml(f.name)}</span>
        <button class="friends-remove-btn" data-user-id="${escapeHtml(f.userId)}" title="Remove">&#10005;</button>
      </div>`;
    }
    html += '</div>';
  }
  if (friends.length === 0 && foes.length === 0) {
    html = '<p class="friends-empty">No friends or foes marked yet. Click on a player in the lobby or match results to mark them.</p>';
  }
  listEl.innerHTML = html;
  
  // Attach remove handlers
  listEl.querySelectorAll('.friends-remove-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const userId = (btn as HTMLElement).dataset.userId;
      if (!userId) return;
      await removePlayerRelationship(userId);
      renderFriendsPanel();
      showToast('Relationship removed', 'info');
    });
  });
}

function showFriendsPanel(): void {
  const panel = document.getElementById('friends-panel');
  if (panel) {
    panel.classList.remove('hidden');
    renderFriendsPanel();
  }
}

function hideFriendsPanel(): void {
  const panel = document.getElementById('friends-panel');
  if (panel) panel.classList.add('hidden');
}

// Wire up friends panel button and close
document.getElementById('friends-panel-btn')?.addEventListener('click', () => showFriendsPanel());
document.getElementById('friends-panel-close')?.addEventListener('click', () => hideFriendsPanel());

// Expose for inline onclick in lobby player list and leaderboard HTML
(window as any).__showRelPopup = (e: MouseEvent) => {
  const target = e.target as HTMLElement;
  // Try both lobby-player container and rel-mark-btn (leaderboard)
  const el = target.closest('[data-user-id]') as HTMLElement | null;
  if (!el) return;
  const userId = el.dataset.userId;
  const displayName = el.dataset.displayName;
  if (!userId || !displayName) return;
  e.stopPropagation();
  const rect = el.getBoundingClientRect();
  showRelPopup(userId, displayName, rect.right + 8, rect.top);
};

// Track active FFA/Teams match for rejoin
interface ActiveMultiplayerMatch {
  matchId: string;
  mode: 'ffa' | 'teams';
  durationMs: number;
  isPaused: boolean;
  botsEnabled?: boolean;
  fetchedAt: number;
}
let activeMultiplayerMatches: ActiveMultiplayerMatch[] = [];
const ACTIVE_MP_MATCHES_KEY = 'rescueworld_active_mp_matches';
const MAX_SIMULTANEOUS_MATCHES = 5;

// Clock update interval for real-time display
let matchClockInterval: number | null = null;
// Polling interval for match status sync
let matchPollInterval: number | null = null;

function getActiveMultiplayerMatches(): ActiveMultiplayerMatch[] {
  try {
    const stored = localStorage.getItem(ACTIVE_MP_MATCHES_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      if (Array.isArray(parsed)) {
        return parsed.filter((m: ActiveMultiplayerMatch) => m.matchId && (m.mode === 'ffa' || m.mode === 'teams'));
      }
    }
  } catch { /* ignore */ }
  return [];
}

function setActiveMultiplayerMatches(matches: ActiveMultiplayerMatch[]): void {
  activeMultiplayerMatches = matches;
  if (matches.length > 0) {
    localStorage.setItem(ACTIVE_MP_MATCHES_KEY, JSON.stringify(matches));
  } else {
    localStorage.removeItem(ACTIVE_MP_MATCHES_KEY);
  }
}

/** Add a match to the active matches list (when exiting to lobby) */
function addActiveMultiplayerMatch(match: Omit<ActiveMultiplayerMatch, 'fetchedAt'>): void {
  const existing = activeMultiplayerMatches.filter(m => m.matchId !== match.matchId);
  existing.push({ ...match, fetchedAt: Date.now() });
  setActiveMultiplayerMatches(existing);
}

/** Remove a match from the active matches list */
function removeActiveMultiplayerMatch(matchId: string): void {
  const filtered = activeMultiplayerMatches.filter(m => m.matchId !== matchId);
  setActiveMultiplayerMatches(filtered);
}

/** Clear all active matches (backward compatibility) */
function setActiveMultiplayerMatch(match: { matchId: string; mode: 'ffa' | 'teams' } | null): void {
  if (match) {
    addActiveMultiplayerMatch({ matchId: match.matchId, mode: match.mode, durationMs: 0, isPaused: false });
  } else {
    setActiveMultiplayerMatches([]);
  }
}

/** Fetch all active matches from server and update UI */
async function fetchActiveMatchesInfo(): Promise<void> {
  if (!currentUserId) {
    setActiveMultiplayerMatches([]);
    return;
  }
  try {
    const res = await fetch('/api/active-matches', { credentials: 'include' });
    const data = await res.json();
    if (data.matches && Array.isArray(data.matches)) {
      const now = Date.now();
      const matches: ActiveMultiplayerMatch[] = data.matches.map((m: { matchId: string; mode: 'ffa' | 'teams'; durationMs: number; isPaused: boolean; botsEnabled?: boolean }) => ({
        matchId: m.matchId,
        mode: m.mode,
        durationMs: m.durationMs,
        isPaused: m.isPaused,
        botsEnabled: m.botsEnabled,
        fetchedAt: now,
      }));
      setActiveMultiplayerMatches(matches);
    } else {
      setActiveMultiplayerMatches([]);
    }
  } catch { /* ignore */ }
  updateMatchListDisplay();
  updateResumeMatchUI();
}

/** Backward compatibility alias */
async function fetchActiveMatchInfo(): Promise<void> {
  return fetchActiveMatchesInfo();
}

/** Start real-time clock updates (every second) */
function startMatchClockUpdates(): void {
  if (matchClockInterval) return;
  matchClockInterval = window.setInterval(() => {
    updateMatchListDisplay();
  }, 1000);
}

/** Stop real-time clock updates */
function stopMatchClockUpdates(): void {
  if (matchClockInterval) {
    clearInterval(matchClockInterval);
    matchClockInterval = null;
  }
}

/** Start polling for match status updates (every 30 seconds) */
function startMatchPolling(): void {
  if (matchPollInterval) return;
  matchPollInterval = window.setInterval(() => {
    fetchActiveMatchesInfo();
  }, 30000);
}

/** Stop polling for match status */
function stopMatchPolling(): void {
  if (matchPollInterval) {
    clearInterval(matchPollInterval);
    matchPollInterval = null;
  }
}

/** Format duration in mm:ss */
function formatMatchDuration(ms: number): string {
  const totalSecs = Math.floor(ms / 1000);
  const mins = Math.floor(totalSecs / 60);
  const secs = totalSecs % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

/** Update the match list display with current times */
function updateMatchListDisplay(): void {
  const container = document.getElementById('active-matches-container');
  const list = document.getElementById('active-matches-list');
  if (!container || !list) return;
  
  // Filter matches for current selected mode (or show all)
  const matchesToShow = activeMultiplayerMatches;
  
  if (matchesToShow.length === 0) {
    container.classList.add('hidden');
    return;
  }
  
  container.classList.remove('hidden');
  
  // Build HTML for each match
  const now = Date.now();
  const html = matchesToShow.map(match => {
    // Calculate current duration
    let currentDurationMs = match.durationMs;
    if (!match.isPaused && match.fetchedAt) {
      currentDurationMs += now - match.fetchedAt;
    }
    const timeStr = formatMatchDuration(currentDurationMs);
    const shortId = getShortMatchId(match.matchId);
    const pausedBadge = match.isPaused ? '<span class="match-paused">PAUSED</span>' : '';
    const botsBadge = match.botsEnabled ? '<span class="match-bots-badge">w/bots</span>' : '';
    
    return `<div class="active-match-item" data-match-id="${match.matchId}" data-mode="${match.mode}">
      <div class="match-info">
        <span class="match-mode">${match.mode.toUpperCase()}</span>
        <span class="match-id">${shortId}</span>
        ${botsBadge}
        ${pausedBadge}
      </div>
      <span class="match-time">${timeStr}</span>
    </div>`;
  }).join('');
  
  list.innerHTML = html;
  
  // Add click handlers
  list.querySelectorAll('.active-match-item').forEach(item => {
    item.addEventListener('click', () => {
      const matchId = (item as HTMLElement).dataset.matchId;
      const mode = (item as HTMLElement).dataset.mode as 'ffa' | 'teams';
      if (matchId && mode) {
        rejoinMatch(matchId, mode);
      }
    });
  });
}

/** Rejoin a specific match */
function rejoinMatch(matchId: string, mode: 'ffa' | 'teams'): void {
  startConnect({ mode, rejoinMatchId: matchId });
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

// Auto-reconnect state for unexpected disconnects (mobile sleep, network blip)
const MAX_RECONNECT_ATTEMPTS = 3;
const RECONNECT_BASE_DELAY_MS = 1500;
let matchDisconnectInfo: { matchId: string; mode: 'ffa' | 'teams' | 'solo'; attempts: number } | null = null;
let matchEndedNormally = false; // Set true when match ends via matchOver/elimination, prevents auto-reconnect
let reconnectTimeoutId: number | null = null;

/** Format number for human-readable display (1K, 1.1K, 252.2K, 3M, etc.) */
function formatNumber(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1000000) {
    const k = n / 1000;
    return k >= 100 ? `${Math.round(k)}K` : k >= 10 ? `${k.toFixed(1).replace(/\.0$/, '')}K` : `${k.toFixed(2).replace(/\.?0+$/, '')}K`;
  }
  const m = n / 1000000;
  return m >= 100 ? `${Math.round(m)}M` : m >= 10 ? `${m.toFixed(1).replace(/\.0$/, '')}M` : `${m.toFixed(2).replace(/\.?0+$/, '')}M`;
}

function getTokens(): number {
  return parseInt(localStorage.getItem(TOKENS_KEY) || '0', 10);
}
function setTokens(n: number): void {
  localStorage.setItem(TOKENS_KEY, String(Math.max(0, n)));
}
function updateLandingTokens(): void {
  // Use server inventory for both signed-in and guests; fall back to localStorage for guests with no server data
  const serverRt = currentInventory.storedRt ?? 0;
  const tokens = isSignedIn ? serverRt : (serverRt > 0 ? serverRt : getTokens());
  
  // Update equipment panel RT display with human-readable format
  const equipRt = document.getElementById('equip-rt');
  if (equipRt) equipRt.textContent = formatNumber(tokens);
  
  // Update pending size boost display
  const equipSize = document.getElementById('equip-size');
  if (equipSize) equipSize.textContent = pendingBoosts.sizeBonus > 0 ? `+${pendingBoosts.sizeBonus}` : '0';
  
  // Update size boost button with dynamic price
  const sizeBtn = document.getElementById('buy-size-btn') as HTMLButtonElement | null;
  if (sizeBtn) {
    const sizePrice = getSizeBoostPrice(pendingBoosts.sizeBonus);
    sizeBtn.textContent = `Buy +1 Size (${sizePrice} RT)`;
    sizeBtn.disabled = tokens < sizePrice || pendingBoosts.sizeBonus >= 50;
  }
  
  // Update other boost buttons
  document.querySelectorAll('.landing-buy').forEach((btn) => {
    const b = (btn as HTMLElement).dataset.boost;
    if (b === 'size') return; // Handled above
    if (b === 'speed') {
      (btn as HTMLButtonElement).disabled = tokens < BOOST_PRICES.speed || pendingBoosts.speedBoost;
    }
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

/** Update adopt speed button visibility and state */
function updateAdoptSpeedButton(): void {
  const me = latestSnapshot?.players.find((pl) => pl.id === myPlayerId);
  const isEliminated = me?.eliminated || !me;
  
  // Check if adopt speed boost is currently active (based on tick)
  const currentTick = latestSnapshot?.tick ?? 0;
  const isActive = currentTick < adoptSpeedActiveUntilTick;
  
  if (me && (inMatchAdoptSpeedBoosts > 0 || isActive) && !isEliminated && matchPhase === 'playing') {
    if (isActive) {
      const remainingTicks = adoptSpeedActiveUntilTick - currentTick;
      const remainingSeconds = Math.ceil(remainingTicks / 25);  // 25 ticks per second
      adoptSpeedBtnEl.textContent = `Adopt Speed ${remainingSeconds}s (${inMatchAdoptSpeedBoosts})`;
      adoptSpeedBtnEl.classList.add('active');
    } else {
      adoptSpeedBtnEl.textContent = `Adopt Speed [B] (${inMatchAdoptSpeedBoosts})`;
      adoptSpeedBtnEl.classList.remove('active');
    }
    adoptSpeedBtnEl.classList.remove('hidden');
  } else {
    adoptSpeedBtnEl.classList.add('hidden');
    adoptSpeedBtnEl.classList.remove('active');
  }
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
    // Hide match list for solo
    const container = document.getElementById('active-matches-container');
    if (container) container.classList.add('hidden');
    return;
  }
  
  // Load matches from storage if needed
  if (activeMultiplayerMatches.length === 0) {
    activeMultiplayerMatches = getActiveMultiplayerMatches();
  }
  
  // Update the match list display
  updateMatchListDisplay();
  
  // Check if user has active FFA/Teams matches
  const matchesForMode = activeMultiplayerMatches.filter(m => m.mode === selectedMode);
  const hasActiveMatches = matchesForMode.length > 0;
  const atMaxMatches = activeMultiplayerMatches.length >= MAX_SIMULTANEOUS_MATCHES;
  
  // Hide the single resume button - we now use the match list
  resumeBtn.classList.add('hidden');
  
  // Update play button text
  if (atMaxMatches) {
    playBtn.textContent = 'Max Matches (5)';
    (playBtn as HTMLButtonElement).disabled = true;
  } else if (hasActiveMatches) {
    playBtn.textContent = 'Start New Match';
    (playBtn as HTMLButtonElement).disabled = false;
  } else {
    playBtn.textContent = 'Play';
    (playBtn as HTMLButtonElement).disabled = false;
  }
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
  await fetchRelationships();
  // Show/hide friends panel button based on sign-in status
  const friendsPanelBtn = document.getElementById('friends-panel-btn');
  if (friendsPanelBtn) {
    if (isSignedIn) friendsPanelBtn.classList.remove('hidden');
    else friendsPanelBtn.classList.add('hidden');
  }
  await fetchReferralInfo();
  updateReferralUI();
  await fetchDailyGiftStatus();
  await fetchSavedMatchStatus();
  await fetchActiveMatchesInfo();
  
  // Start real-time clock updates and polling for active matches
  startMatchClockUpdates();
  startMatchPolling();
  
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
    // Guest - persist via cookie
    try {
      const res = await fetch('/auth/guest/name', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ nickname }),
      });
      const data = await res.json();
      if (data.success) {
        currentDisplayName = data.displayName;
        if (data.guestId && !currentUserId) {
          currentUserId = data.guestId;
        }
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
        if (nickHintEl) nickHintEl.textContent = 'Sign in to save permanently';
      }
    } catch {
      if (nickHintEl) nickHintEl.textContent = 'Failed to save';
    }
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
    } else if (!isSignedIn) {
      // Save guest nickname and ensure we have a guest_id for rejoin
      try {
        const res = await fetch('/auth/guest/name', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ nickname: nickInput }),
        });
        const data = await res.json();
        if (data.guestId && !currentUserId) {
          currentUserId = data.guestId;
        }
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
      // Set guest ID so the server can track this player for rejoin
      if (data.guestId && !currentUserId) {
        currentUserId = data.guestId;
      }
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
  // PixiJS handles canvas resizing via its own resize listener (resizeTo: window).
  // No manual canvas dimension update needed.
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
  
  // Block movement during breeder mini-game or warning popup
  if (breederGame.active || breederWarningVisible) {
    e.preventDefault();
    return;
  }
  
  // Full spectator mode: cycle players with left/right arrows
  if (isObserver) {
    if (e.code === 'ArrowRight' || e.code === 'KeyD') {
      observerFollowIndex++;
    } else if (e.code === 'ArrowLeft' || e.code === 'KeyA') {
      observerFollowIndex = Math.max(0, observerFollowIndex - 1);
    }
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
  
  // Block movement during breeder mini-game or warning popup
  if (breederGame.active || breederWarningVisible) {
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
  
  // Block joystick movement during breeder mini-game or warning popup
  if (breederGame.active || breederWarningVisible) {
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
    observerCameraX = Math.max(pixiScreenW / 2, Math.min(MAP_WIDTH - pixiScreenW / 2, observerCameraX));
    observerCameraY = Math.max(pixiScreenH / 2, Math.min(MAP_HEIGHT - pixiScreenH / 2, observerCameraY));
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

// --- Click/Tap on other shelters to send ally request (disabled in Teams mode) ---
function handleAllyRequestAtPosition(screenX: number, screenY: number): void {
  if (selectedMode === 'teams') return; // Teams mode: alliances are automatic
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
  const scaleX = pixiScreenW / rect.width;
  const scaleY = pixiScreenH / rect.height;
  const screenX = (e.clientX - rect.left) * scaleX;
  const screenY = (e.clientY - rect.top) * scaleY;
  
  // Convert screen to world coordinates for boss mill check
  const cam = getCamera();
  const worldX = cam.x + screenX;
  const worldY = cam.y + screenY;
  
  // Check for boss mill click first (in solo boss mode)
  if (latestSnapshot.bossMode?.active && checkBossMillClick(worldX, worldY)) {
    return; // Handled by boss mill modal
  }
  
  handleAllyRequestAtPosition(screenX, screenY);
});

// Mobile touch support for ally requests
canvas.addEventListener('touchend', (e) => {
  if (!latestSnapshot || !myPlayerId || !gameWs || gameWs.readyState !== WebSocket.OPEN) return;
  // Only process single-finger taps (not joystick gestures)
  if (e.changedTouches.length !== 1) return;
  const touch = e.changedTouches[0];
  const rect = canvas.getBoundingClientRect();
  const scaleX = pixiScreenW / rect.width;
  const scaleY = pixiScreenH / rect.height;
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
  const w = pixiScreenW;
  const h = pixiScreenH;
  
  // Check if player is eliminated (observer mode) or full spectator
  const me = latestSnapshot?.players.find((p) => p.id === myPlayerId);
  const isEliminated = me?.eliminated === true;
  
  if (isObserver) {
    // Full spectator mode: follow a player by index
    const players = latestSnapshot?.players.filter(p => !p.eliminated) ?? [];
    if (players.length > 0) {
      const idx = observerFollowIndex % players.length;
      const target = players[idx];
      observerCameraX = target.x;
      observerCameraY = target.y;
    }
    const camX = Math.max(0, Math.min(MAP_WIDTH - w, observerCameraX - w / 2));
    const camY = Math.max(0, Math.min(MAP_HEIGHT - h, observerCameraY - h / 2));
    return { x: camX, y: camY, w, h };
  }
  
  if (isEliminated) {
    // Eliminated observer mode: free camera panning
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
  const w = pixiScreenW;
  const h = pixiScreenH;
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

// --- Auto-reconnect for unexpected disconnects ---
function attemptAutoReconnect(): void {
  if (!matchDisconnectInfo) return;
  
  const info = matchDisconnectInfo;
  info.attempts++;
  
  if (info.attempts > MAX_RECONNECT_ATTEMPTS) {
    // Give up — return to lobby and let user manually rejoin from match list
    matchDisconnectInfo = null;
    connectionOverlayEl.classList.add('hidden');
    gameWrapEl.classList.remove('visible');
    landingEl.classList.remove('hidden');
    authAreaEl.classList.remove('hidden');
    exitMobileFullscreen();
    
    // Add match to the active list for manual rejoin
    if (currentUserId || isSignedIn) {
      addActiveMultiplayerMatch({
        matchId: info.matchId,
        mode: info.mode as 'ffa' | 'teams',
        durationMs: 0,
        isPaused: false,
      });
    }
    currentMatchId = null;
    updateResumeMatchUI();
    startMatchClockUpdates();
    startMatchPolling();
    fetchActiveMatchesInfo();
    connectLobbyLeaderboard();
    startServerClockWhenOnLobby();
    startGameStatsPolling();
    showToast('Disconnected. You can rejoin from the match list.', 'info');
    return;
  }
  
  // Show reconnecting overlay
  connectionOverlayEl.classList.remove('hidden');
  connectionOverlayEl.innerHTML = `<h2>Reconnecting\u2026</h2><p>Attempt ${info.attempts} of ${MAX_RECONNECT_ATTEMPTS}</p>`;
  gameWrapEl.classList.add('visible');
  landingEl.classList.add('hidden');
  
  connect({ mode: info.mode, rejoinMatchId: info.matchId })
    .then(() => {
      // Success — clear disconnect info
      matchDisconnectInfo = null;
      connectionOverlayEl.classList.add('hidden');
      gameWrapEl.classList.add('visible');
      requestAnimationFrame(tick);
    })
    .catch(() => {
      // Retry with exponential backoff
      const delay = RECONNECT_BASE_DELAY_MS * Math.pow(2, info.attempts - 1);
      reconnectTimeoutId = window.setTimeout(() => {
        reconnectTimeoutId = null;
        attemptAutoReconnect();
      }, delay);
    });
}

function cancelAutoReconnect(): void {
  matchDisconnectInfo = null;
  if (reconnectTimeoutId !== null) {
    clearTimeout(reconnectTimeoutId);
    reconnectTimeoutId = null;
  }
}

// --- Connect flow ---
async function connect(options?: { latency?: number; mode?: 'ffa' | 'teams' | 'solo'; abandon?: boolean; rejoinMatchId?: string }): Promise<void> {
  matchEndedNormally = false;
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
    // NOTE: Don't withdraw inventory here! The server withdraws it after validating the match.
    // This prevents inventory loss if the player tries to resume an expired match.
    // For guests: send localStorage RT as fallback (server prefers inventory, falls back to this)
    const guestRt = !isSignedIn ? Math.min(getTokens(), MAX_RT_PER_MATCH) : undefined;
    gameWs.send(JSON.stringify({ 
      type: 'mode', 
      mode: options?.mode ?? 'ffa', 
      displayName,
      userId: currentUserId, // For inventory tracking - server will withdraw
      abandon: options?.abandon,
      rejoinMatchId: options?.rejoinMatchId,
      botsEnabled: (options?.mode === 'ffa' || options?.mode === 'teams') ? botsEnabled : undefined,
      team: options?.mode === 'teams' ? selectedTeam : undefined,
      guestStartingRt: guestRt,
    }));
    // Clear guest localStorage RT only for NEW matches (not rejoins).
    // On rejoin, the server reconnects to the existing player without withdrawing from inventory,
    // so clearing localStorage would lose the RT.
    if (!isSignedIn && guestRt && guestRt > 0 && !options?.rejoinMatchId) {
      setTokens(0);
    }
    if (pendingBoosts.sizeBonus > 0 || pendingBoosts.speedBoost) {
      gameWs.send(JSON.stringify({
        type: 'startingBoosts',
        sizeBonus: pendingBoosts.sizeBonus,
        speedBoost: pendingBoosts.speedBoost,
      }));
      pendingBoosts.sizeBonus = 0;
      pendingBoosts.speedBoost = false;
    }
    // Send selected equipment items (from item selection modal)
    // Both signed-in users and guests use server-side inventory withdrawal
    if (pendingItemSelection) {
      gameWs.send(JSON.stringify({
        type: 'selectedItems',
        portCharges: pendingItemSelection.portCharges,
        shelterPortCharges: pendingItemSelection.shelterPortCharges,
        speedBoosts: pendingItemSelection.speedBoosts,
        sizeBoosts: pendingItemSelection.sizeBoosts,
        adoptSpeedBoosts: pendingItemSelection.adoptSpeedBoosts,
        shelterTier3Boosts: pendingItemSelection.shelterTier3Boosts,
      }));
      pendingItemSelection = null;
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
        if (msg.type === 'pendingNoBots' && typeof msg.mode === 'string') {
          // Server found a no-bots lobby with waiting players — prompt user
          const modeLabel = msg.mode === 'teams' ? 'Teams' : 'FFA';
          const textEl = document.getElementById('join-nobots-text');
          if (textEl) {
            const count = typeof msg.playerCount === 'number' ? msg.playerCount : 1;
            textEl.textContent = `There's a ${modeLabel} match pending with no bots — ${count} player${count > 1 ? 's' : ''} waiting! Join them?`;
          }
          const popup = document.getElementById('join-nobots-popup');
          if (popup) popup.classList.remove('hidden');
          // Hide connecting overlay while prompt is shown
          connectionOverlayEl.classList.add('hidden');
          landingEl.classList.remove('hidden');
          
          const joinBtn = document.getElementById('join-nobots-btn');
          const skipBtn = document.getElementById('skip-nobots-btn');
          const wsRef = gameWsLocal;
          
          const cleanup = () => {
            if (popup) popup.classList.add('hidden');
            joinBtn?.removeEventListener('click', onJoin);
            skipBtn?.removeEventListener('click', onSkip);
          };
          const onJoin = () => {
            cleanup();
            landingEl.classList.add('hidden');
            connectionOverlayEl.classList.remove('hidden');
            connectionOverlayEl.innerHTML = '<h2>Joining…</h2><p>Joining the match lobby.</p>';
            if (wsRef.readyState === WebSocket.OPEN) {
              wsRef.send(JSON.stringify({ type: 'joinNoBotsResponse', join: true }));
            }
          };
          const onSkip = () => {
            cleanup();
            landingEl.classList.add('hidden');
            connectionOverlayEl.classList.remove('hidden');
            connectionOverlayEl.innerHTML = '<h2>Connecting…</h2><p>Starting match with bots.</p>';
            if (wsRef.readyState === WebSocket.OPEN) {
              wsRef.send(JSON.stringify({ type: 'joinNoBotsResponse', join: false }));
            }
          };
          joinBtn?.addEventListener('click', onJoin);
          skipBtn?.addEventListener('click', onSkip);
          return;
        }
        if (msg.type === 'welcome' && msg.playerId) {
          myPlayerId = msg.playerId;
          playerIdToUserId.clear(); // Reset mapping for new match
          // Track actual match mode from server
          if (msg.mode === 'ffa' || msg.mode === 'teams' || msg.mode === 'solo') {
            currentMatchMode = msg.mode;
          } else {
            currentMatchMode = selectedMode; // Fallback to selectedMode
          }
          // Initialize in-match boost state
          inMatchAdoptSpeedBoosts = typeof msg.adoptSpeedBoosts === 'number' ? msg.adoptSpeedBoosts : 0;
          adoptSpeedActiveUntilTick = typeof msg.adoptSpeedActiveUntilTick === 'number' ? msg.adoptSpeedActiveUntilTick : 0;
          adoptSpeedUsedSeconds = typeof msg.adoptSpeedUsedSeconds === 'number' ? msg.adoptSpeedUsedSeconds : 0;
          // Server withdrew RT (capped) - update client state to reflect remaining inventory
          if (isSignedIn && !msg.resumed) {
            if (msg.remainingInventory) {
              currentInventory = {
                storedRt: msg.remainingInventory.storedRt ?? 0,
                portCharges: msg.remainingInventory.portCharges ?? 0,
                speedBoosts: msg.remainingInventory.speedBoosts ?? 0,
                sizeBoosts: msg.remainingInventory.sizeBoosts ?? 0,
                adoptSpeedBoosts: msg.remainingInventory.adoptSpeedBoosts ?? 0,
                shelterTier3Boosts: msg.remainingInventory.shelterTier3Boosts ?? 0,
                signedIn: true,
              };
            } else {
              currentInventory = { storedRt: 0, portCharges: 0, speedBoosts: 0, sizeBoosts: 0, adoptSpeedBoosts: 0, signedIn: true };
            }
            updateEquipmentPanel();
          }
          // Show toast for starting RT from chest (if not resuming)
          if (!msg.resumed && typeof msg.startingRT === 'number' && msg.startingRT > 0) {
            showToast(`Starting with ${msg.startingRT} RT from chest!`, 'success');
          }
          // Track current matchId for FFA/Teams rejoin capability
          if (msg.matchId && (currentMatchMode === 'ffa' || currentMatchMode === 'teams')) {
            // If resumed, remove this match from pending list (we're back in it)
            if (msg.resumed) {
              removeActiveMultiplayerMatch(msg.matchId);
              showToast(`Rejoined match ${getShortMatchId(msg.matchId)}!`, 'success');
            }
            // Store current match info for potential rejoin later
            currentMatchId = msg.matchId;
          }
          isObserver = false;
          observerOverlayEl.classList.add('hidden');
          playWelcome();
        }
        if (msg.type === 'observing') {
          isObserver = true;
          myPlayerId = null; // observer has no player entity
          observerFollowIndex = 0;
          currentMatchId = msg.matchId ?? null;
          observerOverlayEl.classList.remove('hidden');
          lobbyOverlayEl.classList.add('hidden');
        }
        if (msg.type === 'promoted') {
          // Observer promoted to player
          isObserver = false;
          myPlayerId = msg.playerId;
          observerOverlayEl.classList.add('hidden');
          showToast('A slot opened! You are now playing.', 'success');
        }
        if (msg.type === 'savedMatchExpired') {
          hasSavedMatch = false;
          updateResumeMatchUI();
          fetchSavedMatchStatus();
          fetchActiveMatchesInfo(); // Will refresh the match list from server
          const reason = typeof msg.reason === 'string' ? msg.reason : 'Match already ended';
          showToast(reason, 'info');
          cancelAutoReconnect();
          currentMatchId = null;
          if (gameWs) {
            gameWs.close();
            gameWs = null;
          }
          // Return to lobby
          myPlayerId = null;
          latestSnapshot = null;
          leaderboardEl.classList.remove('show');
          matchEndPlayed = false;
          matchEndTokensAwarded = false;
          matchEndWasStrayLoss = false;
          clearAnnouncements();
          gameWrapEl.classList.remove('visible');
          landingEl.classList.remove('hidden');
          authAreaEl.classList.remove('hidden');
          exitMobileFullscreen();
          updateLandingTokens();
          restoreModeSelection();
          connectionOverlayEl?.classList.add('hidden');
          startServerClockWhenOnLobby();
          connectLobbyLeaderboard();
          startGameStatsPolling();
        }
        if (msg.type === 'serverShutdown') {
          const baseMessage = typeof msg.message === 'string' ? msg.message : 'Server is updating. Your progress has been saved.';
          // Show countdown message with reload button
          let countdown = 7;
          const updateShutdownToast = () => {
            const reloadBtn = `<button onclick="location.reload()" style="margin-left:8px;padding:4px 12px;background:#3b82f6;color:#fff;border:none;border-radius:4px;cursor:pointer;font-weight:600;">Reload Now</button>`;
            showToast(`${baseMessage}<br><span style="font-size:12px;opacity:0.8;">Auto-reloading in ${countdown}s...</span>${reloadBtn}`, 'info', true);
          };
          updateShutdownToast();
          const shutdownInterval = setInterval(() => {
            countdown--;
            if (countdown <= 0) {
              clearInterval(shutdownInterval);
              location.reload();
            } else {
              updateShutdownToast();
            }
          }, 1000);
          cancelAutoReconnect();
          currentMatchId = null;
          if (gameWs) {
            gameWs.close();
            gameWs = null;
          }
          myPlayerId = null;
          latestSnapshot = null;
          leaderboardEl.classList.remove('show');
          matchEndPlayed = false;
          matchEndTokensAwarded = false;
          matchEndWasStrayLoss = false;
          clearAnnouncements();
          gameWrapEl.classList.remove('visible');
          landingEl.classList.remove('hidden');
          authAreaEl.classList.remove('hidden');
          exitMobileFullscreen();
          updateLandingTokens();
          restoreModeSelection();
          updateResumeMatchUI();
          fetchSavedMatchStatus();
          fetchActiveMatchesInfo(); // Refresh match list from server
          startMatchClockUpdates();
          startMatchPolling();
          connectionOverlayEl?.classList.add('hidden');
          startServerClockWhenOnLobby();
          connectLobbyLeaderboard();
        }
        // Handle playerMap message (playerId -> userId mapping for friend/foe)
        if (msg.type === 'playerMap' && Array.isArray(msg.players)) {
          for (const p of msg.players) {
            if (p.userId) playerIdToUserId.set(p.playerId, p.userId);
          }
        }
        // Handle friendOnline notification
        if (msg.type === 'friendOnline' && typeof msg.displayName === 'string') {
          showToast(`Your friend ${msg.displayName} is now online!`, 'success');
        }
        if (msg.type === 'matchState' && typeof msg.phase === 'string') {
          matchPhase = msg.phase as MatchPhase;
          countdownRemainingSec = typeof msg.countdownRemainingSec === 'number' ? msg.countdownRemainingSec : 0;
          readyCount = typeof msg.readyCount === 'number' ? msg.readyCount : 0;
          
          // Cache playerId -> userId from matchState players
          if (Array.isArray(msg.players)) {
            for (const p of msg.players) {
              if (p.userId) playerIdToUserId.set(p.id, p.userId);
            }
          }
          
          // Update player list (only show human players in FFA/Teams lobby)
          if (Array.isArray(msg.players) && msg.players.length > 0) {
            lobbyPlayerListEl.innerHTML = msg.players
              .map((p: { displayName: string; id: string; userId?: string; team?: 'red' | 'blue' }) => {
                const rel = p.userId ? playerRelationships.get(p.userId) : undefined;
                const relClass = rel === 'friend' ? ' is-friend' : rel === 'foe' ? ' is-foe' : '';
                const teamClass = p.team === 'red' ? ' team-red' : p.team === 'blue' ? ' team-blue' : '';
                const relIcon = rel === 'friend' ? '<span class="rel-icon friend-icon" title="Friend"></span>' : rel === 'foe' ? '<span class="rel-icon foe-icon" title="Foe"></span>' : '';
                const teamLabel = p.team ? ` <span style="opacity:0.7;font-size:11px">[${p.team}]</span>` : '';
                const isMe = p.id === myPlayerId;
                const clickAttr = (!isMe && isSignedIn && p.userId && p.userId !== currentUserId) ? ` data-user-id="${escapeHtml(p.userId)}" data-display-name="${escapeHtml(p.displayName)}" onclick="window.__showRelPopup(event)"` : '';
                return `<div class="lobby-player${relClass}${teamClass}"${clickAttr}>${relIcon}${escapeHtml(p.displayName)}${teamLabel}</div>`;
              })
              .join('');
          } else {
            lobbyPlayerListEl.innerHTML = '';
          }
          
          if (matchPhase === 'lobby') {
            if (selectedMode === 'solo') {
              lobbyOverlayEl.classList.add('hidden');
            } else {
              lobbyOverlayEl.classList.remove('hidden');
              // Show team selection only in Teams mode lobby
              if (selectedMode === 'teams') {
                teamSelectEl.classList.remove('hidden');
              } else {
                teamSelectEl.classList.add('hidden');
              }
              if (botsEnabled && typeof msg.playerCount === 'number' && msg.playerCount <= 1) {
                lobbyMessageEl.textContent = selectedMode === 'teams' 
                  ? 'Pick your team and start with bots.'
                  : 'No other players yet.';
                lobbyReadyBtnEl.classList.remove('hidden');
                lobbyReadyBtnEl.textContent = 'Ready with Bots';
              } else {
                lobbyMessageEl.textContent = selectedMode === 'teams'
                  ? 'Pick your team. Waiting for players…'
                  : 'Waiting for another player…';
                lobbyReadyBtnEl.classList.add('hidden');
              }
              lobbyCountdownEl.classList.add('hidden');
            }
          } else if (matchPhase === 'countdown') {
            lobbyOverlayEl.classList.remove('hidden');
            teamSelectEl.classList.add('hidden'); // Hide team select during countdown
            lobbyMessageEl.textContent = 'Match starting soon';
            lobbyCountdownEl.classList.remove('hidden');
            lobbyCountdownEl.textContent = countdownRemainingSec > 0 ? `Starting in ${countdownRemainingSec}s…` : 'Starting…';
            lobbyReadyBtnEl.classList.remove('hidden');
            if (iAmReady) lobbyReadyBtnEl.textContent = 'Ready!';
            else lobbyReadyBtnEl.textContent = 'Ready';
          } else {
            lobbyOverlayEl.classList.add('hidden');
            teamSelectEl.classList.add('hidden');
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
        // Boss mode messages (enter/exit handled by proximity detection, not messages)
        if (msg.type === 'bossPurchaseResult' || msg.type === 'bossSubmitMealResult' || msg.type === 'karmaAwarded') {
          handleBossMessage(msg as { type: string; [key: string]: unknown });
        }
        // Easter egg boss mode result
        if (msg.type === 'easterEggBossModeResult' || msg.type === 'debugBossModeResult') {
          if (msg.success) {
            showToast('Boss Mode activated!', 'success');
          } else {
            showToast(`Boss Mode failed: ${msg.reason || 'unknown'}`, 'error');
          }
        }
        // Items applied confirmation (from item selection modal)
        if (msg.type === 'itemsApplied') {
          // Update remaining inventory after items were withdrawn
          if (isSignedIn) {
            currentInventory.portCharges = Math.max(0, currentInventory.portCharges - (msg.portCharges ?? 0));
            currentInventory.speedBoosts = Math.max(0, currentInventory.speedBoosts - (msg.speedBoosts ?? 0));
            currentInventory.sizeBoosts = Math.max(0, currentInventory.sizeBoosts - (msg.sizeBoosts ?? 0));
            currentInventory.adoptSpeedBoosts = Math.max(0, currentInventory.adoptSpeedBoosts - (msg.adoptSpeedBoosts ?? 0));
            if (currentInventory.shelterTier3Boosts != null) {
              currentInventory.shelterTier3Boosts = Math.max(0, currentInventory.shelterTier3Boosts - (msg.shelterTier3Boosts ?? 0));
            }
            updateEquipmentPanel();
          }
          // Update in-match adopt speed boost count
          if (typeof msg.adoptSpeedBoosts === 'number' && msg.adoptSpeedBoosts > 0) {
            inMatchAdoptSpeedBoosts += msg.adoptSpeedBoosts;
            updateAdoptSpeedButton();
          }
          // Show toast summarizing what was applied
          const parts: string[] = [];
          if (msg.portCharges > 0) parts.push(`${msg.portCharges} port${msg.portCharges > 1 ? 's' : ''}`);
          if (msg.speedBoosts > 0) parts.push('speed boost');
          if (msg.sizeBoosts > 0) parts.push(`+${msg.sizeBoosts} size`);
          if (msg.adoptSpeedBoosts > 0) parts.push(`${msg.adoptSpeedBoosts} adopt speed`);
          if (msg.shelterTier3Boosts > 0) parts.push(`${msg.shelterTier3Boosts} tier 3`);
          if (parts.length > 0) {
            showToast(`Equipment applied: ${parts.join(', ')}`, 'success');
          }
        }
        // Boost used confirmation
        if (msg.type === 'boostUsed') {
          if (msg.boostType === 'adoptSpeed') {
            if (msg.success) {
              inMatchAdoptSpeedBoosts = msg.remainingBoosts ?? 0;
              adoptSpeedActiveUntilTick = msg.activeUntilTick ?? 0;
              adoptSpeedUsedSeconds = msg.usedSeconds ?? 0;
              updateAdoptSpeedButton();
              showToast('Adopt speed boost activated! (60s)', 'success');
            } else {
              if ((msg.usedSeconds ?? 0) >= 300) {
                showToast('Max 5 minutes used this match!', 'info');
              } else {
                showToast('No adopt speed boosts available!', 'info');
              }
            }
          }
        }
        // Match end inventory notification - match has ended, saved match cleared
        if (msg.type === 'matchEndInventory') {
          hasSavedMatch = false;
          if (msg.strayLoss === true) matchEndWasStrayLoss = true;
          // Remove current match from pending list (it has ended)
          if (currentMatchId) {
            removeActiveMultiplayerMatch(currentMatchId);
          }
          updateResumeMatchUI();
          // Refresh inventory from server after match end deposit
          fetchInventory();
          fetchSavedMatchStatus();
          fetchActiveMatchesInfo();
          // Show karma notification if awarded
          if (typeof msg.karmaAwarded === 'number' && msg.karmaAwarded > 0) {
            showToast(`+${msg.karmaAwarded} Karma Point!`, 'success');
            // Refresh karma display
            fetchKarma();
          }
          // Teams mode: show team result toast
          if (msg.winningTeam && msg.myTeam) {
            if (msg.myTeam === msg.winningTeam) {
              showToast(`Your team (${msg.myTeam === 'red' ? 'Red' : 'Blue'}) won! Full rewards earned.`, 'success');
            } else {
              showToast(`Your team (${msg.myTeam === 'red' ? 'Red' : 'Blue'}) lost. Rewards reduced to 1/3.`, 'error');
            }
          }
        }
        // Match-wide announcements
        if (msg.type === 'announcement' && Array.isArray(msg.messages)) {
          showAnnouncement(msg.messages);
        }
        // Incoming ally request from another player (not in Teams mode - alliances are automatic)
        if (msg.type === 'allyRequestReceived' && typeof msg.fromId === 'string' && typeof msg.fromName === 'string') {
          if (selectedMode !== 'teams') {
            showAllyRequestPopup(msg.fromId, msg.fromName);
          }
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
            // Play teleport sound for local player
            if (p.id === myPlayerId) {
              playPort();
            }
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
      const petSnapTime = performance.now();
      const curGen = ++interpPetGen;
      for (const pet of snap.pets) {
        const existing = interpolatedPets.get(pet.id);
        if (existing) {
          // Reuse objects: swap prev/next references, copy fields onto next
          const tmp = existing.prev;
          existing.prev = existing.next;
          existing.next = tmp;
          tmp.id = pet.id; tmp.x = pet.x; tmp.y = pet.y;
          tmp.vx = pet.vx; tmp.vy = pet.vy;
          tmp.insideShelterId = pet.insideShelterId;
          tmp.petType = pet.petType;
          existing.startTime = petSnapTime;
          existing.gen = curGen;
        } else {
          interpolatedPets.set(pet.id, {
            prev: pet,
            next: { ...pet },
            startTime: petSnapTime,
            gen: curGen,
          });
        }
      }
      // Sweep stale entries (pets no longer in snapshot) — zero allocations
      if (interpolatedPets.size > snap.pets.length + 50) {
        for (const [id, entry] of interpolatedPets) {
          if (entry.gen !== curGen) interpolatedPets.delete(id);
        }
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
          playPickupBoost();
        } else if (me.size > lastKnownSize) {
          // Still play sound but don't show popup
          playPickupBoost();
        }
        if ((me.speedBoostUntil ?? 0) > lastSpeedBoostUntil) playPickupBoost();
        lastSpeedBoostUntil = me.speedBoostUntil ?? 0;
        if (me.totalAdoptions > lastTotalAdoptions) {
          const myShelter = latestSnapshot?.shelters?.find(s => s.ownerId === myPlayerId);

          // 1. Shelter auto-adoption: pets that left the shelter
          if (myShelter?.hasAdoptionCenter) {
            const shelterAdoptedIds = lastShelterPetsInsideIds
              .filter((id) => !myShelter.petsInside.includes(id));
            if (shelterAdoptedIds.length > 0) {
              const types = shelterAdoptedIds.map((id) => lastPetTypesById.get(id) ?? PET_TYPE_CAT);
              if (getShelterAdoptSfxEnabled()) playAdoptionSounds(types);
              triggerAdoptionAnimation(myShelter.x, myShelter.y, myShelter.x, myShelter.y - 100, types);
            }
          }

          // 2. Van drop-off adoption: pets that left the van (adoption center or event)
          const vanAdoptedIds = lastPetsInsideIds
            .filter((id) => !me.petsInside.includes(id));
          if (vanAdoptedIds.length > 0) {
            const types = vanAdoptedIds.map((id) => lastPetTypesById.get(id) ?? PET_TYPE_CAT);
            playAdoptionSounds(types);
            // Find nearest adoption event the van is inside
            let animTarget: { x: number; y: number } | null = null;
            for (const ev of latestSnapshot?.adoptionEvents ?? []) {
              if (Math.hypot(me.x - ev.x, me.y - ev.y) <= ev.radius) {
                animTarget = ev;
                break;
              }
            }
            // Fall back to central adoption zone
            if (!animTarget) {
              const zone = latestSnapshot?.adoptionZones?.[0];
              if (zone) animTarget = zone;
            }
            if (animTarget) {
              triggerAdoptionAnimation(me.x, me.y, animTarget.x, animTarget.y, types);
            }
          }
        }
        lastTotalAdoptions = me.totalAdoptions;
        if (me.petsInside.length > lastPetsInsideLength) playStrayCollected();
        lastPetsInsideLength = me.petsInside.length;
        // Track van and shelter pet IDs + pet types for adoption animations
        // Only track types for pets in own van/shelter — not all 2000+ strays
        lastPetsInsideIds = [...me.petsInside];
        const mySh = latestSnapshot?.shelters?.find((s) => s.ownerId === myPlayerId);
        lastShelterPetsInsideIds = mySh ? [...mySh.petsInside] : [];
        const trackIds = new Set(lastPetsInsideIds);
        if (mySh) for (const id of mySh.petsInside) trackIds.add(id);
        if (trackIds.size > 0) {
          for (const p of snap.pets) {
            if (trackIds.has(p.id)) lastPetTypesById.set(p.id, p.petType ?? PET_TYPE_CAT);
          }
        }
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
      
      // Handle boss mode mill proximity changes (server-driven)
      const bossModeActive = !!snap.bossMode?.active;
      
      // Ensure boss music is playing whenever boss mode is active (handles
      // reconnects, settings toggles, and normal transitions)
      if (bossModeActive) {
        if (!isBossMusicPlaying()) {
          playBossMusic();
        }
      } else if (wasBossModeActive) {
        // Boss mode just ended - switch back to regular music
        stopBossMusic();
      }
      wasBossModeActive = bossModeActive;
      
      if (bossModeActive) {
        const currentPlayerAtMill = snap.bossMode!.playerAtMill;
        
        // Detect when player enters a mill (proximity-based, server tells us)
        if (currentPlayerAtMill >= 0 && lastPlayerAtMill < 0) {
          // Player just entered a mill - open the modal
          openBossMillModalFromProximity(currentPlayerAtMill);
        } else if (currentPlayerAtMill < 0 && lastPlayerAtMill >= 0) {
          // Player left the mill - close the modal
          closeBossMillModal();
        }
        
        lastPlayerAtMill = currentPlayerAtMill;
        
        // Update modal content if still open
        if (bossMillOpen) {
          updateBossMillModal();
        }
      } else {
        // Boss mode ended
        if (bossMillOpen) {
          closeBossMillModal();
        }
        lastPlayerAtMill = -1;
      }
    }
  };
  gameWsLocal.onclose = () => {
    const wasMatchId = currentMatchId;
    const wasMode = selectedMode;
    const wasMatchEnded = matchEndedNormally;
    const wasObserver = isObserver;
    
    gameWs = null;
    myPlayerId = null;
    latestSnapshot = null;
    lastShelterPortCharges = 0;
    predictedPlayer = null;
    matchPhase = 'playing';
    sentAllyRequests.clear();
    iAmReady = false;
    isObserver = false;
    observerOverlayEl.classList.add('hidden');
    wasBossModeActive = false;
    releaseWakeLock();
    
    // Auto-reconnect if this was an unexpected disconnect during an active FFA/Teams match
    if (wasMatchId && !wasMatchEnded && !wasObserver && (wasMode === 'ffa' || wasMode === 'teams')) {
      if (!matchDisconnectInfo) {
        matchDisconnectInfo = { matchId: wasMatchId, mode: wasMode, attempts: 0 };
      }
      attemptAutoReconnect();
    }
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
/** Cached performance.now() for the current frame — avoids repeated syscalls in interpolation. */
let frameNow = 0;
let lastRenderTime = 0;

function tick(now: number): void {
  // Schedule next frame immediately to maintain timing accuracy
  requestAnimationFrame(tick);
  
  // Frame rate limiting - skip if not enough time has passed
  if (lastRenderTime && now - lastRenderTime < targetFrameMs - 1) {
    return; // Skip this frame, wait for next
  }
  
  if (!lastTickTime) lastTickTime = now;
  frameNow = performance.now(); // Cache for all interpolation this frame
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
    observerCameraX = Math.max(pixiScreenW / 2, Math.min(MAP_WIDTH - pixiScreenW / 2, observerCameraX));
    observerCameraY = Math.max(pixiScreenH / 2, Math.min(MAP_HEIGHT - pixiScreenH / 2, observerCameraY));
  }

  const matchOver = latestSnapshot != null && latestSnapshot.matchEndAt > 0 && latestSnapshot.tick >= latestSnapshot.matchEndAt;
  const meForActive = latestSnapshot?.players.find((p) => p.id === myPlayerId);
  const gameActive = matchPhase === 'playing' && !matchOver && !meForActive?.eliminated;
  const canMove = gameActive && !breederGame.active && !breederWarningVisible; // Can't move during breeder minigame or warning

  // Send input at server tick rate (only when match is playing and not over, and not in minigame)
  // Observers don't send input
  if (canMove && !isObserver && gameWs?.readyState === WebSocket.OPEN && now - lastInputSendTime >= TICK_MS) {
    lastInputSendTime = now;
    const buf = encodeInput(inputFlags, inputSeq++);
    gameWs.send(buf);
  }

  // Van engine sounds (Camaro purr / jet swoosh) when "Van sounds" is enabled
  {
    const isMoving = canMove && inputFlags !== 0;
    const currentTick = latestSnapshot?.tick ?? 0;
    const isBoosted = isMoving && predictedPlayer != null && (predictedPlayer.speedBoostUntil ?? 0) > currentTick;
    updateEngineState(isMoving, isBoosted);
    // Throttle: 0 when idle/coasting, 1 when pressing movement keys (accelerating)
    // For Beetle, this controls the "pea-shooter chirp" whistle intensity
    updateEngineThrottle(isMoving ? 1 : 0);
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
      // Check if this is a teleport (large position change) - snap camera instantly instead of smoothing
      const distToTarget = Math.hypot(tx - playerDisplayX, ty - playerDisplayY);
      if (distToTarget > 200) {
        // Teleport detected - snap camera instantly
        playerDisplayX = tx;
        playerDisplayY = ty;
      } else {
        playerDisplayX += (tx - playerDisplayX) * PLAYER_DISPLAY_SMOOTH;
        playerDisplayY += (ty - playerDisplayY) * PLAYER_DISPLAY_SMOOTH;
      }
    }
    if (!Number.isFinite(playerDisplayX) || !Number.isFinite(playerDisplayY)) {
      playerDisplayX = tx;
      playerDisplayY = ty;
    }
    // Show Fight/Ally when my SHELTER overlaps another player's SHELTER — vans cannot attack
    // Show CPU warning when overlapping a CPU shelter (no prompt)
    // In Teams mode: no fight/ally prompt — teammates are auto-allied, opponents auto-fight
    let overlappingId: string | null = null;
    let cpuOverlapping = false;
    if (latestSnapshot && selectedMode !== 'teams') {
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
      const otherName = other?.displayName ?? overlappingId;
      const otherRel = getRelationshipByPlayerId(overlappingId);
      const relLabel = otherRel === 'friend' ? ' (Friend)' : otherRel === 'foe' ? ' (Foe)' : '';
      fightAllyNameEl.textContent = otherName + relLabel;
      if (otherRel === 'friend') fightAllyNameEl.style.color = '#2ecc71';
      else if (otherRel === 'foe') fightAllyNameEl.style.color = '#e74c3c';
      else fightAllyNameEl.style.color = '';
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
  // Pet interpolation is now lazy (computed on-demand in getInterpolatedPet)

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

/** Reusable buffer for interpolated pet — mutated and returned, consumed immediately by caller. */
const _interpPetBuf: PetState = { id: '', x: 0, y: 0, vx: 0, vy: 0, insideShelterId: null, petType: 0 };

function getInterpolatedPet(id: string): PetState | null {
  const entry = interpolatedPets.get(id);
  if (!entry) return null;
  const t = Math.min(1, (frameNow - entry.startTime) / INTERP_BUFFER_MS);
  const n = entry.next;
  _interpPetBuf.id = n.id;
  _interpPetBuf.x = lerp(entry.prev.x, n.x, t);
  _interpPetBuf.y = lerp(entry.prev.y, n.y, t);
  _interpPetBuf.vx = n.vx;
  _interpPetBuf.vy = n.vy;
  _interpPetBuf.insideShelterId = n.insideShelterId;
  _interpPetBuf.petType = n.petType;
  return _interpPetBuf;
}

// --- Canvas 2D world rendering code has been removed ---
// All rendering (drawMapBackground, drawShelter, drawStray, drawBreederCamp,
// drawPickup, drawSeasonParticles, drawAdoptionZone, drawPortEffect, etc.)
// has been moved to the PixiJS entity modules in client/src/entities/.

function render(dt: number): void {
  try {
    // Update van facing direction (left/right) based on horizontal velocity
    if (latestSnapshot) {
      for (const p of latestSnapshot.players) {
        if (Math.abs(p.vx) > 0.5) {
          vanFacingDir.set(p.id, p.vx > 0 ? 1 : -1);
        }
      }
    }

    // ---- PixiJS camera & scene graph update ----
    const me = latestSnapshot?.players.find(p => p.id === myPlayerId);
    const safeCam = pixiUpdateCamera({
      predictedX: playerDisplayX,
      predictedY: playerDisplayY,
      isObserver,
      isFullSpectator: isObserver,
      spectatorPlayers: latestSnapshot?.players.filter(p => !p.eliminated),
      spectatorIndex: observerFollowIndex,
      isEliminated: !!(me?.eliminated),
    });

    // Rebuild background if season changed
    _bgLayer.build(currentSeason);

    // Seasonal particle update
    pixiUpdateSeasonParticles(dt, safeCam, currentSeason, latestSnapshot?.tick ?? 0);

  // Viewport culling bounds
  const viewL = safeCam.x;
  const viewR = safeCam.x + safeCam.w;
  const viewT = safeCam.y;
  const viewB = safeCam.y + safeCam.h;

  if (latestSnapshot) {
    // Adoption zones
    updateAdoptionZones(latestSnapshot.adoptionZones, zoneLayer);
    // Adoption events
    updateAdoptionEvents(
      latestSnapshot.adoptionEvents ?? [],
      latestSnapshot.tick,
      me?.x ?? 0, me?.y ?? 0,
      adoptionEventTexture,
      zoneLayer,
    );
    // Pickups — build camp texture map from sprites module
    const campTexMap = new Map<number, Texture>();
    for (let lvl = 1; lvl <= 20; lvl++) campTexMap.set(lvl, getBreederCampTexture(lvl));
    updatePickups(latestSnapshot.pickups ?? [], pickupLayer, campTexMap, viewL, viewR, viewT, viewB);
    // Shelters
    updateShelters(
      latestSnapshot.shelters ?? [], myPlayerId, latestSnapshot.players,
      lastPetTypesById, shelterLayer, viewL, viewR, viewT, viewB,
    );
    // Breeder shelters
    updateBreeders(latestSnapshot.breederShelters ?? [], shelterLayer, viewL, viewR, viewT, viewB);
  }

  // Boss mode
  pixiUpdateBossMode(latestSnapshot?.bossMode, bossLayer, viewL, viewR, viewT, viewB);

  // Strays — rendered via PixiJS sprite pool
  pixiUpdateStrays(
    latestSnapshot?.pets ?? [],
    (id) => getInterpolatedPet(id),
    viewL, viewR, viewT, viewB,
    strayLayer,
  );

  // Build player-keyed relationships map for van renderer
  const _relMap = new Map<string, 'friend' | 'foe'>();
  for (const pl of latestSnapshot?.players ?? []) {
    const rel = getRelationshipByPlayerId(pl.id);
    if (rel) _relMap.set(pl.id, rel);
  }
  // Vans (player vehicles)
  updateVans(
    latestSnapshot?.players ?? [],
    myPlayerId,
    predictedPlayer,
    playerDisplayX, playerDisplayY,
    vanFacingDir,
    latestSnapshot?.tick ?? 0,
    sentAllyRequests,
    _relMap,
    playerLayer,
  );

  // Growth popup
  renderGrowthPopup(growthPopUntil > Date.now(), hudContainer, pixiScreenW, pixiScreenH);

  // Adoption animations (PixiJS)
  pixiRenderAdoptionAnimations(effectLayer);

  // Port effects (PixiJS)
  renderPortEffects(portAnimations, effectLayer);

  // Seasonal particles (PixiJS)
  pixiRenderSeasonParticles(safeCam, currentSeason, effectLayer);

  // Shelter locator arrow (HUD)
  const shelterLocatorMe = latestSnapshot?.players.find(p => p.id === myPlayerId);
  const myShelterForLocator = shelterLocatorMe?.shelterId
    ? (latestSnapshot?.shelters?.find(s => s.id === shelterLocatorMe.shelterId) ?? null)
    : null;
  if (myShelterForLocator && shelterLocatorMe && !shelterLocatorMe.eliminated) {
    renderShelterLocator(
      true,
      myShelterForLocator.x, myShelterForLocator.y,
      predictedPlayer?.x ?? shelterLocatorMe.x,
      predictedPlayer?.y ?? shelterLocatorMe.y,
      safeCam, hudContainer, pixiScreenW, pixiScreenH,
    );
  } else {
    renderShelterLocator(false, 0, 0, 0, 0, safeCam, hudContainer, pixiScreenW, pixiScreenH);
  }

  // Virtual joystick (HUD)
  renderJoystick(
    joystickActive,
    joystickOriginX, joystickOriginY,
    joystickCurrentX, joystickCurrentY,
    JOYSTICK_MAX_RADIUS,
    hudContainer, pixiScreenW, pixiScreenH,
  );

  // Minimap (Canvas 2D — separate small canvas)
  pixiDrawMinimap(
    minimapCtx, latestSnapshot, myPlayerId, currentSeason,
    hideStraysOnMinimap, safeCam, playerDisplayX, playerDisplayY,
  );

  // ---- Render the PixiJS frame ----
  renderFrame();


  // UI
  const meUI = latestSnapshot?.players.find((p) => p.id === myPlayerId) ?? predictedPlayer;
  const rawCapacity = meUI ? Math.floor(meUI.size) : 0;
  // Vans always capped at VAN_MAX_CAPACITY (shelter capacity shown on shelter building)
  const capacity = Math.min(rawCapacity, VAN_MAX_CAPACITY);
  const inside = meUI?.petsInside.length ?? 0;
  // Use server-provided total (pets array may be capped for performance)
  const strayCount = latestSnapshot?.totalOutdoorStrays ?? 0;
  scoreEl.textContent = meUI?.eliminated ? 'Observer Mode' : `Size: ${rawCapacity}`;
  carriedEl.textContent = meUI?.eliminated ? 'WASD to pan | Drag to move' : `Pets: ${inside}/${capacity}`;
  
  // Show/hide build shelter button - requires size >= 50 and tokens >= 250
  const hasShelter = !!(meUI?.shelterId);
  const isEliminated = !!(meUI?.eliminated);
  const playerTokens = meUI?.money ?? 0;
  const canBuildShelter = meUI && meUI.size >= 50 && !hasShelter && !isEliminated && matchPhase === 'playing';
  
  // Update tokens display
  gameTokensEl.textContent = formatNumber(playerTokens);
  
  // Menu button - show when in match and not eliminated (always available, even after building shelter)
  const showMenuButton = meUI && !isEliminated && matchPhase === 'playing';
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
  const portCount = meUI?.portCharges ?? 0;
  if (meUI && portCount > 0 && !isEliminated && matchPhase === 'playing') {
    portBtnEl.textContent = `Random [P] (${portCount})`;
    portBtnEl.classList.remove('hidden');
  } else {
    portBtnEl.classList.add('hidden');
  }
  
  // Shelter port button - show when player has shelter port charges
  // If no shelter yet, show but indicate it needs a shelter
  const shelterPortCount = Math.max(meUI?.shelterPortCharges ?? 0, lastShelterPortCharges);
  if (meUI && shelterPortCount > 0 && !isEliminated) {
    if (hasShelter) {
      shelterPortBtnEl.textContent = isMobileBrowser ? `[H] (${shelterPortCount})` : `Home [H] (${shelterPortCount})`;
      (shelterPortBtnEl as HTMLButtonElement).disabled = false;
      shelterPortBtnEl.setAttribute('aria-disabled', 'false');
      shelterPortBtnEl.style.opacity = '1';
      shelterPortBtnEl.style.cursor = 'pointer';
    } else {
      // Show the button but indicate it's not usable without a shelter
      shelterPortBtnEl.textContent = isMobileBrowser ? `[H] (${shelterPortCount}) 🔒` : `Home [H] (${shelterPortCount}) 🔒`;
      (shelterPortBtnEl as HTMLButtonElement).disabled = false;
      shelterPortBtnEl.setAttribute('aria-disabled', 'true');
      shelterPortBtnEl.style.opacity = '0.6';
      shelterPortBtnEl.style.cursor = 'not-allowed';
    }
    shelterPortBtnEl.classList.remove('hidden');
  } else {
    shelterPortBtnEl.classList.add('hidden');
  }
  
  // Adopt speed boost button - show when player has boosts available
  updateAdoptSpeedButton();
  
  // Transfer button - show when near allied shelter and carrying pets
  let nearbyAlliedShelter: ShelterState | null = null;
  if (meUI && meUI.petsInside.length > 0 && !isEliminated && matchPhase === 'playing') {
    // Check if near any allied shelter
    for (const shelter of latestSnapshot?.shelters ?? []) {
      if (shelter.ownerId === myPlayerId) continue; // Skip own shelter
      // Check if allied (by looking at allies list)
      const owner = latestSnapshot?.players.find(p => p.id === shelter.ownerId);
      const isAllied = meUI.allies?.includes(shelter.ownerId) || false;
      if (!isAllied) continue;
      
      // Check distance
      const dx = (predictedPlayer?.x ?? meUI.x) - shelter.x;
      const dy = (predictedPlayer?.y ?? meUI.y) - shelter.y;
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
  const myShelter = meUI?.shelterId ? (latestSnapshot?.shelters?.find(s => s.id === meUI.shelterId) ?? null) : null;
  
  if (meUI && !isEliminated && matchPhase === 'playing' && isPanned) {
    centerVanBtnEl.classList.remove('hidden');
  } else {
    centerVanBtnEl.classList.add('hidden');
  }
  
  // Show shelter button if player has a shelter and is panned (or not near shelter)
  if (meUI && !isEliminated && matchPhase === 'playing' && myShelter) {
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
  const speedBoostRemain = meUI && (meUI.speedBoostUntil ?? 0) > nowTick ? ((meUI.speedBoostUntil! - nowTick) / tickRate).toFixed(1) : '';
  if (tagCooldownEl) tagCooldownEl.textContent = meUI ? `Adoptions: ${meUI.totalAdoptions}  •  Strays: ${strayCount}${speedBoostRemain ? `  •  Speed: ${speedBoostRemain}s` : ''}` : '';
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
  const points = meUI?.totalAdoptions ?? 0;
  const myShelterForStatus = meUI?.shelterId ? (latestSnapshot?.shelters?.find(s => s.id === meUI.shelterId) ?? null) : null;
  const shelterLabel = myShelterForStatus ? `🏠 lvl${myShelterForStatus.tier}` : '🏠 --';
  timerEl.textContent = matchPhase === 'playing' ? `⭐ ${points}  ${shelterLabel}` : '';
  
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
  
  // Team score HUD (Teams mode only)
  if (selectedMode === 'teams' && matchPhase === 'playing' && latestSnapshot?.teamScores) {
    teamScoreHudEl.classList.remove('hidden');
    teamScoreRedEl.textContent = `Red: ${latestSnapshot.teamScores.red}`;
    teamScoreBlueEl.textContent = `Blue: ${latestSnapshot.teamScores.blue}`;
  } else {
    teamScoreHudEl.classList.add('hidden');
  }
  
  // Boss mode timer overlay
  updateBossModeTimer();
  
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
      eventToggleBtnEl.classList.remove('hidden');
      if (eventPanelOpen) {
        eventPanelEl.classList.remove('hidden');
      } else {
        eventPanelEl.classList.add('hidden');
      }
    } else {
      eventToggleBtnEl.classList.add('hidden');
      eventPanelEl.classList.add('hidden');
      eventPanelOpen = false;
    }
  }
  
  const iAmEliminated = !!(meUI?.eliminated);
  const matchEndedEarly = !!(latestSnapshot?.matchEndedEarly);
  const matchIsFinished = remainingSec <= 0 || matchEndedEarly || iAmEliminated;
  if (matchIsFinished && latestSnapshot?.players.length) {
    // Close any active breeder minigame when match ends (including early wins)
    if (breederGame.active) {
      endBreederMiniGame(false);
    }
    // Also close the breeder warning popup if showing
    if (breederWarningVisible) {
      breederWarningPopupEl.classList.add('hidden');
      breederWarningVisible = false;
      pendingBreederGame = null;
    }
    if (!matchEndPlayed) {
      matchEndPlayed = true;
      matchEndedNormally = true;
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
    const strayLoss = !!(latestSnapshot?.strayLoss || matchEndWasStrayLoss);
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
    if (latestSnapshot?.strayLoss || matchEndWasStrayLoss) {
      title = 'Match lost — too many strays!';
    } else if (iAmEliminated) {
      title = 'You were consumed';
    } else if (selectedMode === 'teams' && latestSnapshot?.winningTeam) {
      const myTeam = meUI?.team;
      const winTeam = latestSnapshot.winningTeam;
      const teamName = winTeam === 'red' ? 'Red' : 'Blue';
      if (myTeam === winTeam) {
        title = `Your team won! (Team ${teamName})`;
      } else {
        title = `Team ${teamName} won!`;
      }
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
    const playerLine = (p: PlayerState, i: number) => {
      const isMe = p.id === myPlayerId;
      const name = isMe ? 'You' : (p.displayName ?? p.id);
      const rel = getRelationshipByPlayerId(p.id);
      const relDot = rel === 'friend' ? '<span class="rel-dot rel-dot-friend"></span>' : rel === 'foe' ? '<span class="rel-dot rel-dot-foe"></span>' : '';
      const teamTag = p.team ? `<span style="color:${p.team === 'red' ? '#e74c3c' : '#3498db'};font-weight:700"> [${p.team === 'red' ? 'R' : 'B'}]</span>` : '';
      const targetUserId = getUserIdByPlayerId(p.id);
      const markBtn = (!isMe && isSignedIn && targetUserId && targetUserId !== currentUserId)
        ? ` <button class="rel-mark-btn" data-user-id="${escapeHtml(targetUserId)}" data-display-name="${escapeHtml(p.displayName ?? p.id)}" onclick="window.__showRelPopup(event)">&#9881;</button>`
        : '';
      return `${i + 1}. ${relDot}${escapeHtml(name)}${teamTag}: size ${sizeLabel(p)} (${p.totalAdoptions} adoptions)${markBtn}`;
    };
    // Team scores summary for Teams mode
    const teamScoreLine = selectedMode === 'teams' && latestSnapshot?.teamScores
      ? `<br><span style="color:#e74c3c;font-weight:700">Red: ${latestSnapshot.teamScores.red}</span> vs <span style="color:#3498db;font-weight:700">Blue: ${latestSnapshot.teamScores.blue}</span><br>`
      : '';
    // Guest save prompt: show after match if guest earned items
    const didWin = latestSnapshot?.winnerId === myPlayerId || 
                   (selectedMode === 'teams' && latestSnapshot?.winningTeam && meUI?.team === latestSnapshot.winningTeam);
    const guestSavePrompt = (!isSignedIn && didWin)
      ? `<div style="margin:12px 0;padding:10px 14px;background:rgba(123,237,159,0.15);border:1px solid #7bed9f;border-radius:8px;text-align:center;">
           <div style="font:600 13px Rubik,sans-serif;color:#7bed9f;margin-bottom:6px;">Save your newly acquired items by creating an account!</div>
           <a href="${buildAuthUrl('/auth/google')}" style="display:inline-block;padding:6px 16px;background:#fff;color:#333;border-radius:6px;font:600 12px Rubik,sans-serif;text-decoration:none;">Sign in with Google</a>
         </div>`
      : '';
    leaderboardEl.innerHTML = `<strong>${title}</strong>${teamScoreLine}<br>` + sorted.map((p, i) => playerLine(p, i)).join('<br>') + tokenLines + guestSavePrompt + adHtml + '<div style="display:flex;gap:12px;margin-top:16px;"><button type="button" id="play-again-btn" class="fight-ally-btn ally-btn" style="flex:1">Play again</button><button type="button" id="lobby-btn" class="fight-ally-btn fight-btn" style="flex:1">Back to lobby</button></div>';
  } else {
    leaderboardEl.classList.remove('show');
  }
  } catch (err) {
    console.error('Render error:', err);
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
    // Request fullscreen immediately while still in user gesture context
    enterMobileFullscreen();
    requestWakeLock();
    if (gameWs) {
      gameWs.close();
      gameWs = null;
    }
    leaderboardEl.classList.remove('show');
    matchEndPlayed = false;
    matchEndWasStrayLoss = false;
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
      .catch((err: Error) => {
        exitMobileFullscreen();
        showConnectionError(err.message || 'Connection failed.');
      });
  } else if (btn.id === 'lobby-btn') {
    if (gameWs) {
      gameWs.close();
      gameWs = null;
    }
    leaderboardEl.classList.remove('show');
    matchEndPlayed = false;
    matchEndTokensAwarded = false;
    matchEndWasStrayLoss = false;
    latestSnapshot = null;
    currentMatchId = null;
    gameWrapEl.classList.remove('visible');
    landingEl.classList.remove('hidden');
    authAreaEl.classList.remove('hidden');
    exitMobileFullscreen();
    updateLandingTokens();
    restoreModeSelection();
    // Clear saved match state since match ended
    hasSavedMatch = false;
    // Remove current match from pending list since it ended properly
    if (currentMatchId) {
      removeActiveMultiplayerMatch(currentMatchId);
    }
    updateResumeMatchUI();
    fetchSavedMatchStatus(); // Sync with server
    fetchActiveMatchesInfo(); // Refresh match list
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

// --- Lobby: Team selection buttons ---
teamRedBtnEl.addEventListener('click', () => {
  if (selectedTeam === 'red') return;
  selectedTeam = 'red';
  teamRedBtnEl.classList.add('selected');
  teamBlueBtnEl.classList.remove('selected');
  // Notify server of team change during lobby
  if (gameWs && gameWs.readyState === WebSocket.OPEN && matchPhase === 'lobby') {
    gameWs.send(JSON.stringify({ type: 'changeTeam', team: 'red' }));
  }
});
teamBlueBtnEl.addEventListener('click', () => {
  if (selectedTeam === 'blue') return;
  selectedTeam = 'blue';
  teamBlueBtnEl.classList.add('selected');
  teamRedBtnEl.classList.remove('selected');
  // Notify server of team change during lobby
  if (gameWs && gameWs.readyState === WebSocket.OPEN && matchPhase === 'lobby') {
    gameWs.send(JSON.stringify({ type: 'changeTeam', team: 'blue' }));
  }
});

// --- Lobby: Ready button ---
lobbyReadyBtnEl.addEventListener('click', () => {
  if (iAmReady || !gameWs || gameWs.readyState !== WebSocket.OPEN) return;
  if (matchPhase !== 'countdown' && matchPhase !== 'lobby') return;
  iAmReady = true;
  gameWs.send(JSON.stringify({ type: 'ready' }));
  lobbyReadyBtnEl.textContent = 'Ready!';
  lobbyMessageEl.textContent = matchPhase === 'lobby'
    ? 'Starting with bots…'
    : "You're ready! Waiting for other player(s)…";
});

// --- Observer: Back to lobby ---
observerBackBtnEl.addEventListener('click', () => {
  if (gameWs) {
    gameWs.close();
    gameWs = null;
  }
  isObserver = false;
  observerOverlayEl.classList.add('hidden');
  gameWrapEl.classList.remove('visible');
  landingEl.classList.remove('hidden');
  authAreaEl.classList.remove('hidden');
  exitMobileFullscreen();
  updateLandingTokens();
  restoreModeSelection();
  startServerClockWhenOnLobby();
  connectLobbyLeaderboard();
});

// --- Lobby: Back to lobby (same as end-match lobby button) ---
lobbyBackBtnEl.addEventListener('click', () => {
  cancelAutoReconnect();
  currentMatchId = null;
  if (gameWs) {
    gameWs.close();
    gameWs = null;
  }
  lobbyOverlayEl.classList.add('hidden');
  gameWrapEl.classList.remove('visible');
  landingEl.classList.remove('hidden');
  authAreaEl.classList.remove('hidden'); // Show auth when returning to lobby
  exitMobileFullscreen();
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
  if (breederGame.active || breederWarningVisible) return; // Don't allow porting during mini-game or warning
  if (!gameWs || gameWs.readyState !== WebSocket.OPEN) return;
  gameWs.send(JSON.stringify({ type: 'usePort' }));
});

// --- Shelter Port button ---
shelterPortBtnEl.addEventListener('click', () => {
  if (breederGame.active || breederWarningVisible) return; // Don't allow porting during mini-game or warning
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

// --- Adopt Speed Boost button ---
adoptSpeedBtnEl.addEventListener('click', () => {
  if (breederGame.active || breederWarningVisible) return;
  if (!gameWs || gameWs.readyState !== WebSocket.OPEN) return;
  if (inMatchAdoptSpeedBoosts <= 0) {
    showToast('No adopt speed boosts available!', 'info');
    return;
  }
  if (adoptSpeedUsedSeconds >= 300) {
    showToast('Max 5 minutes used this match!', 'info');
    return;
  }
  if (matchPhase !== 'playing') return;
  gameWs.send(JSON.stringify({ type: 'useBoost', boostType: 'adoptSpeed' }));
});

// --- Transfer Pets button ---
transferBtnEl.addEventListener('click', () => {
  if (breederGame.active || breederWarningVisible) return; // Don't allow during mini-game or warning
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
  const canBuyGravity = hasShelter && !shelter?.hasGravity && shelter?.hasAdoptionCenter && tokens >= 300;
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
    // Use random port charge (not during breeder mini-game or warning)
    if (breederGame.active || breederWarningVisible) return;
    if (gameWs && gameWs.readyState === WebSocket.OPEN) {
      const me = latestSnapshot?.players.find((pl) => pl.id === myPlayerId);
      if (me && (me.portCharges ?? 0) > 0 && !me.eliminated && matchPhase === 'playing') {
        gameWs.send(JSON.stringify({ type: 'usePort' }));
      }
    }
  }
  if (e.key === 'h' || e.key === 'H') {
    // Use shelter port charge (not during breeder mini-game or warning)
    if (breederGame.active || breederWarningVisible) return;
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
  // Easter egg: Cycle season visuals (Ctrl+Shift+Alt+*) - client-side only, cosmetic
  if (e.ctrlKey && e.shiftKey && e.altKey && (e.key === '*' || e.key === '8')) {
    e.preventDefault();
    const SEASON_ORDER: Season[] = ['winter', 'spring', 'summer', 'fall'];
    const SEASON_NAMES_EE: Record<Season, string> = { winter: 'Winter', spring: 'Spring', summer: 'Summer', fall: 'Fall' };
    const SEASON_ICONS_EE: Record<Season, string> = { winter: '\u2744', spring: '\u2740', summer: '\u2600', fall: '\u2741' };
    const idx = SEASON_ORDER.indexOf(currentSeason);
    currentSeason = SEASON_ORDER[(idx + 1) % SEASON_ORDER.length];
    // Update HUD badge
    seasonBadgeEl.textContent = `${SEASON_ICONS_EE[currentSeason]} ${SEASON_NAMES_EE[currentSeason]}`;
    seasonBadgeEl.className = `season-badge ${currentSeason}`;
    // Update leaderboard tab
    const seasonTabEE = document.querySelector('.leaderboard-tab[data-type="season"]') as HTMLElement | null;
    if (seasonTabEE) seasonTabEE.textContent = SEASON_NAMES_EE[currentSeason];
    showToast(`Season switched to ${SEASON_NAMES_EE[currentSeason]} ${SEASON_ICONS_EE[currentSeason]}`, 'info');
    return;
  }
  // Easter egg: Force boss mode (Ctrl+Shift+B) - check BEFORE regular B handler
  if (e.ctrlKey && e.shiftKey && (e.key === 'b' || e.key === 'B')) {
    e.preventDefault();
    if (gameWs?.readyState === WebSocket.OPEN) {
      gameWs.send(JSON.stringify({ type: 'easterEggBossMode' }));
      showToast('Triggering Boss Mode...', 'info');
    }
    return;
  }
  if (e.key === 'b' || e.key === 'B') {
    // Use adopt speed boost (not during breeder mini-game or warning)
    if (breederGame.active || breederWarningVisible) return;
    if (gameWs && gameWs.readyState === WebSocket.OPEN) {
      if (inMatchAdoptSpeedBoosts <= 0) return;
      if (adoptSpeedUsedSeconds >= 300) {
        showToast('Max 5 minutes used this match!', 'info');
        return;
      }
      if (matchPhase !== 'playing') return;
      gameWs.send(JSON.stringify({ type: 'useBoost', boostType: 'adoptSpeed' }));
    }
  }

  // Breeder mini-game hotkeys
  if (e.key === 'i' || e.key === 'I') {
    // Instant Rescue [I] - only during active breeder game
    if (!breederGame.active) return;
    const instantBtn = document.getElementById('instant-rescue-btn') as HTMLButtonElement | null;
    if (instantBtn && !instantBtn.classList.contains('hidden') && !instantBtn.disabled) {
      instantBtn.click();
    }
  }
  if (e.key === 'c' || e.key === 'C') {
    // Continue [C] - close breeder result screen
    if (!breederGame.active) return;
    const closeBtn = document.getElementById('breeder-close-btn');
    if (closeBtn && !closeBtn.classList.contains('hidden')) {
      closeBtn.click();
    }
  }
  if (e.key === 'r' || e.key === 'R') {
    // Retreat [R] - retreat from active breeder game
    if (!breederGame.active) return;
    const retreatBtn = document.getElementById('breeder-retreat-btn');
    if (retreatBtn && !retreatBtn.classList.contains('hidden')) {
      retreatBtn.click();
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
shelterAdoptSfxToggleEl.checked = getShelterAdoptSfxEnabled();
vanSoundSelectEl.value = getVanSoundType();
musicToggleEl.addEventListener('change', () => {
  setMusicEnabled(musicToggleEl.checked);
  if (musicToggleEl.checked) playMusic();
});
sfxToggleEl.addEventListener('change', () => {
  setSfxEnabled(sfxToggleEl.checked);
  if (!sfxToggleEl.checked) stopEngineLoop(); // Stop van engine when SFX disabled
});
shelterAdoptSfxToggleEl.addEventListener('change', () => {
  setShelterAdoptSfxEnabled(shelterAdoptSfxToggleEl.checked);
});
vanSoundSelectEl.addEventListener('change', () => {
  setVanSoundType(vanSoundSelectEl.value as VanSoundType);
  stopEngineLoop(); // Stop current sound; new one will start on next movement tick
});

// Hide strays toggle - only show buildings/shelters/camps/events on minimap
let hideStraysOnMinimap = localStorage.getItem('hideStrays') === 'true';
hideStraysToggleEl.checked = hideStraysOnMinimap;
hideStraysToggleEl.addEventListener('change', () => {
  hideStraysOnMinimap = hideStraysToggleEl.checked;
  localStorage.setItem('hideStrays', hideStraysOnMinimap ? 'true' : 'false');
});

settingsBtnEl.addEventListener('click', () => settingsPanelEl.classList.toggle('hidden'));
settingsCloseEl.addEventListener('click', () => settingsPanelEl.classList.add('hidden'));

// Event panel megaphone toggle
eventToggleBtnEl.addEventListener('click', () => {
  eventPanelOpen = !eventPanelOpen;
  if (eventPanelOpen) {
    eventPanelEl.classList.remove('hidden');
  } else {
    eventPanelEl.classList.add('hidden');
  }
});

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
    if (currentMatchMode === 'solo') {
      showToast('Your match has been saved.', 'success');
    } else if (currentMatchMode === 'ffa' || currentMatchMode === 'teams') {
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
  
  // Capture match duration before clearing state
  const exitMatchDurationMs = latestSnapshot?.matchDurationMs ?? 0;
  
  // Always close and return to lobby (even if WebSocket is already closed)
  cancelAutoReconnect();
  const exitMatchId = currentMatchId;
  currentMatchId = null; // Clear before close to prevent auto-reconnect
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
  matchEndWasStrayLoss = false;
  // Clear any pending announcements/banners immediately
  clearAnnouncements();
  gameWrapEl.classList.remove('visible');
  landingEl.classList.remove('hidden');
  authAreaEl.classList.remove('hidden');
  exitMobileFullscreen();
  // Refresh inventory from server so equipment chest shows accurate post-match values
  fetchInventory();
  updateLandingTokens();
  restoreModeSelection();
  // For solo mode with active connection, show Resume button (we know we just saved)
  if (currentMatchMode === 'solo' && wasConnected) {
    hasSavedMatch = true;
    updateResumeMatchUI();
  } else if ((currentMatchMode === 'ffa' || currentMatchMode === 'teams') && exitMatchId && (isSignedIn || currentUserId)) {
    // For FFA/Teams, add the match to the list (don't replace existing matches)
    // Works for both registered users and guests (who now have a guest_id)
    addActiveMultiplayerMatch({ 
      matchId: exitMatchId, 
      mode: currentMatchMode, 
      durationMs: exitMatchDurationMs,
      isPaused: false, // Will update on next poll
    });
    updateResumeMatchUI();
  } else {
    // Match already ended or unknown state - fetch from server
    fetchSavedMatchStatus();
    fetchActiveMatchesInfo();
  }
  startServerClockWhenOnLobby();
  connectLobbyLeaderboard();
  startGameStatsPolling();
  // Start real-time clock updates and polling for FFA/Teams
  if (selectedMode === 'ffa' || selectedMode === 'teams') {
    startMatchClockUpdates();
    startMatchPolling();
  }
});
switchServerBtnEl.addEventListener('click', () => {
  cancelAutoReconnect();
  currentMatchId = null;
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
const mpOptionsEl = document.getElementById('mp-options');
const botsEnabledEl = document.getElementById('bots-enabled') as HTMLInputElement | null;
const BOTS_ENABLED_KEY = 'rescueworld_bots_enabled';
let botsEnabled = localStorage.getItem(BOTS_ENABLED_KEY) !== 'false'; // default true
if (botsEnabledEl) botsEnabledEl.checked = botsEnabled;
if (botsEnabledEl) {
  botsEnabledEl.addEventListener('change', () => {
    botsEnabled = botsEnabledEl.checked;
    localStorage.setItem(BOTS_ENABLED_KEY, String(botsEnabled));
  });
}

function updateSoloOptionsVisibility(): void {
  if (soloOptionsEl) {
    if (selectedMode === 'solo') {
      soloOptionsEl.classList.remove('hidden');
    } else {
      soloOptionsEl.classList.add('hidden');
    }
  }
  if (mpOptionsEl) {
    if (selectedMode === 'ffa' || selectedMode === 'teams') {
      mpOptionsEl.classList.remove('hidden');
    } else {
      mpOptionsEl.classList.add('hidden');
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

// --- Item Selection Modal Logic ---

/** Check if player has any equipment items (non-RT) in their chest */
function playerHasEquipmentItems(): boolean {
  // Check server inventory for both signed-in and guests
  if ((currentInventory.portCharges ?? 0) > 0 || (currentInventory.speedBoosts ?? 0) > 0 ||
      (currentInventory.sizeBoosts ?? 0) > 0 || (currentInventory.adoptSpeedBoosts ?? 0) > 0 ||
      (currentInventory.shelterTier3Boosts ?? 0) > 0) {
    return true;
  }
  // Fallback: check guest pendingBoosts (bought from Buy buttons pre-match)
  if (!isSignedIn) {
    return pendingBoosts.sizeBonus > 0 || pendingBoosts.speedBoost;
  }
  return false;
}

/** Show item selection modal and return a promise that resolves with the selection */
function showItemSelectionModal(): Promise<ItemSelection> {
  return new Promise((resolve) => {
    // Current quantities available
    const avail = {
      ports: isSignedIn ? currentInventory.portCharges : 0,
      speed: isSignedIn ? currentInventory.speedBoosts : (pendingBoosts.speedBoost ? 1 : 0),
      size: isSignedIn ? currentInventory.sizeBoosts : pendingBoosts.sizeBonus,
      adopt: isSignedIn ? currentInventory.adoptSpeedBoosts : 0,
      tier3: isSignedIn ? (currentInventory.shelterTier3Boosts ?? 0) : 0,
    };

    // Selected quantities (default to 0 so players opt-in)
    const selected = {
      ports: 0,
      speed: 0,
      size: 0,
      adopt: 0,
      tier3: 0,
    };

    // Helper to update row visibility and display
    function updateRow(key: 'ports' | 'speed' | 'size' | 'adopt' | 'tier3') {
      const row = document.getElementById(`item-row-${key}`)!;
      const qtyEl = document.getElementById(`item-qty-${key}`)!;
      const availEl = document.getElementById(`item-avail-${key}`)!;
      const decBtn = document.getElementById(`item-dec-${key}`) as HTMLButtonElement;
      const incBtn = document.getElementById(`item-inc-${key}`) as HTMLButtonElement;
      if (avail[key] <= 0) {
        row.classList.add('hidden');
        return;
      }
      row.classList.remove('hidden');
      availEl.textContent = `(have ${avail[key]})`;
      qtyEl.textContent = String(selected[key]);
      decBtn.disabled = selected[key] <= 0;
      incBtn.disabled = selected[key] >= avail[key];
    }

    function updateAll() {
      updateRow('ports');
      updateRow('speed');
      updateRow('size');
      updateRow('adopt');
      updateRow('tier3');
    }

    // Wire up +/- buttons
    const keys = ['ports', 'speed', 'size', 'adopt', 'tier3'] as const;
    const cleanupFns: (() => void)[] = [];
    for (const key of keys) {
      const decBtn = document.getElementById(`item-dec-${key}`)!;
      const incBtn = document.getElementById(`item-inc-${key}`)!;
      const onDec = () => { if (selected[key] > 0) { selected[key]--; updateAll(); } };
      const onInc = () => { if (selected[key] < avail[key]) { selected[key]++; updateAll(); } };
      decBtn.addEventListener('click', onDec);
      incBtn.addEventListener('click', onInc);
      cleanupFns.push(() => { decBtn.removeEventListener('click', onDec); incBtn.removeEventListener('click', onInc); });
    }

    updateAll();
    itemSelectOverlayEl.classList.remove('hidden');

    const cleanup = () => {
      itemSelectOverlayEl.classList.add('hidden');
      cleanupFns.forEach((fn) => fn());
      itemSelectConfirmBtn.removeEventListener('click', onConfirm);
      itemSelectSkipBtn.removeEventListener('click', onSkip);
    };

    const onConfirm = () => {
      cleanup();
      resolve({
        portCharges: selected.ports,
        shelterPortCharges: 0,
        speedBoosts: selected.speed,
        sizeBoosts: selected.size,
        adoptSpeedBoosts: selected.adopt,
        shelterTier3Boosts: selected.tier3,
      });
    };
    const onSkip = () => {
      cleanup();
      resolve({
        portCharges: 0,
        shelterPortCharges: 0,
        speedBoosts: 0,
        sizeBoosts: 0,
        adoptSpeedBoosts: 0,
        shelterTier3Boosts: 0,
      });
    };

    itemSelectConfirmBtn.addEventListener('click', onConfirm);
    itemSelectSkipBtn.addEventListener('click', onSkip);
  });
}

function startConnect(options: { mode: 'ffa' | 'teams' | 'solo'; abandon?: boolean; resume?: boolean; rejoinMatchId?: string }): void {
  // Request fullscreen immediately while still in user gesture context
  enterMobileFullscreen();
  requestWakeLock();
  playMusic();
  stopServerClock();
  stopMatchClockUpdates();
  stopMatchPolling();

  const doConnect = () => {
    landingEl.classList.add('hidden');
    connectionOverlayEl.classList.remove('hidden');
    connectionOverlayEl.innerHTML = (options.resume || options.rejoinMatchId)
      ? '<h2>Resuming…</h2><p>Loading your saved match.</p>'
      : '<h2>Connecting…</h2><p>Waiting for game server.</p>';
    authAreaEl.classList.add('hidden');
    connect({ mode: options.mode, abandon: options.abandon, rejoinMatchId: options.rejoinMatchId })
      .then(() => {
        connectionOverlayEl.classList.add('hidden');
        gameWrapEl.classList.add('visible');
        if (musicToggleEl) musicToggleEl.checked = getMusicEnabled();
        if (vanSoundSelectEl) vanSoundSelectEl.value = getVanSoundType();
        requestAnimationFrame(tick);
      })
      .catch((err: Error) => {
        showConnectionError(err.message || 'Connection failed.');
        exitMobileFullscreen(); // Exit fullscreen on connection error
        authAreaEl.classList.remove('hidden');
      });
  };

  // Show item selection modal if player has equipment items (skip for resume/rejoin)
  if (!options.resume && !options.rejoinMatchId && playerHasEquipmentItems()) {
    showItemSelectionModal().then((selection) => {
      pendingItemSelection = selection;
      // For guests: clear pendingBoosts since they chose via modal
      if (!isSignedIn) {
        pendingBoosts.sizeBonus = 0;
        pendingBoosts.speedBoost = false;
      }
      doConnect();
    });
  } else {
    pendingItemSelection = null;
    doConnect();
  }
}

const resumeMatchBtnEl = document.getElementById('resume-match-btn');
if (resumeMatchBtnEl) {
  resumeMatchBtnEl.addEventListener('click', () => {
    // Solo resume - only used for solo mode now
    if (selectedMode === 'solo' && hasSavedMatch) {
      startConnect({ mode: 'solo', resume: true });
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
  // FFA/Teams: check if at max matches
  if ((selectedMode === 'ffa' || selectedMode === 'teams') && activeMultiplayerMatches.length >= MAX_SIMULTANEOUS_MATCHES) {
    showToast('Maximum matches reached (5). Finish or leave a match first.', 'info');
    return;
  }
  // Start new match
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
    const boost = (btn as HTMLElement).dataset.boost;
    if (!boost) return;
    const tokens = getTokens();
    
    if (boost === 'size') {
      // Dynamic pricing for size boosts
      const price = getSizeBoostPrice(pendingBoosts.sizeBonus);
      if (tokens < price || pendingBoosts.sizeBonus >= 50) return;
      setTokens(tokens - price);
      pendingBoosts.sizeBonus += 1;
    } else if (boost === 'speed') {
      if (tokens < BOOST_PRICES.speed || pendingBoosts.speedBoost) return;
      setTokens(tokens - BOOST_PRICES.speed);
      pendingBoosts.speedBoost = true;
    }
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

// ============================================
// BOSS MILL MODAL LOGIC
// ============================================

const bossMillModal = document.getElementById('boss-mill-modal');
const bossMillTitle = document.getElementById('boss-mill-title');
const bossMillDesc = document.getElementById('boss-mill-desc');
const bossMillPetCount = document.getElementById('boss-mill-pet-count');
const bossMillPlayerRt = document.getElementById('boss-mill-player-rt');
const bossMillIngredients = document.getElementById('boss-mill-ingredients');
const bossMillSubmit = document.getElementById('boss-mill-submit');
const bossMillFlee = document.getElementById('boss-mill-flee');
const bossMillClose = document.getElementById('boss-mill-close');
const bossMillWarning = document.getElementById('boss-mill-warning');

let currentBossMillId: number = -1;
let bossMillOpen = false;
let lastPlayerAtMill: number = -1; // Track previous value to detect changes
let wasBossModeActive = false; // Track boss mode transitions for music

/** Ingredient emojis for display */
const INGREDIENT_EMOJIS: Record<string, string> = {
  bowl: '🥣',
  water: '💧',
  carrot: '🥕',
  apple: '🍎',
  chicken: '🍗',
  seeds: '🌾',
  treat: '🦴',
};

/** Open the boss mill modal when player enters via proximity (server-driven) */
function openBossMillModalFromProximity(millId: number): void {
  const bossMode = latestSnapshot?.bossMode;
  if (!bossMode?.active) return;
  
  const mill = bossMode.mills.find(m => m.id === millId);
  if (!mill || mill.completed) return;
  
  currentBossMillId = millId;
  bossMillOpen = true;
  
  // No need to send enter message - server already knows from proximity detection
  
  updateBossMillModal();
  bossMillModal?.classList.remove('hidden');
}

/** Close the boss mill modal */
function closeBossMillModal(): void {
  bossMillOpen = false;
  currentBossMillId = -1;
  bossMillModal?.classList.add('hidden');
  // No need to send exit message - server handles proximity detection automatically
}

/** Update the boss mill modal with current data */
function updateBossMillModal(): void {
  const bossMode = latestSnapshot?.bossMode;
  if (!bossMode?.active || currentBossMillId < 0) return;
  
  const mill = bossMode.mills.find(m => m.id === currentBossMillId);
  if (!mill) {
    closeBossMillModal();
    return;
  }
  
  // Update title
  const _bossMillEmojis: Record<number, string> = {
    [BOSS_MILL_HORSE]: '🐴', [BOSS_MILL_CAT]: '🐈',
    [BOSS_MILL_DOG]: '🐕', [BOSS_MILL_BIRD]: '🐦', [BOSS_MILL_RABBIT]: '🐰',
  };
  const emoji = _bossMillEmojis[mill.petType] ?? '🐾';
  const name = BOSS_MILL_NAMES[mill.petType] ?? 'Mill';
  if (bossMillTitle) bossMillTitle.textContent = `${emoji} ${name}`;
  if (bossMillDesc) bossMillDesc.textContent = `Prepare a meal to rescue the ${name.toLowerCase().replace(' stable', 's').replace(' boutique', 's').replace(' depot', 's').replace(' barn', 's').replace(' hutch', 's')}!`;
  if (bossMillPetCount) bossMillPetCount.textContent = String(mill.petCount);
  
  // Update player RT
  const me = latestSnapshot?.players.find(p => p.id === myPlayerId);
  const playerRt = me?.money ?? 0;
  if (bossMillPlayerRt) bossMillPlayerRt.textContent = String(playerRt);
  
  // Build ingredients list
  if (bossMillIngredients) {
    bossMillIngredients.innerHTML = '';
    let allComplete = true;
    
    for (const [ingredient, needed] of Object.entries(mill.recipe)) {
      const purchased = mill.purchased[ingredient] ?? 0;
      const isComplete = purchased >= needed;
      if (!isComplete) allComplete = false;
      
      const cost = BOSS_INGREDIENT_COSTS[ingredient] ?? 10;
      const canAfford = playerRt >= cost;
      
      const row = document.createElement('div');
      row.className = `ingredient-row${isComplete ? ' complete' : ''}`;
      
      const emojiSpan = INGREDIENT_EMOJIS[ingredient] ?? '🍽️';
      
      row.innerHTML = `
        <span class="ingredient-name">${emojiSpan} ${ingredient.charAt(0).toUpperCase() + ingredient.slice(1)}</span>
        <span class="ingredient-progress">${purchased}/${needed}</span>
        <button class="ingredient-buy" data-ingredient="${ingredient}" ${isComplete || !canAfford ? 'disabled' : ''}>
          ${isComplete ? '✓' : `+1 (${cost} RT)`}
        </button>
      `;
      
      bossMillIngredients.appendChild(row);
    }
    
    // Enable/disable submit button
    if (bossMillSubmit) {
      (bossMillSubmit as HTMLButtonElement).disabled = !allComplete;
    }
  }
  
  // Show/hide tycoon warning
  if (bossMillWarning) {
    const tycoonAtThisMill = bossMode.tycoonTargetMill === currentBossMillId;
    const tycoonDist = Math.hypot(bossMode.tycoonX - mill.x, bossMode.tycoonY - mill.y);
    const isClose = tycoonDist < BOSS_TYCOON_DETECTION_RADIUS * 2;
    
    if (tycoonAtThisMill && isClose) {
      bossMillWarning.classList.remove('hidden');
    } else {
      bossMillWarning.classList.add('hidden');
    }
  }
}

/** Purchase an ingredient for the current boss mill */
function purchaseBossIngredient(ingredient: string, amount: number): void {
  if (gameWs?.readyState === WebSocket.OPEN) {
    gameWs.send(JSON.stringify({ type: 'bossPurchase', ingredient, amount }));
  }
}

/** Submit the meal to rescue pets */
function submitBossMeal(): void {
  if (gameWs?.readyState === WebSocket.OPEN) {
    gameWs.send(JSON.stringify({ type: 'bossSubmitMeal' }));
  }
}

// Event listeners for boss mill modal
bossMillClose?.addEventListener('click', closeBossMillModal);
bossMillFlee?.addEventListener('click', closeBossMillModal);
bossMillSubmit?.addEventListener('click', submitBossMeal);

// Event delegation for ingredient buy buttons (since they're recreated on each update)
// Use pointerdown instead of click because the modal is rebuilt on every snapshot,
// which can destroy buttons between mousedown and mouseup, preventing click from firing
bossMillIngredients?.addEventListener('pointerdown', (e) => {
  const target = e.target as HTMLElement;
  if (target.classList.contains('ingredient-buy')) {
    if (target.hasAttribute('disabled')) return;
    const ingredient = target.getAttribute('data-ingredient');
    if (ingredient) {
      purchaseBossIngredient(ingredient, 1);
    }
  }
});

// Handle server responses for boss mode
function handleBossMessage(msg: { type: string; [key: string]: unknown }): void {
  switch (msg.type) {
    case 'bossPurchaseResult':
      if (!msg.success) {
        showToast(String(msg.message || 'Purchase failed'), 'error');
      }
      // Modal will update on next snapshot
      break;
    case 'bossSubmitMealResult':
      if (msg.success) {
        closeBossMillModal();
        // Show celebration
        if (msg.kpAwarded) {
          showToast('All mills cleared! +1 Karma Point!', 'success');
        } else {
          showToast(String(msg.message), 'success');
        }
      } else {
        showToast(String(msg.message), 'error');
      }
      break;
    case 'karmaAwarded':
      showToast(`+${msg.amount} Karma Point for Boss Mode Victory!`, 'success');
      break;
  }
}

// Boss mill interaction is now proximity-based (driven by server state)
// This function is kept for potential future use but currently not used
function checkBossMillClick(_worldX: number, _worldY: number): boolean {
  // Click interaction disabled - player must drive to mills
  return false;
}

// Boss mode timer elements
const bossModeTimerEl = document.getElementById('boss-mode-timer');
const bossTimerTimeEl = document.getElementById('boss-timer-time');
const bossTimerMillsEl = document.getElementById('boss-timer-mills');
const bossRadarIndicatorEl = document.getElementById('radar-indicator');

/** Update the boss mode timer overlay */
function updateBossModeTimer(): void {
  const bossMode = latestSnapshot?.bossMode;
  
  if (!bossMode?.active) {
    bossModeTimerEl?.classList.add('hidden');
    return;
  }
  
  bossModeTimerEl?.classList.remove('hidden');
  
  // Calculate remaining time
  const currentTick = latestSnapshot?.tick ?? 0;
  const elapsedTicks = currentTick - bossMode.startTick;
  const remainingTicks = Math.max(0, bossMode.timeLimit - elapsedTicks);
  const remainingSeconds = Math.ceil(remainingTicks / TICK_RATE);
  const mins = Math.floor(remainingSeconds / 60);
  const secs = remainingSeconds % 60;
  
  if (bossTimerTimeEl) {
    bossTimerTimeEl.textContent = `${mins}:${secs.toString().padStart(2, '0')}`;
    // Add low time warning
    if (remainingSeconds < 60) {
      bossTimerTimeEl.classList.add('low');
    } else {
      bossTimerTimeEl.classList.remove('low');
    }
  }
  
  if (bossTimerMillsEl) {
    bossTimerMillsEl.textContent = `${bossMode.millsCleared}/5 Mills Cleared`;
  }
  
  // Update radar indicator - show tycoon position relative to player
  if (bossRadarIndicatorEl) {
    const me = latestSnapshot?.players.find(p => p.id === myPlayerId);
    if (me) {
      // Calculate direction from player to tycoon
      const dx = bossMode.tycoonX - me.x;
      const dy = bossMode.tycoonY - me.y;
      const dist = Math.hypot(dx, dy);
      
      // Normalize and scale to radar size (30px radius, center at 26px)
      const maxDist = 1000; // Distance at which indicator is at edge
      const radarScale = Math.min(1, dist / maxDist);
      const angle = Math.atan2(dy, dx);
      
      const radarCenterX = 26;
      const radarCenterY = 26;
      const radarRadius = 22;
      
      const indicatorX = radarCenterX + Math.cos(angle) * radarRadius * radarScale;
      const indicatorY = radarCenterY + Math.sin(angle) * radarRadius * radarScale;
      
      bossRadarIndicatorEl.style.left = `${indicatorX}px`;
      bossRadarIndicatorEl.style.top = `${indicatorY}px`;
      
      // Change color based on distance (closer = more red/urgent)
      const urgency = 1 - radarScale;
      if (urgency > 0.7) {
        bossRadarIndicatorEl.style.boxShadow = '0 0 15px #ff0000';
      } else if (urgency > 0.4) {
        bossRadarIndicatorEl.style.boxShadow = '0 0 10px #ff6600';
      } else {
        bossRadarIndicatorEl.style.boxShadow = '0 0 6px #ff4444';
      }
    }
  }
}

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
  // Check if player has enough RT to possibly win
  const me = latestSnapshot?.players.find(p => p.id === myPlayerId);
  const currentRT = me?.money ?? 0;
  const minRTNeeded = calculateMinimumRTNeeded(petCount, level);
  const campType = opts.isMill ? 'mill' : 'breeder camp';
  
  if (currentRT < minRTNeeded) {
    // Stop movement immediately when showing warning
    breederWarningVisible = true;
    setInputFlag(INPUT_LEFT, false);
    setInputFlag(INPUT_RIGHT, false);
    setInputFlag(INPUT_UP, false);
    setInputFlag(INPUT_DOWN, false);
    sendInputImmediately(); // Send stop to server immediately
    
    // Show warning popup
    pendingBreederGame = { petCount, level, opts };
    breederWarningTextEl.textContent = `This ${campType} requires more RT than you have to rescue all pets.`;
    breederWarningStatsEl.textContent = `Required: ${minRTNeeded}+ RT | You have: ${currentRT} RT`;
    breederWarningPopupEl.classList.remove('hidden');
    return;
  }
  
  // Proceed with game if enough RT
  proceedWithBreederMiniGame(petCount, level, opts);
}

/** Actually start the breeder mini-game (called directly or after warning confirmation) */
function proceedWithBreederMiniGame(petCount: number, level: number, opts: BreederStartOptions): void {
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

  // Hide result and continue button, show game
  breederResultEl.classList.add('hidden');
  breederCloseBtnEl.classList.add('hidden');
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

  btn.textContent = `⚡ Instant Rescue [I] (${cost} RT)`;
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
  breederTokensEl.textContent = `Your Tokens: ${formatNumber(tokens)}`;
  
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
  
  if (tokens < cost) {
    showToast(`Not enough RT! Need ${cost} RT`, 'error');
    return;
  }
  
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
        playPickupBoost();
        
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
      playPickupBoost();
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
  
  // Show result and continue button (will be updated when server responds with rewards)
  breederFoodsEl.style.display = 'none';
  breederResultEl.classList.remove('hidden');
  breederCloseBtnEl.classList.remove('hidden');
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
    if (r.type === 'adoptSpeed') {
      rewardLines.push(`<div class="breeder-reward-item">+${r.amount} Adopt Speed Boost 🚀</div>`);
      // Update in-match boost count
      inMatchAdoptSpeedBoosts += r.amount;
      updateAdoptSpeedButton();
    }
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

/** Retreat from an active breeder minigame: clear local state, close UI, and
 *  send only breederRetreat (NOT breederComplete) so the server can restore
 *  the camp and bump the van away. */
function retreatBreederMiniGame(): void {
  // Clear timers without sending breederComplete
  if (breederGame.timerInterval) {
    clearInterval(breederGame.timerInterval);
    breederGame.timerInterval = null;
  }
  if (breederGame.addPetInterval) {
    clearInterval(breederGame.addPetInterval);
    breederGame.addPetInterval = null;
  }
  // Close the minigame UI immediately (no results screen)
  breederGame.active = false;
  breederMinigameEl.classList.remove('show');
  // Send retreat to server (camp restore + van bump + cooldown)
  if (gameWs?.readyState === WebSocket.OPEN) {
    gameWs.send(JSON.stringify({ type: 'breederRetreat' }));
  }
}

// Breeder Mini-Game Event Listeners
breederFoodsEl.querySelectorAll('.breeder-food-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    const food = (btn as HTMLElement).dataset.food as FoodType;
    if (food) useFood(food);
  });
});

breederCloseBtnEl.addEventListener('click', closeBreederMiniGame);

// Retreat button in active breeder minigame - allows escape at any time
const breederRetreatBtn = document.getElementById('breeder-retreat-btn');
breederRetreatBtn?.addEventListener('click', () => {
  retreatBreederMiniGame();
});

// Breeder Warning Popup Event Listeners
breederWarningContinueEl.addEventListener('click', () => {
  breederWarningPopupEl.classList.add('hidden');
  breederWarningVisible = false;
  if (pendingBreederGame) {
    proceedWithBreederMiniGame(pendingBreederGame.petCount, pendingBreederGame.level, pendingBreederGame.opts);
    pendingBreederGame = null;
  }
});

breederWarningRetreatEl.addEventListener('click', () => {
  breederWarningPopupEl.classList.add('hidden');
  breederWarningVisible = false;
  pendingBreederGame = null;
  // Send retreat message to server to let player escape
  if (gameWs?.readyState === WebSocket.OPEN) {
    gameWs.send(JSON.stringify({ type: 'breederRetreat' }));
  }
});

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
      dailyGiftClaimBtnEl.disabled = false;
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
  
  if (!dailyGiftStatus?.canClaimToday) {
    closeDailyGiftModal();
    return;
  }
  
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
    const isMe = entry.userId === myId;
    const clickAttr = (!isMe && isSignedIn && entry.userId && entry.userId !== currentUserId)
      ? ` data-user-id="${escapeHtml(entry.userId)}" data-display-name="${escapeHtml(entry.displayName)}" onclick="window.__showRelPopup(event)" style="cursor:pointer"`
      : '';
    return `<div class="lobby-leaderboard-entry${highlight}"${clickAttr}>
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
    const isMe = entry.userId === currentUserId;
    const clickAttr = (!isMe && isSignedIn && entry.userId && entry.userId !== currentUserId)
      ? ` data-user-id="${escapeHtml(entry.userId)}" data-display-name="${escapeHtml(entry.displayName)}" onclick="window.__showRelPopup(event)" style="cursor:pointer"`
      : '';
    return `
      <div class="leaderboard-entry ${highlight}"${clickAttr}>
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
    updateLandingTokens();  // Update button disabled states based on inventory
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
  // Use server inventory for both signed-in and guests; fall back to localStorage for guests with no server data yet
  const serverRt = currentInventory.storedRt ?? 0;
  const displayRt = isSignedIn ? serverRt : (serverRt > 0 ? serverRt : getTokens());
  equipRtEl.textContent = formatNumber(displayRt);
  
  // Ports from server inventory (persisted for both signed-in and guests)
  equipPortsEl.textContent = String(currentInventory.portCharges ?? 0);
  
  // Speed: check server inventory
  const hasSpeed = pendingBoosts.speedBoost || (currentInventory.speedBoosts ?? 0) > 0;
  equipSpeedEl.textContent = hasSpeed ? '✓' : '0';
  
  // Size: from server inventory (fall back to pendingBoosts for guests without server data)
  const serverSize = currentInventory.sizeBoosts ?? 0;
  const sizeCount = serverSize > 0 ? serverSize : (isSignedIn ? 0 : pendingBoosts.sizeBonus);
  equipSizeEl.textContent = sizeCount > 0 ? `+${sizeCount}` : '0';
  
  // Adopt speed boosts from inventory
  equipAdoptSpeedEl.textContent = String(currentInventory.adoptSpeedBoosts ?? 0);
  
  const hasItems = displayRt > 0 || (currentInventory.portCharges ?? 0) > 0 || 
                   (currentInventory.sizeBoosts ?? 0) > 0 || (currentInventory.adoptSpeedBoosts ?? 0) > 0 ||
                   (currentInventory.speedBoosts ?? 0) > 0;
  if (hasItems) {
    equipNoteEl.textContent = `Up to ${MAX_RT_PER_MATCH} RT auto-applied per match`;
    equipNoteEl.classList.add('signed-in');
  } else {
    equipNoteEl.textContent = 'Earn tokens by winning matches!';
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
    currentInventory = { storedRt: 0, portCharges: 0, speedBoosts: 0, sizeBoosts: 0, adoptSpeedBoosts: 0, signedIn: true };
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

// --- Page Visibility API: detect browser wake-from-sleep (mobile hibernation) ---
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;

  // Re-acquire wake lock if returning to an active match
  if (gameWs && myPlayerId) {
    requestWakeLock();
  }
  
  // Check if we have an active match but the websocket is dead
  if (currentMatchId && (!gameWs || gameWs.readyState !== WebSocket.OPEN) && !matchEndedNormally) {
    const mode = selectedMode;
    if (mode === 'ffa' || mode === 'teams') {
      // The websocket died while the page was hidden (mobile sleep)
      if (!matchDisconnectInfo) {
        matchDisconnectInfo = { matchId: currentMatchId, mode, attempts: 0 };
      }
      // Only start reconnect if not already in progress
      if (reconnectTimeoutId === null) {
        attemptAutoReconnect();
      }
    }
  }
});
