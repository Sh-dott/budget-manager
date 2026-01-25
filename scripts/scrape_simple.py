#!/usr/bin/env python3
"""
Simple scraper using il-supermarket-scraper library.
Downloads files and parses them to update MongoDB.
"""

import os
import sys
import gzip
import tempfile
import xml.etree.ElementTree as ET
from datetime import datetime
from pathlib import Path

# Load environment
try:
    from dotenv import load_dotenv
    env_path = Path(__file__).parent.parent / '.env'
    load_dotenv(env_path)
except ImportError:
    pass

MONGODB_URI = os.environ.get('MONGODB_URI', 'mongodb://localhost:27017/budget-manager')

# Category keywords for Hebrew products
CATEGORIES = {
    'מוצרי חלב': ['חלב', 'גבינה', 'יוגורט', 'שמנת', 'קוטג', 'לבן'],
    'לחם ומאפים': ['לחם', 'פיתה', 'לחמניה', 'חלה', 'באגט'],
    'בשר ועוף': ['עוף', 'בקר', 'הודו', 'שניצל', 'בשר'],
    'משקאות': ['מים', 'קולה', 'מיץ', 'בירה', 'יין'],
    'חטיפים': ['במבה', 'ביסלי', 'שוקולד', 'חטיף'],
}


def categorize(name):
    lower = (name or '').lower()
    for cat, keywords in CATEGORIES.items():
        for kw in keywords:
            if kw in lower:
                return cat
    return 'כללי'


def parse_xml(filepath, chain_id, chain_name):
    """Parse XML price file."""
    products = []
    try:
        # Handle gzipped files
        if filepath.endswith('.gz'):
            with gzip.open(filepath, 'rt', encoding='utf-8', errors='replace') as f:
                content = f.read()
        else:
            with open(filepath, 'r', encoding='utf-8', errors='replace') as f:
                content = f.read()

        root = ET.fromstring(content)
        items = root.findall('.//Item') + root.findall('.//Product')

        for item in items:
            barcode = None
            name = None
            price = None

            for tag in ['ItemCode', 'Barcode', 'barcode']:
                el = item.find(tag)
                if el is not None and el.text:
                    barcode = el.text.strip()
                    break

            for tag in ['ItemName', 'ItemNm', 'ProductName']:
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

            if barcode and name and price and price > 0:
                products.append({
                    'barcode': barcode,
                    'name': name,
                    'price': round(price, 2),
                    'chain': chain_id,
                    'chainName': chain_name,
                    'category': categorize(name),
                })

    except Exception as e:
        print(f"  Error parsing {filepath}: {e}", file=sys.stderr)

    return products


def scrape_chain(chain_name, scraper_id, output_dir):
    """Scrape a single chain."""
    print(f"\n📦 Fetching {chain_name}...", file=sys.stderr)

    try:
        from il_supermarket_scarper import ScarpingTask
        from il_supermarket_scarper.utils import FileTypesFilters

        # Create output directory
        chain_dir = os.path.join(output_dir, scraper_id.lower())
        os.makedirs(chain_dir, exist_ok=True)

        # Try scraping with price files only
        print(f"  Starting scraper for {scraper_id}...", file=sys.stderr)

        # Use only price file types (not promos)
        task = ScarpingTask(
            dump_folder_name=chain_dir,
            enabled_scrapers=[scraper_id],
            files_types=['PRICE_FILE', 'PRICE_FULL_FILE'],
            limit=10
        )
        task.start()

        # Find and parse downloaded files
        products = []
        for root, dirs, files in os.walk(chain_dir):
            for filename in files:
                if filename.endswith(('.xml', '.gz', '.XML', '.GZ')):
                    filepath = os.path.join(root, filename)
                    print(f"  Found: {filename}", file=sys.stderr)
                    parsed = parse_xml(filepath, scraper_id.lower(), chain_name)
                    products.extend(parsed)
                    print(f"    -> {len(parsed)} products", file=sys.stderr)

                    if len(products) >= 5000:
                        break

        print(f"  ✓ {chain_name}: {len(products)} products", file=sys.stderr)
        return products[:5000]

    except Exception as e:
        print(f"  ✗ {chain_name} error: {e}", file=sys.stderr)
        import traceback
        traceback.print_exc()
        return []


