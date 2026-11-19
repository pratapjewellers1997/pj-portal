/**
 * PJ Portal API — configuration.
 *
 * Nothing secret lives in this file (the repo may be public).
 * All IDs and secrets are stored in Script Properties:
 *   Apps Script editor > Project Settings > Script Properties.
 *
 *   REGISTRY_ID       ID of "2. SYSTEM REGISTRY" (v2)
 *   OAUTH_CLIENT_ID   Google OAuth Web client ID (ends .apps.googleusercontent.com)
 *   SESSION_SECRET    Long random text, used to sign portal sessions.
 *                     Run setupSessionSecret() once to create it.
 *
 * Rule: this API only READS the Registry. It never writes to System Master.
 */

var API_VERSION = '0.19.1';
var SESSION_DAYS = 7;
var PEOPLE_TAB = 'People';
var PEOPLE_CACHE_SECONDS = 300; // 5 minutes

function cfg_(key) {
  var value = PropertiesService.getScriptProperties().getProperty(key);
  if (!value) throw new Error('Missing Script Property: ' + key);
  return value;
}

/** Run once from the editor: creates SESSION_SECRET if it is missing. */
function setupSessionSecret() {
  var props = PropertiesService.getScriptProperties();
  if (props.getProperty('SESSION_SECRET')) {
    Logger.log('SESSION_SECRET already exists. Not changed.');
    return;
  }
  var secret = Utilities.getUuid() + Utilities.getUuid() + Utilities.getUuid();
  props.setProperty('SESSION_SECRET', secret.replace(/-/g, ''));
  Logger.log('SESSION_SECRET created.');
}

/** Run from the editor to check the setup before deploying. */
function checkSetup() {
  ['REGISTRY_ID', 'OAUTH_CLIENT_ID', 'SESSION_SECRET'].forEach(function (k) {
    var v = PropertiesService.getScriptProperties().getProperty(k);
    Logger.log(k + ': ' + (v ? 'OK' : 'MISSING'));
  });
  var people = loadPeople_(true);
  Logger.log('People rows read: ' + people.length);
}

/**
 * Run this from the editor after changing the People tab (Active, Role, Name)
 * when you don't want to wait 5 minutes. Clears the portal's short-term copies
 * of People, each person's systems list, notices, checklists and messages.
 * Work data (the 10-minute snapshot) is not touched.
 */
function clearPortalCache() {
  var cache = CacheService.getScriptCache();
  var keys = ['people_v1', 'social_v1', 'cl_v1', 'msg_v1_n'];
  loadPeople_(true).forEach(function (p) {
    p.emails.forEach(function (e) { keys.push('portal_v1_' + e); });
  });
  cache.removeAll(keys);
  console.log('Cleared ' + keys.length + ' cached items. People changes apply immediately.');
  if (typeof syncStaffToFirestore_ === 'function') {
    try { var r = syncStaffToFirestore_(true); console.log('Chat staff list updated: ' + r.active + ' active, ' + r.deactivated + ' turned off.'); }
    catch (e) { console.warn('Chat staff list not updated: ' + e); }
  }
}
