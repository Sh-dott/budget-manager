// Budget Manager - Hebrew RTL Version with Shared Backend
// =====================================================

const API_URL = '';

// State
let state = {
    transactions: [],
    categories: { income: [], expense: [] },
    currentMonth: new Date(),
    currentType: 'expense',
    avatars: {
        Shai: localStorage.getItem('avatar_Shai') || '',
        Gal: localStorage.getItem('avatar_Gal') || ''
    }
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
    setupEventListeners();
    setupMobileMenu();
    setupAvatarUploads();
    loadAvatars();
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
function openModal() {
    const modal = document.getElementById('modal');
    const dateInput = document.getElementById('date');

    // Reset form
    document.getElementById('transactionForm').reset();
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

    const transaction = {
        type: state.currentType,
        amount: parseFloat(document.getElementById('amount').value),
        category: document.getElementById('category').value,
        description: document.getElementById('description').value,
        date: document.getElementById('date').value,
        person: document.querySelector('.person-btn.active').dataset.person
    };

    const success = await saveTransaction(transaction);
    if (success) {
        closeModal();
    }
}

// UI Update Functions
function updateUI() {
    updateMonthDisplay();
    updateStats();
    updateRecentTransactions();
    updateTransactionsList();
    updateCategories();
    updateFilterOptions();
    updateCharts();
    updateAnalytics();
}

function updateMonthDisplay() {
    const month = hebrewMonths[state.currentMonth.getMonth()];
    const year = state.currentMonth.getFullYear();
    document.getElementById('currentMonth').textContent = `${month} ${year}`;
}

function getMonthTransactions() {
    const year = state.currentMonth.getFullYear();
    const month = state.currentMonth.getMonth();

    return state.transactions.filter(t => {
        const date = new Date(t.date);
        return date.getFullYear() === year && date.getMonth() === month;
    });
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

    container.innerHTML = transactions.map(t => `
        <div class="transaction-item">
            <div class="transaction-right">
                <div class="transaction-icon ${t.type}">
                    ${t.type === 'income' ? '📈' : '📉'}
                </div>
                <div class="transaction-details">
                    <h4>${t.description || t.category}</h4>
                    <div class="transaction-meta">
                        <span>${t.category}</span>
                        <span>•</span>
                        <span>${formatDate(t.date)}</span>
                        ${t.person ? `<span>•</span>${getPersonAvatar(t.person)}<span>${t.person}</span>` : ''}
                    </div>
                </div>
            </div>
            <div class="transaction-left">
                <span class="transaction-amount ${t.type}">
                    ${t.type === 'income' ? '+' : '-'}${formatCurrency(t.amount)}
                </span>
                <button class="delete-btn" onclick="deleteTransaction(${t.id})" title="מחק">
                    מחק
                </button>
            </div>
        </div>
    `).join('');
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

// Mobile Menu
function setupMobileMenu() {
    const menuToggle = document.getElementById('menuToggle');
    const sidebar = document.querySelector('.sidebar');

    // Create overlay
    const overlay = document.createElement('div');
    overlay.className = 'sidebar-overlay';
    document.body.appendChild(overlay);

    if (menuToggle) {
        menuToggle.addEventListener('click', () => {
            sidebar.classList.toggle('open');
            overlay.classList.toggle('open');
        });
    }

    overlay.addEventListener('click', () => {
        sidebar.classList.remove('open');
        overlay.classList.remove('open');
    });

    // Close menu when nav item clicked on mobile
    document.querySelectorAll('.nav-item').forEach(item => {
        item.addEventListener('click', () => {
            if (window.innerWidth <= 768) {
                sidebar.classList.remove('open');
                overlay.classList.remove('open');
            }
        });
    });
}

// Avatar Management
function setupAvatarUploads() {
    const shaiInput = document.getElementById('shaiAvatarInput');
    const galInput = document.getElementById('galAvatarInput');

    if (shaiInput) {
        shaiInput.addEventListener('change', (e) => handleAvatarUpload(e, 'Shai'));
    }
    if (galInput) {
        galInput.addEventListener('change', (e) => handleAvatarUpload(e, 'Gal'));
    }
}

function handleAvatarUpload(event, person) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
        const dataUrl = e.target.result;
        state.avatars[person] = dataUrl;
        localStorage.setItem(`avatar_${person}`, dataUrl);
        updateAvatarDisplays();
        showToast(`תמונת ${person} עודכנה`, 'success');
    };
    reader.readAsDataURL(file);
}

function loadAvatars() {
    state.avatars.Shai = localStorage.getItem('avatar_Shai') || '';
    state.avatars.Gal = localStorage.getItem('avatar_Gal') || '';
    updateAvatarDisplays();
}

function updateAvatarDisplays() {
    // Update settings page avatars
    const shaiPreview = document.getElementById('shaiAvatar');
    const galPreview = document.getElementById('galAvatar');

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

    // Update modal person buttons
    const shaiBtn = document.getElementById('shaiAvatarBtn');
    const galBtn = document.getElementById('galAvatarBtn');

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
}

function getPersonAvatar(person) {
    if (person === 'Shai' && state.avatars.Shai) {
        return `<img src="${state.avatars.Shai}" alt="Shai" class="transaction-person-avatar">`;
    } else if (person === 'Gal' && state.avatars.Gal) {
        return `<img src="${state.avatars.Gal}" alt="Gal" class="transaction-person-avatar">`;
    } else if (person === 'משותף') {
        return '<span class="transaction-person-initial">👫</span>';
    } else {
        const initial = person ? person.charAt(0).toUpperCase() : '?';
        return `<span class="transaction-person-initial">${initial}</span>`;
    }
}

// Make functions globally available
window.addCategory = addCategory;
window.removeCategory = removeCategory;
window.deleteTransaction = deleteTransaction;
