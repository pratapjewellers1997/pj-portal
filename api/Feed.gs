/**
 * PJ Portal API — Feed reader (read-only).
 *
 * Reads the Registry "Feed" tab (one row = one person + one link they may see)
 * and returns only the signed-in person's rows, grouped by system:
 *   { systems: [{id, name, group, lifecycle, purpose, task, sort, links: [...]}] }
 * Grouping by system sends the long Purpose/Task text once per system,
 * not once per link, which keeps the response small on mobile data.
 *
 * Columns are found by header name, so the Feed's column order can change.
 */

var FEED_TAB = 'Feed';
var FEED_CACHE_SECONDS = 300; // matches the Registry's 5-minute refresh

function buildPortal_(person) {
  var cache = CacheService.getScriptCache();
  var key = 'portal_v1_' + person.email;
  var hit = cache.get(key);
  if (hit) return JSON.parse(hit);

  var sheet = SpreadsheetApp.openById(cfg_('REGISTRY_ID')).getSheetByName(FEED_TAB);
  if (!sheet) throw new Error('Registry tab not found: ' + FEED_TAB);

  var values = sheet.getDataRange().getDisplayValues();
  var head = values[0].map(function (h) { return String(h).trim().toLowerCase(); });
  var c = {};
  ['email', 'system id', 'system', 'function group', 'lifecycle', 'purpose', 'task',
   'link id', 'link type', 'label', 'url', 'show as', 'open button', 'embed url', 'sort']
    .forEach(function (name) { c[name] = head.indexOf(name); });
  if (c['email'] === -1 || c['link id'] === -1 || c['url'] === -1) {
    throw new Error('Feed tab needs Email, Link ID and URL columns');
  }
  var get = function (row, name) { return c[name] > -1 ? String(row[c[name]] || '').trim() : ''; };

  var bySystem = {};
  var seenLinks = {};
  for (var r = 1; r < values.length; r++) {
    var row = values[r];
    if (person.emails.indexOf(normaliseEmail_(get(row, 'email'))) === -1) continue;

    var linkId = get(row, 'link id');
    var url = get(row, 'url');
    if (!linkId || !url || seenLinks[linkId]) continue; // one person, two emails: no duplicates
    seenLinks[linkId] = true;

    var sysId = get(row, 'system id') || get(row, 'system');
    var sort = Number(get(row, 'sort')) || 9999;
    var sys = bySystem[sysId];
    if (!sys) {
      sys = bySystem[sysId] = {
        id: sysId,
        name: get(row, 'system'),
        group: get(row, 'function group') || 'Other',
        lifecycle: get(row, 'lifecycle') || 'Active',
        purpose: get(row, 'purpose'),
        task: get(row, 'task'),
        sort: sort,
        links: []
      };
    }
    if (!sys.task && get(row, 'task')) sys.task = get(row, 'task');
    if (sort < sys.sort) sys.sort = sort;

    sys.links.push({
      id: linkId,
      type: get(row, 'link type'),
      label: get(row, 'label') || get(row, 'link type'),
      url: url,
      showAs: get(row, 'show as') || 'Open',
      open: isTrue_(get(row, 'open button')),
      embedUrl: get(row, 'embed url'),
      sort: sort
    });
  }

  var systems = Object.keys(bySystem).map(function (k) { return bySystem[k]; });
  systems.forEach(function (s) { s.links.sort(function (a, b) { return a.sort - b.sort; }); });
  systems.sort(function (a, b) { return a.sort - b.sort; });

  var result = { systems: systems, generatedAt: new Date().toISOString() };
  try { cache.put(key, JSON.stringify(result), FEED_CACHE_SECONDS); } catch (e) {} // >100 KB: skip cache
  return result;
}
