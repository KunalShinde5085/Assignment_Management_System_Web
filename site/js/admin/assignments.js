// ============================================================================
// ADMIN · ASSIGNMENTS — admin/assignments.html page logic.
// List, search, filter by subject, add, edit, delete, approve, reject,
// publish/unpublish. File management for a given assignment happens on
// admin/uploads.html (linked from each row).
// ============================================================================
import { supabase } from "../supabase.js";
import { requireAdmin, attachLogoutHandler } from "../access.js";
import {
  renderAdminShell, loadingState, emptyState, errorState, escapeHtml,
  badge, showToast, confirmDialog, setButtonLoading,
} from "../components.js";

let allAssignments = [];
let allSubjects = [];
let currentSubjectFilter = "";
let currentSearch = "";

async function init() {
  attachLogoutHandler();
  const ctx = await requireAdmin();
  if (!ctx) return;
  renderAdminShell("assignments.html", ctx.user.email, await countPendingUsers());

  const { data: subjects } = await supabase.from("subjects").select("id, name, code").order("name");
  allSubjects = subjects || [];

  document.getElementById("admin-main-slot").innerHTML = `
    <div class="page-header">
      <div><h1>Assignments</h1><p class="subtitle">Create, review, and publish experiments</p></div>
      <button class="btn btn-primary" id="add-assignment-btn">Add Assignment</button>
    </div>
    <div class="toolbar">
      <div class="toolbar-left">
        <div class="search-bar"><span class="icon">⌕</span><input type="text" id="assignment-search" placeholder="Search assignments..."></div>
        <select id="subject-filter">
          <option value="">All subjects</option>
          ${allSubjects.map((s) => `<option value="${escapeHtml(s.id)}">${escapeHtml(s.name)}</option>`).join("")}
        </select>
      </div>
    </div>
    <div class="card"><div id="assignments-table-mount"></div></div>`;

  document.getElementById("add-assignment-btn").addEventListener("click", () => openAssignmentForm());
  document.getElementById("assignment-search").addEventListener("input", (e) => {
    currentSearch = e.target.value.trim().toLowerCase();
    renderTable();
  });
  document.getElementById("subject-filter").addEventListener("change", (e) => {
    currentSubjectFilter = e.target.value;
    renderTable();
  });

  loadAssignments();
}

async function countPendingUsers() {
  const { count } = await supabase.from("user_access").select("id", { count: "exact", head: true }).eq("status", "pending");
  return count || 0;
}

async function loadAssignments() {
  const mount = document.getElementById("assignments-table-mount");
  mount.innerHTML = loadingState("Loading assignments...");
  const { data, error } = await supabase
    .from("assignments")
    .select("id, title, experiment_number, description, status, subject_id, subjects(name)")
    .order("created_at", { ascending: false });
  if (error) { console.error(error); mount.innerHTML = errorState(); return; }
  allAssignments = data || [];
  renderTable();
}

function renderTable() {
  const mount = document.getElementById("assignments-table-mount");
  let list = allAssignments;
  if (currentSubjectFilter) list = list.filter((a) => a.subject_id === currentSubjectFilter);
  if (currentSearch) {
    list = list.filter(
      (a) => a.title.toLowerCase().includes(currentSearch) || (a.experiment_number || "").toLowerCase().includes(currentSearch)
    );
  }
  if (list.length === 0) { mount.innerHTML = emptyState("No assignments found."); return; }
  mount.innerHTML = `
    <div class="table-wrap"><table class="data-table">
      <thead><tr><th>Experiment</th><th>Title</th><th>Subject</th><th>Status</th><th></th></tr></thead>
      <tbody>${list.map(assignmentRow).join("")}</tbody>
    </table></div>`;
  wireRowActions(mount, list);
}

function assignmentRow(a) {
  return `
    <tr data-id="${escapeHtml(a.id)}">
      <td>${escapeHtml(a.experiment_number || "—")}</td>
      <td>${escapeHtml(a.title)}</td>
      <td>${escapeHtml(a.subjects?.name || "")}</td>
      <td>${badge(a.status)}</td>
      <td><div class="row-actions">
        ${a.status !== "approved" ? '<button class="btn btn-success btn-sm" data-action="approve">Approve</button>' : ""}
        ${a.status !== "rejected" ? '<button class="btn btn-secondary btn-sm" data-action="reject">Reject</button>' : ""}
        ${a.status === "approved" ? '<button class="btn btn-secondary btn-sm" data-action="unpublish">Unpublish</button>' : ""}
        <a class="btn btn-secondary btn-sm" href="uploads.html?assignment_id=${escapeHtml(a.id)}">Files</a>
        <button class="btn btn-secondary btn-sm" data-action="edit">Edit</button>
        <button class="btn btn-danger btn-sm" data-action="delete">Delete</button>
      </div></td>
    </tr>`;
}

