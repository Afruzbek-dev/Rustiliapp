import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh }) }));

import { AnswerInputs } from "@/components/tests/AnswerInputs";
import { ActiveTest } from "@/components/tests/ActiveTest";
import { StartButton, TestIntro } from "@/components/tests/TestIntro";
import { TestResult } from "@/components/tests/TestResult";
import { TestRunner, formatClock, type TestRunnerActions } from "@/components/tests/TestRunner";
import type { ClientItem, ResultView } from "@/server/tests";

const E1 = "00000000-0000-4000-8000-000000000201";
const E2 = "00000000-0000-4000-8000-000000000202";
const E3 = "00000000-0000-4000-8000-000000000203";

const items: ClientItem[] = [
  {
    exerciseId: E1, section: "vocab", type: "classify", prompt: "Rodni belgilang",
    payload: { items: [{ id: "a1", text: "книга" }, { id: "b2", text: "стол" }], buckets: [{ id: "bx", label: "ж.р" }, { id: "by", label: "м.р" }] },
  },
  {
    exerciseId: E2, section: "grammar", type: "choose", prompt: "Tanlang",
    payload: { items: [{ id: "q", text: "Я ... читать", options: ["могу", "умею"] }] },
  },
  {
    exerciseId: E3, section: "grammar", type: "fill_blank", prompt: "To'ldiring",
    payload: { items: [{ id: "f", before: "Это", after: "." }] },
  },
];

function actionsFake(over: Partial<TestRunnerActions> = {}) {
  const save = vi.fn(async () => true);
  const finish = vi.fn(async () => true);
  return { save, finish, ...over } as TestRunnerActions & { save: ReturnType<typeof vi.fn>; finish: ReturnType<typeof vi.fn> };
}

describe("AnswerInputs", () => {
  it("classify collects answers and never shows feedback", async () => {
    const onChange = vi.fn();
    render(<AnswerInputs type="classify" payload={items[0].payload} value={undefined} onChange={onChange} />);
    const group = screen.getByRole("group", { name: "книга" });
    await userEvent.click(within(group).getByRole("button", { name: "м.р" }));
    expect(onChange).toHaveBeenCalledWith({ answers: { a1: "by" } });
    expect(screen.queryByText(/to'g'ri|xato/i)).toBeNull();
  });

  it("choose marks the picked option with aria-pressed only", () => {
    render(<AnswerInputs type="choose" payload={items[1].payload} value={{ answers: { q: 1 } }} onChange={() => {}} />);
    expect(screen.getByRole("button", { name: "умею" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "могу" })).toHaveAttribute("aria-pressed", "false");
  });

  it("fill_blank, conjugate and match produce the server answer shapes", () => {
    const fill = vi.fn();
    const { unmount } = render(<AnswerInputs type="fill_blank" payload={items[2].payload} value={undefined} onChange={fill} />);
    fireEvent.change(screen.getByLabelText(/Bo'sh joy/), { target: { value: "дом" } });
    expect(fill).toHaveBeenCalledWith({ answers: { f: "дом" } });
    unmount();

    const conj = vi.fn();
    const c = render(<AnswerInputs type="conjugate" payload={{ verb: "писать", pronouns: [] }} value={{ forms: ["пишу"] }} onChange={conj} />);
    fireEvent.change(screen.getByLabelText("ты писать"), { target: { value: "пишешь" } });
    expect(conj).toHaveBeenCalledWith({ forms: ["пишу", "пишешь", "", "", "", ""] });
    c.unmount();

    const match = vi.fn();
    render(
      <AnswerInputs
        type="match"
        payload={{ left: [{ id: "l1", text: "дом" }], right: [{ id: "r1", text: "uy" }, { id: "r2", text: "kitob" }] }}
        value={undefined}
        onChange={match}
      />,
    );
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "r2" } });
    expect(match).toHaveBeenCalledWith({ pairs: [["l1", "r2"]] });
  });
});

