# WhatsApp AD Assistant Bot (Ubuntu VPS + Telegram Admin Bridge)

An intelligent, lightweight, human-like **WhatsApp AI Assistant (AD)** designed specifically to run seamlessly on low-resource VPS instances (such as Oracle Cloud 1GB RAM Ubuntu instances). 

Unlike heavy Puppeteer/Chromium bots, this bot runs on **Baileys WebSocket multi-device protocol**, consuming only **~50MB of RAM** and zero CPU when idle.

---

## 🌟 Key Features

1. **Natural Human Friend Persona (AD):**
   - **Identity:** Talks in first person as **AD** ("main AD bol raha hu").
   - **Hometown:** Lahore, Pakistan.
   - **Strict Privacy:** Never reveals real personal name (*never Awais*).
   - **No Store / E-Commerce:** Chatbot is purely conversational and friendly; no product catalogs or store links.
   - **Always Present:** Speaks directly with friends like a real human hanging out on WhatsApp.

2. **Telegram Admin Bridge (Controlled by `@Daraz_Hacker`):**
   - Controlled exclusively from Telegram by `@Daraz_Hacker`.
   - Manage allowed WhatsApp numbers via Telegram commands:
     - `/status` — View connection state & whitelist
     - `/add <phone>` — Whitelist a phone number (e.g. `/add 923001234567`)
     - `/remove <phone>` — Remove a phone number
     - `/list` — View all whitelisted numbers
     - `/allowall` — Allow all incoming contacts
     - `/say <phone> <message>` — Send WhatsApp messages directly from Telegram
   - Automatically notifies `@Daraz_Hacker` on Telegram whenever contacts message AD on WhatsApp.

3. **Multi-Device Pairing Code (No QR Scanning Needed):**
   - Generates an 8-character pairing code (e.g. `ABCD-1234`) displayed in the terminal and sent to your Telegram admin bot.
   - Simply enter this code in **WhatsApp > Linked Devices > Link with phone number**.

4. **1GB RAM Friendly (Baileys Engine):**
   - Uses zero headless browsers.
   - Works reliably on Oracle Free Tier 1GB AMD/Ampere instances without Out-Of-Memory (OOM) crashes.

---

## 🚀 Quick Setup on Oracle VPS (Ubuntu)

### 1. SSH into your VPS:
```bash
ssh ubuntu@YOUR_VPS_IP
```

### 2. Clone and Deploy:
```bash
git clone https://github.com/Don84848/whatsapp-ad-assistant.git
cd whatsapp-ad-assistant
chmod +x deploy.sh
./deploy.sh
```

### 3. Configure `.env`:
```bash
nano .env
```
Fill in:
- `WHATSAPP_PHONE_NUMBER`: Your WhatsApp number with country code (e.g. `923001234567`)
- `GROQ_API_KEY`: Your Groq API Key
- `TELEGRAM_BOT_TOKEN`: Your Telegram Bot Token

### 4. Link Your WhatsApp:
View your Pairing Code in PM2 logs:
```bash
pm2 logs whatsapp-ad-assistant
```
Open **WhatsApp on your phone > Linked Devices > Link with Phone Number**, and type the 8-digit code.

Your WhatsApp AD bot is now active and chatting 24/7!
