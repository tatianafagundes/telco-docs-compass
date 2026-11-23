/** EDS: a cell with no value shows an em dash, never a blank or a placeholder word. */
export function EmptyCell({ label = "Not set" }: { label?: string }) {
  return (
    <>
      <span aria-hidden="true" className="text-text-secondary">
        —
      </span>
      <span className="sr-only">{label}</span>
    </>
  );
}
