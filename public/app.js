// Budget Manager - Hebrew RTL Version with Shared Backend
// =====================================================

const API_URL = '';

// State
let state = {
    transactions: [],
    recurringTransactions: [],
    categories: { income: [], expense: [] },
    currentMonth: new Date(),
    currentType: 'expense',
    isRecurring: false,
    avatars: {
        Shai: '',
        Gal: '',
        Chubby: ''
    },
    budgets: {},
    editingTransactionId: null,
    searchQuery: '',
    searchMinAmount: '',
    searchMaxAmount: ''
};

// Hebrew month names
const hebrewMonths = [
    'ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני',
    'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'
];

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    init();
});

async function init() {
    await loadData();
    await loadAvatars();
    await loadBudgets();
    setupEventListeners();
    setupMobileMenu();
    setupAvatarUploads();
    setupSearchListeners();
    updateUI();
}

// API Functions
async function loadData() {
    try {
        const response = await fetch(`${API_URL}/api/data`);
        const data = await response.json();
        state.transactions = data.transactions || [];
        state.categories = data.categories || { income: [], expense: [] };
    } catch (error) {
        console.error('Error loading data:', error);
        showToast('שגיאה בטעינת נתונים', 'error');
    }
}

async function saveTransaction(transaction) {
    try {
        const response = await fetch(`${API_URL}/api/transactions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(transaction)
        });
        const result = await response.json();
        if (result.success) {
            state.transactions.push(result.transaction);
            updateUI();
            showToast('התנועה נשמרה בהצלחה!', 'success');
            return true;
        }
    } catch (error) {
        console.error('Error saving transaction:', error);
        showToast('שגיאה בשמירת התנועה', 'error');
    }
    return false;
}

async function deleteTransaction(id) {
    // Confirm before deleting
    if (!confirm('האם אתה בטוח שברצונך למחוק את התנועה?')) {
        return;
    }

    try {
        const response = await fetch(`${API_URL}/api/transactions/${id}`, {
            method: 'DELETE'
        });
        const result = await response.json();
        if (result.success) {
            state.transactions = state.transactions.filter(t => t.id !== id);
            updateUI();
            showToast('התנועה נמחקה', 'success');
        }
    } catch (error) {
        console.error('Error deleting transaction:', error);
        showToast('שגיאה במחיקת התנועה', 'error');
    }
}

async function updateTransaction(id, transaction) {
    try {
        const response = await fetch(`${API_URL}/api/transactions/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(transaction)
        });
        const result = await response.json();
        if (result.success) {
            const index = state.transactions.findIndex(t => t.id === id);
            if (index !== -1) {
                state.transactions[index] = result.transaction;
            }
            updateUI();
            showToast('התנועה עודכנה בהצלחה!', 'success');
            return true;
        }
    } catch (error) {
        console.error('Error updating transaction:', error);
        showToast('שגיאה בעדכון התנועה', 'error');
    }
    return false;
}

function editTransaction(id) {
    const transaction = state.transactions.find(t => t.id === id);
    if (!transaction) return;

    state.editingTransactionId = id;
    openModal(transaction);
}

// Budget Functions
async function loadBudgets() {
    try {
        const response = await fetch(`${API_URL}/api/budgets`);
        const budgets = await response.json();
        state.budgets = budgets || {};
    } catch (error) {
        console.error('Error loading budgets:', error);
    }
}

async function saveBudget(category, amount) {
    try {
        const budgets = { ...state.budgets, [category]: amount };
        delete budgets._id;

        const response = await fetch(`${API_URL}/api/budgets`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ budgets })
        });
        const result = await response.json();
        if (result.success) {
            state.budgets = result.budgets;
            updateUI();
            showToast('התקציב נשמר', 'success');
        }
    } catch (error) {
        console.error('Error saving budget:', error);
        showToast('שגיאה בשמירת התקציב', 'error');
    }
}

function getBudgetStatus() {
    const transactions = getMonthTransactions();
    const expensesByCategory = {};
    const budgetStatus = [];

    transactions.filter(t => t.type === 'expense').forEach(t => {
        expensesByCategory[t.category] = (expensesByCategory[t.category] || 0) + t.amount;
    });

    for (const category of (state.categories.expense || [])) {
        const spent = expensesByCategory[category] || 0;
        const budget = state.budgets[category];
        if (budget && budget > 0) {
            const percentage = Math.round((spent / budget) * 100);
            budgetStatus.push({
                category,
                spent,
                budget,
                percentage,
                remaining: budget - spent,
                isOver: spent > budget
            });
        }
    }

    return budgetStatus;
}

// Search Functions
function setupSearchListeners() {
    const searchInput = document.getElementById('searchInput');
    const searchMinAmount = document.getElementById('searchMinAmount');
    const searchMaxAmount = document.getElementById('searchMaxAmount');

    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            state.searchQuery = e.target.value;
            updateTransactionsList();
        });
    }

    if (searchMinAmount) {
        searchMinAmount.addEventListener('input', (e) => {
            state.searchMinAmount = e.target.value;
            updateTransactionsList();
        });
    }

    if (searchMaxAmount) {
        searchMaxAmount.addEventListener('input', (e) => {
            state.searchMaxAmount = e.target.value;
            updateTransactionsList();
        });
    }
}

