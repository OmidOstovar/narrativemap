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
 * TILE_STYLE names one of the styles below — the default is plain
 * OpenStreetMap, which is the one that has never refused. TILE_URL overrides it
 * with any {z}/{x}/{y} address, which is how a provider with an account is used:
 *
 *   TILE_URL=https://tiles.stadiamaps.com/tiles/alidade_smooth_dark/{z}/{x}/{y}{r}.png?api_key=…
 *   TILE_ATTRIBUTION=&copy; Stadia Maps &copy; OpenStreetMap contributors
 *
 * {r} becomes "@2x" for a high-resolution screen, where the provider offers it.
 *
 * TILE_STYLE_LATIN names the style shown to a reader in English, or 'off' to
 * leave everyone on the same imagery. OpenStreetMap letters a place in the
 * language of the place, so the default is a style that keeps its names in a
 * layer of their own and draws them in Latin.
 *
 * Which of them a given host can actually reach is not a thing this file can
 * know, so `probe` asks all of them from wherever the archive is running and
 * /api/tiles/status reports the answer.
 */

const crypto = require('node:crypto');

const OSM_CREDIT = '&copy; <a href="https://www.openstreetmap.org/copyright" rel="noopener">'
  + 'OpenStreetMap</a> contributors';
const ESRI_CREDIT = 'Tiles &copy; <a href="https://www.esri.com" rel="noopener">Esri</a>';

const ARCGIS = 'https://services.arcgisonline.com/ArcGIS/rest/services/Canvas';

/**
 * `filter` is CSS, applied to the tiles in the browser. It is part of the
 * style rather than a fixed rule, because how a basemap has to be treated
 * depends entirely on which one it is: one drawn pale has to be turned dark,
 * one drawn dark must be left alone.
 *
 * `labels` is a second layer of place names, drawn over the first. Providers
 * that keep names separate do it so the two can be styled apart; the archive
 * fetches both and stacks them, so the map still says where things are.
 */
const STYLES = {
  /*
   * Esri's dark canvas: drawn dark rather than made dark, and asking for no
   * account. Names come from the companion layer. Whether it answers a given
   * host at all is what /api/tiles/status is for.
   */
  'esri-dark': {
    url: `${ARCGIS}/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}`,
    labels: `${ARCGIS}/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}`,
    attribution: `${ESRI_CREDIT}, ${OSM_CREDIT}`,
    maxZoom: 16,
    filter: 'saturate(0.9) brightness(1.05)',
  },

  /** The same, pale: Esri's light canvas, for a map that is not to be dark. */
  'esri-light': {
    url: `${ARCGIS}/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}`,
    labels: `${ARCGIS}/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}`,
    attribution: `${ESRI_CREDIT}, ${OSM_CREDIT}`,
    maxZoom: 16,
    filter: 'saturate(0.8) brightness(0.98)',
  },

  /*
   * OpenStreetMap's own tiles, turned dark on the way in rather than served
   * dark: inverted, and their hues turned back, so what survives is the
   * lightness. More detail and more names than the canvases, at the cost of
   * looking inverted, which it is.
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

  /*
   * The default, and what this archive showed before any of the rest:
   * OpenStreetMap exactly as it draws itself, untouched. Pale under a dark
   * page, but it is the map everyone already knows how to read, it carries
   * every name and street, and it is the one basemap that has never once
   * refused or asked for an account.
   */
  osm: {
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: OSM_CREDIT,
    maxZoom: 19,
    filter: 'none',
  },

  /*
   * The same map for a reader who is not reading Persian.
   *
   * OpenStreetMap letters a place in the language of the place, which is the
   * right answer nearly everywhere and the wrong one here: an English reader
   * turning on street view gets Tehran's streets named in Persian, which is
   * no more use to them than no names at all. Esri's canvas draws no names on
   * the ground itself and letters them in a second layer, in Latin — so this
   * is the one pair in the list that can say Valiasr Street.
   *
   * No treatment of its own, so the theme turns the ground and the names over
   * together on the dark side.
   */
  'esri-latin': {
    url: `${ARCGIS}/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}`,
    labels: `${ARCGIS}/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}`,
    attribution: `${ESRI_CREDIT}, ${OSM_CREDIT}`,
    maxZoom: 16,
    filter: 'none',
  },

  /*
   * The former default. CARTO now stamps "api key required" across tiles
   * fetched without an account, so this is only useful with one — set
   * TILE_URL to the keyed address rather than naming this style.
   */
  'carto-dark': {
    url: 'https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
    attribution: `${OSM_CREDIT} &copy; <a href="https://carto.com/attributions" rel="noopener">CARTO</a>`,
    maxZoom: 20,
    filter: 'saturate(0.75) brightness(0.82)',
  },
};

