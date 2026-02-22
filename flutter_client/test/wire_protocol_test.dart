import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';

import 'package:flutter_client/game/constants.dart';
import 'package:flutter_client/protocol/wire_protocol.dart';

void main() {
  test('encodeInput matches backend wire format', () {
    final out = encodeInput(inputLeft | inputUp, 17);
    expect(out.length, 4);
    expect(out[0], msgInput);
    expect(out[1], 0x05);
    expect(out[2], 0x00);
    expect(out[3], 17);
  });

  test('decodeSnapshot parses minimal snapshot', () {
    final data = ByteData(64);
    var off = 0;
    data.setUint8(off++, msgSnapshot);
    data.setUint32(off, 42, Endian.little);
    off += 4;
    data.setUint32(off, 9000, Endian.little);
    off += 4;
    data.setUint8(off++, 0); // matchEndedEarly
    data.setUint8(off++, 0); // winnerId str len
    data.setUint8(off++, 0); // strayLoss
    data.setUint32(off, 3, Endian.little);
    off += 4;
    data.setUint8(off++, 0); // scarcity
    data.setUint32(off, 2500, Endian.little);
    off += 4;
    data.setUint16(off, 0, Endian.little);
    off += 2;
    data.setUint8(off++, 0); // players
    data.setUint16(off, 0, Endian.little); // pets
    off += 2;
    data.setUint8(off++, 0); // zones
    data.setUint8(off++, 0); // pickups
    data.setUint8(off++, 0); // shelters
    data.setUint8(off++, 0); // breeder shelters
    data.setUint8(off++, 0); // adoption events
    data.setUint8(off++, 0); // boss mode absent
    data.setUint8(off++, 0); // team scores absent

    final snap = decodeSnapshot(data.buffer.asUint8List());
    expect(snap.tick, 42);
    expect(snap.matchEndAt, 9000);
    expect(snap.totalMatchAdoptions, 3);
    expect(snap.players, isEmpty);
    expect(snap.pets, isEmpty);
  });
}
