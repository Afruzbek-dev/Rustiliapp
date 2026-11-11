-- 0015_teacher_stats: teacher dashboard statistics + the daily "Eslatma" reminder ledger. Task 25.
--
-- Every statistics function is SECURITY DEFINER (it must read other students' rows past RLS) and
-- therefore authorises the caller ITSELF as its first step: auth.uid() must be an admin or the
-- teacher of the cohort's course (teaches_cohort). Anybody else (student, curator, another
-- teacher, anon, a service-role call without a user) gets an EMPTY result, never another
-- course's data. EXECUTE is granted to authenticated + service_role only.
--
-- Definitions shared by the functions:
--   active student   : enrollment in the cohort with status 'active' and not expired;
--   complete part    : part_progress.status = 'completed' for a part of the cohort's course;
--   unreviewed       : submission pending AND finished (audio with a file, video with a Telegram
--                      file, or text), filed by an active student of the cohort for the course;
--   effective review : the LATEST review of a submission (history is kept, overrides win);
--   today            : the Asia/Tashkent calendar day.

-- ---------------------------------------------------------------------------
-- Internal helper: the active students of a cohort. NOT authorised on its own, so API roles may
-- not call it; the definer functions below call it as the function owner.
-- ---------------------------------------------------------------------------
create function public.stats_member_ids(p_cohort uuid) returns setof uuid
language sql stable security definer set search_path = public as $$
  select e.student_id
  from public.enrollments e
  where e.cohort_id = p_cohort
    and e.status = 'active'
    and (e.expires_at is null or e.expires_at > now())
$$;

revoke execute on function public.stats_member_ids(uuid) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- teacher_kpis: one row of headline numbers (no row when the caller may not see the cohort).
--   total_students     : every enrollment of the cohort except rejected ones;
--   active_today       : active students with daily_activity.xp > 0 on today's Tashkent day;
--   avg_progress       : completed lesson parts per active student (2 decimals; 0 without students).
-- ---------------------------------------------------------------------------
create function public.teacher_kpis(p_cohort uuid)
returns table (
  active_students int, total_students int, pending_requests int,
  active_today int, unreviewed_submissions int, avg_progress numeric
)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare
  v_course uuid;
  v_today  date := public.tashkent_day(now());
  v_active int;
begin
  if p_cohort is null or not public.teaches_cohort(p_cohort) then
    return;
  end if;
  select c.course_id into v_course from public.cohorts c where c.id = p_cohort;
  if v_course is null then
    return;
  end if;
  select count(*)::int into v_active from public.stats_member_ids(p_cohort);

  return query select
    v_active,
    (select count(*)::int from public.enrollments e where e.cohort_id = p_cohort and e.status <> 'rejected'),
    (select count(*)::int from public.enrollments e where e.cohort_id = p_cohort and e.status = 'pending'),
    (select count(distinct d.student_id)::int
       from public.daily_activity d
      where d.day = v_today and d.xp > 0
        and d.student_id in (select public.stats_member_ids(p_cohort))),
    (select count(*)::int
       from public.submissions s
      where s.status = 'pending'
        and ((s.kind = 'audio' and s.storage_path is not null)
          or (s.kind = 'video' and s.tg_file_id is not null)
          or s.kind = 'text')
        and s.student_id in (select public.stats_member_ids(p_cohort))
        and public.exercise_course_id(s.exercise_id) = v_course),
    case when v_active = 0 then 0::numeric
         else round((select count(*)
                       from public.part_progress pp
                       join public.lesson_parts lp on lp.id = pp.lesson_part_id
                       join public.lessons l on l.id = lp.lesson_id
                       join public.modules mo on mo.id = l.module_id
                      where pp.status = 'completed'
                        and mo.course_id = v_course
                        and pp.student_id in (select public.stats_member_ids(p_cohort)))::numeric / v_active, 2)
    end;
end
$$;

-- ---------------------------------------------------------------------------
-- daily_active: the number of active students with xp > 0 per Tashkent day, zero-filled for
-- every one of the last p_days days (1..60, default 14), oldest first, ending today.
-- ---------------------------------------------------------------------------
create function public.daily_active(p_cohort uuid, p_days int default 14)
returns table (day date, active int)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare
  v_today date := public.tashkent_day(now());
  v_days  int  := least(greatest(coalesce(p_days, 14), 1), 60);
begin
  if p_cohort is null or not public.teaches_cohort(p_cohort) then
    return;
  end if;
  return query
    select g.d::date,
           coalesce((select count(distinct a.student_id)::int
                       from public.daily_activity a
                      where a.day = g.d::date and a.xp > 0
                        and a.student_id in (select public.stats_member_ids(p_cohort))), 0)
    from generate_series(v_today - (v_days - 1), v_today, interval '1 day') as g(d)
    order by 1;
end
$$;

-- ---------------------------------------------------------------------------
-- lesson_completion: per lesson of the course (module, then lesson order): how many active
-- students finished ALL of its playable parts (a part with at least one published block, the same
-- rule as published_part_ids); a lesson without a playable part counts nobody.
-- ---------------------------------------------------------------------------
create function public.lesson_completion(p_cohort uuid)
returns table (lesson_id uuid, title text, completed_students int, total_active_students int)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare
  v_course uuid;
  v_total  int;
