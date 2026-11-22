/**
 * PJ Portal — Script Properties Cleanup Utility
 *
 * Safe, auditable cleanup of Script Properties with:
 *   - Dry-run mode (default) — shows what WOULD be deleted, changes nothing
 *   - Protected-key list — config and active data are never touched
 *   - Backup before deletion — full snapshot saved to Drive
 *   - Approval-gated — requires explicit switch to actually delete
 *   - Detailed logging — every action is logged to console
 *
 * HOW TO USE:
 *   1. Run  auditProperties()       — read-only inventory, no changes
 *   2. Run  cleanupDryRun()         — shows what WOULD be cleaned, no changes
 *   3. Run  backupProperties()      — saves full backup to Drive before any deletion
 *   4. Run  cleanupExecute()        — actually deletes orphaned keys (requires backup first)
 *   5. Run  restoreFromBackup(id)   — restores from a backup file if something went wrong
 *
 * NEVER deletes: config keys, active snapshot chunks, active vendor history,
 * active activity data, chat metadata, or any key on the PROTECTED list.
 */

/* ======================== PROTECTED KEYS ======================== */

/**
 * Keys that must NEVER be deleted. Grouped by purpose.
 * Add any new config keys here when they are created.
 */
var PROTECTED_PREFIXES = [
  'REGISTRY_ID',         // Config
  'OAUTH_CLIENT_ID',     // Config
  'SESSION_SECRET',      // Config — NEVER expose this value
  'fs_staff_hash',       // Chat staff sync
  'chat_folder_id',      // Chat file storage
  'chat_archive_id',     // Chat archive sheet ID
  'chat_archive_upto',   // Chat archive progress
  'chat_archive_last_run', // Chat archive timestamp
  'chat_audit',          // Chat audit settings (JSON)
];

/** Prefixes for chunked data series that are actively managed by the code. */
var MANAGED_PREFIXES = [
  'snap_v2_p',           // Snapshot property chunks (snap_v2_p0, snap_v2_p1, ..., snap_v2_pn)
  'vend_hist_v1_np',     // Vendor history property chunks
  'activity_v1_p',       // Activity property chunks
  'chatdir_',            // Chat subfolder mappings (one per chat pair)
];

/* ======================== INVENTORY ======================== */

/**
 * Run this from the Apps Script editor to see a complete inventory.
 * READ-ONLY — changes nothing.
 */
function auditProperties() {
  var props = PropertiesService.getScriptProperties();
  var all = props.getProperties();
  var keys = Object.keys(all).sort();

  console.log('═══════════════════════════════════════════');
  console.log('  SCRIPT PROPERTIES AUDIT');
  console.log('  Total keys: ' + keys.length);
  console.log('  Total size: ' + estimateSize_(all) + ' bytes (limit: 500,000)');
  console.log('  Usage: ' + Math.round(estimateSize_(all) / 500000 * 100) + '%');
  console.log('═══════════════════════════════════════════');

  var groups = classifyKeys_(keys);

  console.log('\n── CONFIG (3 expected) ──');
  groups.config.forEach(function(k) {
    console.log('  ✓ ' + k + ' = ' + (isSensitive_(k) ? '***REDACTED***' : truncate_(all[k], 60)));
  });

  console.log('\n── SNAPSHOT CHUNKS (' + groups.snapshot.length + ' keys) ──');
  logChunkGroup_(groups.snapshot, all);

  console.log('\n── VENDOR HISTORY CHUNKS (' + groups.vendor.length + ' keys) ──');
  logChunkGroup_(groups.vendor, all);

  console.log('\n── ACTIVITY CHUNKS (' + groups.activity.length + ' keys) ──');
  logChunkGroup_(groups.activity, all);

  console.log('\n── CHAT METADATA (' + groups.chat.length + ' keys) ──');
  groups.chat.forEach(function(k) {
    console.log('  ✓ ' + k + ' = ' + truncate_(all[k], 60));
  });

  if (groups.orphan.length > 0) {
    console.log('\n── ORPHANED / UNKNOWN (' + groups.orphan.length + ' keys) ──');
    groups.orphan.forEach(function(k) {
      console.log('  ⚠ ' + k + ' = ' + truncate_(all[k], 60) + ' (' + all[k].length + ' bytes)');
    });
  } else {
    console.log('\n── No orphaned keys found ──');
  }

  console.log('\n── SIZE BREAKDOWN ──');
  var configSize = sumSize_(groups.config, all);
  var snapSize = sumSize_(groups.snapshot, all);
  var vendorSize = sumSize_(groups.vendor, all);
  var activitySize = sumSize_(groups.activity, all);
  var chatSize = sumSize_(groups.chat, all);
  var orphanSize = sumSize_(groups.orphan, all);
  console.log('  Config:         ' + configSize + ' bytes');
  console.log('  Snapshot:       ' + snapSize + ' bytes');
  console.log('  Vendor history: ' + vendorSize + ' bytes');
  console.log('  Activity:       ' + activitySize + ' bytes');
  console.log('  Chat metadata:  ' + chatSize + ' bytes');
  console.log('  Orphaned:       ' + orphanSize + ' bytes');

  return {
    totalKeys: keys.length,
    totalSize: estimateSize_(all),
    groups: {
      config: groups.config.length,
      snapshot: groups.snapshot.length,
      vendor: groups.vendor.length,
      activity: groups.activity.length,
      chat: groups.chat.length,
      orphan: groups.orphan.length
    },
    orphanedKeys: groups.orphan,
    usagePercent: Math.round(estimateSize_(all) / 500000 * 100)
  };
}

