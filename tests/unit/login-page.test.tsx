import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

class Redirect extends Error {
  constructor(public to: string) {
    super(`redirect:${to}`);
  }
}
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Redirect(to);
  },
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({}) }));
vi.mock("@/lib/supabase/browser", () => ({ createClient: () => ({ auth: { verifyOtp: vi.fn() } }) }));
const view = vi.fn();
vi.mock("@/server/login-view", () => ({ resolveLoginView: (...a: unknown[]) => view(...a) }));

import LoginPage from "@/app/(public)/login/page";
import WelcomePage from "@/app/(public)/page";

describe("/login page", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
  });

  it("anonymous visitors see the login steps", async () => {
    view.mockResolvedValue({ kind: "anonymous" });
    render(await LoginPage());
    expect(screen.getByRole("list", { name: "Qadamlar" })).toBeInTheDocument();
  });

  it("a pending student sees the pending state and is not redirected", async () => {
    view.mockResolvedValue({ kind: "pending" });
    render(await LoginPage());
    expect(screen.getByRole("heading", { name: "Ustoz tasdig'i kutilmoqda" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Telegram'ni ochish/ })).toBeInTheDocument();
    expect(screen.getByText(/ustozingizga Telegram orqali yozing/)).toBeInTheDocument();
  });

  it("a rejected/expired enrollment gets the closed copy and a sign-out button, not 'waiting for approval'", async () => {
    view.mockResolvedValue({ kind: "closed" });
    render(await LoginPage());
    expect(screen.getByRole("heading", { name: "Kursga kirish yopilgan, ustoz bilan bog'laning" })).toBeInTheDocument();
    expect(screen.queryByText("Ustoz tasdig'i kutilmoqda")).toBeNull();
    expect(screen.getByRole("button", { name: "Chiqish" })).toBeInTheDocument();
  });

  it("the pending view has a sign-out button", async () => {
    view.mockResolvedValue({ kind: "pending" });
    render(await LoginPage());
    expect(screen.getByRole("button", { name: "Chiqish" })).toBeInTheDocument();
  });

  it("an active student is redirected to /home", async () => {
    view.mockResolvedValue({ kind: "redirect", to: "/home" });
    await expect(LoginPage()).rejects.toMatchObject({ to: "/home" });
  });
});

describe("/ welcome page", () => {
  it("renders the headline and a CTA to /login", () => {
    render(<WelcomePage />);
    expect(screen.getByRole("heading", { name: "Rus tilida gapirishni boshlang." })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Telegram orqali kirish" })).toHaveAttribute("href", "/login");
  });
});