function wireRowActions(mount, list) {
  mount.querySelectorAll("button[data-action]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.closest("tr").dataset.id;
      const assignment = list.find((a) => a.id === id);
      const action = btn.dataset.action;
      if (action === "approve") return updateStatus(assignment, "approved");
      if (action === "reject") return updateStatus(assignment, "rejected");
      if (action === "unpublish") return updateStatus(assignment, "unpublished");
      if (action === "edit") return openAssignmentForm(assignment);
      if (action === "delete") return deleteAssignment(assignment);
    });
  });
}

async function updateStatus(assignment, status) {
  const { error } = await supabase.from("assignments").update({ status }).eq("id", assignment.id);
  if (error) { console.error(error); showToast("Could not update assignment.", "error"); return; }
  showToast(`Assignment marked ${status}.`, "success");
  loadAssignments();
}

async function deleteAssignment(assignment) {
  const { count } = await supabase.from("files").select("id", { count: "exact", head: true }).eq("assignment_id", assignment.id);
  const ok = await confirmDialog({
    title: "Delete this assignment?",
    message: (count || 0) > 0
      ? "This assignment contains associated files. Deleting it will also remove its associated files."
      : "This cannot be undone.",
    confirmLabel: "Delete Permanently",
  });
  if (!ok) return;

  const { data: files } = await supabase.from("files").select("storage_path").eq("assignment_id", assignment.id);
  if (files && files.length > 0) {
    await supabase.storage.from("assignments").remove(files.map((f) => f.storage_path));
  }
  // files rows cascade-delete automatically via ON DELETE CASCADE.
  const { error } = await supabase.from("assignments").delete().eq("id", assignment.id);
  if (error) { console.error(error); showToast("Could not delete assignment.", "error"); return; }
  showToast("Assignment deleted.", "success");
  loadAssignments();
}

function openAssignmentForm(assignment = null) {
  const isEdit = !!assignment;
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true">
      <h3>${isEdit ? "Edit Assignment" : "Add Assignment"}</h3>
      <form id="assignment-form">
        <div class="field"><label>Subject</label>
          <select name="subject_id" required>
            ${allSubjects.map((s) => `<option value="${escapeHtml(s.id)}" ${assignment?.subject_id === s.id ? "selected" : ""}>${escapeHtml(s.name)}</option>`).join("")}
          </select>
        </div>
        <div class="field"><label>Experiment Number</label><input type="text" name="experiment_number" value="${escapeHtml(assignment?.experiment_number || "")}" placeholder="e.g. 03"></div>
        <div class="field"><label>Title</label><input type="text" name="title" required value="${escapeHtml(assignment?.title || "")}"></div>
        <div class="field"><label>Description</label><textarea name="description">${escapeHtml(assignment?.description || "")}</textarea></div>
        ${!isEdit ? `<div class="field"><label>Initial status</label>
          <select name="status">
            <option value="pending">Pending review</option>
            <option value="approved">Approved (publish immediately)</option>
          </select>
          <div class="hint">Admin-created content can be published directly.</div>
        </div>` : ""}
        <div class="hint" style="margin-bottom:14px;">Files are managed separately after saving, from the assignment's "Files" page.</div>
        <div class="modal-actions">
          <button type="button" class="btn btn-secondary" data-action="cancel">Cancel</button>
          <button type="submit" class="btn btn-primary">${isEdit ? "Save Changes" : "Add Assignment"}</button>
        </div>
      </form>
    </div>`;
  document.body.appendChild(overlay);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });
  overlay.querySelector('[data-action="cancel"]').addEventListener("click", () => overlay.remove());

  overlay.querySelector("#assignment-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const form = e.target;
    const submitBtn = form.querySelector('button[type="submit"]');
    setButtonLoading(submitBtn, true, "Saving...");

    const payload = {
      subject_id: form.subject_id.value,
      experiment_number: form.experiment_number.value.trim() || null,
      title: form.title.value.trim(),
      description: form.description.value.trim() || null,
    };
    if (!isEdit) payload.status = form.status.value;

    const { error } = isEdit
      ? await supabase.from("assignments").update(payload).eq("id", assignment.id)
      : await supabase.from("assignments").insert(payload);

    setButtonLoading(submitBtn, false);
    if (error) { console.error(error); showToast("Could not save assignment.", "error"); return; }
    showToast(isEdit ? "Assignment updated." : "Assignment added.", "success");
    overlay.remove();
    loadAssignments();
  });
}

init();
