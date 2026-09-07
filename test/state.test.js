'use strict';

/**
 * Where state is written decides whether the archive survives a deploy, so the
 * rule is worth pinning down: a mounted volume wins, and a database left in the
 * old place is carried onto it once rather than abandoned there.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const STATE = require.resolve('../src/state');

/** state.js reads the environment when it loads, so each case needs it fresh. */
function loadWith(env) {
  const saved = { ...process.env };
  Object.assign(process.env, env);
  delete require.cache[STATE];
  try {
    return require('../src/state');
  } finally {
    for (const key of Object.keys(process.env)) delete process.env[key];
    Object.assign(process.env, saved);
    delete require.cache[STATE];
  }
}

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'nm-state-'));
}

test('with no volume, state sits beside the code', () => {
  const state = loadWith({ STATE_DIR: '', RAILWAY_VOLUME_MOUNT_PATH: '' });
  assert.equal(state.STATE_DIR, path.join(__dirname, '..', 'data'));
});

test('a mounted volume is where state goes', () => {
  const mount = tempDir();
  const state = loadWith({ STATE_DIR: '', RAILWAY_VOLUME_MOUNT_PATH: mount });
  assert.equal(state.STATE_DIR, mount);
  assert.equal(state.statePath('narrativemap.db'), path.join(mount, 'narrativemap.db'));
});

test('a volume counts as persistent even mounted at the legacy path', () => {
  const legacy = path.join(__dirname, '..', 'data');
  const onVolume = loadWith({ STATE_DIR: '', RAILWAY_VOLUME_MOUNT_PATH: legacy });
  assert.equal(onVolume.ON_PERSISTENT_STORAGE, true, 'where it points is not the question');

  const bare = loadWith({ STATE_DIR: '', RAILWAY_VOLUME_MOUNT_PATH: '' });
  assert.equal(bare.ON_PERSISTENT_STORAGE, false, 'no volume, no promise');
});

test('a database left behind is carried onto the volume, journal and all', () => {
  const mount = tempDir();
  const legacy = path.join(__dirname, '..', 'data');
  fs.mkdirSync(legacy, { recursive: true });
  const name = `adopt-${process.pid}.db`;
  fs.writeFileSync(path.join(legacy, name), 'main');
  fs.writeFileSync(path.join(legacy, `${name}-wal`), 'journal');

  try {
    const state = loadWith({ STATE_DIR: '', RAILWAY_VOLUME_MOUNT_PATH: mount });
    const moved = state.adoptLegacy(name, ['', '-wal', '-shm']);
    assert.equal(moved, path.join(mount, name));
    assert.equal(fs.readFileSync(moved, 'utf8'), 'main');
    assert.equal(fs.readFileSync(`${moved}-wal`, 'utf8'), 'journal', 'the journal travels too');
  } finally {
    fs.rmSync(path.join(legacy, name), { force: true });
    fs.rmSync(path.join(legacy, `${name}-wal`), { force: true });
  }
});

test('what is already on the volume is never overwritten', () => {
  const mount = tempDir();
  const legacy = path.join(__dirname, '..', 'data');
  fs.mkdirSync(legacy, { recursive: true });
  const name = `keep-${process.pid}.db`;
  fs.writeFileSync(path.join(legacy, name), 'the old one');
  fs.writeFileSync(path.join(mount, name), 'the live one');

  try {
    const state = loadWith({ STATE_DIR: '', RAILWAY_VOLUME_MOUNT_PATH: mount });
    state.adoptLegacy(name, ['']);
    assert.equal(fs.readFileSync(path.join(mount, name), 'utf8'), 'the live one');
  } finally {
    fs.rmSync(path.join(legacy, name), { force: true });
  }
});
