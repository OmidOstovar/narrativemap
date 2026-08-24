/* Shared helpers: API calls, escaping, date formatting, toasts. */
(function (global) {
  'use strict';

  /* ------------------------------- fetch --------------------------------- */

  async function api(path, options) {
    const opts = Object.assign({ headers: {} }, options);
    if (opts.body !== undefined && typeof opts.body !== 'string') {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(opts.body);
    }
    const response = await fetch(path, opts);
    const text = await response.text();
    let payload = null;
    try { payload = text ? JSON.parse(text) : null; } catch { /* non-JSON */ }

    if (!response.ok) {
      const error = new Error((payload && payload.error) || `Request failed (${response.status}).`);
      error.status = response.status;
      error.errors = (payload && payload.errors) || [];
      throw error;
    }
    return payload;
  }

  /* ------------------------------ escaping ------------------------------- */

  const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, (c) => ESCAPES[c]);
  }

  /** Renders user text as paragraphs, preserving blank-line breaks. */
  function paragraphs(text) {
    return String(text || '')
      .split(/\n{2,}/)
      .map((block) => block.trim())
      .filter(Boolean)
      .map((block) => `<p>${escapeHtml(block).replace(/\n/g, '<br>')}</p>`)
      .join('');
  }

  const RTL_PATTERN = /[؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿]/;

  /** Persian and Arabic answers need to render right-to-left. */
  function dirFor(text) {
    return RTL_PATTERN.test(String(text || '')) ? 'rtl' : 'ltr';
  }

  /* ------------------------------- dates --------------------------------- */

  const GREGORIAN_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];

  function parts(iso) {
    const [y, m, d] = String(iso).split('-').map(Number);
    return { y, m, d };
  }

  function gregorianPoint(iso, precision) {
    const { y, m, d } = parts(iso);
    if (precision === 'year') return String(y);
    if (precision === 'month') return `${GREGORIAN_MONTHS[m - 1]} ${y}`;
    return `${d} ${GREGORIAN_MONTHS[m - 1]} ${y}`;
  }

  function jalaliPoint(iso, precision) {
    const j = global.Jalali && global.Jalali.fromISO(iso);
    if (!j) return null;
    if (precision === 'year') return String(j.jy);
    if (precision === 'month') return `${j.month} ${j.jy}`;
    return `${j.jd} ${j.month} ${j.jy}`;
  }

  function formatPeriod(period) {
    if (!period) return '';
    const a = gregorianPoint(period.start, period.precision);
    const b = gregorianPoint(period.end, period.precision);
    return a === b ? a : `${a} – ${b}`;
  }

  function formatPeriodJalali(period) {
    if (!period) return null;
    const a = jalaliPoint(period.start, period.precision);
    const b = jalaliPoint(period.end, period.precision);
    if (!a || !b) return null;
    return a === b ? a : `${a} – ${b}`;
  }

  /** Compact form for list cards: years only. */
  function formatYears(period) {
    if (!period) return '';
    const from = period.start.slice(0, 4);
    const to = period.end.slice(0, 4);
    return from === to ? from : `${from}–${to}`;
  }

  function formatTimestamp(iso) {
    if (!iso) return '';
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleString(undefined, {
      year: 'numeric', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  }

  /* ------------------------------- toasts -------------------------------- */

  function toastContainer() {
    let node = document.querySelector('.toasts');
    if (!node) {
      node = document.createElement('div');
      node.className = 'toasts';
      node.setAttribute('role', 'status');
      node.setAttribute('aria-live', 'polite');
      document.body.appendChild(node);
    }
    return node;
  }

  function toast(message, kind) {
    const node = document.createElement('div');
    node.className = kind === 'error' ? 'toast toast--error' : 'toast';
    node.textContent = message;
    toastContainer().appendChild(node);
    setTimeout(() => {
      node.style.transition = 'opacity 200ms ease';
      node.style.opacity = '0';
      setTimeout(() => node.remove(), 220);
    }, kind === 'error' ? 5200 : 3400);
  }

  /* ------------------------------- misc ---------------------------------- */

  function debounce(fn, wait) {
    let timer = null;
    return function debounced(...args) {
      clearTimeout(timer);
      timer = setTimeout(() => fn.apply(this, args), wait);
    };
  }

  /** Marks the current page in the header nav. */
  function markActiveNav() {
    const here = location.pathname.replace(/\/$/, '') || '/';
    document.querySelectorAll('.site-nav a').forEach((link) => {
      const target = new URL(link.href, location.origin).pathname.replace(/\/$/, '') || '/';
      if (target === here) link.classList.add('is-active');
    });
  }

  document.addEventListener('DOMContentLoaded', markActiveNav);

  global.NM = {
    api, escapeHtml, paragraphs, dirFor,
    formatPeriod, formatPeriodJalali, formatYears, formatTimestamp,
    gregorianPoint, jalaliPoint,
    toast, debounce,
  };
}(window));
