import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Flashcard } from "@/components/student/Flashcard";
import type { StudyCard } from "@/server/srs";

const mk = (n: number, over: Partial<StudyCard> = {}): StudyCard => ({
  wordId: `w${n}`,
  ru: "дом",
  stress: "до́м",
  uz: "uy",
  gender: "m",
  exampleRu: "Это мой дом.",
  exampleUz: "Bu mening uyim.",
  audioUrl: null,
  lessonTitle: "Dars 1",
  isDifficult: false,
  isNew: true,
  labels: { again: "10 daq", hard: "1 kun", good: "4 kun" },
  ...over,
});

const okResponse = () => new Response(JSON.stringify({}), { status: 200 });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Flashcard", () => {
  it("shows the empty state with a link to /path", () => {
    render(<Flashcard cards={[]} />);
    expect(screen.getByText("Bugun takrorlash yo'q — yangi darsni boshlang")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Yo'lga o'tish/ })).toHaveAttribute("href", "/path");
  });

  it("renders header, counter, gender chip and hides the answer until flipped", () => {
    render(<Flashcard cards={[mk(1), mk(2)]} />);
    expect(screen.getByRole("heading", { name: "Takrorlash" })).toBeInTheDocument();
    expect(screen.getByText("Dars 1")).toBeInTheDocument();
    expect(screen.getByText("1 / 2")).toBeInTheDocument();
    expect(screen.getByText("м.р.")).toBeInTheDocument();
    expect(screen.getByText("до́м")).toBeInTheDocument();
    expect(screen.queryByText("uy")).toBeNull();
    expect(screen.queryByRole("button", { name: /Bildim/ })).toBeNull();
    expect(screen.getByRole("link", { name: "Orqaga" })).toHaveAttribute("href", "/home");
  });

  it("flips on click, Enter and Space and shows translation, example and interval labels", async () => {
    const user = userEvent.setup();
    render(<Flashcard cards={[mk(1)]} />);
    const flip = screen.getByRole("button", { name: /до́м/ });
    await user.click(flip);
    expect(screen.getByText("uy")).toBeInTheDocument();
    expect(screen.getByText("Bu mening uyim.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Qayta 10 daq" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Qiyin 1 kun" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Bildim 4 kun" })).toBeInTheDocument();
    await user.click(flip);
    expect(screen.queryByText("uy")).toBeNull();
    flip.focus();
    await user.keyboard("{Enter}");
    expect(screen.getByText("uy")).toBeInTheDocument();
    await user.keyboard(" ");
    expect(screen.queryByText("uy")).toBeNull();
  });

  it("posts the grade and advances only after the server confirms", async () => {
    const user = userEvent.setup();
    let resolve!: (r: Response) => void;
    const fetchMock = vi.fn(() => new Promise<Response>((r) => (resolve = r)));
    vi.stubGlobal("fetch", fetchMock);
    render(<Flashcard cards={[mk(1), mk(2, { uz: "kot" })]} />);
    await user.click(screen.getByRole("button", { name: /до́м/ }));
    await user.click(screen.getByRole("button", { name: "Bildim 4 kun" }));
    expect(fetchMock).toHaveBeenCalledWith("/api/srs/grade", expect.objectContaining({ method: "POST" }));
    const sent = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(sent).toMatchObject({ wordId: "w1", grade: "good" });
    // not optimistic: still on card 1
    expect(screen.getByText("1 / 2")).toBeInTheDocument();
    resolve(okResponse());
    await waitFor(() => expect(screen.getByText("2 / 2")).toBeInTheDocument());
    expect(screen.queryByText("uy")).toBeNull(); // new card starts unflipped
  });

  it("shows an error and retries the same grade without advancing", async () => {
    const user = userEvent.setup();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("{}", { status: 500 }))
      .mockResolvedValueOnce(okResponse());
    vi.stubGlobal("fetch", fetchMock);
    render(<Flashcard cards={[mk(1), mk(2)]} />);
    await user.click(screen.getByRole("button", { name: /до́м/ }));
    await user.click(screen.getByRole("button", { name: "Qayta 10 daq" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Saqlab bo'lmadi");
    expect(screen.getByText("1 / 2")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Qayta urinish" }));
    await waitFor(() => expect(screen.getByText("2 / 2")).toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("toggles the difficult word with aria-pressed, after the server confirms", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue(okResponse());
    vi.stubGlobal("fetch", fetchMock);
    render(<Flashcard cards={[mk(1)]} />);
    const toggle = screen.getByRole("button", { name: /Qiyin so'z/ });
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    await user.click(toggle);
    await waitFor(() => expect(toggle).toHaveAttribute("aria-pressed", "true"));
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/srs/difficult",
      expect.objectContaining({ body: JSON.stringify({ wordId: "w1", value: true }) }),
    );
  });

  it("hides the audio button without speechSynthesis and shows it with", () => {
    const { unmount } = render(<Flashcard cards={[mk(1)]} />);
    expect(screen.queryByRole("button", { name: "Talaffuzni eshitish" })).toBeNull();
    unmount();
    vi.stubGlobal("speechSynthesis", { cancel: vi.fn(), speak: vi.fn() });
    vi.stubGlobal("SpeechSynthesisUtterance", class {});
    render(<Flashcard cards={[mk(1)]} />);
    expect(screen.getByRole("button", { name: "Talaffuzni eshitish" })).toBeInTheDocument();
  });

  it("shows the finished state after the last card", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(okResponse()));
    render(<Flashcard cards={[mk(1)]} />);
    await user.click(screen.getByRole("button", { name: /до́м/ }));
    await user.click(screen.getByRole("button", { name: "Bildim 4 kun" }));
    expect(await screen.findByText("Takrorlash tugadi")).toBeInTheDocument();
  });

  it("reuses the same requestId when retrying a failed grade, and a new one for the next card", async () => {
    const user = userEvent.setup();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("{}", { status: 500 }))
      .mockResolvedValue(okResponse());
    vi.stubGlobal("fetch", fetchMock);
    render(<Flashcard cards={[mk(1), mk(2)]} />);
    await user.click(screen.getByRole("button", { name: /до́м/ }));
    await user.click(screen.getByRole("button", { name: "Bildim 4 kun" }));
    await user.click(await screen.findByRole("button", { name: "Qayta urinish" }));
    await waitFor(() => expect(screen.getByText("2 / 2")).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: /до́м/ }));
    await user.click(screen.getByRole("button", { name: "Bildim 4 kun" }));
    const ids = fetchMock.mock.calls.map((c) => JSON.parse((c[1] as RequestInit).body as string).requestId);
    expect(ids[0]).toMatch(/^[0-9a-f-]{36}$/);
    expect(ids[1]).toBe(ids[0]);
    expect(ids[2]).not.toBe(ids[0]);
  });

  it("on 409 reloads the queue and shows the current card without advancing or an error", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn(async (url: string) =>
      url === "/api/srs/queue"
        ? new Response(JSON.stringify({ cards: [mk(1, { uz: "yangi holat" })] }), { status: 200 })
        : new Response(JSON.stringify({ error: "conflict" }), { status: 409 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    render(<Flashcard cards={[mk(1), mk(2)]} />);
    await user.click(screen.getByRole("button", { name: /до́м/ }));
    await user.click(screen.getByRole("button", { name: "Bildim 4 kun" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Karta boshqa joyda yangilangan");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByText("1 / 1")).toBeInTheDocument();
    expect(screen.queryByText("uy")).toBeNull(); // unflipped
    await user.click(screen.getByRole("button", { name: /до́м/ }));
    expect(screen.getByText("yangi holat")).toBeInTheDocument();
  });

  it("shows an error when the difficult toggle fails and does not flip the state", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 500 })));
    render(<Flashcard cards={[mk(1)]} />);
    const toggle = screen.getByRole("button", { name: /Qiyin so'z/ });
    await user.click(toggle);
    expect(await screen.findByRole("alert")).toHaveTextContent("Belgini saqlab bo'lmadi");
    expect(toggle).toHaveAttribute("aria-pressed", "false");
  });
});
