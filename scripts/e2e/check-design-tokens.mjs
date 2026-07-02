import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = process.cwd();
const GLOBALS_CSS = resolve(ROOT, "src/app/globals.css");
const DESIGN_TOKENS = resolve(ROOT, "ios/StillPointApp/Theme/DesignTokens.swift");

/** @typedef {{ r: number, g: number, b: number, a: number }} Rgba */

/** Shared color tokens: Swift SPColor name -> CSS custom property. */
const SHARED_COLOR_MAP = {
  bg: { css: "--bg-rgb", format: "rgb-triple" },
  fg: { css: "--fg" },
  fg2: { css: "--fg-2" },
  fg3: { css: "--fg-3" },
  fg4: { css: "--fg-4" },
  border1: { css: "--border-1" },
  border2: { css: "--border-2" },
  border3: { css: "--border-3" },
  surface1: { css: "--surface-1" },
  surface2: { css: "--surface-2" },
  surface3: { css: "--surface-3" },
  green: { css: "--accent-green" },
  greenEnd: { css: "--accent-green-end" },
  greenText: { css: "--accent-green-text" },
  greenBorder: { css: "--accent-green-border" },
  greenBorderSubtle: { css: "--accent-green-border-subtle" },
  greenBgSubtle: { css: "--accent-green-bg-subtle" },
  greenBgFaint: { css: "--accent-green-bg-faint" },
  amber: { css: "--accent-amber" },
  amberEnd: { css: "--accent-amber-end" },
  amberText: { css: "--accent-amber-text" },
  amberDim: { css: "--accent-amber-dim" },
  amberBorder: { css: "--accent-amber-border" },
  amberBorderSubtle: { css: "--accent-amber-border-subtle" },
  amberBg: { css: "--accent-amber-bg" },
  amberBgFaint: { css: "--accent-amber-bg-faint" },
  danger: { css: "--accent-danger" },
  dangerMuted: { css: "--accent-danger-muted" },
  dangerBorderSubtle: { css: "--accent-danger-border-subtle" },
  overlayText: { css: "--overlay-text" },
};

/** Shared spacing tokens: Swift SPSpacing name -> CSS custom property. */
const SHARED_SPACING_MAP = {
  s1: { css: "--s1" },
  s2: { css: "--s2" },
  s3: { css: "--s3" },
  s4: { css: "--s4" },
  s5: { css: "--s5" },
  s6: { css: "--s6" },
};

/** Web-only tokens that intentionally have no iOS counterpart. */
const CSS_ONLY_VARS = new Set([
  "--accent-green-strong",
  "--accent-green-dim",
  "--accent-green-bg",
  "--accent-green-glow",
  "--accent-green-muted",
  "--accent-amber-hint",
  "--accent-amber-muted",
  "--accent-danger-border",
  "--overlay-bg",
  "--nav-h",
]);

const SHARED_CSS_VARS = new Set([
  ...Object.values(SHARED_COLOR_MAP).map((entry) => entry.css),
  ...Object.values(SHARED_SPACING_MAP).map((entry) => entry.css),
]);

function evalFraction(raw) {
  if (raw.includes("/")) {
    const [numerator, denominator] = raw.split("/").map(Number);
    return numerator / denominator;
  }
  return Number(raw);
}

/** @param {string} css */
function parseCssVars(css) {
  const rootMatch = css.match(/:root\s*\{([\s\S]*?)\}/);
  if (!rootMatch) {
    throw new Error("Could not find :root block in globals.css");
  }

  /** @type {Record<string, string>} */
  const vars = {};
  const declRe = /--([a-z0-9-]+)\s*:\s*([^;]+);/gi;
  let match;
  while ((match = declRe.exec(rootMatch[1])) !== null) {
    vars[`--${match[1]}`] = match[2].trim();
  }
  return vars;
}

