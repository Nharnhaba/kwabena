/* ================================================================
   1. DATA CONFIGURATION & INITIALIZATION ENGINE
   ================================================================ */
const CATEGORIES = [
  { id: "food",      name: "Food",            emoji: "🍛" },
  { id: "transport", name: "Transport/Trotro", emoji: "🚌" },
  { id: "airtime",   name: "Airtime/Data",    emoji: "📶" },
  { id: "bills",     name: "Bills",           emoji: "💡" },
  { id: "hustle",    name: "Hustle",          emoji: "💼" },
  { id: "cars",      name: "Cars",            emoji: "🚗" },
];

let expenses = [];
let selectedCategoryId = "food";
let selectedMethod = "momo";

// PWA Install Prompt Logic
let deferredPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  const installBtn = document.getElementById('pwaInstallBtn');
  if (installBtn) installBtn.classList.remove('hidden');
});

function triggerPWAInstall() {
  if (!deferredPrompt) return;
  deferredPrompt.prompt();
  deferredPrompt.userChoice.then((choiceResult) => {
    if (choiceResult.outcome === 'accepted') {
      const installBtn = document.getElementById('pwaInstallBtn');
      if (installBtn) installBtn.classList.add('hidden');
    }
    deferredPrompt = null;
  });
}

/* ================================================================
   2. UTILITY STRUCTURAL FUNCTIONS
   ================================================================ */
