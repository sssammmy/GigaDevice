'use strict';

const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const express = require('express');
const { createClient } = require('@libsql/client');

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

loadDotEnv(path.join(__dirname, '.env'));

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_URL = (process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data', 'bookings.db');
const CONFIG_PATH = process.env.EVENT_CONFIG || path.join(__dirname, 'config', 'event.json');
// Accept common variations of the setting name, such as NOTIFY_EMAIL or
// Notify_Emails, since a small typo in the host's settings is easy to miss.
const NOTIFY_KEY =
  'NOTIFY_EMAILS' in process.env
    ? 'NOTIFY_EMAILS'
    : Object.keys(process.env).find((k) => /^noti+fy?(cation)?s?e?mails?$/.test(k.toLowerCase().replace(/[^a-z]/g, '')));
const NOTIFY_EMAILS = String((NOTIFY_KEY && process.env[NOTIFY_KEY]) || '')
  .split(/[,;\s]+/)
  .map((s) => s.trim().replace(/^<|>$/g, ''))
  .filter((s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s));

const event = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
validateEventConfig(event);

// ---------------------------------------------------------------------------
// Database
// ---------------------------------------------------------------------------

// Uses a hosted Turso database when TURSO_DATABASE_URL is set (needed on hosts
// without a persistent disk, such as Render's free plan). Otherwise a local file.
let db;
if (process.env.TURSO_DATABASE_URL) {
  db = createClient({ url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN });
} else {
  fs.mkdirSync(path.dirname(path.resolve(DB_PATH)), { recursive: true });
  db = createClient({ url: `file:${path.resolve(DB_PATH)}` });
}

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS bookings (
    ref TEXT PRIMARY KEY,
    token TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'confirmed',
    date TEXT NOT NULL,
    time TEXT NOT NULL,
    room TEXT NOT NULL,
    requester_type TEXT NOT NULL,
    first_name TEXT NOT NULL,
    last_name TEXT NOT NULL,
    email TEXT,
    phone TEXT,
    company TEXT NOT NULL,
    job_title TEXT,
    attendees INTEGER NOT NULL DEFAULT 1,
    topics TEXT NOT NULL DEFAULT '[]',
    notes TEXT,
    rsm_name TEXT,
    rsm_email TEXT,
    rsm_region TEXT,
    created_at TEXT NOT NULL,
    cancelled_at TEXT
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS uniq_active_slot
    ON bookings(date, time, room) WHERE status = 'confirmed'`,
];

const ready = db.batch(SCHEMA, 'write');

const SQL = {
  activeInSlot: "SELECT room FROM bookings WHERE status = 'confirmed' AND date = ? AND time = ?",
  activeCounts: "SELECT date, time, COUNT(*) AS n FROM bookings WHERE status = 'confirmed' GROUP BY date, time",
  insert: `INSERT INTO bookings (ref, token, date, time, room, requester_type, first_name, last_name,
      email, phone, company, job_title, attendees, topics, notes, rsm_name, rsm_email, rsm_region, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  byRef: 'SELECT * FROM bookings WHERE ref = ?',
  cancel: "UPDATE bookings SET status = 'cancelled', cancelled_at = ? WHERE ref = ? AND status = 'confirmed'",
  all: 'SELECT * FROM bookings ORDER BY date, time, room',
};

async function query(sql, args = []) {
  await ready;
  return (await db.execute({ sql, args })).rows;
}

async function getByRef(ref) {
  return (await query(SQL.byRef, [ref]))[0] || null;
}

async function cancelBooking(ref) {
  await query(SQL.cancel, [new Date().toISOString(), ref]);
  return getByRef(ref);
}

// ---------------------------------------------------------------------------
// Slots and time helpers
// ---------------------------------------------------------------------------

function toMinutes(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

function fromMinutes(min) {
  return `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
}

function formatTime(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  const suffix = h >= 12 ? 'PM' : 'AM';
  const h12 = ((h + 11) % 12) + 1;
  return `${h12}:${String(m).padStart(2, '0')} ${suffix}`;
}

function formatDate(isoDate) {
  const d = new Date(`${isoDate}T12:00:00Z`);
  return d.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

// Convert a wall clock date and time in the event timezone to a UTC Date.
function zonedToUtc(isoDate, hhmm, timeZone) {
  const [y, mo, d] = isoDate.split('-').map(Number);
  const [h, mi] = hhmm.split(':').map(Number);
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  const offset = tzOffsetMs(new Date(guess), timeZone);
  let utc = guess - offset;
  const offset2 = tzOffsetMs(new Date(utc), timeZone);
  if (offset2 !== offset) utc = guess - offset2;
  return new Date(utc);
}

function tzOffsetMs(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(date);
  const get = (t) => Number(parts.find((p) => p.type === t).value);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

const blocked = new Set((event.blockedSlots || []).map((b) => `${b.date} ${b.time}`));

function slotTimesFor(day) {
  const out = [];
  for (let t = toMinutes(day.start); t + event.slotMinutes <= toMinutes(day.end); t += event.slotMinutes) {
    const time = fromMinutes(t);
    if (!blocked.has(`${day.date} ${time}`)) out.push(time);
  }
  return out;
}

function isValidSlot(date, time) {
  const day = event.days.find((d) => d.date === date);
  return Boolean(day) && slotTimesFor(day).includes(time);
}

function isPast(date, time, now = new Date()) {
  return zonedToUtc(date, time, event.timezone) <= now;
}

async function availability(now = new Date()) {
  const counts = new Map();
  for (const row of await query(SQL.activeCounts)) counts.set(`${row.date} ${row.time}`, Number(row.n));
  const capacity = event.rooms.length;
  return event.days.map((day) => ({
    date: day.date,
    label: formatDate(day.date),
    slots: slotTimesFor(day).map((time) => {
      const taken = counts.get(`${day.date} ${time}`) || 0;
      const past = isPast(day.date, time, now);
      const remaining = past ? 0 : Math.max(0, capacity - taken);
      return { time, label: formatTime(time), remaining, available: remaining > 0 };
    }),
  }));
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const EMAIL_RE = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;

function clean(value, max) {
  if (value === undefined || value === null) return '';
  return String(value).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim().slice(0, max);
}

function validateBooking(body) {
  const errors = {};
  const b = {
    requesterType: body.requesterType === 'rsm' ? 'rsm' : 'customer',
    date: clean(body.date, 10),
    time: clean(body.time, 5),
    firstName: clean(body.firstName, 80),
    lastName: clean(body.lastName, 80),
    email: clean(body.email, 160).toLowerCase(),
    phone: clean(body.phone, 40),
    company: clean(body.company, 120),
    jobTitle: clean(body.jobTitle, 120),
    attendees: Number.parseInt(body.attendees, 10) || 1,
    topics: Array.isArray(body.topics)
      ? body.topics.map((t) => clean(t, 80)).filter((t) => event.topics.includes(t))
      : [],
    notes: clean(body.notes, 2000),
    rsmName: clean(body.rsmName, 120),
    rsmEmail: clean(body.rsmEmail, 160).toLowerCase(),
    rsmRegion: clean(body.rsmRegion, 80),
  };

  if (!b.firstName) errors.firstName = 'First name is required.';
  if (!b.lastName) errors.lastName = 'Last name is required.';
  if (!b.company) errors.company = 'Company is required.';
  if (b.attendees < 1 || b.attendees > 12) errors.attendees = 'Attendees must be between 1 and 12.';

  if (b.requesterType === 'customer') {
    if (!EMAIL_RE.test(b.email)) errors.email = 'A valid email is required.';
  } else {
    if (b.email && !EMAIL_RE.test(b.email)) errors.email = 'Enter a valid email or leave it blank.';
    if (!b.rsmName) errors.rsmName = 'Your name is required.';
    if (!EMAIL_RE.test(b.rsmEmail)) errors.rsmEmail = 'A valid email is required.';
    if (b.rsmRegion && !event.regions.includes(b.rsmRegion)) errors.rsmRegion = 'Select a region.';
  }

  if (!isValidSlot(b.date, b.time)) errors.slot = 'Select an available time slot.';
  else if (isPast(b.date, b.time)) errors.slot = 'That time slot has already passed.';

  return { booking: b, errors };
}

// ---------------------------------------------------------------------------
// Booking creation
// ---------------------------------------------------------------------------

function newRef() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let ref = 'GD-';
  const bytes = crypto.randomBytes(6);
  for (const byte of bytes) ref += alphabet[byte % alphabet.length];
  return ref;
}

// Serialize booking writes in this process so two requests never race for the
// same room. The unique index is a second guard if more than one instance runs.
let writeQueue = Promise.resolve();
function createBooking(b) {
  const run = writeQueue.then(() => insertBooking(b));
  writeQueue = run.catch(() => {});
  return run;
}

async function insertBooking(b) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const used = new Set((await query(SQL.activeInSlot, [b.date, b.time])).map((r) => r.room));
    const room = event.rooms.find((r) => !used.has(r));
    if (!room) return null;
    const ref = newRef();
    const token = crypto.randomBytes(18).toString('base64url');
    try {
      await query(SQL.insert, [
        ref, token, b.date, b.time, room, b.requesterType, b.firstName, b.lastName,
        b.email || null, b.phone || null, b.company, b.jobTitle || null, b.attendees,
        JSON.stringify(b.topics), b.notes || null,
        b.rsmName || null, b.rsmEmail || null, b.rsmRegion || null,
        new Date().toISOString(),
      ]);
      return getByRef(ref);
    } catch (err) {
      if (!/UNIQUE|constraint/i.test(String(err.message))) throw err;
    }
  }
  return null;
}

function publicBooking(row) {
  return {
    ref: row.ref,
    status: row.status,
    date: row.date,
    time: row.time,
    dateLabel: formatDate(row.date),
    timeLabel: `${formatTime(row.time)} to ${formatTime(fromMinutes(toMinutes(row.time) + event.slotMinutes))} ${event.timezoneLabel}`,
    room: row.room,
    company: row.company,
    name: `${row.first_name} ${row.last_name}`,
    attendees: Number(row.attendees),
    topics: JSON.parse(row.topics || '[]'),
    manageUrl: `${PUBLIC_URL}/manage.html?ref=${encodeURIComponent(row.ref)}&token=${encodeURIComponent(row.token)}`,
  };
}

function safeEqual(a, b) {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

// ---------------------------------------------------------------------------
// Calendar invite (.ics)
// ---------------------------------------------------------------------------

function icsDate(d) {
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

function icsEscape(s) {
  return String(s).replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/([,;])/g, '\\$1');
}

function foldLine(line) {
  const out = [];
  let rest = line;
  while (rest.length > 73) {
    out.push(rest.slice(0, 73));
    rest = ' ' + rest.slice(73);
  }
  out.push(rest);
  return out.join('\r\n');
}

function buildIcs(row) {
  const start = zonedToUtc(row.date, row.time, event.timezone);
  const end = new Date(start.getTime() + event.slotMinutes * 60000);
  const location = `${event.company} ${row.room}, ${event.booth}, ${event.venue}, ${event.city}`;
  const description = [
    `Meeting with ${event.company} at ${event.eventName}.`,
    `Confirmation: ${row.ref}`,
    event.meetingLocationNote,
    `Manage or cancel: ${publicBooking(row).manageUrl}`,
  ].join('\n');
  const status = row.status === 'cancelled' ? 'CANCELLED' : 'CONFIRMED';
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//GigaDevice Americas//CES Booking//EN',
    'CALSCALE:GREGORIAN',
    row.status === 'cancelled' ? 'METHOD:CANCEL' : 'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${row.ref}@gigadevice-ces-booking`,
    `DTSTAMP:${icsDate(new Date())}`,
    `DTSTART:${icsDate(start)}`,
    `DTEND:${icsDate(end)}`,
    `SUMMARY:${icsEscape(`${event.company} meeting at ${event.eventName} (${row.company})`)}`,
    `LOCATION:${icsEscape(location)}`,
    `DESCRIPTION:${icsEscape(description)}`,
    `STATUS:${status}`,
    `SEQUENCE:${row.status === 'cancelled' ? 1 : 0}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return lines.map(foldLine).join('\r\n') + '\r\n';
}

// ---------------------------------------------------------------------------
// Email (optional)
// ---------------------------------------------------------------------------

// Two ways to send email:
// 1. Gmail relay (recommended on Render's free plan, which blocks SMTP):
//    a small Google Apps Script web app that sends from your own Gmail.
//    Set GMAIL_SCRIPT_URL and GMAIL_SCRIPT_SECRET. See tools/gmail-relay.gs.
// 2. SMTP: set SMTP_HOST and related settings. Needs a host that allows SMTP.
// Find the relay URL even if the setting name has a typo. Accepts the web app
// URL (ending in /exec) or the bare Deployment ID (starts with AKfy).
const SCRIPT_URL_RE = /^https:\/\/script\.google\.com\/\S+\/exec\/?$/;
const DEPLOY_ID_RE = /^AKfy[\w-]{20,}$/;
function scriptUrlFrom(value, exactKey = false) {
  const v = String(value || '').trim().replace(/^["']|["']$/g, '');
  if (SCRIPT_URL_RE.test(v)) return v.replace(/\/$/, '');
  // A web app URL inside extra text, or with ?query or #hash after /exec.
  const inside = v.match(/https:\/\/script\.google\.com\/[^\s"'<>?#]+?\/exec(?=$|[\s"'<>?#/])/);
  if (inside) return inside[0];
  const id = v.match(/(?:^|[^\w-])(AKfy[\w-]{20,})(?:$|[^\w-])/);
  if (id) return `https://script.google.com/macros/s/${id[1]}/exec`;
  // Under the exact setting name, any /exec URL is trusted (used by tests and proxies).
  if (exactKey && /^https?:\/\/\S+\/exec$/.test(v)) return v;
  if (DEPLOY_ID_RE.test(v)) return `https://script.google.com/macros/s/${v}/exec`;
  return '';
}
const GMAIL_KEY = scriptUrlFrom(process.env.GMAIL_SCRIPT_URL, true)
  ? 'GMAIL_SCRIPT_URL'
  : Object.keys(process.env).find((k) => scriptUrlFrom(process.env[k]));
const GMAIL_SCRIPT_URL = GMAIL_KEY ? scriptUrlFrom(process.env[GMAIL_KEY], GMAIL_KEY === 'GMAIL_SCRIPT_URL') : '';
// Explain what is wrong with a GMAIL_SCRIPT_URL value that was not usable.
function scriptUrlProblem() {
  const key = Object.keys(process.env).find((k) => /gmail|script/i.test(k) && !/secret/i.test(k));
  if (!key) return null;
  const v = String(process.env[key]).trim();
  if (!v) return `${key} is empty.`;
  const fix = 'In the Google script, click Deploy, then Manage deployments, and copy the Web app URL. It starts with https://script.google.com/macros/s/ and ends in /exec.';
  if (/googleusercontent\.com/i.test(v)) return `${key} is the address your browser showed after opening the script, which only works once. ${fix}`;
  if (/\/dev\/?$/.test(v)) return `${key} ends in /dev, which is the test link. ${fix}`;
  if (/\/edit|\/home\/projects|\/d\//.test(v)) return `${key} is the script editor link. ${fix}`;
  if (/^1[\w-]{30,}$/.test(v)) return `${key} looks like the Script ID from Project Settings. ${fix}`;
  if (/@/.test(v)) return `${key} contains an email address, not the script link. ${fix}`;
  const preview = v.length > 60 ? `${v.slice(0, 40)}...${v.slice(-12)}` : v;
  return `${key} is not a Google script web app URL. It currently starts "${preview.slice(0, 40)}"${v.length > 40 ? ` and ends "${v.slice(-12)}"` : ''} (${v.length} characters). ${fix}`;
}
const SECRET_KEY = String(process.env.GMAIL_SCRIPT_SECRET || '').trim()
  ? 'GMAIL_SCRIPT_SECRET'
  : Object.keys(process.env).find((k) => /secret/i.test(k) && !/admin|smtp|turso|auth/i.test(k) && String(process.env[k]).trim()) ||
    ('GMAIL_SCRIPT_SECRET' in process.env ? 'GMAIL_SCRIPT_SECRET' : undefined);
const GMAIL_SCRIPT_SECRET = String((SECRET_KEY && process.env[SECRET_KEY]) || '').trim().replace(/^["']|["']$/g, '');
const ON_RENDER = Boolean(process.env.RENDER);

let transporter = null;
if (!GMAIL_SCRIPT_URL && process.env.SMTP_HOST && !ON_RENDER) {
  const nodemailer = require('nodemailer');
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT) || 587,
    secure: Number(process.env.SMTP_PORT) === 465,
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
    connectionTimeout: 15000,
  });
}

const emailMode = GMAIL_SCRIPT_URL ? 'gmail' : transporter ? 'smtp' : 'off';
const emailLog = []; // recent results, shown on the admin page

function logEmail(entry) {
  emailLog.unshift({ at: new Date().toISOString(), ...entry });
  emailLog.length = Math.min(emailLog.length, 20);
  (entry.ok ? console.log : console.error)(`Email ${entry.ok ? 'sent' : 'FAILED'}: ${entry.subject} to ${entry.to}${entry.error ? ` (${entry.error})` : ''}`);
}

async function deliver({ to, subject, text, replyTo, attachments = [] }) {
  if (!to.length) return;
  try {
    if (emailMode === 'gmail') {
      const res = await fetch(GMAIL_SCRIPT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        redirect: 'follow',
        signal: AbortSignal.timeout(30000),
        body: JSON.stringify({
          secret: GMAIL_SCRIPT_SECRET,
          to: to.join(','),
          subject,
          text,
          replyTo: replyTo || '',
          fromName: event.company,
          attachments: attachments.map((a) => ({ filename: a.filename, content: a.content, contentType: a.contentType })),
        }),
      });
      const body = await res.text();
      let data;
      try {
        data = JSON.parse(body);
      } catch {
        throw new Error(`Gmail relay returned an unexpected response (HTTP ${res.status}). Check the script is deployed with access set to Anyone.`);
      }
      if (!data.ok) throw new Error(`Gmail relay: ${data.error || 'unknown error'}`);
    } else if (emailMode === 'smtp') {
      await transporter.sendMail({
        from: process.env.SMTP_FROM || process.env.SMTP_USER,
        to: to.join(', '),
        replyTo: replyTo || undefined,
        subject,
        text,
        attachments,
      });
    } else if (ON_RENDER && process.env.SMTP_HOST) {
      throw new Error('Render blocks SMTP email. Add GMAIL_SCRIPT_URL in Render (the Google script URL ending in /exec) and remove the SMTP settings.');
    } else {
      throw new Error('Email is not configured.');
    }
    logEmail({ ok: true, to: to.join(', '), subject });
  } catch (err) {
    if (emailMode === 'gmail' && !/^Gmail relay/.test(err.message)) {
      err.message = /abort|timeout/i.test(err.message)
        ? 'The Google script did not answer within 30 seconds. Open the script URL in a browser to check it shows "Gmail relay is running", then try again.'
        : `Could not reach the Google script (${err.message}). Check ${GMAIL_KEY} in Render.`;
    }
    logEmail({ ok: false, to: to.join(', '), subject, error: err.message });
    throw err;
  }
}

function bookingSummaryText(row) {
  const p = publicBooking(row);
  const lines = [
    `Confirmation: ${p.ref}`,
    `Date: ${p.dateLabel}`,
    `Time: ${p.timeLabel}`,
    `Room: ${p.room}`,
    `Location: ${event.booth}, ${event.venue}, ${event.city}`,
    `Company: ${row.company}`,
    `Contact: ${p.name}${row.job_title ? `, ${row.job_title}` : ''}`,
    row.email ? `Email: ${row.email}` : null,
    row.phone ? `Phone: ${row.phone}` : null,
    `Attendees: ${row.attendees}`,
    p.topics.length ? `Topics: ${p.topics.join(', ')}` : null,
    row.rsm_name ? `${row.requester_type === 'rsm' ? 'Booked by' : 'GigaDevice contact'}: ${row.rsm_name}${row.rsm_email ? ` <${row.rsm_email}>` : ''}${row.rsm_region ? ` (${row.rsm_region})` : ''}` : null,
    row.notes ? `Notes: ${row.notes}` : null,
  ];
  return lines.filter(Boolean).join('\n');
}

async function sendEmails(row, kind) {
  if (emailMode === 'off') {
    console.log(`[email disabled] ${kind} ${row.ref}`);
    return;
  }
  const p = publicBooking(row);
  const recipients = [row.email, row.rsm_email].filter(Boolean);
  const subject =
    kind === 'cancelled'
      ? `Cancelled: ${event.company} meeting at ${event.eventName} (${p.ref})`
      : `Confirmed: ${event.company} meeting at ${event.eventName} (${p.ref})`;
  const intro =
    kind === 'cancelled'
      ? `Your meeting with ${event.company} at ${event.eventName} has been cancelled.`
      : `Thank you. Your meeting with ${event.company} at ${event.eventName} is confirmed.`;
  const text = `${intro}\n\n${bookingSummaryText(row)}\n\n${kind === 'cancelled' ? '' : `${event.meetingLocationNote}\n\nManage or cancel your booking: ${p.manageUrl}\n\n`}Questions? Contact ${event.contactEmail}\n`;
  const ics = { filename: `${p.ref}.ics`, content: buildIcs(row), contentType: 'text/calendar; charset=utf-8' };

  await Promise.allSettled([
    deliver({ to: recipients, subject, text, replyTo: NOTIFY_EMAILS[0] || event.contactEmail, attachments: [ics] }),
    deliver({
      to: NOTIFY_EMAILS,
      replyTo: row.email || row.rsm_email || undefined,
      subject: `[CES booking ${kind}] ${row.company} ${p.dateLabel} ${formatTime(row.time)}`,
      text: bookingSummaryText(row),
      attachments: [ics],
    }),
  ]);
}

// ---------------------------------------------------------------------------
// HTTP app
// ---------------------------------------------------------------------------

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);

app.use((req, res, next) => {
  res.set({
    'Content-Security-Policy':
      "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'same-origin',
    'X-Frame-Options': 'DENY',
  });
  next();
});

app.use(express.json({ limit: '32kb' }));

function requireAdmin(req, res, next) {
  if (!ADMIN_PASSWORD) {
    return res.status(503).send('Admin is disabled. Set ADMIN_PASSWORD to enable it.');
  }
  const header = req.get('authorization') || '';
  const [scheme, encoded] = header.split(' ');
  if (scheme === 'Basic' && encoded) {
    const [user, ...rest] = Buffer.from(encoded, 'base64').toString().split(':');
    if (user === 'admin' && safeEqual(rest.join(':'), ADMIN_PASSWORD)) return next();
  }
  res.set('WWW-Authenticate', 'Basic realm="GigaDevice CES Admin", charset="UTF-8"');
  return res.status(401).send('Authentication required.');
}

// Simple in-memory rate limiter for booking submissions.
const hits = new Map();
function rateLimit(limit, windowMs) {
  return (req, res, next) => {
    const now = Date.now();
    const key = req.ip;
    const list = (hits.get(key) || []).filter((t) => now - t < windowMs);
    if (list.length >= limit) {
      return res.status(429).json({ error: 'Too many requests. Please try again in a few minutes.' });
    }
    list.push(now);
    hits.set(key, list);
    next();
  };
}
setInterval(() => {
  const now = Date.now();
  for (const [k, list] of hits) if (list.every((t) => now - t > 3600000)) hits.delete(k);
}, 600000).unref();

// Admin pages are protected before static files are served.
app.get(['/admin', '/admin.html', '/admin.js'], requireAdmin);
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));

