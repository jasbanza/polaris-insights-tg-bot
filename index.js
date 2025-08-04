/**
 * Polaris Insights Telegram Bot
 * 
 * This bot fetches the latest published insights from Polaris API and sends them to a Telegram chat.
 * It supports both simple text messages and rich image overlays with custom typography.
 * Uses intelligent caching to avoid sending duplicate insights.
 * 
 * Features:
 * - Fetches insights from Polaris API
 * - Processes multiple insights chronologically 
 * - Sends to Telegram with proper formatting
 * - Caches processed insights to prevent duplicates
 * - Optional image overlay with custom fonts (currently disabled)
 * 
 * @author jasbanza
 * @version 2.0.0
 */
// Import required modules
import fs from 'fs';
import fetch from 'node-fetch';
import { ConsoleLogColors } from "js-console-log-colors";
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// Get current directory for ES modules compatibility
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Initialize console logger with color support
const out = new ConsoleLogColors();

// Initialize Sharp and Canvas modules for image processing (optional feature)
// These are loaded dynamically to gracefully handle missing dependencies
let sharp = null;
let sharpAvailable = false;
let Canvas = null;
let canvasAvailable = false;

// Attempt to load Sharp module for image processing
try {
    const sharpModule = await import('sharp');
    sharp = sharpModule.default;
    
    if (sharp) {
        sharp.cache(false); // Disable cache to prevent font-related issues
        sharpAvailable = true;
        out.success('Sharp loaded successfully - image processing available');
    }
} catch (error) {
    out.warn(`Sharp not available (${error.message}) - image overlay disabled, text messages only`);
    sharpAvailable = false;
}

// Attempt to load Canvas module for text rendering
try {
    Canvas = await import('canvas');
    if (Canvas) {
        canvasAvailable = true;
        out.success('Canvas loaded successfully - custom font rendering available');
    }
} catch (error) {
    out.warn(`Canvas not available (${error.message}) - falling back to system fonts only`);
    canvasAvailable = false;
}

out.success('Polaris Insights Telegram Bot initialized successfully');

// Load environment variables from .env file
dotenv.config({ path: path.join(__dirname, '.env') });

/**
 * Application configuration object
 * Centralizes all configuration settings loaded from environment variables
 * @typedef {Object} Config
 */
const config = {
    /** Polaris API configuration */
    Polaris: {
        /** @type {string} Base URL for Polaris API */
        API_URL: process.env.POLARIS_API_URL || 'https://api.polaris.app',
        /** @type {string} Base URL for insight links */
        INSIGHTS_URL: process.env.POLARIS_INSIGHTS_URL || 'https://beta.polaris.app/insights/'
    },
    
    /** Telegram bot configuration */
    Telegram: {
        /** @type {string} Telegram bot token */
        TOKEN: process.env.TELEGRAM_TOKEN,
        /** @type {string} Telegram chat ID to send messages to */
        CHAT_ID: process.env.TELEGRAM_CHAT_ID,
        /** @type {boolean} Whether to use image overlays (requires Sharp and Canvas) */
        USE_IMAGE_OVERLAY: process.env.USE_IMAGE_OVERLAY === 'true' && sharpAvailable && canvasAvailable
    },
    
    /** Caching configuration */
    Cache: {
        /** @type {string} Path to cache file */
        FILENAME: path.join(__dirname, 'latest_insight.cache.json')
    },
    
    /** Insight processing configuration */
    Insights: {
        /** @type {number} Maximum number of insights to process per run */
        LIMIT: parseInt(process.env.INSIGHTS_LIMIT) || 5
    },
    
    /** Image overlay configuration (used when USE_IMAGE_OVERLAY is true) */
    ImageOverlay: {
        /** @type {number} Text width as percentage of image width (0.1-1.0) */
        TEXT_WIDTH_PERCENT: parseFloat(process.env.TEXT_WIDTH_PERCENT) || 0.8,
        /** @type {number} Image width divided by this number for font size */
        FONT_SIZE_DIVISOR: parseInt(process.env.FONT_SIZE_DIVISOR) || 20,
        /** @type {number} Pixels from bottom edge (deprecated - now using center alignment) */
        BOTTOM_MARGIN: parseInt(process.env.BOTTOM_MARGIN) || 60,
        /** @type {number} Line spacing multiplier */
        LINE_HEIGHT_MULTIPLIER: parseFloat(process.env.LINE_HEIGHT_MULTIPLIER) || 1.2,
        /** @type {string} Text color */
        TEXT_COLOR: process.env.TEXT_COLOR || 'white',
        /** @type {string} Text outline color */
        TEXT_STROKE_COLOR: process.env.TEXT_STROKE_COLOR || 'black',
        /** @type {number} Text outline thickness */
        TEXT_STROKE_WIDTH: parseInt(process.env.TEXT_STROKE_WIDTH) || 2,
        /** @type {number} Read time font size as percentage of main font (0.5-1.0) */
        READTIME_FONT_SIZE_PERCENT: parseFloat(process.env.READTIME_FONT_SIZE_PERCENT) || 0.7,
        /** @type {number} Pixels below main text for read time */
        READTIME_MARGIN_TOP: parseInt(process.env.READTIME_MARGIN_TOP) || 20,
        /** @type {string} Font family for text rendering */
        FONT_FAMILY: process.env.FONT_FAMILY || '"PP Editorial New Ultralight",Arial, serif',
        /** @type {number} JPEG quality 1-100 */
        IMAGE_QUALITY: parseInt(process.env.IMAGE_QUALITY) || 90
    }
};

