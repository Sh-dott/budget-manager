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

// Price Search State
let priceSearchState = {
    originalResults: null,  // Store original API results
    filteredProducts: [],   // Currently filtered products
    selectedChains: [],     // Selected chain filters
    sortBy: 'price-asc',    // price-asc, price-desc, name
    viewMode: 'cards'       // cards, compact, table
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
    try {
        await loadData();
        await loadAvatars();
        await loadBudgets();
        setupEventListeners();
        setupMobileMenu();
        setupAvatarUploads();
        setupSearchListeners();
        updateUI();
    } catch (error) {
        console.error('Error initializing app:', error);
        showToast('שגיאה באתחול האפליקציה', 'error');
    }
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
    try {
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
    document.getElementById('addTransactionBtn').addEventListener('click', () => openModal());
    document.getElementById('closeModal').addEventListener('click', closeModal);
    document.getElementById('cancelBtn').addEventListener('click', closeModal);
    document.getElementById('modal').addEventListener('click', (e) => {
        if (e.target.id === 'modal') closeModal();
    });

    // Type toggle
    document.querySelectorAll('.type-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            try {
                document.querySelectorAll('.type-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                const newType = btn.dataset.type;
                if (newType === 'income' || newType === 'expense') {
                    state.currentType = newType;
                    updateCategorySelect();
                }
            } catch (error) {
                console.error('Error switching type:', error);
            }
        });
    });

    // Person selector
    document.querySelectorAll('.person-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            try {
                document.querySelectorAll('.person-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
            } catch (error) {
                console.error('Error switching person:', error);
            }
        });
    });

    // Form submit
    const form = document.getElementById('transactionForm');
    if (form) {
        form.addEventListener('submit', handleFormSubmit);
    }

    // Filters
    const typeFilter = document.getElementById('typeFilter');
    const categoryFilter = document.getElementById('categoryFilter');
    if (typeFilter) {
        typeFilter.addEventListener('change', updateTransactionsList);
    }
    if (categoryFilter) {
        categoryFilter.addEventListener('change', updateTransactionsList);
    }
    } catch (error) {
        console.error('Error setting up event listeners:', error);
    }
}

