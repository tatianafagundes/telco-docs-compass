import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { JOURNEY_STEPS } from "@/services/review-flow-rules";

/** "Check details → Approve → Effective" with the current step highlighted. */
export function ReviewJourney({ step }: { step: 0 | 1 | 2 | 3 }) {
  return (
    <ol aria-label="Approval steps" className="flex flex-wrap items-center gap-x-2 gap-y-1">
      {JOURNEY_STEPS.map((label, i) => {
        const done = i < step;
        const current = i === step;
        return (
          <li key={label} className="flex items-center gap-2" aria-current={current ? "step" : undefined}>
            {i > 0 ? <span aria-hidden="true" className="h-px w-4 bg-border-subtle" /> : null}
            <span
              className={cn(
                "type-label-12 inline-flex size-5 items-center justify-center rounded-full border",
                done ? "border-status-cleared bg-status-cleared text-text-on-color" : current ? "border-focus text-text-main" : "border-border-subtle text-text-secondary",
              )}
            >
              {done ? <Check aria-hidden="true" className="size-3" /> : i + 1}
            </span>
            <span className={cn("type-label-12", current ? "text-text-main" : "text-text-secondary")}>
              {label}
              {done ? <span className="sr-only"> (done)</span> : null}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
