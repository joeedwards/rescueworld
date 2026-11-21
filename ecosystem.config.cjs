/**
 * PM2 ecosystem config for rescueworld.
 *
 * Dev (server + Vite client):
 *   npm run build -w shared && pm2 start ecosystem.config.cjs
 *
 * Production (server only; nginx serves client/dist):
 *   npm run build -w shared && npm run build -w server
 *   GAME_WS_URL=wss://your-host/ws-game pm2 start ecosystem.config.cjs --only rescueworld-server
 */
module.exports = {
  apps: [
    {
      name: 'rescueworld-server',
      cwd: __dirname,
      script: 'server/dist/index.js',
      watch: ['server/dist', 'server/src'],
      ignore_watch: ['node_modules', '*.log', 'client'],
      watch_delay: 1000,
    },
    {
      name: 'rescueworld-client',
      cwd: __dirname,
      script: 'npm',
      args: ['run', 'dev', '-w', 'client'],
      interpreter: 'none',
    },
  ],
};
