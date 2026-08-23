// ============================================================================
// COMPONENTS — toast, confirmation modal, loading/empty/error state helpers,
// and shared navigation rendering (student topbar + admin sidebar).
// These are plain DOM helpers — no framework, reusable across every page.
// ============================================================================

/* ----------------------------- Toasts ---------------------------------- */
function ensureToastRegion() {
  let region = document.getElementById("toast-region");
  if (!region) {
    region = document.createElement("div");
    region.id = "toast-region";
    region.setAttribute("aria-live", "polite");
    document.body.appendChild(region);
  }
  return region;
}

export function showToast(message, type = "info", timeout = 4000) {
  const region = ensureToastRegion();
  const el = document.createElement("div");
  el.className = `toast toast-${type}`;
  el.textContent = message;
  region.appendChild(el);
  setTimeout(() => el.remove(), timeout);
}

/* --------------------------- Confirm modal ------------------------------ */
// Returns a Promise<boolean> — resolves true if the user confirms.
export function confirmDialog({ title, message, confirmLabel = "Confirm", danger = true }) {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    overlay.innerHTML = `
      <div class="modal" role="dialog" aria-modal="true" aria-labelledby="confirm-title">
        <div class="modal-danger-icon">!</div>
        <h3 id="confirm-title">${escapeHtml(title)}</h3>
        <p>${escapeHtml(message)}</p>
        <div class="modal-actions">
          <button type="button" class="btn btn-secondary" data-action="cancel">Cancel</button>
          <button type="button" class="btn ${danger ? "btn-danger" : "btn-primary"}" data-action="confirm">${escapeHtml(confirmLabel)}</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);

    function close(result) {
      overlay.remove();
      document.removeEventListener("keydown", onKey);
      resolve(result);
    }
    function onKey(e) { if (e.key === "Escape") close(false); }

    overlay.addEventListener("click", (e) => { if (e.target === overlay) close(false); });
    overlay.querySelector('[data-action="cancel"]').addEventListener("click", () => close(false));
    overlay.querySelector('[data-action="confirm"]').addEventListener("click", () => close(true));
    document.addEventListener("keydown", onKey);
    overlay.querySelector('[data-action="confirm"]').focus();
  });
}

/* ------------------------ Loading / empty / error ------------------------ */
export function loadingState(message = "Loading...") {
  return `<div class="loading-row"><span class="spinner"></span><span>${escapeHtml(message)}</span></div>`;
}

export function emptyState(message, sub = "") {
  return `
    <div class="state-block">
      <div class="state-icon">—</div>
      <h3>${escapeHtml(message)}</h3>
      ${sub ? `<p>${escapeHtml(sub)}</p>` : ""}
    </div>`;
}

export function errorState(message = "Something went wrong. Please try again.") {
  return `
    <div class="state-block state-error">
      <div class="state-icon">!</div>
      <h3>${escapeHtml(message)}</h3>
    </div>`;
}

/* -------------------------------- Utils --------------------------------- */
export function escapeHtml(str) {
  if (str === null || str === undefined) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export function formatBytes(bytes) {
  if (bytes === null || bytes === undefined) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export function badge(status) {
  return `<span class="badge badge-${escapeHtml(status)}">${escapeHtml(status)}</span>`;
}

/* --------------------- Generic "set loading" button helper -------------- */
export function setButtonLoading(btn, isLoading, loadingText = "Working...") {
  if (isLoading) {
    btn.dataset.originalText = btn.dataset.originalText || btn.innerHTML;
    btn.setAttribute("data-loading", "true");
    btn.disabled = true;
    btn.innerHTML = `<span class="spinner spinner-light"></span> ${escapeHtml(loadingText)}`;
  } else {
    btn.removeAttribute("data-loading");
    btn.disabled = false;
    if (btn.dataset.originalText) btn.innerHTML = btn.dataset.originalText;
  }
}

/* ---------------------------------------------------------------------------
   NAVIGATION — shared student topbar. Injects into <div id="app-nav">.
   Extensible: add new links to STUDENT_NAV_LINKS without touching HTML.
--------------------------------------------------------------------------- */
const STUDENT_NAV_LINKS = [
  { href: "dashboard.html", label: "Dashboard" },
  { href: "subjects.html", label: "Subjects" },
];

export function renderStudentNav(activePage, email) {
  const mount = document.getElementById("app-nav");
  if (!mount) return;
  const links = STUDENT_NAV_LINKS.map(
    (l) => `<a href="${l.href}" class="${l.href === activePage ? "active" : ""}">${l.label}</a>`
  ).join("");

  mount.innerHTML = `
    <header class="app-topbar">
      <div class="app-topbar__brand">
        <span class="mark">AR</span>
        <span>Assignment Repository</span>
      </div>
      <nav class="app-topbar__nav" id="topbar-nav">
        ${links}
        <a href="#" id="logout-link">Logout</a>
      </nav>
      <div class="app-topbar__user">
        <span class="email">${escapeHtml(email || "")}</span>
        <button class="app-topbar__menu-btn" id="nav-menu-btn" aria-label="Toggle menu">☰</button>
      </div>
    </header>`;

  document.getElementById("nav-menu-btn")?.addEventListener("click", () => {
    document.getElementById("topbar-nav").classList.toggle("open");
  });
}

/* ---------------------------------------------------------------------------
   ADMIN SIDEBAR — extensible nav-group structure (Section 29: future menus
   like Announcements/Reports/Analytics can be appended to ADMIN_NAV_GROUPS
   without any structural rebuild).
--------------------------------------------------------------------------- */
const ADMIN_NAV_GROUPS = [
  {
    label: "Content",
    links: [
      { href: "subjects.html", label: "Subjects" },
      { href: "assignments.html", label: "Assignments" },
    ],
  },
  {
    label: "Access",
    links: [
      { href: "users.html", label: "Users" },
    ],
  },
];

export function renderAdminShell(activePage, email, pendingCount = 0) {
  const mount = document.getElementById("app-nav");
  if (!mount) return;

  const groups = ADMIN_NAV_GROUPS.map((g) => {
    const links = g.links
      .map((l) => {
        const isUsers = l.href === "users.html";
        const countBadge = isUsers && pendingCount > 0 ? `<span class="count">${pendingCount}</span>` : "";
        return `<a href="${l.href}" class="${l.href === activePage ? "active" : ""}">${escapeHtml(l.label)} ${countBadge}</a>`;
      })
      .join("");
    return `<div class="nav-group"><div class="nav-group-label">${escapeHtml(g.label)}</div>${links}</div>`;
  }).join("");

  mount.innerHTML = `
    <div class="admin-sidebar" id="admin-sidebar">
      <div class="admin-sidebar__brand">
        <span class="mark">AR</span>
        <div><span>Assignment Repository</span><span class="tag">Admin</span></div>
      </div>
      <nav class="admin-nav">
        <div class="nav-group">
          <a href="index.html" class="${activePage === "index.html" ? "active" : ""}">Dashboard</a>
        </div>
        ${groups}
      </nav>
      <div class="admin-sidebar__footer">
        ${escapeHtml(email || "")}
        <a href="#" id="logout-link">Logout</a>
        <a href="../dashboard.html">Back to student view</a>
      </div>
    </div>
    <div class="admin-content">
      <div class="admin-topbar">
        <button class="admin-sidebar-toggle" id="admin-sidebar-toggle" aria-label="Toggle menu">☰</button>
        <span class="title">Admin</span>
        <span></span>
      </div>
      <main class="admin-main" id="admin-main-slot"></main>
    </div>`;

  document.getElementById("admin-sidebar-toggle")?.addEventListener("click", () => {
    document.getElementById("admin-sidebar").classList.toggle("open");
  });
}
