require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { MongoClient, ObjectId } = require('mongodb');
const path = require('path');
const OpenAI = require('openai');

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
        res.json(avatarsDoc || { Shai: '', Gal: '' });
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
        res.json(budgetsDoc || { _id: 'budgets' });
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
// Price Search API (Using OpenAI for Israeli Price Estimates)
// ========================================
app.get('/api/prices/search', async (req, res) => {
    try {
        const query = req.query.q;
        if (!query) {
            return res.status(400).json({ success: false, error: 'Query required' });
        }

        // Check cache (6 hour TTL)
        const cacheKey = `price-search-${query.toLowerCase().trim()}`;
        const cached = await db.collection('cache').findOne({
            _id: cacheKey,
            expiresAt: { $gt: new Date() }
        });

        if (cached) {
            return res.json({ success: true, results: cached.results, cached: true });
        }

        // Use OpenAI to get price estimates
        if (!openai) {
            return res.json({
                success: true,
                results: {
                    query,
                    message: 'השוואת מחירים דורשת הגדרת OPENAI_API_KEY',
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

        let results;
        try {
            const responseText = completion.choices[0].message.content.trim();
            // Clean up potential markdown code blocks
            const cleanJson = responseText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
            const parsed = JSON.parse(cleanJson);

            // Generate image URL using a free image service
            const imageQuery = encodeURIComponent(parsed.productEnglish || parsed.product);
            const imageUrl = `https://source.unsplash.com/200x200/?${imageQuery},food,grocery`;

            results = {
                query,
                product: parsed.product,
                productEnglish: parsed.productEnglish,
                category: parsed.category,
                image: imageUrl,
                stores: parsed.stores.sort((a, b) => a.price - b.price), // Sort by price
                tip: parsed.tip,
                cheapest: parsed.cheapest,
                disclaimer: 'המחירים הם הערכות בלבד. מומלץ לבדוק באתרי הרשתות.'
            };
        } catch (parseError) {
            console.error('Error parsing OpenAI response:', parseError);
            results = {
                query,
                message: 'לא הצלחנו לקבל מחירים. נסה שוב.',
                stores: []
            };
        }

        // Cache for 6 hours
        const expiresAt = new Date();
        expiresAt.setHours(expiresAt.getHours() + 6);
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
