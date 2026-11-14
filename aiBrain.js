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

// Per-contact conversation memory (stores up to last 8 messages + active language preference per contact)
const chatMemories = new Map();

// Unambiguous Pakistani Roman Urdu tokens
const STRICT_URDU_TOKENS = /\b(kya|kia|hai|hain|bhai|yr|yar|karo|kr|kro|krna|krdo|ruko|chahiye|chahye|chaiye|kitne|kitna|kitny|kaunsa|konsa|hoga|batao|btao|sunao|theek|thik|kaise|kesy|kaisa|aap|tum|mein|me|bhi|nahi|nhi|nai|dekh|lelo|lena|dedo|milega|milta|sasta|mehnga|mehanga|kahan|kidhar|umar|haal|wala|wali|acha|achha|behtar|kab|ayega|aayega|aaya|abhi|thora|zara|bhejo|mujhe|mjhe|apko|hum|haan|hanji|salam|aoa|assalam|walaikum|waqt|masla|kaam|chalta|chalega|chlega|paisay|paise|samajh|samjho|bohot|bahut|zyada|pata|pta|karna|dijiye|lenge|denge|rakho|bhej|kisko|kiska|mera|tera|hamara|apna|kesa|krte|karti|karna|shukriya|pe|par)\b/gi;

// Clear English tokens
const CLEAR_ENGLISH_TOKENS = /\b(hi|hello|hey|what|where|when|how|which|why|who|is|are|was|were|do|does|did|can|could|would|should|you|your|need|want|price|prices|cost|buy|link|please|yes|yeah|thanks|thank|help|give|send|warranty|account|available|payment|pay|work|working|check|still|waiting|sorry|have|got|this|that|with|from|only|english|understand|speak|good|morning|evening|night|fine|doing|chilling|bro|man|dude|welcome)\b/gi;

function resolveLanguage(userText, currentLang) {
  if (!userText) return currentLang || "ur";

  // Explicit English switch request
  if (/\b(only english|speak english|in english|english please|no urdu|talk in english|write in english)\b/i.test(userText)) {
    return "en";
  }
  // Explicit Urdu switch request
  if (/\b(urdu mein|urdu me|urdu bolo|urdu me bolo|speak urdu|in urdu|urdu please|roman urdu)\b/i.test(userText) || /[\u0600-\u06FF]/.test(userText)) {
    return "ur";
  }

  const urMatches = (userText.match(STRICT_URDU_TOKENS) || []).length;
  const enMatches = (userText.match(CLEAR_ENGLISH_TOKENS) || []).length;

  // If user used clear Urdu words, switch to Urdu
  if (urMatches >= 1) {
    return "ur";
  }

  // If user used clear English (2+ clear English words with no Urdu words), switch to English
  if (enMatches >= 2 && urMatches === 0) {
    return "en";
  }

  // If single English word like "hi", "hello", "hey", "thanks"
  if (enMatches >= 1 && urMatches === 0) {
    // If contact already has an active language in history, maintain that language
    if (currentLang) return currentLang;
    // New contact starting with English greeting -> English
    return "en";
  }

  // If no language matches (numbers, emojis, etc.), maintain current or default to Urdu
  return currentLang || "ur";
}

