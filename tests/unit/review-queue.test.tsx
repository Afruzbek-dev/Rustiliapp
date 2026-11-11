import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ReviewQueue, type ReviewQueueProps } from "@/components/staff/ReviewQueue";
import type { QueueItem } from "@/lib/curator-types";
import CuratorError from "@/app/(staff)/curator/error";
import Loading from "@/app/(staff)/curator/loading";

const NOW = "2026-11-11T12:00:00.000Z";
const item = (n: number, over: Partial<QueueItem> = {}): QueueItem => ({
  id: `00000000-0000-4000-8000-00000000010${n}`,
  kind: "video",
  status: "pending",
  createdAt: "2026-11-11T10:00:00.000Z",
  studentName: `Talaba${n} V.`,
  lessonTitle: `Dars ${n}`,
  prompt: `Расскажите ${n}`,
  review: null,
  ...over,
});
const reviewedItem = (n: number): QueueItem =>
  item(n, {
    status: "reviewed",
    review: {
      scores: { completeness: 3, pronunciation: 3, grammar: 3, fluency: 3 },
      total: 3,
      comment: "Eski izoh",
      reviewerName: "Zarina Q.",
      isOverride: false,
      createdAt: "2026-11-10T10:00:00.000Z",
    },
  });

const setup = (props: Partial<ReviewQueueProps> = {}) =>
  render(<ReviewQueue initialItems={[item(1), item(2)]} reviewed={[]} canOverride={false} nowIso={NOW} {...props} />);

const rate = async (user: ReturnType<typeof userEvent.setup>, values: [string, number][]) => {
  for (const [label, n] of values) await user.click(screen.getByRole("button", { name: `${label}: ${n}` }));
};
const ALL: [string, number][] = [
  ["Matnni to'liq aytdi", 4],
  ["Talaffuz", 4],
  ["Grammatika", 5],
  ["Ravonlik", 3],
];

