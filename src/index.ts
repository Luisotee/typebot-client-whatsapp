import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
} from "@whiskeysockets/baileys";
import { PrismaClient } from "@prisma/client";
import qrcode from "qrcode-terminal";

// Load environment variables
import "dotenv/config";

const prisma = new PrismaClient();

const TYPEBOT_ID = process.env.TYPEBOT_ID!;
const TYPEBOT_API_KEY = process.env.TYPEBOT_API_KEY!;
const TYPEBOT_API_BASE =
  process.env.TYPEBOT_API_BASE || "https://bot.luisotee.com/api/v1";
const TYPEBOT_API_URL = `${TYPEBOT_API_BASE}/typebots/${TYPEBOT_ID}/preview/startChat`;
const TYPEBOT_SESSION_URL = `${TYPEBOT_API_BASE}/preview/sessions`;

async function start() {
  const { state, saveCreds } = await useMultiFileAuthState("auth_info");
  const sock = makeWASocket({
    auth: state,
    // Remove the deprecated printQRInTerminal option
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log("QR Code received, scan it with your phone!");
      qrcode.generate(qr, { small: true });
    }

    if (connection === "close") {
      // Fix: lastDisconnect does not have 'reason', so check error or always reconnect unless error is fatal
      const isLoggedOut =
        (lastDisconnect?.error as any)?.output?.statusCode === DisconnectReason.loggedOut;
      const shouldReconnect = !isLoggedOut;
      console.log(
        "Connection closed due to ",
        lastDisconnect?.error,
        ", reconnecting ",
        shouldReconnect
      );
      if (shouldReconnect) {
        start();
      }
    } else if (connection === "open") {
      console.log("Opened connection");
    }
  });

  sock.ev.on("messages.upsert", async ({ messages }) => {
    const msg = messages[0];
    if (!msg.message?.conversation) return;

    const waId = msg.key.remoteJid!;
    const text = msg.message.conversation;

    // Log incoming message
    await prisma.message.create({
      data: { waId, content: text, direction: "in" },
    });

    // Find last sessionId
    let sessionId: string | null = null;
    const lastMsg = await prisma.message.findFirst({
      where: { waId, sessionId: { not: null } },
      orderBy: { timestamp: "desc" },
    });

    let needNewSession = false;
    if (lastMsg) {
      sessionId = lastMsg.sessionId;
      // Try to continue session
      const continueRes = await fetch(
        `${TYPEBOT_SESSION_URL}/${sessionId}/continueChat`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${TYPEBOT_API_KEY}`,
          },
          body: JSON.stringify({
            message: {
              type: "text",
              text: text,
            },
            textBubbleContentFormat: "richText",
          }),
        }
      );
      const continueData = await continueRes.json();
      console.log("Typebot continueChat response:", continueData);

      if (continueRes.status === 404 || continueData.code === "NOT_FOUND") {
        needNewSession = true;
      }
    } else {
      needNewSession = true;
    }

    let typebotResponse: any;

    if (needNewSession) {
      // Start new session
      const res = await fetch(TYPEBOT_API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${TYPEBOT_API_KEY}`,
        },
        body: JSON.stringify({
          message: {
            type: "text",
            text: text,
          },
          textBubbleContentFormat: "richText",
        }),
      });
      typebotResponse = await res.json();
      console.log("Typebot startChat response:", typebotResponse);
      sessionId = typebotResponse.sessionId;
    } else {
      // Continue session
      const continueRes = await fetch(
        `${TYPEBOT_SESSION_URL}/${sessionId}/continueChat`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${TYPEBOT_API_KEY}`,
          },
          body: JSON.stringify({
            message: {
              type: "text",
              text: text,
            },
            textBubbleContentFormat: "richText",
          }),
        }
      );
      typebotResponse = await continueRes.json();
      console.log("Typebot continueChat response:", typebotResponse);
    }

    // Save sessionId for this message
    await prisma.message.updateMany({
      where: { waId, content: text, direction: "in", sessionId: null },
      data: { sessionId },
    });

    // Extract the latest message from the messages array
    let reply = "...";
    if (Array.isArray(typebotResponse.messages) && typebotResponse.messages.length > 0) {
      // Find the last message with type 'text'
      const lastTextMsg = [...typebotResponse.messages]
        .reverse()
        .find((m: any) => m.type === "text");

      // Try different possible content structures
      reply =
        lastTextMsg?.content?.richText?.[0]?.children?.[0]?.text ||
        lastTextMsg?.content?.text ||
        lastTextMsg?.content?.html ||
        lastTextMsg?.content ||
        "...";

      console.log("Extracted reply:", reply);
      console.log("Full text message object:", JSON.stringify(lastTextMsg, null, 2));
    }

    // Log outgoing message
    await prisma.message.create({
      data: { waId, content: reply, direction: "out", sessionId },
    });

    // Send reply to WhatsApp
    await sock.sendMessage(waId, { text: reply });
  });
}

start();
