// ============================================================================
// ASSIGNMENTS — assignment.html page logic (student).
// Shows one assignment's detail plus its files, with preview + download.
// ============================================================================
import { supabase } from "./supabase.js";
import { requireApproved, attachLogoutHandler } from "./access.js";
import { STORAGE_BUCKET } from "./config.js";
import {
  renderStudentNav, loadingState, emptyState, errorState,
  escapeHtml, formatBytes, showToast,
} from "./components.js";

const SIGNED_URL_TTL_SECONDS = 60 * 5; // 5 minutes

async function init() {
  attachLogoutHandler();
  const ctx = await requireApproved();
  if (!ctx) return;
  renderStudentNav("subjects.html", ctx.user.email);

  const assignmentId = new URLSearchParams(window.location.search).get("id");
  const root = document.getElementById("assignment-root");
  if (!assignmentId) {
    root.innerHTML = errorState("No assignment specified.");
    return;
  }
  root.innerHTML = loadingState("Loading assignment...");

  const { data: assignment, error } = await supabase
    .from("assignments")
    .select("id, title, experiment_number, description, subject_id, subjects(id, name, code)")
    .eq("id", assignmentId)
    .eq("status", "approved")
    .maybeSingle();

  if (error) {
    console.error(error);
    root.innerHTML = errorState();
    return;
  }
  if (!assignment) {
    root.innerHTML = errorState("Assignment not found or is unavailable.");
    return;
  }

  const subject = assignment.subjects;

  const { data: files, error: fError } = await supabase
    .from("files")
    .select("id, file_name, storage_path, file_type, file_size")
    .eq("assignment_id", assignmentId)
    .order("file_name", { ascending: true });

  root.innerHTML = `
    <div class="breadcrumbs">
      <a href="subjects.html">Subjects</a>
      <span class="sep">/</span>
      <a href="subjects.html?id=${encodeURIComponent(subject?.id || "")}">${escapeHtml(subject?.name || "")}</a>
      <span class="sep">/</span>
      <span class="current">Experiment ${escapeHtml(assignment.experiment_number || "")}</span>
    </div>
    <div class="assignment-detail-header">
      <div class="exp-eyebrow">${escapeHtml(subject?.name || "")} · Experiment ${escapeHtml(assignment.experiment_number || "")}</div>
      <h1>${escapeHtml(assignment.title)}</h1>
      <p>${escapeHtml(assignment.description || "")}</p>
    </div>
    <h2>Files</h2>
    <div id="assignment-files"></div>`;

  const filesMount = document.getElementById("assignment-files");
  if (fError) {
    console.error(fError);
    filesMount.innerHTML = errorState();
    return;
  }
  if (!files || files.length === 0) {
    filesMount.innerHTML = emptyState("No files have been added to this assignment yet.");
    return;
  }
  filesMount.innerHTML = `<div class="file-list">${files.map(fileRow).join("")}</div>`;

  filesMount.querySelectorAll("[data-preview]").forEach((btn) =>
    btn.addEventListener("click", () => handlePreview(btn.dataset.path))
  );
  filesMount.querySelectorAll("[data-download]").forEach((btn) =>
    btn.addEventListener("click", () => handleDownload(btn.dataset.path, btn.dataset.name))
  );
}

function fileRow(f) {
  const ext = (f.file_type || f.file_name.split(".").pop() || "").toUpperCase();
  return `
    <div class="file-row">
      <div class="file-icon">${escapeHtml(ext.slice(0, 4))}</div>
      <div class="info">
        <div class="name">${escapeHtml(f.file_name)}</div>
        <div class="meta">${escapeHtml(ext)} · ${formatBytes(f.file_size)}</div>
      </div>
      <div class="actions">
        <button class="btn btn-secondary btn-sm" data-preview data-path="${escapeHtml(f.storage_path)}">Preview</button>
        <button class="btn btn-primary btn-sm" data-download data-path="${escapeHtml(f.storage_path)}" data-name="${escapeHtml(f.file_name)}">Download</button>
      </div>
    </div>`;
}

async function handlePreview(path) {
  const { data, error } = await supabase.storage
    .from(STORAGE_BUCKET)
    .createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
  if (error || !data) {
    console.error(error);
    showToast("Unable to preview this file.", "error");
    return;
  }
  window.open(data.signedUrl, "_blank", "noopener");
}

async function handleDownload(path, fileName) {
  const { data, error } = await supabase.storage
    .from(STORAGE_BUCKET)
    .createSignedUrl(path, SIGNED_URL_TTL_SECONDS, { download: fileName });
  if (error || !data) {
    console.error(error);
    showToast("Unable to download this file.", "error");
    return;
  }
  window.location.href = data.signedUrl;
}

init();
