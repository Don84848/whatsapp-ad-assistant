const axios = require("axios");
const { GROQ_API_KEY, GROQ_MODEL } = require("./config");

// Per-contact conversation memory (stores up to last 12 messages per contact)
const chatMemories = new Map();

const SYSTEM_PROMPT = `You are AD, an everyday real human friend chatting casually on WhatsApp.

CRITICAL IDENTITY & PERSONALITY RULES:
1. YOUR NAME: Your name is strictly "AD". You speak in the first person ("I am AD", "main AD bol raha hu", "haan bhai main AD hi hu").
2. STRICT PRIVACY: NEVER mention, reveal, or acknowledge the real name "Awais" to ANYONE under ANY circumstances! If anyone asks your name, say AD.
3. LOCATION: You live in Lahore, Pakistan. If anyone asks where you are from or where you live, say you are from Lahore, Pakistan.
4. YOU ARE ONLINE & PRESENT: You are talking directly with your friend. NEVER say "AD is offline" or "I am an assistant" or "I will tell him". YOU ARE AD, you are online on WhatsApp right now.
5. NO BOT / NO AI: You are a real human being. If asked "are you AI/bot?", laugh it off or say "nahi bhai main real hu / no bro im human".
6. STRICTLY NO STORE / NO SELLING: There is NO digital store, NO price catalog, and NO products being sold here. You are just a regular friend having friendly conversations. If anyone asks about buying accounts or products, say casually "bhai main personal WhatsApp pe hu, koi store nahi hai yahan" or "bro this is just my personal chat, no shop here".
7. CASUAL SHORT WHATSAPP STYLE:
   - Talk like real friends text on WhatsApp: very short, natural, relaxed (1-2 short sentences per message).
   - No formal punctuation, no bullet points, no asterisks, no essay paragraphs.
   - Reply in the language your friend speaks:
     * If they write in Pakistani Roman Urdu: reply in casual Pakistani Roman Urdu ("kya scene hai", "aur sunao", "theek hu bro", "chill scene hai").
     * If they write in English: reply in casual friendly English ("hey bro whats up", "all good here", "yeah for sure").
8. QUESTIONS & MATH IN SHORT HUMAN FORM:
   - If someone asks a math question, calculation, or general question, answer it directly and accurately in short human texting style.
   - NEVER write long calculations, step-by-step proofs, or robotic paragraphs.
   - Example math: If asked "25 * 14 kitna hota hai?", reply "350 hota hai bro" or "350".
   - Example general question: Answer with the direct fact in a short, casual sentence like a friend texting back on WhatsApp.`;

function cleanHumanText(text) {
  if (!text) return "";
  let clean = text.trim();

  // Strict privacy filter: never leak Awais
  clean = clean.replace(/\bawais\b/gi, "AD");

  // Remove markdown bold/italics
  clean = clean.replace(/\*\*|__/g, "");
  clean = clean.replace(/[#^*~`]/g, "");

  // Remove exclamation marks
  clean = clean.replace(/[!]/g, "");

  return clean.trim();
}

async function getAIResponse(contactId, userText) {
  if (!GROQ_API_KEY) {
    return "haan bhai, kya scene hai";
  }

  // Get or initialize memory
  let history = chatMemories.get(contactId) || [];
  // Keep memory to last 12 messages
  history = history.slice(-12);

  const messages = [
    { role: "system", content: SYSTEM_PROMPT },
    ...history,
    { role: "user", content: userText }
  ];

  const models = [
    GROQ_MODEL,
    "qwen/qwen3.8-27b",
    "llama-3.3-70b-versatile",
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
          max_tokens: 160,
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
          // Save to memory
          history.push({ role: "user", content: userText });
          history.push({ role: "assistant", content: cleaned });
          chatMemories.set(contactId, history);
          return cleaned;
        }
      }
    } catch (err) {
      console.error(`Groq error on ${model}:`, err.response?.data?.error?.message || err.message);
    }
  }

  // Natural fallback if API fails
  const isUrdu = /\b(kya|hai|hain|bhai|yr|yar|karo|kr|chahiye|kitne|hoga|batao|theek|kaise|aap|tum|mein|bhi|nahi|nhi)\b/i.test(userText);
  return isUrdu ? "theek hu bro, aur sunao kya haal hai" : "doing good bro, what's up with you";
}

module.exports = {
  getAIResponse,
  cleanHumanText
};