/**
 * Main execution function
 * Initializes the bot, validates configuration, and processes new insights
 * @async
 * @function main
 * @returns {Promise<void>}
 * @throws {Error} When required environment variables are missing
 */
(async function main() {
    try {
        // Validate required environment variables
        if (!config.Telegram.TOKEN || !config.Telegram.CHAT_ID) {
            throw new Error('Missing required environment variables: TELEGRAM_TOKEN and/or TELEGRAM_CHAT_ID');
        }

        // Log current configuration for transparency
        out.info(`Sharp available: ${sharpAvailable}`);
        out.info(`Canvas available: ${canvasAvailable}`);
        out.info(`Image overlay enabled: ${config.Telegram.USE_IMAGE_OVERLAY}`);
        out.info(`Message type: ${config.Telegram.USE_IMAGE_OVERLAY ? 'Canvas-based image overlay' : 'Photo with caption (when available) or text only'}`);
        out.info(`Processing up to ${config.Insights.LIMIT} insights`);

        // Process new insights from the API
        await processNewPublishedInsights({ limit: config.Insights.LIMIT });

        out.success('Finished processing insights');

    } catch (error) {
        out.error(`Error in main execution: ${error.message}`);
        process.exit(1);
    }
})();

/**
 * Reads cached data from a JSON file
 * Provides graceful error handling and logging for cache operations
 * 
 * @async
 * @function readCache
 * @param {Object} options - Configuration options
 * @param {string} [options.filename='cache.json'] - Name of the cache file to read from
 * @returns {Object} Parsed JSON data or empty object if file doesn't exist or is invalid
 * @example
 * const cache = readCache({ filename: 'latest_insight.cache.json' });
 */
function readCache({ filename = 'cache.json' }) {
    try {
        // Debug logging for troubleshooting
        out.info(`Current working directory: ${process.cwd()}`);
        out.info(`Attempting to read cache file: ${filename}`);
        out.info(`File exists: ${fs.existsSync(filename)}`);

        if (!fs.existsSync(filename)) {
            out.warn(`Cache file does not exist: ${filename}`);
            return {};
        }

        const data = fs.readFileSync(filename, 'utf8');
        const parsed = JSON.parse(data);
        out.info(`Cache loaded successfully from: ${filename}`);
        return parsed;
        
    } catch (error) {
        out.warn(`Error reading cache (${filename}): ${error.message}`);
        return {};
    }
}

/**
 * Writes data to a JSON cache file with verification
 * Includes error handling and file verification
 * 
 * @async
 * @function writeCache
 * @param {Object} data - Data to be cached (will be JSON stringified)
 * @param {Object} [options] - Configuration options
 * @param {string} [options.filename='cache.json'] - Name of the cache file to write to
 * @returns {void}
 * @example
 * writeCache({ id: '123', timestamp: new Date().toISOString() }, { filename: 'cache.json' });
 */
