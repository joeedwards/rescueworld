/**
 * UI module — DOM element references, toast/announcement helpers,
 * and lobby/settings/inventory management.
 * Heavy UI flows (leaderboard modal, daily gift, breeder minigame) stay
 * as inline handlers in main.ts for now since they mutate many variables.
 */

// ---- DOM element references ----
export const canvas = document.getElementById('game') as HTMLCanvasElement;
export const ctx = canvas.getContext('2d')!;
export const minimap = document.getElementById('minimap') as HTMLCanvasElement;
export const minimapCtx = minimap.getContext('2d')!;
export const scoreEl = document.getElementById('score')!;
export const eventPanelEl = document.getElementById('event-panel')!;
export const eventPanelListEl = document.getElementById('event-panel-list')!;
export const eventToggleBtnEl = document.getElementById('event-toggle-btn')!;
export let eventPanelOpen = false;
export function setEventPanelOpen(v: boolean): void { eventPanelOpen = v; }
export const carriedEl = document.getElementById('carried')!;
export const tagCooldownEl = document.getElementById('tag-cooldown')!;
export const timerEl = document.getElementById('timer')!;
export const gameClockEl = document.getElementById('game-clock')!;
export const seasonBadgeEl = document.getElementById('season-badge')!;
export const leaderboardEl = document.getElementById('leaderboard')!;
export const connectionOverlayEl = document.getElementById('connection-overlay')!;
export const howToPlayEl = document.getElementById('how-to-play')!;
export const settingsBtnEl = document.getElementById('settings-btn')!;
export const settingsPanelEl = document.getElementById('settings-panel')!;
export const exitToLobbyBtnEl = document.getElementById('exit-to-lobby-btn')!;
export const musicToggleEl = document.getElementById('music-toggle') as HTMLInputElement;
export const sfxToggleEl = document.getElementById('sfx-toggle') as HTMLInputElement;
export const shelterAdoptSfxToggleEl = document.getElementById('shelter-adopt-sfx-toggle') as HTMLInputElement;
export const vanSoundSelectEl = document.getElementById('van-sound-select') as HTMLSelectElement;
export const hideStraysToggleEl = document.getElementById('hide-strays-toggle') as HTMLInputElement;
export const settingsCloseEl = document.getElementById('settings-close')!;
export const fpsSelectEl = document.getElementById('fps-select') as HTMLSelectElement | null;
export const pingEl = document.getElementById('ping')!;
export const switchServerEl = document.getElementById('switch-server')!;
export const switchServerBtnEl = document.getElementById('switch-server-btn')!;
export const authAreaEl = document.getElementById('auth-area')!;
export const landingEl = document.getElementById('landing')!;
export const gameWrapEl = document.getElementById('game-wrap')!;
export const landingPlayBtn = document.getElementById('landing-play')!;
export const landingNickInput = document.getElementById('landing-nick') as HTMLInputElement;
export const nickSaveBtn = document.getElementById('nick-save-btn') as HTMLButtonElement;
export const nickHintEl = document.getElementById('nick-hint') as HTMLElement;
export const landingMusicToggleEl = document.getElementById('landing-music-toggle') as HTMLInputElement | null;
export const landingProfileName = document.getElementById('landing-profile-name')!;
export const landingProfileAvatar = document.getElementById('landing-profile-avatar')!;
export const landingProfileActions = document.getElementById('landing-profile-actions')!;
export const landingAuthButtons = document.getElementById('landing-auth-buttons')!;
export const referralStatusEl = document.getElementById('referral-status')!;
export const referralLinkEl = document.getElementById('referral-link')!;
export const referralCopyBtn = document.getElementById('referral-copy-btn') as HTMLButtonElement;
export const referralClaimBtn = document.getElementById('referral-claim-btn') as HTMLButtonElement;
export const cookieBannerEl = document.getElementById('cookie-banner')!;
export const cookieAcceptBtn = document.getElementById('cookie-accept')!;
export const cookieEssentialBtn = document.getElementById('cookie-essential')!;
export const fightAllyOverlayEl = document.getElementById('fight-ally-overlay')!;
export const fightAllyNameEl = document.getElementById('fight-ally-name')!;
export const fightAllyFightBtn = document.getElementById('fight-ally-fight')!;
export const fightAllyAllyBtn = document.getElementById('fight-ally-ally')!;
export const cpuWarningEl = document.getElementById('cpu-warning')!;
export const actionMenuEl = document.getElementById('action-menu')!;
export const actionMenuCloseEl = document.getElementById('action-menu-close')!;
export const actionSizeTextEl = document.getElementById('action-size-text')!;
export const actionSizeBarEl = document.getElementById('action-size-bar')!;
export const actionTokensTextEl = document.getElementById('action-tokens-text')!;
export const actionTokensBarEl = document.getElementById('action-tokens-bar')!;
export const actionBuildBtnEl = document.getElementById('action-build-btn') as HTMLButtonElement;
export const actionBuildShelterItemEl = document.getElementById('action-build-shelter')!;
export const actionAdoptionCenterItemEl = document.getElementById('action-adoption-center')!;
export const actionGravityItemEl = document.getElementById('action-gravity')!;
export const actionAdvertisingItemEl = document.getElementById('action-advertising')!;
export const actionVanSpeedItemEl = document.getElementById('action-van-speed')!;
export const actionAdoptionBtnEl = document.getElementById('action-adoption-btn') as HTMLButtonElement;
export const actionGravityBtnEl = document.getElementById('action-gravity-btn') as HTMLButtonElement;
export const actionAdvertisingBtnEl = document.getElementById('action-advertising-btn') as HTMLButtonElement;
export const actionVanSpeedBtnEl = document.getElementById('action-van-speed-btn') as HTMLButtonElement;
export const groundBtnEl = document.getElementById('ground-btn')!;
export const portBtnEl = document.getElementById('port-btn')!;
export const shelterPortBtnEl = document.getElementById('shelter-port-btn')!;
export const adoptSpeedBtnEl = document.getElementById('adopt-speed-btn')!;
export const transferBtnEl = document.getElementById('transfer-btn')!;
export const buildShelterBtnEl = document.getElementById('build-shelter-btn') as HTMLButtonElement;
export const centerVanBtnEl = document.getElementById('center-van-btn')!;
export const centerShelterBtnEl = document.getElementById('center-shelter-btn')!;
export const gameTokensEl = document.getElementById('game-tokens')!;
export const lobbyOverlayEl = document.getElementById('lobby-overlay')!;
export const lobbyMessageEl = document.getElementById('lobby-message')!;
export const lobbyPlayerListEl = document.getElementById('lobby-player-list')!;
export const lobbyCountdownEl = document.getElementById('lobby-countdown')!;
export const lobbyReadyBtnEl = document.getElementById('lobby-ready-btn')!;
export const lobbyBackBtnEl = document.getElementById('lobby-back-btn')!;
export const lobbyGiftBtnEl = document.getElementById('lobby-gift-btn')!;
export const teamSelectEl = document.getElementById('team-select')!;
export const teamRedBtnEl = document.getElementById('team-red-btn')!;
export const teamBlueBtnEl = document.getElementById('team-blue-btn')!;
export const teamScoreHudEl = document.getElementById('team-score-hud')!;
export const teamScoreRedEl = document.getElementById('team-score-red')!;
export const teamScoreBlueEl = document.getElementById('team-score-blue')!;
export const observerOverlayEl = document.getElementById('observer-overlay')!;
export const observerBackBtnEl = document.getElementById('observer-back-btn')!;
export const breederMinigameEl = document.getElementById('breeder-minigame')!;
export const breederTimerEl = document.getElementById('breeder-timer')!;
export const breederTokensEl = document.getElementById('breeder-tokens')!;
export const breederPetsEl = document.getElementById('breeder-pets')!;
export const breederWarningPopupEl = document.getElementById('breeder-warning-popup')!;
export const breederWarningTextEl = document.getElementById('breeder-warning-text')!;
export const breederWarningStatsEl = document.getElementById('breeder-warning-stats')!;
export const breederWarningContinueEl = document.getElementById('breeder-warning-continue')!;
export const breederWarningRetreatEl = document.getElementById('breeder-warning-retreat')!;
export const breederFoodsEl = document.getElementById('breeder-foods')!;
export const breederResultEl = document.getElementById('breeder-result')!;
export const breederResultTitleEl = document.getElementById('breeder-result-title')!;
export const breederRewardsEl = document.getElementById('breeder-rewards')!;
export const breederCloseBtnEl = document.getElementById('breeder-close-btn')!;
export const dailyGiftModalEl = document.getElementById('daily-gift-modal')!;
export const dailyGiftCloseEl = document.getElementById('daily-gift-close')!;
export const dailyGiftSubtitleEl = document.getElementById('daily-gift-subtitle')!;
export const dailyGiftGridEl = document.getElementById('daily-gift-grid')!;
export const dailyGiftClaimBtnEl = document.getElementById('daily-gift-claim-btn') as HTMLButtonElement;
export const dailyGiftBtnEl = document.getElementById('daily-gift-btn')!;
export const serverClockTimeEl = document.getElementById('server-clock-time')!;
export const serverClockNextGiftEl = document.getElementById('server-clock-next-gift')!;
export const leaderboardModalEl = document.getElementById('leaderboard-modal')!;
export const leaderboardCloseEl = document.getElementById('leaderboard-close')!;
export const leaderboardContentEl = document.getElementById('leaderboard-content')!;
export const leaderboardMyRankEl = document.getElementById('leaderboard-my-rank')!;
export const leaderboardBtnEl = document.getElementById('leaderboard-btn')!;
export const lobbyLeaderboardContentEl = document.getElementById('lobby-leaderboard-content');
export const equipRtEl = document.getElementById('equip-rt')!;
export const equipPortsEl = document.getElementById('equip-ports')!;
export const equipSpeedEl = document.getElementById('equip-speed')!;
export const equipSizeEl = document.getElementById('equip-size')!;
export const equipAdoptSpeedEl = document.getElementById('equip-adopt-speed')!;
export const equipNoteEl = document.getElementById('equip-note')!;
export const karmaDisplayEl = document.getElementById('karma-display')!;
export const karmaPointsEl = document.getElementById('karma-points')!;
export const itemSelectOverlayEl = document.getElementById('item-select-overlay')!;
export const itemSelectConfirmBtn = document.getElementById('item-select-confirm-btn')!;
export const itemSelectSkipBtn = document.getElementById('item-select-skip-btn')!;

