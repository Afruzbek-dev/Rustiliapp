-- 0001_identity: profiles, courses, cohorts, curator groups, enrollments, login nonces.
-- Spec §3 (roles), §5 (login/enrollment), §6 (data model).
-- Every table has RLS enabled; writes not covered by a policy go through the service role.

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type public.user_role as enum ('student', 'curator', 'teacher', 'admin');
create type public.enrollment_status as enum ('pending', 'active', 'rejected', 'expired');
create type public.enrollment_source as enum ('manual', 'payme', 'click');
create type public.nonce_status as enum ('created', 'confirmed', 'consumed');

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table public.profiles (
  id                uuid primary key references auth.users (id) on delete cascade,
  full_name         text not null default '',
  phone             text unique,
  telegram_id       bigint unique,
  telegram_username text,
  role              public.user_role not null default 'student',
  created_at        timestamptz not null default now()
);

create table public.courses (
  id          uuid primary key default gen_random_uuid(),
  teacher_id  uuid not null references public.profiles (id) on delete restrict,
  title       text not null,
  slug        text not null unique,
  description text,
  created_at  timestamptz not null default now()
);
create index courses_teacher_id_idx on public.courses (teacher_id);

create table public.cohorts (
  id           uuid primary key default gen_random_uuid(),
  course_id    uuid not null references public.courses (id) on delete cascade,
  name         text not null,
  starts_on    date,
  ends_on      date,
  access_until timestamptz,
  created_at   timestamptz not null default now()
);
create index cohorts_course_id_idx on public.cohorts (course_id);

create table public.curator_groups (
  id               uuid primary key default gen_random_uuid(),
  cohort_id        uuid not null references public.cohorts (id) on delete cascade,
  curator_id       uuid references public.profiles (id) on delete set null,
  name             text not null,
  telegram_chat_id bigint unique,
  created_at       timestamptz not null default now(),
  unique (id, cohort_id) -- target of enrollments' composite FK
);
create index curator_groups_cohort_id_idx on public.curator_groups (cohort_id);
create index curator_groups_curator_id_idx on public.curator_groups (curator_id);

create table public.enrollments (
  id               uuid primary key default gen_random_uuid(),
  student_id       uuid not null references public.profiles (id) on delete cascade,
  cohort_id        uuid not null references public.cohorts (id) on delete cascade,
  curator_group_id uuid,
  status           public.enrollment_status not null default 'pending',
  source           public.enrollment_source not null default 'manual',
  approved_by      uuid references public.profiles (id) on delete set null,
  approved_at      timestamptz,
  expires_at       timestamptz,
  created_at       timestamptz not null default now(),
  unique (student_id, cohort_id),
  -- a student's curator group must belong to the same cohort
  foreign key (curator_group_id, cohort_id)
    references public.curator_groups (id, cohort_id) on delete set null (curator_group_id)
);
create index enrollments_cohort_id_idx on public.enrollments (cohort_id);
create index enrollments_curator_group_id_idx on public.enrollments (curator_group_id);

create table public.login_nonces (
  nonce       text primary key,
  telegram_id bigint,
  status      public.nonce_status not null default 'created',
  expires_at  timestamptz not null,
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Helper functions (security definer: they read past RLS, but only ever answer
-- questions about the calling user, auth.uid()).
-- ---------------------------------------------------------------------------
create function public.app_role() returns public.user_role
language sql stable security definer set search_path = public as $$
  select p.role from public.profiles p where p.id = auth.uid()
$$;

create function public.is_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.app_role() in ('teacher', 'admin'), false)
$$;

create function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.app_role() = 'admin', false)
$$;

