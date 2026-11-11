-- 0013_bot_sessions: video submissions through the Telegram bot. Task 21.
--
-- bot_sessions: the "pending task" a student opened with a deep link (/start task_<exerciseId>),
-- valid until expires_at. Service-role only: RLS enabled, no policies, no grants for API roles.

create table public.bot_sessions (
  telegram_id bigint primary key,
  exercise_id uuid not null references public.exercises (id) on delete cascade,
  expires_at  timestamptz not null,
  created_at  timestamptz not null default now()
);
create index bot_sessions_expires_at_idx on public.bot_sessions (expires_at);

alter table public.bot_sessions enable row level security;
revoke all on public.bot_sessions from anon, authenticated;

-- Telegram's per-file unique id: a re-delivered update (or the same file sent twice) can never
-- create two submissions.
alter table public.submissions add column tg_file_unique_id text;
create unique index submissions_tg_file_unique_id_key
  on public.submissions (tg_file_unique_id) where tg_file_unique_id is not null;

-- Atomic, rate-limited creation of a video submission (mirrors create_audio_submission in 0009):
-- serialized per (student, exercise) by an advisory lock; at most 3 video submissions per
-- exercise per 10 minutes.
-- Returns (submission_id, outcome):
--   'ok'               new row created
--   'duplicate'        the same file was already stored for THIS student and exercise (existing id)
--   'duplicate_other'  the file is already stored for someone/something else (null id; never leak the id)
--   'rate_limited'     (null id)
create function public.create_video_submission(
  p_student uuid, p_exercise uuid, p_group uuid, p_file_id text, p_file_unique_id text, p_archive_message_id bigint
) returns table (submission_id uuid, outcome text)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare
  v_id uuid;
  v_owner uuid;
  v_ex uuid;
begin
  if coalesce(p_file_id, '') = '' or coalesce(p_file_unique_id, '') = '' then
    raise exception 'file ids are required' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_student::text || p_exercise::text, 0));

  select s.id, s.student_id, s.exercise_id into v_id, v_owner, v_ex
  from public.submissions s where s.tg_file_unique_id = p_file_unique_id;
  if found then
    if v_owner = p_student and v_ex = p_exercise then
      return query select v_id, 'duplicate'::text;
    else
      return query select null::uuid, 'duplicate_other'::text;
    end if;
    return;
  end if;

  if (select count(*) from public.submissions s
      where s.student_id = p_student and s.exercise_id = p_exercise and s.kind = 'video'
        and s.created_at > now() - interval '10 minutes') >= 3 then
    return query select null::uuid, 'rate_limited'::text;
    return;
  end if;

  insert into public.submissions
    (student_id, exercise_id, curator_group_id, kind, tg_file_id, tg_file_unique_id, tg_archive_message_id, status)
  values
    (p_student, p_exercise, p_group, 'video', p_file_id, p_file_unique_id, p_archive_message_id, 'pending')
  on conflict (tg_file_unique_id) where tg_file_unique_id is not null do nothing
  returning id into v_id;
  if v_id is null then
    -- lost a race against another student/exercise holding the same file
    select s.id, s.student_id, s.exercise_id into v_id, v_owner, v_ex
    from public.submissions s where s.tg_file_unique_id = p_file_unique_id;
    if v_owner = p_student and v_ex = p_exercise then
      return query select v_id, 'duplicate'::text;
    else
      return query select null::uuid, 'duplicate_other'::text;
    end if;
    return;
  end if;
  return query select v_id, 'ok'::text;
end
$$;

revoke execute on function public.create_video_submission(uuid, uuid, uuid, text, text, bigint)
  from public, anon, authenticated;
grant execute on function public.create_video_submission(uuid, uuid, uuid, text, text, bigint) to service_role;

alter table public.submissions add column notify_claimed_at timestamptz;

-- ---------------------------------------------------------------------------
-- Notification lease (carry-over from the Task 20 review). Only the caller that wins runs completePart / the daily bump / the curator
-- notice. The lease lasts 2 minutes (a crashed worker is retried afterwards); notified_at ends it
-- for good. Only COMPLETED submissions can be claimed: audio needs storage_path, video needs
-- tg_file_id (audio rows with storage_path NULL are unfinished uploads).
-- ---------------------------------------------------------------------------
-- claim returns the lease TOKEN (the new notify_claimed_at) for the single winner, null otherwise;
-- release only gives back the lease that carries THAT token, so a stale holder cannot erase a newer
-- holder's lease.
create function public.claim_submission_notification(p_id uuid, p_student uuid) returns timestamptz
language sql volatile security definer set search_path = public as $$
  update public.submissions s set notify_claimed_at = clock_timestamp()
  where s.id = p_id and s.student_id = p_student and s.notified_at is null
    and (s.notify_claimed_at is null or s.notify_claimed_at < now() - interval '2 minutes')
    and ((s.kind = 'audio' and s.storage_path is not null)
      or (s.kind = 'video' and s.tg_file_id is not null)
      or s.kind = 'text')
  returning s.notify_claimed_at
$$;

create function public.release_submission_notification(p_id uuid, p_token timestamptz) returns void
language sql volatile security definer set search_path = public as $$
  update public.submissions set notify_claimed_at = null
  where id = p_id and notified_at is null and notify_claimed_at = p_token
$$;

revoke execute on function public.claim_submission_notification(uuid, uuid), public.release_submission_notification(uuid, timestamptz)
  from public, anon, authenticated;
grant execute on function public.claim_submission_notification(uuid, uuid), public.release_submission_notification(uuid, timestamptz)
  to service_role;

revoke truncate, trigger, references on all tables in schema public from anon, authenticated;
