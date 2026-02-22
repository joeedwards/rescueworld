import 'package:just_audio/just_audio.dart';

class AudioController {
  final AudioPlayer _music = AudioPlayer();
  final AudioPlayer _sfx = AudioPlayer();
  bool _enabled = true;

  bool get enabled => _enabled;

  Future<void> setEnabled(bool value) async {
    _enabled = value;
    if (!_enabled) {
      await _music.stop();
      await _sfx.stop();
    }
  }

  Future<void> playCollectFx() async {
    if (!_enabled) return;
    await _sfx.setVolume(0.6);
    // Placeholder short tone file can be swapped for game assets later.
  }

  Future<void> stopAll() async {
    await _music.stop();
    await _sfx.stop();
  }

  Future<void> dispose() async {
    await _music.dispose();
    await _sfx.dispose();
  }
}