// Modal Functions
function openModal(transaction = null) {
    try {
        const modal = document.getElementById('modal');
        const dateInput = document.getElementById('date');
        const modalTitle = document.querySelector('.modal-header h2');
        const submitBtn = document.querySelector('#transactionForm .btn-primary');
        const recurringToggle = document.getElementById('recurringToggle');

        if (!modal || !dateInput) {
            console.error('Modal elements not found');
            return;
        }

        // Ensure transaction is a valid object (not an Event)
        if (transaction && (transaction instanceof Event || typeof transaction.type !== 'string')) {
            transaction = null;
        }

        // Reset form
        const form = document.getElementById('transactionForm');
        if (form) form.reset();

        state.isRecurring = false;
        state.editingTransactionId = null;
        if (recurringToggle) recurringToggle.checked = false;

        if (transaction && transaction.id) {
            // Edit mode - don't allow editing generated recurring transactions
            if (transaction.isGenerated) {
                showToast('לא ניתן לערוך תנועה קבועה שנוצרה אוטומטית', 'error');
                return;
            }

            state.editingTransactionId = transaction.id;
            if (modalTitle) modalTitle.textContent = 'עריכת תנועה';
            if (submitBtn) submitBtn.textContent = 'עדכן';

            // Set type
            state.currentType = transaction.type || 'expense';
            document.querySelectorAll('.type-btn').forEach(b => {
                b.classList.toggle('active', b.dataset.type === state.currentType);
            });

            // Fill form fields
            const amountInput = document.getElementById('amount');
            const descInput = document.getElementById('description');
            if (amountInput) amountInput.value = transaction.amount || '';
            if (descInput) descInput.value = transaction.description || '';
            if (dateInput) dateInput.value = transaction.date || '';

            // Update category select and set value
            updateCategorySelect();
            const categorySelect = document.getElementById('category');
            if (categorySelect && transaction.category) {
                categorySelect.value = transaction.category;
            }

            // Set person
            document.querySelectorAll('.person-btn').forEach(b => {
                b.classList.toggle('active', b.dataset.person === transaction.person);
            });

            // Set recurring toggle
            state.isRecurring = transaction.isRecurring || false;
            if (recurringToggle) recurringToggle.checked = state.isRecurring;
        } else {
            // Create mode
            if (modalTitle) modalTitle.textContent = 'תנועה חדשה';
            if (submitBtn) submitBtn.textContent = 'שמור';

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
    } catch (error) {
        console.error('Error opening modal:', error);
        showToast('שגיאה בפתיחת החלון', 'error');
    }
}

function closeModal() {
    document.getElementById('modal').classList.remove('active');
}

function updateCategorySelect() {
    try {
        const select = document.getElementById('category');
        if (!select) {
            console.warn('Category select element not found');
            return;
        }

        const categories = state.categories && state.categories[state.currentType]
            ? state.categories[state.currentType]
            : [];

        select.innerHTML = categories.map(cat =>
            `<option value="${cat}">${cat}</option>`
        ).join('');
    } catch (error) {
        console.error('Error updating category select:', error);
    }
}

async function handleFormSubmit(e) {
    e.preventDefault();

    try {
        const recurringToggle = document.getElementById('recurringToggle');
        const activePersonBtn = document.querySelector('.person-btn.active');

        const transaction = {
            type: state.currentType,
            amount: parseFloat(document.getElementById('amount').value) || 0,
            category: document.getElementById('category').value || '',
            description: document.getElementById('description').value || '',
            date: document.getElementById('date').value || new Date().toISOString().split('T')[0],
            person: activePersonBtn ? activePersonBtn.dataset.person : 'Shai',
            isRecurring: recurringToggle ? recurringToggle.checked : false
        };

        if (!transaction.amount || transaction.amount <= 0) {
            showToast('נא להזין סכום תקין', 'error');
            return;
        }

        if (!transaction.category) {
            showToast('נא לבחור קטגוריה', 'error');
            return;
        }

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
    } catch (error) {
        console.error('Error submitting form:', error);
        showToast('שגיאה בשמירת התנועה', 'error');
    }
}

// UI Update Functions
function updateUI() {
    try {
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
    } catch (error) {
        console.error('Error updating UI:', error);
    }
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
        mobileAddBtn.addEventListener('click', () => openModal());
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

// ========================================
// AI Insights Widgets
// ========================================

// Daily Tips Widget - Auto-loads on dashboard
async function loadDailyTipsWidget() {
    const container = document.getElementById('dailyTipContent');
    if (!container) return;

    // Check localStorage cache first (24h TTL)
    const cached = localStorage.getItem('dailyTip');
    if (cached) {
        const { tip, timestamp } = JSON.parse(cached);
        const age = Date.now() - timestamp;
        if (age < 24 * 60 * 60 * 1000) { // 24 hours
            container.innerHTML = `<p class="tip-text">${tip}</p>`;
            return;
        }
    }

    container.innerHTML = '<div class="widget-loading">💭 מחפש טיפים...</div>';

    try {
        const response = await fetch(`${API_URL}/api/insights/daily-tips`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });
        const result = await response.json();

        if (result.success) {
            container.innerHTML = `<p class="tip-text">${result.tip}</p>`;
            // Cache in localStorage
            localStorage.setItem('dailyTip', JSON.stringify({
                tip: result.tip,
                timestamp: Date.now()
            }));
        } else {
            container.innerHTML = '<p class="tip-error">לא ניתן לטעון טיפ</p>';
        }
    } catch (error) {
        console.error('Error loading daily tip:', error);
        container.innerHTML = '<p class="tip-error">שגיאה בטעינת טיפ</p>';
    }
}

async function refreshDailyTips() {
    // Clear cache and reload
    localStorage.removeItem('dailyTip');
    await loadDailyTipsWidget();
    showToast('הטיפ עודכן!', 'success');
}

// Anomaly Detection Widget - Auto-loads on dashboard
async function loadAnomalyWidget() {
    const container = document.getElementById('anomalyContent');
    if (!container) return;

    // Check dismissed anomalies
    const dismissed = JSON.parse(localStorage.getItem('dismissedAnomalies') || '[]');

    container.innerHTML = '<div class="widget-loading">🔍 בודק חריגות...</div>';

    try {
        const response = await fetch(`${API_URL}/api/insights/anomalies`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });
        const result = await response.json();

        if (result.success && result.anomalies.length > 0) {
            // Filter out dismissed anomalies
            const activeAnomalies = result.anomalies.filter(a =>
                !dismissed.includes(`${a.category}-${new Date().getMonth()}`)
            );

            if (activeAnomalies.length > 0) {
                container.innerHTML = activeAnomalies.map(a => `
                    <div class="anomaly-chip ${a.severity}" data-category="${a.category}">
                        <span class="anomaly-icon">${a.severity === 'high' ? '🚨' : a.severity === 'medium' ? '⚠️' : '📊'}</span>
                        <span class="anomaly-text">
                            ${a.category}: ₪${a.currentAmount.toLocaleString()} (ממוצע: ₪${a.average.toLocaleString()})
                        </span>
                        <button class="dismiss-btn" onclick="dismissAnomaly('${a.category}')" title="סגור">×</button>
                    </div>
                `).join('');
            } else {
                container.innerHTML = '<p class="no-anomalies">✅ לא נמצאו חריגות החודש</p>';
            }
        } else {
            container.innerHTML = '<p class="no-anomalies">✅ לא נמצאו חריגות החודש</p>';
        }
    } catch (error) {
        console.error('Error loading anomalies:', error);
        container.innerHTML = '<p class="tip-error">שגיאה בבדיקת חריגות</p>';
    }
}

function dismissAnomaly(category) {
    const dismissed = JSON.parse(localStorage.getItem('dismissedAnomalies') || '[]');
    const key = `${category}-${new Date().getMonth()}`;
    if (!dismissed.includes(key)) {
        dismissed.push(key);
        localStorage.setItem('dismissedAnomalies', JSON.stringify(dismissed));
    }
    // Remove from UI
    const chip = document.querySelector(`.anomaly-chip[data-category="${category}"]`);
    if (chip) {
        chip.style.animation = 'fadeOut 0.3s ease';
        setTimeout(() => chip.remove(), 300);
    }
}

