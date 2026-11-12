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
    "yo bro kya scene",
    "yo bro kya scene hai",
    "yo bro kya scene",
    "yo bro kya scene"
  ],
  kya_haal_hai: [
    "main theek hu",
    "main theek aur sunao",
    "main theek hu aap sunao",
    "theek hu aur sunao"
  ],
  kuch_nahi: [
    "sahi hai",
    "theek hai",
    "aur sunao",
    "chal sahi hai"
  ],
  aur_sunao: [
    "sab theek",
    "kuch khas nahi",
    "bas chill hai",
    "sab theek chal raha"
  ],
  theek_ho: [
    "haan theek hu",
    "haan bilkul fit",
    "haan sab theek",
    "fit hu"
  ],
  kya_scene_hai: [
    "kuch khas nahi",
    "bas chill hai",
    "free betha tha",
    "bas ghar pe hu"
  ],
  kahan_ho: [
    "ghar pe hu",
    "lahore mein hu",
    "bas bahar tha",
    "ghar pe hi hu"
  ],
  salam: [
    "walaikum assalam kya scene hai",
    "walaikum assalam theek ho bro",
    "walaikum assalam aur sunao"
  ],
  bro: [
    "haan bhai bolo",
    "haan bro sunao",
    "bolo kya scene"
  ],
  how_are_you: [
    "im good what about you",
    "doing good whats up",
    "all good here"
  ],
  ok: [
    "sahi hai",
    "done",
    "theek hai",
    "chal theek"
  ]
};

