#!/usr/bin/env python3
"""
Israeli Supermarket Price Fetcher - All Chains

Uses il-supermarket-scraper to fetch real prices from all Israeli chains.
Outputs JSON to stdout for the Node.js updater to consume.

Usage:
    python scripts/fetch_all_chains.py [chain1] [chain2] ...
    python scripts/fetch_all_chains.py --list

Install dependencies:
    pip install il-supermarket-scraper pymongo python-dotenv
"""

import json
import sys
import os
import tempfile
import gzip
import xml.etree.ElementTree as ET
from datetime import datetime
from pathlib import Path

# Load environment variables
try:
    from dotenv import load_dotenv
    # Load from budget-manager directory
    env_path = Path(__file__).parent.parent / '.env'
    load_dotenv(env_path)
except ImportError:
    pass

# MongoDB connection
MONGODB_URI = os.environ.get('MONGODB_URI', 'mongodb://localhost:27017/budget-manager')

# Chain configuration
CHAINS = {
    'shufersal': {
        'name': 'שופרסל',
        'scraper': 'SHUFERSAL',
    },
    'rami_levy': {
        'name': 'רמי לוי',
        'scraper': 'RAMI_LEVY',
    },
    'victory': {
        'name': 'ויקטורי',
        'scraper': 'VICTORY',
    },
    'yeinot_bitan': {
        'name': 'יינות ביתן',
        'scraper': 'YAYNO_BITAN',
    },
    'mega': {
        'name': 'מגה',
        'scraper': 'MEGA',
    },
    'osher_ad': {
        'name': 'אושר עד',
        'scraper': 'OSHER_AD',
    },
    'hazi_hinam': {
        'name': 'חצי חינם',
        'scraper': 'HAZI_HINAM',
    },
    'tiv_taam': {
        'name': 'טיב טעם',
        'scraper': 'TIV_TAAM',
    },
    'yohananof': {
        'name': 'יוחננוף',
        'scraper': 'YOHANANOF',
    },
    'good_pharm': {
        'name': 'גוד פארם',
        'scraper': 'GOOD_PHARM',
    },
    'freshmarket': {
        'name': 'פרש מרקט',
        'scraper': 'FRESHMARKET',
    },
    'keshet': {
        'name': 'קשת טעמים',
        'scraper': 'KESHET',
    },
    'bareket': {
        'name': 'ברקת',
        'scraper': 'BAREKET',
    },
    'stop_market': {
        'name': 'סטופ מרקט',
        'scraper': 'STOP_MARKET',
    },
    'politzer': {
        'name': 'פוליצר',
        'scraper': 'POLITZER',
    },
    'zol_vbegadol': {
        'name': 'זול ובגדול',
        'scraper': 'ZOL_VBEGADOL',
    },
    'super_yuda': {
        'name': 'סופר יודא',
        'scraper': 'SUPER_YUDA',
    },
}

# Category keywords
CATEGORIES = {
    'מוצרי חלב': ['חלב', 'גבינה', 'יוגורט', 'שמנת', 'קוטג', 'לבן', 'מעדן', 'שוקו'],
    'לחם ומאפים': ['לחם', 'פיתה', 'לחמניה', 'חלה', 'באגט', 'טוסט', 'מאפה'],
    'ביצים': ['ביצים', 'ביצה'],
    'בשר ועוף': ['עוף', 'בקר', 'טלה', 'הודו', 'נקניק', 'שניצל', 'המבורגר', 'בשר'],
    'דגים': ['דג', 'סלמון', 'טונה', 'אמנון', 'פילה'],
    'פירות וירקות': ['תפוח', 'בננה', 'תפוז', 'לימון', 'עגבני', 'מלפפון', 'גזר', 'בצל'],
    'משקאות': ['מים', 'קולה', 'ספרייט', 'מיץ', 'סודה', 'בירה', 'יין', 'משקה'],
    'חטיפים': ['במבה', 'ביסלי', 'שוקולד', 'עוגיה', 'וופל', 'סוכריה', 'חטיף'],
    'ניקיון': ['סבון', 'שמפו', 'מרכך', 'אבקה', 'נוזל כלים', 'אקונומיקה'],
    'פסטה ואורז': ['פסטה', 'ספגטי', 'אטריות', 'אורז', 'קוסקוס'],
    'שימורים': ['שימורים', 'טונה', 'תירס', 'אפונה', 'חומוס'],
    'קפה ותה': ['קפה', 'נס', 'אספרסו', 'תה'],
}


