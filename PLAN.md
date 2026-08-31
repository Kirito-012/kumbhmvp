# PLAN.md — TheCraftSync

> A modern helpdesk/ticketing system. Same problem space as Trudesk (see [CONTEXT.md](./CONTEXT.md)),
> rebuilt on Next.js + TypeScript + MongoDB with a schema and architecture designed for the access
> patterns that actually matter.
>
> **How to use this file:** every actionable line is a `- [ ]` checkbox. As work lands, check the
> box (`- [x]`) instead of writing progress notes elsewhere — this file is the single source of
> truth for "what's actually done" across every phase.

---

## 1. Guiding Principles

1. **One source of truth per concern.** One permission engine. One data-fetching pattern. One state model.
2. **Type safety end to end.** Zod schemas define the contract; TypeScript types are derived, never hand-written twice.
3. **Nothing unbounded inside a document.** Comments, notes, attachments, and history are their own
   collections with indexes — the mistake that most hurts Trudesk.
4. **The list view is the hot path.** Every schema and index decision is judged against "does the
   ticket grid stay fast at 500k tickets?"
5. **Agent-first UX.** Keyboard shortcuts, saved views, bulk actions, command palette. Agents live here all day.
6. **Server-first rendering.** React Server Components for reads; Server Actions / route handlers for writes.
7. **Ship a working vertical slice each phase.** Every phase ends with something runnable and demoable.

---

## 2. Technical Stack

| Layer         | Choice                                                                            | Why                                              |
| ------------- | --------------------------------------------------------------------------------- | ------------------------------------------------ |
| Framework     | **Next.js 15+, App Router, TypeScript (strict)**                                  | RSC for fast reads, one deployable, one language |
| Runtime       | Node.js 22 LTS, **custom server** (`server.ts`)                                   | Needed to host Socket.IO in-process — see §8     |
| Database      | **MongoDB 7 + Mongoose 8**                                                        | Locked in. Redesigned schema (§3)                |
| Auth          | **Auth.js (NextAuth v5)**, Credentials provider + MongoDB adapter                 | Sessions in DB, SSO/2FA extensible               |
| Authorization | **CASL** (or a small hand-rolled ability layer) — single `defineAbilityFor(user)` | One engine, shared server + client               |
| Validation    | **Zod** — one schema per operation, reused for form + API + types                 | Kills the client/server contract drift           |
| Server state  | **TanStack Query** for client-side islands; RSC for everything else               | No Redux, no sagas, no Immutable                 |
| Client state  | **Zustand** for the little that's truly global (UI prefs, drawer state)           | ~1 KB, no boilerplate                            |
| Forms         | **react-hook-form + zodResolver**                                                 |                                                  |
| Styling       | **Tailwind CSS v4 + shadcn/ui** (Radix primitives)                                | Accessible by default, dark mode free            |
| Tables        | **TanStack Table** (headless) + virtualization                                    | Handles the 100k-row grid                        |
| Charts        | **Recharts** or **visx**                                                          | Dashboard + reports                              |
| Realtime      | **Socket.IO** in the custom server                                                | Same model as Trudesk, proven                    |
| Editor        | **Tiptap** (rich text) storing sanitized HTML, or MDX-lite                        | Better than EasyMDE; paste images, mentions      |
| Files         | **S3-compatible** (MinIO local, R2/S3 prod) via presigned URLs                    | Never store on the app filesystem                |
| Email out     | **Nodemailer + React Email**                                                      | Templates as typed React components              |
| Email in      | **ImapFlow + mailparser** worker                                                  | Cleaner than Trudesk's `imap` callbacks          |
| Jobs/queue    | **BullMQ + Redis**                                                                | SLA timers, email send, IMAP poll, digests       |
| Search        | Mongo **Atlas Search** if hosted, else a proper text index                        | No Elasticsearch dependency                      |
| Logging       | **Pino** structured logs                                                          |                                                  |
| Testing       | **Vitest** (unit) + **Playwright** (e2e) + **mongodb-memory-server**              |                                                  |
| Tooling       | pnpm, ESLint 9 flat config, Prettier, Husky + lint-staged, Commitlint             |                                                  |
| Deploy        | Docker + docker-compose (app, mongo, redis, minio); CI via GitHub Actions         | Build artifacts **never** committed              |

---

