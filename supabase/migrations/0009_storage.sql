-- 0009_storage: private `submissions` bucket for student audio recordings. Task 20.
--
-- Object name: <studentId>/<submissionId>.<ext>. Uploads happen ONLY through service-role signed
-- upload URLs issued by /api/submissions/audio-upload, so authenticated/anon get NO insert, update
-- or delete policies (and no grants). Read access:
--   student : own objects (first folder = auth.uid())
--   curator : objects of submissions in their groups; teacher: their course's; admin: all
--   (both only for COMPLETED submissions, i.e. submissions.storage_path = object name)

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('submissions', 'submissions', false, 10485760, array['audio/webm', 'audio/mp4', 'audio/ogg'])
on conflict (id) do nothing;

-- Submission id encoded in an object name, or null when the name does not match the shape.
create function public.submission_id_from_object(p_name text) returns uuid
language sql immutable as $$
  select case
    when p_name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(webm|mp4|ogg)$'
    then substring(p_name from '/([0-9a-f-]{36})\.')::uuid
  end
$$;

-- True when the object belongs to a completed submission whose student is the folder owner and
-- the caller may read that submission (reuses can_read_submission: student, group curator,
-- course teacher, admin).
create function public.can_read_submission_object(p_name text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.submissions s
    where s.id = public.submission_id_from_object(p_name)
      and s.kind = 'audio'
      and s.storage_path = p_name
      and s.student_id::text = split_part(p_name, '/', 1)
      and public.can_read_submission(s.id)
  )
$$;

revoke execute on function public.can_read_submission_object(text) from public, anon;
grant execute on function public.can_read_submission_object(text) to authenticated, service_role;

create policy submissions_objects_select_own on storage.objects for select to authenticated
  using (bucket_id = 'submissions' and (storage.foldername(name))[1] = auth.uid()::text);

create policy submissions_objects_select_staff on storage.objects for select to authenticated
  using (bucket_id = 'submissions' and public.can_read_submission_object(name));

-- No insert/update/delete policies exist (RLS already denies writes). Also drop the grants as
-- defence in depth. On hosted Supabase these tables belong to supabase_storage_admin, so a REVOKE
-- may be refused; that must not block later migrations.
do $$
begin
  revoke all on storage.objects, storage.buckets from anon;
  revoke insert, update, delete on storage.objects, storage.buckets from authenticated;
  revoke truncate, trigger, references on storage.objects, storage.buckets from anon, authenticated;
exception when insufficient_privilege then
  null;
end $$;

-- ---------------------------------------------------------------------------
-- Submissions: notification marker + atomic, rate-limited creation of audio uploads
-- ---------------------------------------------------------------------------
-- notified_at: set by audio-complete once part completion, the daily bump and the curator
-- notification all succeeded, so a retried completion finishes whatever a failed one left undone.
alter table public.submissions add column notified_at timestamptz;

-- Rate limit rule (per student + exercise, serialized by an advisory lock so parallel requests
-- cannot overshoot):
--   * COMPLETED audio rows (storage_path not null) created in the last 10 minutes: at most 3;
--   * INCOMPLETE audio rows (storage_path null) in the last hour: at most 10, so failed sends do not
--     lock a student out but orphan rows stay bounded.
-- Returns (submission_id, 'ok') or (null, 'rate_limited' | 'too_many_incomplete').
create function public.create_audio_submission(p_student uuid, p_exercise uuid, p_group uuid, p_ext text)
returns table (submission_id uuid, outcome text)
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
begin
  if p_ext not in ('webm', 'mp4', 'ogg') then
    raise exception 'invalid extension' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_student::text || p_exercise::text, 0));
  if (select count(*) from public.submissions s
      where s.student_id = p_student and s.exercise_id = p_exercise and s.kind = 'audio'
        and s.storage_path is not null and s.created_at > now() - interval '10 minutes') >= 3 then
    return query select null::uuid, 'rate_limited'::text;
    return;
  end if;
  if (select count(*) from public.submissions s
      where s.student_id = p_student and s.exercise_id = p_exercise and s.kind = 'audio'
        and s.storage_path is null and s.created_at > now() - interval '1 hour') >= 10 then
    return query select null::uuid, 'too_many_incomplete'::text;
    return;
  end if;
  insert into public.submissions (student_id, exercise_id, curator_group_id, kind, status)
  values (p_student, p_exercise, p_group, 'audio', 'pending')
  returning id into v_id;
  return query select v_id, 'ok'::text;
end
$$;

revoke execute on function public.create_audio_submission(uuid, uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.create_audio_submission(uuid, uuid, uuid, text) to service_role;
