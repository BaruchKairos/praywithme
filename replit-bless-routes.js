/**
 * Bless Someone™ — Replit / Express routes
 *
 * Mount AFTER express.json() (or other body parser), e.g.:
 *   const { registerBlessRoutes } = require('./replit-bless-routes');
 *   registerBlessRoutes(app);
 *
 * Persists gifts to ./data/bless-gifts.json (single-instance; swap for Redis/Postgres at scale).
 * CORS: reuse the same allowlist you use for /api/anthropic (https://baruchkairos.github.io).
 */

const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(process.cwd(), 'data');
const DATA_FILE = path.join(DATA_DIR, 'bless-gifts.json');

const MAX_BODY_BYTES = 350_000;
const MAX_PRAYER_TEXT = 50_000;

async function loadStore() {
  try {
    const raw = await fs.readFile(DATA_FILE, 'utf8');
    const o = JSON.parse(raw);
    return o && typeof o === 'object' ? o : {};
  } catch {
    return {};
  }
}

async function saveStore(store) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(DATA_FILE, JSON.stringify(store), 'utf8');
}

function isUuid(id) {
  return typeof id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id);
}

function sanitizeGift(body) {
  if (!body || typeof body !== 'object') return null;
  const lp = body.lastPrayer;
  if (!lp || typeof lp !== 'object') return null;
  if (typeof lp.prayer !== 'string' || typeof lp.verse !== 'string') return null;
  const prayer = lp.prayer.slice(0, MAX_PRAYER_TEXT);
  return {
    v: Number(body.v) === 1 ? 1 : 1,
    created: typeof body.created === 'number' ? body.created : Date.now(),
    senderPrepayExtended: !!body.senderPrepayExtended,
    recipientFirst: String(body.recipientFirst || '').slice(0, 200),
    senderNote: String(body.senderNote || '').slice(0, 2000),
    lastPrayer: {
      verse: String(lp.verse || '').slice(0, 120),
      verseText: String(lp.verseText || '').slice(0, 2000),
      prayer,
      closing: String(lp.closing || '').slice(0, 500),
      ministerId: Number(lp.ministerId) || 0,
      len: String(lp.len || 'short').slice(0, 20),
      tradition: String(lp.tradition || '').slice(0, 80),
      topic: String(lp.topic || '').slice(0, 200),
      req: String(lp.req || '').slice(0, 5000),
    },
  };
}

/**
 * @param {import('express').Application} app
 */
function registerBlessRoutes(app) {
  app.post('/api/bless/create', async (req, res) => {
    try {
      const raw = JSON.stringify(req.body || {});
      if (raw.length > MAX_BODY_BYTES) {
        return res.status(413).json({ error: 'Payload too large' });
      }
      const gift = sanitizeGift(req.body);
      if (!gift) return res.status(400).json({ error: 'Invalid gift payload' });

      const id = crypto.randomUUID();
      const store = await loadStore();
      store[id] = { ...gift, _savedAt: Date.now() };
      await saveStore(store);
      return res.status(201).json({ id });
    } catch (e) {
      console.error('[bless/create]', e);
      return res.status(500).json({ error: 'Server error' });
    }
  });

  app.get('/api/bless/:id', async (req, res) => {
    try {
      const id = String(req.params.id || '').slice(0, 48);
      if (!isUuid(id)) return res.status(400).json({ error: 'Invalid id' });

      const store = await loadStore();
      const row = store[id];
      if (!row) return res.status(404).json({ error: 'Not found' });

      const { _savedAt, ...gift } = row;
      return res.json(gift);
    } catch (e) {
      console.error('[bless/get]', e);
      return res.status(500).json({ error: 'Server error' });
    }
  });
}

module.exports = { registerBlessRoutes };
