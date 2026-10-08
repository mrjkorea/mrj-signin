"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const { chromium } = require("playwright");
const { startFixtureServer } = require("./helpers/fixture-server");
const { installChipIdleRoutes } = require("./helpers/chip-idle-routes");

const ROOT = path.join(__dirname, "..");
const DECODABLE_FIXTURE = "/test/fixtures/chip-body-slot/decodable-library.html";
const DAY3_FIXTURE = "/test/fixtures/chip-body-slot/day3-workbook-phone.html";
const LEAP_FROG_HUD_FIXTURE = "/test/fixtures/chip-body-slot/leap-frog-hud-phone.html";

async function openSignedIn(page, server, fixturePath, width, height, waitGrid, skipChipLayout) {
  await page.setViewportSize({ width, height });
  await installChipIdleRoutes(page, ROOT);
  await page.goto(server.baseUrl + fixturePath, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(
    () => globalThis.MRJ_AUTH && typeof MRJ_AUTH.student === "function" && MRJ_AUTH.student(),
    { timeout: 60000 }
  );
  if (waitGrid) {
    await page.waitForSelector(".book-grid.ready", { timeout: 15000 });
  }
  await page.waitForTimeout(waitGrid ? 1200 : 800);
  if (skipChipLayout) return;
  await page.evaluate(() => {
    window.dispatchEvent(new Event("resize"));
    window.MRJ_AUTH._test.scheduleChipLayout();
  });
  await page.waitForTimeout(600);
}

async function readChipState(page, hudSelector) {
  return page.evaluate((hudSel) => {
    const chip = document.getElementById("mrj-auth-student-chip");
    if (!chip) return { missing: true };
    const cr = chip.getBoundingClientRect();
    const marginTop = parseFloat(chip.style.marginTop) || 0;
    const vh = window.innerHeight;
    const overlaps = [];
    if (!chip.hidden) {
      const nodes = document.querySelectorAll(
        "button, a, select, input, textarea, [role='button'], [onclick], [class*='card']"
      );
      for (let i = 0; i < nodes.length; i++) {
        const el = nodes[i];
        if (!el || el === chip || chip.contains(el)) continue;
        if (el.closest("#mrj-auth-student-chip, .mrj-auth-panel-root, #mrj-auth-gate, .mrj-auth")) {
          continue;
        }
        if (el.closest("canvas")) continue;
        const st = getComputedStyle(el);
        if (st.display === "none" || st.visibility === "hidden" || st.opacity === "0") continue;
        const r = el.getBoundingClientRect();
        if (r.width < 2 || r.height < 2) continue;
        const hit =
          cr.left < r.right && cr.right > r.left && cr.top < r.bottom && cr.bottom > r.top;
        if (hit) {
          overlaps.push(el.tagName + (el.id ? "#" + el.id : ""));
        }
      }
      if (hudSel) {
        const hud = document.querySelector(hudSel);
        if (hud) {
          const r = hud.getBoundingClientRect();
          const hit =
            cr.left < r.right && cr.right > r.left && cr.top < r.bottom && cr.bottom > r.top;
          if (hit) overlaps.push("hud#" + hudSel);
        }
      }
    }
    return {
      hidden: chip.hidden,
      marginTop,
      rect: { top: cr.top, bottom: cr.bottom, left: cr.left, right: cr.right },
      onScreen: !chip.hidden && cr.top >= -2 && cr.bottom <= vh - 8,
      overlaps
    };
  }, hudSelector || "");
}

async function readChipStateWithHud(page) {
  return readChipState(page, "#lf-left");
}

describe("chip marginTop collision", () => {
  it("leap-frog-like HUD phone clears score pill with marginTop", { timeout: 120000 }, async () => {
    const server = await startFixtureServer(ROOT);
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage();
      await openSignedIn(page, server, LEAP_FROG_HUD_FIXTURE, 390, 844, false, true);
      const atBase = await page.evaluate(() => {
        const chip = document.getElementById("mrj-auth-student-chip");
        chip.hidden = false;
        chip.style.marginTop = "";
        const cr = chip.getBoundingClientRect();
        const hud = document.getElementById("lf-left");
        const hr = hud.getBoundingClientRect();
        const overlapsHud =
          cr.left < hr.right && cr.right > hr.left && cr.top < hr.bottom && cr.bottom > hr.top;
        return {
          marginTop: parseFloat(chip.style.marginTop) || 0,
          overlapsHud,
          chipLeft: cr.left,
          hudRight: hr.right
        };
      });
      console.log("LEAP_FROG_HUD_390_BASE", JSON.stringify(atBase));
      assert.equal(atBase.marginTop, 0);
      assert.equal(atBase.overlapsHud, true, "HUD must overlap chip at base margin");

      await page.evaluate(() => {
        window.dispatchEvent(new Event("resize"));
        window.MRJ_AUTH._test.scheduleChipLayout();
      });
      await page.waitForTimeout(600);

      const state = await readChipStateWithHud(page);
      console.log("LEAP_FROG_HUD_390", JSON.stringify(state));
      assert.equal(state.hidden, false);
      assert.ok(state.marginTop >= 30, "marginTop px=" + state.marginTop);
      assert.equal(state.overlaps.length, 0);
      assert.equal(state.onScreen, true);
    } finally {
      await browser.close();
      await server.close();
    }
  });

  it("day3-like phone layout clears Records with ~92px marginTop", { timeout: 120000 }, async () => {
    const server = await startFixtureServer(ROOT);
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage();
      await openSignedIn(page, server, DAY3_FIXTURE, 390, 844, false);
      const state = await readChipState(page);
      console.log("DAY3_FIXTURE_390", JSON.stringify(state));
      assert.equal(state.hidden, false);
      assert.ok(
        state.marginTop >= 70 && state.marginTop <= 100,
        "marginTop px=" + state.marginTop + " (live day3 phone ~92)"
      );
      assert.equal(state.overlaps.length, 0);
      assert.equal(state.onScreen, true);
    } finally {
      await browser.close();
      await server.close();
    }
  });

  it("decodable library without pill hides chip or leaves controls clear at 390×844", {
    timeout: 120000
  }, async () => {
    const server = await startFixtureServer(ROOT);
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage();
      await openSignedIn(page, server, DECODABLE_FIXTURE, 390, 844, true);
      const state = await readChipState(page);
      console.log("DECODABLE_NO_PILL_390", JSON.stringify(state));
      assert.ok(state.hidden || state.overlaps.length === 0);
      if (!state.hidden) assert.equal(state.onScreen, true);
    } finally {
      await browser.close();
      await server.close();
    }
  });

  it("decodable library without pill hides chip or leaves controls clear at 1280×800", {
    timeout: 120000
  }, async () => {
    const server = await startFixtureServer(ROOT);
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage();
      await openSignedIn(page, server, DECODABLE_FIXTURE, 1280, 800, true);
      const state = await readChipState(page);
      console.log("DECODABLE_NO_PILL_1280", JSON.stringify(state));
      assert.ok(state.hidden || state.overlaps.length === 0);
      if (!state.hidden) assert.equal(state.onScreen, true);
    } finally {
      await browser.close();
      await server.close();
    }
  });
});
