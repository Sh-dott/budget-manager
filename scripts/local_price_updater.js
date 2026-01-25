#!/usr/bin/env node
/**
 * Local Israeli Supermarket Price Updater
 *
 * Run this script from your computer (with Israeli IP) to fetch
 * real prices from official supermarket portals and update your database.
 *
 * Usage:
 *   node scripts/local_price_updater.js
 *
 * Or with specific chains:
 *   node scripts/local_price_updater.js --chains shufersal,rami_levy
 *
 * Environment:
 *   Set MONGODB_URI in .env or pass as environment variable
 */

require('dotenv').config();
const https = require('https');
const http = require('http');
const zlib = require('zlib');
const { MongoClient } = require('mongodb');
const { XMLParser } = require('fast-xml-parser');

// MongoDB connection
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/budget-manager';

// Chain configurations with their official price data URLs
const CHAINS = {
    shufersal: {
        name: 'שופרסל',
        baseUrl: 'http://prices.shufersal.co.il',
        fileListPath: '/FileObject/UpdateCategory?catID=2&storeId=0&sort=Time&sortdir=DESC',
        type: 'shufersal'
    },
    rami_levy: {
        name: 'רמי לוי',
        baseUrl: 'http://url.publishedprices.co.il',
        username: 'RasLevi',
        type: 'publishedprices'
    },
    victory: {
        name: 'ויקטורי',
        baseUrl: 'http://url.publishedprices.co.il',
        username: 'Victory',
        type: 'publishedprices'
    },
    yeinot_bitan: {
        name: 'יינות ביתן',
        baseUrl: 'http://url.publishedprices.co.il',
        username: 'yabormarket',
        type: 'publishedprices'
    },
    osher_ad: {
        name: 'אושר עד',
        baseUrl: 'http://url.publishedprices.co.il',
        username: 'osherad',
        type: 'publishedprices'
    },
    hazi_hinam: {
        name: 'חצי חינם',
        baseUrl: 'http://url.publishedprices.co.il',
        username: 'HasijHnam',
        type: 'publishedprices'
    },
    mega: {
        name: 'מגה',
        baseUrl: 'http://publishprice.mega.co.il',
        type: 'mega'
    },
    tiv_taam: {
        name: 'טיב טעם',
        baseUrl: 'http://url.publishedprices.co.il',
        username: 'TivTaam',
        type: 'publishedprices'
    }
};

// Category detection
const CATEGORY_KEYWORDS = {
    'מוצרי חלב': ['חלב', 'גבינה', 'יוגורט', 'שמנת', 'קוטג', 'לבן', 'מעדן', 'שוקו'],
    'לחם ומאפים': ['לחם', 'פיתה', 'לחמניה', 'חלה', 'באגט', 'טוסט', 'מאפה', 'עוגה'],
    'ביצים': ['ביצים', 'ביצה'],
    'בשר ועוף': ['עוף', 'בקר', 'טלה', 'הודו', 'נקניק', 'שניצל', 'המבורגר', 'כרעיים', 'חזה', 'בשר'],
    'דגים': ['דג', 'סלמון', 'טונה', 'אמנון', 'פילה'],
    'פירות וירקות': ['תפוח', 'בננה', 'תפוז', 'לימון', 'עגבני', 'מלפפון', 'גזר', 'בצל', 'אבוקדו'],
    'משקאות': ['מים', 'קולה', 'ספרייט', 'מיץ', 'סודה', 'בירה', 'יין', 'משקה'],
    'חטיפים': ['במבה', 'ביסלי', 'שוקולד', 'עוגיה', 'וופל', 'סוכריה', 'גלידה', 'חטיף'],
    'ניקיון': ['סבון', 'שמפו', 'מרכך', 'אבקה', 'נוזל כלים', 'אקונומיקה', 'מטליות'],
    'פסטה ואורז': ['פסטה', 'ספגטי', 'אטריות', 'אורז', 'קוסקוס', 'פתיתים'],
    'שימורים': ['שימורים', 'טונה', 'תירס', 'אפונה', 'חומוס', 'שעועית'],
    'קפה ותה': ['קפה', 'נס', 'אספרסו', 'תה', 'קפסולות'],
    'תינוקות': ['חיתולים', 'מטרנה', 'סימילאק', 'מגבונים', 'תינוק'],
};

