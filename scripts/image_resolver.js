/**
 * Multi-source Image Resolver for Products
 *
 * Resolution order:
 *   1. Check imageCache collection (30-day TTL)
 *   2. OpenFoodFacts API by barcode (/api/v2/product/{barcode}.json)
 *   3. Constructed OFF URL with HEAD validation (front_he, front_en, front, 1)
 *   4. OpenFoodFacts name search (cgi/search.pl)
 *   5. Product-specific keyword matching (Hebrew name -> specific product image)
 *   6. Category fallback image (generic category images, last resort)
 */

const https = require('https');
const http = require('http');

// ========================================
// Product-Specific Keyword Images
// ========================================
// Ordered: first match wins. More specific keywords come before general ones.
const PRODUCT_KEYWORD_IMAGES = [
    // Dairy - specific products
    { keywords: ['\u05E7\u05D5\u05D8\u05D2'], image: 'https://images.unsplash.com/photo-1488477181946-6428a0291777?w=200' },          // קוטג -> cottage cheese
    { keywords: ['\u05D2\u05D1\u05D9\u05E0\u05D4 \u05E6\u05D4\u05D5\u05D1\u05D4'], image: 'https://images.unsplash.com/photo-1486297678162-eb2a19b0a32d?w=200' },  // גבינה צהובה -> yellow cheese
    { keywords: ['\u05D2\u05D1\u05D9\u05E0\u05D4 \u05DC\u05D1\u05E0\u05D4', '\u05D2\u05D1\u05D9\u05E0\u05D4 \u05E9\u05DE\u05E0\u05EA'], image: 'https://images.unsplash.com/photo-1559561853-08451507cbe7?w=200' },  // גבינה לבנה / גבינה שמנת -> cream cheese
    { keywords: ['\u05D2\u05D1\u05D9\u05E0\u05D4'], image: 'https://images.unsplash.com/photo-1486297678162-eb2a19b0a32d?w=200' },       // גבינה -> cheese
    { keywords: ['\u05D9\u05D5\u05D2\u05D5\u05E8\u05D8'], image: 'https://images.unsplash.com/photo-1488477181946-6428a0291777?w=200' },   // יוגורט -> yogurt
    { keywords: ['\u05DE\u05E2\u05D3\u05DF'], image: 'https://images.unsplash.com/photo-1488477181946-6428a0291777?w=200' },               // מעדן -> pudding/dessert
    { keywords: ['\u05E9\u05DE\u05E0\u05EA'], image: 'https://images.unsplash.com/photo-1559561853-08451507cbe7?w=200' },                  // שמנת -> cream
    { keywords: ['\u05DC\u05D1\u05DF'], image: 'https://images.unsplash.com/photo-1488477181946-6428a0291777?w=200' },                      // לבן -> leben
    { keywords: ['\u05D7\u05DE\u05D0\u05D4'], image: 'https://images.unsplash.com/photo-1589985270826-4b7bb135bc9d?w=200' },               // חמאה -> butter
    { keywords: ['\u05E9\u05D5\u05E7\u05D5', '\u05E9\u05D5\u05E7\u05D5\u05DC\u05D3 \u05D7\u05DC\u05D1'], image: 'https://images.unsplash.com/photo-1563636619-e9143da7973b?w=200' }, // שוקו -> chocolate milk
    { keywords: ['\u05D7\u05DC\u05D1'], image: 'https://images.unsplash.com/photo-1563636619-e9143da7973b?w=200' },                        // חלב -> milk

    // Bread & bakery
    { keywords: ['\u05E4\u05D9\u05EA\u05D4'], image: 'https://images.unsplash.com/photo-1586075574812-eeea2a490979?w=200' },               // פיתה -> pita
    { keywords: ['\u05D7\u05DC\u05D4'], image: 'https://images.unsplash.com/photo-1509440159596-0249088772ff?w=200' },                      // חלה -> challah
    { keywords: ['\u05DC\u05D7\u05DE\u05E0\u05D9\u05D4', '\u05DC\u05D7\u05DE\u05E0\u05D9\u05D5\u05EA'], image: 'https://images.unsplash.com/photo-1549931319-a545dcf3bc73?w=200' },   // לחמניה -> bun/roll
    { keywords: ['\u05D1\u05D0\u05D2\u05D8'], image: 'https://images.unsplash.com/photo-1585535936540-c5f4cce4d42a?w=200' },               // באגט -> baguette
    { keywords: ['\u05E2\u05D5\u05D2\u05D4', '\u05E2\u05D5\u05D2\u05EA'], image: 'https://images.unsplash.com/photo-1578985545062-69928b1d9587?w=200' },   // עוגה -> cake
    { keywords: ['\u05E2\u05D5\u05D2\u05D9\u05D5\u05EA', '\u05E2\u05D5\u05D2\u05D9\u05D4'], image: 'https://images.unsplash.com/photo-1558961363-fa8fdf82db35?w=200' }, // עוגיות -> cookies
    { keywords: ['\u05DC\u05D7\u05DD'], image: 'https://images.unsplash.com/photo-1549931319-a545dcf3bc73?w=200' },                        // לחם -> bread

    // Eggs
    { keywords: ['\u05D1\u05D9\u05E6\u05D9\u05DD', '\u05D1\u05D9\u05E6\u05D4'], image: 'https://images.unsplash.com/photo-1582722872445-44dc5f7e3c8f?w=200' },   // ביצים -> eggs

    // Meat & poultry
    { keywords: ['\u05E9\u05E0\u05D9\u05E6\u05DC'], image: 'https://images.unsplash.com/photo-1604908176997-125f25cc6f3d?w=200' },         // שניצל -> schnitzel
    { keywords: ['\u05D4\u05DE\u05D1\u05D5\u05E8\u05D2\u05E8'], image: 'https://images.unsplash.com/photo-1568901346375-23c9450c58cd?w=200' }, // המבורגר -> hamburger
    { keywords: ['\u05E0\u05E7\u05E0\u05D9\u05E7', '\u05E0\u05E7\u05E0\u05D9\u05E7\u05D9\u05D5\u05EA'], image: 'https://images.unsplash.com/photo-1558030006-450675393462?w=200' },  // נקניק -> sausage/hotdog
    { keywords: ['\u05DB\u05E8\u05E2\u05D9\u05D9\u05DD'], image: 'https://images.unsplash.com/photo-1527477396000-e27163b481c2?w=200' },   // כרעיים -> drumsticks
    { keywords: ['\u05D7\u05D6\u05D4 \u05E2\u05D5\u05E3', '\u05D7\u05D6\u05D4 \u05D7\u05D6\u05D4'], image: 'https://images.unsplash.com/photo-1604503468506-a8da13d82571?w=200' },  // חזה עוף -> chicken breast
    { keywords: ['\u05E2\u05D5\u05E3'], image: 'https://images.unsplash.com/photo-1587593810167-a84920ea0781?w=200' },                      // עוף -> chicken
    { keywords: ['\u05D1\u05E7\u05E8'], image: 'https://images.unsplash.com/photo-1588347818036-558601350947?w=200' },                      // בקר -> beef
    { keywords: ['\u05D1\u05E9\u05E8'], image: 'https://images.unsplash.com/photo-1607623814075-e51df1bdc82f?w=200' },                      // בשר -> meat

    // Fish
    { keywords: ['\u05E1\u05DC\u05DE\u05D5\u05DF'], image: 'https://images.unsplash.com/photo-1574781330855-d0db8cc6a79c?w=200' },         // סלמון -> salmon
    { keywords: ['\u05D8\u05D5\u05E0\u05D4'], image: 'https://images.unsplash.com/photo-1558642452-9d2a7deb7f62?w=200' },                  // טונה -> tuna
    { keywords: ['\u05D3\u05D2'], image: 'https://images.unsplash.com/photo-1534604973900-c43ab4c2e0ab?w=200' },                            // דג -> fish

    // Fruits & vegetables
    { keywords: ['\u05EA\u05E4\u05D5\u05D7 \u05D0\u05D3\u05DE\u05D4', '\u05EA\u05E4\u05D5\u05D7\u05D9\u05DD'], image: 'https://images.unsplash.com/photo-1560806887-1e4cd0b6cbd6?w=200' },  // תפוח -> apple
    { keywords: ['\u05D1\u05E0\u05E0\u05D4'], image: 'https://images.unsplash.com/photo-1571771894821-ce9b6c11b08e?w=200' },               // בננה -> banana
    { keywords: ['\u05EA\u05E4\u05D5\u05D6', '\u05EA\u05E4\u05D5\u05D6\u05D9\u05DD'], image: 'https://images.unsplash.com/photo-1547514701-42dfc6400d1d?w=200' },  // תפוז -> orange
    { keywords: ['\u05DC\u05D9\u05DE\u05D5\u05DF'], image: 'https://images.unsplash.com/photo-1590502593747-42a996133562?w=200' },          // לימון -> lemon
    { keywords: ['\u05D0\u05D1\u05D5\u05E7\u05D3\u05D5'], image: 'https://images.unsplash.com/photo-1523049673857-eb18f1d7b578?w=200' },   // אבוקדו -> avocado
    { keywords: ['\u05E2\u05D2\u05D1\u05E0\u05D9', '\u05E2\u05D2\u05D1\u05E0\u05D9\u05D5\u05EA'], image: 'https://images.unsplash.com/photo-1546470427-e26264be0b0b?w=200' },  // עגבניה -> tomato
    { keywords: ['\u05DE\u05DC\u05E4\u05E4\u05D5\u05DF'], image: 'https://images.unsplash.com/photo-1449300079323-02e209d9d3a6?w=200' },   // מלפפון -> cucumber
    { keywords: ['\u05D2\u05D6\u05E8'], image: 'https://images.unsplash.com/photo-1598170845058-32b9d6a5da37?w=200' },                      // גזר -> carrot
    { keywords: ['\u05D1\u05E6\u05DC'], image: 'https://images.unsplash.com/photo-1518977956812-cd3dbadaaf31?w=200' },                      // בצל -> onion
    { keywords: ['\u05EA\u05E4\u05D5\u05D7 \u05D0\u05D3\u05DE\u05D4'], image: 'https://images.unsplash.com/photo-1568702846914-96b305d2ead1?w=200' },  // תפוח אדמה -> potato

    // Drinks
    { keywords: ['\u05E7\u05D5\u05DC\u05D4'], image: 'https://images.unsplash.com/photo-1554866585-cd94860890b7?w=200' },                  // קולה -> cola
    { keywords: ['\u05E1\u05E4\u05E8\u05D9\u05D9\u05D8'], image: 'https://images.unsplash.com/photo-1625772299848-391b6a87d7b3?w=200' },   // ספרייט -> sprite/lemon soda
    { keywords: ['\u05DE\u05D9\u05E5 \u05EA\u05E4\u05D5\u05D6\u05D9\u05DD'], image: 'https://images.unsplash.com/photo-1621506289937-a8e4df240d0b?w=200' },  // מיץ תפוזים -> orange juice
    { keywords: ['\u05DE\u05D9\u05E5'], image: 'https://images.unsplash.com/photo-1534353473418-4cfa6c56fd38?w=200' },                      // מיץ -> juice
    { keywords: ['\u05D1\u05D9\u05E8\u05D4'], image: 'https://images.unsplash.com/photo-1535958636474-b021ee887b13?w=200' },                // בירה -> beer
    { keywords: ['\u05D9\u05D9\u05DF'], image: 'https://images.unsplash.com/photo-1510812431401-41d2bd2722f3?w=200' },                      // יין -> wine
    { keywords: ['\u05DE\u05D9\u05DD \u05DE\u05D9\u05E0\u05E8\u05DC\u05D9\u05DD', '\u05DE\u05D9\u05DD \u05DE\u05E2\u05D9\u05D9\u05DF', '\u05E0\u05D1\u05D9\u05E2\u05D5\u05EA'], image: 'https://images.unsplash.com/photo-1548839140-29a749e1cf4d?w=200' },  // מים מינרליים -> water
    { keywords: ['\u05E1\u05D5\u05D3\u05D4'], image: 'https://images.unsplash.com/photo-1625772299848-391b6a87d7b3?w=200' },               // סודה -> soda

    // Snacks
    { keywords: ['\u05D1\u05DE\u05D1\u05D4'], image: 'https://images.unsplash.com/photo-1621447504864-d8686e12698c?w=200' },               // במבה -> peanut snack
    { keywords: ['\u05D1\u05D9\u05E1\u05DC\u05D9'], image: 'https://images.unsplash.com/photo-1566478989037-eec170784d0b?w=200' },         // ביסלי -> pretzel snack
    { keywords: ['\u05E9\u05D5\u05E7\u05D5\u05DC\u05D3'], image: 'https://images.unsplash.com/photo-1511381939415-e44015466834?w=200' },    // שוקולד -> chocolate
    { keywords: ['\u05D5\u05D5\u05E4\u05DC'], image: 'https://images.unsplash.com/photo-1568051243851-f9b136146e97?w=200' },                // וופל -> waffle
    { keywords: ['\u05E1\u05D5\u05DB\u05E8\u05D9\u05D4', '\u05E1\u05D5\u05DB\u05E8\u05D9\u05D5\u05EA'], image: 'https://images.unsplash.com/photo-1581798459219-318e76afafb0?w=200' },  // סוכריה -> candy
    { keywords: ['\u05D2\u05DC\u05D9\u05D3\u05D4'], image: 'https://images.unsplash.com/photo-1497034825429-c343d7c6a68f?w=200' },         // גלידה -> ice cream
    { keywords: ['\u05D7\u05D8\u05D9\u05E3', '\u05E6\u05D9\u05E4\u05E1'], image: 'https://images.unsplash.com/photo-1566478989037-eec170784d0b?w=200' },  // חטיף/ציפס -> chips/snack

    // Pasta, rice, grains
    { keywords: ['\u05E1\u05E4\u05D2\u05D8\u05D9'], image: 'https://images.unsplash.com/photo-1551462147-ff29053bfc14?w=200' },            // ספגטי -> spaghetti
    { keywords: ['\u05E4\u05E1\u05D8\u05D4'], image: 'https://images.unsplash.com/photo-1551462147-ff29053bfc14?w=200' },                  // פסטה -> pasta
    { keywords: ['\u05D0\u05D8\u05E8\u05D9\u05D5\u05EA'], image: 'https://images.unsplash.com/photo-1612929633738-8fe44f7ec841?w=200' },   // אטריות -> noodles
    { keywords: ['\u05D0\u05D5\u05E8\u05D6'], image: 'https://images.unsplash.com/photo-1586201375761-83865001e31c?w=200' },               // אורז -> rice
    { keywords: ['\u05E7\u05D5\u05E1\u05E7\u05D5\u05E1'], image: 'https://images.unsplash.com/photo-1585543805890-6051f7829f98?w=200' },   // קוסקוס -> couscous
    { keywords: ['\u05E4\u05EA\u05D9\u05EA\u05D9\u05DD'], image: 'https://images.unsplash.com/photo-1551462147-ff29053bfc14?w=200' },      // פתיתים -> ptitim

    // Canned goods & pantry
    { keywords: ['\u05E8\u05E1\u05E7 \u05E2\u05D2\u05D1\u05E0\u05D9\u05D5\u05EA'], image: 'https://images.unsplash.com/photo-1472476443507-c7a5948772fc?w=200' },  // רסק עגבניות -> tomato paste
    { keywords: ['\u05D7\u05D5\u05DE\u05D5\u05E1'], image: 'https://images.unsplash.com/photo-1585513553105-31e70ffa0b02?w=200' },         // חומוס -> hummus
    { keywords: ['\u05D8\u05D7\u05D9\u05E0\u05D4'], image: 'https://images.unsplash.com/photo-1590779033100-9f60a05a013d?w=200' },         // טחינה -> tahini
    { keywords: ['\u05E9\u05DE\u05DF \u05D6\u05D9\u05EA'], image: 'https://images.unsplash.com/photo-1474979266404-7eabd7875faf?w=200' },  // שמן זית -> olive oil
    { keywords: ['\u05E9\u05DE\u05DF \u05E7\u05E0\u05D5\u05DC\u05D4', '\u05E9\u05DE\u05DF'], image: 'https://images.unsplash.com/photo-1474979266404-7eabd7875faf?w=200' },  // שמן קנולה -> cooking oil
    { keywords: ['\u05E9\u05D9\u05DE\u05D5\u05E8\u05D9\u05DD'], image: 'https://images.unsplash.com/photo-1584568694244-14fbdf83bd30?w=200' },  // שימורים -> canned food
    { keywords: ['\u05EA\u05D9\u05E8\u05E1'], image: 'https://images.unsplash.com/photo-1551754655-cd27e38d2076?w=200' },                  // תירס -> corn
    { keywords: ['\u05D0\u05E4\u05D5\u05E0\u05D4'], image: 'https://images.unsplash.com/photo-1587735243615-c03f25aaff15?w=200' },         // אפונה -> peas

    // Coffee & tea
    { keywords: ['\u05E7\u05E4\u05E1\u05D5\u05DC\u05D5\u05EA', '\u05E7\u05E4\u05E1\u05D5\u05DC\u05D4'], image: 'https://images.unsplash.com/photo-1514432324607-a09d9b4aefda?w=200' },  // קפסולות -> coffee capsules
    { keywords: ['\u05D0\u05E1\u05E4\u05E8\u05E1\u05D5'], image: 'https://images.unsplash.com/photo-1514432324607-a09d9b4aefda?w=200' },   // אספרסו -> espresso
    { keywords: ['\u05E7\u05E4\u05D4 \u05E0\u05DE\u05E1', '\u05E0\u05E1 \u05E7\u05E4\u05D4', '\u05E7\u05E4\u05D4 \u05E0\u05E1'], image: 'https://images.unsplash.com/photo-1559496417-e7f25cb247f3?w=200' },  // קפה נמס -> instant coffee
    { keywords: ['\u05E7\u05E4\u05D4'], image: 'https://images.unsplash.com/photo-1509042239860-f550ce710b93?w=200' },                      // קפה -> coffee
    { keywords: ['\u05EA\u05D4'], image: 'https://images.unsplash.com/photo-1556679343-c7306c1976bc?w=200' },                               // תה -> tea

    // Cleaning
    { keywords: ['\u05E9\u05DE\u05E4\u05D5'], image: 'https://images.unsplash.com/photo-1585751119414-ef2636f8aede?w=200' },               // שמפו -> shampoo
    { keywords: ['\u05E1\u05D1\u05D5\u05DF'], image: 'https://images.unsplash.com/photo-1600857544200-b2f666a9a2ec?w=200' },               // סבון -> soap
    { keywords: ['\u05D0\u05D1\u05E7\u05EA \u05DB\u05D1\u05D9\u05E1\u05D4', '\u05D0\u05D1\u05E7\u05D4'], image: 'https://images.unsplash.com/photo-1582735689369-4fe89db7114c?w=200' },  // אבקת כביסה -> laundry detergent
    { keywords: ['\u05E0\u05D5\u05D6\u05DC \u05DB\u05DC\u05D9\u05DD'], image: 'https://images.unsplash.com/photo-1585421514738-01798e348b17?w=200' },  // נוזל כלים -> dish soap
    { keywords: ['\u05DE\u05D8\u05DC\u05D9\u05D5\u05EA', '\u05DE\u05D2\u05D1\u05D5\u05E0\u05D9\u05DD'], image: 'https://images.unsplash.com/photo-1583947215259-38e31be8751f?w=200' },  // מטליות/מגבונים -> wipes
    { keywords: ['\u05E0\u05D9\u05D9\u05E8 \u05D8\u05D5\u05D0\u05DC\u05D8'], image: 'https://images.unsplash.com/photo-1584556812952-905ffd0c611a?w=200' },  // נייר טואלט -> toilet paper

    // Baby
    { keywords: ['\u05D7\u05D9\u05EA\u05D5\u05DC\u05D9\u05DD'], image: 'https://images.unsplash.com/photo-1544367567-0f2fcb009e0b?w=200' },  // חיתולים -> diapers
    { keywords: ['\u05DE\u05D8\u05E8\u05E0\u05D4', '\u05E1\u05D9\u05DE\u05D9\u05DC\u05D0\u05E7'], image: 'https://images.unsplash.com/photo-1515488042361-ee00e0ddd4e4?w=200' },  // מטרנה/סימילאק -> baby formula

    // Other common items
    { keywords: ['\u05E7\u05D5\u05E8\u05E0\u05E4\u05DC\u05E7\u05E1', '\u05D3\u05D2\u05E0\u05D9 \u05D1\u05D5\u05E7\u05E8'], image: 'https://images.unsplash.com/photo-1521483451569-e33803c0330c?w=200' },  // קורנפלקס -> cereal
    { keywords: ['\u05E1\u05D5\u05DB\u05E8'], image: 'https://images.unsplash.com/photo-1581268559468-79decf4956b4?w=200' },               // סוכר -> sugar
    { keywords: ['\u05E7\u05DE\u05D7'], image: 'https://images.unsplash.com/photo-1509440159596-0249088772ff?w=200' },                      // קמח -> flour
    { keywords: ['\u05DE\u05DC\u05D7'], image: 'https://images.unsplash.com/photo-1518110925495-5fe2fda0442c?w=200' },                      // מלח -> salt
];

