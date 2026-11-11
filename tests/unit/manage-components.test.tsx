import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { ActionState, StaffAction } from "@/components/staff/action-state";
import { ActionForm } from "@/components/staff/manage/ActionForm";
import { CohortsPanel } from "@/components/staff/manage/CohortsPanel";
import { CuratorsPanel } from "@/components/staff/manage/CuratorsPanel";
import { Pagination } from "@/components/staff/manage/Pagination";
import { StudentActions } from "@/components/staff/manage/StudentActions";
import { StudentFilters, studentsHref } from "@/components/staff/manage/StudentFilters";
import { StudentTable } from "@/components/staff/manage/StudentTable";
import { formatDay, formatInstantDay } from "@/components/staff/manage/status";
import type { StudentDetail, StudentRow } from "@/server/manage-read";

const ok: StaffAction = async () => ({ status: "success", message: "Bajarildi" });
const noop = vi.fn<StaffAction>(async () => ({ status: "success", message: "Bajarildi" }));
const handlers = { approve: noop, reject: noop, expire: noop, move: noop, setExpiry: noop, linkTelegram: noop };

const row = (over: Partial<StudentRow> = {}): StudentRow => ({
  enrollmentId: "e1", studentId: "s1", name: "Madina Rahimova", phone: "+998 ** *** ** 33", telegramLinked: true, telegramUsername: null,
  status: "active", expiresAt: null, groupId: "g1", groupName: "Guruh A", partsCompleted: 2, partsTotal: 5, lastActive: "2026-03-04", requestedAt: "x", ...over,
});
const groups = [{ id: "g1", name: "Guruh A" }, { id: "g2", name: "Guruh B" }];

