import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

class Redirect extends Error {
  constructor(public to: string) {
    super(`redirect:${to}`);
  }
}

const state = vi.hoisted(() => ({
  user: null as { id: string } | null,
  profile: null as { role: string; full_name: string } | null,
  pathname: "/teacher",
  count: 0 as number | null,
  queueUser: null as string | null,
}));
vi.mock("@/server/curator-queue", () => ({
  getQueue: async (userId: string) => {
    state.queueUser = userId;
    if (state.count === null) throw new Error("boom");
    return { items: [], count: state.count, role: "teacher" };
  },
}));

vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Redirect(to);
  },
  usePathname: () => state.pathname,
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: state.user } }) },
    from: (table: string) => {
      const b: Record<string, unknown> = {};
      b.select = (_cols: string, opts?: { head?: boolean }) => (opts?.head ? b : b);
      b.eq = () => b;
      b.or = () => Promise.resolve(state.count === null ? { count: null, error: { code: "x" } } : { count: state.count, error: null });
      b.maybeSingle = () => Promise.resolve({ data: table === "profiles" ? state.profile : null });
      return b;
    },
  }),
}));
vi.mock("@/lib/supabase/browser", () => ({ createClient: () => ({ auth: { signOut: async () => undefined } }) }));

import StaffLayout from "@/app/(staff)/layout";
import { Sidebar, navItemsFor } from "@/components/staff/Sidebar";
import { pendingQueueCount, requireShellUser } from "@/server/staff-shell";

async function target(fn: () => Promise<unknown>) {
  try {
    await fn();
    return null;
  } catch (e) {
    if (e instanceof Redirect) return e.to;
    throw e;
  }
}

beforeEach(() => {
  state.user = { id: "u1" };
  state.profile = { role: "teacher", full_name: "Zarina Kasimova" };
  state.pathname = "/teacher";
  state.count = 0;
});

describe("staff guard", () => {
  it("anonymous goes to /login, student to /home, profile-less to /login", async () => {
    state.user = null;
    expect(await target(() => requireShellUser())).toBe("/login");
    state.user = { id: "u1" };
    state.profile = { role: "student", full_name: "S" };
    expect(await target(() => requireShellUser())).toBe("/home");
    state.profile = null;
    expect(await target(() => requireShellUser())).toBe("/login");
  });

  it("teacher, admin and curator may enter", async () => {
    for (const role of ["teacher", "admin", "curator"]) {
      state.profile = { role, full_name: "Ism" };
      expect(await requireShellUser()).toEqual({ id: "u1", name: "Ism", role });
    }
  });

  it("the badge count degrades to null on an error", async () => {
    state.count = 7;
    expect(await pendingQueueCount("u1")).toBe(7);
    expect(state.queueUser).toBe("u1");
    state.count = null;
    expect(await pendingQueueCount("u1")).toBeNull();
  });
});

describe("navigation per role", () => {
  it("teacher and admin see the full menu; curator only the queue", () => {
    expect(navItemsFor("teacher").map((i) => i.label)).toEqual([
      "Bosh panel",
      "Kurslar va darslar",
      "O'quvchilar",
      "Guruhlar",
      "Tekshirish navbati",
      "Kuratorlar",
      "Testlar",
      "Reyting",
      "Sozlamalar",
    ]);
    expect(navItemsFor("admin")).toHaveLength(9);
    expect(navItemsFor("curator").map((i) => [i.label, i.href])).toEqual([["Tekshirish navbati", "/curator"]]);
  });

  it("renders links, marks the current page and shows the pending badge", () => {
    render(<Sidebar role="teacher" name="Zarina Kasimova" pending={12} />);
    const nav = screen.getByRole("navigation", { name: "Ustoz paneli" });
    expect(within(nav).getAllByRole("link")).toHaveLength(9);
    expect(within(nav).getByRole("link", { name: "Bosh panel" })).toHaveAttribute("aria-current", "page");
    expect(within(nav).getByRole("link", { name: "Testlar" })).not.toHaveAttribute("aria-current");
    expect(within(nav).getByRole("link", { name: /Tekshirish navbati/ })).toHaveTextContent("12");
    expect(screen.getByText("Zarina Kasimova")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Chiqish" })).toBeInTheDocument();
  });

  it("the dashboard link is not current on sub-pages, which highlight their own item", () => {
    state.pathname = "/teacher/students/42";
    render(<Sidebar role="admin" name="A" />);
    expect(screen.getByRole("link", { name: "Bosh panel" })).not.toHaveAttribute("aria-current");
    expect(screen.getByRole("link", { name: "O'quvchilar" })).toHaveAttribute("aria-current", "page");
  });

  it("the curator queue is current under /curator/*, and no badge at zero or unknown", () => {
    state.pathname = "/curator/queue";
    render(<Sidebar role="curator" name="K" pending={0} />);
    const link = screen.getByRole("link", { name: "Tekshirish navbati" });
    expect(link).toHaveAttribute("aria-current", "page");
    expect(link).not.toHaveTextContent(/\d/);
    expect(screen.getAllByRole("link")).toHaveLength(1);
  });

  it("the mobile menu button toggles the menu", async () => {
    render(<Sidebar role="teacher" name="Z" />);
    const button = screen.getByRole("button", { name: "Menyuni ochish" });
    expect(button).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(button);
    expect(screen.getByRole("button", { name: "Menyuni yopish" })).toHaveAttribute("aria-expanded", "true");
    expect(document.getElementById("staff-menu")?.className).toContain("flex");
    expect(document.getElementById("staff-menu")?.className).not.toContain("hidden");
  });

  it("tokens only: no hard-coded colours or emoji in the shell", () => {
    const { container } = render(<Sidebar role="teacher" name="Z" pending={3} />);
    expect(container.innerHTML).not.toMatch(/#[0-9a-f]{3,6}\b/i);
    expect(container.textContent).not.toMatch(/\p{Extended_Pictographic}/u);
  });
});

describe("staff layout", () => {
  it("wraps the page: fluid flex-wrap shell with the content pane", async () => {
    state.count = 4;
    const { container } = render(await StaffLayout({ children: <p>Sahifa</p> }));
    expect(container.firstElementChild?.className).toContain("flex-wrap");
    expect(screen.getByText("Sahifa").parentElement?.className).toContain("min-w-0");
    expect(screen.getByRole("link", { name: /Tekshirish navbati/ })).toHaveTextContent("4");
  });

  it("redirects a student before rendering anything", async () => {
    state.profile = { role: "student", full_name: "S" };
    expect(await target(() => StaffLayout({ children: null }))).toBe("/home");
  });
});
