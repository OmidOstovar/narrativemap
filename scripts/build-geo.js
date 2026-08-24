#!/usr/bin/env node
/**
 * Builds public/data/iran.geo.json from geoBoundaries source data.
 *
 * Sources (CC BY 4.0, geoBoundaries / www.geoboundaries.org):
 *   ADM0 https://media.githubusercontent.com/media/wmgeolab/geoBoundaries/main/releaseData/gbOpen/IRN/ADM0/geoBoundaries-IRN-ADM0_simplified.geojson
 *   ADM1 https://media.githubusercontent.com/media/wmgeolab/geoBoundaries/main/releaseData/gbOpen/IRN/ADM1/geoBoundaries-IRN-ADM1_simplified.geojson
 *
 * Usage: node scripts/build-geo.js <adm0.geojson> <adm1.geojson>
 *
 * The raw files are ~1.3 MB combined; this reduces them to a browser-friendly
 * outline by running Douglas-Peucker over every ring and rounding coordinates.
 */
const fs = require('node:fs');
const path = require('node:path');

const OUT = path.join(__dirname, '..', 'public', 'data', 'iran.geo.json');

// Perpendicular distance from p to the segment a-b, in degrees.
function segmentDistance(p, a, b) {
  let [x, y] = a;
  let dx = b[0] - x;
  let dy = b[1] - y;
  if (dx !== 0 || dy !== 0) {
    const t = ((p[0] - x) * dx + (p[1] - y) * dy) / (dx * dx + dy * dy);
    if (t > 1) { x = b[0]; y = b[1]; }
    else if (t > 0) { x += dx * t; y += dy * t; }
  }
  dx = p[0] - x;
  dy = p[1] - y;
  return Math.sqrt(dx * dx + dy * dy);
}

function douglasPeucker(points, tolerance) {
  if (points.length <= 2) return points;
  let maxDist = 0;
  let index = 0;
  const last = points.length - 1;
  for (let i = 1; i < last; i++) {
    const d = segmentDistance(points[i], points[0], points[last]);
    if (d > maxDist) { maxDist = d; index = i; }
  }
  if (maxDist <= tolerance) return [points[0], points[last]];
  return [
    ...douglasPeucker(points.slice(0, index + 1), tolerance).slice(0, -1),
    ...douglasPeucker(points.slice(index), tolerance),
  ];
}

// Shoelace area, used to throw away specks too small to see at country zoom.
function ringArea(ring) {
  let sum = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    sum += (ring[j][0] * ring[i][1]) - (ring[i][0] * ring[j][1]);
  }
  return Math.abs(sum / 2);
}

function round(ring, digits) {
  const f = 10 ** digits;
  return ring.map(([x, y]) => [Math.round(x * f) / f, Math.round(y * f) / f]);
}

function simplifyRing(ring, tolerance, digits) {
  let out = douglasPeucker(ring, tolerance);
  out = round(out, digits);
  // Drop consecutive duplicates introduced by rounding.
  out = out.filter((p, i) => i === 0 || p[0] !== out[i - 1][0] || p[1] !== out[i - 1][1]);
  if (out.length < 4) return null;
  const first = out[0];
  const lastPoint = out[out.length - 1];
  if (first[0] !== lastPoint[0] || first[1] !== lastPoint[1]) out.push(first);
  return out.length >= 4 ? out : null;
}

function simplifyGeometry(geometry, { tolerance, digits, minArea }) {
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  const kept = [];
  for (const polygon of polygons) {
    if (ringArea(polygon[0]) < minArea) continue;
    const outer = simplifyRing(polygon[0], tolerance, digits);
    if (!outer) continue;
    const holes = polygon.slice(1)
      .filter((r) => ringArea(r) >= minArea * 2)
      .map((r) => simplifyRing(r, tolerance, digits))
      .filter(Boolean);
    kept.push([outer, ...holes]);
  }
  if (!kept.length) return null;
  return kept.length === 1
    ? { type: 'Polygon', coordinates: kept[0] }
    : { type: 'MultiPolygon', coordinates: kept };
}

function countPoints(geometry) {
  let n = 0;
  const walk = (a) => { if (typeof a[0] === 'number') { n++; return; } a.forEach(walk); };
  walk(geometry.coordinates);
  return n;
}

const [adm0Path, adm1Path] = process.argv.slice(2);
if (!adm0Path || !adm1Path) {
  console.error('Usage: node scripts/build-geo.js <adm0.geojson> <adm1.geojson>');
  console.error('See the header of this file for the source URLs.');
  process.exit(1);
}

const adm0 = JSON.parse(fs.readFileSync(adm0Path, 'utf8'));
const adm1 = JSON.parse(fs.readFileSync(adm1Path, 'utf8'));

const borderOpts = { tolerance: 0.012, digits: 3, minArea: 0.0006 };
const provinceOpts = { tolerance: 0.018, digits: 3, minArea: 0.0015 };

const border = {
  type: 'Feature',
  properties: { name: 'Iran' },
  geometry: simplifyGeometry(adm0.features[0].geometry, borderOpts),
};

// geoBoundaries splits a couple of provinces across features; merge by name.
const byName = new Map();
for (const feature of adm1.features) {
  const name = feature.properties.shapeName;
  const geometry = simplifyGeometry(feature.geometry, provinceOpts);
  if (!geometry) continue;
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  if (byName.has(name)) byName.get(name).push(...polygons);
  else byName.set(name, [...polygons]);
}

const provinces = [...byName.entries()]
  .map(([name, polygons]) => ({
    type: 'Feature',
    properties: { name, iso: adm1.features.find((f) => f.properties.shapeName === name)?.properties.shapeISO || null },
    geometry: polygons.length === 1
      ? { type: 'Polygon', coordinates: polygons[0] }
      : { type: 'MultiPolygon', coordinates: polygons },
  }))
  .sort((a, b) => a.properties.name.localeCompare(b.properties.name));

const output = {
  type: 'FeatureCollection',
  attribution: 'Boundaries: geoBoundaries (geoboundaries.org), CC BY 4.0',
  features: [border, ...provinces],
};

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(output));

const total = output.features.reduce((n, f) => n + countPoints(f.geometry), 0);
console.log(`Wrote ${OUT}`);
console.log(`  ${provinces.length} provinces + border, ${total} points, ${(fs.statSync(OUT).size / 1024).toFixed(1)} KB`);
