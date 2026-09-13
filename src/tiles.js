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
 * TILE_STYLE names one of the styles below. TILE_URL overrides it with any
 * {z}/{x}/{y} address, which is how a provider that wants an account is used:
 *
 *   TILE_URL=https://tiles.stadiamaps.com/tiles/alidade_smooth_dark/{z}/{x}/{y}{r}.png?api_key=…
 *   TILE_ATTRIBUTION=&copy; Stadia Maps &copy; OpenStreetMap contributors
 *
 * {r} becomes "@2x" for a high-resolution screen, where the provider offers it.
 */

const OSM_CREDIT = '&copy; <a href="https://www.openstreetmap.org/copyright" rel="noopener">'
  + 'OpenStreetMap</a> contributors';

/**
 * `filter` is CSS, applied to the tiles in the browser. It is part of the
 * style rather than a fixed rule, because how a basemap has to be treated
 * depends entirely on which one it is.
 */
const STYLES = {
  /*
   * The default: OpenStreetMap's own tiles, turned dark on the way in rather
   * than served dark. Nothing to sign up for and no key to be withdrawn —
   * which is what put the words "api key required" across the previous
   * provider's tiles. Inverting a map also inverts its hues, so they are
   * turned back; what survives is the lightness, which is the point.
   *
   * OpenStreetMap asks that whoever fetches its tiles say who they are and not
   * ask twice for the same square, which the relay's user agent and its cache
   * between them do. An archive read by many more people than this one should
   * move to a provider it pays: that is TILE_URL, and nothing else changes.
   */
  'osm-dark': {
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: OSM_CREDIT,
    maxZoom: 19,
    filter: 'invert(1) hue-rotate(180deg) saturate(0.6) brightness(0.95) contrast(1.05)',
  },

  /** The same map left as it is drawn: pale, and closest to what most know. */
  osm: {
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: OSM_CREDIT,
    maxZoom: 19,
    filter: 'saturate(0.8) brightness(0.96)',
  },

  /*
   * Esri's dark canvas, drawn dark rather than made dark, and quieter for it.
   * The trade is names: Esri keeps its labels in a second layer this relay
   * does not fetch, so this is roads and coastline without place names — good
   * to look at, harder to place a pin by.
   */
  'esri-dark': {
    url: 'https://services.arcgisonline.com/ArcGIS/rest/services/Canvas/'
      + 'World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}',
    attribution: 'Tiles &copy; <a href="https://www.esri.com" rel="noopener">Esri</a>, '
      + OSM_CREDIT,
    maxZoom: 16,
    filter: 'saturate(0.9) brightness(1.05)',
  },

  /*
   * The former default. CARTO now stamps "api key required" across tiles
   * fetched without an account, so this is only useful with one — set
   * TILE_URL to the keyed address instead of naming this style.
   */
  'carto-dark': {
    url: 'https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
    attribution: `${OSM_CREDIT} &copy; <a href="https://carto.com/attributions" rel="noopener">CARTO</a>`,
    maxZoom: 20,
    filter: 'saturate(0.75) brightness(0.82)',
  },
};

const DEFAULT_STYLE = 'osm-dark';

/** A provider given only as a URL is assumed to be already the look intended. */
const CUSTOM = { attribution: OSM_CREDIT, maxZoom: 20, filter: 'saturate(0.8) brightness(0.92)' };

function setting(name) {
  return (process.env[name] || '').trim();
}

/**
 * The style in force: a named one, anything TILE_URL points at, or the default.
 * Read per call rather than frozen at load, so the tests and a restarted
 * process see the same settings the environment does.
 */
function style() {
  const named = STYLES[setting('TILE_STYLE')];
  const url = setting('TILE_URL');
  const base = named || (url ? CUSTOM : STYLES[DEFAULT_STYLE]);

  return {
    url: url || base.url,
    attribution: setting('TILE_ATTRIBUTION') || base.attribution,
    maxZoom: Number(setting('TILE_MAX_ZOOM') || base.maxZoom),
    filter: process.env.TILE_FILTER === undefined ? base.filter : process.env.TILE_FILTER,
  };
}

/** What the map needs to know about the imagery it is being handed. */
function config() {
  const { attribution, maxZoom, filter } = style();
  return { attribution, maxZoom, filter };
}

/**
 * Builds the upstream address from numbers alone.
 *
 * Nothing a caller sends becomes part of the host or the path shape — only
 * three integers, each checked against the bounds of the zoom level they
 * claim. Without that this route would be an open proxy: a way to make the
 * archive fetch any address on someone else's behalf.
 *
 * Placeholders are named, so a provider that orders them {z}/{y}/{x} — Esri
 * does — is a matter of its address and nothing more.
 */
function upstreamFor(z, x, y, retina) {
  const { url, maxZoom } = style();
  if (!Number.isInteger(z) || !Number.isInteger(x) || !Number.isInteger(y)) return null;
  if (z < 0 || z > maxZoom) return null;

  const span = 2 ** z;
  if (x < 0 || x >= span || y < 0 || y >= span) return null;

  // A provider with no {r} in its address has no doubled tile to offer, and
  // the ordinary one is served instead: softer on a dense screen, never blank.
  return url
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
  // Keyed by the address rather than the coordinates, so a change of provider
  // cannot serve one map's squares inside another's, and so a doubled tile
  // that resolves to the ordinary one is stored once.
  const url = upstreamFor(z, x, y, retina);
  if (!url) return null;

  const hit = cache.get(url);
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
  remember(url, tile);
  return tile;
}

module.exports = { fetchTile, upstreamFor, config, style, STYLES, DEFAULT_STYLE, MAX_TILES, cache };
