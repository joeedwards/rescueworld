// Render Adoptar.io gameplay screenshots using node-canvas
// Mimics the actual game's rendering style from main.ts
import { createCanvas, registerFont, loadImage } from '/tmp/node_modules/canvas/index.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, 'screenshots');
const ASSETS = path.join(__dirname, '..', 'client', 'public');

const W = 1280, H = 720;
const COLORS = {
  bg: '#3d6b3d',
  darkBg: '#1a1a2e',
  mint: '#7bed9f',
  blue: '#70a3ff',
  gold: '#ffd93d',
  red: '#ff6b6b',
  purple: '#c77dff',
  teal: '#10b981',
  brown: '#8B4513',
  darkBrown: '#654321',
  tan: '#D2B48C',
};

// Pet emojis
const PETS = ['🐕', '🐈', '🐰', '🐦'];

function drawGrid(ctx, offsetX, offsetY) {
  ctx.fillStyle = COLORS.bg;
  ctx.fillRect(0, 0, W, H);
  // White dot grid
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  for (let x = -offsetX % 36; x < W; x += 36) {
    for (let y = -offsetY % 36; y < H; y += 36) {
      ctx.beginPath();
      ctx.arc(x, y, 1.8, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function drawVan(ctx, x, y, color, angle, petCount, maxPets, name, isPlayer) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  const w = 50, h = 30;

  // Van body
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.roundRect(-w/2, -h/2, w, h, 6);
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.3)';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Cabin (front section)
  ctx.fillStyle = 'rgba(255,255,255,0.3)';
  ctx.fillRect(w/2 - 14, -h/2 + 3, 11, h - 6);

  // Wheels
  ctx.fillStyle = '#333';
  ctx.fillRect(-w/2 + 4, -h/2 - 3, 10, 4);
  ctx.fillRect(-w/2 + 4, h/2 - 1, 10, 4);
  ctx.fillRect(w/2 - 14, -h/2 - 3, 10, 4);
  ctx.fillRect(w/2 - 14, h/2 - 1, 10, 4);

  // Pet count on van
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 10px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(`${petCount}/${maxPets}`, -4, 0);

  ctx.restore();

  // Name tag
  if (name) {
    ctx.fillStyle = isPlayer ? COLORS.mint : 'rgba(255,255,255,0.9)';
    ctx.font = 'bold 12px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(name, x, y - 24);
  }
}

function drawShelter(ctx, x, y, color, level) {
  const baseW = 60 + level * 10;
  const baseH = 40 + level * 6;

  // Building body
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.roundRect(x - baseW/2, y - baseH/2 + 8, baseW, baseH - 8, 4);
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.3)';
  ctx.lineWidth = 1;
  ctx.stroke();

  // Roof
  ctx.fillStyle = COLORS.brown;
  ctx.beginPath();
  ctx.moveTo(x - baseW/2 - 6, y - baseH/2 + 8);
  ctx.lineTo(x, y - baseH/2 - 10);
  ctx.lineTo(x + baseW/2 + 6, y - baseH/2 + 8);
  ctx.closePath();
  ctx.fill();

  // Door
  ctx.fillStyle = COLORS.darkBrown;
  ctx.fillRect(x - 6, y + baseH/2 - 14, 12, 14);

  // Kennel bars
  for (let i = -1; i <= 1; i += 2) {
    const kx = x + i * 18;
    ctx.strokeStyle = '#555';
    ctx.lineWidth = 1;
    ctx.strokeRect(kx - 8, y - 4, 16, 12);
    for (let b = 0; b < 3; b++) {
      ctx.beginPath();
      ctx.moveTo(kx - 8 + b * 5 + 3, y - 4);
      ctx.lineTo(kx - 8 + b * 5 + 3, y + 8);
      ctx.stroke();
    }
  }

  // Level badge
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 10px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(`Lv${level}`, x, y - baseH/2 - 14);
}

function drawAdoptionZone(ctx, x, y, radius) {
  // Dashed border circle
  ctx.save();
  ctx.setLineDash([8, 6]);
  ctx.strokeStyle = 'rgba(123, 237, 159, 0.6)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);

  // Fill
  ctx.fillStyle = 'rgba(74, 124, 89, 0.2)';
  ctx.fill();

  // Labels
  ctx.fillStyle = COLORS.mint;
  ctx.font = 'bold 14px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('ADOPTION CENTER', x, y - 8);
  ctx.font = '10px sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  ctx.fillText('Bring pets here to adopt out', x, y + 8);
  ctx.restore();
}

function drawBreederCamp(ctx, x, y, level) {
  // Tent
  ctx.fillStyle = COLORS.tan;
  ctx.beginPath();
  ctx.moveTo(x - 25, y + 15);
  ctx.lineTo(x, y - 15);
  ctx.lineTo(x + 25, y + 15);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = COLORS.brown;
  ctx.lineWidth = 2;
  ctx.stroke();

  // Pen circle
  ctx.strokeStyle = COLORS.brown;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(x, y + 25, 14, 0, Math.PI * 2);
  ctx.stroke();

  // Fence posts
  for (let a = 0; a < Math.PI * 2; a += Math.PI / 3) {
    ctx.fillStyle = COLORS.brown;
    ctx.beginPath();
    ctx.arc(x + Math.cos(a) * 14, y + 25 + Math.sin(a) * 14, 2, 0, Math.PI * 2);
    ctx.fill();
  }

  // Pet dots inside pen
  const penColors = ['#ff6b6b', '#70a3ff', '#ffd93d', '#c77dff'];
  for (let i = 0; i < 3; i++) {
    const pa = (i / 3) * Math.PI * 2;
    ctx.fillStyle = penColors[i % penColors.length];
    ctx.beginPath();
    ctx.arc(x + Math.cos(pa) * 6, y + 25 + Math.sin(pa) * 6, 3, 0, Math.PI * 2);
    ctx.fill();
  }

  // Level badge
  ctx.fillStyle = '#fff';
  ctx.fillRect(x - 8, y - 22, 16, 12);
  ctx.fillStyle = '#333';
  ctx.font = 'bold 9px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(String(level), x, y - 13);
}

function drawPet(ctx, x, y, type, isSpecial) {
  const petInfo = {
    '🐕': { color: '#c8956c', label: 'D', shape: 'circle' },
    '🐈': { color: '#e8a87c', label: 'C', shape: 'circle' },
    '🐰': { color: '#ddd', label: 'R', shape: 'circle' },
    '🐦': { color: '#70c4ff', label: 'B', shape: 'diamond' },
    '⭐': { color: '#ffd700', label: '★', shape: 'star' },
  };
  const info = petInfo[type] || { color: '#fff', label: '?', shape: 'circle' };

  ctx.save();
  if (isSpecial) {
    // Golden glow for special pets
    ctx.shadowColor = '#ffd700';
    ctx.shadowBlur = 16;
  }

  const r = isSpecial ? 14 : 11;

  // Draw body
  ctx.fillStyle = info.color;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();

  // Outline
  ctx.strokeStyle = isSpecial ? '#ffd700' : 'rgba(0,0,0,0.4)';
  ctx.lineWidth = isSpecial ? 2.5 : 1.5;
  ctx.stroke();

  ctx.shadowBlur = 0;

  // Ears for dogs and cats
  if (type === '🐕' || type === '🐈') {
    ctx.fillStyle = info.color;
    // Left ear
    ctx.beginPath();
    ctx.ellipse(x - r * 0.6, y - r * 0.8, r * 0.35, r * 0.5, -0.3, 0, Math.PI * 2);
    ctx.fill();
    // Right ear
    ctx.beginPath();
    ctx.ellipse(x + r * 0.6, y - r * 0.8, r * 0.35, r * 0.5, 0.3, 0, Math.PI * 2);
    ctx.fill();
  }

  // Bunny ears (tall)
  if (type === '🐰') {
    ctx.fillStyle = '#ddd';
    ctx.beginPath();
    ctx.ellipse(x - 4, y - r - 5, 3, 8, -0.15, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(x + 4, y - r - 5, 3, 8, 0.15, 0, Math.PI * 2);
    ctx.fill();
    // Inner ears
    ctx.fillStyle = '#ffb6c1';
    ctx.beginPath();
    ctx.ellipse(x - 4, y - r - 5, 1.5, 5, -0.15, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(x + 4, y - r - 5, 1.5, 5, 0.15, 0, Math.PI * 2);
    ctx.fill();
  }

  // Eyes
  ctx.fillStyle = '#2d2d2d';
  ctx.beginPath();
  ctx.arc(x - 3, y - 2, 1.8, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(x + 3, y - 2, 1.8, 0, Math.PI * 2);
  ctx.fill();

  // Nose
  if (type !== '🐦' && type !== '⭐') {
    ctx.fillStyle = '#333';
    ctx.beginPath();
    ctx.arc(x, y + 2, 1.5, 0, Math.PI * 2);
    ctx.fill();
  }

  // Bird beak
  if (type === '🐦') {
    ctx.fillStyle = '#ffa500';
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + r + 5, y + 1);
    ctx.lineTo(x + r, y + 3);
    ctx.closePath();
    ctx.fill();
    // Wing
    ctx.fillStyle = '#5ab0e0';
    ctx.beginPath();
    ctx.ellipse(x - 2, y + 2, 6, 4, 0.2, 0, Math.PI * 2);
    ctx.fill();
  }

  // Star label for special
  if (isSpecial) {
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 14px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('★', x, y);
  }

  ctx.restore();
}

function drawPowerUp(ctx, x, y, type) {
  const colors = { size: COLORS.mint, speed: COLORS.blue, port: COLORS.purple, shelter: COLORS.teal };
  const labels = { size: '+Size', speed: 'Speed', port: 'Port', shelter: 'Home' };
  ctx.fillStyle = colors[type] || COLORS.mint;
  ctx.beginPath();
  ctx.roundRect(x - 12, y - 12, 24, 24, 4);
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 8px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(labels[type] || '?', x, y);
}

function drawTopBar(ctx, score, time, clock) {
  // Top bar background
  const grad = ctx.createLinearGradient(0, 0, 0, 48);
  grad.addColorStop(0, 'rgba(30,35,50,0.9)');
  grad.addColorStop(1, 'rgba(22,26,38,0.9)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, 48);
  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, 48);
  ctx.lineTo(W, 48);
  ctx.stroke();

  // Score
  ctx.fillStyle = COLORS.mint;
  ctx.font = 'bold 14px sans-serif';
  ctx.textAlign = 'left';
  ctx.shadowColor = 'rgba(123,237,159,0.4)';
  ctx.shadowBlur = 12;
  ctx.fillText(`🏆 ${score} RT`, 16, 28);
  ctx.shadowBlur = 0;

  // Timer
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 14px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(time, W/2, 28);

  // Clock
  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  ctx.font = '600 14px monospace';
  ctx.textAlign = 'right';
  ctx.fillText(clock, W - 16, 28);
}

function drawMinimap(ctx, playerX, playerY, entities) {
  const mmW = 140, mmH = 100;
  const mmX = W - mmW - 12, mmY = H - mmH - 12;

  ctx.fillStyle = 'rgba(22,26,38,0.8)';
  ctx.beginPath();
  ctx.roundRect(mmX, mmY, mmW, mmH, 8);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.15)';
  ctx.lineWidth = 1;
  ctx.stroke();

  // Player dot
  ctx.fillStyle = COLORS.mint;
  ctx.beginPath();
  ctx.arc(mmX + mmW/2, mmY + mmH/2, 3, 0, Math.PI * 2);
  ctx.fill();

  // Other dots
  for (const e of entities) {
    ctx.fillStyle = e.color;
    ctx.beginPath();
    ctx.arc(mmX + e.x * mmW, mmY + e.y * mmH, 2, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawBottomAbilities(ctx) {
  const abilities = [
    { key: '1', label: 'Speed Boost', color: COLORS.blue, cd: false },
    { key: '2', label: 'Shelter Port', color: COLORS.teal, cd: true },
    { key: '3', label: 'Random Port', color: COLORS.purple, cd: false },
  ];
  const startX = W/2 - (abilities.length * 56) / 2;
  const y = H - 48;

  for (let i = 0; i < abilities.length; i++) {
    const a = abilities[i];
    const ax = startX + i * 56;
    ctx.fillStyle = a.cd ? 'rgba(60,60,60,0.8)' : 'rgba(35,42,60,0.9)';
    ctx.beginPath();
    ctx.roundRect(ax, y, 48, 40, 6);
    ctx.fill();
    ctx.strokeStyle = a.cd ? 'rgba(255,255,255,0.1)' : a.color;
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.fillStyle = a.cd ? 'rgba(255,255,255,0.3)' : '#fff';
    ctx.font = 'bold 10px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(a.key, ax + 24, y + 14);
    ctx.font = '8px sans-serif';
    ctx.fillText(a.label.split(' ')[0], ax + 24, y + 28);

    if (a.cd) {
      ctx.fillStyle = 'rgba(255,255,255,0.6)';
      ctx.font = 'bold 12px sans-serif';
      ctx.fillText('12s', ax + 24, y + 20);
    }
  }
}

// --- Generate frames ---

function renderFrame(frameNum, opts) {
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  const { playerX, playerY, playerAngle = 0 } = opts;
  // Camera is centered on the player
  const camX = playerX;
  const camY = playerY;

  // Background grid
  drawGrid(ctx, camX, camY);

  // Adoption zones
  for (const az of opts.adoptionZones || []) {
    drawAdoptionZone(ctx, az.x - camX + W/2, az.y - camY + H/2, az.r);
  }

  // Breeder camps
  for (const bc of opts.breederCamps || []) {
    drawBreederCamp(ctx, bc.x - camX + W/2, bc.y - camY + H/2, bc.level);
  }

  // Shelters
  for (const s of opts.shelters || []) {
    drawShelter(ctx, s.x - camX + W/2, s.y - camY + H/2, s.color, s.level);
  }

  // Power-ups
  for (const p of opts.powerUps || []) {
    drawPowerUp(ctx, p.x - camX + W/2, p.y - camY + H/2, p.type);
  }

  // Pets
  for (const pet of opts.pets || []) {
    drawPet(ctx, pet.x - camX + W/2, pet.y - camY + H/2, pet.type, pet.special);
  }

  // Other vans
  for (const v of opts.vans || []) {
    drawVan(ctx, v.x - camX + W/2, v.y - camY + H/2, v.color, v.angle, v.pets, v.max, v.name, false);
  }

  // Player van (always center)
  drawVan(ctx, W/2, H/2, opts.playerColor || COLORS.mint, playerAngle, opts.playerPets || 0, opts.playerMax || 6, opts.playerName || 'You', true);

  // UI overlays
  drawTopBar(ctx, opts.score || 0, opts.timer || '4:32', opts.clock || '18:45');
  drawMinimap(ctx, playerX, playerY, opts.minimapDots || []);
  drawBottomAbilities(ctx);

  return canvas;
}

// Define 9 frames showing a rescue sequence
const frames = [
  // Frame 1: Starting position, seeing pets and adoption zone ahead
  {
    playerX: 400, playerY: 400, playerAngle: 0.1,
    playerColor: COLORS.mint, playerPets: 0, playerMax: 6, playerName: 'Rescuer',
    score: 45, timer: '4:48', clock: '18:42',
    adoptionZones: [{ x: 700, y: 200, r: 100 }],
    pets: [
      { x: 500, y: 350, type: '🐕', special: false },
      { x: 550, y: 420, type: '🐈', special: false },
      { x: 480, y: 460, type: '🐰', special: false },
      { x: 620, y: 380, type: '🐦', special: false },
      { x: 350, y: 300, type: '🐈', special: false },
      { x: 680, y: 480, type: '🐕', special: false },
      { x: 300, y: 500, type: '⭐', special: true },
    ],
    breederCamps: [{ x: 200, y: 600, level: 2 }],
    shelters: [{ x: 600, y: 550, color: COLORS.blue, level: 2 }],
    vans: [
      { x: 650, y: 300, color: COLORS.blue, angle: -0.3, pets: 2, max: 6, name: 'BlueDog' },
      { x: 250, y: 250, color: COLORS.red, angle: 0.8, pets: 4, max: 6, name: 'RedCat' },
    ],
    powerUps: [
      { x: 350, y: 380, type: 'speed' },
      { x: 560, y: 500, type: 'size' },
    ],
    minimapDots: [
      { x: 0.6, y: 0.3, color: COLORS.blue },
      { x: 0.2, y: 0.2, color: COLORS.red },
      { x: 0.7, y: 0.8, color: '#ff9f43' },
    ],
  },
  // Frame 2: Moving towards pets
  {
    playerX: 440, playerY: 390, playerAngle: -0.15,
    playerColor: COLORS.mint, playerPets: 0, playerMax: 6, playerName: 'Rescuer',
    score: 45, timer: '4:45', clock: '18:42',
    adoptionZones: [{ x: 700, y: 200, r: 100 }],
    pets: [
      { x: 500, y: 350, type: '🐕', special: false },
      { x: 550, y: 420, type: '🐈', special: false },
      { x: 480, y: 460, type: '🐰', special: false },
      { x: 620, y: 380, type: '🐦', special: false },
      { x: 350, y: 300, type: '🐈', special: false },
      { x: 680, y: 480, type: '🐕', special: false },
      { x: 300, y: 500, type: '⭐', special: true },
    ],
    breederCamps: [{ x: 200, y: 600, level: 2 }],
    shelters: [{ x: 600, y: 550, color: COLORS.blue, level: 2 }],
    vans: [
      { x: 660, y: 310, color: COLORS.blue, angle: -0.2, pets: 2, max: 6, name: 'BlueDog' },
      { x: 270, y: 240, color: COLORS.red, angle: 0.6, pets: 4, max: 6, name: 'RedCat' },
    ],
    powerUps: [
      { x: 350, y: 380, type: 'speed' },
      { x: 560, y: 500, type: 'size' },
    ],
    minimapDots: [
      { x: 0.6, y: 0.3, color: COLORS.blue },
      { x: 0.2, y: 0.2, color: COLORS.red },
    ],
  },
  // Frame 3: Picking up first pet
  {
    playerX: 490, playerY: 360, playerAngle: -0.05,
    playerColor: COLORS.mint, playerPets: 1, playerMax: 6, playerName: 'Rescuer',
    score: 50, timer: '4:42', clock: '18:42',
    adoptionZones: [{ x: 700, y: 200, r: 100 }],
    pets: [
      { x: 550, y: 420, type: '🐈', special: false },
      { x: 480, y: 460, type: '🐰', special: false },
      { x: 620, y: 380, type: '🐦', special: false },
      { x: 350, y: 300, type: '🐈', special: false },
      { x: 680, y: 480, type: '🐕', special: false },
      { x: 300, y: 500, type: '⭐', special: true },
    ],
    breederCamps: [{ x: 200, y: 600, level: 2 }],
    shelters: [{ x: 600, y: 550, color: COLORS.blue, level: 2 }],
    vans: [
      { x: 670, y: 320, color: COLORS.blue, angle: 0.1, pets: 3, max: 6, name: 'BlueDog' },
      { x: 300, y: 230, color: COLORS.red, angle: 0.4, pets: 4, max: 6, name: 'RedCat' },
    ],
    powerUps: [
      { x: 560, y: 500, type: 'size' },
    ],
    minimapDots: [
      { x: 0.65, y: 0.35, color: COLORS.blue },
      { x: 0.25, y: 0.2, color: COLORS.red },
    ],
  },
  // Frame 4: More pets picked up
  {
    playerX: 530, playerY: 400, playerAngle: 0.3,
    playerColor: COLORS.mint, playerPets: 3, playerMax: 6, playerName: 'Rescuer',
    score: 65, timer: '4:35', clock: '18:43',
    adoptionZones: [{ x: 700, y: 200, r: 100 }],
    pets: [
      { x: 620, y: 380, type: '🐦', special: false },
      { x: 680, y: 480, type: '🐕', special: false },
      { x: 300, y: 500, type: '⭐', special: true },
    ],
    breederCamps: [{ x: 200, y: 600, level: 2 }],
    shelters: [
      { x: 600, y: 550, color: COLORS.blue, level: 2 },
      { x: 530, y: 500, color: COLORS.mint, level: 1 },
    ],
    vans: [
      { x: 680, y: 250, color: COLORS.blue, angle: -0.5, pets: 4, max: 6, name: 'BlueDog' },
      { x: 350, y: 300, color: COLORS.red, angle: 1.2, pets: 5, max: 6, name: 'RedCat' },
    ],
    powerUps: [{ x: 440, y: 320, type: 'port' }],
    minimapDots: [
      { x: 0.7, y: 0.25, color: COLORS.blue },
      { x: 0.3, y: 0.3, color: COLORS.red },
    ],
  },
  // Frame 5: Heading to adoption zone with full van
  {
    playerX: 600, playerY: 320, playerAngle: -0.4,
    playerColor: COLORS.mint, playerPets: 5, playerMax: 6, playerName: 'Rescuer',
    score: 80, timer: '4:28', clock: '18:43',
    adoptionZones: [{ x: 700, y: 200, r: 100 }],
    pets: [
      { x: 680, y: 480, type: '🐕', special: false },
      { x: 300, y: 500, type: '⭐', special: true },
      { x: 750, y: 350, type: '🐈', special: false },
    ],
    breederCamps: [{ x: 200, y: 600, level: 2 }],
    shelters: [
      { x: 600, y: 550, color: COLORS.blue, level: 2 },
      { x: 530, y: 500, color: COLORS.mint, level: 1 },
    ],
    vans: [
      { x: 720, y: 400, color: COLORS.blue, angle: 0.7, pets: 5, max: 6, name: 'BlueDog' },
      { x: 400, y: 500, color: COLORS.red, angle: -0.2, pets: 6, max: 6, name: 'RedCat' },
    ],
    powerUps: [],
    minimapDots: [
      { x: 0.72, y: 0.4, color: COLORS.blue },
      { x: 0.35, y: 0.5, color: COLORS.red },
    ],
  },
  // Frame 6: At adoption zone - delivering pets!
  {
    playerX: 680, playerY: 230, playerAngle: -0.6,
    playerColor: COLORS.mint, playerPets: 5, playerMax: 6, playerName: 'Rescuer',
    score: 80, timer: '4:22', clock: '18:43',
    adoptionZones: [{ x: 700, y: 200, r: 100 }],
    pets: [
      { x: 300, y: 500, type: '⭐', special: true },
      { x: 800, y: 400, type: '🐕', special: false },
      { x: 850, y: 300, type: '🐈', special: false },
    ],
    breederCamps: [{ x: 200, y: 600, level: 2 }],
    shelters: [
      { x: 600, y: 550, color: COLORS.blue, level: 2 },
      { x: 530, y: 500, color: COLORS.mint, level: 1 },
    ],
    vans: [
      { x: 750, y: 420, color: COLORS.blue, angle: 0.9, pets: 6, max: 6, name: 'BlueDog' },
    ],
    powerUps: [{ x: 600, y: 350, type: 'shelter' }],
    minimapDots: [
      { x: 0.75, y: 0.42, color: COLORS.blue },
      { x: 0.4, y: 0.55, color: COLORS.red },
    ],
  },
  // Frame 7: Adoption success - score jump
  {
    playerX: 700, playerY: 210, playerAngle: 0.0,
    playerColor: COLORS.mint, playerPets: 0, playerMax: 6, playerName: 'Rescuer',
    score: 130, timer: '4:18', clock: '18:44',
    adoptionZones: [{ x: 700, y: 200, r: 100 }],
    pets: [
      { x: 300, y: 500, type: '⭐', special: true },
      { x: 800, y: 400, type: '🐕', special: false },
      { x: 850, y: 300, type: '🐈', special: false },
      { x: 500, y: 350, type: '🐰', special: false },
      { x: 450, y: 280, type: '🐦', special: false },
    ],
    breederCamps: [{ x: 200, y: 600, level: 2 }, { x: 900, y: 150, level: 3 }],
    shelters: [
      { x: 600, y: 550, color: COLORS.blue, level: 3 },
      { x: 530, y: 500, color: COLORS.mint, level: 2 },
    ],
    vans: [
      { x: 400, y: 350, color: COLORS.blue, angle: -0.6, pets: 2, max: 6, name: 'BlueDog' },
      { x: 350, y: 450, color: COLORS.red, angle: 0.3, pets: 1, max: 6, name: 'RedCat' },
    ],
    powerUps: [{ x: 750, y: 300, type: 'speed' }],
    minimapDots: [
      { x: 0.4, y: 0.35, color: COLORS.blue },
      { x: 0.35, y: 0.45, color: COLORS.red },
    ],
  },
  // Frame 8: Back to rescuing - heading to special pet
  {
    playerX: 500, playerY: 400, playerAngle: 0.7,
    playerColor: COLORS.mint, playerPets: 2, playerMax: 6, playerName: 'Rescuer',
    score: 140, timer: '4:08', clock: '18:44',
    adoptionZones: [{ x: 700, y: 200, r: 100 }],
    pets: [
      { x: 300, y: 500, type: '⭐', special: true },
      { x: 450, y: 280, type: '🐦', special: false },
      { x: 600, y: 480, type: '🐕', special: false },
      { x: 380, y: 350, type: '🐈', special: false },
    ],
    breederCamps: [{ x: 200, y: 600, level: 2 }],
    shelters: [
      { x: 600, y: 550, color: COLORS.blue, level: 3 },
      { x: 530, y: 500, color: COLORS.mint, level: 2 },
    ],
    vans: [
      { x: 700, y: 250, color: COLORS.blue, angle: 0.2, pets: 4, max: 6, name: 'BlueDog' },
      { x: 250, y: 550, color: COLORS.red, angle: -0.8, pets: 3, max: 6, name: 'RedCat' },
      { x: 550, y: 350, color: COLORS.gold, angle: 1.5, pets: 1, max: 6, name: 'GoldPaw' },
    ],
    powerUps: [
      { x: 400, y: 450, type: 'size' },
      { x: 650, y: 300, type: 'port' },
    ],
    minimapDots: [
      { x: 0.7, y: 0.25, color: COLORS.blue },
      { x: 0.2, y: 0.55, color: COLORS.red },
      { x: 0.55, y: 0.35, color: COLORS.gold },
    ],
  },
  // Frame 9: Grabbing the special star pet with golden glow
  {
    playerX: 320, playerY: 490, playerAngle: 0.9,
    playerColor: COLORS.mint, playerPets: 4, playerMax: 6, playerName: 'Rescuer',
    score: 165, timer: '3:55', clock: '18:44',
    adoptionZones: [{ x: 700, y: 200, r: 100 }],
    pets: [
      { x: 320, y: 490, type: '⭐', special: true },
      { x: 600, y: 480, type: '🐕', special: false },
      { x: 200, y: 350, type: '🐰', special: false },
      { x: 750, y: 380, type: '🐈', special: false },
    ],
    breederCamps: [{ x: 200, y: 600, level: 2 }],
    shelters: [
      { x: 600, y: 550, color: COLORS.blue, level: 3 },
      { x: 530, y: 500, color: COLORS.mint, level: 2 },
    ],
    vans: [
      { x: 720, y: 200, color: COLORS.blue, angle: -0.3, pets: 6, max: 6, name: 'BlueDog' },
      { x: 300, y: 600, color: COLORS.red, angle: 0.1, pets: 5, max: 6, name: 'RedCat' },
    ],
    powerUps: [],
    minimapDots: [
      { x: 0.72, y: 0.2, color: COLORS.blue },
      { x: 0.3, y: 0.6, color: COLORS.red },
    ],
  },
];

async function main() {
  console.log(`Rendering ${frames.length} gameplay screenshots...`);

  for (let i = 0; i < frames.length; i++) {
    const num = String(i + 1).padStart(3, '0');
    const canvas = renderFrame(i, frames[i]);
    const outPath = path.join(OUT, `screenshot_${num}.png`);
    const buffer = canvas.toBuffer('image/png');
    fs.writeFileSync(outPath, buffer);
    console.log(`  Saved ${outPath} (${(buffer.length / 1024).toFixed(0)} KB)`);
  }

  console.log('Done!');
}

main().catch(console.error);
