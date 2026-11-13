# Deploying StudyMate on AWS

StudyMate is a single Node process with a SQLite file. That makes **one EC2 instance (or Lightsail) with an EBS disk** the right fit.
Do **not** run two copies at once (no Auto Scaling >1, no multiple ECS tasks): SQLite is a single-writer database.

## Option A — EC2 + Docker + automatic HTTPS (recommended)

1. **Domain**: point an `A` record (e.g. `bot.yourdomain.com`) to the instance's **Elastic IP** (EC2 → Elastic IPs → Allocate → Associate).
2. **Launch** an EC2 instance: Amazon Linux 2023 or Ubuntu 22.04/24.04, `t3.micro`/`t4g.small` is enough to start, 20 GB gp3 disk.
   Security group inbound: **22** (your IP only), **80** and **443** (anywhere). Nothing else.
   Paste `deploy/aws/ec2-userdata.sh` into *User data* (installs Docker + Compose), or run it once with `sudo`.
3. **Upload the project** (`scp -r studymate ec2-user@<ip>:~/` or `git clone`).
4. **Create `.env`** next to `docker-compose.yml`:
   ```
   BOT_TOKEN=<main bot token>
   OWNER_ID=<your numeric telegram id>
   PUBLIC_URL=https://bot.yourdomain.com
   DOMAIN=bot.yourdomain.com
   STORAGE_CHANNEL_ID=-100xxxxxxxxxx
   WEBHOOK_SECRET=<long random string>
   BRAND_NAME=StudyMate
   # optional
   DELIVERY_BOT_TOKEN=
   RAZORPAY_KEY_ID=
   RAZORPAY_KEY_SECRET=
   ```
5. `docker compose up -d --build` — Caddy fetches the HTTPS certificate on its own. Check `https://bot.yourdomain.com/healthz` → `{"ok":true,…}`.
6. In Telegram: open the bot → `/start`. The webhook (and the delivery bot's webhook) are registered automatically from `PUBLIC_URL`.
7. Open `https://bot.yourdomain.com/admin/` (or the Admin button in the bot) and fill batches, faculties, subjects and force-join channels.

Update later: upload new code → `docker compose up -d --build`. Data lives in the `studymate-data` Docker volume and survives rebuilds.
Logs: `docker compose logs -f app`.

## Keeping your lectures/notes when the server is replaced
The index of lectures, notes, users and settings is one SQLite file in `DATA_DIR` (`/data` in Docker). Lectures themselves stay in your Telegram storage channel.
If a container/instance is rebuilt **without** its disk, the index is empty and lectures look "lost". Three safety nets (use at least one):
1. **Persistent disk** – with `docker compose` the `studymate-data` volume already survives `docker compose up -d --build`. Do NOT use `docker compose down -v` or plain `docker run` without `-v studymate-data:/data`.
2. **MongoDB** – set `MONGO_URI` (same name as the older bot; `MONGODB_URI` also works; Atlas free tier is fine). New/edited lectures, notes, chapters, faculties and settings are saved within ~30–60 s, everything else every 10 min. The app saves a compressed snapshot every `BACKUP_EVERY_MIN` minutes (only if something changed) and on shutdown, and **restores it automatically** when it starts with an empty disk. The Docker image installs the `mongodb` driver at build time (`npm install mongodb` if you run without Docker).
3. **Telegram pinned snapshot** – set `BACKUP_CHAT_ID` (or it uses `STORAGE_CHANNEL_ID`). The bot must be admin with “Pin messages”. Latest snapshot stays pinned and is restored on a fresh server. (Telegram lets bots download files up to ~20 MB; the index is normally far smaller.)

Force-join from env also accepts the older names: `FORCE_JOIN_CHANNELS` (ids), `FORCE_JOIN_CHANNEL_LINKS`, `FORCE_JOIN_CHANNEL_NAMES` (+ `_FOUNDATION` / `_INTERMEDIATE` suffix for one level). You can also give **only chat ids** (e.g. `JOIN_CHANNELS_FOUNDATION=-1001234567890,-1009876543210`): the bot fetches the title and join link itself (make the bot admin of those channels/groups). A link is only needed if the bot cannot read the chat.

Force a restore on a server that already has data: set `FORCE_RESTORE=1` once, restart, then remove it.

## Cloudflare in front of the app
If the Mini App opens with only the bottom bar and a blank page:
* Rules → Speed → Optimization: turn **Rocket Loader OFF**, **Auto Minify OFF** (JS/CSS/HTML), Email Obfuscation / Scrape Shield OFF.
* Caching → add a Cache Rule: **Bypass cache** for `/api/*`, `/tg/*` and `/app/*`.
* Security: turn **Bot Fight Mode / Under Attack OFF** for this hostname, or add a WAF *skip* rule for `/api/*` and `/tg/webhook` (Telegram’s webview and Telegram’s servers cannot solve captchas).
* SSL/TLS mode **Full** (not Flexible).
The app now shows an on-screen “Still loading… Reload” note with the error text if scripts are blocked, so you can see what is wrong.

## Backups
The app already writes a daily SQLite backup into `/data/backups` (and sends it to the owner on Telegram).
For an off-box copy: give the instance an IAM role with `s3:PutObject` on one bucket, then add a cron line
`30 3 * * * ~/studymate/deploy/aws/backup-to-s3.sh <bucket-name>`. Also enable **EBS snapshots** (Data Lifecycle Manager) for the instance volume.

## Option B — Lightsail
Same steps as A on a Lightsail Ubuntu instance (cheaper, fixed price, static IP + firewall built in). Open ports 80/443 in the Lightsail networking tab.

## Option C — App Runner / ECS Fargate
Possible only with exactly **one** task and an **EFS** volume mounted at `/data`; SQLite over NFS can be slow and is less safe. Put the service behind an ALB with an ACM certificate and set `PUBLIC_URL` to that https URL (drop `DOMAIN`, no Caddy). Prefer Option A.

## Checklist
- [ ] `PUBLIC_URL` is https and matches the domain; port 443 reachable from the internet
- [ ] Bot is **admin** in the storage channel and in every force-join channel (and the delivery bot is admin of the storage channel)
- [ ] Students have started the delivery bot once (Access tab shows the button)
- [ ] Razorpay: test with a real small payment; keys only in `.env`, never in the admin panel
- [ ] Only one app container running

## Tidy chat & pinned how-to video
Admin → Bot configuration: **Tidy bot chat** deletes the old menu messages on every `/start` (welcome, level choice, join gate, refer…). The **How to watch lectures** video is pinned in the student's chat and replaced (never duplicated) when they tap the button again; lecture videos/notes keep their own 24 h auto-delete rules.