const DEFAULT_STYLE = 'osm';

/*
 * What an English reader is shown instead. TILE_STYLE_LATIN names another of
 * the styles above, or 'off' to leave every reader on the same imagery.
 */
const DEFAULT_LATIN = 'esri-latin';

/** A provider given only as a URL is assumed to be already the look intended. */
const CUSTOM = { attribution: OSM_CREDIT, maxZoom: 20, filter: 'saturate(0.8) brightness(0.92)' };

function setting(name) {
  return (process.env[name] || '').trim();
}

/**
 * The style in force: a named one, anything TILE_URL points at, or the default.
 * Read per call rather than frozen at load, so a restarted process and the
 * tests both see what the environment actually says.
 */
function style(variant) {
  if (variant === 'latin') return latinStyle();

  const named = STYLES[setting('TILE_STYLE')];
  const url = setting('TILE_URL');
  const base = named || (url ? CUSTOM : STYLES[DEFAULT_STYLE]);

  return {
    name: named ? setting('TILE_STYLE') : (url ? 'custom' : DEFAULT_STYLE),
    url: url || base.url,
    // A custom address is one layer; names would have to come with it.
    labels: url ? (setting('TILE_LABELS_URL') || null) : (base.labels || null),
    attribution: setting('TILE_ATTRIBUTION') || base.attribution,
    maxZoom: Number(setting('TILE_MAX_ZOOM') || base.maxZoom),
    filter: process.env.TILE_FILTER === undefined ? base.filter : process.env.TILE_FILTER,
  };
}

/**
 * The imagery for a reader who has asked for English, or null when there is
 * none to offer — which is what 'off' means, and what a style with no separate
 * name layer amounts to: its names are painted into the ground in whatever
 * language the ground was drawn in, and no setting here can change them.
 */
function latinStyle() {
  const asked = setting('TILE_STYLE_LATIN').toLowerCase();
  if (asked === 'off') return null;

  const name = STYLES[asked] ? asked : DEFAULT_LATIN;
  const base = STYLES[name];
  if (!base || !base.labels) return null;

  return {
    name,
    url: base.url,
    labels: base.labels,
    attribution: base.attribution,
    maxZoom: base.maxZoom,
    filter: base.filter,
  };
}

/**
 * A short name for exactly this imagery, which changes when the imagery does.
 *
 * Tiles are cached hard — a square of map is the same square forever, and
 * saying so is what spares the provider and the reader the second fetch. But
 * "forever" belongs to the square, not to the address: with a fixed address, a
 * change of provider reaches nobody who has already looked at the map, and the
 * old provider's tiles go on being shown for as long as the cache holds them.
 * A provider that has begun writing "api key required" across its tiles goes on
 * writing it. So the address carries this, and changing provider changes every
 * address at once.
 */
function token(variant) {
  const current = style(variant);
  if (!current) return null;
  const digest = crypto.createHash('sha1')
    .update(`${current.url}|${current.labels || ''}`)
    .digest('hex')
    .slice(0, 8);
  return `${current.name}-${digest}`;
}

/**
 * Which imagery an address is asking for. The token is the whole of the
 * answer: it is built from the provider's own address, so it cannot name a
 * provider the archive is not on. Anything unrecognised is served the ordinary
 * imagery rather than refused — a reader holding the page open across a
 * redeploy gets a map, not a grid of holes.
 */
function variantFor(asked) {
  return asked && asked === token('latin') ? 'latin' : undefined;
}

/** What the map needs to know about the imagery it is being handed. */
function config() {
  const { name, attribution, maxZoom, filter, labels } = style();
  const latin = style('latin');

  return {
    style: name,
    token: token(),
    attribution,
    maxZoom,
    filter,
    labels: Boolean(labels),
    // The second set, for a reader in English. Null when there is none, and
    // then the map simply keeps the first for everybody.
    latin: latin ? {
      style: latin.name,
      token: token('latin'),
      attribution: latin.attribution,
      maxZoom: latin.maxZoom,
      filter: latin.filter,
      labels: Boolean(latin.labels),
    } : null,
  };
}

