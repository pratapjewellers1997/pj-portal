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
  return { ok: true, user: user, systems: portal.systems, generatedAt: portal.generatedAt };
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
