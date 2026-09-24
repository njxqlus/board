# Collaborative Board beta

The board uses React Flow only as its interaction engine: all object types live on
one canvas and have their own visuals. Use the left icon toolbar to create objects,
drag to move, hover/select to expose connector handles, and double-click to edit.
The selected-object toolbar contains style and arrangement controls. Opacity zero
makes an object invisible without deleting its data. See the
[refactor verification report and remaining beta limitations](docs/REFACTOR_REPORT.md).
For the resize/toolbar follow-up, see [UI fixes](docs/UI_FIXES.md).
After installing this update, restart `bun run dev` and reload the page: the
React Flow dependency patch is not picked up by an already-running Bun HMR server.

### Temporary React Flow patch

`patchedDependencies` applies `patches/@xyflow%2Freact@12.11.6.patch` during Bun
installation. It defers React Flow's node ResizeObserver store updates to the
next animation frame and coalesces measurements. This addresses the reproduced
`ResizeObserver loop completed with undelivered notifications` during resizing;
it does not silence browser errors. Only the ESM entry points used by this app
are patched. Keep the patch, package manifest and lockfile together in Git.

When intentionally upgrading React Flow, first test the unpatched release with
`bun run build && bun test tests/e2e/selection-regression.test.ts` and manually
resize objects at 100% and fractional zoom in a freshly restarted dev server.
Remove the patch registration/file and regenerate the lockfile if the issue is
gone; otherwise port and re-test it against the new version. Do not assume a patch
for 12.11.6 applies to another version. Frozen installs retain the locked version.

The Docker context allows only source, migrations, patches and build inputs;
local credentials, Git history, agent settings, docs and test artifacts are not
sent to the builder. The image runs as the unprivileged `bun` user. Dependencies
include build tooling; this is not a minimal runtime-only image. Database/DAM
credentials are provided at runtime, never copied into the image.

Install Bun 1.3.14 or newer, run `bun install --frozen-lockfile`, then `cp .env.example .env`; set a 32+ character `BETTER_AUTH_SECRET`, a PostgreSQL `DATABASE_URL`, and a reachable private `JEAN_CLAUDE_BUN_DAM_SERVER_URL`.

Leave `TRUST_PROXY=false` for direct local deployment; set it to `true` only behind a proxy that overwrites `X-Real-IP`.

For a clean local setup, use the following sequence:

```sh
bun install --frozen-lockfile
cp .env.example .env
docker compose up -d postgres
# Set BETTER_AUTH_SECRET and the actual private DAM URL in .env before continuing.
bun run migrate
bun run user:create # run twice for two manual-test accounts
bun run dev
```

Open http://localhost:3000 and sign in. The DAM is an existing private prerequisite: use its operator-provided health/check command from the application host, then upload a small PNG through the board to verify the application, not the browser, can reach it. If port 5432 is already occupied, use `POSTGRES_PORT=5433 docker compose up -d postgres` and set the matching port in `DATABASE_URL`. Public registration is disabled; verify `POST /api/auth/sign-up/email` fails.

Use `bun run check`, `bun run test`, `bun run build`, and `bun run media:cleanup` for local validation. `GET /health/live` verifies process liveness and `GET /health/ready` verifies the database schema is ready. `bun run start` serves production and `docker build -t collaborative-board .` builds the single-replica application image; PostgreSQL and DAM remain external. Run migrations before replacing the application container.

## Operations

Start the local database with `docker compose up -d postgres`, inspect it with `docker compose logs -f postgres`, and stop it with `docker compose down` (the named `board-postgres` volume is retained). Apply database migrations before starting an application image:

```sh
DATABASE_URL='postgresql://board:CHANGE_ME@db-host:5432/board' \
BETTER_AUTH_SECRET='at-least-32-random-characters' \
bun run migrate
```

Build and run one production application replica, substituting real private service URLs and secrets locally:

```sh
docker build -t collaborative-board .
docker run --rm --name collaborative-board -p 3000:3000 \
  -e DATABASE_URL='postgresql://board:CHANGE_ME@db-host:5432/board' \
  -e BETTER_AUTH_SECRET='at-least-32-random-characters' \
  -e BETTER_AUTH_URL='https://board.example.test' \
  -e JEAN_CLAUDE_BUN_DAM_SERVER_URL='http://private-dam:3000' \
  -e APP_INSTANCE_ID='stable-installation-id' \
  collaborative-board
```

For a localhost-only Docker smoke test, set `BETTER_AUTH_URL=http://localhost:3000`; the application permits non-Secure cookies only for an HTTP loopback origin. Any non-loopback production origin continues to require HTTPS Secure cookies.

Use `docker logs -f collaborative-board`, `docker stop collaborative-board`, and `bun run media:cleanup` to inspect, stop, and retry due cleanup jobs. The beta intentionally supports exactly one application replica: presence, edit leases, and broadcasts are in memory. PostgreSQL backups and DAM storage/derivative backups are separate operational responsibilities.

