#!/bin/bash
# Paste into EC2 "User data" (Amazon Linux 2023 / Ubuntu) OR run once with sudo. Installs Docker + compose.
set -e
if command -v dnf >/dev/null; then dnf install -y docker git && systemctl enable --now docker && mkdir -p /usr/local/lib/docker/cli-plugins && curl -fsSL https://github.com/docker/compose/releases/latest/download/docker-compose-linux-x86_64 -o /usr/local/lib/docker/cli-plugins/docker-compose && chmod +x /usr/local/lib/docker/cli-plugins/docker-compose
else apt-get update && apt-get install -y docker.io docker-compose-v2 git && systemctl enable --now docker; fi
usermod -aG docker ec2-user 2>/dev/null || usermod -aG docker ubuntu 2>/dev/null || true
echo "Docker ready. Now: upload the project, create .env (see AWS.md), run: docker compose up -d --build"
