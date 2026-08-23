# Assignment Repository — Version 1

A minimal, secure college assignment/experiment repository built with plain
HTML5, CSS3, and vanilla ES6 JavaScript modules, backed entirely by Supabase
(Auth, Postgres, Storage, Row Level Security). No frameworks, no build step,
no Node backend — this is a static site you can host anywhere.

---

## 1. Project overview

Registered users must be approved by an administrator before they can browse
subjects, view approved assignments, or download approved files.
Administrators have full control over subjects, assignments, files, and
registered users. See `supabase/schema.sql` for the complete data model and
security rules — that file is the source of truth for what is and isn't
allowed, enforced at the database level via Row Level Security, not just in
the UI.

## 2. Folder structure

```
assignment-portal/
  index.html            entry point — redirects based on session/status
  login.html
  register.html
  pending.html
  dashboard.html
  subjects.html          list view (no query) + subject detail (?id=)
  assignment.html         ?id=<assignment uuid>

  admin/
    index.html            stats + pending approvals
    users.html             approve / reject / disable / delete users
    subjects.html           subject CRUD
    assignments.html        assignment CRUD + approve/reject/publish
    uploads.html            ?assignment_id=<uuid> — file management

  css/
    global.css      design tokens, reset, layout, buttons, forms, tables
    components.css   toast, modal, spinner, empty/error states
    auth.css         login/register/pending
    dashboard.css    student dashboard/subjects/assignment
    admin.css        admin sidebar shell + admin-specific layout

  js/
    config.js        <- put your Supabase URL + anon key here
    supabase.js      shared Supabase client
    access.js        auth guards (requireApproved / requireAdmin / etc.)
    auth.js          login / register / pending logic
    components.js    toast/modal/nav render helpers
    dashboard.js
    subjects.js
    assignments.js

    admin/
      admin.js       admin dashboard stats
      users.js
      subjects.js
      assignments.js
      uploads.js

  supabase/
    schema.sql       full DB schema, RLS policies, storage policies

  assets/
    logo/
    icons/
```

## 3–7. Supabase / database / storage / authentication setup

1. Create a project at [supabase.com](https://supabase.com).
2. Go to **SQL Editor** and run the entire contents of `supabase/schema.sql`
   once. This creates every table, index, trigger, RLS policy, storage
   bucket, and storage policy in one pass — you never need to click through
   the table editor manually.
3. Go to **Authentication > Providers** and make sure **Email** is enabled.
   For local development you may want to disable "Confirm email" so you can
   test registration/approval immediately; re-enable it for production.
4. Go to **Authentication > URL Configuration** and set your site URL (e.g.
   `http://localhost:5500` while developing).

The `assignments` Storage bucket and every RLS/storage policy already exist
after step 2 — nothing else to configure.

## 8. Configuration instructions

Open `js/config.js` and fill in:

```js
export const SUPABASE_URL = "https://YOUR-PROJECT-REF.supabase.co";
export const SUPABASE_ANON_KEY = "YOUR-PUBLIC-ANON-KEY";
```

Both values are on **Project Settings > API** in your Supabase dashboard.
Use the **anon public** key only — never the `service_role` key, which must
never appear in frontend code.

## 9. Admin setup — creating the first administrator

There is deliberately no "make me admin" button or role field anywhere in
this app. To create your first admin:

1. Register a normal account through `register.html` (it will sit in
   `pending` status — that's expected).
2. In the Supabase Dashboard, go to **Authentication > Users** and copy that
   user's UUID.
3. In the **SQL Editor**, run:

```sql
insert into public.admins (user_id) values ('<uuid>');
update public.user_access set status = 'approved' where user_id = '<uuid>';
```

That account can now sign in at `login.html` and will be routed straight to
`admin/index.html`.

## 10. How to run locally

This is a static site — any local web server works (it must be served over
HTTP, not opened as a `file://` URL, for ES module imports to work):

```bash
# from the project root
npx serve .
# or
python3 -m http.server 5500
```

Then visit `http://localhost:5500`.

## 11. How to deploy

Deploy the whole folder to any static host — Netlify, Vercel, GitHub Pages,
Cloudflare Pages, or a plain Nginx/Apache server. There is no build step:
just upload the files as-is. Remember to add your deployed URL to
**Authentication > URL Configuration** in Supabase.

## 12–16. Day-to-day admin usage

- **Add a subject** — Admin > Subjects > "Add Subject".
- **Add an assignment** — Admin > Assignments > "Add Assignment". Choose a
  subject, an experiment number, a title, and a description. New assignments
  start as `pending` unless you choose "Approved" at creation time.
- **Upload a file** — Admin > Assignments > click **Files** on the row you
  want, then use the upload form. Allowed file types and the max size are
  both configured in `js/config.js`.
- **Approve users** — Admin > Users > Pending tab > Approve. Only
  `approved` users can see repository content; registration alone never
  grants access.
- **Delete content** — every destructive action (delete user/subject/
  assignment/file, reject user/assignment) asks for confirmation first, and
  deleting a subject or assignment also removes its related assignments/
  files from both the database and Storage — nothing is left orphaned.

## 17. Future upgrade architecture

Nothing in this build blocks the planned Version 2–4 features (faculty
accounts, student profiles, notifications, deadlines, submissions,
analytics, AI search, etc.):

- The admin sidebar (`js/components.js` → `ADMIN_NAV_GROUPS`) is a plain
  array — add a new `{ href, label }` entry and the new page appears in
  navigation with zero markup changes.
- Every table uses proper foreign keys (`subject_id`, `assignment_id`) —
  new tables can reference these directly instead of duplicating data.
- RLS policies are centralized in `supabase/schema.sql` and built around two
  reusable helper functions (`is_admin()`, `is_approved()`) — new tables can
  reuse them immediately instead of re-deriving authorization logic.
- The student topbar and admin sidebar are rendered from shared components,
  not copy-pasted per page, so new pages take a few lines to wire in.

---

**Security note:** Every guard in `js/access.js` is a UX convenience, not
the real security boundary. The actual enforcement is Row Level Security and
Storage policies in `supabase/schema.sql` — a user bypassing the frontend
entirely and calling the Supabase REST API directly still cannot read or
write anything they're not authorized for.
