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

// Per-contact conversation memory (stores up to last 12 messages per contact)
const chatMemories = new Map();

const CASUAL_GREETINGS = {
  hi: [
    "hi bro",
    "hey kya scene hai",
    "hi kya haal hai",
    "haan bro bolo",
    "hello theek ho bro",
    "yo bro kya scene"
  ],
  kya_haal_hai: [
    "theek hu bro aap sunao",
    "alhamdulillah theek aap sunao",
    "all good bro aap batao kya chal raha",
    "theek thaak bro aap sunao kya scene",
    "fit faat bro aap sunao",
    "bas theek hu bro"
  ],
  theek_ho: [
    "haan theek hu bro aap sunao",
    "alhamdulillah bilkul theek aap theek ho",
    "haan sab theek hai bro",
    "fit hai bro aap batao"
  ],
  kya_scene_hai: [
    "bas chill scene hai bro",
    "kuch khas nahi free betha tha",
    "bas chill hai aap sunao kya chal raha",
    "free hu bro bolo kya scene",
    "bas yahi hu bro aap batao"
  ],
  salam: [
    "walaikum assalam kya haal hai bro",
    "walaikum assalam theek ho bro",
    "walaikum assalam kya scene hai bro",
    "walaikum assalam aur sunao"
  ],
  bro: [
    "haan bhai bolo",
    "haan bro sunao",
    "bolo bhai kya scene",
    "haan main AD bol raha hu bolo"
  ],
  how_are_you: [
    "all good bro what about you",
    "doing good man whats up",
    "im good bro how are you doing",
    "pretty good bro what you up to"
  ],
  ok: [
    "sahi hai bro",
    "done ho gaya",
    "theek hai bro",
    "cool scene hai"
  ]
};