function categorize(name) {
    const lower = (name || '').toLowerCase();
    for (const [cat, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
        for (const kw of keywords) {
            if (lower.includes(kw)) return cat;
        }
    }
    return 'כללי';
}

// HTTP fetch helper
function fetchUrl(url, options = {}) {
    return new Promise((resolve, reject) => {
        const protocol = url.startsWith('https') ? https : http;
        const timeout = options.timeout || 30000;

        console.log(`  Fetching: ${url.substring(0, 80)}...`);

        const req = protocol.get(url, { timeout }, (res) => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                console.log(`  Redirecting to: ${res.headers.location.substring(0, 50)}...`);
                return fetchUrl(res.headers.location, options).then(resolve).catch(reject);
            }

            if (res.statusCode !== 200) {
                return reject(new Error(`HTTP ${res.statusCode}`));
            }

            const chunks = [];
            res.on('data', chunk => chunks.push(chunk));
            res.on('end', () => {
                const buffer = Buffer.concat(chunks);

                // Check if gzipped
                if (res.headers['content-encoding'] === 'gzip' ||
                    url.endsWith('.gz') ||
                    (buffer[0] === 0x1f && buffer[1] === 0x8b)) {
                    zlib.gunzip(buffer, (err, decompressed) => {
                        if (err) return reject(err);
                        resolve(decompressed.toString('utf-8'));
                    });
                } else {
                    resolve(buffer.toString('utf-8'));
                }
            });
        });

        req.on('error', reject);
        req.on('timeout', () => {
            req.destroy();
            reject(new Error('Request timeout'));
        });
    });
}

// Parse XML price data
function parsePriceXml(xmlContent, chainId, chainName) {
    const parser = new XMLParser({
        ignoreAttributes: false,
        attributeNamePrefix: '@_',
    });

    const products = [];

    try {
        const result = parser.parse(xmlContent);

        // Find items - different XML structures per chain
        let items = [];

        // Try different paths
        const paths = [
            result?.root?.Items?.Item,
            result?.Prices?.Products?.Product,
            result?.Items?.Item,
            result?.Root?.Items?.Item,
            result?.PriceFull?.Items?.Item,
            result?.Prices?.Item,
        ];

        for (const path of paths) {
            if (path) {
                items = Array.isArray(path) ? path : [path];
                break;
            }
        }

        console.log(`  Found ${items.length} items in XML`);

        for (const item of items) {
            const barcode = String(item.ItemCode || item.Barcode || item.barcode || '').trim();
            const name = String(item.ItemName || item.ItemNm || item.ProductName || item.name || '').trim();
            const priceStr = String(item.ItemPrice || item.Price || item.price || '0');
            const price = parseFloat(priceStr.replace(',', '.')) || 0;

            if (barcode && name && price > 0 && barcode.length >= 5) {
                products.push({
                    barcode,
                    name,
                    price: Math.round(price * 100) / 100,
                    chain: chainId,
                    chainName,
                    manufacturer: String(item.ManufacturerName || item.Manufacturer || '').trim(),
                    category: categorize(name),
                });
            }
        }
    } catch (error) {
        console.error(`  XML parse error: ${error.message}`);
    }

    return products;
}

