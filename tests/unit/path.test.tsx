import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getPath: vi.fn() }));
vi.mock("@/server/guards", () => ({ requireStudent: async () => ({ user: { id: "s1" }, role: "student" }) }));
vi.mock("@/server/path", async (orig) => ({ ...(await orig<typeof import("@/server/path")>()), getPath: mocks.getPath }));
vi.mock("@/server/dashboard", () => ({ supabaseDashboardDb: () => ({}) }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({}) }));

import PathError from "@/app/(student)/path/error";
import Loading from "@/app/(student)/path/loading";
import PathPage from "@/app/(student)/path/page";
import { ModuleHeader } from "@/components/student/ModuleHeader";
import { PathNode } from "@/components/student/PathNode";
import type { PartProgress } from "@/lib/path-status";
import { getPathWith, type ModuleRow, type PathDb, type TestRow } from "@/server/path";

type PartSpec = { id: string; position: number; kind: "grammar" | "conversation"; published: boolean };

function lesson(id: string, position: number, parts: PartSpec[]) {
  return {
    id,
    position,
    title: `Dars ${id}`,
    lesson_parts: parts.map((p) => ({ id: p.id, position: p.position, kind: p.kind, title: p.id })),
  };
}
const two = (l: string, pub = [true, true]): PartSpec[] => [
  { id: `${l}g`, position: 1, kind: "grammar", published: pub[0] },
  { id: `${l}c`, position: 2, kind: "conversation", published: pub[1] },
];

function fakeDb(opts: {
  modules: ModuleRow[];
  published: string[];
  progress?: Record<string, PartProgress>;
  tests?: TestRow[];
  enrolled?: boolean;
}): PathDb {
  return {
    enrollment: async () =>
      opts.enrolled === false ? null : { cohortId: "c", courseId: "course", label: "G" },
    modules: async () => opts.modules,
    publishedPartIds: async (ids) => new Set(ids.filter((i) => opts.published.includes(i))),
    progress: async () => new Map(Object.entries(opts.progress ?? {})),
    tests: async () => opts.tests ?? [],
  };
}

const mod = (id: string, position: number, lessons: ModuleRow["lessons"]): ModuleRow => ({
  id,
  position,
  title: `Modul ${id}`,
  lessons,
});

describe("getPath", () => {
  const modules = [
    mod("m2", 2, [lesson("l3", 1, two("l3"))]),
    mod("m1", 1, [lesson("l2", 2, two("l2")), lesson("l1", 1, two("l1"))]),
  ];
  const all = ["l1g", "l1c", "l2g", "l2c", "l3g", "l3c"];

  it("orders modules and lessons and derives statuses", async () => {
    const p = await getPathWith(
      fakeDb({ modules, published: all, progress: { l1g: "completed", l1c: "in_progress" } }),
      "s1",
    );
    expect(p.modules.map((m) => m.id)).toEqual(["m1", "m2"]);
    expect(p.modules[0].lessons.map((l) => l.id)).toEqual(["l1", "l2"]);
    expect(p.modules[0].lessons.map((l) => l.status)).toEqual(["in_progress", "locked"]);
    expect(p.modules[0].lessons[0].parts.map((x) => x.status)).toEqual(["completed", "in_progress"]);
    expect(p.modules[0].lessons[0].continuePartId).toBe("l1c");
    expect(p.modules[0].lessons[1].continuePartId).toBeNull();
    expect(p.modules[1].lessons[0].status).toBe("locked");
  });

  it("a student without progress sees the first published part available", async () => {
    const p = await getPathWith(fakeDb({ modules, published: all }), "s1");
    expect(p.modules[0].lessons[0].status).toBe("available");
    expect(p.modules[0].lessons[0].continuePartId).toBe("l1g");
  });

  it("hides unpublished parts and skips them in the sequence", async () => {
    const p = await getPathWith(
      fakeDb({ modules, published: ["l1g", "l2g", "l2c", "l3g", "l3c"], progress: { l1g: "completed" } }),
      "s1",
    );
    expect(p.modules[0].lessons[0].parts.map((x) => x.id)).toEqual(["l1g"]);
    expect(p.modules[0].lessons[0].status).toBe("completed");
    expect(p.modules[0].lessons[1].continuePartId).toBe("l2g");
  });

  it("a lesson with no published parts is coming soon and locked", async () => {
    const p = await getPathWith(fakeDb({ modules, published: ["l1g", "l1c", "l3g", "l3c"] }), "s1");
    const l2 = p.modules[0].lessons[1];
    expect(l2.comingSoon).toBe(true);
    expect(l2.status).toBe("locked");
    expect(l2.parts).toEqual([]);
  });

  it("module test unlocks only when every lesson of the module is completed", async () => {
    const tests: TestRow[] = [{ id: "t1", title: "Test 1", after_module_id: "m1", published: true }];
    const done: Record<string, PartProgress> = { l1g: "completed", l1c: "completed", l2g: "completed" };
    const locked = await getPathWith(fakeDb({ modules, published: all, progress: done, tests }), "s1");
    expect(locked.modules[0].test?.status).toBe("locked");
    expect(locked.modules[1].test).toBeNull();
    const open = await getPathWith(
      fakeDb({ modules, published: all, progress: { ...done, l2c: "completed" }, tests }),
      "s1",
    );
    expect(open.modules[0].test).toEqual({ id: "t1", title: "Test 1", status: "available" });
    expect(open.modules[0].completedLessons).toBe(2);
  });

  it("module 2's first part unlocks once module 1's last part is completed (sequence is course-wide)", async () => {
    const done: Record<string, PartProgress> = { l1g: "completed", l1c: "completed", l2g: "completed" };
    const before = await getPathWith(fakeDb({ modules, published: all, progress: { ...done } }), "s1");
    expect(before.modules[1].lessons[0].status).toBe("locked");
    const after = await getPathWith(
      fakeDb({ modules, published: all, progress: { ...done, l2c: "completed" } }),
      "s1",
    );
    expect(after.modules[1].lessons[0].status).toBe("available");
    expect(after.modules[1].lessons[0].continuePartId).toBe("l3g");
  });

  it("an unpublished tests row does not produce a test node", async () => {
    const tests: TestRow[] = [{ id: "t9", title: "Draft", after_module_id: "m1", published: false }];
    const p = await getPathWith(fakeDb({ modules, published: all, tests }), "s1");
    expect(p.modules.every((m) => m.test === null)).toBe(true);
  });

  it("empty course or no enrollment gives no modules", async () => {
    expect((await getPathWith(fakeDb({ modules: [], published: [] }), "s1")).modules).toEqual([]);
    expect((await getPathWith(fakeDb({ modules, published: all, enrolled: false }), "s1")).modules).toEqual([]);
  });

  it("surfaces db errors", async () => {
    const db = { ...fakeDb({ modules, published: all }), progress: async () => Promise.reject(new Error("boom")) };
    await expect(getPathWith(db, "s1")).rejects.toThrow("boom");
  });
});

