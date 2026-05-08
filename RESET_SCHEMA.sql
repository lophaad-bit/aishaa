-- ╔══════════════════════════════════════════════════════════╗
-- ║   AISHA — FULL RESET + CORRECT SCHEMA                   ║
-- ║   Run this ENTIRE file in Supabase > SQL Editor          ║
-- ║   WARNING: This drops & recreates tables. Safe to run    ║
-- ║   if you have no photos yet.                             ║
-- ╚══════════════════════════════════════════════════════════╝

-- ── STEP 1: Drop old broken tables ───────────────────────────
DROP TABLE IF EXISTS public.photos   CASCADE;
DROP TABLE IF EXISTS public.profiles CASCADE;

-- ── STEP 2: Recreate PHOTOS table (with correct columns) ─────
CREATE TABLE public.photos (
  id           TEXT PRIMARY KEY,
  storage_path TEXT NOT NULL,
  title        TEXT NOT NULL DEFAULT 'Exclusive',
  caption      TEXT NOT NULL DEFAULT '',
  added        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  likes        INTEGER NOT NULL DEFAULT 0
);

-- ── STEP 3: Recreate PROFILES table ──────────────────────────
CREATE TABLE public.profiles (
  id       UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  username TEXT UNIQUE NOT NULL,
  email    TEXT,
  joined   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  likes    TEXT[] NOT NULL DEFAULT '{}',
  saved    TEXT[] NOT NULL DEFAULT '{}'
);

-- ── STEP 4: Enable Row Level Security ────────────────────────
ALTER TABLE public.photos   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- ── STEP 5: Policies ─────────────────────────────────────────

-- Anyone (including guests) can read photos
CREATE POLICY "photos_public_read"
  ON public.photos FOR SELECT
  USING (true);

-- Each user can only read/write their own profile
CREATE POLICY "profiles_own_select"
  ON public.profiles FOR SELECT
  USING (auth.uid() = id);

CREATE POLICY "profiles_own_insert"
  ON public.profiles FOR INSERT
  WITH CHECK (auth.uid() = id);

CREATE POLICY "profiles_own_update"
  ON public.profiles FOR UPDATE
  USING (auth.uid() = id);

-- ── STEP 6: Auto-create profile on signup ────────────────────
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

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

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ── STEP 7: Storage bucket ────────────────────────────────────
INSERT INTO storage.buckets (id, name, public)
VALUES ('photos', 'photos', true)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "storage_photos_public_read" ON storage.objects;
CREATE POLICY "storage_photos_public_read"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'photos');

-- ── DONE ─────────────────────────────────────────────────────
-- You should see: "Success. No rows returned"
-- Now go back to your site and refresh.