// Budget Recommendations
async function loadBudgetRecommendations() {
    const container = document.getElementById('budgetRecommendations');
    if (!container) return;

    container.innerHTML = '<div class="widget-loading">📊 מחשב המלצות...</div>';

    try {
        const response = await fetch(`${API_URL}/api/insights/budget-recommendations`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });
        const result = await response.json();

        if (result.success && result.recommendations.length > 0) {
            container.innerHTML = result.recommendations.map(r => `
                <div class="recommendation-item ${r.urgency}">
                    <div class="rec-header">
                        <span class="rec-category">${r.category}</span>
                        <span class="rec-status-badge ${r.status}">${getStatusLabel(r.status)}</span>
                    </div>
                    <div class="rec-details">
                        <div class="rec-row">
                            <span>נוכחי:</span>
                            <span class="rec-current">${r.currentBudget > 0 ? `₪${r.currentBudget.toLocaleString()}` : 'לא הוגדר'}</span>
                        </div>
                        <div class="rec-row">
                            <span>מומלץ:</span>
                            <span class="rec-suggested">₪${r.suggestedBudget.toLocaleString()}</span>
                        </div>
                        <div class="rec-reasoning">${r.reasoning}</div>
                    </div>
                    <button class="apply-budget-btn" onclick="applyBudgetRecommendation('${r.category}', ${r.suggestedBudget})">
                        החל תקציב
                    </button>
                </div>
            `).join('');
        } else {
            container.innerHTML = '<p class="no-recommendations">אין מספיק נתונים להמלצות. המשך לתעד הוצאות!</p>';
        }
    } catch (error) {
        console.error('Error loading recommendations:', error);
        container.innerHTML = '<p class="tip-error">שגיאה בחישוב המלצות</p>';
    }
}

function getStatusLabel(status) {
    const labels = {
        'under-budgeted': 'תקציב נמוך מדי',
        'over-budgeted': 'תקציב גבוה מדי',
        'no-budget': 'ללא תקציב',
        'optimal': 'אופטימלי'
    };
    return labels[status] || status;
}

async function applyBudgetRecommendation(category, amount) {
    await saveBudget(category, amount);
    showToast(`התקציב עודכן ל-₪${amount.toLocaleString()}`, 'success');
    loadBudgetRecommendations(); // Refresh
}

// ========================================
// Receipt Scanner (Tesseract.js OCR)
// ========================================

function triggerReceiptScan() {
    const input = document.getElementById('receiptInput');
    if (input) {
        input.click();
    }
}

// Initialize receipt scanner
function setupReceiptScanner() {
    const input = document.getElementById('receiptInput');
    if (input) {
        input.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (file) {
                await scanReceipt(file);
            }
        });
    }
}

async function scanReceipt(imageFile) {
    const statusEl = document.getElementById('receiptScanStatus');
    if (!statusEl) return;

    statusEl.style.display = 'block';
    statusEl.innerHTML = '<div class="scan-progress"><span class="loading-spinner"></span> סורק קבלה...</div>';

    try {
        // Check if Tesseract is loaded
        if (typeof Tesseract === 'undefined') {
            throw new Error('Tesseract.js not loaded');
        }

        const result = await Tesseract.recognize(imageFile, 'heb+eng', {
            logger: m => {
                if (m.status === 'recognizing text') {
                    statusEl.innerHTML = `<div class="scan-progress"><span class="loading-spinner"></span> מזהה טקסט... ${Math.round(m.progress * 100)}%</div>`;
                }
            }
        });

        const text = result.data.text;
        console.log('OCR Result:', text);

        // Parse the receipt text
        const parsed = parseReceiptText(text);

        statusEl.innerHTML = '<div class="scan-success">✅ הסריקה הושלמה!</div>';
        setTimeout(() => {
            statusEl.style.display = 'none';
        }, 2000);

        // Pre-fill the form
        if (parsed.amount) {
            document.getElementById('amount').value = parsed.amount;
        }
        if (parsed.date) {
            document.getElementById('date').value = parsed.date;
        }
        if (parsed.description) {
            document.getElementById('description').value = parsed.description;
        }

        showToast('הקבלה נסרקה בהצלחה!', 'success');
    } catch (error) {
        console.error('Receipt scan error:', error);
        statusEl.innerHTML = '<div class="scan-error">❌ שגיאה בסריקה. נסה שוב.</div>';
        setTimeout(() => {
            statusEl.style.display = 'none';
        }, 3000);
    }
}

function parseReceiptText(text) {
    const result = {
        amount: null,
        date: null,
        description: null
    };

    // Look for total amount patterns (Hebrew and English)
    const amountPatterns = [
        /סה"כ[:\s]*₪?(\d+(?:[.,]\d{2})?)/i,
        /סה"כ לתשלום[:\s]*₪?(\d+(?:[.,]\d{2})?)/i,
        /total[:\s]*₪?(\d+(?:[.,]\d{2})?)/i,
        /לתשלום[:\s]*₪?(\d+(?:[.,]\d{2})?)/i,
        /₪\s*(\d+(?:[.,]\d{2})?)/,
        /(\d+(?:[.,]\d{2})?)\s*₪/
    ];

    for (const pattern of amountPatterns) {
        const match = text.match(pattern);
        if (match) {
            result.amount = parseFloat(match[1].replace(',', '.'));
            break;
        }
    }

    // Look for date patterns
    const datePatterns = [
        /(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/,
        /(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})/
    ];

    for (const pattern of datePatterns) {
        const match = text.match(pattern);
        if (match) {
            let day, month, year;
            if (match[1].length === 4) {
                year = match[1];
                month = match[2].padStart(2, '0');
                day = match[3].padStart(2, '0');
            } else {
                day = match[1].padStart(2, '0');
                month = match[2].padStart(2, '0');
                year = match[3].length === 2 ? '20' + match[3] : match[3];
            }
            result.date = `${year}-${month}-${day}`;
            break;
        }
    }

    // Try to extract store name (first line usually)
    const lines = text.split('\n').filter(l => l.trim());
    if (lines.length > 0) {
        result.description = lines[0].trim().substring(0, 50);
    }

    return result;
}

// ========================================
// Shopping Lists
// ========================================

let shoppingLists = [];
let currentShoppingListId = null;

async function loadShoppingLists() {
    try {
        const response = await fetch(`${API_URL}/api/shopping-lists`);
        const result = await response.json();
        if (result.success) {
            shoppingLists = result.lists;
            renderShoppingLists();
        }
    } catch (error) {
        console.error('Error loading shopping lists:', error);
    }
}

