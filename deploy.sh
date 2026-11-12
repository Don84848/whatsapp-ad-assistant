#!/bin/bash
# ==============================================================================
# One-Click Deployment Script for WhatsApp AD Assistant Bot on Ubuntu VPS (Oracle)
# ==============================================================================

set -e

echo "🚀 Starting WhatsApp AD Assistant setup on Ubuntu VPS..."

# 1. Update system packages
sudo apt-get update -y
sudo apt-get install -y curl git build-essential

# 2. Install Node.js 20 LTS if not already installed
if ! command -v node &> /dev/null; then
    echo "📦 Installing Node.js 20 LTS..."
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
    sudo apt-get install -y nodejs
fi

echo "Node version: $(node -v)"
echo "NPM version: $(npm -v)"

# 3. Install PM2 process manager globally
if ! command -v pm2 &> /dev/null; then
    echo "📦 Installing PM2 process manager..."
    sudo npm install -g pm2
fi

# 4. Install project dependencies
echo "📦 Installing dependencies..."
npm install --omit=dev

# 5. Check for .env file
if [ ! -f .env ]; then
    echo "⚙️ Creating .env file from .env.example..."
    cp .env.example .env
    echo "⚠️ Please edit your .env file with your phone number and keys if needed!"
fi

# 6. Start the bot with PM2
echo "🔄 Starting bot under PM2..."
pm2 stop whatsapp-ad-assistant 2>/dev/null || true
pm2 start index.js --name "whatsapp-ad-assistant"
pm2 save

echo ""
echo "=============================================================="
echo "✅ WHATSAPP AD ASSISTANT IS RUNNING 24/7 UNDER PM2!"
echo "=============================================================="
echo "Useful Commands:"
echo "• View live logs / Pairing Code: pm2 logs whatsapp-ad-assistant"
echo "• Restart bot: pm2 restart whatsapp-ad-assistant"
echo "• Stop bot: pm2 stop whatsapp-ad-assistant"
echo "=============================================================="
