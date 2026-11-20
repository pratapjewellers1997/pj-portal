/**
 * PJ Portal API: Vendor scorecard (Step 11, rules updated in 0.12.0).
 *
 * vendors {session, period} -> {ok, vendors, orders, sources, ...}
 *   period: '3m' (default), 'thisMonth', 'lastMonth', '6m', 'fy' (this financial year, Apr-Mar), 'all'
 *
 * Order to Delivery FMS rules (as used by Pratap Jewellers):
 *   - "Delivery Time" and "Extended Delivery Time" are CUSTOMER days. They include
 *     2 extra days for HUID / quality after the vendor delivers (VENDOR_BUFFER_DAYS).
 *   - Vendor's first promise = day of "Issue Order to Supplier" Actual
 *                              + (Delivery Time - 2) days, till end of that day.
 *   - Extension only when "Follow up with Supplier ?" is answered Yes. Then the
 *     vendor's new date = "Extended Date" (that is the vendor's date); if it is
 *     blank: day of the follow-up Actual + (Extended Delivery Time - 2) days.
 *   - On time   = "Product Recieved from Vendor" Actual on or before the agreed
 *                 vendor date (the extended date when there was an extension).
 *     First promise kept = received on or before the first promise.
 *   - QC failed = "Order Quality Check ?" answered No;  Returned = "Return to Vendor" done.
 * Purchase to Display FMS: receipts, pieces, "Check For HUID In Product ?" answers.
 * Sales (Owner and Admin/MIS only): GP Feeder gp_master_log totals per vendor per month.
 *
 * Data: orders in the last 3 months come from the 10-minute snapshot (fresh).
 * Older orders come from a full read of the O2D / P2D sheets, kept for 6 hours.
 */

var VENDOR_BUFFER_DAYS = 2;
var VENDOR_HIST_KEY = 'vend_hist_v1';
var VENDOR_PERIODS = ['3m', 'thisMonth', 'lastMonth', '6m', 'fy', 'all'];
var VENDOR_STEPS = {
  issue: /issue order to (supplier|vendor)/i,
  recv: /rec(ie|ei)ved from (vendor|supplier)/i,
  follow: /follow ?up with (supplier|vendor)/i,
  qc: /quality/i,
  ret: /return to vendor/i,
  huid: /check for huid/i
};

