"use strict";
// Mock of Google Sheets modelling real input parsing (USER_ENTERED-like, as Range.setValue does).
const fs = require("fs");
const vm = require("vm");

const ERR = "#ERROR!";
function makeBook(opts = {}) {
  // opts.textFmtLiteralApostrophe: hypothesis B (in "@"-formatted cells a leading ' is stored literally)
  const stats = { getValues: 0, getValue: 0, setValues: 0, setValue: 0, appendRow: 0, deleteRow: 0, deleteRows: 0, getLastRow: 0, charsRead: 0, charsWritten: 0, maxSetValuesChars: 0 };
  const lockState = { held: false, writesWithoutLock: [] };
  function parseInput(v, textFmt) {
    if (typeof v !== "string") return v;
    let s = Buffer.from(v, "utf8").toString("utf8"); // lone surrogates -> U+FFFD on the wire
    if (s.length > 50000) throw new Error("Your input contains more than the maximum of 50000 characters in a single cell.");
    if (s.charAt(0) === "'") {
      if (textFmt && opts.textFmtLiteralApostrophe) return s;
      return s.slice(1); // quote prefix = format marker, not content
    }
    if (textFmt) return s;
    if (s === "") return "";
    if (/^\s*[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?\s*$/i.test(s)) return Number(s);
    if (/^(true|false)$/i.test(s)) return s.toLowerCase() === "true";
    if (/^[=+\-@]/.test(s)) return ERR; // formula / parse error
    if (/^\d{4}-\d{2}-\d{2}(T[\d:.]+Z?)?$/.test(s)) return new Date(s); // date coercion
    return s;
  }
  class Sheet {
    constructor(name) { this.name = name; this.rows = []; this.fmt = {}; this.maxRows = 1000; this.frozen = 0; }
    _w() { if (!lockState.held) lockState.writesWithoutLock.push(this.name); }
    getLastRow() { stats.getLastRow++; let n = this.rows.length; while (n > 0 && (this.rows[n - 1] || []).every(x => x === "" || x == null)) n--; return n; }
    getLastColumn() { let m = 0; for (const r of this.rows) if (r) m = Math.max(m, r.length); return m; }
    getMaxRows() { return this.maxRows; }
    insertRowsAfter(after, n) {
      this._w();
      stats.insertRows = (stats.insertRows || 0) + 1;
      this.maxRows += n;
      const insertAt = Math.min(after, this.rows.length);
      this.rows.splice(insertAt, 0, ...Array.from({ length: n }, () => []));
      return this;
    }
    deleteRows(r, n) { this._w(); stats.deleteRows = (stats.deleteRows || 0) + 1; if (this.maxRows - n <= this.frozen) throw new Error("cannot delete all non-frozen rows"); this.rows.splice(r - 1, n); this.maxRows -= n; for (let i = 0; i < n; i++) this.fmtShift(r); return this; }
    cell(r, c) { const row = this.rows[r - 1]; const v = row ? row[c - 1] : ""; return v == null ? "" : v; }
    set(r, c, v) {
      const textFmt = !!this.fmt[r + ":" + c] || !!this.fmt["col:" + c];
      while (this.rows.length < r) this.rows.push([]);
      const row = this.rows[r - 1]; while (row.length < c) row.push("");
      row[c - 1] = parseInput(v, textFmt);
    }
    getRange(r, c, nr = 1, nc = 1) { if (r < 1 || nr < 1 || r + nr - 1 > this.maxRows) throw new Error("range outside sheet " + this.name + " r=" + r + " nr=" + nr + " max=" + this.maxRows); return new Range(this, r, c, nr, nc); }
    getDataRange() { return this.getRange(1, 1, Math.max(1, this.getLastRow()), Math.max(1, this.getLastColumn())); }
    appendRow(vals) { this._w(); stats.appendRow++; const r = this.getLastRow() + 1; if (r > this.maxRows) this.maxRows = r; vals.forEach((v, i) => this.set(r, i + 1, v)); stats.charsWritten += vals.join("").length; return this; }
    deleteRow(r) { this._w(); stats.deleteRow++; if (this.maxRows - 1 <= this.frozen) throw new Error("cannot delete all non-frozen rows"); this.maxRows--; this.rows.splice(r - 1, 1); this.fmtShift(r); return this; }
    fmtShift(r) { const nf = {}; for (const k of Object.keys(this.fmt)) { if (k.startsWith("col:")) { nf[k] = 1; continue; } const [rr, cc] = k.split(":").map(Number); if (rr < r) nf[k] = 1; else if (rr > r) nf[(rr - 1) + ":" + cc] = 1; } this.fmt = nf; }
    setFrozenRows(n) { this.frozen = n; }
    getFrozenRows() { return this.frozen; }
    snapshot() { return JSON.stringify(this.rows); }
  }
  class Range {
    constructor(s, r, c, nr, nc) { Object.assign(this, { s, r, c, nr, nc }); }
    getValues() { stats.getValues++; const out = []; for (let i = 0; i < this.nr; i++) { const row = []; for (let j = 0; j < this.nc; j++) { const v = this.s.cell(this.r + i, this.c + j); if (typeof v === "string") stats.charsRead += v.length; row.push(v instanceof Date ? new Date(v.getTime()) : v); } out.push(row); } return out; }
    getValue() { stats.getValue++; const v = this.s.cell(this.r, this.c); if (typeof v === "string") stats.charsRead += v.length; return v; }
    setValues(vals) { this.s._w(); stats.setValues++; if (vals.length !== this.nr || vals[0].length !== this.nc) throw new Error("range size mismatch"); let ch = 0; vals.forEach((row, i) => row.forEach((v, j) => { this.s.set(this.r + i, this.c + j, v); ch += String(v).length; })); stats.charsWritten += ch; stats.maxSetValuesChars = Math.max(stats.maxSetValuesChars, ch); return this; }
    setValue(v) { this.s._w(); stats.setValue++; this.s.set(this.r, this.c, v); return this; }
    setNumberFormat(f) { for (let i = 0; i < Math.min(this.nr, 5000); i++) for (let j = 0; j < this.nc; j++) { if (f === "@") this.s.fmt[(this.r + i) + ":" + (this.c + j)] = 1; else delete this.s.fmt[(this.r + i) + ":" + (this.c + j)]; } return this; }
  }
  const sheets = {};
  const ss = {
    getSheetByName(n) { return sheets[n] || null; },
    insertSheet(n) { if (!sheets[n]) sheets[n] = new Sheet(n); return sheets[n]; },
  };
  return { ss, sheets, stats, lockState, parseInput, ERR };
}

function loadCode(file, book, lockOpts = {}) {
  const cache = {}; const props = {};
  let uuid = 0;
  const lock = {
    waitLock() { if (book.lockState.held && lockOpts.strictReentry) throw new Error("re-entrant waitLock"); book.lockState.held = true; },
    tryLock() { book.lockState.held = true; return true; },
    releaseLock() { book.lockState.held = false; },
    hasLock() { return book.lockState.held; },
  };
  const ctx = {
    SpreadsheetApp: { openById() { return book.ss; } },
    LockService: { getScriptLock() { return lock; } },
    CacheService: { getScriptCache() { return { get: k => cache[k] || null, put: (k, v) => { cache[k] = v; }, remove: k => { delete cache[k]; } }; } },
    PropertiesService: { getScriptProperties() { return { getProperty: k => props[k] == null ? null : props[k], setProperty: (k, v) => { props[k] = String(v); }, deleteProperty: k => { delete props[k]; } }; } },
    Utilities: { getUuid() { uuid++; return "00000000-0000-4000-8000-" + String(uuid).padStart(12, "0") + Math.random().toString(16).slice(2, 10); } },
    ContentService: { MimeType: { JSON: "json" }, createTextOutput(s) { return { setMimeType() { return this; }, getContent() { return s; } }; } },
    Object,
    JSON,
    Math,
    String,
    Number,
    Array,
    Date,
    isFinite,
    parseInt,
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(file, "utf8"), ctx, { filename: file });
  ctx.post = (body) => JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify(body) } }).getContent());
  return ctx;
}
module.exports = { makeBook, loadCode };
