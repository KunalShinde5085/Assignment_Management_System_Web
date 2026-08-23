import { supabase } from "../supabase.js";

import {
  requireAdmin,
  attachLogoutHandler
} from "../access.js";

import {
  renderAdminShell,
  loadingState,
  emptyState,
  errorState,
  escapeHtml,
  formatDate,
  showToast,
  setButtonLoading
} from "../components.js";

import {
  STUDENT_SUBMISSIONS_BUCKET
} from "../config.js";


// ============================================================================
// INIT
// ============================================================================

async function init() {

  attachLogoutHandler();

  const ctx = await requireAdmin();

  if (!ctx) return;

  renderAdminShell(
    "student-submissions.html",
    ctx.user.email
  );

  await loadSubmissions();
}


// ============================================================================
// LOAD SUBMISSIONS
// ============================================================================

async function loadSubmissions() {

  const slot =
    document.getElementById(
      "admin-main-slot"
    );

  slot.innerHTML =
    loadingState(
      "Loading student submissions..."
    );


  const {
    data: submissions,
    error
  } = await supabase
    .from("student_uploads")
    .select(`
      id,
      assignment_id,
      uploaded_by,
      file_name,
      storage_path,
      status,
      created_at,
      assignments (
        title,
        experiment_number,
        subjects (
          name,
          code
        )
      )
    `)
    .order(
      "created_at",
      {
        ascending: false
      }
    );


  if (error) {

    console.error(
      "Student submissions error:",
      error
    );

    slot.innerHTML =
      errorState(
        "Could not load student submissions."
      );

    return;
  }


  // --------------------------------------------------------------------------
  // GET STUDENT EMAILS
  // --------------------------------------------------------------------------

  const userIds = [
    ...new Set(
      (submissions || [])
        .map(
          (submission) =>
            submission.uploaded_by
        )
    )
  ];


  let users = [];


  if (userIds.length > 0) {

    const {
      data,
      error: userError
    } = await supabase
      .from("user_access")
      .select(
        "user_id, email"
      )
      .in(
        "user_id",
        userIds
      );


    if (userError) {

      console.error(
        "Could not load student emails:",
        userError
      );

    } else {

      users = data || [];

    }
  }


  const emailMap =
    new Map(
      users.map(
        (user) => [
          user.user_id,
          user.email
        ]
      )
    );


  renderPage(
    submissions || [],
    emailMap
  );
}


// ============================================================================
// RENDER
// ============================================================================

function renderPage(
  submissions,
  emailMap
) {

  const slot =
    document.getElementById(
      "admin-main-slot"
    );


  slot.innerHTML = `

    <div class="page-header">

      <div>

        <h1>
          Student Submissions
        </h1>

        <p class="subtitle">
          Review files submitted by students.
        </p>

      </div>

    </div>


    <div class="card">

      <div class="card-header">

        <h3>
          Submitted Files
        </h3>

      </div>


      <div id="submissions-mount"></div>

    </div>

  `;


  const mount =
    document.getElementById(
      "submissions-mount"
    );


  if (
    !submissions ||
    submissions.length === 0
  ) {

    mount.innerHTML =
      emptyState(
        "No student submissions yet."
      );

    return;
  }


  mount.innerHTML = `

    <div class="table-wrap">

      <table class="data-table">

        <thead>

          <tr>

            <th>Assignment</th>

            <th>Student</th>

            <th>File</th>

            <th>Status</th>

            <th>Submitted</th>

            <th>Actions</th>

          </tr>

        </thead>


        <tbody>

          ${submissions
            .map(
              (submission) =>
                renderRow(
                  submission,
                  emailMap.get(
                    submission.uploaded_by
                  ) ||
                    submission.uploaded_by
                )
            )
            .join("")}

        </tbody>

      </table>

    </div>

  `;


  // --------------------------------------------------------------------------
  // VIEW
  // --------------------------------------------------------------------------

  mount
    .querySelectorAll(
      "[data-view]"
    )
    .forEach(
      (button) => {

        button.addEventListener(
          "click",
          () =>
            viewFile(
              button.dataset.view
            )
        );

      }
    );


  // --------------------------------------------------------------------------
  // APPROVE
  // --------------------------------------------------------------------------

  mount
    .querySelectorAll(
      "[data-approve]"
    )
    .forEach(
      (button) => {

        button.addEventListener(
          "click",
          async () => {

            await updateStatus(
              button,
              button.dataset.approve,
              "approved"
            );

          }
        );

      }
    );


  // --------------------------------------------------------------------------
  // REJECT
  // --------------------------------------------------------------------------

  mount
    .querySelectorAll(
      "[data-reject]"
    )
    .forEach(
      (button) => {

        button.addEventListener(
          "click",
          async () => {

            await updateStatus(
              button,
              button.dataset.reject,
              "rejected"
            );

          }
        );

      }
    );
}


