// Files chosen in "Choose a record" on the Documents page, waiting for the record page to take
// them. Memory only: a reload drops them, and the record page then just offers its own button.
let pending: { entityId: string; files: File[] } | null = null;

export function handOverFiles(entityId: string, files: File[]): void {
  pending = { entityId, files };
}

/** The files for this record, once; anything left for another record is dropped. */
export function takeFiles(entityId: string): File[] {
  const p = pending;
  pending = null;
  return p && p.entityId === entityId ? p.files : [];
}
