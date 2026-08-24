const CATEGORIES = [
  { id: "food",      name: "Food",            emoji: "🍛" },
  { id: "transport", name: "Transport/Trotro", emoji: "🚌" },
  { id: "airtime",   name: "Airtime/Data",    emoji: "📶" },
  { id: "bills",     name: "Bills",           emoji: "💡" },
  { id: "hustle",    name: "Hustle",          emoji: "💼" },
  { id: "cars",      name: "Cars",            emoji: "🚗" },
];

const INCOME_CATEGORIES = [
  { id: "salary",   name: "Salary",        emoji: "💰" },
  { id: "business", name: "Business",      emoji: "🧾" },
  { id: "momo_in",  name: "Momo received", emoji: "📲" },
  { id: "gift",     name: "Gift",          emoji: "🎁" },
  { id: "other_in", name: "Other income",  emoji: "➕" },
];

let expenses = [];
let currentUser = null;
let selectedCategoryId = null;
let selectedMethod = "momo";
let selectedType = "expense";
let budgets = {};
let recurringTemplates = [];

// Dashboard state
let dateFilterValue = null;
let quickFilter = "week";
let summaryMode = "month";
let editingExpenseId = null;
const SESSION_KEY = "sika-session";
let searchQuery = "";
let filterCategoryId = "";
let filterMinAmount = null;
let filterMaxAmount = null;
let pendingUpdateReg = null;

function showUpdateBanner(reg){
  pendingUpdateReg = reg;
  document.getElementById("updateBanner").classList.remove("hidden");
}

function applyUpdate(){
  if (pendingUpdateReg && pendingUpdateReg.waiting){
    pendingUpdateReg.waiting.postMessage("skipWaiting");
  }
  document.getElementById("updateBanner").classList.add("hidden");
}

function applySearch(){
  searchQuery = document.getElementById("searchInput").value.trim().toLowerCase();
  filterCategoryId = document.getElementById("categoryFilterSelect").value;
  const min = document.getElementById("minAmountInput").value;
  const max = document.getElementById("maxAmountInput").value;
  filterMinAmount = min ? parseFloat(min) : null;
  filterMaxAmount = max ? parseFloat(max) : null;

  if (searchQuery || filterCategoryId || filterMinAmount !== null || filterMaxAmount !== null){
    quickFilter = null;
    dateFilterValue = null;
    document.querySelectorAll(".chip-btn").forEach(b => b.classList.remove("active"));
  }

  renderDashboard();
}

function clearSearch(){
  document.getElementById("searchInput").value = "";
  document.getElementById("categoryFilterSelect").value = "";
  document.getElementById("minAmountInput").value = "";
  document.getElementById("maxAmountInput").value = "";
  searchQuery = "";
  filterCategoryId = "";
  filterMinAmount = null;
  filterMaxAmount = null;
  renderDashboard();
}

async function hashPassword(password){
  const enc = new TextEncoder().encode(password);
  const buf = await crypto.subtle.digest("SHA-256", enc);
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}

async function getUser(username){
  try{
    const doc=await db.collection("users").doc(username).get();
    if(!doc.exists) return null;
    return doc.data();
  }catch(err){console.error(err);throw err;}
}

async function createUser(user){
  await db.collection("users").doc(user.username).set(user);
  return true;
}

async function updateUserInDB(user){
  await db.collection("users").doc(user.username).set(user);
  return true;
}

