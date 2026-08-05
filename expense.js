const CATEGORIES = [
  { id: "food",      name: "Food",            emoji: "🍛" },
  { id: "transport", name: "Transport/Trotro", emoji: "🚌" },
  { id: "airtime",   name: "Airtime/Data",    emoji: "📶" },
  { id: "bills",     name: "Bills",           emoji: "💡" },
  { id: "hustle",    name: "Hustle",          emoji: "💼" },
  { id: "cars",      name: "Cars",            emoji: "🚗" },
];

let expenses = [];
let currentUser = null;
let selectedCategoryId = null;
let selectedMethod = "momo";
let editingExpenseId = null;
let dateFilterValue = null;
let quickFilter = null;

const DB_NAME = "sika-db";
const DB_VERSION = 2;
const SESSION_KEY = "sika-session";
let dbInstance = null;

function openDB(){
  return new Promise((resolve, reject) => {
    if (dbInstance) return resolve(dbInstance);
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      const tx = e.target.transaction;
      if (db.objectStoreNames.contains("profile")) db.deleteObjectStore("profile");
      if (!db.objectStoreNames.contains("users")) {
        db.createObjectStore("users", { keyPath: "username" });
      }
      let expenseStore;
      if (!db.objectStoreNames.contains("expenses")) {
        expenseStore = db.createObjectStore("expenses", { keyPath: "id" });
      } else {
        expenseStore = tx.objectStore("expenses");
      }
      if (!expenseStore.indexNames.contains("by_username")) {
        expenseStore.createIndex("by_username", "username", { unique: false });
      }
    };
    req.onsuccess = (e) => { dbInstance = e.target.result; resolve(dbInstance); };
    req.onerror = (e) => reject(e.target.error);
  });
}

async function hashPassword(password){
  const enc = new TextEncoder().encode(password);
  const buf = await crypto.subtle.digest("SHA-256", enc);
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}

async function getUser(username){
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("users", "readonly");
    const req = tx.objectStore("users").get(username);
    req.onsuccess = () => req.result ? resolve(req.result) : reject(new Error("No such user"));
    req.onerror = () => reject(req.error);
  });
}

async function createUser(user){
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("users", "readwrite");
    tx.objectStore("users").add(user);
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
  });
}

async function updateUserInDB(user){
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("users", "readwrite");
    tx.objectStore("users").put(user); // put() overwrites the existing record
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
  });
}

async function loadExpensesForUser(username){
  try {
    const db = await openDB();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction("expenses", "readonly");
      const req = tx.objectStore("expenses").index("by_username").getAll(username);
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    return [];
  }
}

