import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Choose, Classify, Conjugate, FillBlank, Match } from "@/components/exercises";

const fetchMock = vi.fn();

function reply(body: unknown, status = 200) {
  fetchMock.mockResolvedValueOnce(
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }),
  );
}

function lastBody() {
  const call = fetchMock.mock.calls.at(-1);
  return JSON.parse((call?.[1] as RequestInit).body as string);
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

const classifyPayload = {
  items: [{ id: "i1", text: "тетрадь" }],
  buckets: [
    { id: "m", label: "Erkak" },
    { id: "f", label: "Ayol", hint: "-ь ham bo'lishi mumkin" },
    { id: "n", label: "O'rta" },
  ],
};

describe("Classify", () => {
  it("renders the word and three buckets, sends the answer, shows ok feedback with XP", async () => {
    reply({ correct: true, expected: "f", xpAwarded: 10 });
    render(<Classify exerciseId="ex1" payload={classifyPayload} />);
    expect(screen.getByText("тетрадь")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /Erkak|Ayol|O'rta/ })).toHaveLength(3);
    await userEvent.click(screen.getByRole("button", { name: /Ayol/ }));
    expect(lastBody()).toEqual({ exerciseId: "ex1", answer: { itemId: "i1", bucketId: "f" } });
    expect(await screen.findByText("Zo'r! +10 XP")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveFocus();
  });

  it("shows wrong feedback with the expected bucket and an outlined correct bucket", async () => {
    reply({ correct: false, expected: "f", xpAwarded: 0 });
    render(<Classify exerciseId="ex1" payload={classifyPayload} />);
    await userEvent.click(screen.getByRole("button", { name: /Erkak/ }));
    expect(await screen.findByText("Deyarli!")).toBeInTheDocument();
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("To'g'ri javob: Ayol");
    expect(alert).toHaveFocus();
    expect(screen.getByRole("button", { name: /Ayol/ }).className).toContain("border-dashed");
    expect(screen.getByRole("button", { name: "Tushundim" })).toBeInTheDocument();
  });

  it("offers a retry after a network error and recovers", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    render(<Classify exerciseId="ex1" payload={classifyPayload} />);
    await userEvent.click(screen.getByRole("button", { name: /Ayol/ }));
    const retry = await screen.findByRole("button", { name: "Qayta urinish" });
    expect(screen.getByRole("alert")).toHaveFocus();
    reply({ correct: true, expected: "f", xpAwarded: 10 });
    await userEvent.click(retry);
    expect(await screen.findByText("Zo'r! +10 XP")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not show a verdict before the server answers", async () => {
    let resolve: (r: Response) => void = () => {};
    fetchMock.mockReturnValueOnce(new Promise<Response>((r) => (resolve = r)));
    render(<Classify exerciseId="ex1" payload={classifyPayload} />);
    await userEvent.click(screen.getByRole("button", { name: /Ayol/ }));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Erkak/ })).toBeDisabled();
    resolve(new Response(JSON.stringify({ correct: true, xpAwarded: 10 }), { status: 200 }));
    expect(await screen.findByText("Zo'r! +10 XP")).toBeInTheDocument();
  });

  it("calls onDone after the last item", async () => {
    reply({ correct: true, xpAwarded: 10 });
    const onDone = vi.fn();
    render(<Classify exerciseId="ex1" payload={classifyPayload} onDone={onDone} />);
    await userEvent.click(screen.getByRole("button", { name: /Ayol/ }));
    await userEvent.click(await screen.findByRole("button", { name: "Davom etish" }));
    expect(onDone).toHaveBeenCalledOnce();
  });

  it("hides the audio button when speechSynthesis is unsupported and shows it otherwise", async () => {
    const { unmount } = render(<Classify exerciseId="ex1" payload={classifyPayload} />);
    await waitFor(() => expect(screen.queryByRole("button", { name: "Talaffuzni eshitish" })).toBeNull());
    unmount();
    const speak = vi.fn();
    const cancel = vi.fn();
    vi.stubGlobal("speechSynthesis", { speak, cancel });
    vi.stubGlobal(
      "SpeechSynthesisUtterance",
      class {
        lang = "";
        constructor(public text: string) {}
      },
    );
    Object.defineProperty(window, "speechSynthesis", { value: { speak, cancel }, configurable: true });
    render(<Classify exerciseId="ex1" payload={classifyPayload} />);
    await userEvent.click(await screen.findByRole("button", { name: "Talaffuzni eshitish" }));
    expect(speak).toHaveBeenCalledOnce();
    expect(speak.mock.calls[0][0]).toMatchObject({ text: "тетрадь", lang: "ru-RU" });
    // @ts-expect-error cleanup of the test-only property
    delete window.speechSynthesis;
  });
});

