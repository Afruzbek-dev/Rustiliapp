import { act, render, renderHook, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Choose, Classify, Conjugate, FillBlank, Match, useAttempt } from "@/components/exercises";

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
    { id: "f", label: "Ayol" },
    { id: "n", label: "O'rta" },
  ],
};

describe("error mapping", () => {
  const cases: [number, string][] = [
    [401, "Seans tugagan"],
    [403, "ruxsat yo'q"],
    [404, "Mashq topilmadi"],
  ];
  for (const [code, text] of cases) {
    it(`HTTP ${code} shows its message and no retry button`, async () => {
      reply({ error: "x" }, code);
      render(<Classify exerciseId="ex1" payload={classifyPayload} />);
      await userEvent.click(screen.getByRole("button", { name: /Ayol/ }));
      expect(await screen.findByRole("alert")).toHaveTextContent(text);
      expect(screen.queryByRole("button", { name: "Qayta urinish" })).not.toBeInTheDocument();
    });
  }

  it("HTTP 401 offers a login link", async () => {
    reply({ error: "x" }, 401);
    render(<Classify exerciseId="ex1" payload={classifyPayload} />);
    await userEvent.click(screen.getByRole("button", { name: /Ayol/ }));
    expect(await screen.findByRole("link", { name: "Qayta kirish" })).toHaveAttribute("href", "/login");
  });

  it("5xx still offers retry", async () => {
    reply({ error: "x" }, 503);
    render(<Classify exerciseId="ex1" payload={classifyPayload} />);
    await userEvent.click(screen.getByRole("button", { name: /Ayol/ }));
    expect(await screen.findByRole("button", { name: "Qayta urinish" })).toBeInTheDocument();
  });

  it("useAttempt maps statuses to error kinds", async () => {
    const { result } = renderHook(() => useAttempt("e"));
    const answer = { itemId: "i", bucketId: "b" };
    for (const [code, kind] of [
      [401, "auth"],
      [403, "forbidden"],
      [404, "notfound"],
      [500, "server"],
    ] as const) {
      reply({}, code);
      await act(async () => {
        await result.current.submit(answer);
      });
      expect(result.current.error).toBe(kind);
      act(() => result.current.reset());
    }
    fetchMock.mockRejectedValueOnce(new TypeError("x"));
    await act(async () => {
      await result.current.submit(answer);
    });
    expect(result.current.error).toBe("network");
  });

  it("a request aborted by reset does not clear the busy flag of a newer one", async () => {
    const { result } = renderHook(() => useAttempt("e"));
    const abortable = (_u: string, init: RequestInit) =>
      new Promise<Response>((_res, rej) => {
        init.signal?.addEventListener("abort", () => rej(new DOMException("a", "AbortError")));
      });
    fetchMock.mockImplementationOnce(abortable).mockImplementationOnce(abortable);
    const a = { itemId: "i", bucketId: "b" };
    let first: Promise<unknown> = Promise.resolve();
    act(() => {
      first = result.current.submit(a);
    });
    act(() => result.current.reset());
    act(() => {
      void result.current.submit(a);
    });
    await act(async () => {
      await first;
    });
    await act(async () => {
      await result.current.submit(a);
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("onDone semantics", () => {
  const conj = { verb: "работать", pronouns: ["я", "ты", "он/она", "мы", "вы", "они"] };
  const forms = ["работаю", "работаешь", "работает", "работаем", "работаете", "работают"];

  async function fillConj() {
    for (const [i, p] of conj.pronouns.entries()) await userEvent.type(screen.getByLabelText(p), forms[i]);
    await userEvent.click(screen.getByRole("button", { name: "Tekshirish" }));
  }

  it("Conjugate: wrong answer clears the form and does not call onDone", async () => {
    reply({ correct: false, expected: forms, perItem: [false, true, true, true, true, true], xpAwarded: 0 });
    const onDone = vi.fn();
    render(<Conjugate exerciseId="ex3" payload={conj} onDone={onDone} />);
    await fillConj();
    await userEvent.click(await screen.findByRole("button", { name: "Tushundim" }));
    expect(onDone).not.toHaveBeenCalled();
    const input = screen.getByLabelText("я") as HTMLInputElement;
    expect(input.value).toBe("");
    expect(input).not.toHaveAttribute("readonly");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("Conjugate: correct answer calls onDone", async () => {
    reply({ correct: true, expected: forms, perItem: forms.map(() => true), xpAwarded: 15 });
    const onDone = vi.fn();
    render(<Conjugate exerciseId="ex3" payload={conj} onDone={onDone} />);
    await fillConj();
    await userEvent.click(await screen.findByRole("button", { name: "Davom etish" }));
    expect(onDone).toHaveBeenCalledOnce();
  });

  const match = {
    left: [
      { id: "l1", text: "дом" },
      { id: "l2", text: "кот" },
    ],
    right: [
      { id: "r1", text: "uy" },
      { id: "r2", text: "mushuk" },
    ],
  };
  async function pairAll(swap: boolean) {
    await userEvent.click(screen.getByRole("button", { name: "дом" }));
    await userEvent.click(screen.getByRole("button", { name: swap ? "mushuk" : "uy" }));
    await userEvent.click(screen.getByRole("button", { name: "кот" }));
    await userEvent.click(screen.getByRole("button", { name: swap ? "uy" : "mushuk" }));
  }

  it("Match: wrong answer resets pairs and does not call onDone", async () => {
    reply({ correct: false, expected: { l1: "r1", l2: "r2" }, xpAwarded: 0 });
    const onDone = vi.fn();
    render(<Match exerciseId="ex5" payload={match} onDone={onDone} />);
    await pairAll(true);
    await userEvent.click(await screen.findByRole("button", { name: "Tushundim" }));
    expect(onDone).not.toHaveBeenCalled();
    expect(screen.queryByText(/juftlik 1/)).not.toBeInTheDocument();
  });

  it("Match: correct answer calls onDone", async () => {
    reply({ correct: true, expected: { l1: "r1", l2: "r2" }, xpAwarded: 10 });
    const onDone = vi.fn();
    render(<Match exerciseId="ex5" payload={match} onDone={onDone} />);
    await pairAll(false);
    await userEvent.click(await screen.findByRole("button", { name: "Davom etish" }));
    expect(onDone).toHaveBeenCalledOnce();
  });
});

describe("multi-item advance and keyboard", () => {
  it("Classify advances to the next item and updates progress", async () => {
    reply({ correct: true, xpAwarded: 10 });
    const payload = {
      ...classifyPayload,
      items: [
        { id: "i1", text: "тетрадь" },
        { id: "i2", text: "стол" },
      ],
    };
    const onDone = vi.fn();
    render(<Classify exerciseId="ex1" payload={payload} onDone={onDone} />);
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "0");
    await userEvent.click(screen.getByRole("button", { name: /Ayol/ }));
    await screen.findByText("Zo'r! +10 XP");
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "1");
    await userEvent.click(screen.getByRole("button", { name: "Davom etish" }));
    expect(screen.getByText("стол")).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(onDone).not.toHaveBeenCalled();
    reply({ correct: true, xpAwarded: 10 });
    await userEvent.click(screen.getByRole("button", { name: /Erkak/ }));
    expect(lastBody().answer).toEqual({ itemId: "i2", bucketId: "m" });
  });

  it("FillBlank advances to the next item", async () => {
    reply({ correct: true, xpAwarded: 10 });
    const payload = {
      items: [
        { id: "b1", before: "Он", after: "." },
        { id: "b2", before: "Мы", after: "." },
      ],
    };
    render(<FillBlank exerciseId="ex2" payload={payload} />);
    await userEvent.type(screen.getByLabelText("Bo'sh joyni to'ldiring"), "x");
    await userEvent.keyboard("{Enter}");
    await userEvent.click(await screen.findByRole("button", { name: "Davom etish" }));
    expect(screen.getByText("Мы")).toBeInTheDocument();
    expect((screen.getByLabelText("Bo'sh joyni to'ldiring") as HTMLInputElement).value).toBe("");
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "1");
  });

  it("Choose advances to the next item", async () => {
    reply({ correct: true, xpAwarded: 10 });
    const payload = {
      items: [
        { id: "c1", text: "первый", options: ["а", "б"] },
        { id: "c2", text: "второй", options: ["в", "г"] },
      ],
    };
    render(<Choose exerciseId="ex4" payload={payload} />);
    await userEvent.click(screen.getByRole("button", { name: "а" }));
    await userEvent.click(await screen.findByRole("button", { name: "Davom etish" }));
    expect(screen.getByText("второй")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "в" })).toBeEnabled();
  });

  it("a Classify bucket works with Enter", async () => {
    reply({ correct: true, xpAwarded: 10 });
    render(<Classify exerciseId="ex1" payload={classifyPayload} />);
    screen.getByRole("button", { name: /Ayol/ }).focus();
    await userEvent.keyboard("{Enter}");
    expect(lastBody().answer.bucketId).toBe("f");
    await screen.findByRole("status");
  });

  it("a Classify bucket works with Space", async () => {
    reply({ correct: true, xpAwarded: 10 });
    render(<Classify exerciseId="ex1" payload={classifyPayload} />);
    screen.getByRole("button", { name: /Erkak/ }).focus();
    await userEvent.keyboard(" ");
    expect(lastBody().answer.bucketId).toBe("m");
    await screen.findByRole("status");
  });
});
