import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  requireStaff: vi.fn(),
  listCohorts: vi.fn(),
  getDashboard: vi.fn(),
  remindedToday: vi.fn(),
}));

vi.mock("@/server/guards", () => ({ requireStaff: m.requireStaff }));
vi.mock("@/app/(staff)/teacher/actions", () => ({
  approveRequestAction: vi.fn(),
  rejectRequestAction: vi.fn(),
  remindStudentAction: vi.fn(),
}));
vi.mock("@/server/teacher-reminders", () => ({ remindedToday: m.remindedToday }));
vi.mock("@/server/teacher-stats", async (orig) => ({
  ...(await orig<typeof import("@/server/teacher-stats")>()),
  listCohorts: m.listCohorts,
  getTeacherDashboard: m.getDashboard,
}));

import TeacherDashboardPage from "@/app/(staff)/teacher/page";
import ComingSoonPage from "@/app/(staff)/teacher/[...slug]/page";
import Loading from "@/app/(staff)/teacher/loading";
import TeacherError from "@/app/(staff)/teacher/error";

const dashboard = {
  kpis: { activeStudents: 12, totalStudents: 15, pendingRequests: 2, activeToday: 7, unreviewedSubmissions: 5, avgProgress: 3.5 },
  activity: Array.from({ length: 14 }, (_, i) => ({ day: `2026-11-${String(i + 1).padStart(2, "0")}`, active: i })),
  lessons: [{ lessonId: "l1", title: "Dars 1", completed: 6, total: 12 }],
  curators: [{ groupId: "g1", groupName: "Guruh A", curatorName: "Kurator", students: 12, pendingQueue: 20, avgScore: 4, avgResponseHours: 3 }],
  idle: [{ studentId: "s1", name: "Ali Valiyev", telegramLinked: true, lastActive: null, lastPartTitle: null }],
  requests: [{ enrollmentId: "e1", studentName: "Zafar Qodirov", phone: "+998 ** *** ** 67", requestedAt: "2026-11-10T00:00:00Z" }],
};

beforeEach(() => {
  vi.clearAllMocks();
  m.requireStaff.mockResolvedValue({ user: { id: "t1" }, role: "teacher" });
  m.remindedToday.mockResolvedValue(new Set());
  m.getDashboard.mockResolvedValue(dashboard);
  m.listCohorts.mockResolvedValue([
    { id: "c-new", name: "Potok 2", startsOn: "2026-11-01" },
    { id: "c-old", name: "Potok 1", startsOn: "2026-09-01" },
  ]);
});

const sp = (v: Record<string, string> = {}) => Promise.resolve(v);

describe("teacher dashboard page", () => {
  it("defaults to the newest cohort and renders every block", async () => {
    render(await TeacherDashboardPage({ searchParams: sp() }));
    expect(m.getDashboard).toHaveBeenCalledWith("c-new");
    expect(screen.getByRole("heading", { level: 1, name: "Bosh panel" })).toBeInTheDocument();
    expect(screen.getAllByText("Faol o'quvchilar").length).toBeGreaterThan(0);
    expect(screen.getAllByText("12").length).toBeGreaterThan(0);
    expect(screen.getAllByRole("button", { name: /faol o'quvchi$/ })).toHaveLength(14);
    expect(screen.getByRole("button", { name: "Ruxsat" })).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "Dars 1: 50%" })).toBeInTheDocument();
    expect(screen.getByText("Guruh A")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Ali Valiyev/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Potok 1" })).toHaveAttribute("href", "/teacher?cohort=c-old");
  });

  it("honours ?cohort= and ignores a cohort the teacher cannot see", async () => {
    render(await TeacherDashboardPage({ searchParams: sp({ cohort: "c-old" }) }));
    expect(m.getDashboard).toHaveBeenLastCalledWith("c-old");
    await TeacherDashboardPage({ searchParams: sp({ cohort: "someone-elses" }) });
    expect(m.getDashboard).toHaveBeenLastCalledWith("c-new");
  });

  it("marks students already reminded today", async () => {
    m.remindedToday.mockResolvedValue(new Set(["s1"]));
    render(await TeacherDashboardPage({ searchParams: sp() }));
    expect(screen.getByRole("button", { name: /Ali Valiyev/ })).toBeDisabled();
  });

  it("empty state when the teacher has no cohorts", async () => {
    m.listCohorts.mockResolvedValue([]);
    render(await TeacherDashboardPage({ searchParams: sp() }));
    expect(screen.getByText("Hali guruh yo'q")).toBeInTheDocument();
    expect(m.getDashboard).not.toHaveBeenCalled();
  });

  it("a failing query throws, so error.tsx takes over", async () => {
    m.getDashboard.mockRejectedValue(new Error("rpc failed"));
    await expect(TeacherDashboardPage({ searchParams: sp() })).rejects.toThrow("rpc failed");
  });
});

describe("states", () => {
  it("loading skeleton is announced", () => {
    render(<Loading />);
    expect(screen.getByRole("status")).toHaveTextContent("Yuklanmoqda");
  });

  it("error boundary offers a retry", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const reset = vi.fn();
    render(<TeacherError error={new Error("x")} reset={reset} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Panelni yuklab bo'lmadi");
    screen.getByRole("button", { name: "Qayta urinish" }).click();
    expect(reset).toHaveBeenCalled();
  });

  it("not-yet-built sections show 'Tez orada' behind the staff guard", async () => {
    render(await ComingSoonPage());
    expect(screen.getByText("Tez orada")).toBeInTheDocument();
    expect(m.requireStaff).toHaveBeenCalled();
  });
});