def categorize(name):
    lower = (name or '').lower()
    for cat, keywords in CATEGORIES.items():
        for kw in keywords:
            if kw in lower:
                return cat
    return 'כללי'


def parse_xml_file(filepath, chain_id, chain_name):
    """Parse a price XML/GZ file and extract products."""
    products = []

    try:
        # Handle gzipped files
        if filepath.endswith('.gz'):
            with gzip.open(filepath, 'rt', encoding='utf-8', errors='replace') as f:
                content = f.read()
        else:
            with open(filepath, 'r', encoding='utf-8', errors='replace') as f:
                content = f.read()

        # Parse XML
        root = ET.fromstring(content)

        # Find items (different tags per chain)
        items = root.findall('.//Item') + root.findall('.//Product')

        for item in items:
            barcode = None
            name = None
            price = None
            manufacturer = ''

            # Try different tag names
            for tag in ['ItemCode', 'Barcode', 'barcode']:
                el = item.find(tag)
                if el is not None and el.text:
                    barcode = el.text.strip()
                    break

            for tag in ['ItemName', 'ItemNm', 'ProductName', 'name']:
                el = item.find(tag)
                if el is not None and el.text:
                    name = el.text.strip()
                    break

            for tag in ['ItemPrice', 'Price', 'price']:
                el = item.find(tag)
                if el is not None and el.text:
                    try:
                        price = float(el.text.strip().replace(',', '.'))
                    except ValueError:
                        pass
                    break

            for tag in ['ManufacturerName', 'Manufacturer']:
                el = item.find(tag)
                if el is not None and el.text:
                    manufacturer = el.text.strip()
                    break

            if barcode and name and price and price > 0:
                products.append({
                    'barcode': barcode,
                    'name': name,
                    'price': round(price, 2),
                    'chain': chain_id,
                    'chainName': chain_name,
                    'manufacturer': manufacturer,
                    'category': categorize(name),
                })

    except Exception as e:
        print(f"Error parsing {filepath}: {e}", file=sys.stderr)

    return products


def fetch_chain(chain_id, output_dir, limit=5000):
    """Fetch prices for a single chain using il-supermarket-scraper."""
    if chain_id not in CHAINS:
        print(f"Unknown chain: {chain_id}", file=sys.stderr)
        return []

    chain = CHAINS[chain_id]
    print(f"\n📦 Fetching {chain['name']}...", file=sys.stderr)

    try:
        from il_supermarket_scarper import ScarpingTask

        # Try different file types - some chains only have certain types
        file_types_to_try = [['Price'], ['PriceFull'], ['PriceFull', 'Price']]
        products = []

        for file_types in file_types_to_try:
            print(f"  Trying file types: {file_types}...", file=sys.stderr)

            # Create scraping task
            task = ScarpingTask(
                dump_folder_name=output_dir,
                enabled_scrapers=[chain['scraper']],
                files_types=file_types,
                limit=10,  # Limit files to download
            )

            # Run scraper
            print(f"  Downloading price files...", file=sys.stderr)
            task.start()

            # Parse downloaded files
            for root, dirs, files in os.walk(output_dir):
                for filename in files:
                    if 'price' in filename.lower() and (filename.endswith('.xml') or filename.endswith('.gz')):
                        filepath = os.path.join(root, filename)
                        parsed = parse_xml_file(filepath, chain_id, chain['name'])
                        products.extend(parsed)
                        print(f"  Parsed {len(parsed)} products from {filename}", file=sys.stderr)

                        if len(products) >= limit:
                            break
                if len(products) >= limit:
                    break

            # If we got products, stop trying other file types
            if products:
                break

        print(f"  ✓ {chain['name']}: {len(products[:limit])} products", file=sys.stderr)
        return products[:limit]

    except ImportError:
        print("  ✗ il-supermarket-scraper not installed. Run: pip install il-supermarket-scraper", file=sys.stderr)
        return []
    except Exception as e:
        print(f"  ✗ {chain['name']} error: {e}", file=sys.stderr)
        return []