describe("PathNode", () => {
  it("locked node is a disabled button without href and shows the message on tap", () => {
    render(<PathNode title="Урок 2" subtitle="Dars" status="locked" />);
    const btn = screen.getByRole("button", { name: /Урок 2.*qulflangan/ });
    expect(btn).toHaveAttribute("aria-disabled", "true");
    expect(btn).not.toHaveAttribute("href");
    expect(screen.queryByRole("link")).toBeNull();
    fireEvent.click(btn);
    expect(screen.getByRole("status")).toHaveTextContent("Avval oldingi darsni tugating");
  });

  it("current node is a link with the continue label and day in its name", () => {
    render(<PathNode title="Урок 3" status="in_progress" href="/lesson/p1" currentDay={2} />);
    expect(screen.getByText("Davom etish · 2-kun")).toBeInTheDocument();
    const link = screen.getByRole("link", { name: /Урок 3.*davom etmoqda.*2-kun/ });
    expect(link).toHaveAttribute("href", "/lesson/p1");
  });

  it("announces per-day states in the accessible name", () => {
    render(
      <PathNode
        title="Урок 3"
        status="in_progress"
        href="/lesson/p1"
        currentDay={2}
        days={[
          { label: "Grammatika", status: "completed" },
          { label: "Razgovor", status: "available" },
        ]}
      />,
    );
    expect(
      screen.getByRole("link", { name: /Grammatika: tugallangan, Razgovor: ochiq/ }),
    ).toBeInTheDocument();
  });

  it("available non-current test node is a link; locked test node is a button", () => {
    const { unmount } = render(<PathNode kind="test" title="Test" status="available" href="/test/t1" />);
    expect(screen.getByRole("link", { name: /Test.*ochiq/ })).toHaveAttribute("href", "/test/t1");
    expect(screen.queryByText(/Davom etish/)).toBeNull();
    unmount();
    render(<PathNode kind="test" title="Test" status="locked" lockedMessage="Avval modul darslarini tugating" />);
    expect(screen.getByRole("button", { name: /Test.*qulflangan/ })).toHaveAttribute("aria-disabled", "true");
  });
});

describe("ModuleHeader", () => {
  it("shows the module chip and lesson progress", () => {
    render(<ModuleHeader position={1} title="Salomlashish" completed={2} total={5} />);
    expect(screen.getByText("1-MODUL")).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "2");
    expect(screen.getByText("2/5 dars tugallandi")).toBeInTheDocument();
  });
});

describe("path page states", () => {
  it("renders the loading state", () => {
    render(<Loading />);
    expect(screen.getByRole("status")).toHaveTextContent("Yuklanmoqda");
  });

  it("renders the error state with retry", () => {
    const reset = vi.fn();
    vi.spyOn(console, "error").mockImplementation(() => {});
    render(<PathError error={new Error("x")} reset={reset} />);
    expect(screen.getByRole("alert")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Qayta urinish" }));
    expect(reset).toHaveBeenCalled();
  });

  it("renders the empty state for an empty course", async () => {
    mocks.getPath.mockResolvedValue({ modules: [] });
    render(await PathPage());
    expect(screen.getByText("Kurs hali tayyor emas")).toBeInTheDocument();
  });

  it("renders nodes for a populated path", async () => {
    mocks.getPath.mockResolvedValue({
      modules: [
        {
          id: "m1",
          position: 1,
          title: "Salomlashish",
          completedLessons: 0,
          test: { id: "t1", title: "Test 1", status: "locked" },
          lessons: [
            {
              id: "l1",
              position: 1,
              title: "Privet",
              status: "available",
              comingSoon: false,
              continuePartId: "p1",
              parts: [{ id: "p1", position: 1, kind: "grammar", title: "G", status: "available" }],
            },
          ],
        },
      ],
    });
    render(await PathPage());
    expect(screen.getByRole("link", { name: /Урок 1/ })).toHaveAttribute("href", "/lesson/p1");
    expect(screen.getByRole("button", { name: /Test.*qulflangan/ })).toHaveAttribute("aria-disabled", "true");
  });
});