function filterTransactions(transactions) {
    let filtered = [...transactions];

    // Text search (description, category)
    if (state.searchQuery) {
        const query = state.searchQuery.toLowerCase();
        filtered = filtered.filter(t =>
            (t.description && t.description.toLowerCase().includes(query)) ||
            (t.category && t.category.toLowerCase().includes(query)) ||
            (t.person && t.person.toLowerCase().includes(query))
        );
    }

    // Amount range filter
    if (state.searchMinAmount) {
        const min = parseFloat(state.searchMinAmount);
        filtered = filtered.filter(t => t.amount >= min);
    }

    if (state.searchMaxAmount) {
        const max = parseFloat(state.searchMaxAmount);
        filtered = filtered.filter(t => t.amount <= max);
    }

    return filtered;
}

// Per-Person Analytics
function calculatePersonStats() {
    const transactions = getMonthTransactions();
    const personStats = {};

    transactions.forEach(t => {
        const person = t.person || 'לא צוין';
        if (!personStats[person]) {
            personStats[person] = { income: 0, expense: 0, count: 0 };
        }
        personStats[person][t.type] += t.amount;
        personStats[person].count++;
    });

    return personStats;
}

async function addCategory(type) {
    const inputId = type === 'income' ? 'newIncomeCategory' : 'newExpenseCategory';
    const input = document.getElementById(inputId);
    const name = input.value.trim();

    if (!name) return;

    try {
        const response = await fetch(`${API_URL}/api/categories/${type}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name })
        });
        const result = await response.json();
        if (result.success) {
            state.categories = result.categories;
            updateUI();
            input.value = '';
            showToast('הקטגוריה נוספה', 'success');
        }
    } catch (error) {
        console.error('Error adding category:', error);
        showToast('שגיאה בהוספת קטגוריה', 'error');
    }
}

async function removeCategory(type, name) {
    try {
        const response = await fetch(`${API_URL}/api/categories/${type}/${encodeURIComponent(name)}`, {
            method: 'DELETE'
        });
        const result = await response.json();
        if (result.success) {
            state.categories = result.categories;
            updateUI();
            showToast('הקטגוריה נמחקה', 'success');
        }
    } catch (error) {
        console.error('Error removing category:', error);
    }
}

// Event Listeners
function setupEventListeners() {
    // Navigation
    document.querySelectorAll('.nav-item').forEach(item => {
        item.addEventListener('click', () => {
            document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
            item.classList.add('active');

            const viewId = item.dataset.view;
            document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
            document.getElementById(`${viewId}-view`).classList.add('active');

            updateUI();
        });
    });

    // View all link
    document.querySelectorAll('.view-all').forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            const navTarget = link.dataset.nav;
            document.querySelector(`[data-view="${navTarget}"]`).click();
        });
    });

    // Month navigation
    document.getElementById('prevMonth').addEventListener('click', () => {
        state.currentMonth.setMonth(state.currentMonth.getMonth() - 1);
        updateUI();
    });

    document.getElementById('nextMonth').addEventListener('click', () => {
        state.currentMonth.setMonth(state.currentMonth.getMonth() + 1);
        updateUI();
    });

    // Modal
    document.getElementById('addTransactionBtn').addEventListener('click', openModal);
    document.getElementById('closeModal').addEventListener('click', closeModal);
    document.getElementById('cancelBtn').addEventListener('click', closeModal);
    document.getElementById('modal').addEventListener('click', (e) => {
        if (e.target.id === 'modal') closeModal();
    });

    // Type toggle
    document.querySelectorAll('.type-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.type-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            state.currentType = btn.dataset.type;
            updateCategorySelect();
        });
    });

    // Person selector
    document.querySelectorAll('.person-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.person-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
        });
    });

    // Form submit
    document.getElementById('transactionForm').addEventListener('submit', handleFormSubmit);

    // Filters
    document.getElementById('typeFilter').addEventListener('change', updateTransactionsList);
    document.getElementById('categoryFilter').addEventListener('change', updateTransactionsList);
}

// Modal Functions
function openModal(transaction = null) {
    const modal = document.getElementById('modal');
    const dateInput = document.getElementById('date');
    const modalTitle = document.querySelector('.modal-header h2');
    const submitBtn = document.querySelector('#transactionForm .btn-primary');
    const recurringToggle = document.getElementById('recurringToggle');

    // Reset form
    document.getElementById('transactionForm').reset();
    state.isRecurring = false;
    if (recurringToggle) recurringToggle.checked = false;

    if (transaction) {
        // Edit mode - don't allow editing generated recurring transactions
        if (transaction.isGenerated) {
            showToast('לא ניתן לערוך תנועה קבועה שנוצרה אוטומטית', 'error');
            return;
        }

        modalTitle.textContent = 'עריכת תנועה';
        submitBtn.textContent = 'עדכן';

        // Set type
        state.currentType = transaction.type;
        document.querySelectorAll('.type-btn').forEach(b => {
            b.classList.toggle('active', b.dataset.type === transaction.type);
        });

        // Fill form fields
        document.getElementById('amount').value = transaction.amount;
        document.getElementById('description').value = transaction.description || '';
        document.getElementById('date').value = transaction.date;

        // Update category select and set value
        updateCategorySelect();
        document.getElementById('category').value = transaction.category;

        // Set person
        document.querySelectorAll('.person-btn').forEach(b => {
            b.classList.toggle('active', b.dataset.person === transaction.person);
        });

        // Set recurring toggle
        state.isRecurring = transaction.isRecurring || false;
        if (recurringToggle) recurringToggle.checked = state.isRecurring;
    } else {
        // Create mode
        modalTitle.textContent = 'תנועה חדשה';
        submitBtn.textContent = 'שמור';
        state.editingTransactionId = null;

        document.querySelectorAll('.type-btn').forEach(b => {
            b.classList.toggle('active', b.dataset.type === 'expense');
        });
        document.querySelectorAll('.person-btn').forEach(b => {
            b.classList.toggle('active', b.dataset.person === 'Shai');
        });

        state.currentType = 'expense';
        updateCategorySelect();

        // Set today's date
        dateInput.value = new Date().toISOString().split('T')[0];
    }

    modal.classList.add('active');
}

function closeModal() {
    document.getElementById('modal').classList.remove('active');
}

function updateCategorySelect() {
    const select = document.getElementById('category');
    const categories = state.categories[state.currentType] || [];

    select.innerHTML = categories.map(cat =>
        `<option value="${cat}">${cat}</option>`
    ).join('');
}

async function handleFormSubmit(e) {
    e.preventDefault();

    const recurringToggle = document.getElementById('recurringToggle');
    const transaction = {
        type: state.currentType,
        amount: parseFloat(document.getElementById('amount').value),
        category: document.getElementById('category').value,
        description: document.getElementById('description').value,
        date: document.getElementById('date').value,
        person: document.querySelector('.person-btn.active').dataset.person,
        isRecurring: recurringToggle ? recurringToggle.checked : false
    };

    let success;
    if (state.editingTransactionId) {
        success = await updateTransaction(state.editingTransactionId, transaction);
    } else {
        success = await saveTransaction(transaction);
    }

    if (success) {
        state.editingTransactionId = null;
        closeModal();
    }
}

// UI Update Functions
function updateUI() {
    updateMonthDisplay();
    updateStats();
    updateBudgetAlerts();
    updateBudgetProgress();
    updateRecentTransactions();
    updateTransactionsList();
    updateCategories();
    updateFilterOptions();
    updateCharts();
    updateAnalytics();
    updatePersonChart();
}

function updateMonthDisplay() {
    const month = hebrewMonths[state.currentMonth.getMonth()];
    const year = state.currentMonth.getFullYear();
    document.getElementById('currentMonth').textContent = `${month} ${year}`;
}

function getMonthTransactions() {
    const year = state.currentMonth.getFullYear();
    const month = state.currentMonth.getMonth();

    // Get regular transactions for this month
    const regularTransactions = state.transactions.filter(t => {
        const date = new Date(t.date);
        return date.getFullYear() === year && date.getMonth() === month;
    });

    // Generate recurring transactions for this month (if not already exists)
    const generatedRecurring = generateRecurringForMonth(year, month, regularTransactions);

    return [...regularTransactions, ...generatedRecurring];
}

function generateRecurringForMonth(year, month, existingTransactions) {
    const generated = [];
    const recurringTemplates = state.transactions.filter(t => t.isRecurring);

    for (const template of recurringTemplates) {
        const templateDate = new Date(template.date);
        const templateYear = templateDate.getFullYear();
        const templateMonth = templateDate.getMonth();

        // Don't generate for the original month or months before it
        if (year < templateYear || (year === templateYear && month <= templateMonth)) {
            continue;
        }

        // Check if a transaction with this recurring ID already exists for this month
        const alreadyExists = existingTransactions.some(t =>
            t.recurringSourceId === template.id ||
            (t.id === template.id && new Date(t.date).getMonth() === month)
        );

        if (!alreadyExists) {
            // Generate the transaction for this month
            const day = Math.min(template.recurringDay || templateDate.getDate(), new Date(year, month + 1, 0).getDate());
            generated.push({
                ...template,
                id: `recurring-${template.id}-${year}-${month}`,
                date: `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
                isGenerated: true,
                recurringSourceId: template.id
            });
        }
    }

    return generated;
}

