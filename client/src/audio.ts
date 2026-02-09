/**
 * Audio: music (MP3 loop), SFX (Web Audio API generated tones), toggles (localStorage).
 */

const MUSIC_KEY = 'rescueworld_music';
const MUSIC_VOLUME_KEY = 'rescueworld_music_volume';
const SFX_KEY = 'rescueworld_sfx';
const SFX_VOLUME_KEY = 'rescueworld_sfx_volume';
const VAN_SOUND_TYPE_KEY = 'rescueworld_van_sound_type';
const SHELTER_ADOPT_SFX_KEY = 'rescueworld_shelter_adopt_sfx';

export type VanSoundType = 'off' | 'camaro' | 'beetle' | 'ev';

function getStored(key: string, fallback: boolean): boolean {
  try {
    const v = localStorage.getItem(key);
    if (v === '0' || v === 'false') return false;
    if (v === '1' || v === 'true') return true;
  } catch {
    // ignore
  }
  return fallback;
}

function setStored(key: string, value: boolean): void {
  try {
    localStorage.setItem(key, value ? '1' : '0');
  } catch {
    // ignore
  }
}

export function getMusicEnabled(): boolean {
  return getStored(MUSIC_KEY, true);
}

/** Get the music volume (0-100). Defaults to 100. */
export function getMusicVolume(): number {
  try {
    const v = localStorage.getItem(MUSIC_VOLUME_KEY);
    if (v != null) {
      const n = parseInt(v, 10);
      if (!isNaN(n) && n >= 0 && n <= 100) return n;
    }
  } catch { /* ignore */ }
  return 100;
}

/** Set the music volume (0-100). Also updates playing audio elements. */
export function setMusicVolume(vol: number): void {
  const clamped = Math.max(0, Math.min(100, Math.round(vol)));
  try { localStorage.setItem(MUSIC_VOLUME_KEY, String(clamped)); } catch { /* ignore */ }
  const fraction = clamped / 100;
  if (musicAudio) musicAudio.volume = fraction;
  if (bossAudio) bossAudio.volume = fraction;
  // If volume > 0 and music is enabled but paused, start playing
  if (clamped > 0) {
    setStored(MUSIC_KEY, true);
    if (isBossMusicActive && bossAudio && bossAudio.paused) {
      const p = bossAudio.play();
      if (p && typeof p.catch === 'function') p.catch(() => {});
    } else if (musicAudio && musicAudio.paused) {
      const p = musicAudio.play();
      if (p && typeof p.catch === 'function') p.catch(() => {});
    }
  } else {
    // Volume 0 = muted
    setStored(MUSIC_KEY, false);
    if (musicAudio) musicAudio.pause();
    if (bossAudio) bossAudio.pause();
  }
}

export function setMusicEnabled(on: boolean): void {
  setStored(MUSIC_KEY, on);
  const vol = on ? getMusicVolume() / 100 : 0;
  if (musicAudio) musicAudio.volume = vol;
  if (!on && musicAudio) musicAudio.pause();
  // Also handle boss music
  if (!on && bossAudio) bossAudio.pause();
  if (on && isBossMusicActive && bossAudio) {
    bossAudio.volume = vol;
    const p = bossAudio.play();
    if (p && typeof p.catch === 'function') p.catch(() => {});
  }
}

export function getSfxEnabled(): boolean {
  return getStored(SFX_KEY, true);
}

export function setSfxEnabled(on: boolean): void {
  setStored(SFX_KEY, on);
}

/** Get the SFX volume (0-100). Defaults to 100. */
export function getSfxVolume(): number {
  try {
    const v = localStorage.getItem(SFX_VOLUME_KEY);
    if (v != null) {
      const n = parseInt(v, 10);
      if (!isNaN(n) && n >= 0 && n <= 100) return n;
    }
  } catch { /* ignore */ }
  return 100;
}

/** Set the SFX volume (0-100). Also updates enabled state. */
export function setSfxVolume(vol: number): void {
  const clamped = Math.max(0, Math.min(100, Math.round(vol)));
  try { localStorage.setItem(SFX_VOLUME_KEY, String(clamped)); } catch { /* ignore */ }
  if (clamped > 0) {
    setStored(SFX_KEY, true);
  } else {
    setStored(SFX_KEY, false);
    stopEngineLoop();
  }
}

/** Get the effective SFX volume fraction (0-1), accounting for enabled state. */
export function getSfxVolumeFraction(): number {
  if (!getSfxEnabled()) return 0;
  return getSfxVolume() / 100;
}

export function getShelterAdoptSfxEnabled(): boolean {
  return getStored(SHELTER_ADOPT_SFX_KEY, true);
}

export function setShelterAdoptSfxEnabled(on: boolean): void {
  setStored(SHELTER_ADOPT_SFX_KEY, on);
}

export function getVanSoundType(): VanSoundType {
  try {
    const v = localStorage.getItem(VAN_SOUND_TYPE_KEY);
    if (v === 'off' || v === 'camaro' || v === 'beetle' || v === 'ev') return v;
  } catch {
    // ignore
  }
  return 'camaro'; // Default to Camaro
}

export function setVanSoundType(type: VanSoundType): void {
  try {
    localStorage.setItem(VAN_SOUND_TYPE_KEY, type);
  } catch {
    // ignore
  }
}

// Legacy compatibility
export function getVanSoundsEnabled(): boolean {
  return getVanSoundType() !== 'off';
}

export function setVanSoundsEnabled(on: boolean): void {
  setVanSoundType(on ? 'camaro' : 'off');
}

let audioContext: AudioContext | null = null;
function getContext(): AudioContext | null {
  if (audioContext) {
    // Resume if suspended (browser autoplay policy)
    if (audioContext.state === 'suspended') {
      audioContext.resume().catch(() => {});
    }
    return audioContext;
  }
  try {
    audioContext = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    // Resume immediately in case it starts suspended
    if (audioContext.state === 'suspended') {
      audioContext.resume().catch(() => {});
    }
  } catch {
    return null;
  }
  return audioContext;
}

