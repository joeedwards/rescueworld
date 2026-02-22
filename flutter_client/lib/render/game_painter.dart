import 'dart:math';

import 'package:flutter/material.dart';

import '../game/constants.dart';
import '../game/models.dart';
import '../state/game_state_store.dart';

class GamePainter extends CustomPainter {
  GamePainter({
    required this.snapshot,
    required this.interpolatedPets,
    required this.localPlayerId,
  });

  final GameSnapshot? snapshot;
  final List<RenderPet> interpolatedPets;
  final String? localPlayerId;

  @override
  void paint(Canvas canvas, Size size) {
    canvas.drawRect(Offset.zero & size, Paint()..color = const Color(0xFF15272F));
    if (snapshot == null) return;
    final snap = snapshot!;
    final me = snap.players.where((p) => p.id == localPlayerId).cast<PlayerState?>().firstOrNull ?? snap.players.firstOrNull;
    final camX = me?.x ?? mapWidth / 2;
    final camY = me?.y ?? mapHeight / 2;
    final viewport = Rect.fromCenter(
      center: Offset(camX, camY),
      width: size.width + 120,
      height: size.height + 120,
    );
    final offset = Offset(size.width / 2 - camX, size.height / 2 - camY);
    canvas.save();
    canvas.translate(offset.dx, offset.dy);

    _drawWorldBounds(canvas);
    _drawZones(canvas, snap.adoptionZones);
    _drawPickups(canvas, snap.pickups);
    _drawShelters(canvas, snap.shelters);
    _drawBreederShelters(canvas, snap.breederShelters);
    _drawEvents(canvas, snap.adoptionEvents);
    _drawPets(canvas, interpolatedPets, viewport);
    _drawPlayers(canvas, snap.players, viewport);
    _drawBoss(canvas, snap.bossMode);
    canvas.restore();

    _drawMiniMap(canvas, size, snap);
  }

  void _drawWorldBounds(Canvas canvas) {
    canvas.drawRect(
      Rect.fromLTWH(0, 0, mapWidth, mapHeight),
      Paint()
        ..color = const Color(0xFF1D3940)
        ..style = PaintingStyle.stroke
        ..strokeWidth = 4,
    );
  }

  void _drawZones(Canvas canvas, List<AdoptionZoneState> zones) {
    final fill = Paint()..color = const Color(0x4428E08F);
    final line = Paint()
      ..color = const Color(0xFF28E08F)
      ..style = PaintingStyle.stroke
      ..strokeWidth = 2;
    for (final z in zones) {
      canvas.drawCircle(Offset(z.x, z.y), z.radius, fill);
      canvas.drawCircle(Offset(z.x, z.y), z.radius, line);
    }
  }

  void _drawPickups(Canvas canvas, List<PickupState> pickups) {
    for (final p in pickups) {
      final color = switch (p.type) {
        0 => const Color(0xFF5DD267),
        1 => const Color(0xFF4DA4FF),
        2 => const Color(0xFFFFD05A),
        3 => const Color(0xFFC58BFF),
        4 => const Color(0xFFFFAA5A),
        _ => const Color(0xFFCCCCCC),
      };
      canvas.drawCircle(Offset(p.x, p.y), 10, Paint()..color = color);
    }
  }

  void _drawShelters(Canvas canvas, List<ShelterState> shelters) {
    final fill = Paint()..color = const Color(0x88DF6A6A);
    for (final s in shelters) {
      canvas.drawCircle(Offset(s.x, s.y), max(16, s.size * 0.2), fill);
    }
  }

  void _drawBreederShelters(Canvas canvas, List<BreederShelterState> breederShelters) {
    final fill = Paint()..color = const Color(0x99A65EFF);
    for (final s in breederShelters) {
      canvas.drawCircle(Offset(s.x, s.y), max(20, s.size * 0.25), fill);
    }
  }

  void _drawEvents(Canvas canvas, List<AdoptionEventState> events) {
    final line = Paint()
      ..color = const Color(0x99F5C04E)
      ..style = PaintingStyle.stroke
      ..strokeWidth = 2;
    for (final e in events) {
      canvas.drawCircle(Offset(e.x, e.y), e.radius.toDouble(), line);
    }
  }

  void _drawPets(Canvas canvas, List<RenderPet> pets, Rect viewport) {
    var spriteBudget = 350;
    for (final p in pets) {
      if (p.insideShelterId != null) continue;
      if (!viewport.contains(p.position)) continue;
      final color = switch (p.type) {
        0 => const Color(0xFFCB8F5F),
        1 => const Color(0xFF9D6D46),
        2 => const Color(0xFF75C6E8),
        3 => const Color(0xFFD9D3B4),
        4 => const Color(0xFFFFD700),
        _ => const Color(0xFFCB8F5F),
      };
      if (spriteBudget > 0) {
        spriteBudget--;
        canvas.drawCircle(p.position, 6, Paint()..color = color);
      } else {
        canvas.drawRect(
          Rect.fromCenter(center: p.position, width: 3, height: 3),
          Paint()..color = color,
        );
      }
    }
  }

  void _drawPlayers(Canvas canvas, List<PlayerState> players, Rect viewport) {
    for (final p in players) {
      final pos = Offset(p.x, p.y);
      if (!viewport.contains(pos)) continue;
      final base = p.id == localPlayerId ? const Color(0xFFE8F16A) : const Color(0xFFE4E8EF);
      canvas.drawCircle(pos, max(14, p.size * 0.14), Paint()..color = base);
    }
  }

  void _drawBoss(Canvas canvas, BossModeState? boss) {
    if (boss == null || !boss.active) return;
    canvas.drawCircle(Offset(boss.tycoonX, boss.tycoonY), 20, Paint()..color = const Color(0xFFE05252));
    for (final mill in boss.mills) {
      canvas.drawCircle(Offset(mill.x, mill.y), 14, Paint()..color = const Color(0xFFFA7C2A));
    }
  }

  void _drawMiniMap(Canvas canvas, Size size, GameSnapshot snap) {
    const mmW = 160.0;
    const mmH = 160.0;
    final left = size.width - mmW - 14;
    final top = 14.0;
    final bg = Rect.fromLTWH(left, top, mmW, mmH);
    canvas.drawRect(bg, Paint()..color = const Color(0xBB0F1E24));
    canvas.drawRect(
      bg,
      Paint()
        ..color = const Color(0xFF6F8A95)
        ..style = PaintingStyle.stroke,
    );
    for (final p in snap.players) {
      final x = left + (p.x / mapWidth) * mmW;
      final y = top + (p.y / mapHeight) * mmH;
      canvas.drawCircle(Offset(x, y), 3, Paint()..color = p.id == localPlayerId ? Colors.yellow : Colors.white);
    }
  }

  @override
  bool shouldRepaint(covariant GamePainter oldDelegate) {
    return oldDelegate.snapshot != snapshot ||
        oldDelegate.interpolatedPets != interpolatedPets ||
        oldDelegate.localPlayerId != localPlayerId;
  }
}

extension _FirstOrNull<E> on Iterable<E> {
  E? get firstOrNull => isEmpty ? null : first;
}
