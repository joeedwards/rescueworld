/**
 * Game channel protocol (WebRTC unreliable).
 * Snapshot: shelters (players) with size/petsInside, strays (pets), adoption zones.
 */

import type { GameSnapshot, PlayerState, PetState, AdoptionZoneState, PickupState, ShelterState, BreederShelterState } from './types';
import type { InputFlags } from './types';

export const MSG_INPUT = 0x01;
export const MSG_SNAPSHOT = 0x02;

export function encodeInput(inputFlags: InputFlags, inputSeq: number): ArrayBuffer {
  const buf = new ArrayBuffer(4);
  const view = new DataView(buf);
  view.setUint8(0, MSG_INPUT);
  view.setUint16(1, inputFlags, true);
  view.setUint8(3, inputSeq & 0xff);
  return buf;
}

export function decodeInput(buf: ArrayBuffer): { inputFlags: InputFlags; inputSeq: number } {
  const view = new DataView(buf);
  if (view.getUint8(0) !== MSG_INPUT) throw new Error('Invalid input message');
  return {
    inputFlags: view.getUint16(1, true),
    inputSeq: view.getUint8(3),
  };
}

function writeString(view: DataView, offset: number, s: string): number {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(s);
  view.setUint8(offset, bytes.length);
  new Uint8Array(view.buffer).set(bytes, offset + 1);
  return offset + 1 + bytes.length;
}

function readString(view: DataView, offset: number): { s: string; next: number } {
  const len = view.getUint8(offset);
  if (len === 0) return { s: '', next: offset + 1 };
  const maxLen = view.buffer.byteLength - (offset + 1);
  if (len > maxLen || len < 0) throw new RangeError(`Snapshot string length ${len} exceeds buffer (${maxLen} bytes left)`);
  const bytes = new Uint8Array(view.buffer, offset + 1, len);
  const s = new TextDecoder().decode(bytes);
  return { s, next: offset + 1 + len };
}

export function encodeSnapshot(snap: GameSnapshot): ArrayBuffer {
  const encoder = new TextEncoder();
  const players = snap.players ?? [];
  const pets = snap.pets ?? [];
  const adoptionZones = snap.adoptionZones ?? [];
  const pickups = snap.pickups ?? [];
  const shelters = snap.shelters ?? [];
  const breederShelters = snap.breederShelters ?? [];
  // msg(1), tick(4), matchEndAt(4), matchEndedEarly(1), winnerId(string), totalMatchAdoptions(4), scarcityLevel(1), matchDurationMs(4), numPlayers(1)
  let size = 1 + 4 + 4 + 1 + 1 + encoder.encode(snap.winnerId ?? '').length + 4 + 1 + 4 + 1;
  for (const p of players) {
    size += 1 + encoder.encode(p.id).length + 1 + encoder.encode(p.displayName ?? p.id).length + 4 * 4 + 4 + 4 + 1; // id, displayName, x,y,vx,vy, size(4), totalAdoptions(4), numPets
    for (const pid of p.petsInside) size += 1 + encoder.encode(pid).length;
    size += 4 + 1; // speedBoostUntil(4), inputSeq(1)
    size += 1 + 1 + 1 + 1; // eliminated(1), grounded(1), portCharges(1), numAllies(1)
    for (const aid of p.allies ?? []) size += 1 + encoder.encode(aid).length;
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
  // Shelters: count(1), then for each: id, ownerId, x, y, flags(1), numPets, pets, size(4), totalAdoptions(4), tier(1)
  size += 1;
  for (const s of shelters) {
    size += 1 + encoder.encode(s.id).length;
    size += 1 + encoder.encode(s.ownerId).length;
    size += 4 + 4; // x, y
    size += 1; // flags byte (hasAdoptionCenter, hasGravity, hasAdvertising)
    size += 1; // numPets
    for (const pid of s.petsInside) size += 1 + encoder.encode(pid).length;
    size += 4 + 4 + 1; // size(4), totalAdoptions(4), tier(1)
  }
  // Breeder shelters (mills)
  size += 1;
  for (const b of breederShelters) {
    size += 1 + encoder.encode(b.id).length + 4 + 4 + 1 + 4; // id, x, y, level, size
  }
  const buf = new ArrayBuffer(size * 2); // No cap - large games need large buffers
  const view = new DataView(buf);
  let off = 0;
  view.setUint8(off++, MSG_SNAPSHOT);
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
    for (const pid of p.petsInside) off = writeString(view, off, pid);
    view.setUint32(off, (p.speedBoostUntil ?? 0) >>> 0, true);
    off += 4;
    view.setUint8(off++, p.inputSeq & 0xff);
    view.setUint8(off++, (p.eliminated ? 1 : 0));
    view.setUint8(off++, (p.grounded ? 1 : 0));
    view.setUint8(off++, (p.portCharges ?? 0) & 0xff);
    const allies = p.allies ?? [];
    view.setUint8(off++, allies.length);
    for (const aid of allies) off = writeString(view, off, aid);
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
    if (pet.insideShelterId) off = writeString(view, off, pet.insideShelterId);
    else view.setUint8(off++, 0);
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
    view.setUint8(off++, s.petsInside.length);
    for (const pid of s.petsInside) off = writeString(view, off, pid);
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
  return buf.slice(0, off);
}

export function decodeSnapshot(buf: ArrayBuffer): GameSnapshot {
  const view = new DataView(buf);
  let off = 0;
  if (view.getUint8(off++) !== MSG_SNAPSHOT) throw new Error('Invalid snapshot message');
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
  const players: PlayerState[] = [];
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
    const petsInside: string[] = [];
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
    const numAllies = view.getUint8(off++);
    const allies: string[] = [];
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
      ...(shelterColor ? { shelterColor } : {}),
      ...(money > 0 ? { money } : {}),
      ...(shelterId ? { shelterId } : {}),
      ...(vanSpeedUpgrade ? { vanSpeedUpgrade: true } : {}),
    });
  }
  // Use Uint16 for pet count - large maps can have 255+ pets
  const numPets = view.getUint16(off, true);
  off += 2;
  const pets: PetState[] = [];
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
  const adoptionZones: AdoptionZoneState[] = [];
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
  const pickups: PickupState[] = [];
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
  const shelters: ShelterState[] = [];
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
    const numShelterPets = view.getUint8(off++);
    const petsInside: string[] = [];
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
  const breederShelters: BreederShelterState[] = [];
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
  };
}