app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));

app.get('/api/config', (req, res) => {
  res.json({
    company: event.company,
    eventName: event.eventName,
    tagline: event.tagline,
    city: event.city,
    venue: event.venue,
    booth: event.booth,
    meetingLocationNote: event.meetingLocationNote,
    timezoneLabel: event.timezoneLabel,
    slotMinutes: event.slotMinutes,
    topics: event.topics,
    regions: event.regions,
    contactEmail: event.contactEmail,
    dateRange: `${formatDate(event.days[0].date)} to ${formatDate(event.days[event.days.length - 1].date)}`,
  });
});

app.get('/api/availability', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ timezoneLabel: event.timezoneLabel, days: await availability() });
});

app.post('/api/bookings', rateLimit(Number(process.env.BOOKING_RATE_LIMIT) || 10, 10 * 60000), async (req, res) => {
  const body = req.body || {};
  if (body.website) return res.status(400).json({ error: 'Invalid submission.' }); // honeypot
  const { booking, errors } = validateBooking(body);
  if (Object.keys(errors).length) {
    return res.status(400).json({ error: 'Please correct the highlighted fields.', fields: errors });
  }
  const row = await createBooking(booking);
  if (!row) {
    return res.status(409).json({
      error: 'Sorry, that time slot was just booked. Please choose another time.',
      fields: { slot: 'This slot is no longer available.' },
    });
  }
  sendEmails(row, 'confirmed').catch((e) => console.error(e));
  res.status(201).json({ booking: publicBooking(row), icsUrl: `/api/bookings/${row.ref}/ics?token=${row.token}` });
});

