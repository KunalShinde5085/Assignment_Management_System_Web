// ============================================================================
// ADMIN · UPLOADS — admin/uploads.html page logic. Upload, replace, delete,
// view, and download files for one assignment (?assignment_id=<uuid>).
// Implements Section 18 (file validation) and Section 19 (safe deletion).
// ============================================================================
import { supabase } from "../supabase.js";
import { requireAdmin, attachLogoutHandler } from "../access.js";
import { STORAGE_BUCKET, ALLOWED_FILE_EXTENSIONS, MAX_FILE_SIZE_BYTES } from "../config.js";
import {
  renderAdminShell, loadingState, emptyState, errorState, escapeHtml,
  formatBytes, showToast, confirmDialog, setButtonLoading,
} from "../components.js";

let assignment = null;

async function init() {
  attachLogoutHandler();
  const ctx = await requireAdmin();
  if (!ctx) return;

  const assignmentId = new URLSearchParams(window.location.search).get("assignment_id");
  const pendingCount = await countPendingUsers();
  renderAdminShell("assignments.html", ctx.user.email, pendingCount);

  const slot = document.getElementById("admin-main-slot");
  if (!assignmentId) {
    slot.innerHTML = errorState("No assignment specified.");
    return;
  }
  slot.innerHTML = loadingState("Loading assignment...");

  const { data, error } = await supabase
    .from("assignments")
    .select("id, title, experiment_number, subject_id, subjects(name, code)")
    .eq("id", assignmentId)
    .maybeSingle();

  if (error || !data) {
    console.error(error);
    slot.innerHTML = errorState("Assignment not found.");
    return;
  }
  assignment = data;

  slot.innerHTML = `
    <div class="breadcrumbs">
      <a href="assignments.html">Assignments</a>
      <span class="sep">/</span>
      <span class="current">${escapeHtml(assignment.title)}</span>
    </div>
    <div class="page-header">
      <div>
        <h1>${escapeHtml(assignment.title)}</h1>
        <p class="subtitle">${escapeHtml(assignment.subjects?.name || "")} · Experiment ${escapeHtml(assignment.experiment_number || "")}</p>
      </div>
    </div>

    <div class="card" style="margin-bottom:20px;">
      <div class="card-header"><h3>Upload a file</h3></div>
      <div class="card-pad">
        <form id="upload-form">
          <div class="field">
            <label>File</label>
            <input type="file" name="file" id="upload-file-input" required>
            <div class="hint">Allowed: ${ALLOWED_FILE_EXTENSIONS.join(", ").toUpperCase()}. Max ${formatBytes(MAX_FILE_SIZE_BYTES)}.</div>
          </div>
          <div id="upload-error" class="form-error-banner hidden"></div>
          <button type="submit" class="btn btn-primary" id="upload-submit-btn">Upload File</button>
        </form>
      </div>
    </div>

    <div class="card">
      <div class="card-header"><h3>Files</h3></div>
      <div id="files-mount"></div>
    </div>`;

  document.getElementById("upload-form").addEventListener("submit", handleUpload);
  loadFiles();
}

async function countPendingUsers() {
  const { count } = await supabase.from("user_access").select("id", { count: "exact", head: true }).eq("status", "pending");
  return count || 0;
}

/* ------------------------------ Validation -------------------------------- */
function validateFile(file) {
  const ext = file.name.split(".").pop().toLowerCase();
  if (!ALLOWED_FILE_EXTENSIONS.includes(ext)) {
    return `Only ${ALLOWED_FILE_EXTENSIONS.join(", ").toUpperCase()} files are allowed.`;
  }
  if (file.size > MAX_FILE_SIZE_BYTES) {
    return `File is too large. Maximum size is ${formatBytes(MAX_FILE_SIZE_BYTES)}.`;
  }
  if (!file.name || file.name.trim().length === 0) {
    return "Invalid filename.";
  }
  return null;
}

function sanitizeFileName(name) {
  return name.trim().replace(/[^a-zA-Z0-9._-]/g, "_");
}

