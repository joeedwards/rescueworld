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
  if (audioContext) return audioContext;
  try {
    audioContext = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
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
  playTone(440, 0.08, 'square', 0.2);
  setTimeout(() => playTone(880, 0.08, 'square', 0.15), 60);
}

export function playAdoption(): void {
  playTone(392, 0.1, 'sine', 0.25);
  setTimeout(() => playTone(523, 0.12, 'sine', 0.22), 70);
  setTimeout(() => playTone(659, 0.15, 'sine', 0.2), 140);
}

export function playStrayCollected(): void {
  playTone(330, 0.06, 'sine', 0.18);
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

// --- Van engine: subtle "good exhaust but silent" rumble when moving ---
const VAN_ENGINE_VOLUME = 0.045;
const VAN_ENGINE_FADE = 0.08;

let vanEngineOsc1: OscillatorNode | null = null;
let vanEngineOsc2: OscillatorNode | null = null;
let vanEngineGain: GainNode | null = null;
let vanEngineTargetGain = 0;

function ensureVanEngineNodes(): boolean {
  const ctx = getContext();
  if (!ctx || !getSfxEnabled()) return false;
  if (vanEngineGain) return true;
  try {
    vanEngineOsc1 = ctx.createOscillator();
    vanEngineOsc2 = ctx.createOscillator();
    vanEngineGain = ctx.createGain();
    vanEngineOsc1.type = 'triangle';
    vanEngineOsc2.type = 'sine';
    vanEngineOsc1.frequency.value = 42;
    vanEngineOsc2.frequency.value = 56;
    vanEngineOsc1.detune.value = -8;
    vanEngineOsc2.detune.value = 5;
    vanEngineOsc1.connect(vanEngineGain);
    vanEngineOsc2.connect(vanEngineGain);
    vanEngineGain.gain.value = 0;
    vanEngineGain.connect(ctx.destination);
    vanEngineOsc1.start(0);
    vanEngineOsc2.start(0);
  } catch {
    return false;
  }
  return true;
}

/**
 * Call every frame: active = van is moving (any direction pressed).
 * Smooth low rumble like a car with good exhaust, but quiet.
 */
export function updateVanEngine(active: boolean): void {
  vanEngineTargetGain = active ? VAN_ENGINE_VOLUME : 0;
  if (!active && !vanEngineGain) return; // never started, nothing to fade
  if (!ensureVanEngineNodes()) return;
  const ctx = getContext();
  if (!ctx || !vanEngineGain) return;
  vanEngineGain.gain.setTargetAtTime(vanEngineTargetGain, ctx.currentTime, 0.05);
}

/**
 * One-shot jet-engine whoosh when speed boost activates.
 */
export function playSpeedBoostWhoosh(): void {
  if (!getSfxEnabled()) return;
  const ctx = getContext();
  if (!ctx) return;
  try {
    const duration = 0.4;
    const bufferSize = ctx.sampleRate * duration;
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) data[i] = (Math.random() * 2 - 1) * 0.7;
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(3200, ctx.currentTime);
    filter.frequency.exponentialRampToValueAtTime(180, ctx.currentTime + duration);
    filter.Q.value = 0.7;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0.22, ctx.currentTime + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    source.start(ctx.currentTime);
    source.stop(ctx.currentTime + duration);
  } catch {
    // ignore
  }
}

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
