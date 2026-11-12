/**
 * PJ Portal API — People lookup (read-only).
 *
 * Reads the Registry "People" tab by header name, so column order can change.
 * Columns used: Email, Name, Designation, Role, Active, Account type.
 * An Email cell may hold more than one address (comma, semicolon or new line),
 * e.g. samkit@ and admin@ for the same person.
 * Role "System" (the mis@ automation account) is never allowed to sign in.
 */

var PORTAL_ROLES = ['Admin', 'Owner', 'Manager', 'Doer'];

function loadPeople_(skipCache) {
  var cache = CacheService.getScriptCache();
  if (!skipCache) {
    var hit = cache.get('people_v1');
    if (hit) return JSON.parse(hit);
  }

  var sheet = SpreadsheetApp.openById(cfg_('REGISTRY_ID')).getSheetByName(PEOPLE_TAB);
  if (!sheet) throw new Error('Registry tab not found: ' + PEOPLE_TAB);

  var values = sheet.getDataRange().getDisplayValues();
  var head = values[0].map(function (h) { return String(h).trim().toLowerCase(); });
  var col = function (name) { return head.indexOf(name); };
  var cEmail = col('email'), cName = col('name'), cDesig = col('designation'),
      cRole = col('role'), cActive = col('active'), cAcct = col('account type');
  if (cEmail === -1 || cRole === -1) throw new Error('People tab needs Email and Role columns');

  var people = [];
  for (var r = 1; r < values.length; r++) {
    var row = values[r];
    var emails = String(row[cEmail] || '')
      .split(/[\s,;]+/)
      .map(normaliseEmail_)
      .filter(function (e) { return e.indexOf('@') > 0; });
    if (!emails.length) continue;
    people.push({
      emails: emails,
      name: cName > -1 ? row[cName] : '',
      designation: cDesig > -1 ? row[cDesig] : '',
      role: String(row[cRole] || '').trim(),
      active: cActive > -1 ? isTrue_(row[cActive]) : true,
      accountType: cAcct > -1 ? row[cAcct] : ''
    });
  }

  try { cache.put('people_v1', JSON.stringify(people), PEOPLE_CACHE_SECONDS); } catch (e) {}
  return people;
}

/** Finds the person for a verified email, or throws not_registered / inactive. */
function findPerson_(email) {
  var people = loadPeople_(false);
  for (var i = 0; i < people.length; i++) {
    var p = people[i];
    if (p.emails.indexOf(email) === -1) continue;
    if (!p.active) throw apiError_('inactive');
    if (PORTAL_ROLES.indexOf(p.role) === -1) throw apiError_('not_registered');
    return {
      email: email,
      name: p.name,
      designation: p.designation,
      role: p.role,
      accountType: p.accountType
    };
  }
  throw apiError_('not_registered');
}

function isTrue_(v) {
  var s = String(v).trim().toLowerCase();
  return s === 'true' || s === 'yes' || s === 'y' || s === '1' || s === 'active';
}
