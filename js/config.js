// ============================================================================
// CONFIG — public, browser-safe Supabase project settings.
// ============================================================================
// Get these two values from: Supabase Dashboard > Project Settings > API.
// The "anon public" key is safe to expose in frontend code — it is NOT the
// service_role key. NEVER put a service_role key anywhere in this project.
// ============================================================================
export const SUPABASE_URL = "https://ryjithgeurtaenilipss.supabase.co";
export const SUPABASE_ANON_KEY = "sb_publishable_XMdedAZAF_-bmasuBSPyig_Uc2cY_mZ";

// Name of the Storage bucket created by supabase/schema.sql. Change only if
// you also change it in schema.sql.
export const STORAGE_BUCKET = "assignments";

export const STUDENT_SUBMISSIONS_BUCKET = "student-submissions";

// File upload restrictions (Section 17/18 of the spec). Edit freely.
export const ALLOWED_FILE_EXTENSIONS = [
  "pdf", "doc", "docx", "ppt", "pptx", "zip", "txt", "c", "cpp", "py", "java"
];
export const MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024; // 25 MB
