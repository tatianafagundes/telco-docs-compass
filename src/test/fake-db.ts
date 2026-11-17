// In-memory stand-in for the Supabase client, used by service tests that must run offline.
//
// What it does: tables as arrays of rows, the chainable query builder the services use
// (select/insert/update/upsert/delete + eq/in/is/lt/match/order/limit/maybeSingle/single),
// programmable rpc() answers, and programmable errors per table and operation.
// What it does NOT do: row-level security, SQL functions, triggers, column types or constraints.
// A passing test here proves the application's own checks, not what the database enforces.
// Anything the fake does not support throws, so a test never passes by silently ignoring a call.
import type { Db } from "@/services/seam-runtime";

export type Row = Record<string, unknown>;
type Op = "select" | "insert" | "update" | "upsert" | "delete";
type Filter = (row: Row) => boolean;
type RpcHandler = (args: Record<string, unknown>) => unknown;

export interface WriteLogEntry {
  table: string;
  op: Exclude<Op, "select">;
  rows: Row[];
}

export interface DbError {
  message: string;
}

/** Reads `a.b` from nested objects, so embedded joins like `integration_clients.revoked_at` work. */
function pathValue(row: Row, path: string): unknown {
  let cur: unknown = row;
  for (const part of path.split(".")) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Row)[part];
  }
  return cur;
}

/** Top-level column names of a PostgREST select string; joins like `a!inner(b)` keep their key `a`. */
function selectedKeys(columns: string): string[] | null {
  const keys: string[] = [];
  let depth = 0;
  let token = "";
  const flush = () => {
    const name = token.trim().split(/[!(:]/)[0]?.trim();
    if (name) keys.push(name);
    token = "";
  };
  for (const ch of columns) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) flush();
    else token += ch;
  }
  flush();
  return keys.includes("*") ? null : keys;
}

function project(row: Row, columns: string | null): Row {
  const keys = columns ? selectedKeys(columns) : null;
  if (!keys) return { ...row };
  const out: Row = {};
  for (const k of keys) if (k in row) out[k] = row[k];
  return out;
}

export class FakeDb {
  readonly tables: Record<string, Row[]> = {};
  /** Every insert, update, upsert and delete, in order. Tests assert on this. */
  readonly writes: WriteLogEntry[] = [];
  private rpcs: Record<string, RpcHandler> = {};
  private staleReads = new Map<string, Row[]>();
  private writeHooks: { key: string; fn: () => void }[] = [];
  private failures = new Map<string, DbError>();

  constructor(seed: Record<string, Row[]> = {}) {
    for (const [name, rows] of Object.entries(seed))
      this.tables[name] = rows.map((r) => ({ ...r }));
  }

  /** Answer `rpc(name)` with a fixed value or a function of its arguments. */
  onRpc(name: string, answer: unknown | RpcHandler): this {
    this.rpcs[name] = typeof answer === "function" ? (answer as RpcHandler) : () => answer;
    return this;
  }

  /** Make every `op` on `table` return `{ data: null, error }`, the way supabase-js does (it never throws). */
  fail(table: string, op: Op, message = "forced failure"): this {
    this.failures.set(`${table}:${op}`, { message });
    return this;
  }

  /**
   * The next select on `table` returns `rows` instead of the current data, once. Use it to replay
   * what a slow second processor would have read before another one changed the row.
   */
  stubNextSelect(table: string, rows: Row[]): this {
    this.staleReads.set(
      table,
      rows.map((r) => ({ ...r })),
    );
    return this;
  }

  /** Runs `fn` right after the next `op` on `table` is applied, to simulate something else happening mid-flow. */
  onWrite(table: string, op: WriteLogEntry["op"], fn: () => void): this {
    this.writeHooks.push({ key: `${table}:${op}`, fn });
    return this;
  }

  takeStale(table: string): Row[] | undefined {
    const rows = this.staleReads.get(table);
    this.staleReads.delete(table);
    return rows;
  }

  fireWriteHook(table: string, op: WriteLogEntry["op"]): void {
    const i = this.writeHooks.findIndex((h) => h.key === `${table}:${op}`);
    if (i >= 0) this.writeHooks.splice(i, 1)[0]?.fn();
  }

  rows(table: string): Row[] {
    return (this.tables[table] ??= []);
  }

  writesTo(table: string, op?: WriteLogEntry["op"]): WriteLogEntry[] {
    return this.writes.filter((w) => w.table === table && (!op || w.op === op));
  }

  /** The object services receive as `Db`. */
  asDb(): Db {
    return this as unknown as Db;
  }

  from(table: string): QueryBuilder {
    return new QueryBuilder(this, table);
  }

  rpc(
    name: string,
    args: Record<string, unknown> = {},
  ): Promise<{ data: unknown; error: DbError | null }> {
    const handler = this.rpcs[name];
    if (!handler) {
      return Promise.resolve({
        data: null,
        error: { message: `FakeDb: no answer set for rpc ${name}` },
      });
    }
    return Promise.resolve({ data: handler(args), error: null });
  }

  failureFor(table: string, op: Op): DbError | undefined {
    return this.failures.get(`${table}:${op}`);
  }
}

