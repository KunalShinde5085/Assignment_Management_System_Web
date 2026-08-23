// ============================================================================
// ASSIGNMENTS — assignment.html page logic (student).
// Shows assignment files + student upload for admin approval
// + approved student files.
// ============================================================================

import { supabase } from "./supabase.js";
import { requireApproved, attachLogoutHandler } from "./access.js";

import {
  STORAGE_BUCKET,
  STUDENT_SUBMISSIONS_BUCKET,
  ALLOWED_FILE_EXTENSIONS,
  MAX_FILE_SIZE_BYTES,
} from "./config.js";

import {
  renderStudentNav,
  loadingState,
  emptyState,
  errorState,
  escapeHtml,
  formatBytes,
  showToast,
} from "./components.js";

const SIGNED_URL_TTL_SECONDS = 60 * 5;


// ============================================================================
// INIT
// ============================================================================

async function init() {
  attachLogoutHandler();

  const ctx = await requireApproved();
  if (!ctx) return;

  renderStudentNav("subjects.html", ctx.user.email);

  const assignmentId =
    new URLSearchParams(window.location.search).get("id");

  const root =
    document.getElementById("assignment-root");

  if (!assignmentId) {
    root.innerHTML =
      errorState("No assignment specified.");
    return;
  }

  root.innerHTML =
    loadingState("Loading assignment...");


  // ==========================================================================
  // LOAD ASSIGNMENT
  // ==========================================================================

  const {
    data: assignment,
    error,
  } = await supabase
    .from("assignments")
    .select(`
      id,
      title,
      experiment_number,
      description,
      subject_id,
      subjects(id, name, code)
    `)
    .eq("id", assignmentId)
    .eq("status", "approved")
    .maybeSingle();

  if (error) {
    console.error(error);
    root.innerHTML = errorState();
    return;
  }

  if (!assignment) {
    root.innerHTML =
      errorState(
        "Assignment not found or is unavailable."
      );
    return;
  }


  const subject = assignment.subjects;


  // ==========================================================================
  // LOAD EXISTING ADMIN FILES
  // ==========================================================================

  const {
    data: files,
    error: fError,
  } = await supabase
    .from("files")
    .select(
      "id, file_name, storage_path, file_type, file_size"
    )
    .eq("assignment_id", assignmentId)
    .order("file_name", {
      ascending: true,
    });


  // ==========================================================================
  // LOAD APPROVED STUDENT FILES
  // ==========================================================================

  const {
    data: approvedStudentFiles,
    error: studentFilesError,
  } = await supabase
    .from("student_uploads")
    .select(`
      id,
      assignment_id,
      uploaded_by,
      file_name,
      storage_path,
      status,
      created_at
    `)
    .eq("assignment_id", assignmentId)
    .eq("status", "approved")
    .order("created_at", {
      ascending: false,
    });

  if (studentFilesError) {
    console.error(
      "Could not load approved student files:",
      studentFilesError
    );
  }


  // ==========================================================================
  // RENDER PAGE
  // ==========================================================================

  root.innerHTML = `
    <div class="breadcrumbs">
      <a href="subjects.html">Subjects</a>

      <span class="sep">/</span>

      <a href="subjects.html?id=${encodeURIComponent(
        subject?.id || ""
      )}">
        ${escapeHtml(subject?.name || "")}
      </a>

      <span class="sep">/</span>

      <span class="current">
        Experiment ${escapeHtml(
          assignment.experiment_number || ""
        )}
      </span>
    </div>


    <div class="assignment-detail-header">

      <div class="exp-eyebrow">
        ${escapeHtml(subject?.name || "")}
        · Experiment
        ${escapeHtml(
          assignment.experiment_number || ""
        )}
      </div>

      <h1>
        ${escapeHtml(assignment.title)}
      </h1>

      <p>
        ${escapeHtml(
          assignment.description || ""
        )}
      </p>

    </div>


    <!-- ================================================================ -->
    <!-- EXISTING ADMIN FILES                                             -->
    <!-- ================================================================ -->

    <h2>Files</h2>

    <div id="assignment-files"></div>


    <!-- ================================================================ -->
    <!-- STUDENT UPLOAD                                                   -->
    <!-- ================================================================ -->

    <div
      class="card"
      style="margin-top:24px;"
    >

      <div class="card-header">
        <h3>Submit Your Work</h3>
      </div>

      <div class="card-pad">

        <p>
          Upload your completed assignment.
          Your file will be sent to the admin
          for approval.
        </p>

        <form id="student-upload-form">

          <input
            type="file"
            id="student-upload-file"
            required
          >

          <button
            type="submit"
            class="btn btn-primary"
            id="student-upload-button"
          >
            Send to Admin
          </button>

          <div
            id="student-upload-message"
            class="form-message"
          ></div>

        </form>

      </div>

    </div>


    <!-- ================================================================ -->
    <!-- APPROVED STUDENT FILES                                           -->
    <!-- ================================================================ -->

    <div style="margin-top:32px;">

      <h2>
        Student Submissions
      </h2>

      <div id="approved-student-files"></div>

    </div>
  `;


  // ==========================================================================
  // EXISTING ADMIN FILES
  // ==========================================================================

  const filesMount =
    document.getElementById(
      "assignment-files"
    );

  if (fError) {
    console.error(fError);
    filesMount.innerHTML =
      errorState();
  } else if (!files || files.length === 0) {

    filesMount.innerHTML =
      emptyState(
        "No files have been added to this assignment yet."
      );

  } else {

    filesMount.innerHTML = `
      <div class="file-list">
        ${files.map(fileRow).join("")}
      </div>
    `;

    filesMount
      .querySelectorAll("[data-preview]")
      .forEach((btn) =>
        btn.addEventListener(
          "click",
          () =>
            handlePreview(
              btn.dataset.path
            )
        )
      );

    filesMount
      .querySelectorAll("[data-download]")
      .forEach((btn) =>
        btn.addEventListener(
          "click",
          () =>
            handleDownload(
              btn.dataset.path,
              btn.dataset.name
            )
        )
      );
  }


  // ==========================================================================
  // STUDENT UPLOAD FORM
  // ==========================================================================

  const uploadForm =
    document.getElementById(
      "student-upload-form"
    );

  if (uploadForm) {

    uploadForm.addEventListener(
      "submit",
      async (event) => {

        event.preventDefault();

        await uploadStudentFile(
          assignmentId
        );

      }
    );
  }


  // ==========================================================================
  // APPROVED STUDENT FILES
  // ==========================================================================

  renderApprovedStudentFiles(
    approvedStudentFiles || []
  );
}


