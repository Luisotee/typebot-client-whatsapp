import "dotenv/config";
import { ACCESS_TOKEN, PHONE_NUMBER_ID, WHATSAPP_API_URL } from "./config";

export const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function sendWhatsappText(to: string, text: string) {
  return sendWhatsappMessage({
    to,
    type: "text",
    text: { body: text },
  });
}

async function sendWhatsappImage(to: string, imageUrl: string, caption?: string) {
  return sendWhatsappMessage({
    to,
    type: "image",
    image: { link: imageUrl, caption },
  });
}

async function sendWhatsappVideo(to: string, videoUrl: string, caption?: string) {
  const response = await sendWhatsappMessage({
    to,
    type: "video",
    video: { link: videoUrl, caption },
  });
  await delay(10000);
  return response;
}

async function sendWhatsappButtons(
  to: string,
  bodyText: string,
  buttons: Array<{ id: string; title: string }>
) {
  return sendWhatsappMessage({
    to,
    type: "interactive",
    interactive: {
      type: "button",
      body: { text: bodyText },
      action: {
        buttons: buttons.map((btn, index) => ({
          type: "reply",
          reply: {
            id: btn.id,
            title: btn.title.substring(0, 20), // WhatsApp limit
          },
        })),
      },
    },
  });
}

async function sendWhatsappList(
  to: string,
  bodyText: string,
  buttonText: string,
  sections: Array<{
    title: string;
    rows: Array<{ id: string; title: string; description?: string }>;
  }>
) {
  return sendWhatsappMessage({
    to,
    type: "interactive",
    interactive: {
      type: "list",
      body: { text: bodyText },
      action: {
        button: buttonText,
        sections,
      },
    },
  });
}

async function sendWhatsappReaction(to: string, messageId: string, emoji: string) {
  return sendWhatsappMessage({
    to,
    type: "reaction",
    reaction: { message_id: messageId, emoji },
  });
}

async function sendWhatsappMessage(payload: any) {
  const response = await fetch(`${WHATSAPP_API_URL}/${PHONE_NUMBER_ID}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${ACCESS_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      ...payload,
    }),
  });
  if (!response.ok) {
    const error = await response.text();
    console.error("Failed to send WhatsApp message:", error);
  }
  return response;
}

export {
  sendWhatsappText,
  sendWhatsappImage,
  sendWhatsappVideo,
  sendWhatsappButtons,
  sendWhatsappList,
  sendWhatsappReaction,
};
