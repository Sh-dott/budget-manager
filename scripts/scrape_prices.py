#!/usr/bin/env python3
"""
Israeli Supermarket Price Scraper
Uses il-supermarket-scraper to fetch real prices from Israeli chains.
Output JSON to stdout for Node.js to consume.

Set ISRAEL_PROXY_URL environment variable for Israeli proxy:
  export ISRAEL_PROXY_URL="http://user:pass@proxy.example.com:8080"
"""

import json
import sys
import os
import tempfile
import logging
from datetime import datetime
from typing import List, Dict, Any, Optional

# Set up logging to stderr (so stdout stays clean for JSON)
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    stream=sys.stderr
)
logger = logging.getLogger(__name__)

# Configure proxy for Israeli IP (required for scraping Israeli supermarkets)
PROXY_URL = os.environ.get('ISRAEL_PROXY_URL')
if PROXY_URL:
    logger.info(f"Using proxy: {PROXY_URL[:30]}...")
    os.environ['HTTP_PROXY'] = PROXY_URL
    os.environ['HTTPS_PROXY'] = PROXY_URL
    os.environ['http_proxy'] = PROXY_URL
    os.environ['https_proxy'] = PROXY_URL
else:
    logger.warning("No ISRAEL_PROXY_URL set - scraping may fail from non-Israeli IPs")

# Suppress the il_supermarket_scarper library's Logger output to stdout
# by monkey-patching before import
class _SuppressedLogger:
    """Suppress the library's custom Logger that pollutes stdout"""
    @staticmethod
    def info(*args, **kwargs): pass
    @staticmethod
    def debug(*args, **kwargs): pass
    @staticmethod
    def warning(*args, **kwargs): pass
    @staticmethod
    def error(*args, **kwargs): pass

# Pre-emptively add to sys.modules to suppress library logger
try:
    import il_supermarket_scarper.utils.logger as lib_logger
    lib_logger.Logger = _SuppressedLogger
except:
    pass

# Chain name mapping (English ID -> Hebrew display name)
CHAIN_NAMES = {
    'shufersal': 'שופרסל',
    'rami_levy': 'רמי לוי',
    'mega': 'מגה',
    'victory': 'ויקטורי',
    'yeinot_bitan': 'יינות ביתן',
    'tiv_taam': 'טיב טעם',
    'osher_ad': 'אושר עד',
    'hazi_hinam': 'חצי חינם',
    'keshet_teamim': 'קשת טעמים',
    'super_pharm': 'סופר פארם',
    'politzer': 'פוליצר',
    'freshmarket': 'פרש מרקט',
    'stop_market': 'סטופ מרקט',
    'bareket': 'ברקת',
    'maayan_2000': 'מעיין 2000',
    'zol_vbegadol': 'זול ובגדול',
    'superyuda': 'סופר יודא',
}

# Default chains for quick scraping
DEFAULT_CHAINS = ['shufersal', 'rami_levy', 'victory']


def get_available_chains() -> List[str]:
    """Get list of available chains from the scraper library."""
    try:
        from il_supermarket_scarper import DumpFolderNames
        # Return our mapped chain IDs
        return list(CHAIN_TO_ENUM.keys())
    except ImportError as e:
        logger.error(f"Failed to import il_supermarket_scarper: {e}")
        return list(CHAIN_NAMES.keys())


# Map chain IDs to DumpFolderNames enum values
CHAIN_TO_ENUM = {
    'shufersal': 'SHUFERSAL',
    'rami_levy': 'RAMI_LEVY',
    'victory': 'VICTORY',
    'yeinot_bitan': 'YAYNO_BITAN_AND_CARREFOUR',
    'tiv_taam': 'TIV_TAAM',
    'osher_ad': 'OSHER_AD',
    'hazi_hinam': 'HAZI_HINAM',
    'keshet_teamim': 'KESHET',
    'super_pharm': 'SUPER_PHARM',
    'politzer': 'POLITZER',
    'freshmarket': 'FRESH_MARKET_AND_SUPER_DOSH',
    'stop_market': 'STOP_MARKET',
    'bareket': 'BAREKET',
    'maayan_2000': 'MAAYAN_2000',
    'zol_vbegadol': 'ZOL_VE_BEGADOL',
    'superyuda': 'SUPER_YUDA',
}