// ========================================
// Category Fallback Images (generic, last resort)
// ========================================
const CATEGORY_FALLBACK_IMAGES = {
    '\u05DE\u05D5\u05E6\u05E8\u05D9 \u05D7\u05DC\u05D1': 'https://images.unsplash.com/photo-1550583724-b2692b85b150?w=200',
    '\u05DC\u05D7\u05DD \u05D5\u05DE\u05D0\u05E4\u05D9\u05DD': 'https://images.unsplash.com/photo-1509440159596-0249088772ff?w=200',
    '\u05D1\u05D9\u05E6\u05D9\u05DD': 'https://images.unsplash.com/photo-1582722872445-44dc5f7e3c8f?w=200',
    '\u05D1\u05E9\u05E8 \u05D5\u05E2\u05D5\u05E3': 'https://images.unsplash.com/photo-1607623814075-e51df1bdc82f?w=200',
    '\u05D1\u05E9\u05E8 \u05D5\u05D3\u05D2\u05D9\u05DD': 'https://images.unsplash.com/photo-1607623814075-e51df1bdc82f?w=200',
    '\u05D3\u05D2\u05D9\u05DD': 'https://images.unsplash.com/photo-1534604973900-c43ab4c2e0ab?w=200',
    '\u05E4\u05D9\u05E8\u05D5\u05EA \u05D5\u05D9\u05E8\u05E7\u05D5\u05EA': 'https://images.unsplash.com/photo-1610832958506-aa56368176cf?w=200',
    '\u05DE\u05E9\u05E7\u05D0\u05D5\u05EA': 'https://images.unsplash.com/photo-1534353473418-4cfa6c56fd38?w=200',
    '\u05E9\u05EA\u05D9\u05D9\u05D4': 'https://images.unsplash.com/photo-1534353473418-4cfa6c56fd38?w=200',
    '\u05D7\u05D8\u05D9\u05E4\u05D9\u05DD': 'https://images.unsplash.com/photo-1621939514649-280e2ee25f60?w=200',
    '\u05E0\u05D9\u05E7\u05D9\u05D5\u05DF': 'https://images.unsplash.com/photo-1563453392212-326f5e854473?w=200',
    '\u05DE\u05D5\u05E6\u05E8\u05D9 \u05E0\u05D9\u05E7\u05D9\u05D5\u05DF': 'https://images.unsplash.com/photo-1563453392212-326f5e854473?w=200',
    '\u05E4\u05E1\u05D8\u05D4 \u05D5\u05D0\u05D5\u05E8\u05D6': 'https://images.unsplash.com/photo-1551462147-ff29053bfc14?w=200',
    '\u05E9\u05D9\u05DE\u05D5\u05E8\u05D9\u05DD': 'https://images.unsplash.com/photo-1584568694244-14fbdf83bd30?w=200',
    '\u05E7\u05E4\u05D4 \u05D5\u05EA\u05D4': 'https://images.unsplash.com/photo-1509042239860-f550ce710b93?w=200',
    '\u05EA\u05D9\u05E0\u05D5\u05E7\u05D5\u05EA': 'https://images.unsplash.com/photo-1515488042361-ee00e0ddd4e4?w=200',
    '\u05DB\u05DC\u05DC\u05D9': 'https://images.unsplash.com/photo-1542838132-92c53300491e?w=200',
    '\u05DE\u05D6\u05D5\u05DF \u05DB\u05DC\u05DC\u05D9': 'https://images.unsplash.com/photo-1542838132-92c53300491e?w=200',
    '\u05D0\u05D7\u05E8': 'https://images.unsplash.com/photo-1542838132-92c53300491e?w=200',
};

