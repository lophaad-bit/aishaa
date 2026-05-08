// Vercel API Route: /api/admin
// Env vars required in Vercel dashboard:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ADMIN_PASS

const { createClient } = require('@supabase/supabase-js');

const BUCKET = 'photos';

const CORS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function supabaseAdmin() {
  return createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

module.exports = async function handler(req, res) {
  Object.entries(CORS).forEach(([k, v]) => res.setHeader(k, v));

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, msg: 'Method not allowed' });

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY || !process.env.ADMIN_PASS) {
    return res.status(500).json({ ok: false, msg: 'Server not configured. Add SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and ADMIN_PASS to Vercel Environment Variables, then redeploy.' });
  }

  const body = req.body || {};
  const { action, password } = body;

  // ── LOGIN ────────────────────────────────────────────
  if (action === 'login') {
    if (!password) return res.status(400).json({ ok: false, msg: 'Password required' });
    if (password === process.env.ADMIN_PASS) return res.json({ ok: true });
    return res.status(401).json({ ok: false, msg: 'Incorrect password' });
  }

  if (password !== process.env.ADMIN_PASS) {
    return res.status(401).json({ ok: false, msg: 'Unauthorized' });
  }

  const sb = supabaseAdmin();

  // ── GET PHOTOS ───────────────────────────────────────
  if (action === 'get_photos') {
    const { data, error } = await sb.from('photos').select('*').order('added', { ascending: false });
    if (error) return res.status(500).json({ ok: false, msg: error.message });
    return res.json({ ok: true, photos: data || [] });
  }

  // ── GET STATS ────────────────────────────────────────
  if (action === 'get_stats') {
    const [photosRes, usersRes] = await Promise.all([
      sb.from('photos').select('likes'),
      sb.from('profiles').select('id', { count: 'exact', head: true }),
    ]);
    const totalLikes  = (photosRes.data || []).reduce((s, p) => s + (p.likes || 0), 0);
    const totalPhotos = (photosRes.data || []).length;
    const totalUsers  = usersRes.count || 0;
    return res.json({ ok: true, totalPhotos, totalUsers, totalLikes });
  }

  // ── UPLOAD PHOTO ─────────────────────────────────────
  if (action === 'upload') {
    const { fileBase64, fileType, title, caption } = body;
    if (!fileBase64 || !fileType) return res.status(400).json({ ok: false, msg: 'No file provided' });

    const ext = fileType.split('/')[1]?.replace('jpeg', 'jpg') || 'jpg';
    if (!['jpg', 'png', 'gif', 'webp'].includes(ext)) return res.status(400).json({ ok: false, msg: 'File type not allowed' });

    const id = 'photo_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
    const storagePath = `${id}.${ext}`;
    const fileBuffer  = Buffer.from(fileBase64, 'base64');

    const { error: uploadErr } = await sb.storage
      .from(BUCKET)
      .upload(storagePath, fileBuffer, { contentType: fileType, upsert: false });

    if (uploadErr) return res.status(500).json({ ok: false, msg: 'Storage upload failed: ' + uploadErr.message });

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
      return res.status(500).json({ ok: false, msg: 'Database insert failed: ' + dbErr.message });
    }

    return res.json({ ok: true, msg: 'Photo uploaded!', id });
  }

  // ── EDIT PHOTO ───────────────────────────────────────
  if (action === 'edit') {
    const { id, title, caption } = body;
    if (!id) return res.status(400).json({ ok: false, msg: 'Missing photo id' });
    const { error } = await sb.from('photos').update({
      title:   (title   || '').trim().slice(0, 80),
      caption: (caption || '').trim().slice(0, 300),
    }).eq('id', id);
    if (error) return res.status(500).json({ ok: false, msg: error.message });
    return res.json({ ok: true, msg: 'Photo updated!' });
  }

  // ── DELETE PHOTO ─────────────────────────────────────
  if (action === 'delete') {
    const { id } = body;
    if (!id) return res.status(400).json({ ok: false, msg: 'Missing photo id' });

    const { data: photo } = await sb.from('photos').select('storage_path').eq('id', id).single();
    if (photo?.storage_path) {
      await sb.storage.from(BUCKET).remove([photo.storage_path]);
    }

    const { error } = await sb.from('photos').delete().eq('id', id);
    if (error) return res.status(500).json({ ok: false, msg: error.message });
    return res.json({ ok: true, msg: 'Photo deleted.' });
  }

  // ── GET USERS ────────────────────────────────────────
  if (action === 'get_users') {
    const { data, error } = await sb
      .from('profiles')
      .select('username, email, likes, saved, joined')
      .order('joined', { ascending: false });
    if (error) return res.status(500).json({ ok: false, msg: error.message });
    return res.json({ ok: true, users: data || [] });
  }

  return res.status(400).json({ ok: false, msg: 'Unknown action: ' + action });
};
