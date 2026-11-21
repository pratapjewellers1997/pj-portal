/* ───────────────────────────────────────────────────────────
   Messages  –  one-to-one staff messaging (via Google Sheet)
   Tab  : "Portal Messages"  in Registry
   ───────────────────────────────────────────────────────────*/

var MSG_TAB      = 'Portal Messages';
var MSG_HEADERS  = ['ID','Sent at','From','From name','To','To name','Text','Read at'];
var MSG_MAX_LEN  = 1000;      // hard cap on message text
var MSG_DAILY    = 150;       // max messages per person / day
var MSG_THREAD_MAX = 200;     // messages returned per thread

/* ---- cache helpers ---- */
function loadMessages_() {
  var cache = CacheService.getScriptCache();
  var key   = 'msg_v1';
  // try chunked read first
  var chunk0 = cache.get(key + '_0');
  if (chunk0 !== null) {
    var parts = [chunk0];
    for (var i = 1; ; i++) {
      var c = cache.get(key + '_' + i);
      if (c === null) break;
      parts.push(c);
    }
    return JSON.parse(parts.join(''));
  }
  // read from sheet
  var ss   = SpreadsheetApp.openById(REGISTRY_ID);
  var tab  = ss.getSheetByName(MSG_TAB);
  if (!tab) return [];
  var data = tab.getDataRange().getValues();
  if (data.length < 2) return [];
  var hdr = data[0].map(function(h){ return String(h).trim(); });
  var rows = [];
  for (var r = 1; r < data.length; r++) {
    var obj = {};
    for (var c = 0; c < hdr.length; c++) obj[hdr[c]] = data[r][c];
    rows.push(obj);
  }
  // cache 60 s, chunked
  var json  = JSON.stringify(rows);
  var CHUNK = 90000;
  var nChunks = Math.ceil(json.length / CHUNK);
  var bag = {};
  for (var i = 0; i < nChunks; i++) {
    bag[key + '_' + i] = json.substr(i * CHUNK, CHUNK);
  }
  cache.putAll(bag, 60);
  return rows;
}

function clearMessageCache_() {
  var cache = CacheService.getScriptCache();
  var key   = 'msg_v1';
  var keys  = [];
  for (var i = 0; i < 20; i++) keys.push(key + '_' + i);
  cache.removeAll(keys);
}

/* ---- messageable contacts ---- */
function messageable_(people, myEmail) {
  return people.filter(function(p) {
    return p.email !== myEmail && p.active;
  }).map(function(p) {
    return { email: p.email, name: p.name, role: p.role };
  });
}

/* ---- actions ---- */
function actionInbox_(req) {
  var me   = readSession_(req).email;
  var msgs = loadMessages_();
  var people = loadPeople_();

  // build conversations
  var convos = {};
  msgs.forEach(function(m) {
    if (m.From !== me && m.To !== me) return;
    var other = m.From === me ? m.To : m.From;
    if (!convos[other]) convos[other] = { with: other, withName: '', msgs: [], unread: 0 };
    convos[other].msgs.push(m);
    if (m.To === me && !m['Read at']) convos[other].unread++;
  });
  // set names, sort by latest
  var list = Object.keys(convos).map(function(k) {
    var c = convos[k];
    var last = c.msgs[c.msgs.length - 1];
    c.withName = c.msgs[0].From === me ? c.msgs[0]['To name'] : c.msgs[0]['From name'];
    c.latest   = last['Sent at'];
    c.preview  = String(last.Text || '').substring(0, 60);
    delete c.msgs;
    return c;
  });
  list.sort(function(a, b) { return new Date(b.latest) - new Date(a.latest); });

  return { conversations: list, contacts: messageable_(people, me) };
}

function actionUnread_(req) {
  var me   = readSession_(req).email;
  var msgs = loadMessages_();
  var count = 0;
  msgs.forEach(function(m) {
    if (m.To === me && !m['Read at']) count++;
  });
  return { unread: count };
}

function actionThread_(req) {
  var me    = readSession_(req).email;
  var other = String(req.with || '').trim().toLowerCase();
  if (!other) throw apiError_('missing_param');
  var msgs  = loadMessages_();
  var people = loadPeople_();

  var thread = msgs.filter(function(m) {
    return (m.From === me && m.To === other) || (m.From === other && m.To === me);
  });
  thread.sort(function(a, b) { return new Date(a['Sent at']) - new Date(b['Sent at']); });
  if (thread.length > MSG_THREAD_MAX) thread = thread.slice(-MSG_THREAD_MAX);

  // mark incoming as read
  var ss  = SpreadsheetApp.openById(REGISTRY_ID);
  var tab = ss.getSheetByName(MSG_TAB);
  if (tab) {
    var data = tab.getDataRange().getValues();
    var hdr  = data[0].map(function(h){ return String(h).trim(); });
    var idCol   = hdr.indexOf('ID');
    var readCol = hdr.indexOf('Read at');
    var toCol   = hdr.indexOf('To');
    if (idCol >= 0 && readCol >= 0 && toCol >= 0) {
      var now = new Date();
      for (var r = 1; r < data.length; r++) {
        if (data[r][toCol] === me && !data[r][readCol]) {
          var fromCol = hdr.indexOf('From');
          if (fromCol >= 0 && data[r][fromCol] === other) {
            tab.getRange(r + 1, readCol + 1).setValue(now);
          }
        }
      }
    }
    clearMessageCache_();
  }

  var otherPerson = people.find(function(p){ return p.email === other; });
  return {
    messages: thread.map(function(m) {
      return { id: m.ID, from: m.From, fromName: m['From name'], text: m.Text, sent: m['Sent at'], read: m['Read at'] || null };
    }),
    withName: otherPerson ? otherPerson.name : other
  };
}

function actionSendMessage_(req) {
  var me     = readSession_(req).email;
  var people = loadPeople_();
  var mePerson = people.find(function(p){ return p.email === me; });
  if (!mePerson) throw apiError_('not_found');

  var to   = String(req.to || '').trim().toLowerCase();
  var text = String(req.text || '').trim();
  if (!to || !text) throw apiError_('missing_param');
  if (text.length > MSG_MAX_LEN) throw apiError_('too_long');

  var toPerson = people.find(function(p){ return p.email === to && p.active; });
  if (!toPerson) throw apiError_('recipient_invalid');

  // rate limit
  var today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  var msgs  = loadMessages_();
  var todayCount = msgs.filter(function(m) {
    return m.From === me && String(m['Sent at']).indexOf(today) === 0;
  }).length;
  if (todayCount >= MSG_DAILY) throw apiError_('rate_limit');

  // write row
  var ss  = SpreadsheetApp.openById(REGISTRY_ID);
  var tab = ss.getSheetByName(MSG_TAB);
  if (!tab) {
    tab = ss.insertSheet(MSG_TAB);
    tab.appendRow(MSG_HEADERS);
  }
  var id  = Utilities.getUuid();
  var now = new Date();
  tab.appendRow([id, now, me, mePerson.name, to, toPerson.name, safeCell_(text), '']);
  clearMessageCache_();

  // push notification
  try { notifyPush_(to, mePerson.name + ': ' + text.substring(0, 80), 'message'); } catch(e) {}

  return { ok: true, id: id };
}
