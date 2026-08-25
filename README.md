# Narrative Map — Iran

A map of Iran built from first-hand narratives. Each narrative is one person's
account, anchored to an **exact place** (a pin, to about a metre) and a **period
of time** (a start and an end, at whatever precision the contributor actually
has). Anyone can submit one; nothing appears on the public map until a moderator
has read it and accepted it.

Every narrative is a set of answers to the same questionnaire, so accounts from
very different people stay readable side by side.

## Running it

```bash
npm install
npm run seed     # optional: twelve sample narratives so the map is not empty
npm start
```

Then open <http://localhost:3000>. The review queue is at
<http://localhost:3000/admin>.

On first start, if `ADMIN_PASSWORD` is not set, the server generates a password,
prints it once, and stores it in `data/.admin-password`. Set your own in a `.env`
or the environment to override it. Requires Node 22.5 or newer (it uses the
built-in `node:sqlite`).

```bash
npm test         # 22 API tests over a throwaway database
npm run dev      # restart on file changes
```

## How it fits together

```
server.js              Express app: public API, admin API, static files
src/questions.js       The questionnaire — the single source of truth
src/validate.js        Validates a submission (answers, place, period, contributor)
src/db.js              SQLite schema and queries
src/geo.js             Point-in-polygon: is the pin in Iran, and in which province
src/auth.js            Moderator password, signed session cookie, rate limiting
public/                index (map) · submit · admin · about, plus CSS and JS
public/data/           Iran's outline and 31 provinces, bundled
scripts/seed.js        Sample narratives
scripts/build-geo.js   Regenerates public/data/iran.geo.json from source data
test/api.test.js       End-to-end API tests
```

### Languages

The interface is English and Persian, switched by a toggle in the header and
remembered per visitor in `localStorage`. The starting language follows the
browser (`?lang=fa` forces it for one visit).

All interface text lives in `public/js/i18n.js` as `{ en, fa }` pairs. Static
markup is tagged `data-i18n="key"` (or `data-i18n-placeholder`, `-label`,
`-html`); anything rendered from JavaScript calls `t(key, params)`. Views that
have to redraw on a switch register with `I18N.onChange`.

Persian sets `dir="rtl"` on the document, which flips the sidebar and reading
panel automatically — CSS grid reverses column order on its own, so only things
anchored to a physical edge need the `[dir='rtl']` rules at the end of the
stylesheet. The timeline stays left-to-right in both languages because it is a
numeric axis, and coordinates are isolated so bidi does not reorder them.

Dates are stored as Gregorian ISO strings and shown in both calendars, leading
with the one the current language uses: Solar Hijri first in Persian, Gregorian
first in English. Month names are translated in both calendars.

Contributor text is separate from interface language: answers can be written in
either language, and Persian or Arabic is detected per answer and rendered
right-to-left even while the interface is in English.

### Changing the questions

Edit `src/questions.js`. The public form, the server-side validation, the
reading panel, and the moderator's edit view are all generated from that array,
so adding, reordering, or rewording a question needs no other change.

Every contributor-facing string in that file is an `{ en, fa }` pair, and
`select` options carry a stable `value` that is what actually gets stored — so an
answer chosen in English still renders in Persian for a Persian reader.

Keep the `id` of a question stable when you reword it — answers are stored keyed
by `id`, so renaming one orphans the answers already collected under the old
name. The same applies to an option's `value`. Removing a question hides its
answers from the site but leaves them in the database.

Two ids are special, set at the bottom of the file: `title` supplies the name
shown on pins and list cards, and `what_happened` supplies list previews and the
search snippet.

### The review flow

1. A visitor fills in the form at `/submit`. The submission is stored with
   status `pending` and is invisible to the public API.
2. The moderator signs in at `/admin` and reads it in full, along with the
   contributor's email if one was given.
3. **Publish** moves it to `approved` and it appears on the map immediately.
   **Decline** moves it to `rejected` with a private note. **Unpublish** takes a
   published narrative back off the map.
4. **Edit details** lets the moderator fix a typo, correct a place name, or drag
   a misplaced pin before or after publishing. Edits go through exactly the same
   validation as a public submission.

### What is public and what is not

The public API returns answers, place, period, and the contributor's chosen
display name. It never returns the contributor's email, the moderator's private
review note, review timestamps, or anything about pending and declined
submissions. There is a test asserting this.

