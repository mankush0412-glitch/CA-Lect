# Management Upgrade — Faculty / Batch / Student / Subject / Resource system + new Admin Panel

This adds a reference-style **Lectures flow** for students and a new **Management Panel** for staff, without touching
the existing bot logic, payments, ads, referrals or deployment. No new environment variables, no new runtime dependencies.

## What was added

| Path | Purpose |
|---|---|
| `core/entity-store.js` | One generic `entities` table in the existing SQLite DB (+ Mongo mirror hooks). Safe, additive schema: nothing existing is altered. |
| `core/rbac.js` | Roles/permissions, signed Telegram `initData` verification (HMAC, 24 h max age), actor resolution. |
| `core/service.js` | All business logic + validation: faculty, subjects, batches, assignments, students, resources, categories, announcements, access, analytics, admins, config, logs, backup, student catalog. |
| `core/router.js` | HTTP layer (`/api/admin/*`, `/api/catalog`). Every route declares its required permission; enforced server-side. Rate limit, idempotency key, body limits. |
| `core/wire.js` | Glue: mounts the APIs, mirrors entities to MongoDB, restores them on a fresh disk (Render), runs the announcement scheduler. |
| `public/admin.html` | New admin panel (mobile-first, Telegram WebApp). |
| `public/lectures-v2.js` | New student Lectures flow (+ WhatsApp-channel reminder), loaded by `index.html`. |
| `core/study.js`, `core/study-router.js` | Study tracker engine + student API `/api/study/*` (timer, goal, streaks, 14 badges, leaderboards, live, recap, profile, groups & chat). |
| `public/study-v2.js` | New **Study** tab: Timer · Rankings · Recap · Groups(+chat) · Live · Profile. |
| `routes/course.js` | +`setVisibilityFilter` hook on `GET /batches` and `GET /batches/:bid` (default allow-all). |
| `server.js` | +4 small edits: mount (`core/wire`), visibility hook, `mgmt.setBot(bot)`, `/panel` command + “Open Admin Panel” button on `/admin`. |
| `public/index.html` | +1 script tag; bottom-nav “Home” relabelled “Lectures”. |
| `test/` | 27 automated tests (API, RBAC, study engine, glue, and three real-browser end-to-end suites). |

## Opening the panel
* Owner (`OWNER_ID`) is always **Super Admin** and can never be locked out.
* Send `/admin` (owner) or `/panel` (any active staff account) → **Open Panel** → `/admin.html`.
* Staff are added in the panel under **More → Admin & staff** (Telegram numeric ID + role).

## Roles
| Role | Can do |
|---|---|
| Super Admin | Everything, incl. staff, restore backup |
| Admin | Everything except staff management |
| Faculty | **Only their own batches**: view batches/students of those batches, upload resources to them, announce to them |
| Moderator | View students/batches, block/unblock, announcements |
| Support | Read-only: students, batches, announcements |

Per-account `extraPerms` / `deniedPerms` allow fine tuning. Every denial is written to the activity log.

## Data model (entities table; kinds)
`faculty`, `subject`, `batchmeta` (level, type regular/fastrack, label e.g. “May 2026”, institute tag, dates, status
upcoming/active/completed/archived, visibility), `assignment` (batch + subject → faculty), `enrollment` (student ↔ batch),
`resource`, `category`, `notification`, `admin_user`, `log`, `config`.
Existing `batches` documents are **not changed**; metadata sits beside them. Enrolling a student also adds them to the
batch’s existing `premiumUsers`, so the existing access checks keep working unchanged.

## Study tab (matches the reference)
* **Timer**: ring + per-subject play/pause, daily goal, Pomodoro (25/5). Subjects come from *Subjects* in the panel (defaults used if empty), plus up to 4 custom subjects per student.
* **Time is counted on the server** (start → stop/heartbeat every 30 s). If the app is closed/backgrounded the session is ended and only up to 90 s after the last heartbeat is counted, so leaving a timer running cannot inflate hours. Days use IST; a day counts toward a streak at ≥ 30 min.
* **Rankings** (today / week / all-time, top 50 + your rank), **Live** (who is studying now, 20 s refresh), **Recap** (day/week/month/all, daily breakdown, subject split, *Send recap to Telegram*), **Profile** (display name, goal, streak, calendar history, 14 badges, danger zone).
* **Groups**: official group per level (auto-joined), create public/private with invite code, join by code, group leaderboard, chat (polled every 4 s, 500 chars, replies, 1 message/1.2 s).
* **Admin → More → Study tracker**: live timing, today overview/trends, top students, groups moderation (delete messages, remove members, delete groups), per-student study stats + reset. Dashboard shows “N studying now”.

## Student flow (matches the reference)
Level chooser → Free/Premium → Subjects grid → Teachers (Regular/Fastrack) → Batches → Chapters (Lectures / Notes) →
bottom-sheet picker (single tap, Select Multiple, Select All, Send N to bot). A subject’s teachers come from the batches
that contain that subject; set the faculty on the batch (or per-subject under *Batch → Assign*). Batches that have no
faculty do not appear in the new flow — assign one in the panel.

## Deploying
Nothing special: deploy as before (`npm start`). On first start the new table is created automatically. Existing data is untouched.
On Render the entities are mirrored to a new Mongo collection `entities` and restored if the disk is wiped.

## Tests
`npm test` (Node ≥ 22 for `node:sqlite`; the browser suites need Playwright + Chromium and are skipped if absent).

## Known limitations (read this)
* **Not run against the real server stack.** Express/Mongoose/better-sqlite3/the Telegram library could not be installed in the build sandbox (no network), so `server.js` was only syntax-checked and the glue was tested with fakes. Do a staging deploy first.
* **Not tested inside the real Telegram client.** UI tests ran in headless Chromium with a signed fake `initData`.
* **Multi-send timing:** “Send N lectures” opens each bot deep link ~1.8 s apart. Whether Telegram clients honour rapid successive `openTelegramLink` calls was not verified on a device.
* **Still not built:** the *Customised Planner* (5-step schedule + PDF + daily reminders), the Access-tab restyle (countdown tiles, “Ad Server” cards, today's usage), the “Pro tip” ad sheet, and lecture durations / daily lecture-quota chips. The planner and durations need a per-lecture duration field the current data model does not have; the Access tab and Pro-tip sheet are tied to your existing ad system and were left untouched.
* **Chat history is not mirrored to MongoDB** (study time, memberships and profiles are). On Render, a restart can clear old group messages.
* The “bot welcome / join channels” chat screens in the PDF are bot messages, not the web app; they were not changed.
* Content management: the panel manages batches, faculty, subject catalogue, assignments, students and **resources** (links / existing bot file codes). Creating chapters/lectures and uploading videos still use the existing owner tools, as they depend on the bot’s forwarding pipeline.
* Resources are managed and access-scoped in the panel API, but are **not yet shown to students** in the app.
* CSV/JSON downloads use a browser download; some Telegram in-app browsers block those.
* The icon font and Google font load from CDNs (as the existing app does).
