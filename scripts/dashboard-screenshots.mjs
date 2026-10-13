#!/usr/bin/env node
import { chromium } from "playwright";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import http from "http";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const artifactDir = "/opt/cursor/artifacts/screenshots";
fs.mkdirSync(artifactDir, { recursive: true });

function serve(port) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let p = req.url.split("?")[0];
      if (p === "/") p = "/teacher-dashboard.html";
      const file = path.join(root, decodeURIComponent(p.replace(/^\//, "")));
      if (!file.startsWith(root) || !fs.existsSync(file)) {
        res.writeHead(404);
        res.end("missing");
        return;
      }
      const ext = path.extname(file);
      const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };
      res.writeHead(200, { "Content-Type": types[ext] || "application/octet-stream" });
      res.end(fs.readFileSync(file));
    });
    server.listen(port, () => resolve(server));
  });
}

async function mockTeacherPage(page) {
  await page.addInitScript(() => {
    window.__mock = true;
    const students = [
      { id: "zz_test_it_wm" },
      { id: "zz_test_alpha" },
    ];
    const apps = [
      { program: "word-master", label: "Word Master", completionPct: 62, avgScorePct: 78, lastActive: "2026-10-10", weakCount: 2 },
      { program: "greenzap", label: "Green Zap", completionPct: 40, avgScorePct: 85, lastActive: "2026-10-09", weakCount: 0 },
    ];
    const dashboards = {
      "word-master": {
        scoreTrend: [
          { date: "2026-10-08", pct: 70 },
          { date: "2026-10-10", pct: 80 },
        ],
      },
    };
    const origFetch = window.fetch;
    window.fetch = function (url, opts) {
      const body = opts && opts.body ? JSON.parse(opts.body) : {};
      if (body.action === "teacher_list_students") {
        if (body.teacher_secret !== "demo-secret") {
          return Promise.resolve({
            json: () => Promise.resolve({ ok: false, error: "forbidden", message: "Teachers only." }),
          });
        }
        return Promise.resolve({ json: () => Promise.resolve({ ok: true, students }) });
      }
      if (body.action === "teacher_student_dashboard") {
        return Promise.resolve({
          json: () => Promise.resolve({ ok: true, student: body.student, apps, dashboards }),
        });
      }
      if (body.action === "teacher_app_roster") {
        return Promise.resolve({
          json: () =>
            Promise.resolve({
              ok: true,
              students: students.map((s) => ({
                id: s.id,
                summary: { completionPct: s.id === "zz_test_it_wm" ? 62 : 35 },
              })),
            }),
        });
      }
      return origFetch(url, opts);
    };
  });
}

async function main() {
  const port = 8765;
  const server = await serve(port);
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await mockTeacherPage(page);
  await page.goto(`http://127.0.0.1:${port}/teacher-dashboard.html`);
  await page.fill("#td-pw", "demo-secret");
  await page.click("text=Open class dashboard");
  await page.waitForSelector("text=Students");
  await page.screenshot({ path: path.join(artifactDir, "teacher-class-list-phone.png"), fullPage: true });
  await page.click("text=zz_test_it_wm");
  await page.waitForSelector("text=Word Master");
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(artifactDir, "teacher-student-charts-phone.png"), fullPage: true });

  const studentPage = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await studentPage.setContent(`<!DOCTYPE html>
<html><head><link rel="stylesheet" href="http://127.0.0.1:${port}/mrj-auth.css"/></head>
<body>
<script src="http://127.0.0.1:${port}/lib/chart.umd.min.js"></script>
<script src="http://127.0.0.1:${port}/lib/mrj-progress-charts.js"></script>
<div class="mrj-auth-panel-root" style="display:block;position:relative;inset:auto;padding:0.5rem;">
<div class="mrj-auth-panel" style="max-width:100%;max-height:none;">
<div class="mrj-auth-panel-header"><h2 class="mrj-auth-panel-title">My progress</h2></div>
<div class="mrj-auth-panel-body" id="body"></div></div></div>
<script>
var units=[{id:"nouns100",label:"Nouns 100",done:8,total:10,pct:80},{id:"verbs100",label:"Verbs 100",done:3,total:10,pct:30}];
var trend=[{date:"2026-10-08",pct:70},{date:"2026-10-09",pct:75},{date:"2026-10-10",pct:80}];
var b=document.getElementById("body");
var c1=document.createElement("div");c1.className="mrj-auth-chart-canvas-wrap";c1.style.height="220px";
var cv1=document.createElement("canvas");c1.appendChild(cv1);b.appendChild(c1);
var c2=document.createElement("div");c2.className="mrj-auth-chart-canvas-wrap";c2.style.height="200px";
var cv2=document.createElement("canvas");c2.appendChild(cv2);b.appendChild(c2);
MRJ_PROGRESS_CHARTS.renderCompletionBarChart(cv1,units);
MRJ_PROGRESS_CHARTS.renderScoreTrendChart(cv2,trend);
</script></body></html>`);
  await studentPage.waitForTimeout(300);
  await studentPage.screenshot({ path: path.join(artifactDir, "student-my-progress-phone.png"), fullPage: true });

  await browser.close();
  server.close();
  console.log("Wrote screenshots to", artifactDir);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