describe("FillBlank", () => {
  const payload = { items: [{ id: "b1", before: "Он", after: "в парке.", hint: "гулять" }] };

  it("sends the typed value with the right attributes and shows ok feedback", async () => {
    reply({ correct: true, expected: ["гуляет"], xpAwarded: 10 });
    render(<FillBlank exerciseId="ex2" payload={payload} />);
    const input = screen.getByLabelText("Bo'sh joyni to'ldiring");
    expect(input).toHaveAttribute("autocomplete", "off");
    expect(input).toHaveAttribute("autocapitalize", "none");
    expect(input).toHaveAttribute("spellcheck", "false");
    expect(input).toHaveAttribute("lang", "ru");
    await userEvent.type(input, "гуляет");
    await userEvent.keyboard("{Enter}");
    expect(lastBody()).toEqual({ exerciseId: "ex2", answer: { itemId: "b1", value: "гуляет" } });
    expect(await screen.findByText("Zo'r! +10 XP")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveFocus();
  });

  it("shows the expected answer and hint when wrong", async () => {
    reply({ correct: false, expected: ["гуляет"], xpAwarded: 0 });
    render(<FillBlank exerciseId="ex2" payload={payload} />);
    await userEvent.type(screen.getByLabelText("Bo'sh joyni to'ldiring"), "гуляют");
    await userEvent.click(screen.getByRole("button", { name: "Tekshirish" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("To'g'ri javob: гуляет");
    expect(alert).toHaveTextContent("гулять");
    expect(alert).toHaveFocus();
  });

  it("offers retry on server error", async () => {
    reply({ error: "boom" }, 500);
    render(<FillBlank exerciseId="ex2" payload={payload} />);
    await userEvent.type(screen.getByLabelText("Bo'sh joyni to'ldiring"), "x");
    await userEvent.click(screen.getByRole("button", { name: "Tekshirish" }));
    expect(await screen.findByRole("button", { name: "Qayta urinish" })).toBeInTheDocument();
  });
});

describe("Conjugate", () => {
  const payload = { verb: "работать", pronouns: ["я", "ты", "он/она", "мы", "вы", "они"] };
  const forms = ["работаю", "работаешь", "работает", "работаем", "работаете", "работаут"];

  it("renders six labelled inputs and sends all forms", async () => {
    reply({ correct: true, expected: forms, perItem: [true, true, true, true, true, true], xpAwarded: 15 });
    render(<Conjugate exerciseId="ex3" payload={payload} />);
    expect(screen.getByText("работать")).toBeInTheDocument();
    for (const [i, p] of payload.pronouns.entries()) {
      const input = screen.getByLabelText(p);
      expect(input).toHaveAttribute("autocomplete", "off");
      expect(input).toHaveAttribute("autocapitalize", "none");
      expect(input).toHaveAttribute("spellcheck", "false");
      expect(input).toHaveAttribute("lang", "ru");
      await userEvent.type(input, forms[i]);
    }
    await userEvent.click(screen.getByRole("button", { name: "Tekshirish" }));
    expect(lastBody()).toEqual({ exerciseId: "ex3", answer: { forms } });
    expect(await screen.findByText("Zo'r! +15 XP")).toBeInTheDocument();
  });

  it("marks each field using perItem and lists expected forms", async () => {
    const expected = ["работаю", "работаешь", "работает", "работаем", "работаете", "работают"];
    reply({ correct: false, expected, perItem: [true, true, true, true, true, false], xpAwarded: 0 });
    render(<Conjugate exerciseId="ex3" payload={payload} />);
    for (const [i, p] of payload.pronouns.entries()) await userEvent.type(screen.getByLabelText(p), forms[i]);
    await userEvent.click(screen.getByRole("button", { name: "Tekshirish" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("работают");
    expect(screen.getByLabelText("они")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText("я")).not.toHaveAttribute("aria-invalid");
    expect(screen.getAllByText("Noto'g'ri")).toHaveLength(1);
    expect(screen.getAllByText("To'g'ri")).toHaveLength(5);
  });

  it("keeps submit disabled until all six forms are filled", async () => {
    render(<Conjugate exerciseId="ex3" payload={payload} />);
    expect(screen.getByRole("button", { name: "Tekshirish" })).toBeDisabled();
  });
});

describe("Choose", () => {
  const payload = { items: [{ id: "c1", text: "Это ___ книга.", options: ["моя", "мой", "моё"] }] };

  it("sends the chosen index and shows ok feedback", async () => {
    reply({ correct: true, expected: 0, xpAwarded: 10 });
    render(<Choose exerciseId="ex4" payload={payload} />);
    await userEvent.click(screen.getByRole("button", { name: "моя" }));
    expect(lastBody()).toEqual({ exerciseId: "ex4", answer: { itemId: "c1", index: 0 } });
    expect(await screen.findByText("Zo'r! +10 XP")).toBeInTheDocument();
  });

  it("shows the expected option text when wrong", async () => {
    reply({ correct: false, expected: 0, xpAwarded: 0 });
    render(<Choose exerciseId="ex4" payload={payload} />);
    await userEvent.click(screen.getByRole("button", { name: "мой" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("To'g'ri javob: моя");
    expect(alert).toHaveFocus();
  });

  it("retries after a network error", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("offline"));
    render(<Choose exerciseId="ex4" payload={payload} />);
    await userEvent.click(screen.getByRole("button", { name: "мой" }));
    expect(await screen.findByRole("button", { name: "Qayta urinish" })).toBeInTheDocument();
  });
});

describe("Match", () => {
  const payload = {
    left: [
      { id: "l1", text: "дом" },
      { id: "l2", text: "кот" },
    ],
    right: [
      { id: "r1", text: "uy" },
      { id: "r2", text: "mushuk" },
    ],
  };

  it("pairs a left and a right item, submits when all are paired", async () => {
    reply({ correct: true, expected: { l1: "r1", l2: "r2" }, xpAwarded: 10 });
    render(<Match exerciseId="ex5" payload={payload} />);
    await userEvent.click(screen.getByRole("button", { name: "дом" }));
    await userEvent.click(screen.getByRole("button", { name: "uy" }));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /дом/ })).toHaveTextContent("juftlik 1");
    await userEvent.click(screen.getByRole("button", { name: "кот" }));
    await userEvent.click(screen.getByRole("button", { name: "mushuk" }));
    expect(lastBody()).toEqual({
      exerciseId: "ex5",
      answer: {
        pairs: [
          ["l1", "r1"],
          ["l2", "r2"],
        ],
      },
    });
    expect(await screen.findByText("Zo'r! +10 XP")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveFocus();
  });

  it("marks matched and unmatched pairs and shows the correct pairing", async () => {
    reply({ correct: false, expected: { l1: "r1", l2: "r2" }, xpAwarded: 0 });
    render(<Match exerciseId="ex5" payload={payload} />);
    await userEvent.click(screen.getByRole("button", { name: "дом" }));
    await userEvent.click(screen.getByRole("button", { name: "mushuk" }));
    await userEvent.click(screen.getByRole("button", { name: "кот" }));
    await userEvent.click(screen.getByRole("button", { name: "uy" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("дом - uy, кот - mushuk");
    expect(screen.getByRole("button", { name: /дом/ })).toHaveTextContent("noto'g'ri");
    expect(screen.getByRole("button", { name: /кот/ })).toHaveTextContent("noto'g'ri");
  });

  it("lets a pair be undone before submitting", async () => {
    render(<Match exerciseId="ex5" payload={payload} />);
    await userEvent.click(screen.getByRole("button", { name: "дом" }));
    await userEvent.click(screen.getByRole("button", { name: "uy" }));
    await userEvent.click(screen.getByRole("button", { name: /дом/ }));
    expect(screen.getByRole("button", { name: "uy" })).toBeEnabled();
    expect(screen.queryByText(/juftlik 1/)).not.toBeInTheDocument();
  });

  it("offers retry on network error", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("offline"));
    render(<Match exerciseId="ex5" payload={payload} />);
    await userEvent.click(screen.getByRole("button", { name: "дом" }));
    await userEvent.click(screen.getByRole("button", { name: "uy" }));
    await userEvent.click(screen.getByRole("button", { name: "кот" }));
    await userEvent.click(screen.getByRole("button", { name: "mushuk" }));
    expect(await screen.findByRole("button", { name: "Qayta urinish" })).toBeInTheDocument();
  });
});

describe("useAttempt abort", () => {
  it("aborts the request on unmount", async () => {
    let signal: AbortSignal | undefined;
    fetchMock.mockImplementationOnce((_u: string, init: RequestInit) => {
      signal = init.signal as AbortSignal;
      return new Promise(() => {});
    });
    const { unmount } = render(<Classify exerciseId="ex1" payload={classifyPayload} />);
    await userEvent.click(screen.getByRole("button", { name: /Ayol/ }));
    unmount();
    expect(signal?.aborted).toBe(true);
  });
});
