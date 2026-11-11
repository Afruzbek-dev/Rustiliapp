import { describe, expect, it } from "vitest";
import { CSV_MAX_ROWS, parseCsv, parseWordsCsv } from "@/lib/editor/words-csv";
import { parseYouTubeId } from "@/lib/editor/types";

describe("parseWordsCsv", () => {
  it("parses a valid file with all columns in any order", () => {
    const r = parseWordsCsv("uz,ru,stress,pos,gender,example_ru,example_uz\nkitob,книга,кни́га,noun,f,Это книга,Bu kitob\n");
    expect(r.fileError).toBeUndefined();
    expect(r.errors).toEqual([]);
    expect(r.rows).toEqual([{ ru: "книга", stress: "кни́га", uz: "kitob", pos: "noun", gender: "f", example_ru: "Это книга", example_uz: "Bu kitob" }]);
  });

  it("optional columns may be absent", () => {
    const r = parseWordsCsv("ru,uz\nдом,uy");
    expect(r.rows).toEqual([{ ru: "дом", uz: "uy", stress: "", pos: "", gender: "", example_ru: "", example_uz: "" }]);
  });

  it("reports a missing required column for the whole file", () => {
    expect(parseWordsCsv("ru,stress\nдом,x")).toMatchObject({ rows: [], fileError: "Yetishmayotgan ustun: uz" });
    expect(parseWordsCsv("a,b\n1,2").fileError).toMatch(/ru, uz/);
  });

  it("reports empty uz / ru per row with the file line number and keeps good rows", () => {
    const r = parseWordsCsv("ru,uz\nдом,uy\nстол,\n,kitob\nокно,oyna");
    expect(r.rows.map((x) => x.ru)).toEqual(["дом", "окно"]);
    expect(r.errors).toEqual([
      { line: 3, message: "«uz» bo'sh" },
      { line: 4, message: "«ru» bo'sh" },
    ]);
  });

  it("handles quotes, embedded commas / newlines, escaped quotes, CRLF, BOM and blank lines", () => {
    const r = parseWordsCsv('﻿ru,uz,example_ru\r\n"дом, большой","katta ""uy""","Это\nдом"\r\n\r\nокно,oyna,\r\n');
    expect(r.errors).toEqual([]);
    expect(r.rows[0]).toMatchObject({ ru: "дом, большой", uz: 'katta "uy"', example_ru: "Это\nдом" });
    expect(r.rows[1].ru).toBe("окно");
  });

  it("line numbers stay right after a multi-line quoted field", () => {
    const r = parseWordsCsv('ru,uz,example_ru\nдом,uy,"a\nb"\nстол,');
    expect(r.errors).toEqual([{ line: 4, message: "«uz» bo'sh" }]);
  });

  it("detects semicolon and tab delimiters", () => {
    expect(parseWordsCsv("ru;uz\nдом;uy").rows).toHaveLength(1);
    expect(parseWordsCsv("ru\tuz\nдом\tuy").rows).toHaveLength(1);
  });

  it("dedupes ru+uz inside the file (case-insensitive) and counts duplicates", () => {
    const r = parseWordsCsv("ru,uz\nдом,uy\nДОМ,UY\nдом,xona");
    expect(r.rows).toHaveLength(2);
    expect(r.duplicates).toBe(1);
  });

  it("lists unknown columns as ignored", () => {
    const r = parseWordsCsv("ru,uz,foo\nдом,uy,1");
    expect(r.ignoredColumns).toEqual(["foo"]);
    expect(r.rows).toHaveLength(1);
  });

  it("enforces size and row limits and empty files", () => {
    expect(parseWordsCsv("")).toMatchObject({ fileError: "Fayl bo'sh" });
    expect(parseWordsCsv("   \n ")).toMatchObject({ fileError: "Fayl bo'sh" });
    expect(parseWordsCsv("ru,uz\n" + "a".repeat(250_000)).fileError).toMatch(/katta/);
    const many = "ru,uz\n" + Array.from({ length: CSV_MAX_ROWS + 1 }, (_, i) => `w${i},t${i}`).join("\n");
    expect(parseWordsCsv(many).fileError).toMatch(/500/);
    const exactly = "ru,uz\n" + Array.from({ length: CSV_MAX_ROWS }, (_, i) => `w${i},t${i}`).join("\n");
    expect(parseWordsCsv(exactly).rows).toHaveLength(CSV_MAX_ROWS);
  });

  it("rejects over-long values and control characters per row", () => {
    const r = parseWordsCsv(`ru,uz\n${"я".repeat(201)},x\nдом\u0001,y\nok,fine`);
    expect(r.rows.map((x) => x.ru)).toEqual(["ok"]);
    expect(r.errors).toHaveLength(2);
  });

  it("header only gives no rows and no error", () => {
    expect(parseWordsCsv("ru,uz\n")).toMatchObject({ rows: [], errors: [] });
  });
});

describe("parseCsv", () => {
  it("handles a trailing line without newline and unterminated quotes", () => {
    expect(parseCsv("a,b\nc,d", ",").map((r) => r.cells)).toEqual([["a", "b"], ["c", "d"]]);
    expect(parseCsv('a,"b\nc', ",").map((r) => r.cells)).toEqual([["a", "b\nc"]]);
  });
});

describe("parseYouTubeId", () => {
  it.each([
    ["https://www.youtube.com/watch?v=dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    ["https://youtu.be/dQw4w9WgXcQ?t=3", "dQw4w9WgXcQ"],
    ["youtube.com/embed/dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    ["https://m.youtube.com/shorts/dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    ["dQw4w9WgXcQ", "dQw4w9WgXcQ"],
  ])("accepts %s", (input, id) => expect(parseYouTubeId(input)).toBe(id));
  it.each(["https://vimeo.com/123", "https://evil.com/watch?v=dQw4w9WgXcQ", "javascript:alert(1)", "", "https://youtube.com/watch?v=short"])("rejects %s", (input) =>
    expect(parseYouTubeId(input)).toBeNull(),
  );
});
