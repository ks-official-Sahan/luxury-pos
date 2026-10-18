import { describe, expect, it } from "vitest";
import { forwardHeaders, isEdgeCacheable, isRetriable, limitBucket, originOrder, parseRules } from "./gateway";

describe("edge gateway", () => {
  const rules = parseRules('[{"prefix":"/api/insights","origin":"fallback"},{"prefix":"/api","origin":"primary"}]');

  it("routes bounded contexts by longest prefix and fails over", () => {
    expect(originOrder("/api/insights/ask", rules, true)).toEqual(["fallback", "primary"]);
    expect(originOrder("/api/insightsx", rules, true)).toEqual(["primary", "fallback"]);
    expect(originOrder("/api/orders", rules, false)).toEqual(["primary"]);
    expect(originOrder("/api/orders", rules, true, new Set(["primary"]))).toEqual(["fallback", "primary"]);
  });

  it("retries only reads and UUID-keyed writes", () => {
    expect(isRetriable("GET", "/api/orders")).toBe(true);
    expect(isRetriable("POST", "/api/orders")).toBe(true);
    expect(isRetriable("POST", "/api/tokens")).toBe(false);
    expect(isRetriable("PATCH", "/api/customers/1")).toBe(false);
  });

  it("caches only anonymous public reads", () => {
    expect(isEdgeCacheable("GET", "/api/public/brand/x", false)).toBe(true);
    expect(isEdgeCacheable("GET", "/api/public/brand/x", true)).toBe(false);
    expect(isEdgeCacheable("GET", "/api/me", false)).toBe(false);
  });

  it("buckets rate limits and leaves the web app alone", () => {
    expect(limitBucket("/api/auth/sign-in/email")).toBe("auth");
    expect(limitBucket("/mcp")).toBe("api");
    expect(limitBucket("/sell")).toBeNull();
  });

  it("overwrites spoofed client IP headers", () => {
    const h = forwardHeaders(new Headers({ "x-real-ip": "6.6.6.6", "x-forwarded-for": "6.6.6.6" }), { clientIp: "1.2.3.4", host: "pos.example", requestId: "r" });
    expect(h.get("x-real-ip")).toBe("1.2.3.4");
    expect(h.get("x-forwarded-for")).toBe("1.2.3.4");
  });

  it("rejects malformed rules", () => {
    expect(() => parseRules('[{"prefix":"api","origin":"primary"}]')).toThrow();
    expect(() => parseRules('{"prefix":"/api"}')).toThrow();
  });
});
