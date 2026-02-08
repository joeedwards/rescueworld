/**
 * Boot entry point — initializes the PixiJS renderer (which creates the
 * canvas#game element inside #game-container), then loads the main game
 * module which expects canvas#game to exist in the DOM.
 *
 * This two-phase approach is necessary because:
 * 1. PixiJS creates the WebGL canvas dynamically
 * 2. main.ts has top-level DOM lookups for canvas#game
 * 3. We need (1) to complete before (2) runs
 */

import { initRenderer } from './renderer';
import { initSprites } from './sprites';
import { prerenderStrayTextures } from './entities/strays';

async function boot(): Promise<void> {
  try {
    // Phase 1: Create the WebGL canvas inside #game-container
    // This creates a <canvas id="game"> element that main.ts expects
    await initRenderer();

    // Phase 2: Pre-render emoji/sprite textures to WebGL textures
    await initSprites();
    prerenderStrayTextures();

    console.log('[Boot] PixiJS renderer and textures ready, loading game…');

    // Phase 3: Load the main game module (which does top-level DOM lookups)
    // The dynamic import ensures main.ts runs AFTER the canvas exists
    await import('./main');
  } catch (err) {
    console.error('[Boot] Failed to initialize:', err);
    // Show a fallback error message
    const container = document.getElementById('game-container');
    if (container) {
      container.innerHTML = `
        <div style="display:flex;align-items:center;justify-content:center;height:100%;color:#fff;font-family:sans-serif;flex-direction:column;gap:12px;">
          <h2>Failed to initialize WebGL</h2>
          <p>Your browser may not support WebGL. Try updating your browser.</p>
          <p style="font-size:12px;color:#888;">${err}</p>
        </div>
      `;
    }
  }
}

boot();
