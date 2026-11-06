# GigaDevice Americas CES Meeting Booking

Public website where customers and GigaDevice RSMs book meetings with the GigaDevice Americas team at CES.

## What it does

* Branded landing page with event dates, venue and booth
* Two booking paths: customers book for themselves, RSMs book on behalf of a customer
* Live slot availability across multiple meeting rooms with no double booking
* Confirmation page, calendar invite (.ics) and a private link to view or cancel
* Optional confirmation emails to the customer and RSM, plus a copy to the internal team
* Password protected admin dashboard at `/admin` with filters, room schedule, cancel and CSV export

## Run locally

Requires Node.js 20 or newer.

```
npm install
cp .env.example .env      # set ADMIN_PASSWORD at minimum
npm start
```

Open http://localhost:3000 for the public site and http://localhost:3000/admin for the dashboard (user `admin`, password from `ADMIN_PASSWORD`).

Run tests with `npm test`.

## Customize the event

Edit `config/event.json` and restart.

| Setting | Purpose |
| --- | --- |
| `eventName`, `tagline`, `venue`, `booth` | Text shown on the site and in invites |
| `days` | Each show day with start and end time (Las Vegas local time) |
| `slotMinutes` | Meeting length |
| `rooms` | Meeting rooms. The number of rooms is how many meetings can run at the same time |
| `blockedSlots` | Times to close, such as lunch |
| `topics` | Topic choices on the form |
| `regions` | RSM region choices |
| `contactEmail` | Shown in the header, footer and emails |

CES 2027 dates are preset to January 6 to 9, 2027. Confirm the dates and booth number before launch.

## Branding

The header uses the official GigaDevice mark and white wordmark from `public/assets`. Replace those files to change the logo. Brand colors are defined at the top of `public/styles.css`.

## Email

Set the `SMTP_*` variables to send confirmation and cancellation emails with a calendar invite attached. `NOTIFY_EMAILS` takes a comma separated list of internal addresses that receive a copy of every booking. Leave `SMTP_HOST` blank to turn email off. Office 365, Google Workspace, SendGrid and similar SMTP services all work.

## Deploy for free

Free setup: Render hosts the site at a free web address like `https://gigadevice-ces.onrender.com`. Turso stores the bookings for free, because Render's free plan erases local files on every restart.

**Step 1. Create the free database (Turso)**

1. Sign up at https://turso.tech (GitHub login works).
2. Create a database, for example `gigadevice-ces`.
3. Copy the database URL. It starts with `libsql://`.
4. Create a database token and copy it.

**Step 2. Create the free site (Render)**

1. Sign up at https://render.com with your GitHub account.
2. Click New, then Blueprint, and pick the `sssammmy/GigaDevice` repo. Render reads `render.yaml`.
3. When asked, fill in:
   * `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` from step 1
   * `ADMIN_PASSWORD`, a strong password for `/admin`
   * Email settings if you want confirmation emails, otherwise leave them blank
4. Click Apply. In a few minutes the site is live at `https://gigadevice-ces.onrender.com`. If that name is taken, Render adds a few characters. The final address is shown at the top of the service page.

**Step 3. Keep it awake (optional, free)**

Free Render sites go to sleep after 15 minutes without visitors, and the next visitor waits about a minute. To prevent this, create a free monitor at https://uptimerobot.com that checks `https://<your-site>.onrender.com/api/config` every 5 minutes. One always-on site fits within Render's free monthly hours.

**Step 4. Branded address (optional)**

For an address like `ces.gigadevice.com`, ask your IT team to add a CNAME record pointing to your onrender.com address, then add the custom domain under Settings in Render. This costs nothing if the company domain already exists.

**Updating the site.** Any change pushed to `main` redeploys automatically. Bookings are kept in Turso.

**Other hosting.** The included Dockerfile runs anywhere. Without Turso settings it stores bookings in `data/bookings.db`, so mount that folder on a persistent volume.

## Sharing with RSMs

Send RSMs the link with `?type=rsm` added, for example `https://ces.example.com/?type=rsm`. The form opens with the RSM path selected.

## Backups

Use Export CSV in the admin dashboard for a quick snapshot. Bookings live in Turso when configured, otherwise in the file at `DB_PATH`.
