import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

import { Classify, FeedbackSheet } from "@/components/exercises";
import { LessonPlayer } from "@/components/lesson/LessonPlayer";
import { TextBlock } from "@/components/lesson/blocks/TextBlock";
import type { BlockResult } from "@/lib/blocks/types";
import type { LessonPartData } from "@/server/lesson";

const EX1 = "11111111-1111-4111-8111-111111111111";
const EX2 = "22222222-2222-4222-8222-222222222222";
const W1 = "33333333-3333-4333-8333-333333333333";

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  push.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

function reply(body: unknown, status = 200) {
  fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));
}

const words = [
  { id: W1, ru: "мама", stress: "ма́ма", uz: "ona" },
  { id: "w2", ru: "ёлка", stress: null, uz: "archa" },
];

function data(blocks: BlockResult[], over: Partial<LessonPartData> = {}): LessonPartData {
  return {
    part: { id: "p1", kind: "grammar", title: "G" },
    lesson: { id: "l1", title: "Dars", objective: null },
    blocks,
    exercises: {
      [EX1]: {
        id: EX1,
        type: "classify",
        prompt: "Rodni toping",
        checkMode: "auto",
        payload: {
          items: [{ id: "i1", text: "тетрадь" }],
          buckets: [
            { id: "m", label: "Erkak" },
            { id: "f", label: "Ayol" },
          ],
        },
      },
      [EX2]: { id: EX2, type: "speaking", prompt: "Gapiring", checkMode: "review", payload: {} },
    },
    words,
    progress: null,
    nextPartId: "p2",
    submittedExerciseIds: [],
    ...over,
  };
}

const text = (id: string, body = "Привет, мама!"): BlockResult => ({ id, type: "text", payload: { body } });
const next = () => screen.getByRole("button", { name: /Keyingisi|Tugatish/ });

