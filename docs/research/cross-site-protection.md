# #96 — Which cross-site protection should guard the local API?

Research date: 2026-10-24. Inspected commit: `7234291` (origin/main). Map:
[#93](https://github.com/LordHalyana/Backlogger/issues/93). Ticket:
[#96](https://github.com/LordHalyana/Backlogger/issues/96).

Throwaway research branch `research/cross-site-protection`, never merged. **No
product choice is made here.** Findings, experiments and options with
trade-offs only. All `file:line` citations are against `7234291`.

---

## 1. Current state of the code

### Server, CORS and body parsing

- Bind address defaults to `0.0.0.0` (`packages/api/src/server.ts:23`).
  `BACKLOGGER_ALLOWED_ORIGINS` defaults to `*` (`server.ts:36`); `''` parses to
  an empty list, which disables CORS (`server.ts:99-106`).
- CORS is the [`cors`](https://github.com/expressjs/cors) package 2.8.6 on
  Express 4.22.2 / body-parser 1.20.5 (`package-lock.json`). Configuration in
  `packages/api/src/app.ts:81-105`:
  - `*` means `origin: true`: **reflect any origin** (`app.ts:86-91`).
  - With a list, requests with no `Origin` are always allowed
    (`app.ts:93-94`); others get the header only if listed (`app.ts:95-96`).
  - `credentials: false`, methods `GET, POST, PUT, DELETE, OPTIONS`, allowed
    request headers `Content-Type, If-Match, Idempotency-Key`, exposed `ETag`
    (`app.ts:98-101`).
- The only body parser is `express.json({ limit: '24mb' })`, mounted globally
  (`app.ts:38`). There is **no** `express.urlencoded`, `express.text`,
  `express.raw`, multer or other multipart handling anywhere in
  `packages/api/src`. Import sends file contents inside JSON
  (`routes/import.ts:15`). `express.json` only parses when `Content-Type`
  matches its `type` option, default `"application/json"`; otherwise `req.body`
  is `{}` ([Express 4 API, express.json](https://expressjs.com/en/4x/api/express/)).
  So **`text/plain` is not parsed as JSON** (verified in §3).
- There is no Host header check and no Origin enforcement. The cors README is
  explicit that the package "sets response headers—it doesn't block requests",
  "CORS is not access control" and "Your server receives and processes every
  request" ([cors README](https://github.com/expressjs/cors/blob/master/README.md)).
  The existing test locks this: a denied origin still gets `200`
  (`packages/api/src/app.test.ts:73-82`).
- In production the same Express app serves the built UI and an SPA fallback
  (`server.ts:69-79`), so the UI is same-origin with the API.

### Every state-changing route

| Route                                     | File                              | Needs a JSON body?            |
| ----------------------------------------- | --------------------------------- | ----------------------------- |
| `POST /api/projects`                      | `routes/projects.ts:22-29`        | yes (Zod)                     |
| `PUT /api/projects/:id`                   | `routes/projects.ts:31-38`        | yes                           |
| `DELETE /api/projects/:id`                | `routes/projects.ts:40-46`        | no (Idempotency-Key optional) |
| `POST /api/projects/:id/reload`           | `routes/project-reload.ts:14-33`  | **no**                        |
| `POST /api/projects/:id/folders`          | `routes/project-folders.ts:58-69` | yes                           |
| `DELETE /api/projects/:id/folders/*`      | `routes/project-folders.ts:72-81` | no                            |
| `POST /api/projects/:projectId/documents` | `routes/documents.ts:31-39`       | yes                           |
| `POST /api/projects/:projectId/import`    | `routes/import.ts:11-20`          | yes                           |
| `PUT /api/documents/:id`                  | `routes/documents.ts:88-97`       | yes (+ optional If-Match)     |
| `DELETE /api/documents/:id`               | `routes/documents.ts:99-107`      | no                            |
| `POST /api/documents/:id/file`            | `routes/documents.ts:109-123`     | yes                           |
| `POST /api/documents/:id/move`            | `routes/documents.ts:125-133`     | yes                           |
| `POST /api/documents/:taskId/comments`    | `routes/comments.ts:19-32`        | yes (validated in service)    |
| `PUT /api/comments/:commentId`            | `routes/comments.ts:48-61`        | yes                           |
| `DELETE /api/comments/:commentId`         | `routes/comments.ts:63-74`        | no                            |
| `POST /api/capture`                       | `routes/capture.ts:10-17`         | yes                           |
| `POST /api/recovery/:operationId/recheck` | `routes/recovery.ts:23-28`        | **no** (needs operation id)   |
| `POST /api/recovery/:operationId/dismiss` | `routes/recovery.ts:30-35`        | **no** (needs operation id)   |
| `POST /api/recovery/:operationId/abandon` | `routes/recovery.ts:37-49`        | yes (`review_token`)          |
| `POST /api/admin/reindex`                 | `routes/admin.ts:16-23`           | **no**                        |
| `POST /api/admin/reload-templates`        | `routes/admin.ts:25-37`           | **no**                        |

All GET routes are reads. No mutation is reachable by GET.

### How the web client calls the API

- All JSON calls go through `apiFetch`, which **always** sets
  `Content-Type: application/json`, even on body-less POSTs
  (`packages/web/src/lib/api.ts:15-22`; e.g. `lib/reindex.ts:24`,
  `lib/projects.ts:104`, `lib/recovery.ts:159,197`). Two plain `fetch` GETs
  exist (`App.tsx:42`, `lib/graph.ts:28`). All URLs are relative (`/api/...`).
  No custom header beyond `If-Match` / `Idempotency-Key` is sent. No
  `credentials` option (there are no cookies anyway).
- Dev: Vite serves the UI and proxies `/api` and `/health` to
  `http://127.0.0.1:${BACKLOGGER_PORT}` (`packages/web/vite.config.ts:4-5,17-20`),
  and binds `0.0.0.0` (`vite.config.ts:15`). The string shorthand becomes
  `{ target, changeOrigin: true }` in Vite's source
  (`node_modules/vite/dist/node/chunks/dep-BK3b2jBa.js:61756`, Vite 5.4.21), so
  the API sees **`Host: 127.0.0.1:3333`** but the browser's
  **`Origin: http://<host>:5173`** (verified in §3). The browser itself sees a
  same-origin request.
- Consequence: **the bundled UI never makes a cross-origin request**, neither
  in production (same server) nor in dev (proxy). CORS response headers are
  only used by third-party browser pages.
- E2E runs the UI at `http://127.0.0.1:5173` (`playwright.config.ts:30,56`).
  API tests use supertest against `createApp` (`packages/api/src/test-support.ts:53`),
  which sends `Host: 127.0.0.1:<ephemeral port>` and no Origin.

### Docker

- `docker-compose.yml:6` publishes `"3002:3002"` on all host interfaces;
  `BACKLOGGER_HOST: 0.0.0.0` and `BACKLOGGER_ALLOWED_ORIGINS: "*"`
  (`docker-compose.yml:24-27`; also `Dockerfile:92-93`). Inside a container the
  server must bind a non-loopback address or port publishing cannot reach it;
  loopback-only exposure has to come from `ports: "127.0.0.1:3002:3002"`
  (bind question, outside this ticket).
- The healthcheck calls `http://localhost:3002/health` from inside the
  container (`docker-compose.yml:29-30`), so it sends `Host: localhost:3002`.
- With port mapping, the browser's `Host` and `Origin` carry the **host-side**
  port (e.g. `localhost:8080` if mapped `8080:3002`), not 3002.

### CLI and scripts

- Operator docs use `curl -X POST http://127.0.0.1:3333/api/admin/reindex` with
  no body and no headers (`docs/operations/backup-restore.md:89`).
- The repo scripts (`scripts/reindex.ts`, `scripts/migrate.ts`, bench scripts)
  open the database directly; none call the HTTP API.

### Markdown rendering

- One shared markdown-it 14.2.0 instance: `html: false, linkify: true,
breaks: true, typographer: false` (`packages/shared/src/markdown.ts:18-23`).
  No custom `validateLink`, so markdown-it's default applies.
- Wiki-link renderer (`markdown.ts:25-31`, rule `markdown.ts:43-63`): emits
  `<a class="wiki-link" data-title="${escapeHtml(title)}" href="#">`; the
  display text is a normal `text` token (escaped by markdown-it). `escapeHtml`
  escapes `& < > "` (`markdown.ts:65-71`), sufficient for a double-quoted
  attribute. It sets no `id` or `name`.
- The three `dangerouslySetInnerHTML` sites, all fed by `renderMarkdown`:
  - `packages/web/src/components/DocumentPreview.tsx:107` (document bodies,
    including imported and mounted files).
  - `packages/web/src/components/CommentBody.tsx:69` (comment bodies).
  - `packages/web/src/components/HelpDrawer.tsx:109` (bundled help content).
- Post-render DOM code: `markTerms` only splits text nodes and creates
  `<mark>` via `textContent` (`packages/web/src/lib/landing.ts:41-66`). Wiki
  links are resolved by reading `data-title` and matching against known titles
  (`packages/web/src/hooks/useWikiLinkNavigation.ts:36-47`). Relative `.md`
  links are intercepted; scheme links are left to the browser
  (`DocumentPreview.tsx:63-100`). No other `innerHTML`/`insertAdjacentHTML`
  use exists in `packages/web/src` or `packages/shared/src`.
- Existing locking tests cover `<script>`, `<img onerror>`, raw `<b>` and safe
  Markdown (`packages/shared/src/markdown.test.ts:5-35`). None cover
  `javascript:` links, `data:` URIs or wiki-link attribute escaping.

---

## 2. Browser facts that decide the threat model

From the [WHATWG Fetch standard](https://fetch.spec.whatwg.org/):

- CORS-safelisted methods are `GET`, `HEAD`, `POST`
  ([§2.2.1](https://fetch.spec.whatwg.org/#cors-safelisted-method)).
- A `Content-Type` header is safelisted only when its essence is
  `application/x-www-form-urlencoded`, `multipart/form-data` or `text/plain`
  ([§2.2.2](https://fetch.spec.whatwg.org/#cors-safelisted-request-header)).
  So `application/json`, `If-Match`, `Idempotency-Key` and any custom header
  force a preflight; `PUT` and `DELETE` always do.
- `no-cors` mode "restricts requests to using CORS-safelisted methods and
  CORS-safelisted request-headers" and returns an opaque response
  ([request mode](https://fetch.spec.whatwg.org/#concept-request-mode)). The
  request is still **sent**; only the response is hidden.
- [Append a request `Origin` header](https://fetch.spec.whatwg.org/#append-a-request-origin-header):
  `Origin` is always sent for CORS-tainted requests, and for **every request
  whose method is not GET/HEAD** in any mode (forms, `no-cors`). It is omitted
  only for non-CORS GET/HEAD, which includes same-origin GETs. For non-CORS
  requests the referrer policy can turn it into the literal `null`; with the
  default `strict-origin-when-cross-origin` this happens when an **`https:`
  page posts to an `http:` URL**, i.e. exactly a public HTTPS site posting to
  `http://127.0.0.1`.
  - Implication: a modern browser never sends a mutation without `Origin`, so
    "no Origin" means a non-browser client. `Origin: null` must be treated as
    foreign, not as absent. OWASP says the same: "Missing headers and
    `Origin: null` are not evidence of a same-origin request."
- [Fetch Metadata](https://www.w3.org/TR/fetch-metadata/) `Sec-Fetch-Site`
  takes `cross-site`, `same-site`, `same-origin` or `none`, cannot be set by
  script (`Sec-` prefix), and is **only sent to potentially trustworthy URLs**.
  Per [Secure Contexts](https://www.w3.org/TR/secure-contexts/), `127.0.0.0/8`,
  `::1` and `localhost` / `*.localhost` qualify; plain-HTTP LAN IPs or
  hostnames (`http://192.168.1.10:3002`, `http://backlogger.local`) and
  rebinding hostnames (`http://evil.example`) do **not**. "Same-site" ignores
  ports, so `http://localhost:5173` and `http://localhost:3333` are same-site.
- [Chrome Local Network Access](https://developer.chrome.com/blog/local-network-access)
  (prompt launching in Chrome 142) asks permission before a **public** site
  reaches loopback/local addresses. It is one browser, it is a user prompt, and
  the blog does not discuss DNS rebinding. Vite's advisory notes PNA-era Chrome
  (94+) was not affected by its rebinding issue. Useful defence in depth; not a
  server control.

---

## 3. Experiments (local, this commit)

API started twice with `tsx` on scratch data dirs: port 3901 with the default
(`*`), port 3902 with `BACKLOGGER_ALLOWED_ORIGINS=http://127.0.0.1:5173`. curl
simulated browser headers. Results were the same on both ports except where
noted.

| #   | Request (simulating)                                                                                                                             | Result                                                                                                                                                           |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `POST /api/projects`, `Origin: http://evil.example`, `Content-Type: text/plain`, JSON-looking body (form `enctype=text/plain` / `no-cors` fetch) | `400` — body not parsed; no project created                                                                                                                      |
| 2   | Same with `application/x-www-form-urlencoded`                                                                                                    | `400 VALIDATION_FAILED` (`id`/`name` required)                                                                                                                   |
| 3   | `POST /api/admin/reindex`, evil Origin, `text/plain`, no body                                                                                    | **`200`, reindex ran** on both ports (3901 also returned `Access-Control-Allow-Origin: http://evil.example`)                                                     |
| 4   | `POST /api/projects/inbox/reload`, evil Origin, no body                                                                                          | **`200`, reload ran** on both ports (`inbox` always exists)                                                                                                      |
| 5   | Preflight `OPTIONS /api/projects/inbox` for `PUT` + `content-type` from evil Origin                                                              | 3901: `204` with ACAO = evil origin and all methods → **browser would proceed**. 3902: `200` without CORS headers → browser blocks                               |
| 6   | `POST /api/projects` with `application/json` from evil Origin                                                                                    | `201` on both: the server never rejects. On 3901 a browser would allow this (and read the response); on 3902 the preflight in #5 stops a browser from sending it |
| 7   | `GET /api/projects` with `Host: rebind.evil.example:<port>`, no Origin (post-rebinding same-origin read)                                         | **`200`, full project list** on both                                                                                                                             |
| 8   | `POST /api/projects` JSON with `Host` and `Origin` both `rebind.evil.example` (post-rebinding write)                                             | **`201`** on both                                                                                                                                                |
| 9   | `POST` with `Content-Type: application/vnd.api+json`                                                                                             | `400` — only `application/json` is parsed                                                                                                                        |

Vite dev proxy (Vite 5.4.21, string shorthand, echo server as target):

- Request to `http://127.0.0.1:5199/api/x` with `Origin: http://127.0.0.1:5199`
  arrived as `Host: 127.0.0.1:3903`, `Origin: http://127.0.0.1:5199`;
  `Sec-Fetch-Site` was passed through unchanged.
- A forged `Host: rebind.evil.example:5199` got **`403 Blocked request. This
host ("rebind.evil.example") is not allowed`** from Vite itself. The dev
  server is already rebinding-safe; the API port behind it is not.

Not tested: a real browser against a public origin (no public host available),
and Docker (one manual check is planned by the map).

Plain-language summary of today's exposure:

- **Default config (`*`) — any website can read and write everything.** Any
  page the user visits can `fetch` the API with CORS, pass preflights, create,
  edit and delete projects, documents and comments, and read all content.
  Docker ships this configuration.
- **With an allowlist set** — preflighted requests (JSON bodies, PUT, DELETE)
  are blocked by the browser. Simple cross-site POSTs still execute; because
  only JSON is parsed, the reachable actions are the **body-less POSTs**:
  reindex, template reload, project reload (any known project id, `inbox`
  always works), and recovery recheck/dismiss (needs an operation id).
  Impact: unwanted work / load, not data change.
- **DNS rebinding works regardless of allowlist** — once a hostname rebinds to
  127.0.0.1 the attacker's page is same-origin: reads (GET, no Origin) and
  writes (Origin = attacker host, which CORS never blocks server-side) both
  succeed. Only a Host check (or Origin enforcement on writes) stops it.

---

## 4. Mechanisms

### A. Host header allowlist (anti-rebinding)

Reject any request whose `Host` hostname is not allowed. Prior art:

- Vite: `server.allowedHosts` — "`localhost` and domains under `.localhost`
  and all IP addresses are allowed by default"; the check is skipped over HTTPS
  ([Vite 5 server options](https://v5.vite.dev/config/server-options));
  introduced by [GHSA-vg6x-rcgg-rjx6](https://github.com/vitejs/vite/security/advisories/GHSA-vg6x-rcgg-rjx6)
  ("Non-HTTPS servers are vulnerable to DNS rebinding attacks without validation
  on the Host header"; patched 6.0.9 / 5.4.12 / 4.5.6).
- webpack-dev-server: `allowedHosts: 'auto'` always allows `localhost`, `host`
  and the websocket hostname; `'all'` is "NOT RECOMMENDED as apps that do not
  check the host are vulnerable to DNS rebinding attacks"
  ([webpack dev-server docs](https://webpack.js.org/configuration/dev-server/)).

Allowing any IP literal is rebinding-safe because rebinding needs an
attacker-controlled DNS name. Matching hostname only (ignoring port) survives
Docker port remapping (`localhost:8080`) and supertest's ephemeral ports.

- Covers: rebinding for **reads and writes**, every route.
- Does not cover: ordinary cross-site requests (Host is the real one).
- Callers: UI prod/Docker (`localhost`, `127.0.0.1`), Vite dev (proxy rewrites
  to `127.0.0.1:<api>`), curl, healthcheck (`localhost`), supertest
  (`127.0.0.1`), future MCP client — all pass by default. Users reaching the app
  by a DNS name (`backlogger.local`, reverse proxy) would need configuration.

### B. Origin enforcement on state-changing requests

Reject non-GET/HEAD/OPTIONS requests whose `Origin` is present and not allowed
(`null` counts as not allowed); allow absent `Origin` (non-browser clients, per
the Fetch rule in §2). OWASP lists "Using Standard Headers to Verify Origin"
and says to reject if neither Origin nor Referer establishes a trusted source
([OWASP CSRF cheat sheet](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html));
allowing absent Origin is a deliberate relaxation for CLI use, defensible
because browsers always send Origin on these methods. The MCP spec requires
"Servers MUST validate the `Origin` header on all incoming connections to
prevent DNS rebinding attacks … If the `Origin` header is present and invalid,
servers MUST respond with HTTP 403 Forbidden"
([MCP transports, 2025-11-25](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports)).

What is "allowed"? Two sub-options:

- **B1. Explicit list** (e.g. reuse `BACKLOGGER_ALLOWED_ORIGINS`). Simple and
  predictable, but the server cannot know the host-side Docker port or LAN
  address in advance; the list must include every origin the UI is opened from
  (`http://localhost:3002`, `http://127.0.0.1:3002`, dev `:5173` variants).
- **B2. Same-origin by comparison**: allow when `Origin`'s host:port equals the
  request's `Host`. Works for prod, Docker with any port mapping, and LAN by IP
  with zero configuration. Fails in dev because Vite rewrites `Host` (Origin
  `:5173` vs Host `:3333`) — fixable by `changeOrigin: false` in
  `vite.config.ts` or by listing dev origins. **Rebinding passes B2** (Origin
  and Host both say `evil.example`), so B2 is only safe together with A.
  Reverse proxies that rewrite Host would also need care (LAN mode, out of
  scope).

- Covers: all browser cross-site writes, including simple/no-cors POSTs and
  form posts; rebinding writes when B1 is used (attacker Origin not listed).
- Does not cover: rebinding **reads** (same-origin GET sends no Origin).
- Callers: curl/CLI/MCP-over-HTTP send no Origin → pass. UI passes if its
  origin is allowed.

### C. Require a non-safelisted header on mutations (JSON content type or a custom header)

Requiring `Content-Type: application/json` (or e.g. `X-Backlogger: 1`) on every
non-GET forces any cross-origin browser request through a preflight. OWASP:
custom request headers are "particularly well suited for AJAX or API
endpoints"; "disallow these simple content types" for JSON APIs; caveat that a
browser bug letting headers through would break it.

- Covers: simple/no-cors POSTs and forms — closes the four body-less POSTs that
  remain reachable today.
- Depends on CORS: useless while CORS reflects any origin (preflight passes).
- Does not cover: rebinding (same-origin script can set any header).
- Callers: UI already sends `application/json` on every call
  (`lib/api.ts:19`) → no UI change for the JSON variant; a custom header would
  need one line in `apiFetch`. curl must add `-H 'Content-Type:
application/json'` to body-less POSTs; `backup-restore.md:89` would change.
  Test suites using `.send()` without a body would need updating for
  body-less routes.

### D. Fetch Metadata (`Sec-Fetch-Site`)

Reject mutations with `Sec-Fetch-Site: cross-site` (OWASP's default policy;
OWASP says an Origin-based fallback "is a mandatory requirement"). For this
app, rejecting `same-site` too matters, since any other app on
`localhost:<port>` is same-site.

- Covers: cross-site writes from browsers, when the header is present.
- Does not cover: rebinding and plain-HTTP non-loopback hosts (LAN, `.local`)
  — the header is not sent to non-trustworthy URLs (§2).
- Callers: Vite dev shows `same-origin` to the browser and forwards the header;
  prod `same-origin`; curl sends none → fallback path.
- Adds little over B for this app, since B is needed anyway as fallback.

### E. CORS configuration itself

- Narrowing CORS (empty or explicit list) stops cross-origin **reads** and
  preflighted writes. Since the bundled UI never makes cross-origin requests,
  an empty default does not affect it. Third-party browser pages (none exist
  today) would need explicit listing.
- It never blocks simple requests or rebinding (§3 #3, #4, #7, #8).

### Coverage matrix

| Threat                                               | A Host  | B1 Origin list | B2 Origin = Host | C header/JSON | D Fetch Metadata | E narrow CORS |
| ---------------------------------------------------- | ------- | -------------- | ---------------- | ------------- | ---------------- | ------------- |
| Cross-site JSON / PUT / DELETE                       | –       | yes            | yes              | only with E   | yes\*            | yes (browser) |
| Cross-site simple POST (form, `text/plain`, no-cors) | –       | yes            | yes              | yes, with E   | yes\*            | **no**        |
| Cross-site reads                                     | –       | –              | –                | –             | –                | yes           |
| Rebinding reads                                      | **yes** | –              | –                | –             | –                | –             |
| Rebinding writes                                     | **yes** | yes            | **no**           | –             | –                | –             |

\* when the header is sent (loopback / localhost URLs only).

### Combinations worth comparing

1. **A + B2 + empty CORS default** — zero configuration for prod, Docker any
   port and LAN-by-IP; dev needs `changeOrigin: false` or dev origins listed;
   names other than localhost need a Host allowlist entry.
2. **A + B1 + empty CORS default** — explicit; dev and Docker origins must be
   pre-listed or configured; rebinding writes also blocked by B1 alone.
3. **A + C + narrow CORS** — no Origin logic; relies on preflight semantics;
   curl scripts change; the CORS list must be right for C to mean anything.
4. **A + B + C** — belt and braces; most test churn.
5. Any of the above **+ D** — marginal for loopback; no help for LAN.

---

## 5. Default for `BACKLOGGER_ALLOWED_ORIGINS` once binding is loopback

Facts that bound the choice:

- The bundled UI does not need CORS in any mode (§1), so `*` buys nothing for
  Backlogger's own UI and grants every website full read/write.
- The `*` comment in `server.ts:33-35` and `.env.example:7-11` justify it with
  LAN access from `http://192.168.x.y:5173`; that path goes through the Vite
  proxy, so it is same-origin as well.
- Docker sets `*` explicitly (`docker-compose.yml:27`) and the docs describe it
  as the default (`docs/operations/deployment.md:108,114-118`,
  `docs/operations/security.md:43-52`).

Options:

- **Empty (no CORS headers).** Smallest surface; nothing in the repo breaks.
  Third-party browser tools must opt in.
- **Loopback dev origins** (`http://localhost:5173,http://127.0.0.1:5173`).
  Only meaningful if the variable also drives Origin enforcement (B1), since
  the UI does not need CORS.
- **Keep `*`.** Incompatible with any cross-site protection that leans on CORS
  (C, E); would need B to compensate.
- Separate question: should one variable drive both CORS response headers and
  server-side Origin rejection, or two (e.g. CORS vs mutation allowlist), plus
  a Host allowlist variable?

---

## 6. Sanitization

### Residual risk with the current renderer

markdown-it's own guidance: with HTML disabled, "Output will be safe without
sanitizer"; by default it prohibits `javascript:`, `vbscript:`, `file:` and
`data:` except gif/png/jpeg/webp images; the one plugin pitfall is generating
`id`/`name` from user input (DOM clobbering)
([markdown-it safety.md](https://github.com/markdown-it/markdown-it/blob/master/docs/safety.md)).
The default `validateLink` is
`/^(vbscript|javascript|file|data):/` → reject unless `data:image/(gif|png|jpeg|webp);`
(`node_modules/markdown-it/lib/index.mjs:31-39`).

Probe of `renderMarkdown` at this commit (28 payloads):

- Rejected (rendered as text): `javascript:` in any case, entity-encoded
  (`&#106;avascript:`, `javascript&colon;`), with leading space or control
  char, in angle brackets, as autolink, as reference definition; `vbscript:`,
  `file:`, `data:text/html`, `data:image/svg+xml`; raw `<img onerror>`,
  `<svg onload>`, `<script>`.
- Tab inside the scheme (`java\tscript:`) is percent-encoded to
  `java%09script:`, which browsers do not strip (only raw tab/newline are
  stripped by URL parsing), so it is a harmless relative URL.
- Link titles with quotes are escaped (`title="t&quot; onmouseover=…"`).
- Wiki-link with `"` or `<img …>` in title/display: escaped into
  `data-title` and text. No attribute break-out.
- **Allowed by design**: remote images (`![](https://tracker.example/p.gif)`)
  — loading a document fetches third-party URLs (privacy/beacon, reveals that
  the doc was opened); arbitrary `http(s)`, `//host`, `blob:` and
  `mailto:` links, including links to `http://127.0.0.1:3333/api/...` (GET
  only, so read-only); `data:image/png` images.

So with `html: false` and the default `validateLink`, script execution through
the renderer requires a markdown-it bug or a future config change (enabling
`html`, a plugin emitting raw HTML/attributes, a custom `validateLink`, or a
renderer rule that skips escaping). The wiki-link rule is the only custom
renderer and it escapes correctly but has no test for it.

### Would DOMPurify add real protection?

[DOMPurify](https://github.com/cure53/DOMPurify) (README: v3.4.17) strips
script-capable elements/attributes, enforces a URI allowlist (`http, https,
ftp, ftps, tel, mailto, callto, sms, cid, xmpp, matrix` by default),
sanitizes DOM clobbering by default (`SANITIZE_DOM: true`; optional
`SANITIZE_NAMED_PROPS` prefixing), needs a DOM (jsdom server-side; happy-dom
"not considered safe"), and warns that changing markup after sanitizing can
"void the effects of sanitization".

- Adds: a second, independent layer if markdown-it or a future plugin
  regresses; a place to enforce extra policy (e.g. strip remote `img`, force
  `rel=noopener` on links, drop `data:` images).
- Costs: a new browser-side dependency on every render path, a per-render
  cost on large documents (not measured), and the risk of stripping legitimate
  output (`class` and `data-*` attributes such as `data-title` are allowed by
  DOMPurify's defaults per its README, but this was not tested here). Rendering
  happens in the browser only (all three sites are client components), so no
  server DOM is needed; web tests already run under jsdom
  (`vitest.config.ts:14`, `packages/web/package.json:30`). Sanitizing must run
  last, after `renderMarkdown`, with nothing rewriting the HTML string
  afterwards.
- Does not add: protection against content that is already plain text after
  rendering; anything against CSRF.

### Locking tests as the alternative (or complement)

Cheap tests that would pin the current guarantees in
`packages/shared/src/markdown.test.ts`:

- `javascript:` / `vbscript:` / `file:` / non-image `data:` links and images
  never produce an `href`/`src` with those schemes (including entity- and
  case-encoded variants).
- Wiki-link titles and displays containing `"`, `<`, `>` stay escaped; no `id`
  or `name` is emitted.
- The renderer options stay `html: false` and `validateLink` stays the
  default (assert on the exported instance or on behaviour).
- A test that fails if a new `dangerouslySetInnerHTML` site appears without
  going through `renderMarkdown` (grep-style test or lint rule
  `react/no-danger` with an allowlist).

---

## 7. Open questions for the follow-up decision ticket

1. Which threat set must the local release close: cross-site writes only, or
   also cross-site reads and rebinding reads?
2. Host allowlist: Vite-style default (localhost, `*.localhost`, any IP
   literal) or loopback names only? Configuration variable name and format?
   Hostname-only matching (port-agnostic, needed for Docker remapping)?
3. Origin rule: explicit list (B1), Origin = Host (B2), or both? Is `Origin:
null` rejected (Fetch says it appears for HTTPS→HTTP posts)? Are requests
   without Origin allowed for curl/MCP clients?
4. Do we also require `application/json` (or a custom header) on body-less
   POSTs, accepting that curl examples change?
5. Dev mode: switch the Vite proxy to `changeOrigin: false`, or list dev
   origins, or relax checks when `NODE_ENV !== 'production'`?
6. `BACKLOGGER_ALLOWED_ORIGINS` default: empty, loopback dev origins, or keep
   `*`? One variable for CORS and Origin enforcement, or separate ones? What
   does Docker compose ship?
7. Status code and body for rejections (403 with the standard error shape,
   as MCP requires 403 for bad Origin)? Logged?
8. Is `/health` exempt from the Host check (Docker healthcheck uses
   `localhost`, so not needed by default)?
9. Fetch Metadata: include as a first check or skip as redundant?
10. Sanitizer: add DOMPurify on the three sites, or rely on locking tests
    (and a lint/grep guard for new `dangerouslySetInnerHTML`)? Should remote
    images be blocked or proxied regardless (privacy, not XSS)?
11. Security release gates (map #93): which of §3's probes become automated
    tests — cross-origin simple POST rejected, forged Host rejected, preflight
    from foreign origin refused, `Origin: null` rejected, curl without Origin
    accepted?
