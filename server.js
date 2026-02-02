require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { MongoClient, ObjectId } = require('mongodb');
const path = require('path');
const OpenAI = require('openai');
const { XMLParser } = require('fast-xml-parser');
const cron = require('node-cron');
const zlib = require('zlib');
const https = require('https');
const http = require('http');
const { spawn } = require('child_process');
const { CHAINS, fetchChain, fetchAllChains } = require('./scripts/chain_fetcher');
const { resolveImagesForProducts, validateAndRefreshImages, CATEGORY_FALLBACK_IMAGES, resolveProductImage, getCategoryFallback } = require('./scripts/image_resolver');

const app = express();
const PORT = process.env.PORT || 4000;

// MongoDB connection
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/budget-manager';
let db;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Default data
const defaultCategories = {
    income: ['משכורת', 'פרילנס', 'השקעות', 'שכירות', 'מתנות', 'החזרים', 'אחר'],
    expense: ['מזון וקניות', 'מסעדות ובתי קפה', 'תחבורה ודלק', 'דיור ושכירות', 'חשבונות', 'בילויים', 'קניות ואופנה', 'בריאות', 'חינוך', 'חיות מחמד', 'מתנות', 'חיסכון', 'אחר']
};

// Connect to MongoDB
async function connectDB() {
    try {
        const client = new MongoClient(MONGODB_URI);
        await client.connect();
        db = client.db('budget-manager');
        console.log('Connected to MongoDB');

        // Initialize categories if not exists
        const settings = await db.collection('settings').findOne({ _id: 'categories' });
        if (!settings) {
            await db.collection('settings').insertOne({
                _id: 'categories',
                ...defaultCategories
            });
        }

        // Initialize products collection with text index for Hebrew search
        try {
            await db.collection('products').createIndex(
                { name: 'text' },
                { default_language: 'none', name: 'products_name_text' }
            );
            await db.collection('products').createIndex({ barcode: 1 }, { unique: true, sparse: true });
            await db.collection('products').createIndex({ itemCode: 1 });
            await db.collection('imageCache').createIndex({ barcode: 1 }, { unique: true });
            console.log('Products and imageCache collection indexes created');
        } catch (indexError) {
            // Index might already exist
            if (indexError.code !== 85 && indexError.code !== 86) {
                console.log('Products index note:', indexError.message);
            }
        }
    } catch (error) {
        console.error('MongoDB connection error:', error);
        process.exit(1);
    }
}

// API Routes

// Get all data
app.get('/api/data', async (req, res) => {
    try {
        const transactions = await db.collection('transactions').find({}).toArray();
        const categoriesDoc = await db.collection('settings').findOne({ _id: 'categories' });
        const categories = categoriesDoc ? { income: categoriesDoc.income, expense: categoriesDoc.expense } : defaultCategories;

        res.json({ transactions, categories });
    } catch (error) {
        console.error('Error fetching data:', error);
        res.status(500).json({ error: 'Failed to fetch data' });
    }
});

// Get transactions
app.get('/api/transactions', async (req, res) => {
    try {
        const { year, month } = req.query;
        let query = {};

        if (year && month) {
            const startDate = new Date(parseInt(year), parseInt(month), 1);
            const endDate = new Date(parseInt(year), parseInt(month) + 1, 0);
            query.date = { $gte: startDate.toISOString().split('T')[0], $lte: endDate.toISOString().split('T')[0] };
        }

        const transactions = await db.collection('transactions').find(query).toArray();
        res.json(transactions);
    } catch (error) {
        console.error('Error fetching transactions:', error);
        res.status(500).json({ error: 'Failed to fetch transactions' });
    }
});

// Add transaction
app.post('/api/transactions', async (req, res) => {
    try {
        const transaction = {
            ...req.body,
            id: Date.now(),
            isRecurring: req.body.isRecurring || false,
            recurringDay: req.body.isRecurring ? new Date(req.body.date).getDate() : null,
            createdAt: new Date().toISOString()
        };

        await db.collection('transactions').insertOne(transaction);
        res.json({ success: true, transaction });
    } catch (error) {
        console.error('Error adding transaction:', error);
        res.status(500).json({ success: false, error: 'Failed to save transaction' });
    }
});

// Update transaction
app.put('/api/transactions/:id', async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const isRecurring = req.body.isRecurring || false;
        const updates = {
            type: req.body.type,
            amount: req.body.amount,
            category: req.body.category,
            description: req.body.description,
            date: req.body.date,
            person: req.body.person,
            isRecurring: isRecurring,
            recurringDay: isRecurring ? new Date(req.body.date).getDate() : null,
            updatedAt: new Date().toISOString()
        };

        await db.collection('transactions').updateOne({ id }, { $set: updates });
        const transaction = await db.collection('transactions').findOne({ id });
        res.json({ success: true, transaction });
    } catch (error) {
        console.error('Error updating transaction:', error);
        res.status(500).json({ success: false, error: 'Failed to update transaction' });
    }
});

// Delete transaction
app.delete('/api/transactions/:id', async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        await db.collection('transactions').deleteOne({ id });
        res.json({ success: true });
    } catch (error) {
        console.error('Error deleting transaction:', error);
        res.status(500).json({ success: false, error: 'Failed to delete transaction' });
    }
});

// Get recurring transactions
app.get('/api/recurring', async (req, res) => {
    try {
        const recurring = await db.collection('transactions').find({ isRecurring: true }).toArray();
        res.json(recurring);
    } catch (error) {
        console.error('Error fetching recurring transactions:', error);
        res.status(500).json({ error: 'Failed to fetch recurring transactions' });
    }
});

// Toggle recurring status
app.put('/api/transactions/:id/recurring', async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const { isRecurring } = req.body;
        const transaction = await db.collection('transactions').findOne({ id });

        const recurringDay = isRecurring ? new Date(transaction.date).getDate() : null;

        await db.collection('transactions').updateOne(
            { id },
            { $set: { isRecurring, recurringDay } }
        );

        const updated = await db.collection('transactions').findOne({ id });
        res.json({ success: true, transaction: updated });
    } catch (error) {
        console.error('Error updating recurring status:', error);
        res.status(500).json({ success: false, error: 'Failed to update recurring status' });
    }
});

// Get categories
app.get('/api/categories', async (req, res) => {
    try {
        const categoriesDoc = await db.collection('settings').findOne({ _id: 'categories' });
        const categories = categoriesDoc ? { income: categoriesDoc.income, expense: categoriesDoc.expense } : defaultCategories;
        res.json(categories);
    } catch (error) {
        console.error('Error fetching categories:', error);
        res.status(500).json({ error: 'Failed to fetch categories' });
    }
});

// Add category
app.post('/api/categories/:type', async (req, res) => {
    try {
        const { type } = req.params;
        const { name } = req.body;

        const updateField = type === 'income' ? 'income' : 'expense';
        await db.collection('settings').updateOne(
            { _id: 'categories' },
            { $addToSet: { [updateField]: name } }
        );

        const categoriesDoc = await db.collection('settings').findOne({ _id: 'categories' });
        res.json({ success: true, categories: { income: categoriesDoc.income, expense: categoriesDoc.expense } });
    } catch (error) {
        console.error('Error adding category:', error);
        res.status(500).json({ success: false, error: 'Failed to add category' });
    }
});

// Delete category
app.delete('/api/categories/:type/:name', async (req, res) => {
    try {
        const { type, name } = req.params;
        const updateField = type === 'income' ? 'income' : 'expense';

        await db.collection('settings').updateOne(
            { _id: 'categories' },
            { $pull: { [updateField]: decodeURIComponent(name) } }
        );

        const categoriesDoc = await db.collection('settings').findOne({ _id: 'categories' });
        res.json({ success: true, categories: { income: categoriesDoc.income, expense: categoriesDoc.expense } });
    } catch (error) {
        console.error('Error deleting category:', error);
        res.status(500).json({ success: false, error: 'Failed to delete category' });
    }
});

// Get avatars
app.get('/api/avatars', async (req, res) => {
    try {
        const avatarsDoc = await db.collection('settings').findOne({ _id: 'avatars' });
        if (avatarsDoc) {
            const { _id, ...avatars } = avatarsDoc;
            res.json(avatars);
        } else {
            res.json({ Shai: '', Gal: '', Chubby: '' });
        }
    } catch (error) {
        console.error('Error fetching avatars:', error);
        res.status(500).json({ error: 'Failed to fetch avatars' });
    }
});

// Update avatar
app.post('/api/avatars/:person', async (req, res) => {
    try {
        const { person } = req.params;
        const { avatar } = req.body;

        await db.collection('settings').updateOne(
            { _id: 'avatars' },
            { $set: { [person]: avatar } },
            { upsert: true }
        );

        res.json({ success: true });
    } catch (error) {
        console.error('Error saving avatar:', error);
        res.status(500).json({ success: false, error: 'Failed to save avatar' });
    }
});

// Get budgets
app.get('/api/budgets', async (req, res) => {
    try {
        const budgetsDoc = await db.collection('settings').findOne({ _id: 'budgets' });
        if (budgetsDoc) {
            const { _id, ...budgets } = budgetsDoc;
            res.json(budgets);
        } else {
            res.json({});
        }
    } catch (error) {
        console.error('Error fetching budgets:', error);
        res.status(500).json({ error: 'Failed to fetch budgets' });
    }
});

