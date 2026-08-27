const SUPER_ADMIN_DOC_ID = "nharnhaba";
function getCurrentUser() {
  try { return JSON.parse(localStorage.getItem("sika_currentUser") || "null"); } catch(e) { return null; }
}
function isSuperAdmin() {
  const u = getCurrentUser();
  if (!u) return false;
  return u.id === SUPER_ADMIN_DOC_ID || u.docId === SUPER_ADMIN_DOC_ID || u.username?.toLowerCase() === SUPER_ADMIN_DOC_ID || u.isAdmin === true;
}

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
let debts = [];
let debtViewMode = "lent";

// Dashboard state
let dateFilterValue = null;
let quickFilter = "today";
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
  document.getElementById("updateBtn").onclick = applyUpdate;

  // Show native system notification if supported and allowed
  if ("Notification" in window && Notification.permission === "granted" && localStorage.getItem("sika-notifications-enabled") !== "false") {
    const title = "Sika Update Ready";
    const options = {
      body: "A new version of Sika is ready. Tap to update now!",
      icon: "icon-192.png",
      tag: "sika-update-notify", // prevent duplicates
      requireInteraction: true
    };

    if (navigator.serviceWorker && navigator.serviceWorker.ready) {
      navigator.serviceWorker.ready.then(swReg => {
        swReg.showNotification(title, options);
      }).catch(err => {
        console.warn("Service worker notification failed, trying standard Notification:", err);
        const notification = new Notification(title, options);
        notification.onclick = function() {
          window.focus();
          applyUpdate();
          notification.close();
        };
      });
    } else {
      const notification = new Notification(title, options);
      notification.onclick = function() {
        window.focus();
        applyUpdate();
        notification.close();
      };
    }
  }
}

async function autoUpdateApp(reg) {
  // Prevent auto-refresh if the user is currently typing/editing an expense
  const isEditing = document.getElementById("screen-add")?.classList.contains("active");
  if (isEditing) {
    console.log("Update deferred: User is currently adding/editing an expense.");
    return;
  }

  if (reg && reg.waiting) {
    reg.waiting.postMessage("skipWaiting");
  } else {
    // Clear cache and service worker to guarantee reload gets new code
    if ('serviceWorker' in navigator) {
      try {
        const regs = await navigator.serviceWorker.getRegistrations();
        for (const r of regs) {
          await r.unregister();
        }
        const keys = await caches.keys();
        for (const key of keys) {
          await caches.delete(key);
        }
      } catch (err) {
        console.warn("Failed to unregister Service Worker or clear cache during auto-update:", err);
      }
    }
    window.location.reload();
  }
}

// Keep applyUpdate as an alias for backwards compatibility (e.g. notifications clicks)
const applyUpdate = autoUpdateApp;

