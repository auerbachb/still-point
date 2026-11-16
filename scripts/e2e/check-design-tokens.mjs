import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

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
  "--font-serif",
  "--font-mono",
  "--accent-green-strong",
  "--accent-green-dim",
  "--accent-green-bg",
  "--accent-green-glow",
  "--accent-green-muted",
  "--accent-amber-hint",
  "--accent-amber-muted",
  "--accent-danger-border",
  "--overlay-bg",
  "--accent-green-rgb",
  "--accent-blue-rgb",
  "--accent-blue-deep-rgb",
  "--accent-blue-text",
  "--accent-amber-active-text",
  "--accent-green-active-text",
  "--accent-amber-note",
  "--nav-h",
]);

/** iOS-only SPColor tokens that intentionally have no web counterpart. */
const SPCOLOR_ONLY = new Set(/** @type {string[]} */ ([]));

/** iOS-only SPSpacing tokens that intentionally have no web counterpart. */
const SPSPACING_ONLY = new Set(/** @type {string[]} */ ([]));

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

/** Drops `//` line comments so declarations can be scanned without comment noise. */
function stripLineComments(swift) {
  return swift.replace(/\/\/[^\n]*/g, "");
}

/**
 * Collects `static let name = expr` declarations from one enum body. Each
 * expression runs up to the next declaration, so multi-line expressions such as
 * `Color.adaptive(` ... `)` stay whole. Whitespace is removed from the expression.
 * @param {string} body
 * @returns {Record<string, string>}
 */
function collectStaticLets(body) {
  const starts = [...body.matchAll(/static let (\w+)\s*=/g)];
  /** @type {Record<string, string>} */
  const exprs = {};
  starts.forEach((match, index) => {
    const from = match.index + match[0].length;
    const to = index + 1 < starts.length ? starts[index + 1].index : body.length;
    exprs[match[1]] = body.slice(from, to).replace(/\s+/g, "");
  });
  return exprs;
}

/**
 * Parses the inside of a Swift RGB tuple or initializer, e.g.
 * `red:232.0/255,green:228.0/255,blue:222.0/255` (whitespace already removed).
 * @param {string} args @returns {Rgba | null}
 */
function parseRgbArgs(args) {
  const match = args.match(
    /^red:([\d.]+(?:\/\d+)?),green:([\d.]+(?:\/\d+)?),blue:([\d.]+(?:\/\d+)?)$/
  );
  if (!match) {
    return null;
  }
  return {
    r: Math.round(evalFraction(match[1]) * 255),
    g: Math.round(evalFraction(match[2]) * 255),
    b: Math.round(evalFraction(match[3]) * 255),
    a: 1,
  };
}

/** A Color.adaptive argument: an inline tuple or a name from the private SPInk enum. */
const ADAPTIVE_ARG = String.raw`\(red:[^()]*\)|[\w.]+`;
// Groups: 1 dark arg, 2 light arg, 3 darkOpacity, 4 lightOpacity (unused: only dark is
// compared), 5 trailing `.opacity(n)`. Whitespace is already removed from expressions.
const ADAPTIVE_RE = new RegExp(
  `^Color\\.adaptive\\(dark:(${ADAPTIVE_ARG}),light:(${ADAPTIVE_ARG})` +
    `(?:,darkOpacity:([\\d.]+))?(?:,lightOpacity:([\\d.]+))?\\)(?:\\.opacity\\(([\\d.]+)\\))?$`
);

/**
 * @param {string} swift
 * @returns {{ colors: Record<string, Rgba>, rawExprs: Record<string, string> }}
 *   colors holds every SPColor token resolved to its DARK value. Adaptive tokens
 *   (`Color.adaptive(dark:, light:)`) compare by their dark value, the palette
 *   the web CSS mirrors. The light value must still parse, but is not compared.
 */
