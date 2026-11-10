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

-- No insert/update/delete policies exist; also drop the grants (defence in depth).
revoke all on storage.objects, storage.buckets from anon;
revoke insert, update, delete on storage.objects, storage.buckets from authenticated;
revoke truncate, trigger, references on storage.objects, storage.buckets from anon, authenticated;