// Fetch Shufersal prices
async function fetchShufersal(limit = 10000) {
    const chain = CHAINS.shufersal;
    console.log(`\n📦 Fetching ${chain.name}...`);

    const products = [];

    try {
        // Get file list
        const listUrl = `${chain.baseUrl}${chain.fileListPath}`;
        const listHtml = await fetchUrl(listUrl);

        // Extract file URLs (look for PriceFull files)
        const fileMatches = listHtml.match(/href="([^"]*(?:PriceFull|pricefull)[^"]*\.xml(?:\.gz)?)"/gi) || [];
        console.log(`  Found ${fileMatches.length} price files`);

        // Download and parse first few files
        for (const match of fileMatches.slice(0, 3)) {
            if (products.length >= limit) break;

            try {
                const fileUrl = match.replace(/href="/i, '').replace(/"$/, '');
                const fullUrl = fileUrl.startsWith('http') ? fileUrl : `${chain.baseUrl}${fileUrl}`;

                const xmlContent = await fetchUrl(fullUrl, { timeout: 60000 });
                const parsed = parsePriceXml(xmlContent, 'shufersal', chain.name);
                products.push(...parsed);

                console.log(`  Total products so far: ${products.length}`);
            } catch (fileError) {
                console.log(`  Skipping file: ${fileError.message}`);
            }
        }
    } catch (error) {
        console.error(`  ${chain.name} error: ${error.message}`);
    }

    return products.slice(0, limit);
}

// Fetch from PublishedPrices chains
async function fetchPublishedPrices(chainId, limit = 10000) {
    const chain = CHAINS[chainId];
    if (!chain || chain.type !== 'publishedprices') return [];

    console.log(`\n📦 Fetching ${chain.name}...`);
    const products = [];

    try {
        // Try to get file listing
        const loginUrl = `${chain.baseUrl}/login/user`;

        // PublishedPrices requires a session - try direct file access
        const today = new Date();
        const dates = [];
        for (let i = 0; i < 7; i++) {
            const d = new Date(today);
            d.setDate(d.getDate() - i);
            dates.push(d.toISOString().split('T')[0].replace(/-/g, ''));
        }

        for (const dateStr of dates) {
            if (products.length >= limit) break;

            const possibleFiles = [
                `PriceFull${dateStr}*.xml`,
                `PriceFull*.xml`,
                `pricefull.xml`,
            ];

            // Try the file index page
            const indexUrl = `${chain.baseUrl}/file/d/${chain.username}/`;

            try {
                const indexHtml = await fetchUrl(indexUrl);

                // Extract file links
                const fileMatches = indexHtml.match(/href="([^"]*(?:Price|price)[^"]*\.(?:xml|gz))"/gi) || [];

                for (const match of fileMatches.slice(0, 2)) {
                    if (products.length >= limit) break;

                    const fileName = match.replace(/href="/i, '').replace(/"$/, '');
                    const fileUrl = `${chain.baseUrl}/file/d/${chain.username}/${fileName}`;

                    try {
                        const xmlContent = await fetchUrl(fileUrl, { timeout: 60000 });
                        const parsed = parsePriceXml(xmlContent, chainId, chain.name);
                        products.push(...parsed);
                        console.log(`  Got ${parsed.length} products from ${fileName}`);
                    } catch (e) {
                        // Continue to next file
                    }
                }
            } catch (e) {
                console.log(`  Could not access ${chain.name} file index: ${e.message}`);
            }
        }
    } catch (error) {
        console.error(`  ${chain.name} error: ${error.message}`);
    }

    return products.slice(0, limit);
}

// Merge products by barcode
function mergeProducts(allProducts) {
    const merged = {};

    for (const product of allProducts) {
        const { barcode, chain, chainName, price, ...rest } = product;

        if (!merged[barcode]) {
            merged[barcode] = {
                barcode,
                name: rest.name,
                manufacturer: rest.manufacturer || '',
                category: rest.category || 'כללי',
                prices: [],
                image: barcode.length >= 12
                    ? `https://images.openfoodfacts.org/images/products/${barcode.slice(0,3)}/${barcode.slice(3,6)}/${barcode.slice(6,9)}/${barcode.slice(9)}/front_he.400.jpg`
                    : null,
            };
        }

        // Add/update price for this chain
        const existingPrice = merged[barcode].prices.find(p => p.chain === chain);
        if (!existingPrice) {
            merged[barcode].prices.push({ chain, chainName, price });
        } else {
            existingPrice.price = price; // Update with latest
        }
    }

    return Object.values(merged);
}

