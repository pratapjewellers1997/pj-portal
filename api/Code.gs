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
 *   social / postNotice / readNotice / removeNotice / giveKudos / removeKudos     (Step 8, Social.gs)
 */

function doGet() {
  return json_({ ok: true, service: 'PJ Portal API', version: API_VERSION });
}

function doPost(e) {
  try {
    var req = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    switch (req.action) {
      case 'login': return json_(actionLogin_(req));
      case 'me':    return json_(actionMe_(req));
      case 'portal': return json_(actionPortal_(req));
      case 'work':   return json_(actionWork_(req));
      case 'lookup': return json_(actionLookup_(req));
      case 'insights': return json_(actionInsights_(req));
      case 'karigar':  return json_(actionKarigar_(req));
      case 'vendors':  return json_(actionVendors_(req));
      case 'checklists':    return json_(actionChecklists_(req));
      case 'tickChecklist': return json_(actionTickChecklist_(req));
      case 'social':       return json_(actionSocial_(req));
      case 'postNotice':   return json_(actionPostNotice_(req));
      case 'readNotice':   return json_(actionReadNotice_(req));
      case 'removeNotice': return json_(actionRemoveNotice_(req));
      case 'giveKudos':    return json_(actionGiveKudos_(req));
      case 'removeKudos':  return json_(actionRemoveKudos_(req));
      default:      throw apiError_('unknown_action');
    }
  } catch (err) {
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