function mockFetch(handler: (url: string, body: Record<string, unknown> | null) => Response | Promise<Response>) {
  const fn = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) =>
    handler(String(url), init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null),
  );
  vi.stubGlobal("fetch", fn);
  return fn;
}
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
const reviewCalls = (fn: ReturnType<typeof mockFetch>) =>
  fn.mock.calls.filter(([u]) => String(u) === "/api/reviews");

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ReviewQueue", () => {
  it("shows title, count chip, current submission and the oldest first", () => {
    setup();
    expect(screen.getByRole("heading", { level: 1, name: "Tekshirish navbati" })).toBeInTheDocument();
    expect(screen.getByText("Navbatda 2 ta topshiriq")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent("Talaba1 V.");
    expect(screen.getByText("Dars 1")).toBeInTheDocument();
    expect(screen.getByText("2 soat oldin")).toBeInTheDocument();
    const video = document.querySelector("video")!;
    expect(video).toHaveAttribute("src", "/api/media/tg/00000000-0000-4000-8000-000000000101");
    expect(video).toHaveAttribute("controls");
    expect(video).toHaveAttribute("playsinline");
  });

  it("selecting a score is a real button with aria-label and pressed state; the submit stays disabled until all four are set", async () => {
    const user = userEvent.setup();
    setup();
    const submit = () => screen.getByRole("button", { name: /^Baholash/ });
    expect(submit()).toBeDisabled();
    await rate(user, ALL.slice(0, 3));
    expect(submit()).toBeDisabled();
    const four = screen.getByRole("button", { name: "Talaffuz: 4" });
    expect(four).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Talaffuz: 5" })).toHaveAttribute("aria-pressed", "false");
    await rate(user, [ALL[3]!]);
    expect(submit()).toBeEnabled();
    expect(submit()).toHaveTextContent("Baholash · 4.0 · keyingisi");
  });

  it("toggles the exercise prompt", async () => {
    const user = userEvent.setup();
    setup();
    expect(screen.queryByText("Расскажите 1")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Matnni ko'rsatish" }));
    expect(screen.getByText("Расскажите 1")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Matnni yashirish" }));
    expect(screen.queryByText("Расскажите 1")).not.toBeInTheDocument();
  });

  it("submits the JSON payload without override, then opens the next submission with focus on its heading", async () => {
    const user = userEvent.setup();
    const fetchFn = mockFetch(() => json(200, { ok: true, total: 4, isOverride: false }));
    setup();
    await rate(user, ALL);
    await user.type(screen.getByLabelText("Izoh (ixtiyoriy)"), "  Yaxshi  ");
    await user.click(screen.getByRole("button", { name: /^Baholash/ }));

    await waitFor(() => expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent("Talaba2 V."));
    const [url, init] = reviewCalls(fetchFn)[0]!;
    expect(url).toBe("/api/reviews");
    expect((init!.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
    const body = JSON.parse(String(init!.body));
    expect(body).toEqual({
      submissionId: "00000000-0000-4000-8000-000000000101",
      scores: { completeness: 4, pronunciation: 4, grammar: 5, fluency: 3 },
      comment: "Yaxshi",
    });
    expect("override" in body).toBe(false);
    expect(screen.getByText("Navbatda 1 ta topshiriq")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Baho yuborildi");
    expect(screen.getByRole("heading", { level: 2 })).toHaveFocus();
    // the form of the next item starts empty
    expect(screen.getByRole("button", { name: /^Baholash/ })).toBeDisabled();
  });

  it("does not advance before the server answers (never optimistic)", async () => {
    const user = userEvent.setup();
    let release: (r: Response) => void = () => {};
    mockFetch(() => new Promise<Response>((res) => (release = res)));
    setup();
    await rate(user, ALL);
    await user.click(screen.getByRole("button", { name: /^Baholash/ }));
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent("Talaba1 V.");
    release(json(200, { ok: true, total: 4 }));
    await waitFor(() => expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent("Talaba2 V."));
  });

  it("409: says another curator reviewed it and moves on", async () => {
    const user = userEvent.setup();
    mockFetch(() => json(409, { error: "already_reviewed" }));
    setup();
    await rate(user, ALL);
    await user.click(screen.getByRole("button", { name: /^Baholash/ }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Boshqa kurator baholadi"));
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent("Talaba2 V.");
  });

  it.each([
    [403, "Bu topshiriqni baholashga ruxsat yo'q"],
    [404, "Topshiriq topilmadi"],
  ])("%i: shows the error and advances", async (status, text) => {
    const user = userEvent.setup();
    mockFetch(() => json(status, { error: "x" }));
    setup();
    await rate(user, ALL);
    await user.click(screen.getByRole("button", { name: /^Baholash/ }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(text));
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent("Talaba2 V.");
  });

  it.each([
    ["network error", () => Promise.reject(new TypeError("offline"))],
    ["500", () => Promise.resolve(json(500, { error: "internal_error" }))],
  ])("%s: keeps the form and allows a retry", async (_name, fail) => {
    const user = userEvent.setup();
    let attempt = 0;
    const fetchFn = mockFetch(() => (++attempt === 1 ? (fail() as Promise<Response>) : json(200, { ok: true, total: 4 })));
    setup();
    await rate(user, ALL);
    await user.click(screen.getByRole("button", { name: /^Baholash/ }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(/Qayta urinib/));
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent("Talaba1 V.");
    expect(screen.getByRole("button", { name: "Talaffuz: 4" })).toHaveAttribute("aria-pressed", "true");
    await user.click(screen.getByRole("button", { name: /^Baholash/ }));
    await waitFor(() => expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent("Talaba2 V."));
    expect(reviewCalls(fetchFn)).toHaveLength(2);
  });

  it("focus is never lost to <body>: score buttons stay focusable while busy and a failed submit returns focus to the card", async () => {
    const user = userEvent.setup();
    let release: (r: Response) => void = () => undefined;
    mockFetch(() => new Promise<Response>((res) => (release = res)));
    setup();
    await rate(user, ALL);
    const score = screen.getByRole("button", { name: "Talaffuz: 4" });
    score.focus();
    await user.keyboard("{Enter}"); // submits the finished form from a score button
    await waitFor(() => expect(screen.getByRole("button", { name: /^Baholash/ })).toHaveAttribute("aria-busy", "true"));
    expect(score).not.toBeDisabled();
    expect(score).toHaveAttribute("aria-disabled", "true");
    expect(document.activeElement).toBe(score);
    await user.click(screen.getByRole("button", { name: "Talaffuz: 2" })); // ignored while busy
    expect(score).toHaveAttribute("aria-pressed", "true");
    release(json(500, { error: "internal_error" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(/Qayta urinib/));
    expect(document.activeElement).not.toBe(document.body);
  });

  it("skip moves to the next item without a server call and keeps it in the queue", async () => {
    const user = userEvent.setup();
    const fetchFn = mockFetch(() => json(200, {}));
    setup();
    await user.click(screen.getByRole("button", { name: "O'tkazish" }));
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent("Talaba2 V.");
    expect(screen.getByText("Navbatda 2 ta topshiriq")).toBeInTheDocument();
    expect(reviewCalls(fetchFn)).toHaveLength(0);
    await user.click(screen.getByRole("button", { name: "O'tkazish" }));
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent("Talaba1 V.");
  });

  it("single item: skip is disabled", () => {
    setup({ initialItems: [item(1)] });
    expect(screen.getByRole("button", { name: "O'tkazish" })).toBeDisabled();
  });

  it("keyboard: digits rate the focused criterion, Tab moves criterion, Enter submits when valid", async () => {
    const user = userEvent.setup();
    const fetchFn = mockFetch(() => json(200, { ok: true, total: 4 }));
    setup();
    // the hint is present for screen readers
    expect(screen.getByText(/Enter/, { selector: "p.sr-only" })).toBeInTheDocument();

    await user.tab(); // media / prompt toggle come first; move to the first criterion
    for (let i = 0; i < 8 && !document.activeElement?.closest("[data-rubric-row]"); i++) await user.tab();
    expect(document.activeElement).toHaveAttribute("aria-label", "Matnni to'liq aytdi: 1");
    await user.keyboard("4");
    await user.tab();
    expect(document.activeElement).toHaveAttribute("aria-label", "Talaffuz: 1");
    await user.keyboard("4");
    await user.tab();
    await user.keyboard("5");
    // Enter on an incomplete form does not submit
    await user.keyboard("{Enter}");
    expect(reviewCalls(fetchFn)).toHaveLength(0);
    await user.tab();
    await user.keyboard("3");
    expect(screen.getByRole("button", { name: "Ravonlik: 3" })).toHaveAttribute("aria-pressed", "true");
    await user.keyboard("{Enter}");
    await waitFor(() => expect(reviewCalls(fetchFn)).toHaveLength(1));
    expect(JSON.parse(String(reviewCalls(fetchFn)[0]![1]!.body)).scores).toEqual({
      completeness: 4, pronunciation: 4, grammar: 5, fluency: 3,
    });
  });

  it("digits typed in the comment box are text, not scores", async () => {
    const user = userEvent.setup();
    setup();
    await user.type(screen.getByLabelText("Izoh (ixtiyoriy)"), "12345");
    expect(screen.getByLabelText("Izoh (ixtiyoriy)")).toHaveValue("12345");
    expect(screen.queryAllByRole("button", { pressed: true })).toHaveLength(0);
  });

  it("limits the comment to 1000 characters", () => {
    setup();
    expect(screen.getByLabelText("Izoh (ixtiyoriy)")).toHaveAttribute("maxlength", "1000");
  });

  it("audio: fetches a signed URL for the current submission, with play/pause and speeds", async () => {
    const user = userEvent.setup();
    const fetchFn = mockFetch((url) => (url.startsWith("/api/submissions/audio-url") ? json(200, { url: "https://signed.example/a.webm" }) : json(200, {})));
    const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(async () => {});
    setup({ initialItems: [item(1, { kind: "audio" })] });
    await waitFor(() => expect(document.querySelector("audio")).toHaveAttribute("src", "https://signed.example/a.webm"));
    expect(fetchFn.mock.calls[0]![0]).toBe("/api/submissions/audio-url?id=00000000-0000-4000-8000-000000000101");
    await user.click(screen.getByRole("button", { name: "Eshitish" }));
    expect(play).toHaveBeenCalled();
    const speeds = within(screen.getByRole("group", { name: "Tezlik" })).getAllByRole("button");
    expect(speeds.map((b) => b.textContent)).toEqual(["1x", "1.25x", "1.5x"]);
    await user.click(speeds[2]!);
    expect(speeds[2]).toHaveAttribute("aria-pressed", "true");
    expect(document.querySelector("audio")!.playbackRate).toBe(1.5);
    play.mockRestore();
  });

  it("audio: a failed signed URL shows an error with a retry", async () => {
    const user = userEvent.setup();
    let n = 0;
    mockFetch(() => (++n === 1 ? json(404, { error: "not_found" }) : json(200, { url: "https://signed.example/a" })));
    setup({ initialItems: [item(1, { kind: "audio" })] });
    expect(await screen.findByText("Audioni yuklab bo'lmadi")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Audioni qayta yuklash" }));
    await waitFor(() => expect(document.querySelector("audio")).toBeInTheDocument());
  });
});

describe("ReviewQueue states", () => {
  it("empty queue shows the empty state", () => {
    setup({ initialItems: [] });
    expect(screen.getByText("Navbat bo'sh — hammasi baholangan")).toBeInTheDocument();
    expect(screen.getByText("Navbatda 0 ta topshiriq")).toBeInTheDocument();
  });

  it("becomes empty after the last review", async () => {
    const user = userEvent.setup();
    mockFetch(() => json(200, { ok: true, total: 4 }));
    setup({ initialItems: [item(1)] });
    await rate(user, ALL);
    await user.click(screen.getByRole("button", { name: /^Baholash/ }));
    expect(await screen.findByText("Navbat bo'sh — hammasi baholangan")).toBeInTheDocument();
  });

  it("loading state announces itself", () => {
    render(<Loading />);
    expect(screen.getByRole("status")).toHaveTextContent("Yuklanmoqda");
  });

  it("error state offers a retry and logs only name and digest", async () => {
    const user = userEvent.setup();
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const reset = vi.fn();
    const err = Object.assign(new Error("student Ali secret"), { digest: "d1" });
    render(<CuratorError error={err} reset={reset} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Navbatni yuklab bo'lmadi");
    await user.click(screen.getByRole("button", { name: "Qayta urinish" }));
    expect(reset).toHaveBeenCalled();
    expect(JSON.stringify(log.mock.calls)).not.toContain("secret");
    log.mockRestore();
  });
});

describe("ReviewQueue: Qayta ko'rish (teacher/admin)", () => {
  const staff = (extra: Partial<ReviewQueueProps> = {}) =>
    setup({ canOverride: true, reviewed: [reviewedItem(5)], ...extra });

  it("curators get no tabs", () => {
    setup();
    expect(screen.queryByRole("tab")).not.toBeInTheDocument();
  });

  it("staff get tabs with aria-selected and a list of reviewed items", async () => {
    const user = userEvent.setup();
    staff();
    const queueTab = screen.getByRole("tab", { name: "Navbat" });
    const reviewTab = screen.getByRole("tab", { name: "Qayta ko'rish" });
    expect(queueTab).toHaveAttribute("aria-selected", "true");
    await user.click(reviewTab);
    expect(reviewTab).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("button", { name: /Talaba5 V\./ })).toHaveTextContent("3.00");
  });

  it("opening a reviewed item shows the existing review and submits with override: true", async () => {
    const user = userEvent.setup();
    const fetchFn = mockFetch(() => json(200, { ok: true, total: 4.5, isOverride: true }));
    staff();
    await user.click(screen.getByRole("tab", { name: "Qayta ko'rish" }));
    await user.click(screen.getByRole("button", { name: /Talaba5 V\./ }));
    expect(screen.getByText(/Joriy baho: 3\.00/)).toBeInTheDocument();
    expect(screen.getAllByText("Eski izoh").length).toBeGreaterThan(0);
    // prefilled with the previous scores: only change two criteria
    expect(screen.getByRole("button", { name: "Grammatika: 3" })).toHaveAttribute("aria-pressed", "true");
    await rate(user, [["Grammatika", 5], ["Ravonlik", 5]]);
    await user.click(screen.getByRole("button", { name: /^Bahoni yangilash/ }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Baho yangilandi: 4.50"));
    const body = JSON.parse(String(reviewCalls(fetchFn)[0]![1]!.body));
    expect(body).toEqual({
      submissionId: "00000000-0000-4000-8000-000000000105",
      scores: { completeness: 3, pronunciation: 3, grammar: 5, fluency: 5 },
      comment: "Eski izoh",
      override: true,
    });
    // no skip button for overrides
    expect(screen.queryByRole("button", { name: "O'tkazish" })).not.toBeInTheDocument();
  });

  it("a pending item in the queue tab NEVER sends override, even for staff", async () => {
    const user = userEvent.setup();
    const fetchFn = mockFetch(() => json(200, { ok: true, total: 4 }));
    staff();
    await rate(user, ALL);
    await user.click(screen.getByRole("button", { name: /^Baholash/ }));
    await waitFor(() => expect(reviewCalls(fetchFn)).toHaveLength(1));
    expect("override" in JSON.parse(String(reviewCalls(fetchFn)[0]![1]!.body))).toBe(false);
  });

  it("deep link to a reviewed item opens it in the review tab", () => {
    staff({ initialTab: "reviewed", initialOpenId: reviewedItem(5).id });
    expect(screen.getByRole("tab", { name: "Qayta ko'rish" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("button", { name: /^Bahoni yangilash · 3\.0/ })).toBeEnabled(); // prefilled with the existing scores
    expect(screen.getByText(/Joriy baho/)).toBeInTheDocument();
  });

  it("a reviewed deep link for a curator is read-only: no form, no override", () => {
    setup({ pinned: reviewedItem(5) });
    expect(screen.getByText(/Allaqachon baholangan: 3\.00/)).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /^Talaffuz: / })).toHaveLength(5); // only the queue's own form
  });
});