// Save budgets
app.post('/api/budgets', async (req, res) => {
    try {
        const { budgets } = req.body;

        await db.collection('settings').updateOne(
            { _id: 'budgets' },
            { $set: budgets },
            { upsert: true }
        );

        const budgetsDoc = await db.collection('settings').findOne({ _id: 'budgets' });
        res.json({ success: true, budgets: budgetsDoc });
    } catch (error) {
        console.error('Error saving budgets:', error);
        res.status(500).json({ success: false, error: 'Failed to save budgets' });
    }
});

// AI Insights - Initialize OpenAI client
let openai = null;
try {
    if (process.env.OPENAI_API_KEY) {
        openai = new OpenAI({
            apiKey: process.env.OPENAI_API_KEY
        });
        console.log('OpenAI client initialized');
    } else {
        console.log('OpenAI API key not configured - AI insights disabled');
    }
} catch (error) {
    console.error('Error initializing OpenAI:', error.message);
}

// Get AI Insights
app.post('/api/insights', async (req, res) => {
    if (!openai) {
        return res.status(503).json({
            success: false,
            error: 'AI insights not configured. Add OPENAI_API_KEY to .env file.'
        });
    }

    try {
        const { transactions, budgets, month, year } = req.body;

        // Calculate summary data
        const income = transactions.filter(t => t.type === 'income').reduce((sum, t) => sum + t.amount, 0);
        const expenses = transactions.filter(t => t.type === 'expense').reduce((sum, t) => sum + t.amount, 0);
        const balance = income - expenses;

        // Group expenses by category
        const expensesByCategory = {};
        transactions.filter(t => t.type === 'expense').forEach(t => {
            expensesByCategory[t.category] = (expensesByCategory[t.category] || 0) + t.amount;
        });

        // Group by person
        const expensesByPerson = {};
        transactions.filter(t => t.type === 'expense').forEach(t => {
            const person = t.person || 'לא צוין';
            expensesByPerson[person] = (expensesByPerson[person] || 0) + t.amount;
        });

        // Check budget overruns
        const budgetStatus = [];
        for (const [category, spent] of Object.entries(expensesByCategory)) {
            const budget = budgets[category];
            if (budget && budget > 0) {
                budgetStatus.push({
                    category,
                    spent,
                    budget,
                    percentage: Math.round((spent / budget) * 100),
                    isOver: spent > budget
                });
            }
        }

        const prompt = `אתה יועץ פיננסי מומחה. נתח את הנתונים הבאים ותן תובנות והמלצות בעברית.

נתוני חודש ${month}/${year}:
- הכנסות: ₪${income.toLocaleString()}
- הוצאות: ₪${expenses.toLocaleString()}
- יתרה: ₪${balance.toLocaleString()}
- אחוז חיסכון: ${income > 0 ? Math.round((balance / income) * 100) : 0}%

הוצאות לפי קטגוריה:
${Object.entries(expensesByCategory).map(([cat, amount]) => `- ${cat}: ₪${amount.toLocaleString()}`).join('\n')}

הוצאות לפי אדם:
${Object.entries(expensesByPerson).map(([person, amount]) => `- ${person}: ₪${amount.toLocaleString()}`).join('\n')}

מצב תקציבים:
${budgetStatus.length > 0 ? budgetStatus.map(b => `- ${b.category}: ${b.percentage}% (${b.isOver ? 'חריגה!' : 'בתקציב'})`).join('\n') : 'לא הוגדרו תקציבים'}

מספר תנועות: ${transactions.length}

תן:
1. 🔍 ניתוח קצר של המצב הפיננסי (2-3 משפטים)
2. ⚠️ אזהרות אם יש (חריגות תקציב, הוצאות גבוהות)
3. 💡 3 המלצות קונקרטיות לשיפור
4. 🎯 יעד לחודש הבא

ענה בצורה תמציתית וידידותית.`;

        const completion = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: [
                {
                    role: 'system',
                    content: 'אתה יועץ פיננסי ידידותי ומקצועי. עונה תמיד בעברית בצורה תמציתית וברורה.'
                },
                { role: 'user', content: prompt }
            ],
            max_tokens: 800,
            temperature: 0.7
        });

        res.json({
            success: true,
            insights: completion.choices[0].message.content,
            summary: {
                income,
                expenses,
                balance,
                savingsRate: income > 0 ? Math.round((balance / income) * 100) : 0,
                topCategory: Object.entries(expensesByCategory).sort((a, b) => b[1] - a[1])[0],
                overBudget: budgetStatus.filter(b => b.isOver)
            }
        });
    } catch (error) {
        console.error('Error generating insights:', error);
        res.status(500).json({ success: false, error: 'Failed to generate insights' });
    }
});

// ========================================
// AI Insights - Daily Tips Widget
// ========================================
app.post('/api/insights/daily-tips', async (req, res) => {
    try {
        // Check cache first (24 hour TTL)
        const cachedTip = await db.collection('cache').findOne({
            _id: 'daily-tip',
            expiresAt: { $gt: new Date() }
        });

        if (cachedTip) {
            return res.json({ success: true, tip: cachedTip.tip, cached: true });
        }

        // Get last 7 days of transactions
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
        const dateStr = sevenDaysAgo.toISOString().split('T')[0];

        const transactions = await db.collection('transactions')
            .find({ date: { $gte: dateStr }, type: 'expense' })
            .toArray();

        if (transactions.length === 0) {
            return res.json({
                success: true,
                tip: '💡 אין מספיק נתונים מהשבוע האחרון. המשך לתעד את ההוצאות שלך!',
                cached: false
            });
        }

        // Analyze spending by category
        const categorySpending = {};
        let totalSpent = 0;
        transactions.forEach(t => {
            categorySpending[t.category] = (categorySpending[t.category] || 0) + t.amount;
            totalSpent += t.amount;
        });

        // Find highest spending category
        const topCategory = Object.entries(categorySpending)
            .sort((a, b) => b[1] - a[1])[0];

        // Generate tip using OpenAI if available
        let tip;
        if (openai) {
            const prompt = `אתה יועץ פיננסי. בשבוע האחרון המשתמש הוציא ₪${totalSpent.toLocaleString()} בסך הכל.
הקטגוריה הכי יקרה: ${topCategory[0]} (₪${topCategory[1].toLocaleString()}).
התפלגות הוצאות: ${Object.entries(categorySpending).map(([k, v]) => `${k}: ₪${v.toLocaleString()}`).join(', ')}.

תן טיפ חיסכון אחד קצר ומעשי בעברית (עד 50 מילים). התמקד בקטגוריה הגבוהה ביותר.`;

            const completion = await openai.chat.completions.create({
                model: 'gpt-4o-mini',
                messages: [
                    { role: 'system', content: 'אתה יועץ פיננסי ידידותי. עונה בעברית בתמציתיות.' },
                    { role: 'user', content: prompt }
                ],
                max_tokens: 150,
                temperature: 0.7
            });
            tip = completion.choices[0].message.content;
        } else {
            // Fallback tips based on category
            const tips = {
                'מזון וקניות': `💡 הוצאת ₪${topCategory[1].toLocaleString()} על מזון השבוע. נסה לתכנן רשימת קניות מראש ולהימנע מקניות אימפולסיביות.`,
                'מסעדות ובתי קפה': `💡 הוצאת ₪${topCategory[1].toLocaleString()} על אוכל בחוץ. נסה להכין אוכל בבית לפחות פעמיים בשבוע.`,
                'תחבורה ודלק': `💡 הוצאת ₪${topCategory[1].toLocaleString()} על תחבורה. שקול שימוש בתחבורה ציבורית או שיתוף נסיעות.`,
                'בילויים': `💡 הוצאת ₪${topCategory[1].toLocaleString()} על בילויים. חפש אירועים חינמיים או הנחות לפני שאתה יוצא.`,
                'קניות ואופנה': `💡 הוצאת ₪${topCategory[1].toLocaleString()} על קניות. המתן 24 שעות לפני רכישות גדולות.`
            };
            tip = tips[topCategory[0]] || `💡 הקטגוריה הגבוהה ביותר שלך השבוע: ${topCategory[0]} (₪${topCategory[1].toLocaleString()}). נסה להגדיר תקציב לקטגוריה זו.`;
        }

        // Cache for 24 hours
        const expiresAt = new Date();
        expiresAt.setHours(expiresAt.getHours() + 24);
        await db.collection('cache').updateOne(
            { _id: 'daily-tip' },
            { $set: { tip, expiresAt, createdAt: new Date() } },
            { upsert: true }
        );

        res.json({ success: true, tip, cached: false });
    } catch (error) {
        console.error('Error generating daily tip:', error);
        res.status(500).json({ success: false, error: 'Failed to generate tip' });
    }
});

