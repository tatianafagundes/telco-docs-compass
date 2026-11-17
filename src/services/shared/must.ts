// Turns a Supabase answer into its data, or throws when the database reported an error.
// supabase-js never throws on its own: it returns `{ data, error }`, and code that only reads
// `data` treats a failed query as "no rows" or as a write that worked. Wrap every query whose
// failure must stop the operation.
//
// Does not know about HTTP, roles or tenants. The thrown message names what failed, never the
// database message, so nothing from the database reaches logs or answers by accident.

interface DbAnswer<T> {
  data: T;
  error: { message: string } | null;
}

export class DatabaseError extends Error {
  constructor(what: string) {
    super(`database error while ${what}`);
    this.name = "DatabaseError";
  }
}

/** @param what short phrase for the failed step, e.g. "reading the documents of a bulk batch". */
export function must<T>(answer: DbAnswer<T>, what: string): T {
  if (answer.error) throw new DatabaseError(what);
  return answer.data;
}
