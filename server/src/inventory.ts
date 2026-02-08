/**
 * Inventory module - manages stored equipment and RT chest for registered users
 */

import { ensureReferralStorage } from './referrals.js';

// Timestamp helper for logging
function log(...args: unknown[]): void {
  const ts = new Date().toISOString();
  console.log(`[${ts}]`, ...args);
}

type DbModule = typeof import('better-sqlite3');
let sqlite: import('better-sqlite3').Database | null = null;

function db(): import('better-sqlite3').Database {
  if (!sqlite) {
    ensureReferralStorage(); // This initializes SQLite with all tables
    const Database = require('better-sqlite3') as DbModule;
    const SQLITE_DB_PATH = process.env.SQLITE_DB_PATH || require('path').join(__dirname, '..', 'rescueworld.db');
    sqlite = new (Database as unknown as new (path: string) => import('better-sqlite3').Database)(SQLITE_DB_PATH);
  }
  return sqlite!;
}

export type Inventory = {
  storedRt: number;
  portCharges: number;
  shelterPortCharges: number;
  speedBoosts: number;
  sizeBoosts: number;
  shelterTier3Boosts: number;
  adoptSpeedBoosts: number;
};

/**
 * Get a user's inventory
 */
export function getInventory(userId: string): Inventory {
  const conn = db();
  
  const row = conn.prepare(`
    SELECT stored_rt, port_charges, shelter_port_charges, speed_boosts, size_boosts, shelter_tier3_boosts, adopt_speed_boosts 
    FROM inventory 
    WHERE user_id = ?
  `).get(userId) as {
    stored_rt: number;
    port_charges: number;
    shelter_port_charges: number;
    speed_boosts: number;
    size_boosts: number;
    shelter_tier3_boosts?: number;
    adopt_speed_boosts?: number;
  } | undefined;
  
  if (!row) {
    return {
      storedRt: 0,
      portCharges: 0,
      shelterPortCharges: 0,
      speedBoosts: 0,
      sizeBoosts: 0,
      shelterTier3Boosts: 0,
      adoptSpeedBoosts: 0,
    };
  }
  
  return {
    storedRt: row.stored_rt,
    portCharges: row.port_charges,
    shelterPortCharges: row.shelter_port_charges ?? 0,
    speedBoosts: row.speed_boosts,
    sizeBoosts: row.size_boosts,
    shelterTier3Boosts: row.shelter_tier3_boosts ?? 0,
    adoptSpeedBoosts: row.adopt_speed_boosts ?? 0,
  };
}

/**
 * Initialize inventory for a new user (call when user registers)
 */
export function initializeInventory(userId: string, startingRt: number = 0): void {
  const conn = db();
  
  conn.prepare(`
    INSERT OR IGNORE INTO inventory (user_id, stored_rt, port_charges, shelter_port_charges, speed_boosts, size_boosts, shelter_tier3_boosts, adopt_speed_boosts)
    VALUES (?, ?, 0, 0, 0, 0, 0, 0)
  `).run(userId, startingRt);
}

/**
 * Deposit items after a match ends (auto-save all RT and unused items)
 */
export function depositAfterMatch(
  userId: string, 
  rt: number, 
  portCharges: number = 0, 
  shelterPortCharges: number = 0,
  speedBoosts: number = 0, 
  sizeBoosts: number = 0,
  adoptSpeedBoosts: number = 0
): Inventory {
  const conn = db();
  
  // Upsert - insert if not exists, otherwise update
  conn.prepare(`
    INSERT INTO inventory (user_id, stored_rt, port_charges, shelter_port_charges, speed_boosts, size_boosts, shelter_tier3_boosts, adopt_speed_boosts)
    VALUES (?, ?, ?, ?, ?, ?, 0, ?)
    ON CONFLICT(user_id) DO UPDATE SET 
      stored_rt = stored_rt + ?,
      port_charges = port_charges + ?,
      shelter_port_charges = shelter_port_charges + ?,
      speed_boosts = speed_boosts + ?,
      size_boosts = size_boosts + ?,
      adopt_speed_boosts = adopt_speed_boosts + ?
  `).run(userId, rt, portCharges, shelterPortCharges, speedBoosts, sizeBoosts, adoptSpeedBoosts, rt, portCharges, shelterPortCharges, speedBoosts, sizeBoosts, adoptSpeedBoosts);
  
  log(`Deposited for ${userId}: +${rt} RT, +${portCharges} ports, +${shelterPortCharges} home ports, +${speedBoosts} speed, +${sizeBoosts} size, +${adoptSpeedBoosts} adopt speed`);
  
  return getInventory(userId);
}

/**
 * @deprecated Use withdrawForMatchSelective instead
 * Withdraw all items for match start (empties the chest)
 */
export function withdrawForMatch(userId: string): Inventory {
  return withdrawForMatchSelective(userId, 999999, {});
}

/** Item selection for selective withdrawal */
export type ItemSelection = {
  portCharges?: number;
  shelterPortCharges?: number;
  speedBoosts?: number;
  sizeBoosts?: number;
  shelterTier3Boosts?: number;
  adoptSpeedBoosts?: number;
};

/**
 * Withdraw RT (capped at maxRt) and only selected items for match start.
 * Returns what was actually withdrawn. Remainder stays in inventory.
 */
