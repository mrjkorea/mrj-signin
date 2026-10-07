"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

function createGasContext() {
  const sheets = {};
  const scriptCache = {};
  const props = {};

  function colLetter(n) {
    let s = "";
    n++;
    while (n > 0) {
      const m = (n - 1) % 26;
      s = String.fromCharCode(65 + m) + s;
      n = Math.floor((n - 1) / 26);
    }
    return s;
  }

  class MockRange {
    constructor(sheet, r1, c1, r2, c2) {
      this.sheet = sheet;
      this.r1 = r1;
      this.c1 = c1;
      this.r2 = r2;
      this.c2 = c2;
    }
    getValues() {
      const out = [];
      for (let r = this.r1; r <= this.r2; r++) {
        const row = [];
        for (let c = this.c1; c <= this.c2; c++) {
          row.push(this.sheet.cell(r, c));
        }
        out.push(row);
      }
      return out;
    }
    setValues(values) {
      for (let i = 0; i < values.length; i++) {
        for (let j = 0; j < values[i].length; j++) {
          this.sheet.setCell(this.r1 + i, this.c1 + j, values[i][j]);
        }
      }
    }
    setValue(v) {
      this.sheet.setCell(this.r1, this.c1, v);
    }
    setNumberFormat() {}
    getValue() {
      return this.sheet.cell(this.r1, this.c1);
    }
  }

  class MockSheet {
    constructor(name) {
      this.name = name;
      this._cells = {};
      this._maxRow = 1;
      this._maxCol = 1;
    }
    cell(r, c) {
      const k = r + ":" + c;
      return this._cells[k] == null ? "" : this._cells[k];
    }
    setCell(r, c, v) {
      this._cells[r + ":" + c] = v;
      this._maxRow = Math.max(this._maxRow, r);
      this._maxCol = Math.max(this._maxCol, c);
    }
    getLastRow() {
      return this._maxRow;
    }
    getLastColumn() {
      return this._maxCol;
    }
    getMaxRows() {
      return 1000;
    }
    getRange(r1, c1, numRows, numCols) {
      return new MockRange(this, r1, c1, r1 + numRows - 1, c1 + numCols - 1);
    }
    getDataRange() {
      return this.getRange(1, 1, this._maxRow, this._maxCol);
    }
    getSheetByName() {
      return null;
    }
    insertSheet() {
      return this;
    }
    setFrozenRows() {}
    deleteRow(row) {
      const next = {};
      for (const k of Object.keys(this._cells)) {
        const [rs, cs] = k.split(":");
        const r = +rs;
        const c = +cs;
        if (r < row) next[k] = this._cells[k];
        else if (r > row) next[r - 1 + ":" + c] = this._cells[k];
      }
      this._cells = next;
      this._maxRow = Math.max(1, this._maxRow - 1);
    }
    appendRow(row) {
      const r = this._maxRow + 1;
      for (let c = 0; c < row.length; c++) this.setCell(r, c + 1, row[c]);
    }
  }

  function ensureSheet(name) {
    if (!sheets[name]) sheets[name] = new MockSheet(name);
    return sheets[name];
  }

  const ss = {
    getSheetByName(name) {
      return sheets[name] || null;
    },
    insertSheet(name) {
      return ensureSheet(name);
    }
  };

  const context = {
    sheets,
    ensureSheet,
    SpreadsheetApp: {
      openById() {
        return ss;
      }
    },
    LockService: {
      getScriptLock() {
        return {
          waitLock() {},
          tryLock() {
            return true;
          },
          releaseLock() {}
        };
      }
    },
    CacheService: {
      getScriptCache() {
        return {
          get(k) {
            return scriptCache[k];
          },
          put(k, v) {
            scriptCache[k] = v;
          },
          remove(k) {
            delete scriptCache[k];
          }
        };
      }
    },
    PropertiesService: {
      getScriptProperties() {
        return {
          getProperty(k) {
            return props[k];
          },
          setProperty(k, v) {
            props[k] = v;
          },
          deleteProperty(k) {
            delete props[k];
          }
        };
      }
    },
    Utilities: {
      getUuid() {
        return "00000000-0000-4000-8000-000000000001";
      }
    },
    ContentService: {
      MimeType: { JSON: "application/json" },
      createTextOutput(s) {
        return { setMimeType() {}, getContent() { return s; } };
      }
    },
    Object,
    JSON,
    Math,
    String,
    Number,
    Array,
    Date,
    isFinite,
    parseInt
  };

  const code = fs.readFileSync(path.join(__dirname, "..", "..", "Code.gs"), "utf8");
  vm.runInNewContext(code, context, { filename: "Code.gs", timeout: 10000 });
  return context;
}

module.exports = { createGasContext };