function actionVendors_(req) {
  var user = findPerson_(readSession_(req.session));
  var data = loadSnapshot_() || buildSnapshotLocked_(60000) || loadSnapshot_();
  if (!data) throw apiError_('busy');
  var isDoer = user.role === 'Doer';
  var canSales = user.role === 'Owner' || user.role === 'Admin';
  var period = VENDOR_PERIODS.indexOf(req.period) > -1 ? req.period : '3m';
  var range = vendorRange_(period);
  var D = 864e5, now = Date.now();
  var round1 = function (x) { return Math.round(x * 10) / 10; };

  // Records: fresh snapshot, plus older history when the period needs it
  var fresh = vendorRecords_(data.tasks, data.items || {}, data.bases);
  var sysIds = {};
  fresh.forEach(function (r) { sysIds[r.s] = true; });
  var byKey = {}, historyNote = '';
  if (period !== '3m' && range.from < now - (WORK_WINDOW_DAYS - 1) * D) {   // older than the snapshot keeps
    var hist = loadVendorHistory_(Object.keys(sysIds));
    if (hist) hist.forEach(function (r) { byKey[r.s + '|' + r.k] = r; });
    else historyNote = 'Older orders could not be loaded right now; showing the last 3 months only.';
  }
  fresh.forEach(function (r) { byKey[r.s + '|' + r.k] = r; });   // fresh wins
  var records = Object.keys(byKey).map(function (k) { return byKey[k]; });

  // Vendor names <-> codes ("SANJAY BHAI" = "SANJAY BHAI (S06)")
  var codeOf = function (name) { var m = String(name || '').match(/\(([A-Za-z0-9]+)\)\s*$/); return m ? m[1].toUpperCase() : ''; };
  var baseOf = function (name) { return normName_(String(name || '').replace(/\([^)]*\)\s*$/, '')); };
  var codeByName = {};
  records.forEach(function (r) { [r.vendor, r.vendor2].forEach(function (n) { var c = codeOf(n); if (c) codeByName[baseOf(n)] = c; }); });
  ((data.gp && data.gp.rows) || []).forEach(function (r) { if (r.c && r.v) codeByName[baseOf(r.v)] = String(r.c).toUpperCase(); });

  var vendors = {}, orders = [], usedSys = {};
  var vendorOf = function (raw) {
    var name = cleanName_(raw) || 'Not set';
    var code = codeOf(name) || codeByName[baseOf(name)] || '';
    var key = code || baseOf(name) || 'not set';
    if (vendors[key] && !codeOf(vendors[key].name) && codeOf(name)) vendors[key].name = name;
    return vendors[key] = vendors[key] || { key: key, name: name, code: code,
      orders: 0, received: 0, onTime: 0, late: 0, lateDays: 0, firstKept: 0, firstJudged: 0,
      extended: 0, qcDone: 0, qcFail: 0, returned: 0, open: 0, overdue: 0,
      receipts: 0, pieces: 0, huidYes: 0, huidNo: 0 };
  };

  records.forEach(function (r) {
    if (r.t === 'o') {
      if (r.issue < range.from || r.issue > range.to) return;
      usedSys[r.s] = { system: r.n, url: r.url };
      var v = vendorOf(r.vendor || r.vendor2);
      var pr = vendorPromise_(r);
      var recv = r.recv, status, lateDays = null;
      v.orders++;
      if (pr.extended) v.extended++;
      if (recv) {
        v.received++;
        if (pr.first) { v.firstJudged++; if (recv <= pr.first) v.firstKept++; }
        if (!pr.agreed) status = 'received';
        else if (recv <= pr.agreed) { v.onTime++; status = 'on_time'; }
        else { v.late++; lateDays = Math.ceil((recv - pr.agreed) / D); v.lateDays += lateDays; status = 'late'; }
      } else {
        v.open++;
        if (pr.agreed && now > pr.agreed) { v.overdue++; status = 'overdue'; lateDays = Math.ceil((now - pr.agreed) / D); }
        else status = 'waiting';
      }
      if (r.qc) { v.qcDone++; if (/^no\b/i.test(r.qc)) v.qcFail++; }
      if (r.ret) v.returned++;
      orders.push({
        vendor: v.key,
        order: isDoer ? (r.no || String(r.k).split('_')[0]) : r.k,
        customer: isDoer ? '' : r.l,
        issued: r.issue, firstPromise: pr.first, agreed: pr.agreed, extended: pr.extended,
        extensionNote: pr.note, received: recv, status: status, lateDays: lateDays,
        qc: r.qc, returned: r.ret, url: r.url
      });
    } else if (r.t === 'p') {
      if (!r.ts || r.ts < range.from || r.ts > range.to) return;
      usedSys[r.s] = { system: r.n, url: r.url };
      var p = vendorOf(r.vendor);
      p.receipts++;
      p.pieces += parseFloat(r.pcs) || 0;
      if (/^yes/i.test(r.huid)) p.huidYes++; else if (/^no/i.test(r.huid)) p.huidNo++;
    }
  });

  // Sales from GP (Owner / Admin only), months that overlap the period
  var gpInfo = null;
  if (canSales && data.gp) {
    var fromM = Utilities.formatDate(new Date(range.from), TZ, 'yyyy-MM');
    var toM = Utilities.formatDate(new Date(Math.min(range.to, now)), TZ, 'yyyy-MM');
    gpInfo = { upTo: data.gp.upTo || '', url: data.gp.url || '' };
    (data.gp.rows || []).forEach(function (r) {
      if (r.m < fromM || r.m > toM) return;
      var key = r.c ? String(r.c).toUpperCase() : baseOf(r.v);
      var v = vendors[key] || vendorOf(r.v + (r.c ? ' (' + r.c + ')' : ''));
      if (!v.sales) v.sales = { pcs: 0, revenue: 0, gp: 0 };
      v.sales.pcs += r.pcs; v.sales.revenue += r.rev; v.sales.gp += r.gp;
    });
  }

  var list = Object.keys(vendors).map(function (k) {
    var v = vendors[k], judged = v.onTime + v.late;
    var out = {
      key: v.key, name: v.name, code: v.code,
      orders: v.orders, received: v.received, onTime: v.onTime, late: v.late,
      onTimePct: judged ? Math.round((v.onTime / judged) * 100) : null,
      firstKept: v.firstKept, firstJudged: v.firstJudged,
      firstKeptPct: v.firstJudged ? Math.round((v.firstKept / v.firstJudged) * 100) : null,
      avgLateDays: v.late ? round1(v.lateDays / v.late) : null,
      extended: v.extended, qcDone: v.qcDone, qcFail: v.qcFail, returned: v.returned,
      open: v.open, overdue: v.overdue, receipts: v.receipts, pieces: v.pieces,
      huidYes: v.huidYes, huidNo: v.huidNo, stars: vendorStars_(v)
    };
    if (canSales && v.sales) {
      out.sales = { pcs: v.sales.pcs, revenue: Math.round(v.sales.revenue), gp: Math.round(v.sales.gp),
                    gpPct: v.sales.revenue ? round1((v.sales.gp / v.sales.revenue) * 100) : null };
    }
    return out;
  }).filter(function (v) { return v.orders || v.receipts || v.sales; })
    .sort(function (a, b) { return b.orders - a.orders || b.receipts - a.receipts || a.name.localeCompare(b.name); });

  // Sources, with "last edited"
  var act = loadActivity_(), edited = {};
  ((act && act.files) || []).forEach(function (f) { edited[f.id] = f.t; });
  var sheetId = function (u) { var m = String(u || '').match(/spreadsheets\/d\/([\w-]{20,})/); return m ? m[1] : ''; };
  var sources = Object.keys(usedSys).map(function (s) {
    var id = sheetId(usedSys[s].url);
    return { label: usedSys[s].system, url: id ? 'https://docs.google.com/spreadsheets/d/' + id + '/edit' : '', edited: edited[id] || null };
  });
  if (gpInfo) {
    var gid = sheetId(gpInfo.url);
    sources.push({ label: 'GP Feeder System (gp_master_log)', url: gpInfo.url ? gpInfo.url + '/edit' : '',
                   edited: edited[gid] || null, upTo: gpInfo.upTo, ownersOnly: true });
  }

  return {
    ok: true, scope: isDoer ? 'self' : 'all', canSeeSales: canSales, period: period,
    window: { from: Utilities.formatDate(new Date(range.from), TZ, 'yyyy-MM-dd'),
              to: Utilities.formatDate(new Date(Math.min(range.to, now)), TZ, 'yyyy-MM-dd'), all: period === 'all' },
    note: historyNote, bufferDays: VENDOR_BUFFER_DAYS,
    sales: gpInfo ? { upTo: gpInfo.upTo } : null,
    vendors: list, orders: orders.sort(function (a, b) { return b.issued - a.issued; }),
    sources: sources, builtAt: data.builtAt
  };
}

