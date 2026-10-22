/**
 * Teacher sign-in role and metadata tagging (mirrored in Code.gs / mrj-auth.js).
 */
"use strict";

/** Server-side allowlist: display id "Andrew" → id_key "andrew". */
const SIGNIN_TEACHER_ROLE_KEYS = ["andrew"];

function idKey(id) {
  return String(id == null ? "" : id)
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function signInRoleForIdKey(key) {
  const k = idKey(key);
  if (!k) return "";
  for (const allowed of SIGNIN_TEACHER_ROLE_KEYS) {
    if (allowed === k) return "teacher";
  }
  return "";
}

function parseMetadataJson(raw) {
  if (raw == null || raw === "") return null;
  if (typeof raw === "object") return raw;
  try {
    const v = JSON.parse(String(raw));
    return v && typeof v === "object" ? v : null;
  } catch {
    return null;
  }
}

function metadataRoleIsTeacher(meta) {
  if (!meta || typeof meta !== "object") return false;
  return String(meta.role || "").trim().toLowerCase() === "teacher";
}

function isTeacherMetadataJson(raw) {
  return metadataRoleIsTeacher(parseMetadataJson(raw));
}

function teacherMetadataJsonString() {
  return JSON.stringify({ role: "teacher" });
}

function tagProgressJsonWithRole(json, role) {
  if (role !== "teacher") return String(json == null ? "{}" : json);
  let obj;
  try {
    obj = JSON.parse(String(json == null ? "{}" : json));
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) obj = {};
  } catch {
    obj = {};
  }
  obj.metadata_json = { role: "teacher" };
  return JSON.stringify(obj);
}

function progressRowIsTeacherTagged(row) {
  if (!row) return false;
  if (isTeacherMetadataJson(row.metadata_json)) return true;
  return false;
}

function filterProgressRowsSkipTeacher(rows) {
  return (rows || []).filter((r) => !progressRowIsTeacherTagged(r));
}

module.exports = {
  SIGNIN_TEACHER_ROLE_KEYS,
  idKey,
  signInRoleForIdKey,
  parseMetadataJson,
  metadataRoleIsTeacher,
  isTeacherMetadataJson,
  teacherMetadataJsonString,
  tagProgressJsonWithRole,
  progressRowIsTeacherTagged,
  filterProgressRowsSkipTeacher,
};
