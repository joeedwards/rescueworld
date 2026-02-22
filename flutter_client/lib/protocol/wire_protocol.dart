import 'dart:convert';
import 'dart:typed_data';

import '../game/constants.dart';
import '../game/models.dart';

Uint8List encodeInput(int inputFlags, int inputSeq) {
  final data = ByteData(4);
  data.setUint8(0, msgInput);
  data.setUint16(1, inputFlags, Endian.little);
  data.setUint8(3, inputSeq & 0xff);
  return data.buffer.asUint8List();
}

class _Reader {
  _Reader(this.bytes) : _view = ByteData.sublistView(bytes);
  final Uint8List bytes;
  final ByteData _view;
  int off = 0;

  int get length => _view.lengthInBytes;
  int u8() => _view.getUint8(off++);
  int i8() => _view.getInt8(off++);

  int u16() {
    final out = _view.getUint16(off, Endian.little);
    off += 2;
    return out;
  }

  int u32() {
    final out = _view.getUint32(off, Endian.little);
    off += 4;
    return out;
  }

  double f32() {
    final out = _view.getFloat32(off, Endian.little);
    off += 4;
    return out;
  }

  String str() {
    final len = u8();
    if (len == 0) return '';
    final end = off + len;
    if (end > length) throw RangeError('String length exceeds buffer');
    final out = utf8.decode(bytes.sublist(off, end));
    off = end;
    return out;
  }
}

