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

function cleanHumanText(text) {
  if (!text) return "";
  let clean = text.trim();

  // Privacy & Identity filters: Never mention Awais or Daraz Hacker
  clean = clean.replace(/\bawais\b/gi, "AD");
  clean = clean.replace(/@?daraz[_\s]?hacker/gi, "AD");

  // Replace newlines with spaces first so words from separate lines never merge
  clean = clean.replace(/[\r\n]+/g, " ");

  // Strip markdown formatting
  clean = clean.replace(/\*\*|__/g, "");
  clean = clean.replace(/[#^*~`]/g, "");

  // Remove commas, question marks (English and Urdu), exclamation marks
  clean = clean.replace(/[,?؟!;~]/g, " ");

  // Strip isolated or trailing periods
  clean = clean.replace(/(?<!\d)\.|\.(?!\d)/g, " ");

  // Deduplicate words or phrases repeated consecutively (fixes stuttering e.g. "good good" -> "good")
  clean = clean.replace(/\b(\w+)(?:\s+\1\b)+/gi, "$1");
  clean = clean.replace(/\b(\w+\s+\w+)(?:\s+\1\b)+/gi, "$1");
  clean = clean.replace(/\b(\w+\s+\w+\s+\w+)(?:\s+\1\b)+/gi, "$1");

  // Normalize whitespace
  clean = clean.replace(/\s+/g, " ");

  return clean.trim();
}

function buildSystemPrompt() {
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

  return `You are AD chatting casually on WhatsApp.
Current live time: ${pkTime}, ${pkDate}.

STRICT LANGUAGE MANDATE:
- You must ALWAYS speak and reply in 100% ENGLISH ONLY.
- NEVER use any Urdu, Roman Urdu, Hindi, or foreign words under ANY circumstances!
- Even if the other person writes in Urdu, Roman Urdu, Hindi, or any other language, you must ALWAYS reply in simple, natural, casual English!

CORE RULES:
1. HUMAN STYLE: Text casually like a real friend on WhatsApp—short and natural (1-2 lines for chat). No periods (.) or (!) at end of lines. No commas (,) and no question marks (?) (e.g. write "how are you doing" or "whats up", NOT "whats up?"). No markdown (** or __). NEVER add artificial sign-offs like "have a good one" or "thanks for the chat".
2. PRIVACY & IDENTITY: You are "AD". Speak in first-person ("I am AD", "yeah im AD"). NEVER mention "Awais", "@Daraz_Hacker", "Daraz Hacker", or real full names. Never admit being an AI/bot (reply "no im human").
3. NO SELLING / NO STORE (STRICT): This is strictly your personal WhatsApp. Zero selling, zero store, zero products. If someone asks about buying accounts, Netflix, Spotify, prices, or store products, reply politely: "bro this is my personal WhatsApp i dont sell anything here".
4. DIRECT & INTELLIGENT: Answer what the person actually asked directly and politely in English. If they ask a question (time, math, facts, or casual conversation), answer it clearly like a normal human friend. Never repeat yourself. Never stutter or repeat words.
5. CASUAL BANTER: If they greet you (hi, hello, hey, whats up), greet them back warmly and naturally ("hey whats up", "im good how are you", "doing good what about you"). Talk like a normal, respectful, real human friend.

FINAL MANDATE: ALWAYS REPLY 100% IN ENGLISH ONLY! ZERO URDU OR HINDI WORDS!`;
}

async function getAIResponse(contactId, userText) {
  if (!GROQ_API_KEY) {
    return "doing good how are you doing";
  }

  const systemPrompt = buildSystemPrompt();

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
          max_tokens: isReasoning ? 200 : 130,
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

  // 100% English natural fallback if all models fail
  const isQuestion = /\b(kya|kia|kaise|kese|kitna|kitne|kahan|kidhar|kab|kyun|kis|batao|who|what|where|when|why|how)\b/i.test(userText);
  if (isQuestion) {
    return "could you say that again please";
  }
  return "doing good how are you doing";
}

module.exports = {
  getAIResponse,
  cleanHumanText,
  buildSystemPrompt
};
