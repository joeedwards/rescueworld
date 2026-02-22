import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';

import 'package:web_socket_channel/web_socket_channel.dart';

import '../game/constants.dart';
import '../game/models.dart';
import '../protocol/wire_protocol.dart';

enum ConnectionState {
  disconnected,
  connectingSignaling,
  connectingGame,
  connected,
  reconnecting,
  failed,
}

class WelcomeInfo {
  WelcomeInfo({
    required this.matchId,
    required this.playerId,
    required this.mode,
    required this.startingRt,
    required this.startingPorts,
    required this.shelterPortCharges,
    required this.resumed,
  });

  final String matchId;
  final String playerId;
  final String mode;
  final int startingRt;
  final int startingPorts;
  final int shelterPortCharges;
  final bool resumed;
}

class GameSocketClient {
  final _snapshotController = StreamController<GameSnapshot>.broadcast();
  final _jsonController = StreamController<Map<String, dynamic>>.broadcast();
  final _welcomeController = StreamController<WelcomeInfo>.broadcast();
  final _connectionController = StreamController<ConnectionState>.broadcast();

  WebSocketChannel? _signaling;
  WebSocketChannel? _game;
  String? _lastMatchId;
  String? _lastMode;
  Completer<String>? _gameUrlCompleter;
  Timer? _pingTimer;
  bool _receivedPong = true;
  ConnectionState _connectionState = ConnectionState.disconnected;

  Stream<GameSnapshot> get snapshots => _snapshotController.stream;
  Stream<Map<String, dynamic>> get jsonMessages => _jsonController.stream;
  Stream<WelcomeInfo> get welcomeMessages => _welcomeController.stream;
  Stream<ConnectionState> get connectionStates => _connectionController.stream;
  String? get lastMatchId => _lastMatchId;
  ConnectionState get connectionState => _connectionState;

  void _setConnectionState(ConnectionState next) {
    _connectionState = next;
    _connectionController.add(next);
  }

  Future<void> connect({
    required Uri signalingUrl,
    required String mode,
    String? displayName,
    String? userId,
    String? rejoinMatchId,
    String? joinMatchId,
    String? team,
    bool botsEnabled = true,
    int? guestStartingRt,
    bool abandon = false,
  }) async {
    _lastMode = mode;
    _setConnectionState(ConnectionState.connectingSignaling);
    _gameUrlCompleter = Completer<String>();
    _signaling = WebSocketChannel.connect(signalingUrl);
    _signaling!.stream.listen(_onSignalingMessage);
    _signaling!.sink.add(jsonEncode(<String, dynamic>{
      'type': 'join',
      'latency': 0,
      'mode': mode,
    }));

    final gameUrl = await _gameUrlCompleter!.future.timeout(const Duration(seconds: 5));

    _setConnectionState(ConnectionState.connectingGame);
    _game?.sink.close();
    _game = await _connectGameWithFallback(signalingUrl: signalingUrl, gameUrl: gameUrl);
    _game!.stream.listen(_onGameMessage, onDone: _onGameClosed, onError: (_) => _onGameClosed());
    final modePayload = <String, dynamic>{
      'type': 'mode',
      'mode': mode,
      'abandon': abandon,
      'botsEnabled': botsEnabled,
    };
    if (displayName?.isNotEmpty ?? false) modePayload['displayName'] = displayName;
    if (userId?.isNotEmpty ?? false) modePayload['userId'] = userId;
    if (rejoinMatchId?.isNotEmpty ?? false) modePayload['rejoinMatchId'] = rejoinMatchId;
    if (joinMatchId?.isNotEmpty ?? false) modePayload['joinMatchId'] = joinMatchId;
    if (team != null) modePayload['team'] = team;
    if ((guestStartingRt ?? 0) > 0) modePayload['guestStartingRt'] = guestStartingRt;
    _game!.sink.add(jsonEncode(modePayload));

    _pingTimer?.cancel();
    _pingTimer = Timer.periodic(const Duration(seconds: 4), (_) {
      if (_game == null) return;
      if (!_receivedPong) {
        _setConnectionState(ConnectionState.failed);
        return;
      }
      _receivedPong = false;
      _game!.sink.add(jsonEncode(<String, dynamic>{
        'type': 'ping',
        'ts': DateTime.now().millisecondsSinceEpoch,
      }));
    });
  }

