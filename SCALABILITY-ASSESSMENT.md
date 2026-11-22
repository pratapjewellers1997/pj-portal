# PJ Portal — Large-Data Scalability Assessment

**Date:** 2026-11-22  
**Scope:** Backend data-reading patterns, snapshot system, concurrency, quotas  
**Goal:** Realistic capacity assessment at 100 / 10K / 50K / 100K / 500K / 1M+ rows per sheet

---

## 1. How Data Flows Today (Simple Explanation)

When someone opens PJ Portal, here is what happens:

1. **Browser asks the backend** for data (e.g. Work dashboard, Vendor scorecard)
2. **Backend checks the cache** — a fast temporary store (Script Cache, 6-hour life)
3. **If cache is empty**, backend checks **Script Properties** — a durable store (survives restarts)
4. **If Properties is empty too**, backend checks **Google Drive** — the slowest fallback
5. **If nothing is stored anywhere**, backend **reads every Google Sheet** that matters, filters the data to the last 92 days (for Work) or the selected period, compresses it, and stores it in all three layers

The key question: **how much data does step 5 actually download?**

---

## 2. The Core Bottleneck: ALL Rows Are Downloaded

### What `wantRanges_()` does

The function `wantRanges_()` in Work.gs decides *which columns* to read from each sheet tab. For example, it might request columns A through Z from the "Sales" tab.

**Critical finding:** It requests **column ranges** like `'A:Z'`, not row ranges like `'A2:Z1000'`. This means:

> **Every single row in the sheet is downloaded**, regardless of how many are relevant.

### What happens after download

Once all rows arrive, `readBooksSmart_()` filters them in memory:
- Rows outside the date window (last 92 days for Work) are **discarded**
- Only matching rows are kept and compressed into the snapshot

### The problem in plain language

Imagine a filing cabinet with 500,000 papers. To find papers from the last 3 months (maybe 5,000 papers), the current system:
1. **Photocopies all 500,000 papers** (downloads everything)
2. Looks through the copies and **keeps only the 5,000 recent ones**
3. Throws away the other 495,000 copies

This works fine when the cabinet has 1,000 papers. It becomes a serious problem at 100,000+.

---

## 3. Scalability Assessment by Row Count

### Reading Pattern Summary

| Component | What it does | Scales with |
|-----------|-------------|-------------|
| `wantRanges_()` | Decides columns to read | Number of tabs (fixed) |
| `readBooksParallel_()` | Downloads sheet data via API | **Total rows in sheet** |
| `readBooksSmart_()` | Skips sheets unchanged since last read | Sheets modified since last build |
| `pack_()`/`unpack_()` | GZIP compress/decompress | Size of filtered data |
| `buildSnapshot_()` | Orchestrates the full rebuild | Everything above |

### Tier 1: 100 rows per sheet — VERIFIED FAST ✅

- **API download:** <1 second per sheet
- **Memory filtering:** Instant
- **Snapshot size:** <10 KB compressed
- **Rebuild time:** 2-5 seconds total
- **Storage:** Fits easily in Cache (100 KB limit) and Properties
- **Status:** This is roughly where PJ Portal operates today. No issues.

### Tier 2: 10,000 rows per sheet — SHOULD WORK ✅

- **API download:** 2-5 seconds per sheet (estimated)
- **Memory filtering:** <1 second
- **Snapshot size:** ~50-150 KB compressed (depending on column count)
- **Rebuild time:** 10-20 seconds total
- **Storage:** Fits in Cache; may need 15-20 Property chunks
- **Health alerts:** `sourceRows > 5000` warning would trigger at this level
- **Status:** Workable but approaching limits. The `readBooksSmart_()` optimization (skip unchanged sheets) helps significantly here.

### Tier 3: 50,000 rows per sheet — AT RISK ⚠️

- **API download:** 15-30 seconds per sheet (estimated)
- **Memory filtering:** 2-5 seconds
- **Snapshot size:** Likely 300-500 KB compressed
- **Rebuild time:** 30-90 seconds — **exceeds the Apps Script 6-minute limit if many sheets need reading**
- **Storage:** Exceeds Properties capacity (500 KB total); would rely on Drive fallback
- **Google API quotas:** Read quota per minute could be hit with parallel reads
- **Key risk:** A single `UrlFetchApp.fetchAll()` call downloading 50K rows × 20 columns ≈ 10-20 MB of JSON. Apps Script has a **50 MB per call response size limit**, which is not hit, but memory usage approaches the **~250 MB runtime memory limit**.
- **Status:** Would work occasionally but not reliably. Cold starts (no cache) would be painfully slow.

