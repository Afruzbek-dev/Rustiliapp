import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Plus } from "lucide-react";
import { describe, expect, it, vi } from "vitest";
import { Button, IconButton, ProgressBar, Tabs } from "@/components/ui";

function TabsHarness() {
  const [v, setV] = useState("a");
  return (
    <Tabs
      value={v}
      onChange={setV}
      tabs={[
        { id: "a", label: "A" },
        { id: "b", label: "B" },
        { id: "c", label: "C" },
      ]}
    />
  );
}

describe("Button as link", () => {
  it("forwards rest props (id, data-*, onClick)", async () => {
    const onClick = vi.fn((e: { preventDefault: () => void }) => e.preventDefault());
    render(
      <Button href="/path" id="go" data-qa="x" onClick={onClick}>
        Davom
      </Button>,
    );
    const link = screen.getByRole("link", { name: "Davom" });
    expect(link).toHaveAttribute("id", "go");
    expect(link).toHaveAttribute("data-qa", "x");
    await userEvent.click(link);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it.each([["disabled"], ["loading"]])("blocks activation when %s", (mode) => {
    const onClick = vi.fn();
    const props = mode === "disabled" ? { disabled: true } : { loading: true };
    render(
      <Button href="/path" onClick={onClick} {...props}>
        Davom
      </Button>,
    );
    const link = screen.getByRole("link", { name: "Davom" });
    expect(link).toHaveAttribute("aria-disabled", "true");
    expect(link).toHaveAttribute("tabindex", "-1");
    const event = new MouseEvent("click", { bubbles: true, cancelable: true });
    link.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(onClick).not.toHaveBeenCalled();
  });
});

describe("IconButton runtime guard", () => {
  it("throws on an empty aria-label outside production", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<IconButton aria-label="" icon={<Plus />} />)).toThrow(/aria-label/);
    expect(() => render(<IconButton aria-label="   " icon={<Plus />} />)).toThrow(/aria-label/);
    spy.mockRestore();
  });
});

describe("ProgressBar hardening", () => {
  it.each([[Number.NaN], [Infinity], [-Infinity]])("clamps %s to a finite value", (v) => {
    render(<ProgressBar value={v} />);
    const now = Number(screen.getByRole("progressbar").getAttribute("aria-valuenow"));
    expect(now).toBe(0);
  });

  it("falls back for NaN max", () => {
    render(<ProgressBar value={5} max={Number.NaN} />);
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuemax", "100");
  });

  it("always has an accessible name", () => {
    render(<ProgressBar value={10} />);
    expect(screen.getByRole("progressbar", { name: "Jarayon" })).toBeInTheDocument();
    render(<ProgressBar value={10} label="Dars" />);
    expect(screen.getByRole("progressbar", { name: "Dars" })).toBeInTheDocument();
  });
});

describe("Tabs roving tabindex", () => {
  it("only the selected tab is tabbable and it follows selection", async () => {
    const user = userEvent.setup();
    render(<TabsHarness />);
    const tab = (n: string) => screen.getByRole("tab", { name: n });
    expect(tab("A")).toHaveAttribute("tabindex", "0");
    expect(tab("B")).toHaveAttribute("tabindex", "-1");
    expect(tab("C")).toHaveAttribute("tabindex", "-1");
    tab("A").focus();
    await user.keyboard("{ArrowRight}");
    expect(tab("A")).toHaveAttribute("tabindex", "-1");
    expect(tab("B")).toHaveAttribute("tabindex", "0");
  });

  it("wraps around in both directions", async () => {
    const user = userEvent.setup();
    render(<TabsHarness />);
    screen.getByRole("tab", { name: "A" }).focus();
    await user.keyboard("{ArrowLeft}");
    expect(screen.getByRole("tab", { name: "C" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "C" })).toHaveFocus();
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: "A" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "A" })).toHaveFocus();
  });
});
