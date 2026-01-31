"use strict";
/**
 * Rescue server: starts signaling (matchmaking), game server, and auth API in one process.
 * Ensures storage (Redis or SQLite fallback) is ready before starting servers.
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const path_1 = __importDefault(require("path"));
const dotenv_1 = __importDefault(require("dotenv"));
// Load .env from repo root so it works regardless of cwd (e.g. systemd, pm2)
dotenv_1.default.config({ path: path_1.default.resolve(__dirname, '..', '..', '.env') });
async function main() {
    const { ensureStorage } = await Promise.resolve().then(() => __importStar(require('./registry.js')));
    const status = await ensureStorage();
    if (!status.redis && !status.sqlite) {
        console.warn('Storage: Redis and SQLite unavailable. Guest names will use random fallback.');
    }
    await Promise.resolve().then(() => __importStar(require('./SignalingServer.js')));
    await Promise.resolve().then(() => __importStar(require('./GameServer.js')));
    await Promise.resolve().then(() => __importStar(require('./authServer.js')));
}
main().catch((err) => {
    console.error('Server failed to start:', err);
    process.exit(1);
});
