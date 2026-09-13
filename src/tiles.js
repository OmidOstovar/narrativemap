'use strict';

/**
 * The map's base imagery, fetched by the archive rather than by the reader.
 *
 * A tile layer is dozens of requests per glance at the map, each carrying the
 * reader's address to whoever serves them, and together describing exactly
 * where on the map that reader is looking. For an archive of testimony that is
 * a poor thing to hand out, so the archive asks on their behalf: the provider
 * sees this server, and the reader's browser speaks only to the archive.
 *
 * TILE_URL chooses the provider. The default is CARTO's dark basemap, which
 * needs no account. Anything with {z}/{x}/{y} works, so moving to a keyed
 * provider — Stadia, MapTiler — is a change of variable, not of code:
 *
 *   TILE_URL=https://tiles.stadiamaps.com/tiles/alidade_smooth_dark/{z}/{x}/{y}{r}.png?api_key=…
 *
 * {r} becomes "@2x" for a high-resolution screen and nothing otherwise.
 */

const DEFAULT_URL = 'https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';

/** As required by the providers, and shown on the map. */
const ATTRIBUTION = process.env.TILE_ATTRIBUTION
  || '&copy; <a href="https://www.openstreetmap.org/copyright" rel="noopener">OpenStreetMap</a>'
  + ' &copy; <a href="https://carto.com/attributions" rel="noopener">CARTO</a>';

const MAX_ZOOM = Number(process.env.TILE_MAX_ZOOM || 18);

function template() {
  return (process.env.TILE_URL || DEFAULT_URL).trim();
}

/**
 * Builds the upstream address from numbers alone.
 *
 * Nothing a caller sends becomes part of the host or the path shape — only
 * three integers, each checked against the bounds of the zoom level they
 * claim. Without that this route would be an open proxy: a way to make the
 * archive fetch any address on someone else's behalf.
 */
function upstreamFor(z, x, y, retina) {
  if (!Number.isInteger(z) || !Number.isInteger(x) || !Number.isInteger(y)) return null;
  if (z < 0 || z > MAX_ZOOM) return null;

  const span = 2 ** z;
  if (x < 0 || x >= span || y < 0 || y >= span) return null;

  return template()
    .replace('{z}', String(z))
    .replace('{x}', String(x))
    .replace('{y}', String(y))
    .replace('{r}', retina ? '@2x' : '');
}

/**
 * A small hot cache, shared by everyone looking at the same part of the map.
 *
 * Held in memory rather than on the volume: the volume is where the archive
 * lives, and map imagery must never be what fills it. Browsers do the heavy
 * lifting through the long cache header on each tile; this only spares the
 * provider the first visitor of each pair of eyes.
 */
const MAX_TILES = Number(process.env.TILE_CACHE_TILES || 600);
const cache = new Map();

function remember(key, tile) {
  cache.set(key, tile);
  // A Map keeps insertion order, so the oldest key is the first one out.
  while (cache.size > MAX_TILES) cache.delete(cache.keys().next().value);
}

/**
 * Fetches one tile. Returns { body, type } or null when the coordinates are
 * not real, and throws only when the provider fails.
 */
async function fetchTile(z, x, y, { retina = false } = {}) {
  const url = upstreamFor(z, x, y, retina);
  if (!url) return null;

  const key = `${z}/${x}/${y}${retina ? '@2x' : ''}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const response = await fetch(url, {
    headers: { 'User-Agent': 'narrativemap (a public archive of first-hand narratives)' },
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error(`tile upstream said ${response.status}`);

  const tile = {
    body: Buffer.from(await response.arrayBuffer()),
    type: response.headers.get('content-type') || 'image/png',
  };
  remember(key, tile);
  return tile;
}

module.exports = { fetchTile, upstreamFor, ATTRIBUTION, MAX_ZOOM, MAX_TILES, cache };
