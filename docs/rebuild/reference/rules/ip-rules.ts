// Which IP addresses are not public. Pure functions, no I/O.
//
// Used before the server sends a request to an address a connected system gave us (a webhook
// callback, a file URL): it must never reach the server's own network. Anything that cannot be read
// as an address counts as not public, so a strange input is refused instead of let through.
// Does not resolve names; that is the caller's job (see `resolvesPublic` in tmf-gateway.ts).

const V4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

/** The four numbers of a dotted IPv4 address, or null when it is not one. */
function parseV4(text: string): [number, number, number, number] | null {
  const m = V4.exec(text);
  if (!m) return null;
  const parts = m.slice(1, 5).map(Number) as [number, number, number, number];
  return parts.every((n) => n <= 255) ? parts : null;
}

function isNonPublicV4([a, b, c]: [number, number, number, number]): boolean {
  return (
    a === 0 || // "this network"
    a === 10 || // private
    a === 127 || // loopback
    (a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT
    (a === 169 && b === 254) || // link-local, includes cloud metadata services
    (a === 172 && b >= 16 && b <= 31) || // private
    (a === 192 && b === 0 && (c === 0 || c === 2)) || // protocol assignments, documentation
    (a === 192 && b === 88 && c === 99) || // 6to4 relay
    (a === 192 && b === 168) || // private
    (a === 198 && (b === 18 || b === 19)) || // benchmarking
    (a === 198 && b === 51 && c === 100) || // documentation
    (a === 203 && b === 0 && c === 113) || // documentation
    a >= 224 // multicast, reserved, broadcast
  );
}

/** The eight 16-bit groups of an IPv6 address (handles `::` and a trailing IPv4 part), or null. */
function parseV6(text: string): number[] | null {
  let work = text;
  const tail: number[] = [];
  const lastColon = work.lastIndexOf(":");
  const last = work.slice(lastColon + 1);
  if (last.includes(".")) {
    // "::ffff:1.2.3.4": the IPv4 part stands for the last two groups.
    const v4 = parseV4(last);
    if (!v4) return null;
    tail.push((v4[0] << 8) | v4[1], (v4[2] << 8) | v4[3]);
    work = work.slice(0, lastColon + 1);
    if (!work.endsWith("::")) work = work.slice(0, -1);
  }
  const halves = work.split("::");
  if (halves.length > 2) return null;
  const groups = (part: string | undefined) => (part ? part.split(":") : []);
  const front = groups(halves[0]);
  const back = halves.length === 2 ? groups(halves[1]) : [];
  if (![...front, ...back].every((g) => /^[0-9a-f]{1,4}$/.test(g))) return null;
  const num = (g: string[]) => g.map((x) => parseInt(x, 16));
  const known = front.length + back.length + tail.length;
  if (halves.length === 1) return known === 8 ? [...num(front), ...tail] : null;
  if (known > 7) return null; // "::" must stand for at least one group
  return [...num(front), ...Array<number>(8 - known).fill(0), ...num(back), ...tail];
}

function isNonPublicV6(g: number[]): boolean {
  const [g0 = 0, g1 = 0, g2 = 0, g3 = 0, g4 = 0, g5 = 0] = g;
  const zeros = (...xs: number[]) => xs.every((x) => x === 0);
  return (
    zeros(g0, g1, g2, g3, g4, g5) || // ::, ::1 and the old IPv4-compatible form
    (zeros(g0, g1, g2, g3, g4) && g5 === 0xffff) || // IPv4-mapped: refused whatever it holds
    (g0 & 0xfe00) === 0xfc00 || // unique local
    (g0 & 0xffc0) === 0xfe80 || // link-local
    (g0 & 0xffc0) === 0xfec0 || // site-local (retired, still treated as internal)
    (g0 & 0xff00) === 0xff00 || // multicast
    (g0 === 0x64 && g1 === 0xff9b && (zeros(g2, g3, g4, g5) || g2 === 1)) || // NAT64
    g0 === 0x2002 || // 6to4
    (g0 === 0x2001 && (g1 === 0 || g1 === 0x0db8)) || // Teredo, documentation
    (g0 === 0x0100 && zeros(g1, g2, g3)) // discard-only
  );
}

/**
 * True when the address is loopback, private, link-local, carrier-grade NAT, multicast, reserved,
 * documentation, or a tunnel form (NAT64, 6to4, Teredo) that can point at one of those; also true
 * when the text is not a readable IP address.
 */
export function isPrivateIp(ip: string): boolean {
  const text = ip
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, ""); // an IPv6 host may come in brackets
  if (text.includes(":")) {
    const groups = parseV6(text);
    return groups === null || isNonPublicV6(groups);
  }
  const v4 = parseV4(text);
  return v4 === null || isNonPublicV4(v4);
}