def update_mongodb(products):
    """Update MongoDB with products."""
    try:
        from pymongo import MongoClient
    except ImportError:
        print("pymongo not installed", file=sys.stderr)
        return

    print(f"\n💾 Connecting to MongoDB...", file=sys.stderr)

    client = MongoClient(MONGODB_URI)
    db = client.get_database()
    collection = db['products']

    # Merge products by barcode
    merged = {}
    for p in products:
        barcode = p['barcode']
        if barcode not in merged:
            merged[barcode] = {
                'barcode': barcode,
                'name': p['name'],
                'category': p['category'],
                'prices': []
            }
        # Add price for this chain
        if not any(pr['chain'] == p['chain'] for pr in merged[barcode]['prices']):
            merged[barcode]['prices'].append({
                'chain': p['chain'],
                'chainName': p['chainName'],
                'price': p['price']
            })

    print(f"💾 Updating {len(merged)} products...", file=sys.stderr)

    stats = {'inserted': 0, 'updated': 0, 'errors': 0}
    now = datetime.utcnow()

    for product in merged.values():
        try:
            barcode = product['barcode']
            prices = product['prices']
            cheapest = min(prices, key=lambda p: p['price']) if prices else {'price': 0, 'chainName': ''}

            # Generate image URL
            image = None
            if len(barcode) >= 12:
                image = f"https://images.openfoodfacts.org/images/products/{barcode[:3]}/{barcode[3:6]}/{barcode[6:9]}/{barcode[9:]}/front_he.400.jpg"

            result = collection.update_one(
                {'barcode': barcode},
                {
                    '$set': {
                        'name': product['name'],
                        'category': product['category'],
                        'image': image,
                        'prices': [{'chain': p['chain'], 'chainName': p['chainName'], 'price': p['price'], 'lastUpdated': now} for p in prices],
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

    client.close()

    print(f'\n✅ Update complete!', file=sys.stderr)
    print(f'   Inserted: {stats["inserted"]}', file=sys.stderr)
    print(f'   Updated: {stats["updated"]}', file=sys.stderr)
    print(f'   Errors: {stats["errors"]}', file=sys.stderr)


def main():
    # Chains to scrape
    chains = {
        'victory': ('ויקטורי', 'VICTORY'),
        'rami_levy': ('רמי לוי', 'RAMI_LEVY'),
        'yeinot_bitan': ('יינות ביתן', 'YAYNO_BITAN'),
        'mega': ('מגה', 'MEGA'),
        'osher_ad': ('אושר עד', 'OSHER_AD'),
        'hazi_hinam': ('חצי חינם', 'HAZI_HINAM'),
        'tiv_taam': ('טיב טעם', 'TIV_TAAM'),
        'keshet': ('קשת טעמים', 'KESHET'),
        'bareket': ('ברקת', 'BAREKET'),
        'stop_market': ('סטופ מרקט', 'STOP_MARKET'),
        'freshmarket': ('פרש מרקט', 'FRESHMARKET'),
    }

    # Parse args
    args = sys.argv[1:]
    if '--list' in args:
        for chain_id, (name, scraper) in chains.items():
            print(f"{chain_id}: {name}")
        return

    selected = [a for a in args if a in chains]
    if not selected:
        selected = list(chains.keys())

    print(f"🇮🇱 Scraping: {', '.join(selected)}", file=sys.stderr)

    # Create temp directory
    output_dir = tempfile.mkdtemp(prefix='supermarket_')
    print(f"Output: {output_dir}", file=sys.stderr)

    all_products = []
    for chain_id in selected:
        name, scraper = chains[chain_id]
        products = scrape_chain(name, scraper, output_dir)
        all_products.extend(products)

    if all_products:
        update_mongodb(all_products)
    else:
        print("\n⚠️ No products found", file=sys.stderr)

    # Cleanup
    import shutil
    try:
        shutil.rmtree(output_dir)
    except:
        pass


if __name__ == '__main__':
    main()