## 3. Data Model (Redesigned)

The headline change: **`comments`, `notes`, `attachments`, and `history` become top-level collections**
referencing `ticketId`. The ticket document stays small and fast, and the grid never pays for a
comment thread it isn't showing.

### Collections

```
users            _id, username, email, fullname, passwordHash, roleId, title, avatarUrl,
                 phone{work,mobile}, companyName, timezone, prefs{...},
                 apiKeyHash?, totpSecret?, isActive, lastLoginAt, deletedAt?
                 idx: {email:1} uniq, {username:1} uniq, {roleId:1}, {deletedAt:1}

roles            _id, key, name, description, grants[], rank, isSystem
                 → dynamic RBAC only. No parallel static role file.

groups           _id, name, slug, memberIds[], notifyEmails[], deletedAt?   // customer buckets
teams            _id, name, memberIds[], deletedAt?                          // agent buckets
departments      _id, name, teamIds[], groupIds[], allGroups:boolean         // teams → groups map

ticketStatuses   _id, name, slug, color, order, isResolved, isDefault, slaPausedInThis
ticketPriorities _id, name, slug, color, order, slaHours, overdueAfterHours
ticketTypes      _id, name, slug, allowedPriorityIds[], defaultPriorityId, isActive
tags             _id, name, slug, color, usageCount

tickets          _id, number (int, human-facing), subject, issue (sanitized HTML),
                 ownerId, groupId, assigneeId?, typeId, statusId, priorityId, tagIds[],
                 subscriberIds[], dueDate?, slaDueAt?, firstResponseAt?, resolvedAt?, closedAt?,
                 source: 'web'|'email'|'api'|'public',
                 counts: { comments, notes, attachments },   // denormalized, kept in sync
                 lastActivityAt, createdAt, updatedAt, deletedAt?
                 idx: {number:1} uniq
                      {deletedAt:1, statusId:1, lastActivityAt:-1}    // default grid
                      {deletedAt:1, assigneeId:1, statusId:1}          // "my tickets"
                      {deletedAt:1, groupId:1, statusId:1, createdAt:-1}
                      {deletedAt:1, slaDueAt:1}                        // overdue sweep
                      text index on {subject, issue}

ticketComments   _id, ticketId, authorId, body, isInternal:boolean, editedAt?, deletedAt?, createdAt
                 idx: {ticketId:1, createdAt:1}
                 → replaces BOTH comments[] and notes[]; `isInternal` is the only difference

attachments      _id, ticketId?, commentId?, uploaderId, filename, mimeType, size,
                 storageKey, createdAt
                 idx: {ticketId:1}

ticketEvents     _id, ticketId, actorId, action, field?, from?, to?, meta{}, createdAt
                 idx: {ticketId:1, createdAt:1}
                 → the audit trail. Append-only. Also the source for "activity feed".

notifications    _id, userId, type, title, body, link, ticketId?, readAt?, createdAt
                 idx: {userId:1, readAt:1, createdAt:-1}

notices          _id, title, message, color, isActive, startsAt?, endsAt?, createdBy
settings         _id, key (uniq), value, updatedBy, updatedAt   // typed via a Zod registry
savedViews       _id, ownerId?, isShared, name, filters{}, columns[], sort{}
counters         _id ('tickets'), seq                            // atomic ticket numbering
sessions         managed by Auth.js MongoDB adapter
```

### Deliberate departures from Trudesk

| Trudesk                                 | TCS_Ticket                                                       | Reason                                                  |
| --------------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------- |
| `comments[]` + `notes[]` embedded       | `ticketComments` collection with `isInternal`                    | Unbounded growth; grid pays for data it doesn't show    |
| `attachments[]`, `history[]` embedded   | own collections                                                  | same                                                    |
| `deleted: boolean`                      | `deletedAt: Date \| null`                                        | Tells you _when_; enables retention/purge jobs          |
| `pre('find')` auto-populate             | explicit `.populate()` / aggregation per query, **never** global | No hidden N+1                                           |
| static `roles.js` + DB roles            | DB roles only, one `grants[]` vocabulary                         | One source of truth                                     |
| `uid` via counters                      | `number` via same atomic counter (this was right)                | Keep it                                                 |
| status as number → ref migration debris | `statusId` ref from day one, `isResolved` flag on the status     | Clean                                                   |
| —                                       | `counts{}` denormalized on ticket                                | Grid shows "3 comments" without a lookup                |
| —                                       | `slaDueAt`, `firstResponseAt`                                    | SLA is a first-class concept, not a report afterthought |
| —                                       | `savedViews`                                                     | Agents' actual daily workflow                           |

