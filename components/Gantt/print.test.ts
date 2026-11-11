import { describe, expect, it } from "vitest";
import { PRINT_OPTIONS, renderPrintFooter, renderPrintHeader } from "@/components/Gantt/print";

describe("print header and footer", () => {
  it("titles each page with the couple, the wedding day and the as-of date", () => {
    const html = renderPrintHeader("Priya & Sam", "2027-04-17", "2026-11-11");
    expect(html).toContain("Priya &amp; Sam: payment schedule");
    expect(html).toContain("Wedding day April 17, 2027");
    expect(html).toContain("As of November 11, 2026");
  });

  it("escapes the couple's names, which come from the database", () => {
    const html = renderPrintHeader('<img src=x onerror="alert(1)">', "2027-04-17", "2026-11-11");
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
  });

  it("numbers pages from 1 (Bryntum counts from 0)", () => {
    expect(renderPrintFooter(0, 2)).toContain("Page 1 of 2");
    expect(renderPrintFooter(1, 2)).toContain("Page 2 of 2");
  });
});

describe("print options", () => {
  it("prints every row and the whole timeline, landscape, without cutting rows at page breaks", () => {
    expect(PRINT_OPTIONS).toMatchObject({
      exporterType: "multipagevertical",
      orientation: "landscape",
      scheduleRange: "completeview",
      rowsRange: "all",
      alignRows: true,
    });
  });
});
