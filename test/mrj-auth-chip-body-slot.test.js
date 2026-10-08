"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const { chromium } = require("playwright");
const { startFixtureServer } = require("./helpers/fixture-server");
const { installChipIdleRoutes } = require("./helpers/chip-idle-routes");

const ROOT = path.join(__dirname, "..");

async function openSignedIn(page, server, fixturePath, width, height) {
  await page.setViewportSize({ width, height });
  await installChipIdleRoutes(page, ROOT);
  await page.goto(server.baseUrl + fixturePath, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(
    () => globalThis.MRJ_AUTH && typeof MRJ_AUTH.student === "function" && MRJ_AUTH.student(),
    { timeout: 60000 }
  );
  await page.waitForSelector("#mrj-auth-student-chip", { state: "visible", timeout: 45000 });
  await page.waitForTimeout(1200);
}

async function bodyPadPx(page) {
  return page.evaluate(() => {
    const pad = document.body && document.body.style ? document.body.style.paddingTop : "";
    return {
      pad: parseFloat(pad) || 0,
      slot: globalThis.MRJ_AUTH._test.getChipBodySlotPx()
    };
  });
}

describe("compact chip body slot padding", () => {
  it("list with full-width buttons under header stays at 0px", { timeout: 120000 }, async () => {
    const server = await startFixtureServer(ROOT);
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage();
      await openSignedIn(page, server, "/test/fixtures/chip-body-slot/list-under-header.html", 390, 844);
      const { pad, slot } = await bodyPadPx(page);
      assert.equal(pad, 0);
      assert.equal(slot, 0);
    } finally {
      await browser.close();
      await server.close();
    }
  });

  it("title overlap uses ≤44px and is stable across forced layouts", { timeout: 120000 }, async () => {
    const server = await startFixtureServer(ROOT);
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage();
      await openSignedIn(page, server, "/test/fixtures/chip-idle/phone-title-overlap.html", 390, 844);
      const pads = [];
      for (let i = 0; i < 5; i++) {
        await page.evaluate(() => {
          window.MRJ_AUTH._test.scheduleChipLayout();
          window.dispatchEvent(new Event("resize"));
        });
        await page.waitForTimeout(400);
        pads.push((await bodyPadPx(page)).pad);
      }
      assert.ok(pads[0] > 0 && pads[0] <= 44, "expected small positive pad, got " + pads[0]);
      for (const p of pads) {
        assert.equal(p, pads[0], "padding should not drift across forced layouts");
      }
    } finally {
      await browser.close();
      await server.close();
    }
  });

  it("full-screen 100vh overflow hidden canvas page keeps 0px padding", { timeout: 120000 }, async () => {
    const server = await startFixtureServer(ROOT);
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage();
      await openSignedIn(page, server, "/test/fixtures/chip-body-slot/fullscreen-canvas.html", 390, 844);
      const { pad, slot } = await bodyPadPx(page);
      assert.equal(pad, 0);
      assert.equal(slot, 0);
    } finally {
      await browser.close();
      await server.close();
    }
  });

  it("score text ticker does not rewrite body padding after settle", { timeout: 120000 }, async () => {
    const server = await startFixtureServer(ROOT);
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage();
      await openSignedIn(page, server, "/test/fixtures/chip-body-slot/score-ticker.html", 390, 844);
      const before = await bodyPadPx(page);
      await page.evaluate(() => window.MRJ_AUTH._test.resetChipIdleMetrics());
      await page.waitForTimeout(3000);
      const after = await bodyPadPx(page);
      const metrics = await page.evaluate(() => window.MRJ_AUTH._test.getChipIdleMetrics());
      assert.equal(after.pad, before.pad);
      assert.equal(after.slot, before.slot);
      assert.equal(metrics.domWrites, 0);
    } finally {
      await browser.close();
      await server.close();
    }
  });
});