function writeCache(data, { filename = 'cache.json' } = {}) {
    try {
        out.info(`Writing cache to: ${filename}`);
        fs.writeFileSync(filename, JSON.stringify(data, null, 2));
        out.info(`Cache updated successfully: ${filename}`);

        // Verify the file was written correctly
        if (fs.existsSync(filename)) {
            out.success(`Cache file verified: ${filename}`);
        } else {
            out.error(`Cache file was not created: ${filename}`);
        }
        
    } catch (error) {
        out.error(`Error writing cache: ${error.message}`);
    }
}

/**
 * Fetches new published insights and sends them to Telegram
 * Processes insights chronologically and uses caching to prevent duplicates
 * 
 * @async
 * @function processNewPublishedInsights
 * @param {Object} options - Processing options
 * @param {number} [options.limit=5] - Maximum number of insights to fetch and process
 * @returns {Promise<void>}
 * @throws {Error} When API request fails or returns invalid data
 * @example
 * await processNewPublishedInsights({ limit: 10 });
 */
async function processNewPublishedInsights({ limit = 5 }) {
    try {
        const url = `${config.Polaris.API_URL}/ai/curated-insights?_sort=publishedAt&_order=desc&_end=${limit}`;
        out.info(`Fetching latest ${limit} insights from: ${url}`);

        const response = await fetch(url);

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const insights = await response.json();

        // Validate API response
        if (!insights || insights.length === 0) {
            out.warn('No insights available from API');
            return;
        }

        // Reverse array to process chronologically (oldest first)
        // API returns newest first, but we want to send oldest unprocessed insights first
        const chronologicalInsights = insights.reverse();
        out.info(`Found ${chronologicalInsights.length} insights to process (reversed to oldest-first order)`);

        // Process each insight with error handling
        let processedCount = 0;
        for (const insight of chronologicalInsights) {
            try {
                // Check cache to avoid processing duplicates
                const cacheData = readCache({ filename: config.Cache.FILENAME });

                if (cacheData && cacheData.publishedAt) {
                    const cachedDate = new Date(cacheData.publishedAt);
                    const insightDate = new Date(insight.publishedAt);

                    // Skip if this insight was already processed
                    if (insightDate <= cachedDate) {
                        out.info(`Insight ${insight.id} (published: ${insight.publishedAt}) already processed (cached: ${cacheData.publishedAt}), skipping`);
                        continue;
                    }
                }

                out.info(`Processing new insight: ${insight.id} (published: ${insight.publishedAt})`);

                // Send the insight to Telegram
                const response = await sendMessage({ insight });

                // Validate response
                if (!response || !response.ok) {
                    throw new Error(`Telegram message failed: ${response?.description || 'Unknown error'}`);
                }

                out.success(`Message sent successfully for insight ${insight.id}`);

                // Update cache only after successful send
                writeCache({
                    id: insight.id,
                    publishedAt: insight.publishedAt,
                    sentAt: new Date().toISOString()
                }, { filename: config.Cache.FILENAME });

                processedCount++;

                // Rate limiting: add delay between messages (except for last one)
                const hasMoreInsights = processedCount < chronologicalInsights.length;
                if (hasMoreInsights) {
                    out.info('Waiting 1 second before processing next insight...');
                    await new Promise(resolve => setTimeout(resolve, 1000));
                }

            } catch (error) {
                out.error(`Error processing insight ${insight.id}: ${error.message}`);
                // Continue processing other insights instead of failing completely
                continue;
            }
        }

    } catch (error) {
        out.error(`Error fetching new published insights: ${error.message}`);
        throw error;
    }
}

/**
 * Creates an image with text overlay using Canvas and Sharp
 * This function is preserved for future use but currently disabled via configuration
 * 
 * @async
 * @function createImageWithTextOverlay
 * @param {Object} options - Image creation options
 * @param {string} options.backgroundImageUrl - URL of the background image to download
 * @param {string} options.headline - Text to overlay on the image
 * @param {string} [options.readTime] - Optional read time text to display below headline
 * @returns {Promise<Buffer>} Processed image buffer ready for upload
 * @throws {Error} When Sharp/Canvas unavailable or image processing fails
 * @example
 * const imageBuffer = await createImageWithTextOverlay({
 *   backgroundImageUrl: 'https://example.com/image.jpg',
 *   headline: 'Breaking News Story',
 *   readTime: '5 min read'
 * });
 */