function playTone(frequency: number, duration: number, type: OscillatorType = 'sine', volume = 0.3): void {
  if (!getSfxEnabled()) return;
  const volFraction = getSfxVolumeFraction();
  if (volFraction <= 0) return;
  const ctx = getContext();
  if (!ctx) return;
  try {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = frequency;
    osc.type = type;
    gain.gain.setValueAtTime(volume * volFraction, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + duration);
  } catch {
    // ignore
  }
}

export function playPickupGrowth(): void {
  playTone(523, 0.12, 'sine', 0.25);
  setTimeout(() => playTone(659, 0.1, 'sine', 0.2), 80);
}

export function playPickupSpeed(): void {
  // "Turbo Ignition" - dramatic bass-drop effect for speed boost activation
  if (!getSfxEnabled()) return;
  const vf = getSfxVolumeFraction();
  if (vf <= 0) return;
  const ctx = getContext();
  if (!ctx) return;
  try {
    // Layer 1: Descending frequency sweep 150Hz down to 60Hz (reverse power-up)
    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.connect(gain1);
    gain1.connect(ctx.destination);
    osc1.type = 'sawtooth';
    osc1.frequency.setValueAtTime(150, ctx.currentTime);
    osc1.frequency.exponentialRampToValueAtTime(60, ctx.currentTime + 0.12);
    gain1.gain.setValueAtTime(0.28 * vf, ctx.currentTime);
    gain1.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.18);
    osc1.start(ctx.currentTime);
    osc1.stop(ctx.currentTime + 0.18);

    // Layer 2: Square wave punch
    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.connect(gain2);
    gain2.connect(ctx.destination);
    osc2.type = 'square';
    osc2.frequency.value = 100;
    gain2.gain.setValueAtTime(0.20 * vf, ctx.currentTime);
    gain2.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.08);
    osc2.start(ctx.currentTime);
    osc2.stop(ctx.currentTime + 0.08);

    // Layer 3: Rising harmonic triangle (delayed)
    setTimeout(() => {
      const ctx2 = getContext();
      if (!ctx2) return;
      const osc3 = ctx2.createOscillator();
      const gain3 = ctx2.createGain();
      osc3.connect(gain3);
      gain3.connect(ctx2.destination);
      osc3.type = 'triangle';
      osc3.frequency.setValueAtTime(200, ctx2.currentTime);
      osc3.frequency.exponentialRampToValueAtTime(400, ctx2.currentTime + 0.10);
      gain3.gain.setValueAtTime(0.18 * vf, ctx2.currentTime);
      gain3.gain.exponentialRampToValueAtTime(0.001, ctx2.currentTime + 0.12);
      osc3.start(ctx2.currentTime);
      osc3.stop(ctx2.currentTime + 0.12);
    }, 40);

    // Layer 4: Sub-bass rumble
    const osc4 = ctx.createOscillator();
    const gain4 = ctx.createGain();
    osc4.connect(gain4);
    gain4.connect(ctx.destination);
    osc4.type = 'sine';
    osc4.frequency.value = 50;
    gain4.gain.setValueAtTime(0.22 * vf, ctx.currentTime);
    gain4.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15);
    osc4.start(ctx.currentTime);
    osc4.stop(ctx.currentTime + 0.15);
  } catch {
    // ignore
  }
}

/** Cat adoption: happy purring trill - rapid soft warble rising in pitch */
function playAdoptionCat(): void {
  playTone(880, 0.06, 'sine', 0.18);
  setTimeout(() => playTone(988, 0.06, 'sine', 0.16), 50);
  setTimeout(() => playTone(1047, 0.06, 'sine', 0.14), 100);
  setTimeout(() => playTone(1175, 0.08, 'sine', 0.16), 150);
  // Purr undertone
  setTimeout(() => playTone(220, 0.15, 'triangle', 0.08), 60);
}

/** Dog adoption: excited bark - two short bright yips + happy tail wag */
function playAdoptionDog(): void {
  // First yip
  playTone(587, 0.06, 'square', 0.15);
  setTimeout(() => playTone(440, 0.04, 'square', 0.10), 30);
  // Second yip (higher pitch = more excited)
  setTimeout(() => playTone(659, 0.06, 'square', 0.14), 120);
  setTimeout(() => playTone(523, 0.04, 'square', 0.09), 150);
  // Happy rising finish
  setTimeout(() => playTone(784, 0.10, 'sine', 0.12), 200);
}

/** Bird adoption: cheerful chirp - fast rising tweet sequence */
function playAdoptionBird(): void {
  playTone(1319, 0.04, 'sine', 0.18);
  setTimeout(() => playTone(1568, 0.05, 'sine', 0.16), 40);
  setTimeout(() => playTone(1760, 0.04, 'sine', 0.14), 80);
  setTimeout(() => playTone(1568, 0.03, 'sine', 0.12), 120);
  setTimeout(() => playTone(2093, 0.08, 'sine', 0.15), 160);
  // Fluttery trill
  setTimeout(() => playTone(1760, 0.03, 'triangle', 0.08), 200);
  setTimeout(() => playTone(2093, 0.03, 'triangle', 0.08), 230);
}

/** Rabbit adoption: gentle hop - soft bouncy thuds with a happy squeak */
function playAdoptionRabbit(): void {
  // Soft hop thuds
  playTone(262, 0.08, 'sine', 0.15);
  setTimeout(() => playTone(330, 0.07, 'sine', 0.14), 90);
  setTimeout(() => playTone(392, 0.07, 'sine', 0.13), 170);
  // Tiny squeak of joy
  setTimeout(() => playTone(1175, 0.05, 'triangle', 0.10), 240);
  setTimeout(() => playTone(1319, 0.06, 'triangle', 0.12), 280);
}

