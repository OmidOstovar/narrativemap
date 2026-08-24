'use strict';

const fs = require('node:fs');
const path = require('node:path');

const GEO_PATH = path.join(__dirname, '..', 'public', 'data', 'iran.geo.json');

const geo = JSON.parse(fs.readFileSync(GEO_PATH, 'utf8'));
const border = geo.features.find((f) => f.properties.name === 'Iran');
const provinces = geo.features.filter((f) => f !== border);

/** Ray-casting test for a point against a single linear ring. */
function inRing([x, y], ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

/** True when the point is inside the outer ring and outside every hole. */
function inPolygon(point, polygon) {
  if (!inRing(point, polygon[0])) return false;
  return polygon.slice(1).every((hole) => !inRing(point, hole));
}

function inFeature(point, feature) {
  const { type, coordinates } = feature.geometry;
  const polygons = type === 'Polygon' ? [coordinates] : coordinates;
  return polygons.some((polygon) => inPolygon(point, polygon));
}

/**
 * The boundary data is simplified for display, so a point can sit a few hundred
 * metres outside the drawn coastline and still be a real Iranian address. The
 * tolerance re-tests the point nudged in each direction before rejecting it.
 */
const TOLERANCE_DEGREES = 0.05;

function isInsideIran(lat, lng) {
  const point = [lng, lat];
  if (inFeature(point, border)) return true;
  const t = TOLERANCE_DEGREES;
  const nudges = [[t, 0], [-t, 0], [0, t], [0, -t]];
  return nudges.some(([dx, dy]) => inFeature([lng + dx, lat + dy], border));
}

/** Returns the province name containing the point, or null. */
function provinceFor(lat, lng) {
  const point = [lng, lat];
  const hit = provinces.find((f) => inFeature(point, f));
  if (hit) return hit.properties.name;

  // Coastal and border points may fall just outside the simplified outline;
  // fall back to the nearest province centroid within a small radius.
  let best = null;
  let bestDistance = Infinity;
  for (const feature of provinces) {
    const c = centroidOf(feature);
    const d = (c[0] - lng) ** 2 + (c[1] - lat) ** 2;
    if (d < bestDistance) { bestDistance = d; best = feature; }
  }
  return bestDistance < 4 && best ? best.properties.name : null;
}

const centroids = new Map();
function centroidOf(feature) {
  const name = feature.properties.name;
  if (centroids.has(name)) return centroids.get(name);
  const { type, coordinates } = feature.geometry;
  const polygons = type === 'Polygon' ? [coordinates] : coordinates;
  let sx = 0;
  let sy = 0;
  let n = 0;
  for (const polygon of polygons) {
    for (const [x, y] of polygon[0]) { sx += x; sy += y; n++; }
  }
  const c = [sx / n, sy / n];
  centroids.set(name, c);
  return c;
}

const PROVINCE_NAMES = provinces.map((f) => f.properties.name).sort();

module.exports = { isInsideIran, provinceFor, PROVINCE_NAMES };