GameSnapshot decodeSnapshot(Uint8List bytes) {
  final r = _Reader(bytes);
  if (r.u8() != msgSnapshot) throw StateError('Invalid snapshot message');

  final tick = r.u32();
  final matchEndAt = r.u32();
  final matchEndedEarly = r.u8() != 0;
  final winnerId = r.str();
  final strayLoss = r.u8() != 0;
  final totalMatchAdoptions = r.u32();
  final scarcityLevel = r.u8();
  final matchDurationMs = r.u32();
  final totalOutdoorStrays = r.u16();

  final players = <PlayerState>[];
  for (var i = 0; i < r.u8(); i++) {
    final id = r.str();
    final displayName = r.str();
    final x = r.f32();
    final y = r.f32();
    final vx = r.f32();
    final vy = r.f32();
    final size = r.f32();
    final totalAdoptions = r.u32();
    final petsInside = <String>[];
    for (var j = 0; j < r.u8(); j++) {
      petsInside.add(r.str());
    }
    final speedBoostUntil = r.u32();
    final inputSeq = r.u8();
    final eliminated = r.u8() != 0;
    final grounded = r.u8() != 0;
    final portCharges = r.u8();
    final shelterPortCharges = r.u8();
    final allies = <String>[];
    for (var j = 0; j < r.u8(); j++) {
      allies.add(r.str());
    }
    final shelterColor = r.str();
    final money = r.u16();
    final shelterId = r.str();
    final vanSpeedUpgrade = r.u8() != 0;
    final vanLure = r.u8() != 0;
    final teamByte = r.off < r.length ? r.u8() : 0;
    players.add(PlayerState(
      id: id,
      displayName: displayName.isEmpty ? id : displayName,
      x: x,
      y: y,
      vx: vx,
      vy: vy,
      size: size,
      totalAdoptions: totalAdoptions,
      petsInside: petsInside,
      speedBoostUntil: speedBoostUntil,
      inputSeq: inputSeq,
      allies: allies,
      eliminated: eliminated,
      grounded: grounded,
      portCharges: portCharges,
      shelterPortCharges: shelterPortCharges,
      shelterColor: shelterColor.isEmpty ? null : shelterColor,
      money: money,
      shelterId: shelterId.isEmpty ? null : shelterId,
      vanSpeedUpgrade: vanSpeedUpgrade,
      vanLure: vanLure,
      team: teamByte == 1 ? 'red' : teamByte == 2 ? 'blue' : null,
    ));
  }

  final pets = <PetState>[];
  for (var i = 0; i < r.u16(); i++) {
    final id = r.str();
    final x = r.f32();
    final y = r.f32();
    final vx = r.f32();
    final vy = r.f32();
    final inside = r.str();
    final petType = r.off < r.length ? r.u8() : 0;
    pets.add(PetState(
      id: id,
      x: x,
      y: y,
      vx: vx,
      vy: vy,
      insideShelterId: inside.isEmpty ? null : inside,
      petType: petType,
    ));
  }

  final zones = <AdoptionZoneState>[];
  for (var i = 0; i < r.u8(); i++) {
    zones.add(AdoptionZoneState(id: r.str(), x: r.f32(), y: r.f32(), radius: r.f32()));
  }

  final pickups = <PickupState>[];
  for (var i = 0; i < r.u8(); i++) {
    final id = r.str();
    final x = r.f32();
    final y = r.f32();
    final type = r.u8();
    final level = r.u8();
    pickups.add(PickupState(id: id, x: x, y: y, type: type, level: level == 0 ? null : level));
  }

  final shelters = <ShelterState>[];
  for (var i = 0; i < r.u8(); i++) {
    final id = r.str();
    final ownerId = r.str();
    final x = r.f32();
    final y = r.f32();
    final flags = r.u8();
    final petsInside = <String>[];
    for (var j = 0; j < r.u16(); j++) {
      petsInside.add(r.str());
    }
    shelters.add(ShelterState(
      id: id,
      ownerId: ownerId,
      x: x,
      y: y,
      hasAdoptionCenter: (flags & 1) != 0,
      hasGravity: (flags & 2) != 0,
      hasAdvertising: (flags & 4) != 0,
      petsInside: petsInside,
      size: r.f32(),
      totalAdoptions: r.u32(),
      tier: r.off < r.length ? r.u8() : 1,
    ));
  }

  final breederShelters = <BreederShelterState>[];
  for (var i = 0; i < (r.off < r.length ? r.u8() : 0); i++) {
    breederShelters.add(BreederShelterState(
      id: r.str(),
      x: r.f32(),
      y: r.f32(),
      level: r.u8(),
      size: r.f32(),
      millCount: r.off < r.length ? r.u8() : 1,
    ));
  }

  final adoptionEvents = <AdoptionEventState>[];
  for (var i = 0; i < (r.off < r.length ? r.u8() : 0); i++) {
    adoptionEvents.add(AdoptionEventState(
      id: r.str(),
      type: r.str(),
      x: r.f32(),
      y: r.f32(),
      radius: r.u16(),
      startTick: r.u32(),
      durationTicks: r.u32(),
      totalNeeded: r.off + 2 <= r.length ? r.u16() : 0,
      totalRescued: r.off + 2 <= r.length ? r.u16() : 0,
    ));
  }

  BossModeState? bossMode;
  if (r.off < r.length && r.u8() != 0) {
    final startTick = r.u32();
    final timeLimit = r.u32();
    final tycoonX = r.f32();
    final tycoonY = r.f32();
    final tycoonTargetMill = r.u8();
    final millsCleared = r.u8();
    final mallX = r.f32();
    final mallY = r.f32();
    final playerAtMill = r.i8();
    final rebuildingMill = r.i8();
    final mills = <BossMill>[];
    for (var i = 0; i < r.u8(); i++) {
      final id = r.u8();
      final petType = r.u8();
      final petCount = r.u8();
      final x = r.f32();
      final y = r.f32();
      final completed = r.u8() != 0;
      final recipe = <String, int>{};
      for (var j = 0; j < r.u8(); j++) {
        recipe[r.str()] = r.u8();
      }
      final purchased = <String, int>{};
      for (var j = 0; j < r.u8(); j++) {
        purchased[r.str()] = r.u8();
      }
      mills.add(BossMill(
        id: id,
        petType: petType,
        petCount: petCount,
        recipe: recipe,
        purchased: purchased,
        completed: completed,
        x: x,
        y: y,
      ));
    }
    bossMode = BossModeState(
      active: true,
      startTick: startTick,
      timeLimit: timeLimit,
      mills: mills,
      tycoonX: tycoonX,
      tycoonY: tycoonY,
      tycoonTargetMill: tycoonTargetMill,
      millsCleared: millsCleared,
      mallX: mallX,
      mallY: mallY,
      playerAtMill: playerAtMill,
      rebuildingMill: rebuildingMill < 0 ? null : rebuildingMill,
    );
  }

  Map<String, int>? teamScores;
  String? winningTeam;
  if (r.off < r.length && r.u8() != 0) {
    teamScores = <String, int>{'red': r.u32(), 'blue': r.u32()};
    final winning = r.u8();
    winningTeam = winning == 1 ? 'red' : winning == 2 ? 'blue' : null;
  }

  return GameSnapshot(
    tick: tick,
    matchEndAt: matchEndAt,
    matchEndedEarly: matchEndedEarly,
    winnerId: winnerId.isEmpty ? null : winnerId,
    strayLoss: strayLoss,
    totalMatchAdoptions: totalMatchAdoptions,
    scarcityLevel: scarcityLevel == 0 ? null : scarcityLevel,
    matchDurationMs: matchDurationMs,
    totalOutdoorStrays: totalOutdoorStrays,
    players: players,
    pets: pets,
    adoptionZones: zones,
    pickups: pickups,
    shelters: shelters,
    breederShelters: breederShelters,
    adoptionEvents: adoptionEvents,
    bossMode: bossMode,
    teamScores: teamScores,
    winningTeam: winningTeam,
  );
}