describe("LessonPlayer", () => {
  it("shows the close link, progress and counter, and walks blocks in order", async () => {
    render(<LessonPlayer data={data([text("a", "Birinchi"), text("b", "Ikkinchi")])} media={{}} />);
    expect(screen.getByRole("link", { name: "Darsni yopish" })).toHaveAttribute("href", "/path");
    expect(screen.getByText("1/2")).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "Dars jarayoni" })).toHaveAttribute("aria-valuenow", "0");
    expect(screen.getByText("Birinchi")).toBeInTheDocument();
    expect(next()).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "O'qidim" }));
    expect(next()).toBeEnabled();
    await userEvent.click(next());
    expect(screen.getByText("Ikkinchi")).toBeInTheDocument();
    expect(screen.getByText("2/2")).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "Dars jarayoni" })).toHaveAttribute("aria-valuenow", "1");
    expect(screen.getByRole("button", { name: "Tugatish" })).toBeDisabled();
  });

  it("video: 'Ko'rdim' only after the player loaded, iframe is nocookie, lazy, titled", async () => {
    const block: BlockResult = {
      id: "v",
      type: "video",
      payload: { provider: "youtube", videoId: "dQw4w9WgXcQ", title: "Salom video" },
    };
    render(<LessonPlayer data={data([block, text("t")])} media={{}} />);
    const frame = screen.getByTitle("Salom video");
    expect(frame.getAttribute("src")).toMatch(/^https:\/\/www\.youtube-nocookie\.com\/embed\/dQw4w9WgXcQ/);
    expect(frame.getAttribute("src")).not.toMatch(/autoplay/);
    expect(frame).toHaveAttribute("loading", "lazy");
    expect(screen.getByRole("button", { name: "Video yuklanmoqda" })).toBeDisabled();
    expect(next()).toBeDisabled();
    fireEvent.load(frame);
    await userEvent.click(screen.getByRole("button", { name: "Ko'rdim" }));
    expect(next()).toBeEnabled();
  });

  it("audio: manual 'Eshitdim' or ended unlocks Next and reports the listen once", async () => {
    const block: BlockResult = { id: "a", type: "audio", payload: { path: "x.mp3", title: "Dialog", transcript: "Привет" } };
    fetchMock.mockResolvedValue(new Response("{}", { status: 200 }));
    const { container } = render(<LessonPlayer data={data([block, text("t")])} media={{ a: "https://signed/a.mp3" }} />);
    expect(container.querySelector("audio")).toHaveAttribute("src", "https://signed/a.mp3");
    expect(screen.getByText("Matn (transkript)")).toBeInTheDocument();
    expect(next()).toBeDisabled();
    fireEvent.ended(container.querySelector("audio") as HTMLAudioElement);
    await waitFor(() => expect(next()).toBeEnabled());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/lesson/audio-listened");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ blockId: "a" });
    expect(screen.getByRole("button", { name: "1x" })).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(screen.getByRole("button", { name: "0.75x" }));
    expect(screen.getByRole("button", { name: "0.75x" })).toHaveAttribute("aria-pressed", "true");
  });

  it("audio with unavailable media shows a clean state and does not trap the student", async () => {
    const block: BlockResult = { id: "a", type: "audio", payload: { path: "x.mp3", title: "Dialog" } };
    render(<LessonPlayer data={data([block, text("t")])} media={{ a: null }} />);
    expect(screen.getByText("Audio hozircha mavjud emas.")).toBeInTheDocument();
    await waitFor(() => expect(next()).toBeEnabled());
  });

  it("rule image: done when loaded; has alt text", async () => {
    const block: BlockResult = { id: "r", type: "rule_image", payload: { path: "r.png", alt: "Jadval", caption: "Izoh" } };
    render(<LessonPlayer data={data([block, text("t")])} media={{ r: "https://signed/r.png" }} />);
    const img = screen.getByRole("img", { name: "Jadval" });
    expect(next()).toBeDisabled();
    fireEvent.load(img);
    await waitFor(() => expect(next()).toBeEnabled());
    expect(screen.getByText("Izoh")).toBeInTheDocument();
  });

  it("unsupported blocks show a message and continue", async () => {
    render(<LessonPlayer data={data([{ id: "u", type: "unsupported", originalType: "hologram" }, text("t")])} media={{}} />);
    expect(screen.getByText("Bu blok qo'llab-quvvatlanmaydi")).toBeInTheDocument();
    await waitFor(() => expect(next()).toBeEnabled());
  });

  it("words block links to /words and is done on arrival", async () => {
    render(<LessonPlayer data={data([{ id: "w", type: "words", payload: {} }, text("t")])} media={{}} />);
    expect(screen.getByRole("link", { name: /So'zlarni takrorlash/ })).toHaveAttribute("href", "/words?lesson=l1");
    await waitFor(() => expect(next()).toBeEnabled());
  });

  it("exercise: Next unlocks only when the component reports done", async () => {
    const block: BlockResult = { id: "e", type: "exercise", payload: { exerciseId: EX1 } };
    reply({ correct: true, xpAwarded: 10 });
    render(<LessonPlayer data={data([block, text("t")])} media={{}} />);
    expect(screen.getByText("Rodni toping")).toBeInTheDocument();
    expect(next()).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: /Ayol/ }));
    await userEvent.click(await screen.findByRole("button", { name: "Davom etish" }));
    await waitFor(() => expect(next()).toBeEnabled());
  });

  it("a non-retryable exercise error offers 'Orqaga' which leaves to /path", async () => {
    const block: BlockResult = { id: "e", type: "exercise", payload: { exerciseId: EX1 } };
    reply({ error: "not_found" }, 404);
    render(<LessonPlayer data={data([block])} media={{}} />);
    await userEvent.click(screen.getByRole("button", { name: /Ayol/ }));
    await userEvent.click(await screen.findByRole("button", { name: "Orqaga" }));
    expect(push).toHaveBeenCalledWith("/path");
  });

  it("an exercise block with a malformed payload does not trap the student", async () => {
    const block: BlockResult = { id: "e", type: "exercise", payload: { exerciseId: EX1 } };
    const d = data([block]);
    d.exercises[EX1].payload = { nope: true };
    render(<LessonPlayer data={d} media={{}} />);
    expect(screen.getByText("Bu blok qo'llab-quvvatlanmaydi")).toBeInTheDocument();
    await waitFor(() => expect(next()).toBeEnabled());
  });

  it("speaking: card links to /speak; skip is labelled; a submission unlocks Next", async () => {
    const block: BlockResult = { id: "s", type: "speaking", payload: { exerciseId: EX2 } };
    const { unmount } = render(<LessonPlayer data={data([block])} media={{}} />);
    expect(screen.getByRole("link", { name: /Gapirishni boshlash/ })).toHaveAttribute("href", `/speak/${EX2}`);
    expect(next()).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: /Keyinroq bajaraman/ }));
    expect(next()).toBeEnabled();
    unmount();

    render(<LessonPlayer data={data([block], { submittedExerciseIds: [EX2] })} media={{}} />);
    expect(screen.getByText("Javobingiz yuborilgan")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Keyinroq bajaraman/ })).not.toBeInTheDocument();
    await waitFor(() => expect(next()).toBeEnabled());
  });

  it("can resume at a later block via initialIndex (clamped)", () => {
    render(<LessonPlayer data={data([text("a", "Birinchi"), text("b", "Ikkinchi")])} media={{}} initialIndex={9} />);
    expect(screen.getByText("Ikkinchi")).toBeInTheDocument();
  });

  describe("completion", () => {
    async function toLast(d: LessonPartData) {
      render(<LessonPlayer data={d} media={{}} />);
      await userEvent.click(screen.getByRole("button", { name: "O'qidim" }));
      await userEvent.click(screen.getByRole("button", { name: "Tugatish" }));
    }

    it("the last block calls /api/lesson/complete and then shows the result with XP and next lesson", async () => {
      reply({ completed: true, newlyCompleted: true, xpAwarded: 20 });
      await toLast(data([text("a")]));
      expect(fetchMock.mock.calls[0][0]).toBe("/api/lesson/complete");
      expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ partId: "p1" });
      expect(await screen.findByText("Dars tugallandi!")).toBeInTheDocument();
      expect(screen.getByText("+20 XP")).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Keyingi dars" })).toHaveAttribute("href", "/lesson/p2");
      expect(screen.getByRole("link", { name: "Yo'lga qaytish" })).toHaveAttribute("href", "/path");
    });

    it("shows the part XP even when an attempt already completed the part, but none on a replay", async () => {
      reply({ completed: true, newlyCompleted: false, xpAwarded: 0 });
      await toLast(data([text("a")]));
      expect(await screen.findByText("+20 XP")).toBeInTheDocument();
    });

    it("no XP and no 'Keyingi dars' for an already completed part without a next part", async () => {
      reply({ completed: true, newlyCompleted: false, xpAwarded: 0 });
      await toLast(data([text("a")], { progress: "completed", nextPartId: null }));
      expect(await screen.findByText("Bu darsni avval ham tugatgansiz.")).toBeInTheDocument();
      expect(screen.queryByText(/XP/)).not.toBeInTheDocument();
      expect(screen.queryByRole("link", { name: "Keyingi dars" })).not.toBeInTheDocument();
    });

    it("lists the missing exercises with links back, and jumps back to the exercise block", async () => {
      reply({
        completed: false,
        missing: [
          { exerciseId: EX1, kind: "exercise" },
          { exerciseId: EX2, kind: "speaking" },
        ],
      });
      const blocks: BlockResult[] = [
        { id: "e", type: "exercise", payload: { exerciseId: EX1 } },
        { id: "s", type: "speaking", payload: { exerciseId: EX2 } },
        text("t"),
      ];
      render(<LessonPlayer data={data(blocks, { submittedExerciseIds: [EX2] })} media={{}} initialIndex={2} />);
      await userEvent.click(screen.getByRole("button", { name: "O'qidim" }));
      await userEvent.click(screen.getByRole("button", { name: "Tugatish" }));
      expect(await screen.findByText("Dars hali tugamadi")).toBeInTheDocument();
      expect(screen.getByRole("link", { name: /Gapirish topshirig'i: bajarish/ })).toHaveAttribute("href", `/speak/${EX2}`);
      await userEvent.click(screen.getByRole("button", { name: /1-blok/ }));
      expect(screen.getByText("Rodni toping")).toBeInTheDocument();
      expect(screen.getByText("1/3")).toBeInTheDocument();
    });

    it("an empty missing list and a server error are handled", async () => {
      reply({ completed: false, missing: [] });
      await toLast(data([text("a")]));
      expect(await screen.findByText("Dars hali tugamadi")).toBeInTheDocument();
    });

    it("a failed request offers a retry; 401 offers login", async () => {
      reply({ error: "x" }, 500);
      reply({ completed: true, xpAwarded: 20 });
      await toLast(data([text("a")]));
      await userEvent.click(await screen.findByRole("button", { name: "Qayta urinish" }));
      expect(await screen.findByText("Dars tugallandi!")).toBeInTheDocument();
    });

    it("401 offers a login link", async () => {
      reply({ error: "unauthenticated" }, 401);
      await toLast(data([text("a")]));
      expect(await screen.findByRole("link", { name: "Qayta kirish" })).toHaveAttribute("href", "/login");
    });
  });
});

