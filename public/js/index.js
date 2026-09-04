/* The public map: pins, filters, timeline, and the reading panel. */
(function () {
  'use strict';

  const { api, escapeHtml, paragraphs, dirFor, formatYears, formatPeriodPair,
          versionFor, toast, debounce } = window.NM;
  const { t, pick, province, digits } = window.I18N;

  const state = {
    narratives: [],
    questions: [],
    filtered: [],
    selectedId: null,
    yearBounds: { min: 1900, max: new Date().getFullYear() },
    filters: { search: '', province: '', from: null, to: null, sort: 'chronological' },
  };

  let mapApi = null;
  let markerLayer = null;
  const markersById = new Map();

  const $ = (id) => document.getElementById(id);
  const listEl = $('list');
  const readerEl = $('reader');
  const readerBody = $('reader-body');

  /* ------------------------------ filtering ------------------------------ */

  function startYear(n) { return Number(n.period.start.slice(0, 4)); }
  function endYear(n) { return Number(n.period.end.slice(0, 4)); }

  function searchableText(n) {
    if (!n._haystack) {
      n._haystack = [
        ...Object.values(n.answers),
        ...Object.values(n.answersTranslated || {}),
        n.place.name,
        n.place.nameTranslated || '',
        n.place.province || '',
        n.contributor || '',
      ].join(' \n ').toLowerCase();
    }
    return n._haystack;
  }

  function applyFilters() {
    const { search, province, from, to, sort } = state.filters;
    const needle = search.trim().toLowerCase();

    let result = state.narratives.filter((n) => {
      if (province && n.place.province !== province) return false;
      if (from !== null && endYear(n) < from) return false;
      if (to !== null && startYear(n) > to) return false;
      if (needle && !searchableText(n).includes(needle)) return false;
      return true;
    });

    const comparators = {
      chronological: (a, b) => a.period.start.localeCompare(b.period.start),
      reverse: (a, b) => b.period.start.localeCompare(a.period.start),
      recent: (a, b) => b.submittedAt.localeCompare(a.submittedAt),
      title: (a, b) => title(a).localeCompare(title(b)),
    };
    result = result.slice().sort(comparators[sort] || comparators.chronological);

    state.filtered = result;
    renderList();
    renderMarkers();
    renderCount();
    renderHistogram();
  }

  function hasActiveFilters() {
    const { search, province, from, to } = state.filters;
    if (search.trim() || province) return true;
    // Null bounds mean the timeline never appeared, so it cannot be narrowed.
    if (from === null || to === null) return false;
    return from !== state.yearBounds.min || to !== state.yearBounds.max;
  }

  /* ------------------------------ rendering ------------------------------ */

  /** The half of the narrative this reader should see. */
  function shown(n) {
    return versionFor(n);
  }

  /**
   * There is no title question — contributors are asked what happened, not to
   * name it — so a narrative is labelled by the place they chose.
   */
  function title(n) {
    return shown(n).placeName || n.place.name || t('reader.untitled');
  }

  function excerpt(n) {
    const answers = shown(n).answers;
    const source = answers.what_happened
      || Object.values(answers).find((v) => v && v.length > 60)
      || '';
    return source.replace(/\s+/g, ' ').slice(0, 220);
  }

  /** Option values stay the stored English name; only the label is translated. */
  function renderProvinceFilter() {
    const select = $('province-filter');
    const chosen = state.filters.province;
    const names = [...new Set(state.narratives.map((n) => n.place.province).filter(Boolean))]
      .sort((a, b) => province(a).localeCompare(province(b)));

    select.innerHTML = `<option value="">${escapeHtml(t('map.allProvinces'))}</option>`
      + names.map((p) => `<option value="${escapeHtml(p)}">${escapeHtml(province(p))}</option>`).join('');
    select.value = chosen;
  }

  function renderCount() {
    $('count').textContent = digits(state.filtered.length);
    const total = state.narratives.length;
    const shown = state.filtered.length;
    $('count-label').textContent = shown === total
      ? t(total === 1 ? 'map.count.one' : 'map.count.many')
      : t('map.count.ofTotal', { total });
    $('clear-filters').hidden = !hasActiveFilters();
  }

  function renderList() {
    if (!state.narratives.length) {
      listEl.innerHTML = `
        <li class="empty-state">
          <strong>${escapeHtml(t('map.empty.title'))}</strong>
          ${escapeHtml(t('map.empty.body'))}
          <p style="margin-top:14px"><a href="/submit">${escapeHtml(t('map.empty.cta'))}</a></p>
        </li>`;
      return;
    }
    if (!state.filtered.length) {
      listEl.innerHTML = `
        <li class="empty-state">
          <strong>${escapeHtml(t('map.noMatch.title'))}</strong>
          ${escapeHtml(t('map.noMatch.body'))}
        </li>`;
      return;
    }

    listEl.innerHTML = state.filtered.map((n) => `
      <li>
        <button class="card${n.id === state.selectedId ? ' is-active' : ''}" data-id="${escapeHtml(n.id)}">
          <span class="card__title" dir="${dirFor(title(n))}">${escapeHtml(title(n))}</span>
          <span class="card__meta">
            <span class="place">${escapeHtml(province(n.place.province) || '')}</span>
            <span>${escapeHtml(formatYears(n.period))}</span>
          </span>
          <span class="card__excerpt" dir="${dirFor(excerpt(n))}">${escapeHtml(excerpt(n))}</span>
        </button>
      </li>`).join('');
  }

  /* ------------------------------- markers ------------------------------- */

  /**
   * Groups pins that would overlap at the current zoom into one counted marker,
   * so a busy city does not turn into a pile of identical dots.
   */
  function groupForZoom(narratives, map) {
    const zoom = map.getZoom();
    const cell = 46;
    const groups = new Map();

    for (const n of narratives) {
      const point = map.project([n.place.lat, n.place.lng], zoom);
      const key = `${Math.floor(point.x / cell)}:${Math.floor(point.y / cell)}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(n);
    }
    return [...groups.values()];
  }

  function renderMarkers() {
    if (!mapApi) return;
    markerLayer.clearLayers();
    markersById.clear();

    for (const group of groupForZoom(state.filtered, mapApi.map)) {
      if (group.length === 1) {
        const n = group[0];
        const marker = window.NMMap.pin([n.place.lat, n.place.lng], {
          className: n.id === state.selectedId ? 'is-active' : '',
          title: title(n),
        });
        marker.bindTooltip(
          `<strong>${escapeHtml(title(n))}</strong><br>${escapeHtml(formatYears(n.period))} · ${escapeHtml(n.place.name)}`,
          { className: 'map-tip', direction: 'top', offset: [0, -8], opacity: 1 },
        );
        marker.on('click', () => select(n.id));
        marker.addTo(markerLayer);
        markersById.set(n.id, marker);
      } else {
        const lat = group.reduce((s, n) => s + n.place.lat, 0) / group.length;
        const lng = group.reduce((s, n) => s + n.place.lng, 0) / group.length;
        const marker = window.NMMap.pin([lat, lng], {
          className: 'pin--cluster',
          label: escapeHtml(digits(group.length)),
          size: [28, 22],
          anchor: [14, 11],
        });
        marker.bindTooltip(escapeHtml(t('map.cluster', { count: group.length })), {
          className: 'map-tip', direction: 'top', offset: [0, -12], opacity: 1,
        });
        marker.on('click', () => {
          const bounds = L.latLngBounds(group.map((n) => [n.place.lat, n.place.lng]));
          if (bounds.getNorthEast().equals(bounds.getSouthWest())) {
            // Same coordinates: zooming will never separate them, so list them.
            showStack(group);
          } else {
            mapApi.map.fitBounds(bounds, { padding: [80, 80], maxZoom: 15 });
          }
        });
        marker.addTo(markerLayer);
      }
    }
  }

  /** Several narratives pinned to the identical spot: pick from a tooltip list. */
  function showStack(group) {
    const html = group.map((n) => `
      <button class="btn btn--sm btn--block" data-stack-id="${escapeHtml(n.id)}"
              style="margin-bottom:4px;justify-content:flex-start">
        ${escapeHtml(title(n))}
      </button>`).join('');

    const popup = L.popup({ className: 'map-tip', closeButton: true, maxWidth: 280 })
      .setLatLng([group[0].place.lat, group[0].place.lng])
      .setContent(`<div style="min-width:200px">${html}</div>`)
      .openOn(mapApi.map);

    popup.getElement().addEventListener('click', (event) => {
      const button = event.target.closest('[data-stack-id]');
      if (!button) return;
      mapApi.map.closePopup(popup);
      select(button.dataset.stackId);
    });
  }

  /* ------------------------------- timeline ------------------------------ */

  function computeYearBounds() {
    if (!state.narratives.length) return;
    let min = Infinity;
    let max = -Infinity;
    for (const n of state.narratives) {
      min = Math.min(min, startYear(n));
      max = Math.max(max, endYear(n));
    }
    // A little breathing room so the end handles are not flush against the edge.
    state.yearBounds = { min, max: Math.max(max, min + 1) };
  }

  function setupTimeline() {
    if (state.narratives.length < 2) return;
    const { min, max } = state.yearBounds;
    const from = $('year-from');
    const to = $('year-to');

    for (const input of [from, to]) {
      input.min = String(min);
      input.max = String(max);
      input.step = '1';
    }
    from.value = String(min);
    to.value = String(max);
    state.filters.from = min;
    state.filters.to = max;

    $('scale-min').textContent = digits(min);
    $('scale-max').textContent = digits(max);
    $('timeline').hidden = false;

    const onInput = () => {
      let a = Number(from.value);
      let b = Number(to.value);
      if (a > b) {
        // Keep the handles from crossing over each other.
        if (document.activeElement === from) { b = a; to.value = String(b); }
        else { a = b; from.value = String(a); }
      }
      state.filters.from = a;
      state.filters.to = b;
      renderTimelineValue();
      applyFilters();
    };

    from.addEventListener('input', onInput);
    to.addEventListener('input', onInput);

    $('timeline-reset').addEventListener('click', () => {
      from.value = String(min);
      to.value = String(max);
      state.filters.from = min;
      state.filters.to = max;
      renderTimelineValue();
      applyFilters();
    });

    renderTimelineValue();
  }

  function renderTimelineValue() {
    const { from, to } = state.filters;
    $('timeline-value').textContent = from === to ? digits(from) : digits(`${from} – ${to}`);

    const { min, max } = state.yearBounds;
    const span = Math.max(max - min, 1);
    const left = ((from - min) / span) * 100;
    const right = ((to - min) / span) * 100;
    const fill = $('range-fill');
    fill.style.left = `${left}%`;
    fill.style.width = `${Math.max(right - left, 0)}%`;
  }

  const HISTOGRAM_BUCKETS = 44;

  function renderHistogram() {
    const host = $('histogram');
    if ($('timeline').hidden) return;

    const { min, max } = state.yearBounds;
    const span = Math.max(max - min + 1, 1);
    const buckets = Math.min(HISTOGRAM_BUCKETS, span);
    const perBucket = span / buckets;
    const counts = new Array(buckets).fill(0);

    for (const n of state.narratives) {
      const first = Math.floor((startYear(n) - min) / perBucket);
      const last = Math.floor((endYear(n) - min) / perBucket);
      for (let i = Math.max(first, 0); i <= Math.min(last, buckets - 1); i++) counts[i] += 1;
    }

    const peak = Math.max(...counts, 1);
    host.innerHTML = counts.map((count, i) => {
      const bucketStart = min + Math.floor(i * perBucket);
      const bucketEnd = min + Math.floor((i + 1) * perBucket) - 1;
      const inside = bucketEnd >= state.filters.from && bucketStart <= state.filters.to;
      const height = count ? Math.max(3, Math.round((count / peak) * 30)) : 2;
      return `<div class="timeline__bar${inside ? ' is-inside' : ''}" style="height:${height}px"
                title="${bucketStart}${bucketEnd > bucketStart ? `–${bucketEnd}` : ''}: ${count}"></div>`;
    }).join('');
  }

  /* -------------------------------- reader ------------------------------- */

  function questionLabel(id) {
    const question = state.questions.find((q) => q.id === id);
    return question ? pick(question.label) : id;
  }

  /** Choice answers store stable codes; label them in the reader's language. */
  function choiceLabels(question, value) {
    const codes = Array.isArray(value) ? value : [value];
    return codes.map((code) => {
      const option = (question.options || []).find((o) => o.value === code);
      return option ? pick(option) : code;
    });
  }

  function renderReader(n) {
    const when = formatPeriodPair(n.period);
    const coords = `${n.place.lat.toFixed(4)}, ${n.place.lng.toFixed(4)}`;

    const version = shown(n);
    const answers = state.questions
      .filter((q) => q.id !== 'title')
      .map((q) => {
        const isChoice = q.type === 'select' || q.type === 'multiselect';
        // Choice answers are stored as codes and render in either language, so
        // they come from the original whichever version is being read.
        const raw = isChoice ? n.answers[q.id] : version.answers[q.id];
        if (!raw || (Array.isArray(raw) && !raw.length)) return '';
        if (isChoice) {
          const chips = choiceLabels(q, raw)
            .map((label) => `<span class="chip">${escapeHtml(label)}</span>`).join('');
          return `
            <section class="qa">
              <h3 class="qa__q">${escapeHtml(questionLabel(q.id))}</h3>
              <div class="chips">${chips}</div>
            </section>`;
        }
        return `
          <section class="qa">
            <h3 class="qa__q">${escapeHtml(questionLabel(q.id))}</h3>
            <div class="qa__a" dir="${dirFor(raw)}">${paragraphs(raw)}</div>
          </section>`;
      }).join('');

    readerBody.innerHTML = `
      <h1 class="reader__title" dir="${dirFor(title(n))}">${escapeHtml(title(n))}</h1>
      ${version.note ? `
        <p class="provenance${version.untranslated ? ' provenance--untranslated' : ''}"
           title="${escapeHtml(version.noteDetail || '')}">
          ${escapeHtml(version.note)}
        </p>` : ''}
      <dl class="reader__facts">
        <dt>${escapeHtml(t('reader.place'))}</dt>
        <dd>
          ${n.place.province ? escapeHtml(province(n.place.province)) : escapeHtml(version.placeName)}
          <div class="secondary" dir="ltr">${escapeHtml(digits(coords))}</div>
        </dd>
        <dt>${escapeHtml(t('reader.when'))}</dt>
        <dd>
          ${escapeHtml(when.primary)}
          ${when.secondary ? `<div class="secondary">${escapeHtml(when.secondary)} ${escapeHtml(when.secondaryLabel)}</div>` : ''}
        </dd>
        <dt>${escapeHtml(t('reader.toldBy'))}</dt>
        <dd>${escapeHtml(n.contributor || t('reader.anonymous'))}</dd>
      </dl>
      ${answers}`;

    readerEl.classList.add('is-open');
    readerEl.setAttribute('aria-hidden', 'false');
    readerBody.scrollTop = 0;
    readerEl.focus({ preventScroll: true });
  }

  /**
   * The reading panel covers the right of the map pane, so centring on the pin
   * would hide it. This shifts the centre right by half the panel width, which
   * leaves the pin in the strip that is still visible.
   */
  function centreBesideReader(latlng, zoom) {
    const paneWidth = mapApi.map.getSize().x;
    const panelWidth = readerEl.offsetWidth;
    if (paneWidth < panelWidth + 160) return latlng;
    const shifted = mapApi.map.project(latlng, zoom).add([panelWidth / 2, 0]);
    return mapApi.map.unproject(shifted, zoom);
  }

  function select(id) {
    const n = state.narratives.find((item) => item.id === id);
    if (!n) return;

    state.selectedId = id;
    renderReader(n);
    renderList();
    renderMarkers();

    const marker = markersById.get(id);
    const zoom = Math.max(mapApi.map.getZoom(), 8);
    mapApi.map.flyTo(centreBesideReader([n.place.lat, n.place.lng], zoom), zoom, { duration: 0.6 });
    if (marker) marker.setZIndexOffset(1000);

    const url = new URL(location.href);
    url.searchParams.set('n', id);
    history.replaceState(null, '', url);

    const card = listEl.querySelector(`[data-id="${CSS.escape(id)}"]`);
    if (card) card.scrollIntoView({ block: 'nearest' });
  }

  function closeReader() {
    state.selectedId = null;
    readerEl.classList.remove('is-open');
    readerEl.setAttribute('aria-hidden', 'true');
    renderList();
    renderMarkers();
    const url = new URL(location.href);
    url.searchParams.delete('n');
    history.replaceState(null, '', url);
  }

  /* --------------------------------- wiring ------------------------------ */

  function wireControls() {
    $('search').addEventListener('input', debounce((event) => {
      state.filters.search = event.target.value;
      applyFilters();
    }, 180));

    $('province-filter').addEventListener('change', (event) => {
      state.filters.province = event.target.value;
      applyFilters();
    });

    $('sort').addEventListener('change', (event) => {
      state.filters.sort = event.target.value;
      applyFilters();
    });

    $('clear-filters').addEventListener('click', () => {
      state.filters.search = '';
      state.filters.province = '';
      state.filters.from = state.yearBounds.min;
      state.filters.to = state.yearBounds.max;
      $('search').value = '';
      $('province-filter').value = '';
      const from = $('year-from');
      const to = $('year-to');
      if (from) { from.value = String(state.yearBounds.min); to.value = String(state.yearBounds.max); }
      renderTimelineValue();
      applyFilters();
    });

    listEl.addEventListener('click', (event) => {
      const card = event.target.closest('.card');
      if (card) select(card.dataset.id);
    });

    $('reader-close').addEventListener('click', closeReader);

    $('reader-link').addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(location.href);
        toast(t('reader.copied'));
      } catch {
        toast(t('reader.copyFailed'), 'error');
      }
    });

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && state.selectedId) closeReader();
    });

    $('tiles-toggle').addEventListener('change', (event) => {
      mapApi.setTiles(event.target.checked);
    });
  }

  /* --------------------------------- boot -------------------------------- */

  async function boot() {
    mapApi = await window.NMMap.create('map', { interactiveProvinces: true });
    // Leave room at the bottom so southern Iran is not hidden by the timeline.
    markerLayer = L.layerGroup().addTo(mapApi.map);
    mapApi.map.on('zoomend', renderMarkers);

    const [meta, data] = await Promise.all([
      api('/api/questions'),
      api('/api/narratives'),
    ]);

    state.questions = meta.questions;
    state.narratives = data.narratives;

    renderProvinceFilter();

    computeYearBounds();
    setupTimeline();
    // Reserve room at the bottom only when the timeline is actually on screen,
    // otherwise the country floats above a strip of nothing.
    const timelineShown = !document.getElementById('timeline').hidden;
    mapApi.fitIran({
      paddingTopLeft: [24, 24],
      paddingBottomRight: [24, timelineShown ? 128 : 24],
    });
    wireControls();
    applyFilters();

    window.I18N.onChange(() => {
      renderTimelineValue();
      const from = $('year-from');
      if (from) {
        $('scale-min').textContent = digits(state.yearBounds.min);
        $('scale-max').textContent = digits(state.yearBounds.max);
      }
      renderProvinceFilter();
      renderList();
      renderCount();
      renderMarkers();
      const open = state.selectedId && state.narratives.find((n) => n.id === state.selectedId);
      if (open) renderReader(open);
    });

    const deepLink = new URLSearchParams(location.search).get('n');
    if (deepLink) select(deepLink);
  }

  boot().catch((error) => {
    console.error(error);
    toast(error.message || t('map.loadFailed'), 'error');
  });
}());
