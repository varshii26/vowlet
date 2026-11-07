// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ClauseChip } from "@/components/Clauses/ClauseChip";

afterEach(cleanup);

const clause = { text: "Moving the event date costs a <b>$500</b> flat fee.", page: 2 };

describe("ClauseChip", () => {
  it("expands the quoted clause as text, with a link to it in the contract", () => {
    const { container } = render(<ClauseChip label="Grand Oak Estate contract, page 2" clause={clause} href="/vendors/v1?clause=c1" />);
    expect(screen.queryByRole("link")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Grand Oak Estate contract, page 2" }));
    expect(container.querySelector("b")).toBeNull();
    expect(container.textContent).toContain(clause.text);
    expect(screen.getByRole("link", { name: "Open in contract" }).getAttribute("href")).toBe("/vendors/v1?clause=c1");
  });

  it("has no contract link without an href", () => {
    render(<ClauseChip label="Grand Oak Estate contract, page 2" clause={clause} />);
    fireEvent.click(screen.getByRole("button"));
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("is a plain link when there is no quoted text but there is an href", () => {
    render(<ClauseChip label="Grand Oak Estate contract, page 2" clause={null} href="/vendors/v1?clause=c1" />);
    expect(screen.getByRole("link", { name: "Grand Oak Estate contract, page 2" }).getAttribute("href")).toBe("/vendors/v1?clause=c1");
  });

  it("is a plain label with neither", () => {
    render(<ClauseChip label="Grand Oak Estate contract, page 2" clause={null} />);
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });
});
