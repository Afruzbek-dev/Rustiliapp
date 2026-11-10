import { act, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Podium } from "@/components/student/Podium";
import { PrizeBanner } from "@/components/student/PrizeBanner";
import { RankRow } from "@/components/student/RankRow";
import { RatingTabs } from "@/components/student/RatingTabs";
import { StreakCelebration } from "@/components/student/StreakCelebration";
import { getRatingWith, type LeaderboardRow, type RatingDb } from "@/server/rating";
import { ensureStreakBonus } from "@/server/streak-bonus";
import type { SupabaseClient } from "@supabase/supabase-js";

const row = (id: string, name: string, rank: number, score: number, eligible = true): LeaderboardRow => ({
  rank,
  student_id: id,
  display_name: name,
  score,
  eligible,
});

const fakeDb = (rows: LeaderboardRow[], cohort: string | null = "c1"): RatingDb => ({
  cohortId: async () => cohort,
  leaderboard: async () => rows,
});

describe("getRatingWith", () => {
  it("splits podium, rows, own row; ties share a rank; ineligible last", async () => {
    const r = await getRatingWith(
      fakeDb([
        row("e", "Eva K.", 5, 3.2),
        row("a", "Ali V.", 1, 4.8),
        row("c", "Cami R.", 2, 4.5),
        row("b", "Bek S.", 2, 4.5),
        row("d", "Dilya M.", 4, 4.0),
        row("z", "Zara P.", 6, 4.9, false),
      ]),
      "d",
      "speaking",
      "week",
    );
    expect(r.podium.map((p) => p.student_id)).toEqual(["a", "b", "c"]);
    expect(r.rows.map((p) => p.student_id)).toEqual(["d", "e"]);
    expect(r.ineligible.map((p) => p.student_id)).toEqual(["z"]);
    expect(r.own?.student_id).toBe("d");
    expect(r.empty).toBe(false);
  });

  it("is empty without rows or without an enrollment", async () => {
    expect((await getRatingWith(fakeDb([]), "x", "xp", "month")).empty).toBe(true);
    const none = await getRatingWith(fakeDb([row("a", "A.", 1, 1)], null), "x", "xp", "month");
    expect(none.empty).toBe(true);
    expect(none.own).toBeNull();
  });
});

describe("Podium", () => {
  const three = [row("a", "Ali V.", 1, 100), row("b", "Bek S.", 2, 80), row("c", "Cami R.", 3, 60)];

  it("renders places in 2-1-3 order", () => {
    render(<Podium entries={three} kind="xp" />);
    const slots = screen.getAllByRole("listitem").map((li) => li.getAttribute("data-slot"));
    expect(slots).toEqual(["2", "1", "3"]);
    expect(screen.getByText("100 XP")).toBeInTheDocument();
  });

  it("leaves empty slots when fewer than 3 students and highlights own", () => {
    const { container } = render(<Podium entries={three.slice(0, 1)} kind="speaking" ownId="a" />);
    expect(container.querySelectorAll("[data-empty]")).toHaveLength(2);
    expect(container.querySelector("[data-own]")).toHaveAttribute("data-slot", "1");
    expect(screen.getByText("100.0 ball")).toBeInTheDocument();
  });
});

describe("RankRow", () => {
  it("highlights own row and shows the threshold chip for ineligible", () => {
    const { rerender, container } = render(
      <ul>
        <RankRow row={row("a", "Ali V.", 4, 10)} kind="xp" own />
      </ul>,
    );
    expect(container.querySelector("[data-own]")).toBeInTheDocument();
    expect(screen.getByText("(Siz)")).toBeInTheDocument();
    rerender(
      <ul>
        <RankRow row={row("b", "Bek S.", 9, 3, false)} kind="speaking" />
      </ul>,
    );
    expect(container.querySelector("[data-own]")).toBeNull();
    expect(screen.getByText("Kamida 8 ta topshiriq kerak")).toBeInTheDocument();
  });
});