function formatMoney(n){
  return "₵" + (n || 0).toLocaleString("en-GH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function getCategory(id){
  return CATEGORIES.find(c => c.id === id) || { name: "Other", emoji: "•" };
}

function isThisMonth(dateStr){
  if(!dateStr) return false;
  const d = new Date(dateStr), now = new Date();
  return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
}

function isThisWeek(dateStr){
  if(!dateStr) return false;
  const d = new Date(dateStr), now = new Date();
  const diffDays = (now - d) / (1000*60*60*24);
  return diffDays >= 0 && diffDays < 7;
}

function formatDateLabel(dateStr){
  if(!dateStr) return "Today";
  const d = new Date(dateStr), now = new Date();
  const diff = Math.round((now - d) / (1000*60*60*24));
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

/* ================================================================
   3. DATA MUTATION & PERSISTENCE
   ================================================================ */
function clearAllData() {
  if (confirm("CRITICAL WARNING:\nAre you sure you want to delete your data? All entries will be lost forever.")) {
    expenses = [];
    localStorage.removeItem('sika_expenses');
    renderDashboard();
    renderCategories();
    showScreen('dashboard');
  }
}

function deleteExpense(id){
  expenses = expenses.filter(e => e.id !== id);
  localStorage.setItem('sika_expenses', JSON.stringify(expenses));
  renderDashboard();
  renderCategories();
}

/* ================================================================
   4. ADD TRANSACTION UI MANAGEMENT
   ================================================================ */
function renderCategoryGrid(){
  const grid = document.getElementById("categoryGrid");
  if(!grid) return;
  grid.innerHTML = CATEGORIES.map(c => `
    <div class="cat-chip ${c.id === selectedCategoryId ? 'selected' : ''}" onclick="selectCategory('${c.id}')">
      <span class="cat-emoji">${c.emoji}</span>${c.name}
    </div>
  `).join("");
}

function selectCategory(id){
  selectedCategoryId = id;
  renderCategoryGrid();
}

function setPaymentMethod(method){
  selectedMethod = method;
  const momoBtn = document.getElementById("toggleMomo");
  const cashBtn = document.getElementById("toggleCash");
  if (momoBtn) momoBtn.classList.toggle("active", method === "momo");
  if (cashBtn) cashBtn.classList.toggle("active", method === "cash");
}

function resetAddForm(){
  const amountField = document.getElementById("amountInput");
  const noteField = document.getElementById("noteInput");
  const dateField = document.getElementById("dateInput");

  if (amountField) amountField.value = "";
  if (noteField) noteField.value = "";
  if (dateField) dateField.value = new Date().toISOString().slice(0,10);
  
  selectedCategoryId = "food";
  selectedMethod = "momo";
  renderCategoryGrid();
  setPaymentMethod("momo");
}

function saveExpense(){
  const amountVal = document.getElementById("amountInput")?.value;
  const noteVal = document.getElementById("noteInput")?.value.trim();
  const dateVal = document.getElementById("dateInput")?.value || new Date().toISOString().slice(0,10);
  const btn = document.getElementById("saveBtn");

  const amount = parseFloat(amountVal);
  if (!amount || amount <= 0){ alert("Enter an amount."); return; }
  if (!selectedCategoryId){ alert("Pick a category."); return; }

  if (btn) {
    btn.disabled = true;
    btn.textContent = "Saving…";
  }

  const newExpense = {
    id: "exp_" + Date.now(),
    amount: amount,
    category_id: selectedCategoryId,
    method: selectedMethod,
    note: noteVal,
    date: dateVal,
  };

  expenses.unshift(newExpense);
  localStorage.setItem('sika_expenses', JSON.stringify(expenses));

  if (btn) {
    btn.disabled = false;
    btn.textContent = "Save expense";
  }

  resetAddForm();
  renderDashboard();
  renderCategories();
  showScreen("dashboard");
}

/* ================================================================
   5. VIEW PORT RENDERING LIFECYCLE
   ================================================================ */
function renderDashboard(){
  const greetingEl = document.getElementById("dashGreeting");
  const avatarEl = document.getElementById("profileAvatar");
  
  if (greetingEl) greetingEl.textContent = "Sika";
  if (avatarEl) avatarEl.textContent = "S";

  const monthExpenses = expenses.filter(e => isThisMonth(e.date));
  const weekExpenses = expenses.filter(e => isThisWeek(e.date));
  const monthTotal = monthExpenses.reduce((sum, e) => sum + e.amount, 0);
  const weekTotal = weekExpenses.reduce((sum, e) => sum + e.amount, 0);

  const monthTotalEl = document.getElementById("monthTotal");
  const weekTotalEl = document.getElementById("weekTotal");
  const countTotalEl = document.getElementById("countTotal");
  const dateLabelEl = document.getElementById("dashDateLabel");

  if (monthTotalEl) monthTotalEl.textContent = formatMoney(monthTotal);
  if (weekTotalEl) weekTotalEl.textContent = formatMoney(weekTotal);
  if (countTotalEl) countTotalEl.textContent = monthExpenses.length;
  if (dateLabelEl) dateLabelEl.textContent = new Date().toLocaleDateString("en-GB", { month: "long", year: "numeric" });

  const recent = [...expenses].sort((a,b) => new Date(b.date) - new Date(a.date)).slice(0, 15);
  const list = document.getElementById("recentList");
  if (!list) return;

  if (recent.length === 0){
    list.innerHTML = '<div class="empty-state">No expenses yet. Tap + to add your first one.</div>';
    return;
  }

  list.innerHTML = recent.map(e => {
    const cat = getCategory(e.category_id);
    const badgeClass = e.method === "momo" ? "badge-momo" : "badge-cash";
    const badgeLabel = e.method === "momo" ? "Mobile money" : "Cash";
    return `
      <div class="ticket">
        <div class="ticket-icon">${cat.emoji}</div>
        <div class="ticket-body">
          <div class="ticket-cat">${cat.name}</div>
          <div class="ticket-note">${e.note || formatDateLabel(e.date)}</div>
        </div>
        <div class="ticket-right">
          <div class="ticket-amount">${formatMoney(e.amount)}</div>
          <span class="ticket-badge ${badgeClass}">${badgeLabel}</span>
        </div>
        <button class="ticket-del" onclick="deleteExpense('${e.id}')" aria-label="Delete">✕</button>
      </div>`;
  }).join("");
}

function renderCategories(){
  const monthExpenses = expenses.filter(e => isThisMonth(e.date));
  const totals = {};
  CATEGORIES.forEach(c => totals[c.id] = 0);
  monthExpenses.forEach(e => { totals[e.category_id] = (totals[e.category_id] || 0) + e.amount; });

  const maxSpend = Math.max(1, ...Object.values(totals));
  const container = document.getElementById("categoryBreakdown");
  if (!container) return;

  container.innerHTML = CATEGORIES.map(c => {
    const amount = totals[c.id] || 0;
    const pct = Math.round((amount / maxSpend) * 100);
    return `
      <div class="cat-card">
        <div class="cat-card-top">
          <span class="cat-card-emoji">${c.emoji}</span>
          <span class="cat-card-name">${c.name}</span>
          <span class="cat-card-amount">${formatMoney(amount)}</span>
        </div>
        <div class="cat-bar-track"><div class="cat-bar-fill" style="width:${pct}%"></div></div>
      </div>`;
  }).join("");
}

/* ================================================================
   6. NAVIGATION ROUTER CONTROL & INITIALIZATION RUNTIME
   ================================================================ */
function showScreen(name){
  document.querySelectorAll(".screens .screen").forEach(s => s.classList.remove("active"));
  const target = document.getElementById("screen-" + name);
  if(target) target.classList.add("active");

  const chrome = document.getElementById("tabbar");
  const fab = document.getElementById("fabBtn");
  
  if (name === "login" || name === "register"){
    if(chrome) chrome.classList.add("hidden");
    if(fab) fab.classList.add("hidden");
  } else {
    if(chrome) chrome.classList.remove("hidden");
    if(fab) fab.classList.remove("hidden");
    document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
    const tabBtn = document.querySelector(`.tab-btn[data-tab="${name}"]`);
    if (tabBtn) tabBtn.classList.add("active");
  }

  if (name === "add") resetAddForm();
  if (name === "categories") renderCategories();
  if (name === "dashboard") renderDashboard();
}

function enterApp(){
  renderDashboard();
  renderCategoryGrid();
  renderCategories();
  const dateField = document.getElementById("dateInput");
  if (dateField) dateField.value = new Date().toISOString().slice(0,10);
  showScreen("dashboard");
}

function init(){
  try {
    expenses = JSON.parse(localStorage.getItem('sika_expenses')) || [];
    enterApp();
  } catch (e) {
    console.error("Local database load fault:", e);
    expenses = [];
    enterApp();
  }
  const loader = document.getElementById("loadingOverlay");
  if(loader) loader.classList.add("hidden");
}

// Spark up execution lifecycle loops!
init();