/** Horse adoption: proud whinny - rising sweep with warm harmonics */
function playAdoptionHorse(): void {
  if (!getSfxEnabled()) return;
  const vf = getSfxVolumeFraction();
  if (vf <= 0) return;
  const ctx = getContext();
  if (!ctx) return;
  try {
    // Whinny sweep: rising sine with vibrato
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(220, ctx.currentTime);
    osc.frequency.linearRampToValueAtTime(440, ctx.currentTime + 0.15);
    osc.frequency.linearRampToValueAtTime(350, ctx.currentTime + 0.25);
    gain.gain.setValueAtTime(0.15 * vf, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.30);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.30);

    // Warm body tone
    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.connect(gain2);
    gain2.connect(ctx.destination);
    osc2.type = 'sine';
    osc2.frequency.value = 165;
    gain2.gain.setValueAtTime(0.12 * vf, ctx.currentTime);
    gain2.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.20);
    osc2.start(ctx.currentTime);
    osc2.stop(ctx.currentTime + 0.20);
  } catch {
    // ignore
  }
  // Stamp of approval
  setTimeout(() => playTone(110, 0.08, 'sine', 0.12), 250);
}

/** Special/golden pet adoption: magical sparkle fanfare */
function playAdoptionSpecial(): void {
  playTone(523, 0.08, 'sine', 0.20);
  setTimeout(() => playTone(659, 0.08, 'sine', 0.18), 60);
  setTimeout(() => playTone(784, 0.08, 'sine', 0.18), 120);
  setTimeout(() => playTone(1047, 0.12, 'sine', 0.22), 180);
  // Sparkle overtones
  setTimeout(() => playTone(2093, 0.06, 'sine', 0.08), 220);
  setTimeout(() => playTone(2637, 0.06, 'sine', 0.06), 260);
  // Reward bass
  setTimeout(() => playTone(131, 0.15, 'triangle', 0.10), 100);
}

// Pet type constants (must match shared/src/types.ts)
const _PET_CAT = 0;
const _PET_DOG = 1;
const _PET_BIRD = 2;
const _PET_RABBIT = 3;
const _PET_SPECIAL = 4;

/** Play a happy adoption sound unique to the pet type. */
export function playAdoptionByType(petType: number): void {
  switch (petType) {
    case _PET_CAT: playAdoptionCat(); break;
    case _PET_DOG: playAdoptionDog(); break;
    case _PET_BIRD: playAdoptionBird(); break;
    case _PET_RABBIT: playAdoptionRabbit(); break;
    case _PET_SPECIAL: playAdoptionSpecial(); break;
    default: playAdoptionCat(); break; // Fallback
  }
}

/** Play adoption sounds for multiple pets (staggers them slightly so they don't overlap). */
export function playAdoptionSounds(petTypes: number[]): void {
  if (petTypes.length === 0) return;
  // Play the first immediately, stagger the rest by 300ms each
  playAdoptionByType(petTypes[0]);
  for (let i = 1; i < Math.min(petTypes.length, 4); i++) {
    const type = petTypes[i];
    setTimeout(() => playAdoptionByType(type), i * 300);
  }
}

export function playDropOff(): void {
  // "Karma Reward" - deep satisfying impact with rewarding chord progression
  // Layer 1: Deep bass punch for impact
  playTone(65, 0.15, 'sawtooth', 0.30);
  // Layer 2: Sub-bass rumble (felt more than heard)
  playTone(40, 0.20, 'sine', 0.20);
  // Layer 3: Reward chord - staggered triangle tones
  setTimeout(() => playTone(330, 0.12, 'triangle', 0.18), 80);
  setTimeout(() => playTone(415, 0.12, 'triangle', 0.15), 120);
  setTimeout(() => playTone(523, 0.14, 'triangle', 0.18), 160);
  // Layer 4: High shimmer coin-like finish
  setTimeout(() => playTone(880, 0.10, 'sine', 0.08), 200);
}

export function playStrayCollected(): void {
  // "Karma Pulse" - satisfying bass thump with warm harmonics for rescue feeling
  // Layer 1: Deep bass hit - the heartbeat of rescue
  playTone(80, 0.12, 'sawtooth', 0.25);
  // Layer 2: Warm body tone (delayed 20ms)
  setTimeout(() => playTone(220, 0.10, 'sine', 0.18), 20);
  // Layer 3: Subtle sparkle overtone (delayed 40ms)
  setTimeout(() => playTone(660, 0.08, 'triangle', 0.10), 40);
}

export function playPickupBoost(): void {
  // Energetic "power-up" sound for boosts (growth, speed, port)
  playTone(440, 0.06, 'square', 0.15);
  setTimeout(() => playTone(554, 0.06, 'square', 0.12), 40);
  setTimeout(() => playTone(659, 0.08, 'triangle', 0.18), 80);
}

export function playMatchEnd(): void {
  playTone(523, 0.15, 'sine', 0.25);
  setTimeout(() => playTone(659, 0.15, 'sine', 0.22), 120);
  setTimeout(() => playTone(784, 0.2, 'sine', 0.2), 240);
}

export function playWelcome(): void {
  playTone(440, 0.08, 'sine', 0.2);
  setTimeout(() => playTone(554, 0.08, 'sine', 0.18), 80);
  setTimeout(() => playTone(659, 0.12, 'sine', 0.2), 160);
}

export function playAttackWarning(): void {
  // Urgent low-frequency alert tone
  playTone(220, 0.15, 'sawtooth', 0.35);
  setTimeout(() => playTone(180, 0.12, 'sawtooth', 0.3), 100);
  setTimeout(() => playTone(220, 0.1, 'sawtooth', 0.25), 200);
}