// ========================================
// AI Insights - Anomaly Detection
// ========================================
app.post('/api/insights/anomalies', async (req, res) => {
    try {
        const now = new Date();
        const currentMonth = now.getMonth();
        const currentYear = now.getFullYear();

        // Get 6 months of transaction data
        const sixMonthsAgo = new Date();
        sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
        const startDate = sixMonthsAgo.toISOString().split('T')[0];

        const transactions = await db.collection('transactions')
            .find({ date: { $gte: startDate }, type: 'expense' })
            .toArray();

        // Group by month and category
        const monthlyByCategory = {};
        const currentMonthSpending = {};

        transactions.forEach(t => {
            const tDate = new Date(t.date);
            const monthKey = `${tDate.getFullYear()}-${tDate.getMonth()}`;
            const isCurrentMonth = tDate.getMonth() === currentMonth && tDate.getFullYear() === currentYear;

            if (!monthlyByCategory[t.category]) {
                monthlyByCategory[t.category] = {};
            }
            monthlyByCategory[t.category][monthKey] = (monthlyByCategory[t.category][monthKey] || 0) + t.amount;

            if (isCurrentMonth) {
                currentMonthSpending[t.category] = (currentMonthSpending[t.category] || 0) + t.amount;
            }
        });

        // Calculate anomalies
        const anomalies = [];

        for (const [category, monthlyData] of Object.entries(monthlyByCategory)) {
            const currentMonthKey = `${currentYear}-${currentMonth}`;
            const currentAmount = currentMonthSpending[category] || 0;

            // Get historical data (excluding current month)
            const historicalAmounts = Object.entries(monthlyData)
                .filter(([key]) => key !== currentMonthKey)
                .map(([, amount]) => amount);

            if (historicalAmounts.length < 2) continue;

            // Calculate mean and standard deviation
            const mean = historicalAmounts.reduce((a, b) => a + b, 0) / historicalAmounts.length;
            const variance = historicalAmounts.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / historicalAmounts.length;
            const stdDev = Math.sqrt(variance);

            // Check if current month is anomalous (> mean + 1.5 * stdDev)
            const threshold = mean + (1.5 * stdDev);

            if (currentAmount > threshold && currentAmount > 0) {
                const severity = currentAmount > (mean + 3 * stdDev) ? 'high' :
                                currentAmount > (mean + 2 * stdDev) ? 'medium' : 'low';

                anomalies.push({
                    category,
                    currentAmount,
                    average: Math.round(mean),
                    difference: Math.round(currentAmount - mean),
                    percentageOver: Math.round(((currentAmount - mean) / mean) * 100),
                    severity
                });
            }
        }

        // Sort by severity and amount
        anomalies.sort((a, b) => {
            const severityOrder = { high: 0, medium: 1, low: 2 };
            if (severityOrder[a.severity] !== severityOrder[b.severity]) {
                return severityOrder[a.severity] - severityOrder[b.severity];
            }
            return b.difference - a.difference;
        });

        res.json({ success: true, anomalies });
    } catch (error) {
        console.error('Error detecting anomalies:', error);
        res.status(500).json({ success: false, error: 'Failed to detect anomalies' });
    }
});

// ========================================
// AI Insights - Budget Recommendations
// ========================================
app.post('/api/insights/budget-recommendations', async (req, res) => {
    try {
        // Get current budgets
        const budgetsDoc = await db.collection('settings').findOne({ _id: 'budgets' });
        const currentBudgets = budgetsDoc || {};

        // Get 6 months of transaction data
        const sixMonthsAgo = new Date();
        sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
        const startDate = sixMonthsAgo.toISOString().split('T')[0];

        const transactions = await db.collection('transactions')
            .find({ date: { $gte: startDate }, type: 'expense' })
            .toArray();

        // Calculate monthly averages per category
        const categoryData = {};

        transactions.forEach(t => {
            const tDate = new Date(t.date);
            const monthKey = `${tDate.getFullYear()}-${tDate.getMonth()}`;

            if (!categoryData[t.category]) {
                categoryData[t.category] = { months: {}, total: 0 };
            }
            categoryData[t.category].months[monthKey] = (categoryData[t.category].months[monthKey] || 0) + t.amount;
            categoryData[t.category].total += t.amount;
        });

        // Generate recommendations
        const recommendations = [];

        for (const [category, data] of Object.entries(categoryData)) {
            const monthCount = Object.keys(data.months).length;
            if (monthCount < 2) continue;

            const monthlyAverage = data.total / monthCount;
            const suggestedBudget = Math.round(monthlyAverage * 1.15); // 15% buffer
            const currentBudget = currentBudgets[category] || 0;

            const recommendation = {
                category,
                monthlyAverage: Math.round(monthlyAverage),
                suggestedBudget,
                currentBudget,
                reasoning: `מבוסס על ממוצע של ${monthCount} חודשים: ₪${Math.round(monthlyAverage).toLocaleString()}`
            };

            // Determine if under-budgeted
            if (currentBudget > 0 && currentBudget < monthlyAverage) {
                recommendation.status = 'under-budgeted';
                recommendation.urgency = 'high';
            } else if (currentBudget === 0) {
                recommendation.status = 'no-budget';
                recommendation.urgency = 'medium';
            } else if (suggestedBudget < currentBudget * 0.8) {
                recommendation.status = 'over-budgeted';
                recommendation.urgency = 'low';
            } else {
                recommendation.status = 'optimal';
                recommendation.urgency = 'none';
            }

            recommendations.push(recommendation);
        }

        // Sort by urgency
        const urgencyOrder = { high: 0, medium: 1, low: 2, none: 3 };
        recommendations.sort((a, b) => urgencyOrder[a.urgency] - urgencyOrder[b.urgency]);

        res.json({ success: true, recommendations });
    } catch (error) {
        console.error('Error generating recommendations:', error);
        res.status(500).json({ success: false, error: 'Failed to generate recommendations' });
    }
});

// ========================================
// Shopping Lists API
// ========================================

// Get all shopping lists
app.get('/api/shopping-lists', async (req, res) => {
    try {
        const lists = await db.collection('shoppingLists').find({}).sort({ createdAt: -1 }).toArray();
        res.json({ success: true, lists });
    } catch (error) {
        console.error('Error fetching shopping lists:', error);
        res.status(500).json({ success: false, error: 'Failed to fetch shopping lists' });
    }
});

// Create shopping list
app.post('/api/shopping-lists', async (req, res) => {
    try {
        const list = {
            name: req.body.name || 'רשימת קניות חדשה',
            items: [],
            createdAt: new Date(),
            totalEstimate: 0
        };
        const result = await db.collection('shoppingLists').insertOne(list);
        list._id = result.insertedId;
        res.json({ success: true, list });
    } catch (error) {
        console.error('Error creating shopping list:', error);
        res.status(500).json({ success: false, error: 'Failed to create shopping list' });
    }
});

// Delete shopping list
app.delete('/api/shopping-lists/:id', async (req, res) => {
    try {
        await db.collection('shoppingLists').deleteOne({ _id: new ObjectId(req.params.id) });
        res.json({ success: true });
    } catch (error) {
        console.error('Error deleting shopping list:', error);
        res.status(500).json({ success: false, error: 'Failed to delete shopping list' });
    }
});

// Add item to shopping list
app.post('/api/shopping-lists/:id/items', async (req, res) => {
    try {
        const item = {
            id: Date.now(),
            name: req.body.name,
            quantity: req.body.quantity || 1,
            checked: false,
            estimatedPrice: req.body.estimatedPrice || 0
        };

        const result = await db.collection('shoppingLists').findOneAndUpdate(
            { _id: new ObjectId(req.params.id) },
            {
                $push: { items: item },
                $inc: { totalEstimate: item.estimatedPrice * item.quantity }
            },
            { returnDocument: 'after' }
        );

        if (!result) {
            return res.status(404).json({ success: false, error: 'List not found' });
        }
        res.json({ success: true, list: result });
    } catch (error) {
        console.error('Error adding item:', error);
        res.status(500).json({ success: false, error: 'Failed to add item' });
    }
});

// Update item in shopping list
app.put('/api/shopping-lists/:id/items/:itemId', async (req, res) => {
    try {
        const listId = new ObjectId(req.params.id);
        const itemId = parseInt(req.params.itemId);

        // Get current list to find the item
        const list = await db.collection('shoppingLists').findOne({ _id: listId });
        if (!list) {
            return res.status(404).json({ success: false, error: 'List not found' });
        }
        const itemIndex = list.items.findIndex(i => i.id === itemId);

        if (itemIndex === -1) {
            return res.status(404).json({ success: false, error: 'Item not found' });
        }

        // Update the item
        const updatedItem = { ...list.items[itemIndex], ...req.body };
        list.items[itemIndex] = updatedItem;

        // Recalculate total estimate
        const totalEstimate = list.items.reduce((sum, i) =>
            sum + ((i.estimatedPrice || 0) * (i.quantity || 1)), 0);

        await db.collection('shoppingLists').updateOne(
            { _id: listId },
            { $set: { items: list.items, totalEstimate } }
        );

        res.json({ success: true, item: updatedItem });
    } catch (error) {
        console.error('Error updating item:', error);
        res.status(500).json({ success: false, error: 'Failed to update item' });
    }
});

// Delete item from shopping list
app.delete('/api/shopping-lists/:id/items/:itemId', async (req, res) => {
    try {
        const listId = new ObjectId(req.params.id);
        const itemId = parseInt(req.params.itemId);

        const list = await db.collection('shoppingLists').findOne({ _id: listId });
        if (!list) {
            return res.status(404).json({ success: false, error: 'List not found' });
        }
        const item = list.items.find(i => i.id === itemId);
        const priceReduction = item ? (item.estimatedPrice || 0) * (item.quantity || 1) : 0;

        await db.collection('shoppingLists').updateOne(
            { _id: listId },
            {
                $pull: { items: { id: itemId } },
                $inc: { totalEstimate: -priceReduction }
            }
        );

        res.json({ success: true });
    } catch (error) {
        console.error('Error deleting item:', error);
        res.status(500).json({ success: false, error: 'Failed to delete item' });
    }
});

// ========================================
// Israeli Supermarket Price Integration
// ========================================

// XML Parser configuration
const xmlParser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_'
});

