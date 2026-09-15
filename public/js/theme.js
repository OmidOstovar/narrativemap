/**
 * Dark or light, chosen by the reader and remembered.
 *
 * The archive reads as paper by default, a stock per section. The dark theme is
 * what it opened with, kept one click away for anyone who prefers it.
 *
 * The choice is applied before the first paint by a few lines in each page's
 * head, so nothing flashes; this file only builds the switch and handles the
 * change. Nothing about the choice leaves the browser: it is a word in local
 * storage, never sent anywhere and never stored against a reader.
 */
(function (global) {
  'use strict';

  /*
   * The key carries a number, and the number was raised when paper became the
   * default: a reader who tried the dark theme back when it was the default had
   * that choice written down, and would have gone on seeing it for good. Raising
   * the key sets everyone back to the default once. Anyone who wants dark is one
   * press away, and this time it is remembered under the new name.
   */
  const STORAGE_KEY = 'nm_theme2';
  const THEMES = ['dark', 'light'];
  const listeners = new Set();

  function stored() {
    try {
      const value = localStorage.getItem(STORAGE_KEY);
      return THEMES.indexOf(value) >= 0 ? value : null;
    } catch (error) {
      return null; // Storage blocked; the default stands.
    }
  }

  function current() {
    return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
  }

  function apply(theme) {
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem(STORAGE_KEY, theme); } catch (error) { /* nothing to do */ }
    listeners.forEach((fn) => fn(theme));
  }

  function set(theme) {
    if (THEMES.indexOf(theme) < 0 || theme === current()) return;
    apply(theme);
  }

  function toggle() { apply(current() === 'light' ? 'dark' : 'light'); }

  /** Called whenever the theme changes — the map repaints itself this way. */
  function onChange(fn) { listeners.add(fn); }

  function label() {
    const t = global.I18N ? global.I18N.t : (key) => key;
    return current() === 'dark' ? t('theme.toLight') : t('theme.toDark');
  }

  /** The switch, beside the one for the language. */
  function init() {
    const nav = document.querySelector('.site-nav');
    if (!nav || nav.querySelector('.theme-toggle')) return;

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'theme-toggle';
    button.addEventListener('click', toggle);

    const paint = () => {
      button.textContent = label();
      button.setAttribute('aria-label', global.I18N ? global.I18N.t('theme.label') : 'Theme');
      button.setAttribute('aria-pressed', String(current() === 'dark'));
    };
    if (global.I18N && global.I18N.onChange) global.I18N.onChange(paint);
    onChange(paint);
    paint();

    // After the language switch, so the two sit together at the end of the bar.
    nav.appendChild(button);
  }

  global.THEME = { current, set, toggle, onChange, init, THEMES, stored };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
}(window));
