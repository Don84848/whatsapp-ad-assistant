const { GROQ_API_KEY, GROQ_MODEL } = require("./config");

async function postJson(url, payload, headers, timeoutMs = 8000) {
  if (typeof fetch !== "undefined") {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
        signal: controller.signal
      });
      clearTimeout(timer);
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error?.message || `HTTP ${res.status}`);
      }
      return data;
    } catch (err) {
      clearTimeout(timer);
      throw err;
    }
  }
  const axios = require("axios");
  const res = await axios.post(url, payload, { headers, timeout: timeoutMs });
  return res.data;
}

// Per-contact conversation memory (stores up to last 8 messages per contact)
const chatMemories = new Map();

// Language detection tokens (derived directly from production Telegram bot)
const STRICT_URDU_TOKENS = /\b(kya|hai|hain|bhai|yr|yar|karo|kr|kro|krna|krdo|ruko|chahiye|chahye|chaiye|kitne|kitna|kitny|kaunsa|konsa|hoga|batao|btao|sunao|theek|thik|kaise|kesy|kaisa|aap|tum|mein|bhi|nahi|nhi|nai|dekh|lelo|lena|dedo|milega|milta|sasta|mehnga|mehanga|kahan|kidhar|umar|haal|wala|wali|acha|achha|behtar|kab|ayega|aayega|aaya|abhi|thora|zara|bhejo|mujhe|mjhe|apko|hum|haan|hanji|salam|aoa|assalam|waqt|masla|kaam|chalta|chalega|chlega|paisay|paise|samajh|samjho|bohot|bahut|zyada|pata|pta|karna|dijiye|lenge|denge|rakho|bhej|kisko|kiska|mera|tera|hamara|apna|kesa|krte|karti|karna)\b/gi;
const CLEAR_ENGLISH_TOKENS = /\b(what|where|when|how|which|why|who|is|are|was|were|do|does|did|can|could|would|should|you|your|need|want|price|prices|cost|buy|link|please|yes|yeah|hello|hey|thanks|thank|help|give|send|warranty|account|available|payment|pay|work|working|check|still|waiting|sorry|have|got|this|that|with|from|only|english|understand|speak)\b/gi;

function detectLanguage(text) {
  if (!text) return "ur";
  if (/\b(only english|speak english|in english|english please|no urdu)\b/i.test(text)) return "en";
  if (/[\u0600-\u06FF]/.test(text)) return "ur";
  const urMatches = (text.match(STRICT_URDU_TOKENS) || []).length;
  const enMatches = (text.match(CLEAR_ENGLISH_TOKENS) || []).length;
  if (urMatches >= 1) return "ur";
  if (enMatches >= 2 && urMatches === 0) return "en";
  return "ur"; // Default to Pakistani Roman Urdu
}