// Helper: Fetch URL with gzip support (handles SSL cert issues)
function fetchUrl(url, options = {}) {
    return new Promise((resolve, reject) => {
        const isHttps = url.startsWith('https');
        const protocol = isHttps ? https : http;

        const requestOptions = {
            ...require('url').parse(url),
            rejectUnauthorized: false, // Handle self-signed certs
            timeout: 30000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Accept': '*/*',
                ...options.headers
            }
        };

        protocol.get(requestOptions, (res) => {
            if (res.statusCode === 301 || res.statusCode === 302) {
                return fetchUrl(res.headers.location, options).then(resolve).catch(reject);
            }

            if (res.statusCode >= 400) {
                return reject(new Error(`HTTP ${res.statusCode}: ${res.statusMessage}`));
            }

            const chunks = [];
            const isGzip = res.headers['content-encoding'] === 'gzip' || url.endsWith('.gz');

            const stream = isGzip ? res.pipe(zlib.createGunzip()) : res;

            stream.on('data', chunk => chunks.push(chunk));
            stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
            stream.on('error', reject);
        }).on('error', reject);
    });
}

// Helper: Get product image - delegates to image_resolver
async function getProductImage(barcode, productName, category) {
    return resolveProductImage(db, barcode, productName, category);
}

// ========================================
// Unified Chain Product Storage (chainPrices map)
// ========================================
async function storeChainProducts(chainId, products) {
    const stats = { total: 0, updated: 0, errors: 0 };
    const now = new Date();
    const chain = CHAINS[chainId];
    if (!chain) return stats;

    for (const product of products) {
        try {
            stats.total++;
            const barcode = product.barcode.padStart(13, '0');

            if (!barcode || !product.name || !product.price) continue;

            // Build the chainPrices map entry for this chain
            const chainPriceEntry = {
                chain: chainId,
                chainName: chain.name,
                price: product.price,
                lastUpdated: now
            };

            // Fetch existing product to merge chainPrices
            const existing = await db.collection('products').findOne({ barcode });

            // Merge into chainPrices map
            const chainPrices = (existing && existing.chainPrices) ? { ...existing.chainPrices } : {};
            chainPrices[chainId] = chainPriceEntry;

            // Recompute prices array from chainPrices map
            const prices = Object.values(chainPrices).map(cp => ({
                chain: cp.chain,
                chainName: cp.chainName,
                price: cp.price,
                lastUpdated: cp.lastUpdated
            }));

            // Compute cheapest
            const cheapest = prices.reduce((min, p) => p.price < min.price ? p : min, prices[0]);

            await db.collection('products').updateOne(
                { barcode },
                {
                    $set: {
                        barcode,
                        itemCode: product.barcode,
                        name: product.name,
                        category: product.category || mapCategory(product.manufacturer, product.name),
                        manufacturer: product.manufacturer || '',
                        chainPrices,
                        prices,
                        cheapestPrice: cheapest.price,
                        cheapestChain: cheapest.chainName,
                        lastUpdated: now,
                        dataSource: 'chain-fetcher'
                    }
                },
                { upsert: true }
            );

            stats.updated++;
        } catch (error) {
            stats.errors++;
            if (stats.errors <= 3) {
                console.error(`Error storing product: ${error.message}`);
            }
        }
    }

    return stats;
}

// Helper: Map product category
function mapCategory(manufacturerName, itemName) {
    const name = (itemName || '').toLowerCase();
    const mfr = (manufacturerName || '').toLowerCase();

    if (name.includes('חלב') || name.includes('גבינה') || name.includes('יוגורט') || name.includes('שמנת') || mfr.includes('תנובה') || mfr.includes('טרה')) {
        return 'מוצרי חלב';
    }
    if (name.includes('לחם') || name.includes('פיתה') || name.includes('חלה') || name.includes('באגט')) {
        return 'לחם ומאפים';
    }
    if (name.includes('עוף') || name.includes('בקר') || name.includes('דג') || name.includes('סלמון') || name.includes('טונה')) {
        return 'בשר ודגים';
    }
    if (name.includes('מים') || name.includes('קולה') || name.includes('ספרייט') || name.includes('מיץ') || name.includes('בירה')) {
        return 'שתייה';
    }
    if (name.includes('חטיף') || name.includes('שוקולד') || name.includes('עוגיות') || name.includes('במבה')) {
        return 'חטיפים';
    }
    if (name.includes('סבון') || name.includes('שמפו') || name.includes('אבקה') || name.includes('ניקוי')) {
        return 'מוצרי ניקיון';
    }
    return 'מזון כללי';
}

// ========================================
// Shufersal Price Fetcher
// ========================================
async function fetchShufersalPrices() {
    console.log('Fetching Shufersal prices...');
    const stats = { total: 0, updated: 0, errors: 0 };

    try {
        // Shufersal publishes prices at the Cerberus system (like other chains)
        // Try the Shufersal-specific Cerberus endpoint
        const dirUrl = 'https://prices.shufersal.co.il/FileObject/UpdateCategory?storeId=&catID=-1&chain=1';

        let files = [];
        try {
            // First try to get file listing from Shufersal Cerberus
            const listUrl = 'http://prices.shufersal.co.il/FileObject/UpdateCategory?catID=2';
            const dirResponse = await fetchUrl(listUrl);

            // Check if response is XML (file list) or direct XML data
            if (dirResponse.includes('<Items>') || dirResponse.includes('<Item>')) {
                // Direct XML data
                const parsed = xmlParser.parse(dirResponse);
                const items = parsed?.Root?.Items?.Item || parsed?.Items?.Item ||
                             parsed?.root?.Items?.Item || parsed?.PriceFull?.Items?.Item || [];
                const itemArray = Array.isArray(items) ? items : (items ? [items] : []);

                for (const item of itemArray.slice(0, 5000)) {
                    await processItem(item, 'shufersal', 'שופרסל', stats);
                }

                console.log(`Shufersal direct XML: ${stats.updated} products`);
                return stats;
            }
        } catch (e) {
            console.log('Shufersal direct fetch failed, trying alternative...', e.message);
        }

        // Alternative: Try sample products via Shufersal Online API
        // Since the official prices API may require special access, add sample data for demo
        const sampleProducts = [
            { code: '7290000000015', name: 'חלב תנובה 3% 1 ליטר', price: 6.90, mfr: 'תנובה' },
            { code: '7290000000022', name: 'לחם אחיד פרוס', price: 8.50, mfr: 'ברמן' },
            { code: '7290000000039', name: 'ביצים L 12 יח', price: 21.90, mfr: 'הלוי' },
            { code: '7290000000046', name: 'גבינה צהובה 28% 200 גרם', price: 18.90, mfr: 'תנובה' },
            { code: '7290000000053', name: 'שמן קנולה 1 ליטר', price: 14.90, mfr: 'שמן' },
            { code: '7290000000060', name: 'קוטג 5% 250 גרם', price: 7.90, mfr: 'תנובה' },
            { code: '7290000000077', name: 'חמאה 100 גרם', price: 8.50, mfr: 'תנובה' },
            { code: '7290000000084', name: 'שוקולד פרה 100 גרם', price: 7.90, mfr: 'עלית' },
            { code: '7290000000091', name: 'במבה 80 גרם', price: 6.90, mfr: 'אסם' },
            { code: '7290000000107', name: 'קורנפלקס 500 גרם', price: 16.90, mfr: 'תלמה' },
            { code: '7290000000114', name: 'קפה נמס 200 גרם', price: 29.90, mfr: 'עלית' },
            { code: '7290000000121', name: 'חומוס 400 גרם', price: 9.90, mfr: 'צבר' },
            { code: '7290000000138', name: 'טחינה 500 גרם', price: 18.90, mfr: 'הראל' },
            { code: '7290000000145', name: 'אורז 1 קג', price: 11.90, mfr: 'סוגת' },
            { code: '7290000000152', name: 'פסטה 500 גרם', price: 6.90, mfr: 'ברילה' },
            { code: '7290000000169', name: 'רסק עגבניות 400 גרם', price: 5.90, mfr: 'אסם' },
            { code: '7290000000176', name: 'מיץ תפוזים 1 ליטר', price: 9.90, mfr: 'פרימור' },
            { code: '7290000000183', name: 'מים מינרליים 1.5 ליטר', price: 4.50, mfr: 'נביעות' },
            { code: '7290000000190', name: 'קולה 1.5 ליטר', price: 8.90, mfr: 'קוקה קולה' },
            { code: '7290000000206', name: 'יוגורט פרי 150 גרם', price: 4.90, mfr: 'דנונה' }
        ];

        console.log('Using sample Shufersal products for demo...');
        for (const product of sampleProducts) {
            try {
                stats.total++;
                await db.collection('products').updateOne(
                    { barcode: product.code },
                    {
                        $set: {
                            barcode: product.code,
                            itemCode: product.code,
                            name: product.name,
                            category: mapCategory(product.mfr, product.name),
                            manufacturer: product.mfr,
                            lastUpdated: new Date()
                        },
                        $push: {
                            prices: {
                                $each: [{
                                    chain: 'shufersal',
                                    chainName: 'שופרסל',
                                    price: product.price,
                                    lastUpdated: new Date()
                                }],
                                $slice: -10
                            }
                        }
                    },
                    { upsert: true }
                );
                stats.updated++;
            } catch (itemError) {
                stats.errors++;
            }
        }

        console.log(`Shufersal: ${stats.updated} products added`);
    } catch (error) {
        console.error('Shufersal fetch error:', error.message);
    }

    return stats;
}

// Helper function to process items from XML
async function processItem(item, chain, chainName, stats) {
    try {
        if (!item.ItemCode && !item.PriceUpdateDate) return;

        const itemCode = item.ItemCode?.toString() || item.BarCode?.toString();
        const price = parseFloat(item.ItemPrice || item.UnitPrice || 0);

        if (!itemCode || !price) return;

        stats.total++;
        const barcode = itemCode.padStart(13, '0');

        await db.collection('products').updateOne(
            { $or: [{ barcode }, { itemCode }] },
            {
                $set: {
                    barcode,
                    itemCode,
                    name: item.ItemName || item.ItemNm || item.ManufacturerItemDescription,
                    category: mapCategory(item.ManufacturerName, item.ItemName || item.ItemNm),
                    manufacturer: item.ManufacturerName,
                    lastUpdated: new Date()
                },
                $push: {
                    prices: {
                        $each: [{
                            chain,
                            chainName,
                            price,
                            lastUpdated: new Date()
                        }],
                        $slice: -10
                    }
                }
            },
            { upsert: true }
        );
        stats.updated++;
    } catch (itemError) {
        stats.errors++;
    }
}

// ========================================
// Rami Levy Price Fetcher (Cerberus)
// ========================================
async function fetchRamiLevyPrices() {
    console.log('Fetching Rami Levy prices...');
    const stats = { total: 0, updated: 0, errors: 0 };

    try {
        // Try Cerberus API
        const dirUrl = 'https://url.retail.publishedprices.co.il/file/json/dir';

        try {
            const dirResponse = await fetchUrl(dirUrl);
            const files = JSON.parse(dirResponse);

            // Find latest PriceFull file for Rami Levy
            const priceFiles = files.filter(f => f.name && f.name.includes('PriceFull'));

            if (priceFiles.length > 0) {
                const latestFile = priceFiles.sort((a, b) =>
                    new Date(b.date || b.lastModified) - new Date(a.date || a.lastModified)
                )[0];

                const fileUrl = `https://url.retail.publishedprices.co.il/file/d/${latestFile.name}`;
                console.log(`Fetching Rami Levy file: ${latestFile.name}`);

                const xmlData = await fetchUrl(fileUrl);
                const parsed = xmlParser.parse(xmlData);

                const items = parsed?.Root?.Items?.Item || parsed?.Items?.Item || [];
                const itemArray = Array.isArray(items) ? items : (items ? [items] : []);

                for (const item of itemArray.slice(0, 5000)) {
                    await processItem(item, 'rami_levy', 'רמי לוי', stats);
                }

                if (stats.updated > 0) {
                    console.log(`Rami Levy API: ${stats.updated} products updated`);
                    return stats;
                }
            }
        } catch (apiError) {
            console.log('Rami Levy API failed, using sample data...', apiError.message);
        }

        // Fallback: Sample products with Rami Levy prices (typically cheaper)
        const sampleProducts = [
            { code: '7290000000015', name: 'חלב תנובה 3% 1 ליטר', price: 6.50 },
            { code: '7290000000022', name: 'לחם אחיד פרוס', price: 7.90 },
            { code: '7290000000039', name: 'ביצים L 12 יח', price: 19.90 },
            { code: '7290000000046', name: 'גבינה צהובה 28% 200 גרם', price: 16.90 },
            { code: '7290000000053', name: 'שמן קנולה 1 ליטר', price: 12.90 },
            { code: '7290000000060', name: 'קוטג 5% 250 גרם', price: 6.90 },
            { code: '7290000000077', name: 'חמאה 100 גרם', price: 7.50 },
            { code: '7290000000084', name: 'שוקולד פרה 100 גרם', price: 6.90 },
            { code: '7290000000091', name: 'במבה 80 גרם', price: 5.90 },
            { code: '7290000000107', name: 'קורנפלקס 500 גרם', price: 14.90 },
            { code: '7290000000114', name: 'קפה נמס 200 גרם', price: 26.90 },
            { code: '7290000000121', name: 'חומוס 400 גרם', price: 8.90 },
            { code: '7290000000138', name: 'טחינה 500 גרם', price: 16.90 },
            { code: '7290000000145', name: 'אורז 1 קג', price: 9.90 },
            { code: '7290000000152', name: 'פסטה 500 גרם', price: 5.90 },
            { code: '7290000000169', name: 'רסק עגבניות 400 גרם', price: 4.90 },
            { code: '7290000000176', name: 'מיץ תפוזים 1 ליטר', price: 8.90 },
            { code: '7290000000183', name: 'מים מינרליים 1.5 ליטר', price: 3.90 },
            { code: '7290000000190', name: 'קולה 1.5 ליטר', price: 7.90 },
            { code: '7290000000206', name: 'יוגורט פרי 150 גרם', price: 3.90 }
        ];

        console.log('Using sample Rami Levy products for demo...');
        for (const product of sampleProducts) {
            try {
                stats.total++;
                await db.collection('products').updateOne(
                    { barcode: product.code },
                    {
                        $push: {
                            prices: {
                                $each: [{
                                    chain: 'rami_levy',
                                    chainName: 'רמי לוי',
                                    price: product.price,
                                    lastUpdated: new Date()
                                }],
                                $slice: -10
                            }
                        },
                        $set: { lastUpdated: new Date() }
                    }
                );
                stats.updated++;
            } catch (itemError) {
                stats.errors++;
            }
        }

        console.log(`Rami Levy: ${stats.updated} products updated`);
    } catch (error) {
        console.error('Rami Levy fetch error:', error.message);
    }

    return stats;
}

// ========================================
// Sync Endpoints
// ========================================

// Generic per-chain sync endpoint
app.post('/api/sync/chain/:chainId', async (req, res) => {
    try {
        const { chainId } = req.params;
        if (!CHAINS[chainId]) {
            return res.status(400).json({ success: false, error: `Unknown chain: ${chainId}. Valid: ${Object.keys(CHAINS).join(', ')}` });
        }

        console.log(`Manual sync triggered for ${chainId}...`);
        const result = await fetchChain(chainId);

        if (result.success && result.products.length > 0) {
            const storeStats = await storeChainProducts(chainId, result.products);
            await db.collection('settings').updateOne(
                { _id: 'sync-status' },
                { $set: { lastSync: new Date(), [`chainResults.${chainId}`]: { ...storeStats, productsFetched: result.products.length, syncedAt: new Date() } } },
                { upsert: true }
            );
            res.json({ success: true, message: `${result.chainName} sync complete`, stats: storeStats, productsFetched: result.products.length });
        } else {
            res.json({ success: false, message: `${result.chainName}: ${result.error || 'no products fetched'}` });
        }
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Backward-compatible aliases
app.post('/api/sync/shufersal', async (req, res) => {
    try {
        const result = await fetchChain('shufersal');
        if (result.success && result.products.length > 0) {
            const stats = await storeChainProducts('shufersal', result.products);
            res.json({ success: true, message: 'Shufersal sync complete', stats });
        } else {
            // Fallback to legacy sample data
            const stats = await fetchShufersalPrices();
            res.json({ success: true, message: 'Shufersal sync complete (fallback)', stats });
        }
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/api/sync/ramilevi', async (req, res) => {
    try {
        const result = await fetchChain('rami_levy');
        if (result.success && result.products.length > 0) {
            const stats = await storeChainProducts('rami_levy', result.products);
            res.json({ success: true, message: 'Rami Levy sync complete', stats });
        } else {
            const stats = await fetchRamiLevyPrices();
            res.json({ success: true, message: 'Rami Levy sync complete (fallback)', stats });
        }
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Full sync - all chains via unified fetcher
app.post('/api/sync/all', async (req, res) => {
    try {
        console.log('Full sync triggered for all chains...');
        const chainResults = await fetchAllChains();
        const allStats = {};

        for (const [chainId, result] of Object.entries(chainResults)) {
            if (result.success && result.products.length > 0) {
                allStats[chainId] = await storeChainProducts(chainId, result.products);
                allStats[chainId].productsFetched = result.products.length;
            } else {
                allStats[chainId] = { success: false, error: result.error, productsFetched: 0 };
            }
        }

        // Resolve images for new products
        const imageStats = await resolveImagesForProducts(db, 200);

        // Update sync status
        await db.collection('settings').updateOne(
            { _id: 'sync-status' },
            { $set: { lastSync: new Date(), results: allStats, imageStats, type: 'chain-fetcher-all' } },
            { upsert: true }
        );

        res.json({ success: true, message: 'Full sync complete', results: allStats, imageStats });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get sync status
app.get('/api/sync/status', async (req, res) => {
    try {
        const status = await db.collection('settings').findOne({ _id: 'sync-status' });
        const productCount = await db.collection('products').countDocuments();
        res.json({
            success: true,
            lastSync: status?.lastSync,
            productCount,
            results: status?.results,
            availableChains: Object.entries(CHAINS).map(([id, c]) => ({ id, name: c.name, type: c.type }))
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ========================================
// Python Scraper Integration (Real Data)
// ========================================

// Run Python scraper subprocess
const fs = require('fs');
const os = require('os');

async function runPythonScraper(chains = ['shufersal', 'rami_levy', 'victory']) {
    return new Promise((resolve, reject) => {
        const scriptPath = path.join(__dirname, 'scripts', 'scrape_prices.py');
        const outputFile = path.join(os.tmpdir(), `scraper_output_${Date.now()}.json`);

        console.log(`Starting Python scraper for chains: ${chains.join(', ')}`);
        console.log(`Output file: ${outputFile}`);

        // Use 'py' on Windows, 'python' on other platforms
        const pythonCmd = process.platform === 'win32' ? 'py' : 'python';
        const python = spawn(pythonCmd, [scriptPath, ...chains, '--output', outputFile], {
            cwd: __dirname,
            env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
            shell: true
        });

        python.stdout.on('data', (data) => {
            // Stdout now just contains the output file path (or library noise)
            console.log('[Python stdout]', data.toString().trim());
        });

        python.stderr.on('data', (data) => {
            // Log progress from stderr
            console.log('[Python]', data.toString().trim());
        });

        python.on('close', (code) => {
            console.log(`Python scraper exited with code ${code}`);

            if (code !== 0) {
                reject(new Error(`Python scraper failed with code ${code}`));
                return;
            }

            // Read result from temp file
            try {
                if (!fs.existsSync(outputFile)) {
                    reject(new Error('Output file not created'));
                    return;
                }
                const jsonContent = fs.readFileSync(outputFile, 'utf-8');
                const result = JSON.parse(jsonContent);

                // Clean up temp file
                fs.unlinkSync(outputFile);

                resolve(result);
            } catch (parseError) {
                reject(new Error(`Failed to read output file: ${parseError.message}`));
            }
        });

        python.on('error', (err) => {
            reject(new Error(`Failed to start Python scraper: ${err.message}`));
        });
    });
}

// Store scraped products in MongoDB
async function storeScrapedProducts(scraperResult) {
    const stats = { total: 0, updated: 0, errors: 0 };

    if (!scraperResult.chains) {
        return stats;
    }

    for (const [chainId, chainData] of Object.entries(scraperResult.chains)) {
        if (!chainData.success || !chainData.products) {
            console.log(`Skipping ${chainId}: ${chainData.error || 'no products'}`);
            continue;
        }

        console.log(`Storing ${chainData.products.length} products from ${chainId}...`);

        for (const product of chainData.products) {
            try {
                stats.total++;

                const barcode = product.barcode?.toString().padStart(13, '0');
                if (!barcode || !product.name || !product.price) {
                    continue;
                }

                await db.collection('products').updateOne(
                    { barcode },
                    {
                        $set: {
                            barcode,
                            itemCode: product.barcode,
                            name: product.name,
                            category: mapCategory(product.manufacturer, product.name),
                            manufacturer: product.manufacturer || '',
                            lastUpdated: new Date()
                        },
                        $push: {
                            prices: {
                                $each: [{
                                    chain: chainId,
                                    chainName: product.chain_hebrew || chainData.chain_hebrew,
                                    price: product.price,
                                    lastUpdated: new Date()
                                }],
                                $slice: -10  // Keep last 10 price entries
                            }
                        }
                    },
                    { upsert: true }
                );

                stats.updated++;
            } catch (itemError) {
                stats.errors++;
                if (stats.errors < 5) {
                    console.error(`Error storing product: ${itemError.message}`);
                }
            }
        }

        console.log(`${chainId}: stored ${stats.updated} products`);
    }

    return stats;
}

// POST /api/sync/seed - Seed database with real Israeli products
app.post('/api/sync/seed', async (req, res) => {
    try {
        const { seedDatabase } = require('./scripts/seed_products');
        console.log('Starting database seed...');

        // Run seed
        await seedDatabase(db);

        const productCount = await db.collection('products').countDocuments();

        res.json({
            success: true,
            message: 'Database seeded successfully',
            productCount,
            note: 'Real Israeli products with prices from Rami Levy, Shufersal, and Victory'
        });
    } catch (error) {
        console.error('Seed error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// POST /api/sync/kaggle - Import from Kaggle dataset (recommended)
app.post('/api/sync/kaggle', async (req, res) => {
    try {
        const limit = req.body.limit || 5000;
        const chains = req.body.chains; // Optional: specific chains

        console.log('Starting Kaggle dataset import...');

        // Check for Kaggle credentials
        if (!process.env.KAGGLE_USERNAME || !process.env.KAGGLE_KEY) {
            return res.status(400).json({
                success: false,
                error: 'Kaggle credentials not configured',
                instructions: [
                    '1. Create Kaggle account at kaggle.com',
                    '2. Go to Account Settings -> Create New API Token',
                    '3. Set KAGGLE_USERNAME and KAGGLE_KEY in Render environment variables'
                ]
            });
        }

        // Use Node.js Kaggle importer (no Python required)
        const { importFromKaggle } = require('./scripts/import_kaggle_node');
        const result = await importFromKaggle({ limit, chains });

        if (!result.success) {
            return res.status(500).json(result);
        }

        // Store products in MongoDB
        console.log(`Storing ${result.products.length} products in MongoDB...`);
        const stats = await storeKaggleProducts(result.products);

        // Update sync status
        await db.collection('settings').updateOne(
            { _id: 'sync-status' },
            {
                $set: {
                    lastSync: new Date(),
                    type: 'kaggle',
                    totalProducts: result.totalProducts,
                    chainsSummary: result.chainsSummary,
                    storeStats: stats
                }
            },
            { upsert: true }
        );

        res.json({
            success: true,
            message: 'Kaggle import completed',
            totalProducts: result.totalProducts,
            chainsSummary: result.chainsSummary,
            storeStats: stats,
            note: 'Products imported from Kaggle Israeli Supermarkets 2024 dataset'
        });

    } catch (error) {
        console.error('Kaggle import error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Store products from Kaggle import
async function storeKaggleProducts(products) {
    const stats = { inserted: 0, updated: 0, errors: 0 };

    for (const product of products) {
        try {
            // Find cheapest price
            const cheapestPrice = product.prices.reduce((min, p) =>
                p.price < min.price ? p : min, product.prices[0]);

            const result = await db.collection('products').updateOne(
                { barcode: product.barcode },
                {
                    $set: {
                        name: product.name,
                        manufacturer: product.manufacturer || '',
                        category: product.category || 'כללי',
                        image: product.image,
                        prices: product.prices,
                        cheapestPrice: cheapestPrice.price,
                        cheapestChain: cheapestPrice.chainName,
                        unitQty: product.unitQty || '',
                        unitMeasure: product.unitMeasure || '',
                        lastUpdated: new Date(),
                        dataSource: 'kaggle'
                    }
                },
                { upsert: true }
            );

            if (result.upsertedCount > 0) {
                stats.inserted++;
            } else if (result.modifiedCount > 0) {
                stats.updated++;
            }
        } catch (error) {
            stats.errors++;
        }
    }

    return stats;
}

// POST /api/sync/openfoodfacts - Import from Open Food Facts (no credentials, real products!)
app.post('/api/sync/openfoodfacts', async (req, res) => {
    try {
        const limit = req.body.limit || 500;

        console.log('Starting Open Food Facts import...');

        const { importFromOpenFoodFacts } = require('./scripts/import_openfoodfacts');
        const result = await importFromOpenFoodFacts({ limit });

        if (!result.success || result.products.length === 0) {
            return res.status(500).json({
                success: false,
                error: 'Open Food Facts import returned no products'
            });
        }

        // Store products
        console.log(`Storing ${result.products.length} products from Open Food Facts...`);
        const stats = await storeKaggleProducts(result.products);

        // Update sync status
        await db.collection('settings').updateOne(
            { _id: 'sync-status' },
            {
                $set: {
                    lastSync: new Date(),
                    type: 'openfoodfacts',
                    totalProducts: result.totalProducts,
                    chainsSummary: result.chainsSummary,
                    storeStats: stats
                }
            },
            { upsert: true }
        );

        res.json({
            success: true,
            message: 'Open Food Facts import completed',
            totalProducts: result.totalProducts,
            storeStats: stats,
            note: 'Real Israeli products from Open Food Facts with estimated prices'
        });

    } catch (error) {
        console.error('Open Food Facts import error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// POST /api/sync/direct - Import directly from official price portals (no credentials needed)
app.post('/api/sync/direct', async (req, res) => {
    try {
        const limit = req.body.limit || 3000;
        const chains = req.body.chains || ['shufersal', 'rami_levy', 'victory'];

        console.log('Starting direct price portal import...');

        const { importPrices } = require('./scripts/import_prices_direct');
        const result = await importPrices({ limit, chains });

        if (!result.success || result.products.length === 0) {
            return res.status(500).json({
                success: false,
                error: 'Direct import returned no products. Price portals may be geo-blocked or unavailable.',
                suggestion: 'Try /api/sync/seed for demo data, or /api/sync/kaggle with credentials.'
            });
        }

        // Store products
        console.log(`Storing ${result.products.length} products...`);
        const stats = await storeKaggleProducts(result.products);

        // Update sync status
        await db.collection('settings').updateOne(
            { _id: 'sync-status' },
            {
                $set: {
                    lastSync: new Date(),
                    type: 'direct',
                    totalProducts: result.totalProducts,
                    chainsSummary: result.chainsSummary,
                    storeStats: stats
                }
            },
            { upsert: true }
        );

        res.json({
            success: true,
            message: 'Direct import completed',
            totalProducts: result.totalProducts,
            chainsSummary: result.chainsSummary,
            storeStats: stats,
            note: 'Products imported from official Israeli price transparency portals'
        });

    } catch (error) {
        console.error('Direct import error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// POST /api/sync/auto - Automatically choose best import method
app.post('/api/sync/auto', async (req, res) => {
    console.log('Starting auto-import (trying best available method)...');

    // Method 1: Try Kaggle if credentials are set
    if (process.env.KAGGLE_USERNAME && process.env.KAGGLE_KEY) {
        console.log('Kaggle credentials found, trying Kaggle import...');
        try {
            // Forward to Kaggle endpoint
            const kaggleReq = { body: req.body };
            const kaggleRes = {
                json: (data) => res.json({ ...data, method: 'kaggle' }),
                status: (code) => ({ json: (data) => res.status(code).json(data) })
            };
            return app._router.handle(
                Object.assign(req, { url: '/api/sync/kaggle', method: 'POST' }),
                res,
                () => {}
            );
        } catch (e) {
            console.log('Kaggle failed, trying direct...');
        }
    }

    // Method 2: Try direct import from price portals
    console.log('Trying direct import from price portals...');
    try {
        const { importPrices } = require('./scripts/import_prices_direct');
        const result = await importPrices({ limit: 3000 });

        if (result.success && result.products.length > 0) {
            const stats = await storeKaggleProducts(result.products);

            await db.collection('settings').updateOne(
                { _id: 'sync-status' },
                {
                    $set: {
                        lastSync: new Date(),
                        type: 'direct',
                        totalProducts: result.totalProducts,
                        storeStats: stats
                    }
                },
                { upsert: true }
            );

            return res.json({
                success: true,
                method: 'direct',
                message: 'Imported from official price portals',
                totalProducts: result.totalProducts,
                storeStats: stats
            });
        }
    } catch (e) {
        console.log('Direct import failed:', e.message);
    }

    // Method 3: Fall back to seed data
    console.log('Falling back to seed data...');
    try {
        const { seedDatabase } = require('./scripts/seed_products');
        await seedDatabase(db);
        const productCount = await db.collection('products').countDocuments();

        await db.collection('settings').updateOne(
            { _id: 'sync-status' },
            {
                $set: {
                    lastSync: new Date(),
                    type: 'seed',
                    totalProducts: productCount
                }
            },
            { upsert: true }
        );

        return res.json({
            success: true,
            method: 'seed',
            message: 'Imported seed data (45+ real Israeli products)',
            totalProducts: productCount,
            note: 'Live imports unavailable. Using curated seed data with realistic prices.'
        });
    } catch (seedError) {
        return res.status(500).json({
            success: false,
            error: 'All import methods failed',
            details: seedError.message
        });
    }
});

// POST /api/sync/scrape - Trigger Python scraper for all/specified chains
app.post('/api/sync/scrape', async (req, res) => {
    try {
        const chains = req.body.chains || ['shufersal', 'rami_levy', 'victory'];

        console.log('Starting Python scraper sync...');
        res.json({
            success: true,
            message: 'Scrape started',
            chains,
            note: 'This may take several minutes. Check /api/sync/status for results.'
        });

        // Run scraper in background
        try {
            const scraperResult = await runPythonScraper(chains);
            const storeStats = await storeScrapedProducts(scraperResult);

            // Update sync status
            await db.collection('settings').updateOne(
                { _id: 'sync-status' },
                {
                    $set: {
                        lastSync: new Date(),
                        lastScrapeResult: {
                            success: scraperResult.success,
                            totalProducts: scraperResult.total_products,
                            storeStats,
                            chains: Object.keys(scraperResult.chains || {})
                        },
                        type: 'python-scraper'
                    }
                },
                { upsert: true }
            );

            console.log('Scrape complete:', storeStats);
        } catch (scrapeError) {
            console.error('Background scrape failed:', scrapeError.message);
            await db.collection('settings').updateOne(
                { _id: 'sync-status' },
                {
                    $set: {
                        lastScrapeError: scrapeError.message,
                        lastScrapeErrorTime: new Date()
                    }
                },
                { upsert: true }
            );
        }
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// POST /api/sync/scrape/:chain - Scrape specific chain
app.post('/api/sync/scrape/:chain', async (req, res) => {
    try {
        const chain = req.params.chain;
        const validChains = ['shufersal', 'rami_levy', 'mega', 'victory', 'yeinot_bitan', 'tiv_taam', 'osher_ad', 'hazi_hinam'];

        if (!validChains.includes(chain)) {
            return res.status(400).json({
                success: false,
                error: `Invalid chain. Valid chains: ${validChains.join(', ')}`
            });
        }

        console.log(`Starting Python scraper for ${chain}...`);

        const scraperResult = await runPythonScraper([chain]);
        const storeStats = await storeScrapedProducts(scraperResult);

        // Update sync status
        await db.collection('settings').updateOne(
            { _id: 'sync-status' },
            {
                $set: {
                    lastSync: new Date(),
                    [`chainResults.${chain}`]: {
                        success: scraperResult.chains?.[chain]?.success || false,
                        productsCount: scraperResult.chains?.[chain]?.products_count || 0,
                        scrapedAt: new Date()
                    }
                }
            },
            { upsert: true }
        );

        res.json({
            success: true,
            message: `${chain} scrape complete`,
            chain,
            stats: storeStats,
            productsScraped: scraperResult.chains?.[chain]?.products_count || 0
        });
    } catch (error) {
        console.error(`Scrape error for ${req.params.chain}:`, error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

// GET /api/sync/scrape/list - List available chains
app.get('/api/sync/scrape/list', async (req, res) => {
    try {
        const chains = [
            { id: 'shufersal', name: 'שופרסל', status: 'available' },
            { id: 'rami_levy', name: 'רמי לוי', status: 'available' },
            { id: 'mega', name: 'מגה', status: 'available' },
            { id: 'victory', name: 'ויקטורי', status: 'available' },
            { id: 'yeinot_bitan', name: 'יינות ביתן', status: 'available' },
            { id: 'tiv_taam', name: 'טיב טעם', status: 'available' },
            { id: 'osher_ad', name: 'אושר עד', status: 'available' },
            { id: 'hazi_hinam', name: 'חצי חינם', status: 'available' }
        ];

        res.json({ success: true, chains });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ========================================
// Updated Price Search (Real Data + Fallback)
// ========================================
app.get('/api/prices/search', async (req, res) => {
    try {
        const query = req.query.q;
        if (!query) {
            return res.status(400).json({ success: false, error: 'Query required' });
        }

        // Check cache first (1 hour TTL for real data)
        const cacheKey = `price-search-${query.toLowerCase().trim()}`;
        const cached = await db.collection('cache').findOne({
            _id: cacheKey,
            expiresAt: { $gt: new Date() }
        });

        if (cached) {
            return res.json({ success: true, results: cached.results, cached: true });
        }

        // Search in products collection (real data)
        let products = [];

        // Use regex search first (better for Hebrew)
        products = await db.collection('products')
            .find({ name: { $regex: query, $options: 'i' } })
            .limit(10)
            .toArray();

        // If no results, also search by category
        if (products.length === 0) {
            products = await db.collection('products')
                .find({ category: { $regex: query, $options: 'i' } })
                .limit(10)
                .toArray();
        }

        let results;

        if (products.length > 0) {
            // Return ALL matching products with their prices
            const allProducts = [];

            for (const product of products) {
                // Get prices for each chain
                const stores = [];
                if (product.prices && product.prices.length > 0) {
                    for (const p of product.prices) {
                        stores.push({
                            name: p.chainName,
                            chain: p.chain,
                            price: p.price
                        });
                    }
                    stores.sort((a, b) => a.price - b.price);
                }

                // Get image
                let imageUrl = product.image;
                if (!imageUrl) {
                    imageUrl = getCategoryFallback(product.category, product.name);
                }

                allProducts.push({
                    name: product.name,
                    barcode: product.barcode,
                    category: product.category,
                    manufacturer: product.manufacturer,
                    image: imageUrl,
                    stores,
                    cheapestPrice: stores.length > 0 ? stores[0].price : null,
                    cheapestStore: stores.length > 0 ? stores[0].name : null
                });
            }

            // Sort all products by cheapest price
            allProducts.sort((a, b) => (a.cheapestPrice || 999) - (b.cheapestPrice || 999));

            // Group by store for comparison view
            const byStore = {};
            for (const product of allProducts) {
                for (const store of product.stores) {
                    if (!byStore[store.name]) {
                        byStore[store.name] = { store: store.name, products: [], totalPrice: 0 };
                    }
                    byStore[store.name].products.push({
                        name: product.name,
                        price: store.price
                    });
                    byStore[store.name].totalPrice += store.price;
                }
            }

            results = {
                query,
                totalFound: products.length,
                products: allProducts,
                byStore: Object.values(byStore).sort((a, b) => a.totalPrice - b.totalPrice),
                cheapestOverall: allProducts[0]?.cheapestStore,
                disclaimer: `עודכן: ${new Date().toLocaleDateString('he-IL')}`,
                dataSource: 'real'
            };
        } else {
            // Fallback to OpenAI for products not in database
            if (!openai) {
                return res.json({
                    success: true,
                    results: {
                        query,
                        message: 'מוצר לא נמצא במאגר. השוואת מחירים דורשת הגדרת OPENAI_API_KEY',
                        stores: []
                    }
                });
            }

            const prompt = `אתה מומחה למחירי מוצרים בסופרמרקטים בישראל.
המשתמש מחפש: "${query}"

תן הערכת מחירים לפי הפורמט הזה בדיוק (JSON):
{
  "product": "שם המוצר המדויק בעברית",
  "productEnglish": "product name in english for image search",
  "category": "קטגוריה (מוצרי חלב/לחם ומאפים/פירות וירקות/בשר ודגים/שתייה/חטיפים/מוצרי ניקיון/אחר)",
  "stores": [
    { "name": "שופרסל", "price": מחיר_משוער, "note": "הערה קצרה אופציונלית" },
    { "name": "רמי לוי", "price": מחיר_משוער, "note": "הערה קצרה אופציונלית" },
    { "name": "ויקטורי", "price": מחיר_משוער, "note": "הערה קצרה אופציונלית" },
    { "name": "יינות ביתן", "price": מחיר_משוער, "note": "הערה קצרה אופציונלית" }
  ],
  "tip": "טיפ קצר לחיסכון",
  "cheapest": "שם הרשת הזולה ביותר"
}

המחירים צריכים להיות ריאליסטיים למחירים בישראל ב-2024-2025.
החזר רק JSON תקין, בלי טקסט נוסף.`;

            const completion = await openai.chat.completions.create({
                model: 'gpt-4o-mini',
                messages: [
                    { role: 'system', content: 'אתה עוזר שמחזיר רק JSON תקין. אל תוסיף הסברים או markdown.' },
                    { role: 'user', content: prompt }
                ],
                max_tokens: 500,
                temperature: 0.3
            });

            try {
                const responseText = completion.choices[0].message.content.trim();
                const cleanJson = responseText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
                const parsed = JSON.parse(cleanJson);

                const imageQuery = encodeURIComponent(parsed.productEnglish || parsed.product);
                const imageUrl = `https://source.unsplash.com/200x200/?${imageQuery},food,grocery`;

                results = {
                    query,
                    product: parsed.product,
                    productEnglish: parsed.productEnglish,
                    category: parsed.category,
                    image: imageUrl,
                    stores: parsed.stores.sort((a, b) => a.price - b.price),
                    tip: parsed.tip,
                    cheapest: parsed.cheapest,
                    disclaimer: 'מחירים משוערים - מומלץ לבדוק באתרי הרשתות',
                    dataSource: 'estimated'
                };
            } catch (parseError) {
                console.error('Error parsing OpenAI response:', parseError);
                results = {
                    query,
                    message: 'לא הצלחנו לקבל מחירים. נסה שוב.',
                    stores: [],
                    dataSource: 'error'
                };
            }
        }

        // Cache results (1 hour for real data, 6 hours for estimates)
        const expiresAt = new Date();
        expiresAt.setHours(expiresAt.getHours() + (results.dataSource === 'real' ? 1 : 6));
        await db.collection('cache').updateOne(
            { _id: cacheKey },
            { $set: { results, expiresAt, createdAt: new Date() } },
            { upsert: true }
        );

        res.json({ success: true, results, cached: false });
    } catch (error) {
        console.error('Error searching prices:', error);
        res.status(500).json({ success: false, error: 'Failed to search prices' });
    }
});

// ========================================
// Products List Endpoint
// ========================================
app.get('/api/products', async (req, res) => {
    try {
        const { category, limit = 50, search } = req.query;
        let query = {};

        if (category) {
            query.category = category;
        }

        if (search) {
            // Use regex for Hebrew search (more reliable than text search)
            query.name = { $regex: search, $options: 'i' };
        }

        const products = await db.collection('products')
            .find(query)
            .limit(parseInt(limit))
            .toArray();

        // Get unique categories
        const categories = await db.collection('products').distinct('category');

        res.json({
            success: true,
            count: products.length,
            categories,
            products: products.map(p => {
                const prices = Array.isArray(p.prices) && p.prices.length > 0 ? p.prices : [];
                const cheapest = prices.length > 0
                    ? prices.reduce((min, pr) => (pr.price < min.price ? pr : min), prices[0])
                    : null;
                return {
                    barcode: p.barcode,
                    name: p.name,
                    category: p.category,
                    manufacturer: p.manufacturer,
                    image: p.image,
                    prices,
                    cheapestPrice: cheapest ? cheapest.price : null,
                    cheapestChain: cheapest ? cheapest.chainName : null
                };
            })
        });
    } catch (error) {
        console.error('Products list error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ========================================
// Product by Barcode Endpoint
// ========================================
app.get('/api/products/barcode/:barcode', async (req, res) => {
    try {
        const barcode = req.params.barcode.padStart(13, '0');

        // First check local database
        let product = await db.collection('products').findOne({ barcode });

        if (!product) {
            // Try OpenFoodFacts
            const offUrl = `https://world.openfoodfacts.org/api/v2/product/${barcode}.json`;
            try {
                const response = await fetchUrl(offUrl);
                const data = JSON.parse(response);

                if (data.status === 1 && data.product) {
                    product = {
                        barcode,
                        name: data.product.product_name || data.product.product_name_he,
                        image: data.product.image_url || data.product.image_front_url,
                        category: data.product.categories_tags?.[0] || 'אחר',
                        source: 'openfoodfacts'
                    };
                }
            } catch (offError) {
                console.log('OpenFoodFacts lookup failed:', offError.message);
            }
        }

        if (product) {
            res.json({ success: true, product });
        } else {
            res.json({ success: false, message: 'Product not found' });
        }
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ========================================
// Background Sync Cron Job
// ========================================
// Clean up stale scraper temp directories to prevent /tmp from filling up
function cleanupScraperTmpDirs() {
    try {
        const tmpDir = os.tmpdir();
        const entries = fs.readdirSync(tmpDir);
        let cleaned = 0;
        for (const entry of entries) {
            if (entry.startsWith('supermarket_') || entry.startsWith('supermarket_prices_')) {
                const fullPath = path.join(tmpDir, entry);
                try {
                    fs.rmSync(fullPath, { recursive: true, force: true });
                    cleaned++;
                } catch (e) { /* skip entries we can't remove */ }
            }
        }
        if (cleaned > 0) {
            console.log(`Cleaned up ${cleaned} stale scraper temp directories from ${tmpDir}`);
        }
    } catch (e) {
        console.warn('Temp directory cleanup warning:', e.message);
    }
}

