/**
 * IP/CIDR matching utility — no external dependencies.
 * Supports: single IP ("1.2.3.4"), CIDR ("1.2.3.0/24"), IPv6 ("::1", "2001:db8::/32").
 */

/** Parse IPv4 to 32-bit integer */
function parseIPv4(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    const v = parseInt(p, 10);
    if (isNaN(v) || v < 0 || v > 255) return null;
    n = (n << 8) | v;
  }
  return n >>> 0; // unsigned
}

/** Parse IPv6 to two 64-bit BigInts (high, low) */
function parseIPv6(ip: string): [bigint, bigint] | null {
  // Handle :: expansion
  let expanded = ip;
  if (expanded.includes("::")) {
    const [left, right] = expanded.split("::");
    const leftParts = left ? left.split(":") : [];
    const rightParts = right ? right.split(":") : [];
    const missing = 8 - leftParts.length - rightParts.length;
    expanded = [...leftParts, ...Array(missing).fill("0"), ...rightParts].join(":");
  }

  const parts = expanded.split(":");
  if (parts.length !== 8) return null;

  let high = 0n;
  let low = 0n;
  for (let i = 0; i < 8; i++) {
    const v = parseInt(parts[i], 16);
    if (isNaN(v) || v < 0 || v > 0xffff) return null;
    if (i < 4) {
      high = (high << 16n) | BigInt(v);
    } else {
      low = (low << 16n) | BigInt(v);
    }
  }
  return [high, low];
}

/** Check if an IPv4 address matches a CIDR range */
function matchIPv4CIDR(ip: string, cidr: string): boolean {
  const [range, bitsStr] = cidr.split("/");
  const ipNum = parseIPv4(ip);
  const rangeNum = parseIPv4(range);
  if (ipNum === null || rangeNum === null) return false;

  const bits = parseInt(bitsStr, 10);
  if (isNaN(bits) || bits < 0 || bits > 32) return false;
  if (bits === 0) return true;

  const mask = (~0 << (32 - bits)) >>> 0;
  return (ipNum & mask) === (rangeNum & mask);
}

/** Check if an IPv6 address matches a CIDR range */
function matchIPv6CIDR(ip: string, cidr: string): boolean {
  const [range, bitsStr] = cidr.split("/");
  const ipParsed = parseIPv6(ip);
  const rangeParsed = parseIPv6(range);
  if (!ipParsed || !rangeParsed) return false;

  const bits = parseInt(bitsStr, 10);
  if (isNaN(bits) || bits < 0 || bits > 128) return false;
  if (bits === 0) return true;

  const [ipH, ipL] = ipParsed;
  const [rH, rL] = rangeParsed;

  if (bits <= 64) {
    const mask = bits === 64 ? ~0n : (~0n << BigInt(64 - bits)) & ((1n << 64n) - 1n);
    return (ipH & mask) === (rH & mask);
  } else {
    if (ipH !== rH) return false;
    const lowBits = bits - 64;
    const mask = (~0n << BigInt(64 - lowBits)) & ((1n << 64n) - 1n);
    return (ipL & mask) === (rL & mask);
  }
}

function isIPv6(ip: string): boolean {
  return ip.includes(":");
}

/**
 * Check if `ip` matches any entry in the whitelist.
 * Whitelist entries can be: single IP, CIDR range, or "*"" (match all).
 */
export function isIpAllowed(ip: string, whitelist: string[]): boolean {
  if (whitelist.length === 0) return true; // empty whitelist = allow all

  for (let entry of whitelist) {
    entry = entry.trim();
    if (!entry) continue;
    if (entry === "*") return true;

    // CIDR notation
    if (entry.includes("/")) {
      if (isIPv6(entry) && isIPv6(ip)) {
        if (matchIPv6CIDR(ip, entry)) return true;
      } else if (!isIPv6(entry) && !isIPv6(ip)) {
        if (matchIPv4CIDR(ip, entry)) return true;
      }
      continue;
    }

    // Single IP match
    if (entry === ip) return true;

    // IPv4-mapped IPv6: ::ffff:1.2.3.4 → try matching against 1.2.3.4
    if (ip.startsWith("::ffff:") && !isIPv6(entry)) {
      const v4 = ip.slice(7);
      if (entry === v4) return true;
    }
  }

  return false;
}

/** Extract domain from a URL string */
export function extractDomain(referer: string): string | null {
  try {
    return new URL(referer).hostname;
  } catch {
    return null;
  }
}

/** Check if a referer matches any allowed domain */
export function isRefererAllowed(referer: string | undefined, allowedDomains: string[]): boolean {
  if (allowedDomains.length === 0) return true;
  if (!referer) return false; // No referer = block

  const domain = extractDomain(referer);
  if (!domain) return false;

  for (const allowed of allowedDomains) {
    const d = allowed.trim();
    if (!d) continue;
    // Exact match or subdomain match
    if (domain === d || domain.endsWith(`.${d}`)) return true;
  }

  return false;
}