async function loadOwnedBooking(req, res) {
  const row = await getByRef(String(req.params.ref));
  if (!row || !safeEqual(req.query.token || '', row.token)) {
    res.status(404).json({ error: 'Booking not found.' });
    return null;
  }
  return row;
}

app.get('/api/bookings/:ref', async (req, res) => {
  const row = await loadOwnedBooking(req, res);
  if (row) res.json({ booking: publicBooking(row) });
});

app.get('/api/bookings/:ref/ics', async (req, res) => {
  const row = await loadOwnedBooking(req, res);
  if (!row) return;
  res.set('Content-Type', 'text/calendar; charset=utf-8');
  res.set('Content-Disposition', `attachment; filename="${row.ref}.ics"`);
  res.send(buildIcs(row));
});

app.post('/api/bookings/:ref/cancel', rateLimit(20, 10 * 60000), async (req, res) => {
  const row = await loadOwnedBooking(req, res);
  if (!row) return;
  if (row.status === 'cancelled') return res.json({ booking: publicBooking(row) });
  const updated = await cancelBooking(row.ref);
  sendEmails(updated, 'cancelled').catch((e) => console.error(e));
  res.json({ booking: publicBooking(updated) });
});

// Admin API
function adminRow(row) {
  return {
    ref: row.ref,
    status: row.status,
    date: row.date,
    time: row.time,
    timeLabel: formatTime(row.time),
    room: row.room,
    requesterType: row.requester_type,
    firstName: row.first_name,
    lastName: row.last_name,
    email: row.email,
    phone: row.phone,
    company: row.company,
    jobTitle: row.job_title,
    attendees: Number(row.attendees),
    topics: JSON.parse(row.topics || '[]'),
    notes: row.notes,
    rsmName: row.rsm_name,
    rsmEmail: row.rsm_email,
    rsmRegion: row.rsm_region,
    createdAt: row.created_at,
    cancelledAt: row.cancelled_at,
  };
}

