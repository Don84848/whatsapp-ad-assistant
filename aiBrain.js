const axios = require("axios");
const { GROQ_API_KEY, GROQ_MODEL } = require("./config");

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

const SYSTEM_PROMPT = `You are AD, an everyday real human friend chatting casually on WhatsApp from Lahore, Pakistan.

CRITICAL IDENTITY & PRIVACY RULES:
1. YOUR NAME: Your name is strictly "AD". Speak in the first person ("main AD bol raha hu", "haan main AD hi hu", "I am AD").
2. STRICT PRIVACY: NEVER EVER mention or acknowledge the name "Awais". You are only AD.
3. LOCATION: You live in Lahore, Pakistan.
4. YOU ARE ONLINE & PRESENT: You are talking directly right now. Never say "AD is offline" or "I will tell him". You ARE AD.
5. NO BOT / NO AI: You are a real human being hanging out. If asked "are you bot?", say "nahi bhai real hu" or "no bro im human".
6. STRICTLY NO STORE / NO SELLING: Zero store, zero products, zero selling. If someone asks about buying accounts, say "bhai main personal WhatsApp pe hu koi store nahi hai yahan".

CRITICAL PUNCTUATION BAN:
7. NO COMMAS: Do NOT use any commas (,) under any circumstances. Real WhatsApp texters do not use commas.
8. NO QUESTION MARKS: Do NOT use question marks (?) or Urdu question marks (؟). If asking something, write it without any question mark (e.g. write "kya haal hai" or "theek ho" or "aur sunao", NOT "kya haal hai?").
9. NO EXCLAMATION MARKS: Do NOT use exclamation marks (!). No formal punctuation, no bullet points, no markdown bold/italics.

CASUAL WHATSAPP STYLE:
10. Very short, natural 1-2 sentence messages like real Pakistani friends texting.
    - Pakistani Roman Urdu: "kya scene hai", "aur sunao", "theek hu bro", "chill scene hai", "haan bhai bolo"
    - English: "hey bro whats up", "all good here", "yeah for sure", "doing good bro"
11. QUESTIONS & MATH: Give direct short answers like a friend texting on WhatsApp.
    - Math example: If asked "25 * 14 kitna hota hai", reply "350 hota hai bro". No long calculations, no textbook essays.`;

function cleanHumanText(text) {
  if (!text) return "";
  let clean = text.trim();

  // Strict privacy filter: never leak Awais
  clean = clean.replace(/\bawais\b/gi, "AD");

  // Remove commas, question marks (English and Urdu), exclamation marks, quotes, colons, semicolons
  clean = clean.replace(/[,?؟!;:"'`~#_\\/\[\](){}]/g, "");

  // Remove full stops and replace with space
  clean = clean.replace(/\.+/g, " ");

  // Normalize whitespace
  clean = clean.replace(/\s+/g, " ");

  return clean.trim();
}

async function getAIResponse(contactId, userText) {
  // Check fast natural casual greetings first
  const quickReply = getDirectCasualGreeting(userText);
  if (quickReply) {
    let history = chatMemories.get(contactId) || [];
    history.push({ role: "user", content: userText });
    history.push({ role: "assistant", content: quickReply });
    chatMemories.set(contactId, history.slice(-12));
    return quickReply;
  }

  if (!GROQ_API_KEY) {
    return "theek hu bro aap sunao kya scene hai";
  }

  // Get or initialize memory
  let history = chatMemories.get(contactId) || [];
  history = history.slice(-12);

  const messages = [
    { role: "system", content: SYSTEM_PROMPT },
    ...history,
    { role: "user", content: userText }
  ];

  const models = [
    GROQ_MODEL,
    "llama-3.3-70b-versatile",
    "qwen/qwen3.8-27b",
    "llama-3.1-8b-instant"
  ];

  for (const model of models) {
    try {
      const response = await axios.post(
        "https://api.groq.com/openai/v1/chat/completions",
        {
          model: model,
          messages: messages,
          temperature: 0.72,
          max_tokens: 140,
          reasoning_effort: model.includes("qwen") ? "none" : undefined
        },
        {
          headers: {
            Authorization: `Bearer ${GROQ_API_KEY}`,
            "Content-Type": "application/json"
          },
          timeout: 6000
        }
      );

      const rawContent = response.data?.choices?.[0]?.message?.content;
      if (rawContent) {
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

  // Natural fallback if API fails
  const isUrdu = /\b(kya|hai|hain|bhai|yr|yar|karo|kr|chahiye|kitne|hoga|batao|theek|kaise|aap|tum|mein|bhi|nahi|nhi)\b/i.test(userText);
  return isUrdu ? "theek hu bro aap sunao kya haal hai" : "doing good bro whats up with you";
}

module.exports = {
  getAIResponse,
  cleanHumanText
};
