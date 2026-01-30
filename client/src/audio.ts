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

let musicAudio: HTMLAudioElement | null = null;
function getMusicUrl(): string {
  const meta = import.meta as unknown as { env?: { BASE_URL?: string } };
  const base = typeof meta.env?.BASE_URL === 'string' ? meta.env.BASE_URL : '/';
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
      musicAudio.addEventListener('error', () => {
        if (musicAudio && !musicAudio.src.endsWith('/music.mp3')) {
          musicAudio.src = '/music.mp3';
          void musicAudio.play().catch(() => {});
        }
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
