/**
 * Zones entity — adoption zones (square dashed borders) and
 * adoption events (circular pulsing areas with image or fallback).
 */

import { Container, Graphics, Text, TextStyle, Sprite, Texture } from 'pixi.js';
import { ADOPTION_ZONE_RADIUS, MAP_WIDTH, MAP_HEIGHT } from 'shared';
import type { AdoptionZoneState, AdoptionEvent } from 'shared';

// ---- Adoption Zone Pool ----

const zonePool = new Map<string, Container>();

function getOrCreateZone(id: string, parent: Container): Container {
  let c = zonePool.get(id);
  if (!c) {
    c = new Container();
    c.label = `zone-${id}`;
    // Background fill
    const fill = new Graphics();
    fill.label = 'fill';
    c.addChild(fill);
    // Dashed border
    const border = new Graphics();
    border.label = 'border';
    c.addChild(border);
    // Title text
    const titleStyle = new TextStyle({ fontFamily: 'Rubik, sans-serif', fontSize: 14, fontWeight: 'bold', fill: '#7bed9f' });
    const title = new Text({ text: 'ADOPTION CENTER', style: titleStyle });
    title.anchor.set(0.5, 1);
    title.label = 'title';
    c.addChild(title);
    // Subtitle
    const subStyle = new TextStyle({ fontFamily: 'Rubik, sans-serif', fontSize: 14, fontWeight: 'bold', fill: '#7bed9f' });
    const sub = new Text({ text: 'Bring pets here to adopt out', style: subStyle });
    sub.anchor.set(0.5, 0.5);
    sub.label = 'sub';
    c.addChild(sub);
    zonePool.set(id, c);
    parent.addChild(c);
  }
  return c;
}

export function updateAdoptionZones(zones: AdoptionZoneState[], parent: Container): void {
  // Mark all existing as unused
  const used = new Set<string>();

  const zoneList = zones.length > 0
    ? zones
    : [{ id: 'adopt-fallback', x: MAP_WIDTH / 2, y: MAP_HEIGHT / 2, radius: ADOPTION_ZONE_RADIUS }];

  for (const z of zoneList) {
    used.add(z.id);
    const c = getOrCreateZone(z.id, parent);
    const r = z.radius || ADOPTION_ZONE_RADIUS;
    c.position.set(z.x, z.y);

    // Update fill
    const fill = c.getChildByLabel('fill') as Graphics;
    fill.clear();
    fill.rect(-r, -r, r * 2, r * 2);
    fill.fill({ color: 0x4a7c59, alpha: 0.2 });

    // Update border (dashed square)
    const border = c.getChildByLabel('border') as Graphics;
    border.clear();
    border.setStrokeStyle({ width: 4, color: 0x7bed9f, alpha: 0.6 });
    // Draw dashed border manually
    const dashLen = 8;
    const gapLen = 8;
    const sides = [
      { x1: -r, y1: -r, x2: r, y2: -r }, // top
      { x1: r, y1: -r, x2: r, y2: r }, // right
      { x1: r, y1: r, x2: -r, y2: r }, // bottom
      { x1: -r, y1: r, x2: -r, y2: -r }, // left
    ];
    for (const side of sides) {
      const dx = side.x2 - side.x1;
      const dy = side.y2 - side.y1;
      const len = Math.hypot(dx, dy);
      const nx = dx / len;
      const ny = dy / len;
      let pos = 0;
      let drawing = true;
      while (pos < len) {
        const segLen = drawing ? dashLen : gapLen;
        const end = Math.min(pos + segLen, len);
        if (drawing) {
          border.moveTo(side.x1 + nx * pos, side.y1 + ny * pos);
          border.lineTo(side.x1 + nx * end, side.y1 + ny * end);
          border.stroke();
        }
        pos = end;
        drawing = !drawing;
      }
    }

    // Title position
    const title = c.getChildByLabel('title') as Text;
    title.position.set(0, -r - 8);

    // Subtitle position
    const sub = c.getChildByLabel('sub') as Text;
    sub.position.set(0, 0);
  }

  // Remove unused
  for (const [id, c] of zonePool) {
    if (!used.has(id)) {
      c.removeFromParent();
      c.destroy();
      zonePool.delete(id);
    }
  }
}

// ---- Adoption Event Pool ----

const eventPool = new Map<string, Container>();