function updateStats() {
    const transactions = getMonthTransactions();

    const income = transactions
        .filter(t => t.type === 'income')
        .reduce((sum, t) => sum + t.amount, 0);

    const expenses = transactions
        .filter(t => t.type === 'expense')
        .reduce((sum, t) => sum + t.amount, 0);

    const balance = income - expenses;
    const savingsRate = income > 0 ? Math.round((balance / income) * 100) : 0;

    document.getElementById('balance').textContent = formatCurrency(balance);
    document.getElementById('income').textContent = formatCurrency(income);
    document.getElementById('expenses').textContent = formatCurrency(expenses);
    document.getElementById('savingsRate').textContent = `${savingsRate}%`;

    // Update balance color
    const balanceEl = document.getElementById('balance');
    balanceEl.style.color = balance >= 0 ? 'var(--success)' : 'var(--danger)';
}

function updateRecentTransactions() {
    const container = document.getElementById('recentTransactions');
    const transactions = getMonthTransactions()
        .sort((a, b) => new Date(b.date) - new Date(a.date))
        .slice(0, 5);

    renderTransactions(container, transactions);
}

function updateTransactionsList() {
    const container = document.getElementById('allTransactions');
    const typeFilter = document.getElementById('typeFilter').value;
    const categoryFilter = document.getElementById('categoryFilter').value;

    let transactions = getMonthTransactions();

    if (typeFilter !== 'all') {
        transactions = transactions.filter(t => t.type === typeFilter);
    }

    if (categoryFilter !== 'all') {
        transactions = transactions.filter(t => t.category === categoryFilter);
    }

    // Apply search filters
    transactions = filterTransactions(transactions);

    transactions.sort((a, b) => new Date(b.date) - new Date(a.date));
    renderTransactions(container, transactions);
}

