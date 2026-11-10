import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  ensure: vi.fn(),
  getRating: vi.fn(),
  getDashboard: vi.fn(),
}));

vi.mock("@/server/guards", () => ({ requireStudent: async () => ({ user: { id: "u1" }, role: "student" }) }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({}) }));
vi.mock("@/server/streak-bonus", () => ({ ensureStreakBonus: m.ensure }));
vi.mock("@/server/dashboard", () => ({ getDashboard: m.getDashboard }));
vi.mock("@/server/rating", async (orig) => ({
  ...(await orig<typeof import("@/server/rating")>()),
  getRating: m.getRating,
}));
vi.mock("next/navigation", () => ({ usePathname: () => "/home" }));

import HomePage from "@/app/(student)/home/page";
import RatingPage from "@/app/(student)/rating/page";

const dash = (streak: number) => ({
  firstName: "Ali",
  groupLabel: null,
  streak,
  totalXp: 10,
  weeklyRank: null,
  week: [],
  currentPart: null,
  tasks: [],
  dueCards: 0,
  isEmpty: false,
});

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  m.getDashboard.mockResolvedValue(dash(6));
  m.getRating.mockResolvedValue({
    kind: "speaking",
    period: "week",
    podium: [],
    rows: [],
    ineligible: [],
    own: null,
    empty: true,
  });
});

describe("home page", () => {
  it("runs the bonus check and celebrates when awarded; tile uses the checked streak", async () => {
    m.ensure.mockResolvedValue({ milestone: 7, awarded: true, streak: 7, today: "2026-11-10" });
    render(await HomePage());
    expect(m.ensure).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(window.localStorage.getItem("streak-celebrated-7-2026-11-10")).toBe("1");
    expect(screen.getByRole("region", { name: "Statistika" }).textContent).toMatch(/Streak\s*7|7\s*Streak/);
  });

  it("does not celebrate when the XP was already awarded", async () => {
    m.ensure.mockResolvedValue({ milestone: 7, awarded: false, streak: 7, today: "2026-11-10" });
    render(await HomePage());
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("a failing check does not break the page", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    m.ensure.mockRejectedValue(new Error("boom"));
    render(await HomePage());
    expect(screen.getByRole("heading", { name: /Salom/ })).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("rating page", () => {
  it("falls back to speaking/week for invalid params", async () => {
    m.ensure.mockResolvedValue({ milestone: null, awarded: false, streak: 0, today: "2026-11-10" });
    render(await RatingPage({ searchParams: Promise.resolve({ kind: "bogus", period: ["x"] }) }));
    expect(m.getRating).toHaveBeenCalledWith("u1", "speaking", "week");
    expect(screen.getByRole("link", { name: "Gapirish" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Hafta" })).toHaveAttribute("aria-current", "page");
  });

  it("celebrates only when awarded and survives a check failure", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    m.ensure.mockResolvedValue({ milestone: 14, awarded: false, streak: 14, today: "2026-11-10" });
    const a = render(await RatingPage({ searchParams: Promise.resolve({}) }));
    expect(screen.queryByRole("dialog")).toBeNull();
    a.unmount();
    m.ensure.mockRejectedValue(new Error("boom"));
    render(await RatingPage({ searchParams: Promise.resolve({ kind: "xp" }) }));
    expect(m.getRating).toHaveBeenLastCalledWith("u1", "xp", "week");
  });
});
