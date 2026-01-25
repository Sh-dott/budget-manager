#!/usr/bin/env python3
"""
Israeli Supermarket Prices - Kaggle Dataset Importer

Downloads the Israeli Supermarkets 2024 dataset from Kaggle
and outputs JSON for MongoDB import.

Setup:
1. Create Kaggle account at kaggle.com
2. Go to Account -> Create New API Token
3. Set environment variables:
   - KAGGLE_USERNAME=your_username
   - KAGGLE_KEY=your_api_key

Or place kaggle.json in ~/.kaggle/ (Linux/Mac) or %USERPROFILE%\.kaggle\ (Windows)
"""

import json
import sys
import os
import tempfile
import logging
import csv
import zipfile
from datetime import datetime
from typing import Dict, List, Any, Optional
from pathlib import Path

# Set up logging to stderr
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    stream=sys.stderr
)
logger = logging.getLogger(__name__)

# Chain mapping (folder names to display names)
CHAIN_MAPPING = {
    'SHUFERSAL': {'id': 'shufersal', 'name': 'שופרסל'},
    'RAMI_LEVY': {'id': 'rami_levy', 'name': 'רמי לוי'},
    'VICTORY': {'id': 'victory', 'name': 'ויקטורי'},
    'YAYNO_BITAN': {'id': 'yeinot_bitan', 'name': 'יינות ביתן'},
    'MEGA': {'id': 'mega', 'name': 'מגה'},
    'OSHER_AD': {'id': 'osher_ad', 'name': 'אושר עד'},
    'HAZI_HINAM': {'id': 'hazi_hinam', 'name': 'חצי חינם'},
    'TIV_TAAM': {'id': 'tiv_taam', 'name': 'טיב טעם'},
    'YOHANANOF': {'id': 'yohananof', 'name': 'יוחננוף'},
    'GOOD_PHARM': {'id': 'good_pharm', 'name': 'גוד פארם'},
    'SUPER_PHARM': {'id': 'super_pharm', 'name': 'סופר פארם'},
    'FRESHMARKET': {'id': 'freshmarket', 'name': 'פרש מרקט'},
    'KESHET': {'id': 'keshet', 'name': 'קשת טעמים'},
    'BAREKET': {'id': 'bareket', 'name': 'ברקת'},
    'STOP_MARKET': {'id': 'stop_market', 'name': 'סטופ מרקט'},
    'POLITZER': {'id': 'politzer', 'name': 'פוליצר'},
    'ZOL_VBEGADOL': {'id': 'zol_vbegadol', 'name': 'זול ובגדול'},
    'MAAYAN_2000': {'id': 'maayan_2000', 'name': 'מעיין 2000'},
    'SUPER_YUDA': {'id': 'super_yuda', 'name': 'סופר יודא'},
}

# Common product categories based on keywords
CATEGORY_KEYWORDS = {
    'מוצרי חלב': ['חלב', 'גבינה', 'יוגורט', 'שמנת', 'קוטג', 'לבן', 'קפיר', 'מעדן'],
    'לחם ומאפים': ['לחם', 'פיתה', 'לחמניה', 'חלה', 'באגט', 'טוסט', 'מאפה'],
    'ביצים': ['ביצים', 'ביצה'],
    'בשר ועוף': ['עוף', 'בקר', 'טלה', 'כבש', 'הודו', 'נקניק', 'שניצל', 'המבורגר', 'סטייק', 'כרעיים', 'חזה'],
    'דגים': ['דג', 'סלמון', 'טונה', 'אמנון', 'דניס', 'קרפיון'],
    'פירות וירקות': ['תפוח', 'בננה', 'תפוז', 'לימון', 'עגבני', 'מלפפון', 'גזר', 'בצל', 'תפוא', 'אבוקדו', 'ענב', 'אבטיח', 'מלון'],
    'משקאות': ['מים', 'קולה', 'ספרייט', 'פנטה', 'מיץ', 'נקטר', 'סודה', 'בירה', 'יין', 'וודקה', 'ויסקי'],
    'חטיפים וממתקים': ['במבה', 'ביסלי', 'שוקולד', 'עוגיה', 'וופל', 'סוכריה', 'גלידה', 'קרקר'],
    'ניקיון': ['אקונומיקה', 'סבון', 'שמפו', 'מרכך', 'אבקה', 'נוזל כלים', 'מטליות', 'נייר טואלט'],
    'פסטה ואורז': ['פסטה', 'ספגטי', 'אטריות', 'אורז', 'קוסקוס', 'פתיתים', 'בורגול'],
    'שימורים': ['שימורים', 'טונה', 'תירס', 'אפונה', 'חומוס', 'שעועית', 'עגבניות מרוסקות'],
    'קפה ותה': ['קפה', 'נס', 'אספרסו', 'תה', 'תה ירוק', 'קפסולות'],
    'תינוקות': ['חיתולים', 'מטרנה', 'סימילאק', 'מגבונים', 'בקבוק'],
}


