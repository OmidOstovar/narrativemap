/* The moderation queue: read submissions, correct them, publish or decline. */
(function () {
  'use strict';

  const { api, escapeHtml, paragraphs, dirFor, formatPeriod, formatPeriodJalali,
          formatYears, formatTimestamp, toast } = window.NM;

  const state = {
    questions: [],
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

  const title = (s) => s.answers.title || 'Untitled narrative';

  /* -------------------------------- session ------------------------------ */

  async function showApp() {
    $('login-view').hidden = true;
    $('admin-view').hidden = false;
    $('logout').hidden = false;

    const meta = await api('/api/questions');
    state.questions = meta.questions;
    state.yearRange = meta.yearRange;

    wireShell();
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
      if (node) node.textContent = count;
    }

    renderQueue();

    if (keepSelection && state.selectedId
        && state.submissions.some((s) => s.id === state.selectedId)) {
      renderDetail(state.submissions.find((s) => s.id === state.selectedId));
    } else if (!state.submissions.some((s) => s.id === state.selectedId)) {
      state.selectedId = null;
      detailEl().innerHTML = `
        <div class="empty-state" style="padding-top:20vh">
          <strong>Nothing selected.</strong>
          Pick a submission from the queue to read it.
        </div>`;
    }
  }

  function renderQueue() {
    if (!state.submissions.length) {
      const messages = {
        pending: ['Queue is empty.', 'Every submission has been dealt with.'],
        approved: ['Nothing published yet.', 'Approved narratives show up here.'],
        rejected: ['Nothing declined.', ''],
      };
      const [heading, note] = messages[state.status] || ['Nothing here.', ''];
      queueEl().innerHTML = `<li class="empty-state"><strong>${heading}</strong>${escapeHtml(note)}</li>`;
      return;
    }

    queueEl().innerHTML = state.submissions.map((s) => `
      <li>
        <button class="card${s.id === state.selectedId ? ' is-active' : ''}" data-id="${escapeHtml(s.id)}">
          <span class="card__title" dir="${dirFor(title(s))}">${escapeHtml(title(s))}</span>
          <span class="card__meta">
            <span class="place">${escapeHtml(s.place.name)}</span>
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
        <h3>Moderator only — never shown publicly</h3>
        <dl>
          <dt>Reference</dt><dd>${escapeHtml(submission.id)}</dd>
          <dt>Submitted</dt><dd>${escapeHtml(formatTimestamp(submission.submittedAt))}</dd>
          <dt>Contact</dt><dd>${priv.email ? `<a href="mailto:${escapeHtml(priv.email)}">${escapeHtml(priv.email)}</a>` : 'none given'}</dd>
          ${priv.reviewedAt ? `<dt>Reviewed</dt><dd>${escapeHtml(formatTimestamp(priv.reviewedAt))}</dd>` : ''}
          ${priv.reviewNote ? `<dt>Note</dt><dd>${escapeHtml(priv.reviewNote)}</dd>` : ''}
        </dl>
      </div>`;
  }

  function detailHtml(submission) {
    const jalali = formatPeriodJalali(submission.period);
    const answers = state.questions
      .filter((q) => q.id !== 'title' && submission.answers[q.id])
      .map((q) => {
        const value = submission.answers[q.id];
        const isChip = q.type === 'select';
        return `
          <section class="qa${isChip ? ' qa--chip' : ''}">
            <h3 class="qa__q">${escapeHtml(q.label)}</h3>
            <div class="qa__a" dir="${dirFor(value)}">${isChip ? escapeHtml(value) : paragraphs(value)}</div>
          </section>`;
      }).join('');

    const unanswered = state.questions.filter((q) => q.id !== 'title' && !submission.answers[q.id]);

    return `
      <div class="reader__body" style="padding:32px 40px 24px">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:18px">
          <span class="badge badge--${escapeHtml(submission.status)}">${escapeHtml(submission.status)}</span>
          ${submission.status === 'approved'
            ? `<a href="/?n=${encodeURIComponent(submission.id)}" target="_blank" rel="noopener" style="font-size:13px">View on the public map ↗</a>`
            : ''}
        </div>

        ${privateBlock(submission)}

        <h1 class="reader__title" dir="${dirFor(title(submission))}">${escapeHtml(title(submission))}</h1>

        <dl class="reader__facts">
          <dt>Place</dt>
          <dd>
            ${escapeHtml(submission.place.name)}
            ${submission.place.province ? `<span class="secondary"> · ${escapeHtml(submission.place.province)}</span>` : ''}
            <div class="secondary">${submission.place.lat.toFixed(5)}, ${submission.place.lng.toFixed(5)}</div>
          </dd>
          <dt>When</dt>
          <dd>
            ${escapeHtml(formatPeriod(submission.period))}
            ${jalali ? `<div class="secondary">${escapeHtml(jalali)} (Solar Hijri)</div>` : ''}
          </dd>
          <dt>Told by</dt>
          <dd>${escapeHtml(submission.contributor || 'Anonymous')}</dd>
        </dl>

        ${mapBlockHtml(220)}

        ${answers}

        ${unanswered.length ? `
          <p style="color:var(--text-faint);font-size:13px;border-top:1px solid var(--ink-600);padding-top:16px">
            Left blank: ${unanswered.map((q) => escapeHtml(q.label)).join(' · ')}
          </p>` : ''}
      </div>

      <div class="review-actions">
        ${submission.status !== 'approved'
          ? '<button type="button" class="btn btn--approve" data-action="approve">Publish to the map</button>'
          : '<button type="button" class="btn" data-action="pending">Unpublish</button>'}
        ${submission.status !== 'rejected'
          ? '<button type="button" class="btn" data-action="reject">Decline</button>'
          : '<button type="button" class="btn" data-action="pending">Move back to pending</button>'}
        <button type="button" class="btn" data-action="edit">Edit details</button>
        <span class="spacer"></span>
        <button type="button" class="btn btn--danger" data-action="delete">Delete</button>
      </div>`;
  }

  /** Map used to check where a submission is actually pinned. */
  function mapBlockHtml(height) {
    return `
      <div style="margin-bottom:32px">
        <label class="map-toggle" style="box-shadow:none;margin-bottom:8px">
          <input type="checkbox" id="detail-tiles"> Street detail — check the pin against real streets
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
            const { province } = await window.NMMap.locate(position.lat, position.lng);
            const provinceNode = document.getElementById('edit-province');
            if (provinceNode) provinceNode.textContent = province || 'outside the province layer';
          });
        }
      })
      .catch(() => { host.remove(); });
  }

  /* ------------------------------- editing ------------------------------- */

  function editHtml(submission) {
    const fields = state.questions.map((q) => {
      const value = submission.answers[q.id] || '';
      const control = q.type === 'select'
        ? `<select data-answer="${escapeHtml(q.id)}">
             <option value="">— no answer —</option>
             ${q.options.map((o) => `<option value="${escapeHtml(o)}"${o === value ? ' selected' : ''}>${escapeHtml(o)}</option>`).join('')}
           </select>`
        : q.type === 'text'
          ? `<input type="text" data-answer="${escapeHtml(q.id)}" value="${escapeHtml(value)}" maxlength="${q.maxLength || 200}">`
          : `<textarea data-answer="${escapeHtml(q.id)}" rows="${Math.min(q.rows || 5, 10)}" maxlength="${q.maxLength || 5000}">${escapeHtml(value)}</textarea>`;
      return `
        <div class="field">
          <label class="field__label">${escapeHtml(q.label)}${q.required ? '' : '<span class="field__optional">optional</span>'}</label>
          ${control}
          <p class="field__error" data-error-for="${escapeHtml(q.id)}"></p>
        </div>`;
    }).join('');

    return `
      <div class="reader__body" style="padding:32px 40px 24px">
        <h2 class="section__title" style="margin-bottom:20px">Editing “${escapeHtml(title(submission))}”</h2>
        <p class="section__note">
          Fix typos, tighten a place name, or move a misplaced pin. Changes are saved
          to the submission itself, so a published narrative updates on the map.
        </p>

        <div class="private-note" style="border-style:solid">
          <h3>Place and time</h3>
          <div class="edit-grid" style="margin-top:12px">
            <div class="field" style="margin:0">
              <label class="field__label" for="edit-place">Place name</label>
              <input type="text" id="edit-place" value="${escapeHtml(submission.place.name)}" maxlength="160">
            </div>
            <div class="field" style="margin:0">
              <label class="field__label" for="edit-lat">Latitude</label>
              <input type="number" id="edit-lat" step="0.00001" value="${submission.place.lat}">
            </div>
            <div class="field" style="margin:0">
              <label class="field__label" for="edit-lng">Longitude</label>
              <input type="number" id="edit-lng" step="0.00001" value="${submission.place.lng}">
            </div>
          </div>
          <p style="margin:10px 0 0;font-size:13px">
            Province: <span id="edit-province" style="color:var(--text)">${escapeHtml(submission.place.province || 'unknown')}</span>
            — drag the pin below to move it.
          </p>
          <div class="edit-grid" style="margin-top:14px">
            <div class="field" style="margin:0">
              <label class="field__label" for="edit-start">Period start</label>
              <input type="date" id="edit-start" value="${escapeHtml(submission.period.start)}">
            </div>
            <div class="field" style="margin:0">
              <label class="field__label" for="edit-end">Period end</label>
              <input type="date" id="edit-end" value="${escapeHtml(submission.period.end)}">
            </div>
            <div class="field" style="margin:0">
              <label class="field__label" for="edit-precision">Shown as</label>
              <select id="edit-precision">
                ${['year', 'month', 'day'].map((p) => `<option value="${p}"${p === submission.period.precision ? ' selected' : ''}>To the ${p}</option>`).join('')}
              </select>
            </div>
            <div class="field" style="margin:0">
              <label class="field__label" for="edit-contributor">Told by</label>
              <input type="text" id="edit-contributor" value="${escapeHtml(submission.contributor || '')}" placeholder="Anonymous" maxlength="80">
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
        <button type="button" class="btn btn--primary" data-action="save">Save changes</button>
        <button type="button" class="btn btn--ghost" data-action="cancel-edit">Cancel</button>
      </div>`;
  }

  function collectEdit() {
    const answers = {};
    document.querySelectorAll('[data-answer]').forEach((node) => {
      answers[node.dataset.answer] = node.value;
    });
    return {
      answers,
      place: {
        name: $('edit-place').value,
        lat: Number($('edit-lat').value),
        lng: Number($('edit-lng').value),
      },
      period: {
        start: $('edit-start').value,
        end: $('edit-end').value,
        precision: $('edit-precision').value,
      },
      contributor: { name: $('edit-contributor').value, email: null },
    };
  }

  function showEditErrors(errors) {
    document.querySelectorAll('[data-error-for]').forEach((node) => {
      node.textContent = '';
      node.style.display = '';
    });
    for (const error of errors) {
      const node = document.querySelector(`[data-error-for="${CSS.escape(error.field)}"]`);
      if (!node) continue;
      node.textContent = error.message;
      node.style.display = 'block';
    }
  }

  /* -------------------------------- actions ------------------------------ */

  async function setStatus(submission, status) {
    const labels = { approved: 'published', rejected: 'declined', pending: 'moved back to pending' };
    let note = null;
    if (status === 'rejected') {
      note = prompt('Why is this being declined? (private note, optional)') || null;
    }
    try {
      await api(`/api/admin/submissions/${encodeURIComponent(submission.id)}/status`, {
        method: 'POST',
        body: { status, note },
      });
      toast(`Narrative ${labels[status]}.`);
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
          if (!confirm(`Delete “${title(submission)}” permanently? This cannot be undone.`)) return;
          try {
            await api(`/api/admin/submissions/${encodeURIComponent(submission.id)}`, { method: 'DELETE' });
            toast('Submission deleted.');
            state.selectedId = null;
            await refresh(false);
          } catch (error) {
            toast(error.message, 'error');
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
            toast('Changes saved.');
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
