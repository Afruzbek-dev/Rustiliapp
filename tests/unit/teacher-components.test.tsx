import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ActivityChart, formatDay, niceTop } from "@/components/staff/ActivityChart";
import type { ActionState, StaffAction } from "@/components/staff/action-state";
import { CuratorTable } from "@/components/staff/CuratorTable";
import { IdleStudents, daysSince } from "@/components/staff/IdleStudents";
import { KpiTile } from "@/components/staff/KpiTile";
import { LessonCompletion } from "@/components/staff/LessonCompletion";
import { RequestsCard } from "@/components/staff/RequestsCard";

const days = Array.from({ length: 14 }, (_, i) => ({ day: `2026-11-${String(i + 1).padStart(2, "0")}`, active: i === 13 ? 8 : i }));

describe("ActivityChart", () => {
  it("every bar is a button with an aria-label", () => {
    render(<ActivityChart data={days} />);
    const bars = screen.getAllByRole("button");
    expect(bars).toHaveLength(14);
    expect(bars[13]).toHaveAccessibleName("14 noy: 8 ta faol o'quvchi");
    expect(bars[0]).toHaveAccessibleName("1 noy: 0 ta faol o'quvchi");
  });

  it("shows a tooltip on focus and hover, hides it on blur/leave", async () => {
    render(<ActivityChart data={days} />);
    const bar = screen.getByRole("button", { name: /5 noy/ });
    expect(screen.queryByRole("tooltip")).toBeNull();
    bar.focus();
    expect(await screen.findByRole("tooltip")).toHaveTextContent("5 noy: 4 ta faol o'quvchi");
    bar.blur();
    await waitFor(() => expect(screen.queryByRole("tooltip")).toBeNull());
    await userEvent.hover(screen.getByRole("button", { name: /10 noy/ }));
    expect(screen.getByRole("tooltip")).toHaveTextContent("10 noy");
    await userEvent.unhover(screen.getByRole("button", { name: /10 noy/ }));
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("the y-axis tick column is offset like the plot area, so ticks sit on the gridlines", () => {
    const { container } = render(<ActivityChart data={days} />);
    const ticks = container.querySelector("div.h-44.flex-col")!;
    expect(ticks.className).toContain("mt-10");
    expect(ticks.className).not.toContain("pt-10");
  });

  it("offers the same numbers as a table inside <details>", () => {
    const { container } = render(<ActivityChart data={days} />);
    const details = container.querySelector("details")!;
    expect(details).not.toBeNull();
    expect(within(details).getByText("Jadval ko'rinishi")).toBeInTheDocument();
    const rows = within(details).getAllByRole("row", { hidden: true });
    expect(rows).toHaveLength(15); // header + 14 days
    expect(within(details).getByRole("columnheader", { name: "Faol o'quvchilar", hidden: true })).toBeInTheDocument();
  });

  it("single series colour from the token, thin marks, 4px rounded ends, y axis 0 / half / top", () => {
    const { container } = render(<ActivityChart data={days} />);
    const mark = container.querySelector("button > span.bg-info") as HTMLElement;
    expect(mark.className).toContain("w-3");
    expect(mark.className).toContain("rounded-t-[4px]");
    expect(container.innerHTML).not.toMatch(/#[0-9a-f]{6}/i);
    const axis = container.querySelector(".text-right")!;
    expect([...axis.querySelectorAll("span")].map((e) => e.textContent)).toEqual(["20", "10", "0"]); // top for max 12
  });

  it("an all-zero series still renders with a 0/2/4 axis", () => {
    const { container } = render(<ActivityChart data={days.map((d) => ({ ...d, active: 0 }))} />);
    expect(screen.getAllByRole("button")).toHaveLength(14);
    expect([...container.querySelectorAll(".text-right span")].map((e) => e.textContent)).toEqual(["4", "2", "0"]);
  });

  it("niceTop and formatDay", () => {
    expect([0, 4, 7, 20, 21, 51, 100, 101, 250].map(niceTop)).toEqual([4, 4, 10, 20, 50, 100, 100, 200, 300]);
    expect(formatDay("2026-01-05")).toBe("5 yan");
  });
});

const okAction = (message: string): StaffAction => vi.fn(async (): Promise<ActionState> => ({ status: "success", message }));
const req = (id: string, name = "Zafar Qodirov") => ({ enrollmentId: id, studentName: name, phone: "+998 ** *** ** 67" });

describe("RequestsCard", () => {
  it("empty state", () => {
    render(<RequestsCard requests={[]} approveAction={okAction("x")} rejectAction={okAction("x")} />);
    expect(screen.getByText("Yangi so'rovlar yo'q")).toBeInTheDocument();
  });

  it("lists name and masked phone with Ruxsat and Rad etish buttons", () => {
    render(<RequestsCard requests={[req("e1")]} approveAction={okAction("x")} rejectAction={okAction("x")} />);
    expect(screen.getByText("Zafar Qodirov")).toBeInTheDocument();
    expect(screen.getByText("+998 ** *** ** 67")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ruxsat" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Rad etish" })).toBeEnabled();
  });

  it("posts the enrollment id and shows the outcome, which stays after the row disappears", async () => {
    const approve = vi.fn(async (_prev: ActionState, fd: FormData): Promise<ActionState> => {
      expect(fd.get("enrollmentId")).toBe("e1");
      return { status: "success", message: "Ochildi" };
    });
    const { rerender } = render(<RequestsCard requests={[req("e1")]} approveAction={approve} rejectAction={okAction("x")} />);
    await userEvent.click(screen.getByRole("button", { name: "Ruxsat" }));
    expect(await screen.findByText("Ochildi")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Ruxsat" })).toBeNull();
    // the page revalidates and the request is no longer pending
    rerender(<RequestsCard requests={[]} approveAction={approve} rejectAction={okAction("x")} />);
    expect(screen.getByText("Ochildi")).toBeInTheDocument();
    expect(screen.getByText("Zafar Qodirov")).toBeInTheDocument();
  });

  it("shows closed-cohort and forbidden errors and keeps the buttons", async () => {
    const closed: StaffAction = async () => ({ status: "error", message: "Guruh yopilgan" });
    render(<RequestsCard requests={[req("e1")]} approveAction={closed} rejectAction={okAction("x")} />);
    await userEvent.click(screen.getByRole("button", { name: "Ruxsat" }));
    expect(await screen.findByText("Guruh yopilgan")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ruxsat" })).toBeInTheDocument();
  });

  it("reject posts through the reject action", async () => {
    const reject = vi.fn(async (): Promise<ActionState> => ({ status: "success", message: "Rad etildi" }));
    render(<RequestsCard requests={[req("e1")]} approveAction={okAction("x")} rejectAction={reject} />);
    await userEvent.click(screen.getByRole("button", { name: "Rad etish" }));
    expect(await screen.findByText("Rad etildi")).toBeInTheDocument();
    expect(reject).toHaveBeenCalledTimes(1);
  });

  it("a successful reject after a failed approve shows the reject result and settles the row", async () => {
    const approve: StaffAction = async () => ({ status: "error", message: "Xatolik yuz berdi" });
    const reject: StaffAction = async () => ({ status: "success", message: "Rad etildi" });
    render(<RequestsCard requests={[req("e1")]} approveAction={approve} rejectAction={reject} />);
    await userEvent.click(screen.getByRole("button", { name: "Ruxsat" }));
    expect(await screen.findByText("Xatolik yuz berdi")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Rad etish" }));
    expect(await screen.findByText("Rad etildi")).toBeInTheDocument();
    expect(screen.queryByText("Xatolik yuz berdi")).toBeNull();
    expect(screen.queryByRole("button", { name: "Rad etish" })).toBeNull();
  });
});

describe("IdleStudents", () => {
  const s = (over = {}) => ({
    studentId: "s1",
    name: "Ali Valiyev",
    telegramLinked: true,
    lastActive: "2026-11-06",
    lastPartTitle: "Grammatika",
    remindedToday: false,
    ...over,
  });

  it("empty state", () => {
    render(<IdleStudents students={[]} cohortId="c1" today="2026-11-11" remindAction={okAction("x")} />);
    expect(screen.getByText("Hamma faol")).toBeInTheDocument();
  });

  it("shows days idle and the last lesson part; the reminder posts student and cohort ids", async () => {
    const remind = vi.fn(async (_p: ActionState, fd: FormData): Promise<ActionState> => {
      expect([fd.get("studentId"), fd.get("cohortId")]).toEqual(["s1", "c1"]);
      return { status: "success", message: "Eslatma yuborildi" };
    });
    render(<IdleStudents students={[s()]} cohortId="c1" today="2026-11-11" remindAction={remind} />);
    expect(screen.getByText(/5 kun oldin faol bo'lgan · Grammatika/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /eslatma/i }));
    expect(await screen.findByText("Eslatma yuborildi")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /eslatma/i })).toBeDisabled();
  });

  it("disables the button without Telegram or after today's reminder", () => {
    render(
      <IdleStudents
        students={[s({ studentId: "a", name: "A", telegramLinked: false, lastActive: null }), s({ studentId: "b", name: "B", remindedToday: true })]}
        cohortId="c1"
        today="2026-11-11"
        remindAction={okAction("x")}
      />,
    );
    expect(screen.getByText(/Hali faol bo'lmagan/)).toBeInTheDocument();
    expect(screen.getByText("Telegram ulanmagan")).toBeInTheDocument();
    expect(screen.getByText("Bugun yuborilgan")).toBeInTheDocument();
    for (const b of screen.getAllByRole("button")) expect(b).toBeDisabled();
  });

  it("daysSince", () => {
    expect(daysSince("2026-11-11", "2026-11-08")).toBe(3);
    expect(daysSince("2026-11-11", "2026-11-12")).toBe(0);
  });
});

describe("CuratorTable", () => {
  const row = (over = {}) => ({ groupId: "g", groupName: "Guruh A", curatorName: "Kurator", students: 10, pendingQueue: 3, avgScore: 4.256, avgResponseHours: 2.5, ...over });

  it("renders values; a queue above 15 gets the fire chip, 15 does not", () => {
    render(<CuratorTable rows={[row(), row({ groupId: "h", groupName: "Guruh B", pendingQueue: 16 }), row({ groupId: "i", groupName: "Guruh C", pendingQueue: 15 })]} />);
    const rows = screen.getAllByRole("row");
    expect(within(rows[1]!).getByText("4.26")).toBeInTheDocument();
    expect(within(rows[1]!).getByText("2.5 soat")).toBeInTheDocument();
    expect(rows[2]!.querySelector(".bg-fire-bg")).not.toBeNull();
    expect(rows[1]!.querySelector(".bg-fire-bg")).toBeNull();
    expect(rows[3]!.querySelector(".bg-fire-bg")).toBeNull();
  });

  it("missing numbers and curators render as placeholders; empty list message", () => {
    const { rerender } = render(<CuratorTable rows={[row({ avgScore: null, avgResponseHours: null, curatorName: "" })]} />);
    expect(screen.getAllByText("—")).toHaveLength(2);
    expect(screen.getByText("Tayinlanmagan")).toBeInTheDocument();
    rerender(<CuratorTable rows={[]} />);
    expect(screen.getByText(/hali yo'q/)).toBeInTheDocument();
  });
});

describe("LessonCompletion and KpiTile", () => {
  it("bars with accessible percentages; zero students do not divide by zero", () => {
    render(
      <LessonCompletion
        rows={[
          { lessonId: "1", title: "Dars 1", completed: 1, total: 4 },
          { lessonId: "2", title: "Dars 2", completed: 0, total: 0 },
        ]}
      />,
    );
    expect(screen.getByRole("progressbar", { name: "Dars 1: 25%" })).toHaveAttribute("aria-valuenow", "1");
    expect(screen.getByRole("progressbar", { name: "Dars 2: 0%" })).toBeInTheDocument();
  });

  it("empty lessons message", () => {
    render(<LessonCompletion rows={[]} />);
    expect(screen.getByText(/Hali darslar/)).toBeInTheDocument();
  });

  it("KpiTile shows label, value and hint in ink tokens", () => {
    const { container } = render(<KpiTile icon={<span />} label="Bugun faol" value={7} hint="jami 9 ta" />);
    expect(screen.getByText("7")).toBeInTheDocument();
    expect(screen.getByText("jami 9 ta")).toBeInTheDocument();
    expect(container.innerHTML).not.toMatch(/#[0-9a-f]{3,6}\b/i);
  });
});