export function playPort(): void {
  // Teleport/warp sound - rising frequency sweep
  if (!getSfxEnabled()) return;
  const vf = getSfxVolumeFraction();
  if (vf <= 0) return;
  const ctx = getContext();
  if (!ctx) return;
  try {
    // Create a frequency sweep from low to high
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = 'sine';
    // Sweep from 200Hz to 800Hz over 0.15s
    osc.frequency.setValueAtTime(200, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(800, ctx.currentTime + 0.15);
    gain.gain.setValueAtTime(0.25 * vf, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.2);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.2);
    
    // Add a second harmonic for richer sound
    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.connect(gain2);
    gain2.connect(ctx.destination);
    osc2.type = 'triangle';
    osc2.frequency.setValueAtTime(400, ctx.currentTime);
    osc2.frequency.exponentialRampToValueAtTime(1200, ctx.currentTime + 0.12);
    gain2.gain.setValueAtTime(0.15 * vf, ctx.currentTime);
    gain2.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15);
    osc2.start(ctx.currentTime);
    osc2.stop(ctx.currentTime + 0.15);
  } catch {
    // ignore
  }
}

// ============================================================================
// VAN ENGINE SOUNDS - 1968 Camaro purr + jet swoosh (speed boost). Gated by "Van sounds" setting.
// ============================================================================

interface EngineNodes {
  baseOsc: OscillatorNode;
  harmonicOsc: OscillatorNode;
  lfo: OscillatorNode;
  masterGain: GainNode;
  baseGain: GainNode;
  harmonicGain: GainNode;
  noiseSource: AudioBufferSourceNode | null;
  noiseGain: GainNode | null;
  extraOscs?: OscillatorNode[]; // Additional oscillators
  extraGains?: GainNode[]; // Gain nodes that can be modulated
  extraFilters?: BiquadFilterNode[]; // Filters that can be modulated
  extraSources?: (ConstantSourceNode | AudioBufferSourceNode)[]; // Other sources
  engineType?: VanSoundType;
}

let engineNodes: EngineNodes | null = null;
let boostEngineNodes: EngineNodes | null = null;
let engineState: 'off' | 'normal' | 'boost' = 'off';
let currentThrottle = 0; // 0 = idle, 1 = full throttle

function createNoiseBuffer(ctx: AudioContext, duration: number): AudioBuffer {
  const sampleRate = ctx.sampleRate;
  const length = sampleRate * duration;
  const buffer = ctx.createBuffer(1, length, sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) {
    data[i] = Math.random() * 2 - 1;
  }
  return buffer;
}

function createCamaroEngine(ctx: AudioContext, masterGain: GainNode): EngineNodes {
  // 1969 Camaro Z28 small block V8: deep loping burble with "potato-potato" character
  const volume = 0.18;

  // V8 firing frequency at ~750 RPM idle = ~25 Hz fundamental
  const baseOsc = ctx.createOscillator();
  const baseGain = ctx.createGain();
  baseOsc.type = 'sine';
  baseOsc.frequency.value = 28;
  baseGain.gain.value = volume * 0.7;
  baseOsc.connect(baseGain);
  baseGain.connect(masterGain);

  // Second harmonic for body
  const harmonicOsc = ctx.createOscillator();
  const harmonicGain = ctx.createGain();
  harmonicOsc.type = 'sine';
  harmonicOsc.frequency.value = 55;
  harmonicGain.gain.value = volume * 0.5;
  harmonicOsc.connect(harmonicGain);
  harmonicGain.connect(masterGain);

  // Third oscillator for throaty midrange
  const midOsc = ctx.createOscillator();
  const midGain = ctx.createGain();
  midOsc.type = 'sine';
  midOsc.frequency.value = 82;
  midGain.gain.value = volume * 0.25;
  midOsc.connect(midGain);
  midGain.connect(masterGain);

  // LFO for loping "burble" rhythm
  const lfo = ctx.createOscillator();
  const lfoGain = ctx.createGain();
  lfo.type = 'sine';
  lfo.frequency.value = 3.5;
  lfoGain.gain.value = volume * 0.25;
  lfo.connect(lfoGain);
  lfoGain.connect(masterGain.gain);

  // Second slower LFO for camshaft irregularity
  const lfo2 = ctx.createOscillator();
  const lfo2Gain = ctx.createGain();
  lfo2.type = 'sine';
  lfo2.frequency.value = 1.2;
  lfo2Gain.gain.value = volume * 0.1;
  lfo2.connect(lfo2Gain);
  lfo2Gain.connect(masterGain.gain);

  // Lowpass filtered noise for exhaust rumble
  let noiseSource: AudioBufferSourceNode | null = null;
  let noiseGain: GainNode | null = null;
  try {
    const noiseBuffer = createNoiseBuffer(ctx, 2);
    noiseSource = ctx.createBufferSource();
    noiseSource.buffer = noiseBuffer;
    noiseSource.loop = true;
    const noiseFilter = ctx.createBiquadFilter();
    noiseFilter.type = 'lowpass';
    noiseFilter.frequency.value = 120;
    noiseFilter.Q.value = 0.8;
    noiseGain = ctx.createGain();
    noiseGain.gain.value = 0.04;
    noiseSource.connect(noiseFilter);
    noiseFilter.connect(noiseGain);
    noiseGain.connect(masterGain);
    noiseSource.start();
  } catch { /* ignore */ }

  midOsc.start();
  lfo2.start();
  baseOsc.start();
  harmonicOsc.start();
  lfo.start();

  return { baseOsc, harmonicOsc, lfo, masterGain, baseGain, harmonicGain, noiseSource, noiseGain, extraOscs: [midOsc, lfo2] };
}

// Helper functions for Beetle engine
function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

function mapRange(x: number, inLo: number, inHi: number, outLo: number, outHi: number): number {
  const t = (x - inLo) / (inHi - inLo);
  const u = clamp(t, 0, 1);
  return outLo + (outHi - outLo) * u;
}

function makePulseCurve(n: number): Float32Array {
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    const rect = Math.max(0, x);
    curve[i] = Math.pow(rect, 0.35);
  }
  return curve;
}