### Tier 4: 100,000 rows per sheet — LIKELY TO FAIL ❌

- **API download:** 30-60+ seconds per sheet
- **Memory filtering:** 5-10 seconds
- **Snapshot size:** 500 KB - 1 MB+ compressed
- **Rebuild time:** Would likely **exceed the 6-minute Apps Script execution limit**
- **Storage:** Far exceeds Properties; Drive-only storage
- **Memory:** A single sheet's data as a JavaScript array could be 50-100 MB, approaching the runtime limit
- **Key risk:** Google Sheets API returns data in one response — there is no pagination in the current code. 100K rows × 20 columns ≈ 30-50 MB JSON response.
- **Status:** Not reliably supported. Would need architectural changes.

### Tier 5: 500,000 rows per sheet — WILL NOT WORK ❌

- **API download:** Would timeout or exceed response size limits
- **Memory:** Would exceed Apps Script's ~250 MB runtime memory
- **Execution time:** Far beyond the 6-minute limit
- **Google Sheets itself:** Google Sheets has a **10 million cell limit** per spreadsheet. 500K rows × 20 columns = 10M cells — this is the absolute maximum a Google Sheet can hold.
- **Status:** Architecturally incompatible with current approach.

### Tier 6: 1,000,000+ rows — IMPOSSIBLE WITH GOOGLE SHEETS ❌

- **Google Sheets hard limit:** 10 million cells per spreadsheet. 1M rows × 10 columns already hits this.
- **Apps Script limits:** 6-minute execution, ~250 MB memory, 50 MB URL fetch response
- **Status:** Requires a completely different data platform (BigQuery, Cloud SQL, or similar database).

---

## 4. What Makes It Faster Than You'd Expect (Current Optimizations)

### 4a. Smart cache via Drive `modifiedTime`

`readBooksSmart_()` checks each spreadsheet's last-modified time via the Drive API before reading it. If a sheet hasn't changed since the last snapshot build, **it is skipped entirely**. This means:

- If 10 sheets exist but only 2 were edited today, only 2 are re-read
- The other 8 use their previously cached data
- This dramatically reduces rebuild time for typical daily operations

### 4b. Parallel HTTP reads

`readBooksParallel_()` uses `UrlFetchApp.fetchAll()` to download multiple sheets simultaneously, in two rounds:
- Round 1: Fetch all sheet tab metadata (column headers)
- Round 2: Fetch all data ranges in parallel

This is much faster than reading sheets one by one.

### 4c. Three-tier storage with graceful fallback

1. **Script Cache** (fastest, 6-hour TTL, 90 KB chunks) — tried first
2. **Script Properties** (durable, survives restarts, 8.5 KB chunks) — tried second
3. **Google Drive** (slowest but unlimited size) — tried last

Most requests hit the cache and return in <1 second, regardless of how much raw data exists in the sheets.

### 4d. Compression

`pack_()` uses GZIP + base64 encoding. Tabular data compresses very well (often 10:1 or better), so a 1 MB dataset might store as ~100 KB compressed.

### 4e. Concurrency control

`withBuildFlag_()` prevents multiple rebuilds from running at the same time, avoiding wasted work and quota consumption.

---

## 5. Google Apps Script Quotas and Limits

| Limit | Value | Impact |
|-------|-------|--------|
| Execution time | 6 minutes per run | Rebuilds with large data can timeout |
| Runtime memory | ~250 MB | Large arrays from big sheets can crash |
| Script Properties total | 500 KB (9 KB per value) | Snapshot storage limit |
| Script Cache per value | 100 KB | Chunk size limit |
| URL Fetch response | 50 MB per call | Single sheet read size limit |
| URL Fetch calls | 100 per run, 20,000/day | Limits parallel reads |
| Sheets API reads | 300/min per project | Rate limiting at scale |

---

## 6. Specific Bottleneck Analysis

