import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const push = vi.fn();
const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh }) }));

import type { TestEditorActions } from "@/components/tests/editor-actions-type";
import { TestEditor } from "@/components/tests/TestEditor";
import { TestResultsTable } from "@/components/tests/TestResultsTable";
import { TestsIndex } from "@/components/tests/TestsIndex";
import type { EditorTest, EditorTestItem, TestsOverview } from "@/lib/tests/editor-types";
import { getPathWith, type PathDb } from "@/server/path";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const item = (n: number, over: Partial<EditorTestItem> = {}): EditorTestItem => ({
  exerciseId: id(300 + n), position: n, section: "grammar", lessonId: null, type: "classify", prompt: `Savol ${n}`,
  payload: { items: [{ id: `it_a${n}`, text: "книга" }], buckets: [{ id: `bk_z${n}`, label: "ж.р" }, { id: `bk_y${n}`, label: "м.р" }] },
  key: { [`it_a${n}`]: `bk_z${n}` },
  ...over,
});

const test = (over: Partial<EditorTest> = {}): EditorTest => ({
  id: id(100), title: "1-modul testi", courseTitle: "Kurs", moduleId: id(20), moduleTitle: "1-modul", published: false,
  passScore: 60, timeLimitMin: 20, maxAttempts: 1, hasAttempts: false,
  items: [item(1), item(2)], lessons: [{ id: id(30), title: "Урок 1", position: 1 }], results: [], ...over,
});

function actions(over: Partial<TestEditorActions> = {}) {
  const ok = vi.fn(async () => ({ ok: true as const }));
  return {
    createTest: vi.fn(async () => ({ ok: true as const, testId: id(100) })),
    updateTest: ok,
    addItem: vi.fn(async () => ({ ok: true as const, exerciseId: id(399) })),
    updateItem: ok,
    removeItem: ok,
    reorderItems: ok,
    setPublished: vi.fn(async () => ({ ok: true as const, warnings: [] })),
    deleteTest: ok,
    ...over,
  } as TestEditorActions & Record<keyof TestEditorActions, ReturnType<typeof vi.fn>>;
}

beforeEach(() => {
  push.mockClear();
  refresh.mockClear();
});

