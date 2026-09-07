'use strict';

const fs = require('node:fs');
const path = require('node:path');

/**
 * Where anything that has to outlive a deploy is kept.
 *
 * A container's own filesystem is rebuilt every time the app is deployed, so a
 * database written beside the code is silently destroyed on each release. A
 * platform that offers persistent storage says where it is mounted — Railway
 * sets RAILWAY_VOLUME_MOUNT_PATH — and that is where state belongs. With no
 * volume, `data/` beside the code is right, which is the case on a laptop.
 */
const LEGACY_DIR = path.join(__dirname, '..', 'data');

const MOUNTED = process.env.STATE_DIR || process.env.RAILWAY_VOLUME_MOUNT_PATH || '';
const STATE_DIR = MOUNTED || LEGACY_DIR;

function statePath(name) {
  return path.join(STATE_DIR, name);
}

/**
 * Carries a file left in the old place across to the volume, once.
 *
 * The first deploy after a volume is attached would otherwise open an empty
 * database on it, while the real one sat in the container waiting to be thrown
 * away with it. SQLite in WAL mode spans three files and all of them have to
 * travel together, so this runs before the database is opened.
 */
function adoptLegacy(name, suffixes = ['']) {
  const target = statePath(name);
  if (STATE_DIR === LEGACY_DIR) return target;
  if (fs.existsSync(target)) return target;
  if (!fs.existsSync(path.join(LEGACY_DIR, name))) return target;

  fs.mkdirSync(STATE_DIR, { recursive: true });
  for (const suffix of suffixes) {
    const from = path.join(LEGACY_DIR, name + suffix);
    if (fs.existsSync(from)) fs.copyFileSync(from, target + suffix);
  }
  return target;
}

/**
 * True when the platform handed us storage that outlives the container.
 *
 * This asks whether a volume was mounted, not where it points. Comparing paths
 * would call a volume mounted at the legacy path — the obvious choice, since it
 * is where the app wrote before — ephemeral, and say the archive was in danger
 * when it was the one arrangement that had always been safe.
 */
const ON_PERSISTENT_STORAGE = Boolean(MOUNTED);

module.exports = { STATE_DIR, LEGACY_DIR, ON_PERSISTENT_STORAGE, statePath, adoptLegacy };
