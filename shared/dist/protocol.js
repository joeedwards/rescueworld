"use strict";
/**
 * Game channel protocol (WebRTC unreliable).
 * Snapshot: shelters (players) with size/petsInside, strays (pets), adoption zones.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.MSG_SNAPSHOT = exports.MSG_INPUT = void 0;
exports.encodeInput = encodeInput;
exports.decodeInput = decodeInput;
exports.encodeSnapshot = encodeSnapshot;
exports.decodeSnapshot = decodeSnapshot;
exports.MSG_INPUT = 0x01;
exports.MSG_SNAPSHOT = 0x02;
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
    let size = 1 + 4 + 4 + 1;
    for (const p of players) {
        size += 1 + encoder.encode(p.id).length + 1 + encoder.encode(p.displayName ?? p.id).length + 4 * 4 + 4 + 4 + 1; // id, displayName, x,y,vx,vy, size(4), totalAdoptions(4), numPets
        for (const pid of p.petsInside)
            size += 1 + encoder.encode(pid).length;
        size += 4 + 1; // speedBoostUntil(4), inputSeq(1)
    }
    size += 1;
    for (const pet of pets) {
        size += 1 + encoder.encode(pet.id).length + 4 * 4 + 1 + (pet.insideShelterId ? encoder.encode(pet.insideShelterId).length : 0) + 1;
    }
    size += 1;
    for (const z of adoptionZones) {
        size += 1 + encoder.encode(z.id).length + 4 + 4 + 4;
    }
    size += 1;
    for (const u of pickups) {
        size += 1 + encoder.encode(u.id).length + 4 + 4 + 1;
    }
    const buf = new ArrayBuffer(Math.min(size * 2, 65536));
    const view = new DataView(buf);
    let off = 0;
    view.setUint8(off++, exports.MSG_SNAPSHOT);
    view.setUint32(off, snap.tick, true);
    off += 4;
    view.setUint32(off, snap.matchEndAt, true);
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
    }
    view.setUint8(off++, pets.length);
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
        players.push({ id, displayName: displayName || id, x, y, vx, vy, size, totalAdoptions, petsInside, speedBoostUntil, inputSeq });
    }
    const numPets = view.getUint8(off++);
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
        const insideLen = view.getUint8(off++);
        const { s: insideStr, next: inNext } = readString(view, off - 1);
        off = inNext;
        const insideShelterId = insideLen === 0 ? null : insideStr;
        pets.push({ id, x, y, vx, vy, insideShelterId });
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
        pickups.push({ id, x, y, type });
    }
    return { tick, matchEndAt, players, pets, adoptionZones, pickups };
}
