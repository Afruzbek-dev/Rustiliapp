-- 0014_review_helpers: review service SQL (authority, atomic submit + XP, draft scoring). Task 22.
-- (The notification lease, claim_submission_notification, lives in 0013 so Task 21 is self-contained.)

-- The Telegram message carrying the rubric keyboard, kept so it can be edited after the review.
alter table public.submissions
  add column curator_chat_id    bigint,
  add column curator_message_id bigint;

-- ---------------------------------------------------------------------------
-- Column-level read access: students (and curators/teachers) read their submissions through
-- submissions_select, but the review-workflow internals are server-only. Grant the readable columns
-- explicitly; a NEW column on submissions is therefore invisible to API roles until granted here.
-- Hidden: draft_scores, curator_chat_id, curator_message_id, notify_claimed_at.
-- ---------------------------------------------------------------------------
revoke select on public.submissions from authenticated;
grant select (id, student_id, exercise_id, curator_group_id, kind, storage_path, tg_file_id,
              tg_archive_message_id, tg_file_unique_id, text_answer, status, created_at, notified_at)
  on public.submissions to authenticated;

-- ---------------------------------------------------------------------------
-- Who may review a submission: 'curator' (curator of its group), 'staff' (the course's teacher or
-- an admin) or null. The profile role must match, so a student mistakenly set as curator_id
-- gains nothing. Nobody reviews their OWN submission (a staff member enrolled as a student could
-- otherwise farm XP): s.student_id <> r.id.
-- ---------------------------------------------------------------------------
create function public.review_authority(p_submission uuid, p_reviewer uuid) returns text
language sql stable security definer set search_path = public as $$
  select case
    when s.student_id = r.id then null
    when r.role = 'admin' then 'staff'
    when r.role = 'teacher' and exists (
      select 1 from public.courses c where c.id = e.course_id and c.teacher_id = r.id) then 'staff'
    when r.role = 'curator' and exists (
      select 1 from public.curator_groups g where g.id = s.curator_group_id and g.curator_id = r.id) then 'curator'
  end
  from public.submissions s
  join public.exercises e on e.id = s.exercise_id
  join public.profiles r on r.id = p_reviewer
  where s.id = p_submission
$$;

-- ---------------------------------------------------------------------------
-- submit_review: the status flip, the review row and the XP award are ONE transaction.
--   first review (status flip happened): anyone with authority; pays award_xp(student,
--             round(40 * total / 5), 'speaking_reviewed', submission id) for audio and video only
--             (same formula as speakingXp() in TypeScript, parity-tested);
--   already reviewed: accepted ONLY when p_allow_override is true AND the reviewer is staff
--             (teacher/admin): stored with is_override = true, history kept (rows are only ever
--             inserted), no XP. Everyone else (curators, staff without the flag, Telegram) gets
--             'already_reviewed'.
-- total = mean of the four criteria, rounded to 2 decimals (the table check re-verifies it).
-- Returns (outcome, review_id, total, is_override, student_id, xp_awarded); outcome is one of
-- ok | duplicate | forbidden | not_found | unsupported_kind | incomplete | already_reviewed.
-- The student DM and the curator-message edit stay in the application, after commit.
-- ---------------------------------------------------------------------------
create function public.submit_review(
  p_submission uuid, p_reviewer uuid, p_channel public.review_channel, p_scores jsonb, p_comment text,
  p_allow_override boolean default false
) returns table (outcome text, review_id uuid, total numeric, is_override boolean, student_id uuid, xp_awarded boolean)
language plpgsql volatile security definer set search_path = public as $$
#variable_conflict use_column
declare
  s public.submissions;
  v_auth text;
  v_override boolean := false;
  v_total numeric;
  v_id uuid;
  v_flipped uuid;
  v_xp boolean := false;
