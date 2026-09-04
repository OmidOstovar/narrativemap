/* The submission form: place picker, period widget, questionnaire. */
(function () {
  'use strict';

  const { api, escapeHtml, toast, debounce } = window.NM;
  const { t, pick, province, digits } = window.I18N;

  const state = {
    questions: [],
    sequence: [],
    yearRange: { min: 1800, max: new Date().getFullYear() },
    place: { lat: null, lng: null, province: null },
    precision: 'year',
  };

  let pickerApi = null;
  let pinMarker = null;
  // Kept so the confirmation can be redrawn if the language changes after it.
  let submitted = null;
  // Kept so the same complaints come back in the new language, not in English.
  let lastErrors = [];

  const $ = (id) => document.getElementById(id);

  /* ----------------------------- questionnaire --------------------------- */

  /* --------------------------- the form sequence ------------------------- */

  /** One numbered block, whatever it contains. */
  function stepBlock(number, title, help, body) {
    return `
      <section class="step">
        <h2 class="step__title">
          <span class="step__number">${escapeHtml(digits(String(number).padStart(2, '0')))}</span>
          <span>${escapeHtml(title)}</span>
        </h2>
        ${help ? `<p class="step__help">${escapeHtml(help)}</p>` : ''}
        ${body}
      </section>`;
  }

  function optionalTag(question) {
    return question.required
      ? ''
      : ` <span class="field__optional">${escapeHtml(t('submit.optional'))}</span>`;
  }

  function questionBody(question) {
    const id = `q-${question.id}`;
    const placeholder = question.placeholder ? pick(question.placeholder) : '';

    if (question.type === 'multiselect' || question.type === 'select') {
      const multiple = question.type === 'multiselect';
      const choices = question.options.map((option) => `
        <label class="choice">
          <input type="${multiple ? 'checkbox' : 'radio'}"
                 name="${escapeHtml(question.id)}"
                 value="${escapeHtml(option.value)}"
                 data-choice="${escapeHtml(question.id)}">
          <span class="choice__body">
            <span class="choice__label">${escapeHtml(pick(option))}</span>
            ${option.detail ? `<span class="choice__detail">${escapeHtml(pick(option.detail))}</span>` : ''}
          </span>
        </label>`).join('');
      return `<div class="choices" id="${id}" role="group">${choices}</div>
              <p class="field__error" data-error-for="${escapeHtml(question.id)}"></p>`;
    }

    const control = question.type === 'textarea'
      ? `<textarea id="${id}" name="${escapeHtml(question.id)}" rows="${question.rows || 6}"
                   maxlength="${question.maxLength || 5000}"
                   ${placeholder ? `placeholder="${escapeHtml(placeholder)}"` : ''}></textarea>`
      : `<input type="text" id="${id}" name="${escapeHtml(question.id)}"
                maxlength="${question.maxLength || 200}"
                ${placeholder ? `placeholder="${escapeHtml(placeholder)}"` : ''}>`;

    const counter = question.maxLength
      ? `<div class="counter" data-counter-for="${escapeHtml(question.id)}"></div>`
      : '';

    return `${control}${counter}
            <p class="field__error" data-error-for="${escapeHtml(question.id)}"></p>`;
  }

  /** The place picker, unchanged in behaviour but now one numbered step. */
  function placeBody() {
    return `
      <div class="picker">
        <div class="picker__search">
          <label class="visually-hidden" for="place-search">${escapeHtml(t('submit.searchLabel'))}</label>
          <input type="search" id="place-search" placeholder="${escapeHtml(t('submit.search'))}" autocomplete="off">
          <ul class="picker__results" id="place-results"></ul>
        </div>

        <div class="picker__map">
          <div id="picker-map" style="position:absolute;inset:0"></div>
          <div class="picker__hint" id="picker-hint">${escapeHtml(t('submit.pinHint'))}</div>
        </div>

        <div class="picker__readout">
          <span>${escapeHtml(t('submit.pin'))} <span class="coords unset" id="readout-coords" dir="ltr">${escapeHtml(t('submit.pinUnset'))}</span></span>
          <span>${escapeHtml(t('submit.province'))} <span class="province unset" id="readout-province">—</span></span>
          <label class="map-toggle" style="margin-inline-start:auto;box-shadow:none;background:transparent;padding:0;border:none">
            <input type="checkbox" id="picker-tiles"> ${escapeHtml(t('map.streetDetail'))}
          </label>
        </div>

        <p class="field__error" data-error-for="place.point"></p>
      </div>`;
  }

  function periodBody() {
    return `
      <div class="field">
        <label class="field__label" for="precision">${escapeHtml(t('submit.precision'))}</label>
        <select id="precision">
          ${['year', 'month', 'day', 'hour'].map((p) => `<option value="${p}">${escapeHtml(t(`submit.precision.${p}`))}</option>`).join('')}
        </select>
      </div>
      <div class="form-row" id="period-inputs"></div>
      <p class="field__help" id="period-echo" style="margin-top:10px"></p>
      <p class="field__error" data-error-for="period"></p>`;
  }

  function pseudonymBody() {
    return `
      <input type="text" id="contributor-name" maxlength="80" placeholder="${escapeHtml(t('reader.anonymous'))}">
      <p class="field__error" data-error-for="contributor.name"></p>`;
  }

  function emailBody() {
    return `
      <input type="email" id="contributor-email" maxlength="160" placeholder="you@example.com">
      <p class="field__error" data-error-for="contributor.email"></p>`;
  }

  /** Renders every step in the order the questionnaire declares. */
  function renderSteps() {
    let number = 0;
    const html = state.sequence.map((entry) => {
      number += 1;
      if (entry.kind === 'question') {
        const question = state.questions.find((q) => q.id === entry.id);
        if (!question) return '';
        return stepBlock(
          number,
          pick(question.label) + (question.required ? '' : ` (${t('submit.optional')})`),
          question.help ? pick(question.help) : '',
          questionBody(question),
        );
      }
      if (entry.kind === 'place') {
        return stepBlock(number, t('submit.where.title'), t('submit.where.note'), placeBody());
      }
      if (entry.kind === 'period') {
        return stepBlock(number, t('submit.when.title'), t('submit.when.note'), periodBody());
      }
      if (entry.kind === 'pseudonym') {
        return stepBlock(number, t('submit.about.title'), t('submit.about.note'), pseudonymBody());
      }
      if (entry.kind === 'email') {
        return stepBlock(number, `${t('submit.email')} (${t('submit.optional')})`, t('submit.emailHelp'), emailBody());
      }
      return '';
    }).join('');

    $('steps').innerHTML = html;
  }

  function updateCounter(input) {
    const name = input.name;
    if (!name) return;
    const counter = document.querySelector(`[data-counter-for="${CSS.escape(name)}"]`);
    if (!counter) return;
    const question = state.questions.find((q) => q.id === name);
    if (!question || !question.maxLength) return;

    const length = input.value.length;
    counter.textContent = digits(`${length} / ${question.maxLength}`);
    counter.classList.toggle('is-over', length > question.maxLength);
    counter.classList.toggle('is-close', length > question.maxLength * 0.9 && length <= question.maxLength);

    if (question.minLength && length > 0 && length < question.minLength) {
      counter.textContent = t('submit.atLeast', { count: length, min: question.minLength });
      counter.classList.add('is-close');
    }
  }

  function collectAnswers() {
    const answers = {};
    for (const question of state.questions) {
      if (question.type === 'multiselect' || question.type === 'select') {
        const chosen = [...document.querySelectorAll(`[data-choice="${CSS.escape(question.id)}"]:checked`)]
          .map((node) => node.value);
        answers[question.id] = question.type === 'multiselect' ? chosen : (chosen[0] || '');
        continue;
      }
      const input = $(`q-${question.id}`);
      if (input) answers[question.id] = input.value;
    }
    return answers;
  }

  /**
   * Writes a snapshot back into a freshly rendered form. Choices are matched by
   * their stored value, which does not change with the language, so a Persian
   * answer stays chosen when the form is redrawn in English.
   */
  function restoreAnswers(answers) {
    for (const question of state.questions) {
      const value = answers[question.id];
      if (question.type === 'multiselect' || question.type === 'select') {
        const chosen = Array.isArray(value) ? value : [value].filter(Boolean);
        document.querySelectorAll(`[data-choice="${CSS.escape(question.id)}"]`)
          .forEach((node) => { node.checked = chosen.includes(node.value); });
        continue;
      }
      const input = $(`q-${question.id}`);
      if (input && typeof value === 'string') {
        input.value = value;
        updateCounter(input);
      }
    }
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

    if (state.precision === 'hour') {
      const day = previous ? previous.start : '';
      host.innerHTML = `
        <div class="field" style="margin-bottom:0;flex:1 1 100%">
          <label class="field__label" for="period-start">${escapeHtml(t('submit.onDay'))}</label>
          <input type="date" id="period-start" value="${escapeHtml(day)}"
                 min="${state.yearRange.min}-01-01" max="${state.yearRange.max}-12-31">
        </div>
        <div class="field" style="margin-bottom:0">
          <label class="field__label" for="period-start-time">${escapeHtml(t('submit.fromTime'))}</label>
          <input type="time" id="period-start-time" value="${escapeHtml(previous && previous.startTime ? previous.startTime : '')}">
        </div>
        <div class="field" style="margin-bottom:0">
          <label class="field__label" for="period-end-time">${escapeHtml(t('submit.toTime'))}</label>
          <input type="time" id="period-end-time" value="${escapeHtml(previous && previous.endTime ? previous.endTime : '')}">
        </div>
        <p class="field__help" style="flex:1 1 100%;margin:0">${escapeHtml(t('submit.timeHelp'))}</p>`;
    } else if (state.precision === 'year') {
      host.innerHTML = `
        <div class="field" style="margin-bottom:0">
          <label class="field__label" for="period-start">${escapeHtml(t('submit.fromYear'))}</label>
          <input type="number" id="period-start" inputmode="numeric"
                 min="${state.yearRange.min}" max="${state.yearRange.max}"
                 placeholder="${state.yearRange.min}" value="${escapeHtml(startYear)}">
        </div>
        <div class="field" style="margin-bottom:0">
          <label class="field__label" for="period-end">${escapeHtml(t('submit.toYear'))}</label>
          <input type="number" id="period-end" inputmode="numeric"
                 min="${state.yearRange.min}" max="${state.yearRange.max}"
                 placeholder="${state.yearRange.max}" value="${escapeHtml(endYear)}">
        </div>`;
    } else if (state.precision === 'month') {
      host.innerHTML = `
        <div class="field" style="margin-bottom:0">
          <label class="field__label" for="period-start">${escapeHtml(t('submit.fromMonth'))}</label>
          <input type="month" id="period-start" value="${escapeHtml(startMonth)}"
                 min="${state.yearRange.min}-01" max="${state.yearRange.max}-12">
        </div>
        <div class="field" style="margin-bottom:0">
          <label class="field__label" for="period-end">${escapeHtml(t('submit.toMonth'))}</label>
          <input type="month" id="period-end" value="${escapeHtml(endMonth)}"
                 min="${state.yearRange.min}-01" max="${state.yearRange.max}-12">
        </div>`;
    } else {
      host.innerHTML = `
        <div class="field" style="margin-bottom:0">
          <label class="field__label" for="period-start">${escapeHtml(t('submit.firstDay'))}</label>
          <input type="date" id="period-start" value="${previous ? escapeHtml(previous.start) : ''}"
                 min="${state.yearRange.min}-01-01" max="${state.yearRange.max}-12-31">
        </div>
        <div class="field" style="margin-bottom:0">
          <label class="field__label" for="period-end">${escapeHtml(t('submit.lastDay'))}</label>
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

  /**
   * The period widget's inputs, exactly as typed. `readPeriod` gives nothing
   * back until the pair is complete, so a half-filled date would be lost when
   * the form is redrawn; this keeps it.
   */
  const PERIOD_INPUT_IDS = ['period-start', 'period-end', 'period-start-time', 'period-end-time'];

  function periodSnapshot() {
    const snapshot = {};
    for (const id of PERIOD_INPUT_IDS) {
      const input = $(id);
      if (input) snapshot[id] = input.value;
    }
    return snapshot;
  }

  function restorePeriod(snapshot) {
    for (const id of PERIOD_INPUT_IDS) {
      const input = $(id);
      if (input && snapshot[id] !== undefined) input.value = snapshot[id];
    }
    renderPeriodEcho();
  }

  /** Expands the widget's values into the ISO start/end the API expects. */
  /** Adds days to an ISO date without touching the local timezone. */
  function addDays(iso, days) {
    const [y, m, d] = iso.split('-').map(Number);
    const shifted = new Date(Date.UTC(y, m - 1, d + days));
    return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, '0')}-${String(shifted.getUTCDate()).padStart(2, '0')}`;
  }

  function readPeriod() {
    if (state.precision === 'hour') {
      const day = $('period-start');
      const from = $('period-start-time');
      const to = $('period-end-time');
      if (!day || !from || !to) return null;
      if (!day.value || !from.value || !to.value) return null;
      // "From eleven at night until two" means the small hours of the next day.
      const crossesMidnight = to.value < from.value;
      return {
        start: day.value,
        end: crossesMidnight ? addDays(day.value, 1) : day.value,
        precision: 'hour',
        startTime: from.value,
        endTime: to.value,
      };
    }

    const startInput = $('period-start');
    const endInput = $('period-end');
    if (!startInput || !endInput) return null;

    const rawStart = startInput.value.trim();
    const rawEnd = endInput.value.trim();
    if (!rawStart || !rawEnd) return null;

    if (state.precision === 'hour') {
      const day = previous ? previous.start : '';
      host.innerHTML = `
        <div class="field" style="margin-bottom:0;flex:1 1 100%">
          <label class="field__label" for="period-start">${escapeHtml(t('submit.onDay'))}</label>
          <input type="date" id="period-start" value="${escapeHtml(day)}"
                 min="${state.yearRange.min}-01-01" max="${state.yearRange.max}-12-31">
        </div>
        <div class="field" style="margin-bottom:0">
          <label class="field__label" for="period-start-time">${escapeHtml(t('submit.fromTime'))}</label>
          <input type="time" id="period-start-time" value="${escapeHtml(previous && previous.startTime ? previous.startTime : '')}">
        </div>
        <div class="field" style="margin-bottom:0">
          <label class="field__label" for="period-end-time">${escapeHtml(t('submit.toTime'))}</label>
          <input type="time" id="period-end-time" value="${escapeHtml(previous && previous.endTime ? previous.endTime : '')}">
        </div>
        <p class="field__help" style="flex:1 1 100%;margin:0">${escapeHtml(t('submit.timeHelp'))}</p>`;
    } else if (state.precision === 'year') {
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

    const pair = window.NM.formatPeriodPair(period);
    echo.textContent = pair.secondary
      ? `${pair.primary}  ·  ${pair.secondary} ${pair.secondaryLabel}`
      : pair.primary;
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

    const { inside, province: found } = await window.NMMap.locate(lat, lng);
    state.place.province = found;

    $('readout-coords').textContent = digits(`${lat.toFixed(5)}, ${lng.toFixed(5)}`);
    $('readout-coords').classList.remove('unset');
    $('readout-province').textContent = province(found)
      || (inside ? t('submit.insideIran') : t('submit.outsideIran'));
    $('readout-province').classList.toggle('unset', !found && !inside);

    const pointError = document.querySelector('[data-error-for="place.point"]');
    if (!inside) {
      pointError.textContent = t('error.outsideIran');
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
        results.innerHTML = `<li style="padding:8px 10px;color:var(--text-faint);font-size:13px">${escapeHtml(t('submit.searchNone'))}</li>`;
        return;
      }
      results.innerHTML = places.map((place) => {
        const [main, ...rest] = place.display_name.split(', ');
        return `<li><button type="button" data-lat="${place.lat}" data-lon="${place.lon}">
          ${escapeHtml(main)}<span class="muted">${escapeHtml(rest.join(', '))}</span>
        </button></li>`;
      }).join('');
    } catch {
      results.innerHTML = `<li style="padding:8px 10px;color:var(--text-faint);font-size:13px">${escapeHtml(t('submit.searchDown'))}</li>`;
    }
  }

  /* ------------------------------- progress ------------------------------ */

  function updateProgress() {
    const answers = collectAnswers();
    const required = state.questions.filter((q) => q.required);
    const answered = required.filter((q) => {
      const value = answers[q.id];
      if (Array.isArray(value)) return value.length > 0;
      const text = (value || '').trim();
      if (!text) return false;
      return !q.minLength || text.length >= q.minLength;
    });

    const steps = required.length + 2; // questions + pin + period
    let done = answered.length;
    if (state.place.lat !== null) done += 1;
    if (readPeriod()) done += 1;

    const percent = Math.round((done / steps) * 100);
    $('progress').hidden = done === 0;
    $('progress-fill').style.width = `${percent}%`;
    $('progress-text').textContent = done === steps
      ? t('submit.progress.done')
      : t('submit.progress.some', { done, total: steps });
    $('progress-required').textContent = digits(`${percent}%`);
  }

  /* ------------------------------- submitting ---------------------------- */

  function clearErrors() {
    lastErrors = [];
    document.querySelectorAll('.field.has-error').forEach((f) => f.classList.remove('has-error'));
    document.querySelectorAll('[data-error-for]').forEach((el) => {
      el.textContent = '';
      el.style.display = '';
    });
    $('form-error').hidden = true;
  }

  /**
   * The API answers with a `code` and any `params` beside its English
   * `message`, so the browser can say the same thing in the reader's language.
   */
  function errorText(error) {
    if (!error.code) return error.message;
    const translated = t(error.code, error.params);
    return translated === error.code ? error.message : translated;
  }

  function showErrors(errors) {
    lastErrors = errors;
    let firstNode = null;
    for (const error of errors) {
      const node = document.querySelector(`[data-error-for="${CSS.escape(error.field)}"]`);
      if (!node) continue;
      node.textContent = errorText(error);
      node.style.display = 'block';
      const field = node.closest('.field');
      if (field) field.classList.add('has-error');
      if (!firstNode) firstNode = node;
    }
    if (firstNode) firstNode.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function renderSuccess(result) {
    submitted = result;
    $('page').innerHTML = `
      <div class="success">
        <div class="success__mark">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="m5 12.5 4.5 4.5L19 7.5" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </div>
        <h2>${escapeHtml(t('submit.success.title'))}</h2>
        <p>${escapeHtml(t('submit.success.body'))}</p>
        <div class="ref" dir="ltr">${escapeHtml(t('submit.success.ref', { id: result.id }))}</div>
        <div>
          <a class="btn" href="/">${escapeHtml(t('submit.success.back'))}</a>
          <a class="btn btn--primary" href="/submit">${escapeHtml(t('submit.success.another'))}</a>
        </div>
      </div>`;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function handleSubmit(event) {
    event.preventDefault();
    clearErrors();

    const button = $('submit-btn');
    button.disabled = true;
    button.textContent = t('submit.sending');

    const payload = {
      answers: collectAnswers(),
      place: {
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
        $('form-error').textContent = t('submit.fixErrors');
      } else {
        $('form-error').className = 'callout callout--error';
        $('form-error').textContent = error.message;
      }
      $('form-error').hidden = false;
      toast(error.errors && error.errors.length ? t('submit.fixErrors') : error.message, 'error');
      button.disabled = false;
      button.textContent = t('submit.send');
    }
  }

  /* --------------------------------- boot -------------------------------- */

  /**
   * Wires everything inside #steps. The block is rebuilt whenever the language
   * changes, so its listeners are attached here, once per rendering, rather
   * than once per page.
   */
  async function wireSteps() {
    $('steps').addEventListener('input', (event) => {
      updateCounter(event.target);
      updateProgress();
    });
    $('steps').addEventListener('change', updateProgress);

    pickerApi = await window.NMMap.create('picker-map', {
      interactiveProvinces: false,
    });

    pickerApi.map.on('click', (event) => {
      setPin(event.latlng.lat, event.latlng.lng, { keepView: true });
      $('place-results').innerHTML = '';
    });

    $('picker-tiles').addEventListener('change', (event) => pickerApi.setTiles(event.target.checked));

    $('precision').value = state.precision;
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
      $('place-results').innerHTML = '';
      $('place-search').value = '';
      updateProgress();
    });
  }

  /**
   * Redraws the whole form in the language just chosen.
   *
   * Every label, hint and option inside #steps is written by this file rather
   * than tagged in the HTML, so `I18N.apply` cannot reach any of it. Rebuilding
   * the block is the only way to translate all of it at once — and nothing the
   * contributor has entered may be lost in the process, so it is taken down
   * first and put back afterwards.
   */
  async function relocalise() {
    if (submitted) { renderSuccess(submitted); return; }
    if (!state.questions.length || !$('steps')) return;

    const answers = collectAnswers();
    const period = periodSnapshot();
    const name = $('contributor-name').value;
    const email = $('contributor-email').value;
    const tiles = $('picker-tiles').checked;
    const scrolled = window.scrollY;
    const errors = lastErrors;

    // Leaflet has to let go of the container before it is thrown away.
    if (pickerApi) { pickerApi.map.remove(); pickerApi = null; pinMarker = null; }

    renderSteps();
    renderPeriodInputs();
    restoreAnswers(answers);
    restorePeriod(period);
    $('contributor-name').value = name;
    $('contributor-email').value = email;
    $('picker-tiles').checked = tiles;

    await wireSteps();
    if (tiles) pickerApi.setTiles(true);
    if (state.place.lat !== null) {
      // Re-dropping the pin also repaints the province in the new language.
      await setPin(state.place.lat, state.place.lng, { zoom: 13 });
    }
    if (errors.length) {
      showErrors(errors);
      $('form-error').textContent = t('submit.fixErrors');
    }
    updateProgress();
    window.scrollTo(0, scrolled);
  }

  async function boot() {
    const meta = await api('/api/questions');
    state.questions = meta.questions;
    state.sequence = meta.sequence;
    state.yearRange = meta.yearRange;

    renderSteps();
    renderPeriodInputs();
    updateProgress();

    await wireSteps();

    document.addEventListener('click', (event) => {
      if (!event.target.closest('.picker__search')) $('place-results').innerHTML = '';
    });

    $('form').addEventListener('submit', handleSubmit);

    window.I18N.onChange(() => {
      relocalise().catch((error) => console.error('could not redraw the form', error));
    });
  }

  boot().catch((error) => {
    console.error(error);
    toast(error.message || t('submit.loadFailed'), 'error');
  });
}());
