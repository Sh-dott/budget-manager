/**
 * Unified Chain Fetcher for Israeli Supermarket Prices
 *
 * Consolidates price fetching logic for all 9 chains into a reusable module.
 * Ported from local_price_updater.js for use in server.js.
 *
 * Three fetcher types:
 *   - publishedprices: login session + JSON file listing API
 *   - shufersal: Azure blob listing from prices.shufersal.co.il
 *   - laibcatalog: directory listing from laibcatalog.co.il (Victory)
 */

const https = require('https');
const http = require('http');
const zlib = require('zlib');
const { XMLParser } = require('fast-xml-parser');

// Disable SSL verification for Israeli price portals (self-signed certs)
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

// ========================================
// Chain Registry
// ========================================
const CHAINS = {
    shufersal: {
        name: '\u05E9\u05D5\u05E4\u05E8\u05E1\u05DC',
        baseUrl: 'http://prices.shufersal.co.il',
        fileListPath: '/FileObject/UpdateCategory?catID=2&storeId=0&sort=Time&sortdir=DESC',
        type: 'shufersal'
    },
    rami_levy: {
        name: '\u05E8\u05DE\u05D9 \u05DC\u05D5\u05D9',
        baseUrl: 'https://url.publishedprices.co.il',
        username: 'RamiLevi',
        type: 'publishedprices'
    },
    victory: {
        name: '\u05D5\u05D9\u05E7\u05D8\u05D5\u05E8\u05D9',
        baseUrl: 'https://laibcatalog.co.il',
        type: 'laibcatalog'
    },
    yeinot_bitan: {
        name: '\u05D9\u05D9\u05E0\u05D5\u05EA \u05D1\u05D9\u05EA\u05DF',
        baseUrl: 'https://url.publishedprices.co.il',
        username: 'yabormarket',
        type: 'publishedprices'
    },
    osher_ad: {
        name: '\u05D0\u05D5\u05E9\u05E8 \u05E2\u05D3',
        baseUrl: 'https://url.publishedprices.co.il',
        username: 'osherad',
        type: 'publishedprices'
    },
    hazi_hinam: {
        name: '\u05D7\u05E6\u05D9 \u05D7\u05D9\u05E0\u05DD',
        baseUrl: 'https://url.publishedprices.co.il',
        username: 'HaijHnam',
        type: 'publishedprices'
    },
    mega: {
        name: '\u05DE\u05D2\u05D4',
        baseUrl: 'https://publishprice.mega.co.il',
        type: 'mega'
    },
    tiv_taam: {
        name: '\u05D8\u05D9\u05D1 \u05D8\u05E2\u05DD',
        baseUrl: 'https://url.publishedprices.co.il',
        username: 'TivTaam',
        type: 'publishedprices'
    },
    yohananof: {
        name: '\u05D9\u05D5\u05D7\u05E0\u05E0\u05D5\u05E3',
        baseUrl: 'https://url.publishedprices.co.il',
        username: 'yohananof',
        type: 'publishedprices'
    }
};