/** Vendor dates for one O2D order (see rules at the top). */
function vendorPromise_(r) {
  var D = 864e5, buf = VENDOR_BUFFER_DAYS;
  var dt = parseFloat(r.dt), edt = parseFloat(r.edt);
  var first = dt > 0 ? endOfDay_(r.issue + Math.max(dt - buf, 0) * D) : null;
  var extended = /^yes/i.test(r.fuV || '');
  var agreed = first, note = '';
  if (extended) {
    var ed = toMs_(r.ed);
    if (ed) { agreed = endOfDay_(ed); note = 'Extended Date (vendor)'; }
    else if (r.fuA && edt > 0) { agreed = endOfDay_(r.fuA + Math.max(edt - buf, 0) * D); note = 'Follow-up + Extended Delivery Time - ' + buf; }
    else note = 'Extension marked but no Extended Date / days: first promise used';
  }
  return { first: first, agreed: agreed, extended: extended, note: note };
}

/** Slim per-order records from FMS steps (O2D: 't'=o, P2D: 't'=p). */
function vendorRecords_(tasks, items, bases) {
  var groups = {};
  tasks.forEach(function (t) {
    if (t.y !== 'FMS') return;
    var id = t.s + '|' + t.k;
    (groups[id] = groups[id] || { s: t.s, n: t.n, k: t.k, l: t.l, b: t.b, steps: [] }).steps.push(t);
  });
  var out = [];
  Object.keys(groups).forEach(function (id) {
    var g = groups[id], info = items[id] || {}, a = info.a || {};
    var find = function (re) {
      for (var i = 0; i < g.steps.length; i++) if (re.test(g.steps[i].t)) return g.steps[i];
      return null;
    };
    var issue = find(VENDOR_STEPS.issue), recv = find(VENDOR_STEPS.recv), huid = find(VENDOR_STEPS.huid);
    if (issue || recv) {
      if (!issue || !issue.a) return;
      var fu = find(VENDOR_STEPS.follow), qc = find(VENDOR_STEPS.qc), ret = find(VENDOR_STEPS.ret);
      out.push({ t: 'o', s: g.s, n: g.n, k: g.k, l: g.l, url: (bases[g.b] || '') + issue.u,
        issue: issue.a, recv: recv && recv.a ? recv.a : null,
        fuA: fu && fu.a ? fu.a : null, fuV: fu && fu.v ? fu.v : '',
        qc: qc && qc.d && qc.v ? qc.v : '', ret: Boolean(ret && ret.d),
        vendor: a['confirmed vendor'] || '', vendor2: a['vendor name'] || '',
        dt: a['delivery time'] || '', edt: a['extended delivery time'] || '', ed: a['extended date'] || '',
        no: a['order number'] || '' });
    } else if (huid && a['vendor name']) {
      out.push({ t: 'p', s: g.s, n: g.n, k: g.k, url: (bases[g.b] || '') + huid.u,
        ts: info.ts || huid.p, vendor: a['vendor name'], pcs: a['number of pieces'] || '',
        huid: huid.d && huid.v ? huid.v : '' });
    }
  });
  return out;
}

