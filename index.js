/**
 * Polaris Insights Telegram Bot
 * 
 * This bot fetches the latest published insights from Polaris API and sends them to a Telegram chat.
 * It uses caching to avoid sending duplicate insights.
 * 
 * @author jasbanza
 * @version 1.0.0
 */
"use strict";
import fs from 'fs';
import fetch from 'node-fetch';
import { ConsoleLogColors } from "js-console-log-colors"; // custom context colors for console logging by jasbanza
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// Get current directory for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Initialize console log colors
const out = new ConsoleLogColors();

// Initialize Sharp and Canvas with proper font configuration
let sharp = null;
let sharpAvailable = false;
let Canvas = null;
let canvasAvailable = false;

try {
    const sharpModule = await import('sharp');
    sharp = sharpModule.default;
    
    // Initialize Sharp with font configuration to fix Fontconfig warnings
    if (sharp) {
        sharp.cache(false); // Disable cache to avoid font issues
        sharpAvailable = true;
        out.success(`Sharp loaded successfully - image processing available`);
    }
} catch (error) {
    out.warn(`Sharp not available (${error.message}) - image overlay disabled, text messages only`);
    sharpAvailable = false;
}

try {
    Canvas = await import('canvas');
    if (Canvas) {
        canvasAvailable = true;
        out.success(`Canvas loaded successfully - custom font rendering available`);
    }
} catch (error) {
    out.warn(`Canvas not available (${error.message}) - falling back to system fonts only`);
    canvasAvailable = false;
}

out.success(`Polaris Insights Telegram Bot initialized successfully`);

// Load environment variables from .env file
dotenv.config({ path: path.join(__dirname, '.env') });

// Configuration object to centralize API URLs and settings
const config = {
    Polaris: {
        API_URL: process.env.POLARIS_API_URL || 'https://api.polaris.app',
        INSIGHTS_URL: process.env.POLARIS_INSIGHTS_URL || 'https://beta.polaris.app/insights/'
    },
    Telegram: {
        TOKEN: process.env.TELEGRAM_TOKEN,
        CHAT_ID: process.env.TELEGRAM_CHAT_ID,
        USE_IMAGE_OVERLAY: process.env.USE_IMAGE_OVERLAY === 'true' && sharpAvailable && canvasAvailable // Require both Sharp and Canvas
    },
    Cache: {
        FILENAME: path.join(__dirname, 'latest_insight.cache.json')
    },
    Insights: {
        LIMIT: parseInt(process.env.INSIGHTS_LIMIT) || 5 // Default to 5 if not set
    },
    ImageOverlay: {
        TEXT_WIDTH_PERCENT: parseFloat(process.env.TEXT_WIDTH_PERCENT) || 0.8, // 80% of image width
        FONT_SIZE_DIVISOR: parseInt(process.env.FONT_SIZE_DIVISOR) || 20, // width / 20 for font size
        BOTTOM_MARGIN: parseInt(process.env.BOTTOM_MARGIN) || 60, // pixels from bottom
        LINE_HEIGHT_MULTIPLIER: parseFloat(process.env.LINE_HEIGHT_MULTIPLIER) || 1.2, // font size * 1.2
        TEXT_COLOR: process.env.TEXT_COLOR || 'white',
        TEXT_STROKE_COLOR: process.env.TEXT_STROKE_COLOR || 'black',
        TEXT_STROKE_WIDTH: parseInt(process.env.TEXT_STROKE_WIDTH) || 2,
        READTIME_FONT_SIZE_PERCENT: parseFloat(process.env.READTIME_FONT_SIZE_PERCENT) || 0.7, // 70% of main font size
        READTIME_MARGIN_TOP: parseInt(process.env.READTIME_MARGIN_TOP) || 20, // pixels below main text
        FONT_FAMILY: process.env.FONT_FAMILY || '"PP Editorial New Ultralight",Arial, serif', // System-installed PP Editorial New with simple fallback
        IMAGE_QUALITY: parseInt(process.env.IMAGE_QUALITY) || 90 // JPEG quality 1-100
    }
};

/**
 * Main execution function that checks for new insights and sends them to Telegram
 * Uses caching to prevent sending duplicate messages
 */
