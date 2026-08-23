// ============================================================================
// ADMIN · SUBJECTS — admin/subjects.html page logic.
// List, search, add, edit, delete, activate/deactivate.
// ============================================================================
import { supabase } from "../supabase.js";
import { requireAdmin, attachLogoutHandler } from "../access.js";
import {
  renderAdminShell, loadingState, emptyState, errorState, escapeHtml,
  badge, showToast, confirmDialog, setButtonLoading,
} from "../components.js";

let allSubjects = [];

async function init() {
  attachLogoutHandler();
  const ctx = await requireAdmin();
  if (!ctx) return;
  renderAdminShell("subjects.html", ctx.user.email, await countPendingUsers());

  document.getElementById("admin-main-slot").innerHTML = `
    <div class="page-header">
      <div><h1>Subjects</h1><p class="subtitle">Manage the subjects students can browse</p></div>
      <button class="btn btn-primary" id="add-subject-btn">Add Subject</button>
    </div>
    <div class="toolbar">
      <div class="search-bar"><span class="icon">⌕</span><input type="text" id="subject-search" placeholder="Search subjects..."></div>
    </div>
    <div class="card"><div id="subjects-table-mount"></div></div>`;

  document.getElementById("add-subject-btn").addEventListener("click", () => openSubjectForm());
  document.getElementById("subject-search").addEventListener("input", (e) => {
    const q = e.target.value.trim().toLowerCase();
    const filtered = !q ? allSubjects : allSubjects.filter((s) => s.name.toLowerCase().includes(q) || s.code.toLowerCase().includes(q));
    renderTable(filtered);
  });

  loadSubjects();
}

async function countPendingUsers() {
  const { count } = await supabase.from("user_access").select("id", { count: "exact", head: true }).eq("status", "pending");
  return count || 0;
}

async function loadSubjects() {
  const mount = document.getElementById("subjects-table-mount");
  mount.innerHTML = loadingState("Loading subjects...");
  const { data, error } = await supabase.from("subjects").select("*").order("name", { ascending: true });
  if (error) { console.error(error); mount.innerHTML = errorState(); return; }
  allSubjects = data || [];
  renderTable(allSubjects);
}

function renderTable(list) {
  const mount = document.getElementById("subjects-table-mount");
  if (list.length === 0) { mount.innerHTML = emptyState("No subjects found."); return; }
  mount.innerHTML = `
    <div class="table-wrap"><table class="data-table">
      <thead><tr><th>Name</th><th>Code</th><th>Status</th><th></th></tr></thead>
      <tbody>${list.map(subjectRow).join("")}</tbody>
    </table></div>`;
  wireRowActions(mount, list);
}

function subjectRow(s) {
  return `
    <tr data-id="${escapeHtml(s.id)}">
      <td>${escapeHtml(s.name)}</td>
      <td>${escapeHtml(s.code)}</td>
      <td>${badge(s.status)}</td>
      <td><div class="row-actions">
        <button class="btn btn-secondary btn-sm" data-action="edit">Edit</button>
        <button class="btn btn-secondary btn-sm" data-action="toggle">${s.status === "active" ? "Deactivate" : "Activate"}</button>
        <button class="btn btn-danger btn-sm" data-action="delete">Delete</button>
      </div></td>
    </tr>`;
}

function wireRowActions(mount, list) {
  mount.querySelectorAll("button[data-action]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.closest("tr").dataset.id;
      const subject = list.find((s) => s.id === id);
      const action = btn.dataset.action;

      if (action === "edit") return openSubjectForm(subject);
      if (action === "toggle") return toggleStatus(subject);
      if (action === "delete") return deleteSubject(subject);
    });
  });
}

async function toggleStatus(subject) {
  const newStatus = subject.status === "active" ? "inactive" : "active";
  const { error } = await supabase.from("subjects").update({ status: newStatus }).eq("id", subject.id);
  if (error) { console.error(error); showToast("Could not update subject.", "error"); return; }
  showToast(`Subject marked ${newStatus}.`, "success");
  loadSubjects();
}

async function deleteSubject(subject) {
  const { count } = await supabase.from("assignments").select("id", { count: "exact", head: true }).eq("subject_id", subject.id);
  const hasContent = (count || 0) > 0;
  const ok = await confirmDialog({
    title: "Delete this subject?",
    message: hasContent
      ? `This subject has ${count} associated assignment(s). Deleting it will also remove those assignments and their files. This cannot be undone.`
      : "This cannot be undone.",
    confirmLabel: "Delete Permanently",
  });
  if (!ok) return;

  // Assignments/files cascade via the foreign key ON DELETE CASCADE in
  // schema.sql. Storage objects for those files are NOT auto-deleted by
  // Postgres (Storage lives outside the DB) — clean those up first.
  await deleteStorageForSubject(subject.id);

  const { error } = await supabase.from("subjects").delete().eq("id", subject.id);
  if (error) { console.error(error); showToast("Could not delete subject.", "error"); return; }
  showToast("Subject deleted.", "success");
  loadSubjects();
}

async function deleteStorageForSubject(subjectId) {
  const { data: assignments } = await supabase.from("assignments").select("id").eq("subject_id", subjectId);
  if (!assignments || assignments.length === 0) return;
  const assignmentIds = assignments.map((a) => a.id);
  const { data: files } = await supabase.from("files").select("storage_path").in("assignment_id", assignmentIds);
  if (files && files.length > 0) {
    await supabase.storage.from("assignments").remove(files.map((f) => f.storage_path));
  }
}

function openSubjectForm(subject = null) {
  const isEdit = !!subject;
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true">
      <h3>${isEdit ? "Edit Subject" : "Add Subject"}</h3>
      <form id="subject-form">
        <div class="field"><label>Subject Name</label><input type="text" name="name" required value="${escapeHtml(subject?.name || "")}"></div>
        <div class="field"><label>Subject Code</label><input type="text" name="code" required value="${escapeHtml(subject?.code || "")}"></div>
        <div class="field"><label>Description</label><textarea name="description">${escapeHtml(subject?.description || "")}</textarea></div>
        <div class="field"><label>Status</label>
          <select name="status">
            <option value="active" ${subject?.status !== "inactive" ? "selected" : ""}>Active</option>
            <option value="inactive" ${subject?.status === "inactive" ? "selected" : ""}>Inactive</option>
          </select>
        </div>
        <div class="modal-actions">
          <button type="button" class="btn btn-secondary" data-action="cancel">Cancel</button>
          <button type="submit" class="btn btn-primary">${isEdit ? "Save Changes" : "Add Subject"}</button>
        </div>
      </form>
    </div>`;
  document.body.appendChild(overlay);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });
  overlay.querySelector('[data-action="cancel"]').addEventListener("click", () => overlay.remove());

  overlay.querySelector("#subject-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const form = e.target;
    const submitBtn = form.querySelector('button[type="submit"]');
    setButtonLoading(submitBtn, true, "Saving...");

    const payload = {
      name: form.name.value.trim(),
      code: form.code.value.trim(),
      description: form.description.value.trim() || null,
      status: form.status.value,
    };

    const { error } = isEdit
      ? await supabase.from("subjects").update(payload).eq("id", subject.id)
      : await supabase.from("subjects").insert(payload);

    setButtonLoading(submitBtn, false);
    if (error) {
      console.error(error);
      showToast(error.message.includes("duplicate") ? "That subject code is already in use." : "Could not save subject.", "error");
      return;
    }
    showToast(isEdit ? "Subject updated." : "Subject added.", "success");
    overlay.remove();
    loadSubjects();
  });
}

init();
