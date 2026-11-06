(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const form = $('bookingForm');
  const state = { days: [], dayIndex: 0, selected: null, config: null };

  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (k === 'text') node.textContent = v;
      else if (k === 'class') node.className = v;
      else node.setAttribute(k, v);
    }
    for (const c of children || []) node.append(c);
    return node;
  }

  function requesterType() {
    return form.querySelector('input[name="requesterType"]:checked').value;
  }

  function applyRequesterType() {
    const rsm = requesterType() === 'rsm';
    $('rsmFields').classList.toggle('hidden', !rsm);
    document.querySelectorAll('.customer-only').forEach((n) => n.classList.toggle('hidden', rsm));
    $('emailOpt').classList.toggle('hidden', !rsm);
    $('detailsHint').textContent = rsm
      ? 'Enter your details, then the customer you are bringing.'
      : 'Tell us who we are meeting.';
  }

  // ---------------------------------------------------------------------
  // Config and availability
  // ---------------------------------------------------------------------

  async function loadConfig() {
    const res = await fetch('/api/config');
    const cfg = await res.json();
    state.config = cfg;
    document.title = `Meet ${cfg.company} at ${cfg.eventName}`;
    $('eventName').textContent = `${cfg.eventName} | ${cfg.city}`;
    $('tagline').textContent = cfg.tagline;
    $('factDates').textContent = cfg.dateRange.replace(/, \d{4}(?= to )/, '');
    $('factVenue').textContent = cfg.venue;
    $('factBooth').textContent = cfg.booth;
    $('slotHint').textContent = `Each meeting is ${cfg.slotMinutes} minutes. Times shown in Las Vegas time (${cfg.timezoneLabel}).`;
    const mail = `mailto:${cfg.contactEmail}`;
    $('contactLink').href = mail;
    $('footerEmail').href = mail;
    $('footerEmail').textContent = cfg.contactEmail;

    const topics = $('topics');
    topics.replaceChildren(
      ...cfg.topics.map((t) =>
        el('label', { class: 'chip' }, [el('input', { type: 'checkbox', name: 'topics', value: t }), el('span', { text: t })])
      )
    );
    const region = $('rsmRegion');
    cfg.regions.forEach((r) => region.append(el('option', { value: r, text: r })));
    const att = $('attendees');
    for (let i = 1; i <= 12; i++) att.append(el('option', { value: String(i), text: String(i) }));
  }

  async function loadAvailability(keepDay) {
    const res = await fetch('/api/availability', { cache: 'no-store' });
    const data = await res.json();
    state.days = data.days;
    $('tzNote').textContent = `All times are Pacific Time (${data.timezoneLabel}), local time in Las Vegas.`;
    if (!keepDay) {
      const firstOpen = state.days.findIndex((d) => d.slots.some((s) => s.available));
      state.dayIndex = firstOpen >= 0 ? firstOpen : 0;
    }
    if (state.selected) {
      const day = state.days.find((d) => d.date === state.selected.date);
      const slot = day && day.slots.find((s) => s.time === state.selected.time);
      if (!slot || !slot.available) setSelected(null);
    }
    renderDays();
    renderSlots();
  }

  function renderDays() {
    const wrap = $('days');
    wrap.replaceChildren(
      ...state.days.map((d, i) => {
        const open = d.slots.filter((s) => s.available).length;
        const [weekday, rest] = d.label.split(', ');
        const btn = el('button', {
          type: 'button',
          class: 'day-btn',
          role: 'tab',
          'aria-selected': String(i === state.dayIndex),
        }, [
          el('span', { class: 'd-week', text: weekday }),
          el('span', { class: 'd-date', text: rest }),
          el('span', { class: 'd-left', text: open ? `${open} times open` : 'Fully booked' }),
        ]);
        btn.addEventListener('click', () => {
          state.dayIndex = i;
          renderDays();
          renderSlots();
        });
        return btn;
      })
    );
  }

  function renderSlots() {
    const day = state.days[state.dayIndex];
    const wrap = $('slots');
    if (!day) {
      wrap.replaceChildren(el('p', { class: 'small', text: 'No dates are configured.' }));
      return;
    }
    wrap.replaceChildren(
      ...day.slots.map((s) => {
        const isSel = state.selected && state.selected.date === day.date && state.selected.time === s.time;
        const btn = el('button', {
          type: 'button',
          class: 'slot',
          'aria-pressed': String(Boolean(isSel)),
          'aria-label': `${day.label} ${s.label}${s.available ? '' : ' unavailable'}`,
        }, [document.createTextNode(s.label), el('small', { text: s.available ? 'Available' : 'Booked' })]);
        btn.disabled = !s.available;
        btn.addEventListener('click', () => {
          setSelected({ date: day.date, time: s.time, label: `${day.label} at ${s.label} ${state.config.timezoneLabel}` });
          renderSlots();
        });
        return btn;
      })
    );
  }

  function setSelected(sel) {
    state.selected = sel;
    const box = $('selectedSlot');
    box.classList.toggle('hidden', !sel);
    box.textContent = sel ? `Selected: ${sel.label}` : '';
    if (sel) setError('slot', '');
  }

  // ---------------------------------------------------------------------
  // Submit
  // ---------------------------------------------------------------------

  function setError(name, msg) {
    const node = $(`err-${name}`);
    if (node) node.textContent = msg || '';
    const field = form.querySelector(`[data-field="${name}"]`);
    if (field) field.classList.toggle('invalid', Boolean(msg));
  }

  function clearErrors() {
    form.querySelectorAll('.err').forEach((n) => (n.textContent = ''));
    form.querySelectorAll('.invalid').forEach((n) => n.classList.remove('invalid'));
    $('formError').textContent = '';
  }

  function payload() {
    const type = requesterType();
    const v = (id) => $(id).value.trim();
    return {
      requesterType: type,
      date: state.selected && state.selected.date,
      time: state.selected && state.selected.time,
      firstName: v('firstName'),
      lastName: v('lastName'),
      company: v('company'),
      jobTitle: v('jobTitle'),
      email: v('email'),
      phone: v('phone'),
      attendees: v('attendees'),
      topics: [...form.querySelectorAll('input[name="topics"]:checked')].map((c) => c.value),
      notes: v('notes'),
      rsmName: type === 'rsm' ? v('rsmName') : v('gdContact'),
      rsmEmail: type === 'rsm' ? v('rsmEmail') : '',
      rsmRegion: type === 'rsm' ? v('rsmRegion') : '',
      website: v('website'),
    };
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearErrors();
    if (!state.selected) {
      setError('slot', 'Please select a time slot.');
      $('slots').scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    const btn = $('submitBtn');
    btn.disabled = true;
    btn.textContent = 'Booking';
    try {
      const res = await fetch('/api/bookings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload()),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        $('formError').textContent = data.error || 'Booking failed. Please try again.';
        const fields = data.fields || {};
        Object.entries(fields).forEach(([k, msg]) => setError(k, msg));
        const first = Object.keys(fields)[0];
        const target = first === 'slot' ? $('slots') : $(first);
        if (target) target.scrollIntoView({ behavior: 'smooth', block: 'center' });
        if (res.status === 409) await loadAvailability(true);
        return;
      }
      showConfirmation(data);
    } catch (err) {
      $('formError').textContent = 'Network error. Please check your connection and try again.';
    } finally {
      btn.disabled = false;
      btn.textContent = 'Confirm meeting';
    }
  });

  function showConfirmation(data) {
    const b = data.booking;
    form.classList.add('hidden');
    const conf = $('confirmation');
    conf.classList.remove('hidden');
    $('cRef').textContent = b.ref;
    const rows = [
      ['Date', b.dateLabel],
      ['Time', b.timeLabel],
      ['Room', b.room],
      ['Location', `${state.config.booth}, ${state.config.venue}`],
      ['Company', b.company],
      ['Contact', b.name],
      ['Attendees', String(b.attendees)],
    ];
    if (b.topics.length) rows.push(['Topics', b.topics.join(', ')]);
    $('cSummary').replaceChildren(...rows.map(([k, v]) => el('tr', {}, [el('th', { text: k }), el('td', { text: v })])));
    $('cNote').textContent = `${state.config.meetingLocationNote} Save your confirmation number. A confirmation email will follow if email is enabled for this event.`;
    $('cIcs').href = data.icsUrl;
    $('cManage').href = b.manageUrl;
    conf.focus();
    window.scrollTo({ top: conf.offsetTop - 80, behavior: 'smooth' });
  }

  // ---------------------------------------------------------------------
  // Init
  // ---------------------------------------------------------------------

  $('year').textContent = new Date().getFullYear();
  form.querySelectorAll('input[name="requesterType"]').forEach((r) => r.addEventListener('change', applyRequesterType));
  const params = new URLSearchParams(location.search);
  if (params.get('type') === 'rsm') form.querySelector('input[value="rsm"]').checked = true;
  applyRequesterType();

  loadConfig()
    .then(() => loadAvailability(false))
    .catch(() => {
      $('slots').replaceChildren(el('p', { class: 'form-error', text: 'Could not load availability. Please refresh the page.' }));
    });

  setInterval(() => {
    if (!form.classList.contains('hidden')) loadAvailability(true).catch(() => {});
  }, 60000);
})();