function createBeetleEngine(ctx: AudioContext, masterGain: GainNode): EngineNodes {
  // VW Beetle air-cooled flat-4 based on accurate engine synthesis
  // Features: sawtooth+square oscillators, body resonance, mechanical noise,
  // pulse waveshaper for firing pattern, pitch LFO for wobble, compressor

  // === OSCILLATORS: Sawtooth + Square with slight detune ===
  const baseOsc = ctx.createOscillator(); // oscA
  const harmonicOsc = ctx.createOscillator(); // oscB
  baseOsc.type = 'sawtooth';
  harmonicOsc.type = 'square';

  // === FILTERS ===
  // Lowpass to shape oscillator tone
  const lowpass = ctx.createBiquadFilter();
  lowpass.type = 'lowpass';
  lowpass.frequency.value = 650;
  lowpass.Q.value = 1.1;

  // Body resonance bandpass (characteristic VW body sound)
  const bodyBP = ctx.createBiquadFilter();
  bodyBP.type = 'bandpass';
  bodyBP.frequency.value = 160;
  bodyBP.Q.value = 0.9;

  // Mechanical noise bandpass (valve train clatter at 1800Hz)
  const mechBP = ctx.createBiquadFilter();
  mechBP.type = 'bandpass';
  mechBP.frequency.value = 1800;
  mechBP.Q.value = 3.0;

  // === GAINS ===
  const oscGain = ctx.createGain();
  oscGain.gain.value = 0.55;

  const noiseGain = ctx.createGain();
  noiseGain.gain.value = 0.03;

  const ampGain = ctx.createGain(); // Main amplitude modulation point
  ampGain.gain.value = 0.25;

  const outGain = ctx.createGain();
  outGain.gain.value = 0.9;

  // === COMPRESSOR for dynamics control ===
  const compressor = ctx.createDynamicsCompressor();
  compressor.threshold.value = -18;
  compressor.knee.value = 12;
  compressor.ratio.value = 3;
  compressor.attack.value = 0.01;
  compressor.release.value = 0.12;

  // === PULSE WAVESHAPER for 4-cylinder firing pattern ===
  const pulseOsc = ctx.createOscillator();
  pulseOsc.type = 'sine';

  const pulseShaper = ctx.createWaveShaper();
  pulseShaper.curve = makePulseCurve(1024) as Float32Array<ArrayBuffer>;

  const pulseGain = ctx.createGain();
  pulseGain.gain.value = 0.10;

  const pulseBias = ctx.createConstantSource();
  pulseBias.offset.value = 0.35;

  // Pulse modulation chain -> ampGain.gain
  pulseOsc.connect(pulseShaper);
  pulseShaper.connect(pulseGain);
  pulseGain.connect(ampGain.gain);
  pulseBias.connect(ampGain.gain);

  // === PITCH LFO for engine wobble/irregularity ===
  const pitchLfo = ctx.createOscillator();
  pitchLfo.type = 'sine';
  pitchLfo.frequency.value = 2.2;

  const pitchLfoGain = ctx.createGain();
  pitchLfoGain.gain.value = 3.0;

  pitchLfo.connect(pitchLfoGain);
  pitchLfoGain.connect(baseOsc.frequency);
  pitchLfoGain.connect(harmonicOsc.frequency);

  // === NOISE SOURCE for mechanical clatter ===
  const noiseSrc = ctx.createBufferSource();
  noiseSrc.buffer = createNoiseBuffer(ctx, 1);
  noiseSrc.loop = true;

  // === SIGNAL CHAIN ===
  // Oscillators -> oscGain -> lowpass -> bodyBP -> ampGain
  baseOsc.connect(oscGain);
  harmonicOsc.connect(oscGain);
  oscGain.connect(lowpass);
  lowpass.connect(bodyBP);
  bodyBP.connect(ampGain);

  // Noise -> mechBP -> noiseGain -> ampGain
  noiseSrc.connect(mechBP);
  mechBP.connect(noiseGain);
  noiseGain.connect(ampGain);

  // ampGain -> compressor -> outGain -> masterGain
  ampGain.connect(compressor);
  compressor.connect(outGain);
  outGain.connect(masterGain);

  // Set initial RPM (idle ~1200 RPM for moving)
  const idleRPM = 1200;
  const baseHz = mapRange(idleRPM, 900, 4200, 70, 190);
  const detuneHz = mapRange(idleRPM, 900, 4200, 2.0, 7.0);
  baseOsc.frequency.value = baseHz;
  harmonicOsc.frequency.value = baseHz + detuneHz;

  const lpHz = mapRange(idleRPM, 900, 4200, 450, 1200);
  const bodyHz = mapRange(idleRPM, 900, 4200, 140, 240);
  lowpass.frequency.value = lpHz;
  bodyBP.frequency.value = bodyHz;

  const firingHz = (idleRPM / 60) * 2; // 4-cyl fires twice per revolution
  pulseOsc.frequency.value = firingHz;

  // Start all sources
  baseOsc.start();
  harmonicOsc.start();
  noiseSrc.start();
  pulseOsc.start();
  pulseBias.start();
  pitchLfo.start();

  // Store references for throttle modulation
  // baseOsc = oscA, harmonicOsc = oscB, lfo = pulseOsc (firing)
  // extraOscs = [pitchLfo], extraGains = [oscGain, noiseGain, ampGain, outGain, pulseGain]
  // extraFilters = [lowpass, bodyBP, mechBP], extraSources = [pulseBias]
  return {
    baseOsc,
    harmonicOsc,
    lfo: pulseOsc,
    masterGain,
    baseGain: oscGain,
    harmonicGain: outGain,
    noiseSource: noiseSrc,
    noiseGain,
    extraOscs: [pitchLfo],
    extraGains: [oscGain, noiseGain, ampGain, outGain, pulseGain],
    extraFilters: [lowpass, bodyBP, mechBP],
    extraSources: [pulseBias],
    engineType: 'beetle'
  };
}

