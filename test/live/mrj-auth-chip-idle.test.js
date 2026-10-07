"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const { chromium } = require("playwright");
const { installChipIdleRoutes, measureChipIdle } = require("../helpers/chip-idle-routes");

const ROOT = path.join(__dirname, "..", "..");
const IDLE_MS = Number(process.env.CHIP_IDLE_MS || 30000);
const SETTLE_MS = Number(process.env.CHIP_SETTLE_MS || 5000);

const APPS = [
  {
    slug: "word-master",
    url: "https://mrjkorea.github.io/word-master/",
    app: "word-master",
    expectChip: false
  },
  { slug: "day2-words", url: "https://mrjkorea.github.io/day2-words/", app: "day2-words", expectChip: true },
  {
    slug: "day3-workbook",
    url: "https://mrjkorea.github.io/day3-workbook/",
    app: "day3-workbook",
    expectChip: true
  },
  {
    slug: "day5-practice",
    url: "https://mrjkorea.github.io/day5-practice/",
    app: "day5-practice",
    expectChip: true
  },
  { slug: "typing-kids", url: "https://mrjkorea.github.io/typing-kids/", app: "typing-kids", expectChip: true },
  { slug: "news-words", url: "https://mrjkorea.github.io/news-words/", app: "news-words", expectChip: true }
];

describe("chip idle layout loop (live Pages)", () => {
  it(
    "stays quiet after settle on classroom apps",
    { timeout: 600000 },
    async () => {
      const browser = await chromium.launch();
      const results = [];
      try {
        for (const app of APPS) {
          const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
          await installChipIdleRoutes(page, ROOT);
          results.push(await measureChipIdle(page, app, SETTLE_MS, IDLE_MS));
          await page.close();
        }
      } finally {
        await browser.close();
      }
      console.log("CHIP_IDLE_METRICS_LIVE", JSON.stringify(results));
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
