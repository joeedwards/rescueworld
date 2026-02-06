/**
 * Game channel protocol (WebRTC unreliable).
 * Snapshot: shelters (players) with size/petsInside, strays (pets), adoption zones.
 */
import type { GameSnapshot } from './types';
import type { InputFlags } from './types';
export declare const MSG_INPUT = 1;
export declare const MSG_SNAPSHOT = 2;
export declare const MSG_BOSS_MODE_START = "bossModeStart";
export declare const MSG_BOSS_MILL_UPDATE = "bossMillUpdate";
export declare const MSG_BOSS_POSITION = "bossPosition";
export declare const MSG_BOSS_CAUGHT = "bossCaught";
export declare const MSG_BOSS_MODE_END = "bossModeEnd";
export declare const MSG_BOSS_PURCHASE = "bossPurchase";
export declare const MSG_BOSS_SUBMIT_MEAL = "bossSubmitMeal";
export declare const MSG_BOSS_ENTER_MILL = "bossEnterMill";
export declare const MSG_BOSS_EXIT_MILL = "bossExitMill";
export declare function encodeInput(inputFlags: InputFlags, inputSeq: number): ArrayBuffer;
export declare function decodeInput(buf: ArrayBuffer): {
    inputFlags: InputFlags;
    inputSeq: number;
};
export declare function encodeSnapshot(snap: GameSnapshot): ArrayBuffer;
export declare function decodeSnapshot(buf: ArrayBuffer): GameSnapshot;