### Permission vocabulary (single list)

```
ticket:read:own | ticket:read:group | ticket:read:all
ticket:create | ticket:update | ticket:delete | ticket:assign | ticket:merge
comment:create | comment:update:own | comment:update:any | comment:delete
note:read | note:create
attachment:create | attachment:delete
account:read | account:create | account:update | account:delete
group:manage | team:manage | department:manage
report:view | report:generate
notice:manage | settings:manage | role:manage
```

Seeded roles: **Admin** (all), **Manager**, **Agent**, **Customer**.

---

## 4. Route Map

```
(public)
  /login  /forgot-password  /reset-password/[token]  /register
  /submit                      ← public ticket submission (captcha + rate limit)
  /status/[number]/[token]     ← customer checks their ticket without an account

(app)  — authenticated shell: sidebar + topbar + command palette
  /dashboard
  /tickets                     ← grid, URL-driven filters, saved views
  /tickets/new
  /tickets/[number]            ← detail: thread, sidebar props, activity, attachments
  /tickets/[number]/print
  /reports
  /notifications
  /profile
  /accounts  /accounts/[id]
  /groups  /teams  /departments
  /settings/general
  /settings/tickets            ← types, priorities, statuses, tags
  /settings/roles
  /settings/mailer             ← SMTP + IMAP
  /settings/notifications
  /settings/logs

api/
  /api/auth/[...nextauth]
  /api/v1/tickets…             ← REST surface for integrations, API-key auth
  /api/webhooks/inbound-email  ← optional: SendGrid/Postmark inbound instead of IMAP
  /api/upload/presign
  /api/socket                  ← Socket.IO handshake
```

Writes go through **Server Actions** for first-party UI. `/api/v1/*` exists for external integrations
and mobile, sharing the same service layer — not a second implementation.

---

## 5. Application Architecture

```
src/
  app/                     routes (RSC by default; 'use client' only at interactive leaves)
  components/
    ui/                    shadcn primitives
    tickets/  dashboard/  settings/   feature components
  server/
    db/           mongoose connection (globalThis cache for HMR), models/
    services/     ticket.service.ts, user.service.ts, …   ← ALL business logic lives here
    actions/      server actions — thin: authz check → zod parse → service call → revalidate
    auth/         auth.ts, ability.ts (CASL), session helpers
    events/       domain event bus → socket emit + notification + email fan-out
    jobs/         BullMQ workers: sla, email-out, imap-poll, digest, purge
  lib/            zod schemas, formatters, constants, shared utils
  hooks/          client hooks
  emails/         React Email templates
  types/          derived types
```

**The rule:** route handlers and server actions never touch Mongoose directly. They authorize,
validate, and delegate to `server/services/*`. That's what makes the REST API and the UI share one
implementation, and what makes the whole thing testable.

**Domain events** — a service that mutates a ticket emits `ticket.updated` with a typed payload.
Subscribers handle: socket broadcast, `ticketEvents` audit write, notification creation, email queue.
Trudesk scatters these concerns through its controllers; centralizing them is a large clarity win.

---

## 6. Build Phases

Each phase ends **runnable**. Estimates assume focused solo work. Check items off as they land;
check the phase heading's own box only once every item under it (or its explicit exceptions) is done.

---

### Phase 0 — Foundation (~2 days)

