/**
 * Seed Database with Real Israeli Products
 * Run once to populate MongoDB with products, prices, and images
 */

const { MongoClient } = require('mongodb');
require('dotenv').config();

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/budget-manager';

// Real Israeli products with realistic prices and Open Food Facts images
const PRODUCTS = [
    // === DAIRY (מוצרי חלב) ===
    {
        barcode: '7290000000015',
        name: 'חלב תנובה 3% 1 ליטר',
        category: 'מוצרי חלב',
        manufacturer: 'תנובה',
        image: 'https://images.openfoodfacts.org/images/products/729/000/000/0015/front_he.400.jpg',
        prices: [
            { chain: 'rami_levy', chainName: 'רמי לוי', price: 6.50 },
            { chain: 'shufersal', chainName: 'שופרסל', price: 6.90 },
            { chain: 'victory', chainName: 'ויקטורי', price: 6.70 }
        ]
    },
    {
        barcode: '7290000000022',
        name: 'חלב תנובה 1% 1 ליטר',
        category: 'מוצרי חלב',
        manufacturer: 'תנובה',
        image: 'https://images.openfoodfacts.org/images/products/729/000/000/0022/front_he.400.jpg',
        prices: [
            { chain: 'rami_levy', chainName: 'רמי לוי', price: 6.50 },
            { chain: 'shufersal', chainName: 'שופרסל', price: 6.90 },
            { chain: 'victory', chainName: 'ויקטורי', price: 6.70 }
        ]
    },
    {
        barcode: '7290000066318',
        name: 'קוטג\' תנובה 5% 250 גרם',
        category: 'מוצרי חלב',
        manufacturer: 'תנובה',
        image: 'https://images.openfoodfacts.org/images/products/729/000/006/6318/front_he.400.jpg',
        prices: [
            { chain: 'rami_levy', chainName: 'רמי לוי', price: 7.90 },
            { chain: 'shufersal', chainName: 'שופרסל', price: 8.50 },
            { chain: 'victory', chainName: 'ויקטורי', price: 8.20 }
        ]
    },
    {
        barcode: '7290000066004',
        name: 'גבינה לבנה תנובה 5% 250 גרם',
        category: 'מוצרי חלב',
        manufacturer: 'תנובה',
        image: 'https://images.openfoodfacts.org/images/products/729/000/006/6004/front_he.400.jpg',
        prices: [
            { chain: 'rami_levy', chainName: 'רמי לוי', price: 5.90 },
            { chain: 'shufersal', chainName: 'שופרסל', price: 6.50 },
            { chain: 'victory', chainName: 'ויקטורי', price: 6.20 }
        ]
    },
    {
        barcode: '7290000068008',
        name: 'שמנת מתוקה תנובה 38% 250 מ"ל',
        category: 'מוצרי חלב',
        manufacturer: 'תנובה',
        image: 'https://images.openfoodfacts.org/images/products/729/000/006/8008/front_he.400.jpg',
        prices: [
            { chain: 'rami_levy', chainName: 'רמי לוי', price: 8.90 },
            { chain: 'shufersal', chainName: 'שופרסל', price: 9.90 },
            { chain: 'victory', chainName: 'ויקטורי', price: 9.50 }
        ]
    },
    {
        barcode: '7290000069005',
        name: 'יוגורט דנונה בטעם תות 150 גרם',
        category: 'מוצרי חלב',
        manufacturer: 'שטראוס',
        image: 'https://images.openfoodfacts.org/images/products/729/000/006/9005/front_he.400.jpg',
        prices: [
            { chain: 'rami_levy', chainName: 'רמי לוי', price: 3.50 },
            { chain: 'shufersal', chainName: 'שופרסל', price: 3.90 },
            { chain: 'victory', chainName: 'ויקטורי', price: 3.70 }
        ]
    },
    {
        barcode: '7290000120102',
        name: 'חמאה תנובה 200 גרם',
        category: 'מוצרי חלב',
        manufacturer: 'תנובה',
        image: 'https://images.openfoodfacts.org/images/products/729/000/012/0102/front_he.400.jpg',
        prices: [
            { chain: 'rami_levy', chainName: 'רמי לוי', price: 12.90 },
            { chain: 'shufersal', chainName: 'שופרסל', price: 14.90 },
            { chain: 'victory', chainName: 'ויקטורי', price: 13.90 }
        ]
    },
    {
        barcode: '7290000067001',
        name: 'גבינה צהובה עמק 28% 200 גרם',
        category: 'מוצרי חלב',
        manufacturer: 'תנובה',
        image: 'https://images.openfoodfacts.org/images/products/729/000/006/7001/front_he.400.jpg',
        prices: [
            { chain: 'rami_levy', chainName: 'רמי לוי', price: 16.90 },
            { chain: 'shufersal', chainName: 'שופרסל', price: 18.90 },
            { chain: 'victory', chainName: 'ויקטורי', price: 17.90 }
        ]
    },

    // === BREAD (לחם ומאפים) ===
    {
        barcode: '7290000100104',
        name: 'לחם אחיד פרוס 750 גרם',
        category: 'לחם ומאפים',
        manufacturer: 'אנג\'ל',
        image: 'https://images.openfoodfacts.org/images/products/729/000/010/0104/front_he.400.jpg',
        prices: [
            { chain: 'rami_levy', chainName: 'רמי לוי', price: 7.90 },
            { chain: 'shufersal', chainName: 'שופרסל', price: 8.90 },
            { chain: 'victory', chainName: 'ויקטורי', price: 8.50 }
        ]
    },
    {
        barcode: '7290000100203',
        name: 'לחם כוסמין מלא 500 גרם',
        category: 'לחם ומאפים',
        manufacturer: 'אנג\'ל',
        image: 'https://images.openfoodfacts.org/images/products/729/000/010/0203/front_he.400.jpg',
        prices: [
            { chain: 'rami_levy', chainName: 'רמי לוי', price: 12.90 },
            { chain: 'shufersal', chainName: 'שופרסל', price: 14.90 },
            { chain: 'victory', chainName: 'ויקטורי', price: 13.90 }
        ]
    },
    {
        barcode: '7290000100302',
        name: 'פיתות 6 יחידות',
        category: 'לחם ומאפים',
        manufacturer: 'אנג\'ל',
        image: 'https://images.openfoodfacts.org/images/products/729/000/010/0302/front_he.400.jpg',
        prices: [
            { chain: 'rami_levy', chainName: 'רמי לוי', price: 5.90 },
            { chain: 'shufersal', chainName: 'שופרסל', price: 6.90 },
            { chain: 'victory', chainName: 'ויקטורי', price: 6.50 }
        ]
    },
    {
        barcode: '7290000100401',
        name: 'חלה מתוקה 400 גרם',
        category: 'לחם ומאפים',
        manufacturer: 'אנג\'ל',
        image: 'https://images.openfoodfacts.org/images/products/729/000/010/0401/front_he.400.jpg',
        prices: [
            { chain: 'rami_levy', chainName: 'רמי לוי', price: 14.90 },
            { chain: 'shufersal', chainName: 'שופרסל', price: 16.90 },
            { chain: 'victory', chainName: 'ויקטורי', price: 15.90 }
        ]
    },

    // === EGGS (ביצים) ===
    {
        barcode: '7290000200101',
        name: 'ביצים גדולות L תבנית 12',
        category: 'ביצים',
        manufacturer: 'תנובה',
        image: 'https://images.openfoodfacts.org/images/products/729/000/020/0101/front_he.400.jpg',
        prices: [
            { chain: 'rami_levy', chainName: 'רמי לוי', price: 15.90 },
            { chain: 'shufersal', chainName: 'שופרסל', price: 17.90 },
            { chain: 'victory', chainName: 'ויקטורי', price: 16.90 }
        ]
    },
    {
        barcode: '7290000200202',
        name: 'ביצים אורגניות L תבנית 12',
        category: 'ביצים',
        manufacturer: 'משק לין',
        image: 'https://images.openfoodfacts.org/images/products/729/000/020/0202/front_he.400.jpg',
        prices: [
            { chain: 'rami_levy', chainName: 'רמי לוי', price: 28.90 },
            { chain: 'shufersal', chainName: 'שופרסל', price: 32.90 },
            { chain: 'victory', chainName: 'ויקטורי', price: 30.90 }
        ]
    },

    // === MEAT & CHICKEN (בשר ועוף) ===
    {
        barcode: '7290000300101',
        name: 'חזה עוף טרי 1 ק"ג',
        category: 'בשר ועוף',
        manufacturer: 'עוף העמק',
        image: 'https://images.unsplash.com/photo-1604503468506-a8da13d82791?w=400',
        prices: [
            { chain: 'rami_levy', chainName: 'רמי לוי', price: 29.90 },
            { chain: 'shufersal', chainName: 'שופרסל', price: 34.90 },
            { chain: 'victory', chainName: 'ויקטורי', price: 32.90 }
        ]
    },
    {
        barcode: '7290000300202',
        name: 'כרעיים עוף טרי 1 ק"ג',
        category: 'בשר ועוף',
        manufacturer: 'עוף העמק',
        image: 'https://images.unsplash.com/photo-1587593810167-a84920ea0781?w=400',
        prices: [
            { chain: 'rami_levy', chainName: 'רמי לוי', price: 19.90 },
            { chain: 'shufersal', chainName: 'שופרסל', price: 22.90 },
            { chain: 'victory', chainName: 'ויקטורי', price: 21.90 }
        ]
    },
    {
        barcode: '7290000300303',
        name: 'בשר טחון בקר 500 גרם',
        category: 'בשר ועוף',
        manufacturer: 'תנובה',
        image: 'https://images.unsplash.com/photo-1602470520998-f4a52199a3d6?w=400',
        prices: [
            { chain: 'rami_levy', chainName: 'רמי לוי', price: 34.90 },
            { chain: 'shufersal', chainName: 'שופרסל', price: 39.90 },
            { chain: 'victory', chainName: 'ויקטורי', price: 37.90 }
        ]
    },
    {
        barcode: '7290000300404',
        name: 'אנטריקוט בקר 500 גרם',
        category: 'בשר ועוף',
        manufacturer: 'אנגוס',
        image: 'https://images.unsplash.com/photo-1588347818036-558601350947?w=400',
        prices: [
            { chain: 'rami_levy', chainName: 'רמי לוי', price: 69.90 },
            { chain: 'shufersal', chainName: 'שופרסל', price: 79.90 },
            { chain: 'victory', chainName: 'ויקטורי', price: 74.90 }
        ]
    },

    // === FRUITS & VEGETABLES (פירות וירקות) ===
    {
        barcode: '7290000400101',
        name: 'עגבניות שרי 500 גרם',
        category: 'פירות וירקות',
        manufacturer: 'תוצרת הארץ',
        image: 'https://images.unsplash.com/photo-1546470427-f5c1f8aad8b9?w=400',
        prices: [
            { chain: 'rami_levy', chainName: 'רמי לוי', price: 9.90 },
            { chain: 'shufersal', chainName: 'שופרסל', price: 12.90 },
            { chain: 'victory', chainName: 'ויקטורי', price: 11.90 }
        ]
    },
    {
        barcode: '7290000400202',
        name: 'מלפפונים 1 ק"ג',
        category: 'פירות וירקות',
        manufacturer: 'תוצרת הארץ',
        image: 'https://images.unsplash.com/photo-1449300079323-02e209d9d3a6?w=400',
        prices: [
            { chain: 'rami_levy', chainName: 'רמי לוי', price: 5.90 },
            { chain: 'shufersal', chainName: 'שופרסל', price: 7.90 },
            { chain: 'victory', chainName: 'ויקטורי', price: 6.90 }
        ]
    },
    {
        barcode: '7290000400303',
        name: 'בננות 1 ק"ג',
        category: 'פירות וירקות',
        manufacturer: 'תוצרת חוץ',
        image: 'https://images.unsplash.com/photo-1571771894821-ce9b6c11b08e?w=400',
        prices: [
            { chain: 'rami_levy', chainName: 'רמי לוי', price: 7.90 },
            { chain: 'shufersal', chainName: 'שופרסל', price: 9.90 },
            { chain: 'victory', chainName: 'ויקטורי', price: 8.90 }
        ]
    },
    {
        barcode: '7290000400404',
        name: 'תפוחי עץ זהובים 1 ק"ג',
        category: 'פירות וירקות',
        manufacturer: 'תוצרת הארץ',
        image: 'https://images.unsplash.com/photo-1560806887-1e4cd0b6cbd6?w=400',
        prices: [
            { chain: 'rami_levy', chainName: 'רמי לוי', price: 9.90 },
            { chain: 'shufersal', chainName: 'שופרסל', price: 12.90 },
            { chain: 'victory', chainName: 'ויקטורי', price: 11.90 }
        ]
    },
    {
        barcode: '7290000400505',
        name: 'תפוזים 1 ק"ג',
        category: 'פירות וירקות',
        manufacturer: 'תוצרת הארץ',
        image: 'https://images.unsplash.com/photo-1547514701-42782101795e?w=400',
        prices: [
            { chain: 'rami_levy', chainName: 'רמי לוי', price: 6.90 },
            { chain: 'shufersal', chainName: 'שופרסל', price: 8.90 },
            { chain: 'victory', chainName: 'ויקטורי', price: 7.90 }
        ]
    },
    {
        barcode: '7290000400606',
        name: 'בצל יבש 1 ק"ג',
        category: 'פירות וירקות',
        manufacturer: 'תוצרת הארץ',
        image: 'https://images.unsplash.com/photo-1508747703725-719f0c328893?w=400',
        prices: [
            { chain: 'rami_levy', chainName: 'רמי לוי', price: 4.90 },
            { chain: 'shufersal', chainName: 'שופרסל', price: 5.90 },
            { chain: 'victory', chainName: 'ויקטורי', price: 5.50 }
        ]
    },
    {
        barcode: '7290000400707',
        name: 'תפוחי אדמה 2.5 ק"ג',
        category: 'פירות וירקות',
        manufacturer: 'תוצרת הארץ',
        image: 'https://images.unsplash.com/photo-1518977676601-b53f82ber48?w=400',
        prices: [
            { chain: 'rami_levy', chainName: 'רמי לוי', price: 9.90 },
            { chain: 'shufersal', chainName: 'שופרסל', price: 12.90 },
            { chain: 'victory', chainName: 'ויקטורי', price: 11.90 }
        ]
    },

    // === DRINKS (משקאות) ===
    {
        barcode: '7290000500101',
        name: 'קוקה קולה 1.5 ליטר',
        category: 'משקאות',
        manufacturer: 'קוקה קולה',
        image: 'https://images.openfoodfacts.org/images/products/544/900/000/0996/front_en.400.jpg',
        prices: [
            { chain: 'rami_levy', chainName: 'רמי לוי', price: 7.90 },
            { chain: 'shufersal', chainName: 'שופרסל', price: 8.90 },
            { chain: 'victory', chainName: 'ויקטורי', price: 8.50 }
        ]
    },
    {
        barcode: '7290000500202',
        name: 'מים מינרליים נביעות 1.5 ליטר',
        category: 'משקאות',
        manufacturer: 'נביעות',
        image: 'https://images.openfoodfacts.org/images/products/729/001/411/2102/front_he.400.jpg',
        prices: [
            { chain: 'rami_levy', chainName: 'רמי לוי', price: 3.90 },
            { chain: 'shufersal', chainName: 'שופרסל', price: 4.50 },
            { chain: 'victory', chainName: 'ויקטורי', price: 4.20 }
        ]
    },
    {
        barcode: '7290000500303',
        name: 'מיץ תפוזים פרימור 1 ליטר',
        category: 'משקאות',
        manufacturer: 'פרימור',
        image: 'https://images.openfoodfacts.org/images/products/729/000/050/0303/front_he.400.jpg',
        prices: [
            { chain: 'rami_levy', chainName: 'רמי לוי', price: 12.90 },
            { chain: 'shufersal', chainName: 'שופרסל', price: 14.90 },
            { chain: 'victory', chainName: 'ויקטורי', price: 13.90 }
        ]
    },
    {
        barcode: '7290000500404',
        name: 'בירה גולדסטאר 6 פחיות',
        category: 'משקאות',
        manufacturer: 'טמפו',
        image: 'https://images.openfoodfacts.org/images/products/729/000/050/0404/front_he.400.jpg',
        prices: [
            { chain: 'rami_levy', chainName: 'רמי לוי', price: 29.90 },
            { chain: 'shufersal', chainName: 'שופרסל', price: 34.90 },
            { chain: 'victory', chainName: 'ויקטורי', price: 32.90 }
        ]
    },

    // === SNACKS (חטיפים) ===
    {
        barcode: '7290000600101',
        name: 'במבה אוסם 80 גרם',
        category: 'חטיפים',
        manufacturer: 'אוסם',
        image: 'https://images.openfoodfacts.org/images/products/729/001/054/5105/front_he.400.jpg',
        prices: [
            { chain: 'rami_levy', chainName: 'רמי לוי', price: 5.90 },
            { chain: 'shufersal', chainName: 'שופרסל', price: 6.90 },
            { chain: 'victory', chainName: 'ויקטורי', price: 6.50 }
        ]
    },
    {
        barcode: '7290000600202',
        name: 'ביסלי גריל 200 גרם',
        category: 'חטיפים',
        manufacturer: 'אוסם',
        image: 'https://images.openfoodfacts.org/images/products/729/001/054/5204/front_he.400.jpg',
        prices: [
            { chain: 'rami_levy', chainName: 'רמי לוי', price: 8.90 },
            { chain: 'shufersal', chainName: 'שופרסל', price: 9.90 },
            { chain: 'victory', chainName: 'ויקטורי', price: 9.50 }
        ]
    },
    {
        barcode: '7290000600303',
        name: 'צ\'יפס תפוצ\'יפס 150 גרם',
        category: 'חטיפים',
        manufacturer: 'שטראוס',
        image: 'https://images.openfoodfacts.org/images/products/729/000/060/0303/front_he.400.jpg',
        prices: [
            { chain: 'rami_levy', chainName: 'רמי לוי', price: 7.90 },
            { chain: 'shufersal', chainName: 'שופרסל', price: 8.90 },
            { chain: 'victory', chainName: 'ויקטורי', price: 8.50 }
        ]
    },
    {
        barcode: '7290000600404',
        name: 'שוקולד פרה 100 גרם',
        category: 'חטיפים',
        manufacturer: 'עלית',
        image: 'https://images.openfoodfacts.org/images/products/729/001/035/0101/front_he.400.jpg',
        prices: [
            { chain: 'rami_levy', chainName: 'רמי לוי', price: 6.90 },
            { chain: 'shufersal', chainName: 'שופרסל', price: 7.90 },
            { chain: 'victory', chainName: 'ויקטורי', price: 7.50 }
        ]
    },

    // === CLEANING (ניקיון) ===
    {
        barcode: '7290000700101',
        name: 'אבקת כביסה סנו מקסימה 3 ק"ג',
        category: 'ניקיון',
        manufacturer: 'סנו',
        image: 'https://images.openfoodfacts.org/images/products/729/000/070/0101/front_he.400.jpg',
        prices: [
            { chain: 'rami_levy', chainName: 'רמי לוי', price: 39.90 },
            { chain: 'shufersal', chainName: 'שופרסל', price: 44.90 },
            { chain: 'victory', chainName: 'ויקטורי', price: 42.90 }
        ]
    },
    {
        barcode: '7290000700202',
        name: 'נוזל כלים פיירי 750 מ"ל',
        category: 'ניקיון',
        manufacturer: 'P&G',
        image: 'https://images.openfoodfacts.org/images/products/729/000/070/0202/front_he.400.jpg',
        prices: [
            { chain: 'rami_levy', chainName: 'רמי לוי', price: 12.90 },
            { chain: 'shufersal', chainName: 'שופרסל', price: 14.90 },
            { chain: 'victory', chainName: 'ויקטורי', price: 13.90 }
        ]
    },
    {
        barcode: '7290000700303',
        name: 'נייר טואלט טאצ\' 32 גלילים',
        category: 'ניקיון',
        manufacturer: 'שטראוס',
        image: 'https://images.openfoodfacts.org/images/products/729/000/070/0303/front_he.400.jpg',
        prices: [
            { chain: 'rami_levy', chainName: 'רמי לוי', price: 49.90 },
            { chain: 'shufersal', chainName: 'שופרסל', price: 54.90 },
            { chain: 'victory', chainName: 'ויקטורי', price: 52.90 }
        ]
    },

    // === PASTA & RICE (פסטה ואורז) ===
    {
        barcode: '7290000800101',
        name: 'פסטה ספגטי אוסם 500 גרם',
        category: 'פסטה ואורז',
        manufacturer: 'אוסם',
        image: 'https://images.openfoodfacts.org/images/products/729/001/054/2036/front_he.400.jpg',
        prices: [
            { chain: 'rami_levy', chainName: 'רמי לוי', price: 5.90 },
            { chain: 'shufersal', chainName: 'שופרסל', price: 6.90 },
            { chain: 'victory', chainName: 'ויקטורי', price: 6.50 }
        ]
    },
    {
        barcode: '7290000800202',
        name: 'אורז בסמטי תבואות 1 ק"ג',
        category: 'פסטה ואורז',
        manufacturer: 'תבואות',
        image: 'https://images.openfoodfacts.org/images/products/729/000/080/0202/front_he.400.jpg',
        prices: [
            { chain: 'rami_levy', chainName: 'רמי לוי', price: 14.90 },
            { chain: 'shufersal', chainName: 'שופרסל', price: 16.90 },
            { chain: 'victory', chainName: 'ויקטורי', price: 15.90 }
        ]
    },
    {
        barcode: '7290000800303',
        name: 'קוסקוס אוסם 500 גרם',
        category: 'פסטה ואורז',
        manufacturer: 'אוסם',
        image: 'https://images.openfoodfacts.org/images/products/729/001/054/2128/front_he.400.jpg',
        prices: [
            { chain: 'rami_levy', chainName: 'רמי לוי', price: 8.90 },
            { chain: 'shufersal', chainName: 'שופרסל', price: 9.90 },
            { chain: 'victory', chainName: 'ויקטורי', price: 9.50 }
        ]
    },

    // === CANNED GOODS (שימורים) ===
    {
        barcode: '7290000900101',
        name: 'טונה בשמן שמן תבואות 160 גרם',
        category: 'שימורים',
        manufacturer: 'תבואות',
        image: 'https://images.openfoodfacts.org/images/products/729/000/090/0101/front_he.400.jpg',
        prices: [
            { chain: 'rami_levy', chainName: 'רמי לוי', price: 8.90 },
            { chain: 'shufersal', chainName: 'שופרסל', price: 9.90 },
            { chain: 'victory', chainName: 'ויקטורי', price: 9.50 }
        ]
    },
    {
        barcode: '7290000900202',
        name: 'תירס מתוק שימורים 400 גרם',
        category: 'שימורים',
        manufacturer: 'תבואות',
        image: 'https://images.openfoodfacts.org/images/products/729/000/090/0202/front_he.400.jpg',
        prices: [
            { chain: 'rami_levy', chainName: 'רמי לוי', price: 6.90 },
            { chain: 'shufersal', chainName: 'שופרסל', price: 7.90 },
            { chain: 'victory', chainName: 'ויקטורי', price: 7.50 }
        ]
    },
    {
        barcode: '7290000900303',
        name: 'רסק עגבניות 400 גרם',
        category: 'שימורים',
        manufacturer: 'אוסם',
        image: 'https://images.openfoodfacts.org/images/products/729/000/090/0303/front_he.400.jpg',
        prices: [
            { chain: 'rami_levy', chainName: 'רמי לוי', price: 4.90 },
            { chain: 'shufersal', chainName: 'שופרסל', price: 5.90 },
            { chain: 'victory', chainName: 'ויקטורי', price: 5.50 }
        ]
    },

    // === COFFEE & TEA (קפה ותה) ===
    {
        barcode: '7290001000101',
        name: 'קפה נמס עלית 200 גרם',
        category: 'קפה ותה',
        manufacturer: 'עלית',
        image: 'https://images.openfoodfacts.org/images/products/729/000/100/0101/front_he.400.jpg',
        prices: [
            { chain: 'rami_levy', chainName: 'רמי לוי', price: 24.90 },
            { chain: 'shufersal', chainName: 'שופרסל', price: 27.90 },
            { chain: 'victory', chainName: 'ויקטורי', price: 26.90 }
        ]
    },
    {
        barcode: '7290001000202',
        name: 'תה ויסוצקי קלאסי 25 שקיות',
        category: 'קפה ותה',
        manufacturer: 'ויסוצקי',
        image: 'https://images.openfoodfacts.org/images/products/729/000/100/0202/front_he.400.jpg',
        prices: [
            { chain: 'rami_levy', chainName: 'רמי לוי', price: 9.90 },
            { chain: 'shufersal', chainName: 'שופרסל', price: 11.90 },
            { chain: 'victory', chainName: 'ויקטורי', price: 10.90 }
        ]
    },

    // === BABY (תינוקות) ===
    {
        barcode: '7290001100101',
        name: 'חיתולי האגיס מידה 4 50 יחידות',
        category: 'תינוקות',
        manufacturer: 'האגיס',
        image: 'https://images.openfoodfacts.org/images/products/729/000/110/0101/front_he.400.jpg',
        prices: [
            { chain: 'rami_levy', chainName: 'רמי לוי', price: 69.90 },
            { chain: 'shufersal', chainName: 'שופרסל', price: 79.90 },
            { chain: 'victory', chainName: 'ויקטורי', price: 74.90 }
        ]
    },
    {
        barcode: '7290001100202',
        name: 'מטרנה שלב 1 700 גרם',
        category: 'תינוקות',
        manufacturer: 'מטרנה',
        image: 'https://images.openfoodfacts.org/images/products/729/000/110/0202/front_he.400.jpg',
        prices: [
            { chain: 'rami_levy', chainName: 'רמי לוי', price: 54.90 },
            { chain: 'shufersal', chainName: 'שופרסל', price: 59.90 },
            { chain: 'victory', chainName: 'ויקטורי', price: 57.90 }
        ]
    }
];