def categorize_product(name: str) -> str:
    """Categorize a product based on its Hebrew name."""
    name_lower = name.lower()
    for category, keywords in CATEGORY_KEYWORDS.items():
        for keyword in keywords:
            if keyword in name_lower:
                return category
    return 'כללי'


def download_kaggle_dataset(output_dir: str) -> bool:
    """Download the Israeli Supermarkets dataset from Kaggle."""
    try:
        from kaggle.api.kaggle_api_extended import KaggleApi

        logger.info("Authenticating with Kaggle API...")
        api = KaggleApi()
        api.authenticate()

        dataset = 'erlichsefi/israeli-supermarkets-2024'
        logger.info(f"Downloading dataset: {dataset}")

        api.dataset_download_files(
            dataset,
            path=output_dir,
            unzip=True
        )

        logger.info(f"Dataset downloaded to {output_dir}")
        return True

    except ImportError:
        logger.error("Kaggle package not installed. Run: pip install kaggle")
        return False
    except Exception as e:
        logger.error(f"Kaggle download error: {e}")
        return False


def parse_price_csv(filepath: str, chain_key: str) -> List[Dict[str, Any]]:
    """Parse a price CSV file and return product list."""
    products = []
    chain_info = CHAIN_MAPPING.get(chain_key, {'id': chain_key.lower(), 'name': chain_key})

    try:
        with open(filepath, 'r', encoding='utf-8', errors='replace') as f:
            # Try to detect delimiter
            sample = f.read(2048)
            f.seek(0)

            delimiter = ','
            if sample.count('\t') > sample.count(','):
                delimiter = '\t'

            reader = csv.DictReader(f, delimiter=delimiter)

            for row in reader:
                try:
                    # Handle different column naming conventions
                    barcode = (row.get('ItemCode') or row.get('item_code') or
                              row.get('Barcode') or row.get('barcode') or '').strip()
                    name = (row.get('ItemName') or row.get('item_name') or
                           row.get('ProductName') or row.get('product_name') or '').strip()
                    price_str = (row.get('ItemPrice') or row.get('item_price') or
                                row.get('Price') or row.get('price') or '0').strip()
                    manufacturer = (row.get('ManufacturerName') or row.get('manufacturer_name') or
                                   row.get('Manufacturer') or '').strip()
                    unit_qty = (row.get('UnitQty') or row.get('unit_qty') or
                               row.get('Quantity') or '').strip()
                    unit_measure = (row.get('UnitOfMeasure') or row.get('unit_of_measure') or
                                   row.get('UOM') or '').strip()

                    # Parse price
                    try:
                        price = float(price_str.replace(',', '.'))
                    except (ValueError, AttributeError):
                        price = 0

                    # Skip invalid products
                    if not barcode or not name or price <= 0:
                        continue

                    # Skip non-food items by barcode prefix (optional)
                    # Israeli food barcodes typically start with 729

                    product = {
                        'barcode': barcode,
                        'name': name,
                        'price': round(price, 2),
                        'chain': chain_info['id'],
                        'chainName': chain_info['name'],
                        'manufacturer': manufacturer,
                        'unitQty': unit_qty,
                        'unitMeasure': unit_measure,
                        'category': categorize_product(name),
                    }

                    products.append(product)

                except Exception as e:
                    continue

    except Exception as e:
        logger.error(f"Error parsing {filepath}: {e}")

    return products


def find_and_parse_csvs(data_dir: str, limit_per_chain: int = 10000) -> Dict[str, List[Dict]]:
    """Find and parse all price CSV files in the data directory."""
    results = {}

    # Walk through directory structure
    for root, dirs, files in os.walk(data_dir):
        for filename in files:
            # Look for price files (price_full_file is most comprehensive)
            if 'price' in filename.lower() and filename.endswith('.csv'):
                filepath = os.path.join(root, filename)

                # Try to determine chain from path or filename
                chain_key = None
                path_parts = filepath.upper().split(os.sep)

                for part in path_parts:
                    for key in CHAIN_MAPPING.keys():
                        if key in part:
                            chain_key = key
                            break
                    if chain_key:
                        break

                # Also check filename
                if not chain_key:
                    filename_upper = filename.upper()
                    for key in CHAIN_MAPPING.keys():
                        if key in filename_upper:
                            chain_key = key
                            break

                if not chain_key:
                    logger.warning(f"Could not determine chain for: {filepath}")
                    continue

                logger.info(f"Parsing {filename} for chain {chain_key}...")
                products = parse_price_csv(filepath, chain_key)

                if products:
                    chain_id = CHAIN_MAPPING[chain_key]['id']
                    if chain_id not in results:
                        results[chain_id] = []

                    # Limit products per chain
                    remaining = limit_per_chain - len(results[chain_id])
                    if remaining > 0:
                        results[chain_id].extend(products[:remaining])

                    logger.info(f"  Found {len(products)} products, total for {chain_id}: {len(results[chain_id])}")

    return results


