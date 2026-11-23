// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { SearchInput } from "./field";

function Box({ start = "" }: { start?: string }) {
  const [v, setV] = useState(start);
  return <SearchInput value={v} onValueChange={setV} placeholder="Search name or ID" />;
}

describe("the search box", () => {
  afterEach(cleanup);

  it("shows no clear button while empty", () => {
    render(<Box />);
    expect(screen.queryByRole("button", { name: "Clear search" })).toBeNull();
  });

  it("clears what was typed with its ✕, and keeps the cursor in the box (Tony, 11/19)", () => {
    render(<Box />);
    const box = screen.getByRole("searchbox") as HTMLInputElement;
    fireEvent.change(box, { target: { value: "rita" } });
    fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
    expect(box.value).toBe("");
    expect(document.activeElement).toBe(box);
    expect(screen.queryByRole("button", { name: "Clear search" })).toBeNull();
  });
});
