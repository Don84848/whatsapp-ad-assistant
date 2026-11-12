const axios = require("axios");
const {
  TELEGRAM_BOT_TOKEN,
  TELEGRAM_ADMIN_USERNAME,
  TELEGRAM_ADMIN_ID,
  isNumberAllowed,
  addNumberToWhitelist,
  removeNumberFromWhitelist,
  getWhitelistNumbers,
  cleanPhoneNumber
} = require("./config");

let activeAdminChatId = TELEGRAM_ADMIN_ID || null;
let lastUpdateId = 0;
let isPolling = false;

// Reference to WhatsApp client so admin can send messages via /say
let waClientRef = null;

function setWhatsAppClient(waClient) {
  waClientRef = waClient;
}

async function sendTelegramMessage(chatId, text) {
  if (!TELEGRAM_BOT_TOKEN || !chatId || !text) return;
  try {
    await axios.post(
      `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
      { chat_id: chatId, text: text },
      { timeout: 5000 }
    );
  } catch (e) {
    console.error("Failed to send Telegram message:", e.response?.data?.description || e.message);
  }
}

async function notifyAdmin(text) {
  if (!activeAdminChatId) return;
  await sendTelegramMessage(activeAdminChatId, text);
}

function isAdmin(fromUser) {
  if (!fromUser) return false;
  const username = (fromUser.username || "").toLowerCase().replace("@", "");
  const id = String(fromUser.id);

  if (activeAdminChatId && id === String(activeAdminChatId)) return true;
  if (TELEGRAM_ADMIN_ID && id === String(TELEGRAM_ADMIN_ID)) {
    activeAdminChatId = id;
    return true;
  }
  if (username && username === TELEGRAM_ADMIN_USERNAME.toLowerCase()) {
    activeAdminChatId = id;
    return true;
  }
  return false;
}

async function handleTelegramCommand(message, getWhatsAppStatus) {
  const fromUser = message.from;
  const chatId = message.chat.id;
  const text = (message.text || "").trim();

  // STRICT ACCESS CHECK: Only Daraz_Hacker can interact with this admin bridge!
  if (!isAdmin(fromUser)) {
    console.warn(`Unauthorized Telegram access attempt from @${fromUser?.username || "unknown"} (ID: ${fromUser?.id})`);
    return;
  }

  activeAdminChatId = chatId;
  const parts = text.split(/\s+/);
  const command = parts[0].toLowerCase();
  const args = parts.slice(1);

  if (command === "/start" || command === "/help") {
    const welcome = `👋 Welcome Boss (@${TELEGRAM_ADMIN_USERNAME})!
I am your WhatsApp AD Assistant Bridge.

📌 Available Commands:
/status - Check WhatsApp connection & whitelist
/add <phone> - Add a number to whitelist (e.g. /add 923001234567)
/remove <phone> - Remove a number from whitelist
/list - View all allowed WhatsApp numbers
/allowall - Allow everyone who messages on WhatsApp
/say <phone> <msg> - Send a message from AD's WhatsApp directly`;
    await sendTelegramMessage(chatId, welcome);
    return;
  }

  if (command === "/status") {
    const waStatus = getWhatsAppStatus ? getWhatsAppStatus() : "Unknown";
    const allowed = getWhitelistNumbers();
    const allowedText = allowed.includes("*") ? "All numbers allowed (*)" : allowed.join(", ") || "None";
    const statusMsg = `📊 WhatsApp AD Bot Status:
• Connection: ${waStatus}
• Whitelisted Contacts: ${allowed.length} (${allowedText})
• Name: AD (Hometown: Lahore, Pakistan)`;
    await sendTelegramMessage(chatId, statusMsg);
    return;
  }

  if (command === "/add") {
    if (args.length === 0) {
      await sendTelegramMessage(chatId, "⚠️ Usage: /add <phone_number> (e.g. /add 923001234567)");
      return;
    }
    const phone = cleanPhoneNumber(args[0]);
    if (!phone) {
      await sendTelegramMessage(chatId, "❌ Invalid phone number");
      return;
    }
    addNumberToWhitelist(phone);
    await sendTelegramMessage(chatId, `✅ Added +${phone} to allowed WhatsApp contacts`);
    return;
  }

  if (command === "/remove") {
    if (args.length === 0) {
      await sendTelegramMessage(chatId, "⚠️ Usage: /remove <phone_number>");
      return;
    }
    const phone = cleanPhoneNumber(args[0]);
    const success = removeNumberFromWhitelist(phone);
    if (success) {
      await sendTelegramMessage(chatId, `✅ Removed +${phone} from whitelist`);
    } else {
      await sendTelegramMessage(chatId, `⚠️ Number +${phone} was not in whitelist`);
    }
    return;
  }

  if (command === "/list") {
    const allowed = getWhitelistNumbers();
    if (allowed.includes("*")) {
      await sendTelegramMessage(chatId, "📋 Allowed numbers: All numbers (*) can chat with AD");
    } else if (allowed.length === 0) {
      await sendTelegramMessage(chatId, "📋 Allowed numbers: Whitelist is empty (no one can chat). Use /add <number> or /allowall");
    } else {
      await sendTelegramMessage(chatId, `📋 Whitelisted Numbers (${allowed.length}):\n` + allowed.map(n => `• +${n}`).join("\n"));
    }
    return;
  }

  if (command === "/allowall") {
    addNumberToWhitelist("*");
    await sendTelegramMessage(chatId, "✅ Allowed all numbers (*) to chat with AD on WhatsApp");
    return;
  }

  if (command === "/say") {
    if (args.length < 2) {
      await sendTelegramMessage(chatId, "⚠️ Usage: /say <phone_number> <message>");
      return;
    }
    const targetPhone = cleanPhoneNumber(args[0]);
    const msgText = args.slice(1).join(" ");
    if (!waClientRef) {
      await sendTelegramMessage(chatId, "❌ WhatsApp is not connected yet");
      return;
    }
    try {
      const jid = `${targetPhone}@s.whatsapp.net`;
      await waClientRef.sendMessage(jid, { text: msgText });
      await sendTelegramMessage(chatId, `✅ Sent to +${targetPhone}:\n"${msgText}"`);
    } catch (err) {
      await sendTelegramMessage(chatId, `❌ Failed to send WhatsApp message: ${err.message}`);
    }
    return;
  }
}

async function startTelegramPolling(getWhatsAppStatus) {
  if (!TELEGRAM_BOT_TOKEN) {
    console.log("[Telegram Admin] TELEGRAM_BOT_TOKEN not provided, admin bridge disabled");
    return;
  }

  isPolling = true;
  console.log(`[Telegram Admin] Polling started for admin @${TELEGRAM_ADMIN_USERNAME}`);

  while (isPolling) {
    try {
      const response = await axios.get(
        `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getUpdates`,
        {
          params: { offset: lastUpdateId + 1, timeout: 25 },
          timeout: 30000
        }
      );

      const updates = response.data?.result || [];
      for (const update of updates) {
        lastUpdateId = update.update_id;
        if (update.message?.text) {
          await handleTelegramCommand(update.message, getWhatsAppStatus);
        }
      }
    } catch (err) {
      // Avoid rapid error spam on network blips
      await new Promise(r => setTimeout(r, 4000));
    }
  }
}

function stopTelegramPolling() {
  isPolling = false;
}

module.exports = {
  startTelegramPolling,
  stopTelegramPolling,
  notifyAdmin,
  setWhatsAppClient
};