begin
  if p_cohort is null or not public.teaches_cohort(p_cohort) then
    return;
  end if;
  select c.course_id into v_course from public.cohorts c where c.id = p_cohort;
  if v_course is null then
    return;
  end if;
  select count(*)::int into v_total from public.stats_member_ids(p_cohort);

  return query
    select l.id, l.title,
           (select count(*)::int
              from public.stats_member_ids(p_cohort) as m(id)
             where exists (select 1 from public.lesson_parts lp
                            where lp.lesson_id = l.id
                              and exists (select 1 from public.blocks b where b.lesson_part_id = lp.id and b.published))
               and not exists (
                 select 1 from public.lesson_parts lp
                  where lp.lesson_id = l.id
                    and exists (select 1 from public.blocks b where b.lesson_part_id = lp.id and b.published)
                    and not exists (select 1 from public.part_progress pp
                                     where pp.lesson_part_id = lp.id and pp.student_id = m.id
                                       and pp.status = 'completed'))),
           v_total
    from public.lessons l
    join public.modules mo on mo.id = l.module_id
    where mo.course_id = v_course
    order by mo.position, l.position;
end
$$;

-- ---------------------------------------------------------------------------
-- curator_stats: per curator group of the cohort.
--   students            : active students assigned to the group;
--   pending_queue       : finished, pending submissions filed under the group;
--   avg_score           : mean of the EFFECTIVE (latest) review total of the group's submissions;
--   avg_response_hours  : mean of (first review - submission) in hours, for submissions whose first
--                         review happened in the last 30 days (a later override is not a response).
-- ---------------------------------------------------------------------------
create function public.curator_stats(p_cohort uuid)
returns table (
  group_id uuid, group_name text, curator_name text,
  students int, pending_queue int, avg_score numeric, avg_response_hours numeric
)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
begin
  if p_cohort is null or not public.teaches_cohort(p_cohort) then
    return;
  end if;
  return query
    select g.id, g.name, coalesce(p.full_name, ''),
           (select count(*)::int from public.enrollments e
             where e.curator_group_id = g.id and e.status = 'active'
               and (e.expires_at is null or e.expires_at > now())),
           (select count(*)::int from public.submissions s
             where s.curator_group_id = g.id and s.status = 'pending'
               and ((s.kind = 'audio' and s.storage_path is not null)
                 or (s.kind = 'video' and s.tg_file_id is not null)
                 or s.kind = 'text')),
           (select round(avg(lr.total), 2)
              from public.submissions s
              cross join lateral (select r.total from public.reviews r
                                   where r.submission_id = s.id
                                   order by r.created_at desc, r.id desc limit 1) lr
             where s.curator_group_id = g.id),
           (select round(avg(extract(epoch from fr.created_at - s.created_at) / 3600)::numeric, 2)
              from public.submissions s
              cross join lateral (select r.created_at from public.reviews r
                                   where r.submission_id = s.id
                                   order by r.created_at asc, r.id asc limit 1) fr
             where s.curator_group_id = g.id
               and fr.created_at >= now() - interval '30 days')
    from public.curator_groups g
    left join public.profiles p on p.id = g.curator_id
    where g.cohort_id = p_cohort
    order by g.name, g.id;
end
$$;

-- ---------------------------------------------------------------------------
-- idle_students: active students with no daily_activity.xp > 0 on any of the last p_days Tashkent
-- days (1..60, default 3, counting today). Longest idle first (never active = first), then name.
-- ---------------------------------------------------------------------------
create function public.idle_students(p_cohort uuid, p_days int default 3)
returns table (student_id uuid, full_name text, telegram_linked boolean, last_active date, last_part_title text)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare
  v_today date := public.tashkent_day(now());
  v_days  int  := least(greatest(coalesce(p_days, 3), 1), 60);
  v_course uuid;
begin
  if p_cohort is null or not public.teaches_cohort(p_cohort) then
    return;
  end if;
  select c.course_id into v_course from public.cohorts c where c.id = p_cohort;
  return query
    select m.id, p.full_name, p.telegram_id is not null,
           (select max(a.day) from public.daily_activity a where a.student_id = m.id and a.xp > 0),
           (select lp.title
              from public.part_progress pp
              join public.lesson_parts lp on lp.id = pp.lesson_part_id
               join public.lessons l on l.id = lp.lesson_id
               join public.modules mo on mo.id = l.module_id
             where pp.student_id = m.id and mo.course_id = v_course
             order by coalesce(pp.completed_at, pp.started_at) desc, lp.id
             limit 1)
    from public.stats_member_ids(p_cohort) as m(id)
    join public.profiles p on p.id = m.id
    where not exists (select 1 from public.daily_activity a
                       where a.student_id = m.id and a.xp > 0
                         and a.day > v_today - v_days)
    order by 4 asc nulls first, p.full_name, m.id;
end
$$;

revoke execute on function
  public.teacher_kpis(uuid), public.daily_active(uuid, int), public.lesson_completion(uuid),
  public.curator_stats(uuid), public.idle_students(uuid, int)
  from public, anon;
grant execute on function
  public.teacher_kpis(uuid), public.daily_active(uuid, int), public.lesson_completion(uuid),
  public.curator_stats(uuid), public.idle_students(uuid, int)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- reminders: at most ONE "Eslatma" DM per student per Tashkent day. The row is the claim (inserted
-- before sending, removed again when sending fails). Service role only: no policies, no API grants.
-- ---------------------------------------------------------------------------
create table public.reminders (
  student_id uuid not null references public.profiles (id) on delete cascade,
  day        date not null,
  sent_at    timestamptz not null default now(),
  primary key (student_id, day)
);
alter table public.reminders enable row level security;
revoke all on public.reminders from anon, authenticated;

-- API roles never truncate, add triggers to, or reference tables directly.
revoke truncate, trigger, references on all tables in schema public from anon, authenticated;
