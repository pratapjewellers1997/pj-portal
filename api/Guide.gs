/**
 * PJ Portal API — "Portal Guide" tab in the Registry.
 *
 * One place that answers: where is everything stored, what are the free
 * limits, what to check each month, and how to delete everything from scratch.
 *
 * The tab is written by code, so it can never be lost: if it is deleted or
 * changed, run setupPortalGuide() from the editor and it is written again.
 * No timer runs this.
 */

var GUIDE_TAB = 'Portal Guide';

/** Run from the editor: (re)writes the Portal Guide tab now. */
function setupPortalGuide() {
  var url = writePortalGuide_();
  console.log('Portal Guide written: ' + url);
}

function writePortalGuide_() {
  var ss = SpreadsheetApp.openById(cfg_('REGISTRY_ID'));
  var sh = ss.getSheetByName(GUIDE_TAB) || ss.insertSheet(GUIDE_TAB);
  var props = PropertiesService.getScriptProperties();
  var fb = 'https://console.firebase.google.com/project/' + FIREBASE_PROJECT;
  var regUrl = ss.getUrl();
  var archiveId = props.getProperty(CHAT_ARCHIVE_PROP);
  var archiveUrl = archiveId ? 'https://docs.google.com/spreadsheets/d/' + archiveId + '/edit' : 'Not created yet (run setupChat)';
  var folderUrl = 'https://drive.google.com/drive/folders/' + chatFolderId_();
  var scriptUrl = 'https://script.google.com/home/projects/' + ScriptApp.getScriptId() + '/edit';
  var apiUrl = '';
  try { apiUrl = ScriptApp.getService().getUrl() || ''; } catch (e) {}
  var clientId = props.getProperty('OAUTH_CLIENT_ID') || '';
  var clientProject = clientId.split('-')[0] || '(see OAUTH_CLIENT_ID)';
  var repo = 'https://github.com/pratapjewellers1997/pj-portal';
  var site = 'https://pratapjewellers1997.github.io/pj-portal/';
  var now = Utilities.formatDate(new Date(), TZ, 'dd-MMM-yyyy HH:mm');

  var H = function (t, b, c) { return { head: true, row: [t, b || '', c || ''] }; };
  var R = function (a, b, c) { return { row: [a, b || '', c || ''] }; };
  var GAP = { row: ['', '', ''] };

  var list = [
    { title: true, row: ['PJ PORTAL: GUIDE', 'Last updated ' + now + ' IST', 'Written by the portal API (Guide.gs). If this tab is deleted or needs refreshing: Apps Script → run setupPortalGuide. Do not edit by hand.'] },
    GAP,

    H('1. WHERE EVERYTHING IS STORED', 'Link', 'What it is · who can open it'),
    R('Portal website', site, 'What staff open. Hosted free on GitHub Pages. Holds no data: everything comes from the API after sign-in.'),
    R('Portal code (website + API copy)', repo, 'GitHub, public. Never put passwords, keys or IDs of private files here. Only you have write access.'),
    R('Portal API (Apps Script, mis@)', scriptUrl, 'The only thing that reads your sheets. Runs as mis@. Settings → Script Properties hold REGISTRY_ID, OAUTH_CLIENT_ID, SESSION_SECRET (never share).'),
    R('API web address', apiUrl || '(see Deploy → Manage deployments)', 'Set in GitHub as VITE_API_URL. Changes only if you make a NEW deployment instead of a new version.'),
    R('Registry (this spreadsheet)', regUrl, 'People, Feed, links and the Portal tabs listed below.'),
    R('Chat messages (live)', fb + '/firestore/databases/-default-/data/~2Fchats', 'Firebase Firestore, project ' + FIREBASE_PROJECT + '. Text only; only the two people of a chat can read it.'),
    R('Who may chat (staff copy)', fb + '/firestore/databases/-default-/data/~2Fstaff', 'Copied from People (Active = Yes) every 10 minutes. Not edited by hand.'),
    R('Chat audit setting', fb + '/firestore/databases/-default-/data/~2Fsettings', 'Switched only by Admin on the portal page Chat records.'),
    R('Chat photos, videos, PDFs', folderUrl, 'Drive of mis@. One sub-folder per chat. Restricted: never share by link.'),
    R('Chat archive (daily copy)', archiveUrl, 'Spreadsheet in the same folder. Tabs: Messages, Deletion log, Guide (chat-only guide).'),
    R('Google sign-in client', 'Google Cloud project number ' + clientProject + ' → APIs & Services → Credentials', 'The OAuth client used for "Sign in with Google". Its ID is the Script Property OAUTH_CLIENT_ID.'),
    R('Firebase / Google Cloud project', fb + '/overview', 'Project ' + FIREBASE_PROJECT + ' (Spark, free). Firestore, Firebase sign-in for chat, phone notifications.'),
    R('Firebase web key (public, locked)', 'https://console.cloud.google.com/apis/credentials?project=' + FIREBASE_PROJECT, 'Browser key: works only from the portal website and only for 6 APIs. Safe to be public.'),
    R('Short-term copies (cache)', 'Inside Apps Script', 'Work snapshot every 10 minutes, People 5 minutes. Run clearPortalCache() to refresh at once.'),
    GAP,

    H('2. PORTAL TABS IN THIS REGISTRY', 'What it holds', 'Safe to edit?'),
    R('Portal Sources', 'Which FMS / Checklist / Delegation / Attendance / Karigar / GP sheets the portal reads.', 'Yes: add or change rows. Keep the headers.'),
    R('Portal Names', 'Matches names used inside sheets (e.g. MEGHA MADAM) to People.', 'Yes.'),
    R('Portal Notices', 'Notices posted on the portal.', 'Yes (posted from the portal).'),
    R('Portal Reads', 'Who has read which notice.', 'No: written by the portal.'),
    R('Portal Kudos', 'Appreciation given on the portal.', 'No: written by the portal.'),
    R('Portal Checklist Items', 'Leaving / Joining checklist steps.', 'Yes: edit, add or reorder steps.'),
    R('Portal Checklist Log', 'Every tick on a checklist (who, when).', 'No: written by the portal.'),
    R('Portal Devices', 'Phones / computers that get notifications.', 'Only to remove a lost phone (delete its row).'),
    R('Portal Guide', 'This guide.', 'No: written by code (setupPortalGuide).'),
    R('Never touched by the portal', 'System Master, salary, loans, KL_ ledgers, Kaarigar_Payments, customer mobile numbers, GP customer names / rates / costs.', 'The portal never reads or edits these.'),
    GAP,

    H('3. TIMERS (Apps Script → ⏰ Triggers)', 'When', 'What it does'),
    R('refreshWorkCache', 'Every 10 minutes (quiet 00:00–07:00 IST)', 'Builds the work snapshot and copies the staff list to Firestore.'),
    R('archiveChats', 'Every day at 23:00 IST', 'Copies new chat messages to the archive.'),
    GAP,

    H('4. FREE LIMITS (nothing here is ever billed)', 'Limit', 'Note'),
    R('Firestore: stored data', '1 GiB', 'Millions of text messages. Photos are not here (they are in Drive).'),
    R('Firestore: reads', '50,000 per day', 'Opening chats and the inbox. Resets daily at about 1:30 pm IST.'),
    R('Firestore: writes', '20,000 per day', 'Sending messages, "Seen", staff list changes.'),
    R('Firestore: deletes', '20,000 per day', 'The chat delete tool. Very big clean-ups may need 2 days.'),
    R('Firestore: downloaded', '10 GiB per month', ''),
    R('Phone notifications (FCM)', 'Free, no limit', ''),
    R('Sign-in (Google + Firebase)', 'Free for a team this size', ''),
    R('Apps Script (mis@ Workspace)', '100,000 web requests/day · 6 min per run · 6 h of timers per day · about 30 runs at once', 'The portal uses a small part of this.'),
    R('Google Sheets', '10 million cells per spreadsheet', 'Chat archive: about 800,000 messages before a new archive is needed.'),
    R('Drive (photos, videos, PDFs)', 'mis@ Workspace storage', 'Per file: photo 10 MB (shrunk to about 0.2 MB), video 25 MB, PDF 10 MB.'),
    R('GitHub Pages (website)', '1 GB site · about 100 GB traffic per month', 'The portal is under 2 MB.'),
    R('If a limit is reached', 'That service pauses until the next reset', 'Nothing is lost and nothing is billed. Firebase is on Spark: never click Upgrade and never add a card.'),
    GAP,

    H('5. MONTHLY CHECK (5 minutes)', 'Link', 'Look for'),
    R('Firestore usage', fb + '/firestore/databases/-default-/usage', 'Reads and writes well below the limits above.'),
    R('API errors', 'https://script.google.com/home/projects/' + ScriptApp.getScriptId() + '/executions', 'Many red "Failed" rows in a row → tell MIS.'),
    R('Chat records page', site + '#chatadmin', 'Archive "last run" is today or yesterday.'),
    R('Drive storage', 'https://drive.google.com/settings/storage', 'Enough space left on mis@.'),
    R('Who has access', 'Firebase → Users and permissions; Registry / Archive / Chat folder → Share', 'Only mis@ and rohantodkar@. Archive and folder: Restricted.'),
    GAP,

    H('6. NEVER DO', '', ''),
    R('Upgrade Firebase to Blaze or add a card', '', 'Spark can never charge. Blaze can.'),
    R('Share the Chat folder, archive or Registry "Anyone with the link"', '', 'Staff open chat files through the portal, which checks who they are.'),
    R('Put passwords, keys or Script Properties in GitHub', '', 'The repository is public.'),
    R('Make a NEW deployment of the API', '', 'Always Manage deployments → ✏️ → New version, so the web address stays the same.'),
    R('Rename Portal tabs or their header row', '', 'The portal finds them by name.'),
    GAP,

    H('7. DELETE EVERYTHING FROM SCRATCH', 'Where', 'How (do the steps in this order)'),
    R('Step 1: Keep a copy', 'Chat archive · this Registry · GitHub', 'Archive: File → Download → Microsoft Excel. Registry Portal tabs: same. GitHub: Code → Download ZIP. Keep these offline.'),
    R('Step 2: Tell staff', '', 'The portal, chat and notifications stop working from step 3.'),
    R('Step 3: Stop the API', scriptUrl, 'Left menu ⏰ Triggers → delete refreshWorkCache and archiveChats. Deploy → Manage deployments → Archive. Then in Drive, move the "PJ Portal API" project to the Bin.'),
    R('Step 4: Delete Firebase', fb + '/settings/general', 'Scroll to the bottom → Delete project → tick the boxes → Delete. Removes all chats, the staff copy, chat sign-in, notifications and Google Cloud project ' + FIREBASE_PROJECT + '. Google keeps it 30 days in case you change your mind (Cloud console → IAM & Admin → Manage resources → Pending deletion).'),
    R('Step 5: Sign-in client', 'Google Cloud project number ' + clientProject + ' → APIs & Services → Credentials', 'Delete the OAuth client whose ID matches OAUTH_CLIENT_ID. Check first that no other system uses the same client.'),
    R('Step 6: Drive files', folderUrl, 'Move the chat folder (photos, videos, PDFs and the archive inside it) to the Bin. Then Bin → Empty bin. This is permanent.'),
    R('Step 7: Registry tabs', regUrl, 'Delete only: Portal Sources, Portal Names, Portal Notices, Portal Reads, Portal Kudos, Portal Checklist Items, Portal Checklist Log, Portal Devices, Portal Guide. Do not touch People, Feed or any other tab.'),
    R('Step 8: GitHub', repo + '/settings', 'Settings → General → bottom "Danger Zone" → Delete this repository (the website disappears within minutes). Also github.com/settings/installations → Claude → Uninstall.'),
    R('Step 9: Account permissions', 'https://myaccount.google.com/permissions', 'Signed in as mis@: remove "PJ Portal API" if listed. Workspace Admin (admin.google.com → Security → API controls → App access control): remove PJ Portal if listed.'),
    R('Step 10: Staff phones', '', 'Nothing needed: notifications stop after step 4. Staff can remove the Home Screen icon by long-pressing it.'),
    R('Step 11: Final check', site, 'Portal address shows "404". Firebase console no longer lists ' + FIREBASE_PROJECT + '. Drive Bin is empty.'),
    GAP,
    R('Only want to remove chat?', archiveUrl, 'Use the Guide tab in the chat archive and the portal page Chat records (delete by person, chat or date range). The rest of the portal keeps working.')
  ];

  var rows = list.map(function (x) { return x.row; });
  sh.clear();
  sh.getRange(1, 1, rows.length, 3).setValues(rows);
  sh.getRange(1, 1, rows.length, 3).setWrap(true).setVerticalAlignment('top').setFontWeight('normal').setBackground(null);
  sh.getRange(1, 1).setFontSize(14).setFontWeight('bold');
  list.forEach(function (x, i) {
    if (x.head) sh.getRange(i + 1, 1, 1, 3).setFontWeight('bold').setBackground('#F4EBD2');
  });
  sh.setColumnWidth(1, 300); sh.setColumnWidth(2, 380); sh.setColumnWidth(3, 560);
  sh.setFrozenRows(1);
  return regUrl + '#gid=' + sh.getSheetId();
}
