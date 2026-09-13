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

  const STYLE = {
    // Without imagery beneath, the provinces are the map and carry a fill.
    province: { color: '#3a4454', weight: 0.8, fillColor: '#1b212b', fillOpacity: 1, opacity: 1 },
    provinceHover: { fillColor: '#232a36', color: '#4c586c', weight: 1.2 },
    border: { color: '#46536a', weight: 1.8, fill: false, opacity: 1 },
    // Over streets they become lines only, or the map underneath is lost. The
    // fill stays but at almost nothing, so a province is still hoverable.
    provinceOverTiles: {
      color: '#5d6b85', weight: 0.7, opacity: 0.55, fillColor: '#000', fillOpacity: 0.01,
    },
    provinceOverTilesHover: { fillColor: '#e0913f', fillOpacity: 0.07, color: '#8d9ab3', weight: 1.2 },
    borderOverTiles: { color: '#e0913f', weight: 1.6, fill: false, opacity: 0.75 },
  };

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
    const config = Object.assign({ interactiveProvinces: true, zoomControl: true, minZoom: 3.8 }, options);

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
    let tilesShowing = true;

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
     * The base imagery comes through the archive, never from the provider
     * directly — see src/tiles.js. Leaflet fills {r} with "@2x" on a
     * high-resolution screen, which the relay understands.
     */
    const tileLayer = L.tileLayer('/tiles/{z}/{x}/{y}{r}.png', {
      maxZoom: 18,
      detectRetina: true,
      // Kept faint: the map is the ground a narrative stands on, not the
      // subject. The pins and the border have to win.
      className: 'basemap-tiles',
      attribution: 'streets',
    }).addTo(map);
    tileLayer.bringToBack();

    // Over streets the provinces are a hint rather than a shape, and the
    // border is what tells a reader where they are.
    provinceLayer.setStyle(STYLE.provinceOverTiles);
    borderLayer.setStyle(STYLE.borderOverTiles);

    // What the provider requires, asked for rather than hardcoded so changing
    // provider stays a matter of one setting on the server.
    fetch('/api/tiles')
      .then((r) => r.json())
      .then(({ attribution }) => {
        map.attributionControl.removeAttribution('streets');
        if (attribution) map.attributionControl.addAttribution(attribution);
      })
      .catch(() => { /* the map still works uncredited */ });

    /** Kept for the callers that still offer the toggle. */
    function setTiles(enabled) {
      tilesShowing = enabled;
      if (enabled) {
        tileLayer.addTo(map);
        tileLayer.bringToBack();
        provinceLayer.setStyle(STYLE.provinceOverTiles);
        borderLayer.setStyle(STYLE.borderOverTiles);
      } else {
        map.removeLayer(tileLayer);
        provinceLayer.setStyle(STYLE.province);
        borderLayer.setStyle(STYLE.border);
      }
    }

    function fitIran(options) {
      map.fitBounds(IRAN_BOUNDS, Object.assign({ padding: [20, 20], animate: false }, options));
    }

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
