/**
 * Multi-source Image Resolver for Products
 *
 * Resolution order:
 *   1. Check imageCache collection (30-day TTL)
 *   2. OpenFoodFacts API (/api/v2/product/{barcode}.json)
 *   3. Constructed OFF URL with HEAD validation (front_he, front_en, front, 1)
 *   4. Category fallback image (curated Unsplash URLs)
 */

const https = require('https');
const http = require('http');

// ========================================
// Category Fallback Images
// ========================================
const CATEGORY_FALLBACK_IMAGES = {
    '\u05DE\u05D5\u05E6\u05E8\u05D9 \u05D7\u05DC\u05D1': 'https://images.unsplash.com/photo-1550583724-b2692b85b150?w=200',
    '\u05DC\u05D7\u05DD \u05D5\u05DE\u05D0\u05E4\u05D9\u05DD': 'https://images.unsplash.com/photo-1509440159596-0249088772ff?w=200',
    '\u05D1\u05D9\u05E6\u05D9\u05DD': 'https://images.unsplash.com/photo-1582722872445-44dc5f7e3c8f?w=200',
    '\u05D1\u05E9\u05E8 \u05D5\u05E2\u05D5\u05E3': 'https://images.unsplash.com/photo-1607623814075-e51df1bdc82f?w=200',
    '\u05D1\u05E9\u05E8 \u05D5\u05D3\u05D2\u05D9\u05DD': 'https://images.unsplash.com/photo-1607623814075-e51df1bdc82f?w=200',
    '\u05D3\u05D2\u05D9\u05DD': 'https://images.unsplash.com/photo-1534604973900-c43ab4c2e0ab?w=200',
    '\u05E4\u05D9\u05E8\u05D5\u05EA \u05D5\u05D9\u05E8\u05E7\u05D5\u05EA': 'https://images.unsplash.com/photo-1610832958506-aa56368176cf?w=200',
    '\u05DE\u05E9\u05E7\u05D0\u05D5\u05EA': 'https://images.unsplash.com/photo-1534353473418-4cfa6c56fd38?w=200',
    '\u05E9\u05EA\u05D9\u05D9\u05D4': 'https://images.unsplash.com/photo-1534353473418-4cfa6c56fd38?w=200',
    '\u05D7\u05D8\u05D9\u05E4\u05D9\u05DD': 'https://images.unsplash.com/photo-1621939514649-280e2ee25f60?w=200',
    '\u05E0\u05D9\u05E7\u05D9\u05D5\u05DF': 'https://images.unsplash.com/photo-1563453392212-326f5e854473?w=200',
    '\u05DE\u05D5\u05E6\u05E8\u05D9 \u05E0\u05D9\u05E7\u05D9\u05D5\u05DF': 'https://images.unsplash.com/photo-1563453392212-326f5e854473?w=200',
    '\u05E4\u05E1\u05D8\u05D4 \u05D5\u05D0\u05D5\u05E8\u05D6': 'https://images.unsplash.com/photo-1551462147-ff29053bfc14?w=200',
    '\u05E9\u05D9\u05DE\u05D5\u05E8\u05D9\u05DD': 'https://images.unsplash.com/photo-1584568694244-14fbdf83bd30?w=200',
    '\u05E7\u05E4\u05D4 \u05D5\u05EA\u05D4': 'https://images.unsplash.com/photo-1509042239860-f550ce710b93?w=200',
    '\u05EA\u05D9\u05E0\u05D5\u05E7\u05D5\u05EA': 'https://images.unsplash.com/photo-1515488042361-ee00e0ddd4e4?w=200',
    '\u05DB\u05DC\u05DC\u05D9': 'https://images.unsplash.com/photo-1542838132-92c53300491e?w=200',
    '\u05DE\u05D6\u05D5\u05DF \u05DB\u05DC\u05DC\u05D9': 'https://images.unsplash.com/photo-1542838132-92c53300491e?w=200',
    '\u05D0\u05D7\u05E8': 'https://images.unsplash.com/photo-1542838132-92c53300491e?w=200',
};

const DEFAULT_FALLBACK = 'https://images.unsplash.com/photo-1542838132-92c53300491e?w=200';

// 30-day TTL in milliseconds
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