const DEFAULT_FALLBACK = 'https://images.unsplash.com/photo-1542838132-92c53300491e?w=200';

// 30-day TTL in milliseconds
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

// ========================================
// HTTP HEAD validation
// ========================================
function validateImageUrl(url) {
    return new Promise((resolve) => {
        if (!url) return resolve(false);

        try {
            const urlObj = new URL(url);
            const protocol = urlObj.protocol === 'https:' ? https : http;

            const req = protocol.request({
                hostname: urlObj.hostname,
                port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
                path: urlObj.pathname + urlObj.search,
                method: 'HEAD',
                timeout: 8000,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (compatible; BudgetManager/1.0)'
                }
            }, (res) => {
                const contentType = res.headers['content-type'] || '';
                resolve(res.statusCode === 200 && contentType.startsWith('image/'));
            });

            req.on('error', () => resolve(false));
            req.on('timeout', () => {
                req.destroy();
                resolve(false);
            });
            req.end();
        } catch {
            resolve(false);
        }
    });
}

// ========================================
// Fetch helper for GET requests
// ========================================
function httpGet(url, timeout = 10000) {
    return new Promise((resolve, reject) => {
        const urlObj = new URL(url);
        const protocol = urlObj.protocol === 'https:' ? https : http;

        const req = protocol.get({
            hostname: urlObj.hostname,
            port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
            path: urlObj.pathname + urlObj.search,
            timeout,
            headers: {
                'User-Agent': 'Mozilla/5.0 (compatible; BudgetManager/1.0)',
                'Accept': 'application/json'
            }
        }, (res) => {
            if (res.statusCode !== 200) {
                res.resume();
                return reject(new Error(`HTTP ${res.statusCode}`));
            }
            const chunks = [];
            res.on('data', chunk => chunks.push(chunk));
            res.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
            res.on('error', reject);
        });

        req.on('error', reject);
        req.on('timeout', () => {
            req.destroy();
            reject(new Error('Timeout'));
        });
    });
}

