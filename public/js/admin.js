/* The moderation queue: read submissions, correct them, publish or decline. */
(function () {
  'use strict';

  const { api, escapeHtml, paragraphs, dirFor, formatYears, formatPeriodPair,
          formatTimestamp, toast } = window.NM;
  const { t, pick, province, digits } = window.I18N;

  const state = {
    questions: [],
    titleQuestionId: 'narrative_title',
    yearRange: { min: 1800, max: new Date().getFullYear() },
    status: 'pending',
    submissions: [],
    counts: { pending: 0, approved: 0, rejected: 0 },
    selectedId: null,
    editing: false,
  };

  let detailPin = null;

  const $ = (id) => document.getElementById(id);
  const queueEl = () => $('queue');
  const detailEl = () => $('detail');

  /** The title the contributor gave it; older ones are known by their place. */
  const title = (s) => (s.answers[state.titleQuestionId] || '').trim()
    || s.place.name
    || province(s.place.province)
    || t('reader.untitled');

  /** Where it happened, as specifically as the submission says. */
  const placeLabel = (s) => s.place.name || province(s.place.province) || '';

  /** Choice answers store stable codes; label them for the moderator. */
  function choiceLabels(question, value) {
    const codes = Array.isArray(value) ? value : [value].filter(Boolean);
    return codes.map((code) => {
      const option = (question.options || []).find((o) => o.value === code);
      return option ? pick(option) : code;
    });
  }

  const isChoice = (q) => q.type === 'select' || q.type === 'multiselect';

  /* -------------------------------- session ------------------------------ */

  async function showApp() {
    $('login-view').hidden = true;
    $('admin-view').hidden = false;
    $('logout').hidden = false;

    const meta = await api('/api/questions');
    state.questions = meta.questions;
    state.titleQuestionId = meta.titleQuestionId || state.titleQuestionId;
    state.yearRange = meta.yearRange;

    wireShell();
    window.I18N.onChange(() => {
      renderQueue();
      const open = state.submissions.find((item) => item.id === state.selectedId);
      if (open && !state.editing) renderDetail(open);
    });
    await refresh();
  }

  function showLogin() {
    $('login-view').hidden = false;
    $('admin-view').hidden = true;
    $('logout').hidden = true;
    $('password').focus();
  }

  /* --------------------------------- queue ------------------------------- */

  async function refresh(keepSelection) {
    const data = await api(`/api/admin/submissions?status=${encodeURIComponent(state.status)}`);
    state.submissions = data.submissions;
    state.counts = data.counts;

    for (const [status, count] of Object.entries(state.counts)) {
      const node = document.querySelector(`[data-count="${status}"]`);
      if (node) node.textContent = digits(count);
    }

    renderQueue();

    if (keepSelection && state.selectedId
        && state.submissions.some((s) => s.id === state.selectedId)) {
      renderDetail(state.submissions.find((s) => s.id === state.selectedId));
    } else if (!state.submissions.some((s) => s.id === state.selectedId)) {
      state.selectedId = null;
      detailEl().innerHTML = `
        <div class="empty-state" style="padding-top:20vh">
          <strong>${escapeHtml(t('admin.nothingSelected'))}</strong>
          ${escapeHtml(t('admin.pickOne'))}
        </div>`;
    }
  }

  function renderQueue() {
    if (!state.submissions.length) {
      const messages = {
        pending: [t('admin.empty.pending'), t('admin.empty.pendingNote')],
        approved: [t('admin.empty.approved'), t('admin.empty.approvedNote')],
        rejected: [t('admin.empty.rejected'), ''],
      };
      const [heading, note] = messages[state.status] || [t('admin.empty.rejected'), ''];
      queueEl().innerHTML = `<li class="empty-state"><strong>${escapeHtml(heading)}</strong>${escapeHtml(note)}</li>`;
      return;
    }

    queueEl().innerHTML = state.submissions.map((s) => `
      <li>
        <button class="card${s.id === state.selectedId ? ' is-active' : ''}" data-id="${escapeHtml(s.id)}">
          <span class="card__title" dir="${dirFor(title(s))}">${escapeHtml(title(s))}</span>
          <span class="card__meta">
            <span class="place">${escapeHtml(placeLabel(s))}</span>
            <span>${escapeHtml(formatYears(s.period))}</span>
            <span>${escapeHtml(formatTimestamp(s.submittedAt))}</span>
          </span>
          <span class="card__excerpt">${escapeHtml((s.answers.what_happened || '').replace(/\s+/g, ' ').slice(0, 160))}</span>
        </button>
      </li>`).join('');
  }

  /* -------------------------------- detail ------------------------------- */

  function renderDetail(submission) {
    state.selectedId = submission.id;
    state.editing = false;
    renderQueue();
    detailEl().innerHTML = detailHtml(submission);
    detailEl().scrollTop = 0;
    mountDetailMap(submission, false);
    wireDetail(submission);
  }

  function privateBlock(submission) {
    const priv = submission.private || {};
    return `
      <div class="private-note">
        <h3>${escapeHtml(t('admin.privateHeading'))}</h3>
        <dl>
          <dt>${escapeHtml(t('admin.reference'))}</dt><dd>${escapeHtml(submission.id)}</dd>
          <dt>${escapeHtml(t('admin.submitted'))}</dt><dd>${escapeHtml(formatTimestamp(submission.submittedAt))}</dd>
          <dt>${escapeHtml(t('admin.source'))}</dt><dd>${escapeHtml(t('admin.source.' + ((submission.private || {}).source || 'web')))}</dd>
          <dt>${escapeHtml(t('admin.contact'))}</dt><dd>${priv.email ? `<a href="mailto:${escapeHtml(priv.email)}">${escapeHtml(priv.email)}</a>` : escapeHtml(t('admin.noContact'))}</dd>
          ${priv.reviewedAt ? `<dt>${escapeHtml(t('admin.reviewed'))}</dt><dd>${escapeHtml(formatTimestamp(priv.reviewedAt))}</dd>` : ''}
          ${priv.reviewNote ? `<dt>${escapeHtml(t('admin.note'))}</dt><dd>${escapeHtml(priv.reviewNote)}</dd>` : ''}
        </dl>
      </div>`;
  }

  function detailHtml(submission) {
    const when = formatPeriodPair(submission.period);
    const source = (submission.private && submission.private.source) || 'web';
    const tstatus = (submission.private && submission.private.translationStatus) || 'pending';
    const otherLang = submission.originalLang === 'fa' ? 'en' : 'fa';
    const answers = state.questions
      .filter((q) => submission.answers[q.id])
      .map((q) => {
        const raw = submission.answers[q.id];
        if (!raw || (Array.isArray(raw) && !raw.length)) return '';
        if (isChoice(q)) {
          const chips = choiceLabels(q, raw)
            .map((label) => `<span class="chip">${escapeHtml(label)}</span>`).join('');
          return `
            <section class="qa">
              <h3 class="qa__q">${escapeHtml(pick(q.label))}</h3>
              <div class="chips">${chips}</div>
            </section>`;
        }
        const translated = (submission.answersTranslated || {})[q.id];
        return `
          <section class="qa">
            <h3 class="qa__q">${escapeHtml(pick(q.label))}</h3>
            <div class="qa__a" dir="${dirFor(raw)}">${paragraphs(raw)}</div>
            ${translated ? `
              <div class="qa__translation" dir="${dirFor(translated)}">
                <span class="qa__translation-label">${escapeHtml(t('admin.translationOf', { lang: t('lang.' + otherLang) }))}</span>
                ${paragraphs(translated)}
              </div>` : ''}
          </section>`;
      }).join('');

    const unanswered = state.questions.filter((q) => {
      const value = submission.answers[q.id];
      return !value || (Array.isArray(value) && !value.length);
    });

    return `
      <div class="reader__body" style="padding:32px 40px 24px">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:18px;flex-wrap:wrap">
          <span class="badge badge--${escapeHtml(submission.status)}">${escapeHtml(t('admin.status.' + submission.status))}</span>
          <span class="badge badge--source">${escapeHtml(t('admin.source.' + source))}</span>
          ${submission.place.approximate ? `<span class="badge badge--pending">${escapeHtml(t('admin.approximateShort'))}</span>` : ''}
          <span class="badge badge--${tstatus === 'failed' ? 'rejected' : 'source'}">${escapeHtml(t('admin.tstatus.' + tstatus))}</span>
          ${submission.status === 'approved'
            ? `<a href="/?n=${encodeURIComponent(submission.id)}" target="_blank" rel="noopener" style="font-size:13px">${escapeHtml(t('admin.viewOnMap'))}</a>`
            : ''}
        </div>

        ${privateBlock(submission)}

        <h1 class="reader__title" dir="${dirFor(title(submission))}">${escapeHtml(title(submission))}</h1>

        <dl class="reader__facts">
          <dt>${escapeHtml(t('reader.place'))}</dt>
          <dd>
            ${escapeHtml(placeLabel(submission))}
            ${submission.place.province ? `<span class="secondary"> · ${escapeHtml(province(submission.place.province))}</span>` : ''}
            <div class="secondary" dir="ltr">${escapeHtml(digits(`${submission.place.lat.toFixed(5)}, ${submission.place.lng.toFixed(5)}`))}</div>
          </dd>
          <dt>${escapeHtml(t('reader.when'))}</dt>
          <dd>
            ${escapeHtml(when.primary)}
            ${when.secondary ? `<div class="secondary">${escapeHtml(when.secondary)} ${escapeHtml(when.secondaryLabel)}</div>` : ''}
          </dd>
          <dt>${escapeHtml(t('reader.toldBy'))}</dt>
          <dd>${escapeHtml(submission.contributor || t('reader.anonymous'))}</dd>
        </dl>

        ${submission.place.approximate
          ? `<div class="callout callout--warn" style="margin-bottom:16px">${escapeHtml(t('admin.approximate'))}</div>`
          : ''}
        ${mapBlockHtml(220)}

        ${answers}

        ${unanswered.length ? `
          <p style="color:var(--text-faint);font-size:13px;border-top:1px solid var(--ink-600);padding-top:16px">
            ${escapeHtml(t('admin.leftBlank', { questions: unanswered.map((q) => pick(q.label)).join(' · ') }))}
          </p>` : ''}
      </div>

      <div class="review-actions">
        ${submission.status !== 'approved'
          ? `<button type="button" class="btn btn--approve" data-action="approve">${escapeHtml(t('admin.publish'))}</button>`
          : `<button type="button" class="btn" data-action="pending">${escapeHtml(t('admin.unpublish'))}</button>`}
        ${submission.status !== 'rejected'
          ? `<button type="button" class="btn" data-action="reject">${escapeHtml(t('admin.decline'))}</button>`
          : `<button type="button" class="btn" data-action="pending">${escapeHtml(t('admin.backToPending'))}</button>`}
        <button type="button" class="btn" data-action="edit">${escapeHtml(t('admin.edit'))}</button>
        <button type="button" class="btn" data-action="retranslate">${escapeHtml(t('admin.retranslate'))}</button>
        <span class="spacer"></span>
        <button type="button" class="btn btn--danger" data-action="delete">${escapeHtml(t('admin.delete'))}</button>
      </div>`;
  }

  /** Map used to check where a submission is actually pinned. */
  function mapBlockHtml(height) {
    return `
      <div style="margin-bottom:32px">
        <label class="map-toggle" style="box-shadow:none;margin-bottom:8px">
          <input type="checkbox" id="detail-tiles"> ${escapeHtml(t('admin.streetCheck'))}
        </label>
        <div id="detail-map" style="height:${height}px;border:1px solid var(--ink-500);border-radius:var(--radius-sm)"></div>
      </div>`;
  }

  function mountDetailMap(submission, draggable) {
    const host = document.getElementById('detail-map');
    if (!host) return;
    window.NMMap.create('detail-map', { interactiveProvinces: false, zoomControl: true })
      .then((apiHandle) => {
        detailPin = window.NMMap.pin([submission.place.lat, submission.place.lng], {
          className: 'pin--picker', draggable, size: [17, 17], anchor: [8.5, 8.5],
        }).addTo(apiHandle.map);
        apiHandle.map.setView([submission.place.lat, submission.place.lng], 7);

        const toggle = document.getElementById('detail-tiles');
        if (toggle) {
          toggle.addEventListener('change', (event) => {
            apiHandle.setTiles(event.target.checked);
            if (event.target.checked) apiHandle.map.setZoom(Math.max(apiHandle.map.getZoom(), 13));
          });
        }

        if (draggable) {
          detailPin.on('dragend', async () => {
            const position = detailPin.getLatLng();
            const latField = document.getElementById('edit-lat');
            const lngField = document.getElementById('edit-lng');
            if (latField) latField.value = position.lat.toFixed(5);
            if (lngField) lngField.value = position.lng.toFixed(5);
            // Moving the pin is exactly the act that makes it no longer a guess.
            const approxField = document.getElementById('edit-approximate');
            if (approxField) approxField.checked = false;
            const { province: found } = await window.NMMap.locate(position.lat, position.lng);
            const provinceNode = document.getElementById('edit-province');
            if (provinceNode) {
            provinceNode.textContent = province(found) || t('admin.outsideProvinces');
          }
          });
        }
      })
      .catch(() => { host.remove(); });
  }

  /* ------------------------------- editing ------------------------------- */

  function editHtml(submission) {
    const otherLang = submission.originalLang === 'fa' ? 'en' : 'fa';
    const translations = submission.answersTranslated || {};

    const fields = state.questions.map((q) => {
      const value = submission.answers[q.id] || '';
      const translated = translations[q.id] || '';
      const chosen = Array.isArray(value) ? value : [value].filter(Boolean);
      const control = isChoice(q)
        ? `<div class="choices">${q.options.map((o) => `
            <label class="choice">
              <input type="${q.type === 'multiselect' ? 'checkbox' : 'radio'}"
                     name="edit-${escapeHtml(q.id)}" value="${escapeHtml(o.value)}"
                     data-answer-choice="${escapeHtml(q.id)}"${chosen.includes(o.value) ? ' checked' : ''}>
              <span class="choice__body"><span class="choice__label">${escapeHtml(pick(o))}</span></span>
            </label>`).join('')}</div>`
        : q.type === 'text'
          ? `<input type="text" data-answer="${escapeHtml(q.id)}" value="${escapeHtml(value)}" maxlength="${q.maxLength || 200}">`
          : `<textarea data-answer="${escapeHtml(q.id)}" rows="${Math.min(q.rows || 5, 10)}" maxlength="${q.maxLength || 5000}">${escapeHtml(value)}</textarea>`;
      // Select answers are language-independent codes, so they have no
      // translation to edit.
      const translationField = isChoice(q) ? '' : `
        <div class="translation-pane">
          <label class="field__label field__label--sub">${escapeHtml(t('admin.translationOf', { lang: t('lang.' + otherLang) }))}</label>
          <textarea data-translation="${escapeHtml(q.id)}" rows="${Math.min(q.rows || 4, 8)}"
                    dir="${otherLang === 'fa' ? 'rtl' : 'ltr'}">${escapeHtml(translated)}</textarea>
        </div>`;

      return `
        <div class="field">
          <label class="field__label">${escapeHtml(pick(q.label))}${q.required ? '' : `<span class="field__optional">${escapeHtml(t('submit.optional'))}</span>`}</label>
          <div class="bilingual">
            <div>
              <label class="field__label field__label--sub">${escapeHtml(t('admin.originalIn', { lang: t('lang.' + submission.originalLang) }))}</label>
              ${control}
            </div>
            ${translationField}
          </div>
          <p class="field__error" data-error-for="${escapeHtml(q.id)}"></p>
        </div>`;
    }).join('');

    return `
      <div class="reader__body" style="padding:32px 40px 24px">
        <h2 class="section__title" style="margin-bottom:20px">${escapeHtml(t('admin.editing', { title: title(submission) }))}</h2>
        <p class="section__note">${escapeHtml(t('admin.editNote'))}</p>
        <div class="callout" style="margin-bottom:24px">${escapeHtml(t('admin.translationNote'))}</div>

        <div class="private-note" style="border-style:solid">
          <h3>${escapeHtml(t('admin.placeAndTime'))}</h3>
          <div class="edit-grid" style="margin-top:12px">
            <div class="field" style="margin:0">
              <label class="field__label" for="edit-place">${escapeHtml(t('admin.placeName'))}</label>
              <input type="text" id="edit-place" value="${escapeHtml(submission.place.name)}" maxlength="160">
            </div>
            <div class="field" style="margin:0">
              <label class="field__label" for="edit-place-translated">${escapeHtml(t('admin.translationOf', { lang: t('lang.' + otherLang) }))}</label>
              <input type="text" id="edit-place-translated" maxlength="160"
                     dir="${otherLang === 'fa' ? 'rtl' : 'ltr'}"
                     value="${escapeHtml(submission.place.nameTranslated || '')}">
            </div>
            <div class="field" style="margin:0">
              <label class="field__label" for="edit-lat">${escapeHtml(t('admin.latitude'))}</label>
              <input type="number" id="edit-lat" step="0.00001" value="${submission.place.lat}">
            </div>
            <div class="field" style="margin:0">
              <label class="field__label" for="edit-lng">${escapeHtml(t('admin.longitude'))}</label>
              <input type="number" id="edit-lng" step="0.00001" value="${submission.place.lng}">
            </div>
          </div>
          <p style="margin:10px 0 0;font-size:13px">
            ${escapeHtml(t('admin.provinceIs'))} <span id="edit-province" style="color:var(--text)">${escapeHtml(province(submission.place.province) || t('admin.unknown'))}</span>
            ${escapeHtml(t('admin.dragPin'))}
          </p>
          <div class="edit-grid" style="margin-top:14px">
            <div class="field" style="margin:0">
              <label class="field__label" for="edit-start">${escapeHtml(t('admin.periodStart'))}</label>
              <input type="date" id="edit-start" value="${escapeHtml(submission.period.start)}">
            </div>
            <div class="field" style="margin:0">
              <label class="field__label" for="edit-end">${escapeHtml(t('admin.periodEnd'))}</label>
              <input type="date" id="edit-end" value="${escapeHtml(submission.period.end)}">
            </div>
            <div class="field" style="margin:0">
              <label class="field__label" for="edit-precision">${escapeHtml(t('admin.shownAs'))}</label>
              <select id="edit-precision">
                ${['year', 'month', 'day', 'hour'].map((p) => `<option value="${p}"${p === submission.period.precision ? ' selected' : ''}>${escapeHtml(t('submit.precision.' + p))}</option>`).join('')}
              </select>
            </div>
            <div class="field" style="margin:0">
              <label class="field__label" for="edit-start-time">${escapeHtml(t('submit.fromTime'))}</label>
              <input type="time" id="edit-start-time" value="${escapeHtml(submission.period.startTime || '')}">
            </div>
            <div class="field" style="margin:0">
              <label class="field__label" for="edit-end-time">${escapeHtml(t('submit.toTime'))}</label>
              <input type="time" id="edit-end-time" value="${escapeHtml(submission.period.endTime || '')}">
            </div>
            <div class="field" style="margin:0">
              <label class="field__label" for="edit-approximate-label">${escapeHtml(t('admin.approximateField'))}</label>
              <label class="map-toggle" style="box-shadow:none;background:transparent;border:none;padding:8px 0">
                <input type="checkbox" id="edit-approximate"${submission.place.approximate ? ' checked' : ''}>
                ${escapeHtml(t('admin.approximateShort'))}
              </label>
            </div>
            <div class="field" style="margin:0">
              <label class="field__label" for="edit-contributor">${escapeHtml(t('reader.toldBy'))}</label>
              <input type="text" id="edit-contributor" value="${escapeHtml(submission.contributor || '')}" placeholder="${escapeHtml(t('reader.anonymous'))}" maxlength="80">
            </div>
          </div>
          <p class="field__error" data-error-for="period"></p>
          <p class="field__error" data-error-for="place.point"></p>
          <p class="field__error" data-error-for="place.name"></p>
        </div>

        ${mapBlockHtml(260)}

        ${fields}
      </div>

      <div class="review-actions">
        <button type="button" class="btn btn--primary" data-action="save">${escapeHtml(t('admin.save'))}</button>
        <button type="button" class="btn btn--ghost" data-action="cancel-edit">${escapeHtml(t('admin.cancel'))}</button>
      </div>`;
  }

  function collectEdit() {
    const answers = {};
    document.querySelectorAll('[data-answer]').forEach((node) => {
      answers[node.dataset.answer] = node.value;
    });
    for (const question of state.questions) {
      if (!isChoice(question)) continue;
      const chosen = [...document.querySelectorAll(`[data-answer-choice="${CSS.escape(question.id)}"]:checked`)]
        .map((node) => node.value);
      answers[question.id] = question.type === 'multiselect' ? chosen : (chosen[0] || '');
    }
    const translation = {};
    document.querySelectorAll('[data-translation]').forEach((node) => {
      translation[node.dataset.translation] = node.value;
    });

    return {
      translation: {
        answers: translation,
        placeName: $('edit-place-translated') ? $('edit-place-translated').value : null,
      },
      answers,
      place: {
        name: $('edit-place').value,
        lat: Number($('edit-lat').value),
        lng: Number($('edit-lng').value),
        approximate: $('edit-approximate') ? $('edit-approximate').checked : false,
      },
      period: {
        start: $('edit-start').value,
        end: $('edit-end').value,
        precision: $('edit-precision').value,
        startTime: $('edit-start-time') ? $('edit-start-time').value : null,
        endTime: $('edit-end-time') ? $('edit-end-time').value : null,
      },
      contributor: { name: $('edit-contributor').value, email: null },
    };
  }

  /** The API sends a translatable `code` beside its English `message`. */
  function errorText(error) {
    if (!error.code) return error.message;
    const translated = t(error.code, error.params);
    return translated === error.code ? error.message : translated;
  }

  function showEditErrors(errors) {
    document.querySelectorAll('[data-error-for]').forEach((node) => {
      node.textContent = '';
      node.style.display = '';
    });
    for (const error of errors) {
      const node = document.querySelector(`[data-error-for="${CSS.escape(error.field)}"]`);
      if (!node) continue;
      node.textContent = errorText(error);
      node.style.display = 'block';
    }
  }

  /* -------------------------------- actions ------------------------------ */

  async function setStatus(submission, status) {
    const toastKey = {
      approved: 'admin.published', rejected: 'admin.declined', pending: 'admin.movedBack',
    }[status];
    let note = null;
    if (status === 'rejected') {
      note = prompt(t('admin.declineReason')) || null;
    }
    try {
      await api(`/api/admin/submissions/${encodeURIComponent(submission.id)}/status`, {
        method: 'POST',
        body: { status, note },
      });
      toast(t(toastKey));
      await refresh(false);
    } catch (error) {
      toast(error.message, 'error');
    }
  }

  function wireDetail(submission) {
    detailEl().querySelectorAll('[data-action]').forEach((button) => {
      button.addEventListener('click', async () => {
        const action = button.dataset.action;

        if (action === 'approve') return setStatus(submission, 'approved');
        if (action === 'reject') return setStatus(submission, 'rejected');
        if (action === 'pending') return setStatus(submission, 'pending');

        if (action === 'delete') {
          if (!confirm(t('admin.confirmDelete', { title: title(submission) }))) return;
          try {
            await api(`/api/admin/submissions/${encodeURIComponent(submission.id)}`, { method: 'DELETE' });
            toast(t('admin.deleted'));
            state.selectedId = null;
            await refresh(false);
          } catch (error) {
            toast(error.message, 'error');
          }
          return undefined;
        }

        if (action === 'retranslate') {
          if (!confirm(t('admin.retranslateWarning'))) return undefined;
          button.disabled = true;
          const original = button.textContent;
          button.textContent = t('admin.translating');
          try {
            await api(`/api/admin/submissions/${encodeURIComponent(submission.id)}/translate`, { method: 'POST' });
            toast(t('admin.translated'));
            await refresh(false);
            const updated = state.submissions.find((item) => item.id === submission.id);
            if (updated) renderDetail(updated);
          } catch (error) {
            toast(error.message, 'error');
            button.disabled = false;
            button.textContent = original;
          }
          return undefined;
        }

        if (action === 'edit') {
          state.editing = true;
          detailEl().innerHTML = editHtml(submission);
          detailEl().scrollTop = 0;
          mountDetailMap(submission, true);
          wireDetail(submission);
          return undefined;
        }

        if (action === 'cancel-edit') {
          renderDetail(submission);
          return undefined;
        }

        if (action === 'save') {
          try {
            const result = await api(`/api/admin/submissions/${encodeURIComponent(submission.id)}`, {
              method: 'PUT',
              body: collectEdit(),
            });
            toast(t('admin.saved'));
            state.selectedId = result.submission.id;
            await refresh(false);
            renderDetail(result.submission);
          } catch (error) {
            showEditErrors(error.errors || []);
            toast(error.message, 'error');
          }
        }
        return undefined;
      });
    });
  }

  function wireShell() {
    $('tabs').addEventListener('click', async (event) => {
      const tab = event.target.closest('.tab');
      if (!tab) return;
      document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('is-active', t === tab));
      state.status = tab.dataset.status;
      state.selectedId = null;
      await refresh(false);
    });

    queueEl().addEventListener('click', (event) => {
      const card = event.target.closest('.card');
      if (!card) return;
      const submission = state.submissions.find((s) => s.id === card.dataset.id);
      if (submission) renderDetail(submission);
    });

    $('logout').addEventListener('click', async () => {
      await api('/api/admin/logout', { method: 'POST' });
      location.reload();
    });
  }

  /* --------------------------------- boot -------------------------------- */

  $('login-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    $('login-error').textContent = '';
    try {
      await api('/api/admin/login', { method: 'POST', body: { password: $('password').value } });
      await showApp();
    } catch (error) {
      $('login-error').textContent = error.message;
      $('login-error').style.display = 'block';
    }
  });

  api('/api/admin/session')
    .then((session) => (session.authenticated ? showApp() : showLogin()))
    .catch(() => showLogin());
}());
