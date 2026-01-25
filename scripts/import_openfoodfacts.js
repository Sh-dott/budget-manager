/**
 * Open Food Facts Israeli Products Importer
 *
 * Fetches real Israeli food products from Open Food Facts API
 * No authentication required!
 */

const https = require('https');

// Israeli product categories to search
const SEARCH_QUERIES = [
    'חלב',      // milk
    'לחם',      // bread
    'גבינה',    // cheese
    'יוגורט',   // yogurt
    'ביצים',    // eggs
    'עוף',      // chicken
    'מיץ',      // juice
    'שוקולד',   // chocolate
    'במבה',     // bamba
    'ביסלי',    // bisli
    'קפה',      // coffee
    'תה',       // tea
    'אורז',     // rice
    'פסטה',     // pasta
    'שמן',      // oil
    'קמח',      // flour
    'סוכר',     // sugar
    'מלח',      // salt
    'חומוס',    // hummus
    'טחינה',    // tahini
];

// Israeli supermarket chains for price estimation
const CHAINS = [
    { id: 'rami_levy', name: 'רמי לוי', priceMultiplier: 0.95 },
    { id: 'shufersal', name: 'שופרסל', priceMultiplier: 1.05 },
    { id: 'victory', name: 'ויקטורי', priceMultiplier: 1.0 },
];

// Category mapping
const CATEGORY_MAP = {
    'en:milks': 'מוצרי חלב',
    'en:cheeses': 'מוצרי חלב',
    'en:yogurts': 'מוצרי חלב',
    'en:breads': 'לחם ומאפים',
    'en:eggs': 'ביצים',
    'en:meats': 'בשר ועוף',
    'en:beverages': 'משקאות',
    'en:snacks': 'חטיפים',
    'en:chocolates': 'חטיפים',
    'en:cereals': 'דגנים',
    'en:pastas': 'פסטה ואורז',
    'en:rices': 'פסטה ואורז',
    'en:canned-foods': 'שימורים',
    'en:coffees': 'קפה ותה',
    'en:teas': 'קפה ותה',
};

function getCategory(product) {
    const categories = product.categories_tags || [];
    for (const cat of categories) {
        if (CATEGORY_MAP[cat]) return CATEGORY_MAP[cat];
    }
    return 'כללי';
}

function fetchJson(url) {
    return new Promise((resolve, reject) => {
        https.get(url, { headers: { 'User-Agent': 'BudgetManager/1.0' } }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    resolve(JSON.parse(data));
                } catch (e) {
                    reject(e);
                }
            });
        }).on('error', reject);
    });
}

/**
 * Search Open Food Facts for Israeli products
 */
async function searchProducts(query, page = 1) {
    const url = `https://world.openfoodfacts.org/cgi/search.pl?search_terms=${encodeURIComponent(query)}&search_simple=1&action=process&json=1&page=${page}&page_size=100&countries_tags_en=israel`;

    console.log(`[OFF] Searching: ${query} (page ${page})`);

    try {
        const data = await fetchJson(url);
        return data.products || [];
    } catch (e) {
        console.error(`[OFF] Search error for "${query}":`, e.message);
        return [];
    }
}

/**
 * Get Israeli products by barcode prefix (729 = Israel)
 */
async function getIsraeliProducts(page = 1) {
    const url = `https://world.openfoodfacts.org/cgi/search.pl?search_terms=729&search_simple=1&action=process&json=1&page=${page}&page_size=100`;

    try {
        const data = await fetchJson(url);
        // Filter to only Israeli barcodes (729)
        return (data.products || []).filter(p =>
            p.code && p.code.startsWith('729')
        );
    } catch (e) {
        console.error('[OFF] Error fetching Israeli products:', e.message);
        return [];
    }
}

/**
 * Estimate prices for a product based on typical Israeli prices
 */
