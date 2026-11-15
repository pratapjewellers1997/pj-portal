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

var API_VERSION = '0.10.0';
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