// ========================================
// Category Detection
// ========================================
const CATEGORY_KEYWORDS = {
    '\u05DE\u05D5\u05E6\u05E8\u05D9 \u05D7\u05DC\u05D1': ['\u05D7\u05DC\u05D1', '\u05D2\u05D1\u05D9\u05E0\u05D4', '\u05D9\u05D5\u05D2\u05D5\u05E8\u05D8', '\u05E9\u05DE\u05E0\u05EA', '\u05E7\u05D5\u05D8\u05D2', '\u05DC\u05D1\u05DF', '\u05DE\u05E2\u05D3\u05DF', '\u05E9\u05D5\u05E7\u05D5'],
    '\u05DC\u05D7\u05DD \u05D5\u05DE\u05D0\u05E4\u05D9\u05DD': ['\u05DC\u05D7\u05DD', '\u05E4\u05D9\u05EA\u05D4', '\u05DC\u05D7\u05DE\u05E0\u05D9\u05D4', '\u05D7\u05DC\u05D4', '\u05D1\u05D0\u05D2\u05D8', '\u05D8\u05D5\u05E1\u05D8', '\u05DE\u05D0\u05E4\u05D4', '\u05E2\u05D5\u05D2\u05D4'],
    '\u05D1\u05D9\u05E6\u05D9\u05DD': ['\u05D1\u05D9\u05E6\u05D9\u05DD', '\u05D1\u05D9\u05E6\u05D4'],
    '\u05D1\u05E9\u05E8 \u05D5\u05E2\u05D5\u05E3': ['\u05E2\u05D5\u05E3', '\u05D1\u05E7\u05E8', '\u05D8\u05DC\u05D4', '\u05D4\u05D5\u05D3\u05D5', '\u05E0\u05E7\u05E0\u05D9\u05E7', '\u05E9\u05E0\u05D9\u05E6\u05DC', '\u05D4\u05DE\u05D1\u05D5\u05E8\u05D2\u05E8', '\u05DB\u05E8\u05E2\u05D9\u05D9\u05DD', '\u05D7\u05D6\u05D4', '\u05D1\u05E9\u05E8'],
    '\u05D3\u05D2\u05D9\u05DD': ['\u05D3\u05D2', '\u05E1\u05DC\u05DE\u05D5\u05DF', '\u05D8\u05D5\u05E0\u05D4', '\u05D0\u05DE\u05E0\u05D5\u05DF', '\u05E4\u05D9\u05DC\u05D4'],
    '\u05E4\u05D9\u05E8\u05D5\u05EA \u05D5\u05D9\u05E8\u05E7\u05D5\u05EA': ['\u05EA\u05E4\u05D5\u05D7', '\u05D1\u05E0\u05E0\u05D4', '\u05EA\u05E4\u05D5\u05D6', '\u05DC\u05D9\u05DE\u05D5\u05DF', '\u05E2\u05D2\u05D1\u05E0\u05D9', '\u05DE\u05DC\u05E4\u05E4\u05D5\u05DF', '\u05D2\u05D6\u05E8', '\u05D1\u05E6\u05DC', '\u05D0\u05D1\u05D5\u05E7\u05D3\u05D5'],
    '\u05DE\u05E9\u05E7\u05D0\u05D5\u05EA': ['\u05DE\u05D9\u05DD', '\u05E7\u05D5\u05DC\u05D4', '\u05E1\u05E4\u05E8\u05D9\u05D9\u05D8', '\u05DE\u05D9\u05E5', '\u05E1\u05D5\u05D3\u05D4', '\u05D1\u05D9\u05E8\u05D4', '\u05D9\u05D9\u05DF', '\u05DE\u05E9\u05E7\u05D4'],
    '\u05D7\u05D8\u05D9\u05E4\u05D9\u05DD': ['\u05D1\u05DE\u05D1\u05D4', '\u05D1\u05D9\u05E1\u05DC\u05D9', '\u05E9\u05D5\u05E7\u05D5\u05DC\u05D3', '\u05E2\u05D5\u05D2\u05D9\u05D4', '\u05D5\u05D5\u05E4\u05DC', '\u05E1\u05D5\u05DB\u05E8\u05D9\u05D4', '\u05D2\u05DC\u05D9\u05D3\u05D4', '\u05D7\u05D8\u05D9\u05E3'],
    '\u05E0\u05D9\u05E7\u05D9\u05D5\u05DF': ['\u05E1\u05D1\u05D5\u05DF', '\u05E9\u05DE\u05E4\u05D5', '\u05DE\u05E8\u05DB\u05DA', '\u05D0\u05D1\u05E7\u05D4', '\u05E0\u05D5\u05D6\u05DC \u05DB\u05DC\u05D9\u05DD', '\u05D0\u05E7\u05D5\u05E0\u05D5\u05DE\u05D9\u05E7\u05D4', '\u05DE\u05D8\u05DC\u05D9\u05D5\u05EA'],
    '\u05E4\u05E1\u05D8\u05D4 \u05D5\u05D0\u05D5\u05E8\u05D6': ['\u05E4\u05E1\u05D8\u05D4', '\u05E1\u05E4\u05D2\u05D8\u05D9', '\u05D0\u05D8\u05E8\u05D9\u05D5\u05EA', '\u05D0\u05D5\u05E8\u05D6', '\u05E7\u05D5\u05E1\u05E7\u05D5\u05E1', '\u05E4\u05EA\u05D9\u05EA\u05D9\u05DD'],
    '\u05E9\u05D9\u05DE\u05D5\u05E8\u05D9\u05DD': ['\u05E9\u05D9\u05DE\u05D5\u05E8\u05D9\u05DD', '\u05D8\u05D5\u05E0\u05D4', '\u05EA\u05D9\u05E8\u05E1', '\u05D0\u05E4\u05D5\u05E0\u05D4', '\u05D7\u05D5\u05DE\u05D5\u05E1', '\u05E9\u05E2\u05D5\u05E2\u05D9\u05EA'],
    '\u05E7\u05E4\u05D4 \u05D5\u05EA\u05D4': ['\u05E7\u05E4\u05D4', '\u05E0\u05E1', '\u05D0\u05E1\u05E4\u05E8\u05E1\u05D5', '\u05EA\u05D4', '\u05E7\u05E4\u05E1\u05D5\u05DC\u05D5\u05EA'],
    '\u05EA\u05D9\u05E0\u05D5\u05E7\u05D5\u05EA': ['\u05D7\u05D9\u05EA\u05D5\u05DC\u05D9\u05DD', '\u05DE\u05D8\u05E8\u05E0\u05D4', '\u05E1\u05D9\u05DE\u05D9\u05DC\u05D0\u05E7', '\u05DE\u05D2\u05D1\u05D5\u05E0\u05D9\u05DD', '\u05EA\u05D9\u05E0\u05D5\u05E7'],
};