function estimatePrices(product) {
    // Base price estimation based on category and quantity
    let basePrice = 10; // Default

    const name = (product.product_name || '').toLowerCase();
    const quantity = parseFloat(product.quantity) || 1;

    // Price estimation logic
    if (name.includes('חלב') || name.includes('milk')) {
        basePrice = quantity > 500 ? 7 : 4;
    } else if (name.includes('גבינה') || name.includes('cheese')) {
        basePrice = 15;
    } else if (name.includes('יוגורט') || name.includes('yogurt')) {
        basePrice = 5;
    } else if (name.includes('לחם') || name.includes('bread')) {
        basePrice = 8;
    } else if (name.includes('ביצים') || name.includes('egg')) {
        basePrice = 25;
    } else if (name.includes('עוף') || name.includes('chicken')) {
        basePrice = 35;
    } else if (name.includes('במבה') || name.includes('bamba')) {
        basePrice = 7;
    } else if (name.includes('ביסלי') || name.includes('bisli')) {
        basePrice = 7;
    } else if (name.includes('שוקולד') || name.includes('chocolate')) {
        basePrice = 10;
    } else if (name.includes('מיץ') || name.includes('juice')) {
        basePrice = 12;
    } else if (name.includes('קפה') || name.includes('coffee')) {
        basePrice = 25;
    }

    // Generate prices for each chain with some variance
    return CHAINS.map(chain => ({
        chain: chain.id,
        chainName: chain.name,
        price: Math.round(basePrice * chain.priceMultiplier * (0.9 + Math.random() * 0.2) * 100) / 100
    }));
}

/**
 * Main import function
 */
async function importFromOpenFoodFacts(options = {}) {
    const { limit = 500 } = options;
    const allProducts = new Map();

    console.log('[OFF] Starting Open Food Facts import...');

    // Search for products by Hebrew terms
    for (const query of SEARCH_QUERIES) {
        if (allProducts.size >= limit) break;

        const products = await searchProducts(query);

        for (const p of products) {
            if (allProducts.size >= limit) break;
            if (!p.code || !p.product_name) continue;
            if (allProducts.has(p.code)) continue;

            // Get Hebrew name if available
            const name = p.product_name_he || p.product_name || '';
            if (!name) continue;

            allProducts.set(p.code, {
                barcode: p.code,
                name: name,
                manufacturer: p.brands || '',
                category: getCategory(p),
                image: p.image_front_url || p.image_url || null,
                prices: estimatePrices(p),
            });
        }

        console.log(`[OFF] After "${query}": ${allProducts.size} products`);

        // Small delay to be nice to the API
        await new Promise(r => setTimeout(r, 200));
    }

    // Also fetch general Israeli products
    for (let page = 1; page <= 3 && allProducts.size < limit; page++) {
        const products = await getIsraeliProducts(page);

        for (const p of products) {
            if (allProducts.size >= limit) break;
            if (!p.code || !p.product_name) continue;
            if (allProducts.has(p.code)) continue;

            const name = p.product_name_he || p.product_name || '';
            if (!name) continue;

            allProducts.set(p.code, {
                barcode: p.code,
                name: name,
                manufacturer: p.brands || '',
                category: getCategory(p),
                image: p.image_front_url || p.image_url || null,
                prices: estimatePrices(p),
            });
        }

        console.log(`[OFF] Israeli products page ${page}: ${allProducts.size} total`);
        await new Promise(r => setTimeout(r, 200));
    }

    const productList = Array.from(allProducts.values());

    // Count by chain
    const chainsSummary = {};
    for (const chain of CHAINS) {
        chainsSummary[chain.id] = productList.length;
    }

    return {
        success: true,
        totalProducts: productList.length,
        chainsSummary,
        products: productList,
        importedAt: new Date().toISOString(),
        source: 'openfoodfacts'
    };
}

module.exports = { importFromOpenFoodFacts };

// CLI usage
if (require.main === module) {
    importFromOpenFoodFacts({ limit: 200 })
        .then(result => {
            console.log(`\nImported ${result.totalProducts} products`);
            console.log('Sample:', result.products.slice(0, 3));
        })
        .catch(console.error);
}
