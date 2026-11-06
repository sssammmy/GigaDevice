(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  let data = { bookings: [], days: [], rooms: [] };

  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (k === 'text') node.textContent = v;
      else if (k === 'class') node.className = v;
      else node.setAttribute(k, v);
    }
    for (const c of children || []) node.append(typeof c === 'string' ? document.createTextNode(c) : c);
    return node;
  }

  function dayLabel(date) {
    const d = data.days.find((x) => x.date === date);
    return d ? d.label.replace(/, \d{4}$/, '') : date;
  }

  async function load() {
    const res = await fetch('/api/admin/bookings', { cache: 'no-store', credentials: 'same-origin' });
    if (!res.ok) throw new Error('Failed to load bookings');
    data = await res.json();
    const fDay = $('fDay');
    if (fDay.options.length === 1) {
      data.days.forEach((d) => fDay.append(el('option', { value: d.date, text: dayLabel(d.date) })));
    }
    render();
  }

  function render() {
    const active = data.bookings.filter((b) => b.status === 'confirmed');
    $('sTotal').textContent = active.length;
    $('sCustomer').textContent = active.filter((b) => b.requesterType === 'customer').length;
    $('sRsm').textContent = active.filter((b) => b.requesterType === 'rsm').length;
    $('sOpen').textContent = data.days.reduce((n, d) => n + d.slots.reduce((m, s) => m + s.remaining, 0), 0);

    const day = $('fDay').value;
    const status = $('fStatus').value;
    const q = $('fSearch').value.trim().toLowerCase();
    const list = data.bookings.filter((b) => {
      if (day && b.date !== day) return false;
      if (status && b.status !== status) return false;
      if (q) {
        const hay = [b.company, b.firstName, b.lastName, b.email, b.rsmName, b.rsmEmail, b.ref, b.notes].join(' ').toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });

    $('rows').replaceChildren(...list.map(rowFor));
    $('empty').hidden = list.length > 0;
    renderSchedule(day);
  }

  function rowFor(b) {
    const contact = el('td', {}, [
      `${b.firstName} ${b.lastName}`,
      b.jobTitle ? el('div', { class: 'small', text: b.jobTitle }) : '',
      b.email ? el('div', {}, [el('a', { href: `mailto:${b.email}`, text: b.email })]) : '',
      b.phone ? el('div', { class: 'small', text: b.phone }) : '',
    ]);
    const bookedBy = el('td', {}, [
      el('span', { class: b.requesterType === 'rsm' ? 'badge rsm' : 'badge', text: b.requesterType === 'rsm' ? 'RSM' : 'Customer' }),
      b.rsmName ? el('div', { text: b.rsmName }) : '',
      b.rsmEmail ? el('div', { class: 'small', text: b.rsmEmail }) : '',
      b.rsmRegion ? el('div', { class: 'small', text: b.rsmRegion }) : '',
    ]);
    const actions = el('td');
    if (b.status === 'confirmed') {
      const btn = el('button', { class: 'btn btn-danger', type: 'button', text: 'Cancel' });
      btn.addEventListener('click', () => cancel(b, btn));
      actions.append(btn);
    } else {
      actions.append(el('span', { class: 'small', text: 'Cancelled' }));
    }
    return el('tr', { class: b.status === 'cancelled' ? 'cancelled' : '' }, [
      el('td', {}, [el('strong', { text: dayLabel(b.date) }), el('div', { text: b.timeLabel }), el('div', { class: 'small', text: b.ref })]),
      el('td', { text: b.room }),
      el('td', {}, [el('strong', { text: b.company }), el('div', { class: 'small', text: `${b.attendees} attendee${b.attendees > 1 ? 's' : ''}` })]),
      contact,
      el('td', { class: 'small', text: b.topics.join(', ') }),
      bookedBy,
      el('td', { class: 'small', text: b.notes || '' }),
      actions,
    ]);
  }

  function renderSchedule(dayFilter) {
    const days = dayFilter ? data.days.filter((d) => d.date === dayFilter) : data.days;
    const byKey = new Map();
    data.bookings
      .filter((b) => b.status === 'confirmed')
      .forEach((b) => byKey.set(`${b.date}|${b.time}|${b.room}`, b));
    const tables = days.map((d) => {
      const head = el('tr', {}, [el('th', { text: 'Time' }), ...data.rooms.map((r) => el('th', { text: r }))]);
      const body = d.slots.map((s) =>
        el('tr', {}, [
          el('th', { text: s.label }),
          ...data.rooms.map((r) => {
            const b = byKey.get(`${d.date}|${s.time}|${r}`);
            return b
              ? el('td', { class: 'busy' }, [el('strong', { text: b.company }), el('div', { class: 'small', text: b.rsmName ? `RSM ${b.rsmName}` : `${b.firstName} ${b.lastName}` })])
              : el('td', { class: 'small', text: '' });
          }),
        ])
      );
      return el('div', {}, [el('h3', { text: d.label }), el('table', { class: 'schedule' }, [el('thead', {}, [head]), el('tbody', {}, body)])]);
    });
    $('schedule').replaceChildren(...tables);
  }

  async function cancel(b, btn) {
    if (!confirm(`Cancel ${b.company} on ${dayLabel(b.date)} at ${b.timeLabel}?`)) return;
    const notify = confirm('Email a cancellation notice to the customer and RSM?');
    btn.disabled = true;
    const res = await fetch(`/api/admin/bookings/${encodeURIComponent(b.ref)}/cancel?notify=${notify ? 1 : 0}`, {
      method: 'POST',
      credentials: 'same-origin',
    });
    if (!res.ok) {
      btn.disabled = false;
      alert('Could not cancel this booking.');
      return;
    }
    await load();
  }

  ['fDay', 'fStatus'].forEach((id) => $(id).addEventListener('change', render));
  $('fSearch').addEventListener('input', render);
  load().catch((e) => alert(e.message));
  setInterval(() => load().catch(() => {}), 60000);
})();