/** @param {string} value @returns {Rgba | null} */
function parseCssColor(value) {
  let match = value.match(/^rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*([\d.]+)\s*\)$/);
  if (match) {
    return { r: Number(match[1]), g: Number(match[2]), b: Number(match[3]), a: Number(match[4]) };
  }

  match = value.match(/^rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/);
  if (match) {
    return { r: Number(match[1]), g: Number(match[2]), b: Number(match[3]), a: 1 };
  }

  match = value.match(/^#([0-9a-f]{6})$/i);
  if (match) {
    const hex = match[1];
    return {
      r: parseInt(hex.slice(0, 2), 16),
      g: parseInt(hex.slice(2, 4), 16),
      b: parseInt(hex.slice(4, 6), 16),
      a: 1,
    };
  }

  match = value.match(/^(\d+)\s*,\s*(\d+)\s*,\s*(\d+)$/);
  if (match) {
    return { r: Number(match[1]), g: Number(match[2]), b: Number(match[3]), a: 1 };
  }

  return null;
}

/** @param {Rgba} color */
function formatRgba(color) {
  if (color.a === 1) {
    return `rgb(${color.r}, ${color.g}, ${color.b})`;
  }
  return `rgba(${color.r}, ${color.g}, ${color.b}, ${color.a})`;
}

/** @param {Rgba} left @param {Rgba} right */
function rgbaEqual(left, right) {
  return (
    left.r === right.r &&
    left.g === right.g &&
    left.b === right.b &&
    Math.abs(left.a - right.a) < 0.001
  );
}

/**
 * @param {string} swift
 * @returns {{ colors: Record<string, Rgba>, rawExprs: Record<string, string> }}
 */
function parseSwiftColors(swift) {
  const spColorBlock = swift.match(/public enum SPColor\s*\{([\s\S]*?)\n\}/);
  if (!spColorBlock) {
    throw new Error("Could not find SPColor enum in DesignTokens.swift");
  }

  /** @type {Record<string, Rgba>} */
  const colors = {};
  /** @type {Record<string, string>} */
  const rawExprs = {};
  const declRe = /static let (\w+) = (.+)/g;
  let match;

  while ((match = declRe.exec(spColorBlock[1])) !== null) {
    rawExprs[match[1]] = match[2].trim();
  }

  /** @param {string} name @returns {Rgba} */
  function resolveColor(name) {
    if (colors[name]) {
      return colors[name];
    }

    const expr = rawExprs[name];
    if (!expr) {
      throw new Error(`Unknown Swift color token: ${name}`);
    }

    const rgbMatch = expr.match(
      /^Color\(red:\s*([\d.]+(?:\/\d+)?),\s*green:\s*([\d.]+(?:\/\d+)?),\s*blue:\s*([\d.]+(?:\/\d+)?)\)(?:\.opacity\(([\d.]+)\))?$/
    );
    if (rgbMatch) {
      const color = {
        r: Math.round(evalFraction(rgbMatch[1]) * 255),
        g: Math.round(evalFraction(rgbMatch[2]) * 255),
        b: Math.round(evalFraction(rgbMatch[3]) * 255),
        a: rgbMatch[4] ? Number(rgbMatch[4]) : 1,
      };
      colors[name] = color;
      return color;
    }

    const derivedMatch = expr.match(/^([\w.]+)\.opacity\(([\d.]+)\)$/);
    if (derivedMatch) {
      const baseToken = derivedMatch[1].replace(/^Color\./, "");
      if (baseToken === "red") {
        throw new Error(
          `SPColor.${name} uses system Color.red; use explicit Tailwind red-500 RGB (239, 68, 68) instead`
        );
      }
      if (baseToken === "black") {
        const color = { r: 0, g: 0, b: 0, a: Number(derivedMatch[2]) };
        colors[name] = color;
        return color;
      }
      const base = resolveColor(baseToken);
      const color = { ...base, a: Number(derivedMatch[2]) };
      colors[name] = color;
      return color;
    }

    throw new Error(`Unsupported SPColor expression for ${name}: ${expr}`);
  }

  for (const name of Object.keys(rawExprs)) {
    resolveColor(name);
  }

  return { colors, rawExprs };
}