describe("StudentTable", () => {
  const base = { cohortId: "c1", groups, filtered: false, approveAction: ok, rejectAction: ok, bulkMoveAction: ok };

  it("shows the empty state, with a filter-specific text when filtered", () => {
    const { rerender } = render(<StudentTable {...base} rows={[]} />);
    expect(screen.getByText("Hali o'quvchilar yo'q")).toBeInTheDocument();
    rerender(<StudentTable {...base} rows={[]} filtered />);
    expect(screen.getByText("Hech kim topilmadi")).toBeInTheDocument();
  });

  it("renders the columns: masked phone, telegram, status, group, progress, last activity", () => {
    render(<StudentTable {...base} rows={[row(), row({ enrollmentId: "e2", name: "Bobur", phone: "+998 ** *** ** 44", telegramLinked: false, status: "pending", groupName: null, partsTotal: 0, lastActive: null })]} />);
    const table = screen.getByRole("table", { name: "O'quvchilar ro'yxati" });
    expect(within(table).getByRole("link", { name: "Madina Rahimova" })).toHaveAttribute("href", "/teacher/students/e1");
    expect(within(table).getByText("+998 ** *** ** 33")).toBeInTheDocument();
    expect(within(table).getByText("Ulangan")).toBeInTheDocument();
    expect(within(table).getByText("Ulanmagan")).toBeInTheDocument();
    expect(within(table).getByText("2 / 5")).toBeInTheDocument();
    expect(within(table).getByText("04.03.2026")).toBeInTheDocument();
    expect(table.parentElement).toHaveClass("overflow-x-auto");
    // only the pending row has quick approve/reject
    expect(within(table).getAllByRole("button", { name: "Ruxsat" })).toHaveLength(1);
    expect(within(table).getAllByRole("button", { name: "Rad etish" })).toHaveLength(1);
  });

  it("bulk move: select rows, choose a group, submit the ids", async () => {
    const bulk = vi.fn<StaffAction>(async (_p, fd) => ({ status: "success", message: `ok ${fd.getAll("enrollmentIds").join(",")}|${String(fd.get("groupId"))}` }));
    render(<StudentTable {...base} bulkMoveAction={bulk} rows={[row(), row({ enrollmentId: "e2", name: "Bobur" })]} />);
    expect(screen.queryByText(/Tanlangan/)).toBeNull();
    await userEvent.click(screen.getByRole("checkbox", { name: "Madina Rahimova tanlash" }));
    await userEvent.click(screen.getByRole("checkbox", { name: "Bobur tanlash" }));
    expect(screen.getByText(/Tanlangan: 2 ta/)).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText("Guruhga ko'chirish"), "g2");
    await userEvent.click(screen.getByRole("button", { name: /Ko'chirish/ }));
    expect(await screen.findByText("ok e1,e2|g2")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText(/Tanlangan/)).toBeNull()); // selection cleared, result stays visible
    expect(screen.getByText("ok e1,e2|g2")).toBeInTheDocument();
  });

  it("shows the bulk error from the server", async () => {
    const bulk: StaffAction = async () => ({ status: "error", message: "Sizda bu amal uchun ruxsat yo'q" });
    render(<StudentTable {...base} bulkMoveAction={bulk} rows={[row()]} />);
    await userEvent.click(screen.getByRole("checkbox", { name: "Madina Rahimova tanlash" }));
    await userEvent.click(screen.getByRole("button", { name: /Ko'chirish/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Sizda bu amal uchun ruxsat yo'q");
    expect(screen.getByText(/Tanlangan: 1 ta/)).toBeInTheDocument(); // selection kept on failure
  });

  it("select-all toggles the page", async () => {
    render(<StudentTable {...base} rows={[row(), row({ enrollmentId: "e2", name: "Bobur" })]} />);
    await userEvent.click(screen.getByRole("checkbox", { name: "Sahifadagi hammasini tanlash" }));
    expect(screen.getByText(/Tanlangan: 2 ta/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("checkbox", { name: "Sahifadagi hammasini tanlash" }));
    expect(screen.queryByText(/Tanlangan/)).toBeNull();
  });
});

describe("StudentFilters and Pagination", () => {
  const counts = { total: 9, active: 5, pending: 2, expired: 1, rejected: 1, ungrouped: 3 };
  const params = { search: "ali", status: "pending" as const, groupId: null, ungrouped: true, page: 1 };

  it("is a GET search form with status chips carrying counts, keeping the other filters", () => {
    render(<StudentFilters cohortId="c1" params={params} counts={counts} groups={groups} />);
    const form = screen.getByRole("search");
    expect(form).toHaveAttribute("method", "get");
    expect(within(form).getByLabelText("Qidiruv")).toHaveValue("ali");
    expect(within(form).getByLabelText("Kurator guruhi")).toHaveValue("none");
    const chips = screen.getByRole("navigation", { name: "Holat bo'yicha filtr" });
    expect(within(chips).getByRole("link", { name: /Kutmoqda 2/ })).toHaveAttribute("aria-current", "page");
    expect(within(chips).getByRole("link", { name: /Faol 5/ })).toHaveAttribute("href", "/teacher/students?cohort=c1&q=ali&status=active&group=none");
    expect(within(chips).getByRole("link", { name: /Hammasi 9/ }).getAttribute("href")).not.toContain("status=");
  });

  it("builds short URLs and paginates", () => {
    expect(studentsHref("c1", { page: 1 })).toBe("/teacher/students?cohort=c1");
    expect(studentsHref("c1", { groupId: "g", page: 3 })).toBe("/teacher/students?cohort=c1&group=g&page=3");
    const { rerender } = render(<Pagination page={1} pageSize={25} total={60} hrefFor={(p) => `/x?page=${p}`} />);
    expect(screen.getByText("1–25 / 60")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Keyingi/ })).toHaveAttribute("href", "/x?page=2");
    expect(screen.queryByRole("link", { name: /Oldingi/ })).toBeNull();
    rerender(<Pagination page={3} pageSize={25} total={60} hrefFor={(p) => `/x?page=${p}`} />);
    expect(screen.getByText("51–60 / 60")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Keyingi/ })).toBeNull();
    expect(screen.getByRole("link", { name: /Oldingi/ })).toHaveAttribute("href", "/x?page=2");
    rerender(<Pagination page={1} pageSize={25} total={0} hrefFor={() => "/x"} />);
    expect(screen.queryByRole("navigation")).toBeNull();
  });
});

describe("ActionForm", () => {
  it("shows the pending state, then the result; errors use role=alert", async () => {
    let finish!: (s: ActionState) => void;
    const action: StaffAction = () => new Promise<ActionState>((r) => (finish = r));
    render(<ActionForm action={action} submitLabel="Saqlash"><input name="a" aria-label="a" /></ActionForm>);
    await userEvent.click(screen.getByRole("button", { name: "Saqlash" }));
    await waitFor(() => expect(screen.getByRole("button", { name: /Saqlash/ })).toBeDisabled());
    finish({ status: "error", message: "Xato bor" });
    expect(await screen.findByRole("alert")).toHaveTextContent("Xato bor");
  });
});

describe("StudentActions", () => {
  const detail = (over: Partial<StudentDetail> = {}): StudentDetail => ({
    enrollmentId: "e1", cohortId: "c1", cohortName: "Potok 1", studentId: "s1", name: "Madina", phone: null, telegramLinked: false, telegramUsername: null,
    canLinkTelegram: false, status: "active", expiresAt: null, groupId: "g1", groupName: "Guruh A", xp: 0, streak: 0, lastActive: null,
    attemptsTotal: 0, attemptsCorrect: 0, lessons: [], submissions: [], groups, ...over,
  });
  const now = new Date("2026-03-05T10:00:00Z");

  it("pending: approve (with group choice) and reject", () => {
    render(<StudentActions detail={detail({ status: "pending", groupId: null, groupName: null })} handlers={handlers} now={now} />);
    expect(screen.getByRole("button", { name: "Ruxsat berish" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Rad etish" })).toBeInTheDocument();
    expect(screen.getByLabelText("Kurator guruhi")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Muddatni yangilash" })).toBeNull();
  });

  it("active: move, extend and end; the date picker only allows the future", () => {
    render(<StudentActions detail={detail()} handlers={handlers} now={now} />);
    expect(screen.getByRole("button", { name: "Saqlash" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Kursni hozir tugatish" })).toBeInTheDocument();
    const date = screen.getByLabelText("Yangi sana");
    expect(date).toHaveAttribute("min", "2026-03-06");
    expect(date).toHaveValue("2026-04-04");
    expect(screen.queryByRole("button", { name: "Ruxsat berish" })).toBeNull();
  });

  it("rejected: only re-approval; no move or expiry", () => {
    render(<StudentActions detail={detail({ status: "rejected" })} handlers={handlers} now={now} />);
    expect(screen.getByRole("button", { name: "Qayta ruxsat berish" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Guruh")).toBeNull();
    expect(screen.queryByLabelText("Yangi sana")).toBeNull();
  });

  it("manual Telegram link is offered only for a profile with a phone and no telegram", async () => {
    const { rerender } = render(<StudentActions detail={detail()} handlers={handlers} now={now} />);
    expect(screen.queryByLabelText("Telegram ID (raqam)")).toBeNull();
    const link = vi.fn<StaffAction>(async (_p, fd) => ({ status: "success", message: `linked ${String(fd.get("telegramId"))} ${String(fd.get("profileId"))}` }));
    rerender(<StudentActions detail={detail({ canLinkTelegram: true })} handlers={{ ...handlers, linkTelegram: link }} now={now} />);
    await userEvent.type(screen.getByLabelText("Telegram ID (raqam)"), "123456789");
    await userEvent.click(screen.getByRole("button", { name: "Ulash" }));
    expect(await screen.findByText("linked 123456789 s1")).toBeInTheDocument();
  });
});

describe("CohortsPanel", () => {
  const cohort = (over = {}) => ({
    cohortId: "c1", courseId: "k1", courseTitle: "Rus tili", name: "Potok 1", startsOn: "2026-09-01", endsOn: "2026-12-01", accessUntil: null,
    enrollmentOpen: true, activeStudents: 4, pendingStudents: 1, groupCount: 2, ...over,
  });
  const h = { create: noop, update: noop, setAccess: noop };

  it("empty state with the create form; no courses explains why", () => {
    const { rerender } = render(<CohortsPanel cohorts={[]} courses={[{ id: "k1", title: "Rus tili" }]} handlers={h} links={{ bot: null, site: null }} />);
    expect(screen.getByText("Hali guruh yo'q")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Yaratish" })).toBeInTheDocument();
    rerender(<CohortsPanel cohorts={[]} courses={[]} handlers={h} links={{ bot: null, site: null }} />);
    expect(screen.getByText(/avval kurs kerak/)).toBeInTheDocument();
  });

  it("open cohort offers closing; closed cohort offers opening with a future date; share links are shown", () => {
    const now = new Date("2026-03-05T10:00:00Z");
    const { rerender } = render(<CohortsPanel cohorts={[cohort()]} courses={[]} handlers={h} links={{ bot: "https://t.me/rus_bot", site: "https://app.test/login" }} now={now} />);
    expect(screen.getByText("Qabul ochiq")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Qabulni yopish" })).toBeInTheDocument();
    expect(screen.getByDisplayValue("https://t.me/rus_bot")).toHaveAttribute("readonly");
    expect(screen.getByDisplayValue("https://app.test/login")).toBeInTheDocument();
    expect(screen.getByText(/Faol:/).textContent).toContain("4");
    rerender(<CohortsPanel cohorts={[cohort({ enrollmentOpen: false })]} courses={[]} handlers={h} links={{ bot: null, site: null }} now={now} />);
    expect(screen.getByText("Qabul yopiq")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Qabulni ochish" })).toBeInTheDocument();
    expect(screen.getByLabelText("Qabul ochiq: sanagacha")).toHaveAttribute("min", "2026-03-06");
    expect(screen.getByText(/Havola sozlanmagan/)).toBeInTheDocument();
  });

  it("the edit form does not carry the access date (saving can never reopen a closed cohort)", () => {
    render(<CohortsPanel cohorts={[cohort({ enrollmentOpen: false })]} courses={[]} handlers={h} links={{ bot: null, site: null }} />);
    expect(screen.queryByLabelText("Kirish muddati")).toBeNull();
  });
});

describe("CuratorsPanel", () => {
  const g = (over = {}) => ({ id: "g1", name: "Guruh A", curatorId: null, curatorName: null, curatorTelegramLinked: false, telegramChatId: null, students: 3, pendingQueue: 0, ...over });
  const counts = { total: 5, active: 4, pending: 1, expired: 0, rejected: 0, ungrouped: 2 };
  const h = { createGroup: noop, updateGroup: noop, assign: noop, reassign: noop };
  const base = { cohortId: "c1", counts, candidates: null, findQuery: "", findError: null, handlers: h };

  it("empty state still offers group creation and the balance placeholder", () => {
    render(<CuratorsPanel {...base} groups={[]} />);
    expect(screen.getByText("Kurator guruhlari yo'q")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Yaratish" })).toBeInTheDocument();
    expect(screen.getByText(/Guruhsiz:/).textContent).toContain("2");
  });

  it("balance view flags a long queue and shows unassigned groups", () => {
    render(<CuratorsPanel {...base} groups={[g({ curatorId: "p", curatorName: "Kurator Bir", curatorTelegramLinked: true, pendingQueue: 20 }), g({ id: "g2", name: "Guruh B" })]} />);
    const table = screen.getByRole("table", { name: "Kuratorlar yuklanishi" });
    expect(within(table).getByText("Kurator Bir")).toBeInTheDocument();
    expect(within(table).getByText("Tayinlanmagan")).toBeInTheDocument();
    expect(within(table).getByText(/ta, navbat uzun/)).toBeInTheDocument();
    expect(table.parentElement).toHaveClass("overflow-x-auto");
  });

  it("lookup results: found profiles can be assigned; a profile without telegram is disabled; errors and empty are announced", () => {
    const cands = [
      { profileId: "p1", name: "Ali", phone: "+998 ** *** ** 11", telegramLinked: true, telegramUsername: null, role: "student" },
      { profileId: "p2", name: "Vali", phone: null, telegramLinked: false, telegramUsername: null, role: "student" },
    ];
    const { rerender } = render(<CuratorsPanel {...base} groups={[g()]} candidates={cands} findQuery="ali" />);
    expect(screen.getByRole("status")).toHaveTextContent("2 ta profil topildi");
    expect(screen.getByRole("button", { name: "Tayinlash" })).toBeInTheDocument();
    const option = screen.getByRole("option", { name: /Vali/ });
    expect(option).toBeDisabled();
    expect(screen.getByRole("option", { name: /Ali/ })).not.toBeDisabled();
    rerender(<CuratorsPanel {...base} groups={[g()]} candidates={[]} findQuery="zzz" />);
    expect(screen.getAllByText("Hech narsa topilmadi").length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: "Tayinlash" })).toBeNull();
    rerender(<CuratorsPanel {...base} groups={[g()]} candidates={null} findQuery="x" findError="Sizda bu amal uchun ruxsat yo'q" />);
    expect(screen.getByRole("alert")).toHaveTextContent("ruxsat yo'q");
  });

  it("an assigned curator can be removed; the reassign form is limited to 1..100 and needs another group", () => {
    const { rerender } = render(<CuratorsPanel {...base} groups={[g({ curatorId: "p", curatorName: "K", curatorTelegramLinked: false })]} />);
    expect(screen.getByRole("button", { name: "Kuratorni olib tashlash" })).toBeInTheDocument();
    expect(screen.getByText(/Telegram ulanmagan/)).toBeInTheDocument();
    expect(screen.queryByLabelText("Nechta (1–100)")).toBeNull(); // single group: nowhere to move to
    rerender(<CuratorsPanel {...base} groups={[g(), g({ id: "g2", name: "Guruh B" })]} />);
    const n = screen.getAllByLabelText("Nechta (1–100)")[0]!;
    expect(n).toHaveAttribute("max", "100");
    expect(n).toHaveAttribute("min", "1");
  });

  it("the review chat id field is part of the rename form", () => {
    render(<CuratorsPanel {...base} groups={[g({ telegramChatId: "-1001234567890" })]} />);
    expect(screen.getByLabelText("Tekshiruv chati ID (Telegram)")).toHaveValue("-1001234567890");
  });
});

describe("date formatting", () => {
  it("formats calendar days without timezone drift", () => {
    expect(formatDay("2026-03-04")).toBe("04.03.2026");
    expect(formatDay(null)).toBe("—");
    expect(formatDay("junk")).toBe("—");
    expect(formatInstantDay("2026-12-31T19:30:00Z")).toBe("01.01.2027"); // already next day in Tashkent
    expect(formatInstantDay(null)).toBe("—");
    expect(formatInstantDay("nope")).toBe("—");
  });
});