`bun run test:integration` requires an isolated `TEST_DATABASE_URL` whose auth and board migrations have already been applied, for example `DATABASE_URL="$TEST_DATABASE_URL" bun run migrate` followed by `TEST_DATABASE_URL="$TEST_DATABASE_URL" bun run test:integration`; never point it at a development or production database. For browser smoke testing, install a local browser once with `bunx playwright install chromium`, start an isolated app instance, then run `E2E_BASE_URL=http://127.0.0.1:3000 bun run test:e2e`. Supplying temporary `E2E_EMAIL` and `E2E_PASSWORD` runs login, lifecycle, and production deep-link checks; supply a separate `E2E_MEMBER_EMAIL` and `E2E_MEMBER_PASSWORD` to include the two-browser realtime collaboration test. Real-service cases skip without `E2E_BASE_URL` rather than silently exercising production data.

## MCP

### Remote MCP (recommended)

The application serves a **Streamable HTTP MCP endpoint at `/mcp`**. Your Mac
needs only Codex: no repository checkout, Bun, local adapter, or SSH tunnel.

1. On the server, run `bun run migrate` before starting the updated application
   (includes `005_mcp_access_keys.sql`). Set `BETTER_AUTH_URL=https://your-domain`
   and expose the application through HTTPS. Preserve the `Authorization`,
   `Accept`, `Content-Type` and `MCP-Protocol-Version` headers in your reverse
   proxy; allow POST bodies of at least 6 MiB. The endpoint shares the app port.
2. Sign in to the website, open **Connect Codex / MCP** on the boards page, then
   **Create access key**. Save the key when shown; it cannot be retrieved later.
3. In Codex MCP settings add a **Streamable HTTP** server with URL
   `https://your-domain/mcp` and header `Authorization: Bearer YOUR_KEY`.
   Alternatively, use **Copy Codex configuration** and paste into your private
   `~/.codex/config.toml`, then reconnect/restart the MCP connection:

```toml
[mcp_servers.board]
url = "https://your-domain/mcp"
http_headers = { Authorization = "Bearer REPLACE_WITH_YOUR_KEY" }
```

Never commit that configuration/key or paste it into a chat. The header is a
secret stored in your local configuration; keep the file private. Alternatively,
use `bearer_token_env_var = "BOARD_MCP_TOKEN"` instead of `http_headers` if your
Codex process already receives that environment variable. No password is sent
by Codex when using a key. Local HTTP is for testing only.

Keys expire after 90 days, are stored only as SHA-256 hashes, and can be revoked
from the same panel. They carry the user's access to all owned/shared boards,
including edits and confirmed deletion; there are no per-board/read-only key
scopes yet. MCP cannot create keys or manage membership. Revocation and board
permissions are checked on every request. In-flight commands already authorized
may finish. At most 10 active keys can exist per user.

All 22 tools and both resource templates are available remotely. Remote
`media_upload`/`media_replace` take `file: {filename, mimeType, base64}` instead
of `absoluteFilePath` (4 MiB decoded limit); remote clients cannot read server
files. Larger media can still be uploaded through the board UI. Text/table
content is Tiptap JSON; object schemas and a text example are available through
`board://{boardId}/schema`. There is no direct Markdown/PDF/DOCX import.

Transport is stateless request/response JSON over Streamable HTTP, with no
sticky sessions or long-lived SSE subscription. GET and DELETE `/mcp` return
405; missing/expired/revoked credentials return 401. Cross-origin browser
requests are rejected. OAuth discovery/login is not implemented: use the key
header, not `codex mcp login`. There is still no mixed-command `board_batch` or
paginated board read. The board's realtime layer remains single-replica.

Verification commands:

```sh
bun run check
bun run test
bun run build
bun test tests/e2e/selection-regression.test.ts
# After migrating a disposable test database, never your development/production DB:
DATABASE_URL="$TEST_DATABASE_URL" BETTER_AUTH_URL=http://localhost:3057 \
  bun test tests/e2e/remote-mcp.e2e.test.ts
```

The remote test requires `TEST_DATABASE_URL` to be exported and identical to
`DATABASE_URL`, with `test` in its database name. It provisions test users and
boards, starts a local production server, and checks browser key creation,
HTTP MCP initialization/discovery, content mutation/idempotency, cross-user
denial, browser visibility and key revocation. It leaves fixtures in that
disposable database. It does not exercise a deployed domain/TLS proxy or DAM.

### Optional legacy stdio adapter

For existing local integrations only, the stdio adapter remains supported:

```json
{"mcpServers":{"collaborative-board":{"command":"bun","args":["/ABSOLUTE/PATH/TO/board/src/mcp/server.ts"],"env":{"BOARD_URL":"http://localhost:3000","BOARD_EMAIL":"person@example.com","BOARD_PASSWORD":"REPLACE_LOCALLY","BOARD_MCP_UPLOAD_ROOT":"/ABSOLUTE/PATH/TO/agent-output"}}}}
```

Run `bun run mcp` to launch it. It exposes board lifecycle, semantic object reads, versioned object/connector mutation and arrangement, private media upload/read/duplicate/replace, YouTube placement, operation lookup, and the `board://{boardId}/summary` and `board://{boardId}/schema` resources. MCP must use the configured user identity and cannot manage membership.

Run `bun run build` before `bun run test:e2e`: the self-contained canvas regression
runs even without service credentials. Real-service cases skip when their required
environment variables are absent. Add `E2E_DAM=1` to include a real stdio MCP
upload/read/delete of its own temporary asset using the configured private DAM.

See [the manual acceptance checklist](docs/MANUAL_ACCEPTANCE.md) for the real PostgreSQL/DAM/MCP verification workflow.
