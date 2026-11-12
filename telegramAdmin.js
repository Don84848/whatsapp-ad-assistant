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

let sessionController = {
  getAllStatuses: () => ({ s1: "Unknown", s2: "Unknown" }),
  isSessionRegistered: (id) => false,
  requestPairing: async (phone, id) => "0000-0000",
  logoutSession: async (id) => {},
  sendMessage: async (phone, text, id) => {}
};

function registerSessionController(controller) {
  sessionController = { ...sessionController, ...controller };
}

// Backward compatibility helper
function setWhatsAppClient(client) {}

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

  const allowedUsernames = ["daraz_hacker", "advault_gumroad", (TELEGRAM_ADMIN_USERNAME || "").toLowerCase()];
  const allowedIds = ["7002023905", String(TELEGRAM_ADMIN_ID || "")].filter(Boolean);

  if (activeAdminChatId && id === String(activeAdminChatId)) return true;
  if (allowedIds.includes(id)) {
    activeAdminChatId = id;
    return true;
  }
  if (username && allowedUsernames.includes(username)) {
    activeAdminChatId = id;
    return true;
  }
  return false;
}

async function handleTelegramCommand(message) {
  const fromUser = message.from;
  const chatId = message.chat.id;
  const text = (message.text || "").trim();

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
I am your WhatsApp AD Assistant Multi-Account Bridge.

📱 WhatsApp Account 1:
/pair <phone> - Get 8-digit pairing code for Account 1 (e.g. /pair 923001234567)
/relink <phone> - Change number / force re-pair Account 1
/logout - Disconnect Account 1

📱 WhatsApp Account 2 (Multi-WhatsApp):
/pair2 <phone> - Connect a 2nd WhatsApp number
/relink2 <phone> - Change number / force re-pair Account 2
/logout2 - Disconnect Account 2

📊 Management:
/status - View status of both WhatsApp accounts
/add <phone> - Add number to whitelist
/remove <phone> - Remove number from whitelist
/list - View allowed numbers
/allowall - Allow all numbers (*)
/say <phone> <msg> - Send WhatsApp text from Account 1
/say2 <phone> <msg> - Send WhatsApp text from Account 2`;
    await sendTelegramMessage(chatId, welcome);
    return;
  }

  // Account 1 Pairing
  if (command === "/pair" || command === "/pair1") {
    if (args.length === 0) {
      await sendTelegramMessage(chatId, "⚠️ Usage: /pair <phone_number>\nExample: /pair 923001234567\n(Use country code without '+' or spaces)");
      return;
    }
    const phone = cleanPhoneNumber(args[0]);
    if (!phone) {
      await sendTelegramMessage(chatId, "❌ Invalid phone number. Please use country code without '+' (e.g. 923001234567)");
      return;
    }
    if (sessionController.isSessionRegistered(1)) {
      await sendTelegramMessage(
        chatId,
        `✅ WhatsApp Account 1 is already linked and online!\n\nOptions:\n• To change number / re-pair Account 1: /relink ${phone}\n• To connect a 2nd WhatsApp account: /pair2 ${phone}\n• To disconnect Account 1: /logout`
      );
      return;
    }
    try {
      await sendTelegramMessage(chatId, `⏳ Connecting Account 1 for +${phone}...\nPlease wait 3-4 seconds.`);
      const formattedCode = await sessionController.requestPairing(phone, 1);
      const pairMsg = `📱 WhatsApp Account 1 Pairing Code:
🔑 ${formattedCode}

Steps to Link:
1. Open WhatsApp on your phone
2. Tap ⋮ (Three dots) > Linked Devices > Link a Device
3. Tap 'Link with phone number instead'
4. Enter code: ${formattedCode}`;
      await sendTelegramMessage(chatId, pairMsg);
    } catch (err) {
      console.error("[Pair 1 Error]", err);
      await sendTelegramMessage(chatId, `❌ Error requesting pairing code: ${err.message}`);
    }
    return;
  }

  // Account 1 Force Relink
  if (command === "/relink" || command === "/relink1") {
    if (args.length === 0) {
      await sendTelegramMessage(chatId, "⚠️ Usage: /relink <phone_number>\nExample: /relink 923001234567");
      return;
    }
    const phone = cleanPhoneNumber(args[0]);
    if (!phone) {
      await sendTelegramMessage(chatId, "❌ Invalid phone number format");
      return;
    }
    try {
      await sendTelegramMessage(chatId, `⏳ Unlinking existing session and requesting new code for +${phone}...`);
      const formattedCode = await sessionController.requestPairing(phone, 1);
      const pairMsg = `📱 WhatsApp Account 1 Fresh Pairing Code:
🔑 ${formattedCode}

Steps to Link:
1. Open WhatsApp on phone
2. Tap ⋮ > Linked Devices > Link a Device
3. Tap 'Link with phone number instead'
4. Enter code: ${formattedCode}`;
      await sendTelegramMessage(chatId, pairMsg);
    } catch (err) {
      await sendTelegramMessage(chatId, `❌ Error during relink: ${err.message}`);
    }
    return;
  }

  // Account 1 Logout
  if (command === "/logout" || command === "/logout1") {
    try {
      await sessionController.logoutSession(1);
      await sendTelegramMessage(chatId, "✅ WhatsApp Account 1 has been logged out and disconnected. Use /pair <phone> to pair anytime.");
    } catch (err) {
      await sendTelegramMessage(chatId, `❌ Error during logout: ${err.message}`);
    }
    return;
  }

  // Account 2 Pairing (Multi-WhatsApp)
  if (command === "/pair2") {
    if (args.length === 0) {
      await sendTelegramMessage(chatId, "⚠️ Usage: /pair2 <phone_number>\nExample: /pair2 923001234567\n(Use country code without '+' or spaces)");
      return;
    }
    const phone = cleanPhoneNumber(args[0]);
    if (!phone) {
      await sendTelegramMessage(chatId, "❌ Invalid phone number");
      return;
    }
    if (sessionController.isSessionRegistered(2)) {
      await sendTelegramMessage(
        chatId,
        `✅ WhatsApp Account 2 is already linked and online!\n\nOptions:\n• To change number / re-pair Account 2: /relink2 ${phone}\n• To disconnect Account 2: /logout2`
      );
      return;
    }
    try {
      await sendTelegramMessage(chatId, `⏳ Connecting Account 2 for +${phone}...\nPlease wait 3-4 seconds.`);
      const formattedCode = await sessionController.requestPairing(phone, 2);
      const pairMsg = `📱 WhatsApp Account 2 Pairing Code:
🔑 ${formattedCode}

Steps to Link:
1. Open 2nd WhatsApp on your phone
2. Tap ⋮ > Linked Devices > Link a Device
3. Tap 'Link with phone number instead'
4. Enter code: ${formattedCode}`;
      await sendTelegramMessage(chatId, pairMsg);
    } catch (err) {
      console.error("[Pair 2 Error]", err);
      await sendTelegramMessage(chatId, `❌ Error requesting pairing code for Account 2: ${err.message}`);
    }
    return;
  }

  // Account 2 Force Relink
  if (command === "/relink2") {
    if (args.length === 0) {
      await sendTelegramMessage(chatId, "⚠️ Usage: /relink2 <phone_number>");
      return;
    }
    const phone = cleanPhoneNumber(args[0]);
    if (!phone) {
      await sendTelegramMessage(chatId, "❌ Invalid phone number");
      return;
    }
    try {
      await sendTelegramMessage(chatId, `⏳ Unlinking Account 2 and requesting new code for +${phone}...`);
      const formattedCode = await sessionController.requestPairing(phone, 2);
      const pairMsg = `📱 WhatsApp Account 2 Fresh Pairing Code:
🔑 ${formattedCode}

Enter code in 2nd WhatsApp: Linked Devices > Link with phone number`;
      await sendTelegramMessage(chatId, pairMsg);
    } catch (err) {
      await sendTelegramMessage(chatId, `❌ Error during relink2: ${err.message}`);
    }
    return;
  }

  // Account 2 Logout
  if (command === "/logout2") {
    try {
      await sessionController.logoutSession(2);
      await sendTelegramMessage(chatId, "✅ WhatsApp Account 2 has been logged out. Use /pair2 <phone> to pair anytime.");
    } catch (err) {
      await sendTelegramMessage(chatId, `❌ Error during logout2: ${err.message}`);
    }
    return;
  }

  // Status
  if (command === "/status") {
    const { s1, s2 } = sessionController.getAllStatuses();
    const allowed = getWhitelistNumbers();
    const allowedText = allowed.includes("*") ? "All numbers allowed (*)" : allowed.join(", ") || "None";
    const statusMsg = `📊 WhatsApp AD Bot Multi-Status:
• Account 1: ${s1}
• Account 2: ${s2}
• Whitelisted Contacts: ${allowed.length} (${allowedText})
• Persona: AD (Lahore, Pakistan)`;
    await sendTelegramMessage(chatId, statusMsg);
    return;
  }

  // Whitelist management
  if (command === "/add") {
    if (args.length === 0) {
      await sendTelegramMessage(chatId, "⚠️ Usage: /add <phone_number>");
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
      await sendTelegramMessage(chatId, "📋 Allowed numbers: Whitelist is empty. Use /add <number> or /allowall");
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

  // Outbound message from Account 1
  if (command === "/say" || command === "/say1") {
    if (args.length < 2) {
      await sendTelegramMessage(chatId, "⚠️ Usage: /say <phone_number> <message>");
      return;
    }
    const targetPhone = cleanPhoneNumber(args[0]);
    const msgText = args.slice(1).join(" ");
    try {
      await sessionController.sendMessage(targetPhone, msgText, 1);
      await sendTelegramMessage(chatId, `✅ [Account 1] Sent to +${targetPhone}:\n"${msgText}"`);
    } catch (err) {
      await sendTelegramMessage(chatId, `❌ Failed to send from Account 1: ${err.message}`);
    }
    return;
  }

  // Outbound message from Account 2
  if (command === "/say2") {
    if (args.length < 2) {
      await sendTelegramMessage(chatId, "⚠️ Usage: /say2 <phone_number> <message>");
      return;
    }
    const targetPhone = cleanPhoneNumber(args[0]);
    const msgText = args.slice(1).join(" ");
    try {
      await sessionController.sendMessage(targetPhone, msgText, 2);
      await sendTelegramMessage(chatId, `✅ [Account 2] Sent to +${targetPhone}:\n"${msgText}"`);
    } catch (err) {
      await sendTelegramMessage(chatId, `❌ Failed to send from Account 2: ${err.message}`);
    }
    return;
  }
}

async function startTelegramPolling() {
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
          await handleTelegramCommand(update.message);
        }
      }
    } catch (err) {
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
  registerSessionController,
  setWhatsAppClient
};