function categorize(name) {
    const lower = (name || '').toLowerCase();
    for (const [cat, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
        for (const kw of keywords) {
            if (lower.includes(kw)) return cat;
        }
    }
    return '\u05DB\u05DC\u05DC\u05D9';
}

// ========================================
// HTTP Helpers
// ========================================
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

        if (options.cookie) {
            reqOptions.headers['Cookie'] = options.cookie;
        }

        const req = protocol.request(reqOptions, (res) => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                let redirectUrl = res.headers.location;
                if (redirectUrl.startsWith('/')) {
                    redirectUrl = `${urlObj.protocol}//${urlObj.host}${redirectUrl}`;
                }
                return fetchUrl(redirectUrl, options).then(resolve).catch(reject);
            }

            if (res.statusCode !== 200) {
                return reject(new Error(`HTTP ${res.statusCode}`));
            }

            const chunks = [];
            res.on('data', chunk => chunks.push(chunk));
            res.on('end', () => {
                const buffer = Buffer.concat(chunks);
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

function fetchWithSession(url, cookie, maxRedirects = 5) {
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
            let newCookie = cookie;
            if (res.headers['set-cookie']) {
                const newCookies = res.headers['set-cookie'].map(c => c.split(';')[0]).join('; ');
                newCookie = newCookies || cookie;
            }

            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                if (maxRedirects <= 0) {
                    return reject(new Error('Too many redirects'));
                }
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

// ========================================
// XML Parser
// ========================================
function parseXml(xmlContent, chainId, chainName) {
    const parser = new XMLParser({
        ignoreAttributes: false,
        attributeNamePrefix: '@_',
    });

    const products = [];

    try {
        const result = parser.parse(xmlContent);

        let items = [];
        const paths = [
            result?.root?.Items?.Item,
            result?.Prices?.Products?.Product,
            result?.Items?.Item,
            result?.Root?.Items?.Item,
            result?.PriceFull?.Items?.Item,
            result?.Prices?.Item,
        ];

        for (const p of paths) {
            if (p) {
                items = Array.isArray(p) ? p : [p];
                break;
            }
        }

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
        console.error(`  XML parse error for ${chainId}: ${error.message}`);
    }

    return products;
}

// ========================================
// Login to publishedprices.co.il
// ========================================
function loginToPublishedPrices(username) {
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
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => {
                if (cookies && cookies.length > 0) {
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

// ========================================
// Fetcher: publishedprices type
// ========================================
async function fetchPublishedPrices(chainId, limit = 10000) {
    const chain = CHAINS[chainId];
    if (!chain || chain.type !== 'publishedprices') return [];

    console.log(`  [chain_fetcher] Fetching ${chain.name} (publishedprices)...`);
    const products = [];

    try {
        console.log(`  Logging in as ${chain.username}...`);
        const cookie = await loginToPublishedPrices(chain.username);

        if (!cookie) {
            console.log(`  Could not get session for ${chain.name}`);
            return [];
        }
        console.log(`  Got session cookie for ${chain.name}`);

        // Get file listing using JSON API
        const apiUrl = 'https://url.publishedprices.co.il/file/json/dir?iDisplayLength=100&sSearch=PriceFull';

        try {
            const apiResponse = await fetchWithSession(apiUrl, cookie);
            const apiData = JSON.parse(apiResponse);

            if (apiData.aaData && apiData.aaData.length > 0) {
                console.log(`  Found ${apiData.aaData.length} files via API for ${chain.name}`);

                for (const fileEntry of apiData.aaData.slice(0, 3)) {
                    if (products.length >= limit) break;

                    try {
                        const fileNameMatch = fileEntry[0].match(/href="([^"]+)"/);
                        if (!fileNameMatch) continue;

                        const fileName = fileNameMatch[1];
                        const fileUrl = `https://url.publishedprices.co.il${fileName}`;

                        console.log(`  Downloading: ${fileName.substring(0, 50)}...`);
                        const xmlContent = await fetchWithSession(fileUrl, cookie);
                        const parsed = parseXml(xmlContent, chainId, chain.name);
                        products.push(...parsed);
                        console.log(`  Got ${parsed.length} products from file`);

                        if (products.length >= limit) break;
                    } catch (fileError) {
                        console.log(`  Skipping file: ${fileError.message}`);
                    }
                }
            }
        } catch (apiError) {
            console.log(`  API method failed for ${chain.name}: ${apiError.message}`);

            // Fallback: direct file listing
            const indexUrl = `${chain.baseUrl}/file/d/${chain.username}/`;
            const indexHtml = await fetchWithSession(indexUrl, cookie);

            const fileMatches = [];
            const linkRegex = /href="([^"]*(?:PriceFull|Price7)[^"]*\.(?:xml|gz|XML|GZ))"/gi;
            let match;
            while ((match = linkRegex.exec(indexHtml)) !== null) {
                fileMatches.push(match[1]);
            }

            console.log(`  Found ${fileMatches.length} price files (fallback) for ${chain.name}`);

            for (const fileName of fileMatches.slice(0, 3)) {
                if (products.length >= limit) break;

                try {
                    const fileUrl = `${chain.baseUrl}/file/d/${chain.username}/${fileName}`;
                    const xmlContent = await fetchWithSession(fileUrl, cookie);
                    const parsed = parseXml(xmlContent, chainId, chain.name);
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

// ========================================
// Fetcher: shufersal type
// ========================================
async function fetchShufersal(limit = 10000) {
    const chain = CHAINS.shufersal;
    console.log(`  [chain_fetcher] Fetching ${chain.name} (shufersal)...`);

    const products = [];

    try {
        const listUrl = `${chain.baseUrl}${chain.fileListPath}`;
        const listHtml = await fetchUrl(listUrl);

        // Extract Azure blob storage URLs
        const fileMatches = listHtml.match(/href="(https:\/\/[^"]*blob\.core\.windows\.net[^"]*(?:PriceFull|pricefull)[^"]*)"/gi) || [];
        console.log(`  Found ${fileMatches.length} price files for Shufersal`);

        for (const match of fileMatches.slice(0, 5)) {
            if (products.length >= limit) break;

            try {
                let fileUrl = match.replace(/href="/i, '').replace(/"$/, '');
                fileUrl = fileUrl.replace(/&amp;/g, '&');

                const xmlContent = await fetchUrl(fileUrl, { timeout: 120000 });
                const parsed = parseXml(xmlContent, 'shufersal', chain.name);
                products.push(...parsed);

                console.log(`  Total Shufersal products so far: ${products.length}`);
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

// ========================================
// Fetcher: laibcatalog type (Victory)
// ========================================
async function fetchLaibCatalog(chainId, limit = 10000) {
    const chain = CHAINS[chainId];
    if (!chain || chain.type !== 'laibcatalog') return [];

    console.log(`  [chain_fetcher] Fetching ${chain.name} (laibcatalog)...`);
    const products = [];

    try {
        const indexUrl = `${chain.baseUrl}/`;
        const indexHtml = await fetchUrl(indexUrl, { timeout: 60000 });

        const fileMatches = [];
        const linkRegex = /href="([^"]*(?:PriceFull|Price7)[^"]*\.(?:xml|gz|XML|GZ))"/gi;
        let match;
        while ((match = linkRegex.exec(indexHtml)) !== null) {
            fileMatches.push(match[1]);
        }

        // Also check subdirectories
        const dirLinkRegex = /href="([^"]+\/)"/gi;
        const directories = [];
        while ((match = dirLinkRegex.exec(indexHtml)) !== null) {
            if (!match[1].startsWith('..') && !match[1].startsWith('/')) {
                directories.push(match[1]);
            }
        }

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

        console.log(`  Found ${fileMatches.length} price files for ${chain.name}`);

        for (const fileName of fileMatches.slice(0, 3)) {
            if (products.length >= limit) break;

            try {
                const fileUrl = fileName.startsWith('http')
                    ? fileName
                    : `${chain.baseUrl}/${fileName}`;
                const xmlContent = await fetchUrl(fileUrl, { timeout: 120000 });
                const parsed = parseXml(xmlContent, chainId, chain.name);
                products.push(...parsed);
                console.log(`  Got ${parsed.length} products from ${fileName.substring(0, 40)}`);

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

// ========================================
// Public API
// ========================================

/**
 * Fetch products from a single chain.
 * @param {string} chainId - Chain identifier (e.g. 'shufersal', 'rami_levy')
 * @param {number} [limit=10000] - Max products to return
 * @returns {{ success: boolean, chain: string, chainName: string, products: Array, error?: string }}
 */
async function fetchChain(chainId, limit = 10000) {
    const chain = CHAINS[chainId];
    if (!chain) {
        return { success: false, chain: chainId, chainName: '', products: [], error: `Unknown chain: ${chainId}` };
    }

    try {
        let products = [];

        switch (chain.type) {
            case 'shufersal':
                products = await fetchShufersal(limit);
                break;
            case 'publishedprices':
                products = await fetchPublishedPrices(chainId, limit);
                break;
            case 'laibcatalog':
                products = await fetchLaibCatalog(chainId, limit);
                break;
            case 'mega':
                // Mega portal format undocumented, skip for now
                console.log(`  ${chain.name}: Mega portal not implemented yet`);
                return { success: false, chain: chainId, chainName: chain.name, products: [], error: 'Mega portal not implemented' };
            default:
                return { success: false, chain: chainId, chainName: chain.name, products: [], error: `Unknown chain type: ${chain.type}` };
        }

        console.log(`  [chain_fetcher] ${chain.name}: ${products.length} products fetched`);
        return { success: true, chain: chainId, chainName: chain.name, products };
    } catch (error) {
        console.error(`  [chain_fetcher] ${chain.name} failed: ${error.message}`);
        return { success: false, chain: chainId, chainName: chain.name, products: [], error: error.message };
    }
}

/**
 * Fetch products from multiple chains sequentially.
 * @param {string[]} [chainIds] - Chain IDs to fetch (defaults to all except mega)
 * @param {number} [limit=10000] - Max products per chain
 * @returns {Object<string, { success: boolean, chain: string, chainName: string, products: Array, error?: string }>}
 */
async function fetchAllChains(chainIds, limit = 10000) {
    if (!chainIds) {
        // Default: all chains except mega (unimplemented)
        chainIds = Object.keys(CHAINS).filter(id => id !== 'mega');
    }

    const results = {};

    for (const chainId of chainIds) {
        results[chainId] = await fetchChain(chainId, limit);

        // 5-second delay between chains to avoid rate limiting
        if (chainIds.indexOf(chainId) < chainIds.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 5000));
        }
    }

    return results;
}

module.exports = {
    CHAINS,
    fetchChain,
    fetchAllChains,
    categorize
};
