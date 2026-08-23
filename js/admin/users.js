// ============================================================================
// ADMIN · USERS — admin/users.html page logic. Tabs: Pending / Approved /
// Rejected, each with the actions Section 10 of the spec calls for.
// ============================================================================
import { supabase } from "../supabase.js";
import { requireAdmin, attachLogoutHandler } from "../access.js";
import {
  renderAdminShell, loadingState, emptyState, errorState, escapeHtml,
  formatDate, badge, showToast, confirmDialog,
} from "../components.js";

let currentTab = "pending";

async function init() {
  attachLogoutHandler();
  const ctx = await requireAdmin();
  if (!ctx) return;

  const pendingCount = await countPendingUsers();
  renderAdminShell("users.html", ctx.user.email, pendingCount);

  document.getElementById("admin-main-slot").innerHTML = `
    <div class="page-header"><div><h1>Users</h1><p class="subtitle">Approve, reject, disable, or delete accounts</p></div></div>
    <div class="tabs" id="user-tabs">
      <button data-tab="pending" class="active">Pending</button>
      <button data-tab="approved">Approved</button>
      <button data-tab="rejected">Rejected</button>
    </div>
    <div class="card"><div id="users-table-mount"></div></div>`;

  document.getElementById("user-tabs").addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-tab]");
    if (!btn) return;
    currentTab = btn.dataset.tab;
    document.querySelectorAll("#user-tabs button").forEach((b) => b.classList.toggle("active", b === btn));
    loadUsers();
  });

  loadUsers();
}

async function countPendingUsers() {
  const { count } = await supabase
    .from("user_access")
    .select("id", { count: "exact", head: true })
    .eq("status", "pending");
  return count || 0;
}

async function loadUsers() {
  const mount = document.getElementById("users-table-mount");
  mount.innerHTML = loadingState("Loading users...");

  // 'rejected' tab also covers 'disabled' status so admins have one place
  // to manage everyone who currently lacks access.
  const statuses = currentTab === "pending" ? ["pending"] : currentTab === "approved" ? ["approved"] : ["rejected", "disabled"];

  const { data, error } = await supabase
    .from("user_access")
    .select("id, user_id, email, status, created_at")
    .in("status", statuses)
    .order("created_at", { ascending: false });

  if (error) { console.error(error); mount.innerHTML = errorState(); return; }
  if (!data || data.length === 0) {
    mount.innerHTML = emptyState(`No ${currentTab} users.`);
    return;
  }

  mount.innerHTML = `
    <div class="table-wrap"><table class="data-table">
      <thead><tr><th>Email</th><th>Status</th><th>Registered</th><th></th></tr></thead>
      <tbody>${data.map(userRow).join("")}</tbody>
    </table></div>`;

  wireRowActions(mount);
}

function userRow(u) {
  return `
    <tr data-id="${escapeHtml(u.id)}">
      <td>${escapeHtml(u.email)}</td>
      <td>${badge(u.status)}</td>
      <td>${formatDate(u.created_at)}</td>
      <td><div class="row-actions">${actionButtons(u.status)}</div></td>
    </tr>`;
}

function actionButtons(status) {
  const btns = [];
  if (status === "pending") {
    btns.push('<button class="btn btn-success btn-sm" data-action="approve">Approve</button>');
    btns.push('<button class="btn btn-secondary btn-sm" data-action="reject">Reject</button>');
  }
  if (status === "approved") {
    btns.push('<button class="btn btn-secondary btn-sm" data-action="disable">Disable</button>');
  }
  if (status === "rejected" || status === "disabled") {
    btns.push('<button class="btn btn-success btn-sm" data-action="approve">Approve</button>');
  }
  btns.push('<button class="btn btn-danger btn-sm" data-action="delete">Delete</button>');
  return btns.join("");
}

function wireRowActions(mount) {
  mount.querySelectorAll("button[data-action]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const row = btn.closest("tr");
      const id = row.dataset.id;
      const action = btn.dataset.action;

      if (action === "approve") return updateStatus(id, "approved");
      if (action === "reject") return updateStatus(id, "rejected");
      if (action === "disable") return updateStatus(id, "disabled");
      if (action === "delete") {
        const ok = await confirmDialog({
          title: "Delete this user?",
          message: "This permanently removes their access record. This cannot be undone.",
          confirmLabel: "Delete Permanently",
        });
        if (!ok) return;
        const { error } = await supabase.from("user_access").delete().eq("id", id);
        if (error) { console.error(error); showToast("Could not delete user.", "error"); return; }
        showToast("User deleted.", "success");
        loadUsers();
      }
    });
  });
}

async function updateStatus(id, status) {
  const { error } = await supabase.from("user_access").update({ status }).eq("id", id);
  if (error) { console.error(error); showToast("Could not update user.", "error"); return; }
  showToast(`User marked as ${status}.`, "success");
  loadUsers();
}

init();
