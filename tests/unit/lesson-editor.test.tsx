import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh: vi.fn() }) }));

import { LessonEditor } from "@/components/staff/editor/LessonEditor";
import { WordsEditor } from "@/components/staff/editor/WordsEditor";
import type { EditorActions } from "@/components/staff/editor/actions-type";
import { LessonPlayer } from "@/components/lesson/LessonPlayer";
import type { EditorBlock, EditorData } from "@/lib/editor/types";
import type { LessonPartData } from "@/server/lesson";

const L = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const P1 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1";
const P2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2";
const M = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const B1 = "dddddddd-dddd-4ddd-8ddd-ddddddddddd1";
const B2 = "dddddddd-dddd-4ddd-8ddd-ddddddddddd2";

const block = (id: string, over: Partial<EditorBlock> = {}): EditorBlock => ({
  id, type: "text", published: false, updatedAt: "2026-11-11T10:00:00.000001+00:00", payload: { title: id === B1 ? "Birinchi" : "Ikkinchi", body: "matn" }, exercise: null, ...over,
});

function data(over: Partial<EditorData["lesson"]> = {}): EditorData {
  return {
    courseId: "c1", courseTitle: "Kurs",
    tree: [{ id: M, position: 1, title: "Modul", lessons: [{ id: L, position: 1, title: "Dars", status: "draft" }] }],
    lesson: {
      id: L, title: "Откуда Вы?", objective: "Maqsad", updatedAt: "2026-11-11T09:00:00.000001+00:00", moduleId: M, moduleTitle: "Modul", modulePosition: 1, lessonPosition: 1,
      parts: [
        { id: P1, position: 1, kind: "grammar", title: "Grammatika", blocks: [block(B1), block(B2)] },
        { id: P2, position: 2, kind: "conversation", title: "Razgovor", blocks: [] },
      ],
      words: [], ...over,
    },
  };
}

function fakeActions(over: Partial<EditorActions> = {}): EditorActions {
  const ok = { ok: true as const };
  return {
    saveLesson: vi.fn(async () => ({ ...ok, updatedAt: "L2" })),
    createBlock: vi.fn(async () => ({ ...ok, blockId: "new-block", updatedAt: "N1" })),
    saveBlock: vi.fn(async () => ({ ...ok, updatedAt: "S2" })),
    deleteBlock: vi.fn(async () => ok),
    reorderBlocks: vi.fn(async () => ok),
    setPublished: vi.fn(async () => ({ ...ok, warnings: [] })),
    importWords: vi.fn(async () => ({ ...ok, inserted: 2, linked: 0, skipped: 0, errors: [], duplicates: 0, words: [] })),
    saveWord: vi.fn(async () => ({ ...ok, words: [] })),
    unlinkWord: vi.fn(async () => ({ ...ok, words: [] })),
    requestUpload: vi.fn(async () => ({ ...ok, path: "c1/x.mp3", token: "t" })),
    createLesson: vi.fn(async () => ({ ...ok, lessonId: "new-lesson" })),
    ...over,
  };
}

const uploader = vi.fn(async () => ({ ok: true }));

beforeEach(() => {
  push.mockReset();
});
afterEach(() => vi.useRealTimers());

function setup(actions = fakeActions(), d = data()) {
  render(<LessonEditor data={d} actions={actions} uploader={uploader} reload={vi.fn()} />);
  return actions;
}

