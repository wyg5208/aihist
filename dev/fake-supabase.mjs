/**
 * Minimal in-memory stand-in for the Supabase query builder. It implements only
 * the operators used by functions/lib/db.mjs so the real handler and pipeline
 * can run under Node without credentials.
 */
class Query {
  constructor(tables, name) {
    this.tables = tables;
    this.name = name;
    this.mode = "select";
    this.filters = [];
    this.orders = [];
    this.max = null;
    this.countMode = null;
    this.single = null;
    this.payload = null;
    this.options = {};
  }

  rows() {
    if (!this.tables[this.name]) this.tables[this.name] = [];
    return this.tables[this.name];
  }

  select(_columns, options) {
    if (this.mode === "select") this.countMode = options?.count || null;
    return this;
  }

  insert(rows) {
    this.mode = "insert";
    this.payload = Array.isArray(rows) ? rows : [rows];
    return this;
  }

  upsert(rows, options) {
    this.mode = "upsert";
    this.payload = Array.isArray(rows) ? rows : [rows];
    this.options = options || {};
    return this;
  }

  update(patch) {
    this.mode = "update";
    this.payload = patch;
    return this;
  }

  eq(column, value) {
    this.filters.push((row) => row[column] === value);
    return this;
  }

  neq(column, value) {
    this.filters.push((row) => row[column] !== value);
    return this;
  }

  is(column, value) {
    this.filters.push((row) => (row[column] ?? null) === (value ?? null));
    return this;
  }

  /**
   * Supports the small PostgREST subset used by the Function:
   * `col.is.null` and `col.eq.value`, joined by commas (OR).
   */
  or(expression) {
    const clauses = String(expression)
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const [column, operator, ...rest] = part.split(".");
        let value = rest.join(".");
        try {
          value = decodeURIComponent(value);
        } catch {
          /* keep the raw value */
        }
        if (operator === "is" && value === "null") {
          return (row) => (row[column] ?? null) === null;
        }
        if (operator === "eq") return (row) => String(row[column] ?? "") === value;
        if (operator === "neq") return (row) => String(row[column] ?? "") !== value;
        return () => false;
      });
    this.filters.push((row) => clauses.some((clause) => clause(row)));
    return this;
  }

  in(column, values) {
    // Mirror the hosted gateway: long inlined filter lists fail before the
    // request reaches PostgREST. Keep this stricter than the real 2 KB cap so
    // a regression shows up in offline checks.
    if (values.join(",").length > 900) {
      const error = new Error("URI too long");
      error.code = "URI_TOO_LONG";
      throw error;
    }
    const allowed = new Set(values);
    this.filters.push((row) => allowed.has(row[column]));
    return this;
  }

  gte(column, value) {
    this.filters.push((row) => String(row[column] ?? "") >= String(value));
    return this;
  }

  order(column, { ascending = true } = {}) {
    this.orders.push([column, ascending]);
    return this;
  }

  limit(value) {
    this.max = value;
    return this;
  }

  maybeSingle() {
    this.single = "maybe";
    return this;
  }

  then(resolve, reject) {
    try {
      resolve(this.exec());
    } catch (error) {
      reject(error);
    }
  }

  match(row) {
    return this.filters.every((filter) => filter(row));
  }

  exec() {
    const rows = this.rows();

    if (this.mode === "insert") {
      for (const row of this.payload) {
        if (row.id && rows.some((existing) => existing.id === row.id)) {
          throw Object.assign(new Error("duplicate key"), { code: "23505" });
        }
        if (row.fingerprint && rows.some((existing) => existing.fingerprint === row.fingerprint)) {
          throw Object.assign(new Error("duplicate key"), { code: "23505" });
        }
        rows.push({ ...row });
      }
      return { data: rows, error: null, count: null };
    }

    if (this.mode === "upsert") {
      const conflict = this.options.onConflict || "id";
      const inserted = [];
      for (const row of this.payload) {
        const index = rows.findIndex((existing) => existing[conflict] === row[conflict]);
        if (index !== -1) {
          if (this.options.ignoreDuplicates) continue;
          rows[index] = { ...rows[index], ...row };
          inserted.push(rows[index]);
        } else {
          rows.push({ ...row });
          inserted.push({ ...row });
        }
      }
      return { data: inserted, error: null, count: null };
    }

    if (this.mode === "update") {
      const updated = [];
      for (const row of rows) {
        if (!this.match(row)) continue;
        Object.assign(row, this.payload);
        updated.push({ ...row });
      }
      return { data: updated, error: null, count: null };
    }

    let matched = rows.filter((row) => this.match(row));
    const total = matched.length;
    for (const [column, ascending] of [...this.orders].reverse()) {
      matched = matched.sort((a, b) => {
        const left = a[column];
        const right = b[column];
        if (typeof left === "number" && typeof right === "number") {
          return ascending ? left - right : right - left;
        }
        const order = String(left ?? "").localeCompare(String(right ?? ""));
        return ascending ? order : -order;
      });
    }
    if (this.max != null) matched = matched.slice(0, this.max);
    if (this.single === "maybe") {
      return { data: matched[0] || null, error: null, count: this.countMode ? total : null };
    }
    return {
      data: matched,
      error: null,
      count: this.countMode === "exact" ? total : null,
    };
  }
}

export function createFakeSupabase(seed = {}) {
  const tables = {
    events: [],
    raw_items: [],
    sync_runs: [],
    sync_state: [],
    review_decisions: [],
    ...seed,
  };
  return {
    tables,
    from(name) {
      return new Query(tables, name);
    },
  };
}
