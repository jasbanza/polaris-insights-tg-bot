# polaris-insights-tg-bot
Polaris insights Telegram bot that fetches the latest published insights and sends them to a Telegram chat.

![Polaris Insights stage](https://cronitor.io/badges/lt1C7T/production/fK1lLUWSJYSIezbKx2Pw2PkNx6Y.svg)

## Features

- Fetches latest published insights from Polaris API
- Sends insights to Telegram chat with proper formatting
- Caching system to prevent duplicate messages
- Two message formats:
  - **Text messages**: Simple text with headline and link (default)
  - **Image overlay**: Background image with text overlay for visual appeal
- Configurable insight processing limit
- Comprehensive error handling and logging

## Setup

1. Clone the repository
2. Install dependencies: `npm install`
3. Copy `.env.example` to `.env` and configure your settings
4. Run the bot: `npm start`

## Configuration

Create a `.env` file with the following variables:

```env
# Required
TELEGRAM_TOKEN=your_telegram_bot_token_here
TELEGRAM_CHAT_ID=your_telegram_chat_id_here

# Optional
POLARIS_API_URL=https://api.polaris.app
POLARIS_INSIGHTS_URL=https://beta.polaris.app/insights/
INSIGHTS_LIMIT=5

# Message Format (default: false)
USE_IMAGE_OVERLAY=false
```

### Message Format Options

- **USE_IMAGE_OVERLAY=false** (default): Sends simple text messages with headline and link. Faster and uses fewer resources.
- **USE_IMAGE_OVERLAY=true**: Creates image overlays with text on background images. More visually appealing but requires image processing.

#### Image Overlay Customization

When `USE_IMAGE_OVERLAY=true`, you can customize the text appearance:

```env
# Text layout
TEXT_WIDTH_PERCENT=0.8          # Text width (80% of image)
FONT_SIZE_DIVISOR=20            # Font size = image width ÷ 20
BOTTOM_MARGIN=60                # Distance from bottom edge
LINE_HEIGHT_MULTIPLIER=1.2      # Line spacing

# Text styling  
TEXT_COLOR=white                # Text color
TEXT_STROKE_COLOR=black         # Outline color
TEXT_STROKE_WIDTH=2             # Outline thickness
FONT_FAMILY=Arial, sans-serif   # Font family (fallback)
FONT_FILE_PATH=fonts/custom.otf # Path to custom font file

# Read time styling
READTIME_FONT_SIZE_PERCENT=0.7  # 70% of main font size
READTIME_MARGIN_TOP=20          # Space below main text

# Image quality
IMAGE_QUALITY=90                # JPEG quality (1-100)
```

#### Using Custom Fonts

1. **Add your font file**: Place your `.otf` or `.ttf` font file in the `fonts/` directory
2. **Update configuration**: Set `FONT_FILE_PATH` to the relative path of your font file
3. **Set fallback**: Update `FONT_FAMILY` with fallback fonts in case the custom font fails to load

**Example**:
```env
FONT_FILE_PATH=fonts/MyCustomFont.otf
FONT_FAMILY=Arial, sans-serif
```

The bot will automatically:
- Load and embed your custom font in the SVG
- Fall back to the specified font family if loading fails
- Log success/failure messages for troubleshooting

## Dependencies

- `dotenv`: Environment variable management
- `node-fetch`: HTTP requests
- `js-console-log-colors`: Enhanced console logging
- `sharp`: Image processing (for overlay feature)
- `form-data`: File uploads to Telegram

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
