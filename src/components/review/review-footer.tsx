import { Lock } from "lucide-react";
import { Button } from "@/components/erad/button";
import type { FooterAction } from "@/services/review-flow-rules";

export interface ReviewFooterProps {
  checked: number;
  total: number;
  action: FooterAction;
  busy: boolean;
  onNext: () => void;
  onTransition: () => void;
  onDone: () => void;
}

/** Always-visible progress and the one main action for this moment. */
export function ReviewFooter({ checked, total, action, busy, onNext, onTransition, onDone }: ReviewFooterProps) {
  return (
    <div className="sticky bottom-0 z-10 -mx-4 flex flex-wrap items-center justify-between gap-3 border-t border-border-subtle bg-layer-content px-4 py-3">
      <div className="flex min-w-0 flex-col">
        <span className="type-label-14" aria-live="polite">{total === 0 ? "No details to check" : `${checked} of ${total} checked`}</span>
        {total > 0 ? (
          <span aria-hidden="true" className="mt-1 h-1 w-40 overflow-hidden rounded-full bg-item-hover">
            <span className="block h-full bg-status-cleared transition-[width]" style={{ width: `${Math.round((checked / total) * 100)}%` }} />
          </span>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        {action.kind === "transition" && action.reason ? <span className="type-label-12 max-w-xs text-text-secondary">{action.reason}</span> : null}
        {action.kind === "next" ? (
          <Button variant="primary" onClick={onNext}>{action.label}</Button>
        ) : action.kind === "transition" ? (
          <>
            <Button onClick={onDone}>Back to document</Button>
            <Button variant="primary" unavailable={!action.available || busy} onClick={onTransition}>
              {!action.available ? <Lock aria-hidden="true" /> : null}
              {busy ? "Saving…" : action.label}
            </Button>
          </>
        ) : (
          <Button variant="primary" onClick={onDone}>{action.label}</Button>
        )}
      </div>
    </div>
  );
}
