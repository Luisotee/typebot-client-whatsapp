# Typebot Client WhatsApp

This project connects [Typebot](https://typebot.io/) conversational bots to WhatsApp using the WhatsApp Cloud API. It acts as a middleware, forwarding WhatsApp messages to Typebot and sending Typebot's responses back to WhatsApp users.

## Features

- Receives WhatsApp messages via webhook
- Forwards messages to a Typebot flow
- Sends Typebot responses (text, video, etc.) back to WhatsApp
- Supports session management and reactions (queued, working, done, error)
- Persists messages and sessions using SQLite (via Prisma)

## Requirements

- Node.js 18+
- WhatsApp Cloud API credentials
- Typebot API credentials
- A public domain for webhook delivery

## Setup

1. **Clone the repository:**

   ```bash
   git clone https://github.com/yourusername/typebot-client-whatsapp.git
   cd typebot-client-whatsapp
   ```

2. **Install dependencies:**

   ```bash
   yarn install
   ```

3. **Configure environment variables:**

   - Copy `.env` and fill in your WhatsApp and Typebot credentials.

4. **Setup the database and generate Prisma client:**

   ```bash
   yarn build
   ```

5. **Start the server:**

   ```bash
   yarn start
   ```

6. **Set your WhatsApp webhook URL:**

   - Use your own domain, e.g. `https://your-domain.com/webhook`

## Environment Variables

See `.env` for all required variables:

- `TYPEBOT_ID`, `TYPEBOT_API_KEY`, `TYPEBOT_API_BASE`
- `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_API_URL`
- `DATABASE_URL`
- Reaction emoji variables (optional)

## Endpoints

- `GET /webhook` — WhatsApp webhook verification
- `POST /webhook` — Receives WhatsApp messages and handles Typebot integration

## Customization

- Edit the Typebot flow in your Typebot dashboard.
- Adjust message handling logic in `src/index.ts` as needed.

## License

MIT

---

**Note:** This project is not affiliated with WhatsApp or Typebot. Use at your own risk.
