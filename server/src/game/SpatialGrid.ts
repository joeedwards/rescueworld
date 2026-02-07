/**
 * Spatial hash grid for fast proximity queries.
 *
 * Instead of O(n*m) brute-force distance checks, entities are bucketed into
 * fixed-size cells.  queryRadius() only inspects cells that *could* contain
 * entities within the requested radius, turning most interaction loops into
 * nearly-O(n) operations.
 */

export class SpatialGrid<T extends { x: number; y: number }> {
  private cellSize: number;
  private invCellSize: number; // 1/cellSize — avoids repeated division
  private cells: Map<number, T[]> = new Map();
  /** Pool of previously-allocated cell arrays so we don't re-alloc every tick */
  private pool: T[][] = [];

  constructor(cellSize: number) {
    this.cellSize = cellSize;
    this.invCellSize = 1 / cellSize;
  }

  /** Hash two cell coordinates into a single integer key. */
  private key(cx: number, cy: number): number {
    // 10 000 columns is plenty for a 4800-unit map at ≥1-unit cells
    return cy * 10000 + cx;
  }

  /** Remove all entities.  Cell arrays are pooled for reuse. */
  clear(): void {
    for (const arr of this.cells.values()) {
      arr.length = 0;
      this.pool.push(arr);
    }
    this.cells.clear();
  }

  /** Insert an entity into the grid. */
  insert(entity: T): void {
    const cx = (entity.x * this.invCellSize) | 0;
    const cy = (entity.y * this.invCellSize) | 0;
    const k = this.key(cx, cy);
    let cell = this.cells.get(k);
    if (!cell) {
      cell = this.pool.pop() ?? [];
      this.cells.set(k, cell);
    }
    cell.push(entity);
  }

  /**
   * Append every entity within `radius` of (x,y) to `out`.
   * Uses squared-distance comparison internally (no sqrt).
   */
  queryRadius(x: number, y: number, radius: number, out: T[]): void {
    const inv = this.invCellSize;
    const minCx = ((x - radius) * inv) | 0;
    const maxCx = ((x + radius) * inv) | 0;
    const minCy = ((y - radius) * inv) | 0;
    const maxCy = ((y + radius) * inv) | 0;
    const r2 = radius * radius;
    for (let cy = minCy; cy <= maxCy; cy++) {
      for (let cx = minCx; cx <= maxCx; cx++) {
        const cell = this.cells.get(this.key(cx, cy));
        if (!cell) continue;
        for (let i = 0, len = cell.length; i < len; i++) {
          const e = cell[i];
          const dx = e.x - x;
          const dy = e.y - y;
          if (dx * dx + dy * dy <= r2) out.push(e);
        }
      }
    }
  }

  /**
   * Find the single closest entity within `radius` of (x,y), or null.
   * Faster than queryRadius + manual min when you only need one result.
   */
  queryNearest(x: number, y: number, radius: number): T | null {
    const inv = this.invCellSize;
    const minCx = ((x - radius) * inv) | 0;
    const maxCx = ((x + radius) * inv) | 0;
    const minCy = ((y - radius) * inv) | 0;
    const maxCy = ((y + radius) * inv) | 0;
    let bestD2 = radius * radius;
    let best: T | null = null;
    for (let cy = minCy; cy <= maxCy; cy++) {
      for (let cx = minCx; cx <= maxCx; cx++) {
        const cell = this.cells.get(this.key(cx, cy));
        if (!cell) continue;
        for (let i = 0, len = cell.length; i < len; i++) {
          const e = cell[i];
          const dx = e.x - x;
          const dy = e.y - y;
          const d2 = dx * dx + dy * dy;
          if (d2 < bestD2) {
            bestD2 = d2;
            best = e;
          }
        }
      }
    }
    return best;
  }
}
