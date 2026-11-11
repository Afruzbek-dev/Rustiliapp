/**
 * CSV import of lesson words. Columns: ru, uz (required) and stress, pos, gender, example_ru,
 * example_uz (optional), in any order. Limits keep a malicious / accidental huge file harmless.
 */
export const CSV_MAX_BYTES = 200_000;
export const CSV_MAX_ROWS = 500;
export const WORD_COLUMNS = ["ru", "stress", "uz", "pos", "gender", "example_ru", "example_uz"] as const;
export type WordColumn = (typeof WORD_COLUMNS)[number];
export type WordRow = Record<WordColumn, string>;

const MAX_LEN: Record<WordColumn, number> = { ru: 200, uz: 200, stress: 200, pos: 40, gender: 20, example_ru: 500, example_uz: 500 };

export interface CsvRowError {
  /** 1-based line number in the file (header is line 1). */
  line: number;
  message: string;
}

export interface WordsCsvResult {
  rows: WordRow[];
  errors: CsvRowError[];
  /** Whole-file problem (too big, no header, missing required column). rows is empty then. */
  fileError?: string;
  /** Header columns that are not recognised and were ignored. */
  ignoredColumns: string[];
  /** Rows dropped because the same ru + uz appeared earlier in the file. */
  duplicates: number;
}

/** RFC 4180 style parser: quoted fields, "" escapes, CRLF/LF/CR, embedded newlines. Returns lines with their start line number. */
/** A quoted field longer than this (or never closed) is a broken row, not the rest of the file. */
export const CSV_MAX_QUOTED = 1000;

export interface ParsedCsvRow {
  cells: string[];
  line: number;
  /** Set when the row has an unterminated quote; the parser resumed at the next line. */
  error?: string;
}

export function parseCsv(text: string, delimiter: string): ParsedCsvRow[] {
  const out: ParsedCsvRow[] = [];
  let cells: string[] = [];
  let cur = "";
  let quoted = false;
  let line = 1;
  let startLine = 1;
  let touched = false;
  const endCell = () => {
    cells.push(cur);
    cur = "";
  };
  let rowError: string | undefined;
  const endRow = () => {
    endCell();
    if (touched) out.push(rowError ? { cells, line: startLine, error: rowError } : { cells, line: startLine });
    cells = [];
    touched = false;
    rowError = undefined;
  };
  // Is the quote opened at `from` closed (an unescaped quote) within the cap?
  const closes = (from: number): boolean => {
    const end = Math.min(text.length, from + 1 + CSV_MAX_QUOTED);
    for (let j = from + 1; j < end; j++) {
      if (text[j] === '"') {
        if (text[j + 1] === '"') j++;
        else return true;
      }
    }
    return false;
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cur += '"';
          i++;
        } else quoted = false;
      } else {
        if (ch === "\n") line++;
        cur += ch;
      }
      continue;
    }
    if (ch === '"' && cur === "") {
      touched = true;
      if (closes(i)) quoted = true;
      else {
        // unterminated quote: drop the rest of THIS physical line, flag the row and carry on
        rowError = "Yopilmagan qo'shtirnoq";
        while (i + 1 < text.length && text[i + 1] !== "\n" && text[i + 1] !== "\r") i++;
      }
    } else if (ch === delimiter) {
      touched = true;
      endCell();
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      endRow();
      line++;
      startLine = line;
    } else {
      cur += ch;
      touched = true;
    }
  }
  if (touched || cur !== "") endRow();
  return out;
}

function detectDelimiter(headerLine: string): string {
  const counts = [",", ";", "\t"].map((d) => ({ d, n: headerLine.split(d).length - 1 }));
  counts.sort((a, b) => b.n - a.n);
  return counts[0].n > 0 ? counts[0].d : ",";
}

const fileErr = (message: string): WordsCsvResult => ({ rows: [], errors: [], fileError: message, ignoredColumns: [], duplicates: 0 });

export function parseWordsCsv(input: string): WordsCsvResult {
  if (new TextEncoder().encode(input).length > CSV_MAX_BYTES) return fileErr("Fayl juda katta (200 KB gacha)");
  const text = input.replace(/^﻿/, "").normalize("NFC");
  if (text.trim() === "") return fileErr("Fayl bo'sh");
  const firstLine = text.split(/\r\n|\n|\r/, 1)[0];
  const parsed = parseCsv(text, detectDelimiter(firstLine));
  if (parsed.length === 0) return fileErr("Fayl bo'sh");

  const header = parsed[0].cells.map((c) => c.trim().toLowerCase());
  const index = new Map<WordColumn, number>();
  const ignoredColumns: string[] = [];
  header.forEach((h, i) => {
    if ((WORD_COLUMNS as readonly string[]).includes(h) && !index.has(h as WordColumn)) index.set(h as WordColumn, i);
    else if (h) ignoredColumns.push(h);
  });
  const missing = (["ru", "uz"] as const).filter((c) => !index.has(c));
  if (missing.length) return { ...fileErr(`Yetishmayotgan ustun: ${missing.join(", ")}`), ignoredColumns };

  const body = parsed.slice(1);
  if (body.length > CSV_MAX_ROWS) return { ...fileErr(`Qatorlar soni ${CSV_MAX_ROWS} dan oshmasligi kerak`), ignoredColumns };

  const rows: WordRow[] = [];
  const errors: CsvRowError[] = [];
  const seen = new Set<string>();
  let duplicates = 0;
  for (const r of body) {
    if (r.error) {
      errors.push({ line: r.line, message: r.error });
      continue;
    }
    if (r.cells.every((c) => c.trim() === "")) continue;
    const row = Object.fromEntries(WORD_COLUMNS.map((c) => [c, (r.cells[index.get(c) ?? -1] ?? "").trim()])) as WordRow;
    if (!row.ru) {
      errors.push({ line: r.line, message: "«ru» bo'sh" });
      continue;
    }
    if (!row.uz) {
      errors.push({ line: r.line, message: "«uz» bo'sh" });
      continue;
    }
    const tooLong = WORD_COLUMNS.find((c) => row[c].length > MAX_LEN[c]);
    if (tooLong) {
      errors.push({ line: r.line, message: `«${tooLong}» juda uzun (${MAX_LEN[tooLong]} belgigacha)` });
      continue;
    }
    if (WORD_COLUMNS.some((c) => /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(row[c]))) {
      errors.push({ line: r.line, message: "Yaroqsiz belgilar bor" });
      continue;
    }
    const key = `${row.ru.toLowerCase()}\u0000${row.uz.toLowerCase()}`;
    if (seen.has(key)) {
      duplicates++;
      continue;
    }
    seen.add(key);
    rows.push(row);
  }
  return { rows, errors, ignoredColumns, duplicates };
}