app.get('/api/admin/bookings', requireAdmin, async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const [days, rows] = await Promise.all([availability(), query(SQL.all)]);
  res.json({ rooms: event.rooms, days, bookings: rows.map(adminRow) });
});

app.post('/api/admin/bookings/:ref/cancel', requireAdmin, async (req, res) => {
  let row = await getByRef(String(req.params.ref));
  if (!row) return res.status(404).json({ error: 'Booking not found.' });
  if (row.status === 'confirmed') {
    row = await cancelBooking(row.ref);
    if (req.query.notify !== '0') sendEmails(row, 'cancelled').catch((e) => console.error(e));
  }
  res.json({ booking: adminRow(row) });
});

// Names (never values) of settings the user added, to help spot typos.
const SYSTEM_ENV = /^(PATH|HOME|HOSTNAME|PWD|SHLVL|TERM|LANG|LC_|NODE_|NPM_|npm_|RENDER|IS_PULL_REQUEST|PORT$|_|YARN|COREPACK|XDG_|USER$|SHELL$|OLDPWD|TZ$|GIT_|HTTP|NO_PROXY|SSL_|CI$|DEBIAN|PYTHON|JAVA|GO|RUBY|BUN)/i;
function visibleSettingNames() {
  const names = Object.keys(process.env).filter((k) => !SYSTEM_ENV.test(k)).sort();
  return names.length ? names.join(', ') : 'none';
}