// ========================================
// OpenFoodFacts API lookup
// ========================================
async function lookupOpenFoodFacts(barcode) {
    try {
        const url = `https://world.openfoodfacts.org/api/v2/product/${barcode}.json`;
        const response = await httpGet(url);
        const data = JSON.parse(response);

        if (data.status === 1 && data.product) {
            return data.product.image_front_url ||
                   data.product.image_url ||
                   data.product.image_small_url ||
                   null;
        }
        return null;
    } catch {
        return null;
    }
}

// ========================================
// Constructed OFF URL variants
// ========================================
function buildOffUrls(barcode) {
    if (!barcode || barcode.length < 12) return [];

    const padded = barcode.padStart(13, '0');
    const base = `https://images.openfoodfacts.org/images/products/${padded.slice(0,3)}/${padded.slice(3,6)}/${padded.slice(6,9)}/${padded.slice(9)}`;

    return [
        `${base}/front_he.400.jpg`,
        `${base}/front_en.400.jpg`,
        `${base}/front.400.jpg`,
        `${base}/1.400.jpg`,
    ];
}

// ========================================
// OpenFoodFacts name search
// ========================================
async function searchOpenFoodFactsByName(productName) {
    if (!productName) return null;
    try {
        // Search OFF with the product name, filtered to Israel
        const query = encodeURIComponent(productName);
        const url = `https://world.openfoodfacts.org/cgi/search.pl?search_terms=${query}&search_simple=1&action=process&json=1&page_size=3&countries_tags_en=israel`;
        const response = await httpGet(url, 8000);
        const data = JSON.parse(response);

        if (data.count > 0 && data.products) {
            for (const product of data.products) {
                const imageUrl = product.image_front_url || product.image_url;
                if (imageUrl) return imageUrl;
            }
        }
        return null;
    } catch {
        return null;
    }
}