def main():
    args = sys.argv[1:]

    # List available chains
    if '--list' in args:
        print(json.dumps({
            'chains': [
                {'id': k, 'name': v['name']}
                for k, v in CHAINS.items()
            ]
        }))
        return

    # Determine which chains to fetch
    if args:
        selected = [a for a in args if a in CHAINS]
    else:
        # Default to major chains
        selected = ['shufersal', 'rami_levy', 'victory', 'yeinot_bitan', 'osher_ad']

    if not selected:
        print("No valid chains specified", file=sys.stderr)
        print(f"Available: {', '.join(CHAINS.keys())}", file=sys.stderr)
        sys.exit(1)

    print(f"🇮🇱 Fetching prices from: {', '.join(selected)}", file=sys.stderr)

    # Create temp directory for downloads
    output_dir = tempfile.mkdtemp(prefix='supermarket_prices_')

    all_products = []
    chains_summary = {}

    for chain_id in selected:
        chain_dir = os.path.join(output_dir, chain_id)
        os.makedirs(chain_dir, exist_ok=True)

        products = fetch_chain(chain_id, chain_dir, limit=5000)
        all_products.extend(products)
        chains_summary[chain_id] = len(products)

    # Merge products by barcode
    merged = {}
    for p in all_products:
        barcode = p['barcode']
        if barcode not in merged:
            merged[barcode] = {
                'barcode': barcode,
                'name': p['name'],
                'manufacturer': p.get('manufacturer', ''),
                'category': p.get('category', 'כללי'),
                'prices': []
            }

        # Add price if not already present for this chain
        if not any(pr['chain'] == p['chain'] for pr in merged[barcode]['prices']):
            merged[barcode]['prices'].append({
                'chain': p['chain'],
                'chainName': p['chainName'],
                'price': p['price']
            })

    # Check if we should update MongoDB
    if '--update-db' in sys.argv:
        update_mongodb(list(merged.values()))
    else:
        # Output JSON
        result = {
            'success': True,
            'totalProducts': len(merged),
            'chainsSummary': chains_summary,
            'products': list(merged.values()),
            'fetchedAt': datetime.utcnow().isoformat()
        }
        print(json.dumps(result, ensure_ascii=False))

    # Cleanup
    import shutil
    try:
        shutil.rmtree(output_dir)
    except:
        pass

    print(f"\n✅ Total: {len(merged)} unique products", file=sys.stderr)


def update_mongodb(products):
    """Update MongoDB with scraped products."""
    try:
        from pymongo import MongoClient
    except ImportError:
        print("  ✗ pymongo not installed. Run: pip install pymongo", file=sys.stderr)
        return

    print(f"\n💾 Connecting to MongoDB...", file=sys.stderr)

    try:
        client = MongoClient(MONGODB_URI)
        db = client.get_database()
        collection = db['products']

        print(f"💾 Updating {len(products)} products...", file=sys.stderr)

        stats = {'inserted': 0, 'updated': 0, 'errors': 0}
        now = datetime.utcnow()

        for product in products:
            try:
                barcode = product['barcode']

                # Find cheapest price
                prices = product.get('prices', [])
                if prices:
                    cheapest = min(prices, key=lambda p: p['price'])
                else:
                    cheapest = {'price': 0, 'chainName': ''}

                # Generate OpenFoodFacts image URL
                image = None
                if len(barcode) >= 12:
                    image = f"https://images.openfoodfacts.org/images/products/{barcode[:3]}/{barcode[3:6]}/{barcode[6:9]}/{barcode[9:]}/front_he.400.jpg"

                result = collection.update_one(
                    {'barcode': barcode},
                    {
                        '$set': {
                            'name': product['name'],
                            'manufacturer': product.get('manufacturer', ''),
                            'category': product.get('category', 'כללי'),
                            'image': image,
                            'prices': [
                                {**p, 'lastUpdated': now}
                                for p in prices
                            ],
                            'cheapestPrice': cheapest['price'],
                            'cheapestChain': cheapest['chainName'],
                            'lastUpdated': now,
                            'dataSource': 'python-scraper'
                        }
                    },
                    upsert=True
                )

                if result.upserted_id:
                    stats['inserted'] += 1
                elif result.modified_count > 0:
                    stats['updated'] += 1
            except Exception as e:
                stats['errors'] += 1

        # Update sync status
        db['settings'].update_one(
            {'_id': 'sync-status'},
            {
                '$set': {
                    'lastSync': now,
                    'type': 'python-scraper',
                    'totalProducts': len(products),
                    'storeStats': stats
                }
            },
            upsert=True
        )

        client.close()

        print('\n✅ Update complete!', file=sys.stderr)
        print(f'   Inserted: {stats["inserted"]}', file=sys.stderr)
        print(f'   Updated: {stats["updated"]}', file=sys.stderr)
        print(f'   Errors: {stats["errors"]}', file=sys.stderr)
    except Exception as e:
        print(f"  ✗ MongoDB error: {e}", file=sys.stderr)


if __name__ == '__main__':
    main()
