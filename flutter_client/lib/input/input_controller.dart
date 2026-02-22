import 'package:flutter/services.dart';

import '../game/constants.dart';

class InputController {
  int _flags = 0;
  int _inputSeq = 0;

  int get flags => _flags;
  int get inputSeq => _inputSeq;

  int nextInputSeq() {
    _inputSeq = (_inputSeq + 1) & 0xff;
    return _inputSeq;
  }

  void setFromKeyboard(Set<LogicalKeyboardKey> keys) {
    var out = 0;
    if (keys.contains(LogicalKeyboardKey.keyA) || keys.contains(LogicalKeyboardKey.arrowLeft)) {
      out |= inputLeft;
    }
    if (keys.contains(LogicalKeyboardKey.keyD) || keys.contains(LogicalKeyboardKey.arrowRight)) {
      out |= inputRight;
    }
    if (keys.contains(LogicalKeyboardKey.keyW) || keys.contains(LogicalKeyboardKey.arrowUp)) {
      out |= inputUp;
    }
    if (keys.contains(LogicalKeyboardKey.keyS) || keys.contains(LogicalKeyboardKey.arrowDown)) {
      out |= inputDown;
    }
    _flags = out;
  }

  void setFromJoystick(double dx, double dy) {
    var out = 0;
    if (dx < -0.2) out |= inputLeft;
    if (dx > 0.2) out |= inputRight;
    if (dy < -0.2) out |= inputUp;
    if (dy > 0.2) out |= inputDown;
    _flags = out;
  }
}