describe("TestRunner", () => {
  beforeEach(() => {
    refresh.mockClear();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows one question at a time with progress, section and no per-item feedback", async () => {
    render(<TestRunner title="1-modul testi" items={items} initialAnswers={{}} remainingMs={null} actions={actionsFake()} onFinished={() => {}} />);
    expect(screen.getByText("Savol 1 / 3")).toBeInTheDocument();
    expect(screen.getByText("Lug'at")).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "Test jarayoni" })).toHaveAttribute("aria-valuenow", "1");
    expect(screen.queryByRole("timer")).toBeNull();
    await userEvent.click(screen.getAllByRole("button", { name: "ж.р" })[0]);
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.queryByText(/To'g'ri|Xato/)).toBeNull();
  });

  it("saves the answer when moving to another question and restores initial answers", async () => {
    const actions = actionsFake();
    render(<TestRunner title="T" items={items} initialAnswers={{ [E2]: { answers: { q: 0 } } }} remainingMs={null} actions={actions} onFinished={() => {}} />);
    await userEvent.click(screen.getAllByRole("button", { name: "м.р" })[1]);
    await userEvent.click(screen.getByRole("button", { name: /Keyingi/ }));
    await waitFor(() => expect(actions.save).toHaveBeenCalledWith(E1, { answers: { b2: "by" } }));
    expect(screen.getByRole("button", { name: "могу" })).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(screen.getByRole("button", { name: /Oldingi/ }));
    expect(screen.getAllByRole("button", { name: "м.р" })[1]).toHaveAttribute("aria-pressed", "true");
  });

  it("warns when an answer could not be saved but keeps working", async () => {
    const actions = actionsFake({ save: vi.fn(async () => false) });
    render(<TestRunner title="T" items={items} initialAnswers={{}} remainingMs={null} actions={actions} onFinished={() => {}} />);
    await userEvent.click(screen.getAllByRole("button", { name: "ж.р" })[0]);
    await userEvent.click(screen.getByRole("button", { name: /Keyingi/ }));
    expect(await screen.findByText(/Javob saqlanmadi/)).toBeInTheDocument();
  });

  it("finishing asks for confirmation, counts unanswered questions and sends all answers once", async () => {
    const actions = actionsFake();
    const onFinished = vi.fn();
    render(<TestRunner title="T" items={items} initialAnswers={{}} remainingMs={null} actions={actions} onFinished={onFinished} />);
    await userEvent.click(screen.getAllByRole("button", { name: "ж.р" })[0]);
    await userEvent.click(screen.getByRole("button", { name: "Testni yakunlash" }));
    expect(screen.getByText(/2 ta savolga javob berilmagan/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Davom etish" }));
    expect(actions.finish).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Testni yakunlash" }));
    const sheet = screen.getByRole("status");
    await userEvent.dblClick(within(sheet).getByRole("button", { name: "Yakunlash" }));
    await waitFor(() => expect(onFinished).toHaveBeenCalledTimes(1));
    expect(actions.finish).toHaveBeenCalledTimes(1);
    expect(actions.finish).toHaveBeenCalledWith({ [E1]: { answers: { a1: "bx" } } });
  });

  it("a failed submit shows an error with retry (answers are kept)", async () => {
    const finish = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const onFinished = vi.fn();
    render(<TestRunner title="T" items={items.slice(0, 1)} initialAnswers={{}} remainingMs={null} actions={actionsFake({ finish })} onFinished={onFinished} />);
    await userEvent.click(screen.getByRole("button", { name: "Yakunlash" }));
    await userEvent.click(within(screen.getByRole("status")).getByRole("button", { name: "Yakunlash" }));
    const alert = await screen.findByRole("alert");
    expect(within(alert).getByText("Javoblar yuborilmadi")).toBeInTheDocument();
    await userEvent.click(within(alert).getByRole("button", { name: "Qayta urinish" }));
    await waitFor(() => expect(onFinished).toHaveBeenCalledTimes(1));
    expect(finish).toHaveBeenCalledTimes(2);
  });

  it("counts down and submits automatically when the time is up", async () => {
    vi.useFakeTimers();
    const actions = actionsFake();
    const onFinished = vi.fn();
    render(<TestRunner title="T" items={items} initialAnswers={{ [E2]: { answers: { q: 1 } } }} remainingMs={3000} actions={actions} onFinished={onFinished} />);
    expect(screen.getByRole("timer")).toHaveTextContent("00:03");
    expect(screen.getByText(/Vaqt tugayapti/)).toBeInTheDocument();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(screen.getByRole("timer")).toHaveTextContent("00:02");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2500);
    });
    expect(actions.finish).toHaveBeenCalledTimes(1);
    expect(actions.finish).toHaveBeenCalledWith({ [E2]: { answers: { q: 1 } } });
    expect(onFinished).toHaveBeenCalledTimes(1);
    // no second submit however long we wait
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(actions.finish).toHaveBeenCalledTimes(1);
  });

  it("formats the clock", () => {
    expect(formatClock(65_000)).toBe("01:05");
    expect(formatClock(0)).toBe("00:00");
    expect(formatClock(59_001)).toBe("01:00");
  });
});

