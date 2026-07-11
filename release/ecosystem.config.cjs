/**
 * PM2 Ecosystem Configuration — Signalium Platform
 *
 * Usage (from inside the release/ directory, or at workspace root for dev):
 *   pm2 start ecosystem.config.cjs --env production
 *   pm2 reload ecosystem.config.cjs --env production  # zero-downtime reload
 *   pm2 stop   ecosystem.config.cjs
 *   pm2 delete ecosystem.config.cjs
 *
 * Zero-downtime reloads:
 *   PM2 reload sends SIGINT to the old process, waits for it to exit cleanly
 *   (up to kill_timeout ms), then starts the new one. Nginx upstream buffering
 *   absorbs the brief gap, making the reload invisible to users.
 *
 * Environment:
 *   All secrets (DATABASE_URL, SESSION_SECRET, etc.) must be present in the
 *   process environment before starting PM2, typically via a .env file loaded
 *   by your deployment script:  set -a; source .env; set +a; pm2 start ...
 */
module.exports = {
  apps: [
    {
      // -----------------------------------------------------------------------
      // Identity
      // -----------------------------------------------------------------------
      name: "signalium-api",
      script: "./dist/server/index.mjs",

      // -----------------------------------------------------------------------
      // Runtime
      // -----------------------------------------------------------------------
      // Fork mode is required for ESM (.mjs) entry points.
      // Cluster mode wraps the script in a way that breaks ES module semantics.
      exec_mode: "fork",
      instances: 1,

      // Enable source map support so stack traces reference original .ts lines.
      node_args: "--enable-source-maps",

      // -----------------------------------------------------------------------
      // Graceful shutdown / zero-downtime
      // -----------------------------------------------------------------------
      // The app does NOT send process.send('ready') so we rely on listen_timeout.
      // Once the HTTP server is up (usually <2s), PM2 marks it healthy.
      wait_ready: false,
      listen_timeout: 10000,      // ms to wait for port to be open after start
      kill_timeout: 5000,         // ms to wait for clean exit after SIGINT

      // -----------------------------------------------------------------------
      // Stability
      // -----------------------------------------------------------------------
      max_memory_restart: "1500M",  // restart if RSS exceeds this (2 GB VPS)
      max_restarts: 10,
      min_uptime: "5s",             // if it crashes faster, stop restarting

      // -----------------------------------------------------------------------
      // Logging
      // -----------------------------------------------------------------------
      out_file: "./logs/out.log",
      error_file: "./logs/error.log",
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
      merge_logs: true,

      // -----------------------------------------------------------------------
      // Environment overrides
      // Environment variables that change across environments go here.
      // Secrets (DATABASE_URL, SESSION_SECRET, etc.) must be set externally —
      // never commit secrets inside this file.
      // -----------------------------------------------------------------------
      env: {
        // Development fallback (pm2 start without --env)
        NODE_ENV: "development",
      },
      env_production: {
        NODE_ENV: "production",
      },
    },
  ],
};
