/* The submission form: place picker, period widget, questionnaire. */
(function () {
  'use strict';

  const { api, escapeHtml, toast, debounce, gregorianPoint, jalaliPoint } = window.NM;

  const state = {
    questions: [],
    yearRange: { min: 1800, max: new Date().getFullYear() },
    place: { lat: null, lng: null, province: null },
    precision: 'year',
  };

  let pickerApi = null;
  let pinMarker = null;

  const $ = (id) => document.getElementById(id);

  /* ----------------------------- questionnaire --------------------------- */

  function renderQuestions() {
    $('questions').innerHTML = state.questions.map((question, index) => {
      const id = `q-${question.id}`;
      const optional = question.required
        ? ''
        : '<span class="field__optional">optional</span>';
      const help = question.help
        ? `<p class="field__help">${escapeHtml(question.help)}</p>`
        : '';

      let control;
      if (question.type === 'textarea') {
        control = `<textarea id="${id}" name="${escapeHtml(question.id)}" rows="${question.rows || 5}"
                     maxlength="${question.maxLength || 5000}"
                     ${question.placeholder ? `placeholder="${escapeHtml(question.placeholder)}"` : ''}></textarea>`;
      } else if (question.type === 'select') {
        const options = ['<option value="">Choose one…</option>']
          .concat(question.options.map((o) => `<option value="${escapeHtml(o)}">${escapeHtml(o)}</option>`));
        control = `<select id="${id}" name="${escapeHtml(question.id)}">${options.join('')}</select>`;
      } else {
        control = `<input type="text" id="${id}" name="${escapeHtml(question.id)}"
                     maxlength="${question.maxLength || 200}"
                     ${question.placeholder ? `placeholder="${escapeHtml(question.placeholder)}"` : ''}>`;
      }

      const counter = question.maxLength && question.type !== 'select'
        ? `<div class="counter" data-counter-for="${escapeHtml(question.id)}"></div>`
        : '';

      return `
        <div class="field" data-field="${escapeHtml(question.id)}">
          <label class="field__label" for="${id}">
            <span class="field__number">${String(index + 1).padStart(2, '0')}</span>${escapeHtml(question.label)}${optional}
          </label>
          ${help}
          ${control}
          ${counter}
          <p class="field__error" data-error-for="${escapeHtml(question.id)}"></p>
        </div>`;
    }).join('');

    $('questions').addEventListener('input', (event) => {
      updateCounter(event.target);
      updateProgress();
    });
    $('questions').addEventListener('change', updateProgress);
  }

  function updateCounter(input) {
    const name = input.name;
    const counter = document.querySelector(`[data-counter-for="${CSS.escape(name || '')}"]`);
    if (!counter) return;
    const question = state.questions.find((q) => q.id === name);
    if (!question || !question.maxLength) return;

    const length = input.value.length;
    counter.textContent = `${length.toLocaleString()} / ${question.maxLength.toLocaleString()}`;
    counter.classList.toggle('is-over', length > question.maxLength);
    counter.classList.toggle('is-close', length > question.maxLength * 0.9 && length <= question.maxLength);

    if (question.minLength && length > 0 && length < question.minLength) {
      counter.textContent = `${length} / at least ${question.minLength}`;
      counter.classList.add('is-close');
    }
  }

  function collectAnswers() {
    const answers = {};
    for (const question of state.questions) {
      const input = $(`q-${question.id}`);
      if (input) answers[question.id] = input.value;
    }
    return answers;
  }

  /* ------------------------------ the period ----------------------------- */

  function lastDayOfMonth(year, month) {
    return new Date(Date.UTC(year, month, 0)).getUTCDate();
  }

  function renderPeriodInputs() {
    const host = $('period-inputs');
    const previous = readPeriod();
    const startYear = previous ? previous.start.slice(0, 4) : '';
    const endYear = previous ? previous.end.slice(0, 4) : '';
    const startMonth = previous ? previous.start.slice(0, 7) : '';
    const endMonth = previous ? previous.end.slice(0, 7) : '';

    if (state.precision === 'year') {
      host.innerHTML = `
        <div class="field" style="margin-bottom:0">
          <label class="field__label" for="period-start">From year</label>
          <input type="number" id="period-start" inputmode="numeric"
                 min="${state.yearRange.min}" max="${state.yearRange.max}"
                 placeholder="${state.yearRange.min}" value="${escapeHtml(startYear)}">
        </div>
        <div class="field" style="margin-bottom:0">
          <label class="field__label" for="period-end">To year</label>
          <input type="number" id="period-end" inputmode="numeric"
                 min="${state.yearRange.min}" max="${state.yearRange.max}"
                 placeholder="${state.yearRange.max}" value="${escapeHtml(endYear)}">
        </div>`;
    } else if (state.precision === 'month') {
      host.innerHTML = `
        <div class="field" style="margin-bottom:0">
          <label class="field__label" for="period-start">From month</label>
          <input type="month" id="period-start" value="${escapeHtml(startMonth)}"
                 min="${state.yearRange.min}-01" max="${state.yearRange.max}-12">
        </div>
        <div class="field" style="margin-bottom:0">
          <label class="field__label" for="period-end">To month</label>
          <input type="month" id="period-end" value="${escapeHtml(endMonth)}"
                 min="${state.yearRange.min}-01" max="${state.yearRange.max}-12">
        </div>`;
    } else {
      host.innerHTML = `
        <div class="field" style="margin-bottom:0">
          <label class="field__label" for="period-start">First day</label>
          <input type="date" id="period-start" value="${previous ? escapeHtml(previous.start) : ''}"
                 min="${state.yearRange.min}-01-01" max="${state.yearRange.max}-12-31">
        </div>
        <div class="field" style="margin-bottom:0">
          <label class="field__label" for="period-end">Last day</label>
          <input type="date" id="period-end" value="${previous ? escapeHtml(previous.end) : ''}"
                 min="${state.yearRange.min}-01-01" max="${state.yearRange.max}-12-31">
        </div>`;
    }

    for (const input of host.querySelectorAll('input')) {
      input.addEventListener('input', () => { renderPeriodEcho(); updateProgress(); });
      input.addEventListener('change', () => { renderPeriodEcho(); updateProgress(); });
    }
    renderPeriodEcho();
  }

  /** Expands the widget's values into the ISO start/end the API expects. */
  function readPeriod() {
    const startInput = $('period-start');
    const endInput = $('period-end');
    if (!startInput || !endInput) return null;

    const rawStart = startInput.value.trim();
    const rawEnd = endInput.value.trim();
    if (!rawStart || !rawEnd) return null;

    if (state.precision === 'year') {
      const a = Number(rawStart);
      const b = Number(rawEnd);
      if (!Number.isInteger(a) || !Number.isInteger(b)) return null;
      return { start: `${String(a).padStart(4, '0')}-01-01`, end: `${String(b).padStart(4, '0')}-12-31`, precision: 'year' };
    }
    if (state.precision === 'month') {
      const [ey, em] = rawEnd.split('-').map(Number);
      if (!ey || !em) return null;
      return { start: `${rawStart}-01`, end: `${rawEnd}-${String(lastDayOfMonth(ey, em)).padStart(2, '0')}`, precision: 'month' };
    }
    return { start: rawStart, end: rawEnd, precision: 'day' };
  }

  function renderPeriodEcho() {
    const period = readPeriod();
    const echo = $('period-echo');
    if (!period) { echo.textContent = ''; return; }

    const a = gregorianPoint(period.start, period.precision);
    const b = gregorianPoint(period.end, period.precision);
    const ja = jalaliPoint(period.start, period.precision);
    const jb = jalaliPoint(period.end, period.precision);

    const gregorian = a === b ? a : `${a} – ${b}`;
    const jalali = ja && jb ? (ja === jb ? ja : `${ja} – ${jb}`) : null;
    echo.textContent = jalali
      ? `${gregorian}  ·  ${jalali} in the Solar Hijri calendar`
      : gregorian;
  }

  /* ----------------------------- place picker ---------------------------- */

  async function setPin(lat, lng, options) {
    const config = options || {};
    state.place.lat = lat;
    state.place.lng = lng;

    if (!pinMarker) {
      pinMarker = window.NMMap.pin([lat, lng], { className: 'pin--picker', draggable: true, size: [17, 17], anchor: [8.5, 8.5] });
      pinMarker.addTo(pickerApi.map);
      pinMarker.on('dragend', () => {
        const position = pinMarker.getLatLng();
        setPin(position.lat, position.lng, { keepView: true });
      });
    } else {
      pinMarker.setLatLng([lat, lng]);
    }

    $('picker-hint').hidden = true;

    if (!config.keepView) {
      pickerApi.map.setView([lat, lng], Math.max(pickerApi.map.getZoom(), config.zoom || 10));
    }

    const { inside, province } = await window.NMMap.locate(lat, lng);
    state.place.province = province;

    $('readout-coords').textContent = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
    $('readout-coords').classList.remove('unset');
    $('readout-province').textContent = province || (inside ? 'inside Iran' : 'outside Iran');
    $('readout-province').classList.toggle('unset', !province && !inside);

    const pointError = document.querySelector('[data-error-for="place.point"]');
    if (!inside) {
      pointError.textContent = 'That point is outside Iran. This map only carries narratives placed inside the country.';
      pointError.style.display = 'block';
    } else {
      pointError.style.display = 'none';
    }

    updateProgress();
  }

  async function searchPlaces(query) {
    const results = $('place-results');
    if (query.trim().length < 3) { results.innerHTML = ''; return; }

    const url = new URL('https://nominatim.openstreetmap.org/search');
    url.searchParams.set('format', 'jsonv2');
    url.searchParams.set('countrycodes', 'ir');
    url.searchParams.set('limit', '6');
    url.searchParams.set('accept-language', 'en');
    url.searchParams.set('q', query);

    try {
      const response = await fetch(url, { headers: { Accept: 'application/json' } });
      if (!response.ok) throw new Error('search failed');
      const places = await response.json();

      if (!places.length) {
        results.innerHTML = '<li style="padding:8px 10px;color:var(--text-faint);font-size:13px">No matches. Click the map instead.</li>';
        return;
      }
      results.innerHTML = places.map((place) => {
        const [main, ...rest] = place.display_name.split(', ');
        return `<li><button type="button" data-lat="${place.lat}" data-lon="${place.lon}">
          ${escapeHtml(main)}<span class="muted">${escapeHtml(rest.join(', '))}</span>
        </button></li>`;
      }).join('');
    } catch {
      results.innerHTML = '<li style="padding:8px 10px;color:var(--text-faint);font-size:13px">Place search is unavailable. Click the map to drop your pin.</li>';
    }
  }

  /* ------------------------------- progress ------------------------------ */

  function updateProgress() {
    const required = state.questions.filter((q) => q.required);
    const answered = required.filter((q) => {
      const input = $(`q-${q.id}`);
      const value = input ? input.value.trim() : '';
      if (!value) return false;
      return !q.minLength || value.length >= q.minLength;
    });

    const steps = required.length + 3; // questions + place name + pin + period
    let done = answered.length;
    if ($('place-name').value.trim()) done += 1;
    if (state.place.lat !== null) done += 1;
    if (readPeriod()) done += 1;

    const percent = Math.round((done / steps) * 100);
    $('progress').hidden = done === 0;
    $('progress-fill').style.width = `${percent}%`;
    $('progress-text').textContent = done === steps
      ? 'Everything required is filled in.'
      : `${done} of ${steps} required parts filled in`;
    $('progress-required').textContent = `${percent}%`;
  }

  /* ------------------------------- submitting ---------------------------- */

  function clearErrors() {
    document.querySelectorAll('.field.has-error').forEach((f) => f.classList.remove('has-error'));
    document.querySelectorAll('[data-error-for]').forEach((el) => {
      el.textContent = '';
      el.style.display = '';
    });
    $('form-error').hidden = true;
  }

  function showErrors(errors) {
    let firstNode = null;
    for (const error of errors) {
      const node = document.querySelector(`[data-error-for="${CSS.escape(error.field)}"]`);
      if (!node) continue;
      node.textContent = error.message;
      node.style.display = 'block';
      const field = node.closest('.field');
      if (field) field.classList.add('has-error');
      if (!firstNode) firstNode = node;
    }
    if (firstNode) firstNode.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function renderSuccess(result) {
    $('page').innerHTML = `
      <div class="success">
        <div class="success__mark">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="m5 12.5 4.5 4.5L19 7.5" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </div>
        <h2>Your narrative is with the moderator.</h2>
        <p>
          It will appear on the public map once it has been read and accepted.
          If you left an email address, you may hear back with a question first.
        </p>
        <div class="ref">Reference: ${escapeHtml(result.id)}</div>
        <div>
          <a class="btn" href="/">Back to the map</a>
          <a class="btn btn--primary" href="/submit">Add another narrative</a>
        </div>
      </div>`;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function handleSubmit(event) {
    event.preventDefault();
    clearErrors();

    const button = $('submit-btn');
    button.disabled = true;
    button.textContent = 'Sending…';

    const payload = {
      answers: collectAnswers(),
      place: {
        name: $('place-name').value,
        lat: state.place.lat,
        lng: state.place.lng,
      },
      period: readPeriod() || { start: '', end: '', precision: state.precision },
      contributor: {
        name: $('contributor-name').value,
        email: $('contributor-email').value,
      },
    };

    try {
      const result = await api('/api/submissions', { method: 'POST', body: payload });
      renderSuccess(result);
    } catch (error) {
      if (error.errors && error.errors.length) {
        showErrors(error.errors);
        $('form-error').className = 'callout callout--error';
        $('form-error').textContent = `${error.message} See the highlighted questions above.`;
      } else {
        $('form-error').className = 'callout callout--error';
        $('form-error').textContent = error.message;
      }
      $('form-error').hidden = false;
      toast(error.message, 'error');
      button.disabled = false;
      button.textContent = 'Send for review';
    }
  }

  /* --------------------------------- boot -------------------------------- */

  async function boot() {
    const meta = await api('/api/questions');
    state.questions = meta.questions;
    state.yearRange = meta.yearRange;

    renderQuestions();
    renderPeriodInputs();
    updateProgress();

    pickerApi = await window.NMMap.create('picker-map', {
      interactiveProvinces: false,
    });

    pickerApi.map.on('click', (event) => {
      setPin(event.latlng.lat, event.latlng.lng, { keepView: true });
      $('place-results').innerHTML = '';
    });

    $('picker-tiles').addEventListener('change', (event) => pickerApi.setTiles(event.target.checked));

    $('precision').addEventListener('change', (event) => {
      state.precision = event.target.value;
      renderPeriodInputs();
      updateProgress();
    });

    $('place-search').addEventListener('input', debounce((event) => searchPlaces(event.target.value), 380));

    $('place-results').addEventListener('click', (event) => {
      const button = event.target.closest('button[data-lat]');
      if (!button) return;
      const lat = Number(button.dataset.lat);
      const lng = Number(button.dataset.lon);
      setPin(lat, lng, { zoom: 13 });
      if (!$('place-name').value.trim()) {
        $('place-name').value = button.firstChild.textContent.trim();
      }
      $('place-results').innerHTML = '';
      $('place-search').value = '';
      updateProgress();
    });

    document.addEventListener('click', (event) => {
      if (!event.target.closest('.picker__search')) $('place-results').innerHTML = '';
    });

    $('place-name').addEventListener('input', updateProgress);
    $('form').addEventListener('submit', handleSubmit);
  }

  boot().catch((error) => {
    console.error(error);
    toast(error.message || 'Could not load the form.', 'error');
  });
}());