## Notes on the map

The outline of Iran and its 31 provinces is bundled as GeoJSON and drawn
directly, so the map loads without any third-party request. Two optional
features do reach out, and both fail quietly if they cannot:

- the **Street detail** toggle loads OpenStreetMap raster tiles;
- the place search on the submission form uses Nominatim. If it is unavailable,
  the form says so and the contributor clicks the map instead.

The province attached to a narrative is derived from its coordinates rather than
being asked for, both in the browser (for instant feedback) and again on the
server (which is the authority). Pins outside Iran are rejected.

Periods are stored as Gregorian ISO dates and displayed in both the Gregorian
and the Solar Hijri calendar; the conversion is in `public/js/jalali.js`.
Persian and Arabic answers are detected and rendered right-to-left.

## Deploying to Railway

The repo carries `railway.json` and `.nvmrc`, so Railway builds it with no extra
setup. Two things are not optional:

**A volume.** The narratives live in a SQLite file on disk. Without a persistent
volume, Railway wipes it on every redeploy and every restart.

Volumes are attached from the **project canvas**, not from the service's Settings
tab: right-click the service tile and choose **Attach Volume** (the command
palette, Ctrl/Cmd-K, can also create one). Set the mount path to exactly:

```
/app/data
```

Railway's builder puts the code at `/app`, and the app writes its database to
`./data`, so that path is the directory it already uses — nothing else needs
changing. If **Attach Volume** does not appear, the service has more than one
replica; volumes require exactly one.

**Environment variables.** Set these in the service's Variables tab:

```
ADMIN_PASSWORD   = a long password you choose
SESSION_SECRET   = a long random string
COOKIE_SECURE    = true
TRUST_PROXY      = true
NODE_ENV         = production
```

`COOKIE_SECURE` matters because Railway serves over HTTPS; without it the
moderator session cookie is sent unprotected. `TRUST_PROXY` lets the rate limiter
see the real visitor address instead of Railway's router, so one abusive
submitter cannot lock out everyone else. Do not set `PORT` — Railway injects it.

**Railway stages changes.** Attaching the volume, adding variables, and
generating a domain do not take effect when you make them — Railway collects
them into a changeset and applies nothing until you click **Deploy** at the top
of the screen. A domain that reads "Public domain will be generated" is a queued
change, not a broken one. Check the changeset lists the volume before deploying:
going live without it means submissions are erased at the next restart.

The map will be empty on first deploy, which is correct: the sample narratives
are only created by `npm run seed`, and they should not be on a live site.

## Configuration

Copy `.env.example` and set what you need. The interesting ones:

| Variable | Default | Purpose |
| --- | --- | --- |
| `ADMIN_PASSWORD` | generated | Password for the review queue |
| `SESSION_SECRET` | generated | Signs the moderator's session cookie |
| `PORT` | `3000` | Port to listen on |
| `DATABASE_PATH` | `./data/narrativemap.db` | Where SQLite writes |
| `COOKIE_SECURE` | `false` | Set to `true` when serving over HTTPS |
| `TRUST_PROXY` | `false` | Set to `true` behind a reverse proxy |
| `MIN_YEAR` | `1800` | Earliest year a narrative may be dated to |
| `SUBMIT_LIMIT_PER_HOUR` | `10` | Submissions per IP per hour |
| `LOGIN_LIMIT_PER_15_MIN` | `10` | Sign-in attempts per IP per 15 minutes |

Before going live: set `ADMIN_PASSWORD` and `SESSION_SECRET` explicitly, set
`COOKIE_SECURE=true` behind HTTPS, and clear the sample narratives with
`npm run seed:reset` followed by deleting the rows, or just delete
`data/narrativemap.db` and start fresh.

## Attribution

Boundary data from [geoBoundaries](https://www.geoboundaries.org) (CC BY 4.0).
Optional street tiles from [OpenStreetMap](https://www.openstreetmap.org/copyright)
contributors. Map rendering by [Leaflet](https://leafletjs.com), which is an npm
dependency served straight out of `node_modules` at `/vendor/leaflet` rather
than checked in, so `npm install` has to run before the map will draw.

The seeded narratives are invented sample content, not real accounts. Delete
them before the site is used for anything real.
