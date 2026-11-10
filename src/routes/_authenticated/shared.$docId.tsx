import { createFileRoute, Link } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { z } from "zod";
import { DocumentPanel } from "@/components/documents/document-panel";
import { meQuery } from "@/hooks/use-me";
import { sharedOnlyRole } from "@/services/document-actions";
import type { AppRole } from "@/services/document-rules";

export const Route = createFileRoute("/_authenticated/shared/$docId")({
  // The level only narrows what the screen offers; the server checks every action itself.
  validateSearch: z.object({ level: z.enum(["view", "edit"]).catch("view") }),
  head: () => ({
    meta: [
      { title: "Shared document · Documents" },
      { name: "description", content: "A document shared with you directly." },
      { property: "og:title", content: "Shared document · Documents" },
      { property: "og:description", content: "A document shared with you directly." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  loader: ({ context }) => context.queryClient.ensureQueryData(meQuery),
  component: SharedDocumentPage,
});

function SharedDocumentPage() {
  const { docId } = Route.useParams();
  const { level } = Route.useSearch();
  const { data: me } = useSuspenseQuery(meQuery);
  const role = sharedOnlyRole((me.access?.role ?? "viewer") as AppRole, level);
  return (
    <div className="flex max-w-[720px] flex-col gap-4">
      <Link to="/shared" className="focus-ring type-label-12 self-start underline">Back to Shared with me</Link>
      <DocumentPanel id={docId} entityId={null} role={role} />
    </div>
  );
}
