#!/usr/bin/env node
/**
 * Headless screenshots of all 17 classroom apps with local mrj-auth injected.
 */
import { chromium } from "playwright";
import { createServer } from "http";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const outDir = path.join(root, "screenshots");
const port = 9876;

const APPS = [
  { slug: "word-master", url: "https://mrjkorea.github.io/word-master/", programs: ["word-master"] },
  { slug: "day2-words", url: "https://mrjkorea.github.io/day2-words/", programs: ["day2-words", "word-master"] },
  { slug: "day3-workbook", url: "https://mrjkorea.github.io/day3-workbook/", programs: ["day3-workbook", "conversation"] },
  { slug: "day4-speak", url: "https://mrjkorea.github.io/day4-speak/", programs: ["day4-speak"] },
  { slug: "day5-practice", url: "https://mrjkorea.github.io/day5-practice/", programs: ["day5-practice"] },
  { slug: "day6-talk", url: "https://mrjkorea.github.io/day6-talk/", programs: ["day6-talk"] },
  { slug: "leap-frog", url: "https://mrjkorea.github.io/leap-frog/", programs: ["leap-frog"] },
  { slug: "ski-jump", url: "https://mrjkorea.github.io/ski-jump/", programs: ["ski-jump"] },
  { slug: "firefighter-spelling", url: "https://mrjkorea.github.io/firefighter-spelling/", programs: ["firefighter-spelling"] },
  { slug: "typing-kids", url: "https://mrjkorea.github.io/typing-kids/", programs: ["typing-kids"] },
  { slug: "skill-builder-g1", url: "https://mrjkorea.github.io/skill-builder-g1/", programs: ["skill-builder-g1"] },
  { slug: "MRJ-Zap-Grammar-Books", url: "https://mrjkorea.github.io/MRJ-Zap-Grammar-Books/", programs: ["greenzap"], chipOff: true },
  { slug: "pronounce", url: "https://mrjkorea.github.io/pronounce/", programs: ["pronounce"] },
  { slug: "pronounce-whistle", url: "https://mrjkorea.github.io/pronounce-whistle/", programs: ["pronounce"] },
  { slug: "mrj-decodable-try-41", url: "https://mrjkorea.github.io/mrj-decodable-try-41/", programs: ["decodable"] },
  { slug: "mrj-decodable-try-71", url: "https://mrjkorea.github.io/mrj-decodable-try-71/", programs: ["decodable"] },
  { slug: "news-words", url: "https://mrjkorea.github.io/news-words/", programs: ["news-words"] }
];

function staticServer() {
  const mime = {
    ".js": "application/javascript",
    ".css": "text/css",
    ".html": "text/html"
  };
  return createServer((req, res) => {
    const rel = decodeURIComponent(req.url.split("?")[0]).replace(/^\//, "") || "mrj-auth.js";
    const file = path.join(root, rel);
    if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404);
      res.end("not found");
      return;
    }
    const ext = path.extname(file);
    res.writeHead(200, { "Content-Type": mime[ext] || "text/plain" });
    res.end(fs.readFileSync(file));
  });
}

function sampleRows(programs) {
  const p = programs[0];
  return [
    { program: p, item_id: "u01:demo-a", score_value: 9, score_max: 10, score_pct: 90, local_date: "2026-10-07" },
    { program: p, item_id: "g3:u02:demo-b", score_value: 7, score_max: 10, score_pct: 70, local_date: "2026-10-06" }
  ];
}

async function main() {
  fs.mkdirSync(outDir, { recursive: true });
  const server = staticServer();
  await new Promise((r) => server.listen(port, r));
  const base = `http://127.0.0.1:${port}`;
  const browser = await chromium.launch();
  const results = [];

  for (const app of APPS) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    const rows = sampleRows(app.programs);
    await page.route("**/mrj-signin/mrj-auth.js**", (route) =>
      route.fulfill({ status: 200, contentType: "application/javascript", path: path.join(root, "mrj-auth.js") })
    );
    await page.route("**/mrj-signin/mrj-auth.css**", (route) =>
      route.fulfill({ status: 200, contentType: "text/css", path: path.join(root, "mrj-auth.css") })
    );
    await page.route("**/mrj-signin/mrj-auth-boot.js**", (route) =>
      route.fulfill({ status: 200, contentType: "application/javascript", path: path.join(root, "mrj-auth-boot.js") })
    );
    await page.route("**/macros/s/**/exec**", async (route) => {
      let body = {};
      try {
        body = JSON.parse(route.request().postData() || "{}");
      } catch {
        body = {};
      }
      if (body.action === "login" || body.action === "register") {
        await route.fulfill({
          contentType: "application/json",
          body: JSON.stringify({ ok: true, id: "DemoKid", token: "demo-tok", progress: [] })
        });
        return;
      }
      if (body.action === "progress") {
        await route.fulfill({
          contentType: "application/json",
          body: JSON.stringify({
            ok: true,
            id: "DemoKid",
            token: "demo-tok",
            progress: rows,
            hasMore: false,
            total: rows.length
          })
        });
        return;
      }
      if (body.action === "load_pack" || body.action === "save_pack") {
        await route.fulfill({
          contentType: "application/json",
          body: JSON.stringify({ ok: true, found: false, progress_json: "{}" })
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

    let overlapNote = "";
    try {
      await page.goto(app.url, { waitUntil: "domcontentloaded", timeout: 60000 });
      await page.waitForTimeout(4000);
      if (app.chipOff) {
        await page.evaluate(() => {
          if (window.MRJ_AUTH && window.MRJ_AUTH.openProgressPanel) window.MRJ_AUTH.openProgressPanel();
        });
      } else {
        const chip = page.locator("#mrj-auth-student-chip");
        await chip.waitFor({ state: "visible", timeout: 20000 });
        await page.screenshot({ path: path.join(outDir, `${app.slug}-chip.png`) });
        await chip.click();
      }
      await page.locator(".mrj-auth-panel").waitFor({ state: "visible", timeout: 15000 });
      await page.screenshot({ path: path.join(outDir, `${app.slug}-panel.png`), fullPage: false });
      overlapNote = await page.evaluate(() => {
        const chip = document.getElementById("mrj-auth-student-chip");
        if (!chip || chip.hidden) return "chip off or hidden (OK for Zap)";
        const r = chip.getBoundingClientRect();
        const cx = (r.left + r.right) / 2;
        const cy = (r.top + r.bottom) / 2;
        const el = document.elementFromPoint(cx, cy);
        if (!el || el === chip || chip.contains(el)) return "OK";
        const tag = el.className || el.id || el.tagName;
        return "overlap at chip center: " + tag;
      });
    } catch (err) {
      overlapNote = "screenshot failed: " + String(err.message || err);
    }
    results.push({ ...app, overlapNote });
    await page.close();
  }

  await browser.close();
  server.close();
  fs.writeFileSync(path.join(outDir, "results.json"), JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
