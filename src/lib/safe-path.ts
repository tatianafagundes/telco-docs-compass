// Where to go after logging in. Only a path on this site: anything that could leave it
// (another origin, "//host" or "/\host", which browsers read as another host) goes to the default.
export const DEFAULT_AFTER_LOGIN = "/documents";
export function safePath(p: string | undefined, origin: string): string {
  if (!p) return DEFAULT_AFTER_LOGIN;
  try {
    const u = new URL(p, origin);
    if (u.origin !== origin) return DEFAULT_AFTER_LOGIN;
    const path = u.pathname + u.search;
    // "/.//host" normalises to "//host": a protocol-relative address, so refuse it.
    return /^\/(?![/\\])/.test(path) ? path : DEFAULT_AFTER_LOGIN;
  } catch {
    return DEFAULT_AFTER_LOGIN;
  }
}
/** What to say when logging in fails, without saying whether the account exists. */
export function loginErrorText(status: number | undefined): string {
  if (status === 429) return "Too many attempts. Wait a few minutes, then try again.";
  if (status === undefined || status >= 500)
    return "We couldn't reach the server. Check your connection, then try again.";
  return "That email and password did not match. You can try again.";
}