// ============================================================================
// EXISTING ADMIN FILE ROW
// ============================================================================

function fileRow(f) {

  const ext =
    (
      f.file_type ||
      f.file_name.split(".").pop() ||
      ""
    ).toUpperCase();

  return `
    <div class="file-row">

      <div class="file-icon">
        ${escapeHtml(ext.slice(0, 4))}
      </div>

      <div class="info">

        <div class="name">
          ${escapeHtml(f.file_name)}
        </div>

        <div class="meta">
          ${escapeHtml(ext)}
          ·
          ${formatBytes(f.file_size)}
        </div>

      </div>

      <div class="actions">

        <button
          class="btn btn-secondary btn-sm"
          data-preview
          data-path="${escapeHtml(
            f.storage_path
          )}"
        >
          Preview
        </button>

        <button
          class="btn btn-primary btn-sm"
          data-download
          data-path="${escapeHtml(
            f.storage_path
          )}"
          data-name="${escapeHtml(
            f.file_name
          )}"
        >
          Download
        </button>

      </div>

    </div>
  `;
}


// ============================================================================
// STUDENT FILE UPLOAD
// ============================================================================

async function uploadStudentFile(
  assignmentId
) {

  const input =
    document.getElementById(
      "student-upload-file"
    );

  const button =
    document.getElementById(
      "student-upload-button"
    );

  const message =
    document.getElementById(
      "student-upload-message"
    );

  const file = input.files[0];

  if (!file) {

    message.textContent =
      "Please choose a file.";

    return;
  }


  // --------------------------------------------------------------------------
  // GET CURRENT USER
  // --------------------------------------------------------------------------

  const {
    data: {
      user,
    },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {

    message.textContent =
      "Please log in first.";

    return;
  }


  button.disabled = true;
  button.textContent =
    "Sending...";


  // --------------------------------------------------------------------------
  // CLEAN FILE NAME
  // --------------------------------------------------------------------------

  const safeName =
    file.name.replace(
      /[^a-zA-Z0-9._-]/g,
      "_"
    );


  // --------------------------------------------------------------------------
  // STORAGE PATH
  // --------------------------------------------------------------------------

  const storagePath =
    `${user.id}/${assignmentId}/${Date.now()}-${safeName}`;


  // --------------------------------------------------------------------------
  // UPLOAD FILE
  // --------------------------------------------------------------------------

  const {
    error: uploadError,
  } = await supabase.storage
    .from(
      STUDENT_SUBMISSIONS_BUCKET
    )
    .upload(
      storagePath,
      file
    );


  if (uploadError) {

    console.error(
      "Student upload error:",
      uploadError
    );

    message.textContent =
      "Could not upload the file.";

    button.disabled = false;
    button.textContent =
      "Send to Admin";

    return;
  }


  // --------------------------------------------------------------------------
  // SAVE DATABASE RECORD
  // --------------------------------------------------------------------------

  const {
    error: dbError,
  } = await supabase
    .from("student_uploads")
    .insert({
      assignment_id:
        assignmentId,

      uploaded_by:
        user.id,

      file_name:
        file.name,

      storage_path:
        storagePath,

      status:
        "pending",
    });


  // --------------------------------------------------------------------------
  // DATABASE ERROR → REMOVE UPLOADED FILE
  // --------------------------------------------------------------------------

  if (dbError) {

    console.error(
      "Student upload database error:",
      dbError
    );

    await supabase.storage
      .from(
        STUDENT_SUBMISSIONS_BUCKET
      )
      .remove([
        storagePath,
      ]);

    message.textContent =
      "Could not send the file for approval.";

    button.disabled = false;
    button.textContent =
      "Send to Admin";

    return;
  }


  // --------------------------------------------------------------------------
  // SUCCESS
  // --------------------------------------------------------------------------

  message.textContent =
    "✓ File sent to admin for approval.";

  input.value = "";

  button.disabled = false;

  button.textContent =
    "Send to Admin";
}


// ============================================================================
// RENDER APPROVED STUDENT FILES
// ============================================================================

function renderApprovedStudentFiles(
  files
) {

  const mount =
    document.getElementById(
      "approved-student-files"
    );

  if (!mount) return;


  if (!files || files.length === 0) {

    mount.innerHTML =
      emptyState(
        "No approved student files yet."
      );

    return;
  }


  mount.innerHTML = `
    <div class="file-list">

      ${files
        .map(
          (file) => `
            <div class="file-row">

              <div class="file-icon">
                ${escapeHtml(
                  (
                    file.file_name
                      .split(".")
                      .pop() || ""
                  )
                    .toUpperCase()
                    .slice(0, 4)
                )}
              </div>

              <div class="info">

                <div class="name">
                  ${escapeHtml(
                    file.file_name
                  )}
                </div>

                <div class="meta">
                  Approved student submission
                </div>

              </div>

              <div class="actions">

                <button
                  class="btn btn-primary btn-sm"
                  data-student-download
                  data-student-file-id="${escapeHtml(
                    file.id
                  )}"
                >
                  Download
                </button>

              </div>

            </div>
          `
        )
        .join("")}

    </div>
  `;


  mount
    .querySelectorAll(
      "[data-student-download]"
    )
    .forEach((btn) => {

      btn.addEventListener(
        "click",
        () => {

          const file =
            files.find(
              (item) =>
                item.id ===
                btn.dataset
                  .studentFileId
            );

          if (file) {
            downloadStudentFile(file);
          }

        }
      );

    });
}


