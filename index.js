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
const fs = require("fs");

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
const authPath = path.join(__dirname, "auth_info_baileys");

function getWhatsAppStatus() {
  return connectionStatus;
}

function bindSocketEvents(sock, saveCreds) {
  // Save auth credentials automatically
  sock.ev.on("creds.update", saveCreds);

  // Handle connection updates
  sock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr && !USE_PAIRING_CODE) {
      console.log("\n[WhatsApp] Scan this QR Code to log in:");
      qrcode.generate(qr, { small: true });
    }

    if (connection === "close") {
      connectionStatus = "Disconnected / Reconnecting";
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const isRegistered = sock?.authState?.creds?.registered;

      console.log(`[WhatsApp] Connection closed (code: ${statusCode}, registered: ${Boolean(isRegistered)})`);

      // If registered and logged out explicitly
      if (statusCode === DisconnectReason.loggedOut && isRegistered) {
        console.log("[WhatsApp] Logged out from registered session.");
        await notifyAdmin("⚠️ WhatsApp Bot was logged out from device. Use /pair <number> to re-link.");
        try {
          fs.rmSync(authPath, { recursive: true, force: true });
        } catch (e) {}
      } else if (!isRegistered) {
        // Not registered yet and connection closed/timed out
        console.log("[WhatsApp] Temporary pairing session expired. Ready for next attempt...");
        try {
          fs.rmSync(authPath, { recursive: true, force: true });
        } catch (e) {}
      }

      // Automatically reconnect
      setTimeout(() => {
        startWhatsAppBot().catch(() => {});
      }, 3500);
    } else if (connection === "open") {
      connectionStatus = "Connected (Online)";
      console.log("\n=======================================================");
      console.log("✅ WHATSAPP AD ASSISTANT BOT IS NOW ONLINE & CONNECTED!");
      console.log("=======================================================\n");
      await notifyAdmin("✅ WhatsApp AD Assistant Bot is now connected and online!");
    }
  });

  // Handle incoming messages
  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") return;

    for (const msg of messages) {
      if (!msg.message || msg.key.fromMe) continue;
      const jid = msg.key.remoteJid;
      if (!jid || jid.endsWith("@broadcast") || jid.endsWith("@g.us")) continue;

      const senderPhone = cleanPhoneNumber(jid.split("@")[0]);

      if (!isNumberAllowed(senderPhone)) {
        console.log(`[Whitelist] Ignored message from unlisted number: +${senderPhone}`);
        continue;
      }

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
        // Step 1: Realistic delay before reading message (2.5s - 5.0s) to prevent bot detection
        const readDelay = 2500 + Math.floor(Math.random() * 2500);
        await delay(readDelay);

        // Step 2: Mark as read (blue ticks appear like a real human opened the chat)
        await sock.readMessages([msg.key]);

        // Step 3: Thinking pause after reading before typing starts (1.5s - 3.0s)
        const thinkDelay = 1500 + Math.floor(Math.random() * 1500);
        await delay(thinkDelay);

        // Step 4: Start WhatsApp typing presence
        await sock.sendPresenceUpdate("composing", jid);

        // Step 5: Generate response (AI or authentic casual friend reply)
        const aiReply = await getAIResponse(jid, conversationText);

        // Step 6: Realistic typing duration based on message length (3.5s - 7.5s)
        const typingDuration = 3500 + Math.floor(Math.random() * 2000) + Math.min(aiReply.length * 35, 3000);
        await delay(typingDuration);

        // Step 7: Send message and reset typing presence to paused
        await sock.sendMessage(jid, { text: aiReply });
        await sock.sendPresenceUpdate("paused", jid);

        const totalDelay = ((readDelay + thinkDelay + typingDuration) / 1000).toFixed(1);
        console.log(`[AD Replied in ${totalDelay}s] To ${contactName}: "${aiReply}"`);

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

async function requestNewPairingCode(phoneNumber) {
  const clean = cleanPhoneNumber(phoneNumber);
  if (!clean) {
    throw new Error("Invalid phone number format. Use country code without + (e.g. 923001234567)");
  }

  // End existing socket if any
  try {
    if (waSock) {
      waSock.end(undefined);
    }
  } catch (e) {}

  // Clean stale auth data
  try {
    fs.rmSync(authPath, { recursive: true, force: true });
  } catch (e) {}

  // Wait 1 second before recreating
  await delay(1000);

  const { state, saveCreds } = await useMultiFileAuthState(authPath);
  const { version } = await fetchLatestBaileysVersion();

  waSock = makeWASocket({
    version,
    logger: pino({ level: "silent" }),
    printQRInTerminal: false,
    auth: state,
    browser: ["Ubuntu", "Chrome", "20.0.04"]
  });

  setWhatsAppClient(waSock);
  bindSocketEvents(waSock, saveCreds);

  // Wait 3 seconds for the socket handshake to initialize
  await delay(3000);

  console.log(`[WhatsApp] Requesting pairing code for +${clean}...`);
  const code = await waSock.requestPairingCode(clean);
  const formattedCode = code?.match(/.{1,4}/g)?.join("-") || code;

  console.log("\n=======================================================");
  console.log(`📱 YOUR WHATSAPP PAIRING CODE: ${formattedCode}`);
  console.log("Enter this code in: WhatsApp > Linked Devices > Link with Phone Number");
  console.log("=======================================================\n");

  return formattedCode;
}

async function startWhatsAppBot() {
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
  bindSocketEvents(waSock, saveCreds);

  // If phone number is configured in .env and not registered
  if (USE_PAIRING_CODE && !state.creds.registered && WHATSAPP_PHONE_NUMBER) {
    setTimeout(async () => {
      try {
        const code = await requestNewPairingCode(WHATSAPP_PHONE_NUMBER);
        await notifyAdmin(`📱 WhatsApp Pairing Code: ${code}\nEnter this in WhatsApp > Linked Devices > Link with Phone Number`);
      } catch (err) {
        console.error("[WhatsApp] Error requesting pairing code:", err.message);
      }
    }, 2000);
  }
}

// Start Telegram Admin Bridge and WhatsApp Client
console.log("Starting WhatsApp AD Assistant System...");
startTelegramPolling(getWhatsAppStatus, requestNewPairingCode);
startWhatsAppBot().catch((err) => {
  console.error("Fatal startup error:", err);
});