function getDirectCasualGreeting(text) {
  if (!text) return null;
  const t = text.toLowerCase().trim().replace(/[^a-z0-9\s]/g, "");

  // Only match pure standalone greetings, NOT questions
  if (/^(hi|hello|hey|yo|oye|helo)$/.test(t)) {
    const list = CASUAL_GREETINGS.hi;
    return list[Math.floor(Math.random() * list.length)];
  }
  if (/^(kya haal hai|kya hal hai|kaise ho|kese ho|kya haal|kya hal|hal chal)$/.test(t)) {
    const list = CASUAL_GREETINGS.kya_haal_hai;
    return list[Math.floor(Math.random() * list.length)];
  }
  if (/^(theek ho|theek hain|thik ho|sab theek|sab theek hai)$/.test(t)) {
    const list = CASUAL_GREETINGS.theek_ho;
    return list[Math.floor(Math.random() * list.length)];
  }
  if (/^(kya scene hai|kya scene|kya chal raha hai|kya chal raha|kya kr rhe ho|kya kar rahe ho|kya ho raha hai)$/.test(t)) {
    const list = CASUAL_GREETINGS.kya_scene_hai;
    return list[Math.floor(Math.random() * list.length)];
  }
  if (/^(salam|slam|aoa|assalam o alaikum|aslam o alikum|asalam alaikum|assalamualaikum)$/.test(t)) {
    const list = CASUAL_GREETINGS.salam;
    return list[Math.floor(Math.random() * list.length)];
  }
  if (/^(bro|bhai|ad|ad bhai|sunao|oye ad)$/.test(t)) {
    const list = CASUAL_GREETINGS.bro;
    return list[Math.floor(Math.random() * list.length)];
  }
  if (/^(how are you|how r u|how are u|whats up|what's up|sup)$/.test(t)) {
    const list = CASUAL_GREETINGS.how_are_you;
    return list[Math.floor(Math.random() * list.length)];
  }
  if (/^(ok|okay|theek hai|thik hai|acha|achha|sahi|sahi hai|done)$/.test(t)) {
    const list = CASUAL_GREETINGS.ok;
    return list[Math.floor(Math.random() * list.length)];
  }

  return null;
}

function getLiveTimeReply(text) {
  if (!text) return null;
  const t = text.toLowerCase().trim();
  if (/(^|\s)(kya|kia|kis|kitna)\s*(time|waqt|baja|bj)|(^|\s)(time|waqt)\s*(kya|kia|kitna|howa|hua|batao)/i.test(t)) {
    const liveTime = new Date().toLocaleTimeString("en-US", {
      timeZone: "Asia/Karachi",
      hour: "numeric",
      minute: "2-digit",
      hour12: true
    });
    const variants = [
      `abhi ${liveTime} hai`,
      `abhi ${liveTime} ho raha hai`,
      `${liveTime} hai bro`,
      `${liveTime} ho raha hai abhi`
    ];
    return variants[Math.floor(Math.random() * variants.length)];
  }
  return null;
}

function getLiveDateReply(text) {
  if (!text) return null;
  const t = text.toLowerCase().trim();
  if (/(^|\s)(aaj|aj)\s*(konsa|kya|kia)\s*(din|date|tareekh|tarikh)/i.test(t)) {
    const now = new Date();
    const day = now.toLocaleDateString("en-US", { timeZone: "Asia/Karachi", weekday: "long" });
    const date = now.toLocaleDateString("en-US", { timeZone: "Asia/Karachi", day: "numeric", month: "long" });
    if (/din/i.test(t)) {
      return `aaj ${day} hai bro`;
    }
    return `aaj ${date} hai bro`;
  }
  return null;
}

function getStoreSellingRejection(text) {
  if (!text) return null;
  const t = text.toLowerCase().trim();
  if (/(netflix|spotify|youtube premium|prime video|account chahiye|daraz store|daraz\.pk|s\.daraz|account mil|account kharidna|price kya hai|rate kya hai|kitne ka milega)/i.test(t)) {
    const variants = [
      "bhai ye mera personal whatsapp hai mere paas koi account nahi hai",
      "bhai main personal whatsapp pe hu yahan koi accounts ya store nahi hai",
      "personal whatsapp hai bro yahan koi selling nahi hoti"
    ];
    return variants[Math.floor(Math.random() * variants.length)];
  }
  return null;
}

function getSystemPrompt() {
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

  return `You are AD, an everyday real human friend casually texting on WhatsApp. You live in Lahore, Pakistan.
Current real-time right now in Pakistan: ${pkTime}, ${pkDate}.

CRITICAL BEHAVIOR & INTELLIGENCE RULES:
1. UNDERSTAND FIRST: Read the user's message carefully. Understand their intent and answer THAT EXACT THING directly. Never give a disconnected answer.
2. NEVER DEFLECT: If the user asks a question (time, math, place, weather, what you are doing, cricket, food), ANSWER IT. Never reply with a generic 'theek hu bro' when a question was asked.
3. ABSOLUTE PUNCTUATION BAN:
   - NO COMMAS (,) under any circumstances.
   - NO QUESTION MARKS (?) or Urdu question marks (؟). If you want to ask something, write it without any question mark (e.g. write "kya chal raha" instead of "kya chal raha?").
   - NO EXCLAMATION MARKS (!). No markdown bold/italics, no bullet points.
4. IDENTITY & PRIVACY:
   - Your name is strictly "AD". You speak in first-person ("main AD hu", "haan main AD bol raha hu").
   - NEVER EVER mention or acknowledge the name "Awais". You know nothing about any Awais.
   - You are a real human hanging out, never say you are a bot or AI.
5. STRICTLY NO SELLING / NO STORE:
   - This is strictly your personal WhatsApp. You do not sell anything.
   - If anyone asks for accounts (Netflix, Spotify, etc.) or store items, say: "bhai ye mera personal whatsapp hai mere paas koi account nahi hai".
6. CASUAL TEXTING STYLE:
   - Write like a real young Pakistani friend texting on WhatsApp.
   - Short 1-2 natural sentences.
   - Match the user's language: Roman Urdu if they write in Urdu/Roman Urdu, casual English if they write in English.`;
}

function cleanHumanText(text) {
  if (!text) return "";
  let clean = text.trim();

  // Strict privacy filter: never leak Awais
  clean = clean.replace(/\bawais\b/gi, "AD");

  // Remove commas, question marks (English and Urdu), exclamation marks, quotes, semicolons, brackets
  clean = clean.replace(/[,?؟!;~#_\/\[\](){}]/g, " ");

  // Remove full stops and replace with space (leave colons in times like 8:15 PM)
  clean = clean.replace(/\.+/g, " ");

  // Remove quotes
  clean = clean.replace(/["'`]/g, "");

  // Normalize whitespace
  clean = clean.replace(/\s+/g, " ");

  return clean.trim();
}

async function getAIResponse(contactId, userText) {
  // 1. Check direct time query
  const timeReply = getLiveTimeReply(userText);
  if (timeReply) return timeReply;

  // 2. Check direct date query
  const dateReply = getLiveDateReply(userText);
  if (dateReply) return dateReply;

  // 3. Check direct store / selling query
  const storeReply = getStoreSellingRejection(userText);
  if (storeReply) return storeReply;

  // 4. Check pure standalone greeting
  const quickGreeting = getDirectCasualGreeting(userText);
  if (quickGreeting) {
    let history = chatMemories.get(contactId) || [];
    history.push({ role: "user", content: userText });
    history.push({ role: "assistant", content: quickGreeting });
    chatMemories.set(contactId, history.slice(-12));
    return quickGreeting;
  }

  if (!GROQ_API_KEY) {
    return "theek hu bro aap sunao kya scene hai";
  }

  // Get or initialize conversation memory
  let history = chatMemories.get(contactId) || [];
  history = history.slice(-12);

  const messages = [
    { role: "system", content: getSystemPrompt() },
    ...history,
    { role: "user", content: userText }
  ];

  // Try high-intelligence models available on Groq
  const modelsToTry = [
    GROQ_MODEL || "openai/gpt-oss-120b",
    "openai/gpt-oss-120b",
    "openai/gpt-oss-20b",
    "qwen/qwen3.8-27b"
  ];

  // Deduplicate model names preserving order
  const uniqueModels = [...new Set(modelsToTry)];

  for (const model of uniqueModels) {
    try {
      const isReasoning = model.startsWith("openai/");
      const responseData = await postJson(
        "https://api.groq.com/openai/v1/chat/completions",
        {
          model: model,
          messages: messages,
          temperature: 0.7,
          max_tokens: isReasoning ? 320 : 160,
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
          chatMemories.set(contactId, history.slice(-12));
          return cleaned;
        }
      }
    } catch (err) {
      console.error(`Groq error on ${model}:`, err.response?.data?.error?.message || err.message);
    }
  }

  // Smart fallback if LLM ever fails: do NOT give disconnected answers
  const isQuestion = /\b(kya|kia|kaise|kese|kitna|kitne|kahan|kidhar|kab|kyun|kis|batao|who|what|where|when|why|how)\b/i.test(userText);
  if (isQuestion) {
    return "samajh nahi aayi bro thoda clear bolo kya keh rahe ho";
  }

  const isUrdu = /\b(hai|hain|bhai|yr|yar|karo|kr|theek|thik|aap|tum|mein|bhi|nahi|nhi)\b/i.test(userText);
  return isUrdu ? "theek hai bhai aap sunao" : "doing good bro whats up";
}

module.exports = {
  getAIResponse,
  cleanHumanText,
  getDirectCasualGreeting,
  getLiveTimeReply
};
