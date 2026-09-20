# Local Docker deployment

Run commands from this directory. The generated, Git-ignored `.env` selects
`docker-compose.yml` and `docker-compose.local.yml` automatically.

## Addresses and credentials

- LobeHub: <http://localhost:3210>
- Admin: <http://localhost:3211>
- Admin username: `admin`; password: `ADMIN_PASSWORD` in `.env`.
- The main application uses its own user accounts; the admin account is separate.

Use `localhost`, not `127.0.0.1`, in the browser: authentication checks the
configured origin. Published application and gateway ports bind to loopback only.
PostgreSQL and Redis are reachable only inside the Compose network.

The local override pins compilation to CPU 0, limits Rust build workers, and disables glibc rseq during
the image build to avoid a fork/memory-lock stall observed on this Docker
Desktop WSL kernel. These build arguments do not change the production defaults.

## Operations

```powershell
Set-Location E:\lobehub\lobehub\docker-compose\deploy
docker compose ps
docker compose up -d --no-build --wait --wait-timeout 300
docker compose logs --tail 100 lobe admin

# Rebuild from the current checkout before starting updated services.
docker compose build --build-arg USE_CN_MIRROR=true admin lobe
docker compose up -d --no-build --wait --wait-timeout 300

# Apply settings saved through the admin UI.
docker compose restart lobe

# Stop the deployment, preserving data.
docker compose stop
```

Database and Redis data live in the `lobehub_postgres_local` and
`lobehub_redis_data` Docker volumes. Keep `.env`: it contains encryption keys and
the bootstrap password. Changing `ADMIN_PASSWORD` does not reset an existing
admin account. Do not use `docker compose down -v` unless intentionally deleting
the deployment's data.

Model-provider credentials and S3 storage are not provisioned by this local
override. It removes the image's empty `S3_ENDPOINT` default so optional storage
does not fail URL validation at startup. Configure providers and storage through
the admin UI before using model calls or file uploads. QStash scheduled workflows
also require separate configuration. No external model or payment request is
part of deployment verification.
