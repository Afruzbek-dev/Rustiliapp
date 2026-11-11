import { describe, expect, it, vi } from "vitest";
import { createTelegramCuratorNotifier, noticeTitle, shortName, type NoticeSubmission } from "@/server/telegram-notifier";
import { noopCuratorNotifier, notifyCuratorsOfSubmission, setCuratorNotifier } from "@/server/notify-curators";

const ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const base: NoticeSubmission = {
  id: ID, kind: "audio", storagePath: "s/x.webm", tgFileId: null, archiveMessageId: null, curatorMessageId: null,
  curatorGroupId: "g", groupChatId: -100777, studentName: "Ali Valiyev", lessonTitle: "Dars 3", exercisePrompt: "Rasmni tasvirlang",
};

function setup(sub: Partial<NoticeSubmission> | null) {
  const saved: { chat: number; msg: number }[] = [];
  const calls: { m: string; args: unknown[] }[] = [];
  const logs: string[] = [];
  const api = {
    sendMessage: vi.fn(async (...args: unknown[]) => (calls.push({ m: "sendMessage", args }), { message_id: 31 })),
    copyMessage: vi.fn(async (...args: unknown[]) => (calls.push({ m: "copyMessage", args }), { message_id: 32 })),
    editMessageText: vi.fn(),
    editMessageCaption: vi.fn(),
    editMessageReplyMarkup: vi.fn(),
  };
  const notifier = createTelegramCuratorNotifier({
    store: {
      getSubmission: async () => (sub === null ? null : { ...base, ...sub }),
      saveCuratorMessage: async (_id, chat, msg) => void saved.push({ chat, msg }),
    },
    api: api as never,
    archiveChatId: "-100ARCH",
    staffChatId: "-100999",
    appUrl: "https://app.example.uz/",
    log: (l) => logs.push(l),
  });
  return { notifier, api, saved, calls, logs };
}

describe("shortName / noticeTitle", () => {
  it("first name + last initial", () => {
    expect(shortName("Ali Valiyev")).toBe("Ali V.");
    expect(shortName("  madina  rahimova qizi ")).toBe("madina Q.");
    expect(shortName("Ali")).toBe("Ali");
    expect(shortName("")).toBe("O'quvchi");
  });
  it("lesson and trimmed exercise prompt", () => {
    expect(noticeTitle({ lessonTitle: "Dars 3", exercisePrompt: "x".repeat(100) })).toBe(`Dars 3 · ${"x".repeat(60)}`);
    expect(noticeTitle({ lessonTitle: null, exercisePrompt: null })).toBe("Gapirish topshirig'i");
  });
});

describe("curator notifier", () => {
  it("audio: a text message with the web link and the rubric keyboard to the group chat; ids are stored", async () => {
    const t = setup({});
    await t.notifier.notify(ID);
    expect(t.api.copyMessage).not.toHaveBeenCalled();
    const [chat, text, opts] = t.api.sendMessage.mock.calls[0] as [number, string, Record<string, any>]; // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(chat).toBe(-100777);
    expect(text).toContain("Ali V. · Dars 3 · Rasmni tasvirlang");
    expect(text).toContain(`<a href="https://app.example.uz/curator?s=${ID}">Veb'da eshitish</a>`);
    expect(opts.parse_mode).toBe("HTML");
    expect(opts.reply_markup.inline_keyboard).toHaveLength(5);
    expect(opts.reply_markup.inline_keyboard[4][0].callback_data).toBe(`rv:${ID}:save`);
    expect(t.saved).toEqual([{ chat: -100777, msg: 31 }]);
  });

  it("video: header + copyMessage from the archive chat carrying the keyboard; keyboard message id stored", async () => {
    const t = setup({ kind: "video", storagePath: null, tgFileId: "F", archiveMessageId: 555 });
    await t.notifier.notify(ID);
    expect(t.api.copyMessage).toHaveBeenCalledOnce();
    const [chat, from, mid, opts] = t.api.copyMessage.mock.calls[0] as [number, string, number, Record<string, any>]; // eslint-disable-line @typescript-eslint/no-explicit-any
    expect([chat, from, mid]).toEqual([-100777, "-100ARCH", 555]);
    expect(opts.reply_markup.inline_keyboard).toHaveLength(5);
    expect(t.api.sendMessage.mock.calls[0]![1]).toBe("Ali V. · Dars 3 · Rasmni tasvirlang");
    expect(t.saved).toEqual([{ chat: -100777, msg: 32 }]);
  });

  it("a group without telegram_chat_id falls back to the staff chat and logs a PII-free line", async () => {
    const t = setup({ groupChatId: null });
    await t.notifier.notify(ID);
    expect(t.api.sendMessage.mock.calls[0]![0]).toBe("-100999");
    expect(t.saved).toEqual([{ chat: -100999, msg: 31 }]);
    expect(t.logs).toHaveLength(1);
    expect(t.logs[0]).not.toContain("Ali");
    expect(t.logs[0]).not.toContain("Valiyev");
  });

  it("unfinished uploads are ignored (audio without storage_path, video without tg_file_id/archive id)", async () => {
    for (const s of [{ storagePath: null }, { kind: "video", storagePath: null, tgFileId: null, archiveMessageId: 1 }, { kind: "video", storagePath: null, tgFileId: "F", archiveMessageId: null }]) {
      const t = setup(s);
      await t.notifier.notify(ID);
      expect(t.api.sendMessage).not.toHaveBeenCalled();
      expect(t.api.copyMessage).not.toHaveBeenCalled();
      expect(t.saved).toEqual([]);
    }
  });

  it("is idempotent: a submission that already has a curator message is not sent again; unknown id is a no-op", async () => {
    const t = setup({ curatorMessageId: 99 });
    await t.notifier.notify(ID);
    expect(t.api.sendMessage).not.toHaveBeenCalled();
    const missing = setup(null);
    await missing.notifier.notify(ID);
    expect(missing.api.sendMessage).not.toHaveBeenCalled();
  });

  it("escapes HTML in the student name and lesson title", async () => {
    const t = setup({ studentName: "<b>Ali</b> V&", lessonTitle: "<i>x</i>" });
    await t.notifier.notify(ID);
    const text = t.api.sendMessage.mock.calls[0]![1] as string;
    expect(text).not.toContain("<b>");
    expect(text).toContain("&lt;b&gt;");
  });

  it("a Telegram failure propagates (the completion path releases the lease and retries later)", async () => {
    const t = setup({});
    t.api.sendMessage.mockRejectedValueOnce(new Error("tg down"));
    await expect(t.notifier.notify(ID)).rejects.toThrow();
    expect(t.saved).toEqual([]);
  });
});

describe("notifier selection", () => {
  it("setCuratorNotifier replaces the notifier; the noop one logs only the id", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const spy = { notify: vi.fn(async () => undefined) };
    setCuratorNotifier(spy);
    await notifyCuratorsOfSubmission(ID);
    expect(spy.notify).toHaveBeenCalledWith(ID);
    setCuratorNotifier(noopCuratorNotifier);
    await notifyCuratorsOfSubmission(ID);
    expect(info).toHaveBeenCalledWith("notify-curators: submission ready", ID);
  });
});
