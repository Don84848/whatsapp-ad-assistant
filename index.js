const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  delay
} = require("@whiskeysockets/baileys");
const pino = require("pino");
const path = require("path");
const fs = require("fs");

const {
  isNumberAllowed,
  cleanPhoneNumber
} = require("./config");
const { getAIResponse } = require("./aiBrain");
const {
  startTelegramPolling,
  notifyAdmin,
  registerSessionController
} = require("./telegramAdmin");

// Multi-account sessions map: id (1 or 2) -> { sock, status, authPath }
const sessions = new Map();

function getAuthPath(sessionId) {
  return path.join(__dirname, sessionId === 1 ? "auth_info_baileys" : `auth_info_baileys_${sessionId}`);
}

function getSessionStatus(sessionId) {
  return sessions.get(sessionId)?.status || "Disconnected";
}

function getAllStatuses() {
  const s1 = getSessionStatus(1);
  const s2 = getSessionStatus(2);
  return { s1, s2 };
}

function isSessionRegistered(sessionId) {
  const s = sessions.get(sessionId);
  return Boolean(s?.sock?.authState?.creds?.registered);
}

function bindSocketEvents(sock, saveCreds, sessionId) {
  const authPath = getAuthPath(sessionId);

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect } = update;
    const sessionData = sessions.get(sessionId) || {};

    if (connection === "close") {
      sessionData.status = "Disconnected / Reconnecting";
      sessions.set(sessionId, sessionData);

      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const isRegistered = sock?.authState?.creds?.registered;

      console.log(`[WhatsApp Account ${sessionId}] Connection closed (code: ${statusCode}, registered: ${Boolean(isRegistered)})`);

      if (statusCode === DisconnectReason.loggedOut && isRegistered) {
        console.log(`[WhatsApp Account ${sessionId}] Logged out from registered device.`);
        await notifyAdmin(`⚠️ WhatsApp Account ${sessionId} was logged out from device. Use /pair${sessionId === 1 ? "" : "2"} <number> to re-link.`);
        try {
          fs.rmSync(authPath, { recursive: true, force: true });
        } catch (e) {}
      } else if (!isRegistered) {
        try {
          fs.rmSync(authPath, { recursive: true, force: true });
        } catch (e) {}
      }

      // Automatically reconnect if credentials directory exists
      setTimeout(() => {
        if (fs.existsSync(authPath)) {
          startSession(sessionId).catch(() => {});
        }
      }, 4000);
    } else if (connection === "open") {
      sessionData.status = "Connected (Online)";
      sessions.set(sessionId, sessionData);
      console.log(`\n=======================================================`);
      console.log(`✅ WHATSAPP ACCOUNT ${sessionId} IS ONLINE & CONNECTED!`);
      console.log(`=======================================================\n`);
      await notifyAdmin(`✅ WhatsApp Account ${sessionId} is now online and connected!`);
    }
  });

  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") return;

    for (const msg of messages) {
      if (!msg.message || msg.key.fromMe) continue;
      const jid = msg.key.remoteJid;

      // STRICT SAFETY: 1-on-1 private chats only (@s.whatsapp.net)
      // Never touch WhatsApp Channels (@newsletter), Status updates (@broadcast), or Groups (@g.us)
      if (
        !jid ||
        !jid.endsWith("@s.whatsapp.net") ||
        jid === "status@broadcast" ||
        jid.endsWith("@newsletter") ||
        jid.endsWith("@broadcast") ||
        jid.endsWith("@g.us") ||
        jid.startsWith("0@")
      ) {
        continue;
      }

      const senderPhone = cleanPhoneNumber(jid.split("@")[0]);
      if (!isNumberAllowed(senderPhone)) continue;

      const conversationText =
        msg.message.conversation ||
        msg.message.extendedTextMessage?.text ||
        msg.message.imageMessage?.caption ||
        msg.message.videoMessage?.caption ||
        "";

      if (!conversationText.trim()) continue;

      const contactName = msg.pushName || `+${senderPhone}`;
      console.log(`[WA Account ${sessionId} Msg] From ${contactName} (+${senderPhone}): "${conversationText}"`);

      try {
        // Step 1: Human thinking delay before typing (3.0s - 5.5s) to avoid bot detection
        const thinkDelay = 3000 + Math.floor(Math.random() * 2500);
        await delay(thinkDelay);

        // NOTE: We intentionally do NOT call sock.readMessages()
        // Incoming messages stay UNREAD on phone so you can easily review them!

        // Step 2: Show WhatsApp typing indicator
        await sock.sendPresenceUpdate("composing", jid);

        // Step 3: Generate response
        const aiReply = await getAIResponse(jid, conversationText);

        // Step 4: Natural typing duration based on message length
        const typingDuration = 3000 + Math.floor(Math.random() * 1500) + Math.min(aiReply.length * 35, 2500);
        await delay(typingDuration);

        // Step 5: Send message and reset typing presence to paused
        await sock.sendMessage(jid, { text: aiReply });
        await sock.sendPresenceUpdate("paused", jid);

        const totalDelay = ((thinkDelay + typingDuration) / 1000).toFixed(1);
        console.log(`[AD WA${sessionId} Replied in ${totalDelay}s] To ${contactName}: "${aiReply}"`);

        const notifyText = `💬 WhatsApp Account ${sessionId} Chat:
From: ${contactName} (+${senderPhone})
Msg: "${conversationText}"
AD: "${aiReply}"`;
        await notifyAdmin(notifyText);
      } catch (err) {
        console.error(`[Error WA Account ${sessionId}] Failed to process message from ${senderPhone}:`, err.message);
      }
    }
  });
}

