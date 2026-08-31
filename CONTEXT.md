# CONTEXT.md — What Trudesk Is and How It Works

> Reference notes gathered by reading the Trudesk source at `/Users/kirito/theCraftSync/trudesk`
> (v1.2.11, Node/Express/MongoDB/React 16). This document exists to capture **what the product
> does**, **how it is built**, and **where it hurts** — so the rewrite, branded **TheCraftSync**
> and built in this `TCS_Ticket` folder, is an informed redesign rather than a port.

---

## 1. What Trudesk Is

An open-source, self-hosted helpdesk / ticketing system. Customers submit issues, agents work
them through a status pipeline, admins configure the whole thing. Everything is server-rendered
Handlebars shells that mount React containers, backed by an Express REST API and a Socket.IO
realtime layer.

### The core loop

1. A **ticket** is created — by a logged-in user, by a public web form, or by an inbound email (IMAP polling).
2. The ticket lands in a **group** (the customer-facing bucket) and gets a **type**, **priority**, and **status**.
3. **Agents** assigned to that group see it, take assignment, and work it.
4. Communication happens through **comments** (customer-visible) and **notes** (internal only).
5. Every mutation writes a **history** entry. Subscribers get **notifications** (in-app + email).
6. The ticket reaches a closed/resolved status. **Reports** and the **dashboard** aggregate everything.

---

## 2. Domain Model (as built in Trudesk)

Source: `src/models/`

