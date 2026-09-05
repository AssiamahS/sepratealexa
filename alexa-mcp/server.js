#!/usr/bin/env node
// Alexa MCP — see/set/toggle/delete Alexa alarms & reminders from Claude.
// Uses the unofficial Alexa app API via alexa-remote2 with a captured
// Amazon session cookie (data/cookie.json, created by login.js or alexa_login).
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { z } = require('zod');
const { connect, loadCookie, loginUrl } = require('./client');

let alexaPromise = null;
let loginInFlight = false;

function ensureAlexa() {
  if (!alexaPromise) {
    if (!loadCookie()) {
      return Promise.reject(new Error(
        `No Amazon session yet. Run the alexa_login tool, open ${loginUrl} and sign in.`));
    }
    alexaPromise = connect().catch((err) => {
      alexaPromise = null;
      throw err;
    });
  }
  return alexaPromise;
}

function deviceName(alexa, serial) {
  const d = alexa.serialNumbers && alexa.serialNumbers[serial];
  return (d && d.accountName) || serial;
}

function getNotifications(alexa) {
  return new Promise((resolve, reject) => {
    alexa.getNotifications(false, (err, res) => {
      if (err) return reject(err);
      resolve((res && res.notifications) || []);
    });
  });
}

function fmt(alexa, n) {
  return {
    id: n.id,
    type: n.type,
    status: n.status,
    time: `${n.originalDate} ${String(n.originalTime || '').replace(/\.\d+$/, '')}`.trim(),
    label: n.reminderLabel || n.timerLabel || null,
    device: deviceName(alexa, n.deviceSerialNumber),
    recurring: n.recurringPattern || (n.rRuleData ? 'custom' : null),
  };
}

async function findNotification(alexa, id) {
  const all = await getNotifications(alexa);
  const matches = all.filter((n) => n.id === id || (n.id && n.id.includes(id)));
  if (matches.length === 0) throw new Error(`No alarm/reminder with id matching "${id}"`);
  if (matches.length > 1) throw new Error(
    `Ambiguous id "${id}" — matches ${matches.length}: ${matches.map((n) => n.id).join(' | ')}`);
  return matches[0];
}

// "16:00", "4:05 pm", "4pm" (+ optional date "YYYY-MM-DD"|"today"|"tomorrow")
function parseWhen(time, date) {
  const m = String(time).trim().toLowerCase()
    .match(/^(\d{1,2})(?::(\d{2}))?(?::(\d{2}))?\s*(am|pm)?$/);
  if (!m) throw new Error(`Can't parse time "${time}" — use "16:00" or "4:00 pm"`);
  let h = parseInt(m[1], 10);
  const min = parseInt(m[2] || '0', 10);
  const sec = parseInt(m[3] || '0', 10);
  if (m[4] === 'pm' && h < 12) h += 12;
  if (m[4] === 'am' && h === 12) h = 0;
  const d = new Date();
  if (date && date !== 'today') {
    if (date === 'tomorrow') d.setDate(d.getDate() + 1);
    else {
      const dm = String(date).match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
      if (!dm) throw new Error(`Can't parse date "${date}" — use YYYY-MM-DD, today, tomorrow`);
      d.setFullYear(+dm[1], +dm[2] - 1, +dm[3]);
    }
  }
  d.setHours(h, min, sec, 0);
  if (!date && d.getTime() < Date.now()) d.setDate(d.getDate() + 1); // next occurrence
  return d;
}

const text = (obj) => ({
  content: [{ type: 'text', text: typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2) }],
});

const server = new McpServer({ name: 'alexa', version: '1.0.0' });

server.tool(
  'alexa_status',
  'Check Alexa connection: cookie present, auth working, device count.',
  {},
  async () => {
    if (!loadCookie()) return text({ connected: false, reason: 'no cookie — run alexa_login' });
    try {
      const alexa = await ensureAlexa();
      const devices = Object.values(alexa.serialNumbers || {})
        .filter((d) => d.accountName).map((d) => d.accountName);
      return text({ connected: true, devices });
    } catch (err) {
      return text({ connected: false, reason: String(err.message || err) });
    }
  },
);

