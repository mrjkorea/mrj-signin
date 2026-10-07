"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const { chromium } = require("playwright");
const { startFixtureServer } = require("./helpers/fixture-server");
const { installChipIdleRoutes } = require("./helpers/chip-idle-routes");

const ROOT = path.join(__dirname, "..");
const FIXTURE = "/test/fixtures/chip-body-slot/decodable-library.html";

async function openLibrary(page, server, width, height) {
  await page.setViewportSize({ width, height });
  await installChipIdleRoutes(page, ROOT);
  await page.goto(server.baseUrl + FIXTURE, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(
    () => globalThis.MRJ_AUTH && typeof MRJ_AUTH.student === "function" && MRJ_AUTH.student(),
    { timeout: 60000 }
  );
  await page.waitForSelector("#mrj-auth-student-chip", { state: "visible", timeout: 45000 });
  await page.waitForSelector(".book-grid.ready", { timeout: 15000 });
  await page.waitForTimeout(1200);
  await page.evaluate(() => {
    window.dispatchEvent(new Event("resize"));
    window.MRJ_AUTH._test.scheduleChipLayout();
  });
  await page.waitForTimeout(600);
}

async function readChipLayout(page, maxMarginPx) {
  return page.evaluate((maxM) => {
    const chip = document.getElementById("mrj-auth-student-chip");
    const cr = chip.getBoundingClientRect();
    const marginTop = parseFloat(chip.style.marginTop) || 0;
    const vh = window.innerHeight;
    const overlaps = [];
    const nodes = document.querySelectorAll(
      "button, a, select, input, textarea, [role='button'], [onclick], [class*='card']"
    );
    for (let i = 0; i < nodes.length; i++) {
      const el = nodes[i];
      if (!el || el === chip || chip.contains(el)) continue;
      if (el.closest("#mrj-auth-student-chip, .mrj-auth-panel-root, #mrj-auth-gate, .mrj-auth")) continue;
      if (el.closest("canvas")) continue;
      const st = getComputedStyle(el);
      if (st.display === "none" || st.visibility === "hidden" || st.opacity === "0") continue;
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) continue;
      const hit =
        cr.left < r.right && cr.right > r.left && cr.top < r.bottom && cr.bottom > r.top;
      if (hit) {
        overlaps.push(el.tagName + (el.className ? "." + String(el.className).split(" ")[0] : ""));
      }
    }
    return {
      marginTop,
      rect: { top: cr.top, bottom: cr.bottom, left: cr.left, right: cr.right },
      onScreen: cr.top >= -2 && cr.bottom <= vh - 8,
      capOk: marginTop <= maxM,
      overlaps
    };
  }, maxMarginPx);
}

describe("chip marginTop collision (decodable library shape)", () => {
  it("stays on-screen without covering controls at 390×844", { timeout: 120000 }, async () => {
    const server = await startFixtureServer(ROOT);
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage();
      await openLibrary(page, server, 390, 844);
      const layout = await readChipLayout(page, 100);
      console.log("DECODABLE_FIXTURE_390", JSON.stringify(layout));
      assert.equal(layout.onScreen, true);
      assert.equal(layout.capOk, true);
      assert.deepEqual(layout.overlaps, []);
    } finally {
      await browser.close();
      await server.close();
    }
  });

  it("stays on-screen without covering controls at 1280×800", { timeout: 120000 }, async () => {
    const server = await startFixtureServer(ROOT);
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage();
      await openLibrary(page, server, 1280, 800);
      const layout = await readChipLayout(page, 64);
      console.log("DECODABLE_FIXTURE_1280", JSON.stringify(layout));
      assert.equal(layout.onScreen, true);
      assert.equal(layout.capOk, true);
      assert.deepEqual(layout.overlaps, []);
    } finally {
      await browser.close();
      await server.close();
    }
  });
});