- [x] `pnpm create next-app` — TypeScript, App Router, Tailwind, ESLint.
- [x] Tailwind v4 init; design tokens (color, spacing, radius, typography) — **dark theme only** (light theme deliberately deferred, see below).
- [ ] shadcn/ui init — **deliberately skipped.** Hand-rolled components in `src/components/ui/` already cover what's needed; migrating is pure churn with no functional gain right now. Revisit only if a component needs Radix-level a11y primitives the hand-rolled version can't cheaply match.
- [ ] Light theme — **deliberately deferred.** Product is dark-only by design decision (see `CONTEXT.md`/`PLAN.md` §2). Revisit only if explicitly requested.
- [x] Mongoose connection helper with `globalThis` caching (survives HMR) — `src/server/db/connect.ts`, built in Phase 1.
- [ ] Docker Compose: `mongo`, `redis`, `minio` — **`mongo` skipped**, MongoDB is a live Atlas cluster (`MONGODB_URI` in `.env.local`), not local Docker. `redis`/`minio` deferred to Phase 4 (attachments) and Phase 6 (jobs/queue) — no code needs them yet, so standing up empty containers now would be pure overhead. `.env.example` still not written (real `.env.local` has live secrets; revisit before onboarding a second developer).
- [x] Pino logger (`src/lib/logger.ts`, wired into `dbConnect()`), `error.tsx`/`global-error.tsx`/`not-found.tsx` — note: this Next.js version's `error.tsx` API uses `unstable_retry()`, not the old `reset()`.
- [x] ESLint + Prettier (`eslint-config-prettier`) + Husky (`.husky/pre-commit`, `.husky/commit-msg`) + lint-staged (`.lintstagedrc.json`) + commitlint (conventional). Vitest scaffolded (`vitest.config.ts`, 2 test files, 5 passing tests) + Playwright scaffolded (`playwright.config.ts`, `e2e/auth.spec.ts`, 3 passing tests, Chromium installed).
- [x] GitHub Actions: `.github/workflows/ci.yml` — lint → typecheck → unit tests on PR/push to main. **E2E intentionally excluded from CI** — the Playwright suite hits a real Mongo lookup on invalid-credential submission, which would need `MONGODB_URI` as a CI secret; revisit once there's a CI-dedicated database. Workflow exists locally but hasn't run yet — no GitHub remote/push has happened.
- [x] `.gitignore` that **excludes build output** (unlike Trudesk). Local git repo initialized (`git init`); no remote configured yet.

**Done when:** `pnpm dev` serves a themed empty shell; `pnpm test` and CI pass. ✅ `pnpm lint`, `npx tsc --noEmit`, `pnpm test` (5/5), and `pnpm e2e` (3/3) all pass locally. CI workflow is written but unverified against actual GitHub Actions since there's no remote yet.

---

### Frontend Prototype — Pulled Forward (done ahead of schedule)

Built before the backend phases, per explicit request, to lock the visual direction early.
UI only — mock data in `src/lib/mock-data.ts`, no live services behind these screens yet.

- [x] App shell: sidebar nav (desktop fixed + mobile drawer), topbar, user menu block, responsive breakpoints.
- [x] Login page — split-screen branding + form, SSO buttons (UI only, not wired), email/password fields.
- [x] Dashboard page — stat cards, ticket volume chart, priority breakdown, top groups, recent tickets, agent leaderboard (all mock data).
- [x] Tickets list page — toolbar, filterable table UI, badges/avatars/tags, pagination footer (mock data, no real filtering/pagination logic yet).
- [x] Design system tokens: OLED dark background, emerald `#10b981` accent, violet `#818cf8` secondary, status/priority color coding.
- [x] Rebrand sidebar + app to **TheCraftSync**.
- [x] Rebrand remaining "TCS Ticket" strings (root layout `<title>` metadata, login page logo label ×2, login page copyright line).
- [ ] Wire these pages to real auth/data once Phases 1–2 land (replace mock imports with service calls).

---

### Phase 1 — Identity & Access (~4 days)

- [x] Mongoose models: `users`, `roles` (+ `ticketStatuses`/`ticketPriorities`/`ticketTypes` pulled forward from Phase 2 since the seed script needed them). Auth.js session/account collections **not created** — see JWT note below.
- [x] Auth.js v5: Credentials provider, bcrypt hashing. **Session strategy is JWT, not DB** — Auth.js hard-rejects database sessions when every provider is `credentials` (`UnsupportedStrategy` at boot). Revisit DB sessions if/when an OAuth provider is added.
- [x] Login, logout via Server Actions (`src/server/actions/auth.actions.ts`) + `useActionState` on the login form.
- [ ] Forgot-password → emailed token → reset. Rate limiting on auth routes.
- [x] CASL ability builder from `role.grants[]` (`src/server/auth/ability.ts`); `requireAbility()` / `requireUser()` helpers (`src/server/auth/session.ts`).
- [x] Route guards — **`src/proxy.ts`**, not `middleware.ts`: this Next.js version renamed the middleware file convention to `proxy.ts` (same directory level as `app/`). A split `auth.config.ts` (no providers) keeps the proxy's bundle free of mongoose/bcrypt.
- [x] Seed script: 4 roles (Admin/Manager/Agent/Customer), an admin user, default statuses/priorities/types — `pnpm seed`, reads `SEED_ADMIN_EMAIL`/`SEED_ADMIN_PASSWORD` from `.env.local`.
- [ ] First-run setup wizard at `/install` — skipped per decision; seed script is the bootstrap path for now.
- [x] App shell: sidebar nav, topbar, user menu, responsive drawer _(built in the frontend prototype above)_ — **now wired to the real session** (real name/role/logout in the sidebar footer, no more mock `people.aria`).
- [ ] Theme toggle (currently dark-only, no toggle exists).

