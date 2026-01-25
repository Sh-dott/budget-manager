/**
 * Direct Israeli Supermarket Price Importer
 *
 * Fetches prices directly from official Israeli price transparency portals.
 * No Kaggle credentials required - uses legally mandated public data.
 *
 * Usage: node scripts/import_prices_direct.js
 */

const https = require('https');
const http = require('http');
const zlib = require('zlib');
const { XMLParser } = require('fast-xml-parser');
const path = require('path');

// Chain configuration with their official price data URLs
const CHAINS = {
    shufersal: {
        name: 'שופרסל',
        baseUrl: 'http://prices.shufersal.co.il',
        fileListPath: '/FileObject/UpdateCategory?catID=2&storeId=0',  // Price files
    },
    rami_levy: {
        name: 'רמי לוי',
        baseUrl: 'http://url.publishedprices.co.il',
        username: 'RasLevi',  // Public username from government docs
    },
    victory: {
        name: 'ויקטורי',
        baseUrl: 'http://url.publishedprices.co.il',
        username: 'Victory',
    },
    yeinot_bitan: {
        name: 'יינות ביתן',
        baseUrl: 'http://url.publishedprices.co.il',
        username: 'ybitan',
    },
    osher_ad: {
        name: 'אושר עד',
        baseUrl: 'http://url.publishedprices.co.il',
        username: 'osherad',
    },
    hazi_hinam: {
        name: 'חצי חינם',
        baseUrl: 'http://url.publishedprices.co.il',
        username: 'HaziHiwornam',
    },
};

// Category detection based on Hebrew keywords
const CATEGORY_KEYWORDS = {
    'מוצרי חלב': ['חלב', 'גבינה', 'יוגורט', 'שמנת', 'קוטג', 'לבן', 'קפיר', 'מעדן'],
    'לחם ומאפים': ['לחם', 'פיתה', 'לחמניה', 'חלה', 'באגט', 'טוסט', 'מאפה'],
    'ביצים': ['ביצים', 'ביצה'],
    'בשר ועוף': ['עוף', 'בקר', 'טלה', 'כבש', 'הודו', 'נקניק', 'שניצל', 'המבורגר', 'סטייק'],
    'דגים': ['דג', 'סלמון', 'טונה', 'אמנון', 'דניס'],
    'פירות וירקות': ['תפוח', 'בננה', 'תפוז', 'לימון', 'עגבני', 'מלפפון', 'גזר', 'בצל', 'תפוא', 'אבוקדו'],
    'משקאות': ['מים', 'קולה', 'ספרייט', 'פנטה', 'מיץ', 'סודה', 'בירה', 'יין'],
    'חטיפים וממתקים': ['במבה', 'ביסלי', 'שוקולד', 'עוגיה', 'וופל', 'סוכריה', 'גלידה'],
    'ניקיון': ['אקונומיקה', 'סבון', 'שמפו', 'מרכך', 'אבקה', 'נוזל כלים'],
    'פסטה ואורז': ['פסטה', 'ספגטי', 'אטריות', 'אורז', 'קוסקוס', 'פתיתים'],
    'שימורים': ['שימורים', 'טונה', 'תירס', 'אפונה', 'חומוס', 'שעועית'],
    'קפה ותה': ['קפה', 'נס', 'אספרסו', 'תה'],
};

function categorizeProduct(name) {
    const nameLower = name.toLowerCase();
    for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
        for (const keyword of keywords) {
            if (nameLower.includes(keyword)) {
                return category;
            }
        }
    }
    return 'כללי';
}