describe("ActiveTest", () => {
  it("binds the server actions to the attempt and refreshes the page on finish", async () => {
    refresh.mockClear();
    const save = vi.fn(async () => ({ ok: true }));
    const finish = vi.fn(async () => ({ ok: true }));
    render(
      <ActiveTest attemptId="att-1" title="T" items={items.slice(0, 1)} initialAnswers={{}} remainingMs={null} save={save} finish={finish} />,
    );
    await userEvent.click(screen.getAllByRole("button", { name: "ж.р" })[0]);
    await userEvent.click(screen.getByRole("button", { name: "Yakunlash" }));
    await userEvent.click(within(screen.getByRole("status")).getByRole("button", { name: "Yakunlash" }));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(finish).toHaveBeenCalledWith({ attemptId: "att-1", answers: { [E1]: { answers: { a1: "bx" } } } });
  });

  it("a rejected action counts as a failure, not a crash", async () => {
    const finish = vi.fn(async () => {
      throw new Error("offline");
    });
    render(<ActiveTest attemptId="a" title="T" items={items.slice(0, 1)} initialAnswers={{}} remainingMs={null} save={async () => ({ ok: true })} finish={finish} />);
    await userEvent.click(screen.getByRole("button", { name: "Yakunlash" }));
    await userEvent.click(within(screen.getByRole("status")).getByRole("button", { name: "Yakunlash" }));
    expect(await screen.findByText("Javoblar yuborilmadi")).toBeInTheDocument();
  });
});