describe("block list and reordering", () => {
  it("lists blocks and reorders with the keyboard-friendly buttons, saving the new order", async () => {
    const actions = setup();
    const user = userEvent.setup();
    const list = screen.getByRole("list", { name: "Bloklar" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getByRole("button", { name: "1-blokni yuqoriga ko'chirish" })).toHaveAttribute("aria-disabled", "true");
    await user.click(screen.getByRole("button", { name: "1-blokni pastga ko'chirish" }));
    expect(actions.reorderBlocks).toHaveBeenCalledWith({ partId: P1, ids: [B2, B1] });
    const titles = within(list).getAllByRole("listitem").map((li) => li.textContent);
    expect(titles[0]).toContain("Ikkinchi");
  });

  it("restores the order and says so when saving the order fails", async () => {
    const actions = fakeActions({ reorderBlocks: vi.fn(async () => ({ ok: false as const, code: "failed" as const, message: "Xatolik" })) });
    setup(actions);
    await userEvent.setup().click(screen.getByRole("button", { name: "1-blokni pastga ko'chirish" }));
    expect(await screen.findByText(/Tartibni saqlab bo'lmadi/)).toBeInTheDocument();
    expect(within(screen.getByRole("list", { name: "Bloklar" })).getAllByRole("listitem")[0].textContent).toContain("Birinchi");
  });

  it("drag and drop reorders too", () => {
    const actions = setup();
    const items = within(screen.getByRole("list", { name: "Bloklar" })).getAllByRole("listitem");
    const handle = items[0].querySelector("[draggable]") as HTMLElement;
    const dt = { setData: vi.fn(), effectAllowed: "" };
    fireEvent.dragStart(handle, { dataTransfer: dt });
    fireEvent.dragOver(items[1], { dataTransfer: dt });
    fireEvent.drop(items[1], { dataTransfer: dt });
    expect(actions.reorderBlocks).toHaveBeenCalledWith({ partId: P1, ids: [B2, B1] });
  });

  it("adds a block through the server action and offers no arrange / listen_pick exercise type", async () => {
    const actions = setup();
    const user = userEvent.setup();
    expect(screen.queryByRole("button", { name: /O'qish$/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Video$/ }));
    expect(actions.createBlock).toHaveBeenCalledWith({ partId: P1, type: "video" });
    expect(await screen.findByRole("region", { name: "Video bloki" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Mashq$/ }));
    const types = within(await screen.findByLabelText("Mashq turi")).getAllByRole("option").map((o) => o.textContent);
    expect(types).toEqual(["Guruhlash", "Bo'sh joyni to'ldirish", "Tuslash", "Variant tanlash", "Juftlash"]);
  });
});

describe("autosave", () => {
  it("debounces 1.5 s, saves once with the loaded token and shows the saved state", async () => {
    vi.useFakeTimers();
    const actions = setup();
    const area = screen.getAllByLabelText("Matn")[0];
    fireEvent.change(area, { target: { value: "yangi 1" } });
    fireEvent.change(area, { target: { value: "yangi 12" } });
    await act(async () => { await vi.advanceTimersByTimeAsync(1400); });
    expect(actions.saveBlock).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(200); });
    expect(actions.saveBlock).toHaveBeenCalledTimes(1);
    expect(actions.saveBlock).toHaveBeenCalledWith({
      blockId: B1, payload: expect.objectContaining({ body: "yangi 12" }), expected: "2026-11-11T10:00:00.000001+00:00",
    });
    // a second edit carries the token returned by the first save
    fireEvent.change(area, { target: { value: "yangi 123" } });
    await act(async () => { await vi.advanceTimersByTimeAsync(1600); });
    expect(actions.saveBlock).toHaveBeenLastCalledWith(expect.objectContaining({ expected: "S2" }));
  });

  it("conflict: shows both choices; overwrite saves with the server's token", async () => {
    vi.useFakeTimers();
    const saveBlock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, code: "conflict", message: "Blok boshqa joyda o'zgartirilgan", currentUpdatedAt: "SERVER9" })
      .mockResolvedValue({ ok: true, updatedAt: "S10" });
    const actions = setup(fakeActions({ saveBlock }));
    fireEvent.change(screen.getAllByLabelText("Matn")[0], { target: { value: "mening matnim" } });
    await act(async () => { await vi.advanceTimersByTimeAsync(1600); });
    expect(screen.getByText("Bu blok boshqa joyda o'zgartirilgan.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Serverdagi versiyani yuklash" })).toBeInTheDocument();
    // no more automatic saves while in conflict
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(saveBlock).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Mening versiyamni saqlash" }));
    await act(async () => { await vi.advanceTimersByTimeAsync(10); });
    expect(saveBlock).toHaveBeenCalledTimes(2);
    expect(saveBlock).toHaveBeenLastCalledWith(expect.objectContaining({ expected: "SERVER9", payload: expect.objectContaining({ body: "mening matnim" }) }));
    expect(actions.saveBlock).toBe(saveBlock);
  });

  it("a validation error is shown and is retried only after the next edit", async () => {
    vi.useFakeTimers();
    const saveBlock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, code: "invalid", message: "Blok to'liq emas", issues: ["body: bo'sh"] })
      .mockResolvedValue({ ok: true, updatedAt: "S2" });
    setup(fakeActions({ saveBlock }));
    const area = screen.getAllByLabelText("Matn")[0];
    fireEvent.change(area, { target: { value: "" } });
    await act(async () => { await vi.advanceTimersByTimeAsync(1600); });
    expect(screen.getByText("Blok to'liq emas")).toBeInTheDocument();
    expect(screen.getByText("body: bo'sh")).toBeInTheDocument();
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(saveBlock).toHaveBeenCalledTimes(1);
    fireEvent.change(area, { target: { value: "to'g'ri" } });
    await act(async () => { await vi.advanceTimersByTimeAsync(1600); });
    expect(saveBlock).toHaveBeenCalledTimes(2);
  });

  it("shows 'Qoralama · N daqiqa oldin saqlandi'", () => {
    const now = Date.parse("2026-11-11T10:02:30.000Z");
    render(<LessonEditor data={data()} actions={fakeActions()} uploader={uploader} now={() => now} />);
    expect(screen.getByText("Qoralama · 2 daqiqa oldin saqlandi")).toBeInTheDocument();
  });
});

