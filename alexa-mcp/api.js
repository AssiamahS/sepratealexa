// HTTP API for the SlyAlarms iPhone app — same alarm client the MCP uses.
// Runs on the Mac (launchd com.sly.alexa-api), phone reaches it over Tailscale.
//   GET  /health                    -> { ok, devices }
//   GET  /devices                   -> [{ name, serial, type, online }]
//   GET  /alarms                    -> [{ id, type, status, time, label, device, recurring }]
//   POST /alarms                    -> { time, date?, device?, label?, type? }
//   POST /alarms/toggle             -> { id, on }
//   POST /alarms/delete             -> { id }
const http = require('http');
const { connect, loadCookie } = require('./client');

const PORT = process.env.ALEXA_API_PORT || 8798;

let alexaPromise = null;
function ensureAlexa() {
  if (!alexaPromise) {
    if (!loadCookie()) return Promise.reject(new Error('no cookie — run node login.js'));
    alexaPromise = connect().catch((err) => {
      alexaPromise = null;
      throw err;
    });
  }
  return alexaPromise;
}

const deviceName = (alexa, serial) =>
  (alexa.serialNumbers && alexa.serialNumbers[serial] && alexa.serialNumbers[serial].accountName) || serial;

const getNotifications = (alexa) =>
  new Promise((resolve, reject) => {
    alexa.getNotifications(false, (err, res) =>
      err ? reject(err) : resolve((res && res.notifications) || []));
  });

const fmt = (alexa, n) => ({
  id: n.id,
  type: n.type,
  status: n.status,
  date: n.originalDate,
  time: String(n.originalTime || '').slice(0, 5),
  label: n.reminderLabel || n.timerLabel || null,
  device: deviceName(alexa, n.deviceSerialNumber),
  recurring: n.recurringPattern || (n.rRuleData ? 'custom' : null),
});

async function findNotification(alexa, id) {
  const all = await getNotifications(alexa);
  const matches = all.filter((n) => n.id === id || (n.id && n.id.includes(id)));
  if (matches.length !== 1) throw new Error(`id "${id}" matched ${matches.length} notifications`);
  return matches[0];
}

function parseWhen(time, date) {
  const m = String(time).trim().toLowerCase()
    .match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/);
  if (!m) throw new Error(`bad time "${time}"`);
  let h = parseInt(m[1], 10);
  const min = parseInt(m[2] || '0', 10);
  if (m[3] === 'pm' && h < 12) h += 12;
  if (m[3] === 'am' && h === 12) h = 0;
  const d = new Date();
  if (date && date !== 'today') {
    if (date === 'tomorrow') d.setDate(d.getDate() + 1);
    else {
      const dm = String(date).match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
      if (!dm) throw new Error(`bad date "${date}"`);
      d.setFullYear(+dm[1], +dm[2] - 1, +dm[3]);
    }
  }
  d.setHours(h, min, 0, 0);
  if (!date && d.getTime() < Date.now()) d.setDate(d.getDate() + 1);
  return d;
}

const readBody = (req) =>
  new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      try { resolve(body ? JSON.parse(body) : {}); } catch (e) { reject(new Error('bad json')); }
    });
    req.on('error', reject);
  });

const routes = {
  'GET /health': async () => {
    try {
      const alexa = await ensureAlexa();
      const devices = Object.values(alexa.serialNumbers || {})
        .filter((d) => d.accountName).map((d) => d.accountName);
      return { ok: true, devices };
    } catch (err) {
      return { ok: false, reason: String(err.message || err) };
    }
  },
  'GET /devices': async () => {
    const alexa = await ensureAlexa();
    return Object.values(alexa.serialNumbers || {})
      .filter((d) => d.accountName)
      .map((d) => ({ name: d.accountName, serial: d.serialNumber, type: d.deviceType, online: d.online }));
  },
  'GET /alarms': async () => {
    const alexa = await ensureAlexa();
    const list = await getNotifications(alexa);
    list.sort((a, b) => `${b.originalDate}${b.originalTime}`.localeCompare(`${a.originalDate}${a.originalTime}`));
    return list.map((n) => fmt(alexa, n));
  },
  'POST /alarms': async (body) => {
    const alexa = await ensureAlexa();
    let target = body.device;
    if (!target) {
      const named = Object.values(alexa.serialNumbers || {}).filter((d) => d.accountName);
      if (named.length !== 1) throw new Error('device required');
      target = named[0].accountName;
    }
    const when = parseWhen(body.time, body.date);
    const noti = alexa.createNotificationObject(target, body.type || 'Alarm', body.label || null, when, 'ON');
    if (!noti) throw new Error(`device "${target}" not found`);
    await new Promise((resolve, reject) => {
      alexa.createNotification(noti, (err, res) => (err ? reject(err) : resolve(res)));
    });
    return { ok: true, created: when.toISOString(), device: target };
  },
  'POST /alarms/toggle': async (body) => {
    const alexa = await ensureAlexa();
    const noti = await findNotification(alexa, body.id);
    await new Promise((resolve, reject) => {
      alexa.changeNotification(noti, !!body.on, (err, res) => (err ? reject(err) : resolve(res)));
    });
    return { ok: true, id: noti.id, status: body.on ? 'ON' : 'OFF' };
  },
  'POST /alarms/delete': async (body) => {
    const alexa = await ensureAlexa();
    const noti = await findNotification(alexa, body.id);
    await new Promise((resolve, reject) => {
      alexa.deleteNotification(noti, (err, res) => (err ? reject(err) : resolve(res)));
    });
    return { ok: true, deleted: noti.id };
  },
};

http.createServer(async (req, res) => {
  const key = `${req.method} ${req.url.split('?')[0]}`;
  const handler = routes[key];
  res.setHeader('Content-Type', 'application/json');
  if (!handler) {
    res.writeHead(404);
    return res.end(JSON.stringify({ error: `no route ${key}` }));
  }
  try {
    const body = req.method === 'POST' ? await readBody(req) : undefined;
    const out = await handler(body);
    res.writeHead(200);
    res.end(JSON.stringify(out));
  } catch (err) {
    res.writeHead(500);
    res.end(JSON.stringify({ error: String(err.message || err) }));
  }
}).listen(PORT, '0.0.0.0', () => {
  console.log(`alexa-api listening on 0.0.0.0:${PORT}`);
});
