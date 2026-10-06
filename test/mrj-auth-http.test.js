"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const AUTH_PATH = path.join(__dirname, "..", "mrj-auth.js");
const RULES_PATH = path.join(__dirname, "..", "auth-rules.js");

function loadAuth(fetchImpl) {
  const storage = {};
  const sandbox = {
    MRJ_AUTH_TEST_MODE: true,
    MRJAuthRules: require(RULES_PATH),
    localStorage: {
      getItem: (k) => (k in storage ? storage[k] : null),
      setItem: (k, v) => { storage[k] = String(v); },
      removeItem: (k) => { delete storage[k]; }
    },
    fetch: fetchImpl,
    setTimeout,
    clearTimeout,
    Promise,
    JSON,
    Error,
    AbortController,
    document: {
      querySelector: () => ({
        classList: { add() {} },
        appendChild() {},
        removeChild() {},
        insertBefore() {},
        firstChild: null,
        querySelectorAll: () => []
      }),
      createElement: (tag) => ({
        tagName: tag,
        className: "",
        classList: { add() {} },
        setAttribute() {},
        appendChild() {},
        addEventListener() {},
        focus() {},
        textContent: "",
        type: "",
        disabled: false,
        value: ""
      })
    },
    addEventListener() {}
  };
  sandbox.globalThis = sandbox;
  const code = fs.readFileSync(AUTH_PATH, "utf8");
  vm.runInNewContext(code, sandbox, { filename: "mrj-auth.js" });
  return { auth: sandbox.MRJ_AUTH, storage, sandbox };
}

function jsonResponse(obj, delayMs) {
  return () =>
    new Promise((resolve) => {
      setTimeout(() => {
        resolve({
          text: () => Promise.resolve(JSON.stringify(obj))
        });
      }, delayMs || 0);
    });
}

describe("mrj-auth HTTP client", () => {
  it("exposes version marker", () => {
    const { auth } = loadAuth(() => Promise.resolve({ text: () => Promise.resolve("{}") }));
    assert.equal(auth.AUTH_VERSION, "20261006-resilient");
  });

  it("waits through a 15s delay then succeeds", async () => {
    let calls = 0;
    const { auth } = loadAuth(() => {
      calls += 1;
      return jsonResponse({ ok: true, token: "t1" }, 15000)();
    });
    const data = await auth._test.post({ action: "progress", id: "a", token: "t" });
    assert.equal(calls, 1);
    assert.equal(data.ok, true);
  });

  it("postOnce times out at the configured limit", async () => {
    const { auth } = loadAuth(() => new Promise(() => {}));
    await assert.rejects(
      () => auth._test.postOnce({ action: "progress" }, 80),
      (err) => err && err.kind === "timeout"
    );
  });

  it("post retries after failure then succeeds", async () => {
    let calls = 0;
    const { auth } = loadAuth(() => {
      calls += 1;
      if (calls === 1) {
        return Promise.reject(Object.assign(new Error("timeout"), { kind: "timeout" }));
      }
      return jsonResponse({ ok: true, token: "t2" })();
    });
    const data = await auth._test.post({ action: "progress", id: "a", token: "t" });
    assert.equal(calls, 2);
    assert.equal(data.ok, true);
  });

  it("retries on HTML 404 body then succeeds", async () => {
    let calls = 0;
    const { auth } = loadAuth(() => {
      calls += 1;
      if (calls === 1) {
        return Promise.resolve({
          text: () => Promise.resolve("<html>Sorry, unable to open the file</html>")
        });
      }
      return jsonResponse({ ok: true, token: "t3" })();
    });
    const data = await auth._test.post({ action: "progress", id: "a", token: "t" });
    assert.equal(calls, 2);
    assert.equal(data.ok, true);
  });

  it("does not retry wrong_password", async () => {
    let calls = 0;
    const { auth } = loadAuth(() => {
      calls += 1;
      return jsonResponse({ ok: false, error: "wrong_password", message: "Wrong password." })();
    });
    const data = await auth._test.post({ action: "login", id: "a", password: "x" });
    assert.equal(calls, 1);
    assert.equal(data.error, "wrong_password");
  });

  it("sessionRejected treats bad_token as fatal", () => {
    const { auth } = loadAuth(() => Promise.resolve({ text: () => Promise.resolve("{}") }));
    assert.equal(auth._test.sessionRejected({ error: "bad_token" }), true);
    assert.equal(auth._test.sessionRejected({ error: "server" }), false);
  });

  it("optimistic resume keeps session on network failure", async () => {
    const { auth, storage } = loadAuth(() => Promise.reject(new Error("network")));
    storage["mrj.auth.session"] = JSON.stringify({ id: "student1", token: "tok" });
    let ready = null;
    auth.mount("#gate", {
      onReady: (info) => { ready = info; }
    });
    await new Promise((r) => setTimeout(r, 3200));
    assert.ok(ready);
    assert.equal(ready.id, "student1");
    assert.equal(ready.token, "tok");
    assert.equal(storage["mrj.auth.session"], JSON.stringify({ id: "student1", token: "tok" }));
  });

  it("accepts a slow login response after the client has been waiting", async () => {
    let resolveFetch;
    const { auth } = loadAuth(() => new Promise((resolve) => {
      resolveFetch = resolve;
    }));
    auth.mount("#gate", { onReady() {} });
    const pending = auth._test.post({ action: "login", id: "u", password: "p" });
    resolveFetch({
      text: () => Promise.resolve(JSON.stringify({ ok: true, id: "u", token: "late", progress: [] }))
    });
    const data = await pending;
    assert.equal(data.ok, true);
    assert.equal(data.token, "late");
  });
});