// ========================================
// HTTP HEAD validation
// ========================================
function validateImageUrl(url) {
    return new Promise((resolve) => {
        if (!url) return resolve(false);

        try {
            const urlObj = new URL(url);
            const protocol = urlObj.protocol === 'https:' ? https : http;

            const req = protocol.request({
                hostname: urlObj.hostname,
                port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
                path: urlObj.pathname + urlObj.search,
                method: 'HEAD',
                timeout: 8000,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (compatible; BudgetManager/1.0)'
                }
            }, (res) => {
                const contentType = res.headers['content-type'] || '';
                resolve(res.statusCode === 200 && contentType.startsWith('image/'));
            });

            req.on('error', () => resolve(false));
            req.on('timeout', () => {
                req.destroy();
                resolve(false);
            });
            req.end();
        } catch {
            resolve(false);
        }
    });
}

// ========================================
// Fetch helper for GET requests
// ========================================
function httpGet(url, timeout = 10000) {
    return new Promise((resolve, reject) => {
        const urlObj = new URL(url);
        const protocol = urlObj.protocol === 'https:' ? https : http;

        const req = protocol.get({
            hostname: urlObj.hostname,
            port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
            path: urlObj.pathname + urlObj.search,
            timeout,
            headers: {
                'User-Agent': 'Mozilla/5.0 (compatible; BudgetManager/1.0)',
                'Accept': 'application/json'
            }
        }, (res) => {
            if (res.statusCode !== 200) {
                res.resume();
                return reject(new Error(`HTTP ${res.statusCode}`));
            }
            const chunks = [];
            res.on('data', chunk => chunks.push(chunk));
            res.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
            res.on('error', reject);
        });

        req.on('error', reject);
        req.on('timeout', () => {
            req.destroy();
            reject(new Error('Timeout'));
        });
    });
}

// ========================================
// OpenFoodFacts API lookup
// ========================================
async function lookupOpenFoodFacts(barcode) {
    try {
        const url = `https://world.openfoodfacts.org/api/v2/product/${barcode}.json`;
        const response = await httpGet(url);
        const data = JSON.parse(response);

        if (data.status === 1 && data.product) {
            return data.product.image_front_url ||
                   data.product.image_url ||
                   data.product.image_small_url ||
                   null;
        }
        return null;
    } catch {
        return null;
    }
}

// ========================================
// Constructed OFF URL variants
// ========================================
function buildOffUrls(barcode) {
    if (!barcode || barcode.length < 12) return [];

    const padded = barcode.padStart(13, '0');
    const base = `https://images.openfoodfacts.org/images/products/${padded.slice(0,3)}/${padded.slice(3,6)}/${padded.slice(6,9)}/${padded.slice(9)}`;

    return [
        `${base}/front_he.400.jpg`,
        `${base}/front_en.400.jpg`,
        `${base}/front.400.jpg`,
        `${base}/1.400.jpg`,
    ];
}

// ========================================
// Main Resolution Function
// ========================================

/**
 * Resolve a product image from multiple sources.
 * @param {Object} db - MongoDB db instance
 * @param {string} barcode - Product barcode
 * @param {string} [productName] - Product name (unused currently, reserved for future search)
 * @param {string} [category] - Product category for fallback
 * @returns {Promise<string>} - Resolved image URL
 */
async function resolveProductImage(db, barcode, productName, category) {
    // 1. Check cache
    if (db) {
        try {
            const cached = await db.collection('imageCache').findOne({ barcode });
            if (cached && cached.imageUrl) {
                const age = Date.now() - (cached.validatedAt ? cached.validatedAt.getTime() : 0);
                if (age < CACHE_TTL_MS) {
                    return cached.imageUrl;
                }
            }
        } catch {
            // Cache miss or collection doesn't exist yet
        }
    }

    // 2. OpenFoodFacts API
    const offImage = await lookupOpenFoodFacts(barcode);
    if (offImage) {
        const valid = await validateImageUrl(offImage);
        if (valid) {
            await cacheImage(db, barcode, offImage, 'openfoodfacts-api');
            return offImage;
        }
    }

    // 3. Constructed OFF URLs
    const offUrls = buildOffUrls(barcode);
    for (const url of offUrls) {
        const valid = await validateImageUrl(url);
        if (valid) {
            await cacheImage(db, barcode, url, 'openfoodfacts-constructed');
            return url;
        }
    }

    // 4. Category fallback
    const fallback = getCategoryFallback(category);
    await cacheImage(db, barcode, fallback, 'category-fallback');
    return fallback;
}

