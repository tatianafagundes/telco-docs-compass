// Reading a stored file for the processing steps without holding more than the limit in memory
// (file-hooks final seg H2): the stored size is read from the bucket's listing first, so a file
// uploaded larger than declared is refused before any byte of it is fetched.
import type { Db } from "@/services/seam-runtime";

/**
 * The file at `path`, or null when it is not there, or "tooLarge" when it is over `maxBytes`. The
 * size after the download is checked too, for a listing that carries no size.
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
  if (typeof size === "number" && size > maxBytes) return "tooLarge";
  const { data: file } = await admin.storage.from(bucket).download(path);
  if (!file) return null;
  if (file.size > maxBytes) return "tooLarge";
  return new Uint8Array(await file.arrayBuffer());
}
