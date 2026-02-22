import 'package:flutter/material.dart';

import '../game/models.dart';

class GameHud extends StatelessWidget {
  const GameHud({
    super.key,
    required this.snapshot,
    required this.localPlayerId,
    required this.onAction,
    required this.lastStatus,
  });

  final GameSnapshot? snapshot;
  final String? localPlayerId;
  final void Function(String type) onAction;
  final Map<String, dynamic> lastStatus;

  @override
  Widget build(BuildContext context) {
    final me = snapshot?.players.where((p) => p.id == localPlayerId).cast<PlayerState?>().firstOrNull ?? snapshot?.players.firstOrNull;
    return IgnorePointer(
      ignoring: false,
      child: Column(
        children: [
          Container(
            width: double.infinity,
            color: const Color(0xCC0F1F24),
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
            child: Wrap(
              spacing: 12,
              runSpacing: 8,
              children: [
                Text('Tick: ${snapshot?.tick ?? 0}', style: const TextStyle(color: Colors.white)),
                Text('Adoptions: ${me?.totalAdoptions ?? 0}', style: const TextStyle(color: Colors.white)),
                Text('Pets: ${me?.petsInside.length ?? 0}', style: const TextStyle(color: Colors.white)),
                Text('Money: ${me?.money ?? 0}', style: const TextStyle(color: Colors.white)),
                if (snapshot?.teamScores != null)
                  Text(
                    'Teams R:${snapshot!.teamScores!['red']} B:${snapshot!.teamScores!['blue']}',
                    style: const TextStyle(color: Colors.white),
                  ),
                if (lastStatus.isNotEmpty)
                  Text(
                    'Status: ${lastStatus['type'] ?? 'event'}',
                    style: const TextStyle(color: Colors.white70),
                  ),
              ],
            ),
          ),
          const Spacer(),
          Align(
            alignment: Alignment.bottomCenter,
            child: SingleChildScrollView(
              scrollDirection: Axis.horizontal,
              child: Row(
                children: [
                  _cmd('Build', 'buildShelter'),
                  _cmd('AdoptCtr', 'buyAdoptionCenter'),
                  _cmd('Gravity', 'buyGravity'),
                  _cmd('Ads', 'buyAdvertising'),
                  _cmd('Van+', 'buyVanSpeed'),
                  _cmd('Port', 'usePort'),
                  _cmd('ShelterPort', 'useShelterPort'),
                  _cmd('Ready', 'ready'),
                  _cmd('Boost', 'useBoost'),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _cmd(String label, String action) {
    return Padding(
      padding: const EdgeInsets.all(4),
      child: FilledButton(
        onPressed: () => onAction(action),
        child: Text(label),
      ),
    );
  }
}

extension _FirstOrNull<E> on Iterable<E> {
  E? get firstOrNull => isEmpty ? null : first;
}
