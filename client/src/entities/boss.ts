/**
 * Boss entity — PetMall plaza, boss mills, and breeder tycoon NPC.
 * Uses PixiJS Graphics + Text for the boss mode overlay.
 */

import { Container, Graphics, Text, TextStyle, Sprite, Texture } from 'pixi.js';
import { BOSS_PETMALL_RADIUS, BOSS_MILL_RADIUS, BOSS_MILL_NAMES } from 'shared';
import { BOSS_MILL_HORSE, BOSS_MILL_CAT, BOSS_MILL_DOG, BOSS_MILL_BIRD, BOSS_MILL_RABBIT } from 'shared';
import type { BossModeState, BossMill } from 'shared';

const BOSS_MILL_EMOJIS: Record<number, string> = {
  [BOSS_MILL_HORSE]: '🐴', [BOSS_MILL_CAT]: '🐈',
  [BOSS_MILL_DOG]: '🐕', [BOSS_MILL_BIRD]: '🐦', [BOSS_MILL_RABBIT]: '🐰',
};

// ---- PetMall ----
let mallContainer: Container | null = null;

function getOrCreateMall(parent: Container): Container {
  if (!mallContainer) {
    mallContainer = new Container();
    mallContainer.label = 'petmall';
    const plaza = new Graphics();
    plaza.label = 'plaza';
    mallContainer.addChild(plaza);
    const titleStyle = new TextStyle({ fontFamily: 'Rubik, sans-serif', fontSize: 24, fontWeight: 'bold', fill: '#ffd700' });
    const title = new Text({ text: '🏪 PETMALL', style: titleStyle });
    title.anchor.set(0.5);
    title.label = 'title';
    mallContainer.addChild(title);
    const subStyle = new TextStyle({ fontFamily: 'Rubik, sans-serif', fontSize: 16, fill: '#ffffff' });
    const sub = new Text({ text: 'Bring strays, get them out', style: subStyle });
    sub.anchor.set(0.5);
    sub.label = 'sub';
    mallContainer.addChild(sub);
    parent.addChild(mallContainer);
  }
  return mallContainer;
}

// ---- Mills ----
const millPool = new Map<string, Container>();

function getOrCreateMill(id: string, parent: Container): Container {
  let c = millPool.get(id);
  if (!c) {
    c = new Container();
    c.label = `mill-${id}`;
    const bg = new Graphics();
    bg.label = 'bg';
    c.addChild(bg);
    const building = new Graphics();
    building.label = 'building';
    c.addChild(building);
    const roof = new Graphics();
    roof.label = 'roof';
    c.addChild(roof);
    const nameStyle = new TextStyle({ fontFamily: 'Rubik, sans-serif', fontSize: 14, fontWeight: 'bold', fill: '#ffd700' });
    const nameText = new Text({ text: '', style: nameStyle });
    nameText.anchor.set(0.5);
    nameText.label = 'name';
    c.addChild(nameText);
    const statusStyle = new TextStyle({ fontFamily: 'Rubik, sans-serif', fontSize: 12, fill: '#ffffff' });
    const statusText = new Text({ text: '', style: statusStyle });
    statusText.anchor.set(0.5);
    statusText.label = 'status';
    c.addChild(statusText);
    millPool.set(id, c);
    parent.addChild(c);
  }
  return c;
}

// ---- Tycoon ----
let tycoonContainer: Container | null = null;

function getOrCreateTycoon(parent: Container): Container {
  if (!tycoonContainer) {
    tycoonContainer = new Container();
    tycoonContainer.label = 'tycoon';
    const gfx = new Graphics();
    gfx.label = 'body';
    tycoonContainer.addChild(gfx);
    const labelStyle = new TextStyle({ fontFamily: 'Rubik, sans-serif', fontSize: 12, fontWeight: 'bold', fill: '#ff2222' });
    const label = new Text({ text: '🎩 Breeder Tycoon', style: labelStyle });
    label.anchor.set(0.5, 1);
    label.label = 'label';
    tycoonContainer.addChild(label);
    parent.addChild(tycoonContainer);
  }
  return tycoonContainer;
}

/**
 * Update the entire boss mode overlay.
 */