describe("TestIntro / StartButton", () => {
  const base = { testId: "t1", title: "1-modul testi", itemCount: 12, timeLimitMin: 30, passScore: 60, maxAttempts: 1 };

  it("shows the rules", () => {
    render(<TestIntro {...base} start={async () => ({ ok: true })} />);
    expect(screen.getByRole("heading", { name: "1-modul testi" })).toBeInTheDocument();
    expect(screen.getByText("12 ta mashq")).toBeInTheDocument();
    expect(screen.getByText("30 daqiqa")).toBeInTheDocument();
    expect(screen.getByText(/O'tish bali: 60%/)).toBeInTheDocument();
    expect(screen.getByText("Faqat bitta urinish")).toBeInTheDocument();
  });

  it("empty test is not startable", () => {
    render(<TestIntro {...base} itemCount={0} start={async () => ({ ok: true })} />);
    expect(screen.getByText("Test hali tayyor emas.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Testni boshlash" })).toBeNull();
  });

  it("starts and refreshes; shows a clear message on refusal or failure", async () => {
    refresh.mockClear();
    const start = vi.fn().mockResolvedValueOnce({ ok: false, code: "limit" }).mockRejectedValueOnce(new Error("x")).mockResolvedValueOnce({ ok: true });
    render(<StartButton testId="t1" start={start} />);
    await userEvent.click(screen.getByRole("button", { name: "Testni boshlash" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Urinishlar tugagan.");
    await userEvent.click(screen.getByRole("button", { name: "Testni boshlash" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Xatolik yuz berdi");
    await userEvent.click(screen.getByRole("button", { name: "Testni boshlash" }));
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    expect(start).toHaveBeenCalledWith({ testId: "t1" });
  });
});

const result = (over: Partial<ResultView> = {}): ResultView => ({
  attemptId: "a1", score: 66.67, passScore: 60, passed: true, correct: 2, total: 3, wrong: 1, timedOut: false, xp: 133,
  sections: [
    { section: "vocab", label: "Lug'at", correct: 2, total: 2, percent: 100 },
    { section: "grammar", label: "Grammatika", correct: 0, total: 1, percent: 0 },
  ],
  recommendations: [{ section: "grammar", label: "Grammatika", percent: 0, lessons: [{ id: "l2", title: "Урок 2" }] }],
  review: [{ exerciseId: E2, section: "grammar", prompt: "Tanlang", lines: [{ question: "Я ... читать", yours: "умею", expected: "могу", ok: false }] }],
  answersRevealed: true, attemptsUsed: 1, attemptsLeft: 0, canRetake: false, ...over,
});

describe("TestResult", () => {
  it("shows score, counts, sections, recommendations and the review", () => {
    render(<TestResult title="1-modul testi" result={result()} />);
    expect(screen.getByText("Test topshirildi")).toBeInTheDocument();
    expect(screen.getByLabelText("Umumiy ball: 66.67 foiz")).toBeInTheDocument();
    expect(screen.getByText("2 ta to'g'ri")).toBeInTheDocument();
    expect(screen.getByText("1 ta xato")).toBeInTheDocument();
    expect(screen.getByText("+133 XP")).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "Lug'at: 100 foiz" })).toBeInTheDocument();
    expect(screen.getByText(/Qayta ko'ring:/)).toHaveTextContent("Qayta ko'ring: Урок 2");
    expect(screen.getByText("Sizning javobingiz:", { exact: false })).toBeInTheDocument();
    expect(screen.getByText("To'g'ri javob:", { exact: false })).toHaveTextContent("могу");
  });

  it("failed attempt with retries left hides the correct answers and offers a retake", () => {
    render(
      <TestResult
        title="T"
        result={result({
          passed: false, xp: 0, score: 33.33, answersRevealed: false, canRetake: true, attemptsLeft: 1,
          review: [{ exerciseId: E2, section: "grammar", prompt: "Tanlang", lines: [{ question: "q", yours: "a", expected: null, ok: false }] }],
        })}
        retake={<button>Qayta topshirish</button>}
      />,
    );
    expect(screen.getByText("Test topshirilmadi")).toBeInTheDocument();
    expect(screen.queryByText(/To'g'ri javob:/)).toBeNull();
    expect(screen.getByText(/urinishlar tugagandan keyin/)).toBeInTheDocument();
    expect(screen.getByText("Yana 1 ta urinish qoldi.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Qayta topshirish" })).toBeInTheDocument();
    expect(screen.queryByText(/XP/)).toBeNull();
  });

  it("no retake button when the student passed; timed out note; no review section when all is right", () => {
    render(<TestResult title="T" result={result({ review: [], recommendations: [], timedOut: true, canRetake: false })} retake={<button>Qayta topshirish</button>} />);
    expect(screen.queryByRole("button", { name: "Qayta topshirish" })).toBeNull();
    expect(screen.getByText(/Vaqt tugadi/)).toBeInTheDocument();
    expect(screen.queryByText("Xatolar tahlili")).toBeNull();
    expect(screen.queryByText("Tavsiyalar")).toBeNull();
  });

  it("a weak section without tagged lessons still gets a recommendation", () => {
    render(<TestResult title="T" result={result({ recommendations: [{ section: "reading", label: "O'qish", percent: 10, lessons: [] }] })} />);
    expect(screen.getByText(/bo'lim darslarini qayta ko'rib chiqing/i)).toBeInTheDocument();
  });
});