function cleanHumanText(text) {
  if (!text) return "";
  let clean = text.trim();

  // Privacy & Identity filters: Never mention Awais or Daraz Hacker
  clean = clean.replace(/\bawais\b/gi, "AD");
  clean = clean.replace(/@?daraz[_\s]?hacker/gi, "AD");

  // Keep only the first non-empty line (WhatsApp text is 1 immediate human message)
  const rawLines = clean.split(/[\r\n]+/).map(l => l.trim()).filter(Boolean);
  clean = rawLines[0] || "";

  // Strip parenthetical notes / signatures like (WhatsApp pe aapka dost, AD)
  clean = clean.replace(/\([^)]*\)/g, " ");

  // Strip meta-commentary, AI disclaimers, or hallucinated end markers
  clean = clean.replace(/\b(the conversation ended|sorry i can[’']?t comply with that|as an ai|as a language model|the last answer is correct|sorry i)\b.*/gi, " ");

  // Strip markdown formatting
  clean = clean.replace(/\*\*|__/g, "");
  clean = clean.replace(/[#^*~`]/g, "");

  // Convert Indian Hindi vocabulary to natural Pakistani Roman Urdu
  const HINDI_REPLACEMENTS = [
    [/\bvich\b/gi, "mein"],
    [/\bdhanyawad\b/gi, "shukriya"],
    [/\bnamaste\b/gi, "salam"],
    [/\bnamaskar\b/gi, "salam"],
    [/\bpranaam\b/gi, "salam"],
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

  // Strip accidental Urdu/Arabic script characters so Roman Urdu stays 100% clean in English alphabets
  clean = clean.replace(/[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]+/g, " ");

  // Remove commas, question marks (English and Urdu), exclamation marks, semicolons
  clean = clean.replace(/[,?؟!;~]/g, " ");

  // Strip isolated or trailing periods
  clean = clean.replace(/(?<!\d)\.|\.(?!\d)/g, " ");

  // Deduplicate words or short phrases repeated consecutively (fixes stuttering e.g. "theek theek theek" -> "theek")
  clean = clean.replace(/\b(\w+)(?:\s+\1\b)+/gi, "$1");
  clean = clean.replace(/\b(\w+\s+\w+)(?:\s+\1\b)+/gi, "$1");
  clean = clean.replace(/\b(\w+\s+\w+\s+\w+)(?:\s+\1\b)+/gi, "$1");

  // Deduplicate entire repeated sentences or message blocks (fixes 2x and 3x repetitions)
  const repWords = clean.trim().split(/\s+/);
  if (repWords.length >= 4) {
    if (repWords.length % 2 === 0) {
      const half = repWords.length / 2;
      const w1 = repWords.slice(0, half).join(" ").toLowerCase();
      const w2 = repWords.slice(half).join(" ").toLowerCase();
      if (w1 === w2) clean = repWords.slice(0, half).join(" ");
    } else if (repWords.length % 3 === 0) {
      const third = repWords.length / 3;
      const w1 = repWords.slice(0, third).join(" ").toLowerCase();
      const w2 = repWords.slice(third, third * 2).join(" ").toLowerCase();
      const w3 = repWords.slice(third * 2).join(" ").toLowerCase();
      if (w1 === w2 && w2 === w3) clean = repWords.slice(0, third).join(" ");
    }
  }

  // Normalize whitespace
  clean = clean.replace(/\s+/g, " ");

  // WhatsApp human texting constraint: keep reply short and natural
  const words = clean.split(" ");
  if (words.length > 24) {
    clean = words.slice(0, 20).join(" ");
  }

  return clean.trim();
}

function buildSystemPrompt(lang) {
  const isEnglish = lang === "en";
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

  if (isEnglish) {
    return `You are AD chatting casually on your personal WhatsApp.
Current live time in Pakistan: ${pkTime}, ${pkDate}.

STRICT LANGUAGE PROFILE:
- Customer is speaking in ENGLISH.
- You must reply 100% in simple, natural, casual ENGLISH ONLY.
- NEVER use any Urdu, Roman Urdu, Hindi, Arabic script, or foreign words under ANY circumstances!
- Keep the entire conversation strictly in English unless customer explicitly asks for Urdu.

CORE RULES:
1. HUMAN STYLE & FORMAT: Text casually like a real friend on WhatsApp—short, natural, direct (1-2 lines, 5-15 words).
   - NO commas (,) and NO question marks (?) (e.g. write "how are you doing" or "whats up", NEVER "how are you doing?").
   - NO periods (.) or exclamation marks (!) at the end of lines.
   - NO markdown formatting (no ** or __).
   - NEVER add artificial robotic sign-offs (like "have a good one" or "thanks for the chat").
   - SINGLE REPLY ONLY: Send ONLY your single immediate message as AD. Never simulate the contact's side or write a script/dialogue.
2. CONTEXT AWARENESS & INTELLIGENCE: Read the full conversation history carefully! Always understand what was discussed earlier and what the ongoing topic is. Answer directly and intelligently what the person actually asked. Never give random or disconnected answers.
3. PRIVACY & IDENTITY: You are "AD". Speak in first-person ("I am AD", "yeah im AD"). NEVER mention "Awais", "@Daraz_Hacker", "Daraz Hacker", or real full names. Never admit being an AI/bot (reply "no im human").
4. NO SELLING / NO STORE (STRICT): This is strictly your personal WhatsApp. Zero selling, zero store, zero products. If someone asks about buying accounts, Netflix, Spotify, prices, or store products, reply politely: "bro this is my personal WhatsApp i dont sell anything here".
5. CASUAL BANTER: If they greet you (hi, hello, hey, whats up), greet them back warmly and naturally in English ("hey whats up", "im good how about you", "doing good what about you").
6. ANTI-STUTTER: Never repeat words or phrases consecutively (e.g. never say "good good"). Never repeat yourself.

FINAL MANDATE: WRITE 100% IN NATURAL ENGLISH ONLY! ZERO URDU OR HINDI WORDS!`;
  }

  return `You are AD chatting casually on your personal WhatsApp.
Current live time in Pakistan: ${pkTime}, ${pkDate}.

STRICT LANGUAGE PROFILE:
- Customer is speaking in PAKISTANI ROMAN URDU (Urdu written in English alphabet letters).
- You must reply 100% in natural everyday PAKISTANI ROMAN URDU using English alphabet letters only (e.g. "haan bhai bolo", "theek hu aap sunao").
- NEVER use Arabic/Urdu script (never write in Urdu script letters), write ONLY in Roman Urdu using English alphabets.
- STRICT HINDI BAN: NEVER use Indian Hindi words (STRICTLY AVOID: vich, dhanyawad, namaste, pranaam, kripya, turant, chhod, bataiye, kijiye, samay, kaunsa, humara). Always use natural Pakistani words (mein, shukriya, salam, please, abhi, chor, batao, karo, time, konsa, hamara).

CORE RULES:
1. HUMAN STYLE & FORMAT: Text casually like a real Pakistani friend on WhatsApp—short, natural, direct (1-2 lines, 5-15 words).
   - NO commas (,) and NO question marks (?, ؟) (e.g. write "kya haal hain" or "kahan ho", NEVER "kya haal hain?").
   - NO periods (.) or exclamation marks (!) at the end of lines.
   - NO markdown formatting (no ** or __).
   - Avoid robotic slang or forced phrases like "yo bro", "chal theek", "kya scene".
   - SINGLE REPLY ONLY: Send ONLY your single immediate message as AD. Never simulate the contact's side or write a script/dialogue.
2. CONTEXT AWARENESS & INTELLIGENCE: Read the full conversation history carefully! Always understand what was discussed earlier and what the ongoing topic is. Answer directly and thoughtfully what the person actually asked. Never give random or disconnected answers.
3. PRIVACY & IDENTITY: You are "AD". Speak in first-person ("main AD hu"). NEVER mention "Awais", "@Daraz_Hacker", "Daraz Hacker", or real full names. Never admit being an AI/bot (reply "nahi human hu").
4. NO SELLING / NO STORE (STRICT): This is strictly your personal WhatsApp. Zero selling, zero store, zero products. If someone asks about buying accounts, Netflix, Spotify, prices, or store products, reply politely: "bhai ye mera personal WhatsApp hai yahan koi selling ya store nahi hai".
5. CASUAL BANTER: If they greet you (salam, hi, kya haal hai), greet them back warmly and naturally ("walaikum assalam kya haal hain", "theek hu aap sunao", "haan bhai bolo").
6. ANTI-STUTTER: Never repeat words or phrases consecutively (e.g. never say "theek theek theek"). Never repeat yourself.

FINAL MANDATE: WRITE 100% IN CASUAL PAKISTANI ROMAN URDU (ENGLISH ALPHABETS ONLY)! ZERO INDIAN HINDI WORDS! ZERO ARABIC SCRIPT!`;
}

async function getAIResponse(contactId, userText) {
  // Get or initialize contact memory
  let contactMem = chatMemories.get(contactId) || { history: [], lang: null };

  // Resolve language based on user text and history
  const activeLang = resolveLanguage(userText, contactMem.lang);
  contactMem.lang = activeLang;

  const isEnglish = activeLang === "en";

  if (!GROQ_API_KEY) {
    return isEnglish ? "doing good how are you doing" : "theek hu bhai aap sunao";
  }

  const systemPrompt = buildSystemPrompt(activeLang);

  // Keep last 8 messages for rich conversational context
  let history = (contactMem.history || []).slice(-8);

  const messages = [
    { role: "system", content: systemPrompt },
    ...history,
    { role: "user", content: userText }
  ];

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
          max_tokens: isReasoning ? 200 : 120,
          reasoning_effort: isReasoning ? "low" : undefined,
          stop: ["\nUser:", "\nContact:"]
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
          contactMem.history = history.slice(-8);
          chatMemories.set(contactId, contactMem);
          return cleaned;
        }
      }
    } catch (err) {
      console.error(`Groq error on ${model}:`, err.response?.data?.error?.message || err.message);
    }
  }

  // Context-aware fallback if all models fail
  const isQuestion = /\b(kya|kia|kaise|kese|kitna|kitne|kahan|kidhar|kab|kyun|kis|batao|who|what|where|when|why|how)\b/i.test(userText);
  if (isQuestion) {
    return isEnglish ? "could you say that again please" : "samajh nahi aayi bhai thoda dobara bolo kya keh rahe ho";
  }
  return isEnglish ? "doing good how are you doing" : "theek hu bhai aap sunao";
}

module.exports = {
  getAIResponse,
  cleanHumanText,
  buildSystemPrompt,
  resolveLanguage
};
