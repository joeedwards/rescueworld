"use strict";
/**
 * Rescue server: starts signaling (matchmaking), game server, and auth API in one process.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const path_1 = __importDefault(require("path"));
const dotenv_1 = __importDefault(require("dotenv"));
// Load .env from repo root so it works regardless of cwd (e.g. systemd, pm2)
dotenv_1.default.config({ path: path_1.default.resolve(__dirname, '..', '..', '.env') });
const registry_js_1 = require("./registry.js");
require("./SignalingServer");
require("./GameServer");
require("./authServer");
(0, registry_js_1.connectRegistry)().catch(() => { });