describe("TextBlock popover", () => {
  const payload = {
    body: "Это моя мама. Ёлка, дом!\n\nВторой абзац.",
    glossary: [
      { surface: "мамы", wordId: W1 },
      { surface: "ничего", wordId: "unknown-word-id" },
    ],
  };

  it("renders only words with a translation as buttons (normalised: case, ё, stress, punctuation)", () => {
    render(<TextBlock payload={{ ...payload, body: "Мама, ЁЛКА! Дом. Ничего." }} words={words} onDone={() => undefined} />);
    const buttons = screen.getAllByRole("button").map((b) => b.textContent);
    expect(buttons).toEqual(expect.arrayContaining(["Мама", "ЁЛКА"]));
    expect(buttons).not.toContain("Дом");
    expect(buttons).not.toContain("Ничего"); // glossary entry without a known word has no translation
  });

  it("matches inflected glossary surfaces and shows the translation in a dialog", async () => {
    render(<TextBlock payload={{ body: "Нет мамы.", glossary: payload.glossary }} words={words} onDone={() => undefined} />);
    await userEvent.click(screen.getByRole("button", { name: "мамы" }));
    const dialog = screen.getByRole("dialog", { name: "Tarjima" });
    expect(within(dialog).getByText("ona")).toBeInTheDocument();
    expect(within(dialog).getByText("ма́ма")).toBeInTheDocument();
  });

  it("is keyboard accessible and closes on Escape (focus returns to the word)", async () => {
    render(<TextBlock payload={{ body: "Это мама." }} words={words} onDone={() => undefined} />);
    const btn = screen.getByRole("button", { name: "мама" });
    btn.focus();
    await userEvent.keyboard("{Enter}");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(btn).toHaveAttribute("aria-expanded", "true");
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(btn).toHaveFocus();
  });

  it("closes on a click outside and toggles on a second click", async () => {
    render(
      <div>
        <button type="button">outside</button>
        <TextBlock payload={{ body: "Это мама." }} words={words} onDone={() => undefined} />
      </div>,
    );
    await userEvent.click(screen.getByRole("button", { name: "мама" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "outside" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "мама" }));
    await userEvent.click(screen.getByRole("button", { name: "мама" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("splits paragraphs on blank lines and reports done on the button", async () => {
    const onDone = vi.fn();
    render(<TextBlock payload={payload} words={words} onDone={onDone} />);
    expect(document.querySelectorAll("p")).toHaveLength(2);
    await userEvent.click(screen.getByRole("button", { name: "O'qidim" }));
    expect(onDone).toHaveBeenCalled();
  });

  it("scrolled to the end counts as read when IntersectionObserver exists", () => {
    let cb: IntersectionObserverCallback = () => undefined;
    class IO {
      constructor(c: IntersectionObserverCallback) {
        cb = c;
      }
      observe() {}
      disconnect() {}
    }
    vi.stubGlobal("IntersectionObserver", IO);
    const onDone = vi.fn();
    render(<TextBlock payload={{ body: "Это мама." }} words={words} onDone={onDone} />);
    act(() => cb([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver));
    expect(onDone).toHaveBeenCalled();
  });
});

describe("exercise onExit", () => {
  const classify = {
    items: [{ id: "i1", text: "тетрадь" }],
    buckets: [
      { id: "m", label: "Erkak" },
      { id: "f", label: "Ayol" },
    ],
  };

  for (const [code, label] of [
    [400, "invalid"],
    [403, "forbidden"],
    [404, "notfound"],
  ] as const) {
    it(`HTTP ${code} (${label}) shows 'Orqaga' only when onExit is passed`, async () => {
      const onExit = vi.fn();
      reply({ error: "x" }, code);
      const { unmount } = render(<Classify exerciseId="ex1" payload={classify} onExit={onExit} />);
      await userEvent.click(screen.getByRole("button", { name: /Ayol/ }));
      await userEvent.click(await screen.findByRole("button", { name: "Orqaga" }));
      expect(onExit).toHaveBeenCalledTimes(1);
      unmount();

      reply({ error: "x" }, code);
      render(<Classify exerciseId="ex1" payload={classify} />);
      await userEvent.click(screen.getByRole("button", { name: /Ayol/ }));
      await screen.findByRole("alert");
      expect(screen.queryByRole("button", { name: "Orqaga" })).not.toBeInTheDocument();
    });
  }

  it("retryable errors keep 'Qayta urinish' and no 'Orqaga'", () => {
    render(
      <FeedbackSheet status="error" result={null} error="network" onContinue={() => undefined} onRetry={() => undefined} onExit={() => undefined} />,
    );
    expect(screen.getByRole("button", { name: "Qayta urinish" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Orqaga" })).not.toBeInTheDocument();
  });
});
