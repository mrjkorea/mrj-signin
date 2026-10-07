"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { loadMrjAuth } = require("./helpers/load-mrj-auth");

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function jsonResponse(obj) {
  return Promise.resolve({ text: () => Promise.resolve(JSON.stringify(obj)) });
}

function loginFetch(progressHandler) {
  return (url, opts) => {
    const b = JSON.parse(opts.body);
    if (b.action === "login" || b.action === "register") {
      return jsonResponse({
        ok: true,
        id: b.id,
        token: "tok-" + b.id,
        progress: []
      });
    }
    if (b.action === "progress") {
      return progressHandler(b);
    }
    return jsonResponse({ ok: false, error: "bad_action" });
  };
}

describe("student chip and progress panel", () => {
  it("renders chip after sign-in and updates on sign-out", async () => {
    const fetch = loginFetch(() =>
      jsonResponse({ ok: true, id: "kid1", token: "tok-kid1", progress: [], hasMore: false })
    );
    const { auth, root, body } = loadMrjAuth(fetch);
    auth.mount(root, { app: "word-master", onReady: () => {} });
    auth._test.send({ action: "login", id: "kid1", password: "pw" }, () => {}, () => {});
    await wait(3500);
    const chip = body.children.find((c) => c.id === "mrj-auth-student-chip");
    assert.ok(chip);
    assert.equal(chip.hidden, false);
    assert.equal(chip.textContent, "kid1");
    auth.signOut();
    assert.equal(chip.hidden, true);
  });

  it("data-mrj-chip off via options hides chip", async () => {
    const fetch = loginFetch(() =>
      jsonResponse({ ok: true, id: "kid1", token: "tok-kid1", progress: [], hasMore: false })
    );
    const { auth, root, body } = loadMrjAuth(fetch);
    auth.mount(root, { app: "mrj-zap-grammar-books", chipOff: true, onReady: () => {} });
    auth._test.send({ action: "login", id: "kid1", password: "pw" }, () => {}, () => {});
    await wait(3500);
    const chip = body.children.find((c) => c.id === "mrj-auth-student-chip");
    assert.ok(chip);
    assert.equal(chip.hidden, true);
    auth.openProgressPanel();
    const panel = body.children.find((c) => c.id === "mrj-auth-progress-panel-root");
    assert.ok(panel && !panel.hidden);
    auth.closeProgressPanel();
    assert.equal(panel.hidden, true);
  });

  it("openProgressPanel is noop when signed out", () => {
    const { auth, body } = loadMrjAuth(() => jsonResponse({ ok: false }));
    auth.openProgressPanel();
    auth.closeProgressPanel();
    assert.equal(body.children.length, 0);
  });

  it("fetches all progress pages until hasMore is false", async () => {
    let calls = 0;
    const fetch = (url, opts) => {
      const b = JSON.parse(opts.body);
      if (b.action !== "progress") return jsonResponse({ ok: false });
      calls += 1;
      if (!b.offset) {
        return jsonResponse({
          ok: true,
          id: "kid1",
          token: "tok-kid1",
          progress: [{ program: "word-master", item_id: "a", score_pct: 80 }],
          hasMore: true,
          total: 2
        });
      }
      return jsonResponse({
        ok: true,
        id: "kid1",
        token: "tok-kid1",
        progress: [{ program: "word-master", item_id: "b", score_pct: 90 }],
        hasMore: false,
        total: 2
      });
    };
    const { auth, root } = loadMrjAuth(fetch);
    auth.mount(root, { app: "word-master" });
    const result = await auth._test.fetchAllProgress("kid1", "tok-kid1", "", null, { unlimited: true });
    assert.equal(calls, 2);
    assert.equal(result.progress.length, 2);
    const filtered = auth._test.filterProgressForApp(result.progress);
    assert.equal(filtered.length, 2);
  });

  it("stale session discards late panel response", async () => {
    let release;
    const hold = new Promise((r) => {
      release = r;
    });
    const fetch = loginFetch((b) => {
      if (b.id === "studentA" && !b.offset) {
        return hold.then(() =>
          jsonResponse({
            ok: true,
            id: "studentA",
            token: "tok-A",
            progress: [{ program: "word-master", item_id: "stolen", score_pct: 50 }],
            hasMore: false
          })
        );
      }
      return jsonResponse({
        ok: true,
        id: b.id,
        token: b.token,
        progress: [],
        hasMore: false
      });
    });
    const { auth, root, body } = loadMrjAuth(fetch);
    auth.mount(root, { app: "word-master" });
    auth._test.send({ action: "login", id: "studentA", password: "pw" }, () => {}, () => {});
    await wait(3500);
    auth.openProgressPanel();
    auth.signOut();
    auth._test.send({ action: "login", id: "studentB", password: "pw" }, () => {}, () => {});
    await wait(500);
    release();
    await wait(800);
    const panel = body.children.find((c) => c.id === "mrj-auth-progress-panel-root");
    const text = JSON.stringify(panel ? panel.children : []);
    assert.ok(!text.includes("stolen"));
  });

  it("maps zap app to greenzap and filters other programs", () => {
    const { auth, root } = loadMrjAuth(() => jsonResponse({ ok: false }));
    auth.mount(root, { app: "mrj-zap-grammar-books" });
    const programs = auth._test.scoreProgramsForApp();
    assert.equal(programs.length, 1);
    assert.equal(programs[0], "greenzap");
    const rows = auth._test.filterProgressForApp([
      { program: "greenzap", item_id: "u01:a" },
      { program: "word-master", item_id: "x" },
      { program: "greenzap", item_id: "g3:u01:b" }
    ]);
    assert.equal(rows.length, 2);
  });

  it("MRJ_ITEM_LABELS shows friendly item title", async () => {
    const fetch = loginFetch(() =>
      jsonResponse({
        ok: true,
        id: "kid1",
        token: "tok-kid1",
        progress: [{ program: "word-master", item_id: "w1", score_value: 8, score_max: 10 }],
        hasMore: false
      })
    );
    const { auth, root, body, sandbox } = loadMrjAuth(fetch);
    sandbox.MRJ_ITEM_LABELS = { w1: "Word one" };
    auth.mount(root, { app: "word-master" });
    auth._test.send({ action: "login", id: "kid1", password: "pw" }, () => {}, () => {});
    await wait(3500);
    auth.openProgressPanel();
    await wait(1200);
    const panel = body.children.find((c) => c.id === "mrj-auth-progress-panel-root");
    let text = "";
    (function walk(n) {
      text += n.textContent || "";
      n.children.forEach(walk);
    })(panel);
    assert.ok(text.includes("Word one"));
    assert.ok(text.includes("w1"));
  });

  it("panel error shows retry path", async () => {
    let panelAttempt = 0;
    const fetch = loginFetch((b) => {
      if (b.program) {
        return jsonResponse({
          ok: true,
          id: "kid1",
          token: "tok-kid1",
          progress: [],
          hasMore: false
        });
      }
      panelAttempt += 1;
      if (panelAttempt < 3) {
        return jsonResponse({ ok: false, error: "server", message: "busy" });
      }
      return jsonResponse({
        ok: true,
        id: "kid1",
        token: "tok-kid1",
        progress: [{ program: "day4-speak", item_id: "x", score_pct: 70 }],
        hasMore: false
      });
    });
    const { auth, root, body } = loadMrjAuth(fetch);
    auth.mount(root, { app: "day4-speak" });
    auth._test.send({ action: "login", id: "kid1", password: "pw" }, () => {}, () => {});
    await wait(3500);
    auth.openProgressPanel();
    await wait(3800);
    const panel = body.children.find((c) => c.id === "mrj-auth-progress-panel-root");
    let retryBtn = null;
    (function walk(n) {
      n.children.forEach((c) => {
        if (c.textContent === "Retry") retryBtn = c;
        walk(c);
      });
    })(panel);
    assert.ok(retryBtn);
    retryBtn.listeners.click[0]();
    await wait(500);
    let text = "";
    (function walk(n) {
      text += n.textContent || "";
      n.children.forEach(walk);
    })(panel);
    assert.ok(text.includes("70%") || text.includes("x"));
  });
});
