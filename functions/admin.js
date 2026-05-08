// Netlify Function: /.netlify/functions/admin
// Env vars required in Netlify dashboard:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ADMIN_PASS

const { createClient } = require('@supabase/supabase-js');

const BUCKET = 'photos';

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function ok(body, status = 200) {
  return { statusCode: status, headers: CORS_HEADERS, body: JSON.stringify(body) };
}
function fail(msg, status = 400) {
  return { statusCode: status, headers: CORS_HEADERS, body: JSON.stringify({ ok: false, msg }) };
}

function supabaseAdmin() {
  return createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

exports.handler = async (event) => {
  // Handle CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: CORS_HEADERS, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return fail('Method not allowed', 405);
  }

  // Check env vars are configured
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY || !process.env.ADMIN_PASS) {
    return fail('Server not configured. Add SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and ADMIN_PASS to Netlify Environment Variables, then redeploy.', 500);
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return fail('Invalid JSON body');
  }

  const { action, password } = body;

  // ── LOGIN ──────────────────────────────────────────────
  if (action === 'login') {
    if (!password) return fail('Password required');
    if (password === process.env.ADMIN_PASS) {
      return ok({ ok: true });
    }
    return fail('Incorrect password', 401);
  }

  // ── All other actions require correct password ─────────
  if (password !== process.env.ADMIN_PASS) {
    return fail('Unauthorized', 401);
  }

  const sb = supabaseAdmin();

  // ── GET PHOTOS ─────────────────────────────────────────
  if (action === 'get_photos') {
    const { data, error } = await sb
      .from('photos')
      .select('*')
      .order('added', { ascending: false });
    if (error) return fail(error.message, 500);
    return ok({ ok: true, photos: data || [] });
  }

  // ── GET STATS ──────────────────────────────────────────
  if (action === 'get_stats') {
    const [photosRes, usersRes] = await Promise.all([
      sb.from('photos').select('likes'),
      sb.from('profiles').select('id', { count: 'exact', head: true }),
    ]);
    const totalLikes  = (photosRes.data || []).reduce((s, p) => s + (p.likes || 0), 0);
    const totalPhotos = (photosRes.data || []).length;
    const totalUsers  = usersRes.count || 0;
    return ok({ ok: true, totalPhotos, totalUsers, totalLikes });
  }

  // ── UPLOAD PHOTO ───────────────────────────────────────
  if (action === 'upload') {
    const { fileBase64, fileType, title, caption } = body;
    if (!fileBase64 || !fileType) return fail('No file provided');

    const ext = fileType.split('/')[1]?.replace('jpeg', 'jpg') || 'jpg';
    if (!['jpg', 'png', 'gif', 'webp'].includes(ext)) return fail('File type not allowed');

    const id = 'photo_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
    const storagePath = `${id}.${ext}`;
    const fileBuffer  = Buffer.from(fileBase64, 'base64');

    const { error: uploadErr } = await sb.storage
      .from(BUCKET)
      .upload(storagePath, fileBuffer, { contentType: fileType, upsert: false });

    if (uploadErr) return fail('Storage upload failed: ' + uploadErr.message, 500);

    const { error: dbErr } = await sb.from('photos').insert({
      id,
      storage_path: storagePath,
      title:   (title   || 'Exclusive').trim().slice(0, 80),
      caption: (caption || '').trim().slice(0, 300),
      added:   new Date().toISOString(),
      likes:   0,
    });

    if (dbErr) {
      await sb.storage.from(BUCKET).remove([storagePath]);
      return fail('Database insert failed: ' + dbErr.message, 500);
    }

    return ok({ ok: true, msg: 'Photo uploaded!', id });
  }

  // ── EDIT PHOTO ─────────────────────────────────────────
  if (action === 'edit') {
    const { id, title, caption } = body;
    if (!id) return fail('Missing photo id');
    const { error } = await sb.from('photos').update({
      title:   (title   || '').trim().slice(0, 80),
      caption: (caption || '').trim().slice(0, 300),
    }).eq('id', id);
    if (error) return fail(error.message, 500);
    return ok({ ok: true, msg: 'Photo updated!' });
  }

  // ── DELETE PHOTO ───────────────────────────────────────
  if (action === 'delete') {
    const { id } = body;
    if (!id) return fail('Missing photo id');

    const { data: photo } = await sb
      .from('photos').select('storage_path').eq('id', id).single();
    if (photo?.storage_path) {
      await sb.storage.from(BUCKET).remove([photo.storage_path]);
    }

    const { error } = await sb.from('photos').delete().eq('id', id);
    if (error) return fail(error.message, 500);

    return ok({ ok: true, msg: 'Photo deleted.' });
  }

  // ── GET USERS ──────────────────────────────────────────
  if (action === 'get_users') {
    const { data, error } = await sb
      .from('profiles')
      .select('username, email, likes, saved, joined')
      .order('joined', { ascending: false });
    if (error) return fail(error.message, 500);
    return ok({ ok: true, users: data || [] });
  }

  return fail('Unknown action: ' + action);
};
