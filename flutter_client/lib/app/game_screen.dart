import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../audio/audio_controller.dart';
import '../game/constants.dart';
import '../game/models.dart';
import '../input/input_controller.dart';
import '../net/game_socket_client.dart' as gs;
import '../render/game_painter.dart';
import '../state/game_state_store.dart';
import '../ui/game_hud.dart';

class GameScreen extends StatefulWidget {
  const GameScreen({super.key});

  @override
  State<GameScreen> createState() => _GameScreenState();
}

class _GameScreenState extends State<GameScreen> {
  final socketClient = gs.GameSocketClient();
  late final GameStateStore store = GameStateStore(socketClient);
  final input = InputController();
  final audio = AudioController();
  final _pressed = <LogicalKeyboardKey>{};
  Timer? _inputTimer;
  StreamSubscription<gs.WelcomeInfo>? _welcomeSub;
  StreamSubscription<gs.ConnectionState>? _connectionSub;
  String? _localPlayerId;
  Offset _joystick = Offset.zero;
  gs.ConnectionState _connection = gs.ConnectionState.disconnected;

  Uri get _signalingUrl {
    final env = const String.fromEnvironment('SIGNALING_WS_URL');
    if (env.isNotEmpty) return Uri.parse(env);
    if (kIsWeb) {
      final base = Uri.base;
      final secure = base.scheme == 'https';
      final scheme = secure ? 'wss' : 'ws';
      return Uri.parse('$scheme://${base.host}${base.hasPort ? ':${base.port}' : ''}/ws-signaling');
    }
    return Uri.parse('ws://localhost:4000');
  }

  @override
  void initState() {
    super.initState();
    store.bind();
    socketClient.connect(signalingUrl: _signalingUrl, mode: 'ffa');
    _welcomeSub = socketClient.welcomeMessages.listen((welcome) {
      setState(() {
        _localPlayerId = welcome.playerId;
      });
    });
    _connectionSub = socketClient.connectionStates.listen((state) {
      setState(() {
        _connection = state;
      });
    });
    _inputTimer = Timer.periodic(Duration(milliseconds: tickMs.toInt()), (_) {
      socketClient.sendInput(input.flags, input.nextInputSeq());
    });
  }

  @override
  void dispose() {
    _inputTimer?.cancel();
    _welcomeSub?.cancel();
    _connectionSub?.cancel();
    store.dispose();
    audio.dispose();
    socketClient.close();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return KeyboardListener(
      focusNode: FocusNode()..requestFocus(),
      onKeyEvent: (event) {
        if (event is KeyDownEvent) {
          _pressed.add(event.logicalKey);
        } else if (event is KeyUpEvent) {
          _pressed.remove(event.logicalKey);
        }
        input.setFromKeyboard(_pressed);
      },
      child: Scaffold(
        body: SafeArea(
          child: Stack(
            children: [
              Positioned.fill(
                child: ValueListenableBuilder<GameSnapshot?>(
                  valueListenable: store.snapshot,
                  builder: (context, snapshot, _) {
                    return CustomPaint(
                      painter: GamePainter(
                        snapshot: snapshot,
                        interpolatedPets: store.interpolatedPets(),
                        localPlayerId: _localPlayerId,
                      ),
                    );
                  },
                ),
              ),
              Positioned.fill(
                child: ValueListenableBuilder<GameSnapshot?>(
                  valueListenable: store.snapshot,
                  builder: (context, snap, _) {
                    return ValueListenableBuilder<Map<String, dynamic>>(
                      valueListenable: store.status,
                      builder: (context, status, child) {
                        return GameHud(
                          snapshot: snap,
                          localPlayerId: _localPlayerId,
                          lastStatus: status,
                          onAction: _sendAction,
                        );
                      },
                    );
                  },
                ),
              ),
              Positioned(
                top: 10,
                left: 12,
                child: Container(
                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                  color: const Color(0x99000000),
                  child: Text(
                    'Conn: ${_connection.name}',
                    style: const TextStyle(color: Colors.white, fontSize: 12),
                  ),
                ),
              ),
              Positioned(
                left: 20,
                bottom: 20,
                child: _buildJoystick(),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildJoystick() {
    return GestureDetector(
      onPanStart: (_) => setState(() => _joystick = Offset.zero),
      onPanUpdate: (d) {
        final n = Offset((d.localPosition.dx - 45) / 45, (d.localPosition.dy - 45) / 45);
        final dx = n.dx.clamp(-1.0, 1.0);
        final dy = n.dy.clamp(-1.0, 1.0);
        setState(() {
          _joystick = Offset(dx, dy);
        });
        input.setFromJoystick(dx, dy);
      },
      onPanEnd: (_) {
        setState(() => _joystick = Offset.zero);
        input.setFromJoystick(0, 0);
      },
      child: SizedBox(
        width: 90,
        height: 90,
        child: CustomPaint(
          painter: _JoystickPainter(_joystick),
        ),
      ),
    );
  }

  void _sendAction(String action) {
    switch (action) {
      case 'useBoost':
        socketClient.sendJson(<String, dynamic>{'type': 'useBoost', 'boostType': 'adoptSpeed'});
        return;
      default:
        socketClient.sendJson(<String, dynamic>{'type': action});
    }
  }
}

class _JoystickPainter extends CustomPainter {
  _JoystickPainter(this.n);
  final Offset n;
  @override
  void paint(Canvas canvas, Size size) {
    canvas.drawCircle(size.center(Offset.zero), 44, Paint()..color = const Color(0x880F1F24));
    final knob = Offset(
      size.width / 2 + n.dx * 24,
      size.height / 2 + n.dy * 24,
    );
    canvas.drawCircle(knob, 18, Paint()..color = const Color(0xFF8DB7C4));
  }

  @override
  bool shouldRepaint(covariant _JoystickPainter oldDelegate) =>
      (oldDelegate.n - n).distance > 0.001;
}