begin
  select * into s from public.submissions where id = p_submission;
  if not found then
    return query select 'not_found'::text, null::uuid, null::numeric, null::boolean, null::uuid, null::boolean;
    return;
  end if;
  -- explicit self-review refusal (review_authority returns null for it as well)
  v_auth := case when s.student_id = p_reviewer then null else public.review_authority(p_submission, p_reviewer) end;
  if v_auth is null then
    return query select 'forbidden'::text, null::uuid, null::numeric, null::boolean, null::uuid, null::boolean;
    return;
  end if;
  if s.kind not in ('audio', 'video') then
    -- text answers have no review rules (and earn no speaking XP) yet
    return query select 'unsupported_kind'::text, null::uuid, null::numeric, null::boolean, null::uuid, null::boolean;
    return;
  end if;
  if (s.kind = 'audio' and s.storage_path is null) or (s.kind = 'video' and s.tg_file_id is null) then
    return query select 'incomplete'::text, null::uuid, null::numeric, null::boolean, null::uuid, null::boolean;
    return;
  end if;
  if not public.valid_review_scores(p_scores) then
    raise exception 'invalid scores' using errcode = '22023';
  end if;
  v_total := round(((p_scores ->> 'completeness')::numeric + (p_scores ->> 'pronunciation')::numeric
                  + (p_scores ->> 'grammar')::numeric + (p_scores ->> 'fluency')::numeric) / 4, 2);

  update public.submissions set status = 'reviewed', draft_scores = '{}'
  where id = p_submission and status = 'pending'
  returning id into v_flipped;
  if v_flipped is null then
    if not (p_allow_override and v_auth = 'staff') then
      return query select 'already_reviewed'::text, null::uuid, null::numeric, null::boolean, null::uuid, null::boolean;
      return;
    end if;
    v_override := true;
    -- a double submit of the SAME override (same reviewer, scores and comment within 30 s) is not a
    -- new review: serialize per submission, then return the existing row ('duplicate')
    perform pg_advisory_xact_lock(hashtextextended(p_submission::text, 1));
    select r.id into v_id from public.reviews r
    where r.submission_id = p_submission and r.reviewer_id = p_reviewer and r.is_override
      and r.scores = p_scores
      and r.comment is not distinct from nullif(btrim(coalesce(p_comment, '')), '')
      and r.created_at > now() - interval '30 seconds'
    order by r.created_at desc limit 1;
    if v_id is not null then
      return query select 'duplicate'::text, v_id, v_total, true, s.student_id, false;
      return;
    end if;
  end if;

  insert into public.reviews (submission_id, reviewer_id, channel, scores, total, comment, is_override)
  values (p_submission, p_reviewer, p_channel, p_scores, v_total, nullif(btrim(coalesce(p_comment, '')), ''), v_override)
  returning id into v_id;

  if v_flipped is not null then
    v_xp := public.award_xp(s.student_id, round(40 * v_total / 5)::int, 'speaking_reviewed', p_submission::text);
  end if;
  return query select 'ok'::text, v_id, v_total, v_override, s.student_id, v_xp;
end
$$;

-- ---------------------------------------------------------------------------
-- Draft scoring from Telegram: one criterion at a time, atomic per key (jsonb_set), only while the
-- submission is still pending. The actor is authorised HERE too (review_authority), so draft writes
-- by anyone without authority are impossible even if the application check were skipped.
-- Returns the new draft, or null when nothing was updated (already reviewed / unknown).
-- ---------------------------------------------------------------------------
create function public.set_draft_score(p_submission uuid, p_actor uuid, p_criterion text, p_value int) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  v jsonb;
begin
  if p_criterion not in ('completeness', 'pronunciation', 'grammar', 'fluency') or p_value not between 1 and 5 then
    raise exception 'invalid draft score' using errcode = '22023';
  end if;
  if public.review_authority(p_submission, p_actor) is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  update public.submissions
  set draft_scores = jsonb_set(draft_scores, array[p_criterion], to_jsonb(p_value), true)
  where id = p_submission and status = 'pending'
  returning draft_scores into v;
  return v;
end
$$;

revoke execute on function
  public.review_authority(uuid, uuid), public.submit_review(uuid, uuid, public.review_channel, jsonb, text, boolean),
  public.set_draft_score(uuid, uuid, text, int)
  from public, anon, authenticated;
grant execute on function
  public.review_authority(uuid, uuid), public.submit_review(uuid, uuid, public.review_channel, jsonb, text, boolean),
  public.set_draft_score(uuid, uuid, text, int)
  to service_role;

revoke truncate, trigger, references on all tables in schema public from anon, authenticated;
