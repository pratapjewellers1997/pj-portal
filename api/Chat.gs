/**
 * PJ Portal API: Chat helpers + phone notifications (Step 13, v2).
 *
 * Chat text lives in Firebase Firestore (project FIREBASE_PROJECT): real-time,
 * free Spark plan, protected by Firestore security rules (firestore.rules in
 * the repo). This file only does what the browser cannot do safely itself:
 *
 *   1. Staff list for chat: copies Active people from the Registry People tab
 *      to Firestore "staff/{email}" (every 10 minutes, only when it changed).
 *      Firestore rules let only these people read or write chats, so a leaver
 *      loses chat within 10 minutes of Active = No.
 *   2. Photos / videos / PDFs: stored privately in mis@ Google Drive, folder
 *      "PJ Portal Chat Files". Never shared by link. chatFile hands a file only
 *      to the two people of that chat.
 *        chatUpload {session, to, name, mime, data(base64)} -> {ok, file}
 *        chatFile   {session, id}                            -> {ok, name, mime, data}
 *   3. Phone notifications (Firebase Cloud Messaging):
 *        pushRegister   {session, token, device} / pushUnregister {session, token}
 *        notifyChat     {session, to}   (sent by the page after a chat message)
 *      Devices are kept in the Registry tab "Portal Devices" (created automatically).
 *      Notification text never contains the message itself, only who sent it.
 *
 * Needs: this Apps Script linked to the Firebase Google Cloud project, and the
 * scopes datastore, firebase.messaging and drive.file in appsscript.json.
 */

var FIREBASE_PROJECT = 'pj-portal-3cc45';
var FS_BASE = 'https://firestore.googleapis.com/v1/projects/' + FIREBASE_PROJECT + '/databases/(default)/documents';
var CHAT_FOLDER_NAME = 'PJ Portal Chat Files';
var DEVICES_TAB = 'Portal Devices';
var DEVICES_HEADERS = ['Email', 'Token', 'Device', 'Added', 'Last seen'];
var CHAT_FILE_LIMITS = { image: 10 * 1024 * 1024, video: 25 * 1024 * 1024, pdf: 10 * 1024 * 1024 };
var CHAT_MIME_OK = /^(image\/(jpeg|png|webp|gif|heic|heif)|video\/(mp4|quicktime|webm|3gpp)|application\/pdf)$/;

/* ================= 1. Staff list -> Firestore ================= */

/** Run once from the editor after linking the project. Also runs every 10 minutes. */
function setupChat() {
  var r = syncStaffToFirestore_(true);
  console.log('Chat staff list: ' + r.active + ' active emails written, ' + r.deactivated + ' turned off.');
  var folder = chatFolderId_();
  console.log('Chat files folder in mis@ Drive: ' + folder);
  if (typeof setupChatArchive === 'function') setupChatArchive();
}

function syncStaffToFirestore_(force) {
  var want = {};
  loadPeople_(true).forEach(function (p) {
    if (!p.active || PORTAL_ROLES.indexOf(p.role) === -1) return;
    var primary = p.emails[0];
    p.emails.forEach(function (e) {
      want[e] = { primary: primary, name: p.name || '', designation: p.designation || '', role: p.role };
    });
  });
  var hash = Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, JSON.stringify(want)));
  var props = PropertiesService.getScriptProperties();
  if (!force && props.getProperty('fs_staff_hash') === hash) return { active: 0, deactivated: 0, skipped: true };

  // Who is in Firestore now?
  var existing = [], pageToken = '';
  do {
    var res = fsFetch_('get', '/staff?pageSize=300&mask.fieldPaths=active' + (pageToken ? '&pageToken=' + encodeURIComponent(pageToken) : ''));
    (res.documents || []).forEach(function (d) { existing.push(decodeURIComponent(d.name.split('/staff/')[1])); });
    pageToken = res.nextPageToken || '';
  } while (pageToken);

  var writes = [], now = new Date().toISOString();
  Object.keys(want).forEach(function (e) {
    var w = want[e];
    writes.push({ update: { name: fsDocName_('staff/' + e), fields: {
      primary: { stringValue: w.primary }, name: { stringValue: w.name }, designation: { stringValue: w.designation },
      role: { stringValue: w.role }, active: { booleanValue: true }, updatedAt: { timestampValue: now } } } });
  });
  var off = existing.filter(function (e) { return !want[e]; });
  off.forEach(function (e) {
    writes.push({ update: { name: fsDocName_('staff/' + e), fields: { active: { booleanValue: false }, updatedAt: { timestampValue: now } } },
                  updateMask: { fieldPaths: ['active', 'updatedAt'] } });
  });
  for (var i = 0; i < writes.length; i += 400) fsFetch_('post', ':commit', { writes: writes.slice(i, i + 400) });
  props.setProperty('fs_staff_hash', hash);
  return { active: Object.keys(want).length, deactivated: off.length };
}