function renderShoppingLists() {
    const container = document.getElementById('shoppingLists');
    if (!container) return;

    if (shoppingLists.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon">🛍️</div>
                <p>אין רשימות קניות</p>
                <button class="add-category-btn" onclick="createNewShoppingList()">צור רשימה ראשונה</button>
            </div>
        `;
        return;
    }

    container.innerHTML = shoppingLists.map(list => `
        <div class="shopping-list-card" data-list-id="${list._id}">
            <div class="list-header">
                <h3>${list.name}</h3>
                <div class="list-actions">
                    <span class="list-estimate">₪${(list.totalEstimate || 0).toLocaleString()}</span>
                    <button class="delete-list-btn" onclick="deleteShoppingList('${list._id}')" title="מחק">🗑️</button>
                </div>
            </div>
            <div class="list-items">
                ${list.items.length === 0 ? '<p class="no-items">אין פריטים</p>' :
                    list.items.map(item => `
                        <div class="shopping-item ${item.checked ? 'checked' : ''}" data-item-id="${item.id}">
                            <label class="item-checkbox">
                                <input type="checkbox" ${item.checked ? 'checked' : ''}
                                    onchange="toggleShoppingItem('${list._id}', ${item.id}, this.checked)">
                                <span class="checkmark"></span>
                            </label>
                            <span class="item-name">${item.name}</span>
                            <span class="item-quantity">×${item.quantity}</span>
                            ${item.estimatedPrice ? `<span class="item-price">₪${item.estimatedPrice}</span>` : ''}
                            <button class="remove-item-btn" onclick="removeShoppingItem('${list._id}', ${item.id})">×</button>
                        </div>
                    `).join('')
                }
            </div>
            <div class="add-item-form">
                <input type="text" placeholder="הוסף פריט..." class="add-item-input"
                    onkeypress="if(event.key==='Enter') addShoppingItem('${list._id}', this)">
                <button class="add-item-btn" onclick="addShoppingItem('${list._id}', this.previousElementSibling)">+</button>
            </div>
        </div>
    `).join('');
}

async function createNewShoppingList() {
    const name = prompt('שם הרשימה:', 'רשימת קניות חדשה');
    if (!name) return;

    try {
        const response = await fetch(`${API_URL}/api/shopping-lists`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name })
        });
        const result = await response.json();
        if (result.success) {
            shoppingLists.unshift(result.list);
            renderShoppingLists();
            showToast('הרשימה נוצרה!', 'success');
        }
    } catch (error) {
        console.error('Error creating list:', error);
        showToast('שגיאה ביצירת רשימה', 'error');
    }
}

async function deleteShoppingList(listId) {
    if (!confirm('האם למחוק את הרשימה?')) return;

    try {
        const response = await fetch(`${API_URL}/api/shopping-lists/${listId}`, {
            method: 'DELETE'
        });
        const result = await response.json();
        if (result.success) {
            shoppingLists = shoppingLists.filter(l => l._id !== listId);
            renderShoppingLists();
            showToast('הרשימה נמחקה', 'success');
        }
    } catch (error) {
        console.error('Error deleting list:', error);
        showToast('שגיאה במחיקת רשימה', 'error');
    }
}

async function addShoppingItem(listId, inputEl) {
    const name = inputEl.value.trim();
    if (!name) return;

    try {
        const response = await fetch(`${API_URL}/api/shopping-lists/${listId}/items`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, quantity: 1 })
        });
        const result = await response.json();
        if (result.success) {
            // Update local state
            const list = shoppingLists.find(l => l._id === listId);
            if (list && result.list) {
                list.items = result.list.items;
                list.totalEstimate = result.list.totalEstimate;
            }
            inputEl.value = '';
            renderShoppingLists();
        }
    } catch (error) {
        console.error('Error adding item:', error);
        showToast('שגיאה בהוספת פריט', 'error');
    }
}

async function toggleShoppingItem(listId, itemId, checked) {
    try {
        await fetch(`${API_URL}/api/shopping-lists/${listId}/items/${itemId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ checked })
        });

        // Update local state
        const list = shoppingLists.find(l => l._id === listId);
        if (list) {
            const item = list.items.find(i => i.id === itemId);
            if (item) item.checked = checked;
        }

        // Animate the item
        const itemEl = document.querySelector(`.shopping-item[data-item-id="${itemId}"]`);
        if (itemEl) {
            itemEl.classList.toggle('checked', checked);
        }
    } catch (error) {
        console.error('Error toggling item:', error);
    }
}

async function removeShoppingItem(listId, itemId) {
    try {
        await fetch(`${API_URL}/api/shopping-lists/${listId}/items/${itemId}`, {
            method: 'DELETE'
        });

        // Update local state
        const list = shoppingLists.find(l => l._id === listId);
        if (list) {
            list.items = list.items.filter(i => i.id !== itemId);
        }
        renderShoppingLists();
    } catch (error) {
        console.error('Error removing item:', error);
        showToast('שגיאה במחיקת פריט', 'error');
    }
}

// ========================================
// Price Search
// ========================================