/* ======================== DRY RUN ======================== */

/**
 * Shows what cleanup WOULD do — changes nothing.
 * Run this first to review before executing.
 */
function cleanupDryRun() {
  console.log('═══════════════════════════════════════════');
  console.log('  CLEANUP DRY RUN — NO CHANGES WILL BE MADE');
  console.log('═══════════════════════════════════════════');

  var props = PropertiesService.getScriptProperties();
  var all = props.getProperties();
  var keys = Object.keys(all).sort();
  var groups = classifyKeys_(keys);

  // Find stale snapshot chunks (beyond the current count)
  var staleSnap = findStaleChunks_('snap_v2_p', all);
  var staleVendor = findStaleChunks_('vend_hist_v1_np', all);
  var staleActivity = findStaleChunks_('activity_v1_p', all);

  // Legacy keys
  var legacy = keys.filter(function(k) { return k === 'activity_v1'; });

  var toDelete = [].concat(groups.orphan, staleSnap, staleVendor, staleActivity, legacy);
  // De-duplicate
  toDelete = toDelete.filter(function(k, i) { return toDelete.indexOf(k) === i; });
  // Safety: never delete protected keys
  toDelete = toDelete.filter(function(k) { return !isProtected_(k); });

  if (toDelete.length === 0) {
    console.log('\n✓ Nothing to clean up. All keys are active and accounted for.');
    return { action: 'none', keysToDelete: [] };
  }

  var reclaimable = sumSize_(toDelete, all);
  console.log('\nKeys that WOULD be deleted (' + toDelete.length + ' keys, ' + reclaimable + ' bytes):');
  toDelete.forEach(function(k) {
    var reason = groups.orphan.indexOf(k) > -1 ? 'orphaned/unknown' :
                 staleSnap.indexOf(k) > -1 ? 'stale snapshot chunk' :
                 staleVendor.indexOf(k) > -1 ? 'stale vendor chunk' :
                 staleActivity.indexOf(k) > -1 ? 'stale activity chunk' :
                 legacy.indexOf(k) > -1 ? 'legacy key' : 'unknown reason';
    console.log('  ✗ ' + k + ' — ' + reason + ' (' + all[k].length + ' bytes)');
  });

  console.log('\nTo execute this cleanup:');
  console.log('  1. Run  backupProperties()  first');
  console.log('  2. Then run  cleanupExecute()');

  return { action: 'dry_run', keysToDelete: toDelete, reclaimableBytes: reclaimable };
}

/* ======================== BACKUP ======================== */

/**
 * Saves a full backup of all Script Properties to Google Drive.
 * The backup file is a JSON file in the script owner's Drive root.
 * Returns the file ID for use with restoreFromBackup().
 */
