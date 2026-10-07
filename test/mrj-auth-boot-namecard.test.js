"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

describe("mrj-auth-boot name card", () => {
  it("detects What\u2019s your name with curly apostrophe", () => {
    const code = fs.readFileSync(path.join(__dirname, "..", "mrj-auth-boot.js"), "utf8");
    assert.ok(code.indexOf("What\\u2019s your name") !== -1 || code.indexOf("\u2019") !== -1);
    assert.ok(code.indexOf("MRJ_AUTH.openProgressPanel") === -1);
  });
});