/** @param {string} swift @returns {Record<string, number>} */
function parseSwiftSpacing(swift) {
  const spSpacingBlock = swift.match(/public enum SPSpacing\s*\{([\s\S]*?)\n\}/);
  if (!spSpacingBlock) {
    throw new Error("Could not find SPSpacing enum in DesignTokens.swift");
  }

  /** @type {Record<string, number>} */
  const spacing = {};
  const declRe = /static let (\w+):\s*CGFloat\s*=\s*(\d+)/g;
  let match;
  while ((match = declRe.exec(spSpacingBlock[1])) !== null) {
    spacing[match[1]] = Number(match[2]);
  }
  return spacing;
}

/** @param {string} cssValue @returns {number | null} */
function parseCssSpacing(cssValue) {
  const match = cssValue.match(/^(\d+)px$/);
  return match ? Number(match[1]) : null;
}

function main() {
  const cssContent = readFileSync(GLOBALS_CSS, "utf8");
  const swiftContent = readFileSync(DESIGN_TOKENS, "utf8");
  const cssVars = parseCssVars(cssContent);
  const { colors: swiftColors } = parseSwiftColors(swiftContent);
  const swiftSpacing = parseSwiftSpacing(swiftContent);

  const violations = [];

  for (const [swiftName, { css, format }] of Object.entries(SHARED_COLOR_MAP)) {
    const cssValue = cssVars[css];
    if (!cssValue) {
      violations.push(`Missing CSS variable ${css} for shared token SPColor.${swiftName}`);
      continue;
    }

    const swiftColor = swiftColors[swiftName];
    if (!swiftColor) {
      violations.push(`Missing Swift token SPColor.${swiftName} for shared CSS variable ${css}`);
      continue;
    }

    const cssColor = parseCssColor(cssValue);
    if (!cssColor) {
      violations.push(`Could not parse CSS color for ${css}: ${cssValue}`);
      continue;
    }

    if (format === "rgb-triple") {
      if (!rgbaEqual(swiftColor, cssColor)) {
        violations.push(
          `SPColor.${swiftName} (${formatRgba(swiftColor)}) != ${css} (${cssValue})`
        );
      }
      continue;
    }

    if (!rgbaEqual(swiftColor, cssColor)) {
      violations.push(
        `SPColor.${swiftName} (${formatRgba(swiftColor)}) != ${css} (${cssValue})`
      );
    }
  }

  for (const [swiftName, { css }] of Object.entries(SHARED_SPACING_MAP)) {
    const cssValue = cssVars[css];
    if (!cssValue) {
      violations.push(`Missing CSS variable ${css} for shared token SPSpacing.${swiftName}`);
      continue;
    }

    const swiftValue = swiftSpacing[swiftName];
    if (swiftValue == null) {
      violations.push(`Missing Swift token SPSpacing.${swiftName} for shared CSS variable ${css}`);
      continue;
    }

    const cssSpacing = parseCssSpacing(cssValue);
    if (cssSpacing == null) {
      violations.push(`Could not parse CSS spacing for ${css}: ${cssValue}`);
      continue;
    }

    if (swiftValue !== cssSpacing) {
      violations.push(`SPSpacing.${swiftName} (${swiftValue}) != ${css} (${cssValue})`);
    }
  }

  for (const cssVar of Object.keys(cssVars)) {
    if (SHARED_CSS_VARS.has(cssVar) || CSS_ONLY_VARS.has(cssVar)) {
      continue;
    }
    violations.push(
      `Unexpected CSS token ${cssVar} is neither shared nor listed as platform-specific`
    );
  }

  if (violations.length > 0) {
    console.error("Design token parity check failed:");
    for (const violation of violations) {
      console.error(`  - ${violation}`);
    }
    console.error("");
    console.error(
      "Shared tokens must stay aligned between ios/StillPointApp/Theme/DesignTokens.swift and src/app/globals.css."
    );
    process.exit(1);
  }

  const sharedColorCount = Object.keys(SHARED_COLOR_MAP).length;
  const sharedSpacingCount = Object.keys(SHARED_SPACING_MAP).length;
  console.log(
    `Design token parity check passed (${sharedColorCount} shared colors, ${sharedSpacingCount} shared spacing values, ${CSS_ONLY_VARS.size} web-only CSS tokens).`
  );
}

main();