function backupProperties() {
  var props = PropertiesService.getScriptProperties();
  var all = props.getProperties();

  // Redact sensitive values in the backup
  var safe = {};
  Object.keys(all).forEach(function(k) {
    safe[k] = isSensitive_(k) ? '***REDACTED_IN_BACKUP***' : all[k];
  });

  var backup = {
    timestamp: new Date().toISOString(),
    totalKeys: Object.keys(all).length,
    totalSize: estimateSize_(all),
    properties: safe
  };

  var filename = 'pj_portal_props_backup_' +
    Utilities.formatDate(new Date(), 'Asia/Kolkata', 'yyyy-MM-dd_HH-mm') + '.json';
  var file = DriveApp.createFile(filename, JSON.stringify(backup, null, 2), 'application/json');

  // Mark that a backup exists (stored in Cache so it doesn't pollute Properties)
  CacheService.getScriptCache().put('props_backup_id', file.getId(), 86400); // 24h

  console.log('✓ Backup saved: ' + filename);
  console.log('  File ID: ' + file.getId());
  console.log('  Keys backed up: ' + Object.keys(all).length);
  console.log('  Note: SESSION_SECRET and OAUTH_CLIENT_ID values are redacted in the backup.');
  console.log('  These config keys are protected and will never be deleted by cleanup.');

  return { fileId: file.getId(), filename: filename, keys: Object.keys(all).length };
}

/* ======================== EXECUTE ======================== */

/**
 * Actually deletes the keys identified by cleanupDryRun().
 * REQUIRES a backup to have been created first (within the last 24 hours).
 * REQUIRES explicit approval — will not run if no backup exists.
 */
function cleanupExecute() {
  // Safety: check for recent backup
  var backupId = CacheService.getScriptCache().get('props_backup_id');
  if (!backupId) {
    console.log('✗ SAFETY STOP: No recent backup found.');
    console.log('  Run  backupProperties()  first, then try again within 24 hours.');
    return { action: 'blocked', reason: 'no_backup' };
  }

  // Verify backup file exists
  try {
    var backupFile = DriveApp.getFileById(backupId);
    console.log('✓ Backup verified: ' + backupFile.getName());
  } catch (e) {
    console.log('✗ SAFETY STOP: Backup file not found (ID: ' + backupId + '). Run backupProperties() again.');
    return { action: 'blocked', reason: 'backup_missing' };
  }

  var props = PropertiesService.getScriptProperties();
  var all = props.getProperties();
  var keys = Object.keys(all).sort();
  var groups = classifyKeys_(keys);

  var staleSnap = findStaleChunks_('snap_v2_p', all);
  var staleVendor = findStaleChunks_('vend_hist_v1_np', all);
  var staleActivity = findStaleChunks_('activity_v1_p', all);
  var legacy = keys.filter(function(k) { return k === 'activity_v1'; });

  var toDelete = [].concat(groups.orphan, staleSnap, staleVendor, staleActivity, legacy);
  toDelete = toDelete.filter(function(k, i) { return toDelete.indexOf(k) === i; });
  toDelete = toDelete.filter(function(k) { return !isProtected_(k); });

  if (toDelete.length === 0) {
    console.log('✓ Nothing to clean up.');
    return { action: 'none', deleted: 0 };
  }

  // Safety check: never delete during an active build
  var cache = CacheService.getScriptCache();
  if (cache.get('building_snapshot') || cache.get('building_vend_hist_v1')) {
    console.log('✗ SAFETY STOP: A snapshot or vendor build is in progress. Try again in a few minutes.');
    return { action: 'blocked', reason: 'build_in_progress' };
  }

  console.log('═══════════════════════════════════════════');
  console.log('  CLEANUP EXECUTING — DELETING ' + toDelete.length + ' KEYS');
  console.log('═══════════════════════════════════════════');

  var deleted = 0;
  var errors = [];
  toDelete.forEach(function(k) {
    try {
      props.deleteProperty(k);
      console.log('  ✓ Deleted: ' + k);
      deleted++;
    } catch (e) {
      console.log('  ✗ Failed: ' + k + ' — ' + e.message);
      errors.push(k);
    }
  });

  console.log('\n── RESULT ──');
  console.log('  Deleted: ' + deleted + ' keys');
  if (errors.length) console.log('  Errors: ' + errors.length + ' keys');
  console.log('  Backup file: ' + backupFile.getName() + ' (ID: ' + backupId + ')');

  return { action: 'executed', deleted: deleted, errors: errors };
}

/* ======================== RESTORE ======================== */