// Update MongoDB
async function updateDatabase(products) {
    console.log(`\n💾 Connecting to MongoDB...`);

    const client = new MongoClient(MONGODB_URI);
    await client.connect();

    const db = client.db();
    const collection = db.collection('products');

    console.log(`💾 Updating ${products.length} products...`);

    const stats = { inserted: 0, updated: 0, errors: 0 };
    const now = new Date();

    for (const product of products) {
        try {
            // Find cheapest price
            const cheapestPrice = product.prices.reduce((min, p) =>
                p.price < min.price ? p : min, product.prices[0]);

            const result = await collection.updateOne(
                { barcode: product.barcode },
                {
                    $set: {
                        name: product.name,
                        manufacturer: product.manufacturer,
                        category: product.category,
                        image: product.image,
                        prices: product.prices.map(p => ({ ...p, lastUpdated: now })),
                        cheapestPrice: cheapestPrice.price,
                        cheapestChain: cheapestPrice.chainName,
                        lastUpdated: now,
                        dataSource: 'local-scraper'
                    }
                },
                { upsert: true }
            );

            if (result.upsertedCount > 0) stats.inserted++;
            else if (result.modifiedCount > 0) stats.updated++;
        } catch (error) {
            stats.errors++;
        }
    }

    // Update sync status
    await db.collection('settings').updateOne(
        { _id: 'sync-status' },
        {
            $set: {
                lastSync: now,
                type: 'local-scraper',
                totalProducts: products.length,
                storeStats: stats
            }
        },
        { upsert: true }
    );

    await client.close();
    return stats;
}

// Main function
async function main() {
    console.log('🇮🇱 Israeli Supermarket Price Updater');
    console.log('=====================================\n');

    // Parse command line args
    const args = process.argv.slice(2);
    let selectedChains = ['shufersal', 'rami_levy', 'victory'];

    const chainsArg = args.find(a => a.startsWith('--chains='));
    if (chainsArg) {
        selectedChains = chainsArg.replace('--chains=', '').split(',');
    }

    console.log(`Chains to fetch: ${selectedChains.join(', ')}`);
    console.log(`MongoDB: ${MONGODB_URI.substring(0, 30)}...`);

    const allProducts = [];

    // Fetch from each chain
    for (const chainId of selectedChains) {
        try {
            let products = [];

            if (chainId === 'shufersal') {
                products = await fetchShufersal(5000);
            } else if (CHAINS[chainId]) {
                products = await fetchPublishedPrices(chainId, 5000);
            } else {
                console.log(`Unknown chain: ${chainId}`);
                continue;
            }

            console.log(`  ✓ ${CHAINS[chainId]?.name || chainId}: ${products.length} products`);
            allProducts.push(...products);
        } catch (error) {
            console.error(`  ✗ ${chainId}: ${error.message}`);
        }
    }

    if (allProducts.length === 0) {
        console.log('\n⚠️  No products fetched. Price portals may be unavailable.');
        console.log('   Try running from a computer with Israeli IP address.');
        process.exit(1);
    }

    // Merge products by barcode
    console.log(`\n🔄 Merging ${allProducts.length} price entries...`);
    const merged = mergeProducts(allProducts);
    console.log(`   ${merged.length} unique products`);

    // Update database
    const stats = await updateDatabase(merged);

    console.log('\n✅ Update complete!');
    console.log(`   Inserted: ${stats.inserted}`);
    console.log(`   Updated: ${stats.updated}`);
    console.log(`   Errors: ${stats.errors}`);
    console.log(`\n🔗 Your app now has real prices from Israeli supermarkets!`);
}

main().catch(error => {
    console.error('\n❌ Error:', error.message);
    process.exit(1);
});
