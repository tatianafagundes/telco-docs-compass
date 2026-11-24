// Reading a stored file for the processing steps without holding more than the limit in memory
// (file-hooks final seg H2): the stored size is read from the bucket's listing first, so a file
// uploaded larger than declared is refused before any byte of it is fetched.
import { readResponseBytes } from "@/services/gateway-body";
import type { Db } from "@/services/seam-runtime";

/**
 * The file at `path`, or null when it is not there (or the store cannot say now: the caller refuses
 * the step without writing), or "tooLarge" when it is over `maxBytes`.
 */
export async function downloadWithin(
  admin: Db,
  bucket: string,
  path: string,
  maxBytes: number,
): Promise<Uint8Array<ArrayBuffer> | null | "tooLarge"> {
  const cut = path.lastIndexOf("/");
  const folder = cut < 0 ? "" : path.slice(0, cut);
  const name = path.slice(cut + 1);
  const { data: listed } = await admin.storage
    .from(bucket)
    .list(folder, { search: name, limit: 10 });
  const entry = (listed ?? []).find((f) => f.name === name);
  if (!entry) return null;
  const size = (entry.metadata as { size?: unknown } | null)?.size;
  if (typeof size === "number") {
    if (size > maxBytes) return "tooLarge";
    // The listed size is within the limit: the download holds at most that much.
    const { data: file } = await admin.storage.from(bucket).download(path);
    if (!file) return null;
    if (file.size > maxBytes) return "tooLarge";
    return new Uint8Array(await file.arrayBuffer());
  }
  // No size listed: read through a short-lived address, cut at the limit, so memory stays bounded
  // whatever the listing says (final seg re-check F1).
  const { data: signed } = await admin.storage.from(bucket).createSignedUrl(path, 60);
  if (!signed?.signedUrl) return null;
  const res = await fetch(signed.signedUrl);
  if (!res.ok) return null;
  const read = await readResponseBytes(res, maxBytes);
  return read.tooLarge ? "tooLarge" : read.value;
}
