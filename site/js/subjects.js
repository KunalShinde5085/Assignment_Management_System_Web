// ============================================================================
// SUBJECTS — subjects.html page logic (student).
// With no ?id= query param: shows the searchable subject grid.
// With ?id=<uuid>: shows that subject's detail + its approved assignments.
// ============================================================================
import { supabase } from "./supabase.js";
import { requireApproved, attachLogoutHandler } from "./access.js";
import { renderStudentNav, loadingState, emptyState, errorState, escapeHtml } from "./components.js";

async function init() {
  attachLogoutHandler();
  const ctx = await requireApproved();
  if (!ctx) return;
  renderStudentNav("subjects.html", ctx.user.email);

  const subjectId = new URLSearchParams(window.location.search).get("id");
  if (subjectId) {
    await renderSubjectDetail(subjectId);
  } else {
    await renderSubjectList();
  }
}

/* ------------------------------ List view -------------------------------- */
async function renderSubjectList() {
  document.getElementById("subject-list-view").classList.remove("hidden");
  document.getElementById("subject-detail-view").classList.add("hidden");

  let allSubjects = [];
  const mount = document.getElementById("subjects-grid");
  mount.innerHTML = loadingState("Loading subjects...");

  const { data, error } = await supabase
    .from("subjects")
    .select("id, name, code, description")
    .eq("status", "active")
    .order("name", { ascending: true });

  if (error) {
    console.error(error);
    mount.innerHTML = errorState();
    return;
  }
  allSubjects = data || [];
  renderGrid(allSubjects);

  const searchInput = document.getElementById("subject-search");
  searchInput?.addEventListener("input", () => {
    const q = searchInput.value.trim().toLowerCase();
    const filtered = !q
      ? allSubjects
      : allSubjects.filter((s) => s.name.toLowerCase().includes(q) || s.code.toLowerCase().includes(q));
    renderGrid(filtered);
  });

  function renderGrid(list) {
    if (list.length === 0) {
      mount.innerHTML = emptyState("No subjects found.", "Try a different search term.");
      return;
    }
    mount.innerHTML = `<div class="subject-grid">${list.map(subjectCard).join("")}</div>`;
  }
}

function subjectCard(s) {
  return `
    <a class="subject-card" href="subjects.html?id=${encodeURIComponent(s.id)}">
      <div class="code">${escapeHtml(s.code)}</div>
      <h3>${escapeHtml(s.name)}</h3>
      <p>${escapeHtml(s.description || "")}</p>
    </a>`;
}

/* ----------------------------- Detail view -------------------------------- */
async function renderSubjectDetail(subjectId) {
  document.getElementById("subject-list-view").classList.add("hidden");
  const detailView = document.getElementById("subject-detail-view");
  detailView.classList.remove("hidden");
  detailView.innerHTML = loadingState("Loading subject...");

  const { data: subject, error } = await supabase
    .from("subjects")
    .select("id, name, code, description")
    .eq("id", subjectId)
    .eq("status", "active")
    .maybeSingle();

  if (error) {
    console.error(error);
    detailView.innerHTML = errorState();
    return;
  }
  if (!subject) {
    detailView.innerHTML = errorState("Subject not found or is unavailable.");
    return;
  }

  const { data: assignments, error: aError } = await supabase
    .from("assignments")
    .select("id, title, experiment_number, description")
    .eq("subject_id", subjectId)
    .eq("status", "approved")
    .order("experiment_number", { ascending: true });

  detailView.innerHTML = `
    <div class="breadcrumbs">
      <a href="subjects.html">Subjects</a>
      <span class="sep">/</span>
      <span class="current">${escapeHtml(subject.name)}</span>
    </div>
    <div class="page-header">
      <div>
        <h1>${escapeHtml(subject.name)}</h1>
        <p class="subtitle">${escapeHtml(subject.code)}${subject.description ? " · " + escapeHtml(subject.description) : ""}</p>
      </div>
    </div>
    <h2>Assignments</h2>
    <div id="subject-assignment-list"></div>`;

  const listMount = document.getElementById("subject-assignment-list");
  if (aError) {
    console.error(aError);
    listMount.innerHTML = errorState();
    return;
  }
  if (!assignments || assignments.length === 0) {
    listMount.innerHTML = emptyState("No assignments available for this subject.");
    return;
  }
  listMount.innerHTML = `<div class="assignment-list">${assignments.map(assignmentRow).join("")}</div>`;
}

function assignmentRow(a) {
  return `
    <a class="assignment-row" href="assignment.html?id=${encodeURIComponent(a.id)}">
      <div class="exp-tag">${escapeHtml(a.experiment_number || "—")}</div>
      <div class="info">
        <h3>${escapeHtml(a.title)}</h3>
        <p>${escapeHtml(a.description || "")}</p>
      </div>
      <span class="chev">›</span>
    </a>`;
}

init();