// ============================================================================
// ROW
// ============================================================================

function renderRow(
  submission,
  email
) {

  const assignment =
    submission.assignments;

  const subject =
    assignment?.subjects;


  let actionButtons = "";


  if (
    submission.status === "pending"
  ) {

    actionButtons = `

      <button
        class="btn btn-primary btn-sm"
        data-approve="${escapeHtml(
          submission.id
        )}"
      >
        Approve
      </button>


      <button
        class="btn btn-secondary btn-sm"
        data-reject="${escapeHtml(
          submission.id
        )}"
      >
        Reject
      </button>

    `;

  }


  return `

    <tr>

      <td>

        <strong>
          ${escapeHtml(
            assignment?.title ||
              "Unknown assignment"
          )}
        </strong>

        <br>

        <small>
          ${escapeHtml(
            subject?.name || ""
          )}

          · Experiment

          ${escapeHtml(
            assignment?.experiment_number ||
              ""
          )}
        </small>

      </td>


      <td>
        ${escapeHtml(email)}
      </td>


      <td>

        <strong>
          ${escapeHtml(
            submission.file_name
          )}
        </strong>

      </td>


      <td>

        <span
          class="badge badge-${escapeHtml(
            submission.status
          )}"
        >
          ${escapeHtml(
            submission.status
          )}
        </span>

      </td>


      <td>

        ${escapeHtml(
          formatDate(
            submission.created_at
          )
        )}

      </td>


      <td>

        <button
          class="btn btn-secondary btn-sm"
          data-view="${escapeHtml(
            submission.id
          )}"
        >
          View
        </button>

        ${actionButtons}

      </td>

    </tr>

  `;
}


// ============================================================================
// APPROVE / REJECT
// ============================================================================

async function updateStatus(
  button,
  id,
  status
) {

  setButtonLoading(
    button,
    true,
    status === "approved"
      ? "Approving..."
      : "Rejecting..."
  );


  const {
    error
  } = await supabase
    .from("student_uploads")
    .update({
      status
    })
    .eq("id", id);


  if (error) {

    console.error(error);

    setButtonLoading(
      button,
      false
    );

    showToast(
      `Could not ${status} submission.`,
      "error"
    );

    return;
  }


  showToast(
    status === "approved"
      ? "Submission approved."
      : "Submission rejected.",
    "success"
  );


  await loadSubmissions();
}


// ============================================================================
// VIEW FILE
// ============================================================================

async function viewFile(
  id
) {

  const {
    data: submission,
    error
  } = await supabase
    .from("student_uploads")
    .select(
      "storage_path, file_name"
    )
    .eq("id", id)
    .maybeSingle();


  if (error || !submission) {

    console.error(error);

    showToast(
      "Could not find this submission.",
      "error"
    );

    return;
  }


  const {
    data,
    error: urlError
  } = await supabase.storage
    .from(
      STUDENT_SUBMISSIONS_BUCKET
    )
    .createSignedUrl(
      submission.storage_path,
      300
    );


  if (urlError || !data) {

    console.error(urlError);

    showToast(
      "Could not open this file.",
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
// START
// ============================================================================

init();