app.get('/api/admin/email-status', requireAdmin, (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ mode: emailMode, notify: NOTIFY_EMAILS, log: emailLog, smtpBlocked: emailMode === 'off' && Boolean(process.env.SMTP_HOST) });
});

app.post('/api/admin/test-email', requireAdmin, async (req, res) => {
  if (emailMode === 'off') {
    return res.status(400).json({
      ok: false,
      error:
        scriptUrlProblem() ||
        `No Google script URL found in Render. Add GMAIL_SCRIPT_URL with the Web app URL ending in /exec${process.env.SMTP_HOST ? ', and remove the SMTP settings' : ''}. Settings the site can see: ${visibleSettingNames()}.`,
    });
  }
  if (emailMode === 'gmail' && !GMAIL_SCRIPT_SECRET) {
    return res.status(400).json({
      ok: false,
      error: SECRET_KEY
        ? `${SECRET_KEY} is empty in Render. Paste the same value as SECRET in the Google script, then Save Changes.`
        : `GMAIL_SCRIPT_SECRET is missing in Render. Add it with the same value as SECRET in the Google script, then Save Changes. Settings the site can see: ${visibleSettingNames()}.`,
    });
  }
  if (!NOTIFY_EMAILS.length) {
    return res.status(400).json({
      ok: false,
      error: NOTIFY_KEY
        ? `The setting ${NOTIFY_KEY} has no valid email address. Check its value in Render.`
        : 'No NOTIFY_EMAILS setting found. In Render, add NOTIFY_EMAILS (spelled exactly) with your email, then save.',
    });
  }
  try {
    await deliver({
      to: NOTIFY_EMAILS,
      subject: `Test email from the ${event.eventName} booking site`,
      text: `Email is working. Booking notifications will be sent to: ${NOTIFY_EMAILS.join(', ')}`,
    });
    res.json({ ok: true, to: NOTIFY_EMAILS });
  } catch (err) {
    res.status(502).json({ ok: false, error: err.message });
  }
});

