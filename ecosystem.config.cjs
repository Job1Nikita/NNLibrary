module.exports = {
  apps: [
    {
      name: "library-web",
      cwd: "/opt/Library",
      script: "dist/src/server.js",
      instances: 1,
      exec_mode: "fork",
      env: {
        NODE_ENV: "production",
        PORT: 3010
      },
      out_file: "/opt/Library/logs/web-out.log",
      error_file: "/opt/Library/logs/web-err.log",
      merge_logs: true,
      max_memory_restart: "350M"
    },
    {
      name: "library-bot",
      cwd: "/opt/Library",
      script: "dist/src/bot/index.js",
      instances: 1,
      exec_mode: "fork",
      env: {
        NODE_ENV: "production"
      },
      out_file: "/opt/Library/logs/bot-out.log",
      error_file: "/opt/Library/logs/bot-err.log",
      merge_logs: true,
      max_memory_restart: "250M"
    }
  ]
};