function createEVEngine(ctx: AudioContext, masterGain: GainNode): EngineNodes {
  // Silent EV: subtle high-frequency motor whine, barely audible
  const volume = 0.06;

  // High frequency motor whine
  const baseOsc = ctx.createOscillator();
  const baseGain = ctx.createGain();
  baseOsc.type = 'sine';
  baseOsc.frequency.value = 420;
  baseGain.gain.value = volume * 0.5;
  baseOsc.connect(baseGain);
  baseGain.connect(masterGain);

  // Slightly detuned second whine for richness
  const harmonicOsc = ctx.createOscillator();
  const harmonicGain = ctx.createGain();
  harmonicOsc.type = 'sine';
  harmonicOsc.frequency.value = 424;
  harmonicGain.gain.value = volume * 0.4;
  harmonicOsc.connect(harmonicGain);
  harmonicGain.connect(masterGain);

  // Very subtle LFO for slight wavering
  const lfo = ctx.createOscillator();
  const lfoGain = ctx.createGain();
  lfo.type = 'sine';
  lfo.frequency.value = 0.5;
  lfoGain.gain.value = volume * 0.05;
  lfo.connect(lfoGain);
  lfoGain.connect(masterGain.gain);

  baseOsc.start();
  harmonicOsc.start();
  lfo.start();

  return { baseOsc, harmonicOsc, lfo, masterGain, baseGain, harmonicGain, noiseSource: null, noiseGain: null };
}

function createTurboDieselBoost(ctx: AudioContext, masterGain: GainNode): EngineNodes {
  // Turbo diesel boost: low rumble + turbo spool whine + wastegate flutter
  const volume = 0.22;

  // Diesel rumble (low, rough)
  const baseOsc = ctx.createOscillator();
  const baseGain = ctx.createGain();
  baseOsc.type = 'sine';
  baseOsc.frequency.value = 32;
  baseGain.gain.value = volume * 0.6;
  baseOsc.connect(baseGain);
  baseGain.connect(masterGain);

  // Turbo spool whine (rising pitch effect simulated with detuned oscillators)
  const harmonicOsc = ctx.createOscillator();
  const harmonicGain = ctx.createGain();
  harmonicOsc.type = 'sine';
  harmonicOsc.frequency.value = 380;
  harmonicGain.gain.value = volume * 0.25;
  harmonicOsc.connect(harmonicGain);
  harmonicGain.connect(masterGain);

  // Second turbo harmonic for richer whine
  const turbo2 = ctx.createOscillator();
  const turbo2Gain = ctx.createGain();
  turbo2.type = 'sine';
  turbo2.frequency.value = 520;
  turbo2Gain.gain.value = volume * 0.15;
  turbo2.connect(turbo2Gain);
  turbo2Gain.connect(masterGain);

  // Diesel clatter LFO
  const lfo = ctx.createOscillator();
  const lfoGain = ctx.createGain();
  lfo.type = 'sine';
  lfo.frequency.value = 12;
  lfoGain.gain.value = volume * 0.15;
  lfo.connect(lfoGain);
  lfoGain.connect(baseGain.gain);

  // Wastegate flutter simulation
  const flutter = ctx.createOscillator();
  const flutterGain = ctx.createGain();
  flutter.type = 'square';
  flutter.frequency.value = 18;
  flutterGain.gain.value = volume * 0.08;
  flutter.connect(flutterGain);
  flutterGain.connect(masterGain.gain);

  // Turbo whoosh noise (not vacuum cleaner - lower frequency, less harsh)
  let noiseSource: AudioBufferSourceNode | null = null;
  let noiseGain: GainNode | null = null;
  try {
    const noiseBuffer = createNoiseBuffer(ctx, 2);
    noiseSource = ctx.createBufferSource();
    noiseSource.buffer = noiseBuffer;
    noiseSource.loop = true;
    const noiseFilter = ctx.createBiquadFilter();
    noiseFilter.type = 'lowpass';
    noiseFilter.frequency.value = 400;
    noiseFilter.Q.value = 0.5;
    noiseGain = ctx.createGain();
    noiseGain.gain.value = 0.08;
    noiseSource.connect(noiseFilter);
    noiseFilter.connect(noiseGain);
    noiseGain.connect(masterGain);
    noiseSource.start();
  } catch { /* ignore */ }

  turbo2.start();
  flutter.start();
  baseOsc.start();
  harmonicOsc.start();
  lfo.start();

  return { baseOsc, harmonicOsc, lfo, masterGain, baseGain, harmonicGain, noiseSource, noiseGain, extraOscs: [turbo2, flutter] };
}

function createEngineNodes(ctx: AudioContext, isBoost: boolean): EngineNodes | null {
  const soundType = getVanSoundType();
  if (soundType === 'off') return null;

  const masterGain = ctx.createGain();
  masterGain.gain.value = 0;
  masterGain.connect(ctx.destination);

  if (isBoost) {
    return createTurboDieselBoost(ctx, masterGain);
  }

  switch (soundType) {
    case 'camaro': return createCamaroEngine(ctx, masterGain);
    case 'beetle': return createBeetleEngine(ctx, masterGain);
    case 'ev': return createEVEngine(ctx, masterGain);
    default: return createCamaroEngine(ctx, masterGain);
  }
}

function fadeInEngine(nodes: EngineNodes, ctx: AudioContext): void {
  const now = ctx.currentTime;
  const vf = getSfxVolumeFraction();
  nodes.masterGain.gain.setValueAtTime(0, now);
  nodes.masterGain.gain.linearRampToValueAtTime(vf, now + 0.1);
}

function fadeOutEngine(nodes: EngineNodes, ctx: AudioContext, callback?: () => void): void {
  const now = ctx.currentTime;
  nodes.masterGain.gain.setValueAtTime(nodes.masterGain.gain.value, now);
  nodes.masterGain.gain.linearRampToValueAtTime(0, now + 0.1);
  setTimeout(() => {
    try {
      nodes.baseOsc.stop();
      nodes.harmonicOsc.stop();
      nodes.lfo.stop();
      if (nodes.noiseSource) nodes.noiseSource.stop();
      if (nodes.extraOscs) {
        for (const osc of nodes.extraOscs) osc.stop();
      }
      nodes.baseOsc.disconnect();
      nodes.harmonicOsc.disconnect();
      nodes.lfo.disconnect();
      nodes.masterGain.disconnect();
      if (nodes.noiseSource) nodes.noiseSource.disconnect();
      if (nodes.extraOscs) {
        for (const osc of nodes.extraOscs) osc.disconnect();
      }
    } catch {
      // ignore
    }
    if (callback) callback();
  }, 120);
}