function fsDocName_(path) {
  // Resource name inside a request body: plain text (emails have no "/"), not URL-encoded.
  return 'projects/' + FIREBASE_PROJECT + '/databases/(default)/documents/' + path;
}

function fsFetch_(method, path, body) {
  var res = UrlFetchApp.fetch(FS_BASE + path, {
    method: method, contentType: 'application/json', muteHttpExceptions: true,
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
    payload: body ? JSON.stringify(body) : undefined
  });
  var code = res.getResponseCode();
  if (code >= 300) throw new Error('Firestore ' + code + ': ' + res.getContentText().slice(0, 300));
  return JSON.parse(res.getContentText() || '{}');
}

/* ================= 2. Photos / videos / PDFs in Drive ================= */

function chatFolderId_() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('chat_folder_id');
  if (id) return id;
  var f = Drive.Files.create({ name: CHAT_FOLDER_NAME, mimeType: 'application/vnd.google-apps.folder',
                               description: 'Photos, videos and PDFs sent in PJ Portal chat. Private: do not share.' });
  props.setProperty('chat_folder_id', f.id);
  return f.id;
}

/** One sub-folder per chat, e.g. "Harshada Lad – Rohan Todkar" (created the first time). */
function chatSubFolderId_(members) {
  var props = PropertiesService.getScriptProperties();
  var key = 'chatdir_' + Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, members.join('|'))).slice(0, 16);
  var id = props.getProperty(key);
  if (id) return id;
  var people = messageable2_(), all = loadPeople_(false), nameOf = function (e) {
    var p = all.filter(function (x) { return x.emails.indexOf(e) > -1; })[0];
    return (p && p.name) || (people[e] && people[e].name) || e;
  };
  var f = Drive.Files.create({ name: nameOf(members[0]) + ' – ' + nameOf(members[1]), parents: [chatFolderId_()],
    mimeType: 'application/vnd.google-apps.folder', appProperties: { pj: 'chatdir', m0: members[0].slice(0, 120), m1: members[1].slice(0, 120) } });
  props.setProperty(key, f.id);
  return f.id;
}

function chatPair_(user, toEmail) {
  var other = messageable2_()[normaliseEmail_(toEmail)];
  if (!other || other.primary === user.emails[0]) throw apiError_('bad_request');
  return [user.emails[0], other.primary].sort();
}

