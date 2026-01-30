/**
 * Game channel protocol (WebRTC unreliable).
 * Snapshot: shelters (players) with size/petsInside, strays (pets), adoption zones.
 */
import type { GameSnapshot } from './types';
import type { InputFlags } from './types';
export declare const MSG_INPUT = 1;
export declare const MSG_SNAPSHOT = 2;
export declare function encodeInput(inputFlags: InputFlags, inputSeq: number): ArrayBuffer;
export declare function decodeInput(buf: ArrayBuffer): {
    inputFlags: InputFlags;
    inputSeq: number;
};
export declare function encodeSnapshot(snap: GameSnapshot): ArrayBuffer;
export declare function decodeSnapshot(buf: ArrayBuffer): GameSnapshot;
