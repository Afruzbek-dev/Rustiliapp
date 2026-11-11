import { beforeEach, describe, expect, it, vi } from "vitest";
import { remindStudent, REMINDER_TEXT, type ReminderDeps } from "@/server/teacher-reminders";

function makeDeps(over: Partial<ReminderDeps> = {}) {
  const claimed = new Set<string>();
  const deps = {
    mayRemind: vi.fn(async () => true),
    telegramIdOf: vi.fn(async () => 777 as number | null),
    claim: vi.fn(async (s: string, day: string) => {
      const key = `${s}|${day}`;
      if (claimed.has(key)) return false;
      claimed.add(key);
      return true;
    }),
    release: vi.fn(async (s: string, day: string) => {
      claimed.delete(`${s}|${day}`);
    }),
    send: vi.fn(async () => undefined),
    ...over,
  };
  return { deps, claimed };
}

const T1 = new Date("2026-11-11T08:00:00Z");

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("remindStudent", () => {
  it("sends the text plus link once", async () => {
    const { deps } = makeDeps();
    expect(await remindStudent(deps, "s1", "c1", "https://app/home", T1)).toBe("sent");
    expect(deps.send).toHaveBeenCalledWith(777, `${REMINDER_TEXT}\nhttps://app/home`);
  });

  it("at most one reminder per student per Tashkent day", async () => {
    const { deps } = makeDeps();
    expect(await remindStudent(deps, "s1", "c1", "u", T1)).toBe("sent");
    expect(await remindStudent(deps, "s1", "c1", "u", new Date("2026-11-11T15:00:00Z"))).toBe("already_sent");
    expect(deps.send).toHaveBeenCalledTimes(1);
    // another student, and the next Tashkent day (19:00 UTC is already 00:00 the next day) are separate
    expect(await remindStudent(deps, "s2", "c1", "u", T1)).toBe("sent");
    expect(await remindStudent(deps, "s1", "c1", "u", new Date("2026-11-11T19:30:00Z"))).toBe("sent");
    expect(deps.send).toHaveBeenCalledTimes(3);
  });

  it("a student who is not in the teacher's cohort is rejected before any lookup or send", async () => {
    const { deps } = makeDeps({ mayRemind: vi.fn(async () => false) });
    expect(await remindStudent(deps, "s1", "c1", "u", T1)).toBe("not_member");
    expect(deps.telegramIdOf).not.toHaveBeenCalled();
    expect(deps.claim).not.toHaveBeenCalled();
    expect(deps.send).not.toHaveBeenCalled();
  });

  it("no Telegram link: nothing claimed", async () => {
    const { deps } = makeDeps({ telegramIdOf: vi.fn(async () => null) });
    expect(await remindStudent(deps, "s1", "c1", "u", T1)).toBe("no_telegram");
    expect(deps.claim).not.toHaveBeenCalled();
  });

  it("a failed send gives the claim back (retry allowed) and logs no PII", async () => {
    const { deps, claimed } = makeDeps({ send: vi.fn(async () => { throw new Error("chat 777 blocked the bot"); }) });
    expect(await remindStudent(deps, "s1", "c1", "u", T1)).toBe("send_failed");
    expect(claimed.size).toBe(0);
    expect(JSON.stringify((console.error as ReturnType<typeof vi.fn>).mock.calls)).not.toContain("777");
    const ok = makeDeps();
    expect(await remindStudent(ok.deps, "s1", "c1", "u", T1)).toBe("sent");
  });
});
