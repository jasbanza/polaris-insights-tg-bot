/**
 * Polaris Insights Telegram Bot
 * 
 * This bot fetches the latest published insights from Polaris API and sends them to a Telegram chat.
 * It sends simple text messages and photo messages with captions.
 * Uses intelligent caching to avoid sending duplicate insights.
 * 
 * Features:
 * - Fetches insights from Polaris API
 * - Processes multiple insights chronologically 
 * - Sends to Telegram with proper formatting
 * - Caches processed insights to prevent duplicates
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

// Initialize Canvas module for image processing
let Canvas = null;
let canvasAvailable = false;

// Attempt to load Canvas module for image processing
try {
    Canvas = await import('canvas');
    
    if (Canvas) {
        canvasAvailable = true;
        out.success('Canvas loaded successfully - image processing available');
    }
} catch (error) {
    out.warn(`Canvas not available (${error.message}) - color background processing disabled`);
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
const isTestMode = process.env.TEST_MODE === 'true';

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
        /** @type {string} Production chat ID to send messages to */
        CHAT_ID: process.env.TELEGRAM_CHAT_ID,
        /** @type {string} Test chat ID for testing mode */
        TEST_CHAT_ID: process.env.TELEGRAM_TEST_CHAT_ID,
        /** @type {boolean} Whether to run in test mode (uses TEST_CHAT_ID) */
        TEST_MODE: isTestMode,
        /** @type {boolean} Whether to disable web page previews in messages */
        DISABLE_WEB_PAGE_PREVIEW: process.env.DISABLE_WEB_PAGE_PREVIEW === 'true'
    },
    
    /** Caching configuration */
    Cache: {
        /** @type {string} Path to timestamp cache file */
        FILENAME: path.join(__dirname, isTestMode ? 'test_latest_insight.cache.json' : 'latest_insight.cache.json'),
        /** @type {string} Path to processed IDs cache file */
        PROCESSED_IDS_FILENAME: path.join(__dirname, isTestMode ? 'test_processed_insights.cache.json' : 'processed_insights.cache.json'),
        /** @type {number} Maximum number of processed IDs to keep in cache */
        MAX_PROCESSED_IDS: parseInt(process.env.MAX_PROCESSED_IDS) || 200
    },
    
    /** Insight processing configuration */
    Insights: {
        /** @type {number} Maximum number of insights to process per run */
        LIMIT: parseInt(process.env.INSIGHTS_LIMIT) || 7,
        /** @type {number} Minimum age in minutes before processing insights (prevents premature posting during editing) */
        MINIMUM_AGE_MINUTES: parseInt(process.env.MINIMUM_AGE_MINUTES) || 10
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
        if (!config.Telegram.TOKEN) {
            throw new Error('Missing required environment variable: TELEGRAM_TOKEN');
        }

        // Validate chat ID configuration based on mode
        try {
            const chatId = getChatId();
            out.info(`Using chat ID: ${chatId} (${config.Telegram.TEST_MODE ? 'TEST MODE' : 'PRODUCTION MODE'})`);
        } catch (error) {
            throw new Error(`Chat ID configuration error: ${error.message}`);
        }

        // Log current configuration for transparency
        out.info(`Test mode enabled: ${config.Telegram.TEST_MODE}`);
        if (config.Telegram.TEST_MODE) {
            out.warn(`🧪 RUNNING IN TEST MODE - Messages will be sent to test chat: ${config.Telegram.TEST_CHAT_ID}`);
        } else {
            out.info(`📢 Running in production mode - Messages will be sent to: ${config.Telegram.CHAT_ID}`);
        }
        out.info(`Processing up to ${config.Insights.LIMIT} insights`);
        out.info(`Minimum insight age: ${config.Insights.MINIMUM_AGE_MINUTES} minutes (prevents posting during editing)`);
        out.info(`Duplicate protection: ID-based cache (max ${config.Cache.MAX_PROCESSED_IDS} entries) + timestamp optimization`);

        // Log current cache status
        const processedInsights = readProcessedIds();
        out.info(`Currently tracking ${processedInsights.length} processed insight IDs`);

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
 * Adds test mode prefix to messages when in test mode
 * Helps distinguish test messages from production messages
 * 
 * @function addTestModePrefix
 * @param {string} message - The original message text
 * @returns {string} Message with test prefix if in test mode, otherwise unchanged
 * @example
 * const message = addTestModePrefix('Hello world');
 */
function addTestModePrefix(message) {
    if (config.Telegram.TEST_MODE) {
        return `🧪 [TEST] ${message}`;
    }
    return message;
}

/**
 * Gets the appropriate chat ID based on test mode configuration
 * Returns test chat ID when in test mode, otherwise returns production chat ID
 * 
 * @function getChatId
 * @returns {string} The chat ID to use for sending messages
 * @throws {Error} When required chat ID is not configured
 * @example
 * const chatId = getChatId();
 */
function getChatId() {
    if (config.Telegram.TEST_MODE) {
        if (!config.Telegram.TEST_CHAT_ID) {
            throw new Error('TEST_MODE is enabled but TELEGRAM_TEST_CHAT_ID is not configured');
        }
        return config.Telegram.TEST_CHAT_ID;
    } else {
        if (!config.Telegram.CHAT_ID) {
            throw new Error('TELEGRAM_CHAT_ID is not configured');
        }
        return config.Telegram.CHAT_ID;
    }
}

/**
 * Reads processed insight IDs from cache file
 * Returns an array of previously processed insight IDs
 * 
 * @function readProcessedIds
 * @returns {string[]} Array of processed insight IDs
 * @example
 * const processedIds = readProcessedIds();
 */
function readProcessedIds() {
    try {
        const data = readCache({ filename: config.Cache.PROCESSED_IDS_FILENAME });
        return Array.isArray(data.processedIds) ? data.processedIds : [];
    } catch (error) {
        out.warn(`Error reading processed IDs cache: ${error.message}`);
        return [];
    }
}

/**
 * Writes processed insight IDs to cache file
 * Maintains a bounded list of processed IDs to prevent unlimited growth
 * 
 * @function writeProcessedIds
 * @param {string[]} processedIds - Array of processed insight IDs
 * @returns {void}
 * @example
 * writeProcessedIds(['id1', 'id2', 'id3']);
 */
function writeProcessedIds(processedIds) {
    try {
        // Keep only the most recent IDs to prevent unlimited cache growth
        const boundedIds = processedIds.slice(-config.Cache.MAX_PROCESSED_IDS);
        
        writeCache({
            processedIds: boundedIds,
            lastUpdated: new Date().toISOString(),
            totalCount: boundedIds.length
        }, { filename: config.Cache.PROCESSED_IDS_FILENAME });
        
        out.info(`Processed IDs cache updated with ${boundedIds.length} entries`);
    } catch (error) {
        out.error(`Error writing processed IDs cache: ${error.message}`);
    }
}

/**
 * Checks if an insight ID has already been processed
 * 
 * @function isInsightProcessed
 * @param {string} insightId - The insight ID to check
 * @returns {boolean} True if the insight has been processed, false otherwise
 * @example
 * if (isInsightProcessed('123')) { console.log('Already processed'); }
 */
function isInsightProcessed(insightId) {
    const processedInsights = readProcessedIds();
    return processedInsights.some(item => 
        typeof item === 'string' ? item === insightId : item.id === insightId
    );
}

/**
 * Adds an insight to the processed cache with metadata
 * 
 * @function addProcessedInsight
 * @param {string} insightId - The insight ID to add to processed cache
 * @param {Object} [metadata] - Optional metadata about the insight
 * @param {string} [metadata.backgroundType] - Type of background ('color' or 'image')
 * @param {string} [metadata.backgroundValue] - Background color name or image URL
 * @param {string} [metadata.processedAt] - When the insight was processed
 * @returns {void}
 * @example
 * addProcessedInsight('123', { backgroundType: 'color', backgroundValue: 'red-100' });
 */
function addProcessedInsight(insightId, metadata = {}) {
    const processedInsights = readProcessedIds();
    const existingIndex = processedInsights.findIndex(item => 
        typeof item === 'string' ? item === insightId : item.id === insightId
    );
    
    if (existingIndex === -1) {
        // Add new insight with metadata
        const insightData = {
            id: insightId,
            processedAt: new Date().toISOString(),
            ...metadata
        };
        processedInsights.push(insightData);
        writeProcessedIds(processedInsights);
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

        // Filter out insights that are too recent (within minimum age threshold)
        const now = new Date();
        const minAgeMs = config.Insights.MINIMUM_AGE_MINUTES * 60 * 1000; // Convert minutes to milliseconds
        
        const eligibleInsights = chronologicalInsights.filter(insight => {
            const publishedAt = new Date(insight.publishedAt);
            const ageMs = now.getTime() - publishedAt.getTime();
            const isOldEnough = ageMs >= minAgeMs;
            
            if (!isOldEnough) {
                const ageMinutes = Math.floor(ageMs / (60 * 1000));
                out.info(`Insight ${insight.id} is too recent (${ageMinutes} minutes old, minimum ${config.Insights.MINIMUM_AGE_MINUTES} minutes), skipping`);
            }
            
            return isOldEnough;
        });
        
        out.info(`${eligibleInsights.length} of ${chronologicalInsights.length} insights are old enough to process`);

        // Process each insight with error handling
        let processedCount = 0;
        for (const insight of eligibleInsights) {
            try {
                // Primary check: Has this specific insight ID been processed before?
                if (isInsightProcessed(insight.id)) {
                    out.info(`Insight ${insight.id} already processed (found in processed IDs cache), skipping`);
                    continue;
                }

                // Secondary check: Use timestamp cache for efficiency (skip older insights)
                const cacheData = readCache({ filename: config.Cache.FILENAME });
                if (cacheData && cacheData.publishedAt) {
                    const cachedDate = new Date(cacheData.publishedAt);
                    const insightDate = new Date(insight.publishedAt);

                    // Skip if this insight is older than our last processed timestamp
                    // This is an optimization - the ID check above is the primary protection
                    if (insightDate < cachedDate) {
                        out.info(`Insight ${insight.id} (published: ${insight.publishedAt}) is older than cached timestamp (${cacheData.publishedAt}), skipping`);
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

                // Extract background information for cache metadata
                const backgroundMetadata = {};
                if (insight.backgroundType && insight.backgroundValue) {
                    backgroundMetadata.backgroundType = insight.backgroundType;
                    backgroundMetadata.backgroundValue = insight.backgroundValue;
                }

                // Update both caches only after successful send
                // 1. Add to processed IDs cache (primary protection) with metadata
                addProcessedInsight(insight.id, backgroundMetadata);
                
                // 2. Update timestamp cache (secondary optimization)
                writeCache({
                    id: insight.id,
                    publishedAt: insight.publishedAt,
                    sentAt: new Date().toISOString()
                }, { filename: config.Cache.FILENAME });

                processedCount++;

                // Rate limiting: add delay between messages (except for last one)
                const hasMoreInsights = processedCount < eligibleInsights.length;
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
 * Loads color definitions from colors.json file
 * @returns {Object} Color definitions object
 */
function loadColors() {
    try {
        const colorsPath = path.join(__dirname, 'colors.json');
        const colorsData = fs.readFileSync(colorsPath, 'utf8');
        return JSON.parse(colorsData);
    } catch (error) {
        out.error(`Error loading colors.json: ${error.message}`);
        return {};
    }
}

/**
 * Converts RGB string to array
 * @param {string} rgbString - RGB string like "50 82 70"
 * @returns {number[]} RGB array like [50, 82, 70]
 */
function parseRgbString(rgbString) {
    return rgbString.split(' ').map(num => parseInt(num, 10));
}

/**
 * Creates an image with a colored background and overlays a PNG using Canvas
 * @async
 * @function createColoredBackgroundImage
 * @param {Object} options - Image creation options
 * @param {string} options.colorName - Color name to lookup in colors.json
 * @param {string} options.overlayImageUrl - URL of the PNG image to overlay
 * @param {number} [options.width=1920] - Image width (matches background images)
 * @param {number} [options.height=960] - Image height (matches background images)
 * @returns {Promise<Buffer>} Processed image buffer
 */
async function createColoredBackgroundImage({ colorName, overlayImageUrl, width = 1920, height = 960 }) {
    try {
        if (!canvasAvailable) {
            throw new Error('Canvas module not available - cannot create colored background');
        }

        out.info(`Creating colored background image with color: ${colorName}`);
        
        // Load colors and get RGB values
        const colors = loadColors();
        const rgbString = colors[colorName];
        
        if (!rgbString) {
            throw new Error(`Color "${colorName}" not found in colors.json`);
        }
        
        const [r, g, b] = parseRgbString(rgbString);
        out.info(`Using RGB color: ${r}, ${g}, ${b} for ${colorName}`);
        
        // Download the overlay PNG image
        const overlayResponse = await fetch(overlayImageUrl);
        if (!overlayResponse.ok) {
            throw new Error(`Failed to fetch overlay image: ${overlayResponse.status}`);
        }
        
        const overlayBuffer = await overlayResponse.buffer();
        
        // Create Canvas with specified dimensions
        const canvas = Canvas.createCanvas(width, height);
        const ctx = canvas.getContext('2d');
        
        // Fill background with the specified color
        ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
        ctx.fillRect(0, 0, width, height);
        
        // Load the overlay image
        const overlayImage = await Canvas.loadImage(overlayBuffer);
        
        // Calculate scaling to fit image within canvas while maintaining aspect ratio
        const scaleX = width / overlayImage.width;
        const scaleY = height / overlayImage.height;
        const scale = Math.min(scaleX, scaleY) * 0.53; // Use 53% of available space (2/3rds of previous 80%)
        
        const scaledWidth = overlayImage.width * scale;
        const scaledHeight = overlayImage.height * scale;
        
        // Calculate position to center the overlay
        const x = (width - scaledWidth) / 2;
        const y = (height - scaledHeight) / 2;
        
        out.info(`Scaling overlay from ${overlayImage.width}x${overlayImage.height} to ${Math.floor(scaledWidth)}x${Math.floor(scaledHeight)}`);
        
        // Draw the overlay image centered on the canvas
        ctx.drawImage(overlayImage, x, y, scaledWidth, scaledHeight);
        
        // Convert canvas to JPEG buffer
        const imageBuffer = canvas.toBuffer('image/jpeg', { quality: 0.9 });
        
        out.success(`Created colored background image with ${colorName} background and centered overlay`);
        return imageBuffer;
        
    } catch (error) {
        out.error(`Error creating colored background image: ${error.message}`);
        throw error;
    }
}

/**
 * Determines the appropriate image URL or creates a custom image based on background type
 * @async
 * @function getImageForInsight
 * @param {Object} insight - The insight object
 * @returns {Promise<string|Buffer>} Either a URL string or a Buffer for custom images
 */
async function getImageForInsight(insight) {
    try {
        const { backgroundType, backgroundValue, visualizationType, visualizationValue } = insight;
        
        // Helper function to check if a string is a valid URL
        const isValidUrl = (string) => {
            try {
                new URL(string);
                return true;
            } catch (_) {
                return false;
            }
        };
        
        if (backgroundType === 'image') {
            // Use backgroundValue URL directly for image backgrounds
            // But if visualizationType is 'graphics', prefer the visualizationValue
            if (visualizationType === 'graphics' && visualizationValue) {
                // Check if visualizationValue is a valid URL
                if (isValidUrl(visualizationValue)) {
                    out.info(`Using graphics visualization: ${visualizationValue}`);
                    return visualizationValue;
                } else {
                    out.warn(`Graphics visualization value "${visualizationValue}" is not a valid URL, falling back to backgroundValue`);
                    if (backgroundValue && isValidUrl(backgroundValue)) {
                        out.info(`Using image background: ${backgroundValue}`);
                        return backgroundValue;
                    } else {
                        out.warn(`Background value "${backgroundValue}" is also not a valid URL`);
                        return null;
                    }
                }
            } else {
                if (backgroundValue && isValidUrl(backgroundValue)) {
                    out.info(`Using image background: ${backgroundValue}`);
                    return backgroundValue;
                } else {
                    out.warn(`Background value "${backgroundValue}" is not a valid URL`);
                    return null;
                }
            }
        } else if (backgroundType === 'color') {
            // Create custom image with colored background and PNG overlay
            if (!visualizationValue) {
                throw new Error('No visualizationValue provided for color background');
            }
            
            // Check if visualizationValue is a valid URL
            if (!isValidUrl(visualizationValue)) {
                throw new Error(`Visualization value "${visualizationValue}" is not a valid URL for color background overlay`);
            }
            
            out.info(`Creating colored background image with ${backgroundValue} and overlay ${visualizationValue}`);
            const imageBuffer = await createColoredBackgroundImage({
                colorName: backgroundValue,
                overlayImageUrl: visualizationValue
            });
            
            return imageBuffer;
        } else {
            // Fallback to backgroundValue if available and is a valid URL
            if (backgroundValue && isValidUrl(backgroundValue)) {
                return backgroundValue;
            } else {
                out.warn(`Fallback background value "${backgroundValue}" is not a valid URL`);
                return null;
            }
        }
    } catch (error) {
        out.error(`Error getting image for insight: ${error.message}`);
        return null;
    }
}

/**
 * Sends a message with insight data to Telegram chat
 * Sends either a text message or photo message with caption based on available data
 * 
 * @async
 * @function sendMessage
 * @param {Object} options - Message options
 * @param {Object} options.insight - The insight object containing message data
 * @param {string} options.insight.headline - The insight headline text
 * @param {string} options.insight.id - The unique insight identifier
 * @param {string} [options.insight.backgroundValue] - Optional background image URL
 * @param {string} [options.insight.readTime] - Optional read time text
 * @returns {Promise<Object>} Telegram API response object
 * @throws {Error} When both photo and text message fail
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
        // Get the appropriate image (URL or Buffer) based on background type
        const imageData = await getImageForInsight(insight);
        
        if (imageData) {
            if (typeof imageData === 'string') {
                // It's a URL, send as photo message with URL
                out.info(`Sending photo message with URL for insight ${insight.id}`);
                return await sendPhotoMessage({ insight, imageUrl: imageData });
            } else if (Buffer.isBuffer(imageData)) {
                // It's a Buffer, send as photo message with buffer
                out.info(`Sending photo message with custom image buffer for insight ${insight.id}`);
                return await sendPhotoMessageWithBuffer({ insight, imageBuffer: imageData });
            }
        }
        
        // Fallback to text message if no image data
        out.info(`No image data found for insight ${insight.id}, sending text message`);
        return await sendTextMessage({ insight });
        
    } catch (error) {
        out.error(`Error sending message: ${error.message}`);
        // Graceful fallback to text message if image processing fails
        out.warn(`Falling back to text message for insight ${insight.id}`);
        return await sendTextMessage({ insight });
    }
}

/**
 * Sends a text message to Telegram chat
 * Used when no background image is available
 * 
 * @async
 * @function sendTextMessage
 * @param {Object} options - Message options
 * @param {Object} options.insight - The insight object containing headline and id
 * @param {string} options.insight.headline - The insight headline text
 * @param {string} options.insight.id - The unique insight identifier
 * @returns {Promise<Object>} Telegram API response object
 * @throws {Error} When Telegram API request fails
 * @example
 * const response = await sendTextMessage({ 
 *   insight: { headline: 'Breaking News', id: '123' } 
 * });
 */
async function sendTextMessage({ insight }) {
    try {
        const telegramApiUrl = `https://api.telegram.org/bot${config.Telegram.TOKEN}/sendMessage`;

        // Create formatted message with headline and read more link
        const messageText = addTestModePrefix(`${insight.headline}

[Read more](${config.Polaris.INSIGHTS_URL}${insight.id})`);

        const chatId = getChatId();
        out.info(`Sending text message to Telegram chat: ${chatId} (${config.Telegram.TEST_MODE ? 'TEST' : 'PROD'})`);

        const response = await fetch(telegramApiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: chatId,
                text: messageText,
                parse_mode: 'markdown',
                disable_web_page_preview: config.Telegram.DISABLE_WEB_PAGE_PREVIEW
            })
        });

        if (!response.ok) {
            const errorText = await response.text();
            out.error(`Telegram API HTTP error! Status: ${response.status}, Response: ${errorText}`);
            throw new Error(`Telegram API error! status: ${response.status}, response: ${errorText}`);
        }

        const data = await response.json();

        if (!data.ok) {
            out.error(`Telegram API returned error: ${JSON.stringify(data, null, 2)}`);
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
 * @param {string} [options.imageUrl] - Optional image URL (uses insight.backgroundValue if not provided)
 * @returns {Promise<Object>} Telegram API response object
 * @throws {Error} When Telegram API request fails or image download fails
 * @example
 * const response = await sendPhotoMessage({ 
 *   insight: { headline: 'Breaking News', id: '123' },
 *   imageUrl: 'https://example.com/image.jpg'
 * });
 */
async function sendPhotoMessage({ insight, imageUrl }) {
    try {
        const telegramApiUrl = `https://api.telegram.org/bot${config.Telegram.TOKEN}/sendPhoto`;

        // Create caption with headline and read more link
        const caption = addTestModePrefix(`${insight.headline}

[Read more](${config.Polaris.INSIGHTS_URL}${insight.id})`);

        const chatId = getChatId();
        out.info(`Sending photo message to Telegram chat: ${chatId} (${config.Telegram.TEST_MODE ? 'TEST' : 'PROD'})`);

        // Use provided imageUrl or fall back to insight.backgroundValue
        const photoUrl = imageUrl || insight.backgroundValue;

        // Send photo using the direct URL (let Telegram handle the download)
        const response = await fetch(telegramApiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: chatId,
                photo: photoUrl,
                caption: caption,
                parse_mode: 'markdown'
            })
        });

        if (!response.ok) {
            const errorText = await response.text();
            out.error(`Telegram API HTTP error! Status: ${response.status}, Response: ${errorText}`);
            throw new Error(`Telegram API error! status: ${response.status}, response: ${errorText}`);
        }

        const data = await response.json();

        if (!data.ok) {
            out.error(`Telegram API returned error: ${JSON.stringify(data, null, 2)}`);
            throw new Error(`Telegram API returned error: ${data.description || 'Unknown error'}`);
        }

        return data;

    } catch (error) {
        out.error(`Error sending photo message: ${error.message}`);
        throw error; // Re-throw to allow caller to handle
    }
}

/**
 * Sends a photo message to Telegram chat using an image buffer
 * Uploads the image buffer directly to Telegram
 * 
 * @async
 * @function sendPhotoMessageWithBuffer
 * @param {Object} options - Message options
 * @param {Object} options.insight - The insight object containing message data
 * @param {string} options.insight.headline - The insight headline text
 * @param {string} options.insight.id - The unique insight identifier
 * @param {Buffer} options.imageBuffer - The image buffer to send
 * @returns {Promise<Object>} Telegram API response object
 * @throws {Error} When Telegram API request fails
 */
async function sendPhotoMessageWithBuffer({ insight, imageBuffer }) {
    try {
        const telegramApiUrl = `https://api.telegram.org/bot${config.Telegram.TOKEN}/sendPhoto`;

        // Create caption with headline and read more link
        const caption = addTestModePrefix(`${insight.headline}

[Read more](${config.Polaris.INSIGHTS_URL}${insight.id})`);

        const chatId = getChatId();
        out.info(`Sending photo with custom buffer to Telegram chat: ${chatId} (${config.Telegram.TEST_MODE ? 'TEST' : 'PROD'})`);

        // Prepare form data for file upload
        const FormData = (await import('form-data')).default;
        const form = new FormData();
        form.append('chat_id', chatId);
        form.append('photo', imageBuffer, 'insight-image.jpg');
        form.append('caption', caption);
        form.append('parse_mode', 'markdown');

        const response = await fetch(telegramApiUrl, {
            method: 'POST',
            body: form
        });

        if (!response.ok) {
            const errorText = await response.text();
            out.error(`Telegram API HTTP error! Status: ${response.status}, Response: ${errorText}`);
            throw new Error(`Telegram API error! status: ${response.status}, response: ${errorText}`);
        }

        const data = await response.json();

        if (!data.ok) {
            out.error(`Telegram API returned error: ${JSON.stringify(data, null, 2)}`);
            throw new Error(`Telegram API returned error: ${data.description || 'Unknown error'}`);
        }

        return data;

    } catch (error) {
        out.error(`Error sending photo message with buffer: ${error.message}`);
        throw error; // Re-throw to allow caller to handle
    }
}
