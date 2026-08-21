const status = document.getElementById("status");
const data = document.getElementById("data");

function showStatus(msg, type) {
  status.textContent = msg;
  status.className = type;
}

// ============ COOKIES ============

document.getElementById("export-cookies").addEventListener("click", async () => {
  try {
    const cookies = await chrome.cookies.getAll({});
    data.value = JSON.stringify(cookies, null, 2);
    showStatus(`Exported ${cookies.length} cookies`, "success");
  } catch (e) {
    showStatus("Export failed: " + e.message, "error");
  }
});

document.getElementById("import-cookies").addEventListener("click", async () => {
  try {
    const cookies = JSON.parse(data.value);
    if (!Array.isArray(cookies)) throw new Error("JSON harus array");
    let success = 0, failed = 0;
    for (const c of cookies) {
      try {
        const url = buildUrl(c);
        const details = {
          url, name: c.name, value: c.value,
          path: c.path || "/", secure: c.secure || false,
          httpOnly: c.httpOnly || false,
          sameSite: normalizeSameSite(c.sameSite),
        };
        if (c.hostOnly === false && c.domain) details.domain = c.domain;
        if (c.expirationDate) details.expirationDate = c.expirationDate;
        if (c.storeId) details.storeId = c.storeId;
        await chrome.cookies.set(details);
        success++;
      } catch (e) { failed++; }
    }
    showStatus(`Cookies imported: ${success} ok, ${failed} failed`, "success");
  } catch (e) {
    showStatus("Import failed: " + e.message, "error");
  }
});

document.getElementById("clear-cookies").addEventListener("click", async () => {
  if (!confirm("Hapus SEMUA cookies?")) return;
  const cookies = await chrome.cookies.getAll({});
  for (const c of cookies) {
    await chrome.cookies.remove({ url: buildUrl(c), name: c.name, storeId: c.storeId });
  }
  showStatus(`Cleared ${cookies.length} cookies`, "success");
});

// ============ STORAGE (LocalStorage + IndexedDB) ============

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function executeInTab(tabId, func, args = []) {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func,
    args,
    world: "MAIN", // Access page's JS context (needed for IndexedDB)
  });
  return results[0]?.result;
}

// Export LocalStorage + IndexedDB from active tab
document.getElementById("export-storage").addEventListener("click", async () => {
  try {
    const tab = await getActiveTab();
    const result = await executeInTab(tab.id, exportStorageFromPage);
    data.value = JSON.stringify(result, null, 2);
    const lsCount = Object.keys(result.localStorage || {}).length;
    const idbCount = (result.indexedDB || []).length;
    showStatus(`Exported: ${lsCount} localStorage keys, ${idbCount} IndexedDB databases`, "success");
  } catch (e) {
    showStatus("Export storage failed: " + e.message, "error");
  }
});

// Import LocalStorage + IndexedDB to active tab
document.getElementById("import-storage").addEventListener("click", async () => {
  try {
    const tab = await getActiveTab();
    const payload = JSON.parse(data.value);
    const result = await executeInTab(tab.id, importStorageToPage, [payload]);
    showStatus(result, "success");
  } catch (e) {
    showStatus("Import storage failed: " + e.message, "error");
  }
});

document.getElementById("clear-storage").addEventListener("click", async () => {
  if (!confirm("Clear LocalStorage + IndexedDB di tab aktif?")) return;
  const tab = await getActiveTab();
  await executeInTab(tab.id, () => {
    localStorage.clear();
    return "LocalStorage cleared";
  });
  showStatus("Storage cleared", "success");
});

// ============ FULL EXPORT/IMPORT ============

document.getElementById("export-all").addEventListener("click", async () => {
  try {
    const cookies = await chrome.cookies.getAll({});
    const tab = await getActiveTab();
    const storage = await executeInTab(tab.id, exportStorageFromPage);
    const fullData = { cookies, storage, url: tab.url };
    data.value = JSON.stringify(fullData, null, 2);
    showStatus(`Full export: ${cookies.length} cookies + storage from ${tab.url}`, "success");
  } catch (e) {
    showStatus("Full export failed: " + e.message, "error");
  }
});