/**
 * Builds the upstream address from numbers alone.
 *
 * Nothing a caller sends becomes part of the host or the path shape — only
 * three integers, each checked against the bounds of the zoom level they
 * claim, and a layer that must be one of two words. Without that this route
 * would be an open proxy: a way to make the archive fetch any address on
 * someone else's behalf.
 *
 * Placeholders are named, so a provider that orders them {z}/{y}/{x} — Esri
 * does — is a matter of its address and nothing more.
 */
function upstreamFor(z, x, y, retina, layer = 'base', variant) {
  const current = style(variant);
  if (!current) return null;
  const template = layer === 'labels' ? current.labels : current.url;
  if (!template) return null;

  if (!Number.isInteger(z) || !Number.isInteger(x) || !Number.isInteger(y)) return null;
  if (z < 0 || z > current.maxZoom) return null;

  const span = 2 ** z;
  if (x < 0 || x >= span || y < 0 || y >= span) return null;

  // A provider with no {r} in its address has no doubled tile to offer, and
  // the ordinary one is served instead: softer on a dense screen, never blank.
  return template
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

const AGENT = 'narrativemap (a public archive of first-hand narratives)';

/**
 * Fetches one tile. Returns { body, type } or null when the coordinates are
 * not real, and throws only when the provider fails.
 */
async function fetchTile(z, x, y, { retina = false, layer = 'base', variant } = {}) {
  // Keyed by the address rather than the coordinates, so a change of provider
  // cannot serve one map's squares inside another's, and so a doubled tile
  // that resolves to the ordinary one is stored once.
  const url = upstreamFor(z, x, y, retina, layer, variant);
  if (!url) return null;

  const hit = cache.get(url);
  if (hit) return hit;

  const response = await fetch(url, {
    headers: { 'User-Agent': AGENT },
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

/* ------------------------------ diagnosis -------------------------------- */

/**
 * Asks every provider for the same square and reports what came back.
 *
 * Whether a given tile server answers a given host is a fact about the network
 * between them, and no amount of reading this file reveals it: a provider open
 * from a laptop may be refused from a data centre, and a provider that worked
 * last month may now be answering with a demand for an account. This is how
 * that question gets an answer from where it matters — the machine actually
 * serving the archive.
 */
const PROBE_TILE = { z: 5, x: 20, y: 12 }; // A square over Iran, at a modest zoom.

function withoutSecrets(url) {
  // A keyed provider carries its key in the query. The address is worth
  // reporting; the key is not, and a diagnosis page is a public thing.
  try {
    const parsed = new URL(url);
    parsed.search = '';
    return parsed.toString();
  } catch {
    return url;
  }
}

function fill(template, { z, x, y }) {
  return template
    .replace('{z}', String(z)).replace('{x}', String(x))
    .replace('{y}', String(y)).replace('{r}', '');
}

async function ask(url) {
  const started = Date.now();
  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': AGENT },
      signal: AbortSignal.timeout(8000),
    });
    const body = await response.arrayBuffer();
    return {
      status: response.status,
      ok: response.ok,
      bytes: body.byteLength,
      type: response.headers.get('content-type') || null,
      ms: Date.now() - started,
      error: null,
    };
  } catch (error) {
    return {
      status: null, ok: false, bytes: 0, type: null, ms: Date.now() - started,
      error: String(error.message || error),
    };
  }
}

let probed = null;
async function probe({ cacheMs = 60000 } = {}) {
  if (probed && Date.now() - probed.at < cacheMs) return probed.result;

  const inUse = style();
  const candidates = Object.entries(STYLES).map(([name, s]) => ({ name, url: s.url }));
  if (inUse.name === 'custom') candidates.unshift({ name: 'custom', url: inUse.url });

  const results = await Promise.all(candidates.map(async ({ name, url }) => Object.assign(
    { style: name, url: withoutSecrets(fill(url, PROBE_TILE)), inUse: name === inUse.name },
    await ask(fill(url, PROBE_TILE)),
  )));

  probed = { at: Date.now(), result: results };
  return results;
}

module.exports = {
  variantFor,
  fetchTile, upstreamFor, config, style, token, probe,
  STYLES, DEFAULT_STYLE, MAX_TILES, cache, PROBE_TILE,
};