function renderTransactions(container, transactions) {
    if (transactions.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon">📭</div>
                <p>אין תנועות להצגה</p>
            </div>
        `;
        return;
    }

    container.innerHTML = transactions.map(t => {
        const isGenerated = t.isGenerated;
        const isRecurring = t.isRecurring;
        const transactionId = typeof t.id === 'string' ? `'${t.id}'` : t.id;

        return `
        <div class="transaction-item ${isRecurring || isGenerated ? 'recurring' : ''}">
            <div class="transaction-right">
                <div class="transaction-icon ${t.type}">
                    ${t.type === 'income' ? '📈' : '📉'}
                </div>
                <div class="transaction-details">
                    <h4>
                        ${t.description || t.category}
                        ${isRecurring || isGenerated ? '<span class="recurring-badge" title="תנועה קבועה">🔄</span>' : ''}
                    </h4>
                    <div class="transaction-meta">
                        <span>${t.category}</span>
                        <span>•</span>
                        <span>${formatDate(t.date)}</span>
                        ${t.person ? `<span>•</span>${getPersonAvatar(t.person)}<span>${t.person}</span>` : ''}
                        ${isGenerated ? '<span>•</span><span class="generated-label">נוצר אוטומטית</span>' : ''}
                    </div>
                </div>
            </div>
            <div class="transaction-left">
                <span class="transaction-amount ${t.type}">
                    ${t.type === 'income' ? '+' : '-'}${formatCurrency(t.amount)}
                </span>
                <div class="transaction-actions">
                    ${!isGenerated ? `
                        <button class="edit-btn" onclick="editTransaction(${transactionId})" title="ערוך">
                            ערוך
                        </button>
                        <button class="delete-btn" onclick="deleteTransaction(${transactionId})" title="מחק">
                            מחק
                        </button>
                    ` : `
                        <span class="auto-generated-hint">קבוע</span>
                    `}
                </div>
            </div>
        </div>
    `}).join('');
}

function updateCategories() {
    renderCategoryTags('incomeCategories', 'income');
    renderCategoryTags('expenseCategories', 'expense');
}

function renderCategoryTags(containerId, type) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const categories = state.categories[type] || [];
    container.innerHTML = categories.map(cat => `
        <span class="category-tag">
            ${cat}
            <button class="remove-category" onclick="removeCategory('${type}', '${cat}')">&times;</button>
        </span>
    `).join('');
}

function updateFilterOptions() {
    const select = document.getElementById('categoryFilter');
    const allCategories = [...(state.categories.income || []), ...(state.categories.expense || [])];
    const uniqueCategories = [...new Set(allCategories)];

    select.innerHTML = '<option value="all">כל הקטגוריות</option>' +
        uniqueCategories.map(cat => `<option value="${cat}">${cat}</option>`).join('');
}

// Charts
let charts = {};

function updateCharts() {
    updateDailyChart();
    updateExpensesPieChart();
}

function updateDailyChart() {
    const ctx = document.getElementById('dailyChart');
    if (!ctx) return;

    const transactions = getMonthTransactions();
    const daysInMonth = new Date(
        state.currentMonth.getFullYear(),
        state.currentMonth.getMonth() + 1,
        0
    ).getDate();

    const days = {};
    for (let i = 1; i <= daysInMonth; i++) {
        days[i] = { income: 0, expense: 0 };
    }

    transactions.forEach(t => {
        const day = new Date(t.date).getDate();
        if (days[day]) {
            days[day][t.type] += t.amount;
        }
    });

    const labels = Object.keys(days);
    const incomeData = labels.map(d => days[d].income);
    const expenseData = labels.map(d => days[d].expense);

    if (charts.daily) charts.daily.destroy();

    charts.daily = new Chart(ctx, {
        type: 'bar',
        data: {
            labels,
            datasets: [
                {
                    label: 'הכנסות',
                    data: incomeData,
                    backgroundColor: 'rgba(16, 185, 129, 0.8)',
                    borderRadius: 4
                },
                {
                    label: 'הוצאות',
                    data: expenseData,
                    backgroundColor: 'rgba(244, 63, 94, 0.8)',
                    borderRadius: 4
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'top',
                    rtl: true,
                    labels: { color: '#a1a1aa', font: { family: 'Heebo' } }
                }
            },
            scales: {
                x: {
                    grid: { color: 'rgba(255,255,255,0.05)' },
                    ticks: { color: '#a1a1aa' }
                },
                y: {
                    grid: { color: 'rgba(255,255,255,0.05)' },
                    ticks: { color: '#a1a1aa' }
                }
            }
        }
    });
}

function updateExpensesPieChart() {
    const ctx = document.getElementById('expensesPieChart');
    if (!ctx) return;

    const transactions = getMonthTransactions().filter(t => t.type === 'expense');
    const categories = {};

    transactions.forEach(t => {
        categories[t.category] = (categories[t.category] || 0) + t.amount;
    });

    const labels = Object.keys(categories);
    const values = Object.values(categories);

    const colors = [
        '#7c3aed', '#06b6d4', '#10b981', '#f59e0b', '#f43f5e',
        '#8b5cf6', '#14b8a6', '#84cc16', '#ec4899', '#6366f1'
    ];

    if (charts.expensesPie) charts.expensesPie.destroy();

    if (labels.length === 0) {
        ctx.parentElement.innerHTML = '<div class="empty-state"><p>אין נתונים להצגה</p></div>';
        return;
    }

    charts.expensesPie = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels,
            datasets: [{
                data: values,
                backgroundColor: colors.slice(0, labels.length),
                borderWidth: 0
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'left',
                    rtl: true,
                    labels: {
                        color: '#a1a1aa',
                        font: { family: 'Heebo' },
                        padding: 15
                    }
                }
            }
        }
    });
}

// Analytics
function updateAnalytics() {
    updateTrendChart();
    updateComparisonChart();
    updateSummaryTable();
    updatePersonStatsCards();
    updateBudgetSettings();
}

function updateTrendChart() {
    const ctx = document.getElementById('trendChart');
    if (!ctx) return;

    const months = [];
    const incomeData = [];
    const expenseData = [];

    for (let i = 5; i >= 0; i--) {
        const date = new Date(state.currentMonth);
        date.setMonth(date.getMonth() - i);

        const monthTransactions = state.transactions.filter(t => {
            const tDate = new Date(t.date);
            return tDate.getFullYear() === date.getFullYear() &&
                   tDate.getMonth() === date.getMonth();
        });

        months.push(hebrewMonths[date.getMonth()]);
        incomeData.push(monthTransactions.filter(t => t.type === 'income').reduce((sum, t) => sum + t.amount, 0));
        expenseData.push(monthTransactions.filter(t => t.type === 'expense').reduce((sum, t) => sum + t.amount, 0));
    }

    if (charts.trend) charts.trend.destroy();

    charts.trend = new Chart(ctx, {
        type: 'line',
        data: {
            labels: months,
            datasets: [
                {
                    label: 'הכנסות',
                    data: incomeData,
                    borderColor: '#10b981',
                    backgroundColor: 'rgba(16, 185, 129, 0.1)',
                    fill: true,
                    tension: 0.4
                },
                {
                    label: 'הוצאות',
                    data: expenseData,
                    borderColor: '#f43f5e',
                    backgroundColor: 'rgba(244, 63, 94, 0.1)',
                    fill: true,
                    tension: 0.4
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'top',
                    rtl: true,
                    labels: { color: '#a1a1aa', font: { family: 'Heebo' } }
                }
            },
            scales: {
                x: {
                    grid: { color: 'rgba(255,255,255,0.05)' },
                    ticks: { color: '#a1a1aa' }
                },
                y: {
                    grid: { color: 'rgba(255,255,255,0.05)' },
                    ticks: { color: '#a1a1aa' }
                }
            }
        }
    });
}

function updateComparisonChart() {
    const ctx = document.getElementById('comparisonChart');
    if (!ctx) return;

    const transactions = getMonthTransactions();
    const income = transactions.filter(t => t.type === 'income').reduce((sum, t) => sum + t.amount, 0);
    const expenses = transactions.filter(t => t.type === 'expense').reduce((sum, t) => sum + t.amount, 0);

    if (charts.comparison) charts.comparison.destroy();

    charts.comparison = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: ['הכנסות', 'הוצאות'],
            datasets: [{
                data: [income, expenses],
                backgroundColor: ['rgba(16, 185, 129, 0.8)', 'rgba(244, 63, 94, 0.8)'],
                borderRadius: 8,
                barThickness: 60
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false }
            },
            scales: {
                x: {
                    grid: { display: false },
                    ticks: { color: '#a1a1aa', font: { family: 'Heebo' } }
                },
                y: {
                    grid: { color: 'rgba(255,255,255,0.05)' },
                    ticks: { color: '#a1a1aa' }
                }
            }
        }
    });
}

function updateSummaryTable() {
    const container = document.getElementById('summaryTable');
    if (!container) return;

    const rows = [];

    for (let i = 5; i >= 0; i--) {
        const date = new Date(state.currentMonth);
        date.setMonth(date.getMonth() - i);

        const monthTransactions = state.transactions.filter(t => {
            const tDate = new Date(t.date);
            return tDate.getFullYear() === date.getFullYear() &&
                   tDate.getMonth() === date.getMonth();
        });

        const income = monthTransactions.filter(t => t.type === 'income').reduce((sum, t) => sum + t.amount, 0);
        const expenses = monthTransactions.filter(t => t.type === 'expense').reduce((sum, t) => sum + t.amount, 0);
        const balance = income - expenses;

        rows.push({
            month: `${hebrewMonths[date.getMonth()]} ${date.getFullYear()}`,
            income,
            expenses,
            balance
        });
    }

    container.innerHTML = `
        <table>
            <thead>
                <tr>
                    <th>חודש</th>
                    <th>הכנסות</th>
                    <th>הוצאות</th>
                    <th>יתרה</th>
                </tr>
            </thead>
            <tbody>
                ${rows.map(r => `
                    <tr>
                        <td>${r.month}</td>
                        <td style="color: #10b981">${formatCurrency(r.income)}</td>
                        <td style="color: #f43f5e">${formatCurrency(r.expenses)}</td>
                        <td style="color: ${r.balance >= 0 ? '#10b981' : '#f43f5e'}">${formatCurrency(r.balance)}</td>
                    </tr>
                `).join('')}
            </tbody>
        </table>
    `;
}

// Budget Alerts
function updateBudgetAlerts() {
    const container = document.getElementById('budgetAlerts');
    if (!container) return;

    const budgetStatus = getBudgetStatus();
    const overBudget = budgetStatus.filter(b => b.isOver);

    if (overBudget.length === 0) {
        container.innerHTML = '';
        container.style.display = 'none';
        return;
    }

    container.style.display = 'block';
    container.innerHTML = overBudget.map(b => `
        <div class="budget-alert">
            <span class="alert-icon">⚠️</span>
            <span class="alert-text">
                חריגה בקטגוריית <strong>${b.category}</strong>:
                הוצאת ${formatCurrency(b.spent)} מתוך תקציב של ${formatCurrency(b.budget)}
                (${b.percentage}%)
            </span>
        </div>
    `).join('');
}

// Budget Progress
function updateBudgetProgress() {
    const container = document.getElementById('budgetProgress');
    if (!container) return;

    const budgetStatus = getBudgetStatus();

    if (budgetStatus.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <p>לא הוגדרו תקציבים. הגדר תקציב בהגדרות.</p>
            </div>
        `;
        return;
    }

    container.innerHTML = budgetStatus.map(b => `
        <div class="budget-item">
            <div class="budget-header">
                <span class="budget-category">${b.category}</span>
                <span class="budget-amounts">${formatCurrency(b.spent)} / ${formatCurrency(b.budget)}</span>
            </div>
            <div class="progress-bar">
                <div class="progress-fill ${b.isOver ? 'over' : b.percentage > 80 ? 'warning' : ''}"
                     style="width: ${Math.min(b.percentage, 100)}%"></div>
            </div>
            <div class="budget-footer">
                <span class="budget-remaining ${b.isOver ? 'over' : ''}">
                    ${b.isOver ? `חריגה של ${formatCurrency(Math.abs(b.remaining))}` : `נותרו ${formatCurrency(b.remaining)}`}
                </span>
                <span class="budget-percentage">${b.percentage}%</span>
            </div>
        </div>
    `).join('');
}

