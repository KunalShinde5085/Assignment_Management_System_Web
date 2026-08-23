-- ============================================================================
-- ASSIGNMENT REPOSITORY — SUPABASE SCHEMA
-- Version 1
-- ============================================================================
-- Run this entire file once in the Supabase SQL Editor (Project > SQL Editor).
-- It is safe to re-run: destructive statements are guarded with IF EXISTS/
-- IF NOT EXISTS wherever possible, but this is intended for a FRESH project.
-- ============================================================================


-- ============================================================================
-- 0. EXTENSIONS
-- ============================================================================
create extension if not exists pgcrypto;   -- gen_random_uuid()


-- ============================================================================
-- 1. TABLES
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1.1 admins
-- A user is an administrator ONLY if their auth.users id exists in this table.
-- This table is never writable by normal users (no INSERT/UPDATE/DELETE RLS
-- policy is granted to anyone except via the SQL editor / service role).
-- ----------------------------------------------------------------------------
create table if not exists public.admins (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  created_at  timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- 1.2 user_access
-- Controls whether a registered Supabase Auth user may access the repository.
-- Rows are created automatically by a trigger on auth.users (see section 3),
-- NEVER by the client, so a user can never set their own status.
-- ----------------------------------------------------------------------------
-- NOTE ON THE `email` COLUMN:
-- The spec (Section 4) says not to build a profile system or store personal
-- info like name/phone/address/etc. Email is not "extra" personal data here
-- — it already exists in auth.users as the login identifier. We mirror it
-- onto this row (write-only via the trigger below, never client-writable)
-- purely so the admin UI can display "Email" per Section 10 without ever
-- granting the browser access to auth.users directly or using a
-- service-role key on the client.
create table if not exists public.user_access (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null unique references auth.users(id) on delete cascade,
  email       text not null,
  status      text not null default 'pending'
              check (status in ('pending', 'approved', 'rejected', 'disabled')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- 1.3 subjects
-- ----------------------------------------------------------------------------
create table if not exists public.subjects (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  code         text not null unique,
  description  text,
  status       text not null default 'active'
               check (status in ('active', 'inactive')),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- 1.4 assignments
-- status = 'approved' is what makes an assignment visible to students.
-- (Keeping a single status field rather than status + published flag, per the
-- "do not overengineer" directive — 'approved' IS the published state.)
-- ----------------------------------------------------------------------------
create table if not exists public.assignments (
  id                  uuid primary key default gen_random_uuid(),
  subject_id          uuid not null references public.subjects(id) on delete cascade,
  title               text not null,
  experiment_number   text,
  description         text,
  status              text not null default 'pending'
                      check (status in ('pending', 'approved', 'rejected', 'unpublished')),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- 1.5 files
-- storage_path must exactly match the object path inside the "assignments"
-- Storage bucket, e.g. "DSA/EXP03/Stack_Assignment.pdf"
-- ----------------------------------------------------------------------------
create table if not exists public.files (
  id             uuid primary key default gen_random_uuid(),
  assignment_id  uuid not null references public.assignments(id) on delete cascade,
  file_name      text not null,
  storage_path   text not null unique,
  file_type      text,
  file_size      bigint,
  created_at     timestamptz not null default now()
);

-- ============================================================================
-- 2. INDEXES
-- ============================================================================
create index if not exists idx_user_access_user_id      on public.user_access(user_id);
create index if not exists idx_user_access_status        on public.user_access(status);

create index if not exists idx_subjects_status            on public.subjects(status);
create index if not exists idx_subjects_code               on public.subjects(code);

create index if not exists idx_assignments_subject_id      on public.assignments(subject_id);
create index if not exists idx_assignments_status          on public.assignments(status);

create index if not exists idx_files_assignment_id         on public.files(assignment_id);
create index if not exists idx_files_storage_path          on public.files(storage_path);


-- ============================================================================
-- 3. TRIGGERS
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 3.1 updated_at auto-update trigger (reused by all tables that have it)
-- ----------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_user_access_updated_at on public.user_access;
create trigger trg_user_access_updated_at
  before update on public.user_access
  for each row execute function public.set_updated_at();

drop trigger if exists trg_subjects_updated_at on public.subjects;
create trigger trg_subjects_updated_at
  before update on public.subjects
  for each row execute function public.set_updated_at();

drop trigger if exists trg_assignments_updated_at on public.assignments;
create trigger trg_assignments_updated_at
  before update on public.assignments
  for each row execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- 3.2 Auto-create a pending user_access row whenever a new auth user signs up.
-- This runs as SECURITY DEFINER so it bypasses RLS — it is the ONLY way a
-- user_access row gets created. The client never inserts into user_access.
-- ----------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.user_access (user_id, email, status)
  values (new.id, new.email, 'pending')
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists trg_on_auth_user_created on auth.users;
create trigger trg_on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();


-- ============================================================================
-- 4. HELPER FUNCTIONS (used inside RLS policies)
-- Both are SECURITY DEFINER so they can read admins/user_access without
-- triggering recursive RLS evaluation on those same tables.
-- ============================================================================

create or replace function public.is_admin(uid uuid default auth.uid())
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.admins where user_id = uid
  );
$$;

create or replace function public.is_approved(uid uuid default auth.uid())
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.user_access
    where user_id = uid and status = 'approved'
  );
$$;

-- Restrict who can even call these (any authenticated/anon client can call
-- them — that's fine, they only ever return a boolean about the caller).
grant execute on function public.is_admin(uuid) to anon, authenticated;
grant execute on function public.is_approved(uuid) to anon, authenticated;


-- ============================================================================
-- 5. ROW LEVEL SECURITY
-- ============================================================================

alter table public.admins       enable row level security;
alter table public.user_access  enable row level security;
alter table public.subjects     enable row level security;
alter table public.assignments  enable row level security;
alter table public.files        enable row level security;

-- ----------------------------------------------------------------------------
-- 5.1 admins
-- Nobody gets INSERT/UPDATE/DELETE via the client, ever. Only readable so an
-- admin's own client can confirm admin status if you ever need to.
-- ----------------------------------------------------------------------------
drop policy if exists "admins_select_self_or_admin" on public.admins;
create policy "admins_select_self_or_admin"
  on public.admins for select
  using (user_id = auth.uid() or public.is_admin());

-- No insert/update/delete policies are created for "admins" -> only the
-- Supabase SQL editor / service role (which bypasses RLS) can modify it.

-- ----------------------------------------------------------------------------
-- 5.2 user_access
-- ----------------------------------------------------------------------------
drop policy if exists "user_access_select" on public.user_access;
create policy "user_access_select"
  on public.user_access for select
  using (user_id = auth.uid() or public.is_admin());

-- No client-side insert policy: rows are created only by the trigger above.

drop policy if exists "user_access_update_admin_only" on public.user_access;
create policy "user_access_update_admin_only"
  on public.user_access for update
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "user_access_delete_admin_only" on public.user_access;
create policy "user_access_delete_admin_only"
  on public.user_access for delete
  using (public.is_admin());

-- ----------------------------------------------------------------------------
-- 5.3 subjects
-- ----------------------------------------------------------------------------
drop policy if exists "subjects_select" on public.subjects;
create policy "subjects_select"
  on public.subjects for select
  using (
    public.is_admin()
    or (status = 'active' and public.is_approved())
  );

drop policy if exists "subjects_insert_admin_only" on public.subjects;
create policy "subjects_insert_admin_only"
  on public.subjects for insert
  with check (public.is_admin());

drop policy if exists "subjects_update_admin_only" on public.subjects;
create policy "subjects_update_admin_only"
  on public.subjects for update
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "subjects_delete_admin_only" on public.subjects;
create policy "subjects_delete_admin_only"
  on public.subjects for delete
  using (public.is_admin());

-- ----------------------------------------------------------------------------
-- 5.4 assignments
-- ----------------------------------------------------------------------------
drop policy if exists "assignments_select" on public.assignments;
create policy "assignments_select"
  on public.assignments for select
  using (
    public.is_admin()
    or (status = 'approved' and public.is_approved())
  );

drop policy if exists "assignments_insert_admin_only" on public.assignments;
create policy "assignments_insert_admin_only"
  on public.assignments for insert
  with check (public.is_admin());

drop policy if exists "assignments_update_admin_only" on public.assignments;
create policy "assignments_update_admin_only"
  on public.assignments for update
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "assignments_delete_admin_only" on public.assignments;
create policy "assignments_delete_admin_only"
  on public.assignments for delete
  using (public.is_admin());

-- ----------------------------------------------------------------------------
-- 5.5 files
-- A student can see a file's metadata only if it belongs to an approved
-- assignment. Admin sees everything.
-- ----------------------------------------------------------------------------
drop policy if exists "files_select" on public.files;
create policy "files_select"
  on public.files for select
  using (
    public.is_admin()
    or (
      public.is_approved()
      and exists (
        select 1 from public.assignments a
        where a.id = files.assignment_id
          and a.status = 'approved'
      )
    )
  );

drop policy if exists "files_insert_admin_only" on public.files;
create policy "files_insert_admin_only"
  on public.files for insert
  with check (public.is_admin());

drop policy if exists "files_update_admin_only" on public.files;
create policy "files_update_admin_only"
  on public.files for update
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "files_delete_admin_only" on public.files;
create policy "files_delete_admin_only"
  on public.files for delete
  using (public.is_admin());


-- ============================================================================
-- 6. STORAGE — BUCKET + POLICIES
-- ============================================================================
-- Create the bucket. keep it PRIVATE (public = false) — access must go
-- through RLS-checked signed URLs / authenticated downloads, never a public
-- URL.
-- ============================================================================
insert into storage.buckets (id, name, public)
values ('assignments', 'assignments', false)
on conflict (id) do nothing;

-- Storage RLS lives on storage.objects. "name" = full path inside the bucket,
-- which must match files.storage_path exactly.

drop policy if exists "storage_assignments_select" on storage.objects;
create policy "storage_assignments_select"
  on storage.objects for select
  using (
    bucket_id = 'assignments'
    and (
      public.is_admin()
      or (
        public.is_approved()
        and exists (
          select 1
          from public.files f
          join public.assignments a on a.id = f.assignment_id
          where f.storage_path = storage.objects.name
            and a.status = 'approved'
        )
      )
    )
  );

drop policy if exists "storage_assignments_insert_admin_only" on storage.objects;
create policy "storage_assignments_insert_admin_only"
  on storage.objects for insert
  with check (bucket_id = 'assignments' and public.is_admin());

drop policy if exists "storage_assignments_update_admin_only" on storage.objects;
create policy "storage_assignments_update_admin_only"
  on storage.objects for update
  using (bucket_id = 'assignments' and public.is_admin())
  with check (bucket_id = 'assignments' and public.is_admin());

drop policy if exists "storage_assignments_delete_admin_only" on storage.objects;
create policy "storage_assignments_delete_admin_only"
  on storage.objects for delete
  using (bucket_id = 'assignments' and public.is_admin());
create table if not exists public.files (
  id             uuid primary key default gen_random_uuid(),
  assignment_id  uuid not null references public.assignments(id) on delete cascade,
  file_name      text not null,
  storage_path   text not null unique,
  file_type      text,
  file_size      bigint,
  created_at     timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- 1.6 student_uploads
-- Student files wait here for admin approval.
-- ----------------------------------------------------------------------------
create table if not exists public.student_uploads (
  id             uuid primary key default gen_random_uuid(),
  assignment_id  uuid not null references public.assignments(id) on delete cascade,
  uploaded_by    uuid not null references auth.users(id) on delete cascade,
  file_name      text not null,
  storage_path   text not null unique,
  status         text not null default 'pending'
                 check (status in ('pending', 'approved', 'rejected')),
  created_at     timestamptz not null default now()
);
-- ============================================================================
-- 7. CREATING THE FIRST ADMINISTRATOR
-- ============================================================================
-- There is NO signup flow, button, or API call that can create an admin.
-- To bootstrap your first admin account:
--
--   1. Register a normal account through your app's register.html
--      (it will land in "pending" status — that's expected).
--   2. In the Supabase Dashboard, go to Authentication > Users and copy
--      that user's UUID.
--   3. Run the following in the SQL Editor, replacing the UUID:
--
--      insert into public.admins (user_id)
--      values ('00000000-0000-0000-0000-000000000000');
--
--      update public.user_access
--      set status = 'approved'
--      where user_id = '00000000-0000-0000-0000-000000000000';
--
--   (The status update isn't strictly required for admin access — is_admin()
--   bypasses the approval check everywhere — but your frontend login-routing
--   logic should check is_admin() BEFORE checking user_access.status, so the
--   admin isn't accidentally redirected to pending.html.)
-- ============================================================================


-- ============================================================================
-- 8. SAMPLE / TEST DATA (optional — safe to skip or delete before production)
-- ============================================================================
-- insert into public.subjects (name, code, description, status) values
--   ('Data Structures', 'DSA', 'Fundamental Data Structures', 'active'),
--   ('Python', 'PY', 'Python Programming', 'active'),
--   ('Database Management System', 'DBMS', 'DBMS Concepts and Labs', 'active'),
--   ('C Programming', 'C', 'Introduction to C Programming', 'active');
--
-- Note: you cannot insert sample assignments/files here without a real
-- subject_id/assignment_id — grab the generated UUIDs after inserting
-- subjects above, or add sample rows from the admin UI once it's built.

-- ============================================================================
-- END OF SCHEMA
-- ============================================================================
