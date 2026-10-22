"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const teacher = require("../lib/teacher-role");

describe("teacher-role pure helpers", () => {
  it("Andrew id_key maps to teacher role", () => {
    assert.equal(teacher.signInRoleForIdKey("Andrew"), "teacher");
    assert.equal(teacher.signInRoleForIdKey("andrew"), "teacher");
    assert.equal(teacher.signInRoleForIdKey("Student"), "");
  });

  it("tags progress JSON with metadata_json role teacher", () => {
    const out = teacher.tagProgressJsonWithRole('{"v":1}', "teacher");
    const parsed = JSON.parse(out);
    assert.deepEqual(parsed.metadata_json, { role: "teacher" });
  });

  it("filterProgressRowsSkipTeacher removes tagged rows", () => {
    const rows = [
      { program: "p", item: "a", metadata_json: { role: "teacher" } },
      { program: "p", item: "b" },
    ];
    const kept = teacher.filterProgressRowsSkipTeacher(rows);
    assert.equal(kept.length, 1);
    assert.equal(kept[0].item, "b");
  });
});
