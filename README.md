# StudyMate — Telegram study bot + Mini App + Admin panel

A brand-new, dependency-free (no `npm install`) Node app. Telegram bot, a full-screen Mini App for students and a management panel for staff.

* **Student Mini App** (`/app/`): Access (ad servers, countdown, quotas) · Lectures (level → subject → faculty → batch → chapters → lecture picker) · Study (timer, rankings, recap, groups + chat, live, profile, 14 badges) · Customised Planner (5-step wizard, daily plan, PDF, reminders) · Referral · Points.
* **Bot**: welcome, force-join channels, referrals, deep-link delivery, **staff upload sessions**, `/stats /ban /unban /grant /panel`, daily plan reminders, nightly DB backup to the owner.
* **Admin panel** (`/admin/`): dashboard, students, batches, faculty, subjects, **content manager** (chapters/lectures/notes), resources, announcements, **ad servers**, access, payments view, analytics, **study tracker** (live timing, groups moderation), roles/permissions (Super Admin, Admin, Faculty, Moderator, Support), settings, logs, backup.

## Setup (10 minutes)
1. **BotFather**: create a bot → copy the token. `/mybots → your bot → Bot Settings → Menu Button` is set automatically; optionally create a Main Mini App (URL `https://YOUR_URL/app/`, enable *full screen*).
2. Create a **private channel** for storage, add the bot as **admin**, copy its id (`-100…`).
3. Copy `.env.example` → `.env` (or set env vars on your host): `BOT_TOKEN, OWNER_ID, PUBLIC_URL, STORAGE_CHANNEL_ID`.
4. Run: `node --no-warnings server.js` (**Node ≥ 22.5**). Docker/Render files are included; mount a **persistent disk** at `DATA_DIR`.
5. Open the bot → `/panel` → *Batches → new batch* (+ Faculty, Subjects, Ad servers, Settings).

## Uploading lectures (the flow)
`/upload` in the bot (staff only) → choose **batch → subject → chapter (or ➕ new chapter)** → forward/send videos and PDFs.
Videos become lectures (name from caption/file name, **duration read from Telegram**), PDFs/images become chapter notes. Toggle *Videos→Lectures / Everything→Notes*, change chapter, **Done**. Students with *New lecture alerts* get notified. Files live in your storage channel; students receive them via `copyMessage` (forward-protected).

## How access works
Students get a time window from **Ad servers** (admin-defined links; claim after a minimum watch time), referrals, points redemption or admin `/grant`. Free lectures have a daily quota (extra via “lecture” ad servers). Premium batches unlock by enrolling a student (Students → batch → add). Staff are unlimited.

## Security
Every request is authenticated with Telegram-signed `initData` (HMAC); roles enforced on the server; strict CSP; per-user rate limits; input validation; bans checked everywhere.

## Tests
`npm test` — 37 tests (API, RBAC, bot flows with a fake Telegram API, planner/PDF, study engine) and real-browser suites (Playwright + Chromium, skipped if not installed) that visit **every screen at 320/360/390/430 px and desktop** and fail on missing icons, horizontal overflow or a screen that does not fill the viewport.

## Honest limitations
* Verified against a **fake Telegram API and headless Chromium**, not a live bot/Telegram client. Do a staging run first (esp. multi-lecture sends, full-screen mode, ads opening in the in-app browser).
* **Ads**: claims are time-based unless your network supports postback (`POSTBACK_SECRET` + `/api/postback?token=…&secret=…`). “Click-bonus” tiers from the reference are not implemented.
* **Premium payments**: no payment gateway; enrol after you receive payment.
* Test Series card links to an admin-set URL (Settings).  The ad “Pro tip” sheet is built in.
* Uses `node:sqlite` (experimental in Node 22). Data lives in one SQLite file — keep it on a persistent disk; nightly backups are sent to the owner as a document and kept in `DATA_DIR/backups`.
* Group chat history is stored locally (last ~1500 messages per group).
