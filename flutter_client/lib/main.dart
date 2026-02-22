import 'package:flutter/material.dart';

import 'app/game_screen.dart';

void main() {
  runApp(const RescueWorldApp());
}

class RescueWorldApp extends StatelessWidget {
  const RescueWorldApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'RescueWorld Flutter',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        colorScheme: ColorScheme.fromSeed(seedColor: const Color(0xFF2E8FA7)),
      ),
      home: const GameScreen(),
    );
  }
}
