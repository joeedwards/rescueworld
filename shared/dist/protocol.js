"use strict";
/**
 * Game channel protocol (WebRTC unreliable).
 * Snapshot: shelters (players) with size/petsInside, strays (pets), adoption zones.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.MSG_BOSS_EXIT_MILL = exports.MSG_BOSS_ENTER_MILL = exports.MSG_BOSS_SUBMIT_MEAL = exports.MSG_BOSS_PURCHASE = exports.MSG_BOSS_MODE_END = exports.MSG_BOSS_CAUGHT = exports.MSG_BOSS_POSITION = exports.MSG_BOSS_MILL_UPDATE = exports.MSG_BOSS_MODE_START = exports.MSG_SNAPSHOT = exports.MSG_INPUT = void 0;
exports.encodeInput = encodeInput;
exports.decodeInput = decodeInput;
exports.encodeSnapshot = encodeSnapshot;
exports.decodeSnapshot = decodeSnapshot;
exports.MSG_INPUT = 0x01;
exports.MSG_SNAPSHOT = 0x02;
// Boss Mode protocol messages (JSON over WebSocket)
exports.MSG_BOSS_MODE_START = 'bossModeStart';
exports.MSG_BOSS_MILL_UPDATE = 'bossMillUpdate';
exports.MSG_BOSS_POSITION = 'bossPosition';
exports.MSG_BOSS_CAUGHT = 'bossCaught';
exports.MSG_BOSS_MODE_END = 'bossModeEnd';
exports.MSG_BOSS_PURCHASE = 'bossPurchase';
exports.MSG_BOSS_SUBMIT_MEAL = 'bossSubmitMeal';
exports.MSG_BOSS_ENTER_MILL = 'bossEnterMill';
exports.MSG_BOSS_EXIT_MILL = 'bossExitMill';
function encodeInput(inputFlags, inputSeq) {
    const buf = new ArrayBuffer(4);
    const view = new DataView(buf);
    view.setUint8(0, exports.MSG_INPUT);
    view.setUint16(1, inputFlags, true);
    view.setUint8(3, inputSeq & 0xff);
    return buf;
}
function decodeInput(buf) {
    const view = new DataView(buf);
    if (view.getUint8(0) !== exports.MSG_INPUT)
        throw new Error('Invalid input message');
    return {
        inputFlags: view.getUint16(1, true),
        inputSeq: view.getUint8(3),
    };
}
function writeString(view, offset, s) {
    const encoder = new TextEncoder();
    const bytes = encoder.encode(s);
    view.setUint8(offset, bytes.length);
    new Uint8Array(view.buffer).set(bytes, offset + 1);
    return offset + 1 + bytes.length;
}
function readString(view, offset) {
    const len = view.getUint8(offset);
    if (len === 0)
        return { s: '', next: offset + 1 };
    const maxLen = view.buffer.byteLength - (offset + 1);
    if (len > maxLen || len < 0)
        throw new RangeError(`Snapshot string length ${len} exceeds buffer (${maxLen} bytes left)`);
    const bytes = new Uint8Array(view.buffer, offset + 1, len);
    const s = new TextDecoder().decode(bytes);
    return { s, next: offset + 1 + len };
}
function encodeSnapshot(snap) {
    const encoder = new TextEncoder();
    const players = snap.players ?? [];
    const pets = snap.pets ?? [];
    const adoptionZones = snap.adoptionZones ?? [];
    const pickups = snap.pickups ?? [];
    const shelters = snap.shelters ?? [];
    const breederShelters = snap.breederShelters ?? [];
    const adoptionEvents = snap.adoptionEvents ?? [];
    // msg(1), tick(4), matchEndAt(4), matchEndedEarly(1), winnerId(string), totalMatchAdoptions(4), scarcityLevel(1), matchDurationMs(4), numPlayers(1)
    let size = 1 + 4 + 4 + 1 + 1 + encoder.encode(snap.winnerId ?? '').length + 4 + 1 + 4 + 1;
    for (const p of players) {
        size += 1 + encoder.encode(p.id).length + 1 + encoder.encode(p.displayName ?? p.id).length + 4 * 4 + 4 + 4 + 1; // id, displayName, x,y,vx,vy, size(4), totalAdoptions(4), numPets
        for (const pid of p.petsInside)
            size += 1 + encoder.encode(pid).length;
        size += 4 + 1; // speedBoostUntil(4), inputSeq(1)
        size += 1 + 1 + 1 + 1 + 1; // eliminated(1), grounded(1), portCharges(1), shelterPortCharges(1), numAllies(1)
        for (const aid of p.allies ?? [])
            size += 1 + encoder.encode(aid).length;
        size += 1 + encoder.encode(p.shelterColor ?? '').length; // shelterColor string
        size += 2; // money (Uint16)
        size += 1 + encoder.encode(p.shelterId ?? '').length; // shelterId string
        size += 1; // vanSpeedUpgrade (1 byte bool)
    }
    size += 2; // Uint16 for pet count (large maps can have 255+ pets)
    for (const pet of pets) {
        size += 1 + encoder.encode(pet.id).length + 4 * 4 + 1 + (pet.insideShelterId ? encoder.encode(pet.insideShelterId).length : 0) + 1; // +1 petType
    }
    size += 1;
    for (const z of adoptionZones) {
        size += 1 + encoder.encode(z.id).length + 4 + 4 + 4;
    }
    size += 1;
    for (const u of pickups) {
        size += 1 + encoder.encode(u.id).length + 4 + 4 + 1 + 1; // +1 for level byte
    }
    // Shelters: count(1), then for each: id, ownerId, x, y, flags(1), numPets(2), pets, size(4), totalAdoptions(4), tier(1)
    size += 1;
    for (const s of shelters) {
        size += 1 + encoder.encode(s.id).length;
        size += 1 + encoder.encode(s.ownerId).length;
        size += 4 + 4; // x, y
        size += 1; // flags byte (hasAdoptionCenter, hasGravity, hasAdvertising)
        size += 2; // numPets (Uint16 - shelters can hold 255+ pets)
        for (const pid of s.petsInside)
            size += 1 + encoder.encode(pid).length;
        size += 4 + 4 + 1; // size(4), totalAdoptions(4), tier(1)
    }
    // Breeder shelters (mills)
    size += 1;
    for (const b of breederShelters) {
        size += 1 + encoder.encode(b.id).length + 4 + 4 + 1 + 4; // id, x, y, level, size
    }
    // Adoption events
    size += 1; // count
    for (const ev of adoptionEvents) {
        size += 1 + encoder.encode(ev.id).length; // id
        size += 1 + encoder.encode(ev.type).length; // type
        size += 4 + 4; // x, y
        size += 2; // radius (16-bit)
        size += 4 + 4; // startTick, durationTicks
        size += 2 + 2; // totalNeeded(16), totalRescued(16)
    }
    // Boss mode
    const bossMode = snap.bossMode;
    size += 1; // hasBossMode flag
    if (bossMode) {
        size += 4 + 4 + 4 + 4; // startTick, timeLimit, tycoonX, tycoonY
        size += 1 + 1 + 4 + 4 + 1; // tycoonTargetMill, millsCleared, mallX, mallY, playerAtMill
        size += 1; // rebuildingMill
        size += 1; // numMills
        for (const mill of bossMode.mills) {
            size += 1 + 1 + 1 + 4 + 4 + 1; // id, petType, petCount, x, y, completed
            // Recipe: numIngredients, then for each: ingredientName(string), amount(1)
            size += 1;
            for (const ing of Object.keys(mill.recipe)) {
                size += 1 + encoder.encode(ing).length + 1;
            }
            // Purchased: numIngredients, then for each: ingredientName(string), amount(1)
            size += 1;
            for (const ing of Object.keys(mill.purchased)) {
                size += 1 + encoder.encode(ing).length + 1;
            }
        }
    }
    const buf = new ArrayBuffer(size * 2); // No cap - large games need large buffers
    const view = new DataView(buf);
    let off = 0;
    view.setUint8(off++, exports.MSG_SNAPSHOT);
    view.setUint32(off, snap.tick, true);
    off += 4;
    view.setUint32(off, snap.matchEndAt, true);
    off += 4;
    view.setUint8(off++, snap.matchEndedEarly ? 1 : 0);
    off = writeString(view, off, snap.winnerId ?? '');
    view.setUint32(off, (snap.totalMatchAdoptions ?? 0) >>> 0, true);
    off += 4;
    view.setUint8(off++, (snap.scarcityLevel ?? 0) & 0xff);
    view.setUint32(off, (snap.matchDurationMs ?? 0) >>> 0, true);
    off += 4;
    view.setUint8(off++, players.length);
    for (const p of players) {
        off = writeString(view, off, p.id);
        off = writeString(view, off, p.displayName ?? p.id);
        view.setFloat32(off, p.x, true);
        off += 4;
        view.setFloat32(off, p.y, true);
        off += 4;
        view.setFloat32(off, p.vx, true);
        off += 4;
        view.setFloat32(off, p.vy, true);
        off += 4;
        view.setFloat32(off, p.size, true);
        off += 4;
        view.setUint32(off, p.totalAdoptions >>> 0, true);
        off += 4;
        view.setUint8(off++, p.petsInside.length);
        for (const pid of p.petsInside)
            off = writeString(view, off, pid);
        view.setUint32(off, (p.speedBoostUntil ?? 0) >>> 0, true);
        off += 4;
        view.setUint8(off++, p.inputSeq & 0xff);
        view.setUint8(off++, (p.eliminated ? 1 : 0));
        view.setUint8(off++, (p.grounded ? 1 : 0));
        view.setUint8(off++, (p.portCharges ?? 0) & 0xff);
        view.setUint8(off++, (p.shelterPortCharges ?? 0) & 0xff);
        const allies = p.allies ?? [];
        view.setUint8(off++, allies.length);
        for (const aid of allies)
            off = writeString(view, off, aid);
        off = writeString(view, off, p.shelterColor ?? '');
        view.setUint16(off, (p.money ?? 0) & 0xffff, true);
        off += 2;
        off = writeString(view, off, p.shelterId ?? '');
        view.setUint8(off++, p.vanSpeedUpgrade ? 1 : 0);
    }
    // Use Uint16 for pet count - large maps can have 255+ pets
    view.setUint16(off, pets.length, true);
    off += 2;
    for (const pet of pets) {
        off = writeString(view, off, pet.id);
        view.setFloat32(off, pet.x, true);
        off += 4;
        view.setFloat32(off, pet.y, true);
        off += 4;
        view.setFloat32(off, pet.vx, true);
        off += 4;
        view.setFloat32(off, pet.vy, true);
        off += 4;
        if (pet.insideShelterId)
            off = writeString(view, off, pet.insideShelterId);
        else
            view.setUint8(off++, 0);
        view.setUint8(off++, (pet.petType ?? 0) & 0xff);
    }
    view.setUint8(off++, adoptionZones.length);
    for (const z of adoptionZones) {
        off = writeString(view, off, z.id);
        view.setFloat32(off, z.x, true);
        off += 4;
        view.setFloat32(off, z.y, true);
        off += 4;
        view.setFloat32(off, z.radius, true);
        off += 4;
    }
    view.setUint8(off++, pickups.length);
    for (const u of pickups) {
        off = writeString(view, off, u.id);
        view.setFloat32(off, u.x, true);
        off += 4;
        view.setFloat32(off, u.y, true);
        off += 4;
        view.setUint8(off++, u.type & 0xff);
        view.setUint8(off++, (u.level ?? 1) & 0xff); // Breeder camp level (default 1)
    }
    // Encode shelters
    view.setUint8(off++, shelters.length);
    for (const s of shelters) {
        off = writeString(view, off, s.id);
        off = writeString(view, off, s.ownerId);
        view.setFloat32(off, s.x, true);
        off += 4;
        view.setFloat32(off, s.y, true);
        off += 4;
        // Pack flags into single byte
        const flags = (s.hasAdoptionCenter ? 1 : 0) | (s.hasGravity ? 2 : 0) | (s.hasAdvertising ? 4 : 0);
        view.setUint8(off++, flags);
        view.setUint16(off, s.petsInside.length, true); // Uint16 - shelters can hold 255+ pets
        off += 2;
        for (const pid of s.petsInside)
            off = writeString(view, off, pid);
        view.setFloat32(off, s.size, true);
        off += 4;
        view.setUint32(off, s.totalAdoptions >>> 0, true);
        off += 4;
        view.setUint8(off++, (s.tier ?? 1) & 0xff);
    }
    view.setUint8(off++, breederShelters.length);
    for (const b of breederShelters) {
        off = writeString(view, off, b.id);
        view.setFloat32(off, b.x, true);
        off += 4;
        view.setFloat32(off, b.y, true);
        off += 4;
        view.setUint8(off++, (b.level ?? 1) & 0xff);
        view.setFloat32(off, b.size, true);
        off += 4;
    }
    // Encode adoption events
    view.setUint8(off++, adoptionEvents.length);
    for (const ev of adoptionEvents) {
        off = writeString(view, off, ev.id);
        off = writeString(view, off, ev.type);
        view.setFloat32(off, ev.x, true);
        off += 4;
        view.setFloat32(off, ev.y, true);
        off += 4;
        view.setUint16(off, Math.min(0xFFFF, ev.radius) >>> 0, true);
        off += 2;
        view.setUint32(off, ev.startTick >>> 0, true);
        off += 4;
        view.setUint32(off, ev.durationTicks >>> 0, true);
        off += 4;
        view.setUint16(off, Math.min(0xFFFF, ev.totalNeeded) >>> 0, true);
        off += 2;
        view.setUint16(off, Math.min(0xFFFF, ev.totalRescued) >>> 0, true);
        off += 2;
    }
    // Encode boss mode (bossMode variable already declared above for size calculation)
    if (bossMode && bossMode.active) {
        view.setUint8(off++, 1); // hasBossMode = true
        view.setUint32(off, bossMode.startTick >>> 0, true);
        off += 4;
        view.setUint32(off, bossMode.timeLimit >>> 0, true);
        off += 4;
        view.setFloat32(off, bossMode.tycoonX, true);
        off += 4;
        view.setFloat32(off, bossMode.tycoonY, true);
        off += 4;
        view.setUint8(off++, bossMode.tycoonTargetMill & 0xff);
        view.setUint8(off++, bossMode.millsCleared & 0xff);
        view.setFloat32(off, bossMode.mallX, true);
        off += 4;
        view.setFloat32(off, bossMode.mallY, true);
        off += 4;
        view.setInt8(off++, bossMode.playerAtMill); // -1 to 4
        view.setInt8(off++, bossMode.rebuildingMill ?? -1); // -1 to 4
        view.setUint8(off++, bossMode.mills.length);
        for (const mill of bossMode.mills) {
            view.setUint8(off++, mill.id & 0xff);
            view.setUint8(off++, mill.petType & 0xff);
            view.setUint8(off++, mill.petCount & 0xff);
            view.setFloat32(off, mill.x, true);
            off += 4;
            view.setFloat32(off, mill.y, true);
            off += 4;
            view.setUint8(off++, mill.completed ? 1 : 0);
            // Recipe
            const recipeKeys = Object.keys(mill.recipe);
            view.setUint8(off++, recipeKeys.length);
            for (const ing of recipeKeys) {
                off = writeString(view, off, ing);
                view.setUint8(off++, (mill.recipe[ing] ?? 0) & 0xff);
            }
            // Purchased
            const purchasedKeys = Object.keys(mill.purchased);
            view.setUint8(off++, purchasedKeys.length);
            for (const ing of purchasedKeys) {
                off = writeString(view, off, ing);
                view.setUint8(off++, (mill.purchased[ing] ?? 0) & 0xff);
            }
        }
    }
    else {
        view.setUint8(off++, 0); // hasBossMode = false
    }
    return buf.slice(0, off);
}
function decodeSnapshot(buf) {
    const view = new DataView(buf);
    let off = 0;
    if (view.getUint8(off++) !== exports.MSG_SNAPSHOT)
        throw new Error('Invalid snapshot message');
    const tick = view.getUint32(off, true);
    off += 4;
    const matchEndAt = view.getUint32(off, true);
    off += 4;
    const matchEndedEarly = view.getUint8(off++) !== 0;
    const { s: winnerId, next: winnerNext } = readString(view, off);
    off = winnerNext;
    const totalMatchAdoptions = view.getUint32(off, true);
    off += 4;
    const scarcityLevel = view.getUint8(off++);
    const matchDurationMs = view.getUint32(off, true);
    off += 4;
    const numPlayers = view.getUint8(off++);
    const players = [];
    for (let i = 0; i < numPlayers; i++) {
        const { s: id, next: n1 } = readString(view, off);
        off = n1;
        const { s: displayName, next: n2 } = readString(view, off);
        off = n2;
        const x = view.getFloat32(off, true);
        off += 4;
        const y = view.getFloat32(off, true);
        off += 4;
        const vx = view.getFloat32(off, true);
        off += 4;
        const vy = view.getFloat32(off, true);
        off += 4;
        const size = view.getFloat32(off, true);
        off += 4;
        const totalAdoptions = view.getUint32(off, true);
        off += 4;
        const numPets = view.getUint8(off++);
        const petsInside = [];
        for (let j = 0; j < numPets; j++) {
            const { s: pid, next: pn } = readString(view, off);
            off = pn;
            petsInside.push(pid);
        }
        const speedBoostUntil = view.getUint32(off, true);
        off += 4;
        const inputSeq = view.getUint8(off++);
        const eliminated = view.getUint8(off++) !== 0;
        const grounded = view.getUint8(off++) !== 0;
        const portCharges = view.getUint8(off++);
        const shelterPortCharges = view.getUint8(off++);
        const numAllies = view.getUint8(off++);
        const allies = [];
        for (let k = 0; k < numAllies; k++) {
            const { s: allyId, next: allyNext } = readString(view, off);
            off = allyNext;
            allies.push(allyId);
        }
        const { s: shelterColor, next: colorNext } = readString(view, off);
        off = colorNext;
        const money = view.getUint16(off, true);
        off += 2;
        const { s: shelterId, next: shelterIdNext } = readString(view, off);
        off = shelterIdNext;
        const vanSpeedUpgrade = view.getUint8(off++) !== 0;
        players.push({
            id,
            displayName: displayName || id,
            x,
            y,
            vx,
            vy,
            size,
            totalAdoptions,
            petsInside,
            speedBoostUntil,
            inputSeq,
            ...(allies.length ? { allies } : {}),
            ...(eliminated ? { eliminated: true } : {}),
            ...(grounded ? { grounded: true } : {}),
            ...(portCharges > 0 ? { portCharges } : {}),
            ...(shelterPortCharges > 0 ? { shelterPortCharges } : {}),
            ...(shelterColor ? { shelterColor } : {}),
            ...(money > 0 ? { money } : {}),
            ...(shelterId ? { shelterId } : {}),
            ...(vanSpeedUpgrade ? { vanSpeedUpgrade: true } : {}),
        });
    }
    // Use Uint16 for pet count - large maps can have 255+ pets
    const numPets = view.getUint16(off, true);
    off += 2;
    const pets = [];
    for (let i = 0; i < numPets; i++) {
        const { s: id, next: n1 } = readString(view, off);
        off = n1;
        const x = view.getFloat32(off, true);
        off += 4;
        const y = view.getFloat32(off, true);
        off += 4;
        const vx = view.getFloat32(off, true);
        off += 4;
        const vy = view.getFloat32(off, true);
        off += 4;
        const { s: insideStr, next: inNext } = readString(view, off);
        off = inNext;
        const insideShelterId = insideStr === '' ? null : insideStr;
        const petType = off < view.byteLength ? view.getUint8(off++) : 0;
        pets.push({ id, x, y, vx, vy, insideShelterId, petType });
    }
    const numZones = view.getUint8(off++);
    const adoptionZones = [];
    for (let i = 0; i < numZones; i++) {
        const { s: id, next: n1 } = readString(view, off);
        off = n1;
        const x = view.getFloat32(off, true);
        off += 4;
        const y = view.getFloat32(off, true);
        off += 4;
        const radius = view.getFloat32(off, true);
        off += 4;
        adoptionZones.push({ id, x, y, radius });
    }
    const numPickups = view.getUint8(off++);
    const pickups = [];
    for (let i = 0; i < numPickups; i++) {
        const { s: id, next: n1 } = readString(view, off);
        off = n1;
        const x = view.getFloat32(off, true);
        off += 4;
        const y = view.getFloat32(off, true);
        off += 4;
        const type = view.getUint8(off++);
        const level = view.getUint8(off++);
        pickups.push({ id, x, y, type, level: level > 0 ? level : undefined });
    }
    // Decode shelters
    const numShelters = view.getUint8(off++);
    const shelters = [];
    for (let i = 0; i < numShelters; i++) {
        const { s: id, next: n1 } = readString(view, off);
        off = n1;
        const { s: ownerId, next: n2 } = readString(view, off);
        off = n2;
        const x = view.getFloat32(off, true);
        off += 4;
        const y = view.getFloat32(off, true);
        off += 4;
        const flags = view.getUint8(off++);
        const hasAdoptionCenter = (flags & 1) !== 0;
        const hasGravity = (flags & 2) !== 0;
        const hasAdvertising = (flags & 4) !== 0;
        const numShelterPets = view.getUint16(off, true); // Uint16 - shelters can hold 255+ pets
        off += 2;
        const petsInside = [];
        for (let j = 0; j < numShelterPets; j++) {
            const { s: pid, next: pn } = readString(view, off);
            off = pn;
            petsInside.push(pid);
        }
        const shelterSize = view.getFloat32(off, true);
        off += 4;
        const totalAdoptions = view.getUint32(off, true);
        off += 4;
        const tier = off < view.byteLength ? view.getUint8(off++) : (shelterSize < 100 ? 1 : shelterSize < 250 ? 2 : shelterSize < 500 ? 3 : shelterSize < 1000 ? 4 : 5);
        shelters.push({ id, ownerId, x, y, hasAdoptionCenter, hasGravity, hasAdvertising, petsInside, size: shelterSize, totalAdoptions, tier });
    }
    const numBreederShelters = off < view.byteLength ? view.getUint8(off++) : 0;
    const breederShelters = [];
    for (let i = 0; i < numBreederShelters; i++) {
        const { s: bid, next: bn1 } = readString(view, off);
        off = bn1;
        const bx = view.getFloat32(off, true);
        off += 4;
        const by = view.getFloat32(off, true);
        off += 4;
        const level = view.getUint8(off++);
        const bsize = view.getFloat32(off, true);
        off += 4;
        breederShelters.push({ id: bid, x: bx, y: by, level, size: bsize });
    }
    // Decode adoption events
    const numAdoptionEvents = off < view.byteLength ? view.getUint8(off++) : 0;
    const adoptionEvents = [];
    for (let i = 0; i < numAdoptionEvents; i++) {
        const { s: evId, next: evn1 } = readString(view, off);
        off = evn1;
        const { s: evType, next: evn2 } = readString(view, off);
        off = evn2;
        const evX = view.getFloat32(off, true);
        off += 4;
        const evY = view.getFloat32(off, true);
        off += 4;
        const evRadius = view.getUint16(off, true);
        off += 2;
        const startTick = view.getUint32(off, true);
        off += 4;
        const durationTicks = view.getUint32(off, true);
        off += 4;
        const totalNeeded = off + 2 <= view.byteLength ? view.getUint16(off, true) : 0;
        off += 2;
        const totalRescued = off + 2 <= view.byteLength ? view.getUint16(off, true) : 0;
        off += 2;
        adoptionEvents.push({
            id: evId,
            type: evType,
            x: evX,
            y: evY,
            radius: evRadius || 300, // Default to 300 if 0
            requirements: [],
            totalNeeded,
            totalRescued,
            contributions: {},
            startTick,
            durationTicks,
            rewards: { top1: 0, top2: 0, top3: 0, participation: 0 },
        });
    }
    // Decode boss mode
    let bossMode;
    if (off < view.byteLength) {
        const hasBossMode = view.getUint8(off++);
        if (hasBossMode) {
            const startTick = view.getUint32(off, true);
            off += 4;
            const timeLimit = view.getUint32(off, true);
            off += 4;
            const tycoonX = view.getFloat32(off, true);
            off += 4;
            const tycoonY = view.getFloat32(off, true);
            off += 4;
            const tycoonTargetMill = view.getUint8(off++);
            const millsCleared = view.getUint8(off++);
            const mallX = view.getFloat32(off, true);
            off += 4;
            const mallY = view.getFloat32(off, true);
            off += 4;
            const playerAtMill = view.getInt8(off++);
            const rebuildingMill = view.getInt8(off++);
            const numMills = view.getUint8(off++);
            const mills = [];
            for (let i = 0; i < numMills; i++) {
                const id = view.getUint8(off++);
                const petType = view.getUint8(off++);
                const petCount = view.getUint8(off++);
                const mx = view.getFloat32(off, true);
                off += 4;
                const my = view.getFloat32(off, true);
                off += 4;
                const completed = view.getUint8(off++) !== 0;
                // Recipe
                const numRecipeIngredients = view.getUint8(off++);
                const recipe = {};
                for (let j = 0; j < numRecipeIngredients; j++) {
                    const { s: ing, next: ingNext } = readString(view, off);
                    off = ingNext;
                    const amount = view.getUint8(off++);
                    recipe[ing] = amount;
                }
                // Purchased
                const numPurchasedIngredients = view.getUint8(off++);
                const purchased = {};
                for (let j = 0; j < numPurchasedIngredients; j++) {
                    const { s: ing, next: ingNext } = readString(view, off);
                    off = ingNext;
                    const amount = view.getUint8(off++);
                    purchased[ing] = amount;
                }
                mills.push({ id, petType, petCount, recipe, purchased, completed, x: mx, y: my });
            }
            bossMode = {
                active: true,
                startTick,
                timeLimit,
                mills,
                tycoonX,
                tycoonY,
                tycoonTargetMill,
                millsCleared,
                mallX,
                mallY,
                playerAtMill,
                rebuildingMill: rebuildingMill >= 0 ? rebuildingMill : undefined,
            };
        }
    }
    return {
        tick,
        matchEndAt,
        matchEndedEarly: matchEndedEarly || undefined,
        winnerId: winnerId || undefined,
        totalMatchAdoptions,
        scarcityLevel: scarcityLevel > 0 ? scarcityLevel : undefined,
        matchDurationMs,
        players,
        pets,
        adoptionZones,
        pickups,
        shelters: shelters.length > 0 ? shelters : undefined,
        breederShelters: breederShelters.length > 0 ? breederShelters : undefined,
        adoptionEvents: adoptionEvents.length > 0 ? adoptionEvents : undefined,
        bossMode,
    };
}