// ========================================
// Product-specific keyword image matching
// ========================================
function getProductSpecificImage(productName) {
    if (!productName) return null;
    const lower = productName.toLowerCase();

    for (const entry of PRODUCT_KEYWORD_IMAGES) {
        for (const keyword of entry.keywords) {
            if (lower.includes(keyword)) {
                return entry.image;
            }
        }
    }
    return null;
}

// ========================================
// Main Resolution Function
// ========================================

/**
 * Resolve a product image from multiple sources.
 * @param {Object} db - MongoDB db instance
 * @param {string} barcode - Product barcode
 * @param {string} [productName] - Product name for keyword/search matching
 * @param {string} [category] - Product category for fallback
 * @returns {Promise<string>} - Resolved image URL
 */
async function resolveProductImage(db, barcode, productName, category) {
    // 1. Check cache (only use non-fallback cached entries, or fallback if no name available)
    if (db) {
        try {
            const cached = await db.collection('imageCache').findOne({ barcode });
            if (cached && cached.imageUrl) {
                const age = Date.now() - (cached.validatedAt ? cached.validatedAt.getTime() : 0);
                if (age < CACHE_TTL_MS) {
                    // If it was a product-specific or real image, use it
                    // If it was a generic category-fallback, skip and re-resolve if we have a product name
                    if (cached.source !== 'category-fallback') {
                        return cached.imageUrl;
                    }
                }
            }
        } catch {
            // Cache miss or collection doesn't exist yet
        }
    }

    // 2. OpenFoodFacts API by barcode
    const offImage = await lookupOpenFoodFacts(barcode);
    if (offImage) {
        const valid = await validateImageUrl(offImage);
        if (valid) {
            await cacheImage(db, barcode, offImage, 'openfoodfacts-api');
            return offImage;
        }
    }

    // 3. Constructed OFF URLs
    const offUrls = buildOffUrls(barcode);
    for (const url of offUrls) {
        const valid = await validateImageUrl(url);
        if (valid) {
            await cacheImage(db, barcode, url, 'openfoodfacts-constructed');
            return url;
        }
    }

    // 4. OpenFoodFacts name search
    const nameImage = await searchOpenFoodFactsByName(productName);
    if (nameImage) {
        const valid = await validateImageUrl(nameImage);
        if (valid) {
            await cacheImage(db, barcode, nameImage, 'openfoodfacts-name-search');
            return nameImage;
        }
    }

    // 5. Product-specific keyword matching
    const keywordImage = getProductSpecificImage(productName);
    if (keywordImage) {
        await cacheImage(db, barcode, keywordImage, 'product-keyword');
        return keywordImage;
    }

    // 6. Category fallback (last resort)
    const fallback = getCategoryFallback(category);
    await cacheImage(db, barcode, fallback, 'category-fallback');
    return fallback;
}

