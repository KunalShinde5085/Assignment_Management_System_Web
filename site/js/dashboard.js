// ============================================================================
// DASHBOARD — dashboard.html page logic (student).
// ============================================================================
import { supabase } from "./supabase.js";
import { requireApproved, attachLogoutHandler } from "./access.js";
import { renderStudentNav, loadingState, emptyState, errorState, escapeHtml } from "./components.js";

async function init() {
  attachLogoutHandler();
  const ctx = await requireApproved();
  if (!ctx) return;

  renderStudentNav("dashboard.html", ctx.user.email);
  document.getElementById("welcome-email").textContent = ctx.user.email;

  await Promise.all([loadSubjects(), loadRecentAssignments()]);
}

async function loadSubjects() {
  const mount = document.getElementById("dashboard-subjects");
  mount.innerHTML = loadingState("Loading subjects...");

  const { data, error } = await supabase
    .from("subjects")
    .select("id, name, code, description")
    .eq("status", "active")
    .order("name", { ascending: true })
    .limit(8);

  if (error) {
    console.error(error);
    mount.innerHTML = errorState();
    return;
  }
  if (!data || data.length === 0) {
    mount.innerHTML = emptyState("No subjects available.", "Check back once an administrator adds subjects.");
    return;
  }

  mount.innerHTML = `<div class="subject-grid">${data.map(subjectCard).join("")}</div>`;
}

async function loadRecentAssignments() {
  const mount = document.getElementById("dashboard-recent");
  mount.innerHTML = loadingState("Loading recent assignments...");

  const { data, error } = await supabase
    .from("assignments")
    .select("id, title, experiment_number, status, created_at, subjects(name, code)")
    .eq("status", "approved")
    .order("created_at", { ascending: false })
    .limit(5);

  if (error) {
    console.error(error);
    mount.innerHTML = errorState();
    return;
  }
  if (!data || data.length === 0) {
    mount.innerHTML = emptyState("No assignments available yet.");
    return;
  }

  mount.innerHTML = `<div class="assignment-list">${data.map(assignmentRow).join("")}</div>`;
}

function subjectCard(s) {
  return `
    <a class="subject-card" href="subjects.html?id=${encodeURIComponent(s.id)}">
      <div class="code">${escapeHtml(s.code)}</div>
      <h3>${escapeHtml(s.name)}</h3>
      <p>${escapeHtml(s.description || "")}</p>
    </a>`;
}

function assignmentRow(a) {
  const subject = a.subjects;
  return `
    <a class="assignment-row" href="assignment.html?id=${encodeURIComponent(a.id)}">
      <div class="exp-tag">${escapeHtml(a.experiment_number || "—")}</div>
      <div class="info">
        <h3>${escapeHtml(a.title)}</h3>
        <p>${escapeHtml(subject ? `${subject.name} (${subject.code})` : "")}</p>
      </div>
      <span class="chev">›</span>
    </a>`;
}

init();
