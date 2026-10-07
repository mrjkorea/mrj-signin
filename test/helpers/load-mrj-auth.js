"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

function mkNode(tag) {
  const n = {
    tagName: tag,
    className: "",
    children: [],
    listeners: {},
    textContent: "",
    type: "",
    disabled: false,
    value: "",
    parentNode: null,
    classList: { add() {}, remove() {} },
    setAttribute() {},
    focus() {},
    appendChild(c) {
      c.parentNode = n;
      n.children.push(c);
      return c;
    },
    insertBefore(c) {
      c.parentNode = n;
      n.children.unshift(c);
      return c;
    },
    removeChild(c) {
      n.children = n.children.filter((x) => x !== c);
    },
    get firstChild() {
      return n.children[0] || null;
    },
    addEventListener(ev, fn) {
      n.listeners[ev] = n.listeners[ev] || [];
      n.listeners[ev].push(fn);
    },
    querySelectorAll() {
      const out = [];
      (function walk(x) {
        x.children.forEach((c) => {
          if (c.tagName === "button") out.push(c);
          walk(c);
        });
      })(n);
      return out;
    }
  };
  return n;
}

function loadMrjAuth(fetchImpl, session, timeoutMs) {
  const storage = {};
  if (session) storage["mrj.auth.session"] = JSON.stringify(session);
  const root = mkNode("div");
  const sandbox = {
    MRJ_AUTH_TEST_MODE: true,
    MRJAuthRules: require(path.join(__dirname, "..", "..", "auth-rules.js")),
    localStorage: {
      getItem: (k) => (k in storage ? storage[k] : null),
      setItem: (k, v) => {
        storage[k] = String(v);
      },
      removeItem: (k) => {
        delete storage[k];
      }
    },
    fetch: fetchImpl,
    setTimeout,
    clearTimeout,
    Promise,
    JSON,
    Error,
    AbortController,
    document: { querySelector: () => root, createElement: mkNode },
    addEventListener() {}
  };
  sandbox.globalThis = sandbox;
  let code = fs.readFileSync(path.join(__dirname, "..", "..", "mrj-auth.js"), "utf8");
  code = code.replace(
    "var REQUEST_TIMEOUT_MS = 30000;",
    "var REQUEST_TIMEOUT_MS = " + (timeoutMs == null ? 200 : timeoutMs) + ";"
  );
  vm.runInNewContext(code, sandbox, { filename: "mrj-auth.js" });
  return { auth: sandbox.MRJ_AUTH, storage, root, sandbox };
}

module.exports = { loadMrjAuth, mkNode };