/**
 * Restores properties from a backup file. Pass the file ID from backupProperties().
 * Only restores keys that are MISSING — does not overwrite existing keys.
 * Skips redacted values (config keys that were not backed up).
 *
 * @param {string} fileId  The Drive file ID of the backup JSON.
 */
function restoreFromBackup(fileId) {
  if (!fileId) {
    // Try the most recent backup
    fileId = CacheService.getScriptCache().get('props_backup_id');
    if (!fileId) {
      console.log('✗ No file ID provided and no recent backup found.');
      console.log('  Usage: restoreFromBackup("your-backup-file-id")');
      return;
    }
  }

  var file = DriveApp.getFileById(fileId);
  var backup = JSON.parse(file.getBlob().getDataAsString());

  console.log('Restoring from: ' + file.getName());
  console.log('Backup date: ' + backup.timestamp);
  console.log('Backup keys: ' + backup.totalKeys);

  var props = PropertiesService.getScriptProperties();
  var current = props.getProperties();
  var restored = 0, skipped = 0, redacted = 0;

  Object.keys(backup.properties).forEach(function(k) {
    var v = backup.properties[k];
    if (v === '***REDACTED_IN_BACKUP***') { redacted++; return; }
    if (current[k] !== undefined) { skipped++; return; }
    props.setProperty(k, v);
    console.log('  ✓ Restored: ' + k);
    restored++;
  });

  console.log('\n── RESULT ──');
  console.log('  Restored: ' + restored + ' keys');
  console.log('  Skipped (already exist): ' + skipped + ' keys');
  console.log('  Skipped (redacted): ' + redacted + ' keys');
}

/* ======================== HELPERS ======================== */

function classifyKeys_(keys) {
  var groups = { config: [], snapshot: [], vendor: [], activity: [], chat: [], orphan: [] };

  keys.forEach(function(k) {
    if (PROTECTED_PREFIXES.indexOf(k) > -1) {
      if (k === 'REGISTRY_ID' || k === 'OAUTH_CLIENT_ID' || k === 'SESSION_SECRET') {
        groups.config.push(k);
      } else {
        groups.chat.push(k);
      }
    } else if (k.indexOf('snap_v2_p') === 0) {
      groups.snapshot.push(k);
    } else if (k.indexOf('vend_hist_v1_np') === 0) {
      groups.vendor.push(k);
    } else if (k.indexOf('activity_v1_p') === 0) {
      groups.activity.push(k);
    } else if (k.indexOf('chatdir_') === 0) {
      groups.chat.push(k);
    } else if (k === 'activity_v1') {
      // Legacy single-value activity key — safe to remove
      groups.orphan.push(k);
    } else {
      groups.orphan.push(k);
    }
  });

  return groups;
}

function findStaleChunks_(prefix, all) {
  var countKey = prefix + 'n';
  var count = parseInt(all[countKey] || '0', 10);
  var stale = [];

  Object.keys(all).forEach(function(k) {
    if (k.indexOf(prefix) !== 0 || k === countKey) return;
    var num = parseInt(k.replace(prefix, ''), 10);
    if (isNaN(num)) return;
    if (num >= count) stale.push(k); // Beyond current chunk count = leftover
  });

  return stale;
}

function isProtected_(key) {
  if (PROTECTED_PREFIXES.indexOf(key) > -1) return true;
  for (var i = 0; i < MANAGED_PREFIXES.length; i++) {
    if (key.indexOf(MANAGED_PREFIXES[i]) === 0) return true;
  }
  return false;
}

function isSensitive_(key) {
  return key === 'SESSION_SECRET' || key === 'OAUTH_CLIENT_ID';
}

function estimateSize_(all) {
  var total = 0;
  Object.keys(all).forEach(function(k) { total += k.length + all[k].length; });
  return total;
}

function sumSize_(keys, all) {
  var total = 0;
  keys.forEach(function(k) { if (all[k]) total += k.length + all[k].length; });
  return total;
}

function logChunkGroup_(keys, all) {
  if (!keys.length) { console.log('  (none)'); return; }
  var size = sumSize_(keys, all);
  console.log('  ' + keys.length + ' keys, ' + size + ' bytes total');
  console.log('  Keys: ' + keys.join(', '));
}

function truncate_(s, max) {
  return s.length <= max ? s : s.slice(0, max) + '…';
}