  Future<WebSocketChannel> _connectGameWithFallback({
    required Uri signalingUrl,
    required String gameUrl,
  }) async {
    final primaryUri = Uri.parse(gameUrl);
    final isLocalSignal = signalingUrl.host == 'localhost' || signalingUrl.host == '127.0.0.1';
    final isLocalGame = primaryUri.host == 'localhost' || primaryUri.host == '127.0.0.1';
    final useFallback = isLocalSignal && isLocalGame && primaryUri.port != 4001;
    final target = useFallback ? Uri.parse('ws://localhost:4001') : primaryUri;
    return WebSocketChannel.connect(target);
  }

  String? _lastGameUrl;

  void _onSignalingMessage(dynamic event) {
    if (event is! String) return;
    final decoded = jsonDecode(event);
    if (decoded is! Map<String, dynamic>) return;
    if (decoded['type'] == 'joined' && decoded['gameUrl'] is String) {
      _lastGameUrl = decoded['gameUrl'] as String;
      if (_gameUrlCompleter != null && !_gameUrlCompleter!.isCompleted) {
        _gameUrlCompleter!.complete(_lastGameUrl!);
      }
    }
    _jsonController.add(decoded);
  }

  void _onGameMessage(dynamic event) {
    if (event is String) {
      final decoded = jsonDecode(event);
      if (decoded is Map<String, dynamic>) {
        if (decoded['type'] == 'welcome') {
          _lastMatchId = decoded['matchId'] as String?;
          _welcomeController.add(
            WelcomeInfo(
              matchId: (decoded['matchId'] as String?) ?? '',
              playerId: (decoded['playerId'] as String?) ?? '',
              mode: (decoded['mode'] as String?) ?? '',
              startingRt: (decoded['startingRT'] as num?)?.toInt() ?? 0,
              startingPorts: (decoded['startingPorts'] as num?)?.toInt() ?? 0,
              shelterPortCharges: (decoded['shelterPortCharges'] as num?)?.toInt() ?? 0,
              resumed: decoded['resumed'] == true,
            ),
          );
          _setConnectionState(ConnectionState.connected);
        } else if (decoded['type'] == 'pong') {
          _receivedPong = true;
        }
        _jsonController.add(decoded);
      }
      return;
    }

    if (event is List<int>) {
      _handleBinary(Uint8List.fromList(event));
      return;
    }
    if (event is Uint8List) {
      _handleBinary(event);
    }
  }

  void _handleBinary(Uint8List bytes) {
    if (bytes.isEmpty) return;
    if (bytes[0] != msgSnapshot) return;
    try {
      final snapshot = decodeSnapshot(bytes);
      _snapshotController.add(snapshot);
    } catch (_) {
      // Keep socket processing alive even if one malformed packet appears.
    }
  }

  void sendInput(int inputFlags, int inputSeq) {
    _game?.sink.add(encodeInput(inputFlags, inputSeq));
  }

  void sendJson(Map<String, dynamic> payload) {
    _game?.sink.add(jsonEncode(payload));
  }

  Future<void> tryReconnect({
    required Uri signalingUrl,
    String? displayName,
    String? userId,
    String? team,
    int? guestStartingRt,
  }) async {
    _setConnectionState(ConnectionState.reconnecting);
    final mode = _lastMode ?? 'ffa';
    await connect(
      signalingUrl: signalingUrl,
      mode: mode,
      displayName: displayName,
      userId: userId,
      rejoinMatchId: _lastMatchId,
      team: team,
      guestStartingRt: guestStartingRt,
    );
  }

  Future<void> close() async {
    _pingTimer?.cancel();
    _setConnectionState(ConnectionState.disconnected);
    await _snapshotController.close();
    await _jsonController.close();
    await _welcomeController.close();
    await _connectionController.close();
    await _signaling?.sink.close();
    await _game?.sink.close();
  }

  void _onGameClosed() {
    _setConnectionState(ConnectionState.disconnected);
  }
}