/** All orders ever, from the O2D / P2D sheets. Read at most once per 6 hours. */
function loadVendorHistory_(sysIds) {
  var cache = CacheService.getScriptCache();
  var packed = joinParts_(function (keys) { return cache.getAll(keys); }, cache.get(VENDOR_HIST_KEY + '_n'), VENDOR_HIST_KEY + '_');
  if (packed) { try { return unpack_(packed); } catch (e) {} }
  // Nightly build stores in Properties — survives cache clearing
  var props = PropertiesService.getScriptProperties();
  var propPacked = joinParts_(function () { return props.getProperties(); }, props.getProperty(VENDOR_HIST_KEY + '_npn'), VENDOR_HIST_KEY + '_np');
  if (propPacked) { try { return unpack_(propPacked); } catch (e) {} }
  if (!sysIds.length) return [];

  var built = withBuildFlag_(VENDOR_HIST_KEY, 60000, function () {
  try {
    var srcs = loadSourcesCfg_().filter(function (s) { return s.type === 'FMS' && sysIds.indexOf(s.sysId) > -1; });
    var fetched = readBooksParallel_(srcs);
    var raw = srcs.map(function (src, i) { return { src: src, book: fetched[i].book }; });
    var names = buildNameMap_(raw);
    var tasks = [], items = {}, bases = {};
    raw.forEach(function (r) {
      var list = parseFms_(r.src, r.book, names, 0, 8.64e15);
      var bk = r.src.sysId + '|' + r.src.tab;
      bases[bk] = r.book.url + '/edit#gid=' + (r.book.gids[r.src.tab] || 0) + '&range=A';
      list.forEach(function (t) { t.b = bk; });
      Object.keys(list.items || {}).forEach(function (k) { items[k] = list.items[k]; });
      tasks = tasks.concat(list);
    });
    var records = vendorRecords_(tasks, items, bases);
    var p = pack_(records), parts = {}, n = 0;
    for (var i = 0; i < p.length; i += CACHE_CHUNK) parts[VENDOR_HIST_KEY + '_' + (n++)] = p.substr(i, CACHE_CHUNK);
    parts[VENDOR_HIST_KEY + '_n'] = String(n);
    try { cache.putAll(parts, 21600); } catch (e) { console.warn('Vendor history cache write failed: ' + e); }
    return records;
  } catch (err) {
    console.warn('Vendor history failed: ' + err);
    return null;
  }
  });
  if (built) return built;
  var again = joinParts_(function (keys) { return cache.getAll(keys); }, cache.get(VENDOR_HIST_KEY + '_n'), VENDOR_HIST_KEY + '_');
  return again ? unpack_(again) : null;
}

