/**
 * Multi-source Image Resolver for Products
 *
 * Resolution order:
 *   1. Check imageCache collection (30-day TTL)
 *   2. OpenFoodFacts API by barcode (/api/v2/product/{barcode}.json)
 *   3. Constructed OFF URL with HEAD validation (front_he, front_en, front, 1)
 *   4. OpenFoodFacts name search (cgi/search.pl)
 *   5. Product-specific keyword matching (Hebrew name -> verified Wikimedia Commons image)
 *   6. Category fallback image (generic category images, last resort)
 */

const https = require('https');
const http = require('http');

// ========================================
// Product-Specific Keyword Images
// ========================================
// All images are verified Wikimedia Commons URLs with descriptive filenames.
// Ordered: first match wins. More specific keywords come before general ones.
const PRODUCT_KEYWORD_IMAGES = [
    // Dairy - specific products
    { keywords: ['\u05E7\u05D5\u05D8\u05D2'], image: 'https://upload.wikimedia.org/wikipedia/commons/thumb/2/24/Tvorog.jpg/300px-Tvorog.jpg' },          // קוטג -> cottage cheese
    { keywords: ['\u05D2\u05D1\u05D9\u05E0\u05D4 \u05E6\u05D4\u05D5\u05D1\u05D4'], image: 'https://upload.wikimedia.org/wikipedia/commons/thumb/8/81/Emmental_015.jpg/300px-Emmental_015.jpg' },  // גבינה צהובה -> yellow cheese
    { keywords: ['\u05D2\u05D1\u05D9\u05E0\u05D4 \u05DC\u05D1\u05E0\u05D4', '\u05D2\u05D1\u05D9\u05E0\u05D4 \u05E9\u05DE\u05E0\u05EA'], image: 'https://upload.wikimedia.org/wikipedia/commons/thumb/d/de/NCI_cream_cheese_bagel.jpg/300px-NCI_cream_cheese_bagel.jpg' },  // גבינה לבנה / גבינה שמנת -> cream cheese
    { keywords: ['\u05D2\u05D1\u05D9\u05E0\u05D4'], image: 'https://upload.wikimedia.org/wikipedia/commons/thumb/8/81/Emmental_015.jpg/300px-Emmental_015.jpg' },       // גבינה -> cheese
    { keywords: ['\u05D9\u05D5\u05D2\u05D5\u05E8\u05D8'], image: 'https://upload.wikimedia.org/wikipedia/commons/thumb/b/b8/Joghurt.jpg/300px-Joghurt.jpg' },   // יוגורט -> yogurt
    { keywords: ['\u05DE\u05E2\u05D3\u05DF'], image: 'https://upload.wikimedia.org/wikipedia/commons/thumb/b/b8/Joghurt.jpg/300px-Joghurt.jpg' },               // מעדן -> pudding/dessert
    { keywords: ['\u05E9\u05DE\u05E0\u05EA'], image: 'https://upload.wikimedia.org/wikipedia/commons/thumb/d/de/NCI_cream_cheese_bagel.jpg/300px-NCI_cream_cheese_bagel.jpg' },  // שמנת -> cream
    { keywords: ['\u05DC\u05D1\u05DF'], image: 'https://upload.wikimedia.org/wikipedia/commons/thumb/b/b8/Joghurt.jpg/300px-Joghurt.jpg' },                      // לבן -> leben
    { keywords: ['\u05D7\u05DE\u05D0\u05D4'], image: 'https://upload.wikimedia.org/wikipedia/commons/thumb/f/fd/Western-pack-butter.jpg/300px-Western-pack-butter.jpg' },  // חמאה -> butter
    { keywords: ['\u05E9\u05D5\u05E7\u05D5', '\u05E9\u05D5\u05E7\u05D5\u05DC\u05D3 \u05D7\u05DC\u05D1'], image: 'https://upload.wikimedia.org/wikipedia/commons/thumb/4/46/Chocolate_milk.jpg/300px-Chocolate_milk.jpg' }, // שוקו -> chocolate milk
    { keywords: ['\u05D7\u05DC\u05D1'], image: 'https://upload.wikimedia.org/wikipedia/commons/thumb/0/0e/Milk_glass.jpg/300px-Milk_glass.jpg' },                // חלב -> milk

    // Bread & bakery
    { keywords: ['\u05E4\u05D9\u05EA\u05D4'], image: 'https://upload.wikimedia.org/wikipedia/commons/thumb/0/0f/Pita.jpg/300px-Pita.jpg' },                     // פיתה -> pita
    { keywords: ['\u05D7\u05DC\u05D4'], image: 'https://upload.wikimedia.org/wikipedia/commons/thumb/9/91/Challah.jpg/300px-Challah.jpg' },                      // חלה -> challah
    { keywords: ['\u05DC\u05D7\u05DE\u05E0\u05D9\u05D4', '\u05DC\u05D7\u05DE\u05E0\u05D9\u05D5\u05EA'], image: 'https://upload.wikimedia.org/wikipedia/commons/thumb/6/61/Bread_rolls.jpg/300px-Bread_rolls.jpg' },   // לחמניה -> bun/roll
    { keywords: ['\u05D1\u05D0\u05D2\u05D8'], image: 'https://upload.wikimedia.org/wikipedia/commons/thumb/6/65/French_bread_DSC09293.jpg/300px-French_bread_DSC09293.jpg' },  // באגט -> baguette
    { keywords: ['\u05E2\u05D5\u05D2\u05D4', '\u05E2\u05D5\u05D2\u05EA'], image: 'https://upload.wikimedia.org/wikipedia/commons/thumb/0/04/Pound_layer_cake.jpg/300px-Pound_layer_cake.jpg' },   // עוגה -> cake
    { keywords: ['\u05E2\u05D5\u05D2\u05D9\u05D5\u05EA', '\u05E2\u05D5\u05D2\u05D9\u05D4'], image: 'https://upload.wikimedia.org/wikipedia/commons/thumb/5/50/Chocolate_chip_cookies.jpg/300px-Chocolate_chip_cookies.jpg' }, // עוגיות -> cookies
    { keywords: ['\u05DC\u05D7\u05DD'], image: 'https://upload.wikimedia.org/wikipedia/commons/thumb/7/71/Anadama_bread_%281%29.jpg/300px-Anadama_bread_%281%29.jpg' },  // לחם -> bread

    // Eggs
    { keywords: ['\u05D1\u05D9\u05E6\u05D9\u05DD', '\u05D1\u05D9\u05E6\u05D4'], image: 'https://upload.wikimedia.org/wikipedia/commons/thumb/5/5e/Chicken_egg_2009-06-04.jpg/300px-Chicken_egg_2009-06-04.jpg' },   // ביצים -> eggs

    // Meat & poultry
    { keywords: ['\u05E9\u05E0\u05D9\u05E6\u05DC'], image: 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/ae/Wiener-Schnitzel02.jpg/300px-Wiener-Schnitzel02.jpg' },  // שניצל -> schnitzel
    { keywords: ['\u05D4\u05DE\u05D1\u05D5\u05E8\u05D2\u05E8'], image: 'https://upload.wikimedia.org/wikipedia/commons/thumb/e/e8/Hamburger_sandwich.jpg/300px-Hamburger_sandwich.jpg' }, // המבורגר -> hamburger
    { keywords: ['\u05E0\u05E7\u05E0\u05D9\u05E7', '\u05E0\u05E7\u05E0\u05D9\u05E7\u05D9\u05D5\u05EA'], image: 'https://upload.wikimedia.org/wikipedia/commons/thumb/b/b1/Hot_dog_with_mustard.png/300px-Hot_dog_with_mustard.png' },  // נקניק -> sausage/hotdog
    { keywords: ['\u05DB\u05E8\u05E2\u05D9\u05D9\u05DD'], image: 'https://upload.wikimedia.org/wikipedia/commons/thumb/2/2b/Roasted_chicken_leg.jpg/300px-Roasted_chicken_leg.jpg' },  // כרעיים -> drumsticks
    { keywords: ['\u05D7\u05D6\u05D4 \u05E2\u05D5\u05E3', '\u05D7\u05D6\u05D4 \u05D7\u05D6\u05D4'], image: 'https://upload.wikimedia.org/wikipedia/commons/thumb/d/d8/Chicken_schnitzel.jpg/300px-Chicken_schnitzel.jpg' },  // חזה עוף -> chicken breast
    { keywords: ['\u05E2\u05D5\u05E3'], image: 'https://upload.wikimedia.org/wikipedia/commons/thumb/2/21/Grilled_chicken.jpg/300px-Grilled_chicken.jpg' },      // עוף -> chicken
    { keywords: ['\u05D1\u05E7\u05E8'], image: 'https://upload.wikimedia.org/wikipedia/commons/thumb/3/36/Steak_03_bg_040306.jpg/300px-Steak_03_bg_040306.jpg' },  // בקר -> beef
    { keywords: ['\u05D1\u05E9\u05E8'], image: 'https://upload.wikimedia.org/wikipedia/commons/thumb/6/60/Standing-rib-roast.jpg/300px-Standing-rib-roast.jpg' },  // בשר -> meat

    // Fish
    { keywords: ['\u05E1\u05DC\u05DE\u05D5\u05DF'], image: 'https://upload.wikimedia.org/wikipedia/commons/thumb/d/d6/Salmon_sashimi.jpg/300px-Salmon_sashimi.jpg' },  // סלמון -> salmon
    { keywords: ['\u05D8\u05D5\u05E0\u05D4'], image: 'https://upload.wikimedia.org/wikipedia/commons/thumb/b/bc/Tuna_steak.JPG/300px-Tuna_steak.JPG' },          // טונה -> tuna
    { keywords: ['\u05D3\u05D2'], image: 'https://upload.wikimedia.org/wikipedia/commons/thumb/4/48/Tilapia_fish.jpg/300px-Tilapia_fish.jpg' },                    // דג -> fish

    // Fruits & vegetables
    { keywords: ['\u05EA\u05E4\u05D5\u05D7 \u05D0\u05D3\u05DE\u05D4'], image: 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Patates.jpg/300px-Patates.jpg' },  // תפוח אדמה -> potato
    { keywords: ['\u05EA\u05E4\u05D5\u05D7\u05D9\u05DD', '\u05EA\u05E4\u05D5\u05D7'], image: 'https://upload.wikimedia.org/wikipedia/commons/thumb/c/c1/Fuji_apple.jpg/300px-Fuji_apple.jpg' },  // תפוחים -> apple
    { keywords: ['\u05D1\u05E0\u05E0\u05D4'], image: 'https://upload.wikimedia.org/wikipedia/commons/thumb/8/8a/Banana-Single.jpg/300px-Banana-Single.jpg' },    // בננה -> banana
    { keywords: ['\u05EA\u05E4\u05D5\u05D6', '\u05EA\u05E4\u05D5\u05D6\u05D9\u05DD'], image: 'https://upload.wikimedia.org/wikipedia/commons/thumb/c/c4/Orange-Fruit-Pieces.jpg/300px-Orange-Fruit-Pieces.jpg' },  // תפוז -> orange
    { keywords: ['\u05DC\u05D9\u05DE\u05D5\u05DF'], image: 'https://upload.wikimedia.org/wikipedia/commons/thumb/e/e4/Lemon.jpg/300px-Lemon.jpg' },              // לימון -> lemon
    { keywords: ['\u05D0\u05D1\u05D5\u05E7\u05D3\u05D5'], image: 'https://upload.wikimedia.org/wikipedia/commons/thumb/c/c9/Avocado_Hass_-_single_and_halved.jpg/300px-Avocado_Hass_-_single_and_halved.jpg' },  // אבוקדו -> avocado
    { keywords: ['\u05E2\u05D2\u05D1\u05E0\u05D9', '\u05E2\u05D2\u05D1\u05E0\u05D9\u05D5\u05EA'], image: 'https://upload.wikimedia.org/wikipedia/commons/thumb/8/88/Bright_red_tomato_and_cross_section02.jpg/300px-Bright_red_tomato_and_cross_section02.jpg' },  // עגבניה -> tomato
    { keywords: ['\u05DE\u05DC\u05E4\u05E4\u05D5\u05DF'], image: 'https://upload.wikimedia.org/wikipedia/commons/thumb/e/ed/Cucumber_and_cross_section.jpg/300px-Cucumber_and_cross_section.jpg' },  // מלפפון -> cucumber
    { keywords: ['\u05D2\u05D6\u05E8'], image: 'https://upload.wikimedia.org/wikipedia/commons/thumb/b/bd/13-08-31-wien-redaktionstreffen-EuT-by-Bi-frie-037.jpg/300px-13-08-31-wien-redaktionstreffen-EuT-by-Bi-frie-037.jpg' },  // גזר -> carrot
    { keywords: ['\u05D1\u05E6\u05DC'], image: 'https://upload.wikimedia.org/wikipedia/commons/thumb/9/93/Onion.jpg/300px-Onion.jpg' },                          // בצל -> onion

    // Drinks
    { keywords: ['\u05E7\u05D5\u05DC\u05D4'], image: 'https://upload.wikimedia.org/wikipedia/commons/thumb/1/1f/Soda_bubbles_macro.jpg/300px-Soda_bubbles_macro.jpg' },  // קולה -> cola
    { keywords: ['\u05E1\u05E4\u05E8\u05D9\u05D9\u05D8'], image: 'https://upload.wikimedia.org/wikipedia/commons/thumb/1/1f/Soda_bubbles_macro.jpg/300px-Soda_bubbles_macro.jpg' },  // ספרייט -> sprite
    { keywords: ['\u05DE\u05D9\u05E5 \u05EA\u05E4\u05D5\u05D6\u05D9\u05DD'], image: 'https://upload.wikimedia.org/wikipedia/commons/thumb/0/05/Orangejuice.jpg/300px-Orangejuice.jpg' },  // מיץ תפוזים -> orange juice
    { keywords: ['\u05DE\u05D9\u05E5'], image: 'https://upload.wikimedia.org/wikipedia/commons/thumb/0/05/Orangejuice.jpg/300px-Orangejuice.jpg' },               // מיץ -> juice
    { keywords: ['\u05D1\u05D9\u05E8\u05D4'], image: 'https://upload.wikimedia.org/wikipedia/commons/thumb/e/e3/NCI_Visuals_Food_Beer.jpg/300px-NCI_Visuals_Food_Beer.jpg' },  // בירה -> beer
    { keywords: ['\u05D9\u05D9\u05DF'], image: 'https://upload.wikimedia.org/wikipedia/commons/thumb/c/c0/Red_Wine_Glass.jpg/300px-Red_Wine_Glass.jpg' },          // יין -> wine
    { keywords: ['\u05DE\u05D9\u05DD \u05DE\u05D9\u05E0\u05E8\u05DC\u05D9\u05DD', '\u05DE\u05D9\u05DD \u05DE\u05E2\u05D9\u05D9\u05DF', '\u05E0\u05D1\u05D9\u05E2\u05D5\u05EA'], image: 'https://upload.wikimedia.org/wikipedia/commons/thumb/9/91/Sparkling_water.jpg/300px-Sparkling_water.jpg' },  // מים מינרליים -> water
    { keywords: ['\u05E1\u05D5\u05D3\u05D4'], image: 'https://upload.wikimedia.org/wikipedia/commons/thumb/1/1f/Soda_bubbles_macro.jpg/300px-Soda_bubbles_macro.jpg' },  // סודה -> soda

    // Snacks
    { keywords: ['\u05D1\u05DE\u05D1\u05D4'], image: 'https://upload.wikimedia.org/wikipedia/commons/thumb/1/11/Bamba_snack.jpg/300px-Bamba_snack.jpg' },         // במבה -> bamba
    { keywords: ['\u05D1\u05D9\u05E1\u05DC\u05D9'], image: 'https://upload.wikimedia.org/wikipedia/commons/thumb/6/69/Potato-Chips.jpg/300px-Potato-Chips.jpg' }, // ביסלי -> chips snack
    { keywords: ['\u05E9\u05D5\u05E7\u05D5\u05DC\u05D3'], image: 'https://upload.wikimedia.org/wikipedia/commons/thumb/f/f2/Chocolate.jpg/300px-Chocolate.jpg' },  // שוקולד -> chocolate
    { keywords: ['\u05D5\u05D5\u05E4\u05DC'], image: 'https://upload.wikimedia.org/wikipedia/commons/thumb/5/5b/Waffles_with_Strawberries.jpg/300px-Waffles_with_Strawberries.jpg' },  // וופל -> waffle
    { keywords: ['\u05E1\u05D5\u05DB\u05E8\u05D9\u05D4', '\u05E1\u05D5\u05DB\u05E8\u05D9\u05D5\u05EA'], image: 'https://upload.wikimedia.org/wikipedia/commons/thumb/1/10/Candy_in_Damascus.jpg/300px-Candy_in_Damascus.jpg' },  // סוכריה -> candy
    { keywords: ['\u05D2\u05DC\u05D9\u05D3\u05D4'], image: 'https://upload.wikimedia.org/wikipedia/commons/thumb/8/86/Ice_cream_cone.jpg/300px-Ice_cream_cone.jpg' },  // גלידה -> ice cream
    { keywords: ['\u05D7\u05D8\u05D9\u05E3', '\u05E6\u05D9\u05E4\u05E1'], image: 'https://upload.wikimedia.org/wikipedia/commons/thumb/6/69/Potato-Chips.jpg/300px-Potato-Chips.jpg' },  // חטיף/ציפס -> chips/snack

    // Pasta, rice, grains
    { keywords: ['\u05E1\u05E4\u05D2\u05D8\u05D9'], image: 'https://upload.wikimedia.org/wikipedia/commons/thumb/9/98/Spaghetti-prepared.jpg/300px-Spaghetti-prepared.jpg' },  // ספגטי -> spaghetti
    { keywords: ['\u05E4\u05E1\u05D8\u05D4'], image: 'https://upload.wikimedia.org/wikipedia/commons/thumb/9/98/Spaghetti-prepared.jpg/300px-Spaghetti-prepared.jpg' },  // פסטה -> pasta
    { keywords: ['\u05D0\u05D8\u05E8\u05D9\u05D5\u05EA'], image: 'https://upload.wikimedia.org/wikipedia/commons/thumb/9/98/Spaghetti-prepared.jpg/300px-Spaghetti-prepared.jpg' },  // אטריות -> noodles
    { keywords: ['\u05D0\u05D5\u05E8\u05D6'], image: 'https://upload.wikimedia.org/wikipedia/commons/thumb/c/cf/Basmati_Rice.jpg/300px-Basmati_Rice.jpg' },      // אורז -> rice
    { keywords: ['\u05E7\u05D5\u05E1\u05E7\u05D5\u05E1'], image: 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/a4/Couscous-1.jpg/300px-Couscous-1.jpg' },  // קוסקוס -> couscous
    { keywords: ['\u05E4\u05EA\u05D9\u05EA\u05D9\u05DD'], image: 'https://upload.wikimedia.org/wikipedia/commons/thumb/9/98/Spaghetti-prepared.jpg/300px-Spaghetti-prepared.jpg' },  // פתיתים -> ptitim

    // Canned goods & pantry
    { keywords: ['\u05E8\u05E1\u05E7 \u05E2\u05D2\u05D1\u05E0\u05D9\u05D5\u05EA'], image: 'https://upload.wikimedia.org/wikipedia/commons/thumb/b/ba/Tomato_paste.jpg/300px-Tomato_paste.jpg' },  // רסק עגבניות -> tomato paste
    { keywords: ['\u05D7\u05D5\u05DE\u05D5\u05E1'], image: 'https://upload.wikimedia.org/wikipedia/commons/thumb/5/5c/Hummus_from_The_Nile.jpg/300px-Hummus_from_The_Nile.jpg' },  // חומוס -> hummus
    { keywords: ['\u05D8\u05D7\u05D9\u05E0\u05D4'], image: 'https://upload.wikimedia.org/wikipedia/commons/thumb/0/0b/Tahini.jpg/300px-Tahini.jpg' },            // טחינה -> tahini
    { keywords: ['\u05E9\u05DE\u05DF \u05D6\u05D9\u05EA'], image: 'https://upload.wikimedia.org/wikipedia/commons/thumb/e/e9/Italian_olive_oil_2007.jpg/300px-Italian_olive_oil_2007.jpg' },  // שמן זית -> olive oil
    { keywords: ['\u05E9\u05DE\u05DF \u05E7\u05E0\u05D5\u05DC\u05D4', '\u05E9\u05DE\u05DF'], image: 'https://upload.wikimedia.org/wikipedia/commons/thumb/e/e9/Italian_olive_oil_2007.jpg/300px-Italian_olive_oil_2007.jpg' },  // שמן קנולה -> cooking oil
    { keywords: ['\u05E9\u05D9\u05DE\u05D5\u05E8\u05D9\u05DD'], image: 'https://upload.wikimedia.org/wikipedia/commons/thumb/b/ba/Tomato_paste.jpg/300px-Tomato_paste.jpg' },  // שימורים -> canned food
    { keywords: ['\u05EA\u05D9\u05E8\u05E1'], image: 'https://upload.wikimedia.org/wikipedia/commons/thumb/d/d3/Corn_on_the_cob.jpg/300px-Corn_on_the_cob.jpg' },  // תירס -> corn
    { keywords: ['\u05D0\u05E4\u05D5\u05E0\u05D4'], image: 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/a7/Green_peas.jpg/300px-Green_peas.jpg' },    // אפונה -> peas

    // Coffee & tea
    { keywords: ['\u05E7\u05E4\u05E1\u05D5\u05DC\u05D5\u05EA', '\u05E7\u05E4\u05E1\u05D5\u05DC\u05D4'], image: 'https://upload.wikimedia.org/wikipedia/commons/thumb/0/04/Cup_of_coffee.jpg/300px-Cup_of_coffee.jpg' },  // קפסולות -> coffee capsules
    { keywords: ['\u05D0\u05E1\u05E4\u05E8\u05E1\u05D5'], image: 'https://upload.wikimedia.org/wikipedia/commons/thumb/0/04/Cup_of_coffee.jpg/300px-Cup_of_coffee.jpg' },  // אספרסו -> espresso
    { keywords: ['\u05E7\u05E4\u05D4 \u05E0\u05DE\u05E1', '\u05E0\u05E1 \u05E7\u05E4\u05D4', '\u05E7\u05E4\u05D4 \u05E0\u05E1'], image: 'https://upload.wikimedia.org/wikipedia/commons/thumb/2/26/Instant_coffee.jpg/300px-Instant_coffee.jpg' },  // קפה נמס -> instant coffee
    { keywords: ['\u05E7\u05E4\u05D4'], image: 'https://upload.wikimedia.org/wikipedia/commons/thumb/0/04/Cup_of_coffee.jpg/300px-Cup_of_coffee.jpg' },           // קפה -> coffee
    { keywords: ['\u05EA\u05D4'], image: 'https://upload.wikimedia.org/wikipedia/commons/thumb/e/e9/Tea_Cup.jpg/300px-Tea_Cup.jpg' },                             // תה -> tea

    // Cleaning
    { keywords: ['\u05E9\u05DE\u05E4\u05D5'], image: 'https://upload.wikimedia.org/wikipedia/commons/thumb/2/23/Shampoo.jpg/300px-Shampoo.jpg' },                // שמפו -> shampoo
    { keywords: ['\u05E1\u05D1\u05D5\u05DF'], image: 'https://upload.wikimedia.org/wikipedia/commons/thumb/c/ce/Soap.jpg/300px-Soap.jpg' },                      // סבון -> soap
    { keywords: ['\u05D0\u05D1\u05E7\u05EA \u05DB\u05D1\u05D9\u05E1\u05D4', '\u05D0\u05D1\u05E7\u05D4'], image: 'https://upload.wikimedia.org/wikipedia/commons/thumb/c/ce/Soap.jpg/300px-Soap.jpg' },  // אבקת כביסה -> laundry detergent
    { keywords: ['\u05E0\u05D5\u05D6\u05DC \u05DB\u05DC\u05D9\u05DD'], image: 'https://upload.wikimedia.org/wikipedia/commons/thumb/d/d3/Dishwashing.jpg/300px-Dishwashing.jpg' },  // נוזל כלים -> dish soap
    { keywords: ['\u05DE\u05D8\u05DC\u05D9\u05D5\u05EA', '\u05DE\u05D2\u05D1\u05D5\u05E0\u05D9\u05DD'], image: 'https://upload.wikimedia.org/wikipedia/commons/thumb/c/ce/Soap.jpg/300px-Soap.jpg' },  // מטליות/מגבונים -> wipes
    { keywords: ['\u05E0\u05D9\u05D9\u05E8 \u05D8\u05D5\u05D0\u05DC\u05D8'], image: 'https://upload.wikimedia.org/wikipedia/commons/thumb/f/f0/Toilet_paper_orientation_over.jpg/300px-Toilet_paper_orientation_over.jpg' },  // נייר טואלט -> toilet paper

    // Baby
    { keywords: ['\u05D7\u05D9\u05EA\u05D5\u05DC\u05D9\u05DD'], image: 'https://upload.wikimedia.org/wikipedia/commons/thumb/0/0c/Baby_diaper.jpg/300px-Baby_diaper.jpg' },  // חיתולים -> diapers
    { keywords: ['\u05DE\u05D8\u05E8\u05E0\u05D4', '\u05E1\u05D9\u05DE\u05D9\u05DC\u05D0\u05E7'], image: 'https://upload.wikimedia.org/wikipedia/commons/thumb/2/29/Infant_formula.jpg/300px-Infant_formula.jpg' },  // מטרנה/סימילאק -> baby formula

    // Other common items
    { keywords: ['\u05E7\u05D5\u05E8\u05E0\u05E4\u05DC\u05E7\u05E1', '\u05D3\u05D2\u05E0\u05D9 \u05D1\u05D5\u05E7\u05E8'], image: 'https://upload.wikimedia.org/wikipedia/commons/thumb/6/6a/Cornflakes_in_bowl.jpg/300px-Cornflakes_in_bowl.jpg' },  // קורנפלקס -> cereal
    { keywords: ['\u05E1\u05D5\u05DB\u05E8'], image: 'https://upload.wikimedia.org/wikipedia/commons/thumb/3/3c/Sucre_blanc_cassonade_complet_rapadura.jpg/300px-Sucre_blanc_cassonade_complet_rapadura.jpg' },  // סוכר -> sugar
    { keywords: ['\u05E7\u05DE\u05D7'], image: 'https://upload.wikimedia.org/wikipedia/commons/thumb/6/64/All-Purpose_Flour_%284107895947%29.jpg/300px-All-Purpose_Flour_%284107895947%29.jpg' },  // קמח -> flour
    { keywords: ['\u05DE\u05DC\u05D7'], image: 'https://upload.wikimedia.org/wikipedia/commons/thumb/7/78/Salt_shaker_on_white_background.jpg/300px-Salt_shaker_on_white_background.jpg' },  // מלח -> salt
];

// ========================================
// Category Fallback Images (generic, last resort)
// ========================================
// All verified Wikimedia Commons URLs.
const CATEGORY_FALLBACK_IMAGES = {
    '\u05DE\u05D5\u05E6\u05E8\u05D9 \u05D7\u05DC\u05D1': 'https://upload.wikimedia.org/wikipedia/commons/thumb/0/0e/Milk_glass.jpg/300px-Milk_glass.jpg',
    '\u05DC\u05D7\u05DD \u05D5\u05DE\u05D0\u05E4\u05D9\u05DD': 'https://upload.wikimedia.org/wikipedia/commons/thumb/7/71/Anadama_bread_%281%29.jpg/300px-Anadama_bread_%281%29.jpg',
    '\u05D1\u05D9\u05E6\u05D9\u05DD': 'https://upload.wikimedia.org/wikipedia/commons/thumb/5/5e/Chicken_egg_2009-06-04.jpg/300px-Chicken_egg_2009-06-04.jpg',
    '\u05D1\u05E9\u05E8 \u05D5\u05E2\u05D5\u05E3': 'https://upload.wikimedia.org/wikipedia/commons/thumb/6/60/Standing-rib-roast.jpg/300px-Standing-rib-roast.jpg',
    '\u05D1\u05E9\u05E8 \u05D5\u05D3\u05D2\u05D9\u05DD': 'https://upload.wikimedia.org/wikipedia/commons/thumb/6/60/Standing-rib-roast.jpg/300px-Standing-rib-roast.jpg',
    '\u05D3\u05D2\u05D9\u05DD': 'https://upload.wikimedia.org/wikipedia/commons/thumb/4/48/Tilapia_fish.jpg/300px-Tilapia_fish.jpg',
    '\u05E4\u05D9\u05E8\u05D5\u05EA \u05D5\u05D9\u05E8\u05E7\u05D5\u05EA': 'https://upload.wikimedia.org/wikipedia/commons/thumb/c/c1/Fuji_apple.jpg/300px-Fuji_apple.jpg',
    '\u05DE\u05E9\u05E7\u05D0\u05D5\u05EA': 'https://upload.wikimedia.org/wikipedia/commons/thumb/0/05/Orangejuice.jpg/300px-Orangejuice.jpg',
    '\u05E9\u05EA\u05D9\u05D9\u05D4': 'https://upload.wikimedia.org/wikipedia/commons/thumb/0/05/Orangejuice.jpg/300px-Orangejuice.jpg',
    '\u05D7\u05D8\u05D9\u05E4\u05D9\u05DD': 'https://upload.wikimedia.org/wikipedia/commons/thumb/6/69/Potato-Chips.jpg/300px-Potato-Chips.jpg',
    '\u05E0\u05D9\u05E7\u05D9\u05D5\u05DF': 'https://upload.wikimedia.org/wikipedia/commons/thumb/c/ce/Soap.jpg/300px-Soap.jpg',
    '\u05DE\u05D5\u05E6\u05E8\u05D9 \u05E0\u05D9\u05E7\u05D9\u05D5\u05DF': 'https://upload.wikimedia.org/wikipedia/commons/thumb/c/ce/Soap.jpg/300px-Soap.jpg',
    '\u05E4\u05E1\u05D8\u05D4 \u05D5\u05D0\u05D5\u05E8\u05D6': 'https://upload.wikimedia.org/wikipedia/commons/thumb/9/98/Spaghetti-prepared.jpg/300px-Spaghetti-prepared.jpg',
    '\u05E9\u05D9\u05DE\u05D5\u05E8\u05D9\u05DD': 'https://upload.wikimedia.org/wikipedia/commons/thumb/b/ba/Tomato_paste.jpg/300px-Tomato_paste.jpg',
    '\u05E7\u05E4\u05D4 \u05D5\u05EA\u05D4': 'https://upload.wikimedia.org/wikipedia/commons/thumb/0/04/Cup_of_coffee.jpg/300px-Cup_of_coffee.jpg',
    '\u05EA\u05D9\u05E0\u05D5\u05E7\u05D5\u05EA': 'https://upload.wikimedia.org/wikipedia/commons/thumb/2/29/Infant_formula.jpg/300px-Infant_formula.jpg',
    '\u05DB\u05DC\u05DC\u05D9': 'https://upload.wikimedia.org/wikipedia/commons/thumb/c/c1/Fuji_apple.jpg/300px-Fuji_apple.jpg',
    '\u05DE\u05D6\u05D5\u05DF \u05DB\u05DC\u05DC\u05D9': 'https://upload.wikimedia.org/wikipedia/commons/thumb/c/c1/Fuji_apple.jpg/300px-Fuji_apple.jpg',
    '\u05D0\u05D7\u05E8': 'https://upload.wikimedia.org/wikipedia/commons/thumb/c/c1/Fuji_apple.jpg/300px-Fuji_apple.jpg',
};

const DEFAULT_FALLBACK = 'https://upload.wikimedia.org/wikipedia/commons/thumb/c/c1/Fuji_apple.jpg/300px-Fuji_apple.jpg';

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