// Category products mapping
const categoryProducts = {
    'מוצרי חלב': ['חלב', 'גבינה צהובה', 'קוטג\'', 'יוגורט', 'שמנת', 'חמאה'],
    'לחם ומאפים': ['לחם לבן', 'לחם מחיטה מלאה', 'פיתות', 'לחמניות', 'חלה', 'באגט'],
    'פירות וירקות': ['עגבניות', 'מלפפונים', 'תפוחים', 'בננות', 'תפוזים', 'גזר'],
    'בשר ודגים': ['חזה עוף', 'כרעיים', 'בשר טחון', 'סלמון', 'נקניקיות', 'שניצל'],
    'שתייה': ['מים מינרליים', 'קולה', 'מיץ תפוזים', 'בירה', 'יין', 'סודה'],
    'חטיפים': ['במבה', 'ביסלי', 'שוקולד', 'עוגיות', 'צ\'יפס', 'קרקר'],
    'מוצרי ניקיון': ['אבקת כביסה', 'נוזל כלים', 'מרכך', 'אקונומיקה', 'נייר טואלט', 'מגבונים'],
    'תינוקות': ['חיתולים', 'מטרנה', 'מגבונים לתינוק', 'שמפו לתינוק', 'בקבוק', 'מוצץ']
};

function searchByCategory(category) {
    const productsContainer = document.getElementById('categoryProducts');
    const resultsContainer = document.getElementById('priceSearchResults');

    if (!productsContainer) return;

    // Clear previous results
    resultsContainer.innerHTML = '';

    // Show category products
    const products = categoryProducts[category] || [];

    productsContainer.style.display = 'block';
    productsContainer.innerHTML = `
        <div class="category-header">
            <h4>מוצרים פופולריים ב${category}</h4>
        </div>
        <div class="products-grid">
            ${products.map(product => `
                <button class="product-btn" onclick="searchProduct('${product}')">
                    ${product}
                </button>
            `).join('')}
        </div>
    `;
}

function searchProduct(productName) {
    const input = document.getElementById('priceSearchInput');
    if (input) {
        input.value = productName;
    }
    searchPrices();
}

// Chain logos/icons
const chainLogos = {
    'שופרסל': '🟢',
    'רמי לוי': '🔵',
    'ויקטורי': '🟡',
    'אושר עד': '🟠',
    'יינות ביתן': '🟣',
    'מגה': '🔴',
    'חצי חינם': '🟤',
    'טיב טעם': '⚫'
};

async function searchPrices() {
    const input = document.getElementById('priceSearchInput');
    const results = document.getElementById('priceSearchResults');
    const filtersContainer = document.getElementById('priceFiltersContainer');
    if (!input || !results) return;

    const query = input.value.trim();
    if (!query) {
        showToast('הזן שם מוצר לחיפוש', 'error');
        return;
    }

    results.innerHTML = '<div class="widget-loading">🔍 מחפש מחירים בסופרמרקטים...</div>';
    if (filtersContainer) filtersContainer.style.display = 'none';

    try {
        const response = await fetch(`${API_URL}/api/prices/search?q=${encodeURIComponent(query)}`);
        const result = await response.json();

        if (result.success) {
            const data = result.results;

            // Store original results for filtering
            priceSearchState.originalResults = data;

            // Reset filters on new search
            resetPriceFilters();

            // New format: multiple products
            if (data.products && data.products.length > 0) {
                // Show filters panel
                if (filtersContainer) filtersContainer.style.display = 'block';

                // Apply initial display
                priceSearchState.filteredProducts = [...data.products];
                renderPriceResults();
            }
            // Old format fallback (single product)
            else if (data.stores && data.stores.length > 0) {
                results.innerHTML = `
                    <div class="price-results-container">
                        <div class="product-card featured">
                            <div class="product-card-header">
                                <div class="product-info">
                                    <img src="${data.image}" alt="${data.product}" class="product-image"
                                         onerror="this.style.display='none'">
                                    <div class="product-details">
                                        <span class="product-name">${data.product || query}</span>
                                        ${data.category ? `<span class="product-category">${data.category}</span>` : ''}
                                    </div>
                                </div>
                            </div>
                            <div class="chain-prices-grid">
                                ${data.stores.map((store, idx) => `
                                    <div class="chain-price-item ${idx === 0 ? 'cheapest' : ''}">
                                        <span class="chain-logo">${chainLogos[store.name] || '🏪'}</span>
                                        <span class="chain-name">${store.name}</span>
                                        <span class="chain-price ${idx === 0 ? 'best-price' : ''}">₪${store.price.toFixed(2)}</span>
                                        ${idx === 0 ? '<span class="best-badge">הכי זול!</span>' : ''}
                                    </div>
                                `).join('')}
                            </div>
                            <button class="add-to-list-btn" onclick="addProductToShoppingList('${data.product}', ${data.stores[0].price})">
                                ➕ הוסף לרשימת קניות
                            </button>
                        </div>
                        <div class="price-disclaimer">${data.disclaimer || ''}</div>
                    </div>
                `;
            } else {
                results.innerHTML = `
                    <div class="price-results-message">
                        <span class="no-results-icon">🔍</span>
                        <p>${data.message || 'לא נמצאו תוצאות עבור "' + query + '"'}</p>
                        <p class="suggestion">נסה לחפש מוצר אחר או בדוק את האיות</p>
                    </div>
                `;
            }
        }
    } catch (error) {
        console.error('Error searching prices:', error);
        results.innerHTML = '<p class="tip-error">שגיאה בחיפוש מחירים</p>';
    }
}

// Reset price filters to defaults
function resetPriceFilters() {
    priceSearchState.selectedChains = [];
    priceSearchState.sortBy = 'price-asc';
    priceSearchState.viewMode = 'cards';

    // Reset UI
    document.querySelectorAll('#chainFilterGrid input[type="checkbox"]').forEach(cb => cb.checked = false);

    // Reset sort buttons
    document.querySelectorAll('.sort-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.sort === 'price-asc');
    });

    // Reset view buttons
    document.querySelectorAll('.view-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.view === 'cards');
    });
}

