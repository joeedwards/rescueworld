/**
 * Vans entity — player vehicle rendering.
 * Uses offscreen Canvas 2D rendered to PixiJS Sprite for GPU compositing.
 */

import { Container, Sprite, Texture, Text, TextStyle } from 'pixi.js';
import type { PlayerState } from 'shared';
import { VAN_MAX_CAPACITY } from 'shared';

const VAN_FIXED_SIZE = 50;

/** Hash a string to an HSL color */
function hashColor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return `hsl(${h % 360}, 72%, 58%)`;
}

// ---- Offscreen canvas rendering ----

const VAN_CANVAS_W = 160;
const VAN_CANVAS_H = 140;

function renderVanToCanvas(
  p: PlayerState,
  isMe: boolean,
  facingDir: number,
  nowTick: number,
  sentAllyRequests: Set<string>,
  relationships: Map<string, 'friend' | 'foe'>,
): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = VAN_CANVAS_W;
  c.height = VAN_CANVAS_H;
  const ctx = c.getContext('2d')!;
  const cx = VAN_CANVAS_W / 2;
  const cy = VAN_CANVAS_H / 2;
  const half = VAN_FIXED_SIZE;
  const vanWidth = half * 2;
  const vanHeight = half * 1.2;
  const cornerRadius = Math.min(12, half * 0.3);
  const wheelRadius = Math.min(10, half * 0.25);

  ctx.save();
  ctx.translate(cx, cy);

  // Speed boost fire (before van body)
  const hasTemporaryBoost = (p.speedBoostUntil ?? 0) > nowTick;
  const hasPermanentSpeed = !!p.vanSpeedUpgrade;
  if (!p.eliminated && (hasTemporaryBoost || hasPermanentSpeed)) {
    const scale = hasTemporaryBoost ? 1.0 : 0.5;
    const fireDistance = half + 8 * scale;
    const fireX = -facingDir * fireDistance;
    const time = Date.now() / 100;
    const flicker = Math.sin(time * 3) * 0.3 + 0.7;
    const glowRadius = 25 * scale;
    const gradient = ctx.createRadialGradient(fireX, 0, 0, fireX, 0, glowRadius);
    gradient.addColorStop(0, `rgba(255,200,50,${0.6 * flicker * (hasTemporaryBoost ? 1 : 0.6)})`);
    gradient.addColorStop(0.5, `rgba(255,100,20,${0.4 * flicker * (hasTemporaryBoost ? 1 : 0.6)})`);
    gradient.addColorStop(1, 'rgba(255,50,0,0)');
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(fireX, 0, glowRadius, 0, Math.PI * 2);
    ctx.fill();
  }

  // Flip for facing direction
  if (facingDir < 0) ctx.scale(-1, 1);

  // Van body fill
  let fillStyle: string | CanvasGradient;
  const isBot = p.id.startsWith('cpu-');
  let baseColor = isMe ? '#7bed9f' : hashColor(p.id);
  if (p.eliminated) {
    fillStyle = 'rgba(100,100,100,0.5)';
  } else if (isBot && p.team) {
    baseColor = p.team === 'red' ? '#c0392b' : '#2980b9';
    fillStyle = baseColor;
  } else if (p.shelterColor?.startsWith('gradient:')) {
    const parts = p.shelterColor.split(':');
    const grad = ctx.createLinearGradient(-half, 0, half, 0);
    grad.addColorStop(0, parts[1] || '#ff5500');
    grad.addColorStop(1, parts[2] || '#00aaff');
    fillStyle = grad;
  } else if (p.shelterColor) {
    fillStyle = p.shelterColor;
    baseColor = p.shelterColor;
  } else {
    fillStyle = baseColor;
  }

  ctx.shadowColor = 'rgba(0,0,0,0.4)';
  ctx.shadowBlur = 10;
  ctx.fillStyle = fillStyle;
  ctx.beginPath();
  ctx.roundRect(-half, -vanHeight * 0.5, vanWidth, vanHeight, cornerRadius);
  ctx.fill();
  ctx.shadowBlur = 0;

  // Cabin
  const cabinWidth = vanWidth * 0.3;
  ctx.fillStyle = 'rgba(0,0,0,0.15)';
  ctx.beginPath();
  ctx.roundRect(-half + vanWidth - cabinWidth, -vanHeight * 0.5, cabinWidth, vanHeight, [0, cornerRadius, cornerRadius, 0]);
  ctx.fill();

  // Window
  const windowPad = 4;
  const teamWindowColor = p.team === 'red' ? 'rgba(231,76,60,0.75)' : p.team === 'blue' ? 'rgba(52,152,219,0.75)' : null;
  ctx.fillStyle = teamWindowColor ?? 'rgba(135,206,250,0.7)';
  ctx.beginPath();
  ctx.roundRect(-half + vanWidth - cabinWidth + windowPad, -vanHeight * 0.5 + windowPad, cabinWidth - windowPad * 2, vanHeight * 0.4, 4);
  ctx.fill();

  // Border
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

  // Wheels
  ctx.fillStyle = '#333';
  const frontWheelX = half - vanWidth * 0.3;
  const rearWheelX = -half + vanWidth * 0.3;
  const wheelY = vanHeight * 0.5 + wheelRadius * 0.3;
  ctx.beginPath();
  ctx.arc(rearWheelX, wheelY, wheelRadius, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(frontWheelX, wheelY, wheelRadius, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#888';
  ctx.beginPath();
  ctx.arc(rearWheelX, wheelY, wheelRadius * 0.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(frontWheelX, wheelY, wheelRadius * 0.4, 0, Math.PI * 2);
  ctx.fill();

  // Undo flip for text
  if (facingDir < 0) ctx.scale(-1, 1);

  // Pet count label
  const displayCapacity = Math.min(Math.floor(p.size), VAN_MAX_CAPACITY);
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 13px Rubik, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(`Pets: ${p.petsInside.length}/${displayCapacity}`, 0, 10);

  // Name (for other players)
  if (!isMe) {
    const nameText = p.displayName ?? p.id;
    ctx.fillText(nameText, 0, -vanHeight * 0.5 - 10);
    const rel = relationships.get(p.id);
    if (rel) {
      const nameWidth = ctx.measureText(nameText).width;
      ctx.beginPath();
      ctx.arc(nameWidth / 2 + 8, -vanHeight * 0.5 - 10, 5, 0, Math.PI * 2);
      ctx.fillStyle = rel === 'friend' ? '#2ecc71' : '#e74c3c';
      ctx.fill();
    }
  }

  if (p.eliminated) {
    ctx.font = '18px sans-serif';
    ctx.fillText('\uD83D\uDC7B', 0, 0);
  }

  ctx.restore();
  return c;
}

// ---- PixiJS pool ----
const vanPool = new Map<string, { container: Container; lastKey: string }>();

function vanCacheKey(p: PlayerState, facingDir: number): string {
  return `${p.id}-${facingDir}-${p.petsInside.length}-${Math.floor(p.size)}-${p.eliminated ? 1 : 0}-${p.shelterColor ?? ''}-${p.team ?? ''}`;
}

export function updateVans(
  players: PlayerState[],
  myPlayerId: string | null,
  predictedPlayer: PlayerState | null,
  playerDisplayX: number | null,
  playerDisplayY: number | null,
  vanFacingDir: Map<string, number>,
  nowTick: number,
  sentAllyRequests: Set<string>,
  relationships: Map<string, 'friend' | 'foe'>,
  parent: Container,
): void {
  const used = new Set<string>();
  const sorted = [...players].sort((a, b) => a.size - b.size);

  for (const pl of sorted) {
    const isMe = pl.id === myPlayerId;
    let drawX: number, drawY: number;
    if (isMe && predictedPlayer) {
      drawX = playerDisplayX ?? predictedPlayer.x;
      drawY = playerDisplayY ?? predictedPlayer.y;
    } else {
      drawX = pl.x;
      drawY = pl.y;
    }
    if (!Number.isFinite(drawX) || !Number.isFinite(drawY)) continue;

    used.add(pl.id);
    const facingDir = vanFacingDir.get(pl.id) ?? 1;
    const key = vanCacheKey(pl, facingDir);

    let entry = vanPool.get(pl.id);
    if (!entry || entry.lastKey !== key) {
      const canvas = renderVanToCanvas(pl, isMe, facingDir, nowTick, sentAllyRequests, relationships);
      const tex = Texture.from(canvas);
      if (entry) {
        const sprite = entry.container.getChildByLabel('sprite') as Sprite;
        sprite.texture.destroy(true);
        sprite.texture = tex;
        entry.lastKey = key;
      } else {
        const container = new Container();
        container.label = `van-${pl.id}`;
        const sprite = new Sprite(tex);
        sprite.anchor.set(0.5);
        sprite.label = 'sprite';
        container.addChild(sprite);
        parent.addChild(container);
        entry = { container, lastKey: key };
        vanPool.set(pl.id, entry);
      }
    }

    entry.container.position.set(drawX, drawY);
    entry.container.visible = true;
    // Ensure render order matches sort order
    parent.setChildIndex(entry.container, parent.children.indexOf(entry.container));
  }

  // Hide unused
  for (const [id, entry] of vanPool) {
    if (!used.has(id)) entry.container.visible = false;
  }
}

export function clearVans(): void {
  for (const entry of vanPool.values()) { entry.container.removeFromParent(); entry.container.destroy(); }
  vanPool.clear();
}