// HTTP fetch helper
function fetchUrl(url, options = {}) {
    return new Promise((resolve, reject) => {
        const protocol = url.startsWith('https') ? https : http;
        const timeout = options.timeout || 30000;

        const req = protocol.get(url, { timeout }, (res) => {
            // Handle redirects
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
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

    try {
        const result = parser.parse(xmlContent);
        const products = [];

        // Find items (different structures per chain)
        let items = [];
        if (result.root?.Items?.Item) {
            items = Array.isArray(result.root.Items.Item)
                ? result.root.Items.Item
                : [result.root.Items.Item];
        } else if (result.Prices?.Products?.Product) {
            items = Array.isArray(result.Prices.Products.Product)
                ? result.Prices.Products.Product
                : [result.Prices.Products.Product];
        } else if (result.Items?.Item) {
            items = Array.isArray(result.Items.Item)
                ? result.Items.Item
                : [result.Items.Item];
        }

        for (const item of items) {
            const barcode = item.ItemCode || item.Barcode || item.barcode || '';
            const name = item.ItemName || item.ItemNm || item.ProductName || item.name || '';
            const priceStr = item.ItemPrice || item.Price || item.price || '0';
            const price = parseFloat(priceStr) || 0;

            if (barcode && name && price > 0) {
                products.push({
                    barcode: String(barcode).trim(),
                    name: name.trim(),
                    price: Math.round(price * 100) / 100,
                    chain: chainId,
                    chainName: chainName,
                    manufacturer: item.ManufacturerName || item.Manufacturer || '',
                    category: categorizeProduct(name),
                });
            }
        }

        return products;
    } catch (error) {
        console.error(`XML parse error: ${error.message}`);
        return [];
    }
}

// Fetch Shufersal prices
async function fetchShufersal(limit = 5000) {
    console.log('Fetching Shufersal prices...');
    const products = [];

    try {
        // Try to get file list from Shufersal
        const fileListUrl = `${CHAINS.shufersal.baseUrl}${CHAINS.shufersal.fileListPath}`;
        const fileListContent = await fetchUrl(fileListUrl);

        // Parse HTML/JSON response to find price file URLs
        // Shufersal typically lists gz files
        const fileMatches = fileListContent.match(/href="([^"]*PriceFull[^"]*\.gz)"/gi) || [];

        for (const match of fileMatches.slice(0, 3)) { // Limit to 3 files
            const fileUrl = match.replace(/href="/i, '').replace(/"$/, '');
            const fullUrl = fileUrl.startsWith('http') ? fileUrl : `${CHAINS.shufersal.baseUrl}${fileUrl}`;

            try {
                const xmlContent = await fetchUrl(fullUrl);
                const parsed = parsePriceXml(xmlContent, 'shufersal', CHAINS.shufersal.name);
                products.push(...parsed);

                if (products.length >= limit) break;
            } catch (fileError) {
                console.log(`  Skipping file: ${fileError.message}`);
            }
        }
    } catch (error) {
        console.log(`Shufersal error: ${error.message}`);
    }

    return products.slice(0, limit);
}

// Fetch from publishedprices.co.il chains
async function fetchPublishedPrices(chainId, limit = 5000) {
    const chain = CHAINS[chainId];
    if (!chain || !chain.username) return [];

    console.log(`Fetching ${chain.name} prices...`);
    const products = [];

    try {
        // PublishedPrices has a login page, but file lists may be accessible
        const baseUrl = `${chain.baseUrl}/file/d/${chain.username}`;

        // Try common file patterns
        const today = new Date();
        const dateStr = today.toISOString().split('T')[0].replace(/-/g, '');

        const possibleUrls = [
            `${baseUrl}/PriceFull${dateStr}.gz`,
            `${baseUrl}/Price${dateStr}.gz`,
            `${baseUrl}/pricefull.xml`,
        ];

        for (const url of possibleUrls) {
            try {
                const content = await fetchUrl(url);
                const parsed = parsePriceXml(content, chainId, chain.name);
                if (parsed.length > 0) {
                    products.push(...parsed);
                    break;
                }
            } catch {
                // Try next URL
            }
        }
    } catch (error) {
        console.log(`${chain.name} error: ${error.message}`);
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

        // Add price if not already present for this chain
        if (!merged[barcode].prices.find(p => p.chain === chain)) {
            merged[barcode].prices.push({ chain, chainName, price });
        }
    }

    // Sort by number of chains (more chains = more useful for comparison)
    return Object.values(merged).sort((a, b) => b.prices.length - a.prices.length);
}

// Main import function
async function importPrices(options = {}) {
    const { limit = 3000, chains = ['shufersal', 'rami_levy', 'victory'] } = options;
    const allProducts = [];
    const chainsSummary = {};

    for (const chainId of chains) {
        try {
            let products;

            if (chainId === 'shufersal') {
                products = await fetchShufersal(limit);
            } else {
                products = await fetchPublishedPrices(chainId, limit);
            }

            allProducts.push(...products);
            chainsSummary[chainId] = products.length;
            console.log(`  ${CHAINS[chainId]?.name || chainId}: ${products.length} products`);
        } catch (error) {
            console.error(`Failed to fetch ${chainId}: ${error.message}`);
            chainsSummary[chainId] = 0;
        }
    }

    const merged = mergeProducts(allProducts);

    return {
        success: true,
        totalProducts: merged.length,
        chainsSummary,
        products: merged,
        importedAt: new Date().toISOString(),
    };
}

// Export for use in server.js
module.exports = { importPrices, CHAINS };

// CLI usage
if (require.main === module) {
    const args = process.argv.slice(2);
    const outputFile = args.includes('--output')
        ? args[args.indexOf('--output') + 1]
        : null;

    importPrices({ limit: 5000 })
        .then(result => {
            const json = JSON.stringify(result, null, 2);
            if (outputFile) {
                require('fs').writeFileSync(outputFile, json);
                console.log(`Output written to ${outputFile}`);
            } else {
                console.log(json);
            }
        })
        .catch(error => {
            console.error('Import failed:', error);
            process.exit(1);
        });
}
