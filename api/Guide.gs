/**
 * PJ Portal API — the two guide tabs in the Registry, in the same style as the GP Guide.
 *
 *   "Registry Guide"  how the System Registry works, tab by tab, setting by setting.
 *   "Portal Guide"    how the PJ Portal works, where everything is stored, limits,
 *                     security, troubleshooting and how to delete everything.
 *
 * The text lives in this file, so a deleted or broken tab is never lost:
 *   setupGuides()          writes both tabs
 *   setupRegistryGuide()   writes only the Registry Guide
 *   setupPortalGuide()     writes only the Portal Guide
 * No timer runs these. Run one after changing this file.
 *
 * The Registry's own "Guide" tab is written by the Registry's code and is not touched.
 */

var GUIDE_TAB = 'Portal Guide';
var REG_GUIDE_TAB = 'Registry Guide';

/** Run from the editor: writes both guide tabs. */
function setupGuides() {
  console.log('Registry Guide written: ' + writeRegistryGuide_());
  console.log('Portal Guide written: ' + writePortalGuide_());
}
function setupRegistryGuide() { console.log('Registry Guide written: ' + writeRegistryGuide_()); }
function setupPortalGuide() { console.log('Portal Guide written: ' + writePortalGuide_()); }

/* =====================================================================
 * Guide kit: lays out a GP-Guide-style page.
 * Grid: column A = 20 px margin, columns B..M = 12 columns of 100 px.
 * ===================================================================== */

var GK = {
  DARK: '#3A2A1A', TEXT: '#2B2118', BEIGE: '#E8DCC8', CREAM: '#FAF6EE', LINE: '#D6C9AD',
  GREEN: '#1F6F5C', LINK: '#1155CC', GOLD: '#FFF2CC', INFO: '#DDEBF7', WHITE: '#FFFFFF', RED: '#7B0000',
  brown: '#5C4326', purple: '#533483', forest: '#1B4332', navy: '#0F3460', teal: '#2E5266',
  mustard: '#B7860B', plum: '#6A1B4D', lilac: '#D9D2E9', pink: '#F4CCCC', mint: '#D9EAD3'
};
var GK_LIGHT = ['#D9D2E9', '#F4CCCC', '#D9EAD3', '#FFF2CC', '#DDEBF7', '#E8DCC8', '#FAF6EE'];

function GuideDoc_() { this.rows = []; this.sections = []; this.contents = null; }

GuideDoc_.prototype.row_ = function (cells, h) { var r = { cells: cells || [], h: h || 0 }; this.rows.push(r); return r; };
GuideDoc_.prototype.cell_ = function (col, span, text, st) {
  var c = { col: col, span: span, text: text == null ? '' : text, st: st || {} };
  if (text && typeof text === 'object') { c.text = text.t; c.url = text.url; }
  return c;
};
GuideDoc_.prototype.gap = function (px) { this.row_([], px || 8); return this; };
GuideDoc_.prototype.title = function (t) {
  this.row_([this.cell_(2, 12, t, { bg: GK.DARK, fg: GK.WHITE, size: 22, bold: true })], 58); return this;
};
GuideDoc_.prototype.subtitle = function (t) {
  this.row_([this.cell_(2, 12, t, { bg: GK.BEIGE, italic: true })], 0); return this;
};
GuideDoc_.prototype.contentsHere = function () {
  this.gap(12);
  this.row_([this.cell_(2, 12, 'CONTENTS  —  click a title to jump to it', { bg: GK.GREEN, fg: GK.WHITE, size: 12, bold: true })], 30);
  this.contents = { at: this.rows.length };   // rows are inserted here at render time
  this.gap(16);
  return this;
};
GuideDoc_.prototype.section = function (t) {
  var s = { n: this.sections.length + 1, title: t };
  s.label = s.n + '  ·  ' + t;
  this.sections.push(s);
  this.gap(16);
  s.rowObj = this.row_([this.cell_(2, 10, s.label, { bg: GK.GREEN, fg: GK.WHITE, size: 14, bold: true })], 36);
  this.gap(6);
  return this;
};
GuideDoc_.prototype.sub = function (t) {
  this.gap(10);
  this.row_([this.cell_(2, 12, t, { fg: GK.DARK, size: 11, bold: true })], 26);
  this.gap(4);
  return this;
};
GuideDoc_.prototype.para = function (t) { this.row_([this.cell_(2, 12, t, {})], 0); this.gap(6); return this; };
GuideDoc_.prototype.note = function (icon, t, kind) {
  var bg = kind === 'info' ? GK.INFO : GK.GOLD;
  this.row_([this.cell_(2, 1, icon, { bg: bg, size: 14, align: 'center' }), this.cell_(3, 11, t, { bg: bg })], 0);
  this.gap(8);
  return this;
};
/** spans: widths in grid columns (total 12). rows: arrays of strings or {t, url}. */
GuideDoc_.prototype.table = function (spans, head, rows) {
  var self = this;
  var mk = function (vals, st, zebra) {
    var col = 2, cells = [];
    vals.forEach(function (v, i) {
      var s = {};
      for (var k in st) s[k] = st[k];
      if (zebra !== undefined) { s.bg = zebra ? GK.CREAM : GK.WHITE; if (i === 0) s.bold = true; }
      s.border = true;
      cells.push(self.cell_(col, spans[i], v, s));
      col += spans[i];
    });
    return cells;
  };
  if (head) this.row_(mk(head, { bg: GK.DARK, fg: GK.WHITE, bold: true, align: 'center' }), 28);
  rows.forEach(function (r, i) { self.row_(mk(r, {}, i % 2 === 0), 0); });
  this.gap(8);
  return this;
};
/** Numbered steps: [title, text]. */
GuideDoc_.prototype.steps = function (items) {
  var self = this;
  items.forEach(function (it, i) {
    self.row_([
      self.cell_(2, 1, String(i + 1), { bg: GK.GREEN, fg: GK.WHITE, size: 14, bold: true, align: 'center', border: true }),
      self.cell_(3, 3, it[0], { bg: GK.BEIGE, fg: GK.DARK, bold: true, border: true }),
      self.cell_(6, 8, it[1], { bg: GK.CREAM, border: true })
    ], 0);
    self.gap(3);
  });
  this.gap(6);
  return this;
};
/** Bullets: [label, text]. */
GuideDoc_.prototype.bullets = function (items) {
  var self = this;
  items.forEach(function (it) {
    self.row_([
      self.cell_(2, 1, '•', { fg: GK.GREEN, bold: true, align: 'center' }),
      self.cell_(3, 3, it[0], { fg: GK.DARK, bold: true }),
      self.cell_(6, 8, it[1], {})
    ], 0);
  });
  this.gap(8);
  return this;
};
/** Diagram row of boxes: [col, span, text, colour]. */
GuideDoc_.prototype.boxes = function (list, h) {
  var self = this;
  this.row_(list.map(function (b) {
    var light = GK_LIGHT.indexOf(b[3]) > -1;
    return self.cell_(b[0], b[1], b[2], { bg: b[3], fg: light ? GK.TEXT : GK.WHITE, bold: true, align: 'center' });
  }), h || 52);
  return this;
};
/** Arrow row: [col, span]. */
GuideDoc_.prototype.arrows = function (list) {
  var self = this;
  this.row_(list.map(function (a) {
    return self.cell_(a[0], a[1], '▼', { fg: GK.GREEN, size: 14, bold: true, align: 'center' });
  }), 22);
  return this;
};