// Clear all filters
function clearPriceFilters() {
    resetPriceFilters();
    if (priceSearchState.originalResults?.products) {
        priceSearchState.filteredProducts = [...priceSearchState.originalResults.products];
        renderPriceResults();
    }
}

// Apply filters to results
function applyPriceFilters() {
    if (!priceSearchState.originalResults?.products) return;

    // Get selected chains
    priceSearchState.selectedChains = [];
    document.querySelectorAll('#chainFilterGrid input[type="checkbox"]:checked').forEach(cb => {
        priceSearchState.selectedChains.push(cb.value);
    });

    // Filter products
    let filtered = [...priceSearchState.originalResults.products];

    // Filter by chains - show products available in selected chains
    if (priceSearchState.selectedChains.length > 0) {
        filtered = filtered.map(product => {
            // Filter stores to only selected chains
            const filteredStores = product.stores.filter(store =>
                priceSearchState.selectedChains.includes(store.name)
            );

            if (filteredStores.length === 0) return null;

            // Recalculate cheapest from filtered stores
            const sortedStores = [...filteredStores].sort((a, b) => a.price - b.price);

            return {
                ...product,
                stores: sortedStores,
                cheapestPrice: sortedStores[0]?.price,
                cheapestStore: sortedStores[0]?.name
            };
        }).filter(p => p !== null);
    }

    // Apply sorting
    filtered = sortProducts(filtered);

    priceSearchState.filteredProducts = filtered;
    renderPriceResults();
}

// Sort products based on current sort option
function sortProducts(products) {
    const sorted = [...products];

    switch (priceSearchState.sortBy) {
        case 'price-asc':
            sorted.sort((a, b) => (a.cheapestPrice || 999) - (b.cheapestPrice || 999));
            break;
        case 'price-desc':
            sorted.sort((a, b) => (b.cheapestPrice || 0) - (a.cheapestPrice || 0));
            break;
        case 'name':
            sorted.sort((a, b) => a.name.localeCompare(b.name, 'he'));
            break;
    }

    return sorted;
}

// Set sort option
function setSortOption(sortBy) {
    priceSearchState.sortBy = sortBy;

    // Update UI
    document.querySelectorAll('.sort-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.sort === sortBy);
    });

    applyPriceFilters();
}

// Set view option
function setViewOption(viewMode) {
    priceSearchState.viewMode = viewMode;

    // Update UI
    document.querySelectorAll('.view-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.view === viewMode);
    });

    renderPriceResults();
}

// Render price results based on current state
function renderPriceResults() {
    const results = document.getElementById('priceSearchResults');
    if (!results) return;

    const data = priceSearchState.originalResults;
    const products = priceSearchState.filteredProducts;

    if (products.length === 0) {
        results.innerHTML = `
            <div class="price-results-message">
                <span class="no-results-icon">🔍</span>
                <p>לא נמצאו מוצרים התואמים לסינון</p>
                <p class="suggestion">נסה להרחיב את הסינון או לבחור רשתות נוספות</p>
            </div>
        `;
        return;
    }

    // Build active filters display
    const activeFiltersHtml = buildActiveFiltersHtml();

    // Build products list based on view mode
    let productsHtml;
    switch (priceSearchState.viewMode) {
        case 'compact':
            productsHtml = buildCompactView(products);
            break;
        case 'table':
            productsHtml = buildTableView(products);
            break;
        default:
            productsHtml = buildCardsView(products);
    }

    results.innerHTML = `
        <div class="price-results-container">
            <div class="results-header">
                <span class="results-count">מציג ${products.length} מתוך ${data.totalFound} מוצרים</span>
                ${data.dataSource === 'real' ? '<span class="real-data-badge">🔴 מחירים בזמן אמת</span>' : ''}
            </div>

            ${activeFiltersHtml}
            ${productsHtml}

            <div class="price-disclaimer">${data.disclaimer || ''}</div>
        </div>
    `;
}

// Build active filters display
function buildActiveFiltersHtml() {
    const filters = [];

    if (priceSearchState.selectedChains.length > 0) {
        priceSearchState.selectedChains.forEach(chain => {
            filters.push(`
                <span class="active-filter-tag">
                    ${chainLogos[chain] || '🏪'} ${chain}
                    <button class="remove-filter-btn" onclick="removeChainFilter('${chain}')">&times;</button>
                </span>
            `);
        });
    }

    if (filters.length === 0) return '';

    return `<div class="active-filters-display">${filters.join('')}</div>`;
}

// Remove individual chain filter
function removeChainFilter(chain) {
    const checkbox = document.querySelector(`#chainFilterGrid input[value="${chain}"]`);
    if (checkbox) checkbox.checked = false;
    applyPriceFilters();
}