// ========================================
// Cron: Major chains every 8 hours (2AM, 10AM, 6PM)
// ========================================
const MAJOR_CHAINS = ['shufersal', 'rami_levy', 'victory', 'yeinot_bitan', 'osher_ad'];
const MINOR_CHAINS = ['hazi_hinam', 'tiv_taam', 'yohananof'];

cron.schedule('0 2,10,18 * * *', async () => {
    console.log('Starting scheduled major chains sync at', new Date().toISOString());
    cleanupScraperTmpDirs();

    try {
        const chainResults = await fetchAllChains(MAJOR_CHAINS);
        const allStats = {};

        for (const [chainId, result] of Object.entries(chainResults)) {
            if (result.success && result.products.length > 0) {
                allStats[chainId] = await storeChainProducts(chainId, result.products);
                allStats[chainId].productsFetched = result.products.length;
                console.log(`  Cron: ${chainId} - ${result.products.length} products stored`);
            } else {
                allStats[chainId] = { success: false, error: result.error, productsFetched: 0 };
                console.log(`  Cron: ${chainId} - failed: ${result.error}`);
            }
        }

        // Resolve images for new products
        const imageStats = await resolveImagesForProducts(db, 200);

        await db.collection('settings').updateOne(
            { _id: 'sync-status' },
            {
                $set: {
                    lastSync: new Date(),
                    results: allStats,
                    imageStats,
                    type: 'scheduled-major'
                }
            },
            { upsert: true }
        );

        console.log('Major chains sync complete:', JSON.stringify(Object.fromEntries(
            Object.entries(allStats).map(([k, v]) => [k, v.productsFetched || 0])
        )));
    } catch (error) {
        console.error('Scheduled major chains sync failed:', error);
    }
}, {
    timezone: 'Asia/Jerusalem'
});

