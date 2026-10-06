import { DatabaseSync } from 'node:sqlite';

export function createInstrumentedDatabase(path) {
  const db = new DatabaseSync(path);
  const statements = [];
  const distinct = new Set();
  let fullScans = 0;

  // Capture originals before wrapping.
  const origPrepare = db.prepare.bind(db);
  const origExec = db.exec.bind(db);

  function record(sql) {
    statements.push(sql);
    distinct.add(sql);
  }

  function countFullScan(sql) {
    try {
      const plan = origPrepare(`EXPLAIN QUERY PLAN ${sql}`).all();
      const detail = plan.map((row) => String(row.detail).toLowerCase());
      if (detail.some((d) => d.includes('scan')) && !detail.some((d) => d.includes('using index'))) {
        fullScans += 1;
      }
    } catch {
      // ignore explain failures
    }
  }

  db.prepare = function instrumentedPrepare(sql, ...rest) {
    record(sql);
    countFullScan(sql);
    const stmt = origPrepare(sql, ...rest);
    const origAll = stmt.all.bind(stmt);
    const origGet = stmt.get.bind(stmt);
    const origRun = stmt.run.bind(stmt);
    stmt.all = function all(...args) {
      record(sql);
      return origAll(...args);
    };
    stmt.get = function get(...args) {
      record(sql);
      return origGet(...args);
    };
    stmt.run = function run(...args) {
      record(sql);
      return origRun(...args);
    };
    return stmt;
  };

  db.exec = function instrumentedExec(sql, ...rest) {
    record(sql);
    return origExec(sql, ...rest);
  };

  return {
    db,
    metrics() {
      return {
        statements: statements.length,
        distinct_statements: distinct.size,
        full_scans: fullScans,
      };
    },
    reset() {
      statements.length = 0;
      distinct.clear();
      fullScans = 0;
    },
    close() {
      db.close();
    },
  };
}
