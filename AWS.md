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