async function createImageWithTextOverlay({ backgroundImageUrl, headline, readTime }) {
    try {
        // Validate dependencies
        if (!sharpAvailable) {
            throw new Error('Sharp module not available - cannot create image overlay');
        }
        
        if (!canvasAvailable) {
            throw new Error('Canvas module not available - cannot create text overlay');
        }
        
        out.info(`Creating image with Canvas text overlay for: ${headline}`);
        
        // Download the background image
        const imageResponse = await fetch(backgroundImageUrl);
        if (!imageResponse.ok) {
            throw new Error(`Failed to fetch background image: ${imageResponse.status}`);
        }
        
        const imageBuffer = await imageResponse.buffer();
        
        // Get image metadata for canvas sizing
        const image = sharp(imageBuffer);
        const metadata = await image.metadata();
        const { width, height } = metadata;
        
        // Create Canvas with same dimensions as background image
        const canvas = Canvas.createCanvas(width, height);
        const ctx = canvas.getContext('2d');
        
        // Configure font from environment settings
        const fontFamily = config.ImageOverlay.FONT_FAMILY;
        out.info(`Using system-installed fonts: ${fontFamily}`);
        
        // Calculate responsive text layout based on image dimensions
        const maxTextWidth = Math.floor(width * config.ImageOverlay.TEXT_WIDTH_PERCENT);
        const fontSize = Math.floor(width / config.ImageOverlay.FONT_SIZE_DIVISOR);
        const lineHeight = fontSize * config.ImageOverlay.LINE_HEIGHT_MULTIPLIER;
        
        // Configure Canvas text properties with custom styling
        ctx.font = `200 ${fontSize}px "${fontFamily.split(',')[0].replace(/"/g, '')}", serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.letterSpacing = '-0.0025em'; // Custom letter spacing for typography
        
        // Test font rendering for debugging
        const testMetrics = ctx.measureText('Test');
        out.info(`Font test - width: ${testMetrics.width}px, font: ${ctx.font}, letterSpacing: ${ctx.letterSpacing}`);
        
        // Intelligent text wrapping based on actual text measurements
        const words = headline.split(' ');
        const lines = [];
        let currentLine = '';
        
        for (const word of words) {
            const testLine = currentLine ? `${currentLine} ${word}` : word;
            const metrics = ctx.measureText(testLine);
            
            // Break line if text exceeds maximum width
            if (metrics.width > maxTextWidth && currentLine) {
                lines.push(currentLine);
                currentLine = word;
            } else {
                currentLine = testLine;
            }
        }
        if (currentLine) lines.push(currentLine);
        
        // Calculate vertical positioning for center alignment
        const totalTextHeight = lines.length * lineHeight;
        const readTimeFontSize = readTime ? Math.floor(fontSize * config.ImageOverlay.READTIME_FONT_SIZE_PERCENT) : 0;
        const readTimeHeight = readTime ? readTimeFontSize + config.ImageOverlay.READTIME_MARGIN_TOP : 0;
        const totalContentHeight = totalTextHeight + readTimeHeight;
        
        // Center the entire text block (main text + read time) vertically
        const centerY = height / 2;
        const startY = centerY - (totalContentHeight / 2);
        
        // Render main text with stroke effect for readability
        ctx.strokeStyle = config.ImageOverlay.TEXT_STROKE_COLOR;
        ctx.lineWidth = config.ImageOverlay.TEXT_STROKE_WIDTH;
        ctx.fillStyle = config.ImageOverlay.TEXT_COLOR;
        
        lines.forEach((line, index) => {
            const y = startY + (index * lineHeight);
            ctx.strokeText(line, width / 2, y); // Text outline
            ctx.fillText(line, width / 2, y);   // Text fill
        });
        
        // Render read time if available
        if (readTime) {
            const readTimeY = startY + totalTextHeight + config.ImageOverlay.READTIME_MARGIN_TOP;
            
            // Use smaller font for read time
            ctx.font = `200 ${readTimeFontSize}px "${fontFamily.split(',')[0].replace(/"/g, '')}", serif`;
            ctx.strokeStyle = config.ImageOverlay.TEXT_STROKE_COLOR;
            ctx.lineWidth = 1; // Thinner stroke for read time
            ctx.fillStyle = config.ImageOverlay.TEXT_COLOR;
            
            const readTimeText = `(${readTime})`;
            ctx.strokeText(readTimeText, width / 2, readTimeY);
            ctx.fillText(readTimeText, width / 2, readTimeY);
        }
        
        // Convert Canvas to PNG buffer for compositing
        const canvasBuffer = canvas.toBuffer('image/png');
        
        // Composite text overlay onto background image using Sharp
        const finalImage = await image
            .composite([{ input: canvasBuffer, top: 0, left: 0 }])
            .jpeg({ quality: config.ImageOverlay.IMAGE_QUALITY })
            .toBuffer();
        
        out.success('Image with Canvas text overlay created successfully');
        return finalImage;
        
    } catch (error) {
        out.error(`Error creating image with Canvas text overlay: ${error.message}`);
        throw error;
    }
}

