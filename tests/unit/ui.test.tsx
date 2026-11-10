import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Plus } from "lucide-react";
import { describe, expect, it } from "vitest";
import { Button, IconButton, ProgressBar, Tabs } from "@/components/ui";

describe("Button", () => {
  it("renders a link when href is given", () => {
    render(<Button href="/home">Boshlash</Button>);
    const link = screen.getByRole("link", { name: "Boshlash" });
    expect(link.tagName).toBe("A");
    expect(link).toHaveAttribute("href", "/home");
  });

  it("renders a button otherwise", () => {
    render(<Button>Yuborish</Button>);
    expect(screen.getByRole("button", { name: "Yuborish" })).toBeEnabled();
  });

  it("is disabled and aria-busy while loading", () => {
    render(<Button loading>Yuborish</Button>);
    const btn = screen.getByRole("button", { name: "Yuborish" });
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute("aria-busy", "true");
  });
});

describe("IconButton", () => {
  it("exposes aria-label", () => {
    render(<IconButton aria-label="Qo'shish" icon={<Plus />} />);
    expect(screen.getByRole("button", { name: "Qo'shish" })).toBeInTheDocument();
  });

  it("requires aria-label at type level", () => {
    // @ts-expect-error aria-label is mandatory
    const el = <IconButton icon={<Plus />} />;
    expect(el).toBeTruthy();
  });
});

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

describe("Tabs", () => {
  it("has tablist/tab roles and aria-selected", () => {
    render(<TabsHarness />);
    expect(screen.getByRole("tablist")).toBeInTheDocument();
    expect(screen.getAllByRole("tab")).toHaveLength(3);
    expect(screen.getByRole("tab", { name: "A" })).toHaveAttribute("aria-selected", "true");
  });

  it("moves selection with arrow keys", async () => {
    const user = userEvent.setup();
    render(<TabsHarness />);
    screen.getByRole("tab", { name: "A" }).focus();
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: "B" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "B" })).toHaveFocus();
    await user.keyboard("{ArrowLeft}{ArrowLeft}");
    expect(screen.getByRole("tab", { name: "C" })).toHaveAttribute("aria-selected", "true");
  });
});

describe("ProgressBar", () => {
  it("exposes aria values", () => {
    render(<ProgressBar value={30} max={60} />);
    const bar = screen.getByRole("progressbar");
    expect(bar).toHaveAttribute("aria-valuenow", "30");
    expect(bar).toHaveAttribute("aria-valuemin", "0");
    expect(bar).toHaveAttribute("aria-valuemax", "60");
  });

  it("clamps out-of-range values", () => {
    render(<ProgressBar value={500} max={10} />);
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "10");
  });
});
