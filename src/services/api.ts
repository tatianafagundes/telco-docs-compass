// The only door the screens use to reach the backend. One typed function per seam operation.
import type { SeamError, SeamResult } from "@/services/document-rules";
import * as reads from "@/services/document.functions";
import * as writes from "@/services/document-write.functions";

export class SeamFailure extends Error {
  readonly code: string;
  readonly category: SeamError["category"];
  readonly retryable: boolean;
  readonly customerKey: string;
  readonly detail: string | undefined;
  constructor(e: SeamError) {
    super(e.code);
    this.name = "SeamFailure";
    this.code = e.code;
    this.category = e.category;
    this.retryable = e.retryable;
    this.customerKey = e.customerFacing?.key ?? e.code;
    this.detail = e.customerFacing?.detail;
  }
}

function unwrap<T>(r: SeamResult<T>): T {
  if (!r.ok) throw new SeamFailure(r.error);
  return r.data;
}

/** "<uuid>:document.<operation>" – a fresh key per user action; reuse it only to retry that same action. */
export function newIdempotencyKey(op: string): string {
  return `${crypto.randomUUID()}:document.${op}`;
}

type WithoutKey<T> = Omit<T, "idempotencyKey"> & { idempotencyKey?: string };
type InputOf<F> = F extends (opts: { data: infer D }) => unknown ? D : never;

async function write<F extends (opts: { data: never }) => Promise<SeamResult<unknown>>>(
  fn: F,
  op: string,
  input: WithoutKey<InputOf<F>>,
): Promise<Awaited<ReturnType<F>> extends SeamResult<infer T> ? T : never> {
  const data = { ...input, idempotencyKey: input.idempotencyKey ?? newIdempotencyKey(op) };
  const res = await (fn as unknown as (o: { data: unknown }) => Promise<SeamResult<unknown>>)({ data });
  return unwrap(res) as Awaited<ReturnType<F>> extends SeamResult<infer T> ? T : never;
}

export const api = {
  // reads
  me: () => reads.getMe(),
  listEntities: () => reads.listEntities(),
  find: async (input: InputOf<typeof writes.find>) => unwrap(await writes.find({ data: input })),
  get: (id: string) => reads.get({ data: { id } }),
  listVersions: (id: string) => reads.listVersions({ data: { id } }),
  getExtraction: (id: string) => reads.getExtraction({ data: { id } }),
  listSpecifications: () => reads.listSpecifications(),
  getTenantPolicy: () => reads.getTenantPolicy(),
  getContentUrl: async (id: string, purpose: "preview" | "download") =>
    unwrap(await writes.getContentUrl({ data: { id, purpose } })),
  listAccess: async (id: string) => unwrap(await writes.listAccess({ data: { id } })),
  recordAccess: (id: string, action: "view" | "download", versionId?: string) =>
    reads.recordAccess({ data: { id, action, ...(versionId ? { versionId } : {}) } }),
  // writes
  register: (input: WithoutKey<InputOf<typeof writes.register>>) => write(writes.register, "register", input),
  updateMetadata: (input: WithoutKey<InputOf<typeof writes.updateMetadata>>) => write(writes.updateMetadata, "updateMetadata", input),
  addVersion: (input: WithoutKey<InputOf<typeof writes.addVersion>>) => write(writes.addVersion, "addVersion", input),
  transition: (input: WithoutKey<InputOf<typeof writes.transition>>) => write(writes.transition, "transition", input),
  setHold: (input: WithoutKey<InputOf<typeof writes.setHold>>) => write(writes.setHold, "setHold", input),
  delete: (input: WithoutKey<InputOf<typeof writes.deleteDocument>>) => write(writes.deleteDocument, "delete", input),
  restoreDeleted: (input: WithoutKey<InputOf<typeof writes.restoreDeleted>>) => write(writes.restoreDeleted, "restoreDeleted", input),
  reportProblem: (input: WithoutKey<InputOf<typeof writes.reportProblem>>) => write(writes.reportProblem, "reportProblem", input),
  grantAccess: (input: WithoutKey<InputOf<typeof writes.grantAccess>>) => write(writes.grantAccess, "grantAccess", input),
  revokeAccess: (input: WithoutKey<InputOf<typeof writes.revokeAccess>>) => write(writes.revokeAccess, "revokeAccess", input),
  reviewExtraction: (input: WithoutKey<InputOf<typeof writes.reviewExtraction>>) =>
    write(writes.reviewExtraction, "reviewExtraction", input),
};
