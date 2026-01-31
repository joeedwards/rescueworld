import WebSocket from 'ws';
import { encodeInput } from 'shared';
import { INPUT_LEFT, INPUT_RIGHT, INPUT_UP, INPUT_DOWN } from 'shared';
import { TICK_MS } from 'shared';

type Mode = 'ffa' | 'solo' | 'teams';

type ClientState = {
  id: string;
  ws: WebSocket;
  inputSeq: number;
  inputFlags: number;
  pingInterval?: NodeJS.Timeout;
  inputInterval?: NodeJS.Timeout;
  directionInterval?: NodeJS.Timeout;
  connectedAt: number;
};

type Metrics = {
  rttSamples: number[];
  totalPings: number;
  totalPongs: number;
};

function parseArgs(): Record<string, string | boolean> {
  const args: Record<string, string | boolean> = {};
  for (let i = 2; i < process.argv.length; i++) {
    const arg = process.argv[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = process.argv[i + 1];
      if (!next || next.startsWith('--')) {
        args[key] = true;
      } else {
        args[key] = next;
        i++;
      }
    }
  }
  return args;
}

function getNumberArg(args: Record<string, string | boolean>, key: string, fallback: number): number {
  const v = args[key];
  if (typeof v === 'string') {
    const n = Number(v);
    if (!Number.isNaN(n) && Number.isFinite(n)) return n;
  }
  return fallback;
}

function getStringArg(args: Record<string, string | boolean>, key: string, fallback: string): string {
  const v = args[key];
  return typeof v === 'string' && v.length ? v : fallback;
}

function printUsage(): void {
  console.log(`
Usage:
  npx tsx server/scripts/loadTestWs.ts --clients 20 --duration 120 --ramp 0.2 --mode ffa

Options:
  --url       WebSocket URL (default: wss://games.vo.ly/ws-game)
  --clients   Number of simulated clients (default: 10)
  --duration  Test duration in seconds (default: 120)
  --ramp      Delay between client connects in seconds (default: 0.2)
  --mode      ffa | solo | teams (default: ffa)
  --ping      Ping interval in ms (default: 1000)
  --dir       Direction change interval in ms (default: 1200)
  --help      Show this help
`);
}

function computeInputFlags(dx: number, dy: number): number {
  let flags = 0;
  if (dx < -0.3) flags |= INPUT_LEFT;
  if (dx > 0.3) flags |= INPUT_RIGHT;
  if (dy < -0.3) flags |= INPUT_UP;
  if (dy > 0.3) flags |= INPUT_DOWN;
  return flags;
}

function randomDirection(): { dx: number; dy: number } {
  const angle = Math.random() * Math.PI * 2;
  return { dx: Math.cos(angle), dy: Math.sin(angle) };
}

function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[idx];
}

async function main(): Promise<void> {
  const args = parseArgs();
  if (args.help) {
    printUsage();
    return;
  }

  const url = getStringArg(args, 'url', 'wss://games.vo.ly/ws-game');
  const clientCount = getNumberArg(args, 'clients', 10);
  const durationSec = getNumberArg(args, 'duration', 120);
  const rampDelaySec = getNumberArg(args, 'ramp', 0.2);
  const mode = getStringArg(args, 'mode', 'ffa') as Mode;
  const pingIntervalMs = getNumberArg(args, 'ping', 1000);
  const directionIntervalMs = getNumberArg(args, 'dir', 1200);

  const metrics: Metrics = {
    rttSamples: [],
    totalPings: 0,
    totalPongs: 0,
  };

  const clients: ClientState[] = [];
  let connected = 0;
  let closed = 0;

  const startTime = Date.now();
  const endTime = startTime + durationSec * 1000;

  function logSummary(tag = 'interval'): void {
    const samples = metrics.rttSamples.slice();
    samples.sort((a, b) => a - b);
    const avg = samples.length ? Math.round(samples.reduce((a, b) => a + b, 0) / samples.length) : 0;
    const p50 = Math.round(percentile(samples, 0.5));
    const p95 = Math.round(percentile(samples, 0.95));
    const p99 = Math.round(percentile(samples, 0.99));
    const max = samples.length ? samples[samples.length - 1] : 0;
    console.log(`[loadtest] ${tag} clients=${clientCount} connected=${connected} closed=${closed} rtt avg=${avg}ms p50=${p50}ms p95=${p95}ms p99=${p99}ms max=${max}ms pings=${metrics.totalPings} pongs=${metrics.totalPongs}`);
    metrics.rttSamples = [];
  }

  function createClient(index: number): void {
    const id = `loadtest-${index}-${Math.random().toString(36).slice(2, 6)}`;
    const ws = new WebSocket(url);
    const state: ClientState = {
      id,
      ws,
      inputSeq: 0,
      inputFlags: 0,
      connectedAt: Date.now(),
    };
    clients.push(state);

    ws.binaryType = 'arraybuffer';
    ws.on('open', () => {
      connected++;
      ws.send(JSON.stringify({ type: 'mode', mode, displayName: id }));

      state.pingInterval = setInterval(() => {
        const ts = Date.now();
        metrics.totalPings++;
        ws.send(JSON.stringify({ type: 'ping', ts }));
      }, pingIntervalMs);

      state.directionInterval = setInterval(() => {
        const { dx, dy } = randomDirection();
        state.inputFlags = computeInputFlags(dx, dy);
      }, directionIntervalMs);

      state.inputInterval = setInterval(() => {
        const buf = encodeInput(state.inputFlags, state.inputSeq++);
        ws.send(buf);
      }, TICK_MS);
    });

    ws.on('message', (data: WebSocket.RawData) => {
      if (typeof data === 'string') {
        try {
          const msg = JSON.parse(data);
          if (msg.type === 'pong' && typeof msg.ts === 'number') {
            const rtt = Date.now() - msg.ts;
            metrics.totalPongs++;
            metrics.rttSamples.push(rtt);
          }
        } catch {
          // ignore
        }
      } else if (data instanceof Buffer) {
        // Binary snapshots are expected; ignore for load testing
      }
    });

    ws.on('close', () => {
      closed++;
      if (state.pingInterval) clearInterval(state.pingInterval);
      if (state.inputInterval) clearInterval(state.inputInterval);
      if (state.directionInterval) clearInterval(state.directionInterval);
    });

    ws.on('error', (err) => {
      console.warn(`[loadtest] ws error client=${id} err=${err.message}`);
    });
  }

  for (let i = 0; i < clientCount; i++) {
    createClient(i);
    if (rampDelaySec > 0) {
      await new Promise((r) => setTimeout(r, rampDelaySec * 1000));
    }
  }

  const summaryInterval = setInterval(() => {
    logSummary('interval');
  }, 5000);

  while (Date.now() < endTime) {
    await new Promise((r) => setTimeout(r, 1000));
  }

  clearInterval(summaryInterval);
  logSummary('final');
  for (const c of clients) {
    try {
      c.ws.close();
    } catch {
      // ignore
    }
  }
}

main().catch((err) => {
  console.error('[loadtest] fatal error', err);
  process.exit(1);
});
