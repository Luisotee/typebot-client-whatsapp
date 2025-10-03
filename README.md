# Typebot Client WhatsApp

This project connects [Typebot](https://typebot.io/) conversational bots to WhatsApp using either the official WhatsApp Cloud API or the unofficial Baileys library. It acts as a middleware, forwarding WhatsApp messages to Typebot and sending Typebot's responses back to WhatsApp users.

## Features

- **Dual WhatsApp Integration**: Choose between Meta's official WhatsApp Cloud API or the unofficial Baileys library
- Receives WhatsApp messages (via webhook for Meta API or direct connection for Baileys)
- Forwards messages to a Typebot flow
- Sends Typebot responses (text, video, images, etc.) back to WhatsApp
- **Interactive Fallbacks**: For Baileys, buttons and lists are converted to numbered text options
- Supports session management and reactions (queued, working, done, error)
- Audio transcription support (optional)
- Persists messages and sessions using SQLite (via Prisma)

## WhatsApp Integration Modes

### 1. Meta WhatsApp Cloud API (Official)
- ✅ Interactive buttons and lists
- ✅ Media messages (images, videos, audio, documents)
- ✅ Message status tracking
- ❌ Requires business verification for production
- ❌ Limited to approved message templates for marketing

### 2. Baileys (Unofficial)
- ✅ Direct connection to WhatsApp Web
- ✅ Media messages (images, videos, audio, documents)
- ✅ No business verification required
- ❌ Interactive buttons/lists converted to numbered text fallbacks
- ❌ Potential for account suspension if detected by WhatsApp
- ⚠️ Use at your own risk

## Requirements

- Node.js 18+
- **For Meta API**: WhatsApp Cloud API credentials and a public domain for webhooks
- **For Baileys**: A WhatsApp account and QR code scanning capability
- Typebot API credentials

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
