// ============================================================================
// ACCESS — the single source of truth for "who is this and are they allowed
// in". Every protected page calls one of the guard functions below before
// rendering anything. These guards are a UX convenience only — the REAL
// enforcement is Supabase RLS (see supabase/schema.sql). Even if a bug let a
// disallowed page render, the database/storage calls themselves would fail.
// ============================================================================
import { supabase } from "./supabase.js";

/** Returns the current Supabase session, or null if signed out. */
export async function getSession() {
  const { data, error } = await supabase.auth.getSession();
  if (error) {
    console.error("getSession error:", error);
    return null;
  }
  return data.session;
}

/** Returns 'pending' | 'approved' | 'rejected' | 'disabled' | null. */
export async function getAccessStatus(userId) {
  const { data, error } = await supabase
    .from("user_access")
    .select("status")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) {
    console.error("getAccessStatus error:", error);
    return null;
  }
  return data ? data.status : null;
}

/** Returns true if the current user is a member of the admins table. */
export async function checkIsAdmin(userId) {
  const { data, error } = await supabase
    .from("admins")
    .select("user_id")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) {
    console.error("checkIsAdmin error:", error);
    return false;
  }
  return !!data;
}

export async function logout() {
  await supabase.auth.signOut();
  const onAdminPage = window.location.pathname.includes("/admin/");
  window.location.href = onAdminPage ? "../login.html" : "login.html";
}

/** Wires up any element with id="logout-link" found on the page. */
export function attachLogoutHandler() {
  document.addEventListener("click", (e) => {
    const el = e.target.closest("#logout-link");
    if (!el) return;
    e.preventDefault();
    logout();
  });
}

/**
 * Guard for STUDENT pages (dashboard.html, subjects.html, assignment.html).
 * - No session            -> redirect to login.html
 * - Admin                 -> always allowed through (admins can browse the
 *                             student site too)
 * - pending                -> redirect to pending.html
 * - rejected / disabled    -> sign out and redirect to login.html with a
 *                             status message
 * - approved               -> resolves with { user, isAdmin }
 */
export async function requireApproved() {
  const session = await getSession();
  if (!session) {
    window.location.href = "login.html";
    return null;
  }
  const user = session.user;
  const isAdmin = await checkIsAdmin(user.id);
  if (isAdmin) return { user, isAdmin: true };

  const status = await getAccessStatus(user.id);
  if (status === "approved") return { user, isAdmin: false };
  if (status === "pending") {
    window.location.href = "pending.html";
    return null;
  }
  // rejected, disabled, or missing row
  await supabase.auth.signOut();
  const reason = status === "rejected" ? "rejected" : status === "disabled" ? "disabled" : "unavailable";
  window.location.href = `login.html?status=${reason}`;
  return null;
}

/**
 * Guard for ADMIN pages (admin/*.html).
 * - No session   -> redirect to ../login.html
 * - Not an admin -> redirect to ../dashboard.html
 * - Admin        -> resolves with { user }
 */
export async function requireAdmin() {
  const session = await getSession();
  if (!session) {
    window.location.href = "../login.html";
    return null;
  }
  const isAdmin = await checkIsAdmin(session.user.id);
  if (!isAdmin) {
    window.location.href = "../dashboard.html";
    return null;
  }
  return { user: session.user };
}

/**
 * For login/register pages: if the user is already signed in and allowed,
 * skip straight past the auth form to where they belong.
 */
export async function redirectIfAlreadySignedIn() {
  const session = await getSession();
  if (!session) return;
  const isAdmin = await checkIsAdmin(session.user.id);
  if (isAdmin) {
    window.location.href = "dashboard.html";
    return;
  }
  const status = await getAccessStatus(session.user.id);
  if (status === "approved") window.location.href = "dashboard.html";
  else if (status === "pending") window.location.href = "pending.html";
  // rejected/disabled/unknown -> let them stay on the login page
}
