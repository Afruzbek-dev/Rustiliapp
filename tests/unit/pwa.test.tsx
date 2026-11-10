import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import manifest from "@/app/manifest";
import OfflinePage from "@/app/offline/page";

describe("manifest", () => {
  const m = manifest();
  it("has the required identity fields", () => {
    expect(m.name).toBe("Po-russki gaplashamiz");
    expect(m.short_name).toBe("Po-russki");
    expect(m.display).toBe("standalone");
    expect(m.lang).toBe("uz");
    expect(m.start_url).toBe("/home");
    expect(m.theme_color).toBe("#FAF7EC");
    expect(m.background_color).toBe("#FAF7EC");
  });
  it("declares 192/512 any and maskable icons", () => {
    const icons = m.icons ?? [];
    for (const purpose of ["any", "maskable"]) {
      for (const sizes of ["192x192", "512x512"]) {
        expect(icons.some((i) => i.purpose === purpose && i.sizes === sizes && i.type === "image/png")).toBe(true);
      }
    }
  });
});

describe("offline page", () => {
  it("renders Uzbek text and a retry button", () => {
    render(<OfflinePage />);
    expect(screen.getByRole("heading", { name: /Internet aloqasi yo'q/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Qayta urinish" })).toBeInTheDocument();
  });
});