function cleanHumanText(text) {
  if (!text) return "";
  let clean = text.trim();

  // Privacy & Identity filters: Never mention Awais or Daraz Hacker
  clean = clean.replace(/\bawais\b/gi, "AD");
  clean = clean.replace(/@?daraz[_\s]?hacker/gi, "AD");

  // Strip markdown formatting
  clean = clean.replace(/\*\*|__/g, "");
  clean = clean.replace(/[#^*~`]/g, "");

  // Convert Indian Hindi vocabulary to natural Pakistani Roman Urdu
  const HINDI_REPLACEMENTS = [
    [/\bvich\b/gi, "mein"],
    [/\bdhanyawad\b/gi, "shukriya"],
    [/\bnamaste\b/gi, "salam"],
    [/\bnamaskar\b/gi, "salam"],
    [/\bkripya\b/gi, "please"],
    [/\bturant\b/gi, "abhi"],
    [/\bchhod\b/gi, "chor"],
    [/\bbataiye\b/gi, "batao"],
    [/\bkijiye\b/gi, "karo"],
    [/\bsamay\b/gi, "time"],
    [/\bkaunsa\b/gi, "konsa"],
    [/\bhumara\b/gi, "hamara"]
  ];
  for (const [pattern, replacement] of HINDI_REPLACEMENTS) {
    clean = clean.replace(pattern, replacement);
  }

  // Remove commas, question marks (English and Urdu), exclamation marks
  clean = clean.replace(/[,?؟!;~]/g, " ");

  // Replace newlines with spaces so words from different lines don't get merged
  clean = clean.replace(/[\r\n]+/g, " ");

  // Strip isolated or trailing periods
  clean = clean.replace(/(?<!\d)\.|\.(?!\d)/g, " ");

  // Deduplicate words or phrases repeated consecutively (fixes stuttering e.g. "theek theek" -> "theek")
  clean = clean.replace(/\b(\w+)(?:\s+\1\b)+/gi, "$1");
  clean = clean.replace(/\b(\w+\s+\w+)(?:\s+\1\b)+/gi, "$1");
  clean = clean.replace(/\b(\w+\s+\w+\s+\w+)(?:\s+\1\b)+/gi, "$1");

  // Normalize whitespace
  clean = clean.replace(/\s+/g, " ");

  return clean.trim();
}

function buildSystemPrompt(userLang) {
  const isEnglish = userLang === "en";
  const now = new Date();
  const pkTime = now.toLocaleTimeString("en-US", {
    timeZone: "Asia/Karachi",
    hour: "numeric",
    minute: "2-digit",
    hour12: true
  });
  const pkDate = now.toLocaleDateString("en-US", {
    timeZone: "Asia/Karachi",
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric"
  });

  const languageProfile = isEnglish
    ? `STRICT LANGUAGE PROFILE: Customer speaks ENGLISH ONLY. REPLY 100% IN SIMPLE CASUAL ENGLISH ONLY! NEVER use any Urdu, Hindi, or foreign words!`
    : `STRICT LANGUAGE PROFILE: Customer speaks PAKISTANI ROMAN URDU. Reply 100% in casual everyday Pakistani Roman Urdu (avoid formal Hindi like turant/chhod/bataiye/vich/dhanyawad/namaste/pranaam/kripya)!`;

  const humanAnswerExample = isEnglish ? `"no i am human"` : `"nahi human hu"`;

  return `You are AD chatting on WhatsApp.
Current live time in Pakistan: ${pkTime}, ${pkDate}.
${languageProfile}

CORE RULES:
1. HUMAN STYLE: Text casually like a real person on WhatsApp—short and natural (1-2 lines for chat). No periods (.) or (!) at end of lines. No commas (,) and no question marks (?). No markdown (** or __).
2. PRIVACY & IDENTITY: You are "AD". Speak in first-person ("main AD hu", "I am AD"). NEVER mention "Awais", "@Daraz_Hacker", "Daraz Hacker", or real full names. Never admit being an AI/bot (${humanAnswerExample}).
3. NO SELLING / NO STORE (STRICT): This is strictly your personal WhatsApp. Zero selling, zero store, zero products. If someone asks about buying accounts, Netflix, Spotify, prices, or store products, reply politely: "bhai ye mera personal WhatsApp hai yahan koi selling ya store nahi hai".
4. DIRECT & INTELLIGENT: Answer what the person actually asked directly and politely. If they ask a question (time, math, facts, or casual conversation), answer it clearly like a normal human friend. Never repeat yourself. Never stutter or repeat words.
5. CASUAL BANTER: If they greet you (salam, hi, kya haal hai), greet them back warmly and naturally ("walaikum assalam kya haal hain", "theek hu aap sunao", "haan bhai bolo"). Avoid robotic slang, avoid forced phrases like "yo bro", "chal theek", "kya scene". Talk like a normal, respectful, real human friend.

FINAL CHECK: ${isEnglish ? "Write ONLY pure English words!" : "Write ONLY casual Pakistani Roman Urdu!"}`;
}

async function getAIResponse(contactId, userText) {
  if (!GROQ_API_KEY) {
    return "theek hu bhai aap sunao";
  }

  const userLang = detectLanguage(userText);
  const systemPrompt = buildSystemPrompt(userLang);

  // Get or initialize conversation memory (last 6 messages)
  let history = chatMemories.get(contactId) || [];
  history = history.slice(-6);

  const messages = [
    { role: "system", content: systemPrompt },
    ...history,
    { role: "user", content: userText }
  ];

  // Try active models with optimized parameters
  const modelsToTry = [
    GROQ_MODEL || "openai/gpt-oss-120b",
    "openai/gpt-oss-120b",
    "openai/gpt-oss-20b",
    "qwen/qwen3.8-27b"
  ];

  const uniqueModels = [...new Set(modelsToTry)];

  for (const model of uniqueModels) {
    try {
      const isReasoning = model.startsWith("openai/");
      const responseData = await postJson(
        "https://api.groq.com/openai/v1/chat/completions",
        {
          model: model,
          messages: messages,
          temperature: 0.52,
          max_tokens: isReasoning ? 220 : 140,
          reasoning_effort: isReasoning ? "low" : undefined
        },
        {
          Authorization: `Bearer ${GROQ_API_KEY}`,
          "Content-Type": "application/json"
        },
        8000
      );

      const rawContent = responseData?.choices?.[0]?.message?.content;
      if (rawContent && rawContent.trim()) {
        const cleaned = cleanHumanText(rawContent);
        if (cleaned) {
          history.push({ role: "user", content: userText });
          history.push({ role: "assistant", content: cleaned });
          chatMemories.set(contactId, history.slice(-6));
          return cleaned;
        }
      }
    } catch (err) {
      console.error(`Groq error on ${model}:`, err.response?.data?.error?.message || err.message);
    }
  }

  // Natural fallback if all models fail
  const isQuestion = /\b(kya|kia|kaise|kese|kitna|kitne|kahan|kidhar|kab|kyun|kis|batao|who|what|where|when|why|how)\b/i.test(userText);
  if (isQuestion) {
    return userLang === "en" ? "could you say that again please" : "samajh nahi aayi bhai thoda dobara bolo kya keh rahe ho";
  }
  return userLang === "en" ? "doing good how are you" : "theek hu bhai aap sunao kya haal hain";
}

module.exports = {
  getAIResponse,
  cleanHumanText,
  buildSystemPrompt,
  detectLanguage
};
