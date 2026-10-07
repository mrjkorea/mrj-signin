"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const ROOT = path.join(__dirname, "..");
const IDLE_MS = Number(process.env.CHIP_IDLE_MS || 30000);
const SETTLE_MS = Number(process.env.CHIP_SETTLE_MS || 5000);

const APPS = [
  { slug: "word-master", url: "https://mrjkorea.github.io/word-master/", app: "word-master" },
  { slug: "day2-words", url: "https://mrjkorea.github.io/day2-words/", app: "day2-words" },
  { slug: "day3-workbook", url: "https://mrjkorea.github.io/day3-workbook/", app: "day3-workbook" },
  { slug: "day5-practice", url: "https://mrjkorea.github.io/day5-practice/", app: "day5-practice" },
  { slug: "typing-kids", url: "https://mrjkorea.github.io/typing-kids/", app: "typing-kids" },
  { slug: "news-words", url: "https://mrjkorea.github.io/news-words/", app: "news-words" }
];

const authSource =
  "globalThis.MRJ_AUTH_TEST_MODE = true;\n" + fs.readFileSync(path.join(ROOT, "mrj-auth.js"), "utf8");

function progressResponse() {
  return {
    ok: true,
    id: "DemoKid",
    token: "demo-tok",
    progress: [{ program: "word-master", item_id: "u01:a", score_pct: 80, score_value: 8, score_max: 10 }],
    hasMore: false
  };
}

async function measureApp(browser, app) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.route("**/mrj-signin/mrj-auth.js**", (route) =>
    route.fulfill({ status: 200, contentType: "application/javascript", body: authSource })
  );
  await page.route("**/mrj-signin/mrj-auth.css**", (route) =>
    route.fulfill({ status: 200, contentType: "text/css", path: path.join(ROOT, "mrj-auth.css") })
  );
  await page.route("**/mrj-signin/mrj-auth-boot.js**", (route) =>
    route.fulfill({ status: 200, contentType: "application/javascript", path: path.join(ROOT, "mrj-auth-boot.js") })
  );
  await page.route("**/macros/s/**/exec**", async (route) => {
    let body = {};
    try {
      body = JSON.parse(route.request().postData() || "{}");
    } catch {
      body = {};
    }
    if (body.action === "progress" || body.action === "login" || body.action === "register") {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(progressResponse())
      });
      return;
    }
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true }) });
  });
  await page.addInitScript(() => {
    try {
      localStorage.setItem("mrj.auth.session", JSON.stringify({ id: "DemoKid", token: "demo-tok" }));
    } catch (e) {}
  });
  await page.goto(app.url, { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.waitForSelector("#mrj-auth-student-chip", { state: "visible", timeout: 45000 });
  await page.waitForTimeout(SETTLE_MS);
  await page.evaluate(() => {
    window.MRJ_AUTH._test.resetChipIdleMetrics();
  });
  await page.waitForTimeout(IDLE_MS);
  const metrics = await page.evaluate(() => window.MRJ_AUTH._test.getChipIdleMetrics());
  const chipHidden = await page.evaluate(
    () => document.getElementById("mrj-auth-student-chip")?.hidden
  );
  await page.close();
  return { slug: app.slug, chipHidden, ...metrics };
}

describe("chip idle layout loop", () => {
  it(
    "stays quiet after settle on classroom apps",
    { timeout: 600000 },
    async () => {
      const browser = await chromium.launch();
      const results = [];
      try {
        for (const app of APPS) {
          results.push(await measureApp(browser, app));
        }
      } finally {
        await browser.close();
      }
      console.log("CHIP_IDLE_METRICS", JSON.stringify(results));
      for (const r of results) {
        assert.equal(r.chipHidden, false, r.slug + " chip should stay visible");
        assert.equal(r.chipMutations, 0, r.slug + " chip mutations after settle");
        assert.equal(r.observerNotifies, 0, r.slug + " observer callbacks after settle");
        assert.equal(r.layoutRuns, 0, r.slug + " layout runs after settle");
      }
    }
  );
});