def scrape_chain(chain_name: str, output_dir: str = None, limit: int = 5000) -> Dict[str, Any]:
    """
    Scrape a single chain and return products as dict.

    Args:
        chain_name: Name of the chain to scrape (e.g., 'shufersal')
        output_dir: Directory to store downloaded files
        limit: Maximum number of products to return

    Returns:
        Dict with chain info and products list
    """
    try:
        from il_supermarket_scarper import ScarpingTask
    except ImportError as e:
        logger.error(f"Import error: {e}")
        return {
            'chain': chain_name,
            'chain_hebrew': CHAIN_NAMES.get(chain_name.lower(), chain_name),
            'success': False,
            'error': f'Library not installed. Run: pip install il-supermarket-scraper',
            'products': []
        }

    # Get enum name for this chain
    enum_name = CHAIN_TO_ENUM.get(chain_name.lower())
    if not enum_name:
        return {
            'chain': chain_name,
            'chain_hebrew': CHAIN_NAMES.get(chain_name.lower(), chain_name),
            'success': False,
            'error': f'Unknown chain: {chain_name}. Available: {list(CHAIN_TO_ENUM.keys())}',
            'products': []
        }

    # Use temp directory if not specified
    if output_dir is None:
        output_dir = tempfile.mkdtemp(prefix=f'supermarket_{chain_name}_')

    logger.info(f"Starting scrape for chain: {chain_name} ({enum_name})")
    logger.info(f"Output directory: {output_dir}")

    try:
        # Create and run the scraping task with specific scraper
        task = ScarpingTask(
            dump_folder_name=output_dir,
            enabled_scrapers=[enum_name],  # Use uppercase enum name
            files_types=['PRICE_FULL_FILE', 'PRICE_FILE'],
            multiprocessing=1,
            suppress_exception=True
        )

        # Run the scraper
        logger.info(f"Downloading price files for {chain_name}...")
        task.start()

        logger.info(f"Scrape completed for {chain_name}, parsing products...")

        # Parse the downloaded files
        products = parse_scraped_files(output_dir, chain_name, limit)

        return {
            'chain': chain_name,
            'chain_hebrew': CHAIN_NAMES.get(chain_name.lower(), chain_name),
            'success': True,
            'products_count': len(products),
            'products': products,
            'scraped_at': datetime.utcnow().isoformat()
        }

    except Exception as e:
        logger.error(f"Error scraping {chain_name}: {e}")
        import traceback
        logger.error(traceback.format_exc())
        return {
            'chain': chain_name,
            'chain_hebrew': CHAIN_NAMES.get(chain_name.lower(), chain_name),
            'success': False,
            'error': str(e),
            'products': []
        }


def parse_scraped_files(output_dir: str, chain_name: str, limit: int = 5000) -> List[Dict[str, Any]]:
    """
    Parse the downloaded XML/gz files to extract products.

    Args:
        output_dir: Directory containing downloaded files
        chain_name: Name of the chain
        limit: Maximum number of products to return

    Returns:
        List of product dictionaries
    """
    # Parse XML files directly
    logger.info(f"Parsing XML files for {chain_name} from {output_dir}")
    products = parse_xml_files_directly(output_dir, chain_name, limit)
    return products