// ---- Toast notifications ----
let toastTimeout: ReturnType<typeof setTimeout> | null = null;

export function showToast(message: string, type: 'success' | 'error' | 'info' = 'info', allowHtml = false): void {
  let toastEl = document.getElementById('toast');
  if (!toastEl) {
    toastEl = document.createElement('div');
    toastEl.id = 'toast';
    toastEl.className = 'toast';
    document.body.appendChild(toastEl);
  }
  if (allowHtml) {
    toastEl.innerHTML = message;
  } else {
    toastEl.textContent = message;
  }
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

// ---- Announcements ----
const announcementQueue: string[] = [];
let announcementEl: HTMLElement | null = null;
let announcementAnimating = false;

export function showAnnouncement(messages: string[]): void {
  const MAX_QUEUE_SIZE = 3;
  announcementQueue.push(...messages);
  while (announcementQueue.length > MAX_QUEUE_SIZE) {
    announcementQueue.shift();
  }
  processAnnouncementQueue();
}

export function clearAnnouncements(): void {
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
  const useGreen = (isPositive && !isNegative) || (!isNegative && (msgLower.includes('event') || msgLower.includes('adoption')));
  const bgColor = useGreen ? 'rgba(46,204,113,' : 'rgba(255,107,107,';
  const glowColor = useGreen ? 'rgba(46,204,113,0.8)' : 'rgba(255,107,107,0.8)';
  const icon = useGreen ? '✅' : '⚠️';
  if (!announcementEl) {
    announcementEl = document.createElement('div');
    announcementEl.id = 'announcement-bar';
    document.body.appendChild(announcementEl);
  }
  announcementEl.style.cssText = `
    position: fixed; top: 60px; left: 0; width: 100%; height: 40px;
    background: linear-gradient(90deg, ${bgColor}0) 0%, ${bgColor}0.4) 15%, ${bgColor}0.4) 85%, ${bgColor}0) 100%);
    display: flex; align-items: center; justify-content: center;
    overflow: hidden; z-index: 150; pointer-events: none;
  `;
  const textEl = document.createElement('div');
  textEl.style.cssText = `
    white-space: nowrap; font: bold 18px 'Rubik', sans-serif;
    color: #fff; text-shadow: 2px 2px 4px rgba(0,0,0,0.8), 0 0 10px ${glowColor};
    animation: announcementScroll 8s linear forwards;
  `;
  textEl.textContent = `${icon} ${message} ${icon}`;
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
  announcementEl.style.display = 'flex';
  announcementEl.innerHTML = '';
  announcementEl.appendChild(textEl);
  textEl.addEventListener('animationend', () => {
    announcementAnimating = false;
    if (announcementQueue.length === 0 && announcementEl) {
      announcementEl.style.display = 'none';
    }
    processAnnouncementQueue();
  });
}

// ---- Token management ----
const TOKEN_KEY = 'rescueworld_tokens';
export function getTokens(): number {
  const v = localStorage.getItem(TOKEN_KEY);
  return v ? parseInt(v, 10) || 0 : 0;
}
export function setTokens(n: number): void {
  localStorage.setItem(TOKEN_KEY, String(n));
}
export function updateLandingTokens(): void {
  const el = document.getElementById('landing-tokens');
  if (el) el.textContent = String(getTokens());
}

// ---- Formatting ----
export function formatNumber(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

// ---- Connection error overlay ----
export function showConnectionError(msg: string): void {
  connectionOverlayEl.classList.remove('hidden');
  connectionOverlayEl.innerHTML = `<h2>Connection Failed</h2><p>${msg}</p><button onclick="location.reload()">Retry</button>`;
}

// ---- Auth state ----
export let isSignedIn = false;
export let currentDisplayName: string | null = null;
export let currentUserId: string | null = null;
export let currentShelterColor: string | null = null;
export function setIsSignedIn(v: boolean): void { isSignedIn = v; }
export function setCurrentDisplayName(v: string | null): void { currentDisplayName = v; }
export function setCurrentUserId(v: string | null): void { currentUserId = v; }
export function setCurrentShelterColor(v: string | null): void { currentShelterColor = v; }

// ---- Mode selector ----
export type GameMode = 'ffa' | 'teams' | 'solo';
const MODE_KEY = 'rescueworld_mode';
const saved = localStorage.getItem(MODE_KEY);
export let selectedMode: GameMode = (saved === 'ffa' || saved === 'teams' || saved === 'solo') ? saved : 'solo';
export let selectedTeam: 'red' | 'blue' = 'red';
export let currentMatchMode: GameMode = 'solo';
export function setSelectedMode(m: GameMode): void {
  selectedMode = m;
  localStorage.setItem(MODE_KEY, m);
}
export function setSelectedTeam(t: 'red' | 'blue'): void { selectedTeam = t; }
export function setCurrentMatchMode(m: GameMode): void { currentMatchMode = m; }

// ---- Minimap preferences ----
export let hideStraysOnMinimap = localStorage.getItem('hideStrays') === 'true';
export function setHideStraysOnMinimap(v: boolean): void {
  hideStraysOnMinimap = v;
  localStorage.setItem('hideStrays', v ? 'true' : 'false');
}

// ---- Color key ----
export const COLOR_KEY = 'rescueworld_color';
export const SKIN_KEY = 'rescueworld_skin';
export const REF_KEY = 'rescueworld_ref';

// ---- Ally popup data ----
export const allyRequestPopupEl = document.getElementById('ally-request-popup') as HTMLElement;
export const allyRequesterNameEl = document.getElementById('ally-requester-name') as HTMLElement;
export const allyAcceptBtnEl = document.getElementById('ally-accept-btn') as HTMLButtonElement;
export const allyDenyBtnEl = document.getElementById('ally-deny-btn') as HTMLButtonElement;

// ---- Transfer popup data ----
export const transferConfirmPopupEl = document.getElementById('transfer-confirm-popup') as HTMLElement;
export const transferConfirmCountEl = document.getElementById('transfer-confirm-count') as HTMLElement;
export const transferConfirmBtnEl = document.getElementById('transfer-confirm-btn') as HTMLButtonElement;
export const transferCancelBtnEl = document.getElementById('transfer-cancel-btn') as HTMLButtonElement;

// ---- Abandon popup data ----
export const abandonConfirmPopupEl = document.getElementById('abandon-confirm-popup') as HTMLElement;
export const abandonConfirmBtnEl = document.getElementById('abandon-confirm-btn') as HTMLButtonElement;
export const abandonCancelBtnEl = document.getElementById('abandon-cancel-btn') as HTMLButtonElement;