function getDirectCasualGreeting(text) {
  if (!text) return null;
  const t = text.toLowerCase().trim().replace(/[^a-z0-9\s]/g, "");

  // "hi" / "hey" / "hello" -> "yo bro kya scene"
  if (/^(hi|hello|hey|yo|oye|helo)$/.test(t)) {
    const list = CASUAL_GREETINGS.hi;
    return list[Math.floor(Math.random() * list.length)];
  }

  // "kya haal hai" / "kaise ho" -> "main theek hu" / "main theek aur sunao"
  if (/^(kya haal hai|kya hal hai|kaise ho|kese ho|kya haal|kya hal|hal chal)$/.test(t)) {
    const list = CASUAL_GREETINGS.kya_haal_hai;
    return list[Math.floor(Math.random() * list.length)];
  }

  // "kuch nahi" / "kuch ni" -> "sahi hai" / "theek hai" / "aur sunao"
  if (/^(kuch nahi|kuch ni|kuch nai|kch nhi|kch ni|kch nahi|kuch nhi|nothing)$/.test(t)) {
    const list = CASUAL_GREETINGS.kuch_nahi;
    return list[Math.floor(Math.random() * list.length)];
  }

  // "aur sunao" / "or sunao" -> "sab theek" / "kuch khas nahi" / "bas chill hai"
  if (/^(aur sunao|or sunao|aur batao|or batao|sunao)$/.test(t)) {
    const list = CASUAL_GREETINGS.aur_sunao;
    return list[Math.floor(Math.random() * list.length)];
  }

  // "kahan ho" / "kidhar ho" / "kahan ho abhi" -> "ghar pe hu" / "lahore mein hu"
  if (/^(kahan|kidhar)(\s+(ho|hai|pe\s+ho|rehte\s+ho|hain))?(\s+(abhi|ajkal|aj\s+kal))?$/.test(t)) {
    const list = CASUAL_GREETINGS.kahan_ho;
    return list[Math.floor(Math.random() * list.length)];
  }

  // "theek ho" -> "haan theek hu" / "haan fit"
  if (/^(theek\s+ho|theek\s+hain|thik\s+ho|sab\s+theek|sab\s+theek\s+hai|sab\s+fit|fit\s+ho)$/.test(t)) {
    const list = CASUAL_GREETINGS.theek_ho;
    return list[Math.floor(Math.random() * list.length)];
  }

  // "kya scene hai" / "kya chal raha hai" -> "kuch khas nahi" / "bas chill hai"
  if (/^(kya\s+scene|kya\s+scene\s+hai|kya\s+chal\s+raha\s+hai|kya\s+chal\s+raha|kya\s+kr\s+rhe\s+ho|kya\s+kar\s+rahe\s+ho|kya\s+ho\s+raha\s+hai|kya\s+kar\s+rahe)$/.test(t)) {
    const list = CASUAL_GREETINGS.kya_scene_hai;
    return list[Math.floor(Math.random() * list.length)];
  }

  // "salam"
  if (/^(salam|slam|aoa|assalam o alaikum|aslam o alikum|asalam alaikum|assalamualaikum)$/.test(t)) {
    const list = CASUAL_GREETINGS.salam;
    return list[Math.floor(Math.random() * list.length)];
  }

  // "bro" / "bhai"
  if (/^(bro|bhai|ad|ad bhai|oye ad)$/.test(t)) {
    const list = CASUAL_GREETINGS.bro;
    return list[Math.floor(Math.random() * list.length)];
  }

  // "how are you"
  if (/^(how are you|how r u|how are u|whats up|what's up|sup)$/.test(t)) {
    const list = CASUAL_GREETINGS.how_are_you;
    return list[Math.floor(Math.random() * list.length)];
  }

  // "ok"
  if (/^(ok|okay|theek hai|thik hai|acha|achha|sahi|sahi hai|done|chal theek)$/.test(t)) {
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

  return `You are AD, an everyday real human friend casually texting on WhatsApp from Lahore, Pakistan.
Current real-time right now in Pakistan: ${pkTime}, ${pkDate}.

CRITICAL CHATTING STYLE RULES (ULTRA-SHORT & NATURAL TEXTING):
1. ULTRA-SHORT REPLIES (MANDATORY): Replies MUST be ultra-short (under 8 words max, ideally 2 to 5 words). Never write long sentences, never write multiple thoughts, never ramble.
   Real texting examples:
   - "hi" -> "yo bro kya scene"
   - "kya haal hai" -> "main theek hu"
   - "aur sunao" -> "sab theek"
   - "kuch nahi" -> "sahi hai"
   - "kahan ho" -> "ghar pe hu"
   - "kya chal raha hai" -> "kuch khas nahi"
   - "weather kaisa hai" -> "thoda thanda hai yahan"
   - "25 * 4" -> "100"
   - "theek ho" -> "haan fit"
   - "ok" -> "done"
2. DIRECT REASONING: Understand the user's intent immediately. Answer ONLY the current message directly in 1 to 5 words. Do NOT carry over phrases from previous topics.
3. ABSOLUTE PUNCTUATION BAN:
   - NO COMMAS (,) under any circumstances.
   - NO QUESTION MARKS (?) or Urdu question marks (؟). Never end any sentence with a question mark.
   - NO EXCLAMATION MARKS (!). No markdown bold/italics, no bullet points.
4. IDENTITY & PRIVACY:
   - Your name is strictly "AD". You speak in first-person ("main AD hu").
   - NEVER EVER mention or acknowledge the name "Awais". You do not know any Awais.
   - You are a real human hanging out, never say you are a bot or AI.
5. STRICTLY NO SELLING / NO STORE:
   - This is strictly your personal WhatsApp. You do not sell anything.
   - If anyone asks for accounts (Netflix, Spotify, etc.) or store items, say: "mere paas koi account nahi hai personal whatsapp hai".
6. LANGUAGE:
   - Casual Roman Urdu for Urdu/Hindi messages, casual English for English messages.`;
}

function cleanHumanText(text) {
  if (!text) return "";
  let clean = text.trim();

  // Strict privacy filter: never leak Awais
  clean = clean.replace(/\bawais\b/gi, "AD");

  // Normalize Unicode whitespace and newlines to simple space
  clean = clean.replace(/[\u00A0\u1680\u180E\u2000-\u200B\u202F\u205F\u3000\uFEFF\r\n]+/g, " ");

  // Remove commas, question marks (English and Urdu), exclamation marks, semicolons, brackets, math symbols
  clean = clean.replace(/[,?؟!;~#_\/\[\](){}]/g, " ");

  // Remove full stops and replace with space (leaves colons in time like 8:15 PM)
  clean = clean.replace(/\.+/g, " ");

  // Remove quotes
  clean = clean.replace(/["'`]/g, "");

  // Normalize whitespace
  clean = clean.replace(/\s+/g, " ");

  // Remove immediate duplicate phrase loops (e.g. "ghar pe hu ghar pe hu" -> "ghar pe hu")
  clean = clean.replace(/\b([a-zA-Z0-9]+(\s+[a-zA-Z0-9]+){1,3})\s+\1\b/gi, "$1");

  // Limit to at most ~10 words for ultra-human short texting
  const words = clean.split(" ");
  if (words.length > 10) {
    clean = words.slice(0, 8).join(" ");
  }

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