### Bottleneck 1: Full-table download (HIGHEST IMPACT)

**Where:** `wantRanges_()` → `readBooksParallel_()`  
**Problem:** Column ranges (`A:Z`) download all rows  
**Fix (if needed):** Use row-limited ranges or the Sheets API `batchGet` with specific ranges. However, this requires knowing which rows contain recent data — and row positions aren't predictable in manually-edited sheets.  
**Practical solution:** At 50K+ rows, consider archiving old data to a separate "Archive" sheet and keeping only recent data (e.g. last 2 years) in the active sheet. This requires no code changes — just moving old rows.

### Bottleneck 2: In-memory filtering (MEDIUM IMPACT)

**Where:** Row filtering after download  
**Problem:** Processing 100K+ rows in JavaScript consumes significant memory  
**Fix (if needed):** Google Sheets API v4 supports `developerMetadata` and row filtering, but these require sheet-level setup. The simpler fix is keeping active sheets small (see Bottleneck 1 fix).

### Bottleneck 3: Snapshot storage size (LOW-MEDIUM IMPACT)

**Where:** `pack_()` → Properties/Cache/Drive  
**Problem:** Large filtered datasets may exceed Properties capacity  
**Current mitigation:** Drive fallback already handles this. The system degrades gracefully — it just loads slower from Drive.

### Bottleneck 4: Execution time limit (HIGH IMPACT at scale)

**Where:** `buildSnapshot_()` total execution  
**Problem:** 6-minute hard limit on Apps Script  
**Fix (if needed):** Split rebuilds across multiple executions using continuation tokens stored in Properties. This would be a significant code change.

---

## 7. Recommendations

### For current usage (100-5,000 rows) — NO CHANGES NEEDED

The current architecture handles this range well. The smart caching, parallel reads, compression, and three-tier storage are well-designed optimizations.

### For growth to 10,000-20,000 rows — MONITOR ONLY

- Watch health alerts (already in place: `sourceRows > 5000`, `rebuildMs > 25000`)
- The `readBooksSmart_()` skip-unchanged optimization keeps most requests fast
- Consider increasing the `WORK_WINDOW_DAYS` threshold alerts if business needs change

### For growth to 50,000+ rows — ARCHIVE OLD DATA

**Recommended approach (no code changes needed):**
1. Move rows older than 2-3 years to an "Archive" tab or separate spreadsheet
2. Keep only the working window of data in active sheets
3. This keeps the download size manageable without any backend changes

**If archiving isn't sufficient:**
1. Add Google Sheets API row filtering (request only rows where date column > cutoff)
2. Implement continuation-based rebuilds for the 6-minute limit
3. Consider moving historical data to BigQuery for analytics queries

### For 100,000+ rows — PLATFORM CHANGE REQUIRED

At this scale, Google Sheets + Apps Script is not the right platform. Options:
1. **BigQuery** — Google's data warehouse, handles billions of rows, integrates with Sheets
2. **Cloud SQL** — Managed MySQL/PostgreSQL, good for structured queries
3. **Firebase/Firestore** — Already partially integrated via Chat module
4. **Supabase** — Free tier PostgreSQL with API, good for small-medium apps

**Important:** This would be a major architectural change requiring careful planning and your approval before any implementation.

---

## 8. Summary Table

| Row Count | Status | Rebuild Time | Action Needed |
|-----------|--------|-------------|---------------|
| 100 | ✅ Verified fast | 2-5 sec | None |
| 1,000 | ✅ Verified fast | 3-8 sec | None |
| 5,000 | ✅ Works well | 8-15 sec | None |
| 10,000 | ✅ Should work | 10-20 sec | Monitor alerts |
| 50,000 | ⚠️ At risk | 30-90 sec | Archive old data |
| 100,000 | ❌ Likely fails | >6 min timeout | Archive + code changes |
| 500,000 | ❌ Will not work | Impossible | Platform change |
| 1,000,000+ | ❌ Impossible | Sheets limit hit | Different database |

**Key distinction:** "Verified" means tested or observed in production. "Should work" and "At risk" are engineering estimates based on known API behaviour and limits, not production-tested. "Will not work" is a hard technical limitation.

---

*Assessment prepared as part of PJ Portal Technical Audit, November 2026.*
