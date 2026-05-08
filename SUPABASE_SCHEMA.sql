-- ╔══════════════════════════════════════════════════╗
-- ║   AISHA — Supabase SQL Schema                   ║
-- ║   Run this ENTIRE file in Supabase SQL Editor   ║
-- ╚══════════════════════════════════════════════════╝

-- ── 1. PHOTOS TABLE ──────────────────────────────────
CREATE TABLE IF NOT EXISTS public.photos (
  id           TEXT PRIMARY KEY,
  storage_path TEXT NOT NULL,
  title        TEXT NOT NULL DEFAULT 'Exclusive',
  caption      TEXT NOT NULL DEFAULT '',
  added        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  likes        INTEGER NOT NULL DEFAULT 0
);

-- ── 2. PROFILES TABLE (extends Supabase Auth) ────────
CREATE TABLE IF NOT EXISTS public.profiles (
  id       UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  username TEXT UNIQUE NOT NULL,
  email    TEXT,
  joined   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  likes    TEXT[] NOT NULL DEFAULT '{}',
  saved    TEXT[] NOT NULL DEFAULT '{}'
);

-- ── 3. ROW LEVEL SECURITY ────────────────────────────
ALTER TABLE public.photos   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Photos: anyone (even guests) can read
CREATE POLICY "photos_public_read"
  ON public.photos FOR SELECT
  USING (true);

-- Profiles: each user can only read/write their own row
CREATE POLICY "profiles_own_select"
  ON public.profiles FOR SELECT
  USING (auth.uid() = id);

CREATE POLICY "profiles_own_insert"
  ON public.profiles FOR INSERT
  WITH CHECK (auth.uid() = id);

CREATE POLICY "profiles_own_update"
  ON public.profiles FOR UPDATE
  USING (auth.uid() = id);

-- ── 4. AUTO-CREATE PROFILE ON SIGNUP ─────────────────
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, username, email)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'username', split_part(NEW.email, '@', 1)),
    NEW.email
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ── 5. STORAGE BUCKET ────────────────────────────────
-- Run this in SQL Editor too:
INSERT INTO storage.buckets (id, name, public)
VALUES ('photos', 'photos', true)
ON CONFLICT (id) DO NOTHING;

-- Allow public to read photos from storage
CREATE POLICY "storage_photos_public_read"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'photos');

-- Only service role (admin function) can upload/delete
-- (handled by your Netlify Function using service_role key)