document.getElementById("import-all").addEventListener("click", async () => {
  try {
    const fullData = JSON.parse(data.value);

    // Import cookies
    if (fullData.cookies) {
      let s = 0;
      for (const c of fullData.cookies) {
        try {
          const url = buildUrl(c);
          const details = {
            url, name: c.name, value: c.value,
            path: c.path || "/", secure: c.secure || false,
            httpOnly: c.httpOnly || false,
            sameSite: normalizeSameSite(c.sameSite),
          };
          if (c.hostOnly === false && c.domain) details.domain = c.domain;
          if (c.expirationDate) details.expirationDate = c.expirationDate;
          await chrome.cookies.set(details);
          s++;
        } catch (e) {}
      }
    }

    // Import storage
    if (fullData.storage) {
      const tab = await getActiveTab();
      await executeInTab(tab.id, importStorageToPage, [fullData.storage]);
    }

    showStatus("Full import done. Refresh halaman.", "success");
  } catch (e) {
    showStatus("Full import failed: " + e.message, "error");
  }
});

// ============ PAGE FUNCTIONS (injected) ============

function exportStorageFromPage() {
  return new Promise(async (resolve) => {
    // LocalStorage
    const ls = {};
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      ls[key] = localStorage.getItem(key);
    }

    // IndexedDB - export all databases
    const idbData = [];
    try {
      const dbs = await indexedDB.databases();
      for (const dbInfo of dbs) {
        try {
          const dbExport = await new Promise((res, rej) => {
            const req = indexedDB.open(dbInfo.name, dbInfo.version);
            req.onsuccess = async (e) => {
              const db = e.target.result;
              const stores = {};
              for (const storeName of db.objectStoreNames) {
                try {
                  const tx = db.transaction(storeName, "readonly");
                  const store = tx.objectStore(storeName);
                  const allData = await new Promise((r, j) => {
                    const req2 = store.getAll();
                    req2.onsuccess = () => r(req2.result);
                    req2.onerror = () => j(req2.error);
                  });
                  const allKeys = await new Promise((r, j) => {
                    const req2 = store.getAllKeys();
                    req2.onsuccess = () => r(req2.result);
                    req2.onerror = () => j(req2.error);
                  });
                  stores[storeName] = { keys: allKeys, values: allData };
                } catch (e) {}
              }
              db.close();
              res({ name: dbInfo.name, version: dbInfo.version, stores });
            };
            req.onerror = () => rej(req.error);
            req.onblocked = () => rej(new Error("blocked"));
          });
          idbData.push(dbExport);
        } catch (e) {}
      }
    } catch (e) {}

    resolve({ localStorage: ls, indexedDB: idbData });
  });
}

function importStorageToPage(payload) {
  return new Promise(async (resolve) => {
    let lsCount = 0, idbCount = 0;

    // LocalStorage
    if (payload.localStorage) {
      for (const [key, value] of Object.entries(payload.localStorage)) {
        localStorage.setItem(key, value);
        lsCount++;
      }
    }

    // IndexedDB
    if (payload.indexedDB) {
      for (const dbInfo of payload.indexedDB) {
        try {
          await new Promise((res, rej) => {
            const req = indexedDB.open(dbInfo.name, dbInfo.version);
            req.onupgradeneeded = (e) => {
              const db = e.target.result;
              for (const storeName of Object.keys(dbInfo.stores)) {
                if (!db.objectStoreNames.contains(storeName)) {
                  db.createObjectStore(storeName);
                }
              }
            };
            req.onsuccess = async (e) => {
              const db = e.target.result;
              for (const [storeName, storeData] of Object.entries(dbInfo.stores)) {
                try {
                  const tx = db.transaction(storeName, "readwrite");
                  const store = tx.objectStore(storeName);
                  for (let i = 0; i < storeData.keys.length; i++) {
                    store.put(storeData.values[i], storeData.keys[i]);
                  }
                  await new Promise((r) => { tx.oncomplete = r; });
                  idbCount++;
                } catch (e) {}
              }
              db.close();
              res();
            };
            req.onerror = () => rej(req.error);
          });
        } catch (e) {}
      }
    }

    resolve(`Imported: ${lsCount} localStorage keys, ${idbCount} IndexedDB stores. Refresh halaman!`);
  });
}

// ============ UTILS ============

function buildUrl(cookie) {
  const protocol = cookie.secure ? "https://" : "http://";
  const domain = cookie.domain?.startsWith(".") ? cookie.domain.slice(1) : cookie.domain;
  return protocol + domain + (cookie.path || "/");
}

function normalizeSameSite(val) {
  if (!val) return "unspecified";
  const lower = val.toLowerCase();
  if (lower === "no_restriction" || lower === "none") return "no_restriction";
  if (lower === "lax") return "lax";
  if (lower === "strict") return "strict";
  return "unspecified";
}
