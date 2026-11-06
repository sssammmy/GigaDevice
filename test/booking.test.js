'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gd-ces-'));
process.env.DB_PATH = path.join(tmp, 'test.db');
process.env.ADMIN_PASSWORD = 'secret';
process.env.PORT = '0';

const { app, zonedToUtc } = require('../server');
const event = require('../config/event.json');

let server;
let base;

test.before(async () => {
  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(() => {
  server.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

const firstDay = event.days[0];
const slot = { date: firstDay.date, time: firstDay.start };

function customer(extra) {
  return {
    requesterType: 'customer',
    ...slot,
    firstName: 'Ada',
    lastName: 'Lovelace',
    email: 'ada@example.com',
    company: 'Acme Robotics',
    attendees: 2,
    topics: ['GD32 Microcontrollers (MCU)', 'Not a real topic'],
    ...extra,
  };
}

async function post(url, body) {
  const res = await fetch(base + url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

const adminAuth = { Authorization: 'Basic ' + Buffer.from('admin:secret').toString('base64') };

test('timezone conversion uses Pacific time', () => {
  assert.strictEqual(zonedToUtc('2027-01-06', '10:00', 'America/Los_Angeles').toISOString(), '2027-01-06T18:00:00.000Z');
});

test('availability lists configured days', async () => {
  const res = await fetch(base + '/api/availability');
  const data = await res.json();
  assert.strictEqual(data.days.length, event.days.length);
  assert.ok(data.days[0].slots[0].available);
  assert.strictEqual(data.days[0].slots[0].remaining, event.rooms.length);
});

test('validation rejects missing fields', async () => {
  const r = await post('/api/bookings', { requesterType: 'customer' });
  assert.strictEqual(r.status, 400);
  assert.ok(r.body.fields.email);
  assert.ok(r.body.fields.slot);
});

test('RSM booking requires RSM details', async () => {
  const r = await post('/api/bookings', customer({ requesterType: 'rsm', email: '' }));
  assert.strictEqual(r.status, 400);
  assert.ok(r.body.fields.rsmName);
  assert.ok(r.body.fields.rsmEmail);
});

test('fills each room then rejects the slot', async () => {
  const rooms = [];
  for (let i = 0; i < event.rooms.length; i++) {
    const r = await post('/api/bookings', i === 1
      ? customer({ requesterType: 'rsm', email: '', rsmName: 'Sam Rep', rsmEmail: 'sam@gigadevice.com', rsmRegion: 'West' })
      : customer());
    assert.strictEqual(r.status, 201, JSON.stringify(r.body));
    rooms.push(r.body.booking.room);
    assert.deepStrictEqual(r.body.booking.topics, ['GD32 Microcontrollers (MCU)']);
  }
  assert.deepStrictEqual(rooms, event.rooms);
  const full = await post('/api/bookings', customer());
  assert.strictEqual(full.status, 409);

  const avail = await (await fetch(base + '/api/availability')).json();
  assert.strictEqual(avail.days[0].slots[0].available, false);
});

test('owner can view, download ics, and cancel', async () => {
  const r = await post('/api/bookings', customer({ time: firstDay.start.replace(':00', ':30') }));
  assert.strictEqual(r.status, 201);
  const url = new URL(r.body.booking.manageUrl);
  const ref = url.searchParams.get('ref');
  const token = url.searchParams.get('token');

  const bad = await fetch(`${base}/api/bookings/${ref}?token=wrong`);
  assert.strictEqual(bad.status, 404);

  const ics = await fetch(base + r.body.icsUrl);
  const text = await ics.text();
  assert.match(text, /BEGIN:VEVENT/);
  assert.match(text, /DTSTART:20270106T183000Z/);

  const c = await post(`/api/bookings/${ref}/cancel?token=${token}`, {});
  assert.strictEqual(c.status, 200);
  assert.strictEqual(c.body.booking.status, 'cancelled');
});

test('admin requires password and lists bookings', async () => {
  assert.strictEqual((await fetch(base + '/api/admin/bookings')).status, 401);
  assert.strictEqual((await fetch(base + '/admin')).status, 401);
  const res = await fetch(base + '/api/admin/bookings', { headers: adminAuth });
  assert.strictEqual(res.status, 200);
  const data = await res.json();
  assert.ok(data.bookings.length >= event.rooms.length);
  const csv = await fetch(base + '/api/admin/bookings.csv', { headers: adminAuth });
  assert.match(await csv.text(), /Acme Robotics/);
});

test('honeypot blocks bots', async () => {
  const r = await post('/api/bookings', customer({ website: 'spam.example' }));
  assert.strictEqual(r.status, 400);
});