// Build cards view (default)
function buildCardsView(products) {
    const productsHtml = products.map((product, idx) => {
        const hasMultiplePrices = product.stores && product.stores.length > 1;
        const savings = hasMultiplePrices
            ? (product.stores[product.stores.length - 1].price - product.stores[0].price).toFixed(2)
            : 0;

        // Quick store preview (first 4 stores)
        const quickStoresHtml = product.stores.slice(0, 4).map((store, storeIdx) => `
            <div class="store-quick-item ${storeIdx === 0 ? 'best' : ''}" onclick="event.stopPropagation(); addProductFromChain('${product.name.replace(/'/g, "\\'")}', '${store.name}', ${store.price})" title="הוסף מ${store.name}">
                <span class="store-quick-emoji">${chainLogos[store.name] || '🏪'}</span>
                <span class="store-quick-price">₪${store.price.toFixed(2)}</span>
            </div>
        `).join('');

        return `
            <div class="product-card-improved ${idx === 0 ? 'featured' : ''}">
                ${idx === 0 && savings > 0 ? '<div class="cheapest-ribbon">המומלץ</div>' : ''}

                <div class="product-main-content" onclick="toggleProductDetails(this.closest('.product-card-improved'))" style="cursor: pointer;">
                    <div class="product-image-container">
                        <img src="${product.image}" alt="${product.name}" class="product-image-lg"
                             onerror="this.style.display='none'">
                    </div>
                    <div class="product-info-section">
                        <div class="product-title">${product.name}</div>
                        <div class="product-meta">${product.category || ''} ${product.manufacturer ? '• ' + product.manufacturer : ''}</div>
                        <div class="price-highlight">
                            ${product.cheapestPrice ? `
                                <span class="main-price">₪${product.cheapestPrice.toFixed(2)}</span>
                                <span class="price-store-name">${chainLogos[product.cheapestStore] || '🏪'} ${product.cheapestStore}</span>
                            ` : '<span class="no-price">אין מחיר</span>'}
                        </div>
                        ${savings > 0 ? `
                            <div class="savings-tag">💰 חסוך עד ₪${savings}</div>
                        ` : ''}
                    </div>
                    ${hasMultiplePrices ? '<span class="expand-icon" style="align-self: center; margin-right: 0.5rem;">▼</span>' : ''}
                </div>

                ${hasMultiplePrices ? `
                    <div class="stores-quick-view">
                        ${quickStoresHtml}
                        ${product.stores.length > 4 ? `<div class="store-quick-item" onclick="toggleProductDetails(this.closest('.product-card-improved'))">+${product.stores.length - 4}</div>` : ''}
                    </div>

                    <div class="product-details-expanded" style="display: none;">
                        <div class="chain-prices-grid">
                            ${product.stores.map((store, storeIdx) => `
                                <div class="chain-price-item ${storeIdx === 0 ? 'cheapest' : ''}" onclick="event.stopPropagation(); addProductFromChain('${product.name.replace(/'/g, "\\'")}', '${store.name}', ${store.price})">
                                    <span class="chain-logo">${chainLogos[store.name] || '🏪'}</span>
                                    <span class="chain-name">${store.name}</span>
                                    <span class="chain-price ${storeIdx === 0 ? 'best-price' : ''}">
                                        ₪${store.price.toFixed(2)}
                                    </span>
                                    ${storeIdx === 0 ? '<span class="best-badge">הכי זול!</span>' : ''}
                                    <button class="chain-add-btn">➕</button>
                                </div>
                            `).join('')}
                        </div>
                    </div>
                ` : `
                    <div style="padding: 0.5rem 1rem 1rem;">
                        <button class="add-to-list-btn" onclick="addProductToShoppingList('${product.name.replace(/'/g, "\\'")}', ${product.cheapestPrice})">
                            ➕ הוסף לרשימת קניות
                        </button>
                    </div>
                `}
            </div>
        `;
    }).join('');

    return `<div class="products-list">${productsHtml}</div>`;
}

// Build compact view
function buildCompactView(products) {
    const productsHtml = products.map((product, idx) => {
        const hasMultiplePrices = product.stores && product.stores.length > 1;
        const savings = hasMultiplePrices
            ? (product.stores[product.stores.length - 1].price - product.stores[0].price).toFixed(2)
            : 0;

        return `
            <div class="product-card ${idx === 0 ? 'featured' : ''}">
                <div class="product-card-header" onclick="toggleProductDetails(this)">
                    <div class="product-info">
                        <img src="${product.image}" alt="${product.name}" class="product-image"
                             onerror="this.style.display='none'">
                        <div class="product-details">
                            <span class="product-name">${product.name}</span>
                            <span class="product-category">${product.category || ''}</span>
                        </div>
                    </div>
                    <div class="product-price-summary">
                        ${product.cheapestPrice ? `
                            <span class="cheapest-price">₪${product.cheapestPrice.toFixed(2)}</span>
                            <span class="cheapest-store">${chainLogos[product.cheapestStore] || '🏪'} ${product.cheapestStore}</span>
                        ` : '<span class="no-price">אין מחיר</span>'}
                        ${hasMultiplePrices ? `<span class="expand-icon">▼</span>` : ''}
                    </div>
                </div>

                ${hasMultiplePrices ? `
                    <div class="product-details-expanded" style="display: none;">
                        <div class="savings-banner">
                            💰 חסוך עד ₪${savings} בבחירת הרשת הזולה!
                        </div>
                        <div class="chain-prices-grid">
                            ${product.stores.map((store, storeIdx) => `
                                <div class="chain-price-item ${storeIdx === 0 ? 'cheapest' : ''}" onclick="event.stopPropagation(); addProductFromChain('${product.name.replace(/'/g, "\\'")}', '${store.name}', ${store.price})">
                                    <span class="chain-logo">${chainLogos[store.name] || '🏪'}</span>
                                    <span class="chain-name">${store.name}</span>
                                    <span class="chain-price ${storeIdx === 0 ? 'best-price' : ''}">
                                        ₪${store.price.toFixed(2)}
                                    </span>
                                    ${storeIdx === 0 ? '<span class="best-badge">הכי זול!</span>' : ''}
                                    <button class="chain-add-btn">➕</button>
                                </div>
                            `).join('')}
                        </div>
                    </div>
                ` : ''}
            </div>
        `;
    }).join('');

    return `<div class="products-list compact-view">${productsHtml}</div>`;
}

