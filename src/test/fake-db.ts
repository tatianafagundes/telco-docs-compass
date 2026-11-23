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
  code?: string;
}

export interface DbAnswer {
  data: unknown;
  error: DbError | null;
  /** Rows that matched before paging, only when the query asked for `count`. */
  count?: number;
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

/** One call made to the storage stub. */
export interface StorageCall {
  bucket: string;
  op: "upload" | "createSignedUploadUrl" | "createSignedUrl" | "remove";
  path: string;
  bytes?: Uint8Array;
  contentType?: string;
}

export class FakeDb {
  /** Tables whose rows get a generated `id` on insert when none is given, like a uuid default in the database. */
  readonly autoIdTables = new Set<string>();
  /** Tables whose rows get `created_at = now` on insert, like a `default now()` column. */
  /** Tables with a unique key (column lists), like a primary key. An insert that repeats one fails with code 23505. */
  readonly uniqueKeys = new Map<string, string[]>([
    ["idempotency_keys", ["tenant_id", "actor", "key", "operation"]],
  ]);
  readonly autoCreatedAtTables = new Set<string>(["idempotency_keys"]);
  /** Every call to `storage.from(bucket)`, in order. */
  readonly storageCalls: StorageCall[] = [];
  private storageFailures = new Set<StorageCall["op"]>();
  private storageThrows = new Set<StorageCall["op"]>();
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
  /** Undo every `fail`, to test a retry after a failure. */
  clearFailures(): this {
    this.failures.clear();
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

  /** Give rows inserted into these tables a generated id, as the database default would. */
  withAutoId(...tables: string[]): this {
    for (const t of tables) this.autoIdTables.add(t);
    return this;
  }

  /** Make one storage operation answer an error (`data: null`), the way supabase-js does. */
  failStorage(op: StorageCall["op"]): this {
    this.storageFailures.add(op);
    return this;
  }

  /** Make one storage operation throw, like a dropped connection (supabase-js usually returns errors instead). */
  throwStorage(op: StorageCall["op"]): this {
    this.storageThrows.add(op);
    return this;
  }

  /** Undo every `failStorage`, to test a retry after a failure. */
  clearStorageFailures(): this {
    this.storageFailures.clear();
    this.storageThrows.clear();
    return this;
  }

  /** Stand-in for `client.storage`: records the call and answers a fake signed address. */
  get storage() {
    const answer = (bucket: string, op: StorageCall["op"], path: string, extra: object = {}) => {
      this.storageCalls.push({ bucket, op, path, ...extra });
      if (this.storageThrows.has(op)) return Promise.reject(new Error("connection reset"));
      if (this.storageFailures.has(op))
        return Promise.resolve({ data: null, error: { message: `forced storage ${op} failure` } });
      const data =
        op === "createSignedUrl" || op === "createSignedUploadUrl"
          ? { signedUrl: `https://storage.example/${bucket}/${path}?token=t`, path, token: "t" }
          : { path };
      return Promise.resolve({ data, error: null });
    };
    return {
      from: (bucket: string) => ({
        upload: (path: string, bytes: Uint8Array, o?: { contentType?: string }) =>
          answer(bucket, "upload", path, { bytes, contentType: o?.contentType }),
        createSignedUploadUrl: (path: string) => answer(bucket, "createSignedUploadUrl", path),
        createSignedUrl: (path: string) => answer(bucket, "createSignedUrl", path),
        remove: (paths: string[]) => answer(bucket, "remove", paths.join(",")),
      }),
    };
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

class QueryBuilder implements PromiseLike<DbAnswer> {
  private op: Op = "select";
  private columns: string | null = null;
  private payload: Row[] = [];
  private patch: Row = {};
  private filters: Filter[] = [];
  private sort: { column: string; ascending: boolean } | null = null;
  private max: number | null = null;
  private cardinality: "many" | "maybe" | "one" = "many";
  private upsertOn: string[] = [];
  private ignoreDuplicates = false;
  private returning = false;
  private wantCount = false;
  private window: [number, number] | null = null;

  constructor(
    private readonly db: FakeDb,
    private readonly table: string,
  ) {}

  select(columns = "*", opts: { count?: "exact" } = {}) {
    if (opts.count) this.wantCount = true;
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
  gt(column: string, value: string | number) {
    this.filters.push((r) => {
      const v = pathValue(r, column);
      return v !== undefined && v !== null && (v as string | number) > value;
    });
    return this;
  }
  gte(column: string, value: string | number) {
    this.filters.push((r) => {
      const v = pathValue(r, column);
      return v !== undefined && v !== null && (v as string | number) >= value;
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
  /** Rows `from` to `to`, both included, as in supabase-js. */
  range(from: number, to: number) {
    this.window = [from, to];
    return this;
  }
  /** Only the "cs" (contains) operator, on a column holding a JSON array of objects. */
  filter(column: string, op: string, value: string) {
    if (op !== "cs") throw new Error(`FakeDb: filter operator ${op} is not supported`);
    this.filters.push((r) => {
      const have = pathValue(r, column);
      const wanted = JSON.parse(value) as Row | Row[];
      if (!Array.isArray(wanted))
        // An object contains another when every key of the other matches (jsonb `@>`).
        return (
          typeof have === "object" &&
          have !== null &&
          !Array.isArray(have) &&
          Object.entries(wanted).every(([k, v]) => (have as Row)[k] === v)
        );
      return (
        Array.isArray(have) &&
        wanted.every((w) =>
          have.some((h) => Object.entries(w).every(([k, v]) => (h as Row)[k] === v)),
        )
      );
    });
    return this;
  }
  limit(n: number) {
    this.max = n;
    return this;
  }
  maybeSingle() {
    this.cardinality = "maybe";
    return this;
  }
  /** Like maybeSingle, but no row (or more than one) is an error, as in supabase-js. */
  single() {
    this.cardinality = "one";
    return this;
  }

  then<R1 = DbAnswer, R2 = never>(
    onfulfilled?: ((v: DbAnswer) => R1 | PromiseLike<R1>) | null,
    onrejected?: ((reason: unknown) => R2 | PromiseLike<R2>) | null,
  ): PromiseLike<R1 | R2> {
    return Promise.resolve()
      .then(() => this.run())
      .then(onfulfilled, onrejected);
  }

  private matching(): Row[] {
    return this.db.rows(this.table).filter((r) => this.filters.every((f) => f(r)));
  }

  private run(): DbAnswer {
    const error = this.db.failureFor(this.table, this.op);
    if (error) return { data: null, error };
    const rows = this.db.rows(this.table);

    if (this.op === "insert") {
      const added: Row[] = this.payload.map((r) => ({
        ...r,
        ...(this.db.autoIdTables.has(this.table) && r["id"] === undefined
          ? { id: crypto.randomUUID() }
          : {}),
        ...(this.db.autoCreatedAtTables.has(this.table) && r["created_at"] === undefined
          ? { created_at: new Date().toISOString() }
          : {}),
      }));
      const unique = this.db.uniqueKeys.get(this.table);
      if (unique) {
        const seen: Row[] = [...rows];
        for (const r of added) {
          if (seen.some((e) => unique.every((c) => e[c] === r[c])))
            return { data: null, error: { message: "duplicate key value", code: "23505" } };
          seen.push(r);
        }
      }
      rows.push(...added);
      this.db.writes.push({ table: this.table, op: "insert", rows: added });
      return this.answer(this.returning ? added : null);
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
      return this.answer(this.returning ? hit : null);
    }
    if (this.op === "delete") {
      const hit = new Set(this.matching());
      this.db.tables[this.table] = rows.filter((r) => !hit.has(r));
      this.db.writes.push({ table: this.table, op: "delete", rows: [...hit] });
      return this.answer(this.returning ? [...hit] : null);
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
    const total = out.length;
    if (this.window) out = out.slice(this.window[0], this.window[1] + 1);
    if (this.max !== null) out = out.slice(0, this.max);
    return this.answer(out, this.wantCount ? total : undefined);
  }

  /** Shapes the rows like supabase-js: all of them, one or none, or exactly one. */
  private answer(rows: Row[] | null, count?: number): DbAnswer {
    if (rows === null) return { data: null, error: null };
    const withCount = (a: DbAnswer): DbAnswer => (count === undefined ? a : { ...a, count });
    const projected = rows.map((r) => project(r, this.columns));
    if (this.cardinality === "maybe") return withCount({ data: projected[0] ?? null, error: null });
    if (this.cardinality === "one") {
      return projected.length === 1
        ? { data: projected[0], error: null }
        : { data: null, error: { message: `expected one row, got ${projected.length}` } };
    }
    return withCount({ data: projected, error: null });
  }
}
