/**
 * HUD module — screen-space overlays rendered in PixiJS hudContainer.
 * Includes: virtual joystick, shelter locator arrow, growth popup.
 */

import { Container, Graphics, Text, TextStyle } from 'pixi.js';

// ---- Virtual joystick ----
let joystickGfx: Graphics | null = null;

export function renderJoystick(
  active: boolean,
  originX: number, originY: number,
  currentX: number, currentY: number,
  maxRadius: number,
  parent: Container,
  screenW: number, screenH: number,
): void {
  if (!joystickGfx) {
    joystickGfx = new Graphics();
    joystickGfx.label = 'joystick';
    parent.addChild(joystickGfx);
  }
  const g = joystickGfx;
  g.clear();

  if (!active) {
    g.visible = false;
    return;
  }
  g.visible = true;

  // Clamp joystick knob to max radius
  const dx = currentX - originX;
  const dy = currentY - originY;
  const dist = Math.hypot(dx, dy);
  const clampedDist = Math.min(dist, maxRadius);
  const knobX = dist > 0 ? originX + (dx / dist) * clampedDist : originX;
  const knobY = dist > 0 ? originY + (dy / dist) * clampedDist : originY;

  // Outer ring
  g.circle(originX, originY, maxRadius);
  g.fill({ color: 0xffffff, alpha: 0.1 });
  g.setStrokeStyle({ width: 3, color: 0xffffff, alpha: 0.3 });
  g.stroke();

  // Knob
  g.circle(knobX, knobY, 20);
  g.fill({ color: 0x7bed9f, alpha: 0.6 });
  g.setStrokeStyle({ width: 2, color: 0xffffff, alpha: 0.6 });
  g.stroke();
}

// ---- Growth popup ----
let growthText: Text | null = null;

export function renderGrowthPopup(
  show: boolean,
  parent: Container,
  screenW: number,
  screenH: number,
): void {
  if (!growthText) {
    growthText = new Text({
      text: '+1 Size!',
      style: new TextStyle({ fontFamily: 'Rubik, sans-serif', fontSize: 28, fontWeight: 'bold', fill: '#7bed9f' }),
    });
    growthText.anchor.set(0.5);
    growthText.label = 'growthPop';
    parent.addChild(growthText);
  }
  growthText.visible = show;
  if (show) {
    growthText.position.set(screenW / 2, screenH / 2 - 60);
  }
}

// ---- Shelter locator arrow ----
let locatorGfx: Graphics | null = null;
let locatorDistText: Text | null = null;

export function renderShelterLocator(
  show: boolean,
  shelterX: number, shelterY: number,
  vanX: number, vanY: number,
  cam: { x: number; y: number; w: number; h: number },
  parent: Container,
  screenW: number, screenH: number,
): void {
  if (!locatorGfx) {
    locatorGfx = new Graphics();
    locatorGfx.label = 'shelterLocator';
    parent.addChild(locatorGfx);
    locatorDistText = new Text({
      text: '',
      style: new TextStyle({ fontFamily: 'Rubik, sans-serif', fontSize: 12, fontWeight: 'bold', fill: '#fff' }),
    });
    locatorDistText.anchor.set(0.5, 0);
    locatorDistText.label = 'locatorDist';
    parent.addChild(locatorDistText);
  }

  if (!show) {
    locatorGfx!.visible = false;
    locatorDistText!.visible = false;
    return;
  }

  // Check if shelter is on screen
  const isOnScreen = shelterX >= cam.x && shelterX <= cam.x + cam.w &&
    shelterY >= cam.y && shelterY <= cam.y + cam.h;

  if (isOnScreen) {
    locatorGfx!.visible = false;
    locatorDistText!.visible = false;
    return;
  }

  locatorGfx!.visible = true;
  locatorDistText!.visible = true;

  const screenCenterX = cam.x + cam.w / 2;
  const screenCenterY = cam.y + cam.h / 2;
  const angle = Math.atan2(shelterY - screenCenterY, shelterX - screenCenterX);
  const distToShelter = Math.hypot(shelterX - vanX, shelterY - vanY);

  const margin = 60;
  const halfW = screenW / 2 - margin;
  const halfH = screenH / 2 - margin;
  const aspectRatio = halfW / halfH;

  let indicatorX: number, indicatorY: number;
  if (Math.abs(Math.cos(angle)) > Math.abs(Math.sin(angle)) * aspectRatio) {
    indicatorX = screenW / 2 + Math.sign(Math.cos(angle)) * halfW;
    indicatorY = screenH / 2 + Math.tan(angle) * Math.sign(Math.cos(angle)) * halfW;
  } else {
    indicatorY = screenH / 2 + Math.sign(Math.sin(angle)) * halfH;
    indicatorX = screenW / 2 + (1 / Math.tan(angle)) * Math.sign(Math.sin(angle)) * halfH;
  }
  indicatorX = Math.max(margin, Math.min(screenW - margin, indicatorX));
  indicatorY = Math.max(margin, Math.min(screenH - margin, indicatorY));

  const pulse = 0.7 + 0.3 * Math.sin(Date.now() / 300);
  const g = locatorGfx!;
  g.clear();

  // Arrow pointing toward shelter
  g.moveTo(indicatorX + Math.cos(angle) * 20, indicatorY + Math.sin(angle) * 20);
  g.lineTo(indicatorX + Math.cos(angle + 2.5) * 10, indicatorY + Math.sin(angle + 2.5) * 10);
  g.lineTo(indicatorX + Math.cos(angle - 2.5) * 10, indicatorY + Math.sin(angle - 2.5) * 10);
  g.closePath();
  g.fill({ color: 0x7bed9f, alpha: pulse });
  g.setStrokeStyle({ width: 2, color: 0xffffff, alpha: 0.8 });
  g.stroke();

  // Distance text
  const distText = distToShelter >= 1000
    ? `${(distToShelter / 1000).toFixed(1)}k`
    : `${Math.round(distToShelter)}`;
  locatorDistText!.text = distText;
  locatorDistText!.position.set(
    indicatorX - Math.cos(angle) * 35,
    indicatorY - Math.sin(angle) * 35 + 14,
  );
}
