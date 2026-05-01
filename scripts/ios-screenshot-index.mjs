#!/usr/bin/env node
/**
 * Builds screenshots/index.html listing every PNG under a directory (recursive),
 * grouped by basename prefix so multiple device rows align for side-by-side review.
 *
 * Usage: node scripts/ios-screenshot-index.mjs <directory>
 */
import fs from "node:fs/promises";
import path from "node:path";

const root = process.argv[2];
if (!root) {
  console.error("Usage: ios-screenshot-index.mjs <screenshots-directory>");
  process.exit(1);
}

async function collectPngs(dir) {
  const out = [];
  async function walk(current) {
    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const ent of entries) {
      const full = path.join(current, ent.name);
      if (ent.isDirectory()) await walk(full);
      else if (ent.name.endsWith(".png")) out.push(full);
    }
  }
  await walk(dir);
  return out.sort();
}

function devicePrefix(filename) {
  const base = path.basename(filename, ".png");
  const idx = base.indexOf("-");
  return idx === -1 ? base : base.slice(0, idx);
}

function shotSuffix(filename) {
  const base = path.basename(filename, ".png");
  const idx = base.indexOf("-");
  return idx === -1 ? base : base.slice(idx + 1);
}

const pngs = await collectPngs(root);
const byShot = new Map();
for (const file of pngs) {
  const suffix = shotSuffix(file);
  const rel = path.relative(root, file);
  if (!byShot.has(suffix)) byShot.set(suffix, []);
  byShot.get(suffix).push({ rel, device: devicePrefix(path.basename(file)) });
}

const rows = [...byShot.entries()].sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }));
const devices = [...new Set(pngs.map((p) => devicePrefix(path.basename(p))))].sort();

const esc = (s) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

let html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>Still Point — screenshot candidates</title>
  <style>
    body { font-family: system-ui, sans-serif; margin: 24px; background: #0b0f14; color: #e8eef5; }
    h1 { font-weight: 600; font-size: 1.25rem; }
    p { color: #9fb0c3; max-width: 72rem; line-height: 1.5; }
    table { border-collapse: collapse; margin-top: 16px; width: 100%; }
    th, td { border: 1px solid #243042; padding: 8px; vertical-align: top; }
    th { text-align: left; font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.06em; color: #7d93ab; }
    td img { max-width: 220px; height: auto; display: block; background: #111822; }
    .shot { font-family: ui-monospace, monospace; font-size: 0.8rem; color: #c9d7e8; }
    .device { font-size: 0.65rem; color: #7d93ab; margin-top: 6px; }
  </style>
</head>
<body>
  <h1>Screenshot candidates</h1>
  <p>Open this file locally after <code>fastlane screenshots</code>. Rows share the same shot name across simulators; columns are devices present in the folder.</p>
  <table>
    <thead><tr><th>Shot</th>${devices.map((d) => `<th>${esc(d)}</th>`).join("")}</tr></thead>
    <tbody>
`;

for (const [suffix, files] of rows) {
  const byDevice = Object.fromEntries(files.map((f) => [f.device, f.rel]));
  html += `<tr><td class="shot">${esc(suffix)}</td>`;
  for (const d of devices) {
    const rel = byDevice[d];
    if (!rel) {
      html += `<td>—</td>`;
    } else {
      html += `<td><img src="${esc(rel)}" alt="${esc(suffix)} ${esc(d)}"/><div class="device">${esc(d)}</div></td>`;
    }
  }
  html += `</tr>`;
}

html += `
    </tbody>
  </table>
</body>
</html>
`;

await fs.writeFile(path.join(root, "index.html"), html, "utf8");
console.log(`Wrote ${path.join(root, "index.html")}`);