// Person Analytics Chart
function updatePersonChart() {
    const ctx = document.getElementById('personChart');
    if (!ctx) return;

    const personStats = calculatePersonStats();
    const labels = Object.keys(personStats);
    const expenseData = labels.map(p => personStats[p].expense);

    const colors = ['#7c3aed', '#06b6d4', '#10b981', '#f59e0b', '#f43f5e'];

    if (charts.person) charts.person.destroy();

    if (labels.length === 0) {
        ctx.parentElement.innerHTML = '<div class="empty-state"><p>אין נתונים להצגה</p></div>';
        return;
    }

    charts.person = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels,
            datasets: [{
                data: expenseData,
                backgroundColor: colors.slice(0, labels.length),
                borderWidth: 0
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'left',
                    rtl: true,
                    labels: {
                        color: '#a1a1aa',
                        font: { family: 'Heebo' },
                        padding: 15
                    }
                },
                title: {
                    display: false
                }
            }
        }
    });
}

// Update Person Stats Cards
function updatePersonStatsCards() {
    const container = document.getElementById('personStatsCards');
    if (!container) return;

    const personStats = calculatePersonStats();

    container.innerHTML = Object.entries(personStats).map(([person, stats]) => `
        <div class="person-stat-card">
            <div class="person-stat-header">
                ${getPersonAvatar(person)}
                <span class="person-stat-name">${person}</span>
            </div>
            <div class="person-stat-details">
                <div class="person-stat-row">
                    <span>הוצאות:</span>
                    <span class="expense">${formatCurrency(stats.expense)}</span>
                </div>
                <div class="person-stat-row">
                    <span>הכנסות:</span>
                    <span class="income">${formatCurrency(stats.income)}</span>
                </div>
                <div class="person-stat-row">
                    <span>מספר תנועות:</span>
                    <span>${stats.count}</span>
                </div>
            </div>
        </div>
    `).join('');
}

