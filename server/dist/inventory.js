"use strict";
/**
 * Inventory module - manages stored equipment and RT chest for registered users
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.getInventory = getInventory;
exports.initializeInventory = initializeInventory;
exports.depositAfterMatch = depositAfterMatch;
exports.withdrawForMatch = withdrawForMatch;
exports.addRt = addRt;
exports.addPortCharges = addPortCharges;
exports.addSpeedBoosts = addSpeedBoosts;
exports.addSizeBoosts = addSizeBoosts;
const referrals_js_1 = require("./referrals.js");
// Timestamp helper for logging
function log(...args) {
    const ts = new Date().toISOString();
    console.log(`[${ts}]`, ...args);
}
let sqlite = null;
function db() {
    if (!sqlite) {
        (0, referrals_js_1.ensureReferralStorage)(); // This initializes SQLite with all tables
        const Database = require('better-sqlite3');
        const SQLITE_DB_PATH = process.env.SQLITE_DB_PATH || require('path').join(__dirname, '..', 'rescueworld.db');
        sqlite = new Database(SQLITE_DB_PATH);
    }
    return sqlite;
}
/**
 * Get a user's inventory
 */
function getInventory(userId) {
    const conn = db();
    const row = conn.prepare(`
    SELECT stored_rt, port_charges, speed_boosts, size_boosts 
    FROM inventory 
    WHERE user_id = ?
  `).get(userId);
    if (!row) {
        return {
            storedRt: 0,
            portCharges: 0,
            speedBoosts: 0,
            sizeBoosts: 0,
        };
    }
    return {
        storedRt: row.stored_rt,
        portCharges: row.port_charges,
        speedBoosts: row.speed_boosts,
        sizeBoosts: row.size_boosts,
    };
}
/**
 * Initialize inventory for a new user (call when user registers)
 */
function initializeInventory(userId, startingRt = 0) {
    const conn = db();
    conn.prepare(`
    INSERT OR IGNORE INTO inventory (user_id, stored_rt, port_charges, speed_boosts, size_boosts)
    VALUES (?, ?, 0, 0, 0)
  `).run(userId, startingRt);
}
/**
 * Deposit items after a match ends (auto-save all RT and unused items)
 */
function depositAfterMatch(userId, rt, portCharges = 0, speedBoosts = 0, sizeBoosts = 0) {
    const conn = db();
    // Upsert - insert if not exists, otherwise update
    conn.prepare(`
    INSERT INTO inventory (user_id, stored_rt, port_charges, speed_boosts, size_boosts)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET 
      stored_rt = stored_rt + ?,
      port_charges = port_charges + ?,
      speed_boosts = speed_boosts + ?,
      size_boosts = size_boosts + ?
  `).run(userId, rt, portCharges, speedBoosts, sizeBoosts, rt, portCharges, speedBoosts, sizeBoosts);
    log(`Deposited for ${userId}: +${rt} RT, +${portCharges} ports, +${speedBoosts} speed, +${sizeBoosts} size`);
    return getInventory(userId);
}
/**
 * Withdraw all items for match start (empties the chest)
 */
function withdrawForMatch(userId) {
    const conn = db();
    // Get current inventory
    const inventory = getInventory(userId);
    if (inventory.storedRt > 0 || inventory.portCharges > 0 || inventory.speedBoosts > 0 || inventory.sizeBoosts > 0) {
        // Clear the inventory
        conn.prepare(`
      UPDATE inventory 
      SET stored_rt = 0, port_charges = 0, speed_boosts = 0, size_boosts = 0
      WHERE user_id = ?
    `).run(userId);
        log(`Withdrew for ${userId}: ${inventory.storedRt} RT, ${inventory.portCharges} ports, ${inventory.speedBoosts} speed, ${inventory.sizeBoosts} size`);
    }
    return inventory;
}
/**
 * Add RT to inventory (for rewards, etc.)
 */
function addRt(userId, amount) {
    const conn = db();
    conn.prepare(`
    INSERT INTO inventory (user_id, stored_rt, port_charges, speed_boosts, size_boosts)
    VALUES (?, ?, 0, 0, 0)
    ON CONFLICT(user_id) DO UPDATE SET stored_rt = stored_rt + ?
  `).run(userId, amount, amount);
}
/**
 * Add port charges to inventory
 */
function addPortCharges(userId, amount) {
    const conn = db();
    conn.prepare(`
    INSERT INTO inventory (user_id, stored_rt, port_charges, speed_boosts, size_boosts)
    VALUES (?, 0, ?, 0, 0)
    ON CONFLICT(user_id) DO UPDATE SET port_charges = port_charges + ?
  `).run(userId, amount, amount);
}
/**
 * Add speed boosts to inventory
 */
function addSpeedBoosts(userId, amount) {
    const conn = db();
    conn.prepare(`
    INSERT INTO inventory (user_id, stored_rt, port_charges, speed_boosts, size_boosts)
    VALUES (?, 0, 0, ?, 0)
    ON CONFLICT(user_id) DO UPDATE SET speed_boosts = speed_boosts + ?
  `).run(userId, amount, amount);
}
/**
 * Add size boosts to inventory
 */
function addSizeBoosts(userId, amount) {
    const conn = db();
    conn.prepare(`
    INSERT INTO inventory (user_id, stored_rt, port_charges, speed_boosts, size_boosts)
    VALUES (?, 0, 0, 0, ?)
    ON CONFLICT(user_id) DO UPDATE SET size_boosts = size_boosts + ?
  `).run(userId, amount, amount);
}
