/**
 * One-off helper: print Arctic/North Atlantic dots with owners for seam tuning.
 * Run: node scripts/analyze_arctic_dots.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

const parseDots = () => {
  const content = fs.readFileSync(path.join(root, 'constants.tsx'), 'utf8');
  const match =
    content.match(/export const MAP_DOTS: MapPoint\[\]\s*=\s*\[(.*?)\];/s) ||
    content.match(/export const MAP_DOTS\s*=\s*\[(.*?)\];/s);
  if (!match) throw new Error('MAP_DOTS not found');
  const dotPattern = /\{\s*x\s*:\s*([\d.-]+)\s*,\s*y\s*:\s*([\d.-]+)\s*\}/g;
  const dots = [];
  let m;
  while ((m = dotPattern.exec(match[1])) !== null) {
    dots.push({
      index: dots.length,
      x: Number.parseFloat(m[1]),
      y: Number.parseFloat(m[2]),
    });
  }
  return dots;
};

const parseMappings = () => {
  const content = fs.readFileSync(path.join(root, 'utils', 'countryData.ts'), 'utf8');
  const mapping = {};
  const countryPattern = /"([^"]+)"\s*:\s*\[([\s\S]*?)\](?=\s*,\s*"|$)/g;
  let cm;
  while ((cm = countryPattern.exec(content)) !== null) {
    const name = cm[1];
    const body = cm[2];
    const nums = body.match(/\d+/g);
    mapping[name] = nums ? nums.map(Number) : [];
  }
  return mapping;
};

const dots = parseDots();
const mapping = parseMappings();

const ownersByIndex = new Map();
for (const [country, indices] of Object.entries(mapping)) {
  for (const i of indices) {
    if (!ownersByIndex.has(i)) ownersByIndex.set(i, []);
    ownersByIndex.get(i).push(country);
  }
}

// Far north: Ellesmere-ish (top of map) + Baffin seam — y roughly 71–360
const Y_MAX = 380;
const X_MIN = 700;
const X_MAX = 1250;

const arctic = dots.filter(
  (d) => d.y <= Y_MAX && d.x >= X_MIN && d.x <= X_MAX
);

console.log('Index |    x    |    y    | owner(s)');
console.log('-'.repeat(70));
for (const d of arctic.sort((a, b) => a.y - b.y || a.x - b.x)) {
  const owners = ownersByIndex.get(d.index) ?? ['(none)'];
  const tag = owners.join(',');
  if (
    tag.includes('Canada') ||
    tag.includes('Greenland') ||
    tag.includes('(none)')
  ) {
    console.log(
      String(d.index).padStart(5),
      '|',
      d.x.toFixed(1).padStart(7),
      '|',
      d.y.toFixed(1).padStart(7),
      '|',
      tag
    );
  }
}
