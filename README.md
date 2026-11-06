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

Requires Node.js 22.13 or newer.

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

Replace `public/assets/logo.svg` with the official GigaDevice logo (white version for the dark header) and `public/assets/favicon.svg` with the brand icon. Brand colors are defined at the top of `public/styles.css`.

## Email

Set the `SMTP_*` variables to send confirmation and cancellation emails with a calendar invite attached. `NOTIFY_EMAILS` takes a comma separated list of internal addresses that receive a copy of every booking. Leave `SMTP_HOST` blank to turn email off. Office 365, Google Workspace, SendGrid and similar SMTP services all work.

## Deploy

The app is one Node process with a SQLite file, so it needs a host with a persistent disk.

**Render (simplest).** Push this repo to GitHub, create a new Blueprint on render.com, and point it at the repo. `render.yaml` sets up the service and a 1 GB disk. Enter `ADMIN_PASSWORD`, `PUBLIC_URL` and SMTP settings when prompted. Add your custom domain such as `ces.gigadevice-americas.com` in the Render dashboard.

**Docker (any cloud or internal server).**

```
docker build -t gd-ces .
docker run -d -p 3000:3000 -v gd-ces-data:/app/data \
  -e ADMIN_PASSWORD=change-me -e PUBLIC_URL=https://ces.example.com gd-ces
```

Run it behind HTTPS (Render, Railway, Fly.io and most load balancers handle this for you).

## Sharing with RSMs

Send RSMs the link with `?type=rsm` added, for example `https://ces.example.com/?type=rsm`. The form opens with the RSM path selected.

## Backups

All bookings live in the SQLite file at `DB_PATH`. Use Export CSV in the admin dashboard for a quick snapshot, or copy the file.