/** Writes the doc to a tab. Returns the tab's URL. */
GuideDoc_.prototype.render = function (ss, tabName) {
  // Contents rows (inserted where contentsHere() was called).
  if (this.contents) {
    var half = Math.ceil(this.sections.length / 2), crow = [];
    for (var i = 0; i < half; i++) {
      var L = this.sections[i], R = this.sections[i + half];
      var cells = [this.cell_(2, 6, L.label, { bg: GK.CREAM, fg: GK.LINK, size: 11, bold: true, underline: true })];
      cells[0].section = L;
      if (R) { var rc = this.cell_(8, 6, R.label, { bg: GK.CREAM, fg: GK.LINK, size: 11, bold: true, underline: true }); rc.section = R; cells.push(rc); }
      crow.push({ cells: cells, h: 26 });
    }
    Array.prototype.splice.apply(this.rows, [this.contents.at, 0].concat(crow));
  }
  var rows = this.rows, n = rows.length, W = 13;
  this.sections.forEach(function (s) { s.row = rows.indexOf(s.rowObj) + 1; });

  var sh = ss.getSheetByName(tabName) || ss.insertSheet(tabName);
  sh.clear();
  var maxR = sh.getMaxRows(), maxC = sh.getMaxColumns();
  sh.getRange(1, 1, maxR, maxC).breakApart();
  if (maxR < n + 5) sh.insertRowsAfter(maxR, n + 5 - maxR);
  if (maxC < W) sh.insertColumnsAfter(maxC, W - maxC);

  var grid = function (v) { var g = []; for (var r = 0; r < n; r++) { var a = []; for (var c = 0; c < W; c++) a.push(v); g.push(a); } return g; };
  var vals = grid(''), bg = grid(GK.WHITE), fg = grid(GK.TEXT), size = grid(10), wt = grid('normal'),
      sty = grid('normal'), al = grid('left'), line = grid('none');
  var merges = [], borders = [], links = [], heights = [];

  rows.forEach(function (row, ri) {
    var r = ri + 1, est = 0;
    row.cells.forEach(function (c) {
      var s = c.st, t = String(c.text), ci = c.col - 1;
      vals[ri][ci] = t;
      for (var k = 0; k < c.span; k++) bg[ri][ci + k] = s.bg || GK.WHITE;
      fg[ri][ci] = c.url ? GK.LINK : (s.fg || GK.TEXT);
      size[ri][ci] = s.size || 10;
      wt[ri][ci] = s.bold ? 'bold' : 'normal';
      sty[ri][ci] = s.italic ? 'italic' : 'normal';
      al[ri][ci] = s.align || 'left';
      if (s.underline || c.url) line[ri][ci] = 'underline';
      if (c.span > 1) merges.push([r, c.col, c.span]);
      if (s.border) borders.push(sh.getRange(r, c.col, 1, c.span).getA1Notation());
      if (c.url || c.section) links.push({ r: r, c: c.col, text: t, url: c.url, section: c.section });
      // height estimate for wrapped text
      var px = c.span * 100 - 10, fs = s.size || 10, cpl = Math.max(8, Math.floor(px / (fs * 0.56)));
      var lines = t.split('\n').reduce(function (sum, p) { return sum + Math.max(1, Math.ceil(p.length / cpl)); }, 0);
      est = Math.max(est, Math.ceil(lines * fs * 1.5 + 10));
    });
    heights.push(row.h || Math.max(23, est));
  });

  sh.getRange(1, 1, n, W).setNumberFormat('@')
    .setValues(vals).setBackgrounds(bg).setFontColors(fg).setFontSizes(size).setFontWeights(wt)
    .setFontStyles(sty).setHorizontalAlignments(al).setFontLines(line)
    .setFontFamily('Arial').setVerticalAlignment('middle').setWrap(true);
  if (borders.length) sh.getRangeList(borders).setBorder(true, true, true, true, null, null, GK.LINE, SpreadsheetApp.BorderStyle.SOLID);
  var gid = sh.getSheetId();

  // Merges and row heights: one Sheets API request (fast); falls back to one call each.
  var groups = [];
  for (var s = 0; s < n;) {
    var e = s; while (e + 1 < n && heights[e + 1] === heights[s]) e++;
    groups.push([s, e + 1, heights[s]]);
    s = e + 1;
  }
  var reqs = merges.map(function (m) {
    return { mergeCells: { mergeType: 'MERGE_ALL', range: { sheetId: gid, startRowIndex: m[0] - 1, endRowIndex: m[0], startColumnIndex: m[1] - 1, endColumnIndex: m[1] - 1 + m[2] } } };
  }).concat(groups.map(function (g) {
    return { updateDimensionProperties: { range: { sheetId: gid, dimension: 'ROWS', startIndex: g[0], endIndex: g[1] }, properties: { pixelSize: g[2] }, fields: 'pixelSize' } };
  }));
  try {
    SpreadsheetApp.flush();
    Sheets.Spreadsheets.batchUpdate({ requests: reqs }, ss.getId());
  } catch (err) {
    console.warn('Guide: batch layout failed, using slow path: ' + err);
    merges.forEach(function (m) { sh.getRange(m[0], m[1], 1, m[2]).merge(); });
    groups.forEach(function (g) { sh.setRowHeightsForced(g[0] + 1, g[1] - g[0], g[2]); });
  }
  links.forEach(function (l) {
    var url = l.section ? '#gid=' + gid + '&range=B' + l.section.row : l.url;
    if (!url || !/^(https?:\/\/|#gid=)/.test(url)) return;
    sh.getRange(l.r, l.c).setRichTextValue(SpreadsheetApp.newRichTextValue().setText(l.text).setLinkUrl(url).build());
  });
  if (sh.getMaxRows() > n) sh.setRowHeights(n + 1, sh.getMaxRows() - n, 21);
  sh.setColumnWidth(1, 20);
  sh.setColumnWidths(2, 12, 100);
  sh.setHiddenGridlines(true);
  sh.setFrozenRows(0);
  return ss.getUrl() + '#gid=' + gid;
};

/* =====================================================================
 * Shared facts (links built at run time, so they are always current)
 * ===================================================================== */

function guideFacts_() {
  var props = PropertiesService.getScriptProperties();
  var archiveId = props.getProperty(CHAT_ARCHIVE_PROP);
  var clientId = props.getProperty('OAUTH_CLIENT_ID') || '';
  var f = {
    fb: 'https://console.firebase.google.com/project/' + FIREBASE_PROJECT,
    reg: 'https://docs.google.com/spreadsheets/d/' + cfg_('REGISTRY_ID') + '/edit',
    archive: archiveId ? 'https://docs.google.com/spreadsheets/d/' + archiveId + '/edit' : '',
    folder: 'https://drive.google.com/drive/folders/' + chatFolderId_(),
    script: 'https://script.google.com/home/projects/' + ScriptApp.getScriptId() + '/edit',
    execs: 'https://script.google.com/home/projects/' + ScriptApp.getScriptId() + '/executions',
    clientProject: clientId.split('-')[0] || '(see OAUTH_CLIENT_ID)',
    repo: 'https://github.com/pratapjewellers1997/pj-portal',
    site: 'https://pratapjewellers1997.github.io/pj-portal/',
    master: 'https://docs.google.com/spreadsheets/d/1cam8yOAZzqRTxaayc2PVpy7QuH7MDVY3MoNXDcBOxiY/edit',
    when: Utilities.formatDate(new Date(), TZ, 'dd MMM yyyy')
  };
  f.api = '';
  try { f.api = ScriptApp.getService().getUrl() || ''; } catch (e) {}
  return f;
}
function L_(t, url) { return url ? { t: t, url: url } : t; }

/* =====================================================================
 * REGISTRY GUIDE
 * ===================================================================== */

function writeRegistryGuide_() {
  var F = guideFacts_();
  var d = new GuideDoc_();
  d.title('SYSTEM REGISTRY  —  The Complete Guide');
  d.subtitle('Pratap Jewellers  ·  The “brain” between System Master and the PJ Portal  ·  Guide built ' + F.when +
    '  ·  Written for a complete beginner: read top to bottom once, then use the Contents to look things up.');
  d.contentsHere();

  // 1
  d.section('Start here — the 60-second version');
  d.para('What does this sheet do?  You list every system (its sheets, forms, dashboards and people) in System Master. ' +
    'The Registry reads System Master every 5 minutes, works out who should see which link, checks Google Drive, and ' +
    'prepares one clean list called Feed. The PJ Portal reads Feed and shows each person only their own systems. ' +
    'The Registry never changes System Master, and it never removes anyone’s Drive access.');
  d.gap(4);
  d.boxes([[2, 3, '1   Type the system in\nSystem Master', GK.brown], [6, 3, '2   Registry refreshes\n(within 5 minutes)', GK.purple],
           [10, 3, '3   Check the ticks in\nVisibility', GK.forest]], 56);
  d.arrows([[10, 3]]);
  d.boxes([[10, 3, '4   Each person sees their\nlinks on the PJ Portal', GK.navy]], 56);
  d.gap(10);
  d.note('★', 'THE FIVE GOLDEN RULES — (1) System facts (links, owners, doers) are typed ONLY in System Master. The Registry reads it and never edits it.  ' +
    '(2) In this Registry, type only in: People, the Visibility ticks, Systems (Display name, Function group), Links (Show as, Sensitive, Notes), ' +
    'Access (Task (MIS)), Settings, and the Portal tabs marked “Yes” in section 7. Everything else is rebuilt by the code.  ' +
    '(3) Your Visibility ticks are never overwritten.  (4) Nothing is shared in Drive unless AUTO_VIEWER is ON or you press “Grant Viewer access now”, and nothing is ever removed.  ' +
    '(5) Never rename a tab or its header row.');

  // 2
  d.section('The big picture');
  d.para('Follow the arrows from top to bottom. Brown = what you give. Purple = the engine. Green, teal and gold = the lists it builds. Blue = who uses the result.');
  d.boxes([[2, 4, 'System Master\n(you type here — read only for the Registry)', GK.brown], [8, 6, 'Google Drive\n(every linked file and folder)', GK.brown]], 52);
  d.arrows([[2, 4], [8, 6]]);
  d.boxes([[2, 12, 'REGISTRY PIPELINE  (every 5 minutes if System Master changed · Drive scan and sharing check weekly at night)', GK.purple]], 44);
  d.arrows([[2, 4], [6, 4], [10, 4]]);
  d.boxes([[2, 4, 'Systems · Links · People · Access\n(what exists and who works on it)', GK.forest],
           [6, 4, 'Drive tree · Tree gaps · Suggestions\n(what is in Drive)', GK.teal],
           [10, 4, 'Sharing audit · Grant plan · Revoke list\n(who can open what)', GK.mustard]], 56);
  d.arrows([[2, 4]]);
  d.boxes([[2, 4, 'Visibility\n(your ticks: who should see each link)', GK.GOLD]], 52);
  d.arrows([[2, 4]]);
  d.boxes([[2, 4, 'Feed\n(one row = one person + one link)', GK.lilac]], 48);
  d.arrows([[2, 4]]);
  d.boxes([[2, 12, 'PJ PORTAL  —  each person signs in with Google and sees only their own Feed rows (plus their work, attendance and chat)', GK.navy]], 44);
  d.gap(10);
  d.bullets([
    ['You type', 'System Master (systems), People, Visibility ticks, a few columns in Systems / Links / Access, Settings, and the Portal tabs marked “Yes” in section 7.'],
    ['The Registry writes', 'Systems, Links, Access, Feed, Drive tree, Tree gaps, Suggestions, Sharing audit, Access matrix, Grant plan, Revoke list, Log, Health.'],
    ['The portal writes', 'Only its own Portal tabs (notices, checklist ticks, phone devices) and the two guide tabs. Never System Master.'],
    ['Drive is the real lock', 'The portal only chooses which links to show. A file still opens only if Drive lets that person open it.']
  ]);

  // 3
  d.section('Words you will meet');
  d.table([3, 9], ['Word', 'Plain meaning'], [
    ['System', 'One process listed in System Master, for example Repair Process and FMS. Each has a System ID (SYS-01 …).'],
    ['Link', 'One sheet, form, dashboard, folder or video belonging to a system. Each has a Link ID (LNK-001 …).'],
    ['Link type', 'Sheet, FMS, Checklist, Document, Flow chart, Training video, Code file, Drive folder, Form / web app, Doer dashboard, MD dashboard, Dashboard.'],
    ['Lifecycle', 'Active or Inactive, from System Master’s Sheet Status. Inactive systems are visible only to Admin and Owners.'],
    ['Function group', 'The heading a system sits under on the portal: Daily routine, Orders and repair, Stock and purchase, Sales and customer, Money and compliance, People, Content and marketing, Analytics.'],
    ['Role', 'Admin (MIS, sees everything) · Owner (MD) · Manager (includes the EA) · Doer (staff, sees own work) · System (automation login, hidden).'],
    ['Access type', 'How a person is named on a system in System Master: Owner, Problem solver, P.C, Editor, Viewer or Doer.'],
    ['P.C / Problem solver', 'Process Coordinator / the person who fixes problems in that system. Both count as manager-level for that system.'],
    ['Visibility tick', 'A tick box: TRUE = this person sees this link on the portal. Pre-filled by role rules, then yours to change.'],
    ['Feed', 'The final list the portal reads: one row per person per link they may see.'],
    ['Show as', 'Embed (opened inside the portal) or Open (a button that opens the file in a new tab).'],
    ['Sensitive', 'A link hidden from Doers even if they work on the system (salary, loans, hiring, GP and similar).'],
    ['Pipeline', 'The full refresh: read System Master, rebuild the lists, build Feed.'],
    ['Drive scan', 'A walk through the Drive folders to find every file and compare it with System Master.'],
    ['Covered', 'A file inside a folder that is linked in System Master. It needs no row of its own.'],
    ['Suggestion', 'A Drive file that looks like it belongs to a system but is not in System Master. You decide; nothing is added automatically.'],
    ['Grant', 'Giving a person Viewer access to a file in Drive. Listed in Grant plan; done only when you allow it.'],
    ['Revoke list', 'People who can open a file but are not ticked. A review list only: nothing is removed automatically.']
  ]);

  // 4
  d.section('One-time setup checklist');
  d.para('Do these once. Most are already done on your sheet; use the list to check.');
  d.steps([
    ['Create the tabs', 'Registry menu > First-time setup. Creates every tab and fills starting data. Never overwrites existing data.'],
    ['Check Settings', 'AUTO_SYNC ON, SYSTEM_MASTER_ID and MASTER_TAB correct, DRIVE_SCAN and SHARING_AUDIT Weekly, AUTO_VIEWER OFF until the Grant plan is checked (section 8).'],
    ['Fill People', 'One row per person: Email, Name, Designation, Role, Active (Yes/No), Account type. A second email for the same person goes in Notes.'],
    ['Name the systems', 'Systems tab: give each a clean Display name and the right Function group.'],
    ['Review Visibility', 'Go down each person’s column and fix any tick the role rules got wrong. Your ticks are kept for ever.'],
    ['Review Grant plan', 'Check the pending Viewer grants. When happy, either press Grant Viewer access now, or set AUTO_VIEWER to ON.'],
    ['Portal Sources', 'One row per task sheet the portal should read (FMS, checklists, Delegation, Attendance, Karigar, GP). See section 7.'],
    ['Portal Names', 'If a sheet writes a short name (Babu, Megha), add a row: Name in source → Email.']
  ]);

  // 5
  d.section('Your routine');
  d.sub('Every day');
  d.para('Nothing. The timer picks up System Master changes by itself within about 5 minutes.');
  d.sub('When you add or change a system');
  d.steps([
    ['Edit System Master', 'Add the row or the links, owners and doers there (never in the Registry).'],
    ['Wait or run', 'Wait 5 minutes, or Registry > Run pipeline now.'],
    ['Check Systems and Links', 'New rows appear. Set Display name, Function group, Show as and Sensitive if needed.'],
    ['Check Visibility', 'New links get rows with default ticks. Adjust if needed, then Run pipeline now.'],
    ['Check Health', 'Fix any Warning it lists.']
  ]);
  d.sub('When someone joins');
  d.steps([
    ['Add to People', 'Email, Name, Designation, Role, Active = Yes, Account type.'],
    ['Run pipeline now', 'A new tick column appears for them in Visibility, pre-filled by role.'],
    ['Check their ticks', 'Go down their column in Visibility.'],
    ['Portal checklist', 'Open the PJ Portal > Checklists > Joining and work through it.']
  ]);
  d.sub('When someone leaves');
  d.steps([
    ['Set Active = No', 'In People. They can no longer sign in to the portal (within 5 minutes; run clearPortalCache in the portal API for instantly).'],
    ['Run pipeline now', 'Their Feed rows disappear.'],
    ['Portal checklist', 'PJ Portal > Checklists > Leaving. It lists the files they can still open; remove that access in Drive by hand.']
  ]);
  d.sub('Once a week (5 minutes)');
  d.bullets([['Health', 'Read every Warning.'], ['Grant plan', 'Any new pending grants?'], ['Revoke list', 'Anyone who should not have access?'],
             ['Suggestions', 'Any file that should be added to System Master?'], ['Tree gaps', 'Any System Master link the scan cannot find?']]);

  // 6
  d.section('The menu, item by item');
  d.para('Open the Registry and look for the menu called “Registry” in the top bar.');
  d.table([3, 6, 3], ['Menu item', 'What it does', 'When to use'], [
    ['First-time setup', 'Creates all tabs and fills starting data. Never overwrites existing data.', 'Only once (safe to repeat)'],
    ['Run pipeline now', 'Does the whole refresh immediately: Systems, Links, People, Access, Visibility, Feed.', 'After changing People or Visibility ticks'],
    ['Scan Drive now', 'Rebuilds the Drive tree (2–5 minutes; continues by itself if Drive is big).', 'After big folder changes'],
    ['Check sharing now', 'Re-reads who can open each linked file.', 'After changing sharing in Drive'],
    ['Grant Viewer access now', 'Gives the Viewer access listed in Grant plan (max 40 per run). Never changes Editor access, never emails anyone.', 'After checking Grant plan'],
    ['Apply settings', 'Re-installs the timers after you change Settings.', 'Only after changing Settings'],
    ['Open Health', 'Jumps to the Health tab.', 'Any time']
  ]);

  // 7
  d.section('Every tab, and what it is for');
  d.table([3, 2, 2, 5], ['Tab', 'Group', 'You edit?', 'What it holds'], [
    ['Guide', 'Help', 'No', 'The Registry’s own short guide, written by the Registry code. Older wording (mentions Looker Studio and Google Site).'],
    ['Registry Guide', 'Help', 'No', 'This tab. Written by the portal API (setupRegistryGuide).'],
    ['Portal Guide', 'Help', 'No', 'The full guide to the PJ Portal. Written by the portal API (setupPortalGuide).'],
    ['Settings', 'Control', 'Yes', 'Switches for the automation, plus the Sensitive-for-Doers list (section 8).'],
    ['People', 'Control', 'Yes', 'Everyone who may sign in: Email, Name, Designation, Role, Active, Account type, Systems (auto), Notes.'],
    ['Visibility', 'Control', 'Yes (ticks)', 'THE CHECKLIST of who sees which link. One row per link, one tick column per person. Gold tab.'],
    ['Systems', 'From System Master', 'Display name, Function group', 'One row per system with its people, Purpose, Result, Lifecycle and Gaps.'],
    ['Links', 'From System Master', 'Show as, Sensitive, Notes', 'One row per link: type, label, URL, link status.'],
    ['Access', 'From System Master', 'Task (MIS)', 'One row per person per system: their access type and task. Task (MIS) wins over Task (auto).'],
    ['Feed', 'Result', 'No', 'One row per person per link they may see. The portal reads this.'],
    ['Drive tree', 'Drive', 'No', 'Indented folder > file tree with owner, modified date and System Master status.'],
    ['Tree gaps', 'Drive', 'No', 'System Master links the scan could not find (moved, deleted, other owner, no access).'],
    ['Suggestions', 'Drive', 'No (review)', 'Drive files that look like a system’s but are missing in System Master.'],
    ['Sharing audit', 'Sharing', 'No', 'Per file: everyone who can open it and how (owner / editor / viewer / commenter).'],
    ['Access matrix', 'Sharing', 'No', 'Files down, people across: a quick eye-check of access.'],
    ['Grant plan', 'Sharing', 'No (review)', 'Viewer access to ADD: ticked in Visibility, but Drive does not let them open it yet. Status Pending / Done / Failed.'],
    ['Revoke list', 'Sharing', 'No (review)', 'Access to REVIEW: can open the file but not ticked. Nothing is removed automatically.'],
    ['Log', 'Status', 'No', 'Short history of runs, newest first.'],
    ['Health', 'Status', 'No', 'Problems found by the last run. Info = fine, Check / Warning = look soon.'],
    ['Tree raw / Tree queue', 'Hidden', 'No', 'Working memory of the Drive scan so it can continue across runs. Do not touch.'],
    ['Portal Sources', 'Portal', 'Yes', 'Which task sheets the portal reads: System ID, System, Type (FMS / Checklist / Delegation / Attendance / Karigar / GP), Spreadsheet ID, Tab, Active, Notes.'],
    ['Portal Names', 'Portal', 'Yes', 'Short names used inside sheets matched to a person’s email (for example Megha → Pratima Hosurkar).'],
    ['Portal Checklist Items', 'Portal', 'Yes', 'The steps of the Leaving and Joining checklists.'],
    ['Portal Checklist Log', 'Portal', 'No', 'Every tick on a checklist: who, when.'],
    ['Portal Devices', 'Portal', 'Only to remove a lost phone', 'Phones and computers that get portal notifications.'],
    ['Portal Notices / Reads / Kudos', 'Portal', 'No', 'Created the first time a notice or appreciation is posted on the portal.'],
    ['Portal Messages', 'Not used', 'Safe to delete', 'Left over from the first chat test. Chat now lives in Firebase.']
  ]);
  d.note('ℹ', 'PORTAL TABS — The tabs starting with “Portal” belong to the PJ Portal, not to the Registry code. If a Registry update ever removes them, the portal recreates the ones it writes to; Portal Sources, Portal Names and Portal Checklist Items hold your typing, so keep a copy before any big Registry update.', 'info');

  // 8
  d.section('Settings, one by one');
  d.table([3, 2, 5, 2], ['Setting', 'Now', 'What it does', 'After changing, also run'], [
    ['AUTO_SYNC', 'ON', 'ON = System Master changes are picked up within about 5 minutes and scheduled jobs run. OFF = nothing runs by itself.', 'Apply settings'],
    ['SYSTEM_MASTER_ID', '(ID)', 'The System Master spreadsheet (read only, never edited).', 'Run pipeline now'],
    ['MASTER_TAB', 'Sheet1', 'The tab of System Master that holds the systems.', 'Run pipeline now'],
    ['DRIVE_SCAN', 'Weekly', 'How often the Drive tree is rebuilt at night: Off / Daily / Weekly.', 'Apply settings'],
    ['SHARING_AUDIT', 'Weekly', 'How often every file’s sharing is re-checked: Off / Daily / Weekly. New files are always checked.', 'Apply settings'],
    ['AUTO_VIEWER', 'OFF', 'ON = people ticked in Visibility get Viewer access automatically. OFF = only listed in Grant plan. Keep OFF until Grant plan is checked.', 'Run pipeline now'],
    ['INCLUDE_SHARED', 'ON', 'ON = the Drive scan also reads “Shared with me”.', 'Scan Drive now'],
    ['MAX_GRANTS_PER_RUN', '40', 'Safety limit on Viewer grants per run.', 'Run pipeline now'],
    ['EXTRA_SCAN_ROOTS', '(blank)', 'Optional extra folder IDs to scan fully, separated by commas.', 'Scan Drive now'],
    ['SUGGEST_SHARED', 'OFF', 'OFF = Suggestions ignores other people’s files under “Shared with me”. ON = includes them.', 'Scan Drive now'],
    ['Sensitive for Doers (columns E:F)', 'list', 'System + link type pairs hidden from Doers: Attendance System sheet, Verification sheet, Hiring FMS (FMS and sheet), Gold Loan sheet, GP Sheet sheet, MIS Summary sheet, Customer Gift Distribution Form sheet.', 'Run pipeline now']
  ]);

  // 9
  d.section('Who sees what');
  d.para('When a new person or link appears, the ticks are filled from these rules. After that, your ticks win.');
  d.table([4, 8], ['Link type', 'Ticked by default for'], [
    ['Doer dashboard, Checklist, Form / web app', 'Everyone'],
    ['MD dashboard, Dashboard, Flow chart', 'Owner, Manager, Admin'],
    ['Sheet, FMS', 'Manager, Admin — and a Doer who works on that system, unless the link is Sensitive'],
    ['Document', 'Owner, Admin'],
    ['Training video, Code file, Drive folder', 'Admin only'],
    ['Any link of an Inactive system', 'Admin and Owner only'],
    ['Open button', 'Yes for Editors and Owners who may open the real file; Doers get view-only']
  ]);
  d.note('★', 'Active = No in People hides EVERYTHING for that person on the portal, whatever the ticks say.');

  // 10
  d.section('Drive and sharing, in plain words');
  d.table([3, 9], ['Drive tree status', 'Meaning'], [
    ['Linked', 'This exact file or folder is linked in System Master.'],
    ['Inside linked folder', 'It sits inside a folder that is linked. Covered: no separate row, suggestion, grant or revoke.'],
    ['Not in System Master', 'Unknown to System Master. If it looks like it belongs to a system it also appears in Suggestions.']
  ]);
  d.steps([
    ['Sharing audit', 'Reads who can open each linked file now.'],
    ['Compare', 'Visibility ticks (who SHOULD see) are compared with the Sharing audit (who CAN open).'],
    ['Grant plan', 'Ticked but cannot open → a Viewer grant to give. Done only with AUTO_VIEWER ON or Grant Viewer access now, max 40 per run.'],
    ['Revoke list', 'Can open but not ticked → listed for you to review. Fix by ticking them, or by removing their access in Drive yourself.']
  ]);
  d.note('ℹ', 'WHO RUNS THE SHARING — Sharing can only be changed by someone who owns or edits the file. System Master files are owned by rohantodkar@, so grants and the sharing audit must run from that login.', 'info');

  // 11
  d.section('What happens automatically');
  d.table([3, 3, 6], ['Job', 'When', 'What it does'], [
    ['System Master check', 'Every 5 minutes', 'If System Master changed: full pipeline. If not: nothing (saves quota).'],
    ['Drive scan', 'Weekly at night (DRIVE_SCAN)', 'Rebuilds Drive tree, Tree gaps and Suggestions.'],
    ['Sharing audit', 'Weekly at night (SHARING_AUDIT)', 'Re-reads sharing of every linked file; new files always.'],
    ['Viewer grants', 'Only if AUTO_VIEWER = ON', 'Gives the pending grants, max 40 per run.'],
    ['PJ Portal (separate)', 'Every 10 minutes / 23:00', 'The portal API reads People, Feed and Portal Sources on its own timers. Details in the Portal Guide.']
  ]);

  // 12
  d.section('When something looks wrong');
  d.table([4, 8], ['What you see', 'What to do'], [
    ['A person sees nothing on the portal', 'People: email spelled exactly as their Google login, Active = Yes, Role filled. Then Run pipeline now. The portal refreshes People every 5 minutes.'],
    ['A new system is not on the portal', 'Is its Sheet Status Active in System Master? Run pipeline now, then check Log and Systems.'],
    ['A link is missing for someone', 'Find the link’s row in Visibility and tick that person, then Run pipeline now.'],
    ['A Doer can see a sensitive sheet', 'Links: set Sensitive = Yes, or add the System + type to the Sensitive list in Settings, then untick in Visibility.'],
    ['“You need access” when opening a link', 'Drive does not let them open it yet. See Grant plan, or share the file in Drive.'],
    ['A row in Tree gaps', 'The file was moved, deleted, or is owned by someone the scan cannot read. Fix the link in System Master or the file in Drive.'],
    ['Health shows a Warning', 'Read the Detail column; most are missing flow charts, training videos or doers in System Master.'],
    ['Nothing updates at all', 'Settings: AUTO_SYNC = ON, then Registry > Apply settings. Check Log for an error message.']
  ]);

  // 13
  d.section('Quick reference card');
  d.table([5, 7], ['I want to…', 'Go to'], [
    ['Add or change a system or its links', L_('System Master', F.master)],
    ['Decide who sees a link', 'Visibility tab (tick boxes)'],
    ['Add / remove a person', 'People tab (Active = No to remove)'],
    ['Make a link open inside the portal', 'Links tab > Show as = Embed'],
    ['Hide a link from Doers', 'Links tab > Sensitive = Yes'],
    ['Refresh everything now', 'Registry > Run pipeline now'],
    ['See problems', 'Health tab'],
    ['Give pending Viewer access', 'Grant plan, then Registry > Grant Viewer access now'],
    ['Add a task sheet to the portal', 'Portal Sources tab'],
    ['Learn how the portal works', 'Portal Guide tab']
  ]);

  return d.render(SpreadsheetApp.openById(cfg_('REGISTRY_ID')), REG_GUIDE_TAB);
}

/* =====================================================================
 * PORTAL GUIDE
 * ===================================================================== */

function writePortalGuide_() {
  var F = guideFacts_();
  var d = new GuideDoc_();
  d.title('PJ PORTAL  —  The Complete Guide');
  d.subtitle('Pratap Jewellers  ·  Staff intranet on GitHub Pages + Apps Script + Firebase  ·  Guide built ' + F.when +
    '  ·  Written for a complete beginner: read top to bottom once, then use the Contents to look things up.');
  d.contentsHere();

  // 1
  d.section('Start here — the 60-second version');
  d.para('What is the PJ Portal?  One website where every staff member signs in with Google and sees only what is theirs: ' +
    'their systems and links, their tasks across FMS, checklists and the Delegation Sheet, their attendance, notices, ' +
    'appreciation and private chat with colleagues. Managers and Owners see the whole team. It costs nothing to run.');
  d.gap(4);
  d.boxes([[2, 3, '1   Open the portal\non phone or computer', GK.brown], [6, 3, '2   Sign in with Google', GK.purple],
           [10, 3, '3   The API checks the\nRegistry People tab', GK.forest]], 56);
  d.arrows([[10, 3]]);
  d.boxes([[10, 3, '4   They see only their\nown systems and work', GK.navy]], 56);
  d.gap(10);
  d.note('★', 'THE FIVE GOLDEN RULES — (1) Who may sign in is decided ONLY by the Registry People tab (Active = Yes).  ' +
    '(2) What each person sees comes from the Registry (Visibility, Feed) and the task sheets; the portal never edits System Master or any task sheet.  ' +
    '(3) Updating the API: always Deploy > Manage deployments > ✏️ > New version, never a new deployment.  ' +
    '(4) Never put passwords, keys or Script Properties in GitHub: the code is public.  ' +
    '(5) Firebase stays on the free Spark plan: never click Upgrade and never add a card.');

  // 2
  d.section('The big picture');
  d.para('Brown = your Google Sheets. Purple = the portal’s engine. Blue = what staff use. Plum = chat.');
  d.boxes([[2, 6, 'Task sheets (read only)\nFMS · Checklists · Delegation · Attendance · Karigar · GP', GK.brown],
           [8, 6, 'System Registry\nPeople · Feed · Portal tabs', GK.brown]], 52);
  d.arrows([[2, 6], [8, 6]]);
  d.boxes([[2, 12, 'PORTAL API  (Apps Script under mis@)\nchecks who you are · reads only what you may see · builds a work snapshot every 10 minutes', GK.purple]], 52);
  d.arrows([[2, 12]]);
  d.boxes([[2, 12, 'PJ PORTAL WEBSITE  (GitHub Pages)  —  Systems · Work · Board · Scores · Insights · Attendance · Search · Messages', GK.navy]], 44);
  d.arrows([[2, 6], [8, 6]]);
  d.boxes([[2, 6, 'Chat messages\nFirebase Firestore (text only)', GK.plum], [8, 6, 'Chat photos, videos, PDFs\nDrive folder of mis@ · daily archive spreadsheet', GK.plum]], 52);
  d.gap(10);
  d.bullets([
    ['Staff see', 'Only their own rows. The API filters on the server after Google proves who is signed in.'],
    ['Drive is the lock', 'A link opens a file only if Drive lets that person open it.'],
    ['Never read', 'System Master is never edited. Salary, loans, KL_ ledgers, Kaarigar_Payments, customer mobile numbers and GP customer names / rates / costs are never read.']
  ]);

  // 3
  d.section('Words you will meet');
  d.table([3, 9], ['Word', 'Plain meaning'], [
    ['Portal / website', 'What staff open: ' + F.site],
    ['API', 'The Apps Script project “PJ Portal API” under mis@. The only thing that reads your sheets.'],
    ['Deployment / version', 'The API’s web address. Each update is a NEW VERSION of the same deployment so the address never changes.'],
    ['Session', 'After Google sign-in the API gives a signed pass valid for 7 days. Sign out ends it.'],
    ['Role', 'Admin (MIS) · Owner · Manager (includes the EA) · Doer. Comes from the People tab.'],
    ['Snapshot', 'A ready-made copy of everyone’s work, rebuilt every 10 minutes so pages open fast.'],
    ['Cache', 'Short-term copy (People 5 min, checklists 5 min). Run clearPortalCache to refresh at once.'],
    ['Firestore', 'Google’s free database in Firebase project ' + FIREBASE_PROJECT + ' where chat text lives.'],
    ['FCM', 'Firebase Cloud Messaging: free phone notifications.'],
    ['Device token', 'The address of one phone or browser for notifications. Kept in Portal Devices.'],
    ['Spark plan', 'Firebase’s free plan. It can never charge; at a limit it pauses until the next day.'],
    ['Audit (chat)', 'A switch, OFF by default. While ON, Admin / Owners / Managers can read chats sent after it was turned on.']
  ]);

  // 4
  d.section('What each person sees');
  d.table([2, 10], ['Role', 'Pages and powers'], [
    ['Doer', 'Systems (own links) · My work · Board (own items) · Scores · Attendance (own) · Search · Messages · Vendor scorecard (without GP sales).'],
    ['Manager', 'Everything a Doer sees for the whole team, plus Insights and Checklists (Leaving / Joining). Can post notices and give appreciation. Includes the EA.'],
    ['Owner', 'Everything a Manager sees, plus Inactive systems and the Vendor scorecard’s GP sales part.'],
    ['Admin (MIS)', 'Everything, plus Chat records (archive, delete tool, audit switch) and the GP sales part.']
  ]);

  // 5
  d.section('The pages, one by one');
  d.table([3, 9], ['Page', 'What it shows'], [
    ['Systems', 'Home. Today at Pratap card (anniversaries, new joiners), Notice board, Appreciation wall, and the person’s systems grouped by function, with links that open inside or in a new tab.'],
    ['Work / My work', 'Tasks assigned, done, pending and overdue across FMS, checklists and the Delegation Sheet for a chosen period.'],
    ['Board', 'Every open FMS step as a board; below it, Items with karigars (repair pieces still with a karigar).'],
    ['Scores', 'One number per person per week: tasks done on time ÷ tasks due.'],
    ['Insights', 'Team trends, delays and celebrations (not for Doers).'],
    ['Attendance', 'Attendance summary from the Attendance System.'],
    ['🔍 Search', 'Searches systems, links, orders, repairs and people the person may see.'],
    ['Vendor scorecard', 'Order to Delivery and Purchase to Display vendor promises kept, with period filter and “How to check manually” steps.'],
    ['Checklists', 'Leaving and Joining checklists (Admin, Owners, Managers). Ticks are saved in Portal Checklist Log.'],
    ['💬 Messages', 'Private one-to-one chat with photos, videos and PDFs, plus phone notifications.'],
    ['⚙️ Chat records', 'Admin: archive status, delete old chats, audit switch.']
  ]);

  // 6
  d.section('Your routine (MIS)');
  d.sub('Every day');
  d.para('Nothing. The snapshot rebuilds every 10 minutes (07:00–24:00) and chat is archived at 23:00.');
  d.sub('When something changes');
  d.table([4, 8], ['Change', 'What to do'], [
    ['New person / someone leaves', 'Registry People tab (Active Yes / No). Wait 5 minutes or run clearPortalCache. Use Checklists > Joining / Leaving.'],
    ['New task sheet (FMS, checklist …)', 'Add a row to Portal Sources (System ID, System, Type, Spreadsheet ID, Tab, Active = Yes).'],
    ['A name in a sheet is not matched', 'Add it to Portal Names (Name in source → Email). The Board shows unmatched names.'],
    ['New checklist step', 'Edit Portal Checklist Items.'],
    ['A phone is lost', 'Delete its row in Portal Devices.'],
    ['I changed a guide or the code', 'Paste the new files into the API, run the setup function if told to, then Deploy > Manage deployments > ✏️ > New version.']
  ]);
  d.sub('Once a month (5 minutes)');
  d.table([3, 5, 4], ['Check', 'Link', 'Look for'], [
    ['Firestore usage', L_('Open usage', F.fb + '/firestore/databases/-default-/usage'), 'Well below the limits in section 9.'],
    ['API errors', L_('Open executions', F.execs), 'Many red “Failed” rows in a row.'],
    ['Chat records', L_('Open Chat records', F.site + '#chatadmin'), 'Archive “last run” is today or yesterday.'],
    ['Drive storage', L_('Open storage', 'https://drive.google.com/settings/storage'), 'Enough space left on mis@.'],
    ['Who has access', 'Firebase > Users and permissions; Archive and chat folder > Share', 'Only mis@ and rohantodkar@; Restricted.']
  ]);

  // 7
  d.section('Where everything is stored');
  d.table([3, 4, 5], ['What', 'Link', 'What it is · who can open it'], [
    ['Portal website', L_(F.site, F.site), 'Hosted free on GitHub Pages. Holds no data: everything comes from the API after sign-in.'],
    ['Portal code', L_(F.repo, F.repo), 'GitHub, public. Only you have write access. Main branch protected from deletion and force-push.'],
    ['Portal API (Apps Script)', L_('Open the API project', F.script), 'Runs as mis@. Script Properties hold REGISTRY_ID, OAUTH_CLIENT_ID, SESSION_SECRET (never share).'],
    ['API web address', F.api || '(Deploy > Manage deployments)', 'Stored in GitHub as VITE_API_URL. Same address for every new version.'],
    ['Registry', L_('Open the Registry', F.reg), 'People, Feed, Visibility and the Portal tabs.'],
    ['Chat messages (live)', L_('Open Firestore chats', F.fb + '/firestore/databases/-default-/data/~2Fchats'), 'Text only. Only the two people of a chat can read it (plus audit, if ON).'],
    ['Who may chat', L_('Open Firestore staff', F.fb + '/firestore/databases/-default-/data/~2Fstaff'), 'Copied from People (Active = Yes) every 10 minutes.'],
    ['Chat photos, videos, PDFs', L_('Open the chat folder', F.folder), 'Drive of mis@. One sub-folder per chat. Restricted: never share by link.'],
    ['Chat archive', F.archive ? L_('Open the archive', F.archive) : 'Not created yet (run setupChat)', 'Daily copy of every message (tabs: Messages, Deletion log, Guide).'],
    ['Google sign-in client', 'Google Cloud project number ' + F.clientProject + ' > APIs & Services > Credentials', 'The OAuth client for “Sign in with Google” (Script Property OAUTH_CLIENT_ID).'],
    ['Firebase project', L_('Open Firebase', F.fb + '/overview'), FIREBASE_PROJECT + ' on Spark (free): Firestore, chat sign-in, notifications.'],
    ['Firebase web key', L_('Open credentials', 'https://console.cloud.google.com/apis/credentials?project=' + FIREBASE_PROJECT), 'Public on purpose, but locked to the portal website and 6 APIs only.']
  ]);

  // 8
  d.section('What happens automatically');
  d.table([3, 3, 6], ['Timer (Apps Script ⏰)', 'When', 'What it does'], [
    ['refreshWorkCache', 'Every 10 minutes', 'Copies the staff list to Firestore (only when People changed). From 07:00 to 24:00 also rebuilds the work snapshot. Uses about 1.5 of the 6 free timer hours a day.'],
    ['archiveChats', 'Every day at 23:00', 'Copies that day’s new chat messages to the archive.'],
    ['Not timers', '—', 'Short-term copies just expire. Chat and notifications are instant pushes from Firebase. The guides are written only when you run setupGuides.']
  ]);

  // 9
  d.section('Free limits (nothing here is ever billed)');
  d.table([4, 4, 4], ['Service', 'Free limit', 'Note'], [
    ['Firestore: stored data', '1 GiB', 'Millions of text messages. Photos are in Drive, not here.'],
    ['Firestore: reads', '50,000 per day', 'Opening chats and the inbox. Resets about 1:30 pm IST.'],
    ['Firestore: writes', '20,000 per day', 'Sending messages, “Seen”, staff list changes.'],
    ['Firestore: deletes', '20,000 per day', 'The delete tool. Very big clean-ups may need 2 days.'],
    ['Firestore: downloaded', '10 GiB per month', ''],
    ['Phone notifications (FCM)', 'Free, no limit', ''],
    ['Sign-in (Google + Firebase)', 'Free for a team this size', ''],
    ['Apps Script (mis@)', '100,000 web requests/day · 6 min per run · 6 h timers/day · ~30 runs at once', 'The portal uses a small part.'],
    ['Google Sheets', '10 million cells per spreadsheet', 'Chat archive: about 800,000 messages.'],
    ['Drive (chat files)', 'mis@ Workspace storage', 'Per file: photo 10 MB (shrunk to ~0.2 MB), video 25 MB, PDF 10 MB.'],
    ['GitHub Pages', '1 GB site · ~100 GB traffic / month', 'The portal is under 2 MB.'],
    ['If a limit is reached', 'That part pauses until the next reset', 'Nothing is lost and nothing is billed.']
  ]);

  // 10
  d.section('Security: what protects the portal');
  d.table([4, 8], ['Protection', 'How it works'], [
    ['Real Google sign-in', 'Google proves who is signed in. The API never trusts an email typed by the browser.'],
    ['People tab decides', 'Only Active = Yes people get a session. Active = No locks them out within 5 minutes.'],
    ['Filtered on the server', 'Each person’s data is cut down inside the API before it is sent. Hidden data never reaches their phone.'],
    ['Drive still locks files', 'Links open only if Drive allows that person.'],
    ['Firestore rules', 'Only the two people of a chat can read or write it; messages cannot be edited or faked.'],
    ['Locked web key', 'The Firebase key works only from the portal website and only for the 6 APIs it needs.'],
    ['2-Step Verification', 'On for mis@, rohantodkar@ and GitHub, with backup codes kept offline.'],
    ['Protected code', 'GitHub main branch cannot be deleted or force-pushed.'],
    ['No card on file', 'Firebase on Spark and no billing account: nothing can ever be charged.']
  ]);

  // 11
  d.section('Chat records and deleting chats');
  d.steps([
    ['Open', 'Portal > 💬 Messages > “⚙️ Chat records” (Admin only).'],
    ['Choose', 'A person, one chat and / or a date range. At least one is needed.'],
    ['Preview', 'Shows how many messages and files would go.'],
    ['Delete', 'Type DELETE. New messages are archived first; files go to the Drive bin (30 days to restore); a row is added to Deletion log.'],
    ['Big clean-ups', 'Up to 3,000 messages per run: press Delete again until nothing is left.']
  ]);
  d.note('ℹ', 'AUDIT SWITCH — OFF by default. Only Admin can switch it. While ON, Admin, Owners and Managers can read chats sent after it was turned on, and staff see a notice in Messages.', 'info');

  // 12
  d.section('Installing an update');
  d.steps([
    ['Website changes', 'Nothing to do: GitHub publishes them in about 2 minutes. Staff pull down to refresh.'],
    ['API changes', 'Open the API project, open each changed file, Ctrl+A, paste the new version from GitHub, Ctrl+S.'],
    ['Run a setup function', 'Only if told to (for example setupGuides).'],
    ['Deploy', 'Deploy > Manage deployments > ✏️ > Version: New version > Deploy. Never “New deployment”.']
  ]);

  // 13
  d.section('When something looks wrong');
  d.table([4, 8], ['What you see', 'What to do'], [
    ['“This account is marked inactive”', 'People tab: Active = Yes and the email exactly as their Google login. Wait 5 minutes or run clearPortalCache.'],
    ['A person sees no systems', 'Registry Visibility ticks and Feed. See the Registry Guide, section 12.'],
    ['Work numbers look old', 'The snapshot is up to 10 minutes old and pauses 00:00–07:00. Run testWork in the API for a fresh one.'],
    ['A name shows as unmatched', 'Add it to Portal Names.'],
    ['Chat stuck on “Sending…”', 'Check the internet; reopen Messages. If it persists, check Firestore usage for a reached limit.'],
    ['No phone notifications', 'Messages > 🔔 Turn off then Turn on. On iPhone the portal must be opened from the Home Screen icon.'],
    ['Many failed runs in executions', 'Open one to read the error, then tell MIS.']
  ]);

  // 14
  d.section('Never do');
  d.table([5, 7], ['Never', 'Because'], [
    ['Upgrade Firebase to Blaze or add a card', 'Spark can never charge. Blaze can.'],
    ['Share the chat folder, archive or Registry “Anyone with the link”', 'Staff open chat files through the portal, which checks who they are.'],
    ['Put passwords, keys or Script Properties in GitHub', 'The repository is public.'],
    ['Make a NEW deployment of the API', 'The web address would change and the portal would stop.'],
    ['Rename Portal tabs or their header rows', 'The portal finds them by name.']
  ]);

  // 15
  d.section('Delete everything from scratch');
  d.para('Do the steps in this order. Steps 3 onwards stop the portal for everyone.');
  d.steps([
    ['Keep a copy', 'Chat archive: File > Download > Microsoft Excel. Registry Portal tabs: the same. GitHub: Code > Download ZIP. Keep these offline.'],
    ['Tell staff', 'The portal, chat and notifications stop working from step 3.'],
    ['Stop the API', 'API project > ⏰ Triggers: delete refreshWorkCache and archiveChats. Deploy > Manage deployments > Archive. Then move the “PJ Portal API” project to the Drive bin.'],
    ['Delete Firebase', 'Firebase > ⚙️ Project settings > General > bottom > Delete project. Removes all chats, the staff copy, chat sign-in, notifications and Google Cloud project ' + FIREBASE_PROJECT + ' (Google keeps it 30 days in case you change your mind).'],
    ['Sign-in client', 'Google Cloud project number ' + F.clientProject + ' > APIs & Services > Credentials: delete the OAuth client whose ID matches OAUTH_CLIENT_ID, after checking no other system uses it.'],
    ['Drive files', 'Move the chat folder (photos, videos, PDFs and the archive inside it) to the bin, then Empty bin. Permanent.'],
    ['Registry tabs', 'Delete only the tabs starting with “Portal” and the Registry Guide. Do not touch People, Feed or any other tab.'],
    ['GitHub', 'Repository > Settings > General > Danger Zone > Delete this repository (the website disappears within minutes). Also github.com/settings/installations > Claude > Uninstall.'],
    ['Account permissions', 'As mis@: myaccount.google.com/permissions > remove “PJ Portal API” if listed. Workspace Admin > Security > API controls > App access control: remove PJ Portal if listed.'],
    ['Staff phones', 'Nothing needed. Notifications stop after step 4. Staff can long-press to remove the Home Screen icon.'],
    ['Final check', 'Portal address shows 404. Firebase no longer lists ' + FIREBASE_PROJECT + '. Drive bin is empty.']
  ]);

  // 16
  d.section('Quick reference card');
  d.table([5, 7], ['I want to…', 'Go to'], [
    ['Add / remove a person', 'Registry > People (Active Yes / No)'],
    ['Refresh People now', 'API project > run clearPortalCache'],
    ['Add a task sheet', 'Registry > Portal Sources'],
    ['Fix an unmatched name', 'Registry > Portal Names'],
    ['Change checklist steps', 'Registry > Portal Checklist Items'],
    ['Delete old chats', L_('Portal > Chat records', F.site + '#chatadmin')],
    ['See errors', L_('API executions', F.execs)],
    ['See Firestore usage', L_('Firestore usage', F.fb + '/firestore/databases/-default-/usage')],
    ['Rewrite these guides', 'API project > run setupGuides'],
    ['Open the portal', L_(F.site, F.site)]
  ]);

  return d.render(SpreadsheetApp.openById(cfg_('REGISTRY_ID')), GUIDE_TAB);
}
