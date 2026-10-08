"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { loadMrjAuth, mkNode } = require("./helpers/load-mrj-auth");

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function jsonResponse(obj) {
  return Promise.resolve({ text: () => Promise.resolve(JSON.stringify(obj)) });
}

describe("student name pill", () => {
  it("hides chip and wires visible student-pill to open panel once", async () => {
    const fetch = (url, opts) => {
      const b = JSON.parse(opts.body);
      if (b.action === "progress") {
        return jsonResponse({
          ok: true,
          id: "kid",
          token: "tok",
          progress: [{ program: "greenzap", item_id: "u01:a", score_pct: 90 }],
          hasMore: false
        });
      }
      return jsonResponse({ ok: false });
    };
    const { auth, root, body } = loadMrjAuth(fetch, { id: "kid", token: "tok" });
    const pill = mkNode("span", "student-pill");
    pill.textContent = "kid";
    pill.getBoundingClientRect = () => ({ width: 80, height: 24, top: 8, left: 100, right: 180, bottom: 32 });
    body.appendChild(pill);
    auth.mount(root, { app: "mrj-zap-grammar-books" });
    await wait(3500);
    assert.equal(auth.student(), "kid");
    auth._test.updateStudentChip();
    assert.ok(auth._test.findNamePill());
    const chip = body.children.find((c) => c.id === "mrj-auth-student-chip");
    assert.ok(chip);
    assert.equal(chip.hidden, true);
    assert.equal(pill.getAttribute("data-mrj-pill-wired"), "1");
    assert.equal(pill.getAttribute("role"), "button");
    auth.openProgressPanel();
    const panel = body.children.find((c) => c.id === "mrj-auth-progress-panel-root");
    assert.ok(panel && !panel.hidden);
    auth.openProgressPanel();
    assert.equal(panel.children.length, 2);
  });
});
