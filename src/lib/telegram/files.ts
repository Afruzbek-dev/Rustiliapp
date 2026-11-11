import "server-only";

/** Thrown for any Telegram file failure. Deliberately carries no URL and no upstream message. */
export class TelegramFileError extends Error {
  constructor(public readonly code: string) {
    super(`telegram file error (${code})`);
    this.name = "TelegramFileError";
  }
}

const API = "https://api.telegram.org";

/**
 * Bot API getFile + file download. The bot token only ever lives inside the URLs built here; errors
 * are rethrown as TelegramFileError so no URL (and therefore no token) can reach a log or response.
 */
export function createTelegramFiles(token: string, fetchImpl: typeof fetch = fetch) {
  return {
    async getFile(fileId: string): Promise<{ filePath: string; fileSize?: number }> {
      let res: Response;
      try {
        res = await fetchImpl(`${API}/bot${token}/getFile`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ file_id: fileId }),
          redirect: "error",
          cache: "no-store",
        });
      } catch {
        throw new TelegramFileError("network");
      }
      if (!res.ok) throw new TelegramFileError(`http_${res.status}`);
      let json: { ok?: boolean; result?: { file_path?: string; file_size?: number } };
      try {
        json = (await res.json()) as typeof json;
      } catch {
        throw new TelegramFileError("bad_json");
      }
      const path = json.ok ? json.result?.file_path : undefined;
      if (!path || /(^|\/)\.\.(\/|$)/.test(path)) throw new TelegramFileError("no_path");
      return { filePath: path, fileSize: json.result?.file_size };
    },

    async fetchFile(filePath: string, range: string | null): Promise<Response> {
      try {
        return await fetchImpl(`${API}/file/bot${token}/${filePath}`, {
          headers: range ? { Range: range } : {},
          redirect: "error",
          cache: "no-store",
        });
      } catch {
        throw new TelegramFileError("network");
      }
    },
  };
}
