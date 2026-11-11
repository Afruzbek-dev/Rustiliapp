import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const verifyOtp = vi.fn();
vi.mock("@/lib/supabase/browser", () => ({ createClient: () => ({ auth: { verifyOtp } }) }));

import { LoginFlow } from "@/components/auth/LoginFlow";

const NONCE = "n".repeat(32);
const START = {
  nonce: NONCE,
  deepLink: `https://t.me/po_russki_bot?start=login_${NONCE}`,
  matchCode: "47",
  expiresAt: new Date(Date.now() + 600_000).toISOString(),
};
const ID = { name: "Dilnoza A.", phoneMasked: "+998 90 *** ** 47" };

type Route = (url: string, init?: RequestInit) => { status: number; body: unknown };
const jsonRes = (r: { status: number; body: unknown }) =>
  new Response(JSON.stringify(r.body), { status: r.status, headers: { "Content-Type": "application/json" } });

let statusAnswers: { status: number; body: unknown }[];
let exchange: { status: number; body: unknown };
let fetchMock: ReturnType<typeof vi.fn>;

const route: Route = (url) => {
  if (url.endsWith("/start")) return { status: 200, body: START };
  if (url.includes("/status")) return statusAnswers.length > 1 ? statusAnswers.shift()! : statusAnswers[0]!;
  return exchange;
};

async function flush() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
}
async function tick(ms = 2000) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  verifyOtp.mockReset().mockResolvedValue({ error: null });
  statusAnswers = [{ status: 200, body: { status: "created" } }];
  exchange = { status: 200, body: { tokenHash: "th" } };
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => jsonRes(route(url, init)));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const statusCalls = () => fetchMock.mock.calls.filter((c) => String(c[0]).includes("/status")).length;