async function saveUsername(){
  const errEl = document.getElementById("usernameChangeError");
  errEl.textContent = "";
  const newDisplayUsername = document.getElementById("profileUsername").value.trim();
  const newUsername = newDisplayUsername.toLowerCase();
  const oldUsername = currentUser.username;

  if (!newUsername){ errEl.textContent = "Username can't be empty."; return; }
  if (!/^[a-z0-9_]{3,20}$/i.test(newUsername)){
    errEl.textContent = "3-20 characters: letters, numbers, underscore only.";
    return;
  }
  if (newUsername === oldUsername && newDisplayUsername === (currentUser.displayUsername || currentUser.username)) return;

  showConfirm(`Change username from "${oldUsername}" to "${newUsername}"? This updates all your data.`, async () => {
    try {
      const existing = await getUser(newUsername);
      if (existing && newUsername !== oldUsername){ errEl.textContent = "That username is already taken."; return; }

      const wasOwnHousehold = currentUser.householdId === oldUsername;

      const updatedUser = { ...currentUser, username: newUsername, displayUsername: newDisplayUsername };
      if (wasOwnHousehold) updatedUser.householdId = newUsername;
      await db.collection("users").doc(newUsername).set(updatedUser);

      const budgetsDoc = await db.collection("budgets").doc(oldUsername).get();
      if (budgetsDoc.exists && newUsername !== oldUsername){
        await db.collection("budgets").doc(newUsername).set(budgetsDoc.data());
        await db.collection("budgets").doc(oldUsername).delete();
      }

      if (newUsername !== oldUsername){
        const expSnap = await db.collection("expenses").where("username", "==", oldUsername).get();
        const batch1 = db.batch();
        expSnap.docs.forEach(d => {
          const data = d.data();
          const update = { username: newUsername };
          if (wasOwnHousehold && data.householdId === oldUsername) update.householdId = newUsername;
          batch1.update(d.ref, update);
        });
        await batch1.commit();

        const recSnap = await db.collection("recurring").where("username", "==", oldUsername).get();
        const batch2 = db.batch();
        recSnap.docs.forEach(d => {
          const data = d.data();
          const update = { username: newUsername };
          if (wasOwnHousehold && data.householdId === oldUsername) update.householdId = newUsername;
          batch2.update(d.ref, update);
        });
        await batch2.commit();

        if (wasOwnHousehold){
          const membersSnap = await db.collection("users").where("householdId", "==", oldUsername).get();
          const batch3 = db.batch();
          membersSnap.docs.forEach(d => {
            if (d.id !== oldUsername) batch3.update(d.ref, { householdId: newUsername });
          });
          await batch3.commit();
        }

        await db.collection("users").doc(oldUsername).delete();
      }

      currentUser = updatedUser;
      localStorage.setItem(SESSION_KEY, newUsername);
      document.getElementById("dashGreeting").textContent = `Hi, ${newDisplayUsername}`;
      alert("Username updated.");
    } catch (err){
      console.error("Username change failed:", err);
      errEl.textContent = "Something went wrong. Check your connection and try again.";
    }
  });
}

async function loadExpensesForUser(username){
  try {
    const snapshot = await db.collection("expenses").where("username", "==", username).get();
    return snapshot.docs.map(doc => doc.data());
  } catch (err) {
    console.error("Failed to load expenses:", err);
    return [];
  }
}
async function loadExpensesForHousehold(householdId){
  try {
    const snapshot = await db.collection("expenses").where("householdId", "==", householdId).get();
    return snapshot.docs.map(doc => doc.data());
  } catch (err) {
    console.error("Failed to load expenses:", err);
    return [];
  }
}
async function loadRecurringForUser(username){
  try {
    const snapshot = await db.collection("recurring").where("username", "==", username).get();
    return snapshot.docs.map(doc => doc.data());
  } catch (err) {
    console.error("Failed to load recurring templates:", err);
    return [];
  }
}

async function addExpenseToDB(expense){
  try {
    await db.collection("expenses").doc(String(expense.id)).set(expense);
  } catch (err) {
    console.error("Failed to save expense:", err);
    alert("Couldn't save that entry. Check your internet connection and try again.");
  }
}
async function addRecurringToDB(template){
  try {
    await db.collection("recurring").doc(String(template.id)).set(template);
  } catch (err) {
    console.error("Failed to save recurring template:", err);
    alert("Couldn't save that recurring entry. Check your internet connection and try again.");
  }
}

async function updateRecurringInDB(template){
  try {
    await db.collection("recurring").doc(String(template.id)).set(template);
  } catch (err) {
    console.error("Failed to update recurring template:", err);
    alert("Couldn't update that recurring entry. Check your internet connection and try again.");
  }
}

async function deleteRecurringFromDB(id){
  try {
    await db.collection("recurring").doc(String(id)).delete();
  } catch (err) {
    console.error("Failed to delete recurring template:", err);
    alert("Couldn't delete that recurring entry. Check your internet connection.");
  }
}

async function saveRecurringTemplatesToDB(templates){
  try {
    const batch = db.batch();
    templates.forEach(t => {
      const ref = db.collection("recurring").doc(String(t.id));
      batch.set(ref, t);
    });
    await batch.commit();
  } catch (err) {
    console.error("Failed to save recurring templates:", err);
    alert("Couldn't sync recurring entries. Check your internet connection and try again.");
  }
}

async function updateExpenseInDB(expense){
  try {
    await db.collection("expenses").doc(String(expense.id)).set(expense);
  } catch (err) {
    console.error("Failed to update expense:", err);
    alert("Couldn't save changes. Check your internet connection and try again.");
  }
}

async function deleteExpenseFromDB(id){
  try {
    await db.collection("expenses").doc(String(id)).delete();
  } catch (err) {
    console.error("Failed to delete expense:", err);
    alert("Couldn't delete that entry. Check your internet connection.");
  }
}