describe("TestEditor", () => {
  it("saves the settings (pass score, time limit, attempts)", async () => {
    const a = actions();
    render(<TestEditor test={test()} actions={a} />);
    await userEvent.clear(screen.getByLabelText("O'tish bali (%)"));
    await userEvent.type(screen.getByLabelText("O'tish bali (%)"), "75");
    await userEvent.clear(screen.getByLabelText(/Vaqt limiti/));
    await userEvent.clear(screen.getByLabelText("Urinishlar soni"));
    await userEvent.type(screen.getByLabelText("Urinishlar soni"), "2");
    await userEvent.click(screen.getByRole("button", { name: "Saqlash" }));
    await waitFor(() => expect(a.updateTest).toHaveBeenCalledWith({ testId: id(100), title: "1-modul testi", passScore: 75, timeLimitMin: null, maxAttempts: 2 }));
    expect(await screen.findByText("Sozlamalar saqlandi")).toBeInTheDocument();
    expect(refresh).toHaveBeenCalled();
  });

  it("shows server problems", async () => {
    const a = actions({ updateTest: vi.fn(async () => ({ ok: false as const, code: "invalid" as const, message: "O'tish bali 1 dan 100 gacha" })) });
    render(<TestEditor test={test()} actions={a} />);
    await userEvent.click(screen.getByRole("button", { name: "Saqlash" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("O'tish bali 1 dan 100 gacha");
  });

  it("lists items with section / type chips and reorders them", async () => {
    const a = actions();
    render(<TestEditor test={test()} actions={a} />);
    expect(screen.getByText("Mashqlar (2)")).toBeInTheDocument();
    expect(screen.getAllByText("Grammatika").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Guruhlash")).toHaveLength(2);
    expect(screen.getByRole("button", { name: "1-mashqni yuqoriga" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "1-mashqni pastga" }));
    await waitFor(() => expect(a.reorderItems).toHaveBeenCalledWith({ testId: id(100), ids: [id(302), id(301)] }));
  });

  it("removing an item needs a second click", async () => {
    const a = actions();
    render(<TestEditor test={test()} actions={a} />);
    await userEvent.click(screen.getByRole("button", { name: "2-mashqni o'chirish" }));
    expect(a.removeItem).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "2-mashqni o'chirishni tasdiqlash" }));
    await waitFor(() => expect(a.removeItem).toHaveBeenCalledWith({ testId: id(100), exerciseId: id(302) }));
  });

  it("edits an existing item with its stored payload and key (strict save)", async () => {
    const a = actions();
    render(<TestEditor test={test()} actions={a} />);
    await userEvent.click(screen.getByRole("button", { name: "1-mashqni tahrirlash" }));
    const form = screen.getByRole("heading", { name: "Mashqni tahrirlash" }).closest("form")!;
    await userEvent.selectOptions(within(form).getByLabelText("Bo'lim"), "reading");
    await userEvent.selectOptions(within(form).getByLabelText(/Qayta ko'rish darsi/), id(30));
    await userEvent.click(within(form).getByRole("button", { name: "Saqlash" }));
    await waitFor(() => expect(a.updateItem).toHaveBeenCalled());
    const call = a.updateItem.mock.calls[0][0];
    expect(call).toMatchObject({ testId: id(100), exerciseId: id(301), section: "reading", lessonId: id(30) });
    expect(call.exercise).toEqual({ type: "classify", prompt: "Savol 1", payload: item(1).payload, key: item(1).key });
    // test items never ask for per-exercise XP
    expect(screen.queryByLabelText(/XP/)).toBeNull();
  });

  it("a new empty item cannot be added until it is complete", async () => {
    const a = actions();
    render(<TestEditor test={test({ items: [] })} actions={a} />);
    expect(screen.getByText("Testda hali mashq yo'q.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Mashq qo'shish/ }));
    expect(screen.getByRole("button", { name: "Qo'shish" })).toBeDisabled();
    expect(a.addItem).not.toHaveBeenCalled();
  });

  it("publish is blocked with readable reasons until the test is ready", async () => {
    const a = actions();
    const { rerender } = render(<TestEditor test={test({ items: [], passScore: null })} actions={a} />);
    expect(screen.getByRole("button", { name: "Nashr qilish" })).toBeDisabled();
    expect(screen.getByText("Testda mashqlar yo'q")).toBeInTheDocument();
    expect(screen.getByText("O'tish bali kiritilmagan")).toBeInTheDocument();

    rerender(<TestEditor test={test()} actions={a} />);
    await userEvent.click(screen.getByRole("button", { name: "Nashr qilish" }));
    await waitFor(() => expect(a.setPublished).toHaveBeenCalledWith({ testId: id(100), published: true }));
    expect(await screen.findByText("Test nashr qilindi")).toBeInTheDocument();
  });

  it("a published test can be unpublished", async () => {
    const a = actions();
    render(<TestEditor test={test({ published: true })} actions={a} />);
    expect(screen.getByText("Nashr qilingan")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Nashrdan olish" }));
    await waitFor(() => expect(a.setPublished).toHaveBeenCalledWith({ testId: id(100), published: false }));
    expect(screen.queryByRole("button", { name: /Testni o'chirish/ })).toBeNull();
  });

  it("with student attempts the structure is frozen but settings and publishing stay", () => {
    render(<TestEditor test={test({ hasAttempts: true, published: true })} actions={actions()} />);
    expect(screen.getByText(/O'quvchilar bu testni topshirgan/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Mashq qo'shish/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /tahrirlash/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /o'chirish/ })).toBeNull();
    expect(screen.getByRole("button", { name: "Saqlash" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Nashrdan olish" })).toBeEnabled();
  });

  it("deleting a draft test needs confirmation and returns to the list", async () => {
    const a = actions();
    render(<TestEditor test={test()} actions={a} />);
    await userEvent.click(screen.getByRole("button", { name: "Testni o'chirish" }));
    expect(a.deleteTest).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Ha, testni o'chirish" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/teacher/tests"));
  });

  it("renders the results table", () => {
    render(
      <TestEditor
        test={test({ results: [{ studentId: id(1), fullName: "Aziza Karimova", attempts: 2, bestScore: 80, passed: true, lastFinishedAt: "2026-11-11T10:00:00Z", inProgress: false }] })}
        actions={actions()}
      />,
    );
    const row = screen.getByRole("row", { name: /Aziza Karimova/ });
    expect(within(row).getByText("80%")).toBeInTheDocument();
    expect(within(row).getByText("O'tdi")).toBeInTheDocument();
  });
});

describe("TestResultsTable", () => {
  it("empty state", () => {
    render(<TestResultsTable rows={[]} />);
    expect(screen.getByText("Hali o'quvchi yo'q")).toBeInTheDocument();
  });

  it("states: passed, failed, in progress, not started", () => {
    const base = { lastFinishedAt: null, inProgress: false, bestScore: null, attempts: 0, passed: false };
    render(
      <TestResultsTable
        rows={[
          { ...base, studentId: "1", fullName: "A", passed: true, bestScore: 90, attempts: 1 },
          { ...base, studentId: "2", fullName: "B", bestScore: 30, attempts: 1 },
          { ...base, studentId: "3", fullName: "C", inProgress: true },
          { ...base, studentId: "4", fullName: "D" },
        ]}
      />,
    );
    expect(screen.getByText("O'tdi")).toBeInTheDocument();
    expect(screen.getByText("O'tmadi")).toBeInTheDocument();
    expect(screen.getByText("Jarayonda")).toBeInTheDocument();
    expect(screen.getByText("Boshlamagan")).toBeInTheDocument();
  });
});

describe("TestsIndex", () => {
  const overview = (over: Partial<TestsOverview> = {}): TestsOverview => ({
    courses: [
      { id: id(10), title: "Po-russki", modules: [{ id: id(20), title: "Знакомство", position: 1, hasTest: true }, { id: id(21), title: "Семья", position: 2, hasTest: false }] },
    ],
    tests: [{ id: id(100), title: "1-modul testi", courseTitle: "Po-russki", moduleTitle: "Знакомство", published: true, itemCount: 12, passScore: 60, timeLimitMin: 20 }],
    ...over,
  });

  it("lists tests and offers only modules without a test", async () => {
    const createTest = vi.fn(async () => ({ ok: true as const, testId: id(101) }));
    render(<TestsIndex overview={overview()} actions={{ createTest }} />);
    const link = screen.getByRole("link", { name: /1-modul testi/ });
    expect(link).toHaveAttribute("href", `/teacher/tests/${id(100)}`);
    expect(within(link).getByText("Nashr qilingan")).toBeInTheDocument();
    expect(within(link).getByText("12 ta mashq")).toBeInTheDocument();
    const select = screen.getByLabelText("Modul");
    expect(within(select).queryByText(/Знакомство/)).toBeNull();
    await userEvent.selectOptions(select, id(21));
    await userEvent.type(screen.getByLabelText("Test nomi"), "2-modul testi");
    await userEvent.click(screen.getByRole("button", { name: "Test yaratish" }));
    await waitFor(() => expect(createTest).toHaveBeenCalledWith({ moduleId: id(21), title: "2-modul testi" }));
    expect(push).toHaveBeenCalledWith(`/teacher/tests/${id(101)}`);
  });

  it("empty states", () => {
    const { unmount } = render(<TestsIndex overview={{ courses: [], tests: [] }} actions={{ createTest: vi.fn() }} />);
    expect(screen.getByText("Hali test yo'q")).toBeInTheDocument();
    expect(screen.getByText("Avval kurs yarating.")).toBeInTheDocument();
    unmount();
    render(<TestsIndex overview={overview({ tests: [] })} actions={{ createTest: vi.fn() }} />);
    expect(screen.getByText("Modul uchun birinchi testni yarating.")).toBeInTheDocument();
  });

  it("shows the server message when creation fails", async () => {
    const createTest = vi.fn(async () => ({ ok: false as const, code: "invalid" as const, message: "Bu modulda test allaqachon bor" }));
    render(<TestsIndex overview={overview()} actions={{ createTest }} />);
    await userEvent.selectOptions(screen.getByLabelText("Modul"), id(21));
    await userEvent.type(screen.getByLabelText("Test nomi"), "x");
    await userEvent.click(screen.getByRole("button", { name: "Test yaratish" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Bu modulda test allaqachon bor");
    expect(push).not.toHaveBeenCalled();
  });
});

describe("path integration", () => {
  const db = (passed: string[], completedLessons: boolean): PathDb => ({
    enrollment: async () => ({ courseId: "c1" }) as never,
    modules: async () => [
      { id: "m1", position: 1, title: "Modul", lessons: [{ id: "l1", position: 1, title: "Dars", lesson_parts: [{ id: "p1", position: 1, kind: "grammar", title: "G" }] }] },
    ],
    publishedPartIds: async () => new Set(["p1"]),
    progress: async () => new Map(completedLessons ? [["p1", "completed" as const]] : []),
    tests: async () => [{ id: "t1", title: "Test", after_module_id: "m1", published: true }],
    passedTestIds: async () => new Set(passed),
  });

  it("test node: locked until the lessons are completed, available, then completed once passed", async () => {
    expect((await getPathWith(db([], false), "s")).modules[0].test?.status).toBe("locked");
    expect((await getPathWith(db([], true), "s")).modules[0].test?.status).toBe("available");
    expect((await getPathWith(db(["t1"], true), "s")).modules[0].test?.status).toBe("completed");
  });

  it("a port without passedTestIds keeps the old behaviour", async () => {
    const { passedTestIds, ...old } = db(["t1"], true);
    void passedTestIds;
    expect((await getPathWith(old, "s")).modules[0].test?.status).toBe("available");
  });
});
