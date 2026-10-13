"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const dash = require("../lib/dashboard-pure");

describe("dashboard-pure", () => {
  it("summarizes pack sets into completion units", () => {
    const pack = {
      sets: {
        nouns100: { intro: { a: true, b: false }, winsA: { c: 2 } },
      },
    };
    const summary = dash.summarizeStudentDashboard(JSON.stringify(pack), []);
    assert.equal(summary.completion.units.length, 1);
    assert.equal(summary.completion.units[0].id, "nouns100");
    assert.ok(summary.completion.overallPct > 0);
  });

  it("builds score trend from progress rows", () => {
    const rows = [
      { program: "word-master", item: "a", score: "8/10", date: "2026-10-01" },
      { program: "word-master", item: "b", score: "90%", date: "2026-10-02" },
    ];
    const trend = dash.scoreTrendFromRows(rows, 10);
    assert.equal(trend.length, 2);
    assert.equal(trend[1].pct, 90);
  });

  it("formatDeviceItemId compacts device payload", () => {
    const s = dash.formatDeviceItemId_({
      type: "phone",
      os: "iOS",
      browser: "Safari",
      screenW: 390,
      screenH: 844,
    });
    assert.match(s, /^device:phone\/iOS\/Safari\/390x844$/);
  });
});
