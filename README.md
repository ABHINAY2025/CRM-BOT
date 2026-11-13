# WaCRM — WhatsApp CRM bot

A WhatsApp Cloud API CRM with a Jira-style blue and white dashboard (React, Tailwind and shadcn/ui, with `motion` micro animations), keyword bot automations, broadcasts and a built-in ngrok HTTPS tunnel for the Meta webhook.

## Run the bot (one command)

```bash
npm run bot       # starts the ngrok tunnel + CRM server, restarts either if it crashes
```

- CRM: http://localhost:3000 (only on this PC — the ngrok URL serves **only** `/webhook`; everything else returns 403).
- The tunnel prints the Webhook URL + verify token. Set `NGROK_DOMAIN` in `.env` to your free static ngrok domain so this URL never changes.
- Keep the PC awake (Windows power settings → never sleep) while the bot should answer.

## Run it (separately)

```bash
npm run setup     # first time only: installs server + web deps and builds the UI
npm start         # starts server on http://localhost:3000, opens ngrok tunnel, registers webhook with Meta
```

Open **http://localhost:3000**. The console prints the public HTTPS URL, webhook URL and verify token. They are also shown under **Project settings**.

UI development with hot reload: run `npm start` in one terminal and `npm run dev:web` in another, then open http://localhost:5173.

## How the webhook works

- On startup the server opens an ngrok tunnel (`@ngrok/ngrok` SDK). It uses the authtoken from your ngrok config or from `NGROK_AUTHTOKEN`.
- With `AUTO_REGISTER_WEBHOOK=true`, it points your Meta app's WhatsApp webhook at `<ngrok-url>/webhook` and subscribes your WABA. Meta verifies it immediately.
- Free ngrok URLs change on every restart, and they're re-registered automatically. For a fixed URL, claim your free static domain at dashboard.ngrok.com → Domains and set `NGROK_DOMAIN=your-name.ngrok-free.app` in `.env`.
- Incoming webhooks are verified with `X-Hub-Signature-256` using `WA_APP_SECRET`.

## Features

| Area | What you get |
|---|---|
| Dashboard | KPI tiles, 7-day inbound/outbound chart, pipeline overview, tasks, activity stream, connection health |
| Inbox | Live chat (SSE), delivery/read ticks, 24h window timer, quick replies, template sender, media, internal notes |
| Pipeline board | Drag-and-drop Kanban (New → Contacted → Qualified → Proposal → Won/Lost), filters by assignee/label/unread |
| Contacts | Sortable list view, bulk stage/assign/label/delete, CSV export, broadcast to selection |
| Tasks | Jira-style task board linked to contacts, due dates and overdue flags |
| Templates | Synced from Meta with live preview |
| Broadcasts | Send a template to all / stage / label / selected, with `{{name}}` personalisation and progress |
| Bot & automations | Welcome + away messages, business hours, keyword rules (reply, buttons, move stage, add label), rule tester |

## Notes

- **Test number:** Meta's test number can only message numbers added in *WhatsApp → API Setup → To* (up to 5). Others fail with error 131030.
- **24-hour rule:** free-form replies are only allowed within 24h of the customer's last message. After that, send a template.
- Data is stored in MongoDB (`crm_*` collections, see `MONGO_URI`). Secrets live in `.env`, which is git-ignored.

## Deploy to Vercel

The app runs on Vercel as one serverless function (`api/index.js` → `server.js`) plus the static UI (`web/dist`). Data lives in **MongoDB** (collections prefixed `crm_`).

1. **MongoDB Atlas → Network Access:** allow `0.0.0.0/0` (Vercel has no fixed IPs).
2. **Vercel → Add New Project →** import this GitHub repo. Leave framework as *Other*; `vercel.json` sets the build.
3. **Environment variables** (Project → Settings → Environment Variables):

| Name | Value |
|---|---|
| `MONGO_URI` | your Atlas connection string |
| `WA_TOKEN` | permanent System user token |
| `WA_PHONE_NUMBER_ID`, `WA_BUSINESS_ACCOUNT_ID` | from WhatsApp → API Setup |
| `WA_APP_SECRET` | Meta app → Settings → Basic (verifies webhook signatures) |
| `WA_VERIFY_TOKEN` | any secret string; paste the same value in Meta |
| `GRAPH_VERSION` | `v23.0` |
| `ANTHROPIC_API_KEY`, `AI_MODEL`, `AI_EFFORT` | Claude key, `claude-sonnet-5-5`, `medium` |
| `CRM_PASSWORD` | team login password for the CRM |
| `SESSION_SECRET` | long random string (signs login cookies) |
| `NODEJS_HELPERS` | `0` (keeps the raw webhook body for signature checks) |

4. Deploy, then in **Meta → WhatsApp → Configuration** set the callback URL to `https://<your-project>.vercel.app/webhook` with your `WA_VERIFY_TOKEN`, and subscribe to `messages`.

On Vercel the CRM refreshes every 5 seconds (no live connection), and the ngrok/tunnel features are not used. Existing local data can be copied once with `npm run migrate`.
