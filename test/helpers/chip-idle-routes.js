"use strict";

const fs = require("fs");
const path = require("path");

function installChipIdleRoutes(page, root) {
  const authSource =
    "globalThis.MRJ_AUTH_TEST_MODE = true;\n" +
    fs.readFileSync(path.join(root, "mrj-auth.js"), "utf8");

  function progressResponse() {
    return {
      ok: true,
      id: "DemoKid",
      token: "demo-tok",
      progress: [
        {
          program: "word-master",
          item_id: "u01:a",
          score_pct: 80,
          score_value: 8,
          score_max: 10
        }
      ],
      hasMore: false
    };
  }

  return page
    .route("**/mrj-signin/mrj-auth.js**", (route) =>
      route.fulfill({ status: 200, contentType: "application/javascript", body: authSource })
    )
    .then(() =>
      page.route("**/mrj-signin/mrj-auth.css**", (route) =>
        route.fulfill({
          status: 200,
          contentType: "text/css",
          path: path.join(root, "mrj-auth.css")
        })
      )
    )
    .then(() =>
      page.route("**/mrj-signin/mrj-auth-boot.js**", (route) =>
        route.fulfill({
          status: 200,
          contentType: "application/javascript",
          path: path.join(root, "mrj-auth-boot.js")
        })
      )
    )
    .then(() =>
      page.route("**/macros/s/**/exec**", async (route) => {
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
      })
    )
    .then(() =>
      page.addInitScript(() => {
        try {
          localStorage.setItem(
            "mrj.auth.session",
            JSON.stringify({ id: "DemoKid", token: "demo-tok" })
          );
        } catch (e) {}
      })
    );
}

async function measureChipIdle(page, app, settleMs, idleMs) {
  await page.goto(app.url, { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.waitForFunction(
    () => globalThis.MRJ_AUTH && typeof MRJ_AUTH.student === "function" && MRJ_AUTH.student(),
    { timeout: 45000 }
  );
  if (app.expectChip) {
    await page.waitForSelector("#mrj-auth-student-chip", { state: "visible", timeout: 45000 });
  } else {
    await page.waitForTimeout(1500);
  }
  await page.waitForTimeout(settleMs);
  await page.evaluate(() => {
    window.MRJ_AUTH._test.resetChipIdleMetrics();
  });
  await page.waitForTimeout(idleMs);
  const metrics = await page.evaluate(() => window.MRJ_AUTH._test.getChipIdleMetrics());
  const chipHidden = await page.evaluate(
    () => document.getElementById("mrj-auth-student-chip")?.hidden
  );
  return { slug: app.slug, chipHidden, expectChip: app.expectChip, ...metrics };
}

module.exports = { installChipIdleRoutes, measureChipIdle };
