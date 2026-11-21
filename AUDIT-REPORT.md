# PJ Portal — Comprehensive System Audit Report

**Date:** 20 November 2026
**Portal Version:** API 0.19.2 | Frontend build via Vite 6
**URL:** https://pratapjewellers1997.github.io/pj-portal/

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Backend (Apps Script API)](#2-backend-apps-script-api)
3. [Frontend (Vanilla JS PWA)](#3-frontend-vanilla-js-pwa)
4. [Firebase (Chat + Push)](#4-firebase-chat--push)
5. [Google Sheets (Registry + Data)](#5-google-sheets-registry--data)
6. [Deployment & CI/CD](#6-deployment--cicd)
7. [Security Audit](#7-security-audit)
8. [Performance Audit](#8-performance-audit)
9. [Platform Limits & Ceilings](#9-platform-limits--ceilings)
10. [What's Working Well](#10-whats-working-well)
11. [Risks & Weaknesses](#11-risks--weaknesses)
12. [How Well Can We Build This Application](#12-how-well-can-we-build-this-application)
13. [Recommendations & Roadmap](#13-recommendations--roadmap)

---

## 1. Architecture Overview

```
┌──────────────────────────────────────────────────────────────────┐
│                        STAFF BROWSER / PWA                       │
│  Vanilla JS (21 modules) · Vite build · GitHub Pages hosting     │
└───────────┬──────────────────────┬───────────────────────────────┘
            │ text/plain POST      │ Firebase SDK (Firestore + FCM)
            ▼                      ▼
┌───────────────────┐    ┌──────────────────────────┐
│  Apps Script API  │    │  Firebase (pj-portal-3cc45) │
│  (mis@ account)   │    │  Spark (free) plan          │
│  12 .gs files     │    │  · Firestore (chat msgs)    │
│  V8 runtime       │    │  · FCM (push notifications) │
│  Web App (anon)   │    │  · Auth (Google sign-in)    │
└──────┬────────────┘    └──────────────────────────┘
       │ reads/writes
       ▼
┌───────────────────────────────────────┐
│  Google Sheets (System Registry)      │
│  Tabs: People, Feed, Portal Sources,  │
│  Portal Names, Portal Checklist Items, │
│  Portal Notices, Portal Reads,         │
│  Portal Kudos                          │
├───────────────────────────────────────┤
│  Source Sheets (FMS, Delegation,       │
│  Checklists, Attendance, O2D, P2D,     │
│  Karigar, GP)                          │
├───────────────────────────────────────┤
│  Chat Archive Sheet                    │
│  Portal Checklist Log Sheet            │
└───────────────────────────────────────┘
       │
       ▼
┌───────────────────────────────────────┐
│  mis@ Google Drive                     │
│  · PJ Portal Chat Files (folder)      │
│  · Chat file subfolders per pair       │
└───────────────────────────────────────┘
```

**Core Pattern:** The API acts as a "read-mostly" aggregator. Every 10 minutes it snapshots all source sheets into a compressed blob stored in Script Properties + Script Cache. The frontend fetches this snapshot for instant load. Chat is the only real-time channel and runs entirely on Firebase.

---

## 2. Backend (Apps Script API)

### 2.1 File Inventory (12 files, ~4,500 lines)

| File | Lines | Purpose |
|------|-------|---------|
| Code.gs | 130 | Entry point, `doPost()` router for 26 actions |
| Config.gs | 68 | Constants, `API_VERSION`, `cfg_()` reader |
| Auth.gs | 79 | Google tokeninfo verification, HMAC-SHA256 sessions |
| People.gs | 76 | Staff list from Registry "People" tab, 5-min cache |
| Feed.gs | 85 | System links per person from "Feed" tab, 5-min cache |
| Guide.gs | 764 | Help text: 13 Registry + 16 Portal guide sections |
| Work.gs | 1,492 | **Core engine** — snapshot build, 10-min refresh, nightly build, archiving, health checks |
| Chat.gs | 302 | Firebase sync, file upload to Drive, FCM push |
| ChatAdmin.gs | 430 | Archive, purge, audit toggle, admin chat view |
| Checklists.gs | 290 | Joining/Leaving checklists with auto-checks |
| Social.gs | 260 | Notices + Kudos with daily limits, formula injection protection |
| Vendors.gs | 333 | Vendor scorecard, delivery timing, GP sales |

### 2.2 Triggers (3 total)

| Trigger | Schedule | Function | Purpose |
|---------|----------|----------|---------|
| 10-minute | Every 10 min (07:00–24:00 IST) | `refreshWorkCache` | Rebuild snapshot from all source sheets |
| Nightly | ~02:00 IST daily | `nightlyBuild_` | Full vendor history rebuild + GP summary |
| Chat archive | 23:00 IST daily | `archiveChats_` | Archive Firestore messages to Google Sheet |

### 2.3 Data Flow — The 10-Minute Snapshot

1. `refreshWorkCache` fires every 10 minutes
2. `readBooksSmart_()` checks each source sheet's `modifiedTime` via Drive API — skips unchanged sheets
3. Changed sheets are read in parallel via `UrlFetchApp.fetchAll` (Sheets API)
4. Data is parsed by type: FMS (`parseFms_`), Delegation, Checklists, Karigar, Attendance
5. Snapshot is built: last 92 days + 31 days ahead + all open FMS/delegation tasks
6. Compressed with `Utilities.gzip` → base64 → stored in Script Properties (chunked at 8,500 bytes) and Script Cache (chunked at 90,000 bytes, 6h TTL)
7. Activity data (last-edited timestamps per sheet) stored separately

### 2.4 Key Constants

| Constant | Value | Purpose |
|----------|-------|---------|
| WORK_WINDOW_DAYS | 92 | Days of history in snapshot |
| WORK_FUTURE_DAYS | 31 | Days ahead in snapshot |
| QUIET_HOURS | [0, 7] | No refresh between midnight–7am IST |
| CACHE_CHUNK | 90,000 | Max bytes per Script Cache chunk |
| PROP_CHUNK | 8,500 | Max bytes per Script Properties chunk |
| PROP_MAX | 450,000 | Safety ceiling for Properties usage (of 500KB total) |
| SESSION_DAYS | 7 | Session token validity |
| PEOPLE_CACHE_SECONDS | 300 | Staff list cache (5 min) |
| VENDOR_BUFFER_DAYS | 2 | Grace period for vendor delivery scoring |
| CL_JOIN_DAYS | 45 | New hire window for Joining checklist |

### 2.5 API Actions (26 total)

Authentication: `portal`, `guide`
Work: `work`, `mark`, `karigar`
Social: `notices`, `notice_post`, `notice_read`, `notice_remove`, `kudos`, `kudos_post`
Chat: `chat_upload`, `chat_file`, `notify_chat`
Chat Admin: `chat_admin`, `chat_purge`, `chat_audit_set`
Checklists: `checklists`, `tick_checklist`
Vendors: `vendors`
Search: `lookup`
Staff sync: `sync_staff` (Firestore)
System: `health` (admin diagnostics)

---

## 3. Frontend (Vanilla JS PWA)

### 3.1 File Inventory (21 JS files + CSS + HTML, ~3,500 lines JS)

| File | Lines | Purpose |
|------|-------|---------|
| main.js | 142 | App bootstrap, Google Sign-In, SW registration, PWA install |
| api.js | 20 | Single `callApi()` function — POST with text/plain |
| dom.js | 30 | `h()` DOM helper + `safeUrl()` + `isPhone()` |
| firebase.js | 194 | Firebase init, Firestore listeners, FCM push, offline persistence |
| portal.js | 453 | Home page: hash routing, system cards, today card, activity |
| work.js | 291 | Work page: filters, KPIs, summary tables, health panel |
| workdata.js | 138 | Date utilities, presets, memoized data loading |
| board.js | 141 | Kanban board + lookup search |
| scores.js | 152 | Weekly on-time % scores table |
| scoring.js | 83 | Shared scoring rules (GOOD=90, OK=75) |
| insights.js | 141 | Manager+ analytics: sales funnel, turnaround |
| attendance.js | 138 | Attendance from Haazri system |
| vendors.js | 196 | Vendor scorecard with drilldowns |
| karigar.js | 99 | Items with karigars, color-coded by age |
| checklists.js | 179 | Joining/Leaving checklists with optimistic UI |
| messages.js | 431 | Real-time chat (Firestore), file upload, push setup |
| chatadmin.js | 189 | Admin: storage info, archive, purge, audit |
| social.js | 173 | Notice board + Kudos wall |
| search.js | 175 | Global search with 450ms debounce |
| profile.js | 138 | Person profile: score trend, tasks, attendance |
| style.css | 669 | Full CSS — responsive, mobile-first, jewellery brand theme |

### 3.2 Key Architecture Decisions

- **No framework** — Pure vanilla JS, DOM built with a 15-line `h()` helper. Zero build dependencies beyond Vite and Firebase SDK.
- **Hash-based routing** — `#systems`, `#work`, `#board`, `#scores`, `#insights`, `#attendance`, `#vendors`, `#checklists`, `#messages`, `#search`, `#profile`, `#chatadmin`. No history API, no 404 issues on GitHub Pages.
- **XSS-safe by design** — `h()` uses `textContent` only, never `innerHTML`. Sheet data always goes through text nodes. `safeUrl()` whitelists only `http:` / `https:` protocols.
- **API calls via text/plain** — Avoids CORS preflight (no OPTIONS request). The body is JSON stringified as text. This is a clever Apps Script optimization.
- **Offline-capable data** — Portal snapshot cached in `localStorage` (`pj_portal_cache`) for instant load. Chat uses Firestore's `persistentLocalCache` with multi-tab support.
- **Image compression** — Client-side resize to max 1600px, JPEG quality 0.82 before uploading chat images.
- **Optimistic UI** — Checklist ticks show immediately, with background save and rollback on error.

### 3.3 Pages & Role Access

| Page | Route | Who Can See |
|------|-------|-------------|
| Systems (Home) | `#systems` | All staff |
| Work | `#work` | All (Doers see only own) |
| Board | `#board` | All (Doers see only own) |
| Scores | `#scores` | All (Doers see only own) |
| Profile | `#profile` | All (Doers see only own) |
| Attendance | `#attendance` | All (Doers see only own) |
| Insights | `#insights` | Manager, Owner, Admin |
| Vendors | `#vendors` | All (GP sales: Owner/Admin only) |
| Checklists | `#checklists` | Manager, Owner, Admin |
| Messages | `#messages` | All staff |
| Search | `#search` | All (people search: Manager+) |
| Chat Records | `#chatadmin` | Owner, Admin |

### 3.4 Design System

- **Fonts:** Cormorant Garamond (headings) + DM Sans (body) — jewellery brand feel
- **Colors:** Navy (#0B1F3A), Gold (#C9A24B), Cream (#FBF8F1) — consistent luxury palette
- **Responsive:** Mobile-first, 3 breakpoints (default, 700px, 1000px)
- **PWA:** Standalone display, portrait orientation, app shortcuts for Work + Attendance
- **Icons:** 5 PNG icons (48, 192, 512, maskable-512, apple-touch)

---

## 4. Firebase (Chat + Push)

### 4.1 Project Details

- **Project:** `pj-portal-3cc45`
- **Plan:** Spark (free)
- **Services used:** Firestore, FCM, Authentication

### 4.2 Firestore Collections

| Collection | Purpose | Write Source |
|------------|---------|--------------|
| `staff/{email}` | Staff roster (name, active, primary email) | Apps Script only (every 10 min) |
| `settings/{id}` | Chat audit notice | Apps Script only |
| `chats/{chatId}` | Chat metadata (members, names, last msg, read receipts) | Frontend (members only) |
| `chats/{chatId}/messages/{msgId}` | Individual messages | Frontend (members only) |

### 4.3 Security Rules — Analysis

**Strengths:**
- Staff verification: Every operation checks `signedIn()` + `isStaff()` + `email_verified`
- Chat isolation: Only the two members of a chat can read/write it
- Chat ID is deterministic: `email1__email2` (alphabetically sorted) — prevents duplicates
- Messages are immutable: no update or delete from frontend
- Timestamp anti-spoofing: `at` must be within -5min to +1min of server time
- Text size limit: 1,000 characters per message
- Allowed fields whitelisted with `keys().hasOnly()`
- Staff and settings collections are read-only from frontend (`allow write: if false`)

**Weaknesses:**
- `staff` and `settings` writes are blocked for ALL clients, including the Apps Script. The script must use the Firebase Admin SDK or REST API with a service account to bypass rules — this is working correctly since the script uses `fsFetch_()` with OAuth tokens.

### 4.4 FCM Push Notifications

- Uses FCM HTTP v1 API via `UrlFetchApp.fetchAll` for batch sending
- 30-second throttle per chat to prevent notification spam
- Dead tokens automatically cleaned on 404 response
- Service Worker handles push display — skips if portal is already focused
- Notification click: focuses existing tab or opens new one, routes to the chat

### 4.5 Spark Plan Limits (Current Usage vs. Limits)

| Resource | Spark Limit | PJ Portal Usage | Risk |
|----------|-------------|-----------------|------|
| Firestore storage | 1 GiB | Low (text messages only) | ✅ Very safe |
| Firestore reads | 50K/day | Moderate (real-time listeners) | ⚠️ Could grow with more staff |
| Firestore writes | 20K/day | Low (messages + read receipts) | ✅ Safe |
| Firestore deletes | 20K/day | Rare (admin purge only) | ✅ Safe |
| Network egress | 10 GiB/month | Low | ✅ Safe |
| FCM messages | Unlimited | Used for chat push | ✅ No limit |
| Auth users | 50K MAU | ~15 staff | ✅ Very safe |
| Concurrent connections | 1M | ~15 max | ✅ Very safe |

---

## 5. Google Sheets (Registry + Data)

### 5.1 System Registry Tabs (API reads/writes)

| Tab | API Access | Purpose |
|-----|------------|---------|
| People | Read | Staff roster: email, name, role, designation, active status |
| Feed | Read | System links per person (which sheets/dashboards they see) |
| Portal Sources | Read | Source sheet IDs for FMS, Delegation, Attendance etc. |
| Portal Names | Read | Display names for source sheets |
| Portal Checklist Items | Read | Custom checklist items for joining/leaving |
| Portal Notices | **Read + Write** | Notice board posts |
| Portal Reads | **Read + Write** | "Got it" read receipts for notices |
| Portal Kudos | **Read + Write** | Appreciation messages |

**Key rule:** The API NEVER writes to System Master (the master index). It only writes to the three Portal-specific tabs.

### 5.2 Source Sheets (Read-Only by API)

| Source Type | Data Extracted | Window |
|-------------|---------------|--------|
| FMS (Order-to-Delivery) | Tasks, steps, deadlines, karigar assignments | 92 days back + 31 ahead + all open |
| Delegation | Delegated tasks | Same window |
| Checklists | Staff joining/leaving items | All active |
| Attendance (Haazri) | Daily check-in/out, late, absent | Same window |
| O2D sheets | Vendor delivery records | 3 months (snapshot) + all history (nightly) |
| P2D sheets | Purchase-to-display records | Same as O2D |
| GP sheets | Gross profit / sales data | Nightly build only |

### 5.3 Other Sheets

| Sheet | Purpose |
|-------|---------|
| PJ Portal Chat Archive | Daily archive of Firestore messages (23:00 IST) |
| Portal Checklist Log | Tick/untick audit log for checklists |

---

## 6. Deployment & CI/CD

### 6.1 Frontend (GitHub Actions → GitHub Pages)

- **Trigger:** Push to `main` touching `web/**`, `vite.config.js`, `package.json`, or the workflow file
- **Build:** `npm ci` → `npm run build` (Vite)
- **Environment variables:** `VITE_API_URL` and `VITE_GOOGLE_CLIENT_ID` from GitHub Actions Variables
- **Output:** `dist/` folder deployed to GitHub Pages
- **Concurrency:** Only one deploy at a time (`cancel-in-progress: true`)
- **Node version:** 20

### 6.2 Backend (Manual Deploy)

- **Convention:** Edit code in Apps Script editor → Ctrl+S → Deploy → Manage deployments → ✏️ → New version → Deploy
- **Never** create a new deployment (keeps the same URL)
- **Account:** `mis@pratapjewellers.in`

### 6.3 Service Worker

- Cache version: `pj-shell-v3`
- Strategy: **Network-first** for both HTML and assets
- Pre-cached: `./`, `./manifest.webmanifest`, `./icons/icon-192.png`
- On update: Clears old caches, claims clients, posts `pj-sw-updated` message
- Push: Handles FCM data messages, shows notification with generic text
- Click: Focuses existing tab or opens new one, navigates to correct hash route

---

## 7. Security Audit

### 7.1 Strengths ✅

| Area | Implementation |
|------|---------------|
| Authentication | Google OAuth → tokeninfo endpoint → HMAC-SHA256 signed session tokens (7-day expiry) |
| Authorization | 4-tier role system (Admin > Owner > Manager > Doer), "System" role blocked |
| XSS Prevention | `h()` helper uses `textContent` only; `safeUrl()` whitelists protocols |
| CSRF Prevention | text/plain POST body (no CORS preflight needed) |
| Formula Injection | `safeCell_()` strips leading `=`, `+`, `-`, `@` from user input before writing to sheets |
| Chat Security | Firestore rules enforce member-only access, immutable messages, timestamp bounds |
| Data Isolation | Doers can only see their own data; API filters by person's email |
| Secrets | API URL and Client ID in GitHub Actions Variables (not in code); `.env.local` gitignored |
| Bot Prevention | `noindex, nofollow` meta tag; Google Sign-In required |
| Input Limits | Notice title: 100 chars, message: 1000 chars; Kudos: 200 chars; Chat: 1000 chars |
| Rate Limits | Notices: 20/day, Kudos: 30/day per person; Chat notify: 30s throttle |
| Locking | `withLock_()` with 15-second timeout for sheet writes (prevents race conditions) |

### 7.2 Weaknesses & Risks ⚠️

| Risk | Severity | Detail |
|------|----------|--------|
| Session in localStorage | Low | HMAC-signed, 7-day expiry, but vulnerable to XSS if any XSS vector existed (none found) |
| No token refresh | Low | Sessions last exactly 7 days with no renewal — user must re-login weekly |
| tokeninfo endpoint | Medium | Google's tokeninfo is a debug endpoint, not recommended for production. Google recommends using their client library for token verification |
| HMAC secret in Script Properties | Low | Anyone with editor access to the Apps Script project can read it |
| Chat file access | Low | Files stored in mis@ Drive folder. File URLs are unguessable but not access-controlled — anyone with the URL can view |
| No CSP headers | Low | GitHub Pages doesn't support custom headers. Mitigated by no `innerHTML` usage |
| API is ANYONE_ANONYMOUS | Medium | The web app URL is accessible to anyone who finds it. Authentication is enforced in code, not at the platform level. If a code path missed auth checking, it would be open |

---

## 8. Performance Audit

### 8.1 Frontend Performance

| Metric | Status | Detail |
|--------|--------|--------|
| Bundle size | ✅ Good | Vanilla JS, only dependency is Firebase SDK (~250KB). Vite tree-shakes unused Firebase modules |
| Initial load | ✅ Good | Cached portal data in localStorage gives instant render. API called in background for fresh data |
| Font loading | ⚠️ Moderate | 2 Google Fonts loaded (Cormorant Garamond + DM Sans). `preconnect` hints help but still external |
| Image handling | ✅ Good | Client-side resize to 1600px max before upload. JPEG quality 0.82 |
| Search | ✅ Good | 450ms debounce. Systems/pages search is instant from cached data |
| Chat reconnect | ✅ Good | 60-second keepAlive interval + visibility/focus reconnection |
| Offline | ✅ Good | SW caches shell; Firestore has persistent offline cache for chat |

### 8.2 Backend Performance

| Metric | Status | Detail |
|--------|--------|--------|
| Snapshot build time | ✅ Monitored | Health threshold: 25,000ms. Typical: well under |
| Smart refresh | ✅ Excellent | `readBooksSmart_()` skips unchanged sheets via Drive API modifiedTime |
| Parallel reads | ✅ Excellent | `UrlFetchApp.fetchAll` reads multiple sheets simultaneously |
| Compression | ✅ Good | gzip + base64 reduces snapshot size ~3x |
| Source row count | ✅ Monitored | Health threshold: 5,000 rows. Alert if exceeded |
| Properties usage | ✅ Monitored | Health threshold: 75% of 450KB. Alert at that level |
| Vendor history cache | ✅ Good | Built nightly at 02:00 IST, cached in Properties for 24h |
| Nightly archiving | ✅ Good | `archiveOldRows` moves data older than configurable year |

### 8.3 Health Monitoring (Built-in)

The Admin panel shows real-time health data:

| Metric | Threshold | Action |
|--------|-----------|--------|
| Snapshot size | 350 KB | Warning |
| Rebuild time | 25,000 ms | Warning |
| Source rows | 5,000 | Warning |
| Source read time | 8,000 ms | Warning |
| Properties % used | 75% | Warning |

---

## 9. Platform Limits & Ceilings

### 9.1 Apps Script Limits (Workspace Account — mis@)

| Limit | Value | PJ Portal Usage | Headroom |
|-------|-------|-----------------|----------|
| Script runtime (per execution) | 6 minutes | Snapshot: typically <25s | ✅ Huge |
| Total trigger runtime | 6 hours/day | ~102 runs × ~25s = ~42 min/day | ✅ Very safe |
| URL Fetch calls | 100,000/day | ~10 sheets × 102 runs + nightly = ~1,500/day | ✅ Very safe |
| Concurrent executions (per user) | 30 | Usually 1-2 at a time | ✅ Safe |
| Concurrent executions (per script) | 1,000 | Same | ✅ Safe |
| Properties value size | 9 KB per key | Chunked at 8,500 bytes | ✅ Handled |
| **Properties total storage** | **500 KB per store** | **Snapshot + vendor history + activity** | **⚠️ Primary ceiling** |
| Properties read/write | 500,000/day | ~thousands | ✅ Safe |
| Triggers per user per script | 20 | 3 triggers | ✅ Safe |
| URL Fetch response size | 50 MB | Sheet data: typically <1 MB | ✅ Safe |

### 9.2 GitHub Pages Limits

| Limit | Value | PJ Portal | Headroom |
|-------|-------|-----------|----------|
| Repository size | 1 GB recommended | ~few MB | ✅ Huge |
| Published site size | 1 GB max | ~few MB | ✅ Huge |
| Bandwidth | 100 GB/month soft | ~15 staff, tiny | ✅ Huge |
| Builds | 10/hour (unlimited with Actions) | On push only | ✅ Safe |
| Deploy timeout | 10 minutes | Build: ~30 seconds | ✅ Safe |

### 9.3 Firebase Spark Limits

| Limit | Value | PJ Portal | Headroom |
|-------|-------|-----------|----------|
| Firestore storage | 1 GiB | Text messages only | ✅ Huge |
| Firestore reads | 50,000/day | ~15 staff × chat listeners | ⚠️ Watch as staff grows |
| Firestore writes | 20,000/day | Messages + receipts | ✅ Safe |
| Firestore deletes | 20,000/day | Admin purge (rare) | ✅ Safe |
| Network egress | 10 GiB/month | Minimal | ✅ Safe |
| FCM | No daily limit | Chat notifications | ✅ Safe |

### 9.4 The One Real Ceiling: Script Properties (500 KB)

This is the **single most constrained resource** in the entire system:

- **Total capacity:** 500 KB (hard Google limit, cannot be increased)
- **Safety limit in code:** 450 KB (`PROP_MAX`)
- **What lives there:** Snapshot (compressed), vendor history (compressed), activity data, HMAC secret, config values
- **Current mitigation:** gzip compression, 92-day window, nightly vendor history build, yearly archiving
- **If exceeded:** Snapshot save fails → stale data served from cache (6h) → then nothing

---

## 10. What's Working Well

### Architecture Wins

1. **Zero-cost stack** — Everything runs on free tiers: Apps Script, GitHub Pages, Firebase Spark. No hosting bills.

2. **Smart caching** — The 10-minute snapshot with Drive API modifiedTime check is elegant. It avoids reading unchanged sheets, keeping within quotas and fast.

3. **Compression** — gzip + base64 turns ~350 KB of raw data into ~120 KB stored. This 3x reduction is what makes Properties storage viable.

4. **Vanilla JS** — Zero framework overhead. The entire frontend is ~3,500 lines. No build complexity, no dependency vulnerabilities, no breaking upgrades.

5. **XSS-safe by design** — The `h()` helper makes it structurally impossible to inject HTML. This is better than sanitization because it can't be bypassed.

6. **Progressive Web App** — Installable, works offline (cached shell + Firestore persistence), push notifications. Feels like a native app on staff phones.

7. **Role-based access** — Clean 4-tier system enforced both in API (data filtering) and frontend (UI hiding). Doers literally cannot see other people's data.

8. **Health monitoring** — Admin panel shows real-time system health with configurable thresholds. Problems are visible before they become failures.

9. **Formula injection protection** — `safeCell_()` prevents sheet formula attacks from user input (notices, kudos).

10. **Optimistic UI** — Checklist ticks are instant with background save and automatic rollback on error.

### Code Quality

- Consistent naming conventions (camelCase functions, UPPER_CASE constants)
- Clear file separation by feature (not by type)
- Error handling with user-friendly messages and retry/sign-out options
- Defensive coding: null checks, fallbacks, safe URL validation
- Well-commented code with clear section headers

---

## 11. Risks & Weaknesses

### Critical Risks 🔴

| # | Risk | Impact | Likelihood |
|---|------|--------|------------|
| 1 | **Properties storage overflow** | Snapshot save fails, stale/no data | Medium — grows with business |
| 2 | **Single point of failure: mis@ account** | If account is suspended/compromised, everything stops | Low but catastrophic |
| 3 | **No automated backend deployment** | Manual copy-paste to Apps Script editor. Human error possible. No version control for live code | Medium |

### Moderate Risks 🟡

| # | Risk | Impact | Likelihood |
|---|------|--------|------------|
| 4 | **No backend tests** | Bugs caught only in production | Medium |
| 5 | **No frontend tests** | Same | Medium |
| 6 | **6-minute execution limit** | If source sheets grow large enough, snapshot build could timeout | Low (currently ~25s) |
| 7 | **tokeninfo for auth** | Google may deprecate this debug endpoint | Low |
| 8 | **Chat files not access-controlled** | Anyone with file URL can view (URL is unguessable but still) | Low |
| 9 | **Firebase Spark read limits** | 50K reads/day could be hit with more staff or chatty usage | Low for 15 staff |
| 10 | **No error alerting** | Backend errors only visible in Apps Script execution log. No email/push alerts | Medium |

### Minor Risks 🟢

| # | Risk | Impact | Likelihood |
|---|------|--------|------------|
| 11 | Weekly re-login required (7-day sessions, no refresh) | Minor inconvenience | Certain |
| 12 | No data export feature | Staff can't download their own data | Low impact |
| 13 | Service worker cache version must be manually bumped | Stale assets possible if forgotten | Low |

---

## 12. How Well Can We Build This Application

### Overall Assessment: **8/10 — Remarkably well-built for a zero-cost internal tool**

This is an impressive achievement: a full-featured staff intranet with real-time chat, work tracking, vendor scoring, attendance, checklists, search, and push notifications — running entirely on free infrastructure with no frameworks and no ongoing costs.

### What's Already Built (Feature Completeness)

| Feature | Status | Quality |
|---------|--------|---------|
| Staff authentication + roles | ✅ Complete | Excellent |
| System directory + links | ✅ Complete | Excellent |
| Work tracking (FMS/Delegation) | ✅ Complete | Excellent |
| Kanban board | ✅ Complete | Good |
| Performance scores | ✅ Complete | Excellent |
| Person profiles | ✅ Complete | Good |
| Attendance integration | ✅ Complete | Good |
| Manager insights | ✅ Complete | Good |
| Vendor scorecard | ✅ Complete | Excellent |
| Karigar tracking | ✅ Complete | Good |
| Staff checklists | ✅ Complete | Excellent |
| Real-time chat | ✅ Complete | Excellent |
| Chat file sharing | ✅ Complete | Good |
| Push notifications | ✅ Complete | Good |
| Notice board | ✅ Complete | Good |
| Kudos/appreciation | ✅ Complete | Good |
| Global search | ✅ Complete | Good |
| Chat admin (archive/purge/audit) | ✅ Complete | Excellent |
| Health monitoring | ✅ Complete | Good |
| PWA (install + offline) | ✅ Complete | Excellent |

### Scaling Potential

| Scenario | Can Handle? | Bottleneck |
|----------|-------------|------------|
| 15 → 30 staff | ✅ Yes | No issues |
| 30 → 50 staff | ⚠️ Probably | Firestore reads may approach limits |
| 50 → 100 staff | ❌ Needs changes | Properties storage, Firestore reads, snapshot size |
| 3 → 10 source sheets | ✅ Yes | Well within limits |
| 10 → 30 source sheets | ⚠️ Probably | Snapshot build time, Properties storage |
| 1 → 3 stores | ⚠️ Needs planning | Data volume, snapshot window may need shrinking |
| Adding features (e.g., GP analytics, sales targets) | ✅ Yes | Architecture supports it cleanly |

### What Would Break First

1. **Script Properties (500 KB)** — This is the hard ceiling. As more source sheets are added or data grows, the compressed snapshot will eventually exceed 450 KB. Mitigation: shrink window, archive aggressively, or move to external storage.

2. **Firestore daily reads (50K on Spark)** — With real-time listeners, each active user generates reads. 50 active chat users could approach limits. Mitigation: upgrade to Blaze (pay-as-you-go, still very cheap).

3. **6-minute execution timeout** — If snapshot build time grows past 6 minutes, it will fail silently. Currently at ~25 seconds, so there's 14x headroom. Mitigation: parallelize more aggressively, reduce window.

---

## 13. Recommendations & Roadmap

### Short-Term (Do Now)

1. **Add error alerting** — Send an email to mis@ when snapshot build fails or Properties usage exceeds 80%. A few lines in Work.gs.

2. **Automate SW cache version** — Use Vite's content-hashing (already in place for JS/CSS) and consider removing the manual cache version bump.

3. **Monitor Properties usage trend** — Log the Properties % used over time (in a sheet) to predict when the ceiling will be hit.

### Medium-Term (Next Quarter)

4. **Backend version control** — Use `clasp` to push/pull Apps Script code from GitHub. Add a GitHub Action to deploy backend changes automatically.

5. **Token refresh** — Implement silent session renewal so staff don't have to re-login every 7 days.

6. **Chat file access control** — Consider making chat files viewer-restricted or using signed URLs with expiry.

### Long-Term (If Scaling Beyond 50 Staff)

7. **Move snapshot to Google Drive** — Store the compressed snapshot as a file in Drive instead of Properties. This removes the 500 KB ceiling entirely. Drive API is already used; this is a natural extension.

8. **Upgrade Firebase to Blaze** — When Firestore reads approach 50K/day. Blaze plan includes the same free tier + pay-as-you-go for overages. For a small internal app, cost would be pennies.

9. **Consider migration to Cloud Run + Firestore** — If the app needs to serve 100+ staff or external customers, Apps Script's 6-minute limit and Properties storage become real constraints. A Cloud Run backend with Firestore as the primary database would remove all ceilings while keeping costs minimal.

---

## Summary

The PJ Portal is a **production-quality internal application** running on a **zero-cost infrastructure stack**. It handles 15 staff across work tracking, real-time chat, vendor scoring, attendance, checklists, and more — with sophisticated features like smart caching, health monitoring, optimistic UI, and push notifications.

The architecture is clean, the code is well-organized, and the security is thoughtful. The main constraints are inherent to the free platforms (500 KB Properties limit, Firestore daily quotas), not to the code quality.

**For a jewellery store with 15 staff and 2 stores, this is more than sufficient.** It could comfortably scale to 30-40 staff with zero changes. Beyond that, targeted improvements (Drive-based storage, Blaze plan) would extend the runway significantly.

The fact that this entire system — backend, frontend, real-time chat, push notifications, CI/CD — runs at **₹0/month** is remarkable.