app.get('/api/admin/bookings.csv', requireAdmin, async (req, res) => {
  const cols = [
    ['ref', 'Confirmation'], ['status', 'Status'], ['date', 'Date'], ['timeLabel', 'Time'], ['room', 'Room'],
    ['company', 'Company'], ['firstName', 'First name'], ['lastName', 'Last name'], ['jobTitle', 'Title'],
    ['email', 'Email'], ['phone', 'Phone'], ['attendees', 'Attendees'], ['topics', 'Topics'],
    ['requesterType', 'Booked by'], ['rsmName', 'RSM or GD contact'], ['rsmEmail', 'RSM email'],
    ['rsmRegion', 'Region'], ['notes', 'Notes'], ['createdAt', 'Created'], ['cancelledAt', 'Cancelled'],
  ];
  const esc = (v) => {
    let s = Array.isArray(v) ? v.join('; ') : v == null ? '' : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // guard against spreadsheet formula injection
    return `"${s.replace(/"/g, '""')}"`;
  };
  const rows = (await query(SQL.all)).map(adminRow);
  const csv = [cols.map((c) => esc(c[1])).join(',')]
    .concat(rows.map((r) => cols.map((c) => esc(r[c[0]])).join(',')))
    .join('\r\n');
  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', 'attachment; filename="ces-bookings.csv"');
  res.send('\uFEFF' + csv);
});

