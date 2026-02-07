#!/usr/bin/env node
// Capture gameplay screenshots for marketing using Puppeteer
// Takes screenshots of all 4 seasons + boss mode from a live Solo game
import puppeteer from '/tmp/node_modules/puppeteer/lib/esm/puppeteer/puppeteer.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCREENSHOTS_DIR = path.join(__dirname, 'screenshots');

const GAME_URL = 'https://adoptar.io';

async function main() {
  console.log('Launching browser...');
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu'],
    env: {
      ...process.env,
      LD_LIBRARY_PATH: `/tmp/chromium-libs/extracted/usr/lib/x86_64-linux-gnu:${process.env.LD_LIBRARY_PATH || ''}`,
    },
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 2 });

  // Navigate to the game
  console.log('Navigating to', GAME_URL);
  await page.goto(GAME_URL, { waitUntil: 'networkidle2', timeout: 30000 });
  await sleep(2000);

  // Dismiss cookie banner if present
  try {
    const acceptBtn = await page.$('#cookie-accept');
    if (acceptBtn) {
      await acceptBtn.click();
      console.log('Dismissed cookie banner');
      await sleep(500);
    }
  } catch (e) { /* ignore */ }

  // Take a landing page screenshot
  await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'landing-page.png') });
  console.log('Saved landing-page.png');

  // Select Solo mode
  console.log('Selecting Solo mode...');
  await page.click('button[data-mode="solo"]');
  await sleep(500);

  // Uncheck music to avoid interference
  const musicChecked = await page.$eval('#landing-music-toggle', el => el.checked);
  if (musicChecked) {
    await page.click('#landing-music-toggle');
  }

  // Click Play
  console.log('Starting game...');
  await page.click('#landing-play');

  // Wait for the game to fully load and render
  console.log('Waiting for game to load...');
  await sleep(6000);

  // The game should now be running. Current season is Winter (Feb).
  // Take Winter screenshot
  console.log('Taking Winter screenshot...');
  await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'season-winter.png') });
  console.log('Saved season-winter.png');

  // Move the van around a bit for more interesting screenshots
  // Press W to move up
  await page.keyboard.down('KeyW');
  await sleep(1500);
  await page.keyboard.up('KeyW');
  await sleep(500);

  // Cycle to Spring using Ctrl+Shift+Alt+8 (* key)
  console.log('Cycling to Spring...');
  await page.keyboard.down('Control');
  await page.keyboard.down('Shift');
  await page.keyboard.down('Alt');
  await page.keyboard.press('Digit8');
  await page.keyboard.up('Alt');
  await page.keyboard.up('Shift');
  await page.keyboard.up('Control');
  await sleep(2000);
  // Move van
  await page.keyboard.down('KeyD');
  await sleep(1000);
  await page.keyboard.up('KeyD');
  await sleep(500);
  await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'season-spring.png') });
  console.log('Saved season-spring.png');

  // Cycle to Summer
  console.log('Cycling to Summer...');
  await page.keyboard.down('Control');
  await page.keyboard.down('Shift');
  await page.keyboard.down('Alt');
  await page.keyboard.press('Digit8');
  await page.keyboard.up('Alt');
  await page.keyboard.up('Shift');
  await page.keyboard.up('Control');
  await sleep(2000);
  await page.keyboard.down('KeyW');
  await sleep(1000);
  await page.keyboard.up('KeyW');
  await sleep(500);
  await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'season-summer.png') });
  console.log('Saved season-summer.png');

  // Cycle to Fall
  console.log('Cycling to Fall...');
  await page.keyboard.down('Control');
  await page.keyboard.down('Shift');
  await page.keyboard.down('Alt');
  await page.keyboard.press('Digit8');
  await page.keyboard.up('Alt');
  await page.keyboard.up('Shift');
  await page.keyboard.up('Control');
  await sleep(2000);
  await page.keyboard.down('KeyA');
  await sleep(1000);
  await page.keyboard.up('KeyA');
  await sleep(500);
  await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'season-fall.png') });
  console.log('Saved season-fall.png');

  // Activate Boss Mode using Ctrl+Shift+B
  console.log('Activating Boss Mode...');
  await page.keyboard.down('Control');
  await page.keyboard.down('Shift');
  await page.keyboard.press('KeyB');
  await page.keyboard.up('Shift');
  await page.keyboard.up('Control');
  await sleep(4000); // Boss mode needs time to initialize and render
  await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'boss-mode.png') });
  console.log('Saved boss-mode.png');

  // Move toward a mill in boss mode for a more dynamic screenshot
  await page.keyboard.down('KeyW');
  await sleep(2000);
  await page.keyboard.up('KeyW');
  await sleep(500);
  await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'boss-mode-gameplay.png') });
  console.log('Saved boss-mode-gameplay.png');

  await browser.close();
  console.log('\nAll screenshots captured successfully!');
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

main().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