| Model                | Purpose                   | Notable fields                                                                                                                                                                                                                                       |
| -------------------- | ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ticket`             | The central entity        | `uid` (human-readable counter), `owner`, `group`, `assignee`, `type`, `status`, `priority`, `tags[]`, `subject`, `issue`, `dueDate`, `closedDate`, `deleted`, **`comments[]`**, **`notes[]`**, **`attachments[]`**, **`history[]`**, `subscribers[]` |
| `user` (`accounts`)  | People                    | `username`, `password` (bcrypt), `fullname`, `email`, `role` → ref, `title`, `image`, phone/company/social fields, `accessToken` (API key), `tOTPKey` (2FA), `preferences{}`, `deleted`                                                              |
| `role` + `roleorder` | Dynamic RBAC              | Roles are DB rows with `grants[]` permission strings; `roleorder` defines hierarchy for "can this user act on that user"                                                                                                                             |
| `group`              | Customer bucket           | `name`, `members[]` (customers), `sendMailTo[]`                                                                                                                                                                                                      |
| `team`               | Agent bucket              | `name`, `members[]` (agents)                                                                                                                                                                                                                         |
| `department`         | Ties teams → groups       | `name`, `teams[]`, `groups[]`, `allGroups` flag                                                                                                                                                                                                      |
| `ticketStatus`       | Configurable statuses     | `name`, `htmlColor`, `order`, `isResolved`, `slatimer`                                                                                                                                                                                               |
| `ticketpriority`     | Configurable priorities   | `name`, `htmlColor`, `durationHours` (SLA), `overdueIn`                                                                                                                                                                                              |
| `tickettype`         | Configurable types        | `name`, `priorities[]` (which priorities are valid for this type)                                                                                                                                                                                    |
| `tag`                | Free-form labels          | `name`                                                                                                                                                                                                                                               |
| `comment` / `note`   | Ticket messages           | `owner`, `date`, `comment`, `deleted` — **embedded subdocuments**                                                                                                                                                                                    |
| `attachment`         | Files                     | `owner`, `name`, `path`, `type`, `date` — **embedded**                                                                                                                                                                                               |
| `history`            | Audit trail               | `action`, `description`, `owner`, `date` — **embedded**                                                                                                                                                                                              |
| `notification`       | In-app notifications      | `owner`, `title`, `message`, `type`, `unread`, `data`                                                                                                                                                                                                |
| `notice`             | Site-wide banner          | `name`, `message`, `color`, `active`, `alertWindow`                                                                                                                                                                                                  |
| `setting`            | Key/value app config      | `name`, `value` — everything configurable lives here                                                                                                                                                                                                 |
| `template`           | Email templates           | Handlebars/`email-templates` on disk + subject overrides in DB                                                                                                                                                                                       |
| `session`            | Express sessions in Mongo | via `connect-mongo`                                                                                                                                                                                                                                  |
| `counters`           | Atomic `uid` generator    | `$inc` on a counter doc                                                                                                                                                                                                                              |
| `chat/`              | DMs between users         | conversation + message models                                                                                                                                                                                                                        |
| `report`             | Saved report definitions  |                                                                                                                                                                                                                                                      |

### Permission model

Two layers, awkwardly overlapping:

- **Legacy static roles** in `src/permissions/roles.js` — hardcoded `admin` / `mod` / `support` / `user`
  with grant strings like `'ticket:create edit view attachment removeAttachment'`.
- **Dynamic DB roles** (`src/models/role.js`) checked via `canUser('tickets:view')` middleware in the
  API router, with `isAdmin` / `isAgentOrAdmin` shortcuts sprinkled alongside.

Permission strings observed in routes: `tickets:view|create|update|delete|notes`, `comments:create`,
`accounts:view|create|update|delete`, `groups:view|create|update|delete`, `notices:create|update|delete|deactivate`,
`reports:create|view`, `agent:*`, `admin:*`, `plugins:manage`.

---

## 3. Screens / Features (what a user actually sees)

Routes: `src/routes/index.js`, containers: `src/client/containers/`

| Screen                           | What it does                                                                                                                                                                                                                                                                                                                     |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Login / L2 Auth**              | Credentials + optional TOTP second factor, forgot-password + reset-by-hash flows, captcha                                                                                                                                                                                                                                        |
| **Dashboard**                    | Ticket count cards, tickets-per-day chart, top groups (ranked bars), top tags, quick stats, recent tickets                                                                                                                                                                                                                       |
| **Tickets grid**                 | Filterable/paginated list — by status, group, assignee, type, priority, tag, date range. Bulk select. Auto-refresh via socket. Saved filter views: active / assigned to me / unassigned / new / by-status                                                                                                                        |
| **Single ticket**                | Subject/issue (Markdown via EasyMDE), inline edit of status/assignee/type/priority/group/due date/tags/subscribers, comment thread, internal notes tab, attachments, history timeline, print view                                                                                                                                |
| **Create ticket modal**          | Group, type, priority, subject, issue, attachments                                                                                                                                                                                                                                                                               |
| **Public new-issue page**        | Unauthenticated form at `/newissue` — captcha + origin check, auto-creates the account if needed                                                                                                                                                                                                                                 |
| **Accounts**                     | Customers / Agents / Admins tabs, create/edit/disable, profile image upload, API key generation, 2FA management                                                                                                                                                                                                                  |
| **Groups / Teams / Departments** | CRUD + member management                                                                                                                                                                                                                                                                                                         |
| **Messages**                     | Built-in DM/chat between users with typing indicators and spawnable chat windows                                                                                                                                                                                                                                                 |
| **Notices**                      | Create a site-wide banner, push it live to all connected clients over socket                                                                                                                                                                                                                                                     |
| **Reports**                      | Generate CSV/breakdowns: tickets by group, status, priority, tag, type, user, assignee, team — with date ranges                                                                                                                                                                                                                  |
| **Profile**                      | Own details, password, preferences (timezone, auto-refresh, keyboard shortcuts)                                                                                                                                                                                                                                                  |
| **Settings (admin)**             | General (site name, logos, favicon, timezone), Accounts (allow public registration, password policy), Tickets (types/priorities/statuses/tags CRUD, status ordering), Mailer (SMTP + IMAP fetch), Permissions/roles editor, Notifications, Elasticsearch, TPS (push service), Legal, Logs, Backup/Restore, Plugins, Theme editor |
| **About**                        | Version info                                                                                                                                                                                                                                                                                                                     |

### Cross-cutting behaviours

- **Realtime (Socket.IO)** — `src/socketio/socketEventConsts.js` defines ~50 events. Ticket field
  updates, new tickets, notification counts, notices, online-status presence, chat, backup progress,
  log streaming. The grid and single-ticket view live-update without refresh.
- **Email in** (`src/mailer/mailCheck.js`) — polls IMAP on an interval, parses messages, creates
  tickets or appends comments to existing ones.
- **Email out** (`src/mailer/`) — `email-templates` + Handlebars templates on disk:
  `new-ticket`, `ticket-updated`, `ticket-comment-added`, `password-reset`, `new-password`,
  `public-account-created`, `l2auth-reset`, `l2auth-cleared`.
- **Search** — MongoDB regex search by default, optional Elasticsearch index.
- **Caching** — a homegrown forked-process cache (`src/cache/cache.js`) that recomputes dashboard
  aggregates on a timer; optional Redis.
- **Plugins** — a `plugins/` directory loaded at boot.
- **Backup/Restore** — shells out to `mongodump`/`mongorestore`, streams progress over socket.

---

## 4. Technical Architecture (Trudesk today)

```
app.js → express
  ├─ express-hbs views (server-rendered shells)      src/views/
  ├─ session (connect-mongo) + passport local auth
  ├─ REST API                                        src/controllers/api/v1/*
  ├─ Socket.IO server                                src/socketio/*
  ├─ Mongoose models                                 src/models/*
  ├─ IMAP poller + SMTP mailer                       src/mailer/*
  ├─ forked cache process                            src/cache/*
  └─ React 16 SPA bundles (webpack → public/js/*)    src/client/*
       Redux + redux-thunk + redux-saga + Immutable.js
       SASS → single compiled stylesheet, UIkit grid classes
```

**Build**: Grunt orchestrating Webpack + SASS. Compiled bundles (`public/js/*.js` and `.gz`) are
**committed to git**.

---

## 5. Honest Assessment — Why a Rewrite Is Justified

These are the specific things TheCraftSync must do differently.

### Data model problems

1. **Comments, notes, attachments, and history are embedded arrays on the ticket document.**
   A busy ticket grows unboundedly toward Mongo's 16 MB document ceiling. Every ticket list query
   drags the entire comment history over the wire unless carefully projected — and Trudesk often
   doesn't project. This is the single biggest performance flaw.
2. **`pre('find')` auto-population hooks** on the ticket schema mean _every_ query silently joins
   priority (and callers add owner/assignee/group/type/tags on top). N+1 lookups by default.
3. **Status was a number, then became a ref** — the migration left `statusFormatted` virtuals and
   legacy numeric comparisons scattered through the codebase.
4. **Soft-delete via a `deleted` boolean** on nearly every model, enforced by remembering to add
   `deleted: false` to each query. Easy to forget; several queries do.

### Architecture problems

5. **Two parallel permission systems** (static `roles.js` + dynamic DB roles) with three different
   check styles (`canUser`, `isAdmin`, `isAgentOrAdmin`). Authorization logic is scattered across
   route definitions, controllers, and the client bundle.
6. **Client-side permission checks duplicate server logic** — `window.ROLES` is shipped to the browser.
   Two sources of truth that can drift.
7. **No end-to-end type safety.** Plain JS everywhere. API response shapes are implicit; the client
   guesses.
8. **Redux + thunk + saga + Immutable.js all at once** — four state paradigms for one app. Enormous
   boilerplate per feature, and Immutable's `.toJS()` calls everywhere are a real render cost.
9. **Callback-style `async.waterfall`** mixed with promises mixed with `async/await` across the
   controllers. Error handling is inconsistent; several paths swallow errors into `winston.warn`.
10. **A forked child process as a cache layer**, recomputing dashboard aggregates on a timer whether
    or not anyone is looking. Should be a query with proper indexes, or a materialized rollup.
11. **Build artifacts committed to git** (`public/js/*.js`, `*.js.gz`) — every build produces noisy diffs.
12. **Server-rendered Handlebars shell + client React SPA** is the worst of both: two templating
    systems, a flash of unstyled shell, no real SSR benefit.

### UX problems

13. **Dated UI** — UIkit grid classes, a 2016-era visual language, dense tables, no real dark mode,
    weak mobile behaviour.
14. **No keyboard-first workflows** for agents (the people who live in the tool 8 hours a day).
15. **No saved views / no bulk actions worth the name / no SLA surfacing** in the grid.
16. **Search is a regex scan** unless you stand up Elasticsearch.

### What Trudesk gets _right_ (keep these ideas)

- Configurable statuses, priorities, and types as data, not enums.
- The group (customers) / team (agents) / department (mapping) triangle is a genuinely good model
  for "who can see what".
- Human-readable sequential ticket `uid` separate from the DB id.
- Comments vs. internal notes as a first-class distinction.
- Full history/audit trail on every ticket.
- Subscribers list per ticket driving notifications.
- Email-to-ticket, and a public unauthenticated submission form.
- Realtime grid updates — agents genuinely notice when this is missing.
- Per-type valid priorities (a "Task" doesn't need "Critical").

---

## 6. Decisions Locked In for TheCraftSync

| Area         | Decision                                                                                                                                                                                                                                                                 |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Product name | **TheCraftSync** (shown in the app UI, e.g. sidebar branding)                                                                                                                                                                                                            |
| Location     | `/Users/kirito/theCraftSync/TCS_Ticket` (standalone repo, sibling to trudesk)                                                                                                                                                                                            |
| Framework    | Next.js (App Router) + TypeScript                                                                                                                                                                                                                                        |
| Database     | **MongoDB + Mongoose** — same engine as Trudesk, but a _redesigned_ schema (see PLAN.md §3)                                                                                                                                                                              |
| Auth         | **Auth.js (NextAuth v5)** — credentials + optional SSO, DB sessions, TOTP 2FA later                                                                                                                                                                                      |
| Scope        | **Core helpdesk, done well.** In: tickets, comments/notes, attachments, users/roles/groups/teams/departments, dashboard, reports, notifications, email-to-ticket, realtime. Out: built-in chat/DM, plugin system, backup/restore UI, Elasticsearch, in-app theme editor. |
