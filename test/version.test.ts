import { describe, it, expect } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";

const app = createApp();

describe("GET /webhook/kamash/version", () => {
  it("reports when this process came up", async () => {
    const res = await request(app).get("/webhook/kamash/version");

    expect(res.status).toBe(200);
    expect(Number.isNaN(Date.parse(res.body.startedAt))).toBe(false);
  });

  it("reports nulls rather than a made-up date when no release stamp was deployed", async () => {
    // A checkout has no release.json — the workflow writes it per deploy. Every
    // key still has to be present, or the frontend cannot tell "not deployed
    // yet" from "endpoint changed shape".
    const res = await request(app).get("/webhook/kamash/version");

    expect(res.body).toMatchObject({
      releaseId: null,
      commit: null,
      ref: null,
      deployedAt: null,
    });
  });

  it("is never cached — a stale stamp is the one answer this must not give", async () => {
    const res = await request(app).get("/webhook/kamash/version");

    expect(res.headers["cache-control"]).toBe("no-store");
  });
});
