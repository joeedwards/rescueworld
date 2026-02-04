/**
 * PM2 ecosystem config for rescueworld.
 *
 * Start with watch (restarts when server files change):
 *   pm2 start ecosystem.config.cjs
 *
 * Start without watch (e.g. production):
 *   pm2 start server/dist/index.js --name rescueworld
 */
module.exports = {
  apps: [
    {
      name: 'rescueworld',
      cwd: __dirname,
      script: 'server/dist/index.js',
      watch: ['server/dist', 'server/src'],
      ignore_watch: ['node_modules', '*.log', 'client'],
      watch_delay: 1000,
    },
  ],
};