// ========================================
// Cron: Minor chains daily at 3AM
// ========================================
cron.schedule('0 3 * * *', async () => {
    console.log('Starting scheduled minor chains sync at', new Date().toISOString());
    cleanupScraperTmpDirs();

    try {
        const chainResults = await fetchAllChains(MINOR_CHAINS);
        const allStats = {};

        for (const [chainId, result] of Object.entries(chainResults)) {
            if (result.success && result.products.length > 0) {
                allStats[chainId] = await storeChainProducts(chainId, result.products);
                allStats[chainId].productsFetched = result.products.length;
                console.log(`  Cron: ${chainId} - ${result.products.length} products stored`);
            } else {
                allStats[chainId] = { success: false, error: result.error, productsFetched: 0 };
            }
        }

        // Resolve images for new products
        const imageStats = await resolveImagesForProducts(db, 200);

        await db.collection('settings').updateOne(
            { _id: 'sync-status' },
            {
                $set: {
                    lastMinorSync: new Date(),
                    minorResults: allStats,
                    imageStats,
                    type: 'scheduled-minor'
                }
            },
            { upsert: true }
        );

        console.log('Minor chains sync complete');
    } catch (error) {
        console.error('Scheduled minor chains sync failed:', error);
    }
}, {
    timezone: 'Asia/Jerusalem'
});

// ========================================
// Cron: Image validation weekly Sunday 4AM
// ========================================
cron.schedule('0 4 * * 0', async () => {
    console.log('Starting weekly image validation at', new Date().toISOString());

    try {
        const stats = await validateAndRefreshImages(db, 500);
        console.log('Image validation complete:', stats);
    } catch (error) {
        console.error('Image validation failed:', error);
    }
}, {
    timezone: 'Asia/Jerusalem'
});

// Start server
connectDB().then(() => {
    app.listen(PORT, () => {
        console.log(`
    ╔════════════════════════════════════════════════╗
    ║                                                ║
    ║   💰 Budget Manager Running!                   ║
    ║                                                ║
    ║   Local:  http://localhost:${PORT}               ║
    ║                                                ║
    ╚════════════════════════════════════════════════╝
        `);
    });
});
