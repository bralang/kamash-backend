import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    include: ["test/**/*.{test,spec}.ts"],
    env: {
      GOOGLE_SERVICE_ACCOUNT_KEY_PATH: "./test/fixtures/fake-service-account.json",
      GOOGLE_IMPERSONATED_USER_EMAIL: "test@link-up.co.il",
      AUTH_SECRET: "test-secret-test-secret-test-secret-0123",
      // Route tests exercise each endpoint's own behavior and send no session. Enforcement
      // is tested in test/auth.test.ts, which switches it on and walks every route.
      AUTH_ENFORCE: "false",
    },
  },
});