/**
 * Get fallback image URL. Tries product-specific keyword match first, then generic category.
 */
function getCategoryFallback(category, productName) {
    // Try product-specific match first
    const specific = getProductSpecificImage(productName);
    if (specific) return specific;

    return CATEGORY_FALLBACK_IMAGES[category] || DEFAULT_FALLBACK;
}

/**
 * Store resolved image URL in cache.
 */
async function cacheImage(db, barcode, imageUrl, source) {
    if (!db) return;
    try {
        await db.collection('imageCache').updateOne(
            { barcode },
            {
                $set: {
                    barcode,
                    imageUrl,
                    source,
                    validatedAt: new Date()
                }
            },
            { upsert: true }
        );
    } catch {
        // Non-critical, ignore cache write errors
    }
}

/**
 * Batch resolve images for products missing them.
 * @param {Object} db - MongoDB db instance
 * @param {number} [limit=200] - Max products to process
 * @returns {{ resolved: number, failed: number }}
 */
async function resolveImagesForProducts(db, limit = 200) {
    const stats = { resolved: 0, failed: 0 };

    try {
        // Find products with no image or empty image
        const products = await db.collection('products')
            .find({
                $or: [
                    { image: { $exists: false } },
                    { image: null },
                    { image: '' }
                ]
            })
            .limit(limit)
            .toArray();

        console.log(`[image_resolver] Resolving images for ${products.length} products...`);

        for (const product of products) {
            try {
                const imageUrl = await resolveProductImage(
                    db,
                    product.barcode,
                    product.name,
                    product.category
                );

                if (imageUrl) {
                    await db.collection('products').updateOne(
                        { _id: product._id },
                        { $set: { image: imageUrl } }
                    );
                    stats.resolved++;
                } else {
                    stats.failed++;
                }
            } catch {
                stats.failed++;
            }
        }

        console.log(`[image_resolver] Done: ${stats.resolved} resolved, ${stats.failed} failed`);
    } catch (error) {
        console.error('[image_resolver] Batch resolve error:', error.message);
    }

    return stats;
}

