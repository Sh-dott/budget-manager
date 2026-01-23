require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { MongoClient, ObjectId } = require('mongodb');
const path = require('path');

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
            createdAt: new Date().toISOString()
        };

        await db.collection('transactions').insertOne(transaction);
        res.json({ success: true, transaction });
    } catch (error) {
        console.error('Error adding transaction:', error);
        res.status(500).json({ success: false, error: 'Failed to save transaction' });
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
