#!/usr/bin/env node
/**
 * Headless screenshots + chip collision check (artifacts only; not committed).
 */
import { chromium } from "playwright";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const outDir = path.join(root, "screenshots");

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

const VIEWPORTS = [
  { name: "1280x800", width: 1280, height: 800 },
  { name: "390x844", width: 390, height: 844 }
];

function sampleRows(programs) {
  const p = programs[0];
  return [
    { program: p, item_id: "u01:demo-a", score_value: 9, score_max: 10, score_pct: 90, local_date: "2026-10-07" },
    { program: p, item_id: "g3:u02:demo-b", score_value: 7, score_max: 10, score_pct: 70, local_date: "2026-10-06" }
  ];
}

async function chipCollision(page) {
  return page.evaluate(() => {
    const chip = document.getElementById("mrj-auth-student-chip");
    if (!chip || chip.hidden) return "no chip (ok if chip off)";
    const cr = chip.getBoundingClientRect();
    const selectors =
      "button, a, select, input, textarea, [role='button'], [onclick], .pill, [class*='pill'], [class*='badge']";
    const nodes = document.querySelectorAll(selectors);
    for (let i = 0; i < nodes.length; i++) {
      const el = nodes[i];
      if (!el || el === chip || chip.contains(el)) continue;
      if (el.closest("#mrj-auth-student-chip, .mrj-auth-panel-root, #mrj-auth-gate")) continue;
      const st = getComputedStyle(el);
      if (st.display === "none" || st.visibility === "hidden" || st.opacity === "0") continue;
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) continue;
      const overlap =
        cr.left < r.right && cr.right > r.left && cr.top < r.bottom && cr.bottom > r.top;
      if (overlap) {
        const tag = el.tagName + (el.className ? "." + String(el.className).split(" ")[0] : "");
        return "overlap: " + tag;
      }
    }
    return "ok";
  });
}

async function runApp(browser, app, vp) {
  const page = await browser.newPage({ viewport: { width: vp.width, height: vp.height } });
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
      const prog = body.program || "";
      const filtered = rows.filter((r) => !prog || r.program === prog);
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          id: "DemoKid",
          token: "demo-tok",
          progress: filtered.length ? filtered : rows,
          hasMore: false,
          total: filtered.length || rows.length
        })
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

  let chipStatus = "error";
  let panelStatus = "error";
  try {
    await page.goto(app.url, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(4500);
    if (app.chipOff) {
      chipStatus = "chip off";
    } else {
      await page.locator("#mrj-auth-student-chip").waitFor({ state: "visible", timeout: 20000 });
      await page.waitForTimeout(500);
      chipStatus = await chipCollision(page);
      await page.screenshot({ path: path.join(outDir, `${app.slug}-${vp.name}-chip.png`) });
    }
    if (app.chipOff) {
      await page.evaluate(() => window.MRJ_AUTH && window.MRJ_AUTH.openProgressPanel());
    } else {
      await page.locator("#mrj-auth-student-chip").click();
    }
    await page.locator(".mrj-auth-panel").waitFor({ state: "visible", timeout: 15000 });
    panelStatus = "ok";
    await page.screenshot({ path: path.join(outDir, `${app.slug}-${vp.name}-panel.png`) });
  } catch (err) {
    chipStatus = String(err.message || err);
  }
  await page.close();
  return { slug: app.slug, viewport: vp.name, chip: chipStatus, panel: panelStatus };
}

async function main() {
  fs.mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch();
  const results = [];
  for (const vp of VIEWPORTS) {
    for (const app of APPS) {
      results.push(await runApp(browser, app, vp));
    }
  }
  await browser.close();
  fs.writeFileSync(path.join(outDir, "results.json"), JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
