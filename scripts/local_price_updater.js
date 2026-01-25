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
const fs = require('fs');
const path = require('path');
const { MongoClient } = require('mongodb');
const { XMLParser } = require('fast-xml-parser');

// Disable SSL verification for Israeli price portals (self-signed certs)
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

// Cookie file path for publishedprices.co.il session
const COOKIE_FILE = path.join(process.env.USERPROFILE || process.env.HOME, 'cookies.txt');

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
        baseUrl: 'https://url.publishedprices.co.il',
        username: 'RamiLevi',
        type: 'publishedprices'
    },
    victory: {
        name: 'ויקטורי',
        baseUrl: 'https://laibcatalog.co.il',
        type: 'laibcatalog'
    },
    yeinot_bitan: {
        name: 'יינות ביתן',
        baseUrl: 'https://url.publishedprices.co.il',
        username: 'yabormarket',
        type: 'publishedprices'
    },
    osher_ad: {
        name: 'אושר עד',
        baseUrl: 'https://url.publishedprices.co.il',
        username: 'osherad',
        type: 'publishedprices'
    },
    hazi_hinam: {
        name: 'חצי חינם',
        baseUrl: 'https://url.publishedprices.co.il',
        username: 'HaijHnam',
        type: 'publishedprices'
    },
    mega: {
        name: 'מגה',
        baseUrl: 'https://publishprice.mega.co.il',
        type: 'mega'
    },
    tiv_taam: {
        name: 'טיב טעם',
        baseUrl: 'https://url.publishedprices.co.il',
        username: 'TivTaam',
        type: 'publishedprices'
    },
    yohananof: {
        name: 'יוחננוף',
        baseUrl: 'https://url.publishedprices.co.il',
        username: 'yohananof',
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

// Load cookie from file
function loadCookie(domain) {
    try {
        if (fs.existsSync(COOKIE_FILE)) {
            const content = fs.readFileSync(COOKIE_FILE, 'utf-8');
            const lines = content.split('\n');
            for (const line of lines) {
                if (line.startsWith('#') || line.trim() === '') continue;
                const parts = line.split('\t');
                if (parts.length >= 7 && parts[0].includes(domain)) {
                    return `${parts[5]}=${parts[6]}`;
                }
            }
        }
    } catch (e) {
        // Ignore cookie loading errors
    }
    return null;
}

// HTTP fetch helper with cookie support
function fetchUrl(url, options = {}) {
    return new Promise((resolve, reject) => {
        const urlObj = new URL(url);
        const protocol = urlObj.protocol === 'https:' ? https : http;
        const timeout = options.timeout || 30000;

        const reqOptions = {
            hostname: urlObj.hostname,
            port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
            path: urlObj.pathname + urlObj.search,
            method: options.method || 'GET',
            timeout,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Accept': '*/*',
                ...options.headers
            }
        };

        // Add cookie if available
        if (options.cookie) {
            reqOptions.headers['Cookie'] = options.cookie;
        }

        console.log(`  Fetching: ${url.substring(0, 80)}...`);

        const req = protocol.request(reqOptions, (res) => {
            // Save cookies from response
            const setCookie = res.headers['set-cookie'];
            if (setCookie && options.saveCookie) {
                options.saveCookie(setCookie);
            }

            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                let redirectUrl = res.headers.location;
                if (redirectUrl.startsWith('/')) {
                    redirectUrl = `${urlObj.protocol}//${urlObj.host}${redirectUrl}`;
                }
                console.log(`  Redirecting to: ${redirectUrl.substring(0, 50)}...`);
                return fetchUrl(redirectUrl, options).then(resolve).catch(reject);
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
                    (buffer.length > 1 && buffer[0] === 0x1f && buffer[1] === 0x8b)) {
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
        req.end();
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

        // Extract Azure blob storage URLs (Shufersal uses blob.core.windows.net)
        const fileMatches = listHtml.match(/href="(https:\/\/[^"]*blob\.core\.windows\.net[^"]*(?:PriceFull|pricefull)[^"]*)"/gi) || [];
        console.log(`  Found ${fileMatches.length} price files`);

        // Download and parse first few files
        for (const match of fileMatches.slice(0, 5)) {
            if (products.length >= limit) break;

            try {
                // Clean up the URL - decode HTML entities
                let fileUrl = match.replace(/href="/i, '').replace(/"$/, '');
                fileUrl = fileUrl.replace(/&amp;/g, '&');

                console.log(`  Downloading: ${fileUrl.substring(0, 60)}...`);
                const xmlContent = await fetchUrl(fileUrl, { timeout: 120000 });
                const parsed = parsePriceXml(xmlContent, 'shufersal', chain.name);
                products.push(...parsed);

                console.log(`  Total products so far: ${products.length}`);

                if (products.length >= limit) break;
            } catch (fileError) {
                console.log(`  Skipping file: ${fileError.message}`);
            }
        }
    } catch (error) {
        console.error(`  ${chain.name} error: ${error.message}`);
    }

    return products.slice(0, limit);
}

// Login to publishedprices.co.il and get session cookie
async function loginToPublishedPrices(username) {
    // First, try to use existing cookie from file
    const existingCookie = loadCookie('publishedprices.co.il');
    if (existingCookie) {
        console.log(`  Using existing cookie from file`);
        return existingCookie;
    }

    return new Promise((resolve, reject) => {
        const postData = `username=${encodeURIComponent(username)}`;

        const options = {
            hostname: 'url.publishedprices.co.il',
            port: 443,
            path: '/login/user',
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Content-Length': Buffer.byteLength(postData),
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
            }
        };

        const req = https.request(options, (res) => {
            const cookies = res.headers['set-cookie'];

            // Consume the response body
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => {
                if (cookies && cookies.length > 0) {
                    // Extract the session cookie
                    const sessionCookie = cookies.map(c => c.split(';')[0]).join('; ');
                    resolve(sessionCookie);
                } else {
                    resolve(null);
                }
            });
        });

        req.on('error', reject);
        req.write(postData);
        req.end();
    });
}

// Fetch with cookie and handle redirects properly
async function fetchWithSession(url, cookie, maxRedirects = 5) {
    return new Promise((resolve, reject) => {
        const urlObj = new URL(url);
        const protocol = urlObj.protocol === 'https:' ? https : http;

        const options = {
            hostname: urlObj.hostname,
            port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
            path: urlObj.pathname + urlObj.search,
            method: 'GET',
            timeout: 60000,
            headers: {
                'Cookie': cookie,
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
            }
        };

        const req = protocol.request(options, (res) => {
            // Update cookie if new one is set
            let newCookie = cookie;
            if (res.headers['set-cookie']) {
                const newCookies = res.headers['set-cookie'].map(c => c.split(';')[0]).join('; ');
                newCookie = newCookies || cookie;
            }

            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                if (maxRedirects <= 0) {
                    return reject(new Error('Too many redirects'));
                }
                // Check if redirecting to login page - means auth failed
                if (res.headers.location.includes('/login')) {
                    return reject(new Error('Session expired or invalid'));
                }
                let redirectUrl = res.headers.location;
                if (redirectUrl.startsWith('/')) {
                    redirectUrl = `${urlObj.protocol}//${urlObj.host}${redirectUrl}`;
                }
                return fetchWithSession(redirectUrl, newCookie, maxRedirects - 1)
                    .then(resolve)
                    .catch(reject);
            }

            if (res.statusCode !== 200) {
                return reject(new Error(`HTTP ${res.statusCode}`));
            }

            const chunks = [];
            res.on('data', chunk => chunks.push(chunk));
            res.on('end', () => {
                const buffer = Buffer.concat(chunks);
                if (buffer.length > 1 && buffer[0] === 0x1f && buffer[1] === 0x8b) {
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
        req.end();
    });
}

// Fetch from PublishedPrices chains (Rami Levy, Yeinot Bitan, etc.)
async function fetchPublishedPrices(chainId, limit = 10000) {
    const chain = CHAINS[chainId];
    if (!chain || chain.type !== 'publishedprices') return [];

    console.log(`\n📦 Fetching ${chain.name}...`);
    const products = [];

    try {
        // Step 1: Login to get session
        console.log(`  Logging in as ${chain.username}...`);
        const cookie = await loginToPublishedPrices(chain.username);

        if (!cookie) {
            console.log(`  ✗ Could not get session for ${chain.name}`);
            return [];
        }
        console.log(`  ✓ Got session cookie`);

        // Step 2: Get file listing using JSON API
        const apiUrl = `https://url.publishedprices.co.il/file/json/dir?iDisplayLength=100&sSearch=PriceFull`;

        try {
            console.log(`  Fetching file list via API...`);
            const apiResponse = await fetchWithSession(apiUrl, cookie);
            const apiData = JSON.parse(apiResponse);

            if (apiData.aaData && apiData.aaData.length > 0) {
                console.log(`  Found ${apiData.aaData.length} files via API`);

                for (const fileEntry of apiData.aaData.slice(0, 3)) {
                    if (products.length >= limit) break;

                    try {
                        // Extract filename from HTML in API response
                        const fileNameMatch = fileEntry[0].match(/href="([^"]+)"/);
                        if (!fileNameMatch) continue;

                        const fileName = fileNameMatch[1];
                        const fileUrl = `https://url.publishedprices.co.il${fileName}`;

                        console.log(`  Downloading: ${fileName.substring(0, 50)}...`);
                        const xmlContent = await fetchWithSession(fileUrl, cookie);
                        const parsed = parsePriceXml(xmlContent, chainId, chain.name);
                        products.push(...parsed);
                        console.log(`  Got ${parsed.length} products`);

                        if (products.length >= limit) break;
                    } catch (fileError) {
                        console.log(`  Skipping file: ${fileError.message}`);
                    }
                }
            }
        } catch (apiError) {
            console.log(`  API method failed: ${apiError.message}`);

            // Fallback: Try direct file listing
            const indexUrl = `${chain.baseUrl}/file/d/${chain.username}/`;
            const indexHtml = await fetchWithSession(indexUrl, cookie);

            const fileMatches = [];
            const linkRegex = /href="([^"]*(?:PriceFull|Price7)[^"]*\.(?:xml|gz|XML|GZ))"/gi;
            let match;
            while ((match = linkRegex.exec(indexHtml)) !== null) {
                fileMatches.push(match[1]);
            }

            console.log(`  Found ${fileMatches.length} price files (fallback)`);

            for (const fileName of fileMatches.slice(0, 3)) {
                if (products.length >= limit) break;

                try {
                    const fileUrl = `${chain.baseUrl}/file/d/${chain.username}/${fileName}`;
                    console.log(`  Downloading: ${fileName.substring(0, 50)}...`);

                    const xmlContent = await fetchWithSession(fileUrl, cookie);
                    const parsed = parsePriceXml(xmlContent, chainId, chain.name);
                    products.push(...parsed);
                    console.log(`  Got ${parsed.length} products`);

                    if (products.length >= limit) break;
                } catch (fileError) {
                    console.log(`  Skipping ${fileName}: ${fileError.message}`);
                }
            }
        }
    } catch (error) {
        console.error(`  ${chain.name} error: ${error.message}`);
    }

    return products.slice(0, limit);
}

// Fetch from laibcatalog.co.il (Victory)
async function fetchLaibCatalog(chainId, limit = 10000) {
    const chain = CHAINS[chainId];
    if (!chain || chain.type !== 'laibcatalog') return [];

    console.log(`\n📦 Fetching ${chain.name}...`);
    const products = [];

    try {
        // Get file listing from laibcatalog
        const indexUrl = `${chain.baseUrl}/`;
        const indexHtml = await fetchUrl(indexUrl, { timeout: 60000 });

        // Extract price file links
        const fileMatches = [];
        const linkRegex = /href="([^"]*(?:PriceFull|Price7)[^"]*\.(?:xml|gz|XML|GZ))"/gi;
        let match;
        while ((match = linkRegex.exec(indexHtml)) !== null) {
            fileMatches.push(match[1]);
        }

        // Also try to find links in directory listing
        const dirLinkRegex = /href="([^"]+\/)"/gi;
        const directories = [];
        while ((match = dirLinkRegex.exec(indexHtml)) !== null) {
            if (!match[1].startsWith('..') && !match[1].startsWith('/')) {
                directories.push(match[1]);
            }
        }

        console.log(`  Found ${fileMatches.length} files, ${directories.length} directories`);

        // Check directories for price files
        for (const dir of directories.slice(0, 5)) {
            if (products.length >= limit) break;

            try {
                const dirUrl = `${chain.baseUrl}/${dir}`;
                const dirHtml = await fetchUrl(dirUrl, { timeout: 30000 });

                const dirFileRegex = /href="([^"]*(?:PriceFull|Price7|price)[^"]*\.(?:xml|gz|XML|GZ))"/gi;
                while ((match = dirFileRegex.exec(dirHtml)) !== null) {
                    fileMatches.push(`${dir}${match[1]}`);
                }
            } catch (e) {
                // Skip directory errors
            }
        }

        // Download price files
        for (const fileName of fileMatches.slice(0, 3)) {
            if (products.length >= limit) break;

            try {
                const fileUrl = fileName.startsWith('http')
                    ? fileName
                    : `${chain.baseUrl}/${fileName}`;
                console.log(`  Downloading: ${fileName.substring(0, 50)}...`);

                const xmlContent = await fetchUrl(fileUrl, { timeout: 120000 });
                const parsed = parsePriceXml(xmlContent, chainId, chain.name);
                products.push(...parsed);
                console.log(`  Got ${parsed.length} products`);

                if (products.length >= limit) break;
            } catch (fileError) {
                console.log(`  Skipping ${fileName}: ${fileError.message}`);
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
            const chain = CHAINS[chainId];

            if (!chain) {
                console.log(`Unknown chain: ${chainId}`);
                continue;
            }

            switch (chain.type) {
                case 'shufersal':
                    products = await fetchShufersal(5000);
                    break;
                case 'publishedprices':
                    products = await fetchPublishedPrices(chainId, 5000);
                    break;
                case 'laibcatalog':
                    products = await fetchLaibCatalog(chainId, 5000);
                    break;
                case 'mega':
                    // TODO: Mega has its own portal format
                    console.log(`  ${chain.name}: Mega portal not implemented yet`);
                    break;
                default:
                    console.log(`  Unknown chain type: ${chain.type}`);
            }

            console.log(`  ✓ ${chain.name}: ${products.length} products`);
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