/**
 * Sends a message with insight data to Telegram chat
 * Automatically chooses between text message and image overlay based on configuration
 * Provides graceful fallback from image overlay to text message on errors
 * 
 * @async
 * @function sendMessage
 * @param {Object} options - Message options
 * @param {Object} options.insight - The insight object containing message data
 * @param {string} options.insight.headline - The insight headline text
 * @param {string} options.insight.id - The unique insight identifier
 * @param {string} [options.insight.backgroundValue] - Optional background image URL for overlay
 * @param {string} [options.insight.readTime] - Optional read time text
 * @returns {Promise<Object>} Telegram API response object
 * @throws {Error} When both image overlay and text message fail
 * @example
 * const response = await sendMessage({ 
 *   insight: { 
 *     headline: 'Breaking News', 
 *     id: '123',
 *     backgroundValue: 'https://example.com/image.jpg',
 *     readTime: '5 min read'
 *   } 
 * });
 */
async function sendMessage({ insight }) {
    try {
        // Check if image overlay is enabled and dependencies are available
        if (!config.Telegram.USE_IMAGE_OVERLAY || !sharpAvailable || !canvasAvailable) {
            // Log reason for using simple message format
            if (!sharpAvailable) {
                out.warn(`Sharp not available, sending photo/text message for insight ${insight.id}`);
            } else if (!canvasAvailable) {
                out.warn(`Canvas not available, sending photo/text message for insight ${insight.id}`);
            } else {
                out.info(`Image overlay disabled, sending photo/text message for insight ${insight.id}`);
            }
            return await sendTextMessage({ insight });
        }

        // Check if we have a background image for overlay
        if (!insight.backgroundValue) {
            out.warn(`No image URL found for insight ${insight.id}, sending text message instead`);
            return await sendTextMessage({ insight });
        }

        out.info(`Creating image overlay for insight ${insight.id}`);

        // Attempt to create image with text overlay
        const imageBuffer = await createImageWithTextOverlay({
            backgroundImageUrl: insight.backgroundValue,
            headline: insight.headline,
            readTime: insight.readTime
        });

        // Send the processed image via Telegram
        const telegramApiUrl = `https://api.telegram.org/bot${config.Telegram.TOKEN}/sendPhoto`;

        // Create simple caption since text is rendered on the image
        const caption = `**[Read more](${config.Polaris.INSIGHTS_URL}${insight.id})**`;

        out.info(`Sending photo with text overlay to Telegram chat: ${config.Telegram.CHAT_ID}`);

        // Prepare form data for file upload
        const FormData = (await import('form-data')).default;
        const form = new FormData();
        form.append('chat_id', config.Telegram.CHAT_ID);
        form.append('photo', imageBuffer, 'insight-image.jpg');
        form.append('caption', caption);
        form.append('parse_mode', 'markdown');

        const response = await fetch(telegramApiUrl, {
            method: 'POST',
            body: form
        });

        if (!response.ok) {
            throw new Error(`Telegram API error! status: ${response.status}`);
        }

        const data = await response.json();

        if (!data.ok) {
            throw new Error(`Telegram API returned error: ${data.description || 'Unknown error'}`);
        }

        return data;

    } catch (error) {
        out.error(`Error sending message: ${error.message}`);
        // Graceful fallback to text message if image processing fails
        out.warn(`Falling back to text message for insight ${insight.id}`);
        return await sendTextMessage({ insight });
    }
}