// Budget Settings
function updateBudgetSettings() {
    const container = document.getElementById('budgetSettings');
    if (!container) return;

    const categories = state.categories.expense || [];

    container.innerHTML = categories.map(cat => `
        <div class="budget-setting-item">
            <label>${cat}</label>
            <div class="budget-input-wrapper">
                <span class="currency-symbol">₪</span>
                <input type="number"
                       class="budget-input"
                       value="${state.budgets[cat] || ''}"
                       placeholder="ללא הגבלה"
                       onchange="saveBudget('${cat}', this.value ? parseFloat(this.value) : 0)">
            </div>
        </div>
    `).join('');
}

// Utilities
function formatCurrency(amount) {
    return new Intl.NumberFormat('he-IL', {
        style: 'currency',
        currency: 'ILS',
        minimumFractionDigits: 0,
        maximumFractionDigits: 0
    }).format(amount);
}

function formatDate(dateStr) {
    const date = new Date(dateStr);
    return date.toLocaleDateString('he-IL', {
        day: 'numeric',
        month: 'short'
    });
}

function showToast(message, type = 'success') {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.className = `toast ${type} show`;

    setTimeout(() => {
        toast.classList.remove('show');
    }, 3000);
}

// Mobile Navigation
function setupMobileMenu() {
    // Mobile bottom navigation
    const mobileNavItems = document.querySelectorAll('.mobile-nav-item[data-view]');
    mobileNavItems.forEach(item => {
        item.addEventListener('click', () => {
            // Update active states
            mobileNavItems.forEach(i => i.classList.remove('active'));
            item.classList.add('active');

            // Also update desktop nav
            const viewId = item.dataset.view;
            document.querySelectorAll('.nav-item').forEach(nav => {
                nav.classList.toggle('active', nav.dataset.view === viewId);
            });

            // Show the view
            document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
            document.getElementById(`${viewId}-view`).classList.add('active');

            updateUI();
        });
    });

    // Mobile add button
    const mobileAddBtn = document.getElementById('mobileAddBtn');
    if (mobileAddBtn) {
        mobileAddBtn.addEventListener('click', openModal);
    }

    // Sync desktop nav clicks with mobile nav
    document.querySelectorAll('.nav-item').forEach(item => {
        item.addEventListener('click', () => {
            const viewId = item.dataset.view;
            mobileNavItems.forEach(mobileItem => {
                mobileItem.classList.toggle('active', mobileItem.dataset.view === viewId);
            });
        });
    });
}

