const status = document.getElementById("status");
const data = document.getElementById("data");

function showStatus(msg, type) {
  status.textContent = msg;
  status.className = type;
}

// Export ALL cookies from ALL domains
document.getElementById("export-btn").addEventListener("click", async () => {
  try {
    const cookies = await chrome.cookies.getAll({});
    data.value = JSON.stringify(cookies, null, 2);
    showStatus(`Exported ${cookies.length} cookies from all domains`, "success");
  } catch (e) {
    showStatus("Export failed: " + e.message, "error");
  }
});

// Import cookies from JSON
document.getElementById("import-btn").addEventListener("click", async () => {
  try {
    const cookies = JSON.parse(data.value);
    if (!Array.isArray(cookies)) throw new Error("JSON harus berupa array");

    let success = 0, failed = 0;

    for (const c of cookies) {
      try {
        const url = buildUrl(c);
        const details = {
          url,
          name: c.name,
          value: c.value,
          path: c.path || "/",
          secure: c.secure || false,
          httpOnly: c.httpOnly || false,
          sameSite: normalizeSameSite(c.sameSite),
        };

        // Set domain hanya jika hostOnly = false
        if (c.hostOnly === false && c.domain) {
          details.domain = c.domain;
        }

        // Set expiry jika ada (session cookie = tanpa expirationDate)
        if (c.expirationDate) {
          details.expirationDate = c.expirationDate;
        }

        // storeId
        if (c.storeId) {
          details.storeId = c.storeId;
        }

        await chrome.cookies.set(details);
        success++;
      } catch (e) {
        failed++;
      }
    }

    showStatus(`Imported: ${success} success, ${failed} failed`, success > 0 ? "success" : "error");
  } catch (e) {
    showStatus("Import failed: " + e.message, "error");
  }
});

// Clear ALL cookies
document.getElementById("clear-btn").addEventListener("click", async () => {
  if (!confirm("Hapus SEMUA cookies dari semua domain?")) return;
  try {
    const cookies = await chrome.cookies.getAll({});
    let count = 0;
    for (const c of cookies) {
      const url = buildUrl(c);
      await chrome.cookies.remove({ url, name: c.name, storeId: c.storeId });
      count++;
    }
    showStatus(`Cleared ${count} cookies`, "success");
  } catch (e) {
    showStatus("Clear failed: " + e.message, "error");
  }
});

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
