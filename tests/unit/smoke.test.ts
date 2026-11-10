import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");

describe("design tokens", () => {
  it.each([
    ["--bg", "#FAF7EC"],
    ["--card", "#FFFFFF"],
    ["--surface-2", "#F3EEDF"],
    ["--border", "#E6E0CC"],
    ["--border-strong", "#D9D3BC"],
    ["--ink", "#1A1A17"],
    ["--ink-2", "#5F5B50"],
    ["--ink-3", "#6F6B60"],
    ["--brand", "#FFD60A"],
    ["--brand-shadow", "#C9A400"],
    ["--brand-text", "#8A6A00"],
    ["--fire", "#FF6B4A"],
    ["--fire-shadow", "#C24A2F"],
    ["--fire-text", "#B23A1E"],
    ["--fire-bg", "#FFE3DB"],
    ["--ok", "#3DDC84"],
    ["--ok-shadow", "#24A35E"],
    ["--ok-text", "#157A43"],
    ["--ok-bg", "#DDF7E7"],
    ["--info", "#3D7BEA"],
    ["--info-strong", "#1F55B8"],
    ["--info-bg", "#E3ECFC"],
    ["--radius-sm", "12px"],
    ["--radius-md", "16px"],
    ["--radius-lg", "20px"],
    ["--radius-xl", "24px"],
  ])("defines %s: %s", (name, value) => {
    expect(css).toContain(`${name}: ${value};`);
  });
});
