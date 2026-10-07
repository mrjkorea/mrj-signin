"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { loadMrjAuth } = require("./helpers/load-mrj-auth");

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function jsonResponse(obj) {
  return Promise.resolve({ text: () => Promise.resolve(JSON.stringify(obj)) });
}

describe("panel filters and fetch", () => {
  it("word-master excludes day2 pack item ids", () => {
    const { auth, root } = loadMrjAuth(() => jsonResponse({ ok: false }));
    auth.mount(root, { app: "word-master" });
    assert.equal(
      auth._test.rowPassesItemFilter({ program: "word-master", item_id: "basic_a_u01:foo" }),
      false
    );
    assert.equal(
      auth._test.rowPassesItemFilter({ program: "word-master", item_id: "wm:lesson1" }),
      true
    );
  });

  it("day2-words keeps word-master rows only when day2 pack regex matches", () => {
    const { auth, root } = loadMrjAuth(() => jsonResponse({ ok: false }));
    auth.mount(root, { app: "day2-words" });
    assert.equal(
      auth._test.filterProgressForApp([
        { program: "day2-words", item_id: "x" },
        { program: "word-master", item_id: "basic_b_u02:y" },
        { program: "word-master", item_id: "other" }
      ]).length,
      2
    );
  });

  it("pronounce vs pronounce-whistle split whistle item ids", () => {
    const { auth, root, sandbox } = loadMrjAuth(() => jsonResponse({ ok: false }));
    auth.mount(root, { app: "pronounce" });
    assert.equal(auth._test.panelAppKey(), "pronounce");
    assert.equal(
      auth._test.rowPassesItemFilter({ program: "pronounce", item_id: "whistle:a" }),
      false
    );
    auth.mount(root, { app: "pronounce", panelApp: "pronounce-whistle" });
    assert.equal(auth._test.panelAppKey(), "pronounce-whistle");
    assert.equal(
      auth._test.rowPassesItemFilter({ program: "pronounce", item_id: "whistle:a" }),
      true
    );
    sandbox.location = { pathname: "/pronounce-whistle/index.html" };
    auth.mount(root, { app: "pronounce" });
    assert.equal(auth._test.panelAppKey(), "pronounce-whistle");
  });

  it("decodable try-41 and try-71 only allow mlr_dec book ranges", () => {
    const { auth, root } = loadMrjAuth(() => jsonResponse({ ok: false }));
    auth.mount(root, { app: "mrj-decodable-try-41" });
    assert.equal(auth._test.rowPassesItemFilter({ program: "decodable", item_id: "listen" }), false);
    assert.equal(
      auth._test.rowPassesItemFilter({ program: "decodable", item_id: "mlr_dec_041:listen" }),
      true
    );
    assert.equal(
      auth._test.rowPassesItemFilter({ program: "decodable", item_id: "mlr_dec_071:read" }),
      false
    );
    auth.mount(root, { app: "mrj-decodable-try-71" });
    assert.equal(
      auth._test.rowPassesItemFilter({ program: "decodable", item_id: "mlr_dec_071:read" }),
      true
    );
  });

  it("fetches each mapped program separately", async () => {
    const programs = [];
    const fetch = (url, opts) => {
      const b = JSON.parse(opts.body);
      if (b.action !== "progress") return jsonResponse({ ok: false });
      programs.push(b.program || "");
      return jsonResponse({
        ok: true,
        id: "kid",
        token: "tok",
        progress: [{ program: b.program, item_id: b.program + ":1", score_pct: 80 }],
        hasMore: false
      });
    };
    const { auth, root } = loadMrjAuth(fetch);
    auth.mount(root, { app: "day3-workbook" });
    const result = await auth._test.fetchPanelProgress({ id: "kid", token: "tok" }, {});
    assert.ok(result.ok);
    assert.deepEqual(programs.sort(), ["conversation", "day3-workbook"].sort());
    assert.equal(result.progress.length, 2);
  });

  it("paging stops when panel closes", async () => {
    let calls = 0;
    const fetch = (url, opts) => {
      const b = JSON.parse(opts.body);
      if (b.action !== "progress") return jsonResponse({ ok: false });
      calls += 1;
      return jsonResponse({
        ok: true,
        id: "kid",
        token: "tok",
        progress: [{ program: "word-master", item_id: "a", score_pct: 1 }],
        hasMore: true,
        total: 5000
      });
    };
    const { auth, root } = loadMrjAuth(fetch);
    auth.mount(root, { app: "word-master" });
    const result = await auth._test.fetchAllProgress("kid", "tok", "word-master", null, {
      panel: true,
      cancelCheck: function () {
        return calls >= 1;
      }
    });
    assert.equal(result.error, "cancelled");
    assert.equal(calls, 1);
  });

  it("panel fetch does not mutate sign-in state", async () => {
    const fetch = (url, opts) => {
      const b = JSON.parse(opts.body);
      if (b.action === "login") {
        return jsonResponse({ ok: true, id: "kid1", token: "tok-1", progress: [] });
      }
      if (b.action === "progress") {
        return jsonResponse({
          ok: true,
          id: b.id,
          token: b.token,
          progress: [{ program: "word-master", item_id: "x", score_pct: 50 }],
          hasMore: false
        });
      }
      return jsonResponse({ ok: false });
    };
    const { auth, root, body } = loadMrjAuth(fetch);
    auth.mount(root, { app: "word-master" });
    auth._test.send({ action: "login", id: "kid1", password: "pw" }, () => {}, () => {});
    await wait(3500);
    auth.openProgressPanel();
    await wait(1200);
    assert.equal(auth.student(), "kid1");
    assert.equal(auth.token(), "tok-1");
    auth.closeProgressPanel();
    assert.equal(body.children.find((c) => c.id === "mrj-auth-progress-panel-root").hidden, true);
  });

  it("setPanelRowsProvider merges and overrides by item_id", async () => {
    const fetch = () =>
      jsonResponse({
        ok: true,
        id: "kid",
        token: "tok",
        progress: [],
        hasMore: false
      });
    const { auth, root } = loadMrjAuth(fetch);
    auth.mount(root, { app: "word-master" });
    auth.setPanelRowsProvider(function () {
      return [{ item_id: "custom", label: "From app", score_pct: 99 }];
    });
    const merged = auth._test.mergeProviderRows(
      [{ program: "word-master", item_id: "custom", score_pct: 10 }],
      [{ item_id: "custom", label: "From app", score_pct: 99 }]
    );
    assert.equal(merged.length, 1);
    assert.equal(merged[0].score_pct, 99);
    assert.equal(merged[0].label, "From app");
  });

  it("loadPlace ignores stale progress after session change", async () => {
    let release;
    const hold = new Promise((r) => {
      release = r;
    });
    const fetch = (url, opts) => {
      const b = JSON.parse(opts.body);
      if (b.action === "login") {
        return jsonResponse({ ok: true, id: b.id, token: "tok-" + b.id, progress: [] });
      }
      if (b.action === "progress" && b.id === "studentA") {
        return hold.then(() =>
          jsonResponse({
            ok: true,
            id: "studentA",
            token: "tok-stolen",
            progress: [{ program: "word-master", item: "stolen" }],
            hasMore: false
          })
        );
      }
      return jsonResponse({
        ok: true,
        id: b.id,
        token: b.token || "tok-" + b.id,
        progress: [],
        hasMore: false
      });
    };
    const { auth, root } = loadMrjAuth(fetch, null, 200);
    auth.mount(root, { app: "word-master" });
    auth._test.send({ action: "login", id: "studentA", password: "pw" }, () => {}, () => {});
    await wait(500);
    auth.signOut();
    auth._test.send({ action: "login", id: "studentB", password: "pw" }, () => {}, () => {});
    await wait(500);
    release();
    await wait(4000);
    assert.equal(auth.student(), "studentB");
    assert.notEqual(auth.token(), "tok-stolen");
  });
});
