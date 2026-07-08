module.exports = {
  apps: [
    {
      name: "kamash-backend",
      script: "dist/index.js",
      cwd: __dirname,
      instances: 1,
      exec_mode: "fork",
      // Actual secrets (GOOGLE_SERVICE_ACCOUNT_KEY_PATH, OPENAI_API_KEY, etc.) are loaded
      // from a .env file in this directory via `dotenv/config` at process start.
      env: {
        NODE_ENV: "production",
      },
    },
  ],
};
