/**
 * Audio: music (MP3 loop), SFX (Web Audio API generated tones), toggles (localStorage).
 */

const MUSIC_KEY = 'rescueworld_music';
const SFX_KEY = 'rescueworld_sfx';

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

export function setMusicEnabled(on: boolean): void {
  setStored(MUSIC_KEY, on);
  if (musicAudio) musicAudio.volume = on ? 1 : 0;
  if (!on && musicAudio) musicAudio.pause();
}

export function getSfxEnabled(): boolean {
  return getStored(SFX_KEY, true);
}

export function setSfxEnabled(on: boolean): void {
  setStored(SFX_KEY, on);
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
  const ctx = getContext();
  if (!ctx) return;
  try {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = frequency;
    osc.type = type;
    gain.gain.setValueAtTime(volume, ctx.currentTime);
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
    gain1.gain.setValueAtTime(0.28, ctx.currentTime);
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
    gain2.gain.setValueAtTime(0.20, ctx.currentTime);
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
      gain3.gain.setValueAtTime(0.18, ctx2.currentTime);
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
    gain4.gain.setValueAtTime(0.22, ctx.currentTime);
    gain4.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15);
    osc4.start(ctx.currentTime);
    osc4.stop(ctx.currentTime + 0.15);
  } catch {
    // ignore
  }
}

export function playAdoption(): void {
  playTone(392, 0.1, 'sine', 0.25);
  setTimeout(() => playTone(523, 0.12, 'sine', 0.22), 70);
  setTimeout(() => playTone(659, 0.15, 'sine', 0.2), 140);
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
    gain.gain.setValueAtTime(0.25, ctx.currentTime);
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
    gain2.gain.setValueAtTime(0.15, ctx.currentTime);
    gain2.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15);
    osc2.start(ctx.currentTime);
    osc2.stop(ctx.currentTime + 0.15);
  } catch {
    // ignore
  }
}

// ============================================================================
// ENGINE SOUND SYSTEM - Continuous van movement audio
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
}

let engineNodes: EngineNodes | null = null;
let boostEngineNodes: EngineNodes | null = null;
let engineState: 'off' | 'normal' | 'boost' = 'off';

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

function createEngineNodes(ctx: AudioContext, isBoost: boolean): EngineNodes {
  // Configuration based on boost state
  const baseFreq = isBoost ? 110 : 75;
  const harmonicFreq = isBoost ? 220 : 150;
  const lfoFreq = isBoost ? 8 : 4;
  const volume = isBoost ? 0.14 : 0.12;

  // Master gain for fade in/out
  const masterGain = ctx.createGain();
  masterGain.gain.value = 0;
  masterGain.connect(ctx.destination);

  // Base oscillator - sawtooth for engine growl
  const baseOsc = ctx.createOscillator();
  const baseGain = ctx.createGain();
  baseOsc.type = 'sawtooth';
  baseOsc.frequency.value = baseFreq;
  baseGain.gain.value = volume;
  baseOsc.connect(baseGain);
  baseGain.connect(masterGain);

  // Harmonic oscillator - triangle for richness
  const harmonicOsc = ctx.createOscillator();
  const harmonicGain = ctx.createGain();
  harmonicOsc.type = 'triangle';
  harmonicOsc.frequency.value = harmonicFreq;
  harmonicGain.gain.value = volume * 0.3;
  harmonicOsc.connect(harmonicGain);
  harmonicGain.connect(masterGain);

  // LFO for engine pulse rhythm
  const lfo = ctx.createOscillator();
  const lfoGain = ctx.createGain();
  lfo.type = 'sine';
  lfo.frequency.value = lfoFreq;
  lfoGain.gain.value = volume * 0.3; // Modulation depth
  lfo.connect(lfoGain);
  lfoGain.connect(baseGain.gain);

  // Add extra harmonic for boost mode
  if (isBoost) {
    const extraOsc = ctx.createOscillator();
    const extraGain = ctx.createGain();
    extraOsc.type = 'sine';
    extraOsc.frequency.value = 330;
    extraGain.gain.value = volume * 0.2;
    extraOsc.connect(extraGain);
    extraGain.connect(masterGain);
    extraOsc.start();
  }

  // Filtered noise for road/air texture
  let noiseSource: AudioBufferSourceNode | null = null;
  let noiseGain: GainNode | null = null;
  try {
    const noiseBuffer = createNoiseBuffer(ctx, 2);
    noiseSource = ctx.createBufferSource();
    noiseSource.buffer = noiseBuffer;
    noiseSource.loop = true;

    // Filter the noise - lowpass for road, bandpass for boost whoosh
    const noiseFilter = ctx.createBiquadFilter();
    if (isBoost) {
      noiseFilter.type = 'bandpass';
      noiseFilter.frequency.value = 500;
      noiseFilter.Q.value = 0.7;
    } else {
      noiseFilter.type = 'lowpass';
      noiseFilter.frequency.value = 200;
    }

    noiseGain = ctx.createGain();
    noiseGain.gain.value = isBoost ? 0.06 : 0.03;

    noiseSource.connect(noiseFilter);
    noiseFilter.connect(noiseGain);
    noiseGain.connect(masterGain);
    noiseSource.start();
  } catch {
    // Noise is optional, ignore errors
  }

  // Start oscillators
  baseOsc.start();
  harmonicOsc.start();
  lfo.start();

  return {
    baseOsc,
    harmonicOsc,
    lfo,
    masterGain,
    baseGain,
    harmonicGain,
    noiseSource,
    noiseGain,
  };
}

