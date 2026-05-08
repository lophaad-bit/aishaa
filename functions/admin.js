// Netlify Serverless Function — /.netlify/functions/admin
// Uses ONLY Node.js built-in modules — no npm, no bundling, no Node version issues
// Required env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ADMIN_PASS

const https  = require('https');
const { URL } = require('url');

const BUCKET = 'photos';

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function resp(code, body) {
  return { statusCode: code, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}
const ok   = b       => resp(200, b);
const fail = (m, c=400) => resp(c, { ok: false, msg: m });

// ── Low-level HTTPS helper ───────────────────────────────
function httpsRequest(urlStr, method, headers, bodyBuffer) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const opts = {
      hostname: u.hostname,
      port: 443,
      path: u.pathname + u.search,
      method,
      headers: { ...headers },
    };
    if (bodyBuffer && bodyBuffer.length) opts.headers['Content-Length'] = bodyBuffer.length;

    const req = https.request(opts, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end',  () => resolve({ status: res.statusCode, text: Buffer.concat(chunks).toString() }));
    });
    req.on('error', reject);
    if (bodyBuffer && bodyBuffer.length) req.write(bodyBuffer);
    req.end();
  });
}

// ── Supabase REST helpers ────────────────────────────────
function sbAuthHeaders(key, extra = {}) {
  return { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', ...extra };
}

async function sbQuery(sbUrl, key, method, endpoint, bodyObj, extraHeaders = {}) {
  const buf = bodyObj !== null && bodyObj !== undefined
    ? Buffer.from(JSON.stringify(bodyObj))
    : Buffer.alloc(0);
  const { status, text } = await httpsRequest(sbUrl + endpoint, method, sbAuthHeaders(key, extraHeaders), buf);
  if (status >= 400) throw new Error(`DB error ${status}: ${text}`);
  try { return text ? JSON.parse(text) : null; } catch { return null; }
}

async function sbUpload(sbUrl, key, storagePath, fileBuffer, contentType) {
  const headers = {
    apikey:        key,
    Authorization: `Bearer ${key}`,
    'Content-Type': contentType,
    'x-upsert':    'false',
  };
  const { status, text } = await httpsRequest(
    `${sbUrl}/storage/v1/object/${BUCKET}/${storagePath}`, 'POST', headers, fileBuffer
  );
  if (status >= 400) throw new Error(`Storage error ${status}: ${text}`);
}

async function sbStorageDelete(sbUrl, key, paths) {
  const buf = Buffer.from(JSON.stringify({ prefixes: paths }));
  await httpsRequest(`${sbUrl}/storage/v1/object/${BUCKET}`, 'DELETE', sbAuthHeaders(key), buf);
}

// ── Handler ──────────────────────────────────────────────
exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST')    return fail('Method not allowed', 405);

  const SB_URL = process.env.SUPABASE_URL;
  const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const PASS   = process.env.ADMIN_PASS;

  if (!SB_URL || !SB_KEY || !PASS) {
    return fail('Server not configured — add SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and ADMIN_PASS in Netlify → Site settings → Environment variables, then redeploy.', 500);
  }

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return fail('Invalid JSON'); }

  const { action, password } = body;

  // ── LOGIN ──────────────────────────────────────────────
  if (action === 'login') {
    if (!password)        return fail('Password required');
    if (password === PASS) return ok({ ok: true });
    return fail('Incorrect password', 401);
  }

  if (password !== PASS) return fail('Unauthorized', 401);

  try {

    // ── GET PHOTOS ────────────────────────────────────────
    if (action === 'get_photos') {
      const photos = await sbQuery(SB_URL, SB_KEY, 'GET', '/rest/v1/photos?order=added.desc&select=*', null);
      return ok({ ok: true, photos: photos || [] });
    }

    // ── GET STATS ─────────────────────────────────────────
    if (action === 'get_stats') {
      const [photos, profiles] = await Promise.all([
        sbQuery(SB_URL, SB_KEY, 'GET', '/rest/v1/photos?select=likes',    null),
        sbQuery(SB_URL, SB_KEY, 'GET', '/rest/v1/profiles?select=id',     null),
      ]);
      return ok({
        ok: true,
        totalPhotos: (photos   || []).length,
        totalUsers:  (profiles || []).length,
        totalLikes:  (photos   || []).reduce((s, p) => s + (p.likes || 0), 0),
      });
    }

    // ── GET USERS ─────────────────────────────────────────
    if (action === 'get_users') {
      const users = await sbQuery(SB_URL, SB_KEY, 'GET',
        '/rest/v1/profiles?order=joined.desc&select=username,email,likes,saved,joined', null);
      return ok({ ok: true, users: users || [] });
    }

    // ── UPLOAD PHOTO ──────────────────────────────────────
    if (action === 'upload') {
      const { fileBase64, fileType, title, caption } = body;
      if (!fileBase64 || !fileType) return fail('No file provided');

      const ext = (fileType.split('/')[1] || '').replace('jpeg', 'jpg');
      if (!['jpg', 'png', 'gif', 'webp'].includes(ext)) return fail('File type not allowed');

      const id          = 'photo_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
      const storagePath = `${id}.${ext}`;
      const fileBuffer  = Buffer.from(fileBase64, 'base64');

      await sbUpload(SB_URL, SB_KEY, storagePath, fileBuffer, fileType);

      try {
        await sbQuery(SB_URL, SB_KEY, 'POST', '/rest/v1/photos', {
          id,
          storage_path: storagePath,
          title:   (title   || 'Exclusive').trim().slice(0, 80),
          caption: (caption || '').trim().slice(0, 300),
          added:   new Date().toISOString(),
          likes:   0,
        }, { Prefer: 'return=minimal' });
      } catch (dbErr) {
        await sbStorageDelete(SB_URL, SB_KEY, [storagePath]);
        throw dbErr;
      }

      return ok({ ok: true, msg: 'Photo uploaded!', id });
    }

    // ── EDIT PHOTO ────────────────────────────────────────
    if (action === 'edit') {
      const { id, title, caption } = body;
      if (!id) return fail('Missing photo id');
      await sbQuery(SB_URL, SB_KEY, 'PATCH', `/rest/v1/photos?id=eq.${id}`, {
        title:   (title   || '').trim().slice(0, 80),
        caption: (caption || '').trim().slice(0, 300),
      }, { Prefer: 'return=minimal' });
      return ok({ ok: true, msg: 'Photo updated!' });
    }

    // ── DELETE PHOTO ──────────────────────────────────────
    if (action === 'delete') {
      const { id } = body;
      if (!id) return fail('Missing photo id');
      const rows = await sbQuery(SB_URL, SB_KEY, 'GET', `/rest/v1/photos?id=eq.${encodeURIComponent(id)}&select=storage_path`, null);
      const path = rows?.[0]?.storage_path;
      if (path) await sbStorageDelete(SB_URL, SB_KEY, [path]);
      await sbQuery(SB_URL, SB_KEY, 'DELETE', `/rest/v1/photos?id=eq.${encodeURIComponent(id)}`, null);
      return ok({ ok: true, msg: 'Photo deleted.' });
    }

    return fail('Unknown action: ' + action);

  } catch (e) {
    return fail('Server error: ' + e.message, 500);
  }
};