describe("LoginFlow", () => {
  it("starts, shows a real deep link in a new tab and the match code, then polls every 2s", async () => {
    render(<LoginFlow navigate={vi.fn()} />);
    await flush();
    const link = screen.getByRole("link", { name: /Telegram'ni ochish/ });
    expect(link).toHaveAttribute("href", START.deepLink);
    expect(link).toHaveAttribute("target", "_blank");
    expect(screen.getByText(/Botdagi kod:/)).toHaveTextContent("Botdagi kod: 47");
    expect(statusCalls()).toBe(0);
    await tick(2000);
    expect(statusCalls()).toBe(1);
    await tick(4000);
    expect(statusCalls()).toBe(3);
    fireEvent.click(link);
    expect(screen.getByRole("heading", { name: "Telefon raqamni ulashing" })).toBeInTheDocument();
  });

  it("waiting -> identity card -> exchange -> verifyOtp -> navigate", async () => {
    const navigate = vi.fn();
    statusAnswers = [
      { status: 200, body: { status: "created" } },
      { status: 200, body: { status: "confirmed", identity: ID } },
    ];
    render(<LoginFlow navigate={navigate} />);
    await flush();
    await tick();
    expect(statusCalls()).toBe(1);
    await tick();
    expect(screen.getByText(/sifatida kirmoqdasiz/)).toHaveTextContent(
      "Siz Dilnoza A., +998 90 *** ** 47 sifatida kirmoqdasiz — bu sizmisiz?",
    );
    const before = statusCalls();
    await tick(6000);
    expect(statusCalls()).toBe(before); // polling stopped

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Ha, kirish" }));
    });
    await flush();
    const exchangeCall = fetchMock.mock.calls.find((c) => String(c[0]).includes("/exchange"))!;
    expect(JSON.parse((exchangeCall[1] as RequestInit).body as string)).toEqual({ nonce: NONCE, confirm: true });
    expect(verifyOtp).toHaveBeenCalledWith({ token_hash: "th", type: "magiclink" });
    expect(navigate).toHaveBeenCalledWith("/login");
  });

  it("'Yo'q, bekor qilish' clears state and starts a fresh login", async () => {
    statusAnswers = [{ status: 200, body: { status: "confirmed", identity: ID } }];
    render(<LoginFlow navigate={vi.fn()} />);
    await flush();
    await tick();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Yo'q, bekor qilish" }));
    });
    await flush();
    const starts = fetchMock.mock.calls.filter((c) => String(c[0]).endsWith("/start")).length;
    expect(starts).toBe(2);
    expect(screen.queryByText(/sifatida kirmoqdasiz/)).toBeNull();
    expect(screen.getByRole("link", { name: /Telegram'ni ochish/ })).toBeInTheDocument();
  });

  it("expired -> stops polling and 'Qayta urinish' restarts", async () => {
    statusAnswers = [{ status: 200, body: { status: "expired" } }];
    render(<LoginFlow navigate={vi.fn()} />);
    await flush();
    await tick();
    expect(screen.getByRole("heading", { name: "Havola muddati tugadi" })).toBeInTheDocument();
    const n = statusCalls();
    await tick(6000);
    expect(statusCalls()).toBe(n);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Qayta urinish" }));
    });
    await flush();
    expect(screen.getByRole("link", { name: /Telegram'ni ochish/ })).toBeInTheDocument();
  });

  it("a 404 status answer is terminal (expired)", async () => {
    statusAnswers = [{ status: 404, body: { status: "expired" } }];
    render(<LoginFlow navigate={vi.fn()} />);
    await flush();
    await tick();
    expect(screen.getByRole("heading", { name: "Havola muddati tugadi" })).toBeInTheDocument();
  });

  it("confirmed with no identity shows the share-your-number error and no exchange button", async () => {
    statusAnswers = [{ status: 200, body: { status: "confirmed", identity: null } }];
    render(<LoginFlow navigate={vi.fn()} />);
    await flush();
    await tick();
    expect(screen.getByText("Telefon raqam ulashilmagan, botda raqamni ulashing.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Ha, kirish" })).toBeNull();
  });

  it("exchange 409 no_profile shows the same error", async () => {
    statusAnswers = [{ status: 200, body: { status: "confirmed", identity: ID } }];
    exchange = { status: 409, body: { error: "no_profile" } };
    render(<LoginFlow navigate={vi.fn()} />);
    await flush();
    await tick();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Ha, kirish" }));
    });
    await flush();
    expect(screen.getByText("Telefon raqam ulashilmagan, botda raqamni ulashing.")).toBeInTheDocument();
    expect(verifyOtp).not.toHaveBeenCalled();
  });

  it("a failed verifyOtp goes straight to the restart state (nonce is consumed)", async () => {
    statusAnswers = [{ status: 200, body: { status: "confirmed", identity: ID } }];
    verifyOtp.mockResolvedValue({ error: { message: "bad" } });
    const navigate = vi.fn();
    render(<LoginFlow navigate={navigate} />);
    await flush();
    await tick();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Ha, kirish" }));
    });
    await flush();
    expect(screen.getByRole("heading", { name: "Havola muddati tugadi" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Ha, kirish" })).toBeNull();
    expect(navigate).not.toHaveBeenCalled();
  });

  it("'Yo'q, bekor qilish' also calls /cancel with the nonce", async () => {
    statusAnswers = [{ status: 200, body: { status: "confirmed", identity: ID } }];
    render(<LoginFlow navigate={vi.fn()} />);
    await flush();
    await tick();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Yo'q, bekor qilish" }));
    });
    await flush();
    const call = fetchMock.mock.calls.find((c) => String(c[0]).endsWith("/cancel"))!;
    expect(JSON.parse((call[1] as RequestInit).body as string)).toEqual({ nonce: NONCE });
  });

  it("the live region announces the opened step", async () => {
    render(<LoginFlow navigate={vi.fn()} />);
    await flush();
    const live = screen.getByRole("status");
    expect(live).toHaveTextContent(/Botni oching/);
    fireEvent.click(screen.getByRole("link", { name: /Telegram'ni ochish/ }));
    expect(live).toHaveTextContent(/Telefon raqamni ulashing/);
  });

  it("exchange 410 -> expired state", async () => {
    statusAnswers = [{ status: 200, body: { status: "confirmed", identity: ID } }];
    exchange = { status: 410, body: { error: "expired" } };
    render(<LoginFlow navigate={vi.fn()} />);
    await flush();
    await tick();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Ha, kirish" }));
    });
    await flush();
    expect(screen.getByRole("heading", { name: "Havola muddati tugadi" })).toBeInTheDocument();
  });

  it("does not poll while the tab is hidden and aborts polling on unmount", async () => {
    const { unmount } = render(<LoginFlow navigate={vi.fn()} />);
    await flush();
    Object.defineProperty(document, "hidden", { configurable: true, value: true });
    await tick(6000);
    expect(statusCalls()).toBe(0);
    Object.defineProperty(document, "hidden", { configurable: true, value: false });
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await flush();
    expect(statusCalls()).toBe(1);
    unmount();
    await tick(6000);
    expect(statusCalls()).toBe(1);
  });

  it("start failure shows an error with retry", async () => {
    fetchMock.mockImplementationOnce(async () => jsonRes({ status: 500, body: {} }));
    render(<LoginFlow navigate={vi.fn()} />);
    await flush();
    expect(screen.getByRole("heading", { name: "Ulanishda xatolik" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Qayta urinish" })).toBeInTheDocument();
  });
});