/* -------------------------------- Upload ---------------------------------- */
async function handleUpload(e) {
  e.preventDefault();
  const form = e.target;
  const input = document.getElementById("upload-file-input");
  const errorBanner = document.getElementById("upload-error");
  const submitBtn = document.getElementById("upload-submit-btn");
  errorBanner.classList.add("hidden");

  const file = input.files[0];
  if (!file) {
    errorBanner.textContent = "Please choose a file.";
    errorBanner.classList.remove("hidden");
    return;
  }
  const validationError = validateFile(file);
  if (validationError) {
    errorBanner.textContent = validationError;
    errorBanner.classList.remove("hidden");
    return;
  }

  setButtonLoading(submitBtn, true, "Uploading...");

  const safeName = sanitizeFileName(file.name);
  const subjectCode = assignment.subjects?.code || "MISC";
  const expNumber = assignment.experiment_number || "EXP";
  const storagePath = `${subjectCode}/EXP${expNumber}/${Date.now()}-${safeName}`;

  const { error: uploadError } = await supabase.storage
    .from(STORAGE_BUCKET)
    .upload(storagePath, file, { cacheControl: "3600", upsert: false });

  if (uploadError) {
    console.error(uploadError);
    setButtonLoading(submitBtn, false);
    errorBanner.textContent = "Upload failed. Please try again.";
    errorBanner.classList.remove("hidden");
    return;
  }

  const { error: dbError } = await supabase.from("files").insert({
    assignment_id: assignment.id,
    file_name: file.name,
    storage_path: storagePath,
    file_type: file.name.split(".").pop().toLowerCase(),
    file_size: file.size,
  });

  setButtonLoading(submitBtn, false);

  if (dbError) {
    console.error(dbError);
    // Don't leave an orphaned storage object if the DB insert failed.
    await supabase.storage.from(STORAGE_BUCKET).remove([storagePath]);
    errorBanner.textContent = "Upload failed. Please try again.";
    errorBanner.classList.remove("hidden");
    return;
  }

  showToast("File uploaded.", "success");
  form.reset();
  loadFiles();
}

/* --------------------------------- List ------------------------------------ */
async function loadFiles() {
  const mount = document.getElementById("files-mount");
  mount.innerHTML = loadingState("Loading files...");
  const { data, error } = await supabase
    .from("files")
    .select("id, file_name, storage_path, file_type, file_size, created_at")
    .eq("assignment_id", assignment.id)
    .order("created_at", { ascending: false });

  if (error) { console.error(error); mount.innerHTML = errorState(); return; }
  if (!data || data.length === 0) { mount.innerHTML = emptyState("No files uploaded yet."); return; }

  mount.innerHTML = `
    <div class="table-wrap"><table class="data-table">
      <thead><tr><th>File</th><th>Type</th><th>Size</th><th>Uploaded</th><th></th></tr></thead>
      <tbody>${data.map(fileRow).join("")}</tbody>
    </table></div>`;

  wireFileActions(mount, data);
}

function fileRow(f) {
  return `
    <tr data-id="${escapeHtml(f.id)}" data-path="${escapeHtml(f.storage_path)}">
      <td>${escapeHtml(f.file_name)}</td>
      <td>${escapeHtml((f.file_type || "").toUpperCase())}</td>
      <td>${formatBytes(f.file_size)}</td>
      <td>${new Date(f.created_at).toLocaleDateString()}</td>
      <td><div class="row-actions">
        <button class="btn btn-secondary btn-sm" data-action="view">View</button>
        <button class="btn btn-secondary btn-sm" data-action="download">Download</button>
        <button class="btn btn-danger btn-sm" data-action="delete">Delete</button>
      </div></td>
    </tr>`;
}

function wireFileActions(mount, files) {
  mount.querySelectorAll("button[data-action]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const row = btn.closest("tr");
      const id = row.dataset.id;
      const path = row.dataset.path;
      const file = files.find((f) => f.id === id);
      const action = btn.dataset.action;

      if (action === "view") return openSignedUrl(path);
      if (action === "download") return openSignedUrl(path, file.file_name);
      if (action === "delete") return deleteFile(id, path);
    });
  });
}

async function openSignedUrl(path, downloadName = null) {
  const opts = downloadName ? { download: downloadName } : {};
  const { data, error } = await supabase.storage.from(STORAGE_BUCKET).createSignedUrl(path, 300, opts);
  if (error || !data) { console.error(error); showToast("Could not open file.", "error"); return; }
  window.open(data.signedUrl, "_blank", "noopener");
}

async function deleteFile(id, path) {
  const ok = await confirmDialog({
    title: "Delete this file?",
    message: "Are you sure you want to permanently delete this file?",
    confirmLabel: "Delete Permanently",
  });
  if (!ok) return;

  const { error: storageError } = await supabase.storage.from(STORAGE_BUCKET).remove([path]);
  if (storageError) console.error(storageError); // continue — still try to remove the DB record

  const { error: dbError } = await supabase.from("files").delete().eq("id", id);
  if (dbError) { console.error(dbError); showToast("Could not delete file record.", "error"); return; }

  showToast("File deleted.", "success");
  loadFiles();
}

init();
