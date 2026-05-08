# Aisha — Netlify + Supabase Setup Guide

Complete step-by-step instructions to deploy your app.

---

## What You Will Have After This Setup

- **index.html** — Public gallery (hosted on Netlify, FREE)
- **admin.html** — Admin panel to upload & manage photos
- **Supabase** — Database (photos, users) + file storage for images
- **Netlify Functions** — Serverless backend for admin operations

---

## STEP 1 — Create a Supabase Project

1. Go to **https://supabase.com** and sign up (free)
2. Click **"New project"**
3. Fill in:
   - **Name**: `aisha` (or anything you like)
   - **Database Password**: create a strong password (save it!)
   - **Region**: choose the one closest to you
4. Click **"Create new project"** — wait ~2 minutes for it to provision

---

## STEP 2 — Run the Database Schema

1. In your Supabase project, go to the left sidebar → **SQL Editor**
2. Click **"+ New query"**
3. Open the file `SUPABASE_SCHEMA.sql` (in this folder)
4. Copy the **entire contents** and paste it into the SQL Editor
5. Click **"Run"** (or press `Ctrl+Enter`)
6. You should see: `Success. No rows returned`

> This creates the `photos` table, `profiles` table, storage bucket,
> and all the rules that keep your data secure.

---

## STEP 3 — Get Your Supabase Keys

1. In Supabase, go to **Settings** (gear icon, bottom left)
2. Click **"API"** in the left menu
3. You need TWO values — copy them somewhere safe:

| Key | Where to find it |
|-----|-----------------|
| **Project URL** | Under "Project URL" — looks like `https://xxxxx.supabase.co` |
| **anon / public key** | Under "Project API keys" → `anon` `public` |
| **service_role key** | Under "Project API keys" → `service_role` (keep this SECRET!) |

---

## STEP 4 — Edit index.html

Open `index.html` in a text editor (Notepad, VS Code, etc.)

Find this block near the bottom (around line 10–12 of the `<script>` tag):

✅ **Already filled in** — your credentials are already saved in `index.html`:

```js
const SUPABASE_URL      = 'https://havyahjklvinraoamcat.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_2iQW6DDVWX2cKfck5ikY_Q_rpfUJa4K';
```

No changes needed here — skip to Step 5.

---

## STEP 5 — Edit admin.html

Open `admin.html` in a text editor.

✅ **Already filled in** — your Supabase URL is already saved in `admin.html`:

```js
const SUPABASE_URL = 'https://havyahjklvinraoamcat.supabase.co';
```

No changes needed here — skip to Step 6.

---

## STEP 6 — Deploy to Netlify

### Option A — Drag & Drop (Easiest, no account setup needed)

1. Go to **https://app.netlify.com/drop**
2. Drag the entire **`netlify-supabase/`** folder onto the page
3. Wait ~30 seconds — Netlify gives you a live URL like `https://random-name.netlify.app`
4. Done! Visit your URL.

### Option B — Netlify with GitHub (Recommended for updates)

1. Push your code to a GitHub repository
2. Go to **https://app.netlify.com** → "Add new site" → "Import an existing project"
3. Connect GitHub and select your repository
4. Set **"Publish directory"** to: `netlify-supabase`
5. Click **"Deploy site"**

---

## STEP 7 — Add Environment Variables to Netlify

Your admin panel needs secret keys stored on Netlify (NOT in your code).

1. In Netlify, go to your site → **Site configuration** → **Environment variables**
2. Click **"Add a variable"** and add these three:

| Variable Name | Value |
|---------------|-------|
| `SUPABASE_URL` | `https://havyahjklvinraoamcat.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | `sb_secret_ZpdjTrML9KD1-r6C7LCV9Q_tJUf1SU7` |
| `ADMIN_PASS` | `8822245103@testprime` |

> All three values are also saved in `NETLIFY_ENV_VARS.txt` for easy copy-paste.

3. Click **"Save"**
4. Go to **Deploys** → **"Trigger deploy"** → **"Deploy site"** to apply the new vars

> ⚠️  Never put the service_role key in index.html or admin.html — it belongs ONLY in Netlify env vars.

---

## STEP 8 — Install Function Dependencies

For the Netlify Functions to work, you need to tell Netlify to install `@supabase/supabase-js`.

Option A — Netlify handles it automatically if you have a `package.json` in the functions folder (already included).

Option B — If you get errors, add a **root `package.json`** in `netlify-supabase/`:
```json
{
  "name": "aisha-app",
  "version": "1.0.0",
  "dependencies": {
    "@supabase/supabase-js": "^2.39.0"
  }
}
```
Then redeploy.

---

## STEP 9 — Test Everything

1. **Visit your Netlify URL** — you should see the gallery (empty at first)
2. **Sign up** as a user — tap the profile icon → "Sign in / Sign up"
3. **Visit `/admin.html`** — log in with your `ADMIN_PASS`
4. **Upload a photo** — it should appear in the gallery within seconds
5. **Like and save photos** — should persist after page refresh

---

## STEP 10 — Set Admin Password (Final)

The admin password is the `ADMIN_PASS` environment variable you set in Step 7.
To change it, just update that variable in Netlify and redeploy.

---

## File Structure

```
netlify-supabase/
├── index.html              ← Public gallery (edit SUPABASE_URL + ANON_KEY)
├── admin.html              ← Admin panel (edit SUPABASE_URL)
├── manifest.json           ← PWA manifest
├── _redirects              ← Netlify redirects
├── netlify.toml            ← Netlify build config
├── SUPABASE_SCHEMA.sql     ← Run this once in Supabase SQL Editor
├── SETUP.md                ← This file
└── functions/
    ├── admin.js            ← Netlify Function (uses service_role key)
    └── package.json        ← Function dependencies
```

---

## Architecture Overview

```
Browser
  │
  ├── index.html
  │     └── Supabase JS client (anon key, safe to expose)
  │           ├── Auth: supabase.auth.signUp / signIn / signOut
  │           ├── Photos: supabase.from('photos').select(*)
  │           ├── Likes/Saves: supabase.from('profiles').update(...)
  │           └── Images: Supabase Storage (public bucket)
  │
  └── admin.html
        └── Netlify Function /.netlify/functions/admin
              └── Supabase Admin client (service_role key, NEVER in browser)
                    ├── Upload to Storage
                    ├── Insert/Update/Delete photos table
                    └── Get stats (photos + users count)
```

---

## Troubleshooting

**Photos not showing?**
- Check that you ran `SUPABASE_SCHEMA.sql` fully
- Check that `SUPABASE_URL` and `SUPABASE_ANON_KEY` are correct in `index.html`
- Open browser DevTools → Console — look for errors

**Admin upload fails?**
- Check Netlify env vars are set correctly (Step 7)
- Make sure you redeployed after adding env vars
- Open Netlify → Functions → admin → logs

**Users can't sign up?**
- Go to Supabase → Authentication → Providers → make sure Email is enabled
- Check Supabase → Authentication → Email Templates (confirm email may be required)
- To disable email confirmation: Supabase → Auth → Settings → uncheck "Enable email confirmations"

**Images blurry / not loading?**
- Check that the `photos` storage bucket was created (Supabase → Storage)
- Make sure the bucket is set to **Public**

---

## Security Notes

- The `anon` key in `index.html` is safe to expose — it only has the permissions you set via RLS policies
- The `service_role` key bypasses all RLS — keep it ONLY in Netlify env vars, never in frontend code
- Row Level Security (RLS) is enabled on all tables — users can only read/write their own data
- The admin panel is protected by a password stored as a server-side env var
