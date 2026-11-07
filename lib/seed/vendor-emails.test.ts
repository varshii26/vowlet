import { afterEach, describe, expect, it, vi } from "vitest";
import { parseVendorEmails, vendorEmail } from "@/lib/seed/vendor-emails";

describe("parseVendorEmails", () => {
  it("reads a comma-separated list", () => {
    expect(parseVendorEmails("a@x.com,b@y.org")).toEqual({ valid: ["a@x.com", "b@y.org"], ignored: [] });
  });

  it("also accepts spaces, semicolons and new lines between emails, and trims", () => {
    expect(parseVendorEmails("  a@x.com ; b@y.org\n c@z.io  ,").valid).toEqual(["a@x.com", "b@y.org", "c@z.io"]);
  });

  it("keeps the order and drops repeats", () => {
    expect(parseVendorEmails("b@y.org,a@x.com,b@y.org").valid).toEqual(["b@y.org", "a@x.com"]);
  });

  it("reports what it ignored instead of silently using it", () => {
    expect(parseVendorEmails("a@x.com,not-an-email,@nope.com,also@bad,ok@y.org")).toEqual({
      valid: ["a@x.com", "ok@y.org"],
      ignored: ["not-an-email", "@nope.com", "also@bad"],
    });
  });

  it.each([undefined, "", "   ", ",,;"])("returns nothing for %j", (value) => {
    expect(parseVendorEmails(value)).toEqual({ valid: [], ignored: [] });
  });

  it("accepts the sandbox addresses PayPal generates", () => {
    expect(parseVendorEmails("sb-gh43y553656061@business.example.com").valid).toEqual(["sb-gh43y553656061@business.example.com"]);
  });
});

describe("vendorEmail", () => {
  it("shares the configured emails among vendors in turn", () => {
    const configured = ["a@x.com", "b@x.com", "c@x.com"];
    expect([1, 2, 3, 4, 5, 6, 7].map((n) => vendorEmail(n, configured))).toEqual(["a@x.com", "b@x.com", "c@x.com", "a@x.com", "b@x.com", "c@x.com", "a@x.com"]);
  });

  it("gives every vendor the one account when only one is configured", () => {
    expect(new Set([1, 2, 3, 4, 5].map((n) => vendorEmail(n, ["only@x.com"])))).toEqual(new Set(["only@x.com"]));
  });

  it("uses a placeholder, numbered per vendor, when nothing is configured", () => {
    expect(vendorEmail(3, [])).toBe("sb-vendor3@business.example.com");
  });

  it("refuses a slot that isn't a whole number from 1", () => {
    for (const n of [0, -1, 1.5, Number.NaN]) expect(() => vendorEmail(n, [])).toThrow(RangeError);
  });
});

describe("the demo vendors' payees", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  async function vendors() {
    vi.resetModules();
    return (await import("@/lib/seed/demo-data")).VENDORS;
  }

  it("use placeholders when PAYPAL_VENDOR_EMAILS is not set", async () => {
    vi.stubEnv("PAYPAL_VENDOR_EMAILS", "");
    const emails = (await vendors()).map((v) => v.paypalEmail);
    expect(emails.every((e) => /^sb-vendor\d@business\.example\.com$/.test(e))).toBe(true);
  });

  it("use the configured sandbox accounts, all 14 of them, when it is set", async () => {
    vi.stubEnv("PAYPAL_VENDOR_EMAILS", "sb-one@business.example.com, sb-two@business.example.com");
    const list = await vendors();
    expect(list).toHaveLength(14);
    const emails = new Set(list.map((v) => v.paypalEmail));
    expect(emails).toEqual(new Set(["sb-one@business.example.com", "sb-two@business.example.com"]));
  });

  it("use one account for everything when only one is configured", async () => {
    vi.stubEnv("PAYPAL_VENDOR_EMAILS", "sb-gh43y553656061@business.example.com");
    expect(new Set((await vendors()).map((v) => v.paypalEmail))).toEqual(new Set(["sb-gh43y553656061@business.example.com"]));
  });

  it("warn about, and skip, anything that isn't an email", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      vi.stubEnv("PAYPAL_VENDOR_EMAILS", "sb-one@business.example.com,oops");
      const list = await vendors();
      expect(list.every((v) => v.paypalEmail === "sb-one@business.example.com")).toBe(true);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining("oops"));
    } finally {
      warn.mockRestore();
    }
  });
});
