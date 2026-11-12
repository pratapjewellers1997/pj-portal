/**
 * PJ Portal API — identity.
 *
 * 1. verifyGoogleIdToken_: asks Google whether the ID token from
 *    "Sign in with Google" is genuine, issued for OUR app, not expired,
 *    and has a verified email. Works for company and personal Gmail accounts.
 * 2. Portal session: after a good Google check we hand back our own signed
 *    token (valid SESSION_DAYS) so staff do not sign in every hour.
 *    Format: base64url(payload JSON) + "." + base64url(HMAC-SHA256)
 */

var GOOGLE_ISSUERS = ['accounts.google.com', 'https://accounts.google.com'];

function verifyGoogleIdToken_(idToken) {
  if (!idToken || typeof idToken !== 'string') throw apiError_('bad_token');

  var res = UrlFetchApp.fetch(
    'https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(idToken),
    { muteHttpExceptions: true }
  );
  if (res.getResponseCode() !== 200) throw apiError_('bad_token');

  var claims = JSON.parse(res.getContentText());
  var clientId = cfg_('OAUTH_CLIENT_ID');

  if (claims.aud !== clientId) throw apiError_('bad_token');
  if (GOOGLE_ISSUERS.indexOf(claims.iss) === -1) throw apiError_('bad_token');
  if (Number(claims.exp) * 1000 < Date.now()) throw apiError_('token_expired');
  if (String(claims.email_verified) !== 'true') throw apiError_('email_not_verified');

  return {
    email: normaliseEmail_(claims.email),
    googleName: claims.name || '',
    picture: claims.picture || ''
  };
}

function createSession_(email) {
  var payload = {
    e: email,
    x: Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000
  };
  var body = b64url_(Utilities.newBlob(JSON.stringify(payload)).getBytes());
  return body + '.' + sign_(body);
}

/** Returns the email inside a valid session, or throws. */
function readSession_(token) {
  if (!token || typeof token !== 'string' || token.indexOf('.') === -1) {
    throw apiError_('no_session');
  }
  var parts = token.split('.');
  if (parts.length !== 2 || sign_(parts[0]) !== parts[1]) throw apiError_('no_session');

  var payload;
  try {
    payload = JSON.parse(
      Utilities.newBlob(Utilities.base64DecodeWebSafe(parts[0])).getDataAsString()
    );
  } catch (err) {
    throw apiError_('no_session');
  }
  if (!payload.e || !payload.x || payload.x < Date.now()) throw apiError_('session_expired');
  return payload.e;
}

function sign_(text) {
  var bytes = Utilities.computeHmacSha256Signature(text, cfg_('SESSION_SECRET'));
  return b64url_(bytes);
}

function b64url_(bytes) {
  return Utilities.base64EncodeWebSafe(bytes).replace(/=+$/, '');
}

function normaliseEmail_(email) {
  return String(email || '').trim().toLowerCase();
}
