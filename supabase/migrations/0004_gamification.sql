-- 0004_gamification: XP ledger, daily activity, achievements, leaderboards. Spec §10.
--
-- XP is written only by the server: award_xp() is executable by service_role alone, and
-- API roles have SELECT-only access to the ledger. Students never read other students'
-- XP directly; leaderboards are served by the security definer leaderboard() function,
-- which returns display names and scores only.

-- ---------------------------------------------------------------------------
-- Enums & tables
-- ---------------------------------------------------------------------------
create type public.xp_reason as enum
  ('exercise_correct', 'part_completed', 'speaking_reviewed', 'daily_tasks', 'streak_bonus', 'test_completed');

create table public.xp_events (
  id         uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles (id) on delete cascade,
  amount     int not null check (amount > 0),
  reason     public.xp_reason not null,
  ref_id     text not null,
  created_at timestamptz not null default now(),
  unique (student_id, reason, ref_id)
);
create index xp_events_student_created_idx on public.xp_events (student_id, created_at);

-- day is the Asia/Tashkent calendar day
create table public.daily_activity (
  student_id uuid not null references public.profiles (id) on delete cascade,
  day        date not null,
  xp         int not null default 0,
  tasks      jsonb not null default '{}',
  primary key (student_id, day)
);

create table public.achievements (
  code        text primary key,
  title       text not null,
  description text not null,
  icon        text not null -- lucide-react icon name
);

create table public.student_achievements (
  student_id uuid not null references public.profiles (id) on delete cascade,
  code       text not null references public.achievements (code) on delete cascade,
  earned_at  timestamptz not null default now(),
  primary key (student_id, code)
);

insert into public.achievements (code, title, description, icon) values
  ('first_lesson',        'Birinchi dars',        'Birinchi darsni tugatdingiz',                    'BookOpenCheck'),
  ('words_100',           '100 so''z',            '100 ta so''zni yodladingiz',                      'Library'),
  ('streak_7',            '7 kunlik streak',      '7 kun ketma-ket shug''ullandingiz',               'Flame'),
  ('grammar_master',      'Grammatika ustasi',    'Grammatika mashqlarini a''lo bajardingiz',        'GraduationCap'),
  ('listening_champion',  'Tinglash chempioni',   'Tinglash mashqlarida eng yaxshi natija',          'Headphones'),
  ('speaking_champion',   'Gapirish chempioni',   'Gapirish reytingida birinchi o''rin',             'Mic');

-- ---------------------------------------------------------------------------
-- Day bucketing: every XP event adds to daily_activity of its Tashkent day.
-- Done in a trigger so any insert into the ledger (award_xp or a service-role backfill)
-- keeps daily_activity consistent.
-- ---------------------------------------------------------------------------
create function public.tashkent_day(p_at timestamptz) returns date
language sql immutable set search_path = public as $$
  select (p_at at time zone 'Asia/Tashkent')::date
$$;

create function public.xp_events_to_daily_activity() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.daily_activity as d (student_id, day, xp)
  values (new.student_id, public.tashkent_day(new.created_at), new.amount)
  on conflict (student_id, day) do update set xp = d.xp + excluded.xp;
  return null;
end
$$;

create trigger xp_events_to_daily_activity
  after insert on public.xp_events
  for each row execute function public.xp_events_to_daily_activity();

-- ---------------------------------------------------------------------------
-- award_xp: idempotent per (student, reason, ref). Returns true when XP was granted.
-- ---------------------------------------------------------------------------
create function public.award_xp(p_student uuid, p_amount int, p_reason public.xp_reason, p_ref text)
returns boolean
language plpgsql volatile security definer set search_path = public as $$
declare
  v_id uuid;
begin
  insert into public.xp_events (student_id, amount, reason, ref_id)
  values (p_student, p_amount, p_reason, p_ref)
  on conflict (student_id, reason, ref_id) do nothing
  returning id into v_id;
  return v_id is not null;
end
$$;

revoke execute on function public.award_xp(uuid, int, public.xp_reason, text) from public, anon, authenticated;
grant execute on function public.award_xp(uuid, int, public.xp_reason, text) to service_role;

-- ---------------------------------------------------------------------------
-- Leaderboards
-- ---------------------------------------------------------------------------
-- 'Madina Rahimova' -> 'Madina R.'
create function public.display_name(p_full_name text) returns text
language sql immutable set search_path = public as $$
  select case
           when coalesce(parts[1], '') = '' then 'O''quvchi'
           when array_length(parts, 1) >= 2 then parts[1] || ' ' || upper(left(parts[2], 1)) || '.'
           else parts[1]
         end
  from (select regexp_split_to_array(btrim(coalesce(p_full_name, '')), '\s+') as parts) s
$$;