/**
 * Sends a text message to Telegram chat
 * Used as the primary message format when image overlay is disabled
 * If a background image is available, sends it as a photo with the headline as caption
 * 
 * @async
 * @function sendTextMessage
 * @param {Object} options - Message options
 * @param {Object} options.insight - The insight object containing headline and id
 * @param {string} options.insight.headline - The insight headline text
 * @param {string} options.insight.id - The unique insight identifier
 * @param {string} [options.insight.backgroundValue] - Optional background image URL
 * @returns {Promise<Object>} Telegram API response object
 * @throws {Error} When Telegram API request fails
 * @example
 * const response = await sendTextMessage({ 
 *   insight: { headline: 'Breaking News', id: '123', backgroundValue: 'https://example.com/image.jpg' } 
 * });
 */
async function sendTextMessage({ insight }) {
    try {
        // If there's a background image, send it as a photo with caption
        if (insight.backgroundValue) {
            return await sendPhotoMessage({ insight });
        }

        // Otherwise send as plain text message
        const telegramApiUrl = `https://api.telegram.org/bot${config.Telegram.TOKEN}/sendMessage`;

        // Create formatted message with headline and read more link
        const messageText = `${insight.headline}

[Read more](${config.Polaris.INSIGHTS_URL}${insight.id})`;

        out.info(`Sending text message to Telegram chat: ${config.Telegram.CHAT_ID}`);

        const response = await fetch(telegramApiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: config.Telegram.CHAT_ID,
                text: messageText,
                parse_mode: 'markdown',
                disable_web_page_preview: false
            })
        });

        if (!response.ok) {
            throw new Error(`Telegram API error! status: ${response.status}`);
        }

        const data = await response.json();

        if (!data.ok) {
            throw new Error(`Telegram API returned error: ${data.description || 'Unknown error'}`);
        }

        return data;

    } catch (error) {
        out.error(`Error sending text message: ${error.message}`);
        throw error; // Re-throw to allow caller to handle
    }
}

/**
 * Sends a photo message to Telegram chat
 * Sends the background image with headline and read more link as caption
 * 
 * @async
 * @function sendPhotoMessage
 * @param {Object} options - Message options
 * @param {Object} options.insight - The insight object containing message data
 * @param {string} options.insight.headline - The insight headline text
 * @param {string} options.insight.id - The unique insight identifier
 * @param {string} options.insight.backgroundValue - Background image URL
 * @returns {Promise<Object>} Telegram API response object
 * @throws {Error} When Telegram API request fails or image download fails
 * @example
 * const response = await sendPhotoMessage({ 
 *   insight: { headline: 'Breaking News', id: '123', backgroundValue: 'https://example.com/image.jpg' } 
 * });
 */
async function sendPhotoMessage({ insight }) {
    try {
        const telegramApiUrl = `https://api.telegram.org/bot${config.Telegram.TOKEN}/sendPhoto`;

        // Create caption with headline and read more link
        const caption = `${insight.headline}

[Read more](${config.Polaris.INSIGHTS_URL}${insight.id})`;

        out.info(`Sending photo message to Telegram chat: ${config.Telegram.CHAT_ID}`);

        // Send photo using the direct URL (let Telegram handle the download)
        const response = await fetch(telegramApiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: config.Telegram.CHAT_ID,
                photo: insight.backgroundValue,
                caption: caption,
                parse_mode: 'markdown'
            })
        });

        if (!response.ok) {
            throw new Error(`Telegram API error! status: ${response.status}`);
        }

        const data = await response.json();

        if (!data.ok) {
            throw new Error(`Telegram API returned error: ${data.description || 'Unknown error'}`);
        }

        return data;

    } catch (error) {
        out.error(`Error sending photo message: ${error.message}`);
        throw error; // Re-throw to allow caller to handle
    }
}