// Build table view
function buildTableView(products) {
    const tableRows = products.map(product => {
        const savings = product.stores.length > 1
            ? (product.stores[product.stores.length - 1].price - product.stores[0].price).toFixed(2)
            : '0';

        const allPrices = product.stores.slice(0, 3).map(s =>
            `${chainLogos[s.name] || '🏪'}₪${s.price.toFixed(2)}`
        ).join(' ');

        return `
            <tr>
                <td>
                    <img src="${product.image}" alt="" class="product-img-small" onerror="this.style.display='none'">
                </td>
                <td>${product.name}</td>
                <td>${product.category || '-'}</td>
                <td class="price-cell">₪${product.cheapestPrice?.toFixed(2) || '-'}</td>
                <td class="store-cell">
                    ${chainLogos[product.cheapestStore] || '🏪'} ${product.cheapestStore || '-'}
                </td>
                <td class="savings-cell">${savings > 0 ? `₪${savings}` : '-'}</td>
                <td class="all-prices-cell">${allPrices}</td>
                <td>
                    <button class="table-add-btn" onclick="addProductToShoppingList('${product.name.replace(/'/g, "\\'")}', ${product.cheapestPrice})">
                        ➕
                    </button>
                </td>
            </tr>
        `;
    }).join('');

    return `
        <table class="products-table">
            <thead>
                <tr>
                    <th></th>
                    <th>מוצר</th>
                    <th>קטגוריה</th>
                    <th>מחיר</th>
                    <th>רשת</th>
                    <th>חיסכון</th>
                    <th>מחירים נוספים</th>
                    <th></th>
                </tr>
            </thead>
            <tbody>
                ${tableRows}
            </tbody>
        </table>
    `;
}

function toggleProductDetails(element) {
    // Handle both old structure (header click) and new structure (card click)
    let card = element;
    if (element.classList.contains('product-card-header')) {
        card = element.closest('.product-card') || element.closest('.product-card-improved');
    } else if (!element.classList.contains('product-card') && !element.classList.contains('product-card-improved')) {
        card = element.closest('.product-card') || element.closest('.product-card-improved');
    }

    if (!card) return;

    const details = card.querySelector('.product-details-expanded');
    const icon = card.querySelector('.expand-icon');

    if (details) {
        const isVisible = details.style.display !== 'none';
        details.style.display = isVisible ? 'none' : 'block';
        if (icon) icon.textContent = isVisible ? '▼' : '▲';
    }
}

async function addProductToShoppingList(productName, price) {
    // Find or create a default shopping list
    if (shoppingLists.length === 0) {
        await createNewShoppingList();
    }

    if (shoppingLists.length > 0) {
        const listId = shoppingLists[0]._id;
        try {
            const response = await fetch(`${API_URL}/api/shopping-lists/${listId}/items`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: productName, quantity: 1, estimatedPrice: price })
            });
            const result = await response.json();
            if (result.success) {
                shoppingLists[0] = result.list;
                showToast(`${productName} נוסף לרשימה!`, 'success');
            }
        } catch (error) {
            console.error('Error adding to list:', error);
            showToast('שגיאה בהוספה לרשימה', 'error');
        }
    }
}

// Add product from specific chain to shopping list
async function addProductFromChain(productName, chainName, price) {
    // Find or create a default shopping list
    if (shoppingLists.length === 0) {
        await createNewShoppingList();
    }

    if (shoppingLists.length > 0) {
        const listId = shoppingLists[0]._id;
        try {
            const response = await fetch(`${API_URL}/api/shopping-lists/${listId}/items`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name: productName,
                    quantity: 1,
                    estimatedPrice: price,
                    store: chainName
                })
            });
            const result = await response.json();
            if (result.success) {
                shoppingLists[0] = result.list;
                showToast(`${productName} מ${chainName} נוסף לרשימה!`, 'success');
            }
        } catch (error) {
            console.error('Error adding to list:', error);
            showToast('שגיאה בהוספה לרשימה', 'error');
        }
    }
}

// ========================================
// Initialize New Features on Load
// ========================================

// Override init to include new features
const originalInit = init;
async function init() {
    try {
        await loadData();
        await loadAvatars();
        await loadBudgets();
        await loadShoppingLists();
        setupEventListeners();
        setupMobileMenu();
        setupAvatarUploads();
        setupSearchListeners();
        setupReceiptScanner();
        updateUI();

        // Load AI widgets after main data
        loadDailyTipsWidget();
        loadAnomalyWidget();
    } catch (error) {
        console.error('Error initializing app:', error);
        showToast('שגיאה באתחול האפליקציה', 'error');
    }
}

// Make functions globally available
window.addCategory = addCategory;
window.removeCategory = removeCategory;
window.deleteTransaction = deleteTransaction;
window.editTransaction = editTransaction;
window.saveBudget = saveBudget;
window.getAIInsights = getAIInsights;
window.refreshDailyTips = refreshDailyTips;
window.dismissAnomaly = dismissAnomaly;
window.loadBudgetRecommendations = loadBudgetRecommendations;
window.applyBudgetRecommendation = applyBudgetRecommendation;
window.triggerReceiptScan = triggerReceiptScan;
window.createNewShoppingList = createNewShoppingList;
window.deleteShoppingList = deleteShoppingList;
window.addShoppingItem = addShoppingItem;
window.toggleShoppingItem = toggleShoppingItem;
window.removeShoppingItem = removeShoppingItem;
window.searchPrices = searchPrices;
window.searchByCategory = searchByCategory;
window.searchProduct = searchProduct;
window.addProductToShoppingList = addProductToShoppingList;
window.addProductFromChain = addProductFromChain;
window.toggleProductDetails = toggleProductDetails;
window.applyPriceFilters = applyPriceFilters;
window.clearPriceFilters = clearPriceFilters;
window.setSortOption = setSortOption;
window.setViewOption = setViewOption;
window.removeChainFilter = removeChainFilter;
