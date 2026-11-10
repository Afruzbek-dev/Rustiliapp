import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

let mockPath = "/home";
vi.mock("next/navigation", () => ({ usePathname: () => mockPath }));

import { BottomNav } from "@/components/student/BottomNav";
import { ContinueCard } from "@/components/student/ContinueCard";
import { DailyTasks } from "@/components/student/DailyTasks";
import { ReviewDueCard } from "@/components/student/ReviewDueCard";
import { StatTile } from "@/components/student/StatTile";
import { WeekStrip } from "@/components/student/WeekStrip";
import { buildWeek } from "@/server/dashboard";

describe("BottomNav", () => {
  it("renders 5 items and marks only the active one with aria-current", () => {
    mockPath = "/path";
    render(<BottomNav />);
    const links = within(screen.getByRole("navigation")).getAllByRole("link");
    expect(links.map((l) => l.textContent)).toEqual(["Asosiy", "Yo'l", "So'zlar", "Reyting", "Gapirish"]);
    expect(screen.getByRole("link", { name: "Yo'l" })).toHaveAttribute("aria-current", "page");
    expect(links.filter((l) => l.getAttribute("aria-current") === "page")).toHaveLength(1);
  });

  it("Gapirish goes to /path by default and to the given exercise otherwise", () => {
    mockPath = "/home";
    const { unmount } = render(<BottomNav />);
    expect(screen.getByRole("link", { name: "Gapirish" })).toHaveAttribute("href", "/path");
    unmount();
    render(<BottomNav speakHref="/speak/e1" />);
    expect(screen.getByRole("link", { name: "Gapirish" })).toHaveAttribute("href", "/speak/e1");
  });

  it("activates Gapirish on /speak/* and nested routes", () => {
    mockPath = "/speak/e1";
    render(<BottomNav speakHref="/speak/e1" />);
    expect(screen.getByRole("link", { name: "Gapirish" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Asosiy" })).not.toHaveAttribute("aria-current");
  });
});

describe("WeekStrip", () => {
  it("marks today and completed days", () => {
    render(<WeekStrip week={buildWeek("2026-11-10", new Set(["2026-11-09"]))} />);
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(7);
    const today = items.filter((i) => i.getAttribute("aria-current") === "date");
    expect(today).toHaveLength(1);
    expect(today[0]).toHaveTextContent("Se");
    expect(items[0]).toHaveTextContent("Bajarildi");
  });
});

describe("ReviewDueCard", () => {
  it("shows the zero state without a start button", () => {
    render(<ReviewDueCard count={0} />);
    expect(screen.getByText("Hozircha takrorlash kerak emas")).toBeInTheDocument();
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("shows the count and a link when cards are due", () => {
    render(<ReviewDueCard count={7} />);
    expect(screen.getByText("7 ta so'z takrorlashga tayyor")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Boshlash" })).toHaveAttribute("href", "/words");
  });
});

describe("DailyTasks / ContinueCard / StatTile", () => {
  it("renders task progress", () => {
    render(
      <DailyTasks
        tasks={[
          { key: "words", done: 4, target: 10 },
          { key: "grammar", done: 1, target: 1 },
        ]}
      />,
    );
    expect(screen.getByText("4/10")).toBeInTheDocument();
    expect(screen.getByText(/1\/1/)).toBeInTheDocument();
  });

  it("renders the continue card with percent and lesson link", () => {
    render(<ContinueCard part={{ partId: "p9", lessonTitle: "Dars 3", kind: "conversation", percent: 40, started: true }} />);
    expect(screen.getByText("Suhbat kuni")).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "40");
    expect(screen.getByRole("link", { name: "Davom etish" })).toHaveAttribute("href", "/lesson/p9");
  });

  it("renders a stat tile", () => {
    render(<StatTile icon={<span />} label="XP" value={120} />);
    expect(screen.getByText("120")).toBeInTheDocument();
    expect(screen.getByText("XP")).toBeInTheDocument();
  });
});