/** Period -> {from, to} in ms (IST). */
function vendorRange_(period) {
  var now = Date.now(), D = 864e5;
  var today = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd');
  var y = Number(today.slice(0, 4)), m = Number(today.slice(5, 7));
  var start = function (yy, mm) { return istMidnight_(yy + '-' + (mm < 10 ? '0' : '') + mm + '-01'); };
  if (period === 'thisMonth') return { from: start(y, m), to: now };
  if (period === 'lastMonth') {
    var py = m === 1 ? y - 1 : y, pm = m === 1 ? 12 : m - 1;
    return { from: start(py, pm), to: start(y, m) - 1 };
  }
  if (period === '6m') return { from: now - 183 * D, to: now };
  if (period === 'fy') return { from: start(m >= 4 ? y : y - 1, 4), to: now };
  if (period === 'all') return { from: 0, to: now };
  return { from: now - WORK_WINDOW_DAYS * D, to: now };
}

function istMidnight_(key) {
  return Date.UTC(Number(key.slice(0, 4)), Number(key.slice(5, 7)) - 1, Number(key.slice(8, 10))) - 5.5 * 3600000;
}

/** 1-5 stars from on-time % (needs 3+ received orders with a vendor date); -1 if over 20% fail QC. */
function vendorStars_(v) {
  var n = v.onTime + v.late;
  if (n < 3) return null;
  var pct = (v.onTime / n) * 100;
  var s = pct >= 90 ? 5 : pct >= 75 ? 4 : pct >= 60 ? 3 : pct >= 40 ? 2 : 1;
  if (v.qcDone >= 3 && v.qcFail / v.qcDone > 0.2) s = Math.max(1, s - 1);
  return s;
}

/** GP Feeder gp_master_log -> totals per vendor per month (no customer names kept). */
function parseGp_(src, book) {
  var t = src.tab, d = book.tabs[t] || [], k = book.tabs[t + '|K'] || [], s = book.tabs[t + '|S'] || [],
      u = book.tabs[t + '|U'] || [], w = book.tabs[t + '|W'] || [];
  var agg = {}, upTo = '', lines = 0;
  for (var i = 1; i < d.length; i++) {
    var date = dateKey_((d[i] || [])[0]);
    if (!date) continue;
    var wx = w[i] || [], code = String(wx[0] || '').trim(), name = cleanName_(wx[1]);
    if (!code && !name) continue;                            // coin / other items: no vendor
    var key = (code || name) + '|' + date.slice(0, 7);
    var a = agg[key] = agg[key] || { c: code, v: name, m: date.slice(0, 7), pcs: 0, rev: 0, gp: 0 };
    a.pcs += gpNum_((k[i] || [])[0]); a.rev += gpNum_((s[i] || [])[0]); a.gp += gpNum_((u[i] || [])[0]);
    lines++;
    if (date > upTo) upTo = date;
  }
  var rows = Object.keys(agg).map(function (key) {
    var a = agg[key];
    return { c: a.c, v: a.v, m: a.m, pcs: a.pcs, rev: Math.round(a.rev), gp: Math.round(a.gp) };
  });
  return { rows: rows, upTo: upTo, lines: lines, url: book.url };
}

function gpNum_(v) {
  var n = parseFloat(String(v == null ? '' : v).replace(/[^0-9.\-]/g, ''));
  return isNaN(n) ? 0 : n;
}
