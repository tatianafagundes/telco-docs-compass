import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { accessQuery, entitiesQuery } from "@/hooks/use-access";
import { meQuery } from "@/hooks/use-me";
import { whyCanISee } from "@/services/review-rules";
import { Spinner } from "@/components/erad/misc";

/** A small explanation of the signed-in person's own access. */
export function WhyCanISee({ docId }: { docId: string }) {
  const [open, setOpen] = useState(false);
  const access = useQuery({ ...accessQuery(docId), enabled: open });
  const entities = useQuery({ ...entitiesQuery, enabled: open });
  const me = useQuery(meQuery);
  const entityName = (id: string) => entities.data?.find((e) => e.id === id)?.display_name ?? "this record";

  return (
    <div className="flex flex-col gap-1">
      <button type="button" aria-expanded={open} className="focus-ring type-label-12 self-start underline" onClick={() => setOpen(!open)}>
        Why can I see this?
      </button>
      {open ? (
        <div role="status" className="type-paragraph-14">
          {access.isPending || entities.isPending ? <Spinner label="Checking your access" /> :
            access.isError ? "You no longer have access to this document." :
            whyCanISee(access.data, me.data?.userId ?? "", entityName, (iso) => format(new Date(iso), "d MMM"), new Date())}
        </div>
      ) : null}
    </div>
  );
}
