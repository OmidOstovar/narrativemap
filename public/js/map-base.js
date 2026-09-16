/**
 * The base map. Iran is drawn from the bundled boundary file rather than from
 * raster tiles, so the map works with no third-party requests at all. Street
 * tiles stay available behind a toggle for anyone who needs street-level
 * context when placing a pin.
 */
(function (global) {
  'use strict';

  const IRAN_CENTER = [32.55, 53.9];
  const IRAN_BOUNDS = L.latLngBounds([24.0, 43.5], [40.2, 63.8]);

  /**
   * The drawn map's colours, taken from the stylesheet rather than repeated
   * here — the palette is one thing, and a map that disagreed with the page it
   * sits on is how a theme quietly comes apart.
   */
  function paint(name, fallback) {
    const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return value || fallback;
  }

  function styles() {
    return {
      // Without imagery beneath, the provinces are the map and carry a fill.
      province: {
        color: paint('--border-line', '#3a4454'),
        weight: 0.8,
        fillColor: paint('--land', '#1b212b'),
        fillOpacity: 1,
        opacity: 1,
      },
      provinceHover: {
        fillColor: paint('--land-hover', '#232a36'),
        color: paint('--coast', '#46536a'),
        weight: 1.2,
      },
      border: { color: paint('--coast', '#46536a'), weight: 1.8, fill: false, opacity: 1 },
      // Over streets they become lines only, or the map underneath is lost. The
      // fill stays but at almost nothing, so a province is still hoverable.
      provinceOverTiles: {
        color: paint('--coast', '#46536a'),
        weight: 0.7,
        opacity: 0.6,
        fillColor: paint('--text', '#e9e5dd'),
        fillOpacity: 0.01,
      },
      provinceOverTilesHover: {
        fillColor: paint('--saffron', '#e0913f'),
        fillOpacity: 0.09,
        color: paint('--text-faint', '#6f6d69'),
        weight: 1.2,
      },
      borderOverTiles: {
        color: paint('--saffron', '#e0913f'), weight: 1.6, fill: false, opacity: 0.85,
      },
    };
  }

  const STYLE = styles();

  let geoPromise = null;
  function loadGeo() {
    if (!geoPromise) {
      geoPromise = fetch('/data/iran.geo.json').then((r) => {
        if (!r.ok) throw new Error('Could not load the map of Iran.');
        return r.json();
      });
    }
    return geoPromise;
  }

  /**
   * @param {string} elementId
   * @param {{interactiveProvinces?: boolean, zoomControl?: boolean, minZoom?: number}} options
   */
  async function create(elementId, options) {
    /*
     * The floor is low enough that the whole country still fits a short,
     * wide pane — on a phone the map is a quarter of the screen, and a floor
     * set for a desktop would clamp before Iran was all on it. Panning is
     * held by maxBounds rather than by how far out one may zoom.
     */
    const config = Object.assign({ interactiveProvinces: true, zoomControl: true, minZoom: 2.6 }, options);

    const map = L.map(elementId, {
      center: IRAN_CENTER,
      zoom: 5,
      minZoom: config.minZoom,
      maxZoom: 17,
      zoomControl: config.zoomControl,
      attributionControl: true,
      maxBounds: IRAN_BOUNDS.pad(0.35),
      maxBoundsViscosity: 0.7,
      zoomSnap: 0.25,
      wheelPxPerZoomLevel: 110,
      worldCopyJump: false,
    });

    map.attributionControl.setPrefix('');

    const geo = await loadGeo();
    const border = geo.features.find((f) => f.properties.name === 'Iran');
    const provinceFeatures = geo.features.filter((f) => f !== border);

    const baseLayer = L.layerGroup().addTo(map);
    // Which base is in front, so hovering a province matches what is drawn.
    // The drawn map is what is there until imagery arrives, if it ever does.
    let tilesShowing = false;

    const provinceLayer = L.geoJSON(
      { type: 'FeatureCollection', features: provinceFeatures },
      {
        style: () => STYLE.province,
        interactive: config.interactiveProvinces,
        onEachFeature: (feature, layer) => {
          if (!config.interactiveProvinces) return;
          const label = () => (global.I18N ? global.I18N.province(feature.properties.name)
            : feature.properties.name);
          layer.bindTooltip(label(), {
            className: 'map-tip', sticky: true, direction: 'top', opacity: 1,
          });
          // Province tooltips are built once, so refresh them on a switch.
          if (global.I18N) global.I18N.onChange(() => layer.setTooltipContent(label()));
          layer.on('mouseover', () => layer.setStyle(
            tilesShowing ? STYLE.provinceOverTilesHover : STYLE.provinceHover,
          ));
          layer.on('mouseout', () => layer.setStyle(
            tilesShowing ? STYLE.provinceOverTiles : STYLE.province,
          ));
        },
      },
    ).addTo(baseLayer);

    const borderLayer = L.geoJSON(border, { style: STYLE.border, interactive: false }).addTo(baseLayer);

    map.attributionControl.addAttribution(
      'Boundaries <a href="https://www.geoboundaries.org" rel="noopener">geoBoundaries</a> CC BY 4.0',
    );

    /*
     * Street view is context for Iran, not a map of the region. Left to itself
     * the imagery covers the whole pane, and the neighbours' roads bury the
     * ground the archive is laid on. So the tiles are clipped to the country,
     * cut from the same boundary the map is drawn from: inside the border the
     * streets, outside it the binding.
     *
     * The path is in layer coordinates, which is the space the tile pane is
     * positioned in — panning moves the pane and the clip together, so it only
     * has to be rebuilt when the origin does, on a zoom or a reset. A browser
     * that will not follow the reference simply shows the imagery whole, which
     * is where this started.
     */
    const clipId = `nm-iran-clip-${elementId}`;
    let clipShape = null;

    function clipTilesToIran() {
      if (!clipShape) {
        const ns = 'http://www.w3.org/2000/svg';
        const svg = document.createElementNS(ns, 'svg');
        svg.setAttribute('width', '0');
        svg.setAttribute('height', '0');
        svg.setAttribute('aria-hidden', 'true');
        svg.style.position = 'absolute';
        const clip = document.createElementNS(ns, 'clipPath');
        clip.setAttribute('id', clipId);
        clip.setAttribute('clipPathUnits', 'userSpaceOnUse');
        clipShape = document.createElementNS(ns, 'path');
        // Even-odd, so the islands and any hole in the outline come out right
        // whichever way their ring happens to be wound.
        clipShape.setAttribute('clip-rule', 'evenodd');
        clip.appendChild(clipShape);
        svg.appendChild(clip);
        map.getContainer().appendChild(svg);
        map.getPane('tilePane').style.clipPath = `url(#${clipId})`;
      }

      const geometry = border.geometry;
      const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
      let d = '';
      polygons.forEach((polygon) => polygon.forEach((ring) => {
        ring.forEach((position, i) => {
          const point = map.latLngToLayerPoint([position[1], position[0]]);
          d += `${i ? 'L' : 'M'}${point.x.toFixed(1)} ${point.y.toFixed(1)}`;
        });
        d += 'Z';
      }));
      clipShape.setAttribute('d', d);
    }

    map.on('viewreset zoomend', () => { if (clipShape) clipTilesToIran(); });

    /*
     * The base imagery comes through the archive, never from the provider
     * directly — see src/tiles.js.
     *
     * Nothing is fetched until the server has said which provider it is on,
     * because the provider is part of the address: tiles are cached for a week
     * and a fixed address would go on showing the previous provider's squares
     * long after the archive had left it.
     */
    let tileLayer = null;
    let labelLayer = null;
    // What the streets toggle says, whether or not it can be obeyed. The
    // archive opens on its own drawn map: the streets are there for placing a
    // pin, not for reading, and a reader should meet the country first.
    let wanted = false;

    /*
     * Over streets the provinces are a hint rather than a shape, and the
     * border is what tells a reader where they are. Without streets they are
     * the map, and carry a fill. Until the imagery arrives, and if it never
     * does, the drawn map is what stands — never an empty dark rectangle.
     */
    function paintFor(streets) {
      tilesShowing = streets;
      provinceLayer.setStyle(streets ? STYLE.provinceOverTiles : STYLE.province);
      borderLayer.setStyle(streets ? STYLE.borderOverTiles : STYLE.border);
    }

    /** A provider that answers nothing is worse than no provider at all. */
    function giveUpOnTiles() {
      if (tileLayer) map.removeLayer(tileLayer);
      if (labelLayer) map.removeLayer(labelLayer);
      tileLayer = null;
      labelLayer = null;
      paintFor(false);
    }

    function layer(path, className, maxNativeZoom) {
      return L.tileLayer(path, {
        maxZoom: 19,
        maxNativeZoom: maxNativeZoom || undefined,
        // Kept faint: the map is the ground a narrative stands on, not the
        // subject. The pins and the border have to win.
        className: className,
        pane: 'tilePane',
      });
    }

    function build({ token, filter, maxZoom, labels }) {
      if (!token) return;

      tileLayer = layer(`/tiles/${token}/base/{z}/{x}/{y}{r}.png`, 'basemap-tiles', maxZoom);

      // A refusal from the provider is silent otherwise: Leaflet leaves the
      // squares blank and the reader sees a void where the country was.
      let arrived = false;
      let refused = 0;
      tileLayer.on('tileload', () => { arrived = true; });
      tileLayer.on('tileerror', () => {
        refused += 1;
        if (!arrived && refused >= 4) giveUpOnTiles();
      });

      // Names, where the provider draws them apart from the ground.
      if (labels) labelLayer = layer(`/tiles/${token}/labels/{z}/{x}/{y}{r}.png`, 'basemap-labels', maxZoom);

      // A provider with no treatment of its own leaves it to the theme: a
      // street map drawn for paper has to be turned over on the dark one.
      if (typeof filter === 'string' && filter && filter !== 'none') {
        document.documentElement.style.setProperty('--basemap-filter', filter);
      } else {
        document.documentElement.style.removeProperty('--basemap-filter');
      }
      if (wanted) showTiles();
    }

    function showTiles() {
      if (!tileLayer) return;
      clipTilesToIran();
      tileLayer.addTo(map);
      tileLayer.bringToBack();
      if (labelLayer) labelLayer.addTo(map);
      paintFor(true);
    }

    fetch('/api/tiles')
      .then((r) => r.json())
      .then((imagery) => {
        if (imagery.attribution) map.attributionControl.addAttribution(imagery.attribution);
        build(imagery);
      })
      .catch(() => { /* No answer, no imagery: the drawn map is already on screen. */ });

    /** Kept for the callers that still offer the toggle. */
    function setTiles(enabled) {
      wanted = enabled;
      if (enabled) {
        showTiles();
        return;
      }
      if (tileLayer) map.removeLayer(tileLayer);
      if (labelLayer) map.removeLayer(labelLayer);
      paintFor(false);
    }

    function fitIran(options) {
      // A short pane is mostly margin once the country is in it, so the frame
      // around it narrows as the room does.
      const pad = map.getSize().y < 320 ? 6 : 20;
      map.fitBounds(IRAN_BOUNDS, Object.assign({ padding: [pad, pad], animate: false }, options));
    }

    /*
     * The drawn map takes its colours from the stylesheet, which means they are
     * read once — so when the theme changes, they have to be read again or the
     * country stays in the palette it was drawn in.
     */
    function repaint() {
      Object.assign(STYLE, styles());
      paintFor(tilesShowing);
    }
    if (global.THEME && global.THEME.onChange) global.THEME.onChange(repaint);

    fitIran();

    return { map, setTiles, fitIran };
  }

  /* --------------------------- point lookups ---------------------------- */

  function inRing(x, y, ring) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const xi = ring[i][0];
      const yi = ring[i][1];
      const xj = ring[j][0];
      const yj = ring[j][1];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }

  function inFeature(lat, lng, feature) {
    const { type, coordinates } = feature.geometry;
    const polygons = type === 'Polygon' ? [coordinates] : coordinates;
    return polygons.some((polygon) => (
      inRing(lng, lat, polygon[0]) && polygon.slice(1).every((hole) => !inRing(lng, lat, hole))
    ));
  }

  /**
   * Mirrors the server-side check so the submission form can warn about a
   * misplaced pin before anyone fills in the questionnaire. The server stays
   * the authority; this is only for immediate feedback.
   */
  async function locate(lat, lng) {
    const geo = await loadGeo();
    const border = geo.features.find((f) => f.properties.name === 'Iran');
    const provinces = geo.features.filter((f) => f !== border);

    const tolerance = 0.05;
    const inside = inFeature(lat, lng, border)
      || [[tolerance, 0], [-tolerance, 0], [0, tolerance], [0, -tolerance]]
        .some(([dx, dy]) => inFeature(lat + dy, lng + dx, border));

    const province = provinces.find((f) => inFeature(lat, lng, f));
    return { inside, province: province ? province.properties.name : null };
  }

  /** Small circular marker used for narratives and for the submission pin. */
  function pin(latlng, options) {
    const config = options || {};
    return L.marker(latlng, {
      icon: L.divIcon({
        className: '',
        html: `<div class="pin${config.className ? ` ${config.className}` : ''}">${config.label || ''}</div>`,
        iconSize: config.size || [15, 15],
        iconAnchor: config.anchor || [7.5, 7.5],
      }),
      keyboard: config.keyboard !== false,
      draggable: !!config.draggable,
      title: config.title || '',
      riseOnHover: true,
    });
  }

  global.NMMap = { create, pin, locate, IRAN_CENTER, IRAN_BOUNDS };
}(window));