// ============================================================================
// DOWNLOAD APPROVED STUDENT FILE
// ============================================================================

async function downloadStudentFile(
  file
) {

  const {
    data,
    error,
  } = await supabase.storage
    .from(
      STUDENT_SUBMISSIONS_BUCKET
    )
    .createSignedUrl(
      file.storage_path,
      SIGNED_URL_TTL_SECONDS,
      {
        download:
          file.file_name,
      }
    );


  if (error || !data) {

    console.error(error);

    showToast(
      "Unable to download this file.",
      "error"
    );

    return;
  }


  window.location.href =
    data.signedUrl;
}


// ============================================================================
// PREVIEW EXISTING ADMIN FILE
// ============================================================================

async function handlePreview(
  path
) {

  const {
    data,
    error,
  } = await supabase.storage
    .from(STORAGE_BUCKET)
    .createSignedUrl(
      path,
      SIGNED_URL_TTL_SECONDS
    );


  if (error || !data) {

    console.error(error);

    showToast(
      "Unable to preview this file.",
      "error"
    );

    return;
  }


  window.open(
    data.signedUrl,
    "_blank",
    "noopener"
  );
}


// ============================================================================
// DOWNLOAD EXISTING ADMIN FILE
// ============================================================================

async function handleDownload(
  path,
  fileName
) {

  const {
    data,
    error,
  } = await supabase.storage
    .from(STORAGE_BUCKET)
    .createSignedUrl(
      path,
      SIGNED_URL_TTL_SECONDS,
      {
        download:
          fileName,
      }
    );


  if (error || !data) {

    console.error(error);

    showToast(
      "Unable to download this file.",
      "error"
    );

    return;
  }


  window.location.href =
    data.signedUrl;
}


// ============================================================================
// START
// ============================================================================

init();
