// Answers for unsupported methods and unknown paths, and the marker for the legacy address.
import { tmfError, LEGACY_SUNSET, TMF_BASE_PATH } from "@/services/tmf667-mapper";
import { errorReply } from "@/services/gateway-reply";
import { notFound } from "@/services/gateway-core";
// ---------- unsupported methods and paths ----------

type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
const METHODS: HttpMethod[] = ["GET", "POST", "PUT", "PATCH", "DELETE"];

/** Without these, an unsupported method falls through to the app page and answers 200 HTML. */
export function otherMethods(allowed: HttpMethod[]): Partial<Record<HttpMethod, () => Response>> {
  const res = () => {
    const r = errorReply(
      tmfError(405, "methodNotAllowed", "Method Not Allowed", `Use ${allowed.join(" or ")} here.`),
      crypto.randomUUID(),
    );
    r.headers.set("Allow", allowed.join(", "));
    return r;
  };
  return Object.fromEntries(METHODS.filter((m) => !allowed.includes(m)).map((m) => [m, res]));
}

export function unknownPath(): Response {
  return errorReply(
    tmfError(404, "notFound", "Not Found", "No API resource at this address."),
    crypto.randomUUID(),
  );
}

/** Marks replies from the earlier profile address as deprecated (RFC 9745 / RFC 8594). */
export function legacy(res: Response): Response {
  res.headers.set("Deprecation", "true");
  res.headers.set("Sunset", LEGACY_SUNSET);
  res.headers.set("Link", `<${TMF_BASE_PATH}>; rel="successor-version"`);
  return res;
}
