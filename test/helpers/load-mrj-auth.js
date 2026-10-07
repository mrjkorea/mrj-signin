"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

function mkNode(tag, className) {
  const n = {
    nodeType: 1,
    tagName: tag,
    className: className || "",
    classNames: className ? className.split(/\s+/) : [],
    children: [],
    listeners: {},
    textContent: "",
    type: "",
    disabled: false,
    value: "",
    hidden: false,
    parentNode: null,
    id: "",
    style: {},
    attributes: {},
    classList: {
      add(...c) {
        c.forEach((x) => {
          if (!n.classNames.includes(x)) n.classNames.push(x);
        });
        n.className = n.classNames.join(" ");
      },
      remove(...c) {
        n.classNames = n.classNames.filter((x) => !c.includes(x));
        n.className = n.classNames.join(" ");
      },
      toggle(cls, force) {
        const has = n.classNames.includes(cls);
        const on = force === undefined ? !has : !!force;
        if (on && !has) n.classNames.push(cls);
        if (!on) n.classNames = n.classNames.filter((x) => x !== cls);
        n.className = n.classNames.join(" ");
      },
      contains(cls) {
        return n.classNames.includes(cls);
      }
    },
    setAttribute(k, v) {
      n.attributes[k] = v;
      if (k === "id") n.id = v;
      if (k === "class") {
        n.className = v;
        n.classNames = String(v).split(/\s+/).filter(Boolean);
      }
      if (k === "hidden") n.hidden = true;
      if (k === "aria-hidden") n.hidden = v === "true";
    },
    getAttribute(k) {
      return n.attributes[k] == null ? null : String(n.attributes[k]);
    },
    focus() {},
    getBoundingClientRect() {
      return { top: 0, right: 800, width: 80, height: 32, left: 720, bottom: 32 };
    },
    matches(sel) {
      if (sel.startsWith(".")) {
        const cls = sel.slice(1);
        return n.classNames.includes(cls);
      }
      return false;
    },
    closest(sel) {
      if (sel.includes("mrj-auth-chip")) return null;
      return null;
    },
    querySelector(sel) {
      if (sel === ".mrj-auth-panel-body") {
        let found = null;
        (function walk(x) {
          x.children.forEach((c) => {
            if (c.classNames && c.classNames.includes("mrj-auth-panel-body")) found = c;
            walk(c);
          });
        })(n);
        return found;
      }
      return null;
    },
    querySelectorAll(sel) {
      const out = [];
      if (sel === "button") {
        (function walk(x) {
          x.children.forEach((c) => {
            if (c.tagName === "button") out.push(c);
            walk(c);
          });
        })(n);
      }
      return out;
    },
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
    }
  };
  return n;
}

function loadMrjAuth(fetchImpl, session, timeoutMs) {
  const storage = {};
  if (session) storage["mrj.auth.session"] = JSON.stringify(session);
  const root = mkNode("div");
  const body = mkNode("body");
  body.querySelectorAll = function (sel) {
    const out = [];
    (function walk(n) {
      n.children.forEach((c) => {
        if (sel.indexOf("student-pill") !== -1 && c.classNames && c.classNames.includes("student-pill")) {
          out.push(c);
        }
        if (sel.indexOf("mrj-name-pill") !== -1 && c.attributes && c.attributes["data-mrj-name-pill"]) {
          out.push(c);
        }
        if (sel.indexOf("mrj-own-record") !== -1 && c.attributes && c.attributes["data-mrj-own-record"]) {
          out.push(c);
        }
        walk(c);
      });
    })(body);
    return out;
  };
  const html = mkNode("html");
  html.appendChild(body);
  const sandbox = {
    MRJ_AUTH_TEST_MODE: true,
    MRJAuthRules: require(path.join(__dirname, "..", "..", "auth-rules.js")),
    MRJ_ITEM_LABELS: null,
    innerWidth: 1024,
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
    document: {
      documentElement: html,
      body,
      currentScript: null,
      querySelector: (sel) => {
        if (sel === "#mrj-auth-student-chip") {
          return body.children.find((c) => c.id === "mrj-auth-student-chip") || null;
        }
        if (sel && sel.indexOf("student-pill") !== -1) {
          return body.children.find((c) => c.classNames && c.classNames.includes("student-pill")) || null;
        }
        if (sel && sel.indexOf("mrj-name-pill") !== -1) {
          return body.children.find((c) => c.attributes && c.attributes["data-mrj-name-pill"]) || null;
        }
        if (sel && sel.indexOf("mrj-own-record") !== -1) {
          return body.children.find((c) => c.attributes && c.attributes["data-mrj-own-record"]) || null;
        }
        if (sel.startsWith("script")) return null;
        return null;
      },
      querySelectorAll: (sel) => body.querySelectorAll(sel),
      createElement: (tag) => mkNode(tag)
    },
    location: { pathname: "/" },
    innerWidth: 1024,
    getComputedStyle: () => ({
      display: "block",
      visibility: "visible",
      opacity: "1"
    }),
    requestAnimationFrame: (fn) => setTimeout(fn, 0),
    addEventListener() {},
    removeEventListener() {}
  };
  sandbox.globalThis = sandbox;
  let code = fs.readFileSync(path.join(__dirname, "..", "..", "mrj-auth.js"), "utf8");
  code = code.replace(
    "var REQUEST_TIMEOUT_MS = 30000;",
    "var REQUEST_TIMEOUT_MS = " + (timeoutMs == null ? 200 : timeoutMs) + ";"
  );
  vm.runInNewContext(code, sandbox, { filename: "mrj-auth.js" });
  return { auth: sandbox.MRJ_AUTH, storage, root, sandbox, body };
}

module.exports = { loadMrjAuth, mkNode };