/**
 * Get category fallback image URL.
 */
function getCategoryFallback(category) {
    return CATEGORY_FALLBACK_IMAGES[category] || DEFAULT_FALLBACK;
}

/**
 * Store resolved image URL in cache.
 */
async function cacheImage(db, barcode, imageUrl, source) {
    if (!db) return;
    try {
        await db.collection('imageCache').updateOne(
            { barcode },
            {
                $set: {
                    barcode,
                    imageUrl,
                    source,
                    validatedAt: new Date()
                }
            },
            { upsert: true }
        );
    } catch {
        // Non-critical, ignore cache write errors
    }
}

/**
 * Batch resolve images for products missing them.
 * @param {Object} db - MongoDB db instance
 * @param {number} [limit=200] - Max products to process
 * @returns {{ resolved: number, failed: number }}
 */
async function resolveImagesForProducts(db, limit = 200) {
    const stats = { resolved: 0, failed: 0 };

    try {
        // Find products with no image or empty image
        const products = await db.collection('products')
            .find({
                $or: [
                    { image: { $exists: false } },
                    { image: null },
                    { image: '' }
                ]
            })
            .limit(limit)
            .toArray();

        console.log(`[image_resolver] Resolving images for ${products.length} products...`);

        for (const product of products) {
            try {
                const imageUrl = await resolveProductImage(
                    db,
                    product.barcode,
                    product.name,
                    product.category
                );

                if (imageUrl) {
                    await db.collection('products').updateOne(
                        { _id: product._id },
                        { $set: { image: imageUrl } }
                    );
                    stats.resolved++;
                } else {
                    stats.failed++;
                }
            } catch {
                stats.failed++;
            }
        }

        console.log(`[image_resolver] Done: ${stats.resolved} resolved, ${stats.failed} failed`);
    } catch (error) {
        console.error('[image_resolver] Batch resolve error:', error.message);
    }

    return stats;
}

/**
 * Validate and refresh stale cached images.
 * @param {Object} db - MongoDB db instance
 * @param {number} [limit=500] - Max cache entries to check
 * @returns {{ checked: number, refreshed: number, removed: number }}
 */
async function validateAndRefreshImages(db, limit = 500) {
    const stats = { checked: 0, refreshed: 0, removed: 0 };

    try {
        const staleDate = new Date(Date.now() - CACHE_TTL_MS);
        const staleEntries = await db.collection('imageCache')
            .find({
                $or: [
                    { validatedAt: { $lt: staleDate } },
                    { validatedAt: { $exists: false } }
                ]
            })
            .limit(limit)
            .toArray();

        console.log(`[image_resolver] Validating ${staleEntries.length} stale image cache entries...`);

        for (const entry of staleEntries) {
            stats.checked++;

            // Skip category fallbacks - they don't need validation
            if (entry.source === 'category-fallback') {
                await db.collection('imageCache').updateOne(
                    { _id: entry._id },
                    { $set: { validatedAt: new Date() } }
                );
                continue;
            }

            const valid = await validateImageUrl(entry.imageUrl);
            if (valid) {
                await db.collection('imageCache').updateOne(
                    { _id: entry._id },
                    { $set: { validatedAt: new Date() } }
                );
                stats.refreshed++;
            } else {
                // Image gone, remove cache entry so it gets re-resolved
                await db.collection('imageCache').deleteOne({ _id: entry._id });
                // Also clear the product's image so it gets resolved again
                await db.collection('products').updateOne(
                    { barcode: entry.barcode },
                    { $set: { image: null } }
                );
                stats.removed++;
            }
        }

        console.log(`[image_resolver] Validation done: ${stats.checked} checked, ${stats.refreshed} refreshed, ${stats.removed} removed`);
    } catch (error) {
        console.error('[image_resolver] Validation error:', error.message);
    }

    return stats;
}

module.exports = {
    CATEGORY_FALLBACK_IMAGES,
    resolveProductImage,
    validateImageUrl,
    resolveImagesForProducts,
    validateAndRefreshImages,
    getCategoryFallback
};
