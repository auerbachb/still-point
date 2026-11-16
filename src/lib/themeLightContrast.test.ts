import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// #1195: WCAG AA contrast guard for the light palette (#29). The light values
// live in globals.css in two blocks that must stay identical: the explicit
// choice `:root[data-theme="light"]` and the System-with-OS-light block
// `:root:not([data-theme="dark"])` under `@media (prefers-color-scheme: light)`.
// This reads both from the file so the guard fails the moment a light token
// drops below the bar, without a browser. Text tokens are composited over the
// light background first, since several are translucent.

const GLOBALS_CSS = resolve(__dirname, "../app/globals.css");

/** Text tokens that must reach 4.5:1 (WCAG AA normal text) on the light background. */
const TEXT_TOKENS = [
  "--fg",
  "--fg-2",
  "--fg-3",
  "--fg-4",
  "--accent-green-text",
  "--accent-amber-text",
  "--accent-danger",
  "--accent-danger-muted",
  "--accent-green-dim",
  "--accent-blue-text",
] as const;

/** Explicit light choice: html[data-theme="light"] (Settings toggle). */
const EXPLICIT_LIGHT = ':root[data-theme="light"] {';
/** System with an OS light preference (no data-theme attribute). */
const SYSTEM_LIGHT = ':root:not([data-theme="dark"]) {';

type Rgba = { r: number; g: number; b: number; a: number };

function blockDeclarations(css: string, opener: string): Map<string, string> {
  const start = css.indexOf(opener);
  if (start < 0) throw new Error(`light palette block not found in globals.css: ${opener}`);
  const end = css.indexOf("}", start);
  const body = css.slice(start, end);
  const decls = new Map<string, string>();
  for (const match of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    decls.set(match[1], match[2].trim());
  }
  return decls;
}

function parseColour(value: string): Rgba {
  const rgba = value.match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)/);
  if (rgba) {
    return {
      r: Number(rgba[1]),
      g: Number(rgba[2]),
      b: Number(rgba[3]),
      a: rgba[4] === undefined ? 1 : Number(rgba[4]),
    };
  }
  const hex = value.match(/^#([0-9a-f]{6})$/i);
  if (hex) {
    const n = parseInt(hex[1], 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, a: 1 };
  }
  throw new Error(`unsupported colour: ${value}`);
}

/** Source-over composite of a translucent colour onto an opaque background. */
function composite(fg: Rgba, bg: Rgba): Rgba {
  return {
    r: fg.r * fg.a + bg.r * (1 - fg.a),
    g: fg.g * fg.a + bg.g * (1 - fg.a),
    b: fg.b * fg.a + bg.b * (1 - fg.a),
    a: 1,
  };
}

function luminance({ r, g, b }: Rgba): number {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function contrastRatio(a: Rgba, b: Rgba): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

describe("light palette text contrast (#1195)", () => {
  const css = readFileSync(GLOBALS_CSS, "utf8");
  const explicit = blockDeclarations(css, EXPLICIT_LIGHT);
  const system = blockDeclarations(css, SYSTEM_LIGHT);

  it("the explicit and OS-driven light blocks define identical values", () => {
    expect([...system.entries()]).toEqual([...explicit.entries()]);
  });

  for (const [name, decls] of [
    ["explicit light", explicit],
    ["system light", system],
  ] as const) {
    describe(name, () => {
      const bgTriple = decls.get("--bg-rgb");
      if (!bgTriple) throw new Error("--bg-rgb missing from the light palette");
      const [br, bgG, bb] = bgTriple.split(",").map((n) => Number(n.trim()));
      const background: Rgba = { r: br, g: bgG, b: bb, a: 1 };

      it.each(TEXT_TOKENS)("%s reaches 4.5:1 on the light background", (token) => {
        const value = decls.get(token);
        expect(value, `${token} missing from the light palette`).toBeDefined();
        const text = composite(parseColour(value!), background);
        const ratio = contrastRatio(text, background);
        expect(ratio, `${token} contrast ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
      });
    });
  }
});