async function addExpenseToDB(expense){
  try {
    const db = await openDB();
    await new Promise((resolve, reject) => {
      const tx = db.transaction("expenses", "readwrite");
      tx.objectStore("expenses").add(expense);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) {
    console.error("Failed to save expense:", err);
    alert("Couldn't save that expense. Try again.");
  }
}

async function deleteExpenseFromDB(id){
  try {
    const db = await openDB();
    await new Promise((resolve, reject) => {
      const tx = db.transaction("expenses", "readwrite");
      tx.objectStore("expenses").delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) {
    console.error("Failed to delete expense:", err);
  }
}

async function updateExpenseInDB(expense){
  try {
    const db = await openDB();
    await new Promise((resolve, reject) => {
      const tx = db.transaction("expenses", "readwrite");
      tx.objectStore("expenses").put(expense);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) {
    console.error("Failed to update expense:", err);
    alert("Couldn't save changes. Try again.");
  }
}

function formatMoney(n){
  return "₵" + n.toLocaleString("en-GH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function getCategory(id){
  return CATEGORIES.find(c => c.id === id) || { name: "Other", emoji: "•" };
}
function isThisMonth(dateStr){
  const d = new Date(dateStr), now = new Date();
  return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
}
function isThisWeek(dateStr){
  const d = new Date(dateStr), now = new Date();
  const diffDays = (now - d) / (1000*60*60*24);
  return diffDays >= 0 && diffDays < 7;
}
function isLastWeek(dateStr){
  const d = new Date(dateStr), now = new Date();
  const diffDays = (now - d) / (1000*60*60*24);
  return diffDays >= 7 && diffDays < 14;
}
function formatDateLabel(dateStr){
  const d = new Date(dateStr), now = new Date();
  const diff = Math.round((now - d) / (1000*60*60*24));
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}
function initials(name){
  return (name || "").trim().split(/\s+/).slice(0,2).map(w => w[0]?.toUpperCase() || "").join("") || "•";
}

async function loginUser(){
  const username = document.getElementById("loginUsername").value.trim().toLowerCase();
  const password = document.getElementById("loginPassword").value;
  const errorEl = document.getElementById("loginError");
  const btn = document.getElementById("loginBtn");

  if (!username || !password){
    errorEl.textContent = "Enter your username and password.";
    return;
  }

  errorEl.textContent = "";
  btn.disabled = true;
  btn.textContent = "Logging in…";

  try {
    const user = await getUser(username);
    const hash = await hashPassword(password);
    if (hash !== user.passwordHash) throw new Error("Wrong password");

    currentUser = user;
    expenses = await loadExpensesForUser(username);
    localStorage.setItem(SESSION_KEY, username);
    enterApp();
  } catch (err) {
    errorEl.textContent = "Incorrect username or password.";
  } finally {
    btn.disabled = false;
    btn.textContent = "Log in";
  }
}

async function registerUser(){
  const name = document.getElementById("regName").value.trim();
  const phone = document.getElementById("regPhone").value.trim();
  const username = document.getElementById("regUsername").value.trim().toLowerCase();
  const password = document.getElementById("regPassword").value;
  const errorEl = document.getElementById("regError");
  const btn = document.getElementById("regBtn");

  if (!name || !username || !password){
    errorEl.textContent = "Fill in your name, username, and password.";
    return;
  }
  if (password.length < 4){
    errorEl.textContent = "Password should be at least 4 characters.";
    return;
  }

  errorEl.textContent = "";
  btn.disabled = true;
  btn.textContent = "Creating account…";

  try {
    const existing = await getUser(username).catch(() => null);
    if (existing){
      errorEl.textContent = "That username is taken. Try another.";
      btn.disabled = false;
      btn.textContent = "Create account";
      return;
    }

    const passwordHash = await hashPassword(password);
    currentUser = { username, passwordHash, name, phone, createdAt: new Date().toISOString() };
    await createUser(currentUser);

    expenses = [];
    localStorage.setItem(SESSION_KEY, username);
    enterApp();
  } catch (err) {
    errorEl.textContent = "Couldn't create your account. Try again.";
    btn.disabled = false;
    btn.textContent = "Create account";
  }
}

function logoutUser(){
  localStorage.removeItem(SESSION_KEY);
  currentUser = null;
  expenses = [];
  document.getElementById("loginUsername").value = "";
  document.getElementById("loginPassword").value = "";
  resetRegisterForm();
  showScreen("login");
}

let confirmCallback = null;

function showConfirm(message, onConfirm){
  document.getElementById("confirmMessage").textContent = message;
  confirmCallback = onConfirm;
  document.getElementById("confirmModal").classList.remove("hidden");
}

function hideConfirm(){
  document.getElementById("confirmModal").classList.add("hidden");
  confirmCallback = null;
}

document.getElementById("confirmCancelBtn").addEventListener("click", hideConfirm);
document.getElementById("confirmYesBtn").addEventListener("click", () => {
  const cb = confirmCallback;
  hideConfirm();
  if (cb) cb();
});

function togglePasswordVisibility(inputId, btn){
  const input = document.getElementById(inputId);
  const isHidden = input.type === "password";
  input.type = isHidden ? "text" : "password";
  btn.textContent = isHidden ? "🙈" : "👁";
}

function confirmLogout(){
  showConfirm("Log out of your account?", () => {
    logoutUser();
  });
}

function usernameInitials(username){
  return (username || "").slice(0,2).toUpperCase() || "•";
}

function resetRegisterForm(){
  document.getElementById("regName").value = "";
  document.getElementById("regPhone").value = "";
  document.getElementById("regUsername").value = "";
  document.getElementById("regPassword").value = "";
  document.getElementById("regError").textContent = "";
}

function exportAccount(){
  const backup = {
    app: "sika-backup",
    version: 1,
    exportedAt: new Date().toISOString(),
    user: currentUser,
    expenses: expenses
  };
  const json = JSON.stringify(backup, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `sika-backup-${currentUser.username}-${new Date().toISOString().slice(0,10)}.json`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

async function importAccountFile(event){
  const file = event.target.files[0];
  if (!file) return;
  const errorEl = document.getElementById("importError");
  if (errorEl) errorEl.textContent = "";

  try {
    const text = await file.text();
    const data = JSON.parse(text);

    if (!data.user || !data.user.username || !Array.isArray(data.expenses)){
      throw new Error("Invalid backup file");
    }

    const existing = await getUser(data.user.username).catch(() => null);
    if (existing){
      await updateUserInDB(data.user);
    } else {
      await createUser(data.user);
    }

    const db = await openDB();
    await new Promise((resolve, reject) => {
      const tx = db.transaction("expenses", "readwrite");
      const store = tx.objectStore("expenses");
      data.expenses.forEach(e => store.put(e));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });

    currentUser = data.user;
    expenses = await loadExpensesForUser(data.user.username);
    localStorage.setItem(SESSION_KEY, data.user.username);
    enterApp();
  } catch (err) {
    console.error(err);
    if (errorEl) errorEl.textContent = "Couldn't read that backup file.";
    else alert("Couldn't read that backup file.");
  } finally {
    event.target.value = "";
  }
}

function renderProfileScreen(){
  document.getElementById("profileName").value = currentUser.name || "";
  document.getElementById("profilePhone").value = currentUser.phone || "";
  document.getElementById("profileUsername").value = currentUser.username || "";
  document.getElementById("profileCurrentPassword").value = "";
  document.getElementById("profileNewPassword").value = "";
  document.getElementById("profileError").textContent = "";
  document.getElementById("profileSuccess").textContent = "";
}

async function saveProfileChanges(){
  const name = document.getElementById("profileName").value.trim();
  const phone = document.getElementById("profilePhone").value.trim();
  const currentPassword = document.getElementById("profileCurrentPassword").value;
  const newPassword = document.getElementById("profileNewPassword").value;
  const errorEl = document.getElementById("profileError");
  const successEl = document.getElementById("profileSuccess");
  const btn = document.getElementById("profileSaveBtn");

  errorEl.textContent = "";
  successEl.textContent = "";

  if (!name){
    errorEl.textContent = "Name can't be empty.";
    return;
  }

  const updatedUser = { ...currentUser, name, phone };

  // Only touch the password if they filled in both fields
  if (currentPassword || newPassword){
    if (!currentPassword || !newPassword){
      errorEl.textContent = "Fill in both password fields to change your password.";
      return;
    }
    const currentHash = await hashPassword(currentPassword);
    if (currentHash !== currentUser.passwordHash){
      errorEl.textContent = "Current password is incorrect.";
      return;
    }
    if (newPassword.length < 4){
      errorEl.textContent = "New password should be at least 4 characters.";
      return;
    }
    updatedUser.passwordHash = await hashPassword(newPassword);
  }

  btn.disabled = true;
  btn.textContent = "Saving…";

  try {
    await updateUserInDB(updatedUser);
    currentUser = updatedUser;
    document.getElementById("profileCurrentPassword").value = "";
    document.getElementById("profileNewPassword").value = "";
    successEl.textContent = "Saved.";
    renderDashboard(); // refresh greeting/avatar in case name changed
  } catch (err) {
    errorEl.textContent = "Couldn't save changes. Try again.";
  } finally {
    btn.disabled = false;
    btn.textContent = "Save changes";
  }
}
function renderDashboard(){
  document.getElementById("dashGreeting").textContent = currentUser ? `Hi, ${currentUser.username}` : "Sika";
  document.getElementById("profileAvatar").textContent = usernameInitials(currentUser?.username);

  const monthExpenses = expenses.filter(e => isThisMonth(e.date));
  const weekExpenses = expenses.filter(e => isThisWeek(e.date));
  const monthTotal = monthExpenses.reduce((sum, e) => sum + e.amount, 0);
  const weekTotal = weekExpenses.reduce((sum, e) => sum + e.amount, 0);

  document.getElementById("monthTotal").textContent = formatMoney(monthTotal);
  document.getElementById("weekTotal").textContent = formatMoney(weekTotal);
  document.getElementById("countTotal").textContent = monthExpenses.length;
  document.getElementById("dashDateLabel").textContent =
    new Date().toLocaleDateString("en-GB", { month: "long", year: "numeric" });

  let listSource = [...expenses].sort((a,b) => new Date(b.date) - new Date(a.date));
  if (dateFilterValue){
    listSource = listSource.filter(e => e.date === dateFilterValue);
  } else if (quickFilter === "week"){
    listSource = listSource.filter(e => isThisWeek(e.date));
  } else if (quickFilter === "lastweek"){
    listSource = listSource.filter(e => isLastWeek(e.date));
  } else if (quickFilter === "month"){
    listSource = listSource.filter(e => isThisMonth(e.date));
  } else {
    listSource = listSource.slice(0, 8);
  }

  const list = document.getElementById("recentList");
  const filterActive = dateFilterValue || quickFilter;

  if (listSource.length === 0){
    list.innerHTML = filterActive
      ? '<div class="empty-state">No expenses in that range.</div>'
      : '<div class="empty-state">No expenses yet. Tap + to add your first one.</div>';
    return;
  }

  list.innerHTML = listSource.map(e => {
    const cat = getCategory(e.categoryId);
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
        <div class="ticket-actions">
          <button class="ticket-edit" onclick="editExpense(${e.id})" aria-label="Edit">✎</button>
          <button class="ticket-del" onclick="deleteExpense(${e.id})" aria-label="Delete">✕</button>
        </div>
      </div>`;
  }).join("");
}

function applyDateFilter(){
  const value = document.getElementById("dateFilter").value;
  dateFilterValue = value || null;
  quickFilter = null;
  document.querySelectorAll(".chip-btn").forEach(b => b.classList.remove("active"));
  document.getElementById("clearFilterBtn").classList.toggle("hidden", !dateFilterValue);
  renderDashboard();
}

function clearDateFilter(){
  dateFilterValue = null;
  quickFilter = null;
  document.getElementById("dateFilter").value = "";
  document.getElementById("clearFilterBtn").classList.add("hidden");
  document.querySelectorAll(".chip-btn").forEach(b => b.classList.remove("active"));
  renderDashboard();
}

function setQuickFilter(mode){
  quickFilter = (quickFilter === mode) ? null : mode;
  dateFilterValue = null;
  document.getElementById("dateFilter").value = "";
  document.getElementById("clearFilterBtn").classList.add("hidden");
  document.querySelectorAll(".chip-btn").forEach(b => b.classList.remove("active"));
  const chipIds = { week: "chipWeek", lastweek: "chipLastWeek", month: "chipMonth" };
  if (quickFilter && chipIds[quickFilter]){
    document.getElementById(chipIds[quickFilter]).classList.add("active");
  }
  renderDashboard();
}

function exportCSV(){
  if (expenses.length === 0){
    alert("No expenses to export yet.");
    return;
  }
  const header = ["Date", "Category", "Amount (GHS)", "Payment method", "Note"];
  const rows = [...expenses]
    .sort((a,b) => new Date(a.date) - new Date(b.date))
    .map(e => [
      e.date,
      getCategory(e.categoryId).name,
      e.amount.toFixed(2),
      e.method === "momo" ? "Mobile money" : "Cash",
      (e.note || "").replace(/"/g, '""')
    ]);

  const csv = [header, ...rows]
    .map(row => row.map(field => `"${field}"`).join(","))
    .join("\n");

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `sika-expenses-${currentUser.username}-${new Date().toISOString().slice(0,10)}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function applyDateFilter(){
  const value = document.getElementById("dateFilter").value;
  dateFilterValue = value || null;
  document.getElementById("clearFilterBtn").classList.toggle("hidden", !dateFilterValue);
  renderDashboard();
}

function clearDateFilter(){
  dateFilterValue = null;
  document.getElementById("dateFilter").value = "";
  document.getElementById("clearFilterBtn").classList.add("hidden");
  renderDashboard();
}

function deleteExpense(id){
  showConfirm("Delete this expense?", async () => {
    expenses = expenses.filter(e => e.id !== id);
    await deleteExpenseFromDB(id);
    renderDashboard();
    renderCategories();
  });
}
function renderCategoryGrid(){
  const grid = document.getElementById("categoryGrid");
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
  document.getElementById("toggleMomo").classList.toggle("active", method === "momo");
  document.getElementById("toggleCash").classList.toggle("active", method === "cash");
}
function resetAddForm(){
  document.getElementById("amountInput").value = "";
  document.getElementById("noteInput").value = "";
  document.getElementById("dateInput").value = new Date().toISOString().slice(0,10);
  selectedCategoryId = null;
  selectedMethod = "momo";
  editingExpenseId = null;
  document.querySelector("#screen-add .page-title").textContent = "Add expense";
  document.getElementById("saveBtn").textContent = "Save expense";
  renderCategoryGrid();
  setPaymentMethod("momo");
}

function editExpense(id){
  const exp = expenses.find(e => e.id === id);
  if (!exp) return;
  editingExpenseId = id;
  document.getElementById("amountInput").value = exp.amount;
  document.getElementById("noteInput").value = exp.note || "";
  document.getElementById("dateInput").value = exp.date;
  selectedCategoryId = exp.categoryId;
  selectedMethod = exp.method;
  renderCategoryGrid();
  setPaymentMethod(exp.method);
  document.querySelector("#screen-add .page-title").textContent = "Edit expense";
  document.getElementById("saveBtn").textContent = "Save changes";
  showScreen("add");
}

function startNewExpense(){
  editingExpenseId = null;
  showScreen("add");
}

async function saveExpense(){
  const amount = parseFloat(document.getElementById("amountInput").value);
  const note = document.getElementById("noteInput").value.trim();
  const date = document.getElementById("dateInput").value || new Date().toISOString().slice(0,10);
  const btn = document.getElementById("saveBtn");

  if (!amount || amount <= 0){ alert("Enter an amount."); return; }
  if (!selectedCategoryId){ alert("Pick a category."); return; }

  const wasEditing = !!editingExpenseId;
  btn.disabled = true;
  btn.textContent = "Saving…";

  if (wasEditing){
    const idx = expenses.findIndex(e => e.id === editingExpenseId);
    const updatedExpense = { ...expenses[idx], amount, categoryId: selectedCategoryId, method: selectedMethod, note, date };
    expenses[idx] = updatedExpense;
    await updateExpenseInDB(updatedExpense);
  } else {
    const newExpense = {
      id: Date.now(),
      username: currentUser.username,
      amount,
      categoryId: selectedCategoryId,
      method: selectedMethod,
      note,
      date,
    };
    expenses.push(newExpense);
    await addExpenseToDB(newExpense);
  }

  btn.disabled = false;

  resetAddForm();
  renderDashboard();
  renderCategories();
  showScreen("dashboard");
}

function renderCategories(){
  const monthExpenses = expenses.filter(e => isThisMonth(e.date));
  const totals = {};
  CATEGORIES.forEach(c => totals[c.id] = 0);
  monthExpenses.forEach(e => { totals[e.categoryId] = (totals[e.categoryId] || 0) + e.amount; });

  const maxSpend = Math.max(1, ...Object.values(totals));
  const container = document.getElementById("categoryBreakdown");

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

function showScreen(name){
  document.querySelectorAll(".screen").forEach(s => s.classList.remove("active"));
  document.getElementById("screen-" + name).classList.add("active");

  if (name !== "add") editingExpenseId = null;

  const chrome = document.getElementById("tabbar");
  const fab = document.getElementById("fabBtn");
  if (name === "login" || name === "register"){
    chrome.classList.add("hidden");
    fab.classList.add("hidden");
  } else {
    chrome.classList.remove("hidden");
    fab.classList.remove("hidden");
    document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
    const tabBtn = document.querySelector(`.tab-btn[data-tab="${name}"]`);
    if (tabBtn) tabBtn.classList.add("active");
    if (name === "profile") renderProfileScreen();
    if (name === "register") resetRegisterForm();
  }

  if (name === "add" && !editingExpenseId) resetAddForm();
  if (name === "categories") renderCategories();
}

function enterApp(){
  renderDashboard();
  renderCategoryGrid();
  renderCategories();
  document.getElementById("dateInput").value = new Date().toISOString().slice(0,10);
  showScreen("dashboard");
}

async function init(){
  const savedUsername = localStorage.getItem(SESSION_KEY);
  if (savedUsername){
    try {
      currentUser = await getUser(savedUsername);
      expenses = await loadExpensesForUser(savedUsername);
      enterApp();
    } catch (err) {
      localStorage.removeItem(SESSION_KEY);
      showScreen("login");
    }
  } else {
    showScreen("login");
  }
  document.getElementById("loadingOverlay").classList.add("hidden");
}
init();