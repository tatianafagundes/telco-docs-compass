// The only door the screens use to reach the backend. One typed function per seam operation.
import type { SeamError, SeamResult } from "@/services/document-rules";
import * as reads from "@/services/document.functions";
import * as writes from "@/services/document-write.functions";
import * as config from "@/services/tenant-config.functions";
import * as retention from "@/services/retention.functions";
import * as pipeline from "@/services/pipeline.functions";
import { supabase } from "@/integrations/supabase/client";

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

type WithoutKey<D> = Omit<D, "idempotencyKey"> & { idempotencyKey?: string };

async function write<D extends { idempotencyKey: string }, T>(
  fn: (opts: { data: D }) => Promise<SeamResult<T>>,
  op: string,
  input: WithoutKey<D>,
): Promise<T> {
  const data = { ...input, idempotencyKey: input.idempotencyKey ?? newIdempotencyKey(op) } as D;
  return unwrap(await fn({ data }));
}

type FindInput = Parameters<typeof writes.find>[0]["data"];

export const api = {
  // reads
  me: () => reads.getMe(),
  listEntities: () => reads.listEntities(),
  find: async (input: FindInput) => unwrap(await writes.find({ data: input })),
  get: (id: string) => reads.get({ data: { id } }),
  listVersions: (id: string) => reads.listVersions({ data: { id } }),
  listActivity: (id: string) => reads.listActivity({ data: { id } }),
  getExtraction: (id: string) => reads.getExtraction({ data: { id } }),
  searchPeople: (query: string) => reads.searchPeople({ data: { query } }),
  listSpecifications: () => reads.listSpecifications(),
  getTenantPolicy: () => reads.getTenantPolicy(),
  getContentUrl: async (id: string, purpose: "preview" | "download") =>
    unwrap(await writes.getContentUrl({ data: { id, purpose } })),
  listAccess: async (id: string) => unwrap(await writes.listAccess({ data: { id } })),
  recordAccess: (id: string, action: "view" | "download", versionId?: string) =>
    reads.recordAccess({ data: { id, action, ...(versionId ? { versionId } : {}) } }),
  // writes (idempotency key generated here unless the caller retries with its own)
  register: (i: WithoutKey<Parameters<typeof writes.register>[0]["data"]>) => write(writes.register, "register", i),
  updateMetadata: (i: WithoutKey<Parameters<typeof writes.updateMetadata>[0]["data"]>) => write(writes.updateMetadata, "updateMetadata", i),
  addVersion: (i: WithoutKey<Parameters<typeof writes.addVersion>[0]["data"]>) => write(writes.addVersion, "addVersion", i),
  transition: (i: WithoutKey<Parameters<typeof writes.transition>[0]["data"]>) => write(writes.transition, "transition", i),
  setHold: (i: WithoutKey<Parameters<typeof writes.setHold>[0]["data"]>) => write(writes.setHold, "setHold", i),
  delete: (i: WithoutKey<Parameters<typeof writes.deleteDocument>[0]["data"]>) => write(writes.deleteDocument, "delete", i),
  restoreDeleted: (i: WithoutKey<Parameters<typeof writes.restoreDeleted>[0]["data"]>) => write(writes.restoreDeleted, "restoreDeleted", i),
  reportProblem: (i: WithoutKey<Parameters<typeof writes.reportProblem>[0]["data"]>) => write(writes.reportProblem, "reportProblem", i),
  grantAccess: (i: WithoutKey<Parameters<typeof writes.grantAccess>[0]["data"]>) => write(writes.grantAccess, "grantAccess", i),
  revokeAccess: (i: WithoutKey<Parameters<typeof writes.revokeAccess>[0]["data"]>) => write(writes.revokeAccess, "revokeAccess", i),
  reviewExtraction: (i: WithoutKey<Parameters<typeof writes.reviewExtraction>[0]["data"]>) => write(writes.reviewExtraction, "reviewExtraction", i),
  // holds and retention
  listHolds: async (page: number) => unwrap(await retention.listHolds({ data: { page } })),
  retentionOverview: async () => unwrap(await retention.retentionOverview()),
  deletionHistory: async () => unwrap(await retention.deletionHistory()),
  verifyHolds: async () => unwrap(await retention.verifyHolds()),
  retentionFor: async (id: string) => unwrap(await retention.retentionFor({ data: { id } })),
  purge: (i: WithoutKey<Parameters<typeof retention.purgeDocument>[0]["data"]>) => write(retention.purgeDocument, "purge", i),
  // shared configuration (group and countries)
  getConfig: async () => unwrap(await config.getConfig()),
  listChildTenants: async () => unwrap(await config.listChildTenants()),
  getChildView: async (tenantId: string) => unwrap(await config.getChildView({ data: { tenantId } })),
  specUsage: async (code: string) => unwrap(await config.specUsage({ data: { code } })),
  saveSpecification: (i: WithoutKey<Parameters<typeof config.saveSpecification>[0]["data"]>) =>
    write(config.saveSpecification, "config.saveSpecification", i),
  resetSpecification: (i: WithoutKey<Parameters<typeof config.resetSpecification>[0]["data"]>) =>
    write(config.resetSpecification, "config.resetSpecification", i),
  // adding documents (simulated pipeline) and the usability-test reset
  advancePipeline: (i: WithoutKey<Parameters<typeof pipeline.advancePipeline>[0]["data"]>) =>
    write(pipeline.advancePipeline, "advancePipeline", i),
  /** Sends the file bytes with the one-time ticket from register(). */
  uploadContent: async (storagePath: string, token: string, file: File) => {
    const { error } = await supabase.storage.from("documents").uploadToSignedUrl(storagePath, token, file, { contentType: file.type });
    if (error) throw new SeamFailure({ code: "upload.failed", category: "unavailable", retryable: true });
  },
  resetTestData: async () => unwrap(await pipeline.resetTestData()),
};
