import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    include: ["test/**/*.{test,spec}.ts"],
    env: {
      GOOGLE_SERVICE_ACCOUNT_KEY_PATH: "./test/fixtures/fake-service-account.json",
    },
  },
});
