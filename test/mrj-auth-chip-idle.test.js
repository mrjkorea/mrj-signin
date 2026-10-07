"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const { chromium } = require("playwright");
const { startFixtureServer } = require("./helpers/fixture-server");
const { installChipIdleRoutes, measureChipIdle } = require("./helpers/chip-idle-routes");

const ROOT = path.join(__dirname, "..");
const IDLE_MS = Number(process.env.CHIP_IDLE_MS || 8000);
const SETTLE_MS = Number(process.env.CHIP_SETTLE_MS || 2000);

const FIXTURES = [
  {
    slug: "plain",
    path: "/test/fixtures/chip-idle/plain.html",
    expectChip: true
  },
  {
    slug: "with-pill",
    path: "/test/fixtures/chip-idle/with-pill.html",
    expectChip: false
  },
  {
    slug: "with-own-record",
    path: "/test/fixtures/chip-idle/with-own-record.html",
    expectChip: false
  }
];

describe("chip idle layout loop", () => {
  it(
    "stays quiet after settle on local fixture pages",
    { timeout: 180000 },
    async () => {
      const server = await startFixtureServer(ROOT);
      const browser = await chromium.launch();
      const results = [];
      try {
        for (const fixture of FIXTURES) {
          const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
          await installChipIdleRoutes(page, ROOT);
          results.push(
            await measureChipIdle(
              page,
              { slug: fixture.slug, url: server.baseUrl + fixture.path, expectChip: fixture.expectChip },
              SETTLE_MS,
              IDLE_MS
            )
          );
          await page.close();
        }
      } finally {
        await browser.close();
        await server.close();
      }
      console.log("CHIP_IDLE_METRICS", JSON.stringify(results));
      for (const r of results) {
        assert.equal(r.chipHidden, !r.expectChip, r.slug + " chip visibility");
        if (r.expectChip) {
          assert.equal(r.chipMutations, 0, r.slug + " chip mutations after settle");
          assert.equal(r.observerNotifies, 0, r.slug + " observer callbacks after settle");
          assert.equal(r.layoutRuns, 0, r.slug + " layout runs after settle");
        }
      }
    }
  );
});
