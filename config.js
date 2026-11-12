require("dotenv").config();
const fs = require("fs");
const path = require("path");

const WHITELIST_FILE = path.join(__dirname, "whitelist.json");

function loadWhitelist() {
  try {
    if (fs.existsSync(WHITELIST_FILE)) {
      const data = JSON.parse(fs.readFileSync(WHITELIST_FILE, "utf-8"));
      if (Array.isArray(data)) return new Set(data.map(n => cleanPhoneNumber(n)));
    }
  } catch (e) {
    console.error("Error reading whitelist.json:", e.message);
  }

  const envAllowed = (process.env.ALLOWED_NUMBERS || "*").trim();
  if (envAllowed === "*") return new Set(["*"]);

  const set = new Set();
  envAllowed.split(",").forEach(n => {
    const clean = cleanPhoneNumber(n);
    if (clean) set.add(clean);
  });
  return set;
}

function saveWhitelist(set) {
  try {
    fs.writeFileSync(WHITELIST_FILE, JSON.stringify(Array.from(set), null, 2));
  } catch (e) {
    console.error("Error writing whitelist.json:", e.message);
  }
}

let activeWhitelist = loadWhitelist();

function cleanPhoneNumber(str) {
  if (!str) return "";
  const s = String(str).trim();
  if (s === "*") return "*";
  return s.replace(/[^0-9]/g, "");
}

function isNumberAllowed(phone) {
  if (activeWhitelist.has("*")) return true;
  const clean = cleanPhoneNumber(phone);
  return activeWhitelist.has(clean);
}

function addNumberToWhitelist(phone) {
  const clean = cleanPhoneNumber(phone);
  if (!clean) return false;
  activeWhitelist.delete("*"); // If adding specific numbers, remove wildcard
  activeWhitelist.add(clean);
  saveWhitelist(activeWhitelist);
  return true;
}

function removeNumberFromWhitelist(phone) {
  const clean = cleanPhoneNumber(phone);
  const deleted = activeWhitelist.delete(clean);
  if (deleted) saveWhitelist(activeWhitelist);
  return deleted;
}

function getWhitelistNumbers() {
  return Array.from(activeWhitelist);
}

module.exports = {
  GROQ_API_KEY: process.env.GROQ_API_KEY || "",
  GROQ_MODEL: process.env.GROQ_MODEL || "qwen/qwen3.8-27b",
  TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN || "",
  TELEGRAM_ADMIN_USERNAME: (process.env.TELEGRAM_ADMIN_USERNAME || "Daraz_Hacker").replace("@", ""),
  TELEGRAM_ADMIN_ID: process.env.TELEGRAM_ADMIN_ID || "",
  USE_PAIRING_CODE: process.env.USE_PAIRING_CODE !== "false",
  WHATSAPP_PHONE_NUMBER: cleanPhoneNumber(process.env.WHATSAPP_PHONE_NUMBER || ""),
  isNumberAllowed,
  addNumberToWhitelist,
  removeNumberFromWhitelist,
  getWhitelistNumbers,
  cleanPhoneNumber
};
