# OT Tracker — Setup Guide

A private family web app for tracking occupational therapy sessions.
Hosted on **Vercel**, backed by **Supabase**, code on **GitHub**.

---

## Prerequisites

- A [Supabase](https://supabase.com) account (free tier works great)
- A [GitHub](https://github.com) account
- A [Vercel](https://vercel.com) account (free tier, connect with GitHub)

---

## Step 1 — Create Supabase Project

1. Go to [app.supabase.com](https://app.supabase.com) → **New Project**
2. Choose a name (e.g. `ot-tracker`), pick your region, set a strong database password
3. Wait ~2 minutes for the project to spin up

---

## Step 2 — Run Database Migration

1. In your Supabase project → click **SQL Editor** (left sidebar)
2. Click **New query**
3. Paste the entire SQL block below and click **Run**:

```sql
-- Sessions table
create table if not exists public.sessions (
  id                   uuid default gen_random_uuid() primary key,
  date                 date not null,
  therapist_name       text,
  activities           text,
  notes_recommendations text,
  tags                 text[] default '{}',
  created_at           timestamptz default now()
);

-- Session media table (one row per attached photo/video)
create table if not exists public.session_media (
  id           uuid default gen_random_uuid() primary key,
  session_id   uuid references public.sessions(id) on delete cascade,
  storage_path text not null,
  file_name    text,
  mime_type    text,
  thumbnail    text,
  created_at   timestamptz default now()
);

-- Therapists table (for autocomplete)
create table if not exists public.therapists (
  name text primary key
);

-- Enable Row Level Security
alter table public.sessions      enable row level security;
alter table public.session_media enable row level security;
alter table public.therapists    enable row level security;

-- Policies: any authenticated user can read/write all data
create policy "family_full_access" on public.sessions
  for all to authenticated using (true) with check (true);

create policy "family_full_access" on public.session_media
  for all to authenticated using (true) with check (true);

create policy "family_full_access" on public.therapists
  for all to authenticated using (true) with check (true);
```

---

## Step 3 — Create Storage Bucket

1. In Supabase → click **Storage** (left sidebar)
2. Click **New bucket**
3. Name it exactly: `session-media`
4. Leave **Public bucket** UNCHECKED (private — only authenticated users)
5. Click **Save**

Now add storage policies — go to **Storage → Policies** and run this SQL:

```sql
-- Allow authenticated users to upload
create policy "auth_upload" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'session-media');

-- Allow authenticated users to read/download
create policy "auth_read" on storage.objects
  for select to authenticated
  using (bucket_id = 'session-media');

-- Allow authenticated users to delete
create policy "auth_delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'session-media');
```

---

## Step 4 — Create Parent Accounts

1. In Supabase → **Authentication → Users** → **Invite user**
2. Enter the first parent's email → **Send invitation**
3. Repeat for the second parent
4. Each parent will receive an email to set their password

> **Disable public signups** (so no one else can create accounts):
> Go to **Authentication → Providers → Email** → turn OFF **Enable sign-ups** → Save

---

## Step 5 — Get Your API Keys

1. In Supabase → **Settings → API**
2. Copy **Project URL** (looks like `https://abcdefgh.supabase.co`)
3. Copy **anon public** key (long JWT string)

Open `config.js` in the project folder and paste both values:

```js
window.SUPABASE_URL      = 'https://YOUR_PROJECT_ID.supabase.co';   // ← paste here
window.SUPABASE_ANON_KEY = 'YOUR_ANON_KEY_HERE';                    // ← paste here
```

> ⚠️ `config.js` is in `.gitignore` — it will NOT be pushed to GitHub.
> You will add these values directly in Vercel's environment config instead (Step 7).

---

## Step 6 — Push to GitHub

In the `OT Tracker` folder, open a terminal and run:

```bash
git init
git add .
git commit -m "Initial commit: OT Tracker"
```

Then create a **private** repository on GitHub:
1. Go to [github.com/new](https://github.com/new)
2. Name it `ot-tracker`, set to **Private**
3. Do NOT initialise with README (you already have one)
4. Copy the remote URL and run:

```bash
git remote add origin https://github.com/Sheila0324/Axell-OT-Tracker.git
git branch -M main
git push -u origin main
```

---

## Step 7 — Deploy on Vercel

1. Go to [vercel.com](https://vercel.com) → **Add New Project**
2. Import your `ot-tracker` GitHub repository
3. Leave all build settings at defaults (Vercel detects it as a static site)
4. Under **Environment Variables**, add:
   - `NEXT_PUBLIC_SUPABASE_URL` → your Supabase Project URL
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY` → your anon key

   > **Wait** — since this is a plain static site (no build step), Vercel env vars don't automatically inject into JS. Instead, you need to **add a `config.js` file via Vercel's file override feature** or handle it another way.

### Simplest approach for a private family app:

**Option A (recommended for private repos):** Add a real `config.js` to your local folder with actual values, and **add it to git** (safe for a private repo):

```bash
# In .gitignore, comment out or remove "config.js"
git add config.js
git commit -m "Add Supabase config"
git push
```

Since the repository is **private**, your keys are not exposed to the public. Vercel will deploy `config.js` as part of the site.

**Option B:** After Vercel deploys, open your Vercel project → **Settings → Functions** and configure rewrites to serve a dynamic config endpoint. (More complex — only needed if you make the repo public.)

5. Click **Deploy** → wait ~30 seconds → your app is live! 🎉

---

## Step 8 — Share the URL

Send the Vercel URL to both parents (looks like `https://ot-tracker-xxx.vercel.app`).

Each parent opens the link, signs in with the email they received the invitation for, and you're both looking at the same shared data.

---

## Future Updates

Any time you update the code:

```bash
git add .
git commit -m "Your change description"
git push
```

Vercel automatically redeploys within ~30 seconds.

---

## Troubleshooting

| Problem | Solution |
|---|---|
| "Missing Supabase config" on load | Check `config.js` has real values, not placeholders |
| Login says "Invalid credentials" | Check the parent used the email from the invitation |
| Photos not uploading | Verify the `session-media` bucket exists and storage policies are added |
| App shows blank page on Vercel | Check Vercel deploy logs for errors |
| "relation does not exist" error | Re-run the SQL migration in Supabase SQL Editor |