export function updateBossMode(
  bossMode: BossModeState | undefined,
  parent: Container,
  viewL: number, viewR: number, viewT: number, viewB: number,
): void {
  if (!bossMode?.active) {
    // Hide everything
    if (mallContainer) mallContainer.visible = false;
    for (const c of millPool.values()) c.visible = false;
    if (tycoonContainer) tycoonContainer.visible = false;
    return;
  }

  const { mallX, mallY, mills, tycoonX, tycoonY, tycoonTargetMill, playerAtMill, rebuildingMill } = bossMode;

  // ---- PetMall ----
  const mallMargin = BOSS_PETMALL_RADIUS;
  const mallVisible = !(mallX + mallMargin < viewL || mallX - mallMargin > viewR || mallY + mallMargin < viewT || mallY - mallMargin > viewB);
  const mall = getOrCreateMall(parent);
  mall.visible = mallVisible;
  if (mallVisible) {
    mall.position.set(mallX, mallY);
    const plaza = mall.getChildByLabel('plaza') as Graphics;
    plaza.clear();
    plaza.circle(0, 0, BOSS_PETMALL_RADIUS * 0.6);
    plaza.fill({ color: 0x8b4513, alpha: 0.3 });
    const title = mall.getChildByLabel('title') as Text;
    title.position.set(0, -40);
    const sub = mall.getChildByLabel('sub') as Text;
    sub.position.set(0, 0);
  }

  // ---- Mills ----
  const usedMills = new Set<string>();
  const millMargin = 150;
  for (const mill of mills) {
    if (mill.x + millMargin < viewL || mill.x - millMargin > viewR || mill.y + millMargin < viewT || mill.y - millMargin > viewB) continue;
    const millId = String(mill.id);
    usedMills.add(millId);
    const c = getOrCreateMill(millId, parent);
    c.visible = true;
    c.position.set(mill.x, mill.y);

    const isRebuilding = rebuildingMill !== undefined && rebuildingMill === mill.id;
    const isPlayerAt = playerAtMill === mill.id;
    const isTycoonTarget = tycoonTargetMill === mill.id;
    const bw = BOSS_MILL_RADIUS * 1.4;
    const bh = BOSS_MILL_RADIUS * 1.2;

    // Background circle
    const bg = c.getChildByLabel('bg') as Graphics;
    bg.clear();
    bg.circle(0, 0, BOSS_MILL_RADIUS);
    bg.fill({ color: 0x8b4513, alpha: 0.2 });
    if (isPlayerAt) {
      bg.circle(0, 0, BOSS_MILL_RADIUS);
      bg.fill({ color: 0x00aaff, alpha: 0.15 });
    } else if (isTycoonTarget) {
      bg.circle(0, 0, BOSS_MILL_RADIUS);
      bg.fill({ color: 0xff4444, alpha: 0.15 });
    }

    // Building body
    const building = c.getChildByLabel('building') as Graphics;
    building.clear();
    const bodyColor = mill.completed ? 0x3d8b40 : isRebuilding ? 0x8b3500 : 0x8b4513;
    const strokeColor = mill.completed ? 0x2d6a30 : 0x5c2d0e;
    building.roundRect(-bw / 2, -bh / 2, bw, bh, 8);
    building.fill(bodyColor);
    building.setStrokeStyle({ width: 3, color: strokeColor });
    building.stroke();

    // Roof
    const roof = c.getChildByLabel('roof') as Graphics;
    roof.clear();
    const roofColor = mill.completed ? 0x2d6a30 : isRebuilding ? 0x5c2000 : 0x654321;
    roof.moveTo(-bw / 2 - 10, -bh / 2);
    roof.lineTo(0, -bh / 2 - 30);
    roof.lineTo(bw / 2 + 10, -bh / 2);
    roof.closePath();
    roof.fill(roofColor);
    roof.setStrokeStyle({ width: 3, color: strokeColor });
    roof.stroke();

    // Name
    const name = BOSS_MILL_NAMES[mill.petType] ?? 'Mill';
    const emoji = BOSS_MILL_EMOJIS[mill.petType] ?? '🐾';
    const nameText = c.getChildByLabel('name') as Text;
    nameText.text = `${emoji} ${name}`;
    nameText.position.set(0, -bh / 2 - 40);
    nameText.style.fill = mill.completed ? '#7bed9f' : isRebuilding ? '#ff8800' : '#ffd700';

    // Status
    const statusText = c.getChildByLabel('status') as Text;
    if (mill.completed) {
      statusText.text = '✅ Cleared!';
      statusText.style.fill = '#7bed9f';
    } else if (isRebuilding) {
      statusText.text = '🔨 Rebuilding...';
      statusText.style.fill = '#ff8800';
    } else if (isPlayerAt) {
      statusText.text = '🔓 Rescuing...';
      statusText.style.fill = '#00aaff';
      } else {
        // Calculate progress from purchased ingredients
        const totalPurchased = Object.values(mill.purchased ?? {}).reduce((a, b) => a + b, 0);
        const totalNeeded = Object.values(mill.recipe ?? {}).reduce((a, b) => a + b, 0) * mill.petCount;
        statusText.text = `${totalPurchased}/${totalNeeded}`;
      statusText.style.fill = '#ffffff';
    }
    statusText.position.set(0, bh / 2 + 20);
  }

  for (const [poolId, c] of millPool) {
    if (!usedMills.has(poolId)) c.visible = false;
  }

  // ---- Tycoon ----
  const tycoonMargin = 80;
  const tycoonVisible = !(tycoonX + tycoonMargin < viewL || tycoonX - tycoonMargin > viewR || tycoonY + tycoonMargin < viewT || tycoonY - tycoonMargin > viewB);
  const tycoon = getOrCreateTycoon(parent);
  tycoon.visible = tycoonVisible;
  if (tycoonVisible) {
    tycoon.position.set(tycoonX, tycoonY);
    const body = tycoon.getChildByLabel('body') as Graphics;
    body.clear();
    // Body
    body.ellipse(0, 0, 12, 16);
    body.fill(0x1a0808);
    // Head
    body.circle(0, -18, 8);
    body.fill(0xd4a878);
    // Hat
    body.rect(-10, -28, 20, 6);
    body.fill(0x1a0505);
    const label = tycoon.getChildByLabel('label') as Text;
    label.position.set(0, -35);
  }
}

export function clearBoss(): void {
  if (mallContainer) { mallContainer.removeFromParent(); mallContainer.destroy(); mallContainer = null; }
  for (const c of millPool.values()) { c.removeFromParent(); c.destroy(); }
  millPool.clear();
  if (tycoonContainer) { tycoonContainer.removeFromParent(); tycoonContainer.destroy(); tycoonContainer = null; }
}
