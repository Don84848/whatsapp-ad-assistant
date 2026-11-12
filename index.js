const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  delay
} = require("@whiskeysockets/baileys");
const pino = require("pino");
const qrcode = require("qrcode-terminal");
const path = require("path");

const {
  USE_PAIRING_CODE,
  WHATSAPP_PHONE_NUMBER,
  isNumberAllowed,
  cleanPhoneNumber
} = require("./config");
const { getAIResponse } = require("./aiBrain");
const {
  startTelegramPolling,
  notifyAdmin,
  setWhatsAppClient
} = require("./telegramAdmin");

let waSock = null;
let connectionStatus = "Disconnected";

function getWhatsAppStatus() {
  return connectionStatus;
}

async function startWhatsAppBot() {
  const authPath = path.join(__dirname, "auth_info_baileys");
  const { state, saveCreds } = await useMultiFileAuthState(authPath);
  const { version, isLatest } = await fetchLatestBaileysVersion();

  console.log(`[WhatsApp] Using Baileys version ${version.join(".")}, isLatest: ${isLatest}`);

  waSock = makeWASocket({
    version,
    logger: pino({ level: "silent" }),
    printQRInTerminal: !USE_PAIRING_CODE,
    auth: state,
    generateHighQualityLinkPreview: true,
    browser: ["Ubuntu", "Chrome", "20.0.04"]
  });

  setWhatsAppClient(waSock);

  // If using pairing code and not yet registered
  if (USE_PAIRING_CODE && !waSock.authState.creds.registered) {
    if (!WHATSAPP_PHONE_NUMBER) {
      console.log("\n=======================================================");
      console.log("⚠️ WHATSAPP_PHONE_NUMBER is not set in .env!");
      console.log("Please set your phone number (e.g. 923001234567) in .env");
      console.log("Or set USE_PAIRING_CODE=false to scan via QR code in terminal.");
      console.log("=======================================================\n");
    } else {
      setTimeout(async () => {
        try {
          const code = await waSock.requestPairingCode(WHATSAPP_PHONE_NUMBER);
          const formattedCode = code?.match(/.{1,4}/g)?.join("-") || code;
          console.log("\n=======================================================");
          console.log(`📲 YOUR WHATSAPP PAIRING CODE: ${formattedCode}`);
          console.log("Enter this code in: WhatsApp > Linked Devices > Link with Phone Number");
          console.log("=======================================================\n");
          await notifyAdmin(`📲 WhatsApp Pairing Code: ${formattedCode}\nEnter this in WhatsApp > Linked Devices > Link with Phone Number`);
        } catch (err) {
          console.error("[WhatsApp] Error requesting pairing code:", err.message);
        }
      }, 3000);
    }
  }

  // Handle connection updates
  waSock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr && !USE_PAIRING_CODE) {
      console.log("\n[WhatsApp] Scan this QR Code to log in:");
      qrcode.generate(qr, { small: true });
    }

    if (connection === "close") {
      connectionStatus = "Disconnected / Reconnecting";
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
      console.log(`[WhatsApp] Connection closed (code: ${statusCode}). Reconnecting: ${shouldReconnect}`);

      if (shouldReconnect) {
        setTimeout(startWhatsAppBot, 4000);
      } else {
        console.log("[WhatsApp] Logged out. Delete auth_info_baileys folder to pair again.");
        await notifyAdmin("⚠️ WhatsApp Bot logged out. Re-pairing needed.");
      }
    } else if (connection === "open") {
      connectionStatus = "Connected (Online)";
      console.log("\n=======================================================");
      console.log("✅ WHATSAPP AD ASSISTANT BOT IS NOW ONLINE & CONNECTED!");
      console.log("=======================================================\n");
      await notifyAdmin("✅ WhatsApp AD Assistant Bot is now connected and online!");
    }
  });

  // Save auth credentials automatically
  waSock.ev.on("creds.update", saveCreds);

  // Handle incoming messages
  waSock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") return;

    for (const msg of messages) {
      // Ignore messages sent by bot itself, status broadcasts, and groups
      if (!msg.message || msg.key.fromMe) continue;
      const jid = msg.key.remoteJid;
      if (!jid || jid.endsWith("@broadcast") || jid.endsWith("@g.us")) continue;

      // Extract sender phone number
      const senderPhone = cleanPhoneNumber(jid.split("@")[0]);

      // Check Whitelist
      if (!isNumberAllowed(senderPhone)) {
        console.log(`[Whitelist] Ignored message from unlisted number: +${senderPhone}`);
        continue;
      }

      // Extract text content from various message types
      const conversationText =
        msg.message.conversation ||
        msg.message.extendedTextMessage?.text ||
        msg.message.imageMessage?.caption ||
        msg.message.videoMessage?.caption ||
        "";

      if (!conversationText.trim()) continue;

      const contactName = msg.pushName || `+${senderPhone}`;
      console.log(`[WhatsApp Msg] From ${contactName} (+${senderPhone}): "${conversationText}"`);

      try {
        // Mark as read
        await waSock.readMessages([msg.key]);

        // Human reading delay (800ms - 1500ms)
        await delay(800 + Math.floor(Math.random() * 700));

        // Show typing indicator
        await waSock.sendPresenceUpdate("composing", jid);

        // Generate AD's response via Groq AI Brain
        const aiReply = await getAIResponse(jid, conversationText);

        // Human typing simulation proportional to length (1.2s - 2.8s)
        const typingDelay = Math.min(Math.max(1200 + aiReply.length * 15, 1200), 2800);
        await delay(typingDelay);

        // Send response
        await waSock.sendMessage(jid, { text: aiReply });
        await waSock.sendPresenceUpdate("available", jid);

        console.log(`[AD Replied] To ${contactName}: "${aiReply}"`);

        // Notify Telegram Admin (@Daraz_Hacker)
        const notifyText = `💬 WhatsApp Chat:
From: ${contactName} (+${senderPhone})
Msg: "${conversationText}"
AD: "${aiReply}"`;
        await notifyAdmin(notifyText);
      } catch (err) {
        console.error(`[Error] Failed to process message from ${senderPhone}:`, err.message);
      }
    }
  });
}

// Start Telegram Admin Bridge and WhatsApp Client
console.log("Starting WhatsApp AD Assistant System...");
startTelegramPolling(getWhatsAppStatus);
startWhatsAppBot().catch((err) => {
  console.error("Fatal startup error:", err);
});