export function parseSwiftColors(swift) {
  const code = stripLineComments(swift);
  const spColorBlock = code.match(/public enum SPColor\s*\{([\s\S]*?)\n\}/);
  if (!spColorBlock) {
    throw new Error("Could not find SPColor enum in DesignTokens.swift");
  }
  const spInkBlock = code.match(/enum SPInk\s*\{([\s\S]*?)\n\}/);
  const inkDecls = spInkBlock ? collectStaticLets(spInkBlock[1]) : {};
  const colorDecls = collectStaticLets(spColorBlock[1]);

  // SPInk tokens are referenced as `SPInk.<name>`; the SPColor tokens use bare names.
  /** @type {Record<string, string>} */
  const rawExprs = { ...colorDecls };
  for (const [name, expr] of Object.entries(inkDecls)) {
    rawExprs[`SPInk.${name}`] = expr;
  }

  /** Resolves a tuple argument: an inline `(red:…)` literal or a named SPInk tuple. */
  /** @param {string} ref @returns {Rgba | null} */
  function resolveTupleRef(ref) {
    if (ref.startsWith("(")) {
      return parseRgbArgs(ref.slice(1, -1));
    }
    const expr = inkDecls[ref.replace(/^SPInk\./, "")];
    return expr && expr.startsWith("(") ? parseRgbArgs(expr.slice(1, -1)) : null;
  }

  /** @type {Record<string, Rgba>} */
  const resolved = {};

  /** @param {string} name @returns {Rgba} */
  function resolveColor(name) {
    if (resolved[name]) {
      return resolved[name];
    }

    const expr = rawExprs[name];
    if (!expr) {
      throw new Error(`Unknown Swift color token: ${name}`);
    }

    const color = evaluateExpr(name, expr);
    resolved[name] = color;
    return color;
  }

  /** @param {string} name @param {string} expr @returns {Rgba} */
  function evaluateExpr(name, expr) {
    const ctorMatch = expr.match(/^Color\((red:[^()]*)\)(?:\.opacity\(([\d.]+)\))?$/);
    if (ctorMatch) {
      const rgb = parseRgbArgs(ctorMatch[1]);
      if (rgb) {
        return { ...rgb, a: ctorMatch[2] ? Number(ctorMatch[2]) : 1 };
      }
    }

    const adaptiveMatch = expr.match(ADAPTIVE_RE);
    if (adaptiveMatch) {
      const dark = resolveTupleRef(adaptiveMatch[1]);
      const light = resolveTupleRef(adaptiveMatch[2]);
      if (!dark || !light) {
        throw new Error(`Unsupported adaptive SPColor tuple for ${name}: ${expr}`);
      }
      const opacity = adaptiveMatch[3] ?? adaptiveMatch[5];
      return { ...dark, a: opacity ? Number(opacity) : 1 };
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
        return { r: 0, g: 0, b: 0, a: Number(derivedMatch[2]) };
      }
      return { ...resolveColor(baseToken), a: Number(derivedMatch[2]) };
    }

    // Adaptive tokens with a trailing opacity are matched above by ADAPTIVE_RE, so
    // a `.opacity` suffix on a multi-line expression is not `[\w.]+` and fails here.
    throw new Error(`Unsupported SPColor expression for ${name}: ${expr}`);
  }

  for (const name of Object.keys(colorDecls)) {
    resolveColor(name);
  }

  /** @type {Record<string, Rgba>} */
  const colors = {};
  for (const name of Object.keys(colorDecls)) {
    colors[name] = resolved[name];
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

  for (const swiftName of Object.keys(swiftColors)) {
    if (SHARED_COLOR_MAP[swiftName] != null || SPCOLOR_ONLY.has(swiftName)) {
      continue;
    }
    violations.push(
      `Unexpected Swift token SPColor.${swiftName} is neither shared nor listed as platform-specific`
    );
  }

  for (const swiftName of Object.keys(swiftSpacing)) {
    if (SHARED_SPACING_MAP[swiftName] != null || SPSPACING_ONLY.has(swiftName)) {
      continue;
    }
    violations.push(
      `Unexpected Swift token SPSpacing.${swiftName} is neither shared nor listed as platform-specific`
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
    `Design token parity check passed (${sharedColorCount} shared colors, ${sharedSpacingCount} shared spacing values, ${CSS_ONLY_VARS.size} web-only CSS tokens, ${SPCOLOR_ONLY.size + SPSPACING_ONLY.size} iOS-only tokens).`
  );
}

// Run only as the entrypoint, so the unit tests can import the parser.
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main();
}
