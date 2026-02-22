import 'dart:async';
import 'dart:ui';

import 'package:flutter/foundation.dart';

import '../game/models.dart';
import '../net/game_socket_client.dart';

class RenderPet {
  RenderPet({
    required this.id,
    required this.position,
    required this.type,
    this.insideShelterId,
  });

  final String id;
  final Offset position;
  final int type;
  final String? insideShelterId;
}

class GameStateStore {
  GameStateStore(this.socketClient);

  final GameSocketClient socketClient;
  final ValueNotifier<GameSnapshot?> snapshot = ValueNotifier<GameSnapshot?>(null);
  final ValueNotifier<Map<String, dynamic>> status = ValueNotifier<Map<String, dynamic>>(<String, dynamic>{});

  StreamSubscription<GameSnapshot>? _snapshotSub;
  StreamSubscription<Map<String, dynamic>>? _jsonSub;
  GameSnapshot? _prevSnapshot;
  DateTime _prevSnapshotAt = DateTime.now();
  DateTime _currSnapshotAt = DateTime.now();

  void bind() {
    _snapshotSub = socketClient.snapshots.listen((data) {
      _prevSnapshot = snapshot.value;
      _prevSnapshotAt = _currSnapshotAt;
      _currSnapshotAt = DateTime.now();
      snapshot.value = data;
    });
    _jsonSub = socketClient.jsonMessages.listen((data) {
      status.value = data;
    });
  }

  List<RenderPet> interpolatedPets() {
    final curr = snapshot.value;
    final prev = _prevSnapshot;
    if (curr == null) return const <RenderPet>[];
    if (prev == null) {
      return curr.pets
          .map((p) => RenderPet(id: p.id, position: Offset(p.x, p.y), type: p.petType, insideShelterId: p.insideShelterId))
          .toList();
    }
    final dt = _currSnapshotAt.difference(_prevSnapshotAt).inMilliseconds;
    final now = DateTime.now();
    final alpha = dt <= 0
        ? 1.0
        : ((now.difference(_currSnapshotAt).inMilliseconds + 100) / dt).clamp(0.0, 1.0);
    final prevById = <String, PetState>{for (final p in prev.pets) p.id: p};
    return curr.pets.map((p) {
      final old = prevById[p.id];
      if (old == null) {
        return RenderPet(id: p.id, position: Offset(p.x, p.y), type: p.petType, insideShelterId: p.insideShelterId);
      }
      final x = old.x + (p.x - old.x) * alpha;
      final y = old.y + (p.y - old.y) * alpha;
      return RenderPet(id: p.id, position: Offset(x, y), type: p.petType, insideShelterId: p.insideShelterId);
    }).toList();
  }

  Future<void> dispose() async {
    await _snapshotSub?.cancel();
    await _jsonSub?.cancel();
    snapshot.dispose();
    status.dispose();
  }
}