def merge_products_by_barcode(chain_products: Dict[str, List[Dict]]) -> List[Dict[str, Any]]:
    """Merge products from different chains by barcode."""
    merged = {}

    for chain_id, products in chain_products.items():
        for product in products:
            barcode = product['barcode']

            if barcode not in merged:
                merged[barcode] = {
                    'barcode': barcode,
                    'name': product['name'],
                    'manufacturer': product.get('manufacturer', ''),
                    'category': product.get('category', 'כללי'),
                    'unitQty': product.get('unitQty', ''),
                    'unitMeasure': product.get('unitMeasure', ''),
                    'prices': [],
                    'image': f"https://images.openfoodfacts.org/images/products/{barcode[:3]}/{barcode[3:6]}/{barcode[6:9]}/{barcode[9:]}/front_he.400.jpg" if len(barcode) >= 12 else None,
                }

            # Add price for this chain
            merged[barcode]['prices'].append({
                'chain': product['chain'],
                'chainName': product['chainName'],
                'price': product['price'],
            })

    # Convert to list and sort by number of chains (products available in more stores first)
    result = list(merged.values())
    result.sort(key=lambda x: -len(x['prices']))

    return result


def main():
    """Main entry point."""
    import argparse

    parser = argparse.ArgumentParser(description='Import Israeli supermarket prices from Kaggle')
    parser.add_argument('--output', '-o', help='Output JSON file path')
    parser.add_argument('--limit', '-l', type=int, default=5000, help='Max products per chain')
    parser.add_argument('--data-dir', '-d', help='Use existing data directory instead of downloading')
    parser.add_argument('--chains', '-c', nargs='+', help='Specific chains to import')
    args = parser.parse_args()

    # Use temp directory or specified data dir
    if args.data_dir and os.path.exists(args.data_dir):
        data_dir = args.data_dir
        logger.info(f"Using existing data directory: {data_dir}")
    else:
        # Download from Kaggle
        data_dir = tempfile.mkdtemp(prefix='kaggle_supermarket_')
        logger.info(f"Downloading to temp directory: {data_dir}")

        if not download_kaggle_dataset(data_dir):
            # Fallback: try alternative data sources
            logger.error("Failed to download Kaggle dataset")
            logger.info("Trying alternative: official price portals...")

            # Output error result
            result = {
                'success': False,
                'error': 'Could not download Kaggle dataset. Please set KAGGLE_USERNAME and KAGGLE_KEY environment variables.',
                'instructions': [
                    '1. Create Kaggle account at kaggle.com',
                    '2. Go to Account Settings -> Create New API Token',
                    '3. Set KAGGLE_USERNAME and KAGGLE_KEY in Render environment',
                ],
                'products': []
            }
            output_result(result, args.output)
            return

    # Parse CSV files
    logger.info("Parsing price files...")
    chain_products = find_and_parse_csvs(data_dir, limit_per_chain=args.limit)

    if not chain_products:
        logger.error("No products found in data directory")
        result = {
            'success': False,
            'error': 'No price files found in dataset',
            'products': []
        }
        output_result(result, args.output)
        return

    # Filter chains if specified
    if args.chains:
        chain_products = {k: v for k, v in chain_products.items() if k in args.chains}

    # Merge products by barcode
    logger.info("Merging products across chains...")
    merged_products = merge_products_by_barcode(chain_products)

    # Build result
    chains_summary = {chain: len(products) for chain, products in chain_products.items()}

    result = {
        'success': True,
        'importedAt': datetime.utcnow().isoformat(),
        'totalProducts': len(merged_products),
        'chainsSummary': chains_summary,
        'products': merged_products
    }

    logger.info(f"Import complete: {len(merged_products)} unique products from {len(chains_summary)} chains")
    output_result(result, args.output)


def output_result(result: Dict[str, Any], output_file: Optional[str] = None):
    """Output result to file or stdout."""
    json_str = json.dumps(result, ensure_ascii=False)

    if output_file:
        with open(output_file, 'w', encoding='utf-8') as f:
            f.write(json_str)
        print(output_file)  # Print path to stdout
    else:
        print(json_str)


if __name__ == '__main__':
    main()
