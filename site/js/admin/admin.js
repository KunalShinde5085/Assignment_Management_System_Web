// ============================================================================
// ADMIN DASHBOARD — admin/index.html page logic.
// Simple counts + pending-approval quick lists (Section 27). No analytics.
// ============================================================================
import { supabase } from "../supabase.js";
import { requireAdmin, attachLogoutHandler } from "../access.js";
import { renderAdminShell, loadingState, emptyState, errorState, escapeHtml, formatDate } from "../components.js";

async function init() {
  attachLogoutHandler();
  const ctx = await requireAdmin();
  if (!ctx) return;

  const pendingCount = await countPendingUsers();
  renderAdminShell("index.html", ctx.user.email, pendingCount);

  document.getElementById("admin-main-slot").innerHTML = `
    <div class="page-header">
      <div><h1>Dashboard</h1><p class="subtitle">Overview of the repository</p></div>
    </div>
    <div class="stat-grid" id="stat-grid"></div>
    <div class="card" style="margin-bottom:20px;">
      <div class="card-header"><h3>Pending user approvals</h3><a href="users.html">View all</a></div>
      <div id="pending-users-preview"></div>
    </div>
    <div class="card">
      <div class="card-header"><h3>Pending assignment approvals</h3><a href="assignments.html">View all</a></div>
      <div id="pending-assignments-preview"></div>
    </div>`;

  loadStats();
  loadPendingUsersPreview();
  loadPendingAssignmentsPreview();
}

async function countPendingUsers() {
  const { count } = await supabase
    .from("user_access")
    .select("id", { count: "exact", head: true })
    .eq("status", "pending");
  return count || 0;
}

async function loadStats() {
  const grid = document.getElementById("stat-grid");
  grid.innerHTML = Array(5).fill('<div class="card stat-card"><div class="skeleton skeleton-line" style="width:40%"></div><div class="skeleton skeleton-line" style="width:70%"></div></div>').join("");

  const [users, pendingUsers, subjects, assignments, files] = await Promise.all([
    supabase.from("user_access").select("id", { count: "exact", head: true }),
    supabase.from("user_access").select("id", { count: "exact", head: true }).eq("status", "pending"),
    supabase.from("subjects").select("id", { count: "exact", head: true }),
    supabase.from("assignments").select("id", { count: "exact", head: true }),
    supabase.from("files").select("id", { count: "exact", head: true }),
  ]);

  const stats = [
    { label: "Total users", value: users.count ?? "—" },
    { label: "Pending users", value: pendingUsers.count ?? "—" },
    { label: "Subjects", value: subjects.count ?? "—" },
    { label: "Assignments", value: assignments.count ?? "—" },
    { label: "Files", value: files.count ?? "—" },
  ];
  grid.innerHTML = stats.map((s) => `
    <div class="card stat-card">
      <div class="value">${s.value}</div>
      <div class="label">${escapeHtml(s.label)}</div>
    </div>`).join("");
}

async function loadPendingUsersPreview() {
  const mount = document.getElementById("pending-users-preview");
  mount.innerHTML = loadingState();
  const { data, error } = await supabase
    .from("user_access")
    .select("id, user_id, status, created_at")
    .eq("status", "pending")
    .order("created_at", { ascending: false })
    .limit(5);
  if (error) { mount.innerHTML = errorState(); return; }
  if (!data || data.length === 0) { mount.innerHTML = emptyState("No pending users."); return; }
  mount.innerHTML = `
    <div class="table-wrap"><table class="data-table">
      <thead><tr><th>User ID</th><th>Registered</th></tr></thead>
      <tbody>${data.map((u) => `<tr><td>${escapeHtml(u.user_id)}</td><td>${formatDate(u.created_at)}</td></tr>`).join("")}</tbody>
    </table></div>`;
}

async function loadPendingAssignmentsPreview() {
  const mount = document.getElementById("pending-assignments-preview");
  mount.innerHTML = loadingState();
  const { data, error } = await supabase
    .from("assignments")
    .select("id, title, experiment_number, created_at, subjects(name)")
    .eq("status", "pending")
    .order("created_at", { ascending: false })
    .limit(5);
  if (error) { mount.innerHTML = errorState(); return; }
  if (!data || data.length === 0) { mount.innerHTML = emptyState("No pending assignments."); return; }
  mount.innerHTML = `
    <div class="table-wrap"><table class="data-table">
      <thead><tr><th>Title</th><th>Subject</th><th>Submitted</th></tr></thead>
      <tbody>${data.map((a) => `<tr><td>${escapeHtml(a.title)}</td><td>${escapeHtml(a.subjects?.name || "")}</td><td>${formatDate(a.created_at)}</td></tr>`).join("")}</tbody>
    </table></div>`;
}

init();