async function loadBudgetsForUser(username){
  try {
    const doc = await db.collection("budgets").doc(username).get();
    return doc.exists ? doc.data() : {};
  } catch (err) {
    console.error("Failed to load budgets:", err);
    return {};
  }
}

async function saveBudgetsForUser(username, budgetData){
  try {
    await db.collection("budgets").doc(username).set(budgetData);
  } catch (err) {
    console.error("Failed to save budgets:", err);
    alert("Couldn't save budget. Check your connection and try again.");
  }
}

function toggleRateInput(){
  const currency = document.getElementById("currencyInput").value;
  const rateRow = document.getElementById("rateRow");
  if (currency === "GHS"){
    rateRow.classList.add("hidden");
  } else {
    rateRow.classList.remove("hidden");
    document.getElementById("rateCurrencyLabel").textContent = currency;
  }
}

function formatMoney(n, currency = "GHS"){
  const symbols = { GHS: "₵", USD: "$", GBP: "£", EUR: "€" };
  const symbol = symbols[currency] || "₵";
  return symbol + n.toLocaleString("en-GH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function getCategory(id){
  return CATEGORIES.find(c => c.id === id) || { name: "Other", emoji: "•" };
}
function getCategoryList(type){
  return type === "income" ? INCOME_CATEGORIES : CATEGORIES;
}
function getCategoryAny(id, type){
  return getCategoryList(type).find(c => c.id === id) || { name: "Other", emoji: "•" };
}
function isThisMonth(dateStr){
  const d = new Date(dateStr), now = new Date();
  return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
}

function isLastMonth(dateStr){
  const { start, end } = getLastMonthRange();
  const d = new Date(dateStr);
  return d >= start && d <= end;
}

function getMonthRange(offsetMonths = 0) {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + offsetMonths;

  const start = new Date(year, month, 1);
  const end = new Date(year, month + 1, 0); // last day of that month
  end.setHours(23, 59, 59, 999);

  return { start, end };
}

function getThisMonthRange() { return getMonthRange(0); }
function getLastMonthRange() { return getMonthRange(-1); }

function getWeekStart(refDate, offsetWeeks = 0){
  const day = new Date(refDate.getFullYear(), refDate.getMonth(), refDate.getDate());
  const dayOfWeek = day.getDay(); // Sunday = 0 ... Saturday = 6
  day.setDate(day.getDate() - dayOfWeek + offsetWeeks * 7);
  day.setHours(0, 0, 0, 0);
  return day;
}

function isThisWeek(dateStr){
  const d = new Date(dateStr);
  const start = getWeekStart(new Date(), 0);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  end.setHours(23, 59, 59, 999);
  return d >= start && d <= end;
}

function isLastWeek(dateStr){
  const d = new Date(dateStr);
  const start = getWeekStart(new Date(), -1);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  end.setHours(23, 59, 59, 999);
  return d >= start && d <= end;
}
function formatDateLabel(dateStr){
  const d = new Date(dateStr), now = new Date();

  const dOnly = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const nowOnly = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  const diffDays = Math.round((nowOnly - dOnly) / (1000*60*60*24));

  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays} days ago`;

  const diffWeeks = Math.floor(diffDays / 7);
  if (diffWeeks === 1) return "A week ago";
  if (diffWeeks < 5) return `${diffWeeks} weeks ago`;

  const diffMonths = (nowOnly.getFullYear() - dOnly.getFullYear()) * 12 + (nowOnly.getMonth() - dOnly.getMonth());
  if (diffMonths === 1) return "A month ago";
  if (diffMonths < 12) return `${diffMonths} months ago`;

  const diffYears = Math.floor(diffMonths / 12);
  if (diffYears === 1) return "A year ago";
  return `${diffYears} years ago`;
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
    const householdId = currentUser.householdId || currentUser.username;
    expenses = await loadExpensesForHousehold(householdId);
    recurringTemplates = await loadRecurringForUser(username);
    await processRecurringEntries();
    localStorage.setItem(SESSION_KEY, username);
    enterApp();
  } catch (err) {
    console.error(err); errorEl.textContent = err.message || "Incorrect username or password.";
  } finally {
    btn.disabled = false;
    btn.textContent = "Log in";
  }
}

async function registerUser(){
  const name = document.getElementById("regName").value.trim();
  const phone = document.getElementById("regPhone").value.trim();
  const displayUsername = document.getElementById("regUsername").value.trim();
  const username = displayUsername.toLowerCase();
  const password = document.getElementById("regPassword").value;
  const inviteCode = document.getElementById("regInviteCode")?.value.trim().toLowerCase();
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

    let householdId = username;
    if (inviteCode){
      const host = await getUser(inviteCode).catch(() => null);
      if (!host){
        errorEl.textContent = "That household code wasn't found.";
        btn.disabled = false;
        btn.textContent = "Create account";
        return;
      }
      householdId = host.householdId || host.username;
    }

    const passwordHash = await hashPassword(password);
    currentUser = { username, displayUsername, passwordHash, name, phone, householdId, createdAt: new Date().toISOString() };
    await createUser(currentUser);

    expenses = await loadExpensesForHousehold(householdId);
    localStorage.setItem(SESSION_KEY, username);
    enterApp();
  } catch (err) {
    console.error(err); errorEl.textContent = err.message || "Couldn't create your account. Try again.";
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

function renderProfileScreen(){
  document.getElementById("profileName").value = currentUser.name || "";
  document.getElementById("profilePhone").value = currentUser.phone || "";
  document.getElementById("profileUsername").value = currentUser.displayUsername || currentUser.username || "";
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
async function processRecurringEntries(){
  const today = new Date().toISOString().slice(0,10);

  for (const template of recurringTemplates){
    while (template.nextDate <= today){
      const newExpense = {
        id: Date.now() + Math.floor(Math.random() * 1000),
        username: template.username,
        amount: template.amount,
        categoryId: template.categoryId,
        method: template.method,
        note: template.note,
        date: template.nextDate,
        type: template.type,
      };
      expenses.push(newExpense);
      await addExpenseToDB(newExpense);

      template.nextDate = getNextOccurrence(template.nextDate, template.frequency);
    }
  }
  await saveRecurringTemplatesToDB(recurringTemplates);
}
function renderDashboard(){
  document.getElementById("dashGreeting").textContent = currentUser ? `Hi, ${currentUser.displayUsername || currentUser.username}` : "Sika";
  document.getElementById("profileAvatar").textContent = usernameInitials(currentUser?.username);

  const monthEntries = expenses.filter(e => isThisMonth(e.date));
  const weekEntries = expenses.filter(e => isThisWeek(e.date));

  const monthExpenseTotal = monthEntries.filter(e => (e.type || "expense") === "expense").reduce((sum, e) => sum + e.amount, 0);
  const monthIncomeTotal = monthEntries.filter(e => e.type === "income").reduce((sum, e) => sum + e.amount, 0);
  const weekExpenseTotal = weekEntries.filter(e => (e.type || "expense") === "expense").reduce((sum, e) => sum + e.amount, 0);

  document.getElementById("monthTotal").textContent = formatMoney(monthExpenseTotal);
  document.getElementById("incomeTotal").textContent = formatMoney(monthIncomeTotal);
  document.getElementById("balanceTotal").textContent = formatMoney(monthIncomeTotal - monthExpenseTotal);
  document.getElementById("weekTotal").textContent = formatMoney(weekExpenseTotal);
  document.getElementById("countTotal").textContent = monthEntries.length;
  document.getElementById("dashDateLabel").textContent =
    new Date().toLocaleDateString("en-GB", { month: "long", year: "numeric" });

  let listSource = [...expenses].sort((a,b) => new Date(b.date) - new Date(a.date));

  const hasSearchFilter = searchQuery || filterCategoryId || filterMinAmount !== null || filterMaxAmount !== null;

  if (hasSearchFilter){
    listSource = listSource.filter(e => {
      if (searchQuery){
        const cat = getCategoryAny(e.categoryId, e.type || "expense");
        const noteMatch = (e.note || "").toLowerCase().includes(searchQuery);
        const catMatch = cat.name.toLowerCase().includes(searchQuery);
        if (!noteMatch && !catMatch) return false;
      }
      if (filterCategoryId && e.categoryId !== filterCategoryId) return false;
      if (filterMinAmount !== null && e.amount < filterMinAmount) return false;
      if (filterMaxAmount !== null && e.amount > filterMaxAmount) return false;
      return true;
    });
  } else if (dateFilterValue){
    listSource = listSource.filter(e => e.date === dateFilterValue);
  } else if (quickFilter === "week"){
    listSource = listSource.filter(e => isThisWeek(e.date));
  } else if (quickFilter === "lastweek"){
    listSource = listSource.filter(e => isLastWeek(e.date));
  } else if (quickFilter === "month"){
    listSource = listSource.filter(e => isThisMonth(e.date));
  } else if (quickFilter === "lastmonth"){
    listSource = listSource.filter(e => isLastMonth(e.date));
  } else {
    listSource = listSource.slice(0, 8);
  }

  const list = document.getElementById("recentList");
  const filterActive = hasSearchFilter || dateFilterValue || quickFilter;

  if (listSource.length === 0){
    list.innerHTML = filterActive
      ? '<div class="empty-state">No entries in that range.</div>'
      : '<div class="empty-state">No entries yet. Tap + to add your first one.</div>';
    return;
  }

  list.innerHTML = listSource.map(e => {
    const type = e.type || "expense";
    const cat = getCategoryAny(e.categoryId, type);
    const badgeClass = e.method === "momo" ? "badge-momo" : "badge-cash";
    const badgeLabel = e.method === "momo" ? "Mobile money" : "Cash";
    const sign = type === "income" ? "+" : "−";
    const amountClass = type === "income" ? "ticket-amount income" : "ticket-amount expense";
    return `
      <div class="ticket">
        <div class="ticket-icon">${cat.emoji}</div>
        <div class="ticket-body">
          <div class="ticket-cat">${cat.name}</div>
          <div class="ticket-note">${e.note || formatDateLabel(e.date)}${e.originalCurrency && e.originalCurrency !== "GHS" ? ` · ${formatMoney(e.originalAmount, e.originalCurrency)}` : ""}</div>
        </div>
        <div class="ticket-right">
          <div class="${amountClass}">${sign}${formatMoney(e.amount)}</div>
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
  quickFilter = mode; // always one selected — no toggle-off
  dateFilterValue = null;
  document.getElementById("dateFilter").value = "";
  document.getElementById("clearFilterBtn").classList.add("hidden");
  document.querySelectorAll(".chip-btn").forEach(b => b.classList.remove("active"));
  const chipIds = { week: "chipWeek", lastweek: "chipLastWeek", month: "chipMonth", lastmonth: "chipLastMonth" };
  document.getElementById(chipIds[mode]).classList.add("active");
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
  const list = getCategoryList(selectedType);
  grid.innerHTML = list.map(c => `
    <div class="cat-chip ${c.id === selectedCategoryId ? 'selected' : ''}" onclick="selectCategory('${c.id}')">
      <span class="cat-emoji">${c.emoji}</span>${c.name}
    </div>
  `).join("");
}
function populateCategoryFilter(){
  const select = document.getElementById("categoryFilterSelect");
  const allCats = [...CATEGORIES, ...INCOME_CATEGORIES];
  select.innerHTML = '<option value="">All categories</option>' +
    allCats.map(c => `<option value="${c.id}">${c.emoji} ${c.name}</option>`).join("");
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
function setEntryType(type){
  selectedType = type;
  document.getElementById("toggleTypeExpense").classList.toggle("active", type === "expense");
  document.getElementById("toggleTypeIncome").classList.toggle("active", type === "income");
  document.getElementById("categoryFieldLabel").textContent = type === "income" ? "Source" : "Category";
  selectedCategoryId = null;
  renderCategoryGrid();
}
function resetAddForm(){
  document.getElementById("amountInput").value = "";
  document.getElementById("noteInput").value = "";
  document.getElementById("dateInput").value = new Date().toISOString().slice(0,10);
  selectedCategoryId = null;
  selectedMethod = "momo";
  selectedType = "expense";
  editingExpenseId = null;
  document.querySelector("#screen-add .page-title").textContent = "Add expense";
  document.getElementById("saveBtn").textContent = "Save expense";
  document.getElementById("categoryFieldLabel").textContent = "Category";
  document.getElementById("toggleTypeExpense").classList.add("active");
  document.getElementById("toggleTypeIncome").classList.remove("active");
  document.getElementById("recurringCheckbox").checked = false;
  document.getElementById("recurringFrequency").classList.add("hidden");
  renderCategoryGrid();
  setPaymentMethod("momo");
}

function editExpense(id){
  const exp = expenses.find(e => e.id === id);
  if (!exp) return;
  editingExpenseId = id;
  selectedType = exp.type || "expense";
  document.getElementById("amountInput").value = exp.amount;
  document.getElementById("noteInput").value = exp.note || "";
  document.getElementById("dateInput").value = exp.date;
  selectedCategoryId = exp.categoryId;
  selectedMethod = exp.method;
  document.getElementById("toggleTypeExpense").classList.toggle("active", selectedType === "expense");
  document.getElementById("toggleTypeIncome").classList.toggle("active", selectedType === "income");
  document.getElementById("categoryFieldLabel").textContent = selectedType === "income" ? "Source" : "Category";
  renderCategoryGrid();
  setPaymentMethod(exp.method);
  document.querySelector("#screen-add .page-title").textContent = "Edit entry";
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
  const isRecurring = document.getElementById("recurringCheckbox")?.checked;
  const frequency = document.getElementById("recurringFrequency")?.value;
  const currency = document.getElementById("currencyInput")?.value || "GHS";
  const rate = currency === "GHS" ? 1 : parseFloat(document.getElementById("rateInput").value);
  const householdId = currentUser.householdId || currentUser.username;

  if (!amount || amount <= 0){ alert("Enter an amount."); return; }
  if (!selectedCategoryId){ alert(selectedType === "income" ? "Pick a source." : "Pick a category."); return; }
  if (currency !== "GHS" && (!rate || rate <= 0)){ alert("Enter the exchange rate."); return; }

  const amountGHS = amount * rate;

  const wasEditing = !!editingExpenseId;
  btn.disabled = true;
  btn.textContent = "Saving…";

  if (wasEditing){
    const idx = expenses.findIndex(e => e.id === editingExpenseId);
    const updatedExpense = { ...expenses[idx], amount, amountGHS, currency, rate, categoryId: selectedCategoryId, method: selectedMethod, note, date, type: selectedType };
    expenses[idx] = updatedExpense;
    await updateExpenseInDB(updatedExpense);
  } else {
    const newExpense = {
      id: Date.now(),
      username: currentUser.username,
      householdId,
      amount,
      amountGHS,
      currency,
      rate,
      categoryId: selectedCategoryId,
      method: selectedMethod,
      note,
      date,
      type: selectedType,
    };
    expenses.push(newExpense);
    await addExpenseToDB(newExpense);
    if (selectedType === "expense") checkBudgetAlert(selectedCategoryId);

    if (isRecurring){
      const template = {
        id: Date.now() + 1,
        username: currentUser.username,
        amount,
        amountGHS,
        currency,
        rate,
        categoryId: selectedCategoryId,
        method: selectedMethod,
        note,
        type: selectedType,
        frequency,
        nextDate: getNextOccurrence(date, frequency),
      };
      recurringTemplates.push(template);
      await addRecurringToDB(template);
    }
  }

  btn.disabled = false;
  resetAddForm();
  renderDashboard();
  renderCategories();
  showScreen("dashboard");
}
function toggleRecurringOptions(){
  document.getElementById("recurringFrequency").classList.toggle(
    "hidden",
    !document.getElementById("recurringCheckbox").checked
  );
}

function getNextOccurrence(fromDateStr, frequency){
  const d = new Date(fromDateStr);
  if (frequency === "weekly") d.setDate(d.getDate() + 7);
  else d.setMonth(d.getMonth() + 1); // monthly
  return d.toISOString().slice(0,10);
}
function renderCategories(){
  const monthEntries = expenses.filter(e => isThisMonth(e.date));
  renderBreakdownInto("categoryBreakdown", monthEntries.filter(e => (e.type || "expense") === "expense"), CATEGORIES);
  renderBreakdownInto("incomeBreakdown", monthEntries.filter(e => e.type === "income"), INCOME_CATEGORIES);
}

function renderRecurringScreen(){
  const container = document.getElementById("recurringList");
  if (!recurringTemplates.length){
    container.innerHTML = `<p class="page-sub">No recurring entries yet. Turn on "Repeat" when adding an entry to create one.</p>`;
    return;
  }
  container.innerHTML = recurringTemplates.map(t => {
    const list = t.type === "income" ? INCOME_CATEGORIES : CATEGORIES;
    const cat = list.find(c => c.id === t.categoryId);
    const freqLabel = t.frequency === "weekly" ? "Weekly" : "Monthly";
    return `
      <div class="budget-card">
        <div class="budget-card-top">
          <span class="budget-card-emoji">${cat ? cat.emoji : "🔁"}</span>
          <span class="budget-card-name">${cat ? cat.name : "Uncategorized"}</span>
          <button class="secondary-btn" style="padding:6px 12px" onclick="deleteRecurringTemplate(${t.id})">Delete</button>
        </div>
        <div class="budget-status">${freqLabel} · ${formatMoney(t.amount)}${t.note ? " · " + t.note : ""} · next on ${t.nextDate}</div>
      </div>
    `;
  }).join("");
}

function deleteRecurringTemplate(id){
  showConfirm("Stop this recurring entry? Past entries it already created will stay.", async () => {
    recurringTemplates = recurringTemplates.filter(t => t.id !== id);
    await deleteRecurringFromDB(id);
    renderRecurringScreen();
  });
}

function renderBudgetsScreen(){
  const monthExpenses = expenses.filter(e => isThisMonth(e.date) && (e.type || "expense") === "expense");
  const spentByCategory = {};
  CATEGORIES.forEach(c => spentByCategory[c.id] = 0);
  monthExpenses.forEach(e => { spentByCategory[e.categoryId] = (spentByCategory[e.categoryId] || 0) + e.amount; });

  const container = document.getElementById("budgetList");
  container.innerHTML = CATEGORIES.map(c => {
    const limit = budgets[c.id] || 0;
    const spent = spentByCategory[c.id] || 0;
    const pct = limit > 0 ? Math.min(100, Math.round((spent / limit) * 100)) : 0;
    let barClass = "ok";
    let statusText = limit > 0 ? `${formatMoney(spent)} of ${formatMoney(limit)}` : "No budget set";
    let statusClass = "";
    if (limit > 0){
      if (spent > limit){ barClass = "over"; statusClass = "over"; statusText = `${formatMoney(spent)} of ${formatMoney(limit)} — over budget`; }
      else if (pct >= 80){ barClass = "warn"; }
    }
    return `
      <div class="budget-card">
        <div class="budget-card-top">
          <span class="budget-card-emoji">${c.emoji}</span>
          <span class="budget-card-name">${c.name}</span>
          <div class="budget-input-wrap">
            <span>₵</span>
            <input type="number" min="0" step="1" placeholder="0"
              value="${limit || ''}"
              id="budgetInput-${c.id}" />
            <button class="secondary-btn" style="width:auto; padding:7px 12px; font-size:12px"
              onclick="setBudget('${c.id}', document.getElementById('budgetInput-${c.id}').value)">Set</button>
          </div>
        </div>
        ${limit > 0 ? `<div class="budget-progress-track"><div class="budget-progress-fill ${barClass}" style="width:${pct}%"></div></div>` : ''}
        <div class="budget-status ${statusClass}">${statusText}</div>
      </div>`;
  }).join("");
}
function checkBudgetAlert(categoryId){
  const limit = budgets[categoryId] || 0;
  if (limit <= 0) return; // no budget set, nothing to check

  const monthExpenses = expenses.filter(e => isThisMonth(e.date) && (e.type || "expense") === "expense" && e.categoryId === categoryId);
  const spent = monthExpenses.reduce((sum, e) => sum + e.amount, 0);
  const pct = Math.round((spent / limit) * 100);
  const cat = CATEGORIES.find(c => c.id === categoryId);
  const catName = cat ? cat.name : "this category";

  if (spent > limit){
    showBudgetToast(`⚠️ You're over budget on ${catName} — ${formatMoney(spent)} of ${formatMoney(limit)}.`, "over");
  } else if (pct >= 80){
    showBudgetToast(`You've used ${pct}% of your ${catName} budget (${formatMoney(spent)} of ${formatMoney(limit)}).`, "warn");
  }
}

function showBudgetToast(message, type){
  const toast = document.createElement("div");
  toast.className = `budget-toast ${type}`;
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.classList.add("show"), 10);
  setTimeout(() => {
    toast.classList.remove("show");
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

async function setBudget(categoryId, value){
  const amount = parseFloat(value);
  if (!amount || amount <= 0){
    delete budgets[categoryId];
  } else {
    budgets[categoryId] = amount;
  }
  await saveBudgetsForUser(currentUser.username, budgets);
  renderBudgetsScreen();
}

function renderBreakdownInto(containerId, entries, categoryList){
  const totals = {};
  categoryList.forEach(c => totals[c.id] = 0);
  entries.forEach(e => { totals[e.categoryId] = (totals[e.categoryId] || 0) + e.amount; });
  const maxSpend = Math.max(1, ...Object.values(totals));
  const container = document.getElementById(containerId);

  if (entries.length === 0){
    container.innerHTML = '<div class="empty-state">Nothing here yet.</div>';
    return;
  }

  container.innerHTML = categoryList.map(c => {
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

function setSummaryMode(mode){
  summaryMode = mode;
  document.getElementById("summaryModeMonth").classList.toggle("active", mode === "month");
  document.getElementById("summaryModeYear").classList.toggle("active", mode === "year");
  document.getElementById("summaryMonthField").classList.toggle("hidden", mode !== "month");
  document.getElementById("summaryYearField").classList.toggle("hidden", mode !== "year");
  renderSummary();
}

function renderSummaryScreen(){
  const monthInput = document.getElementById("summaryMonthInput");
  if (!monthInput.value) monthInput.value = new Date().toISOString().slice(0,7);
  const yearInput = document.getElementById("summaryYearInput");
  if (!yearInput.value) yearInput.value = new Date().getFullYear();
  renderSummary();
}

function renderSummary(){
  let filtered = [];
  let label = "";

  if (summaryMode === "month"){
    const value = document.getElementById("summaryMonthInput").value;
    if (!value) return;
    filtered = expenses.filter(e => e.date.slice(0,7) === value);
    const [y, m] = value.split("-");
    label = new Date(Number(y), Number(m) - 1, 1).toLocaleDateString("en-GB", { month: "long", year: "numeric" });
  } else {
    const year = document.getElementById("summaryYearInput").value;
    if (!year) return;
    filtered = expenses.filter(e => e.date.slice(0,4) === String(year));
    label = String(year);
  }

  const expenseEntries = filtered.filter(e => (e.type || "expense") === "expense");
  const incomeEntries = filtered.filter(e => e.type === "income");

  document.getElementById("summaryTotalLabel").textContent = `Spent — ${label}`;
  document.getElementById("summaryTotal").textContent = formatMoney(expenseEntries.reduce((sum, e) => sum + e.amount, 0));
  document.getElementById("summaryIncomeLabel").textContent = `Income — ${label}`;
  document.getElementById("summaryIncome").textContent = formatMoney(incomeEntries.reduce((sum, e) => sum + e.amount, 0));

  renderBreakdownInto("summaryBreakdown", expenseEntries, CATEGORIES);
  renderBreakdownInto("summaryIncomeBreakdown", incomeEntries, INCOME_CATEGORIES);
  renderSummaryChart("summaryChart", expenseEntries, CATEGORIES, "expense");
  renderSummaryChart("summaryIncomeChart", incomeEntries, INCOME_CATEGORIES, "income");
}

let summaryChartInstance = null;
let summaryIncomeChartInstance = null;

function renderSummaryChart(canvasId, entries, categories, kind){
  const totals = {};
  entries.forEach(e => {
    totals[e.categoryId] = (totals[e.categoryId] || 0) + e.amount;
  });

  const labels = [];
  const data = [];
  const colors = [];
  const palette = ["#ffc93c", "#ff5c5c", "#5cd6ff", "#7c5cff", "#5cff8f", "#ff8f5c", "#c95cff", "#5cffea"];

  categories.forEach((c, i) => {
    if (totals[c.id] > 0){
      labels.push(c.name);
      data.push(totals[c.id]);
      colors.push(palette[i % palette.length]);
    }
  });

  const ctx = document.getElementById(canvasId).getContext("2d");
  const existing = kind === "income" ? summaryIncomeChartInstance : summaryChartInstance;
  if (existing) existing.destroy();

  if (data.length === 0){
    if (kind === "income") summaryIncomeChartInstance = null; else summaryChartInstance = null;
    return; // nothing to chart
  }

  const chart = new Chart(ctx, {
    type: "doughnut",
    data: {
      labels,
      datasets: [{ data, backgroundColor: colors, borderWidth: 0 }]
    },
    options: {
      plugins: {
        legend: { position: "bottom", labels: { color: "#fff", boxWidth: 12, font: { size: 11 } } }
      }
    }
  });

  if (kind === "income") summaryIncomeChartInstance = chart; else summaryChartInstance = chart;
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
    if (name === "summary") renderSummaryScreen();
    if (name === "budgets") renderBudgetsScreen();
    if (name === "recurring") renderRecurringScreen();
  }

  if (name === "add" && !editingExpenseId) resetAddForm();
  if (name === "categories") renderCategories();
}

async function enterApp(){
  budgets = await loadBudgetsForUser(currentUser.username);
  populateCategoryFilter();
  document.getElementById("chipWeek").classList.add("active");
  renderDashboard();
  renderCategoryGrid();
  renderCategories();
  document.getElementById("dateInput").value = new Date().toISOString().slice(0,10);
  showScreen("dashboard");
}

async function init(){
  loadTheme();
  const savedUsername = localStorage.getItem(SESSION_KEY);
  if (savedUsername){
    try {
      currentUser = await getUser(savedUsername);
      expenses = await loadExpensesForUser(savedUsername);
      enterApp();
      const params = new URLSearchParams(window.location.search);
      const action = params.get("action");
      if (action === "add") showScreen("add");
      if (action === "summary") showScreen("summary");
    } catch (err) {
      localStorage.removeItem(SESSION_KEY);
      showScreen("login");
    }
  } else {
    showScreen("login");
  }
  document.getElementById("loadingOverlay").classList.add("hidden");
}

function toggleTheme(){
  const isLight = document.body.classList.toggle("light-theme");
  localStorage.setItem("sika-theme", isLight ? "light" : "dark");
  document.getElementById("themeToggleBtn").textContent = isLight ? "☀️" : "🌙";
}

function loadTheme(){
  const saved = localStorage.getItem("sika-theme");
  if (saved === "light"){
    document.body.classList.add("light-theme");
    document.getElementById("themeToggleBtn").textContent = "☀️";
  }
}
init();