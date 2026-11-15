/**
 * PJ Portal API: Vendor scorecard (Step 11).
 *
 * vendors {session} -> {ok, vendors, orders, sources, ...}
 *
 * Delivery (all staff): worked out from the Order to Delivery FMS, last 3 months
 *   (the same snapshot as the Work page, so no extra sheet reads):
 *   - Orders      = orders issued to the vendor ("Issue Order to Supplier" done)
 *   - Promised    = end of the day "Issue Order to Supplier" was done + "Delivery Time" days
 *   - On time     = "Product Recieved from Vendor" done on or before Promised
 *   - Extended    = "Extended Delivery Time" or "Extended Date" filled
 *   - QC failed   = "Order Quality Check ?" answered No;  Returned = "Return to Vendor" done
 *   - Open / Overdue = not received yet / not received and Promised has passed
 * Receipts (all staff): Purchase to Display FMS: receipts, pieces, HUID check answers.
 * Sales (Owner and Admin/MIS only): GP Feeder gp_master_log, by Sup Code, for the
 *   months in the same 3-month window. Never sent to anyone else.
 *
 * Vendors are matched by the code in brackets, e.g. "AALOK (A01)" = Sup Code A01.
 */

var VENDOR_STEPS = {
  issue: /issue order to (supplier|vendor)/i,
  recv: /rec(ie|ei)ved from (vendor|supplier)/i,
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
  var now = Date.now(), D = 864e5;
  var round1 = function (x) { return Math.round(x * 10) / 10; };

  // Group FMS steps by item
  var groups = {};
  data.tasks.forEach(function (t) {
    if (t.y !== 'FMS') return;
    var id = t.s + '|' + t.k;
    (groups[id] = groups[id] || { s: t.s, n: t.n, k: t.k, l: t.l, b: t.b, steps: [] }).steps.push(t);
  });

  // Same vendor written with and without its code ("SANJAY BHAI" / "SANJAY BHAI (S06)"):
  // learn name -> code from every place that has both (FMS and GP), then match on the code.
  var codeOf = function (name) { var m = String(name || '').match(/\(([A-Za-z0-9]+)\)\s*$/); return m ? m[1].toUpperCase() : ''; };
  var baseOf = function (name) { return normName_(String(name || '').replace(/\([^)]*\)\s*$/, '')); };
  var codeByName = {};
  Object.keys(data.items || {}).forEach(function (id) {
    var a = data.items[id].a || {};
    [a['confirmed vendor'], a['vendor name']].forEach(function (n) { var c = codeOf(n); if (c) codeByName[baseOf(n)] = c; });
  });
  ((data.gp && data.gp.rows) || []).forEach(function (r) { if (r.c && r.v) codeByName[baseOf(r.v)] = String(r.c).toUpperCase(); });

  var vendors = {}, orders = [], usedSys = {};
  var vendorOf = function (raw) {
    var name = cleanName_(raw) || 'Not set';
    var code = codeOf(name) || codeByName[baseOf(name)] || '';
    var key = code || baseOf(name) || 'not set';
    if (vendors[key] && !codeOf(vendors[key].name) && codeOf(name)) vendors[key].name = name;   // prefer the name with its code
    var v = vendors[key] = vendors[key] || { key: key, name: name, code: code,
      orders: 0, received: 0, onTime: 0, late: 0, lateDays: 0, extended: 0, qcDone: 0, qcFail: 0,
      returned: 0, open: 0, overdue: 0, receipts: 0, pieces: 0, huidYes: 0, huidNo: 0 };
    return v;
  };

  Object.keys(groups).forEach(function (id) {
    var g = groups[id], info = (data.items || {})[id], a = (info && info.a) || {};
    var find = function (re) {
      for (var i = 0; i < g.steps.length; i++) if (re.test(g.steps[i].t)) return g.steps[i];
      return null;
    };
    var issue = find(VENDOR_STEPS.issue), recvStep = find(VENDOR_STEPS.recv), huid = find(VENDOR_STEPS.huid);

    if (issue || recvStep) {                                   // Order to Delivery
      if (!issue || !issue.a) return;                          // not issued to a vendor yet
      usedSys[g.s] = { system: g.n, b: g.b };
      var v = vendorOf(a['confirmed vendor'] || a['vendor name']);
      var days = parseFloat(a['delivery time']);
      var promised = days > 0 ? endOfDay_(issue.a + days * D) : null;
      var extended = Boolean(a['extended date'] || parseFloat(a['extended delivery time']) > 0);
      var recv = recvStep && recvStep.a ? recvStep.a : null;
      var qc = find(VENDOR_STEPS.qc), ret = find(VENDOR_STEPS.ret);
      var status, lateDays = null;
      v.orders++;
      if (extended) v.extended++;
      if (recv) {
        v.received++;
        if (!promised) status = 'received';
        else if (recv <= promised) { v.onTime++; status = 'on_time'; }
        else { v.late++; lateDays = Math.ceil((recv - promised) / D); v.lateDays += lateDays; status = 'late'; }
      } else {
        v.open++;
        if (promised && now > promised) { v.overdue++; status = 'overdue'; lateDays = Math.ceil((now - promised) / D); }
        else status = 'waiting';
      }
      var qcAns = qc && qc.d && qc.v ? qc.v : '';
      if (qcAns) { v.qcDone++; if (/^no\b/i.test(qcAns)) v.qcFail++; }
      if (ret && ret.d) v.returned++;
      orders.push({
        vendor: v.key,
        order: isDoer ? (a['order number'] || String(g.k).split('_')[0]) : g.k,
        customer: isDoer ? '' : g.l,
        issued: issue.a, promised: promised, received: recv, status: status, lateDays: lateDays,
        extended: extended, qc: qcAns, returned: Boolean(ret && ret.d),
        url: (data.bases[g.b] || '') + issue.u
      });
    } else if (huid && a['vendor name']) {                     // Purchase to Display
      usedSys[g.s] = { system: g.n, b: g.b };
      var p = vendorOf(a['vendor name']);
      p.receipts++;
      p.pieces += parseFloat(a['number of pieces']) || 0;
      if (huid.d && huid.v) { if (/^yes/i.test(huid.v)) p.huidYes++; else if (/^no/i.test(huid.v)) p.huidNo++; }
    }
  });

  // Sales from GP (Owner / Admin only)
  var winFrom = now - WORK_WINDOW_DAYS * D;
  var fromKey = Utilities.formatDate(new Date(winFrom), TZ, 'yyyy-MM-dd');
  var toKey = Utilities.formatDate(new Date(now), TZ, 'yyyy-MM-dd');
  var gpInfo = null;
  if (canSales && data.gp) {
    var months = monthsBetween_(fromKey, toKey);
    gpInfo = { upTo: data.gp.upTo || '', url: data.gp.url || '', months: months };
    (data.gp.rows || []).forEach(function (r) {
      if (months.indexOf(r.m) === -1) return;
      var key = r.c ? String(r.c).toUpperCase() : normName_(r.v);
      var v = vendors[key] || vendorOf(r.v + (r.c ? ' (' + r.c + ')' : ''));
      if (!v.sales) v.sales = { pcs: 0, revenue: 0, gp: 0 };
      v.sales.pcs += r.pcs; v.sales.revenue += r.rev; v.sales.gp += r.gp;
    });
  }

  var list = Object.keys(vendors).map(function (k) {
    var v = vendors[k];
    var judged = v.onTime + v.late;
    var out = {
      key: v.key, name: v.name, code: v.code,
      orders: v.orders, received: v.received, onTime: v.onTime, late: v.late,
      onTimePct: judged ? Math.round((v.onTime / judged) * 100) : null,
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
  }).sort(function (a, b) { return b.orders - a.orders || b.receipts - a.receipts || a.name.localeCompare(b.name); });

  // Sources, with "last edited"
  var act = loadActivity_(), edited = {};
  ((act && act.files) || []).forEach(function (f) { edited[f.id] = f.t; });
  var sheetId = function (u) { var m = String(u || '').match(/spreadsheets\/d\/([\w-]{20,})/); return m ? m[1] : ''; };
  var sources = Object.keys(usedSys).map(function (s) {
    var id = sheetId(data.bases[usedSys[s].b]);
    return { label: usedSys[s].system, url: id ? 'https://docs.google.com/spreadsheets/d/' + id + '/edit' : '', edited: edited[id] || null };
  });
  if (gpInfo) {
    var gid = sheetId(gpInfo.url);
    sources.push({ label: 'GP Feeder System (gp_master_log)', url: gpInfo.url ? gpInfo.url + '/edit' : '',
                   edited: edited[gid] || null, upTo: gpInfo.upTo, ownersOnly: true });
  }

  return {
    ok: true, scope: isDoer ? 'self' : 'all', canSeeSales: canSales,
    window: { from: fromKey, to: toKey }, sales: gpInfo ? { upTo: gpInfo.upTo, months: gpInfo.months } : null,
    vendors: list, orders: orders.sort(function (a, b) { return b.issued - a.issued; }),
    sources: sources, builtAt: data.builtAt
  };
}

/** 1-5 stars from on-time % (needs 3+ received orders with a promise date); -1 if over 20% fail QC. */
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