-- True when the caller is the course's teacher (with the teacher role) or an admin.
create function public.teaches_course(course uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_admin()
      or exists (
        select 1 from public.courses c
        where c.id = course
          and c.teacher_id = auth.uid()
          and public.app_role() = 'teacher'
      )
$$;

create function public.teaches_cohort(cohort uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.teaches_course((select c.course_id from public.cohorts c where c.id = cohort))
$$;

-- Courses the caller can study now: active, unexpired enrollments.
create function public.active_course_ids() returns setof uuid
language sql stable security definer set search_path = public as $$
  select distinct c.course_id
  from public.enrollments e
  join public.cohorts c on c.id = e.cohort_id
  where e.student_id = auth.uid()
    and e.status = 'active'
    and (e.expires_at is null or e.expires_at > now())
$$;

-- Cohorts in which the caller is an active, unexpired student.
create function public.active_cohort_ids() returns setof uuid
language sql stable security definer set search_path = public as $$
  select e.cohort_id
  from public.enrollments e
  where e.student_id = auth.uid()
    and e.status = 'active'
    and (e.expires_at is null or e.expires_at > now())
$$;

-- Curator groups the caller curates.
create function public.curated_group_ids() returns setof uuid
language sql stable security definer set search_path = public as $$
  select g.id from public.curator_groups g where g.curator_id = auth.uid()
$$;

-- Students in the caller's curator groups.
create function public.curated_student_ids() returns setof uuid
language sql stable security definer set search_path = public as $$
  select distinct e.student_id
  from public.enrollments e
  join public.curator_groups g on g.id = e.curator_group_id
  where g.curator_id = auth.uid()
$$;

-- Cohorts / courses the caller curates a group in.
create function public.curated_cohort_ids() returns setof uuid
language sql stable security definer set search_path = public as $$
  select distinct g.cohort_id from public.curator_groups g where g.curator_id = auth.uid()
$$;

create function public.curated_course_ids() returns setof uuid
language sql stable security definer set search_path = public as $$
  select distinct c.course_id
  from public.curator_groups g
  join public.cohorts c on c.id = g.cohort_id
  where g.curator_id = auth.uid()
$$;

-- Students (any enrollment status) of courses the caller teaches; all students for admins.
create function public.taught_student_ids() returns setof uuid
language sql stable security definer set search_path = public as $$
  select distinct e.student_id
  from public.enrollments e
  join public.cohorts c on c.id = e.cohort_id
  where public.teaches_course(c.course_id)
$$;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.profiles       enable row level security;
alter table public.courses        enable row level security;
alter table public.cohorts        enable row level security;
alter table public.curator_groups enable row level security;
alter table public.enrollments    enable row level security;
alter table public.login_nonces   enable row level security;

-- profiles ------------------------------------------------------------------
-- Users may only change their own full_name (column privilege); role, phone and
-- telegram_id are written by the server (service role). Inserts/deletes: service role.
revoke insert, update, delete on public.profiles from anon, authenticated;
grant update (full_name) on public.profiles to authenticated;

create policy profiles_select on public.profiles
  for select to authenticated
  using (
    id = auth.uid()
    or public.is_staff()
    or id in (select public.curated_student_ids())
  );

create policy profiles_update_self on public.profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- courses -------------------------------------------------------------------
create policy courses_select on public.courses
  for select to authenticated
  using (
    public.teaches_course(id)
    or id in (select public.active_course_ids())
    or id in (select public.curated_course_ids())
  );

create policy courses_insert on public.courses
  for insert to authenticated
  with check (
    public.is_admin()
    or (teacher_id = auth.uid() and public.app_role() = 'teacher')
  );

create policy courses_update on public.courses
  for update to authenticated
  using (public.teaches_course(id))
  with check (public.is_admin() or (teacher_id = auth.uid() and public.app_role() = 'teacher'));

create policy courses_delete on public.courses
  for delete to authenticated
  using (public.teaches_course(id));

-- cohorts -------------------------------------------------------------------
create policy cohorts_select on public.cohorts
  for select to authenticated
  using (
    public.teaches_course(course_id)
    or id in (select public.active_cohort_ids())
    or id in (select public.curated_cohort_ids())
  );

create policy cohorts_insert on public.cohorts
  for insert to authenticated
  with check (public.teaches_course(course_id));

create policy cohorts_update on public.cohorts
  for update to authenticated
  using (public.teaches_course(course_id))
  with check (public.teaches_course(course_id));

create policy cohorts_delete on public.cohorts
  for delete to authenticated
  using (public.teaches_course(course_id));

-- curator_groups ------------------------------------------------------------
create policy curator_groups_select on public.curator_groups
  for select to authenticated
  using (curator_id = auth.uid() or public.teaches_cohort(cohort_id));

create policy curator_groups_insert on public.curator_groups
  for insert to authenticated
  with check (public.teaches_cohort(cohort_id));

create policy curator_groups_update on public.curator_groups
  for update to authenticated
  using (public.teaches_cohort(cohort_id))
  with check (public.teaches_cohort(cohort_id));

create policy curator_groups_delete on public.curator_groups
  for delete to authenticated
  using (public.teaches_cohort(cohort_id));

-- enrollments ---------------------------------------------------------------
-- Students read their own (pending screen) but never write; enrollment requests are
-- created by the server. Curators read their groups' enrollments.
create policy enrollments_select on public.enrollments
  for select to authenticated
  using (
    student_id = auth.uid()
    or curator_group_id in (select public.curated_group_ids())
    or public.teaches_cohort(cohort_id)
  );

create policy enrollments_insert on public.enrollments
  for insert to authenticated
  with check (public.teaches_cohort(cohort_id));

create policy enrollments_update on public.enrollments
  for update to authenticated
  using (public.teaches_cohort(cohort_id))
  with check (public.teaches_cohort(cohort_id));

create policy enrollments_delete on public.enrollments
  for delete to authenticated
  using (public.teaches_cohort(cohort_id));

-- login_nonces --------------------------------------------------------------
-- Service role only: no policies, and no privileges for API roles.
revoke all on public.login_nonces from anon, authenticated;
