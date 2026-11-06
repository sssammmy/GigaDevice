'use strict';

// Checks booking emails go through the Gmail relay, including the redirect
// that Google Apps Script web apps return after a POST.

const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gd-ces-mail-'));
const received = [];
let relay;
let server;
let base;
let failNext = false;

test.before(async () => {
  relay = http.createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/exec') {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        const data = JSON.parse(body);
        const ok = data.secret === 'shh' && !failNext;
        if (ok) received.push(data);
        const result = encodeURIComponent(JSON.stringify(ok ? { ok: true } : { ok: false, error: failNext ? 'Quota exceeded' : 'bad secret' }));
        failNext = false;
        res.writeHead(302, { Location: `/echo?r=${result}` });
        res.end();
      });
      return;
    }
    if (req.method === 'GET' && req.url.startsWith('/echo')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(decodeURIComponent(new URL(req.url, 'http://x').searchParams.get('r')));
      return;
    }
    res.writeHead(404).end();
  });
  await new Promise((r) => relay.listen(0, r));

  process.env.DB_PATH = path.join(tmp, 'mail.db');
  process.env.ADMIN_PASSWORD = 'secret';
  process.env.GMAIL_SCRIPT_URL = `http://127.0.0.1:${relay.address().port}/exec`;
  process.env.GMAIL_SCRIPT_SECRET = 'shh';
  process.env.NOTIFY_EMAILS = 'me@example.com, boss@example.com';

  const mod = require('../server');
  await mod.ready;
  await new Promise((r) => (server = mod.app.listen(0, r)));
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(() => {
  server.close();
  relay.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

const auth = { Authorization: 'Basic ' + Buffer.from('admin:secret').toString('base64') };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const event = require('../config/event.json');

test('booking and admin cancel send emails to customer and team', async () => {
  const res = await fetch(base + '/api/bookings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      requesterType: 'customer', date: event.days[1].date, time: event.days[1].start,
      firstName: 'Tess', lastName: 'Ter', email: 'tester@example.com', company: 'Test Co', attendees: 1,
    }),
  });
  assert.strictEqual(res.status, 201);
  const { booking } = await res.json();
  await wait(300);
  assert.strictEqual(received.length, 2);
  const toCustomer = received.find((m) => m.to === 'tester@example.com');
  const toTeam = received.find((m) => m.to === 'me@example.com,boss@example.com');
  assert.ok(toCustomer && /Confirmed/.test(toCustomer.subject));
  assert.ok(toTeam && /CES booking confirmed/.test(toTeam.subject));
  assert.match(toCustomer.attachments[0].content, /BEGIN:VCALENDAR/);

  received.length = 0;
  const c = await fetch(`${base}/api/admin/bookings/${booking.ref}/cancel?notify=1`, { method: 'POST', headers: auth });
  assert.strictEqual(c.status, 200);
  await wait(300);
  assert.ok(received.some((m) => m.to === 'tester@example.com' && /Cancelled/.test(m.subject)));
  assert.ok(received.some((m) => m.to === 'me@example.com,boss@example.com' && /cancelled/.test(m.subject)));
});

test('test email button reports success and failure', async () => {
  let r = await fetch(base + '/api/admin/test-email', { method: 'POST', headers: auth });
  assert.strictEqual(r.status, 200);
  assert.strictEqual((await r.json()).ok, true);

  failNext = true;
  r = await fetch(base + '/api/admin/test-email', { method: 'POST', headers: auth });
  assert.strictEqual(r.status, 502);
  assert.match((await r.json()).error, /Quota exceeded/);

  const s = await (await fetch(base + '/api/admin/email-status', { headers: auth })).json();
  assert.strictEqual(s.mode, 'gmail');
  assert.strictEqual(s.log[0].ok, false);
});
