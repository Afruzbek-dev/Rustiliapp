import { describe, expect, it, vi } from "vitest";
import { bumpDailyTask } from "@/server/daily-tasks";

describe("bumpDailyTask", () => {
  it("calls bump_daily_task with the right arguments", async () => {
    const rpc = vi.fn().mockResolvedValue({ error: null });
    await bumpDailyTask({ rpc }, "s1", "words", 4);
    expect(rpc).toHaveBeenCalledWith("bump_daily_task", { p_student: "s1", p_key: "words", p_inc: 4 });
  });

  it("defaults to +1", async () => {
    const rpc = vi.fn().mockResolvedValue({ error: null });
    await bumpDailyTask({ rpc }, "s1", "audio");
    expect(rpc.mock.calls[0][1]).toMatchObject({ p_inc: 1 });
  });

  it("throws on rpc errors and invalid increments", async () => {
    const rpc = vi.fn().mockResolvedValue({ error: { message: "nope" } });
    await expect(bumpDailyTask({ rpc }, "s1", "grammar")).rejects.toThrow(/nope/);
    await expect(bumpDailyTask({ rpc }, "s1", "grammar", 0)).rejects.toThrow(/positive/);
    await expect(bumpDailyTask({ rpc }, "s1", "grammar", 1.5)).rejects.toThrow(/positive/);
  });
});
