import { queryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api, SeamFailure } from "@/services/api";
import { friendlyError } from "@/lib/document-labels";
import type { SpecCharacteristic } from "@/services/document-rules";
import { approveGate, type ReviewField } from "@/services/review-rules";

export const extractionQuery = (docId: string) =>
  queryOptions({
    queryKey: ["extraction", docId],
    queryFn: async () => (await api.getExtraction(docId)) as unknown as ReviewField[],
  });

export const specCharacteristicsQuery = queryOptions({
  queryKey: ["specifications", "characteristics"],
  queryFn: async () => {
    const specs = await api.listSpecifications();
    return Object.fromEntries(
      specs.map((s) => [s.code, ((s.definition ?? {}) as { specCharacteristic?: SpecCharacteristic[] }).specCharacteristic ?? []]),
    ) as Record<string, SpecCharacteristic[]>;
  },
});

/** Details to check and the approve gate for one document, computed from data. */
export function useReviewState(docId: string, documentType: string, versionId: string | null) {
  const fields = useQuery(extractionQuery(docId));
  const specs = useQuery(specCharacteristicsQuery);
  const current = (fields.data ?? []).filter((f) => !versionId || (f as ReviewField & { version_id?: string }).version_id === versionId);
  const gate = approveGate(specs.data?.[documentType] ?? [], current);
  return { fields: current, gate, isPending: fields.isPending || specs.isPending, isError: fields.isError || specs.isError, refetch: fields.refetch };
}

export function useReviewField(entityId: string, docId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { fieldId: string; decision: "accept" | "edit" | "reject"; value?: string }) =>
      api.reviewExtraction({ id: docId, fieldId: v.fieldId, decision: v.decision, ...(v.value !== undefined ? { value: v.value } : {}) }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["extraction", docId] });
      void qc.invalidateQueries({ queryKey: ["document", docId] });
      void qc.invalidateQueries({ queryKey: ["documents", { entityId }] });
    },
    onError: (e: unknown) => toast.error(friendlyError(e instanceof SeamFailure ? e.code : undefined)),
  });
}
