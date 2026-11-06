(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const params = new URLSearchParams(location.search);
  const ref = params.get('ref') || '';
  const token = params.get('token') || '';
  const base = `/api/bookings/${encodeURIComponent(ref)}`;
  const qs = `?token=${encodeURIComponent(token)}`;

  function row(k, v) {
    const tr = document.createElement('tr');
    const th = document.createElement('th');
    const td = document.createElement('td');
    th.textContent = k;
    td.textContent = v;
    tr.append(th, td);
    return tr;
  }

  function render(b) {
    $('loading').classList.add('hidden');
    $('details').classList.remove('hidden');
    $('ref').textContent = b.ref;
    const cancelled = b.status === 'cancelled';
    $('title').textContent = cancelled ? 'This meeting has been cancelled' : 'Your meeting is confirmed';
    const rows = [
      ['Status', cancelled ? 'Cancelled' : 'Confirmed'],
      ['Date', b.dateLabel],
      ['Time', b.timeLabel],
      ['Location', b.location],
      ['Company', b.company],
      ['Contact', b.name],
      ['Attendees', String(b.attendees)],
    ];
    if (b.topics.length) rows.push(['Topics', b.topics.join(', ')]);
    $('summary').replaceChildren(...rows.map(([k, v]) => row(k, v)));
    $('ics').href = `${base}/ics${qs}`;
    $('actions').classList.toggle('hidden', cancelled);
  }

  async function load() {
    const res = await fetch(base + qs, { cache: 'no-store' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      $('loading').classList.add('hidden');
      $('error').textContent = data.error || 'Booking not found. Please use the link from your confirmation.';
      return;
    }
    render(data.booking);
  }

  $('cancelBtn').addEventListener('click', async () => {
    if (!confirm('Cancel this meeting? This frees the slot for someone else.')) return;
    const btn = $('cancelBtn');
    btn.disabled = true;
    const res = await fetch(`${base}/cancel${qs}`, { method: 'POST' });
    const data = await res.json().catch(() => ({}));
    btn.disabled = false;
    if (!res.ok) {
      $('error').textContent = data.error || 'Could not cancel. Please try again.';
      return;
    }
    render(data.booking);
  });

  load().catch(() => {
    $('error').textContent = 'Network error. Please refresh the page.';
  });
})();
