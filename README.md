# عطور الريحان — Alrayhan Perfumes (Full Local System)

A complete, self-contained e-commerce system for the Alrayhan Perfumes shop: a real Node.js
backend with a JSON-file database, and the full storefront + admin frontend wired to it.
Everything the shop needs to run **locally on one computer** — no cloud account, no external
database, no paid services required to get started.

## What's actually real here

- **Product catalog with live inventory** — every price, quantity, and availability flag lives
  in `server/data/products.json` and is served through a real API. Editing it in the admin
  panel updates the database file on disk immediately.
- **Full admin control** — add, edit, or delete *any* product, and add, rename, or delete
  entire brand/group sections (with cascading deletion of that brand's products). All gated
  behind a real server-checked admin password, not a hardcoded string in the page source.
- **Real accounts** — phone sign-up and Google/Apple-style sign-up live in
  `server/data/users.json`. One account per phone number or per e-mail, enforced by the server.
  Accounts hold orders, favourites and pre-orders (there is no wallet).
- **Real orders with email confirmation** — checkout places the order directly on the server
  (no WhatsApp redirect). The order is saved to `server/data/orders.json` and a formatted
  Arabic notification email is sent to the shop owner through **nodemailer**.
- **Light is a real local AI agent** — every answer comes from Ollama running on your own
  machine. No cloud API key, no per-message cost. There is no rule-based mode: keep Ollama
  running (the server starts it automatically if it's installed).
- **A separate admin web app** at `/admin` — its own login screen and interface for managing
  products, brand groups, orders, and stats. The customer-facing storefront no longer contains
  any admin login, panel, or management code at all — management happens exclusively in `/admin`.
- **Product photos (optional per item)** — upload a real photo for any product from the admin
  app, or leave it and the card keeps its generated symbol. You can switch back to the symbol
  at any time. Photos are stored in `server/uploads/` and recorded in the database.
- **Dark and light mode** — a toggle in the site header, remembered per visitor. It also
  respects the device's own light/dark preference on a first visit.
- **Branch map links** — both branch cards link straight to their location on Google Maps.
- **Scent pyramid per product** — an optional three-part triangle (المقدمة / القلب / القاعدة)
  shown in the product preview, editable per product from the admin app.
- **Delivery fee** — home delivery adds a flat 5,000 IQD, calculated on the server so it can't
  be bypassed. Branch pickup stays free. Change the amount with `DELIVERY_FEE` in `.env`.

## What's still a local/demo stand-in (and what to do about it before going public)

- **Phone verification codes are shown on-screen**, not texted, because there's no SMS
  provider configured. Search `server/server.js` for `send-code` and wire in a real provider
  (Twilio, etc.) before this ever goes on the public internet.
- **Order emails need a Gmail app password** to actually send. Until you set it in the admin
  panel (tab «البريد»), orders are still saved normally and their emails wait in a queue that
  sends them as soon as mail works — checkout never breaks.
- **Google/Apple sign-in is simulated** with a simple name+email form — there's no real OAuth
  handshake. Wiring up real Google/Apple sign-in requires registering the app with each
  provider and doing the token verification server-side.
- **The JSON-file database** is perfect for one shop running locally, but it is not built for
  many simultaneous writers. If this ever needs to run on a real public server with real
  traffic, migrate `server/db.js` to a proper database (Postgres, MySQL, etc.) — the rest of
  the code won't need to change much since it all goes through `readTable`/`writeTable`.
- **The admin token is a shared password**, not a per-person login. Fine for one shop owner;
  not fine for a team unless you add real per-user admin accounts.

## Requirements

- [Node.js](https://nodejs.org) version 18 or newer (check with `node -v`)

That's it — no database server, no Docker, no build step.

## Setup (one-time)

```bash
cd server
npm install
```

This installs four small, pure-JavaScript packages (express, cors, multer, dotenv) — nothing
that needs a compiler, so this works the same on Windows, Mac, or Linux.

Optional: copy `server/.env.example` to `server/.env` if you want to change the admin
password or the port away from the defaults.

## Running it

```bash
cd server
npm start
```

Then open **http://localhost:3000** in your browser. That's the whole site — storefront,
cart, accounts, and the admin panel, all served from the same address.

On Windows you can also just double-click `start.bat` in the project root (after running
`npm install` once inside `server/`). On Mac/Linux, `./start.sh` does the same thing.

## Admin password

There is no built-in default password. Copy `server/.env.example` to `server/.env` and set
`ADMIN_PASSWORD` to a strong password of your choice, then restart the server.

If `ADMIN_PASSWORD` is not set, the server generates a temporary random password on every
start and prints it in the console, so you can still log in while testing locally.

Enter it via the small "لوحة التحكم" link at the bottom of the site, or the menu icon next to
the logo.

## What was removed / simplified

- The customer-facing storefront no longer has any admin login, panel, or "add product/brand"
  controls baked into it — all of that lives only in the separate `/admin` app now, for a
  cleaner and more secure separation between what customers and the shop owner can reach.
- The homepage's "تعرّف على تركيبة كل ماسة" (diamond-collection pyramid) section has been
  removed. The three-part scent pyramid on each product's own preview card is unaffected and
  still works the same way.

## Sign up with phone or email

The sign-in window has two tabs: **رقم الهاتف** (code sent by WhatsApp) and
**البريد الإلكتروني** (code sent by email using the same SMTP settings as order emails).
Both use 6-digit codes that expire after 5 minutes. If WhatsApp or SMTP isn't set up yet,
that option runs in demo mode and shows the code on screen.

## WhatsApp verification codes (sign-up OTP)

When a customer signs up with their phone number, the 6-digit code is sent to them on
**WhatsApp** through Meta's official WhatsApp Business Cloud API. Until you fill in the
settings below, the site stays in demo mode and shows the code on screen.

Built in: codes expire after 5 minutes, a new code can be requested once a minute, and
5 wrong attempts cancel the code.

**One-time setup (Meta):**

1. Create a Meta Business account and an app at <https://developers.facebook.com/apps>
   (type: *Business*), then add the **WhatsApp** product.
2. Add and verify the phone number the codes will come from (it must not already be used in the
   normal WhatsApp app). Copy its **Phone number ID**.
3. In WhatsApp Manager → *Message templates*, create a template in the **Authentication**
   category (e.g. named `otp_code`, language Arabic) with a **Copy code** button. Wait for approval.
4. Create a **System User** in Business Settings, give it the app, and generate a **permanent
   token** with `whatsapp_business_messaging` permission.
5. Put the values in `server/.env`:

```
WHATSAPP_TOKEN=your-permanent-token
WHATSAPP_PHONE_NUMBER_ID=123456789012345
WHATSAPP_OTP_TEMPLATE=otp_code
WHATSAPP_TEMPLATE_LANG=ar
WHATSAPP_OTP_BUTTON=true
```

Restart the server. Meta charges per authentication message (check current Iraq pricing in
your WhatsApp Manager). Never commit `server/.env` — the token gives full access to send messages.

## Setting up order-confirmation emails

When a customer checks out, the order is placed **directly** — no WhatsApp redirect — and the
server emails you the details automatically.

To turn the emails on (no file editing, no restart):

1. Turn on 2-Step Verification on your Google account, then create an **App Password** at
   <https://myaccount.google.com/apppasswords> (Gmail will not accept your normal password).
2. Open the admin panel → tab **«البريد»**, enter the Gmail address, the 16-character app
   password, and the address where orders should arrive. Press **«حفظ والتحقق»**, then
   **«إرسال إيميل تجريبي»** to confirm.

The settings are saved in `server/data/mail-settings.json`. That file is in `.gitignore`, so it
is **never uploaded to GitHub** and never overwritten by a git pull or re-upload; it survives
every server restart. The admin panel never shows the saved password again.

**If the internet or Gmail is down**, orders are still saved. Their emails wait in a queue that
retries every 2 minutes and right after the server starts, so every order is emailed once the
connection is back. The «الطلبات» tab shows which emails are still waiting.

**Never put the app password in a file on GitHub.** Google revokes passwords that leak, and
anyone who sees it can send email as your shop. Changing your Google account password also
revokes every app password, so you'd then create a new one and save it in the panel again.

(Old way, still supported: the `SMTP_*` lines in `server/.env`. Settings saved in the panel win.)

## Putting it on GitHub

See **`GITHUB-SETUP.md`** (Arabic) for a step-by-step guide using GitHub Desktop or the
command line. The included `.gitignore` already keeps your `.env` passwords, customer accounts,
orders, and uploaded photos out of the repository.

## Putting it online

See **`HOSTING-GUIDE.md`** (in Arabic) for a full walkthrough: buying a server and a domain,
pointing the domain at the server, deploying, keeping it running with pm2, turning on HTTPS,
and setting up backups.

## Managing brand groups

From the admin app's **الخطوط** tab you can:

- **Add** a whole new brand/group, or **delete** one entirely (deleting a brand also removes
  every product inside it, with a warning telling you how many first)
- **Edit** a brand's name and short tag at any time
- **Upload an advertising photo** for the brand — this becomes the background image for that
  brand's slide in the homepage showcase at the top of the site. Leave it unset and the slide
  keeps its generated gradient-and-icon look instead.

The homepage showcase itself is fully dynamic: it's built from whatever brands actually exist
in the database at the moment someone loads the site, so adding, renaming, or removing a brand
is reflected there immediately — no code changes needed.

## Product photos

Every product can have a real photo, or keep its auto-generated bottle/gem symbol — it's
per-item, so you can photograph your best sellers first and leave the rest as symbols.

In the admin app's **المنتجات** tab each row has a small square thumbnail on the right:

- Click it to pick an image (JPG, PNG, WEBP, or GIF — up to 5 MB)
- The photo appears immediately on the storefront: product cards, the cart, the quick-view
  popup, and even the Light chat suggestions
- Click **إزالة الصورة** to delete it and go back to the default symbol
- Replacing a photo automatically deletes the old file, so `server/uploads/` stays tidy

## Dark and light mode

The header has a sun/moon toggle. The choice is saved in the visitor's browser, so it sticks
between visits. On someone's very first visit the site follows whatever their device is set
to, then respects their manual choice from then on.

Both themes use the same gold-accented identity — light mode is a warm ivory palette rather
than a stark white, so it still looks like the same shop.

The homepage showcase (hero/advertising section) at the top intentionally **stays dark in
both themes** — like a spotlighted display case rather than a plain page background. That's a
deliberate design choice (dramatic imagery reads better with deep contrast), not a bug.

## The admin management app

Open **http://localhost:3000/admin** — it's a separate application from the storefront, with
its own login, built specifically for running the shop:

- **المنتجات** — every product grouped by brand. Edit price, stock quantity, and availability
  inline (saved instantly), or open the full editor to change names, descriptions, size, and
  flags. Add or delete any product, including the original catalog items.
- **الخطوط** — add, rename, recolor, or delete entire brand groups. Deleting a brand also
  deletes its products, and the app warns you how many before you confirm.
- **الطلبات** — every order that comes in, with customer details, items, totals, and whether
  the notification email went out. Change status (جديد / مؤكد / تم التسليم / ملغى) or remove
  old records.
- **الإحصائيات** — totals for products, brands, and orders, how many items are out of stock,
  and a per-brand breakdown.

Everything in this app writes to the same database the storefront reads from, so changes are
live on the shop immediately — no rebuild, no restart.

## Project structure

```
alrayhan-system/
├── server/
│   ├── server.js          ← the whole backend API
│   ├── agent.js            ← Light's AI agent (talks to local Ollama)
│   ├── check-ai.js         ← `npm run check-ai` — diagnoses the AI setup
│   ├── mailer.js           ← nodemailer order-notification emails
│   ├── db.js               ← tiny JSON-file database helper
│   ├── package.json
│   ├── .env.example
│   ├── uploads/            ← uploaded product photos live here
│   ├── data/
│   │   ├── products.json   ← the real product database
│   │   ├── brands.json     ← the real brand/group database
│   │   ├── users.json      ← customer accounts (starts empty)
│   │   ├── orders.json     ← every order placed (starts empty)
│   │   └── diamonds.json   ← scent-pyramid notes for the Ibraq Diamond line
├── public/                 ← the customer-facing storefront
│   ├── index.html
│   └── alrayhan_perfumes_logo.jpg
├── admin/                  ← the separate management web app (/admin)
│   └── index.html
├── start.sh
├── start.bat
└── README.md               ← you are here
```

## Resetting the catalog back to the original data

If you ever want to wipe your edits and start over with the original 100-item catalog this
was built from, keep a backup copy of the original `server/data/products.json` and
`brands.json` before you start editing in the admin panel — restoring is just copying those
files back and restarting the server.

## Light — the AI agent

Light always answers with a real language model running through [Ollama](https://ollama.com)
(free, no cloud account, no per-message cost). It holds real conversations: open-ended
questions, comparisons, "which is better for me and why", and follow-ups that remember what
you just asked. Answers are grounded in your live product database. There is no rule-based
fallback mode.

To keep Light always available, the server:

- **starts Ollama by itself** if it's installed but not running (on this same machine);
- **downloads the model** set in `OLLAMA_MODEL` if Ollama has no model yet (first run only);
- **loads the model into memory at startup and keeps it loaded** (`OLLAMA_KEEP_ALIVE`,
  default `-1` = forever), so customers never wait for a cold start;
- **re-checks Ollama every minute**, and retries a question once if Ollama hiccups.

If Ollama is unreachable, Light tells the customer it's reconnecting and gives the WhatsApp
number. The status line under Light's name shows **🧠 ذكاء اصطناعي · متصل** when it's ready.

**GitHub Codespaces:** the `.devcontainer` folder installs Ollama and the model automatically
when a new codespace is created. In an existing codespace, run
`bash .devcontainer/setup-ollama.sh` once. A 2-core codespace has no GPU, so answers are
noticeably slower than on a PC; a 4-core machine type helps.

### How it works (and what was fixed)

- **Only relevant products are sent to the AI.** For each question Light searches the catalog
  (names, brands, notes, scent families like "summer" or "oud", and budgets like "35 الف") and
  sends the ~12 best matches in detail, plus a one-line overview of every brand. Sending the
  whole catalog used to overflow the model's memory, which silently cut off its instructions.
- **Replies stream in word by word**, so customers see Light typing instead of waiting.
- **If your configured model isn't installed, Light uses whichever model you have.**
- **Model output is shown safely** — formatting like **bold** and bullet points is rendered,
  but the AI can never inject HTML or scripts into your page.
- Perfumes the AI mentions appear under its answer as cards with an **أضف** button.

### Setup

1. Install Ollama: <https://ollama.com/download>
2. Download a model (once):
   ```
   ollama pull qwen2.5:3b
   ```
   `qwen2.5:3b` (~2 GB) handles Arabic well and runs on most PCs. On a strong machine
   (16 GB RAM or more) `ollama pull llama3.1` gives smarter answers.
3. In `server/`, copy `.env.example` to `.env` (if you haven't) and make sure `OLLAMA_MODEL`
   matches the model you pulled. (If it doesn't, Light still uses what's installed.)
4. **Check everything with one command:**
   ```
   cd server
   npm run check-ai
   ```
   It tests each step — Ollama running, model installed, a real answer, and how fast — and
   tells you exactly what to fix if anything fails.
5. Start the store with `npm start` (or `start.bat`) and open <http://localhost:3000>.

### Testing it in the store

Open Light and confirm the status line shows **🧠**. Then try:

- `قارن بين ساڤاج وبلو دو شانيل، أيهم أنسب للصيف؟`
- `أريد عطر للصيف بميزانية 35 الف`
- `هدية لزوجتي، شنو تقترح؟`
- then a follow-up such as `وأيهم أثبت؟` — it should remember the previous answer.

To test the safety net, close Ollama and ask something: Light answers in fast mode. Start
Ollama again, wait ~20 seconds, and the next message goes back to the AI.

### Troubleshooting

| Symptom | Fix |
|---|---|
| Status stays on "رد فوري" | Run `npm run check-ai` — it names the exact problem |
| First answer is very slow | Normal: the model loads into memory once. Later answers are faster |
| Every answer is slow (over a minute) | Use a smaller model: `ollama pull qwen2.5:3b` (or `phi3:mini`) |
| Answers cut off with "انقطع الرد" | Raise `OLLAMA_TIMEOUT_MS` in `.env`, or use a smaller model |
| Weak Arabic answers | Try `qwen2.5:3b` or `qwen2.5:7b` — the Qwen family is strongest in Arabic |

The AI is instructed to use only your store's real products, prices, and policies, and to say
plainly when you don't carry something. Small local models can still occasionally make
mistakes, so treat Light as a helpful assistant rather than the final word on prices — the
product cards and checkout always show the real price from the database.