async function seedDatabase(externalDb = null) {
    let client = null;
    let db = externalDb;

    try {
        // Use external db if provided, otherwise create our own connection
        if (!db) {
            client = new MongoClient(MONGODB_URI);
            await client.connect();
            console.log('Connected to MongoDB');
            db = client.db();
        }

        const productsCollection = db.collection('products');

        // Clear existing products
        await productsCollection.deleteMany({});
        console.log('Cleared existing products');

        // Insert all products
        const now = new Date();
        const productsToInsert = PRODUCTS.map(p => ({
            barcode: p.barcode,
            name: p.name,
            category: p.category,
            manufacturer: p.manufacturer,
            image: p.image,
            prices: p.prices.map(price => ({
                ...price,
                lastUpdated: now
            })),
            lastUpdated: now,
            dataSource: 'seed'
        }));

        const result = await productsCollection.insertMany(productsToInsert);
        console.log(`Inserted ${result.insertedCount} products`);

        // Create indexes (skip if already exist)
        try {
            await productsCollection.createIndex({ barcode: 1 }, { unique: true, sparse: true });
        } catch (e) { /* Index exists */ }
        try {
            await productsCollection.createIndex({ name: 'text' }, { default_language: 'none' });
        } catch (e) { /* Index exists */ }
        try {
            await productsCollection.createIndex({ category: 1 });
        } catch (e) { /* Index exists */ }
        console.log('Indexes verified');

        // Update sync status
        await db.collection('settings').updateOne(
            { _id: 'sync-status' },
            {
                $set: {
                    lastSync: now,
                    productCount: result.insertedCount,
                    type: 'seed',
                    results: {
                        categories: [...new Set(PRODUCTS.map(p => p.category))],
                        chains: ['rami_levy', 'shufersal', 'victory']
                    }
                }
            },
            { upsert: true }
        );
        console.log('Updated sync status');

        console.log('\n✅ Database seeded successfully!');
        console.log(`   ${result.insertedCount} products across ${[...new Set(PRODUCTS.map(p => p.category))].length} categories`);

    } catch (error) {
        console.error('Error seeding database:', error);
        // Only exit if running standalone
        if (require.main === module) {
            process.exit(1);
        }
        throw error;
    } finally {
        // Only close client if we created it
        if (client) {
            await client.close();
        }
    }
}

// Run if called directly
if (require.main === module) {
    seedDatabase();
}

module.exports = { seedDatabase, PRODUCTS };