def parse_xml_files_directly(output_dir: str, chain_name: str, limit: int = 5000) -> List[Dict[str, Any]]:
    """
    Fallback: Parse XML files directly if parser library unavailable.
    """
    import gzip
    import xml.etree.ElementTree as ET

    products = []

    # Find all XML and gz files
    for root_path, dirs, files in os.walk(output_dir):
        for filename in files:
            if len(products) >= limit:
                break

            filepath = os.path.join(root_path, filename)

            try:
                # Handle gzipped files
                if filename.endswith('.gz'):
                    with gzip.open(filepath, 'rt', encoding='utf-8', errors='replace') as f:
                        content = f.read()
                elif filename.endswith('.xml'):
                    with open(filepath, 'r', encoding='utf-8', errors='replace') as f:
                        content = f.read()
                else:
                    continue

                # Parse XML
                root = ET.fromstring(content)

                # Find items (different chains use different element names)
                items = root.findall('.//Item') + root.findall('.//Product')

                for item in items:
                    if len(products) >= limit:
                        break

                    product = {
                        'barcode': get_xml_text(item, ['ItemCode', 'Barcode', 'barcode']),
                        'name': get_xml_text(item, ['ItemName', 'ProductName', 'name', 'ItemNm']),
                        'price': float(get_xml_text(item, ['ItemPrice', 'Price', 'price']) or 0),
                        'chain': chain_name,
                        'chain_hebrew': CHAIN_NAMES.get(chain_name.lower(), chain_name),
                        'manufacturer': get_xml_text(item, ['ManufacturerName', 'Manufacturer']),
                        'unit_quantity': get_xml_text(item, ['UnitQty', 'Quantity']),
                        'unit_measure': get_xml_text(item, ['UnitOfMeasure', 'UOM']),
                    }

                    if product['barcode'] and product['name'] and product['price'] > 0:
                        products.append(product)

            except Exception as e:
                logger.warning(f"Error parsing {filepath}: {e}")
                continue

    logger.info(f"Direct XML parsing: {len(products)} products from {chain_name}")
    return products


def get_xml_text(element, possible_names: List[str]) -> str:
    """Get text from XML element trying multiple possible tag names."""
    for name in possible_names:
        child = element.find(name)
        if child is not None and child.text:
            return child.text.strip()
    return ''


def scrape_multiple_chains(chains: List[str] = None, limit: int = 5000) -> Dict[str, Any]:
    """
    Scrape multiple chains.

    Args:
        chains: List of chain names to scrape. If None, uses DEFAULT_CHAINS.
        limit: Maximum products per chain

    Returns:
        Dict with results per chain
    """
    if chains is None:
        chains = DEFAULT_CHAINS

    results = {
        'success': True,
        'scraped_at': datetime.utcnow().isoformat(),
        'chains': {}
    }

    for chain in chains:
        logger.info(f"Processing chain: {chain}")
        chain_result = scrape_chain(chain, limit=limit)
        results['chains'][chain] = chain_result

        if not chain_result['success']:
            results['success'] = False

    # Calculate totals
    total_products = sum(
        c.get('products_count', 0)
        for c in results['chains'].values()
    )
    results['total_products'] = total_products

    return results


def main():
    """Main entry point for command line usage."""
    output_file = None

    # Check for --output flag
    args = sys.argv[1:]
    if '--output' in args:
        idx = args.index('--output')
        if idx + 1 < len(args):
            output_file = args[idx + 1]
            args = args[:idx] + args[idx+2:]

    if args and args[0] == '--list':
        # List available chains
        available = get_available_chains()
        output = {
            'available_chains': available,
            'chain_names': CHAIN_NAMES
        }
        write_output(output, output_file)
        return

    if args and args[0] == '--help':
        print("""
Israeli Supermarket Price Scraper

Usage:
  python scrape_prices.py [chain1] [chain2] ... [--output file.json]
  python scrape_prices.py --list                   List available chains
  python scrape_prices.py --help                   Show this help

Examples:
  python scrape_prices.py shufersal               Scrape only Shufersal
  python scrape_prices.py shufersal --output /tmp/result.json
  python scrape_prices.py                         Scrape default chains

Note: First run may take several minutes to download price files.
Some chains may require Israeli IP address.
""", file=sys.stderr)
        return

    # Scrape specified chains
    chains = args if args else None
    results = scrape_multiple_chains(chains)
    write_output(results, output_file)


def write_output(data: Dict[str, Any], output_file: str = None):
    """Write output to file or stdout."""
    json_str = json.dumps(data, ensure_ascii=False)

    if output_file:
        # Write to file and print just the path
        with open(output_file, 'w', encoding='utf-8') as f:
            f.write(json_str)
        print(output_file)  # Only this goes to stdout
    else:
        print(json_str)


if __name__ == '__main__':
    main()
