# auto-drive-test

A self-contained Auto Drive S3 endpoint for client integration tests. It runs the same S3 code path as production (nginx, the download API, the upload migration worker, auth and credits) on local storage only: uploads stay in the container's Postgres and are never published to the Autonomys Network. Every container starts empty and needs no network access.

Not for production use: the credentials are fixed and public.

## Run

```bash
docker run --rm -d -p 127.0.0.1:28640:80 ghcr.io/autonomys/auto-drive-test
```

The port accepts connections once the endpoint is ready, usually a few seconds after start. The container also prints `auto-drive-test ready` and reports healthy at that point.

| Setting | Value |
|---|---|
| Endpoint | `http://127.0.0.1:28640` (path-style addressing) |
| Region | `us-east-1` |
| Access key ID | `0123456789abcdef0123456789abcdef` |
| Secret access key | `auto-drive-test` |

To use a different access key ID, pass `-e AUTO_DRIVE_TEST_ACCESS_KEY_ID=<key>`.

## Clients

rclone 1.76 and later (or a current beta) has an Auto Drive provider:

```ini
[autodrive-test]
type = s3
provider = Autonomys
endpoint = http://127.0.0.1:28640
access_key_id = 0123456789abcdef0123456789abcdef
secret_access_key = auto-drive-test
```

With earlier rclone versions use `provider = Other` with `force_path_style = true` and `no_check_bucket = true`.

AWS CLI:

```bash
AWS_ACCESS_KEY_ID=0123456789abcdef0123456789abcdef AWS_SECRET_ACCESS_KEY=auto-drive-test \
  aws --endpoint-url http://127.0.0.1:28640 --region us-east-1 s3 ls
```

## What differs from production

- Nothing is published on-chain or archived, so reads always come from the container's database and never from the files gateway.
- Content moderation is stubbed: no object is ever reported as banned.
- Upload and download credit limits are 1 PiB.
- Payments are off.

## Logs

Service logs are in `/var/log/auto-drive-test/` inside the container:

```bash
docker exec <container> tail -n 50 /var/log/auto-drive-test/download-api.log
```

`DEBUG_LEVEL` (default `info`) sets the backend and auth log level.

## Build

From the repository root, with submodules initialised:

```bash
docker build -f docker/auto-drive-test/Dockerfile -t auto-drive-test .
```
