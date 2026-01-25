/**
 * Kaggle Israeli Supermarket Prices Importer (Node.js version)
 *
 * Downloads price data from Kaggle using their API directly
 * No Python required!
 */

const https = require('https');
const fs = require('fs');
const path = require('path');
const { createGunzip } = require('zlib');
const { pipeline } = require('stream/promises');
const os = require('os');

// Kaggle API base URL
const KAGGLE_API = 'https://www.kaggle.com/api/v1';
const DATASET = 'erlichsefi/israeli-supermarkets-2024';

// Chain mapping
const CHAIN_MAPPING = {
    'SHUFERSAL': { id: 'shufersal', name: 'שופרסל' },
    'RAMI_LEVY': { id: 'rami_levy', name: 'רמי לוי' },
    'VICTORY': { id: 'victory', name: 'ויקטורי' },
    'YAYNO_BITAN': { id: 'yeinot_bitan', name: 'יינות ביתן' },
    'MEGA': { id: 'mega', name: 'מגה' },
    'OSHER_AD': { id: 'osher_ad', name: 'אושר עד' },
    'HAZI_HINAM': { id: 'hazi_hinam', name: 'חצי חינם' },
    'TIV_TAAM': { id: 'tiv_taam', name: 'טיב טעם' },
};

// Category detection
const CATEGORY_KEYWORDS = {
    'מוצרי חלב': ['חלב', 'גבינה', 'יוגורט', 'שמנת', 'קוטג', 'לבן', 'מעדן'],
    'לחם ומאפים': ['לחם', 'פיתה', 'לחמניה', 'חלה', 'באגט', 'טוסט'],
    'ביצים': ['ביצים', 'ביצה'],
    'בשר ועוף': ['עוף', 'בקר', 'הודו', 'נקניק', 'שניצל', 'המבורגר'],
    'פירות וירקות': ['תפוח', 'בננה', 'עגבני', 'מלפפון', 'גזר', 'בצל'],
    'משקאות': ['מים', 'קולה', 'מיץ', 'סודה', 'בירה'],
    'חטיפים': ['במבה', 'ביסלי', 'שוקולד', 'עוגיה', 'וופל'],
    'ניקיון': ['סבון', 'שמפו', 'אבקה', 'נוזל כלים'],
};

function categorize(name) {
    const lower = name.toLowerCase();
    for (const [cat, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
        for (const kw of keywords) {
            if (lower.includes(kw)) return cat;
        }
    }
    return 'כללי';
}

/**
 * Make authenticated Kaggle API request
 */
function kaggleRequest(endpoint, options = {}) {
    return new Promise((resolve, reject) => {
        const username = process.env.KAGGLE_USERNAME;
        const key = process.env.KAGGLE_KEY;

        if (!username || !key) {
            return reject(new Error('KAGGLE_USERNAME and KAGGLE_KEY environment variables required'));
        }

        const auth = Buffer.from(`${username}:${key}`).toString('base64');
        const url = `${KAGGLE_API}${endpoint}`;

        console.log(`[Kaggle] Requesting: ${endpoint}`);

        const req = https.request(url, {
            method: options.method || 'GET',
            headers: {
                'Authorization': `Basic ${auth}`,
                'Accept': 'application/json',
                ...options.headers
            }
        }, (res) => {
            if (res.statusCode === 302 || res.statusCode === 301) {
                // Follow redirect
                return kaggleRequest(res.headers.location.replace(KAGGLE_API, ''), options)
                    .then(resolve)
                    .catch(reject);
            }

            if (res.statusCode !== 200) {
                return reject(new Error(`Kaggle API error: ${res.statusCode}`));
            }

            if (options.stream) {
                return resolve(res);
            }

            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    resolve(JSON.parse(data));
                } catch (e) {
                    resolve(data);
                }
            });
        });

        req.on('error', reject);
        req.end();
    });
}

/**
 * Download dataset file from Kaggle
 */
async function downloadFile(filename, destPath) {
    const username = process.env.KAGGLE_USERNAME;
    const key = process.env.KAGGLE_KEY;
    const auth = Buffer.from(`${username}:${key}`).toString('base64');

    return new Promise((resolve, reject) => {
        const url = `https://www.kaggle.com/api/v1/datasets/download/${DATASET}/${filename}`;
        console.log(`[Kaggle] Downloading: ${filename}`);

        const file = fs.createWriteStream(destPath);

        https.get(url, {
            headers: { 'Authorization': `Basic ${auth}` }
        }, (res) => {
            if (res.statusCode === 302) {
                // Follow redirect
                https.get(res.headers.location, (redirectRes) => {
                    redirectRes.pipe(file);
                    file.on('finish', () => {
                        file.close();
                        resolve(destPath);
                    });
                }).on('error', reject);
            } else if (res.statusCode === 200) {
                res.pipe(file);
                file.on('finish', () => {
                    file.close();
                    resolve(destPath);
                });
            } else {
                reject(new Error(`Download failed: ${res.statusCode}`));
            }
        }).on('error', reject);
    });
}

/**
 * Parse CSV content to products
 */