(async () => {
    try {
        // Validate required environment variables
        if (!config.Telegram.TOKEN || !config.Telegram.CHAT_ID) {
            throw new Error(`Missing required environment variables: TELEGRAM_TOKEN and/or TELEGRAM_CHAT_ID`);
        }

        // Log current configuration
        out.info(`Sharp available: ${sharpAvailable}`);
        out.info(`Canvas available: ${canvasAvailable}`);
        out.info(`Image overlay enabled: ${config.Telegram.USE_IMAGE_OVERLAY}`);
        out.info(`Message type: ${config.Telegram.USE_IMAGE_OVERLAY ? 'Canvas-based image overlay' : 'Text only'}`);
        out.info(`Processing up to ${config.Insights.LIMIT} insights`);

        // Process multiple new insights
        await processNewPublishedInsights({ limit: config.Insights.LIMIT });

        out.success(`Finished processing insights`);

    } catch (error) {
        out.error(`Error in main execution: ${error.message}`);
        process.exit(1);
    }
})();

/**
 * Reads cached data from a JSON file
 * @param {Object} options - Configuration options
 * @param {string} options.filename - Name of the cache file to read from
 * @returns {Object} Parsed JSON data or empty object if file doesn't exist or is invalid
 */
function readCache({ filename = 'cache.json' }) {
    try {
        // Debug: Log current working directory and file path
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
 * Writes data to a JSON cache file
 * @param {Object} data - Data to be cached
 * @param {Object} options - Configuration options
 * @param {string} options.filename - Name of the cache file to write to
 */
function writeCache(data, { filename = 'cache.json' } = {}) {
    try {
        out.info(`Writing cache to: ${filename}`);
        fs.writeFileSync(filename, JSON.stringify(data, null, 2));
        out.info(`Cache updated successfully: ${filename}`);

        // Verify the file was written
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
 * Processes up to 5 latest insights, checking each against cache
 * @returns {Promise<void>}
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

        if (!insights || insights.length === 0) {
            out.warn(`No insights available from API`);
            return;
        }

        // Reverse the insights array to process from oldest to newest
        // API returns in desc order (newest first), but we want to process chronologically
        const chronologicalInsights = insights.reverse();

        out.info(`Found ${chronologicalInsights.length} insights to process (reversed to oldest-first order)`);

        // Process each insight
        let processedCount = 0;
        for (const insight of chronologicalInsights) {
            try {
                // Check if this insight has already been sent by comparing publishedAt dates
                const cache_latestInsight = readCache({ filename: config.Cache.FILENAME });

                if (cache_latestInsight && cache_latestInsight.publishedAt) {
                    const cachedDate = new Date(cache_latestInsight.publishedAt);
                    const insightDate = new Date(insight.publishedAt);

                    if (insightDate <= cachedDate) {
                        out.info(`Insight ${insight.id} (published: ${insight.publishedAt}) already processed (cached: ${cache_latestInsight.publishedAt}), skipping`);
                        continue;
                    }
                }

                out.info(`Processing new insight: ${insight.id} (published: ${insight.publishedAt})`);

                // Send the insight to Telegram
                const response = await sendMessage({
                    insight: insight
                });

                // Check if the message was sent successfully
                if (!response || !response.ok) {
                    throw new Error(`Telegram message failed: ${response?.description || 'Unknown error'}`);
                }

                out.success(`Message sent successfully for insight ${insight.id}`);

                // Update cache only after successful message send
                writeCache({
                    id: insight.id,
                    publishedAt: insight.publishedAt,
                    sentAt: new Date().toISOString()
                }, { filename: config.Cache.FILENAME });

                processedCount++;

                // Add delay only if there are more insights to process
                if (processedCount < chronologicalInsights.length) {
                    out.info(`Waiting 1 second before processing next insight...`);
                    await new Promise(resolve => setTimeout(resolve, 1000));
                }

            } catch (error) {
                out.error(`Error processing insight ${insight.id}: ${error.message}`);
                // Continue with next insight instead of stopping
                continue;
            }
        }

    } catch (error) {
        out.error(`Error fetching new published insights: ${error.message}`);
        throw error;
    }
}

/**
 * Creates an image with text overlay using Canvas for proper font support
 * @param {Object} options - Image creation options
 * @param {string} options.backgroundImageUrl - URL of the background image
 * @param {string} options.headline - Text to overlay on the image
 * @param {string} options.readTime - Optional read time text
 * @returns {Promise<Buffer>} Image buffer with text overlay
 */
async function createImageWithTextOverlay({ backgroundImageUrl, headline, readTime }) {
    try {
        if (!sharpAvailable) {
            throw new Error('Sharp module not available - cannot create image overlay');
        }
        
        if (!canvasAvailable) {
            throw new Error('Canvas module not available - cannot create text overlay');
        }
        
        out.info(`Creating image with Canvas text overlay for: ${headline}`);
        
        // Fetch the background image
        const imageResponse = await fetch(backgroundImageUrl);
        if (!imageResponse.ok) {
            throw new Error(`Failed to fetch background image: ${imageResponse.status}`);
        }
        
        const imageBuffer = await imageResponse.buffer();
        
        // Get image dimensions
        const image = sharp(imageBuffer);
        const metadata = await image.metadata();
        const { width, height } = metadata;
        
        // Create Canvas with same dimensions as background image
        const canvas = Canvas.createCanvas(width, height);
        const ctx = canvas.getContext('2d');
        
        // Use system-installed fonts from config
        const fontFamily = config.ImageOverlay.FONT_FAMILY;
        out.info(`Using system-installed fonts: ${fontFamily}`);
        
        // Calculate text layout
        const maxTextWidth = Math.floor(width * config.ImageOverlay.TEXT_WIDTH_PERCENT);
        const fontSize = Math.floor(width / config.ImageOverlay.FONT_SIZE_DIVISOR);
        const lineHeight = fontSize * config.ImageOverlay.LINE_HEIGHT_MULTIPLIER;
        
        // Set up canvas text properties for measurement and rendering
        ctx.font = `200 ${fontSize}px "${fontFamily.split(',')[0].replace(/"/g, '')}", serif`; // Use font-weight 200
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.letterSpacing = '-0.0025em'; // Custom letter spacing
        
        // Test font rendering to verify it's working
        const testMetrics = ctx.measureText('Test');
        out.info(`Font test - width: ${testMetrics.width}px, font: ${ctx.font}, letterSpacing: ${ctx.letterSpacing}`);
        
        // Smart text wrapping using actual text measurements
        const words = headline.split(' ');
        const lines = [];
        let currentLine = '';
        
        for (const word of words) {
            const testLine = currentLine ? `${currentLine} ${word}` : word;
            const metrics = ctx.measureText(testLine);
            
            if (metrics.width > maxTextWidth && currentLine) {
                lines.push(currentLine);
                currentLine = word;
            } else {
                currentLine = testLine;
            }
        }
        if (currentLine) lines.push(currentLine);
        
        // Calculate text positioning - center vertically
        const totalTextHeight = lines.length * lineHeight;
        const readTimeFontSize = readTime ? Math.floor(fontSize * config.ImageOverlay.READTIME_FONT_SIZE_PERCENT) : 0;
        const readTimeHeight = readTime ? readTimeFontSize + config.ImageOverlay.READTIME_MARGIN_TOP : 0;
        const totalContentHeight = totalTextHeight + readTimeHeight;
        
        // Center the entire text block (main text + read time) vertically in the image
        const centerY = height / 2;
        const startY = centerY - (totalContentHeight / 2);
        
        // Draw main text with stroke effect
        ctx.strokeStyle = config.ImageOverlay.TEXT_STROKE_COLOR;
        ctx.lineWidth = config.ImageOverlay.TEXT_STROKE_WIDTH;
        ctx.fillStyle = config.ImageOverlay.TEXT_COLOR;
        
        lines.forEach((line, index) => {
            const y = startY + (index * lineHeight);
            ctx.strokeText(line, width / 2, y);
            ctx.fillText(line, width / 2, y);
        });
        
        // Add read time if available
        if (readTime) {
            const readTimeY = startY + totalTextHeight + config.ImageOverlay.READTIME_MARGIN_TOP;
            
            ctx.font = `200 ${readTimeFontSize}px "${fontFamily.split(',')[0].replace(/"/g, '')}", serif`; // Match main text font weight
            ctx.strokeStyle = config.ImageOverlay.TEXT_STROKE_COLOR;
            ctx.lineWidth = 1;
            ctx.fillStyle = config.ImageOverlay.TEXT_COLOR;
            
            const readTimeText = `(${readTime})`;
            ctx.strokeText(readTimeText, width / 2, readTimeY);
            ctx.fillText(readTimeText, width / 2, readTimeY);
        }
        
        // Convert canvas to buffer
        const canvasBuffer = canvas.toBuffer('image/png');
        
        // Use Sharp to composite the text overlay onto the background image
        const finalImage = await image
            .composite([{ input: canvasBuffer, top: 0, left: 0 }])
            .jpeg({ quality: config.ImageOverlay.IMAGE_QUALITY })
            .toBuffer();
        
        out.success(`Image with Canvas text overlay created successfully`);
        return finalImage;
        
    } catch (error) {
        out.error(`Error creating image with Canvas text overlay: ${error.message}`);
        throw error;
    }
}

/**
 * Fetches the latest published insight from Polaris API
 * @returns {Promise<Object|null>} The latest insight object or null if none found
 */
async function getLastPublishedInsight() {
    try {
        const url = `${config.Polaris.API_URL}/ai/curated-insights?_sort=publishedAt&_order=desc&_limit=1`;
        out.info(`Fetching latest insight from: ${url}`);

        const response = await fetch(url);

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const insights = await response.json();

        if (!insights || insights.length === 0) {
            out.warn(`No insights available from API`);
            return null;
        }

        out.info(`Latest insight found: ${insights[0].id}`);
        return insights[0];

    } catch (error) {
        out.error(`Error fetching last published insight: ${error.message}`);
        return null;
    }
}

/**
 * Fetches all curated insights from Polaris API
 * @returns {Promise<Array|null>} Array of insights or null if fetch fails
 */
async function getCuratedInsights() {
    try {
        const url = `${config.Polaris.API_URL}/ai/curated-insights`;
        out.info(`Fetching all curated insights from: ${url}`);

        const response = await fetch(url);

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();
        out.info(`Found ${data.length} total insights`);
        return data;

    } catch (error) {
        out.error(`Error fetching curated insights: ${error.message}`);
        return null;
    }
}

/**
 * Sends a message with insight data to Telegram chat
 * @param {Object} options - Message options
 * @param {Object} options.insight - The insight object containing headline, id, and backgroundValue
 * @returns {Promise<Object>} Telegram API response
 */
async function sendMessage({ insight }) {
    try {
        // Check configuration and Canvas/Sharp availability
        if (!config.Telegram.USE_IMAGE_OVERLAY || !sharpAvailable || !canvasAvailable) {
            if (!sharpAvailable) {
                out.warn(`Sharp not available, sending text message for insight ${insight.id}`);
            } else if (!canvasAvailable) {
                out.warn(`Canvas not available, sending text message for insight ${insight.id}`);
            } else {
                out.info(`Image overlay disabled, sending text message for insight ${insight.id}`);
            }
            return await sendTextMessage({ insight });
        }

        // Check if we have an image URL, if not fall back to text message
        if (!insight.backgroundValue) {
            out.warn(`No image URL found for insight ${insight.id}, sending text message instead`);
            return await sendTextMessage({ insight });
        }

        out.info(`Creating image overlay for insight ${insight.id}`);

        // Create image with text overlay
        const imageBuffer = await createImageWithTextOverlay({
            backgroundImageUrl: insight.backgroundValue,
            headline: insight.headline,
            readTime: insight.readTime
        });

        // Use sendPhoto endpoint to send the processed image
        const telegramApiUrl = `https://api.telegram.org/bot${config.Telegram.TOKEN}/sendPhoto`;

        // Create a simple caption with just the link (since text is now on the image)
        const caption = `**[Read more](${config.Polaris.INSIGHTS_URL}${insight.id})**`;

        out.info(`Sending photo with text overlay to Telegram chat: ${config.Telegram.CHAT_ID}`);

        // Create form data for file upload
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
        // Fall back to text message if image processing fails
        out.warn(`Falling back to text message for insight ${insight.id}`);
        return await sendTextMessage({ insight });
    }
}

/**
 * Sends a text message to Telegram chat (fallback when no image is available)
 * @param {Object} options - Message options
 * @param {Object} options.insight - The insight object containing headline and id
 * @returns {Promise<Object>} Telegram API response
 */
async function sendTextMessage({ insight }) {
    try {
        const telegramApiUrl = `https://api.telegram.org/bot${config.Telegram.TOKEN}/sendMessage`;

        // Create the message text with headline and link to the insight
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
