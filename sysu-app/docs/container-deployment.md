# Container deployment status

The repository-root `Dockerfile` builds only the SYSU App Node.js API and Socket.IO service. It does not include the Vite frontend or the SYSU Go API. Compose reads the API environment from the existing `backend/.env`, clears local `DB_ADMIN_*` bootstrap credentials from the container environment, fixes the container port at `3000`, and publishes it on host loopback at `127.0.0.1:3000` by default. The optional `HOST_PORT` variable changes the host-side port; Apache on the same machine can proxy HTTP and WebSocket traffic to that loopback address.

Before starting Compose, create `backend/.env` from `backend/.env.example` if it does not exist, then configure the required values. From the repository root:

```sh
docker compose up --build -d
docker compose ps
docker compose logs -f api
```

For the portal's upload-and-extract workflow, the frontend is a separate static build in `frontend/hosting-dist/`; zip and upload that directory to the portal's web root after building with the final public API/Socket.IO origins. The SYSU Go API is maintained in the sibling project. Local development runs the App API, Vite frontend, and Go API on ports `3000`, `5173`, and `3001` respectively.

The current MySQL configuration accepts loopback database hosts only. Inside the API container, `localhost` refers to the container, and Compose does not start a MySQL service. Therefore the container cannot currently connect to a MySQL server on the LAMP host using the supported database configuration. This remains a deployment blocker; do not change the database host security policy as a workaround. A LAMP host also needs Node.js for the Express and Socket.IO APIs; Apache/PHP/MySQL alone is insufficient.

The Apache virtual host, SPA fallback, TLS termination, WebSocket proxy settings, and proxy trust configuration have not been created or verified. Do not expose the API port publicly; keep the loopback binding and place a correctly configured Apache proxy in front of it. Before production deployment, resolve container-to-MySQL networking without weakening the database host policy, then verify TLS/proxy origins, backup/restore, health/readiness behavior, and staging end to end. No deployment was performed.

## Read-only deployment smoke check

After the company provides the public service origins and starts the two Node services behind Apache, run this from a workstation with Node.js 24. Supply the actual frontend, SYSU App API, and SYSU Go API origins; the command never submits credentials or changes application data. The same command works in PowerShell and a Unix shell.

```sh
node scripts/deployment-smoke.mjs https://web.example.com https://app-api.example.com https://go-api.example.com
```

The check requires HTTPS, fetches the frontend page, checks App `/health/live` and `/health/ready`, checks Go `/api/health` and `/api/health/ready`, and verifies an Engine.IO WebSocket upgrade through each public API origin. Both readiness endpoints require the configured `sysu_fleet_app` database and a successful read-only `SELECT 1`. A local-only run may use loopback HTTP origins with `--allow-http-local`; this option rejects non-loopback HTTP endpoints.

Go `/api/health` remains a liveness check; `/api/health/ready` checks the Go database connection and expected central database name. The read-only smoke script never returns database host, username, or password. Confirm the Node processes restart after a reboot and inspect Apache configuration with `apachectl -t` (or the host's equivalent). A successful smoke check does not verify authenticated Socket.IO subscriptions, Android access, trip workflows, backups, or the web map; perform those staging checks with dedicated test accounts before release.
