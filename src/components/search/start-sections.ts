// Which short lists the Documents start page shows a person. Pure, so the choice is tested.
import { inDays } from "@/components/search/search-url";
import type { SearchFilters } from "@/services/search-rules";

export interface Section {
  title: string;
  empty: string;
  filters: SearchFilters;
}

/** Which short lists a person starts with. Pure, so the choice is tested. */
export function startSections(opts: { isAdmin: boolean; canReview: boolean }): Section[] {
  return [
    // Only people who check and approve are waited for; for others these lists would always look idle.
    ...(opts.canReview
      ? [
          {
            title: "Details to check",
            empty: "No document has details waiting to be checked.",
            filters: { review: true },
          },
          {
            title: "Waiting for approval",
            empty: "No document is waiting for approval.",
            filters: { statuses: ["in_review" as const] },
          },
        ]
      : []),
    {
      title: "Recently changed",
      empty: "Documents you can see will appear here as they change.",
      filters: {},
    },
    {
      title: "Expiring in the next 90 days",
      empty: "Nothing expires in the next 90 days.",
      filters: { expiringBefore: inDays(90), sort: "expiry" },
    },
    ...(opts.isAdmin
      ? [{ title: "On legal hold", empty: "No documents are on hold.", filters: { hold: true } }]
      : []),
  ];
}