function fadeInEngine(nodes: EngineNodes, ctx: AudioContext): void {
  const now = ctx.currentTime;
  nodes.masterGain.gain.setValueAtTime(0, now);
  nodes.masterGain.gain.linearRampToValueAtTime(1, now + 0.1);
}

function fadeOutEngine(nodes: EngineNodes, ctx: AudioContext, callback?: () => void): void {
  const now = ctx.currentTime;
  nodes.masterGain.gain.setValueAtTime(nodes.masterGain.gain.value, now);
  nodes.masterGain.gain.linearRampToValueAtTime(0, now + 0.1);
  
  // Cleanup after fade
  setTimeout(() => {
    try {
      nodes.baseOsc.stop();
      nodes.harmonicOsc.stop();
      nodes.lfo.stop();
      if (nodes.noiseSource) nodes.noiseSource.stop();
      nodes.baseOsc.disconnect();
      nodes.harmonicOsc.disconnect();
      nodes.lfo.disconnect();
      nodes.masterGain.disconnect();
      if (nodes.noiseSource) nodes.noiseSource.disconnect();
    } catch {
      // ignore cleanup errors
    }
    if (callback) callback();
  }, 120);
}

export function startEngineLoop(): void {
  if (!getSfxEnabled()) return;
  if (engineState === 'normal') return;
  
  const ctx = getContext();
  if (!ctx) return;

  try {
    // Stop boost engine if running
    if (engineState === 'boost' && boostEngineNodes) {
      fadeOutEngine(boostEngineNodes, ctx, () => {
        boostEngineNodes = null;
      });
    }

    // Create and start normal engine
    engineNodes = createEngineNodes(ctx, false);
    fadeInEngine(engineNodes, ctx);
    engineState = 'normal';
  } catch {
    // ignore
  }
}

export function stopEngineLoop(): void {
  const ctx = getContext();
  if (!ctx) return;

  try {
    if (engineNodes) {
      fadeOutEngine(engineNodes, ctx, () => {
        engineNodes = null;
      });
    }
    if (boostEngineNodes) {
      fadeOutEngine(boostEngineNodes, ctx, () => {
        boostEngineNodes = null;
      });
    }
    engineState = 'off';
  } catch {
    // ignore
  }
}

export function startBoostEngineLoop(): void {
  if (!getSfxEnabled()) return;
  if (engineState === 'boost') return;

  const ctx = getContext();
  if (!ctx) return;

  try {
    // Stop normal engine if running
    if (engineState === 'normal' && engineNodes) {
      fadeOutEngine(engineNodes, ctx, () => {
        engineNodes = null;
      });
    }

    // Create and start boost engine
    boostEngineNodes = createEngineNodes(ctx, true);
    fadeInEngine(boostEngineNodes, ctx);
    engineState = 'boost';
  } catch {
    // ignore
  }
}

export function stopBoostEngineLoop(): void {
  // Transition back to normal engine if we were boosting
  if (engineState === 'boost') {
    startEngineLoop();
  }
}

/**
 * Update engine state based on movement and boost status.
 * Call this from the game loop.
 */
export function updateEngineState(isMoving: boolean, isBoosted: boolean): void {
  if (!isMoving) {
    if (engineState !== 'off') {
      stopEngineLoop();
    }
    return;
  }

  // Moving - determine which engine to use
  if (isBoosted) {
    if (engineState !== 'boost') {
      startBoostEngineLoop();
    }
  } else {
    if (engineState !== 'normal') {
      startEngineLoop();
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
  try {
    if (!musicAudio) {
      musicAudio = new Audio();
      musicAudio.loop = true;
      musicAudio.volume = 1;
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
    musicAudio.volume = getMusicEnabled() ? 1 : 0;
    const p = musicAudio.play();
    if (p && typeof p.catch === 'function') p.catch(() => {});
  } catch {
    // ignore
  }
}

export function stopMusic(): void {
  if (musicAudio) musicAudio.pause();
}