function parseCSV(content, chainKey) {
    const lines = content.split('\n');
    if (lines.length < 2) return [];

    // Parse header
    const header = lines[0].split(',').map(h => h.trim().replace(/"/g, ''));
    const products = [];

    const chainInfo = CHAIN_MAPPING[chainKey] || { id: chainKey.toLowerCase(), name: chainKey };

    for (let i = 1; i < lines.length; i++) {
        if (!lines[i].trim()) continue;

        // Simple CSV parsing (handles basic cases)
        const values = lines[i].match(/(".*?"|[^,]+)/g)?.map(v => v.replace(/^"|"$/g, '').trim()) || [];

        const row = {};
        header.forEach((h, idx) => {
            row[h] = values[idx] || '';
        });

        const barcode = row.ItemCode || row.item_code || row.Barcode || '';
        const name = row.ItemName || row.item_name || row.ProductName || '';
        const priceStr = row.ItemPrice || row.item_price || row.Price || '0';
        const price = parseFloat(priceStr.replace(',', '.')) || 0;

        if (barcode && name && price > 0) {
            products.push({
                barcode: barcode.trim(),
                name: name.trim(),
                price: Math.round(price * 100) / 100,
                chain: chainInfo.id,
                chainName: chainInfo.name,
                manufacturer: row.ManufacturerName || row.Manufacturer || '',
                category: categorize(name)
            });
        }
    }

    return products;
}

/**
 * List available files in dataset
 */
async function listDatasetFiles() {
    try {
        const data = await kaggleRequest(`/datasets/list/files/${DATASET}`);
        return data.datasetFiles || [];
    } catch (e) {
        console.error('[Kaggle] Error listing files:', e.message);
        return [];
    }
}

/**
 * Main import function
 */
async function importFromKaggle(options = {}) {
    const { limit = 5000, chains = null } = options;
    const tmpDir = os.tmpdir();
    const allProducts = [];
    const chainsSummary = {};

    console.log('[Kaggle] Starting import...');
    console.log(`[Kaggle] Credentials: ${process.env.KAGGLE_USERNAME ? 'Found' : 'Missing'}`);

    try {
        // List files in dataset
        const files = await listDatasetFiles();
        console.log(`[Kaggle] Found ${files.length} files in dataset`);

        // Filter for price files
        const priceFiles = files.filter(f =>
            f.name.includes('price') &&
            (f.name.endsWith('.csv') || f.name.endsWith('.csv.gz'))
        );

        console.log(`[Kaggle] Found ${priceFiles.length} price files`);

        // Process each price file (limit to first few for speed)
        for (const file of priceFiles.slice(0, 6)) {
            // Determine chain from filename
            let chainKey = null;
            for (const key of Object.keys(CHAIN_MAPPING)) {
                if (file.name.toUpperCase().includes(key)) {
                    chainKey = key;
                    break;
                }
            }

            if (!chainKey) {
                console.log(`[Kaggle] Skipping unknown chain file: ${file.name}`);
                continue;
            }

            // Filter by requested chains
            if (chains && !chains.includes(CHAIN_MAPPING[chainKey].id)) {
                continue;
            }

            try {
                const destPath = path.join(tmpDir, file.name);
                await downloadFile(file.name, destPath);

                // Read and parse
                let content;
                if (file.name.endsWith('.gz')) {
                    const zlib = require('zlib');
                    const compressed = fs.readFileSync(destPath);
                    content = zlib.gunzipSync(compressed).toString('utf-8');
                } else {
                    content = fs.readFileSync(destPath, 'utf-8');
                }

                const products = parseCSV(content, chainKey);
                console.log(`[Kaggle] Parsed ${products.length} products from ${file.name}`);

                allProducts.push(...products.slice(0, limit));
                chainsSummary[CHAIN_MAPPING[chainKey].id] = products.length;

                // Cleanup
                try { fs.unlinkSync(destPath); } catch (e) {}

            } catch (fileError) {
                console.error(`[Kaggle] Error processing ${file.name}:`, fileError.message);
            }
        }

        // Merge products by barcode
        const merged = {};
        for (const product of allProducts) {
            if (!merged[product.barcode]) {
                merged[product.barcode] = {
                    barcode: product.barcode,
                    name: product.name,
                    manufacturer: product.manufacturer,
                    category: product.category,
                    prices: [],
                    image: product.barcode.length >= 12
                        ? `https://images.openfoodfacts.org/images/products/${product.barcode.slice(0,3)}/${product.barcode.slice(3,6)}/${product.barcode.slice(6,9)}/${product.barcode.slice(9)}/front_he.400.jpg`
                        : null
                };
            }

            if (!merged[product.barcode].prices.find(p => p.chain === product.chain)) {
                merged[product.barcode].prices.push({
                    chain: product.chain,
                    chainName: product.chainName,
                    price: product.price
                });
            }
        }

        const mergedProducts = Object.values(merged)
            .sort((a, b) => b.prices.length - a.prices.length)
            .slice(0, limit);

        return {
            success: true,
            totalProducts: mergedProducts.length,
            chainsSummary,
            products: mergedProducts,
            importedAt: new Date().toISOString()
        };

    } catch (error) {
        console.error('[Kaggle] Import error:', error);
        return {
            success: false,
            error: error.message,
            products: []
        };
    }
}

module.exports = { importFromKaggle, listDatasetFiles };

// CLI usage
if (require.main === module) {
    importFromKaggle({ limit: 1000 })
        .then(result => {
            console.log(JSON.stringify(result, null, 2));
        })
        .catch(console.error);
}