/**
 * Validate and refresh stale cached images.
 * @param {Object} db - MongoDB db instance
 * @param {number} [limit=500] - Max cache entries to check
 * @returns {{ checked: number, refreshed: number, removed: number }}
 */
async function validateAndRefreshImages(db, limit = 500) {
    const stats = { checked: 0, refreshed: 0, removed: 0 };

    try {
        const staleDate = new Date(Date.now() - CACHE_TTL_MS);
        const staleEntries = await db.collection('imageCache')
            .find({
                $or: [
                    { validatedAt: { $lt: staleDate } },
                    { validatedAt: { $exists: false } }
                ]
            })
            .limit(limit)
            .toArray();

        console.log(`[image_resolver] Validating ${staleEntries.length} stale image cache entries...`);

        for (const entry of staleEntries) {
            stats.checked++;

            // Skip category fallbacks - they don't need validation
            if (entry.source === 'category-fallback') {
                await db.collection('imageCache').updateOne(
                    { _id: entry._id },
                    { $set: { validatedAt: new Date() } }
                );
                continue;
            }

            const valid = await validateImageUrl(entry.imageUrl);
            if (valid) {
                await db.collection('imageCache').updateOne(
                    { _id: entry._id },
                    { $set: { validatedAt: new Date() } }
                );
                stats.refreshed++;
            } else {
                // Image gone, remove cache entry so it gets re-resolved
                await db.collection('imageCache').deleteOne({ _id: entry._id });
                // Also clear the product's image so it gets resolved again
                await db.collection('products').updateOne(
                    { barcode: entry.barcode },
                    { $set: { image: null } }
                );
                stats.removed++;
            }
        }

        console.log(`[image_resolver] Validation done: ${stats.checked} checked, ${stats.refreshed} refreshed, ${stats.removed} removed`);
    } catch (error) {
        console.error('[image_resolver] Validation error:', error.message);
    }

    return stats;
}

module.exports = {
    CATEGORY_FALLBACK_IMAGES,
    resolveProductImage,
    validateImageUrl,
    resolveImagesForProducts,
    validateAndRefreshImages,
    getCategoryFallback
};