-- p_kind: 'xp' | 'speaking'; p_period: 'week' (from Monday 00:00 Asia/Tashkent) | 'month'
-- (from the 1st, 00:00 Asia/Tashkent). Members are the cohort's active, unexpired students.
-- speaking: mean of the latest review total of each audio/video submission made in the
-- period for this course; eligible when count >= 8; eligible first, then mean desc,
-- then count desc. The caller must be an active member of the cohort, its curator, its
-- teacher or an admin; otherwise the result is empty.
create function public.leaderboard(p_cohort uuid, p_kind text, p_period text)
returns table (rank int, student_id uuid, display_name text, score numeric, eligible boolean)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare
  v_start  timestamptz;
  v_course uuid;
begin
  if p_kind is null or p_kind not in ('xp', 'speaking') then
    raise exception 'leaderboard: invalid kind %', p_kind using errcode = '22023';
  end if;
  if p_period is null or p_period not in ('week', 'month') then
    raise exception 'leaderboard: invalid period %', p_period using errcode = '22023';
  end if;

  if not (
    auth.role() = 'service_role'
    or p_cohort in (select public.active_cohort_ids())
    or p_cohort in (select public.curated_cohort_ids())
    or public.teaches_cohort(p_cohort)
  ) then
    return;
  end if;

  select c.course_id into v_course from public.cohorts c where c.id = p_cohort;
  v_start := date_trunc(p_period, now() at time zone 'Asia/Tashkent') at time zone 'Asia/Tashkent';

  if p_kind = 'xp' then
    return query
      with members as (
        select e.student_id
        from public.enrollments e
        where e.cohort_id = p_cohort
          and e.status = 'active'
          and (e.expires_at is null or e.expires_at > now())
      ),
      totals as (
        select m.student_id, coalesce(sum(x.amount), 0)::numeric as score
        from members m
        left join public.xp_events x on x.student_id = m.student_id and x.created_at >= v_start
        group by m.student_id
      )
      select (rank() over (order by t.score desc))::int,
             t.student_id,
             public.display_name(p.full_name),
             t.score,
             true
      from totals t
      join public.profiles p on p.id = t.student_id
      order by 1, 3;
  else
    return query
      with members as (
        select e.student_id
        from public.enrollments e
        where e.cohort_id = p_cohort
          and e.status = 'active'
          and (e.expires_at is null or e.expires_at > now())
      ),
      latest as (
        select distinct on (r.submission_id) s.student_id, r.total
        from public.submissions s
        join members m on m.student_id = s.student_id
        join public.exercises ex on ex.id = s.exercise_id
        join public.reviews r on r.submission_id = s.id
        where s.kind in ('audio', 'video')
          and s.created_at >= v_start
          and ex.course_id = v_course
        order by r.submission_id, r.created_at desc, r.id desc
      ),
      agg as (
        select l.student_id, round(avg(l.total), 2) as score, count(*) as n
        from latest l
        group by l.student_id
      )
      select (rank() over (order by (a.n >= 8) desc, a.score desc, a.n desc))::int,
             a.student_id,
             public.display_name(p.full_name),
             a.score,
             a.n >= 8
      from agg a
      join public.profiles p on p.id = a.student_id
      order by 1, 3;
  end if;
end
$$;

revoke execute on function public.leaderboard(uuid, text, text) from public, anon;
grant execute on function public.leaderboard(uuid, text, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- RLS: read-only for API roles.
-- ---------------------------------------------------------------------------
alter table public.xp_events            enable row level security;
alter table public.daily_activity       enable row level security;
alter table public.achievements         enable row level security;
alter table public.student_achievements enable row level security;

revoke all on public.xp_events, public.daily_activity, public.achievements, public.student_achievements from anon;
revoke insert, update, delete, truncate on public.xp_events, public.daily_activity, public.achievements,
  public.student_achievements from authenticated;

create policy xp_events_select on public.xp_events for select to authenticated
  using (
    student_id = auth.uid()
    or student_id in (select public.curated_student_ids())
    or student_id in (select public.taught_student_ids())
  );

create policy daily_activity_select on public.daily_activity for select to authenticated
  using (
    student_id = auth.uid()
    or student_id in (select public.curated_student_ids())
    or student_id in (select public.taught_student_ids())
  );

create policy achievements_select on public.achievements for select to authenticated
  using (true);

create policy student_achievements_select on public.student_achievements for select to authenticated
  using (
    student_id = auth.uid()
    or student_id in (select public.curated_student_ids())
    or student_id in (select public.taught_student_ids())
  );

-- ---------------------------------------------------------------------------
-- API roles never truncate, add triggers to, or reference tables directly.
-- ---------------------------------------------------------------------------
revoke truncate, trigger, references on all tables in schema public from anon, authenticated;