export function startEngineLoop(): void {
  if (!getSfxEnabled() || getVanSoundType() === 'off') return;
  if (engineState === 'normal') return;
  const ctx = getContext();
  if (!ctx) return;
  try {
    if (engineState === 'boost' && boostEngineNodes) {
      fadeOutEngine(boostEngineNodes, ctx, () => { boostEngineNodes = null; });
    }
    const nodes = createEngineNodes(ctx, false);
    if (!nodes) return;
    engineNodes = nodes;
    fadeInEngine(engineNodes, ctx);
    engineState = 'normal';
  } catch {
    // ignore
  }
}

function forceStopNodes(nodes: EngineNodes | null): void {
  if (!nodes) return;
  // Stop each node independently so one error doesn't prevent others from stopping
  const tryStop = (fn: () => void) => { try { fn(); } catch { /* ignore already-stopped */ } };
  tryStop(() => { nodes.masterGain.gain.value = 0; });
  tryStop(() => nodes.baseOsc.stop());
  tryStop(() => nodes.harmonicOsc.stop());
  tryStop(() => nodes.lfo.stop());
  if (nodes.noiseSource) tryStop(() => nodes.noiseSource!.stop());
  if (nodes.extraOscs) {
    for (const osc of nodes.extraOscs) tryStop(() => osc.stop());
  }
  if (nodes.extraSources) {
    for (const src of nodes.extraSources) tryStop(() => { if ('stop' in src) src.stop(); });
  }
  tryStop(() => nodes.baseOsc.disconnect());
  tryStop(() => nodes.harmonicOsc.disconnect());
  tryStop(() => nodes.lfo.disconnect());
  tryStop(() => nodes.masterGain.disconnect());
  if (nodes.noiseSource) tryStop(() => nodes.noiseSource!.disconnect());
  if (nodes.noiseGain) tryStop(() => nodes.noiseGain!.disconnect());
  if (nodes.extraOscs) {
    for (const osc of nodes.extraOscs) tryStop(() => osc.disconnect());
  }
  if (nodes.extraGains) {
    for (const gain of nodes.extraGains) tryStop(() => gain.disconnect());
  }
  if (nodes.extraFilters) {
    for (const filter of nodes.extraFilters) tryStop(() => filter.disconnect());
  }
  if (nodes.extraSources) {
    for (const src of nodes.extraSources) tryStop(() => src.disconnect());
  }
}

export function stopEngineLoop(): void {
  // Force stop all nodes immediately without requiring context
  forceStopNodes(engineNodes);
  forceStopNodes(boostEngineNodes);
  engineNodes = null;
  boostEngineNodes = null;
  engineState = 'off';
  currentThrottle = 0;
}

export function startBoostEngineLoop(): void {
  if (!getSfxEnabled() || getVanSoundType() === 'off') return;
  if (engineState === 'boost') return;
  const ctx = getContext();
  if (!ctx) return;
  try {
    if (engineState === 'normal' && engineNodes) {
      fadeOutEngine(engineNodes, ctx, () => { engineNodes = null; });
    }
    const nodes = createEngineNodes(ctx, true);
    if (!nodes) return;
    boostEngineNodes = nodes;
    fadeInEngine(boostEngineNodes, ctx);
    engineState = 'boost';
  } catch {
    // ignore
  }
}

export function stopBoostEngineLoop(): void {
  if (engineState === 'boost') {
    startEngineLoop();
  }
}

export function updateEngineState(isMoving: boolean, isBoosted: boolean): void {
  if (!isMoving) {
    if (engineState !== 'off') stopEngineLoop();
    return;
  }
  if (isBoosted) {
    if (engineState !== 'boost') startBoostEngineLoop();
  } else {
    if (engineState !== 'normal') startEngineLoop();
  }
}

/**
 * Update engine throttle for throttle-responsive sounds (Beetle uses full RPM simulation).
 * @param throttle 0 = idle/coasting, 1 = full acceleration
 */
export function updateEngineThrottle(throttle: number): void {
  const t = clamp(throttle, 0, 1);
  currentThrottle = t;

  const nodes = engineNodes;
  if (!nodes || nodes.engineType !== 'beetle') return;

  const ctx = getContext();
  if (!ctx) return;

  const now = ctx.currentTime;
  const ramp = 0.06; // Smooth ramping time constant

  // Map throttle to RPM: idle (0) = 1200 RPM, full (1) = 3800 RPM
  // (Not using full 900-4200 range to keep it realistic for casual driving)
  const rpm = mapRange(t, 0, 1, 1200, 3800);

  // === Oscillator frequencies (sawtooth + detuned square) ===
  const baseHz = mapRange(rpm, 900, 4200, 70, 190);
  const detuneHz = mapRange(rpm, 900, 4200, 2.0, 7.0);
  nodes.baseOsc.frequency.cancelScheduledValues(now);
  nodes.harmonicOsc.frequency.cancelScheduledValues(now);
  nodes.baseOsc.frequency.setTargetAtTime(baseHz, now, ramp);
  nodes.harmonicOsc.frequency.setTargetAtTime(baseHz + detuneHz, now, ramp);

  // === Filter frequencies ===
  if (nodes.extraFilters && nodes.extraFilters.length >= 2) {
    const lowpass = nodes.extraFilters[0];
    const bodyBP = nodes.extraFilters[1];
    const lpHz = mapRange(rpm, 900, 4200, 450, 1200);
    const bodyHz = mapRange(rpm, 900, 4200, 140, 240);
    lowpass.frequency.cancelScheduledValues(now);
    bodyBP.frequency.cancelScheduledValues(now);
    lowpass.frequency.setTargetAtTime(lpHz, now, ramp);
    bodyBP.frequency.setTargetAtTime(bodyHz, now, ramp);
  }

  // === Mechanical noise level ===
  if (nodes.noiseGain) {
    const noise = mapRange(rpm, 900, 4200, 0.02, 0.06);
    nodes.noiseGain.gain.cancelScheduledValues(now);
    nodes.noiseGain.gain.setTargetAtTime(noise, now, ramp);
  }

  // === Firing pulse frequency (4-cyl fires twice per revolution) ===
  // lfo is actually the pulse oscillator for Beetle
  const firingHz = (rpm / 60) * 2;
  nodes.lfo.frequency.cancelScheduledValues(now);
  nodes.lfo.frequency.setTargetAtTime(firingHz, now, ramp);

  // === Pulse depth and bias ===
  if (nodes.extraGains && nodes.extraGains.length >= 5) {
    const pulseGain = nodes.extraGains[4]; // pulseGain is at index 4
    const pulseDepth = mapRange(rpm, 900, 4200, 0.14, 0.08);
    pulseGain.gain.cancelScheduledValues(now);
    pulseGain.gain.setTargetAtTime(pulseDepth, now, ramp);
  }

  if (nodes.extraSources && nodes.extraSources.length >= 1) {
    const pulseBias = nodes.extraSources[0] as ConstantSourceNode;
    if (pulseBias.offset) {
      const bias = mapRange(rpm, 900, 4200, 0.30, 0.42);
      pulseBias.offset.cancelScheduledValues(now);
      pulseBias.offset.setTargetAtTime(bias, now, ramp);
    }
  }
}