class QueryBuilder implements PromiseLike<{ data: unknown; error: DbError | null }> {
  private op: Op = "select";
  private columns: string | null = null;
  private payload: Row[] = [];
  private patch: Row = {};
  private filters: Filter[] = [];
  private sort: { column: string; ascending: boolean } | null = null;
  private max: number | null = null;
  private single: "none" | "maybe" | "one" = "none";
  private upsertOn: string[] = [];
  private ignoreDuplicates = false;
  private returning = false;

  constructor(
    private readonly db: FakeDb,
    private readonly table: string,
  ) {}

  select(columns = "*") {
    if (this.op === "select") this.columns = columns;
    else {
      this.returning = true;
      this.columns = columns;
    }
    return this;
  }
  insert(rows: Row | Row[]) {
    this.op = "insert";
    this.payload = Array.isArray(rows) ? rows : [rows];
    return this;
  }
  update(patch: Row) {
    this.op = "update";
    this.patch = patch;
    return this;
  }
  upsert(rows: Row | Row[], opts: { onConflict?: string; ignoreDuplicates?: boolean } = {}) {
    this.op = "upsert";
    this.payload = Array.isArray(rows) ? rows : [rows];
    this.upsertOn = (opts.onConflict ?? "id").split(",").map((c) => c.trim());
    this.ignoreDuplicates = opts.ignoreDuplicates ?? false;
    return this;
  }
  delete() {
    this.op = "delete";
    return this;
  }
  eq(column: string, value: unknown) {
    this.filters.push((r) => pathValue(r, column) === value);
    return this;
  }
  in(column: string, values: unknown[]) {
    this.filters.push((r) => values.includes(pathValue(r, column)));
    return this;
  }
  is(column: string, value: null | boolean) {
    this.filters.push((r) => {
      const v = pathValue(r, column);
      return value === null ? v === null || v === undefined : v === value;
    });
    return this;
  }
  lt(column: string, value: string | number) {
    this.filters.push((r) => {
      const v = pathValue(r, column);
      return v !== undefined && v !== null && (v as string | number) < value;
    });
    return this;
  }
  match(query: Row) {
    for (const [k, v] of Object.entries(query)) this.eq(k, v);
    return this;
  }
  order(column: string, opts: { ascending?: boolean } = {}) {
    this.sort = { column, ascending: opts.ascending ?? true };
    return this;
  }
  limit(n: number) {
    this.max = n;
    return this;
  }
  maybeSingle() {
    this.single = "maybe";
    return this;
  }

  then<R1 = { data: unknown; error: DbError | null }, R2 = never>(
    onfulfilled?: ((v: { data: unknown; error: DbError | null }) => R1 | PromiseLike<R1>) | null,
    onrejected?: ((reason: unknown) => R2 | PromiseLike<R2>) | null,
  ): PromiseLike<R1 | R2> {
    return Promise.resolve()
      .then(() => this.run())
      .then(onfulfilled, onrejected);
  }

  private matching(): Row[] {
    return this.db.rows(this.table).filter((r) => this.filters.every((f) => f(r)));
  }

  private run(): { data: unknown; error: DbError | null } {
    const error = this.db.failureFor(this.table, this.op);
    if (error) return { data: null, error };
    const rows = this.db.rows(this.table);

    if (this.op === "insert") {
      const added = this.payload.map((r) => ({ ...r }));
      rows.push(...added);
      this.db.writes.push({ table: this.table, op: "insert", rows: added });
      return {
        data: this.returning ? added.map((r) => project(r, this.columns)) : null,
        error: null,
      };
    }
    if (this.op === "upsert") {
      const added: Row[] = [];
      for (const r of this.payload) {
        const same = rows.find((e) => this.upsertOn.every((c) => e[c] === r[c]));
        if (same) {
          if (!this.ignoreDuplicates) Object.assign(same, r);
        } else {
          const copy = { ...r };
          rows.push(copy);
          added.push(copy);
        }
      }
      this.db.writes.push({ table: this.table, op: "upsert", rows: added });
      return { data: null, error: null };
    }
    if (this.op === "update") {
      const hit = this.matching();
      for (const r of hit) Object.assign(r, this.patch);
      this.db.writes.push({ table: this.table, op: "update", rows: hit.map((r) => ({ ...r })) });
      this.db.fireWriteHook(this.table, "update");
      return {
        data: this.returning ? hit.map((r) => project(r, this.columns)) : null,
        error: null,
      };
    }
    if (this.op === "delete") {
      const hit = new Set(this.matching());
      this.db.tables[this.table] = rows.filter((r) => !hit.has(r));
      this.db.writes.push({ table: this.table, op: "delete", rows: [...hit] });
      return { data: null, error: null };
    }

    const stale = this.db.takeStale(this.table);
    let out = (stale ?? this.matching())
      .filter((r) => this.filters.every((f) => f(r)))
      .map((r) => ({ ...r }));
    if (this.sort) {
      const { column, ascending } = this.sort;
      out.sort((a, b) => {
        const x = pathValue(a, column) as string | number;
        const y = pathValue(b, column) as string | number;
        return (x < y ? -1 : x > y ? 1 : 0) * (ascending ? 1 : -1);
      });
    }
    if (this.max !== null) out = out.slice(0, this.max);
    const projected = out.map((r) => project(r, this.columns));
    if (this.single === "maybe") return { data: projected[0] ?? null, error: null };
    return { data: projected, error: null };
  }
}