function actionChatUpload_(req) {
  var user = findPerson_(readSession_(req.session));
  var members = chatPair_(user, req.to);
  var mime = String(req.mime || '').toLowerCase();
  if (!CHAT_MIME_OK.test(mime)) throw apiError_('file_type');
  var kind = mime.indexOf('image/') === 0 ? 'image' : mime.indexOf('video/') === 0 ? 'video' : 'pdf';
  var bytes;
  try { bytes = Utilities.base64Decode(String(req.data || '')); } catch (e) { throw apiError_('bad_request'); }
  if (!bytes.length) throw apiError_('bad_request');
  if (bytes.length > CHAT_FILE_LIMITS[kind]) throw apiError_('file_too_big');
  var name = cleanText_(req.name, 120).replace(/[\\/:*?"<>|]/g, '_') || (kind + '.bin');

  var stamp = Utilities.formatDate(new Date(), TZ, 'yyyyMMdd-HHmmss');
  var blob = Utilities.newBlob(bytes, mime, stamp + ' ' + name);
  var file = Drive.Files.create({
    name: stamp + ' ' + name, parents: [chatSubFolderId_(members)], mimeType: mime,
    description: JSON.stringify({ members: members, from: user.emails[0] }),
    appProperties: { pj: 'chat', m0: members[0].slice(0, 120), m1: members[1].slice(0, 120) }
  }, blob, { fields: 'id,name,mimeType,size' });
  return { ok: true, file: { id: file.id, name: name, mime: mime, size: bytes.length, kind: kind } };
}

function actionChatFile_(req) {
  var user = findPerson_(readSession_(req.session));
  var id = String(req.id || '');
  if (!/^[\w-]{10,100}$/.test(id)) throw apiError_('bad_request');
  var meta;
  try { meta = Drive.Files.get(id, { fields: 'id,name,mimeType,size,appProperties,parents,trashed,createdTime' }); }
  catch (e) { throw apiError_('not_found'); }
  var ap = meta.appProperties || {};
  var isChatFile = ap.pj === 'chat' || (meta.parents || []).indexOf(chatFolderId_()) > -1;
  if (meta.trashed || !isChatFile || !ap.m0) throw apiError_('not_found');
  var member = user.emails.indexOf(ap.m0) > -1 || user.emails.indexOf(ap.m1) > -1;
  var audit = typeof chatAuditAllows_ === 'function' && chatAuditAllows_(user, Date.parse(meta.createdTime));
  if (!member && !audit) throw apiError_('forbidden');
  var res = UrlFetchApp.fetch('https://www.googleapis.com/drive/v3/files/' + id + '?alt=media', {
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) throw apiError_('not_found');
  return { ok: true, name: meta.name.replace(/^\d{8}-\d{6} /, ''), mime: meta.mimeType,
           data: Utilities.base64Encode(res.getBlob().getBytes()) };
}

/** Active staff by every email -> {primary, name}. */
function messageable2_() {
  var map = {};
  loadPeople_(false).forEach(function (p) {
    if (!p.active || PORTAL_ROLES.indexOf(p.role) === -1) return;
    p.emails.forEach(function (e) { map[e] = { primary: p.emails[0], name: p.name, emails: p.emails }; });
  });
  return map;
}

/* ================= 3. Phone notifications ================= */

function devHeaders_() { HEADERS[DEVICES_TAB] = DEVICES_HEADERS; }

function actionPushRegister_(req) {
  var user = findPerson_(readSession_(req.session));
  var token = String(req.token || '');
  if (!/^[\w:\-]{60,400}$/.test(token)) throw apiError_('bad_request');
  var device = cleanText_(req.device, 80);
  devHeaders_();
  withLock_(function () {
    var sh = sheetOf_(DEVICES_TAB);
    var rows = sh.getLastRow() > 1 ? sh.getRange(2, 1, sh.getLastRow() - 1, 2).getValues() : [];
    for (var i = 0; i < rows.length; i++) {
      if (rows[i][1] === token) {
        sh.getRange(i + 2, 1).setValue(user.email);
        sh.getRange(i + 2, 5).setValue(new Date());
        return;
      }
    }
    sh.appendRow([user.email, token, safeCell_(device), new Date(), new Date()]);
  });
  CacheService.getScriptCache().remove('devices_v1');
  return { ok: true };
}

function actionPushUnregister_(req) {
  findPerson_(readSession_(req.session));
  removeDeviceTokens_([String(req.token || '')]);
  return { ok: true };
}

function loadDevices_() {
  var cache = CacheService.getScriptCache(), hit = cache.get('devices_v1');
  if (hit) { try { return JSON.parse(hit); } catch (e) {} }
  var sh = SpreadsheetApp.openById(cfg_('REGISTRY_ID')).getSheetByName(DEVICES_TAB);
  var list = [];
  if (sh && sh.getLastRow() > 1) {
    sh.getRange(2, 1, sh.getLastRow() - 1, 2).getValues().forEach(function (r) {
      if (r[0] && r[1]) list.push({ email: normaliseEmail_(r[0]), token: String(r[1]) });
    });
  }
  try { cache.put('devices_v1', JSON.stringify(list), 600); } catch (e) {}
  return list;
}

function removeDeviceTokens_(tokens) {
  tokens = tokens.filter(Boolean);
  if (!tokens.length) return;
  devHeaders_();
  withLock_(function () {
    var sh = SpreadsheetApp.openById(cfg_('REGISTRY_ID')).getSheetByName(DEVICES_TAB);
    if (!sh || sh.getLastRow() < 2) return;
    var vals = sh.getRange(2, 2, sh.getLastRow() - 1, 1).getValues();
    for (var i = vals.length - 1; i >= 0; i--) if (tokens.indexOf(String(vals[i][0])) > -1) sh.deleteRow(i + 2);
  });
  CacheService.getScriptCache().remove('devices_v1');
}

/**
 * Sends a phone notification to every device of these people. Never throws.
 * Text is generic on purpose (lock screens): who / what, not the content.
 */
function notifyPush_(emails, title, body, url, tag) {
  try {
    var devices = loadDevices_().filter(function (d) { return emails.indexOf(d.email) > -1; });
    if (!devices.length) return 0;
    var token = ScriptApp.getOAuthToken();
    var reqs = devices.map(function (d) {
      return {
        url: 'https://fcm.googleapis.com/v1/projects/' + FIREBASE_PROJECT + '/messages:send',
        method: 'post', contentType: 'application/json', muteHttpExceptions: true,
        headers: { Authorization: 'Bearer ' + token },
        payload: JSON.stringify({ message: { token: d.token,
          webpush: { headers: { Urgency: 'high', TTL: '2419200' },
                     data: { title: String(title).slice(0, 80), body: String(body || '').slice(0, 140),
                             url: String(url || ''), tag: String(tag || '') } } } })
      };
    });
    var dead = [];
    UrlFetchApp.fetchAll(reqs).forEach(function (res, i) {
      var code = res.getResponseCode();
      if (code === 404 || (code === 400 && /UNREGISTERED|INVALID_ARGUMENT/.test(res.getContentText()))) dead.push(devices[i].token);
      else if (code >= 300) console.warn('FCM ' + code + ': ' + res.getContentText().slice(0, 200));
    });
    if (dead.length) removeDeviceTokens_(dead);
    return devices.length - dead.length;
  } catch (e) {
    console.warn('notifyPush_ failed: ' + e);
    return 0;
  }
}

/** notifyChat {session, to}: the page calls this after sending a chat message. At most one push per chat per 30 s. */
function actionNotifyChat_(req) {
  var user = findPerson_(readSession_(req.session));
  var other = messageable2_()[normaliseEmail_(req.to)];
  if (!other || other.primary === user.emails[0]) throw apiError_('bad_request');
  var cache = CacheService.getScriptCache(), key = 'nc_' + user.emails[0] + '_' + other.primary;
  if (cache.get(key)) return { ok: true, sent: 0, throttled: true };
  cache.put(key, '1', 30);
  var sent = notifyPush_(other.emails, '💬 ' + user.name, 'New message. Tap to open.', '#messages/' + encodeURIComponent(user.emails[0]), 'chat-' + user.emails[0]);
  return { ok: true, sent: sent };
}

/** For notices: emails of everyone in an audience ("All", "Doers", "Managers"). */
function audienceEmails_(audience, exceptEmail) {
  var out = [];
  loadPeople_(false).forEach(function (p) {
    if (!p.active || PORTAL_ROLES.indexOf(p.role) === -1 || p.emails.indexOf(exceptEmail) > -1) return;
    if (audience === 'Doers' && p.role !== 'Doer') return;
    if (audience === 'Managers' && p.role === 'Doer') return;
    out = out.concat(p.emails);
  });
  return out;
}
