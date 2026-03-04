# ◆ ReviewDrop

A free, self-hosted website feedback tool. Upload screenshots or PDFs, drop
comment pins anywhere on the page, and share with your team. No accounts needed
to review.

---

## Deploy in ~15 minutes (free)

### Step 1 — Supabase setup

1. Go to https://supabase.com and sign up (free)
2. Click **New Project** → name it `reviewdrop` → set a password → Create
3. Wait ~2 minutes for it to spin up
4. Go to **Storage** → **New Bucket** → name it `reviewdrop-files` → check
   **Public bucket** → Create
5. Go to **Database → SQL Editor → New Query**
6. Paste the entire contents of `schema.sql` and click **Run**
7. Go to **Project Settings → API** and copy:
   - **Project URL** (looks like `https://xxxx.supabase.co`)
   - **anon public** key (long string starting with `eyJ...`)

### Step 2 — GitHub repo

1. Go to https://github.com → **New repository** → name it `reviewdrop`
2. Upload all these project files into the repo (drag & drop works)

### Step 3 — Deploy to Vercel

1. Go to https://vercel.com → sign up with GitHub (free)
2. Click **Add New Project** → select your `reviewdrop` repo → Import
3. Under **Environment Variables**, add:
   - `VITE_SUPABASE_URL` → paste your Supabase Project URL
   - `VITE_SUPABASE_ANON_KEY` → paste your Supabase anon key
4. Click **Deploy**
5. Done! You get a URL like `reviewdrop.vercel.app`

---

## Local development

```bash
npm install
cp .env.example .env
# Fill in your Supabase credentials in .env
npm run dev
```

---

## How it works

- **Upload** any screenshot (PNG/JPG) or PDF
- **Pin Comment** → click anywhere on the image to drop a pin
- **Share** the Vercel URL — anyone can open it, no account needed
- **Real-time** — comments appear instantly for all viewers via Supabase Realtime
- **Resolve** comments as feedback gets addressed
- **Gallery** shows all uploaded projects with open/resolved counts

---

## Stack

- React + Vite (frontend)
- Supabase (database + file storage + realtime)
- Vercel (hosting)
- PDF.js (PDF rendering, loaded on demand)