describe("PrizeBanner", () => {
  it("shows only on the speaking tab", () => {
    const { rerender } = render(<PrizeBanner kind="speaking" />);
    expect(screen.getByText(/top-3 ustozdan sovg'a oladi/)).toBeInTheDocument();
    rerender(<PrizeBanner kind="xp" />);
    expect(screen.queryByText(/sovg'a/)).toBeNull();
  });
});

describe("RatingTabs", () => {
  it("renders real links with aria-current and keeps the other param", () => {
    render(<RatingTabs kind="xp" period="month" />);
    const xp = screen.getByRole("link", { name: "XP" });
    expect(xp.tagName).toBe("A");
    expect(xp).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Gapirish" })).toHaveAttribute("href", "/rating?kind=speaking&period=month");
    expect(screen.getByRole("link", { name: "Gapirish" })).not.toHaveAttribute("aria-current");
    expect(screen.getByRole("link", { name: "Oy" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Hafta" })).toHaveAttribute("href", "/rating?kind=xp&period=week");
    expect(within(screen.getByRole("navigation", { name: "Davr" })).getAllByRole("link")).toHaveLength(2);
  });
});

describe("StreakCelebration", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  it("shows once per milestone and day, dismisses with Davom etish", async () => {
    const { unmount } = render(<StreakCelebration streak={7} day="2026-11-10" />);
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    await act(async () => screen.getByRole("button", { name: "Davom etish" }).click());
    expect(screen.queryByRole("dialog")).toBeNull();
    unmount();
    render(<StreakCelebration streak={7} day="2026-11-10" />);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(window.localStorage.getItem("streak-celebrated-7-2026-11-10")).toBe("1");
  });

  it("does not show for non-milestones", () => {
    render(<StreakCelebration streak={8} day="2026-11-10" />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("still renders when storage throws", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    render(<StreakCelebration streak={14} day="2026-11-10" />);
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });
});

describe("ensureStreakBonus", () => {
  const NOW = new Date("2026-11-10T07:00:00Z"); // 2026-11-10 Tashkent

  function days(n: number, endDay = "2026-11-10") {
    const [y, m, d] = endDay.split("-").map(Number);
    const end = Date.UTC(y, m - 1, d);
    return Array.from({ length: n }, (_, i) => ({ day: new Date(end - i * 86_400_000).toISOString().slice(0, 10) }));
  }

  function setup(activity: { day: string }[], userId = "s1") {
    const seen = new Set<string>();
    const rpc = vi.fn(async (_fn: string, args: { p_ref: string }) => {
      const fresh = !seen.has(args.p_ref);
      seen.add(args.p_ref);
      return { data: fresh, error: null };
    });
    const chain = {
      select: () => chain,
      eq: () => chain,
      gt: () => chain,
      order: () => chain,
      limit: async () => ({ data: activity, error: null }),
    };
    const client = {
      auth: { getUser: async () => ({ data: { user: { id: userId } } }) },
      from: () => chain,
    } as unknown as SupabaseClient;
    return { client, rpc, deps: { now: NOW, service: () => ({ rpc }) as never } };
  }

  it("awards a milestone once (idempotent across visits)", async () => {
    const { client, rpc, deps } = setup(days(7));
    const a = await ensureStreakBonus(client, "s1", deps);
    const b = await ensureStreakBonus(client, "s1", deps);
    expect(a).toMatchObject({ milestone: 7, awarded: true });
    expect(b).toMatchObject({ milestone: 7, awarded: false });
    expect(rpc).toHaveBeenCalledWith("award_xp", {
      p_student: "s1",
      p_amount: 50,
      p_reason: "streak_bonus",
      p_ref: "streak:7:2026-11-10",
    });
  });

  it("pays 100 for 14 and 200 for 30", async () => {
    const s14 = setup(days(14));
    await ensureStreakBonus(s14.client, "s1", s14.deps);
    expect(s14.rpc.mock.calls[0][1]).toMatchObject({ p_amount: 100 });
    const s30 = setup(days(30));
    await ensureStreakBonus(s30.client, "s1", s30.deps);
    expect(s30.rpc.mock.calls[0][1]).toMatchObject({ p_amount: 200 });
  });

  it("does nothing for non-milestones or when today is inactive", async () => {
    const s = setup(days(8));
    expect(await ensureStreakBonus(s.client, "s1", s.deps)).toMatchObject({ milestone: null, awarded: false });
    const y = setup(days(7, "2026-11-09"));
    expect((await ensureStreakBonus(y.client, "s1", y.deps)).milestone).toBeNull();
    expect(s.rpc).not.toHaveBeenCalled();
    expect(y.rpc).not.toHaveBeenCalled();
  });

  it("a gap resets the streak: no bonus", async () => {
    const s = setup(days(7).filter((_, i) => i !== 3));
    expect((await ensureStreakBonus(s.client, "s1", s.deps)).milestone).toBeNull();
    expect(s.rpc).not.toHaveBeenCalled();
  });

  it("6 days of activity pays nothing, and reports today", async () => {
    const s = setup(days(6));
    const r = await ensureStreakBonus(s.client, "s1", s.deps);
    expect(r).toMatchObject({ milestone: null, awarded: false, streak: 6, today: "2026-11-10" });
    expect(s.rpc).not.toHaveBeenCalled();
  });

  it("never acts for a student other than the session user", async () => {
    const s = setup(days(7), "someone-else");
    expect((await ensureStreakBonus(s.client, "s1", s.deps)).milestone).toBeNull();
    expect(s.rpc).not.toHaveBeenCalled();
  });
});
