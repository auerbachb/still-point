import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { parseSwiftColors } from "./check-design-tokens.mjs";

const REPO_ROOT = process.cwd();
const DESIGN_TOKENS = path.join(REPO_ROOT, "ios", "StillPointApp", "Theme", "DesignTokens.swift");

/** Wraps SPColor declarations in the enum shape DesignTokens.swift uses. */
function spColor(body: string): string {
  return `public enum SPColor {\n${body}\n}\n`;
}

describe("parseSwiftColors", () => {
  test("resolves every token in the real DesignTokens.swift without throwing", () => {
    const swift = fs.readFileSync(DESIGN_TOKENS, "utf8");
    const { colors } = parseSwiftColors(swift);

    // Dark palette values the web CSS mirrors (globals.css :root).
    expect(colors.bg).toEqual({ r: 26, g: 24, b: 22, a: 1 });
    expect(colors.fg).toEqual({ r: 232, g: 228, b: 222, a: 0.92 });
    expect(colors.green).toEqual({ r: 74, g: 222, b: 128, a: 1 });
    expect(colors.danger).toEqual({ r: 239, g: 68, b: 68, a: 0.7 });
  });

  test("compares an adaptive token by its dark value, not its light value", () => {
    const swift = spColor(`
    static let bg = Color.adaptive(
        dark: (red: 26 / 255, green: 24 / 255, blue: 22 / 255),
        light: (red: 247 / 255, green: 245 / 255, blue: 241 / 255)
    )`);
    expect(parseSwiftColors(swift).colors.bg).toEqual({ r: 26, g: 24, b: 22, a: 1 });
  });

  test("applies a trailing opacity to a multi-line adaptive token", () => {
    const swift = spColor(`
    static let danger = Color.adaptive(
        dark: (red: 239 / 255, green: 68 / 255, blue: 68 / 255),
        light: (red: 185 / 255, green: 28 / 255, blue: 28 / 255)
    ).opacity(0.7)`);
    expect(parseSwiftColors(swift).colors.danger).toEqual({ r: 239, g: 68, b: 68, a: 0.7 });
  });

  test("reads the dark opacity of a token with separate light and dark opacities", () => {
    const swift = [
      "private enum SPInk {",
      "    static let dark = (red: 232.0 / 255, green: 228.0 / 255, blue: 222.0 / 255)",
      "    static let light = (red: 38.0 / 255, green: 34.0 / 255, blue: 30.0 / 255)",
      "}",
      spColor(`
    static let fg3 = Color.adaptive(
        dark: SPInk.dark, light: SPInk.light, darkOpacity: 0.52, lightOpacity: 0.70
    )`),
    ].join("\n");
    expect(parseSwiftColors(swift).colors.fg3).toEqual({ r: 232, g: 228, b: 222, a: 0.52 });
  });

  test("resolves a token built on a named tuple in a private enum", () => {
    const swift = [
      "private enum SPInk {",
      "    static let dark = (red: 232.0 / 255, green: 228.0 / 255, blue: 222.0 / 255)",
      "    static let light = (red: 38.0 / 255, green: 34.0 / 255, blue: 30.0 / 255)",
      "    static let base = Color.adaptive(dark: dark, light: light)",
      "}",
      "",
      spColor(`
    static let fg = SPInk.base.opacity(0.92)
    static let border1 = SPInk.base.opacity(0.08)`),
    ].join("\n");
    const { colors } = parseSwiftColors(swift);
    expect(colors.fg).toEqual({ r: 232, g: 228, b: 222, a: 0.92 });
    expect(colors.border1).toEqual({ r: 232, g: 228, b: 222, a: 0.08 });
  });

  test("ignores line comments, including ones between declarations", () => {
    const swift = spColor(`
    // Background
    static let bg = Color(red: 26 / 255, green: 24 / 255, blue: 22 / 255) // inline note
    // Overlay
    static let overlayText = Color.black.opacity(0.5)`);
    const { colors } = parseSwiftColors(swift);
    expect(colors.bg).toEqual({ r: 26, g: 24, b: 22, a: 1 });
    expect(colors.overlayText).toEqual({ r: 0, g: 0, b: 0, a: 0.5 });
  });

  test("still rejects an unsupported expression, so the gate stays strict", () => {
    const swift = spColor("    static let bg = UIColor.systemBackground");
    expect(() => parseSwiftColors(swift)).toThrow(
      "Unsupported SPColor expression for bg: UIColor.systemBackground"
    );
  });

  test("rejects system Color.red opacity, as before", () => {
    const swift = spColor("    static let danger = Color.red.opacity(0.7)");
    expect(() => parseSwiftColors(swift)).toThrow("uses system Color.red");
  });

  test("rejects an adaptive token whose light tuple cannot be parsed", () => {
    const swift = spColor(`
    static let bg = Color.adaptive(
        dark: (red: 26 / 255, green: 24 / 255, blue: 22 / 255),
        light: UIColor.white
    )`);
    expect(() => parseSwiftColors(swift)).toThrow("Unsupported adaptive SPColor tuple for bg");
  });
});
