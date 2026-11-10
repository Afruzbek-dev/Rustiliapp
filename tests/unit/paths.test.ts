import { describe, expect, it } from "vitest";
import { isProtectedPath } from "@/lib/supabase/paths";

describe("isProtectedPath", () => {
  it.each(["/home", "/path", "/lesson/abc", "/words", "/speak/1", "/rating", "/test/2", "/curator", "/teacher/lessons/3"])(
    "protects %s",
    (p) => expect(isProtectedPath(p)).toBe(true),
  );
  it.each(["/", "/login", "/api/telegram/webhook", "/homework", "/pathway", "/dev/ui"])("passes through %s", (p) =>
    expect(isProtectedPath(p)).toBe(false),
  );
});