**Done when:** you can register/seed, log in, see a role-appropriate nav, and be blocked from
routes you lack grants for. ✅ Verified end-to-end in the browser: login → dashboard (real user data) → logout → direct `/dashboard` hit while logged out redirects to `/login`.

> **Database note:** `MONGODB_URI` points at an Atlas cluster's `trudesk` database. That database
> previously held unrelated Trudesk test data, which was fully wiped (all collections dropped) at
> the user's explicit request before seeding TheCraftSync's own collections into it.

---

### Phase 2 — Ticket Core (~6 days)

- [x] Models: `tickets`, `ticketComments`, `ticketEvents`, `counters`, plus `tags`. _(`ticketStatuses`/`ticketPriorities`/`ticketTypes` already built + seeded in Phase 1 — see `src/server/db/models/`.)_ **Deviation:** `tickets.groupId` is optional (nullable), not required — Groups don't exist until Phase 3. Will become required once Phase 3 lands.
- [x] `ticket.service.ts`: create, get (`getTicketByNumber`), list (filter+sort+paginate via `listTickets`), update fields (`updateTicketFields`), soft-delete/restore, `addComment`/`listComments`/`listEvents`, `countTicketsByStatus`.
- [x] Atomic ticket numbering via `findByIdAndUpdate` `$inc` on `counters` (`src/server/db/models/counter.model.ts`).
- [x] **Ticket grid** — TanStack Table (manual pagination/sorting mode, no client-side row model needed since filtering/sorting/paging all happen server-side), URL-state filters
      (`?status=&priority=&type=&tag=&q=&sort=&dir=&page=`, `assignee`/`from`/`to` supported in the service layer but not yet exposed in the toolbar UI), sortable via a dropdown, empty state. **Row virtualization skipped** per earlier decision (revisit if/when row counts justify it).