async function checkForNewCode(){
  try {
    const res = await fetch("./index.html?_cb=" + Date.now());
    if (!res.ok) return;
    const html = await res.text();
    const match = html.match(/<meta\s+name=["']app-version["']\s+content=["']([^"']+)["']/i);
    if (match && match[1]) {
      const serverVersion = match[1];
      const localMeta = document.querySelector('meta[name="app-version"]');
      const localVersion = localMeta ? localMeta.getAttribute("content") : null;
      if (localVersion && serverVersion !== localVersion) {
        if (navigator.serviceWorker && navigator.serviceWorker.ready) {
          const reg = await navigator.serviceWorker.ready;
          reg.update();
          autoUpdateApp(reg);
        } else {
          autoUpdateApp(null);
        }
      }
    }
  } catch (e) {
    console.warn("Failed to check for new code version:", e);
  }
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
    const data = doc.data() || {};
    return { ...data, storedUsername: data.username, username: doc.id };
  }catch(err){console.error(err);throw err;}
}

function householdIdOf(user){
  return user?.householdId || user?.username;
}

async function createUser(user){
  await db.collection("users").doc(user.username).set(user);
  return true;
}

async function updateUserInDB(user){
  const { storedUsername, ...rest } = user;
  await db.collection("users").doc(user.username).set(rest);
  return true;
}

async function deleteDocsInBatches(docs){
  const chunkSize = 450;
  for (let i = 0; i < docs.length; i += chunkSize){
    const batch = db.batch();
    docs.slice(i, i + chunkSize).forEach(d => batch.delete(d.ref));
    await batch.commit();
  }
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
      const { storedUsername, ...userPayload } = updatedUser;
      await db.collection("users").doc(newUsername).set(userPayload);

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
async function loadExpensesForAccount(username, householdId){
  const byId = new Map();
  const addAll = (list) => {
    list.forEach(item => {
      if (item && item.id != null) byId.set(String(item.id), item);
    });
  };
  addAll(await loadExpensesForUser(username));
  if (householdId) addAll(await loadExpensesForHousehold(householdId));
  return Array.from(byId.values());
}
function recurringFromDoc(doc){
  const data = doc.data() || {};
  return { ...data, id: data.id ?? doc.id };
}

async function loadRecurringForUser(username, householdId){
  const names = [...new Set(
    [username, currentUser?.username, currentUser?.storedUsername]
      .filter(Boolean)
      .map(n => String(n))
  )];
  const byId = new Map();
  const tryQuery = async (query) => {
    try {
      const snapshot = await query;
      snapshot.docs.forEach(doc => {
        const item = recurringFromDoc(doc);
        byId.set(String(item.id), item);
      });
    } catch (err) {
      console.error("Failed to load recurring templates:", err);
    }
  };
  for (const name of names){
    await tryQuery(db.collection("recurring").where("username", "==", name).get());
  }
  if (householdId) await tryQuery(db.collection("recurring").where("householdId", "==", householdId).get());
  return Array.from(byId.values());
}

async function loadDebtsForAccount(username, householdId){
  const byId = new Map();
  const tryQuery = async (query) => {
    try {
      const snapshot = await query;
      snapshot.docs.forEach(doc => {
        const item = { ...doc.data(), id: doc.data().id ?? doc.id };
        byId.set(String(item.id), item);
      });
    } catch (err) {
      console.error("Failed to load debts:", err);
    }
  };
  await tryQuery(db.collection("debts").where("username", "==", username).get());
  if (householdId) {
    await tryQuery(db.collection("debts").where("householdId", "==", householdId).get());
  }
  return Array.from(byId.values());
}

function handleWriteError(err, contextMessage) {
  console.error(contextMessage, err);
  if (err && err.code === "permission-denied") {
    alert("Permission denied. You do not have permissions to perform this operation.");
  } else {
    console.warn("Write queued locally: Will synchronize once internet connection is restored.");
  }
}

async function addDebtToDB(debt){
  try {
    await db.collection("debts").doc(String(debt.id)).set(debt);
  } catch (err) {
    handleWriteError(err, "Failed to save debt");
  }
}

async function deleteDebtFromDB(id){
  try {
    await db.collection("debts").doc(String(id)).delete();
  } catch (err) {
    handleWriteError(err, "Failed to delete debt");
  }
}

async function addExpenseToDB(expense){
  try {
    await db.collection("expenses").doc(String(expense.id)).set(expense);
  } catch (err) {
    handleWriteError(err, "Failed to save expense");
  }
}
async function addRecurringToDB(template){
  try {
    await db.collection("recurring").doc(String(template.id)).set(template);
  } catch (err) {
    handleWriteError(err, "Failed to save recurring template");
  }
}

async function updateRecurringInDB(template){
  try {
    await db.collection("recurring").doc(String(template.id)).set(template);
  } catch (err) {
    handleWriteError(err, "Failed to update recurring template");
  }
}

async function deleteRecurringFromDB(id){
  try {
    await db.collection("recurring").doc(String(id)).delete();
  } catch (err) {
    handleWriteError(err, "Failed to delete recurring template");
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
    handleWriteError(err, "Failed to save recurring templates");
  }
}

async function updateExpenseInDB(expense){
  try {
    await db.collection("expenses").doc(String(expense.id)).set(expense);
  } catch (err) {
    handleWriteError(err, "Failed to update expense");
  }
}

async function deleteExpenseFromDB(id){
  try {
    await db.collection("expenses").doc(String(id)).delete();
  } catch (err) {
    handleWriteError(err, "Failed to delete expense");
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
    handleWriteError(err, "Failed to save budgets");
  }
}

async function promptSetDailyBudget(event) {
  if (event) event.stopPropagation(); // prevent card click triggers
  const current = budgets._dailyLimit || 0;
  showPrompt("Enter your desired daily spending limit (₵):", current > 0 ? current : "", async (val) => {
    if (val === null) return; // user cancelled
    const parsed = parseFloat(val);
    if (val.trim() === "" || isNaN(parsed) || parsed <= 0) {
      // Clear custom daily budget
      delete budgets._dailyLimit;
      showBudgetToast("Custom daily budget cleared.", "warn");
    } else {
      budgets._dailyLimit = parsed;
      showBudgetToast(`Custom daily budget set to ₵${parsed.toFixed(2)}.`, "ok");
    }
    
    saveBudgetsForUser(currentUser.username, budgets);
    renderDashboard();
  });
}
function formatMoney(n){
  const value = Number(n);
  const safe = Number.isFinite(value) ? value : 0;
  return "₵" + safe.toLocaleString("en-GH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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
function parseLocalDate(dateStr) {
  if (!dateStr) return new Date();
  if (dateStr instanceof Date) return dateStr;
  const parts = String(dateStr).split("-");
  if (parts.length < 3) return new Date(dateStr);
  return new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
}
function isThisMonth(dateStr){
  const d = parseLocalDate(dateStr), now = new Date();
  return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
}

function isLastMonth(dateStr){
  const { start, end } = getLastMonthRange();
  const d = parseLocalDate(dateStr);
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

function isToday(dateStr) {
  const d = parseLocalDate(dateStr), now = new Date();
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
}

function isYesterday(dateStr) {
  const d = parseLocalDate(dateStr), now = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  return d.getFullYear() === yesterday.getFullYear() && d.getMonth() === yesterday.getMonth() && d.getDate() === yesterday.getDate();
}

function isThisWeek(dateStr){
  const d = parseLocalDate(dateStr);
  const start = getWeekStart(new Date(), 0);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  end.setHours(23, 59, 59, 999);
  return d >= start && d <= end;
}

function isLastWeek(dateStr){
  const d = parseLocalDate(dateStr);
  const start = getWeekStart(new Date(), -1);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  end.setHours(23, 59, 59, 999);
  return d >= start && d <= end;
}
function formatDateLabel(dateStr){
  const d = parseLocalDate(dateStr), now = new Date();

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
    if (!user) throw new Error("Incorrect username or password.");

    const hash = await hashPassword(password);
    if (hash !== user.passwordHash) throw new Error("Incorrect username or password.");

        currentUser = user;
    if (!currentUser.displayUsername){
      currentUser.displayUsername = username;
      await db.collection("users").doc(username).update({ displayUsername: username });
    }
    const householdId = householdIdOf(currentUser);
    expenses = await loadExpensesForAccount(currentUser.username, householdId);
    recurringTemplates = await loadRecurringForUser(currentUser.username, householdId);
    await processRecurringEntries();
    localStorage.setItem(SESSION_KEY, username);
    const userToSave = { id: username, docId: username, username: currentUser.username, displayUsername: currentUser.displayUsername, name: currentUser.name, isAdmin: currentUser.isAdmin === true || username === 'nharnhaba', usernameLower: username.toLowerCase() };
    localStorage.setItem("sika_currentUser", JSON.stringify(userToSave));
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
    recurringTemplates = [];
    localStorage.setItem(SESSION_KEY, username);
    const userToSave = { id: username, docId: username, username, displayUsername, name, isAdmin: username === 'nharnhaba', usernameLower: username.toLowerCase() };
    localStorage.setItem("sika_currentUser", JSON.stringify(userToSave));
    enterApp();
  } catch (err) {
    console.error(err); errorEl.textContent = err.message || "Couldn't create your account. Try again.";
    btn.disabled = false;
    btn.textContent = "Create account";
  }
}

function logoutUser(){
  localStorage.removeItem(SESSION_KEY);
  localStorage.removeItem("sika_currentUser");
  currentUser = null;
  expenses = [];
  recurringTemplates = [];
  debts = [];
  budgets = {};
  if (typeof notifListener === "function") {
    notifListener();
    notifListener = null;
  }
  const bellWrap = document.getElementById("notificationBellWrap");
  if (bellWrap) bellWrap.style.display = "none";
  const panel = document.getElementById("adminBroadcastPanel");
  if (panel) panel.style.display = "none";
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

let promptCallback = null;

function showPrompt(message, defaultValue, onConfirm){
  document.getElementById("promptMessage").textContent = message;
  const inputEl = document.getElementById("promptInputVal");
  inputEl.value = defaultValue;
  promptCallback = onConfirm;
  document.getElementById("promptModal").classList.remove("hidden");
  setTimeout(() => inputEl.focus(), 100);
}

function hidePrompt(){
  document.getElementById("promptModal").classList.add("hidden");
  promptCallback = null;
}

document.getElementById("promptCancelBtn").addEventListener("click", hidePrompt);
document.getElementById("promptConfirmBtn").addEventListener("click", () => {
  const cb = promptCallback;
  const val = document.getElementById("promptInputVal").value;
  hidePrompt();
  if (cb) cb(val);
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
  document.getElementById("profileDeletePassword").value = "";
  document.getElementById("profileError").textContent = "";
  document.getElementById("profileSuccess").textContent = "";
  document.getElementById("profileDeleteError").textContent = "";
  updateNotificationButtonUI();
}

function updateNotificationButtonUI() {
  const enableBtn = document.getElementById("notifyBtnEnable");
  const disableBtn = document.getElementById("notifyBtnDisable");
  if (!enableBtn || !disableBtn) return;
  
  if (!("Notification" in window)) {
    enableBtn.textContent = "Unsupported";
    enableBtn.classList.add("disabled");
    disableBtn.classList.add("disabled");
    return;
  }
  
  const userPref = localStorage.getItem("sika-notifications-enabled") !== "false";
  const hasPermission = Notification.permission === "granted";
  
  enableBtn.classList.remove("active");
  disableBtn.classList.remove("active");
  
  if (hasPermission && userPref) {
    enableBtn.textContent = "Enabled ✓";
    enableBtn.classList.add("active");
    disableBtn.textContent = "Disable";
  } else {
    enableBtn.textContent = "Enable";
    disableBtn.textContent = "Disabled ✓";
    disableBtn.classList.add("active");
  }
}

async function setNotificationsEnabled(enabled) {
  if (!("Notification" in window)) {
    alert("System notifications are not supported by this browser.");
    return;
  }
  
  if (enabled) {
    if (Notification.permission !== "granted") {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        alert("Permission denied. Sika cannot send notifications without browser permission.");
        updateNotificationButtonUI();
        return;
      }
    }
    localStorage.setItem("sika-notifications-enabled", "true");
    showBudgetToast("System notifications enabled successfully!", "ok");
    
    // Send a test notification to verify it works
    if (Notification.permission === "granted") {
      const title = "Notifications Enabled";
      const options = {
        body: "You will now receive system notifications from Sika.",
        icon: "icon-192.png",
        tag: "sika-notif-setup"
      };
      if (navigator.serviceWorker && navigator.serviceWorker.ready) {
        navigator.serviceWorker.ready.then(reg => reg.showNotification(title, options));
      } else {
        new Notification(title, options);
      }
    }
  } else {
    localStorage.setItem("sika-notifications-enabled", "false");
    showBudgetToast("System notifications disabled.", "ok");
  }
  
  updateNotificationButtonUI();
}

async function confirmDeleteAccount(){
  const password = document.getElementById("profileDeletePassword").value;
  const errorEl = document.getElementById("profileDeleteError");
  errorEl.textContent = "";

  if (!currentUser){
    errorEl.textContent = "You're not logged in.";
    return;
  }
  if (!password){
    errorEl.textContent = "Enter your password to delete your account.";
    return;
  }

  const hash = await hashPassword(password);
  if (hash !== currentUser.passwordHash){
    errorEl.textContent = "Password is incorrect.";
    return;
  }

  showConfirm("Delete your account forever? Your expenses, budgets, and repeating entries will be removed. This cannot be undone.", () => {
    deleteCurrentAccount();
  });
}

async function deleteCurrentAccount(){
  const errorEl = document.getElementById("profileDeleteError");
  const btn = document.getElementById("profileDeleteBtn");
  const username = currentUser?.username;
  if (!username) return;

  errorEl.textContent = "";
  btn.disabled = true;
  btn.textContent = "Deleting…";

  try {
    const [expSnap, recSnap] = await Promise.all([
      db.collection("expenses").where("username", "==", username).get(),
      db.collection("recurring").where("username", "==", username).get()
    ]);
    await deleteDocsInBatches(expSnap.docs);
    await deleteDocsInBatches(recSnap.docs);
    await db.collection("budgets").doc(username).delete();
    await db.collection("users").doc(username).delete();
    logoutUser();
  } catch (err) {
    console.error("Account delete failed:", err);
    errorEl.textContent = "Couldn't delete your account. Check your connection and try again.";
    btn.disabled = false;
    btn.textContent = "Delete account";
  }
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
function toISODate(d){
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const da = String(d.getDate()).padStart(2, "0");
  return `${y}-${mo}-${da}`;
}

function normalizeDateStr(value){
  if (!value) return toISODate(new Date());
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
  if (value.toDate) return toISODate(value.toDate());
  if (typeof value.seconds === "number") return toISODate(new Date(value.seconds * 1000));
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? toISODate(new Date()) : toISODate(d);
}

async function processRecurringEntries(){
  const today = toISODate(new Date());
  const householdId = householdIdOf(currentUser);

  for (const template of recurringTemplates){
    if (!template.nextDate) template.nextDate = today;
    template.nextDate = normalizeDateStr(template.nextDate);
    if (!template.householdId && householdId) template.householdId = householdId;
    if (!template.username && currentUser?.username) template.username = currentUser.username;

    let guard = 0;
    while (template.nextDate <= today && guard < 36){
      const newExpense = {
        id: Date.now() + Math.floor(Math.random() * 1000),
        username: template.username || currentUser?.username,
        householdId: template.householdId || householdId,
        amount: template.amount,
        amountGHS: template.amountGHS ?? template.amount,
        currency: template.currency || "GHS",
        rate: template.rate ?? 1,
        categoryId: template.categoryId,
        method: template.method,
        note: template.note || "",
        date: template.nextDate,
        type: template.type || "expense",
        isRecurring: true,
        frequency: template.frequency,
        recurringId: template.id,
      };
      expenses.push(newExpense);
      await addExpenseToDB(newExpense);

      template.nextDate = getNextOccurrence(template.nextDate, template.frequency);
      guard++;
    }
  }
  if (recurringTemplates.length) await saveRecurringTemplatesToDB(recurringTemplates);
}
function renderDashboard(){
  document.getElementById("dashGreeting").textContent = currentUser ? `Hi, ${currentUser.displayUsername || currentUser.username}` : "Sika";
  document.getElementById("profileAvatar").textContent = usernameInitials(currentUser?.username);

  const monthEntries = expenses.filter(e => isThisMonth(e.date));
  const weekEntries = expenses.filter(e => isThisWeek(e.date));

  // Category budgets alerts/nudges
  const budgetAlertsEl = document.getElementById("dashboardBudgetAlerts");
  if (budgetAlertsEl) {
    const alerts = [];
    const spentByCategory = {};
    CATEGORIES.forEach(c => spentByCategory[c.id] = 0);
    const monthExpenses = monthEntries.filter(e => (e.type || "expense") === "expense");
    monthExpenses.forEach(e => {
      spentByCategory[e.categoryId] = (spentByCategory[e.categoryId] || 0) + e.amount;
    });

    CATEGORIES.forEach(c => {
      const limit = budgets[c.id] || 0;
      const spent = spentByCategory[c.id] || 0;
      if (limit > 0) {
        const pct = Math.round((spent / limit) * 100);
        if (spent > limit) {
          alerts.push(`<div class="budget-nudge over" style="background: rgba(239, 68, 68, 0.15); color: var(--coral); padding: 10px 14px; border-radius: var(--radius-md); font-size: 13px; font-weight: 500; margin-bottom: 8px; border-left: 4px solid var(--coral);">🚨 <strong>${c.name}</strong> is over budget: ${formatMoney(spent)} of ${formatMoney(limit)}!</div>`);
        } else if (pct >= 80) {
          alerts.push(`<div class="budget-nudge warn" style="background: rgba(245, 158, 11, 0.15); color: var(--gold); padding: 10px 14px; border-radius: var(--radius-md); font-size: 13px; font-weight: 500; margin-bottom: 8px; border-left: 4px solid var(--gold);">⚠️ <strong>${c.name}</strong> budget is at ${pct}%: ${formatMoney(spent)} of ${formatMoney(limit)}</div>`);
        }
      }
    });

    if (alerts.length > 0) {
      budgetAlertsEl.innerHTML = alerts.join("");
      budgetAlertsEl.classList.remove("hidden");
    } else {
      budgetAlertsEl.classList.add("hidden");
    }
  }

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

  // Calculate Daily Budget Ring
  const customDailyLimit = parseFloat(budgets._dailyLimit || 0);
  let dailyLimit = 0;
  
  if (customDailyLimit > 0) {
    dailyLimit = customDailyLimit;
  } else {
    // Exclude special keys like _dailyLimit from monthly sum
    const totalMonthlyBudget = Object.keys(budgets)
      .filter(k => k !== "_dailyLimit")
      .reduce((sum, k) => sum + parseFloat(budgets[k] || 0), 0);
    const todayDate = new Date();
    const totalDaysInMonth = new Date(todayDate.getFullYear(), todayDate.getMonth() + 1, 0).getDate();
    const remainingDays = totalDaysInMonth - todayDate.getDate() + 1;
    
    // Monthly expenses before today
    const monthExpensesBeforeToday = expenses.filter(e => {
      if (!isThisMonth(e.date) || (e.type || "expense") !== "expense") return false;
      const expDate = new Date(e.date);
      return expDate.getDate() < todayDate.getDate();
    }).reduce((sum, e) => sum + e.amount, 0);

    const remainingBudget = Math.max(0, totalMonthlyBudget - monthExpensesBeforeToday);
    dailyLimit = remainingDays > 0 && totalMonthlyBudget > 0 ? (remainingBudget / remainingDays) : 0;
  }

  const spentToday = expenses.filter(e => {
    return isToday(e.date) && (e.type || "expense") === "expense";
  }).reduce((sum, e) => sum + e.amount, 0);

  const leftToday = Math.max(0, dailyLimit - spentToday);

  const dailyLimitAmountEl = document.getElementById("dailyLimitAmount");
  const dailyLimitSpentEl = document.getElementById("dailyLimitSpent");
  const dailyBudgetProgressCircle = document.getElementById("dailyBudgetProgressCircle");
  const dailyBudgetPercentageText = document.getElementById("dailyBudgetPercentageText");

  const hasBudgetSet = (customDailyLimit > 0) || Object.keys(budgets).some(k => k !== "_dailyLimit" && parseFloat(budgets[k] || 0) > 0);

  if (hasBudgetSet) {
    dailyLimitAmountEl.textContent = `${formatMoney(leftToday)} left today`;
    dailyLimitSpentEl.textContent = `Spent today: ${formatMoney(spentToday)} of ${formatMoney(dailyLimit)}`;
    const pct = dailyLimit > 0 ? Math.min(100, Math.round((spentToday / dailyLimit) * 100)) : (spentToday > 0 ? 100 : 0);
    dailyBudgetPercentageText.textContent = `${pct}%`;
    const offset = 157 - (pct / 100) * 157;
    dailyBudgetProgressCircle.style.strokeDashoffset = offset;
    if (pct >= 100) {
      dailyBudgetProgressCircle.setAttribute("stroke", "var(--coral)");
    } else if (pct >= 80) {
      dailyBudgetProgressCircle.setAttribute("stroke", "var(--gold)");
    } else {
      dailyBudgetProgressCircle.setAttribute("stroke", "var(--green)");
    }
  } else {
    dailyLimitAmountEl.textContent = "No budget set";
    dailyLimitSpentEl.textContent = "Set budget inside Set button or category budgets";
    dailyBudgetPercentageText.textContent = "0%";
    dailyBudgetProgressCircle.style.strokeDashoffset = 157;
    dailyBudgetProgressCircle.setAttribute("stroke", "var(--border)");
  }

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
  } else if (quickFilter === "today"){
    listSource = listSource.filter(e => isToday(e.date));
  } else if (quickFilter === "yesterday"){
    listSource = listSource.filter(e => isYesterday(e.date));
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
    const badgeClass = e.method === "momo" ? "badge-momo" : (e.method === "bank" ? "badge-bank" : "badge-cash");
    const badgeLabel = e.method === "momo" ? "Mobile money" : (e.method === "bank" ? "Bank" : "Cash");
    const sign = type === "income" ? "+" : "−";
    const amountClass = type === "income" ? "ticket-amount income" : "ticket-amount expense";
    return `
      <div class="ticket">
        <div class="ticket-icon">${cat.emoji}</div>
        <div class="ticket-body">
          <div class="ticket-cat">${cat.name}</div>
          <div class="ticket-note">${e.note || formatDateLabel(e.date)}</div>
        </div>
        <div class="ticket-right">
          <div class="${amountClass}">${sign}${formatMoney(e.amount)}</div>
          <span class="ticket-badge ${badgeClass}">${badgeLabel}</span>
        </div>
        <div class="ticket-actions">
          <button class="ticket-edit" onclick="editExpense(${e.id})">Edit</button>
          <button class="ticket-del" onclick="deleteExpense(${e.id})">Delete</button>
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
  const dateInput = document.getElementById("dateFilter");
  dateInput.value = "";
  dateInput.type = "text";
  document.getElementById("clearFilterBtn").classList.add("hidden");
  document.querySelectorAll(".chip-btn").forEach(b => b.classList.remove("active"));
  renderDashboard();
}

function setQuickFilter(mode){
  quickFilter = mode; // always one selected — no toggle-off
  dateFilterValue = null;
  const dateInput = document.getElementById("dateFilter");
  dateInput.value = "";
  dateInput.type = "text";
  document.getElementById("clearFilterBtn").classList.add("hidden");
  document.querySelectorAll(".chip-btn").forEach(b => b.classList.remove("active"));
  const chipIds = { 
    today: "chipToday", 
    yesterday: "chipYesterday", 
    week: "chipWeek", 
    lastweek: "chipLastWeek", 
    month: "chipMonth", 
    lastmonth: "chipLastMonth" 
  };
  document.getElementById(chipIds[mode]).classList.add("active");
  renderDashboard();
}
function deleteExpense(id){
  showConfirm("Delete this expense?", async () => {
    expenses = expenses.filter(e => e.id !== id);
    deleteExpenseFromDB(id);
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
  document.getElementById("toggleBank").classList.toggle("active", method === "bank");
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
  const cancelBtn = document.getElementById("cancelBtn");
  if (cancelBtn) cancelBtn.classList.add("hidden");
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

  // Set recurring state with fallback discovery for older records
  let isRec = exp.isRecurring || false;
  let freq = exp.frequency || "monthly";
  let recId = exp.recurringId || null;

  if (!isRec) {
    // Attempt to match this expense with a template in recurringTemplates
    const matchedTemplate = recurringTemplates.find(t => 
      String(t.id) === String(exp.id + 1) || 
      (t.categoryId === exp.categoryId && 
       Math.abs(t.amount - exp.amount) < 0.01 && 
       (t.type || "expense") === (exp.type || "expense") &&
       (t.note || "") === (exp.note || ""))
    );
    if (matchedTemplate) {
      isRec = true;
      freq = matchedTemplate.frequency || "monthly";
      recId = matchedTemplate.id;
      // Link them in memory
      exp.isRecurring = true;
      exp.frequency = freq;
      exp.recurringId = recId;
    }
  }

  document.getElementById("recurringCheckbox").checked = isRec;
  const freqEl = document.getElementById("recurringFrequency");
  freqEl.value = freq;
  if (isRec) {
    freqEl.classList.remove("hidden");
  } else {
    freqEl.classList.add("hidden");
  }

  const cancelBtn = document.getElementById("cancelBtn");
  if (cancelBtn) cancelBtn.classList.remove("hidden");

  document.querySelector("#screen-add .page-title").textContent = "Edit entry";
  document.getElementById("saveBtn").textContent = "Save changes";
  showScreen("add");
}

function startNewExpense(){
  editingExpenseId = null;
  showScreen("add");
}

function cancelEditExpense(){
  resetAddForm();
  showScreen("dashboard");
}

let voiceRecognition = null;

async function startVoiceInput() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    alert("Voice recognition is not supported in this browser. Please try Google Chrome.");
    return;
  }
  
  const voiceBtn = document.getElementById("voiceBtn");
  if (voiceRecognition) {
    voiceRecognition.stop();
    return;
  }
  
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach(track => track.stop());
  } catch (err) {
    console.warn("getUserMedia mic permission prompt failed:", err);
    alert("Microphone access denied. If you are in Standalone PWA mode, check your phone's app permissions for Sika, or launch Sika in Safari/Chrome browser directly.");
    return;
  }
  
  try {
    voiceRecognition = new SpeechRecognition();
    voiceRecognition.lang = "en-GH";
    voiceRecognition.interimResults = false;
    voiceRecognition.maxAlternatives = 1;
    
    voiceRecognition.onstart = function() {
      voiceBtn.textContent = "🛑";
      voiceBtn.style.background = "var(--coral)";
      voiceBtn.style.color = "#ffffff";
    };
    
    voiceRecognition.onresult = function(event) {
      const text = event.results[0][0].transcript.toLowerCase();
      console.log("Speech heard:", text);
      
      // Parse Amount
      const amountMatch = text.match(/\b(\d+(?:\.\d+)?)\b/);
      if (amountMatch && amountMatch[1]) {
        document.getElementById("amountInput").value = parseFloat(amountMatch[1]).toFixed(2);
      }
      
      // Parse Category
      const matchedCat = CATEGORIES.find(c => 
        text.includes(c.name.toLowerCase()) || 
        (c.id && text.includes(c.id.toLowerCase())) ||
        (c.emoji && text.includes(c.emoji))
      ) || INCOME_CATEGORIES.find(c => 
        text.includes(c.name.toLowerCase()) || 
        (c.id && text.includes(c.id.toLowerCase()))
      );
      
      if (matchedCat) {
        const isIncome = INCOME_CATEGORIES.some(c => c.id === matchedCat.id);
        setEntryType(isIncome ? "income" : "expense");
        selectCategory(matchedCat.id);
      }

      // Parse Payment Method
      if (text.includes("momo") || text.includes("mobile money")) {
        setPaymentMethod("momo");
      } else if (text.includes("cash")) {
        setPaymentMethod("cash");
      } else if (text.includes("bank") || text.includes("card")) {
        setPaymentMethod("bank");
      }
      
      // Parse Note
      let noteText = text
        .replace(/\b\d+(?:\.\d+)?\b/g, "")
        .replace(/\b(spent|received|income|expense|on|for|cedis|ghs|cedi|wallet|cash|momo|bank)\b/gi, "")
        .replace(/\s+/g, " ")
        .trim();
        
      if (noteText) {
        noteText = noteText.charAt(0).toUpperCase() + noteText.slice(1);
        document.getElementById("noteInput").value = noteText;
      } else {
        document.getElementById("noteInput").value = text;
      }
      
      showBudgetToast(`Heard: "${text}"`, "ok");
    };
    
    voiceRecognition.onerror = function(event) {
      console.error("Speech recognition error:", event.error);
      if (event.error === "not-allowed") {
        alert("Microphone access denied. Note: Standalone PWA mode on some phones blocks voice capture. Try running Sika inside Safari/Chrome browser directly.");
      } else {
        showBudgetToast("Voice input failed. Try again.", "over");
      }
    };
    
    voiceRecognition.onend = function() {
      voiceBtn.textContent = "🎙️";
      voiceBtn.style.background = "var(--surface)";
      voiceBtn.style.color = "var(--text-primary)";
      voiceRecognition = null;
    };
    
    voiceRecognition.start();
  } catch (err) {
    console.error("Failed to start voice recognition:", err);
    voiceBtn.textContent = "🎙️";
    voiceRecognition = null;
  }
}

async function saveExpense(){
  const amount = parseFloat(document.getElementById("amountInput").value);
  const note = document.getElementById("noteInput").value.trim();
  const date = document.getElementById("dateInput").value || new Date().toISOString().slice(0,10);
  const btn = document.getElementById("saveBtn");
  const isRecurring = document.getElementById("recurringCheckbox")?.checked;
  const frequency = document.getElementById("recurringFrequency")?.value;
  const currency = "GHS";
  const rate = 1;
  const householdId = currentUser.householdId || currentUser.username;

  if (!amount || amount <= 0){ alert("Enter an amount."); return; }
  if (!selectedCategoryId){ alert(selectedType === "income" ? "Pick a source." : "Pick a category."); return; }

  const amountGHS = amount;

  const wasEditing = !!editingExpenseId;
  btn.disabled = true;
  btn.textContent = "Saving…";

  if (wasEditing){
    const idx = expenses.findIndex(e => e.id === editingExpenseId);
    const existingExpense = expenses[idx];
    let templateId = existingExpense.recurringId;

    if (isRecurring) {
      let template = null;
      if (templateId) {
        template = recurringTemplates.find(t => String(t.id) === String(templateId));
      }
      if (!templateId) {
        templateId = Date.now() + 1;
      }
      const updatedTemplate = {
        id: templateId,
        username: currentUser.username,
        householdId,
        amount,
        amountGHS,
        currency,
        rate,
        categoryId: selectedCategoryId,
        method: selectedMethod,
        note: note || "",
        type: selectedType,
        frequency,
        nextDate: template ? template.nextDate : getNextOccurrence(date, frequency),
      };

      if (template) {
        const tIdx = recurringTemplates.findIndex(t => String(t.id) === String(templateId));
        if (tIdx > -1) {
          recurringTemplates[tIdx] = updatedTemplate;
        } else {
          recurringTemplates.push(updatedTemplate);
        }
        updateRecurringInDB(updatedTemplate);
      } else {
        recurringTemplates.push(updatedTemplate);
        addRecurringToDB(updatedTemplate);
      }
    } else {
      if (existingExpense.isRecurring && templateId) {
        recurringTemplates = recurringTemplates.filter(t => String(t.id) !== String(templateId));
        deleteRecurringFromDB(templateId);
      }
      templateId = null;
    }

    const updatedExpense = {
      ...existingExpense,
      amount,
      amountGHS,
      currency,
      rate,
      categoryId: selectedCategoryId,
      method: selectedMethod,
      note,
      date,
      type: selectedType,
      isRecurring,
      frequency: isRecurring ? frequency : null,
      recurringId: templateId
    };
    expenses[idx] = updatedExpense;
    updateExpenseInDB(updatedExpense);
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
      isRecurring,
      frequency: isRecurring ? frequency : null,
      recurringId: null
    };

    if (isRecurring){
      const templateId = Date.now() + 1;
      const template = {
        id: templateId,
        username: currentUser.username,
        householdId,
        amount,
        amountGHS,
        currency,
        rate,
        categoryId: selectedCategoryId,
        method: selectedMethod,
        note: note || "",
        type: selectedType,
        frequency,
        nextDate: getNextOccurrence(date, frequency),
      };
      newExpense.recurringId = templateId;
      recurringTemplates.push(template);
      addRecurringToDB(template);
    }
    expenses.push(newExpense);
    addExpenseToDB(newExpense);
    if (selectedType === "expense") checkBudgetAlert(selectedCategoryId);
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
  const parts = normalizeDateStr(fromDateStr).split("-").map(Number);
  const d = new Date(parts[0], parts[1] - 1, parts[2]);
  if (frequency === "daily") d.setDate(d.getDate() + 1);
  else if (frequency === "weekly") d.setDate(d.getDate() + 7);
  else d.setMonth(d.getMonth() + 1);
  return toISODate(d);
}
function renderCategories(){
  const monthEntries = expenses.filter(e => isThisMonth(e.date));
  renderBreakdownInto("categoryBreakdown", monthEntries.filter(e => (e.type || "expense") === "expense"), CATEGORIES);
  renderBreakdownInto("incomeBreakdown", monthEntries.filter(e => e.type === "income"), INCOME_CATEGORIES);
}

function renderRecurringScreen(){
  const container = document.getElementById("recurringList");
  if (!container) return;
  const templates = Array.isArray(recurringTemplates) ? recurringTemplates : [];
  if (!templates.length){
    container.innerHTML = `<p class="page-sub">No recurring entries yet. Turn on "Make this recurring" when adding an entry to create one.</p>`;
    return;
  }
  try {
    container.innerHTML = templates.map(t => {
      const cat = getCategoryAny(t.categoryId, t.type || "expense");
      const freqLabel = t.frequency === "daily" ? "Daily" : (t.frequency === "weekly" ? "Weekly" : "Monthly");
      const next = normalizeDateStr(t.nextDate);
      const note = t.note ? " · " + String(t.note).replace(/</g, "&lt;") : "";
      const idAttr = String(t.id).replace(/'/g, "");
      return `
      <div class="budget-card">
        <div class="budget-card-top">
          <span class="budget-card-emoji">${cat.emoji || "🔁"}</span>
          <span class="budget-card-name">${cat.name || "Uncategorized"}</span>
          <button class="secondary-btn" style="padding:6px 12px" onclick="deleteRecurringTemplate('${idAttr}')">Delete</button>
        </div>
        <div class="budget-status">${freqLabel} · ${formatMoney(t.amount)}${note} · next on ${next}</div>
      </div>
    `;
    }).join("");
  } catch (err) {
    console.error("Failed to render recurring screen:", err);
    container.innerHTML = `<p class="page-sub">Couldn't show recurring entries. Pull to refresh and try again.</p>`;
  }
}

function deleteRecurringTemplate(id){
  showConfirm("Stop this recurring entry? Past entries it already created will stay.", async () => {
    recurringTemplates = recurringTemplates.filter(t => String(t.id) !== String(id));
    deleteRecurringFromDB(id);
    renderRecurringScreen();
  });
}

function setDebtViewMode(mode){
  debtViewMode = mode;
  renderDebtsScreen();
}

function renderDebtsScreen(){
  const listContainer = document.getElementById("debtsList");
  if (!listContainer) return;
  
  document.getElementById("debtViewLent").classList.toggle("active", debtViewMode === "lent");
  document.getElementById("debtViewBorrowed").classList.toggle("active", debtViewMode === "borrowed");

  const currentDebts = Array.isArray(debts) ? debts : [];
  
  const lentTotal = currentDebts.filter(d => d.type === "lent").reduce((sum, d) => sum + parseFloat(d.amount || 0), 0);
  const borrowedTotal = currentDebts.filter(d => d.type === "borrowed").reduce((sum, d) => sum + parseFloat(d.amount || 0), 0);
  
  document.getElementById("lentTotal").textContent = formatMoney(lentTotal);
  document.getElementById("borrowedTotal").textContent = formatMoney(borrowedTotal);
  
  const filteredDebts = currentDebts.filter(d => d.type === debtViewMode);
  
  if (!filteredDebts.length){
    listContainer.innerHTML = `<p class="page-sub">No active ${debtViewMode} entries found.</p>`;
    return;
  }
  
  listContainer.innerHTML = filteredDebts.map(d => {
    const isLent = d.type === "lent";
    const amtColor = isLent ? "var(--green)" : "var(--coral)";
    const typeLabel = isLent ? "You Lent" : "You Borrowed";
    const emoji = isLent ? "📤" : "📥";
    const idAttr = String(d.id).replace(/'/g, "");
    
    return `
      <div class="budget-card">
        <div class="budget-card-top">
          <span class="budget-card-emoji">${emoji}</span>
          <span class="budget-card-name" style="font-weight: 600;">${d.name}</span>
          <button class="secondary-btn" style="padding:6px 12px; width: auto;" onclick="settleDebt('${idAttr}')">Settle</button>
        </div>
        <div class="budget-status">
          <span style="color: ${amtColor}; font-weight: 600;">${typeLabel} ${formatMoney(d.amount)}</span>
          ${d.note ? ` · ${String(d.note).replace(/</g, "&lt;")}` : ""}
          <span style="float: right; font-size: 11px; opacity: 0.7;">${d.date}</span>
        </div>
      </div>
    `;
  }).join("");
}

async function addNewDebt(){
  const nameEl = document.getElementById("debtName");
  const amountEl = document.getElementById("debtAmount");
  const typeEl = document.getElementById("debtType");
  const noteEl = document.getElementById("debtNote");
  
  const name = nameEl.value.trim();
  const amount = parseFloat(amountEl.value);
  const type = typeEl.value;
  const note = noteEl.value.trim();
  
  if (!name) { alert("Please enter the person's name."); return; }
  if (!amount || amount <= 0) { alert("Please enter a valid amount."); return; }
  
  const newDebt = {
    id: Date.now(),
    username: currentUser.username,
    householdId: householdIdOf(currentUser),
    name,
    amount,
    type,
    note,
    date: toISODate(new Date())
  };
  
  debts.push(newDebt);
  addDebtToDB(newDebt);
  
  nameEl.value = "";
  amountEl.value = "";
  noteEl.value = "";
  
  debtViewMode = type;
  renderDebtsScreen();
}

function settleDebt(id){
  showConfirm("Mark this debt as settled?", async () => {
    debts = debts.filter(d => String(d.id) !== String(id));
    deleteDebtFromDB(id);
    renderDebtsScreen();
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
  saveBudgetsForUser(currentUser.username, budgets);
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
        legend: { position: "bottom", labels: { color: getComputedStyle(document.body).getPropertyValue("--text-primary").trim(), boxWidth: 12, font: { size: 11 } } }
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
    if (name === "dashboard" || name === "categories") {
      fab.classList.remove("hidden");
    } else {
      fab.classList.add("hidden");
    }
    document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
    const tabBtn = document.querySelector(`.tab-btn[data-tab="${name}"]`);
    if (tabBtn) tabBtn.classList.add("active");
    if (name === "profile") renderProfileScreen();
    if (name === "register") resetRegisterForm();
    if (name === "summary") renderSummaryScreen();
    if (name === "budgets") renderBudgetsScreen();
    if (name === "recurring") renderRecurringScreen();
    if (name === "debts") renderDebtsScreen();
  }

  if (name === "add" && !editingExpenseId) resetAddForm();
  if (name === "categories") renderCategories();
}

async function enterApp(){
  budgets = await loadBudgetsForUser(currentUser.username);
  const householdId = householdIdOf(currentUser);
  debts = await loadDebtsForAccount(currentUser.username, householdId);
  populateCategoryFilter();
  document.getElementById("chipToday").classList.add("active");
  renderDashboard();
  renderCategoryGrid();
  renderCategories();
  document.getElementById("dateInput").value = new Date().toISOString().slice(0,10);
  
  const chipsEl = document.querySelector(".filter-chips");
  const indicatorEl = document.querySelector(".scroll-indicator");
  if (chipsEl && indicatorEl) {
    const updateIndicator = () => {
      const isScrollable = chipsEl.scrollWidth > chipsEl.clientWidth;
      const isEnd = chipsEl.scrollWidth - chipsEl.scrollLeft <= chipsEl.clientWidth + 5;
      if (isScrollable && !isEnd) {
        indicatorEl.classList.remove("hidden");
      } else {
        indicatorEl.classList.add("hidden");
      }
    };
    chipsEl.addEventListener("scroll", updateIndicator);
    window.addEventListener("resize", updateIndicator);
    indicatorEl.onclick = () => {
      chipsEl.scrollBy({ left: 120, behavior: "smooth" });
    };
    // Check after rendering/loading finishes
    setTimeout(updateIndicator, 200);
  }
  
  const bellWrap = document.getElementById("notificationBellWrap");
  if (bellWrap) bellWrap.style.display = "block";
  initAdminPanel();
  initNotificationsForAllUsers();

  showScreen("dashboard");
}

function initAdminPanel() {
  const panel = document.getElementById("adminBroadcastPanel");
  if (!panel) return;
  panel.style.display = isSuperAdmin() ? "block" : "none";
}

async function handleSendBroadcast() {
  if (!isSuperAdmin()) { alert("Only Nharnhaba can send"); return; }
  const title = document.getElementById("broadcastTitle").value.trim();
  const message = document.getElementById("broadcastMessage").value.trim();
  const type = document.getElementById("broadcastType").value;
  if (!title || !message) { alert("Fill title and message"); return; }
  const btn = document.getElementById("sendBroadcastBtn");
  btn.textContent = "Sending..."; btn.disabled = true;
  try {
    await db.collection("notifications").add({
      title,
      message,
      type,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      createdByDocId: SUPER_ADMIN_DOC_ID,
      createdByName: getCurrentUser()?.name || "Admin"
    });
    const statusEl = document.getElementById("broadcastStatus");
    statusEl.style.display = "block";
    statusEl.textContent = "Broadcast sent to all users!";
    document.getElementById("broadcastTitle").value = ""; 
    document.getElementById("broadcastMessage").value = "";
    setTimeout(() => { statusEl.style.display = "none"; }, 4000);
  } catch(e) { 
    alert("Error: " + e.message); 
  }
  btn.textContent = "Broadcast to All Users"; btn.disabled = false;
}

let notifListener = null;
let currentNotifications = [];
let isInitialNotifLoad = true;

function initNotificationsForAllUsers() {
  if (notifListener) notifListener(); // unsubscribe
  isInitialNotifLoad = true;
  notifListener = db.collection("notifications")
    .orderBy("createdAt", "desc")
    .limit(20)
    .onSnapshot((snap) => {
      let notifs = snap.docs.map(d => ({id: d.id, ...d.data()}));
      
      // Auto‑remove notifications that were viewed >24h ago
      const now = Date.now();
      const DAY_MS = 24 * 60 * 60 * 1000;
      const toDelete = [];
      notifs.forEach(n => {
        const viewed = Number(localStorage.getItem(`viewed_${n.id}`) || '0');
        if (viewed && (now - viewed) > DAY_MS) {
          toDelete.push(n.id);
        }
      });
      if (toDelete.length) {
        const batch = db.batch();
        toDelete.forEach(id => batch.delete(db.collection('notifications').doc(id)));
        batch.commit().catch(err => console.error('Failed to auto‑remove old notifications', err));
        // remove from local array
        notifs = notifs.filter(n => !toDelete.includes(n.id));
      }
      currentNotifications = notifs;
      
      const countEl = document.getElementById("notifCount");
      const dropdown = document.getElementById("notifDropdown");
      
      // Calculate unread count based on last checked timestamp
      let unreadCount = 0;
      if (notifs.length > 0) {
        const lastChecked = Number(localStorage.getItem("sika_last_notif_checked_time") || "0");
        notifs.forEach(n => {
          const time = n.createdAt?.toDate ? n.createdAt.toDate().getTime() : Date.now();
          if (time > lastChecked) {
            unreadCount++;
          }
        });
      }
      
      if (countEl) { 
        countEl.textContent = unreadCount; 
        countEl.style.display = unreadCount > 0 ? "inline" : "none"; 
      }
      if (dropdown) {
        dropdown.innerHTML = notifs.length === 0 
          ? "<p style='color:var(--text-muted); text-align:center; margin:10px 0;'>No notifications yet</p>" 
          : notifs.map(n => {
              const timeStr = n.createdAt?.toDate ? n.createdAt.toDate().toLocaleString() : 'just now';
              let badgeColor = "var(--gold)";
              if (n.type === "warning") badgeColor = "var(--coral)";
              if (n.type === "promo") badgeColor = "var(--green)";
              return `
                <div data-notif-id="${n.id}" style="padding:10px; border-bottom:1px solid var(--border); margin-bottom:8px;">
                  <b style="color:var(--text-primary); font-size:13px;">${n.title}</b>
                  <br/>
                  <small style="color:${badgeColor}; font-size:9px; font-weight:600; text-transform:uppercase; letter-spacing:0.02em;">${n.type}</small>
                  <small style="color:var(--text-muted); font-size:10px; margin-left:6px;">• ${timeStr}</small>
                  <p style="margin:6px 0 0 0; color:var(--text-secondary); font-size:12px; line-height:1.4;">${n.message}</p>
                </div>
              `;
            }).join("");
            
        // Add Clear All button at top of dropdown
        const clearBtn = document.createElement('button');
        clearBtn.textContent = 'Clear All';
        clearBtn.style.cssText = 'width:100%; padding:6px; margin-bottom:8px; background:var(--surface); color:var(--text-primary); border:none; cursor:pointer;';
        clearBtn.addEventListener('click', async (e) => {
          e.stopPropagation();
          try {
            const snap = await db.collection('notifications').get();
            const batch = db.batch();
            snap.docs.forEach(doc => batch.delete(doc.ref));
            await batch.commit();
            // also clear viewed timestamps
            snap.docs.forEach(doc => localStorage.removeItem(`viewed_${doc.id}`));
            dropdown.innerHTML = '';
            countEl.textContent = '0';
            countEl.style.display = 'none';
          } catch (err) {
            console.error('Failed to clear notifications:', err);
          }
        });
        dropdown.prepend(clearBtn);

        // Track view time when a notification is clicked
        dropdown.addEventListener('click', (e) => {
          const item = e.target.closest('div[data-notif-id]');
          if (item) {
            const id = item.dataset.notifId;
            localStorage.setItem(`viewed_${id}`, Date.now().toString());
          }
        });
      }
      
      if (notifs.length > 0 && window.lastNotifId !== notifs[0].id) {
        const oldNotifId = window.lastNotifId;
        window.lastNotifId = notifs[0].id;
        
        // Only trigger alerts for subsequent new notifications in the same session
        if (!isInitialNotifLoad && oldNotifId) {
          console.log("New notification:", notifs[0].title);
          if (typeof showBudgetToast === "function") {
            showBudgetToast(`New broadcast: ${notifs[0].title}`, "ok");
          }
          if ("Notification" in window && Notification.permission === "granted" && localStorage.getItem("sika-notifications-enabled") !== "false") {
            const title = notifs[0].title || "New Message";
            const options = {
              body: notifs[0].message || "",
              icon: "icon-192.png",
              tag: "sika-notif-" + notifs[0].id
            };
            if (navigator.serviceWorker && navigator.serviceWorker.ready) {
              navigator.serviceWorker.ready.then(swReg => {
                swReg.showNotification(title, options);
              });
            } else {
              new Notification(title, options);
            }
          }
        }
      }
      isInitialNotifLoad = false;
    });
}

async function init(){
  loadTheme();
  
  // Notification UI listeners
  document.getElementById("sendBroadcastBtn")?.addEventListener("click", handleSendBroadcast);
  document.getElementById("notifBell")?.addEventListener("click", (e) => {
    e.stopPropagation();
    const dd = document.getElementById("notifDropdown");
    if (dd) {
      const isOpening = dd.classList.contains("hidden");
      dd.classList.toggle("hidden");
      if (isOpening) {
        // Mark as read by saving current timestamp
        localStorage.setItem("sika_last_notif_checked_time", Date.now().toString());
        const countEl = document.getElementById("notifCount");
        if (countEl) {
          countEl.style.display = "none";
          countEl.textContent = "0";
        }
      }
    }
  });
  document.addEventListener("click", () => {
    const dd = document.getElementById("notifDropdown");
    if (dd) dd.classList.add("hidden");
  });
  const notifDropdown = document.getElementById("notifDropdown");
  if (notifDropdown) {
    notifDropdown.addEventListener("click", (e) => e.stopPropagation());
  }
  const savedUsername = localStorage.getItem(SESSION_KEY);
  if (savedUsername){
    try {
           currentUser = await getUser(savedUsername);
      if (!currentUser) throw new Error("Session user not found");
      const userToSave = { id: savedUsername, docId: savedUsername, username: currentUser.username, displayUsername: currentUser.displayUsername, name: currentUser.name, isAdmin: currentUser.isAdmin === true || savedUsername === 'nharnhaba', usernameLower: savedUsername.toLowerCase() };
      localStorage.setItem("sika_currentUser", JSON.stringify(userToSave));
      if (!currentUser.displayUsername){
        currentUser.displayUsername = savedUsername;
        await db.collection("users").doc(savedUsername).update({ displayUsername: savedUsername });
      }
      const householdId = householdIdOf(currentUser);
      expenses = await loadExpensesForAccount(currentUser.username, householdId);
      recurringTemplates = await loadRecurringForUser(currentUser.username, householdId);
      await processRecurringEntries();
      await enterApp();
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
  if (document.getElementById("screen-summary")?.classList.contains("active")){
    renderSummary();
  }
}

function loadTheme(){
  const saved = localStorage.getItem("sika-theme");
  if (saved === "light"){
    document.body.classList.add("light-theme");
    document.getElementById("themeToggleBtn").textContent = "☀️";
  }
}
init();