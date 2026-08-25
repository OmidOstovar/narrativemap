'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const COOKIE_NAME = 'nm_admin';
const SESSION_HOURS = 12;

/**
 * The signing secret must survive restarts, otherwise every deploy logs the
 * moderator out. Prefer SESSION_SECRET; fall back to a generated file.
 */
function loadSecret() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  const file = path.join(__dirname, '..', 'data', '.session-secret');
  try {
    return fs.readFileSync(file, 'utf8').trim();
  } catch {
    const secret = crypto.randomBytes(32).toString('hex');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, secret, { mode: 0o600 });
    return secret;
  }
}

const SECRET = loadSecret();

function sign(value) {
  return crypto.createHmac('sha256', SECRET).update(value).digest('base64url');
}

function timingSafeEqual(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/** The moderator password. Startup refuses to continue without one. */
function adminPassword() {
  return process.env.ADMIN_PASSWORD || '';
}

function checkPassword(candidate) {
  const expected = adminPassword();
  if (!expected) return false;
  return timingSafeEqual(
    crypto.createHash('sha256').update(String(candidate)).digest('hex'),
    crypto.createHash('sha256').update(expected).digest('hex'),
  );
}

function issueToken() {
  const expiresAt = Date.now() + SESSION_HOURS * 60 * 60 * 1000;
  const payload = `${expiresAt}`;
  return `${payload}.${sign(payload)}`;
}

function verifyToken(token) {
  if (typeof token !== 'string' || !token.includes('.')) return false;
  const index = token.lastIndexOf('.');
  const payload = token.slice(0, index);
  const signature = token.slice(index + 1);
  if (!timingSafeEqual(signature, sign(payload))) return false;
  const expiresAt = Number(payload);
  return Number.isFinite(expiresAt) && expiresAt > Date.now();
}

function parseCookies(header) {
  const jar = {};
  if (!header) return jar;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    jar[part.slice(0, eq).trim()] = decodeURIComponent(part.slice(eq + 1).trim());
  }
  return jar;
}

function setSessionCookie(res, token) {
  const secure = process.env.COOKIE_SECURE === 'true';
  res.setHeader('Set-Cookie', [
    `${COOKIE_NAME}=${token}`,
    'HttpOnly',
    'SameSite=Strict',
    'Path=/',
    `Max-Age=${SESSION_HOURS * 60 * 60}`,
    ...(secure ? ['Secure'] : []),
  ].join('; '));
}

function clearSessionCookie(res) {
  res.setHeader(
    'Set-Cookie',
    `${COOKIE_NAME}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`,
  );
}

function isAuthenticated(req) {
  return verifyToken(parseCookies(req.headers.cookie)[COOKIE_NAME]);
}

/**
 * The Telegram bot posts every contributor's narrative from one address, so it
 * authenticates with a shared token instead of being held to the per-visitor
 * submission limit. Without a token set, no caller is ever trusted.
 */
function isTrustedBot(req) {
  const expected = process.env.BOT_API_TOKEN || '';
  if (!expected) return false;
  const given = req.get('X-Bot-Token') || '';
  if (!given) return false;
  return timingSafeEqual(
    crypto.createHash('sha256').update(given).digest('hex'),
    crypto.createHash('sha256').update(expected).digest('hex'),
  );
}

/** Express middleware guarding every /api/admin route. */
function requireAdmin(req, res, next) {
  if (!isAuthenticated(req)) {
    res.status(401).json({ error: 'Not signed in.' });
    return;
  }
  next();
}

/**
 * Small fixed-window limiter, enough to blunt password guessing and submission
 * floods on a single-process deployment.
 */
function createRateLimiter({ windowMs, max }) {
  const hits = new Map();
  return function limit(key) {
    const now = Date.now();
    const entry = hits.get(key);
    if (!entry || now > entry.resetAt) {
      hits.set(key, { count: 1, resetAt: now + windowMs });
      if (hits.size > 5000) {
        for (const [k, v] of hits) if (now > v.resetAt) hits.delete(k);
      }
      return { ok: true, retryAfter: 0 };
    }
    entry.count += 1;
    if (entry.count > max) {
      return { ok: false, retryAfter: Math.ceil((entry.resetAt - now) / 1000) };
    }
    return { ok: true, retryAfter: 0 };
  };
}

module.exports = {
  COOKIE_NAME,
  isTrustedBot,
  adminPassword,
  checkPassword,
  issueToken,
  verifyToken,
  setSessionCookie,
  clearSessionCookie,
  isAuthenticated,
  requireAdmin,
  createRateLimiter,
};