// ============================================================================
// MUSIC SYSTEM
// ============================================================================

let musicAudio: HTMLAudioElement | null = null;
function getMusicUrl(): string {
  // Prefer Vite's BASE_URL (from vite.config base), fallback to current path so
  // music loads from the same path as the app (e.g. games.vo.ly/rescueworld/music.mp3).
  const meta = import.meta as unknown as { env?: { BASE_URL?: string } };
  let base = typeof meta.env?.BASE_URL === 'string' ? meta.env.BASE_URL : '';
  if (!base || base === '/') {
    const pathname = typeof window !== 'undefined' ? window.location.pathname : '';
    if (pathname.includes('rescueworld')) base = '/rescueworld/';
    else {
      const lastSlash = pathname.lastIndexOf('/');
      base = lastSlash <= 0 ? '/' : pathname.slice(0, lastSlash + 1);
    }
  }
  const path = base.endsWith('/') ? `${base}music.mp3` : `${base}/music.mp3`;
  return path;
}

export function playMusic(): void {
  if (!getMusicEnabled()) return;
  if (isBossMusicActive) return; // Don't override boss music
  try {
    if (!musicAudio) {
      musicAudio = new Audio();
      musicAudio.loop = true;
      musicAudio.volume = getMusicVolume() / 100;
      musicAudio.preload = 'auto';
      musicAudio.src = getMusicUrl();
      let musicTriedFallback = false;
      musicAudio.addEventListener('error', () => {
        if (!musicAudio || musicTriedFallback) return;
        musicTriedFallback = true;
        musicAudio.src = '/rescueworld/music.mp3';
        void musicAudio.play().catch(() => {});
      });
      musicAudio.load();
    }
    musicAudio.volume = getMusicEnabled() ? getMusicVolume() / 100 : 0;
    const p = musicAudio.play();
    if (p && typeof p.catch === 'function') p.catch(() => {});
  } catch {
    // ignore
  }
}

export function stopMusic(): void {
  if (musicAudio) musicAudio.pause();
}

// ============================================================================
// BOSS MODE MUSIC
// ============================================================================

let bossAudio: HTMLAudioElement | null = null;
let isBossMusicActive = false;

function getBossMusicUrl(): string {
  const meta = import.meta as unknown as { env?: { BASE_URL?: string } };
  let base = typeof meta.env?.BASE_URL === 'string' ? meta.env.BASE_URL : '';
  if (!base || base === '/') {
    const pathname = typeof window !== 'undefined' ? window.location.pathname : '';
    if (pathname.includes('rescueworld')) base = '/rescueworld/';
    else {
      const lastSlash = pathname.lastIndexOf('/');
      base = lastSlash <= 0 ? '/' : pathname.slice(0, lastSlash + 1);
    }
  }
  const path = base.endsWith('/') ? `${base}boss.mp3` : `${base}/boss.mp3`;
  return path;
}

/** Switch to boss mode music (pauses regular music, plays boss.mp3) */
export function playBossMusic(): void {
  if (!getMusicEnabled()) return;
  if (isBossMusicActive) return;
  isBossMusicActive = true;

  // Pause regular music
  if (musicAudio) musicAudio.pause();

  try {
    if (!bossAudio) {
      bossAudio = new Audio();
      bossAudio.loop = true;
      bossAudio.volume = getMusicVolume() / 100;
      bossAudio.preload = 'auto';
      bossAudio.src = getBossMusicUrl();
      let bossTriedFallback = false;
      bossAudio.addEventListener('error', () => {
        if (!bossAudio || bossTriedFallback) return;
        bossTriedFallback = true;
        bossAudio.src = '/rescueworld/boss.mp3';
        void bossAudio.play().catch(() => {});
      });
      bossAudio.load();
    }
    bossAudio.volume = getMusicVolume() / 100;
    bossAudio.currentTime = 0;
    const p = bossAudio.play();
    if (p && typeof p.catch === 'function') p.catch(() => {});
  } catch {
    // ignore
  }
}

/** Stop boss mode music and resume regular music if enabled */
export function stopBossMusic(): void {
  if (!isBossMusicActive) return;
  isBossMusicActive = false;

  if (bossAudio) {
    bossAudio.pause();
    bossAudio.currentTime = 0;
  }

  // Resume regular music if music is enabled
  if (getMusicEnabled() && musicAudio) {
    const p = musicAudio.play();
    if (p && typeof p.catch === 'function') p.catch(() => {});
  }
}

/** Check if boss music is currently active */
export function isBossMusicPlaying(): boolean {
  return isBossMusicActive;
}
