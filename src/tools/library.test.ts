import { describe, it, expect } from "vitest";
import { listLibraries } from "./library.js";

describe("list_libraries", () => {
  it("returns p5.brush preset", () => {
    const result = listLibraries();
    expect(result.libraries.length).toBeGreaterThanOrEqual(1);

    const brush = result.libraries.find((l) => l.name === "p5.brush");
    expect(brush).toBeDefined();
    expect(brush!.version).toBe("2.0.3-beta");
    expect(brush!.renderers).toContain("p5");
    expect(brush!.license).toBe("MIT");
    expect(brush!.description).toContain("Natural media");
    expect(brush!.url).toContain("github.com");
  });

  it("returns consistent structure for all presets", () => {
    const result = listLibraries();
    for (const lib of result.libraries) {
      expect(typeof lib.name).toBe("string");
      expect(typeof lib.version).toBe("string");
      expect(typeof lib.description).toBe("string");
      expect(Array.isArray(lib.renderers)).toBe(true);
      expect(typeof lib.license).toBe("string");
    }
  });
});
