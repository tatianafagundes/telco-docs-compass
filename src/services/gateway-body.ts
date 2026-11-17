// Reads what a caller sent without trusting its size: stops at a limit instead of loading the
// whole thing first. Works on the request (JSON and form bodies) and on a fetched file.
//
// Does not parse, authenticate or answer: the caller decides what "too large" means to the person.
// A declared Content-Length over the limit is refused without reading anything. A body without
// one, or with a false one, is cut off at the limit while it streams.

export interface Limited<T> {
  value: T;
  /** True when the body went past the limit. `value` is then empty and must not be used. */
  tooLarge: boolean;
}

async function readStream(
  body: ReadableStream<Uint8Array> | null,
  maxBytes: number,
): Promise<Limited<Uint8Array>> {
  if (!body) return { value: new Uint8Array(0), tooLarge: false };
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      return { value: new Uint8Array(0), tooLarge: true };
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.byteLength;
  }
  return { value: out, tooLarge: false };
}

const declaredOver = (headers: Headers, maxBytes: number) => {
  const n = Number(headers.get("content-length"));
  return Number.isFinite(n) && n > maxBytes;
};

/** The body of a request as text, up to `maxBytes`. */
export async function readRequestText(
  request: Request,
  maxBytes: number,
): Promise<Limited<string>> {
  if (declaredOver(request.headers, maxBytes)) return { value: "", tooLarge: true };
  const r = await readStream(request.body, maxBytes);
  return { value: new TextDecoder().decode(r.value), tooLarge: r.tooLarge };
}

/** The body of a fetched file as bytes, up to `maxBytes`. */
export async function readResponseBytes(
  response: Response,
  maxBytes: number,
): Promise<Limited<Uint8Array<ArrayBuffer>>> {
  if (declaredOver(response.headers, maxBytes)) return { value: new Uint8Array(0), tooLarge: true };
  const r = await readStream(response.body, maxBytes);
  return { value: r.value as Uint8Array<ArrayBuffer>, tooLarge: r.tooLarge };
}