describe("publish and preview", () => {
  it("publishes through the action and flips the status", async () => {
    const actions = setup();
    await userEvent.setup().click(screen.getByRole("button", { name: "Nashr qilish" }));
    await waitFor(() => expect(actions.setPublished).toHaveBeenCalledWith({ lessonId: L, published: true }));
    expect(await screen.findByRole("button", { name: "Qoralamaga qaytarish" })).toBeInTheDocument();
  });

  it("lists the validation problems when the lesson is not ready", async () => {
    const actions = fakeActions({ setPublished: vi.fn(async () => ({ ok: false as const, code: "invalid" as const, message: "x", issues: ["Grammatika, 1-blok (Mashq): kalit noto'g'ri"] })) });
    setup(actions);
    await userEvent.setup().click(screen.getByRole("button", { name: "Nashr qilish" }));
    expect(await screen.findByText("Grammatika, 1-blok (Mashq): kalit noto'g'ri")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Nashr qilish" })).toBeInTheDocument();
  });

  it("preview link points at the active part with ?preview=1", () => {
    setup();
    expect(screen.getByRole("link", { name: /O'quvchi ko'rinishi/ })).toHaveAttribute("href", `/lesson/${P1}?preview=1`);
  });

  it("deleting needs a confirmation and reports student data protection", async () => {
    const actions = fakeActions({ deleteBlock: vi.fn(async () => ({ ok: false as const, code: "has_student_data" as const, message: "O'quvchilar bu mashqni bajargan: o'chirib bo'lmaydi" })) });
    setup(actions);
    const user = userEvent.setup();
    await user.click(screen.getAllByRole("button", { name: "Blokni o'chirish" })[0]);
    expect(actions.deleteBlock).not.toHaveBeenCalled();
    await user.click(screen.getAllByRole("button", { name: "Ha, o'chirish" })[0]);
    expect(actions.deleteBlock).toHaveBeenCalledWith({ blockId: B1 });
    expect(await screen.findByText(/o'chirib bo'lmaydi/)).toBeInTheDocument();
  });
});

describe("exercise form", () => {
  const exBlock = block(B1, { type: "exercise", payload: {}, exercise: { id: "e1", type: "choose", prompt: "Tanlang", payload: { items: [{ id: "a", text: "Savol", options: ["x", "y"] }] }, key: {}, xp: 10, isTestItem: false } });

  it("shows what is wrong with the key and the test-item warning", () => {
    const d = data();
    d.lesson.parts[0].blocks = [{ ...exBlock, exercise: { ...exBlock.exercise!, isTestItem: true } }];
    render(<LessonEditor data={d} actions={fakeActions()} uploader={uploader} />);
    expect(screen.getByText(/test elementi sifatida ham ishlatilgan/)).toBeInTheDocument();
    expect(screen.getByText("Nashrdan oldin tuzating")).toBeInTheDocument();
    expect(screen.getByText(/to'g'ri variant tanlanmagan/)).toBeInTheDocument();
  });

  it("choosing the correct option removes the key error and autosaves the key separately from the payload", async () => {
    vi.useFakeTimers();
    const d = data();
    d.lesson.parts[0].blocks = [exBlock];
    const actions = fakeActions();
    render(<LessonEditor data={d} actions={actions} uploader={uploader} />);
    fireEvent.click(screen.getByLabelText("1-savol: 2-variant to'g'ri"));
    expect(screen.queryByText("Nashrdan oldin tuzating")).not.toBeInTheDocument();
    await act(async () => { await vi.advanceTimersByTimeAsync(1600); });
    const call = (actions.saveBlock as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.exercise.key).toEqual({ a: 1 });
    expect(JSON.stringify(call.exercise.payload)).not.toContain('"a":1');
  });
});

describe("words and CSV", () => {
  const file = (text: string) => new File([text], "words.csv", { type: "text/csv" });
  // jsdom's File has no text() in some versions
  const withText = (f: File, text: string) => Object.assign(f, { text: async () => text });

  it("previews a valid file, reports row errors and imports on confirm", async () => {
    const actions = fakeActions();
    const onWords = vi.fn();
    render(<WordsEditor lessonId={L} words={[]} onWords={onWords} actions={actions} />);
    const csv = "ru,uz\nкнига,kitob\nдом,\nстол,stol";
    await userEvent.setup().upload(screen.getByLabelText("CSV faylni tanlash"), withText(file(csv), csv));
    expect(await screen.findByText(/2 ta to'g'ri qator, 1 ta xato/)).toBeInTheDocument();
    expect(screen.getByText("3-qator: «uz» bo'sh")).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: "2 ta so'zni import qilish" }));
    expect(actions.importWords).toHaveBeenCalledWith({ lessonId: L, csv });
    await waitFor(() => expect(onWords).toHaveBeenCalled());
    expect(await screen.findByText(/2 ta yangi so'z/)).toBeInTheDocument();
  });

  it("a file with a missing column cannot be imported", async () => {
    const actions = fakeActions();
    render(<WordsEditor lessonId={L} words={[]} onWords={vi.fn()} actions={actions} />);
    const csv = "ru,stress\nкнига,x";
    await userEvent.setup().upload(screen.getByLabelText("CSV faylni tanlash"), withText(file(csv), csv));
    expect(await screen.findByText("Yetishmayotgan ustun: uz")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /so'zni import qilish/ })).toBeDisabled();
    expect(actions.importWords).not.toHaveBeenCalled();
  });

  it("shows the empty state", () => {
    render(<WordsEditor lessonId={L} words={[]} onWords={vi.fn()} actions={fakeActions()} />);
    expect(screen.getByText("Hali so'z yo'q")).toBeInTheDocument();
  });
});

describe("preview mode of the student player", () => {
  const d: LessonPartData = {
    part: { id: P1, kind: "grammar", title: "G" },
    lesson: { id: L, title: "Dars", objective: null },
    blocks: [{ id: "x1", type: "exercise", payload: { exerciseId: "e1" } }],
    exercises: { e1: { id: "e1", type: "choose", prompt: "Tanlang", payload: { items: [{ id: "a", text: "Savol", options: ["x", "y"] }] }, checkMode: "auto" } },
    words: [], progress: null, nextPartId: null, submittedExerciseIds: [],
  };

  it("is read-only: no fetch, finishing goes back to the editor", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<LessonPlayer data={d} media={{}} preview={{ exitHref: `/teacher/lessons/${L}` }} />);
    expect(screen.getByText(/Ko'rib chiqish rejimi: o'quvchi ko'rinishi/)).toBeInTheDocument();
    expect(screen.getByText("Savol: x / y")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Darsni yopish" })).toHaveAttribute("href", `/teacher/lessons/${L}`);
    await userEvent.setup().click(screen.getByRole("button", { name: "Tugatish" }));
    expect(push).toHaveBeenCalledWith(`/teacher/lessons/${L}`);
    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