// Avatar Management
function setupAvatarUploads() {
    const shaiInput = document.getElementById('shaiAvatarInput');
    const galInput = document.getElementById('galAvatarInput');
    const chubbyInput = document.getElementById('chubbyAvatarInput');

    if (shaiInput) {
        shaiInput.addEventListener('change', (e) => handleAvatarUpload(e, 'Shai'));
    }
    if (galInput) {
        galInput.addEventListener('change', (e) => handleAvatarUpload(e, 'Gal'));
    }
    if (chubbyInput) {
        chubbyInput.addEventListener('change', (e) => handleAvatarUpload(e, 'Chubby'));
    }
}

function handleAvatarUpload(event, person) {
    const file = event.target.files[0];
    if (!file) return;

    // Compress image before uploading
    const reader = new FileReader();
    reader.onload = async (e) => {
        const img = new Image();
        img.onload = async () => {
            // Resize to max 200x200 to reduce size
            const canvas = document.createElement('canvas');
            const maxSize = 200;
            let width = img.width;
            let height = img.height;

            if (width > height) {
                if (width > maxSize) {
                    height *= maxSize / width;
                    width = maxSize;
                }
            } else {
                if (height > maxSize) {
                    width *= maxSize / height;
                    height = maxSize;
                }
            }

            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, width, height);

            const dataUrl = canvas.toDataURL('image/jpeg', 0.8);

            // Save to server
            try {
                const response = await fetch(`${API_URL}/api/avatars/${person}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ avatar: dataUrl })
                });
                const result = await response.json();
                if (result.success) {
                    state.avatars[person] = dataUrl;
                    updateAvatarDisplays();
                    showToast(`תמונת ${person} עודכנה`, 'success');
                }
            } catch (error) {
                console.error('Error saving avatar:', error);
                showToast('שגיאה בשמירת התמונה', 'error');
            }
        };
        img.src = e.target.result;
    };
    reader.readAsDataURL(file);
}

async function loadAvatars() {
    try {
        const response = await fetch(`${API_URL}/api/avatars`);
        const avatars = await response.json();
        state.avatars.Shai = avatars.Shai || '';
        state.avatars.Gal = avatars.Gal || '';
        state.avatars.Chubby = avatars.Chubby || '';
    } catch (error) {
        console.error('Error loading avatars:', error);
    }
    updateAvatarDisplays();
}

function updateAvatarDisplays() {
    // Update settings page avatars
    const shaiPreview = document.getElementById('shaiAvatar');
    const galPreview = document.getElementById('galAvatar');
    const chubbyPreview = document.getElementById('chubbyAvatar');

    if (shaiPreview) {
        if (state.avatars.Shai) {
            shaiPreview.innerHTML = `<img src="${state.avatars.Shai}" alt="Shai">`;
        } else {
            shaiPreview.innerHTML = '<span>S</span>';
        }
    }

    if (galPreview) {
        if (state.avatars.Gal) {
            galPreview.innerHTML = `<img src="${state.avatars.Gal}" alt="Gal">`;
        } else {
            galPreview.innerHTML = '<span>G</span>';
        }
    }

    if (chubbyPreview) {
        if (state.avatars.Chubby) {
            chubbyPreview.innerHTML = `<img src="${state.avatars.Chubby}" alt="Chubby">`;
        } else {
            chubbyPreview.innerHTML = '<span>C</span>';
        }
    }

    // Update modal person buttons
    const shaiBtn = document.getElementById('shaiAvatarBtn');
    const galBtn = document.getElementById('galAvatarBtn');
    const chubbyBtn = document.getElementById('chubbyAvatarBtn');

    if (shaiBtn) {
        if (state.avatars.Shai) {
            shaiBtn.src = state.avatars.Shai;
            shaiBtn.style.display = 'block';
        } else {
            shaiBtn.style.display = 'none';
        }
    }

    if (galBtn) {
        if (state.avatars.Gal) {
            galBtn.src = state.avatars.Gal;
            galBtn.style.display = 'block';
        } else {
            galBtn.style.display = 'none';
        }
    }

    if (chubbyBtn) {
        if (state.avatars.Chubby) {
            chubbyBtn.src = state.avatars.Chubby;
            chubbyBtn.style.display = 'block';
        } else {
            chubbyBtn.style.display = 'none';
        }
    }
}

function getPersonAvatar(person) {
    if (person === 'Shai' && state.avatars.Shai) {
        return `<img src="${state.avatars.Shai}" alt="Shai" class="transaction-person-avatar">`;
    } else if (person === 'Gal' && state.avatars.Gal) {
        return `<img src="${state.avatars.Gal}" alt="Gal" class="transaction-person-avatar">`;
    } else if (person === 'Chubby' && state.avatars.Chubby) {
        return `<img src="${state.avatars.Chubby}" alt="Chubby" class="transaction-person-avatar">`;
    } else if (person === 'משותף') {
        return '<span class="transaction-person-initial">👫</span>';
    } else {
        const initial = person ? person.charAt(0).toUpperCase() : '?';
        return `<span class="transaction-person-initial">${initial}</span>`;
    }
}

// AI Insights
async function getAIInsights() {
    const container = document.getElementById('aiInsightsContent');
    const btn = document.getElementById('getInsightsBtn');

    if (!container) return;

    // Show loading state
    container.innerHTML = `
        <div class="insights-loading">
            <div class="loading-spinner"></div>
            <p>מנתח את הנתונים...</p>
        </div>
    `;
    if (btn) btn.disabled = true;

    try {
        const transactions = getMonthTransactions();
        const response = await fetch(`${API_URL}/api/insights`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                transactions,
                budgets: state.budgets,
                month: state.currentMonth.getMonth() + 1,
                year: state.currentMonth.getFullYear()
            })
        });

        const result = await response.json();

        if (result.success) {
            container.innerHTML = `
                <div class="insights-content">
                    ${formatInsights(result.insights)}
                </div>
                <div class="insights-footer">
                    <span class="insights-timestamp">עודכן: ${new Date().toLocaleTimeString('he-IL')}</span>
                </div>
            `;
        } else {
            container.innerHTML = `
                <div class="insights-error">
                    <span class="error-icon">⚠️</span>
                    <p>${result.error || 'שגיאה בקבלת תובנות'}</p>
                    ${result.error?.includes('not configured') ? '<p class="setup-hint">הוסף OPENAI_API_KEY לקובץ .env</p>' : ''}
                </div>
            `;
        }
    } catch (error) {
        console.error('Error getting insights:', error);
        container.innerHTML = `
            <div class="insights-error">
                <span class="error-icon">❌</span>
                <p>שגיאה בחיבור לשרת</p>
            </div>
        `;
    }

    if (btn) btn.disabled = false;
}

function formatInsights(text) {
    // Convert markdown-style formatting to HTML
    return text
        .split('\n')
        .map(line => {
            if (line.startsWith('###')) return `<h4>${line.replace('###', '').trim()}</h4>`;
            if (line.startsWith('##')) return `<h3>${line.replace('##', '').trim()}</h3>`;
            if (line.startsWith('#')) return `<h2>${line.replace('#', '').trim()}</h2>`;
            if (line.startsWith('- ') || line.startsWith('* ')) return `<li>${line.substring(2)}</li>`;
            if (line.match(/^\d+\./)) return `<li>${line.replace(/^\d+\./, '').trim()}</li>`;
            if (line.trim() === '') return '<br>';
            return `<p>${line}</p>`;
        })
        .join('')
        .replace(/(<li>.*<\/li>)+/g, '<ul>$&</ul>')
        .replace(/<\/ul><ul>/g, '');
}

// Make functions globally available
window.addCategory = addCategory;
window.removeCategory = removeCategory;
window.deleteTransaction = deleteTransaction;
window.editTransaction = editTransaction;
window.saveBudget = saveBudget;
window.getAIInsights = getAIInsights;
