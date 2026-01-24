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