async function startSession(sessionId) {
  const authPath = getAuthPath(sessionId);

  // If this session has never been paired and is not Account 1, leave as unlinked
  if (!fs.existsSync(authPath) && sessionId !== 1) {
    sessions.set(sessionId, { sock: null, status: "Not Linked", authPath });
    return;
  }

  const { state, saveCreds } = await useMultiFileAuthState(authPath);
  const { version, isLatest } = await fetchLatestBaileysVersion();

  console.log(`[WhatsApp Account ${sessionId}] Using Baileys version ${version.join(".")}, isLatest: ${isLatest}`);

  const sock = makeWASocket({
    version,
    logger: pino({ level: "silent" }),
    printQRInTerminal: false,
    auth: state,
    generateHighQualityLinkPreview: true,
    browser: ["Ubuntu", "Chrome", "20.0.04"]
  });

  sessions.set(sessionId, { sock, status: "Connecting...", authPath });
  bindSocketEvents(sock, saveCreds, sessionId);
}

async function requestPairing(phoneNumber, sessionId = 1) {
  const clean = cleanPhoneNumber(phoneNumber);
  if (!clean) {
    throw new Error("Invalid phone number format. Use country code without + (e.g. 923001234567)");
  }

  const authPath = getAuthPath(sessionId);
  const existing = sessions.get(sessionId);

  // Close existing socket if any
  try {
    if (existing?.sock) {
      existing.sock.end(undefined);
    }
  } catch (e) {}

  // Clean stale auth data
  try {
    fs.rmSync(authPath, { recursive: true, force: true });
  } catch (e) {}

  await delay(1000);

  const { state, saveCreds } = await useMultiFileAuthState(authPath);
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    logger: pino({ level: "silent" }),
    printQRInTerminal: false,
    auth: state,
    browser: ["Ubuntu", "Chrome", "20.0.04"]
  });

  sessions.set(sessionId, { sock, status: "Pairing...", authPath });
  bindSocketEvents(sock, saveCreds, sessionId);

  await delay(3000);

  console.log(`[WhatsApp Account ${sessionId}] Requesting pairing code for +${clean}...`);
  const code = await sock.requestPairingCode(clean);
  const formattedCode = code?.match(/.{1,4}/g)?.join("-") || code;
  return formattedCode;
}

async function logoutSession(sessionId = 1) {
  const authPath = getAuthPath(sessionId);
  const existing = sessions.get(sessionId);

  try {
    if (existing?.sock) {
      await existing.sock.logout();
      existing.sock.end(undefined);
    }
  } catch (e) {}

  try {
    fs.rmSync(authPath, { recursive: true, force: true });
  } catch (e) {}

  sessions.set(sessionId, { sock: null, status: "Logged Out", authPath });
}

async function sendMessage(phoneNumber, text, sessionId = 1) {
  const clean = cleanPhoneNumber(phoneNumber);
  const existing = sessions.get(sessionId);
  if (!existing?.sock || !existing?.sock?.authState?.creds?.registered) {
    throw new Error(`WhatsApp Account ${sessionId} is not connected.`);
  }
  const jid = `${clean}@s.whatsapp.net`;
  await existing.sock.sendMessage(jid, { text });
}

// Register controller with Telegram admin bridge
registerSessionController({
  getAllStatuses,
  isSessionRegistered,
  requestPairing,
  logoutSession,
  sendMessage
});

// Start Telegram Admin Bridge and initial WhatsApp sessions
console.log("Starting WhatsApp AD Assistant Multi-Account System...");
startTelegramPolling();

// Initialize Account 1 (and Account 2 if auth folder exists)
startSession(1).catch((err) => console.error("Account 1 startup error:", err));
if (fs.existsSync(getAuthPath(2))) {
  startSession(2).catch((err) => console.error("Account 2 startup error:", err));
} else {
  sessions.set(2, { sock: null, status: "Not Linked", authPath: getAuthPath(2) });
}
