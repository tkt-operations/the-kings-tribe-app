import "server-only";

import { BlockList, isIP } from "node:net";

/**
 * Which resolved IP addresses the product fetcher may connect to.
 *
 * IPv4: everything except private, loopback, link-local (including the cloud
 * metadata address 169.254.169.254), CGNAT, documentation, benchmarking,
 * multicast and reserved ranges.
 * IPv6: only global unicast (2000::/3), minus Teredo, documentation and 6to4
 * (which can embed private IPv4). This excludes ::1, ::, fc00::/7 (ULA),
 * fe80::/10, ff00::/8, ::ffff:0:0/96 (IPv4-mapped) and 64:ff9b::/96 (NAT64).
 */
const BLOCKED_V4: [string, number][] = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
];

const blockedV4 = new BlockList();
for (const [net, prefix] of BLOCKED_V4) blockedV4.addSubnet(net, prefix, "ipv4");

const globalV6 = new BlockList();
globalV6.addSubnet("2000::", 3, "ipv6");

const blockedV6 = new BlockList();
blockedV6.addSubnet("2001::", 32, "ipv6"); // Teredo
blockedV6.addSubnet("2001:db8::", 32, "ipv6"); // documentation
blockedV6.addSubnet("2002::", 16, "ipv6"); // 6to4

/** True only for a syntactically valid, publicly routable address. */
export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return !blockedV4.check(address, "ipv4");
  if (family === 6) return globalV6.check(address, "ipv6") && !blockedV6.check(address, "ipv6");
  return false;
}
