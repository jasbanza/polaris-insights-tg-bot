# Polaris Insights Telegram Bot

A intelligent Telegram bot that fetches the latest published insights from Polaris API and sends them to a Telegram chat with smart caching and multiple message formats.

![Polaris Insights stage](https://cronitor.io/badges/lt1C7T/production/fK1lLUWSJYSIezbKx2Pw2PkNx6Y.svg)

## Features

- **Smart Insight Fetching**: Retrieves latest published insights from Polaris API
- **Intelligent Caching**: Prevents duplicate messages using timestamp-based caching
- **Multiple Message Formats**: Supports both simple photo messages and advanced image overlays
- **Chronological Processing**: Processes insights from oldest to newest for proper ordering
- **Graceful Error Handling**: Continues processing even if individual insights fail
- **Rate Limiting**: Includes delays between messages to respect Telegram API limits
- **Comprehensive Logging**: Detailed logging with color-coded console output

## Message Format Behavior

The bot supports two primary message formats based on the `USE_IMAGE_OVERLAY` setting:

### When `USE_IMAGE_OVERLAY=false` (Default - Recommended)

| Has Background Image | Result | Description |
|---------------------|---------|-------------|
| ✅ **Yes** | **Photo with Caption** | Sends the insight's background image as a photo with headline and "Read more" link as caption |
| ❌ **No** | **Text Message** | Sends a formatted text message with headline and "Read more" link |

**Benefits:**
- ⚡ **Fast & Efficient**: No image processing required
- 🖼️ **Visual Impact**: Users see the actual insight images
- 📱 **Mobile Friendly**: Images display perfectly in Telegram clients
- 🔄 **Reliable**: Simple and robust message delivery

### When `USE_IMAGE_OVERLAY=true` (Advanced Feature)

| Has Background Image | Result | Description |
|---------------------|---------|-------------|
| ✅ **Yes** | **Custom Text Overlay** | Downloads image, renders custom text overlay with advanced typography, sends processed image |
| ❌ **No** | **Text Message** | Falls back to formatted text message |

**Benefits:**
- 🎨 **Custom Typography**: Uses PP Editorial New Ultralight font with custom styling
- 🎯 **Precise Layout**: Text positioning, sizing, and spacing control
- 🌈 **Advanced Styling**: Custom colors, stroke effects, and read time formatting
- 📐 **Responsive Design**: Text sizing adapts to image dimensions

**Requirements:**
- Sharp module for image processing
- Canvas module for text rendering
- Additional processing time and resources

## Quick Start

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd polaris-insights-tg-bot
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Configure environment**
   ```bash
   cp .env.example .env
   # Edit .env with your settings (see Configuration section)
   ```

4. **Run the bot**
   ```bash
   npm start
   ```

## Configuration

Create a `.env` file with the following variables:

### Required Settings
```env
TELEGRAM_TOKEN=your_telegram_bot_token_here
TELEGRAM_CHAT_ID=your_telegram_chat_id_here
```

### API Configuration (Optional)
```env
POLARIS_API_URL=https://api-stage.polaris.app
POLARIS_INSIGHTS_URL=https://beta-stage.polaris.app/insights/
INSIGHTS_LIMIT=5
```

### Message Format Configuration
```env
# Set to 'true' to use image overlays with text rendered on background images
# Set to 'false' to send background images with text as caption (simpler, faster)
USE_IMAGE_OVERLAY=false
```

### Advanced Image Overlay Settings (Only used when USE_IMAGE_OVERLAY=true)

When image overlay is enabled, you can customize the text rendering:

```env
# Text positioning and sizing
TEXT_WIDTH_PERCENT=0.8          # Text width as percentage of image width (0.1-1.0)
FONT_SIZE_DIVISOR=15            # Image width divided by this for font size (10-50)
LINE_HEIGHT_MULTIPLIER=1.2      # Line spacing multiplier (1.0-2.0)

# Text appearance
TEXT_COLOR=rgb(248, 246, 242)   # Custom off-white color
TEXT_STROKE_COLOR=black         # Text outline color
TEXT_STROKE_WIDTH=3             # Text outline thickness (0-5)
FONT_FAMILY="PP Editorial New Ultralight",serif   # System font with fallback

# Read time styling
READTIME_FONT_SIZE_PERCENT=0.6  # Read time font size as percentage of main text (0.5-1.0)
READTIME_MARGIN_TOP=20          # Pixels below main text (10-50)

# Image quality
IMAGE_QUALITY=90                # JPEG quality 1-100 (higher = better quality, larger file)
```

### Typography Features (Image Overlay Mode)

- **Custom Font**: Uses PP Editorial New Ultralight (system-installed) with serif fallback
- **Font Weight**: Light weight (200) for elegant appearance
- **Letter Spacing**: Custom spacing (-0.0025em) for improved readability
- **Smart Text Wrapping**: Intelligent line breaks based on actual text measurements
- **Vertical Centering**: Text is centered vertically on the image
- **Read Time Display**: Optional read time shown below headline in smaller font

## Dependencies

### Core Dependencies
- **`dotenv`**: Environment variable management
- **`node-fetch`**: HTTP requests for API communication
- **`js-console-log-colors`**: Enhanced console logging with color support

### Image Processing Dependencies (For Image Overlay Feature)
- **`sharp`**: High-performance image processing
- **`canvas`**: Text rendering and Canvas API support  
- **`form-data`**: File uploads to Telegram API

### Installation
```bash
# Install all dependencies
npm install

# For image overlay feature, ensure native dependencies are properly compiled
npm rebuild
```

## How It Works

1. **Fetches Insights**: Retrieves latest insights from Polaris API (up to configured limit)
2. **Checks Cache**: Compares insight timestamps against cached data to avoid duplicates
3. **Processes Chronologically**: Sorts insights from oldest to newest for proper delivery order
4. **Smart Message Format**: 
   - If image overlay disabled: Sends photo with caption (or text if no image)
   - If image overlay enabled: Creates custom text overlay on background image
5. **Updates Cache**: Records successfully sent insights with timestamps
6. **Rate Limiting**: Adds 1-second delay between messages to respect Telegram limits

## Caching System

The bot uses intelligent timestamp-based caching:
- **Cache File**: `latest_insight.cache.json` stores the last processed insight
- **Duplicate Prevention**: Compares `publishedAt` timestamps to skip already-sent insights
- **Persistence**: Cache survives bot restarts and ensures no missed or duplicate messages
- **Automatic Updates**: Cache is updated only after successful message delivery

## Usage

The bot can be run manually or scheduled with a cron job. It processes up to the configured number of insights and only sends new ones that haven't been cached.

### Manual Execution

```bash
npm start
# or
node index.js
```

### Automated Execution with Cron

To run the bot automatically at regular intervals, set up a cron job:

1. **Edit your crontab**:
   ```bash
   crontab -e
   ```

2. **Add a cron entry** (examples):
   ```bash
   # Run every 15 minutes
   */15 * * * * cd /absolute/path/to/polaris-insights-tg-bot && node index.js

   # Run every hour at minute 0
   0 * * * * cd /absolute/path/to/polaris-insights-tg-bot && node index.js

   # Run every 4 hours
   0 */4 * * * cd /absolute/path/to/polaris-insights-tg-bot && node index.js

   # Run daily at 9 AM
   0 9 * * * cd /absolute/path/to/polaris-insights-tg-bot && node index.js
   ```

3. **Important cron considerations**:
   - Use **absolute paths** for both the directory and node executable
   - Ensure the `.env` file is in the same directory as `index.js`
   - Consider redirecting output to a log file for debugging:
     ```bash
     */15 * * * * cd /absolute/path/to/polaris-insights-tg-bot && node index.js >> /var/log/polaris-bot.log 2>&1
     ```

4. **Alternative with full paths**:
   ```bash
   */15 * * * * /usr/bin/node /absolute/path/to/polaris-insights-tg-bot/index.js
   ```

### Systemd Service (Linux)

For more robust scheduling, consider creating a systemd service:

1. **Create service file** (`/etc/systemd/system/polaris-insights-bot.service`):
   ```ini
   [Unit]
   Description=Polaris Insights Telegram Bot
   After=network.target

   [Service]
   Type=oneshot
   User=your-username
   WorkingDirectory=/absolute/path/to/polaris-insights-tg-bot
   ExecStart=/usr/bin/node index.js
   Environment=NODE_ENV=production

   [Install]
   WantedBy=multi-user.target
   ```

2. **Create timer file** (`/etc/systemd/system/polaris-insights-bot.timer`):
   ```ini
   [Unit]
   Description=Run Polaris Insights Bot every 15 minutes
   Requires=polaris-insights-bot.service

   [Timer]
   OnCalendar=*:0/15
   Persistent=true

   [Install]
   WantedBy=timers.target
   ```

3. **Enable and start**:
   ```bash
   sudo systemctl daemon-reload
   sudo systemctl enable polaris-insights-bot.timer
   sudo systemctl start polaris-insights-bot.timer
   ```
