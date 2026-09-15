'use strict';

/**
 * The illuminated margins down the sides of the reading pages, and the setting
 * that governs them.
 *
 * This is CSS rather than a stylesheet file because the choice belongs to
 * whoever runs the archive, not to whoever edits the code: MARGINS in the
 * environment decides, and a redeploy is the whole of the change. There is no
 * flash and no JavaScript in it — the page links this like any stylesheet and
 * the browser has the answer before it paints.
 *
 *   MARGINS=photo   the photographed manuscript margins (the default)
 *   MARGINS=drawn   a vine drawn for this archive, in the same manner
 *   MARGINS=off     no margins at all
 *
 *   MARGIN_WIDTH=124px     how much of the margin shows
 *   MARGIN_MIN_PAGE=1120px  the width below which the narrow margins take over
 *   MARGIN_NARROW=16px      how much shows on a phone — enough for the ruled
 *                           edge, which is what a page has even when there is
 *                           no room for what is drawn beside it
 */

const SETTINGS = ['photo', 'drawn', 'off'];

function setting(name, fallback) {
  const value = (process.env[name] || '').trim();
  return value || fallback;
}

/** A length from the environment, refused unless it plainly is one. */
function length(name, fallback) {
  const value = setting(name, '');
  return /^\d+(\.\d+)?(px|rem|em|vw|ch)$/.test(value) ? value : fallback;
}

function which() {
  const asked = setting('MARGINS', 'photo').toLowerCase();
  return SETTINGS.includes(asked) ? asked : 'photo';
}

/**
 * The frame common to both kinds: fixed to the window rather than placed in the
 * flow, so a margin does not scroll away from the text it is margin to, and so
 * it costs the reading column no width at all.
 */
function frame(width, minPage, narrow, sides, narrowSides) {
  return `.page::before,
.page::after {
  content: '';
  position: fixed;
  /*
   * The full height of the window, not from under the header down. The header
   * scrolls away and is drawn above these, so while it is on screen it covers
   * their top; once it has gone, the margin runs the whole height and the page
   * passes behind it — rather than leaving a strip at the top where text slid
   * past the edge of the page it is printed on.
   */
  top: 0;
  bottom: 0;
  width: ${width};
  pointer-events: none;
  z-index: 1;
}

${sides}

/*
 * On a narrow window there is no room for the drawing, but there is room for
 * the edge of the page — and the column is given side room to clear it rather
 * than running underneath.
 */
@media (max-width: ${minPage}) {
  .page::before,
  .page::after { width: ${narrow}; }

  .page { padding-inline: calc(${narrow} + 16px); }

${narrowSides}
}
`;
}

/*
 * A photograph of a manuscript page, cropped at the column where the
 * decoration stops and otherwise untouched. One copy covers the full height:
 * tiled, the join shows as a break straight across the page. Each side is
 * anchored to its ruled edge so the frame always meets the text, and what the
 * window cannot fit runs off the outer edge — which is what the edge of a page
 * does anyway.
 */
const PHOTO = `.page::before,
.page::after {
  background-repeat: no-repeat;
  background-size: cover;
}
.page::before {
  left: 0;
  background-image: url('/img/margin-left.jpg');
  background-position: right center;
}
.page::after {
  right: 0;
  background-image: url('/img/margin-right.jpg');
  background-position: left center;
}`;

/*
 * The same idea drawn rather than photographed: a vine turning on itself with
 * palmettes at the turns, on a deep ground, and the jadval — the ruled frame of
 * a manuscript page — on the inner edge in gold, coral and ink. It tiles, so it
 * suits any height, and it weighs two kilobytes.
 */
const RULES = `var(--gold, #c8a04a) 0 1px,
      transparent 1px 2.6px,
      var(--rule-coral, #b5624a) 2.6px 3.4px,
      transparent 3.4px 4.3px,
      var(--rule-slate, #4d5a72) 4.3px 5px`;

const DRAWN = `.page::before,
.page::after {
  background-repeat: no-repeat, repeat-y, no-repeat;
  background-size: 5px 100%, 34px 108px, 100% 100%;
}
.page::before {
  left: 0;
  background-image:
    linear-gradient(to left, ${RULES}),
    url('/img/jadval-band.svg'),
    linear-gradient(to bottom, #3a251e, #2a1a16 55%, #35211b);
  background-position: right center, left 2px top, center;
}
.page::after {
  right: 0;
  background-image:
    linear-gradient(to right, ${RULES}),
    url('/img/jadval-band.svg'),
    linear-gradient(to bottom, #3a251e, #2a1a16 55%, #35211b);
  background-position: left center, right 2px top, center;
}`;

/*
 * A woven border for a phone. The manuscript margin is a page's worth of
 * drawing and there is no room for it at this width; a carpet border is made
 * of a repeat, so it reads at any height and at the width of a thumb.
 */
const NARROW_PHOTO = `  .page::before,
  .page::after {
    background-image: url('/img/mobile-border.jpg');
    background-position: center top;
    background-repeat: repeat-y;
    background-size: 100% auto;
  }`;

function css() {
  const chosen = which();
  const head = `/* Illuminated margins: MARGINS=${chosen}. See src/margins.js. */\n`;
  if (chosen === 'off') return `${head}/* Switched off. */\n`;

  return head + frame(
    length('MARGIN_WIDTH', chosen === 'photo' ? '124px' : '38px'),
    length('MARGIN_MIN_PAGE', chosen === 'photo' ? '1120px' : '980px'),
    length('MARGIN_NARROW', chosen === 'photo' ? '22px' : '16px'),
    chosen === 'photo' ? PHOTO : DRAWN,
    chosen === 'photo' ? NARROW_PHOTO : '',
  );
}

module.exports = { css, which, SETTINGS };
