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
        CHAT_ID: process.env.TELEGRAM_CHAT_ID
    },
    Cache: {
        FILENAME: path.join(__dirname, 'latest_insight.cache.json')
    },
    Insights: {
        LIMIT: parseInt(process.env.INSIGHTS_LIMIT, 10) || 5 // Default to 5 if not set
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
async function processNewPublishedInsights({limit = 5}) {
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

        out.info(`Found ${insights.length} insights to process`);

        // Process each insight
        let processedCount = 0;
        for (const insight of insights) {
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
                if (processedCount < insights.length) {
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
        // Check if we have an image URL, if not fall back to text message
        if (!insight.backgroundValue) {
            out.warn(`No image URL found for insight ${insight.id}, sending text message instead`);
            return await sendTextMessage({ insight });
        }

        // Use sendPhoto endpoint to send image with caption
        const telegramApiUrl = `https://api.telegram.org/bot${config.Telegram.TOKEN}/sendPhoto`;

        // Create the caption text with headline and link to the insight
        const caption = `${insight.headline}

[Read more](${config.Polaris.INSIGHTS_URL}${insight.id})`;

        out.info(`Sending photo message to Telegram chat: ${config.Telegram.CHAT_ID}`);
        out.info(`Image URL: ${insight.backgroundValue}`);

        const response = await fetch(telegramApiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: config.Telegram.CHAT_ID,
                photo: insight.backgroundValue, // URL of the image
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
        out.error(`Error sending message: ${error.message}`);
        throw error; // Re-throw to allow caller to handle
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
