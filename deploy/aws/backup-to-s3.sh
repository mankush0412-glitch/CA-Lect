#!/bin/bash
# Optional: copy the app's nightly SQLite backups to S3. Needs AWS CLI + an instance role with s3:PutObject on the bucket.
# cron (daily 03:30):  30 3 * * * /home/ec2-user/studymate/deploy/aws/backup-to-s3.sh my-bucket
set -e; BUCKET="${1:?usage: backup-to-s3.sh <bucket>}"
docker run --rm -v studymate_studymate-data:/data:ro -v "$HOME/.aws:/root/.aws:ro" -e AWS_REGION amazon/aws-cli s3 sync /data/backups "s3://$BUCKET/studymate-backups/" --only-show-errors
