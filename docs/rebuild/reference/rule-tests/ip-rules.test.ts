import { describe, expect, it } from "vitest";
import { isPrivateIp } from "@/services/ip-rules";

describe("isPrivateIp: IPv4", () => {
  it.each([
    ["0.0.0.0", "this network"],
    ["0.1.2.3", "this network"],
    ["10.0.0.1", "private"],
    ["10.255.255.255", "private"],
    ["127.0.0.1", "loopback"],
    ["127.255.255.254", "loopback"],
    ["100.64.0.1", "carrier-grade NAT"],
    ["100.127.255.255", "carrier-grade NAT"],
    ["169.254.169.254", "link-local (cloud metadata)"],
    ["172.16.5.5", "private"],
    ["172.31.0.1", "private"],
    ["192.0.0.1", "protocol assignments"],
    ["192.0.2.1", "documentation"],
    ["192.88.99.1", "6to4 relay"],
    ["192.168.0.1", "private"],
    ["198.18.0.1", "benchmarking"],
    ["198.19.255.255", "benchmarking"],
    ["198.51.100.7", "documentation"],
    ["203.0.113.7", "documentation"],
    ["224.0.0.1", "multicast"],
    ["239.255.255.255", "multicast"],
    ["240.0.0.1", "reserved"],
    ["255.255.255.255", "broadcast"],
  ])("%s is not public (%s)", (ip) => {
    expect(isPrivateIp(ip)).toBe(true);
  });

  it.each([
    "1.1.1.1",
    "8.8.8.8",
    "93.184.216.34",
    "100.63.255.255",
    "100.128.0.1",
    "172.15.255.255",
    "172.32.0.1",
    "192.0.1.1",
    "192.169.0.1",
    "198.17.255.255",
    "198.20.0.1",
    "223.255.255.255",
  ])("%s is public", (ip) => {
    expect(isPrivateIp(ip)).toBe(false);
  });
});

describe("isPrivateIp: IPv6", () => {
  it.each([
    ["::", "unspecified"],
    ["::1", "loopback"],
    ["0:0:0:0:0:0:0:1", "loopback, written out"],
    ["0000:0000:0000:0000:0000:0000:0000:0001", "loopback, with leading zeros"],
    ["[::1]", "loopback, in brackets"],
    ["::127.0.0.1", "old IPv4-compatible form"],
    ["::ffff:7f00:1", "IPv4-mapped"],
    ["::ffff:127.0.0.1", "IPv4-mapped, dotted"],
    ["::ffff:8.8.8.8", "IPv4-mapped, refused whatever it holds"],
    ["fc00::1", "unique local"],
    ["fd12:3456::1", "unique local"],
    ["fe80::1", "link-local"],
    ["febf::1", "link-local, end of range"],
    ["fec0::1", "site-local"],
    ["ff02::1", "multicast"],
    ["64:ff9b::7f00:1", "NAT64 to 127.0.0.1"],
    ["64:ff9b::10.0.0.1", "NAT64, dotted"],
    ["64:ff9b:1::1", "local-use NAT64"],
    ["2002:7f00:1::", "6to4 to 127.0.0.1"],
    ["2001::1", "Teredo"],
    ["2001:db8::1", "documentation"],
    ["100::1", "discard-only"],
  ])("%s is not public (%s)", (ip) => {
    expect(isPrivateIp(ip)).toBe(true);
  });

  it.each([
    "2606:4700::1111",
    "2001:4860:4860::8888",
    "2a00:1450:4001::200e",
    "2001:1::1",
    "fe7f::1",
    "64:ff9a::1",
  ])("%s is public", (ip) => {
    expect(isPrivateIp(ip)).toBe(false);
  });
});

describe("isPrivateIp: anything that is not an address counts as not public", () => {
  it.each([
    "",
    "   ",
    "localhost",
    "example.com",
    "999.1.1.1",
    "1.2.3",
    "1.2.3.4.5",
    "01.2.3.256",
    "1:2:3:4:5:6:7",
    "1:2:3:4:5:6:7:8:9",
    "1::2::3",
    "g::1",
    "fe80::1%eth0",
    "12345::1",
    "::ffff:1.2.3",
  ])("%j", (text) => {
    expect(isPrivateIp(text)).toBe(true);
  });

  it("ignores letter case and surrounding spaces", () => {
    expect(isPrivateIp("  FE80::ABCD  ")).toBe(true);
    expect(isPrivateIp("  2606:4700::1111  ")).toBe(false);
  });
});
