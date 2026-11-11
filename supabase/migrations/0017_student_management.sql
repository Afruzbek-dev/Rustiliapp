-- 0017_student_management: teacher/admin management of students, cohorts and curator groups. Task 27.
--
-- Two kinds of functions, both SECURITY DEFINER with search_path pinned:
--
--  READ (manage_student_list, manage_cohort_counts, manage_cohorts_overview): authorise through
--   auth.uid() / teaches_cohort like 0015, so they are called with the USER-scoped client. A caller
--   who may not see the cohort (another teacher, curator, student, anon) gets an EMPTY result.
--
--  WRITE (manage_*): take the acting profile as p_actor and re-check it in SQL (admin, or the
--   teacher of the cohort's course: can_edit_course_as from 0016). EXECUTE is granted to
--   service_role ONLY, so the server action (which derives p_actor from the verified session) is
--   the only caller. A failed check raises 42501 'forbidden', also for unknown ids (no oracle).
--   Other failures: 22023 = invalid input, 55000 = the row is in a state that forbids the change.
--   Rows that change are locked first (FOR UPDATE, always in id order), so concurrent moves
--   serialise and a student is always in exactly ONE group of the cohort (enrollments is unique per
--   (student, cohort) and its composite FK pins the group to the same cohort).
--
-- profiles.role is never client-writable; the only place a role is granted is manage_assign_curator
-- (service role only, after the actor check, and only for a profile with a linked Telegram).

-- ---------------------------------------------------------------------------
-- Curator group names are unique within a cohort (case-insensitive).
-- ---------------------------------------------------------------------------
create unique index curator_groups_cohort_name_key on public.curator_groups (cohort_id, lower(btrim(name)));

-- ---------------------------------------------------------------------------
-- Authorisation helpers (service role / definer functions only)
-- ---------------------------------------------------------------------------
create function public.manage_can_as(p_actor uuid, p_cohort uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.can_edit_course_as(p_actor, (select c.course_id from public.cohorts c where c.id = p_cohort))
$$;

create function public.manage_require(p_actor uuid, p_cohort uuid) returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.manage_can_as(p_actor, p_cohort) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- READ: manage_student_list. One row per enrollment of the cohort, filters applied.
--   p_search : name substring (case-insensitive) OR phone suffix (digits only, >= 3 digits);
--   p_status : 'active' (not expired) | 'pending' | 'rejected' | 'expired' (expired or lapsed);
--   p_group  : a curator group of the cohort; p_ungrouped = only students without a group;
--   p_limit  : 1..50 (default 25); p_offset >= 0. total_count is the filtered total (for paging).
--   status is the EFFECTIVE one: an 'active' enrollment past expires_at is reported 'expired'.
--   parts_*  : completed / total PLAYABLE parts (>= 1 published block) of the cohort's course.
--   last_active: the latest Tashkent day with xp > 0.
-- ---------------------------------------------------------------------------
create function public.manage_student_list(
  p_cohort uuid, p_search text default null, p_status text default null,
  p_group uuid default null, p_ungrouped boolean default false,
  p_limit int default 25, p_offset int default 0
)
returns table (
  enrollment_id uuid, student_id uuid, full_name text, phone text, telegram_linked boolean,
  telegram_username text, status text, expires_at timestamptz, group_id uuid, group_name text,
  parts_completed int, parts_total int, last_active date, requested_at timestamptz, total_count int
)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare
  v_course   uuid;
  v_playable uuid[];
  v_limit    int  := least(greatest(coalesce(p_limit, 25), 1), 50);
  v_offset   int  := greatest(coalesce(p_offset, 0), 0);
  v_search   text := left(nullif(btrim(coalesce(p_search, '')), ''), 64);
  v_like     text;
  v_digits   text;
begin
  if p_cohort is null or not public.teaches_cohort(p_cohort) then
    return;
  end if;
  if p_status is not null and p_status not in ('active', 'pending', 'rejected', 'expired') then
    return;
  end if;
  select c.course_id into v_course from public.cohorts c where c.id = p_cohort;
  select coalesce(array_agg(distinct lp.id), '{}') into v_playable
    from public.lesson_parts lp
    join public.lessons l on l.id = lp.lesson_id
    join public.modules mo on mo.id = l.module_id
   where mo.course_id = v_course
     and exists (select 1 from public.blocks b where b.lesson_part_id = lp.id and b.published);
  if v_search is not null then
    v_like := '%' || replace(replace(replace(v_search, '\', '\\'), '%', '\%'), '_', '\_') || '%';
    v_digits := regexp_replace(v_search, '\D', '', 'g');
  end if;

  return query
    with base as (
      select e.id as eid, e.student_id as sid, p.full_name as fname, p.phone as phn,
             p.telegram_id is not null as linked, p.telegram_username as uname,
             case when e.status = 'active' and e.expires_at is not null and e.expires_at <= now()
                  then 'expired' else e.status::text end as eff_status,
             e.expires_at as exp, e.curator_group_id as gid, g.name as gname, e.created_at as created
        from public.enrollments e
        join public.profiles p on p.id = e.student_id
        left join public.curator_groups g on g.id = e.curator_group_id
       where e.cohort_id = p_cohort
         and (p_group is null or e.curator_group_id = p_group)
         and (not coalesce(p_ungrouped, false) or e.curator_group_id is null)
         and (v_search is null
              or p.full_name ilike v_like
              or (length(v_digits) >= 3 and p.phone is not null and p.phone like '%' || v_digits))
    ), filtered as (
      select b.*, (count(*) over ())::int as total
        from base b
       where p_status is null or b.eff_status = p_status
    )
    select f.eid, f.sid, f.fname, f.phn, f.linked, f.uname, f.eff_status, f.exp, f.gid, f.gname,
           (select count(*)::int from public.part_progress pp
             where pp.student_id = f.sid and pp.status = 'completed' and pp.lesson_part_id = any (v_playable)),
           cardinality(v_playable),
           (select max(a.day) from public.daily_activity a where a.student_id = f.sid and a.xp > 0),
           f.created, f.total
      from filtered f
     order by f.fname, f.eid
     limit v_limit offset v_offset;
end
$$;

-- ---------------------------------------------------------------------------
-- READ: manage_cohort_counts: one row of enrollment counts for the filter chips (no row when the
-- caller may not see the cohort).
-- ---------------------------------------------------------------------------
create function public.manage_cohort_counts(p_cohort uuid)
returns table (total int, active int, pending int, expired int, rejected int, ungrouped int)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
begin
  if p_cohort is null or not public.teaches_cohort(p_cohort) then
    return;
  end if;
  return query
    select count(*)::int,
           (count(*) filter (where e.status = 'active' and (e.expires_at is null or e.expires_at > now())))::int,
           (count(*) filter (where e.status = 'pending'))::int,
           (count(*) filter (where e.status = 'expired'
                              or (e.status = 'active' and e.expires_at is not null and e.expires_at <= now())))::int,
           (count(*) filter (where e.status = 'rejected'))::int,
           (count(*) filter (where e.curator_group_id is null and e.status in ('pending', 'active')))::int
      from public.enrollments e
     where e.cohort_id = p_cohort;
end
$$;

-- ---------------------------------------------------------------------------
-- READ: manage_cohorts_overview: every cohort of the courses the caller teaches (all for admins),
-- newest first, with its counts. `enrollment_open` mirrors the server rule (computeExpiresAt in
-- enrollment.ts): access_until, else ends_on + 1 month, else open.
-- ---------------------------------------------------------------------------
create function public.manage_cohorts_overview()
returns table (
  cohort_id uuid, course_id uuid, course_title text, name text, starts_on date, ends_on date,
  access_until timestamptz, enrollment_open boolean, active_students int, pending_students int, group_count int
)
language sql stable security definer set search_path = public as $$
  select c.id, c.course_id, co.title, c.name, c.starts_on, c.ends_on, c.access_until,
         case when c.access_until is not null then c.access_until > now()
              when c.ends_on is not null then (c.ends_on + interval '1 month') > now()
              else true end,
         (select count(*)::int from public.enrollments e
           where e.cohort_id = c.id and e.status = 'active' and (e.expires_at is null or e.expires_at > now())),
         (select count(*)::int from public.enrollments e where e.cohort_id = c.id and e.status = 'pending'),
         (select count(*)::int from public.curator_groups g where g.cohort_id = c.id)
    from public.cohorts c
    join public.courses co on co.id = c.course_id
   where public.teaches_course(c.course_id)
   order by c.starts_on desc nulls last, c.created_at desc, c.id
$$;

-- ---------------------------------------------------------------------------
-- READ: manage_student_detail: aggregates for the student page (empty for a caller who does not
-- teach the enrollment's cohort). xp_total/attempt counts are lifetime; active_days = the Tashkent
-- days with xp > 0 within the last 400 days (the server turns them into a streak).
-- ---------------------------------------------------------------------------
create function public.manage_student_detail(p_enrollment uuid)
returns table (xp_total bigint, attempts_total int, attempts_correct int, active_days date[], last_active date)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare
  v_student uuid;
  v_cohort  uuid;
begin
  select e.student_id, e.cohort_id into v_student, v_cohort from public.enrollments e where e.id = p_enrollment;
  if v_cohort is null or not public.teaches_cohort(v_cohort) then
    return;
  end if;
  return query
    select coalesce((select sum(x.amount) from public.xp_events x where x.student_id = v_student), 0)::bigint,
           (select count(*)::int from public.attempts a where a.student_id = v_student),
           (select count(*)::int from public.attempts a where a.student_id = v_student and a.is_correct),
           coalesce((select array_agg(d.day order by d.day)
                       from public.daily_activity d
                      where d.student_id = v_student and d.xp > 0
                        and d.day > public.tashkent_day(now()) - 400), '{}'),
           (select max(d.day) from public.daily_activity d where d.student_id = v_student and d.xp > 0);
end
$$;

-- ---------------------------------------------------------------------------
-- WRITE: cohorts
-- ---------------------------------------------------------------------------
create function public.manage_create_cohort(
  p_actor uuid, p_course uuid, p_name text, p_starts date, p_ends date, p_access timestamptz
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
begin
  if not public.can_edit_course_as(p_actor, p_course) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_name is null or length(btrim(p_name)) not between 1 and 80 then
    raise exception 'invalid name' using errcode = '22023';
  end if;
  if p_starts is not null and p_ends is not null and p_ends < p_starts then
    raise exception 'invalid dates' using errcode = '22023';
  end if;
  insert into public.cohorts (course_id, name, starts_on, ends_on, access_until)
  values (p_course, btrim(p_name), p_starts, p_ends, p_access)
  returning id into v_id;
  return v_id;
end
$$;

-- Does NOT touch access_until: that is only changed by manage_set_cohort_access (open/close), so
-- saving the form can never silently re-open a closed cohort.
create function public.manage_update_cohort(
  p_actor uuid, p_cohort uuid, p_name text, p_starts date, p_ends date
) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.manage_require(p_actor, p_cohort);
  if p_name is null or length(btrim(p_name)) not between 1 and 80 then
    raise exception 'invalid name' using errcode = '22023';
  end if;
  if p_starts is not null and p_ends is not null and p_ends < p_starts then
    raise exception 'invalid dates' using errcode = '22023';
  end if;
  update public.cohorts
     set name = btrim(p_name), starts_on = p_starts, ends_on = p_ends
   where id = p_cohort;
end
$$;

-- Closing = access_until := now(): new requests find no open cohort and pending ones cannot be
-- approved (cohort_closed); enrollments already active keep their own expires_at. Opening needs a
-- future date (at most 3 years ahead).
create function public.manage_set_cohort_access(p_actor uuid, p_cohort uuid, p_open boolean, p_access timestamptz)
returns timestamptz
language plpgsql security definer set search_path = public as $$
declare
  v_value timestamptz;
begin
  perform public.manage_require(p_actor, p_cohort);
  if coalesce(p_open, false) then
    if p_access is null or p_access <= now() or p_access > now() + interval '3 years' then
      raise exception 'invalid access date' using errcode = '22023';
    end if;
    v_value := p_access;
  else
    v_value := now();
  end if;
  update public.cohorts set access_until = v_value where id = p_cohort;
  return v_value;
end
$$;

-- ---------------------------------------------------------------------------
-- WRITE: curator groups
-- ---------------------------------------------------------------------------
create function public.manage_create_group(p_actor uuid, p_cohort uuid, p_name text, p_chat bigint)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
begin
  perform public.manage_require(p_actor, p_cohort);
  if p_name is null or length(btrim(p_name)) not between 1 and 80 then
    raise exception 'invalid name' using errcode = '22023';
  end if;
  insert into public.curator_groups (cohort_id, name, telegram_chat_id)
  values (p_cohort, btrim(p_name), p_chat)
  returning id into v_id;
  return v_id;
end
$$;

-- Sets BOTH fields (a null chat id clears it).
create function public.manage_update_group(p_actor uuid, p_group uuid, p_name text, p_chat bigint)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_cohort uuid;
begin
  select g.cohort_id into v_cohort from public.curator_groups g where g.id = p_group for update;
  if v_cohort is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  perform public.manage_require(p_actor, v_cohort);
  if p_name is null or length(btrim(p_name)) not between 1 and 80 then
    raise exception 'invalid name' using errcode = '22023';
  end if;
  update public.curator_groups set name = btrim(p_name), telegram_chat_id = p_chat where id = p_group;
end
$$;

-- Assign (p_curator) or unassign (null) the curator of a group. The ONLY place a role is granted:
--   * the target must have a profile with a linked Telegram (telegram_id comes from the bot's
--     verified contact step or from manage_link_telegram);
--   * a plain 'student' becomes 'curator', unless he or she has a live (pending, or active and
--     unexpired) enrollment: such a person cannot be promoted (they would lose their student view);
--   * curator / teacher / admin keep their role. Unassigning never changes a role.
-- Returns whether the role was promoted.
create function public.manage_assign_curator(p_actor uuid, p_group uuid, p_curator uuid)
returns boolean
language plpgsql security definer set search_path = public as $$
declare
  v_cohort   uuid;
  v_role     public.user_role;
  v_telegram bigint;
  v_promoted boolean := false;
begin
  select g.cohort_id into v_cohort from public.curator_groups g where g.id = p_group for update;
  if v_cohort is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  perform public.manage_require(p_actor, v_cohort);

  if p_curator is null then
    update public.curator_groups set curator_id = null where id = p_group;
    return false;
  end if;

  select p.role, p.telegram_id into v_role, v_telegram from public.profiles p where p.id = p_curator for update;
  if v_role is null then
    raise exception 'unknown curator' using errcode = '22023';
  end if;
  if v_telegram is null then
    raise exception 'telegram_required' using errcode = '22023';
  end if;
  if v_role = 'student' then
    if exists (select 1 from public.enrollments e
                where e.student_id = p_curator
                  and (e.status = 'pending'
                       or (e.status = 'active' and (e.expires_at is null or e.expires_at > now())))) then
      raise exception 'student_enrolled' using errcode = '55000';
    end if;
    update public.profiles set role = 'curator' where id = p_curator;
    v_promoted := true;
  end if;
  update public.curator_groups set curator_id = p_curator where id = p_group;
  return v_promoted;
end
$$;

-- Exact-match lookup of curator candidates (never a prefix/substring scan: it must not be a way to
-- enumerate the user base). Matches a numeric Telegram id, a full phone number, or a @username.
-- Only teachers and admins may ask.
create function public.manage_find_curator_candidates(p_actor uuid, p_query text)
returns table (profile_id uuid, full_name text, phone text, telegram_linked boolean, telegram_username text, role public.user_role)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare
  v_q      text := btrim(coalesce(p_query, ''));
  v_digits text;
  v_name   text;
begin
  if not exists (select 1 from public.profiles a where a.id = p_actor and a.role in ('teacher', 'admin')) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if length(v_q) = 0 or length(v_q) > 64 then
    return;
  end if;
  v_digits := regexp_replace(v_q, '[\s()+-]', '', 'g');
  if v_digits ~ '^[0-9]{7,15}$' then
    return query
      select p.id, p.full_name, p.phone, p.telegram_id is not null, p.telegram_username, p.role
        from public.profiles p
       where p.phone = '+' || v_digits or p.telegram_id = v_digits::bigint
       order by p.full_name, p.id limit 5;
    return;
  end if;
  v_name := regexp_replace(v_q, '^@', '');
  if v_name ~ '^[A-Za-z][A-Za-z0-9_]{4,31}$' then
    return query
      select p.id, p.full_name, p.phone, p.telegram_id is not null, p.telegram_username, p.role
        from public.profiles p
       where lower(p.telegram_username) = lower(v_name)
       order by p.full_name, p.id limit 5;
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- WRITE: moving students between curator groups
-- ---------------------------------------------------------------------------
-- p_group null = remove the student from any group. The group must belong to the enrollment's
-- cohort. Rejected enrollments cannot be moved. Returns the previous group.
create function public.manage_move_student(p_actor uuid, p_enrollment uuid, p_group uuid)
returns table (changed boolean, previous_group uuid)
language plpgsql security definer set search_path = public as $$
declare
  v_cohort uuid;
  v_status public.enrollment_status;
  v_prev   uuid;
begin
  select e.cohort_id, e.status, e.curator_group_id into v_cohort, v_status, v_prev
    from public.enrollments e where e.id = p_enrollment for update;
  if v_cohort is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  perform public.manage_require(p_actor, v_cohort);
  if v_status = 'rejected' then
    raise exception 'rejected enrollment' using errcode = '55000';
  end if;
  if p_group is not null then
    perform 1 from public.curator_groups g where g.id = p_group and g.cohort_id = v_cohort for share;
    if not found then
      raise exception 'invalid group' using errcode = '22023';
    end if;
  end if;
  if v_prev is not distinct from p_group then
    return query select false, v_prev;
    return;
  end if;
  update public.enrollments set curator_group_id = p_group where id = p_enrollment;
  return query select true, v_prev;
end
$$;

-- Moves up to 100 enrollments of one cohort to a group (null = remove from groups) in ONE
-- transaction. Rows are locked in id order (no deadlocks between two bulk moves). Every listed id
-- must belong to the cohort, otherwise nothing changes. Rejected enrollments are skipped.
-- Returns the number of enrollments whose group actually changed.
create function public.manage_bulk_move(p_actor uuid, p_cohort uuid, p_group uuid, p_enrollments uuid[])
returns int
language plpgsql security definer set search_path = public as $$
declare
  v_ids   uuid[];
  v_found int;
  v_moved int;
begin
  perform public.manage_require(p_actor, p_cohort);
  select coalesce(array_agg(distinct x), '{}') into v_ids from unnest(p_enrollments) as x where x is not null;
  if cardinality(v_ids) = 0 or cardinality(v_ids) > 100 then
    raise exception 'between 1 and 100 enrollments' using errcode = '22023';
  end if;
  if p_group is not null then
    perform 1 from public.curator_groups g where g.id = p_group and g.cohort_id = p_cohort for share;
    if not found then
      raise exception 'invalid group' using errcode = '22023';
    end if;
  end if;
  select count(*) into v_found from (
    select e.id from public.enrollments e
     where e.id = any (v_ids) and e.cohort_id = p_cohort
     order by e.id for update
  ) locked;
  if v_found <> cardinality(v_ids) then
    raise exception 'enrollments outside the cohort' using errcode = '22023';
  end if;
  update public.enrollments
     set curator_group_id = p_group
   where id = any (v_ids) and cohort_id = p_cohort and status <> 'rejected'
     and curator_group_id is distinct from p_group;
  get diagnostics v_moved = row_count;
  return v_moved;
end
$$;

-- Moves up to p_limit (1..100, default 100) non-rejected enrollments of group p_from to group p_to
-- (null = no group) in ONE transaction; call again for the rest. Both groups must belong to the
-- cohort and differ. Rows are locked in id order. Returns the number moved.
create function public.manage_reassign_group(p_actor uuid, p_cohort uuid, p_from uuid, p_to uuid, p_limit int default 100)
returns int
language plpgsql security definer set search_path = public as $$
declare
  v_ids   uuid[];
  v_moved int;
begin
  perform public.manage_require(p_actor, p_cohort);
  if p_from is null or p_from is not distinct from p_to then
    raise exception 'invalid group' using errcode = '22023';
  end if;
  perform 1 from public.curator_groups g where g.id = p_from and g.cohort_id = p_cohort for share;
  if not found then
    raise exception 'invalid group' using errcode = '22023';
  end if;
  if p_to is not null then
    perform 1 from public.curator_groups g where g.id = p_to and g.cohort_id = p_cohort for share;
    if not found then
      raise exception 'invalid group' using errcode = '22023';
    end if;
  end if;
  select coalesce(array_agg(x.id), '{}') into v_ids from (
    select e.id from public.enrollments e
     where e.cohort_id = p_cohort and e.curator_group_id = p_from and e.status <> 'rejected'
     order by e.id
     limit least(greatest(coalesce(p_limit, 100), 1), 100)
     for update
  ) x;
  update public.enrollments set curator_group_id = p_to where id = any (v_ids);
  get diagnostics v_moved = row_count;
  return v_moved;
end
$$;

-- ---------------------------------------------------------------------------
-- WRITE: change the expiry of an active or expired enrollment (future date, at most 3 years ahead).
-- An expired enrollment given a future date becomes active again. Returns the resulting status.
-- ---------------------------------------------------------------------------
create function public.manage_set_expiry(p_actor uuid, p_enrollment uuid, p_expires timestamptz)
returns public.enrollment_status
language plpgsql security definer set search_path = public as $$
declare
  v_cohort uuid;
  v_status public.enrollment_status;
begin
  select e.cohort_id, e.status into v_cohort, v_status from public.enrollments e where e.id = p_enrollment for update;
  if v_cohort is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  perform public.manage_require(p_actor, v_cohort);
  if p_expires is null or p_expires <= now() or p_expires > now() + interval '3 years' then
    raise exception 'invalid expiry' using errcode = '22023';
  end if;
  if v_status not in ('active', 'expired') then
    raise exception 'not active' using errcode = '55000';
  end if;
  update public.enrollments set expires_at = p_expires, status = 'active' where id = p_enrollment;
  return 'active';
end
$$;

-- ---------------------------------------------------------------------------
-- WRITE: manual Telegram link for a profile that has a phone but no telegram_id (e.g. created by an
-- admin). The profile must be a student of one of the actor's cohorts or a curator of one of the
-- actor's groups (admins: any non-self profile). The server (src/server/manage-students.ts)
-- validates the id against the Bot API first and mirrors it into the auth user's app_metadata.
-- ---------------------------------------------------------------------------
create function public.manage_link_telegram(p_actor uuid, p_profile uuid, p_telegram bigint, p_username text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_phone    text;
  v_telegram bigint;
  v_role     public.user_role;
  v_admin    boolean;
begin
  select (a.role = 'admin') into v_admin from public.profiles a where a.id = p_actor and a.role in ('teacher', 'admin');
  if v_admin is null or p_profile is null or p_profile = p_actor then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select p.phone, p.telegram_id, p.role into v_phone, v_telegram, v_role from public.profiles p where p.id = p_profile for update;
  if v_role is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if not v_admin and not (
       exists (select 1 from public.enrollments e join public.cohorts c on c.id = e.cohort_id
                where e.student_id = p_profile and public.can_edit_course_as(p_actor, c.course_id))
    or exists (select 1 from public.curator_groups g join public.cohorts c on c.id = g.cohort_id
                where g.curator_id = p_profile and public.can_edit_course_as(p_actor, c.course_id))
  ) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if not v_admin and v_role not in ('student', 'curator') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if v_phone is null then
    raise exception 'phone_required' using errcode = '22023';
  end if;
  if v_telegram is not null then
    raise exception 'already_linked' using errcode = '55000';
  end if;
  if p_telegram is null or p_telegram < 1 or p_telegram > 4503599627370495 then
    raise exception 'invalid telegram id' using errcode = '22023';
  end if;
  update public.profiles
     set telegram_id = p_telegram, telegram_username = nullif(btrim(coalesce(p_username, '')), '')
   where id = p_profile;
end
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
revoke execute on function
  public.manage_can_as(uuid, uuid), public.manage_require(uuid, uuid),
  public.manage_create_cohort(uuid, uuid, text, date, date, timestamptz),
  public.manage_update_cohort(uuid, uuid, text, date, date),
  public.manage_set_cohort_access(uuid, uuid, boolean, timestamptz),
  public.manage_create_group(uuid, uuid, text, bigint), public.manage_update_group(uuid, uuid, text, bigint),
  public.manage_assign_curator(uuid, uuid, uuid), public.manage_find_curator_candidates(uuid, text),
  public.manage_move_student(uuid, uuid, uuid), public.manage_bulk_move(uuid, uuid, uuid, uuid[]),
  public.manage_reassign_group(uuid, uuid, uuid, uuid, int),
  public.manage_set_expiry(uuid, uuid, timestamptz), public.manage_link_telegram(uuid, uuid, bigint, text)
  from public, anon, authenticated;
grant execute on function
  public.manage_can_as(uuid, uuid), public.manage_require(uuid, uuid),
  public.manage_create_cohort(uuid, uuid, text, date, date, timestamptz),
  public.manage_update_cohort(uuid, uuid, text, date, date),
  public.manage_set_cohort_access(uuid, uuid, boolean, timestamptz),
  public.manage_create_group(uuid, uuid, text, bigint), public.manage_update_group(uuid, uuid, text, bigint),
  public.manage_assign_curator(uuid, uuid, uuid), public.manage_find_curator_candidates(uuid, text),
  public.manage_move_student(uuid, uuid, uuid), public.manage_bulk_move(uuid, uuid, uuid, uuid[]),
  public.manage_reassign_group(uuid, uuid, uuid, uuid, int),
  public.manage_set_expiry(uuid, uuid, timestamptz), public.manage_link_telegram(uuid, uuid, bigint, text)
  to service_role;

revoke execute on function
  public.manage_student_list(uuid, text, text, uuid, boolean, int, int),
  public.manage_cohort_counts(uuid), public.manage_cohorts_overview(), public.manage_student_detail(uuid)
  from public, anon;
grant execute on function
  public.manage_student_list(uuid, text, text, uuid, boolean, int, int),
  public.manage_cohort_counts(uuid), public.manage_cohorts_overview(), public.manage_student_detail(uuid)
  to authenticated, service_role;

-- Defence in depth: API roles never need these table privileges.
revoke truncate, trigger, references on all tables in schema public from anon, authenticated;