export function withdrawForMatchSelective(
  userId: string,
  maxRt: number = 1000,
  items: ItemSelection = {}
): Inventory {
  const conn = db();
  
  // Get current inventory
  const inventory = getInventory(userId);
  
  // Calculate what to actually withdraw (capped by what's available and requested)
  const rtToWithdraw = Math.min(maxRt, inventory.storedRt);
  const portsToWithdraw = Math.min(items.portCharges ?? 0, inventory.portCharges);
  const shelterPortsToWithdraw = Math.min(items.shelterPortCharges ?? 0, inventory.shelterPortCharges);
  const speedToWithdraw = Math.min(items.speedBoosts ?? 0, inventory.speedBoosts);
  const sizeToWithdraw = Math.min(items.sizeBoosts ?? 0, inventory.sizeBoosts);
  const tier3ToWithdraw = Math.min(items.shelterTier3Boosts ?? 0, inventory.shelterTier3Boosts);
  const adoptSpeedToWithdraw = Math.min(items.adoptSpeedBoosts ?? 0, inventory.adoptSpeedBoosts);
  
  const hasAnything = rtToWithdraw > 0 || portsToWithdraw > 0 || shelterPortsToWithdraw > 0 ||
    speedToWithdraw > 0 || sizeToWithdraw > 0 || tier3ToWithdraw > 0 || adoptSpeedToWithdraw > 0;
  
  if (hasAnything) {
    conn.prepare(`
      UPDATE inventory 
      SET stored_rt = stored_rt - ?,
          port_charges = port_charges - ?,
          shelter_port_charges = shelter_port_charges - ?,
          speed_boosts = speed_boosts - ?,
          size_boosts = size_boosts - ?,
          shelter_tier3_boosts = shelter_tier3_boosts - ?,
          adopt_speed_boosts = adopt_speed_boosts - ?
      WHERE user_id = ?
    `).run(rtToWithdraw, portsToWithdraw, shelterPortsToWithdraw, speedToWithdraw, sizeToWithdraw, tier3ToWithdraw, adoptSpeedToWithdraw, userId);
    
    log(`Selective withdraw for ${userId}: ${rtToWithdraw}/${inventory.storedRt} RT, ${portsToWithdraw} ports, ${shelterPortsToWithdraw} home ports, ${speedToWithdraw} speed, ${sizeToWithdraw} size, ${tier3ToWithdraw} tier3, ${adoptSpeedToWithdraw} adopt speed`);
  }
  
  // Return what was actually withdrawn (not what remains)
  return {
    storedRt: rtToWithdraw,
    portCharges: portsToWithdraw,
    shelterPortCharges: shelterPortsToWithdraw,
    speedBoosts: speedToWithdraw,
    sizeBoosts: sizeToWithdraw,
    shelterTier3Boosts: tier3ToWithdraw,
    adoptSpeedBoosts: adoptSpeedToWithdraw,
  };
}

/**
 * Add RT to inventory (for rewards, etc.)
 */
export function addRt(userId: string, amount: number): void {
  const conn = db();
  
  conn.prepare(`
    INSERT INTO inventory (user_id, stored_rt, port_charges, shelter_port_charges, speed_boosts, size_boosts)
    VALUES (?, ?, 0, 0, 0, 0)
    ON CONFLICT(user_id) DO UPDATE SET stored_rt = stored_rt + ?
  `).run(userId, amount, amount);
}

/**
 * Add port charges to inventory
 */
export function addPortCharges(userId: string, amount: number): void {
  const conn = db();
  
  conn.prepare(`
    INSERT INTO inventory (user_id, stored_rt, port_charges, shelter_port_charges, speed_boosts, size_boosts)
    VALUES (?, 0, ?, 0, 0, 0)
    ON CONFLICT(user_id) DO UPDATE SET port_charges = port_charges + ?
  `).run(userId, amount, amount);
}

/**
 * Add shelter port charges to inventory
 */
export function addShelterPortCharges(userId: string, amount: number): void {
  const conn = db();
  
  conn.prepare(`
    INSERT INTO inventory (user_id, stored_rt, port_charges, shelter_port_charges, speed_boosts, size_boosts)
    VALUES (?, 0, 0, ?, 0, 0)
    ON CONFLICT(user_id) DO UPDATE SET shelter_port_charges = shelter_port_charges + ?
  `).run(userId, amount, amount);
}

/**
 * Add speed boosts to inventory
 */
export function addSpeedBoosts(userId: string, amount: number): void {
  const conn = db();
  
  conn.prepare(`
    INSERT INTO inventory (user_id, stored_rt, port_charges, shelter_port_charges, speed_boosts, size_boosts)
    VALUES (?, 0, 0, 0, ?, 0)
    ON CONFLICT(user_id) DO UPDATE SET speed_boosts = speed_boosts + ?
  `).run(userId, amount, amount);
}

/**
 * Add size boosts to inventory
 */
export function addSizeBoosts(userId: string, amount: number): void {
  const conn = db();
  
  conn.prepare(`
    INSERT INTO inventory (user_id, stored_rt, port_charges, shelter_port_charges, speed_boosts, size_boosts)
    VALUES (?, 0, 0, 0, 0, ?)
    ON CONFLICT(user_id) DO UPDATE SET size_boosts = size_boosts + ?
  `).run(userId, amount, amount);
}

/**
 * Add adopt speed boosts to inventory
 */
export function addAdoptSpeedBoosts(userId: string, amount: number): void {
  const conn = db();
  
  conn.prepare(`
    INSERT INTO inventory (user_id, stored_rt, port_charges, shelter_port_charges, speed_boosts, size_boosts, shelter_tier3_boosts, adopt_speed_boosts)
    VALUES (?, 0, 0, 0, 0, 0, 0, ?)
    ON CONFLICT(user_id) DO UPDATE SET adopt_speed_boosts = adopt_speed_boosts + ?
  `).run(userId, amount, amount);
}