export function updateAdoptionEvents(
  events: AdoptionEvent[],
  nowTick: number,
  myPlayerX: number,
  myPlayerY: number,
  eventTexture: Texture | null,
  parent: Container,
): void {
  const used = new Set<string>();

  for (const ev of events) {
    const id = `${ev.x}-${ev.y}`;
    used.add(id);
    let c = eventPool.get(id);
    if (!c) {
      c = new Container();
      c.label = `event-${id}`;
      const glow = new Graphics();
      glow.label = 'glow';
      c.addChild(glow);
      const circle = new Graphics();
      circle.label = 'circle';
      c.addChild(circle);
      // Event image or fallback
      if (eventTexture) {
        const img = new Sprite(eventTexture);
        img.anchor.set(0.5);
        img.width = 100;
        img.height = 100;
        img.label = 'img';
        c.addChild(img);
      } else {
        const fallback = new Graphics();
        fallback.circle(0, 0, 50);
        fallback.fill({ color: 0xffc107, alpha: 0.5 });
        fallback.label = 'img';
        c.addChild(fallback);
      }
      // Name label
      const nameStyle = new TextStyle({ fontFamily: 'Rubik, sans-serif', fontSize: 16, fontWeight: 'bold', fill: '#ffc107' });
      const nameText = new Text({ text: '', style: nameStyle });
      nameText.anchor.set(0.5, 1);
      nameText.label = 'name';
      c.addChild(nameText);
      // Timer label
      const timerStyle = new TextStyle({ fontFamily: 'Rubik, sans-serif', fontSize: 14, fontWeight: 'bold', fill: '#ffc107' });
      const timerText = new Text({ text: '', style: timerStyle });
      timerText.anchor.set(0.5, 0);
      timerText.label = 'timer';
      c.addChild(timerText);
      // Progress label
      const progStyle = new TextStyle({ fontFamily: 'Rubik, sans-serif', fontSize: 14, fontWeight: 'bold', fill: '#ffc107' });
      const progText = new Text({ text: '', style: progStyle });
      progText.anchor.set(0.5, 0);
      progText.label = 'progress';
      c.addChild(progText);

      eventPool.set(id, c);
      parent.addChild(c);
    }

    const r = ev.radius || 300;
    const remaining = Math.max(0, ev.startTick + ev.durationTicks - nowTick);
    const secLeft = Math.ceil(remaining / 25);
    const pulse = 0.8 + 0.2 * Math.sin(nowTick * 0.15);
    const playerDist = Math.hypot(myPlayerX - ev.x, myPlayerY - ev.y);
    const isNearby = playerDist <= r;

    c.position.set(ev.x, ev.y);

    // Glow when nearby
    const glow = c.getChildByLabel('glow') as Graphics;
    glow.clear();
    if (isNearby) {
      glow.circle(0, 0, r + 20);
      glow.fill({ color: 0xffc107, alpha: 0.15 * pulse });
    }

    // Circle border + fill
    const circle = c.getChildByLabel('circle') as Graphics;
    circle.clear();
    const borderColor = isNearby ? 0x7bed9f : 0xffc107;
    const borderAlpha = isNearby ? 0.9 * pulse : 0.8 * pulse;
    circle.circle(0, 0, r);
    circle.fill({ color: borderColor, alpha: 0.15 });
    circle.setStrokeStyle({ width: isNearby ? 6 : 4, color: borderColor, alpha: borderAlpha });
    circle.stroke();

    // Name
    const nameText = c.getChildByLabel('name') as Text;
    const typeName = ev.type.replace(/_/g, ' ').replace(/\b\w/g, (ch: string) => ch.toUpperCase());
    nameText.text = `📢 ${typeName}`;
    nameText.position.set(0, -r - 12);
    nameText.style.fill = isNearby ? '#7bed9f' : '#ffc107';

    // Timer
    const timerText = c.getChildByLabel('timer') as Text;
    timerText.text = isNearby ? `${secLeft}s - DROP PETS HERE!` : `${secLeft}s left - bring pets here!`;
    timerText.position.set(0, 68);
    timerText.style.fill = isNearby ? '#7bed9f' : '#ffc107';

    // Progress
    const progText = c.getChildByLabel('progress') as Text;
    const totalNeeded = ev.totalNeeded ?? 100;
    const totalRescued = ev.totalRescued ?? 0;
    progText.text = `${totalRescued}/${totalNeeded} rescued`;
    progText.position.set(0, 86);
    progText.style.fill = isNearby ? '#7bed9f' : '#ffc107';
  }

  // Remove unused
  for (const [id, c] of eventPool) {
    if (!used.has(id)) {
      c.removeFromParent();
      c.destroy();
      eventPool.delete(id);
    }
  }
}

/** Remove all zone and event containers */
export function clearZones(): void {
  for (const c of zonePool.values()) { c.removeFromParent(); c.destroy(); }
  zonePool.clear();
  for (const c of eventPool.values()) { c.removeFromParent(); c.destroy(); }
  eventPool.clear();
}
