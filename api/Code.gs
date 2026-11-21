/**
 * PJ Portal API — entry points.
 *
 * Deploy: Deploy > New deployment > Web app
 *   Execute as: Me (rohantodkar@pratapjewellers.in)
 *   Who has access: Anyone
 * "Anyone" is safe: every request must carry a Google ID token or a signed
 * portal session, and the API checks it before returning anything.
 *
 * The website sends POST with Content-Type text/plain (no CORS preflight).
 * Body: {"action": "...", ...}
 *
 * Actions (Step 1):
 *   login  {idToken}  -> {ok, session, user}
 *   me     {session}  -> {ok, user}
 *   portal {session}  -> {ok, user, systems, generatedAt}   (Step 2)
 *   work   {session, from, to, person?} -> {ok, tasks, attendance, …}  (Step 3)
 *   lookup {session, q}  -> {ok, items: [{system, key, label, steps}]}  (Step 6)
 *   insights {session, from, to} -> {ok, funnels, turnaround, celebrations}  (Step 7)
 *   karigar {session} -> {ok, items}  (Step 10: items still with karigars)
 *   vendors {session, period} -> {ok, vendors, orders, sources}  (Step 11, Vendors.gs)
 *   checklists / tickChecklist  (Step 12, Checklists.gs: leaving + new joiner checklists)
 *   chatUpload / chatFile / notifyChat / pushRegister / pushUnregister  (Step 13, Chat.gs;
 *   chat text itself lives in Firebase Firestore)
 *   chatAdmin / chatPurge / chatAuditSet / auditChats / auditThread / archiveNow  (ChatAdmin.gs)
 *   social / postNotice / readNotice / removeNotice / giveKudos / removeKudos     (Step 8, Social.gs)
 */

function doGet() {
  return json_({ ok: true, service: 'PJ Portal API', version: API_VERSION });
}

function doPost(e) {
  var t0 = Date.now(), action = '?';
  try {
    var req = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    action = String(req.action || '?');
    var result;
    switch (req.action) {
      case 'login': result = actionLogin_(req); break;
      case 'refresh_session': result = actionRefreshSession_(req); break;
      case 'me':    result = actionMe_(req); break;
      case 'portal': result = actionPortal_(req); break;
      case 'work':   result = actionWork_(req); break;
      case 'lookup': result = actionLookup_(req); break;
      case 'insights': result = actionInsights_(req); break;
      case 'karigar':  result = actionKarigar_(req); break;
      case 'vendors':  result = actionVendors_(req); break;
      case 'checklists':    result = actionChecklists_(req); break;
      case 'tickChecklist': result = actionTickChecklist_(req); break;
      case 'chatUpload':     result = actionChatUpload_(req); break;
      case 'chatFile':       result = actionChatFile_(req); break;
      case 'notifyChat':     result = actionNotifyChat_(req); break;
      case 'pushRegister':   result = actionPushRegister_(req); break;
      case 'pushUnregister': result = actionPushUnregister_(req); break;
      case 'chatAdmin':      result = actionChatAdmin_(req); break;
      case 'chatPurge':      result = actionChatPurge_(req); break;
      case 'chatAuditSet':   result = actionChatAuditSet_(req); break;
      case 'auditChats':     result = actionAuditChats_(req); break;
      case 'auditThread':    result = actionAuditThread_(req); break;
      case 'archiveNow':     result = actionArchiveNow_(req); break;
      case 'social':       result = actionSocial_(req); break;
      case 'postNotice':   result = actionPostNotice_(req); break;
      case 'readNotice':   result = actionReadNotice_(req); break;
      case 'removeNotice': result = actionRemoveNotice_(req); break;
      case 'giveKudos':    result = actionGiveKudos_(req); break;
      case 'removeKudos':  result = actionRemoveKudos_(req); break;
      case 'inbox':        result = actionInbox_(req); break;
      case 'thread':       result = actionThread_(req); break;
      case 'sendMessage':  result = actionSendMessage_(req); break;
      case 'unread':       result = actionUnread_(req); break;
      default:      throw apiError_('unknown_action');
    }
    var out = json_(result);
    // Shows up in Apps Script > Executions: which action, how long, how much
    // data went back — so "this tab feels slow" has a real number behind it
    // instead of a guess, next time it comes up.
    console.log('API ' + action + ': ' + (Date.now() - t0) + ' ms, ' + out.getContent().length + ' bytes');
    return out;
  } catch (err) {
    console.log('API ' + action + ' failed: ' + (Date.now() - t0) + ' ms');
    if (err && err.apiCode) return json_({ ok: false, error: err.apiCode });
    console.error(err && err.stack ? err.stack : err);
    return json_({ ok: false, error: 'server_error' });
  }
}

function actionLogin_(req) {
  var google = verifyGoogleIdToken_(req.idToken);
  var user = findPerson_(google.email);
  user.picture = google.picture;
  return { ok: true, session: createSession_(user.email), user: user };
}

/** Refresh a session that is still valid — returns a new token with a fresh expiry. */
function actionRefreshSession_(req) {
  var email = readSession_(req.session);
  var user = findPerson_(email);
  return { ok: true, session: createSession_(user.email), user: user };
}

function actionMe_(req) {
  var email = readSession_(req.session);
  return { ok: true, user: findPerson_(email) };
}

function actionPortal_(req) {
  var email = readSession_(req.session);
  var user = findPerson_(email);
  var portal = buildPortal_(user);
  return { ok: true, user: user, systems: withActivity_(portal.systems, user), generatedAt: portal.generatedAt };
}

/** Adds "last edited" (and, for non-doers, who edited) to every Google Sheet link. */
function withActivity_(systems, user) {
  var act = loadActivity_();
  if (!act || !act.files) return systems;
  var byId = {};
  act.files.forEach(function (f) { byId[f.id] = f; });
  var showWho = user.role !== 'Doer';
  return systems.map(function (s) {
    var copy = JSON.parse(JSON.stringify(s));
    copy.links.forEach(function (l) {
      var m = String(l.url || '').match(/spreadsheets\/d\/([\w-]{20,})/);
      var f = m && byId[m[1]];
      if (f) { l.edited = f.t; if (showWho) l.editedBy = f.by; }
    });
    return copy;
  });
}

function apiError_(code) {
  var err = new Error(code);
  err.apiCode = code;
  return err;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