- [x] **Ticket detail** (`/tickets/[number]`) — Tiptap issue body (sanitized HTML rendered read-only), inline-editable sidebar (status/assignee/priority/type/due date — **tags/subscribers editing not yet built**, group omitted since Groups don't exist), comment thread with internal-note toggle, activity timeline from `ticketEvents`.
- [x] **Create ticket** — full page (`/tickets/new`) with Tiptap editor, Zod-validated (`src/lib/schemas/ticket.ts`), type→allowed-priorities cascade wired in `NewTicketForm.tsx`. **Modal variant not built** — full-page only.
- [x] Every mutation writes a `ticketEvent` (create/status/assignee/priority/type/due-date changes, comments, notes). Every Server Action calls `requireAbility()` (CASL) before touching data.

**Done when:** an agent can create, find, filter, open, edit, comment on, and close a ticket.
**This is the milestone that makes the product real.** ✅ Verified end-to-end in the browser: created ticket #1, changed status/assignee, posted a reply, confirmed all changes logged in the activity timeline, confirmed grid/tab counts/full-text search all reflect real DB state.

> **Not yet built (carried forward):** ticket merge/split, tags UI (model exists, no picker yet), subscribers, attachments (Phase 4), realtime updates (Phase 5), bulk actions (Phase 8). The `/tickets/[number]/print` route from §4 also isn't built.

---

### Phase 3 — Org Structure & People (~4 days)

- [ ] Groups (customers), Teams (agents), Departments (mapping) — CRUD + member pickers.
- [ ] Visibility rules enforced in `ticket.service.ts`:
  - [ ] Customer → tickets they own, or in groups they belong to.
  - [ ] Agent → tickets in groups reachable via their teams' departments.
  - [ ] Manager/Admin → all.
- [ ] Accounts admin: list/filter, create, edit, deactivate, role assignment, avatar upload.
- [ ] Profile page: details, password change, preferences (timezone, density, shortcuts).
- [ ] Assignee picker restricted to agents with access to that ticket's group.

**Done when:** two customers in different groups cannot see each other's tickets, and an agent
sees exactly their departments' queues.

---

### Phase 4 — Attachments & Files (~2 days)

- [ ] S3-compatible storage, presigned PUT upload direct from browser.
- [ ] MIME allowlist, size cap, server-side verification of the uploaded object.
- [ ] Drag-and-drop on ticket detail and in the comment composer; paste-image support in Tiptap.
- [ ] Thumbnails for images, lightbox preview, download via presigned GET.
- [ ] Orphan-cleanup job.

---

### Phase 5 — Realtime & Notifications (~4 days)

- [ ] Custom `server.ts` hosting Next + Socket.IO; auth handshake off the Auth.js session cookie.
- [ ] Rooms: `ticket:{id}`, `user:{id}`, `group:{id}`, `global`.
- [ ] Live updates: grid inserts/updates, detail-page field changes, new comments, presence
      ("Kirito is viewing this ticket"), typing indicator in the composer.
- [ ] `notifications` collection + bell menu with unread count, mark-read, mark-all-read _(bell icon UI exists in Topbar, not wired)_.
- [ ] Subscriber model: auto-subscribe owner + assignee + commenters; manual subscribe/unsubscribe.
- [ ] Notice banner: admin publishes → pushed to every connected client.

---

### Phase 6 — Email In & Out (~4 days)

- [ ] SMTP settings UI + connection test.
- [ ] React Email templates: ticket created, ticket updated, comment added, assigned to you,
      password reset, account created, SLA breach warning.
- [ ] BullMQ `email-out` worker with retry/backoff; per-user notification preferences respected.
- [ ] Inbound: **either** an ImapFlow polling worker **or** a provider webhook
      (`/api/webhooks/inbound-email`). Parse → match `[TCS-1234]` in subject or a reply token →
      append comment, else create a new ticket. Auto-create the customer account if unknown.
- [ ] Strip quoted reply chains and signatures. Ignore auto-responders (`Auto-Submitted` header).

---

### Phase 7 — Dashboard, Reports & SLA (~4 days)

- [ ] Dashboard from **aggregation pipelines with proper indexes** — no forked cache process:
      open/overdue/unassigned/resolved-today counts, tickets-per-day area chart, top groups,
      top tags, avg first-response and avg resolution time, my-queue widget _(UI shell exists with mock data — see Frontend Prototype; needs real aggregation queries)_.
- [ ] Optional lightweight rollup collection if a pipeline ever exceeds ~200 ms; measure first.
- [ ] Reports: by group / status / priority / type / tag / assignee / team, date-ranged,
      on-screen + CSV export (streamed).
- [ ] SLA engine: `slaDueAt` computed from priority `slaHours` on create/priority-change; BullMQ
      delayed jobs for breach warning and breach; SLA badge (green/amber/red) in grid and detail.

---

### Phase 8 — Agent Productivity (~3 days)

- [ ] Command palette (`⌘K`): jump to ticket by number, search, navigate, run actions _(⌘K hint shown in Topbar search, not wired)_.
- [ ] Keyboard shortcuts: `j/k` navigate, `a` assign, `s` status, `c` comment, `/` search, `?` help.
- [ ] Saved views (personal + shared), pinned to the sidebar.
- [ ] Bulk actions on grid selection: assign, status, priority, tag, group, delete.
- [ ] Canned responses / reply macros.
- [ ] Ticket merge and split.
- [ ] Full-text search across subject, issue, and comments.

---

### Phase 9 — Settings & Admin (~3 days)

- [ ] Typed settings registry (Zod), so a setting is defined once and gets its UI, validation, and type.
- [ ] General: site name, logo, favicon, default timezone, date format.
- [ ] Tickets: statuses (with drag-to-reorder), priorities, types (+allowed priorities), tags.
- [ ] Roles: grant matrix editor.
- [ ] Accounts: public registration toggle, password policy, session lifetime.
- [ ] Public submission: enable/disable, captcha (Turnstile), allowed origins, default group.
- [ ] Log viewer (tail of Pino output).

---

### Phase 10 — Public Portal (~3 days)

- [ ] `/submit` — unauthenticated form, Turnstile captcha, rate-limited, honeypot.
- [ ] Emailed confirmation with a signed status link.
- [ ] `/status/[number]/[token]` — customer views their ticket and replies without an account.
- [ ] Optional customer login area: my tickets list + detail.

---

### Phase 11 — Hardening & Launch (~4 days)

- [ ] Security: CSRF on actions, HTML sanitization (DOMPurify server-side) on all rich text,
      rate limits on auth/public/upload, security headers + CSP, secrets audit, `npm audit`.
- [ ] Performance: `explain()` every grid query, verify index usage, bundle analysis, image optimization,
      seed 100k tickets and profile the grid.
- [ ] Accessibility: keyboard traversal, focus management in dialogs, ARIA on the table, contrast audit.
- [ ] Tests: Vitest on services + ability rules; Playwright on the critical flows
      (login → create → assign → comment → resolve; permission boundaries).
- [ ] Production Docker image (multi-stage, standalone output), healthcheck, graceful shutdown.
- [ ] Docs: README, ENVIRONMENT.md, DEPLOY.md, ARCHITECTURE.md.
- [ ] Optional: Trudesk → TheCraftSync migration script (Mongo→Mongo, unnesting the embedded arrays).

---

### Rough total

~43 focused days. **Phases 0–3 (~16 days) produce a genuinely usable internal helpdesk.**
Everything after is depth.

---

## 7. Explicitly Out of Scope

Dropped from Trudesk, with reasons:

- **Built-in chat/DM** — every org already has Slack/Teams. Huge surface, low value.
- **Plugin system** — no ecosystem existed. Webhooks + the REST API cover integration needs.
- **Backup/restore UI** — `mongodump` belongs in ops tooling, not the app.
- **Elasticsearch** — Mongo text indexes / Atlas Search suffice at this scale.
- **In-app theme editor** — Tailwind tokens + CSS variables, changed in code.
- **TPS push service** — browser Web Push in a later phase if wanted.

---

## 8. Open Risks & Decisions to Revisit

| #   | Item                                   | Note                                                                                                                                                                                                                                     |
| --- | -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Custom server for Socket.IO**        | Rules out Vercel-style serverless deploy. Fine for Docker/VPS self-hosting, which is the target. Alternative if that changes: SSE for one-way updates, or a hosted realtime service. **Decide before Phase 5.**                          |
| 2   | **Mongo transactions**                 | Multi-collection writes (ticket + event + notification) want a transaction — that requires a **replica set**, even single-node. Compose config must set one up. Otherwise: accept eventual consistency and make event writes idempotent. |
| 3   | **Denormalized `counts{}`**            | Fast reads, but can drift. Mitigate with `$inc` on the same write path plus a nightly reconciliation job.                                                                                                                                |
| 4   | **Rich text storage**                  | Tiptap HTML must be sanitized on the **server**, never trusting the client. Choose the tag allowlist early and store the sanitized output, not the raw input.                                                                            |
| 5   | **IMAP vs webhook inbound**            | IMAP polling is self-contained but fragile (auth, threading, dedup). Provider webhooks are far more reliable. Support both; default to IMAP for self-hosters.                                                                            |
| 6   | **Search ceiling**                     | Mongo text indexes degrade past a few million docs. If it becomes a problem, Atlas Search is the swap — keep search behind a `search.service.ts` interface so it's one file to change.                                                   |
| 7   | **Ticket numbering under concurrency** | The atomic `$inc` counter is correct, but the counter doc is a write hotspot at very high create rates. Not a concern below ~100 tickets/sec.                                                                                            |

---

## 9. Immediate Next Steps

- [x] Confirm the stack table in §2 (especially: custom server for Socket.IO — risk #1).
- [x] Scaffold Phase 0 in `/Users/kirito/theCraftSync/TCS_Ticket`.
- [x] Build the frontend prototype (login, dashboard, sidebar/shell, tickets list) — see Frontend Prototype above.
- [ ] Write `src/server/db/models/*` for the Phase 1 + 2 collections with the indexes from §3.
- [ ] Build the Phase 2 vertical slice with real data — that grid is where this either feels better than Trudesk or doesn't.
