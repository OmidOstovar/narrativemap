/**
 * Gregorian <-> Jalaali (Solar Hijri) conversion.
 *
 * Implements the algorithm from Kazimierz M. Borkowski's "The Persian
 * calendar for 3000 years", as used by the jalaali-js library. Dates on this
 * map are stored as Gregorian ISO strings; this is display only.
 */
(function (global) {
  'use strict';

  // Years at which the 33-year leap cycle pattern shifts.
  var BREAKS = [-61, 9, 38, 199, 426, 686, 756, 818, 1111, 1181, 1210,
                1635, 2060, 2097, 2192, 2262, 2324, 2394, 2456, 3178];

  var MONTHS = {
    en: ['Farvardin', 'Ordibehesht', 'Khordad', 'Tir', 'Mordad',
         'Shahrivar', 'Mehr', 'Aban', 'Azar', 'Dey', 'Bahman', 'Esfand'],
    fa: ['فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد',
         'شهریور', 'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند'],
  };

  function div(a, b) { return Math.trunc(a / b); }
  function mod(a, b) { return a - b * Math.floor(a / b); }

  /** Leap-year data and the Gregorian date of Nowruz for a Jalaali year. */
  function jalCal(jy) {
    var bl = BREAKS.length;
    var gy = jy + 621;
    var leapJ = -14;
    var jp = BREAKS[0];
    var jm, jump, leap, leapG, march, n, i;

    if (jy < jp || jy >= BREAKS[bl - 1]) return null;

    for (i = 1; i < bl; i += 1) {
      jm = BREAKS[i];
      jump = jm - jp;
      if (jy < jm) break;
      leapJ = leapJ + div(jump, 33) * 8 + div(mod(jump, 33), 4);
      jp = jm;
    }
    n = jy - jp;

    leapJ = leapJ + div(n, 33) * 8 + div(mod(n, 33) + 3, 4);
    if (mod(jump, 33) === 4 && jump - n === 4) leapJ += 1;

    leapG = div(gy, 4) - div((div(gy, 100) + 1) * 3, 4) - 150;
    march = 20 + leapJ - leapG;

    if (jump - n < 6) n = n - jump + div(jump + 4, 33) * 33;
    leap = mod(mod(n + 1, 33) - 1, 4);
    if (leap === -1) leap = 4;

    return { leap: leap, gy: gy, march: march };
  }

  /** Gregorian date -> Julian Day Number. */
  function g2d(gy, gm, gd) {
    var d = div((gy + div(gm - 8, 6) + 100100) * 1461, 4)
          + div(153 * mod(gm + 9, 12) + 2, 5)
          + gd - 34840408;
    return d - div(div(gy + 100100 + div(gm - 8, 6), 100) * 3, 4) + 752;
  }

  /** Julian Day Number -> Gregorian date. */
  function d2g(jdn) {
    var j = 4 * jdn + 139361631;
    j = j + div(div(4 * jdn + 183187720, 146097) * 3, 4) * 4 - 3908;
    var i = div(mod(j, 1461), 4) * 5 + 308;
    var gd = div(mod(i, 153), 5) + 1;
    var gm = mod(div(i, 153), 12) + 1;
    var gy = div(j, 1461) - 100100 + div(8 - gm, 6);
    return { gy: gy, gm: gm, gd: gd };
  }

  /** Julian Day Number -> Jalaali date. */
  function d2j(jdn) {
    var gy = d2g(jdn).gy;
    var jy = gy - 621;
    var r = jalCal(jy);
    if (!r) return null;
    var jdn1f = g2d(gy, 3, r.march);
    var k = jdn - jdn1f;
    var jm, jd;

    if (k >= 0) {
      if (k <= 185) {
        return { jy: jy, jm: 1 + div(k, 31), jd: mod(k, 31) + 1 };
      }
      k -= 186;
    } else {
      jy -= 1;
      k += 179;
      if (jalCal(jy).leap === 1) k += 1;
    }
    jm = 7 + div(k, 30);
    jd = mod(k, 30) + 1;
    return { jy: jy, jm: jm, jd: jd };
  }

  /** Jalaali date -> Julian Day Number. */
  function j2d(jy, jm, jd) {
    var r = jalCal(jy);
    if (!r) return null;
    return g2d(r.gy, 3, r.march) + (jm - 1) * 31 - div(jm, 7) * (jm - 7) + jd - 1;
  }

  /** Days in a Jalaali month; Esfand is 30 only in a leap year. */
  function daysInMonth(jy, jm) {
    if (jm <= 6) return 31;
    if (jm <= 11) return 30;
    var r = jalCal(jy);
    return r && r.leap === 0 ? 30 : 29;
  }

  function isValid(jy, jm, jd) {
    if (!Number.isInteger(jy) || !Number.isInteger(jm) || !Number.isInteger(jd)) return false;
    if (jm < 1 || jm > 12 || jd < 1) return false;
    return jd <= daysInMonth(jy, jm);
  }

  function pad(n) { return (n < 10 ? '0' : '') + n; }

  /** Jalaali date -> Gregorian ISO 'YYYY-MM-DD', or null if the date is unreal. */
  function toISO(jy, jm, jd) {
    if (!isValid(jy, jm, jd)) return null;
    var jdn = j2d(jy, jm, jd);
    if (jdn === null) return null;
    var g = d2g(jdn);
    return g.gy + '-' + pad(g.gm) + '-' + pad(g.gd);
  }

  /**
   * Converts an ISO 'YYYY-MM-DD' string to { jy, jm, jd, month }.
   * `lang` selects the script the month name is written in.
   */
  function fromISO(iso, lang) {
    var parts = String(iso).split('-');
    if (parts.length !== 3) return null;
    var result = d2j(g2d(Number(parts[0]), Number(parts[1]), Number(parts[2])));
    if (!result) return null;
    var names = MONTHS[lang === 'fa' ? 'fa' : 'en'];
    result.month = names[result.jm - 1];
    return result;
  }

  global.Jalali = {
    fromISO: fromISO,
    toISO: toISO,
    daysInMonth: daysInMonth,
    isValid: isValid,
    MONTHS: MONTHS,
  };
}(typeof window !== 'undefined' ? window : globalThis));