app.use('/api', (req, res) => res.status(404).json({ error: 'Not found.' }));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid request body.' });
  console.error(err);
  res.status(500).json({ error: 'Something went wrong. Please try again.' });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function validateEventConfig(cfg) {
  const required = ['company', 'eventName', 'timezone', 'slotMinutes', 'rooms', 'days', 'topics', 'regions'];
  for (const key of required) if (!(key in cfg)) throw new Error(`config/event.json is missing "${key}"`);
  if (!cfg.rooms.length) throw new Error('config/event.json needs at least one room');
  for (const d of cfg.days) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d.date) || !/^\d{2}:\d{2}$/.test(d.start) || !/^\d{2}:\d{2}$/.test(d.end)) {
      throw new Error(`Invalid day entry in config/event.json: ${JSON.stringify(d)}`);
    }
  }
}

function loadDotEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (!m || process.env[m[1]] !== undefined) continue;
    process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
}

if (require.main === module) {
  ready
    .then(() => {
      app.listen(PORT, () => {
        console.log(`GigaDevice CES booking site running at ${PUBLIC_URL}`);
        console.log(process.env.TURSO_DATABASE_URL ? 'Storing bookings in Turso.' : `Storing bookings in ${path.resolve(DB_PATH)}`);
    if (!ADMIN_PASSWORD) console.warn('ADMIN_PASSWORD is not set. The admin dashboard is disabled.');
        console.log(`Email: ${emailMode === 'gmail' ? 'Gmail relay' : emailMode === 'smtp' ? 'SMTP' : 'off'}. Notify: ${NOTIFY_EMAILS.join(', ') || 'nobody'}`);
      });
    })
    .catch((err) => {
      console.error('Could not open the database:', err.message);
      process.exit(1);
    });
}

module.exports = { app, ready, availability, zonedToUtc, buildIcs };
