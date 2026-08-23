// ============================================================================
// AUTH — login.html and register.html page logic.
// ============================================================================
import { supabase } from "./supabase.js";
import { redirectIfAlreadySignedIn, checkIsAdmin, getAccessStatus } from "./access.js";
import { showToast, setButtonLoading, escapeHtml } from "./components.js";

const STATUS_MESSAGES = {
  rejected: "Your registration request was rejected.",
  disabled: "Your account has been disabled.",
  unavailable: "Your account could not be verified. Please contact an administrator.",
};

/* ------------------------------- Login ---------------------------------- */
export async function initLoginPage() {
  await redirectIfAlreadySignedIn();

  const params = new URLSearchParams(window.location.search);
  const status = params.get("status");
  const banner = document.getElementById("login-status-banner");
  if (status && STATUS_MESSAGES[status] && banner) {
    banner.textContent = STATUS_MESSAGES[status];
    banner.classList.remove("hidden");
  }

  const form = document.getElementById("login-form");
  if (!form) return;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const errorBanner = document.getElementById("login-error");
    errorBanner.classList.add("hidden");

    const email = form.email.value.trim();
    const password = form.password.value;
    const submitBtn = form.querySelector('button[type="submit"]');
    setButtonLoading(submitBtn, true, "Signing in...");

    const { data, error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
      setButtonLoading(submitBtn, false);
      errorBanner.textContent = friendlyAuthError(error);
      errorBanner.classList.remove("hidden");
      return;
    }

    const user = data.user;
    const isAdmin = await checkIsAdmin(user.id);
    if (isAdmin) {
      window.location.href = "admin/index.html";
      return;
    }

    const accessStatus = await getAccessStatus(user.id);
    setButtonLoading(submitBtn, false);

    if (accessStatus === "approved") {
      window.location.href = "dashboard.html";
    } else if (accessStatus === "pending") {
      window.location.href = "pending.html";
    } else {
      await supabase.auth.signOut();
      const reason = accessStatus === "rejected" ? "rejected" : accessStatus === "disabled" ? "disabled" : "unavailable";
      window.location.href = `login.html?status=${reason}`;
    }
  });
}

/* ------------------------------ Register --------------------------------- */
export async function initRegisterPage() {
  await redirectIfAlreadySignedIn();

  const form = document.getElementById("register-form");
  if (!form) return;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const errorBanner = document.getElementById("register-error");
    errorBanner.classList.add("hidden");

    const email = form.email.value.trim();
    const password = form.password.value;
    const confirmPassword = form.confirmPassword.value;
    const submitBtn = form.querySelector('button[type="submit"]');

    if (password !== confirmPassword) {
      errorBanner.textContent = "Passwords do not match.";
      errorBanner.classList.remove("hidden");
      return;
    }
    if (password.length < 8) {
      errorBanner.textContent = "Password must be at least 8 characters.";
      errorBanner.classList.remove("hidden");
      return;
    }

    setButtonLoading(submitBtn, true, "Creating account...");
    const { error } = await supabase.auth.signUp({ email, password });
    setButtonLoading(submitBtn, false);

    if (error) {
      errorBanner.textContent = friendlyAuthError(error);
      errorBanner.classList.remove("hidden");
      return;
    }

    // A database trigger (see schema.sql) automatically creates a `pending`
    // user_access row the moment the auth user is created — nothing to do
    // here on the client.
    window.location.href = "pending.html";
  });
}

/* -------------------------------- Pending --------------------------------- */
export async function initPendingPage() {
  const session = (await supabase.auth.getSession()).data.session;
  if (!session) {
    window.location.href = "login.html";
    return;
  }
  const isAdmin = await checkIsAdmin(session.user.id);
  if (isAdmin) {
    window.location.href = "admin/index.html";
    return;
  }
  const status = await getAccessStatus(session.user.id);
  if (status === "approved") window.location.href = "dashboard.html";
  else if (status === "rejected") window.location.href = "login.html?status=rejected";
  else if (status === "disabled") window.location.href = "login.html?status=disabled";
  // else: stay on pending.html
}

/* -------------------------------- Utils ----------------------------------- */
function friendlyAuthError(error) {
  const msg = (error && error.message) || "";
  if (msg.toLowerCase().includes("invalid login credentials")) return "Incorrect email or password.";
  if (msg.toLowerCase().includes("already registered")) return "An account with this email already exists.";
  if (msg.toLowerCase().includes("password")) return msg;
  if (msg.toLowerCase().includes("email")) return msg;
  return "Something went wrong. Please try again.";
}
