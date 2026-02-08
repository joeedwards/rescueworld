/**
 * Pickups entity — growth/speed/port orbs (squares) and breeder camp sprites.
 * Uses a pool of containers to avoid per-frame allocation.
 */

import { Container, Graphics, Text, TextStyle, Sprite, Texture } from 'pixi.js';
import { GROWTH_ORB_RADIUS } from 'shared';
import { PICKUP_TYPE_GROWTH, PICKUP_TYPE_SPEED, PICKUP_TYPE_PORT, PICKUP_TYPE_BREEDER, PICKUP_TYPE_SHELTER_PORT } from 'shared';
import type { PickupState } from 'shared';

/** Color config per pickup type */
const PICKUP_COLORS: Record<number, { fill: number; stroke: number; label: string }> = {
  [PICKUP_TYPE_GROWTH]: { fill: 0x7bed9f, stroke: 0x2d5a38, label: '+Size' },
  [PICKUP_TYPE_SPEED]: { fill: 0x70a3ff, stroke: 0x2d4a6e, label: 'Speed' },
  [PICKUP_TYPE_PORT]: { fill: 0xc77dff, stroke: 0x6a3d7a, label: 'Random' },
  [PICKUP_TYPE_SHELTER_PORT]: { fill: 0x10b981, stroke: 0x047857, label: 'Home' },
};

// ---- Pool ----
const pool = new Map<string, Container>();

function getOrCreatePickup(id: string, parent: Container): Container {
  let c = pool.get(id);
  if (!c) {
    c = new Container();
    c.label = `pickup-${id}`;
    const gfx = new Graphics();
    gfx.label = 'gfx';
    c.addChild(gfx);
    const labelText = new Text({
      text: '',
      style: new TextStyle({ fontFamily: 'Rubik, sans-serif', fontSize: 10, fill: '#333' }),
    });
    labelText.anchor.set(0.5, 0);
    labelText.label = 'label';
    c.addChild(labelText);
    pool.set(id, c);
    parent.addChild(c);
  }
  return c;
}

/** Create or update a simple orb pickup (not breeder camp) */
function drawOrbPickup(c: Container, u: PickupState): void {
  const h = GROWTH_ORB_RADIUS;
  const config = PICKUP_COLORS[u.type] ?? PICKUP_COLORS[PICKUP_TYPE_GROWTH];

  c.position.set(u.x, u.y);

  const gfx = c.getChildByLabel('gfx') as Graphics;
  gfx.clear();
  gfx.rect(-h, -h, h * 2, h * 2);
  gfx.fill(config.fill);
  gfx.setStrokeStyle({ width: 2, color: config.stroke });
  gfx.stroke();

  const label = c.getChildByLabel('label') as Text;
  label.text = config.label;
  label.position.set(0, h + 2);
}

/**
 * Draw a breeder camp pickup. Uses a pre-rendered texture from sprites module
 * if available; otherwise draws a simple placeholder.
 */
function drawBreederCampPickup(
  c: Container,
  u: PickupState,
  campTextures: Map<number, Texture>,
): void {
  c.position.set(u.x, u.y);
  const level = u.level ?? 1;

  // Remove old children except gfx+label
  while (c.children.length > 2) c.removeChildAt(2);

  const tex = campTextures.get(Math.max(1, Math.min(20, level)));
  if (tex) {
    const sprite = new Sprite(tex);
    sprite.anchor.set(0.5);
    sprite.label = 'campSprite';
    c.addChildAt(sprite, 0);
  }

  // Level badge
  const gfx = c.getChildByLabel('gfx') as Graphics;
  gfx.clear();
  const campW = 110;
  const campH = 80;
  const badgeX = campW / 2 - 6;
  const badgeY = -campH / 2 + 6;
  gfx.roundRect(badgeX - 10, badgeY - 8, 20, 16, 3);
  gfx.fill(0xffffff);
  gfx.setStrokeStyle({ width: 1, color: 0x333333 });
  gfx.stroke();

  // Level text
  const label = c.getChildByLabel('label') as Text;
  label.style.fill = '#ff6b6b';
  label.style.fontWeight = 'bold';
  label.style.fontSize = 10;
  
  // Estimate RT cost
  const basePets = 3 + Math.min(2, Math.floor(level / 2));
  const petCount = Math.min(basePets + Math.floor(level / 2), 8);
  let ingredientCount = 1;
  let avgIngredientCost = 8;
  if (level >= 10) { ingredientCount = 4; avgIngredientCost = 13; }
  else if (level >= 6) { ingredientCount = 3; avgIngredientCost = 11; }
  else if (level >= 3) { ingredientCount = 2; }
  const estimatedRtCost = petCount * ingredientCount * avgIngredientCost;
  label.text = `Lv${level} ~${estimatedRtCost}RT`;
  label.position.set(0, campH / 2 + 6);
}

/**
 * Update all pickups from the latest snapshot.
 * @param pickups  The snapshot's pickup array
 * @param parent   The container to add pickup children to (e.g. pickupLayer)
 * @param campTextures  Pre-rendered camp textures keyed by level (from sprites module)
 * @param viewL/viewR/viewT/viewB  Viewport bounds for culling
 */
export function updatePickups(
  pickups: PickupState[],
  parent: Container,
  campTextures: Map<number, Texture>,
  viewL: number,
  viewR: number,
  viewT: number,
  viewB: number,
): void {
  const used = new Set<string>();

  for (const u of pickups) {
    const margin = u.type === PICKUP_TYPE_BREEDER ? 70 : 30;
    if (u.x + margin < viewL || u.x - margin > viewR || u.y + margin < viewT || u.y - margin > viewB) continue;

    const id = u.id ?? `${u.x}-${u.y}`;
    used.add(id);
    const c = getOrCreatePickup(id, parent);
    c.visible = true;

    if (u.type === PICKUP_TYPE_BREEDER) {
      drawBreederCampPickup(c, u, campTextures);
    } else {
      drawOrbPickup(c, u);
    }
  }

  // Hide unused
  for (const [id, c] of pool) {
    if (!used.has(id)) {
      c.visible = false;
    }
  }
}

/** Remove all pickup containers */
export function clearPickups(): void {
  for (const c of pool.values()) { c.removeFromParent(); c.destroy(); }
  pool.clear();
}