server.tool(
  'alexa_login',
  'Start the one-time Amazon login proxy. Returns a URL the user must open and sign in at. Check alexa_status afterwards.',
  {},
  async () => {
    if (!loginInFlight) {
      loginInFlight = true;
      alexaPromise = connect({ requireCookie: false })
        .finally(() => { loginInFlight = false; })
        .catch((err) => { alexaPromise = null; throw err; });
    }
    await new Promise((r) => setTimeout(r, 2000)); // let the proxy start listening
    return text(`Login proxy running. Open ${loginUrl} on the phone or Mac, sign in to Amazon, then call alexa_status to confirm.`);
  },
);

server.tool(
  'alexa_devices',
  'List Alexa devices (name, serial, online capability).',
  {},
  async () => {
    const alexa = await ensureAlexa();
    const devices = Object.values(alexa.serialNumbers || {})
      .filter((d) => d.accountName)
      .map((d) => ({ name: d.accountName, serial: d.serialNumber, type: d.deviceType, online: d.online }));
    return text(devices);
  },
);

server.tool(
  'alexa_list_alarms',
  'List Alexa alarms, reminders and timers across all devices.',
  { type: z.enum(['Alarm', 'Reminder', 'Timer', 'all']).optional().describe('Filter by type, default all') },
  async ({ type }) => {
    const alexa = await ensureAlexa();
    let list = await getNotifications(alexa);
    if (type && type !== 'all') list = list.filter((n) => n.type === type || (type === 'Alarm' && n.type === 'MusicAlarm'));
    list.sort((a, b) => `${a.originalDate}${a.originalTime}`.localeCompare(`${b.originalDate}${b.originalTime}`));
    return text(list.map((n) => fmt(alexa, n)));
  },
);

server.tool(
  'alexa_set_alarm',
  'Create an Alexa alarm or reminder on a device.',
  {
    time: z.string().describe('Time, e.g. "16:00" or "4:00 pm"'),
    date: z.string().optional().describe('Optional: YYYY-MM-DD, "today", "tomorrow". Default: next occurrence of the time'),
    device: z.string().optional().describe('Device name, e.g. "Bedroom Echo Show 11". Default: the only device if just one exists'),
    label: z.string().optional().describe('Label (spoken for reminders)'),
    type: z.enum(['Alarm', 'Reminder']).optional().describe('Default Alarm'),
  },
  async ({ time, date, device, label, type }) => {
    const alexa = await ensureAlexa();
    let target = device;
    if (!target) {
      const named = Object.values(alexa.serialNumbers || {}).filter((d) => d.accountName);
      if (named.length !== 1) {
        throw new Error(`Multiple devices — specify one: ${named.map((d) => d.accountName).join(', ')}`);
      }
      target = named[0].accountName;
    }
    const when = parseWhen(time, date);
    const noti = alexa.createNotificationObject(target, type || 'Alarm', label || null, when, 'ON');
    if (!noti) throw new Error(`Device "${target}" not found`);
    await new Promise((resolve, reject) => {
      alexa.createNotification(noti, (err, res) => (err ? reject(err) : resolve(res)));
    });
    return text(`Created ${type || 'Alarm'} at ${when.toLocaleString('en-US')} on ${target}${label ? ` ("${label}")` : ''}`);
  },
);

server.tool(
  'alexa_toggle_alarm',
  'Turn an existing alarm/reminder ON or OFF (id from alexa_list_alarms; unique substring ok).',
  {
    id: z.string().describe('Notification id or unique substring of it'),
    on: z.boolean().describe('true = enable, false = turn off'),
  },
  async ({ id, on }) => {
    const alexa = await ensureAlexa();
    const noti = await findNotification(alexa, id);
    await new Promise((resolve, reject) => {
      alexa.changeNotification(noti, on, (err, res) => (err ? reject(err) : resolve(res)));
    });
    return text(`${noti.type} ${fmt(alexa, noti).time} on ${deviceName(alexa, noti.deviceSerialNumber)} → ${on ? 'ON' : 'OFF'}`);
  },
);

server.tool(
  'alexa_delete_alarm',
  'Delete an alarm/reminder entirely (id from alexa_list_alarms; unique substring ok).',
  { id: z.string().describe('Notification id or unique substring of it') },
  async ({ id }) => {
    const alexa = await ensureAlexa();
    const noti = await findNotification(alexa, id);
    await new Promise((resolve, reject) => {
      alexa.deleteNotification(noti, (err, res) => (err ? reject(err) : resolve(res)));
    });
    return text(`Deleted ${noti.type} ${fmt(alexa, noti).time} on ${deviceName(alexa, noti.deviceSerialNumber)}`);
  },
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error('alexa-mcp fatal:', err);
  process.exit(1);
});
