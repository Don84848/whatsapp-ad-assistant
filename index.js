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

const axios = require("axios");
const {
  isNumberAllowed,
  cleanPhoneNumber
} = require("./config");
const {
  getAIResponse,
  splitIntoBubbles,
  getFollowUpResponse
} = require("./aiBrain");
const {
  startTelegramPolling,
  notifyAdmin,
  registerSessionController
} = require("./telegramAdmin");

// Multi-account sessions map: id (1 or 2) -> { sock, status, authPath }
const sessions = new Map();

// Contact follow-up re-engagement tracker:
// jid -> { consecutiveCount: number, lastUserMsgTime: number, lastBotMsgTime: number, timer: NodeJS.Timeout | null, sessionId: number }
const contactFollowUps = new Map();
const MAX_CONSECUTIVE_FOLLOWUPS = 3; // Maximum 3 bot messages total without reply
const INITIAL_FOLLOWUP_DELAY_MS = 20 * 60 * 1000; // 20 minutes for first follow-up
const SUBSEQUENT_FOLLOWUP_DELAY_MS = 50 * 60 * 1000; // 50 minutes for subsequent follow-ups

function scheduleWhatsAppFollowUp(jid, sessionId) {
  const data = contactFollowUps.get(jid);
  if (!data) return;
  if (data.timer) {
    clearTimeout(data.timer);
    data.timer = null;
  }

  if (data.consecutiveCount >= MAX_CONSECUTIVE_FOLLOWUPS) {
    console.log(`[Follow-up WA] Reached max consecutive limit (${data.consecutiveCount}) for ${jid}. Stopping follow-ups.`);
    return;
  }

  const delayMs = data.consecutiveCount === 1 ? INITIAL_FOLLOWUP_DELAY_MS : SUBSEQUENT_FOLLOWUP_DELAY_MS;
  console.log(`[Follow-up WA] Scheduled follow-up #${data.consecutiveCount + 1} for ${jid} in ${(delayMs / 60000).toFixed(0)}m`);

  data.timer = setTimeout(async () => {
    try {
      const currentData = contactFollowUps.get(jid);
      if (!currentData || currentData.consecutiveCount >= MAX_CONSECUTIVE_FOLLOWUPS) return;

      const s = sessions.get(sessionId);
      if (!s?.sock || !s?.sock?.authState?.creds?.registered) return;

      console.log(`[Follow-up WA] Triggering smart follow-up #${currentData.consecutiveCount + 1} for ${jid}`);

      try {
        await s.sock.sendPresenceUpdate("composing", jid);
      } catch (e) {}

      const followUpText = await getFollowUpResponse(jid);
      const typingDuration = 2000 + Math.floor(Math.random() * 1500);
      await delay(typingDuration);

      const bubbles = splitIntoBubbles(followUpText, 2);
      for (let b = 0; b < bubbles.length; b++) {
        if (b > 0) {
          await delay(1200 + Math.floor(Math.random() * 800));
          try { await s.sock.sendPresenceUpdate("composing", jid); } catch (e) {}
          await delay(1400);
        }
        await s.sock.sendMessage(jid, { text: bubbles[b] });
        try { await s.sock.sendPresenceUpdate("paused", jid); } catch (e) {}
      }

      currentData.consecutiveCount += 1;
      currentData.lastBotMsgTime = Date.now();
      contactFollowUps.set(jid, currentData);

      console.log(`[Follow-up WA Sent] To ${jid}: "${followUpText}" (Count: ${currentData.consecutiveCount}/${MAX_CONSECUTIVE_FOLLOWUPS})`);
      await notifyAdmin(`🔄 WhatsApp Account ${sessionId} Follow-up (${currentData.consecutiveCount}/${MAX_CONSECUTIVE_FOLLOWUPS}):\nTo: ${jid.split("@")[0]}\nMsg: "${followUpText}"`);

      if (currentData.consecutiveCount < MAX_CONSECUTIVE_FOLLOWUPS) {
        scheduleWhatsAppFollowUp(jid, sessionId);
      }
    } catch (err) {
      console.error(`[Follow-up WA Error] Failed for ${jid}:`, err.message);
    }
  }, delayMs);
}

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

      const isDirectChat = jid.endsWith("@s.whatsapp.net") || jid.endsWith("@lid");
      if (!isDirectChat) continue;

      // STRICT PRIVACY: Ignore channels, status stories, groups, and system bots
      if (
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

      const innerMessage =
        msg.message.ephemeralMessage?.message ||
        msg.message.viewOnceMessage?.message ||
        msg.message.viewOnceMessageV2?.message ||
        msg.message;

      const conversationText =
        innerMessage.conversation ||
        innerMessage.extendedTextMessage?.text ||
        innerMessage.imageMessage?.caption ||
        innerMessage.videoMessage?.caption ||
        "";

      if (!conversationText.trim()) continue;

      const contactName = msg.pushName || `+${senderPhone}`;
      console.log(`[WA Account ${sessionId} Msg] From ${contactName} (+${senderPhone}): "${conversationText}"`);

      // Clear existing follow-up timer and reset consecutive count on user message
      const existingFollowUp = contactFollowUps.get(jid);
      if (existingFollowUp?.timer) {
        clearTimeout(existingFollowUp.timer);
      }
      contactFollowUps.set(jid, {
        consecutiveCount: 0,
        lastUserMsgTime: Date.now(),
        lastBotMsgTime: 0,
        timer: null,
        sessionId
      });

      try {
        // Step 1: Human thinking delay before typing (2.5s - 4.5s) to avoid bot detection
        const thinkDelay = 2500 + Math.floor(Math.random() * 2000);
        await delay(thinkDelay);

        // NOTE: We intentionally do NOT call sock.readMessages()
        // Incoming messages stay UNREAD on phone so you can easily review them!

        // Step 2: Generate response
        const aiReply = await getAIResponse(jid, conversationText);

        // Step 3: Split into natural chat bubbles (1 or 2 bubbles)
        const bubbles = splitIntoBubbles(aiReply, 2);

        // Step 4: Send bubbles sequentially with human pacing and typing presence
        for (let i = 0; i < bubbles.length; i++) {
          const bubble = bubbles[i];
          const bubbleTyping = 1500 + Math.min(bubble.length * 35, 2500) + Math.floor(Math.random() * 800);
          try {
            await sock.sendPresenceUpdate("composing", jid);
          } catch (e) {}
          await delay(bubbleTyping);

          await sock.sendMessage(jid, { text: bubble });
          try {
            await sock.sendPresenceUpdate("paused", jid);
          } catch (e) {}

          if (i < bubbles.length - 1) {
            await delay(1200 + Math.floor(Math.random() * 1000));
          }
        }

        // Update follow-up tracker: bot has sent 1 response turn
        const followData = contactFollowUps.get(jid) || { lastUserMsgTime: Date.now() };
        followData.consecutiveCount = 1;
        followData.lastBotMsgTime = Date.now();
        followData.sessionId = sessionId;
        contactFollowUps.set(jid, followData);

        // Schedule re-engagement follow-up in case the contact doesn't reply
        scheduleWhatsAppFollowUp(jid, sessionId);

        const totalDelay = (thinkDelay / 1000).toFixed(1);
        console.log(`[AD WA${sessionId} Replied in ${totalDelay}s] To ${contactName}: "${aiReply}" (${bubbles.length} bubbles)`);

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

// Background keep-alive / follow-up trigger for Telegram Serverless Webhook
setInterval(() => {
  axios
    .get("https://telegram-assistant-bot-seven.vercel.app/api/webhook?action=followup")
    .then((res) => {
      if (res.data?.dispatched > 0) {
        console.log(`[Telegram Cron] Dispatched ${res.data.dispatched} follow-ups.`);
      }
    })
    .catch(() => {});
}, 10 * 60 * 1000); // Every 10 minutes
