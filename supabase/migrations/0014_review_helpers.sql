-- 0014_review_helpers: review service SQL (authority, atomic submit, draft scoring). Task 22.
-- (The notification lease, claim_submission_notification, lives in 0013 so Task 21 is self-contained.)

-- The Telegram message carrying the rubric keyboard, kept so it can be edited after the review.
alter table public.submissions
  add column curator_chat_id    bigint,
  add column curator_message_id bigint;

-- ---------------------------------------------------------------------------
-- Who may review a submission: 'curator' (curator of its group), 'staff' (the course's teacher or
-- an admin) or null. The profile role must match, so a student mistakenly set as curator_id
-- gains nothing.
-- ---------------------------------------------------------------------------
create function public.review_authority(p_submission uuid, p_reviewer uuid) returns text
language sql stable security definer set search_path = public as $$
  select case
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
-- submit_review: the status flip and the review row are ONE transaction.
--   curator : FIRST review wins (update ... where status = 'pending' returning); 0 rows -> 'already_reviewed'
--   staff   : may review at any time; on an already reviewed submission the review is stored with
--             is_override = true (history kept: rows are only ever inserted)
-- total = mean of the four criteria, rounded to 2 decimals (the table check re-verifies it).
-- Returns (outcome, review_id, total, is_override, student_id) with outcome one of
-- ok | forbidden | not_found | incomplete | already_reviewed. XP and the DM stay in the application,
-- after commit.
-- ---------------------------------------------------------------------------
create function public.submit_review(
  p_submission uuid, p_reviewer uuid, p_channel public.review_channel, p_scores jsonb, p_comment text
) returns table (outcome text, review_id uuid, total numeric, is_override boolean, student_id uuid)
language plpgsql volatile security definer set search_path = public as $$
#variable_conflict use_column
declare
  s public.submissions;
  v_auth text;
  v_override boolean := false;
  v_total numeric;
  v_id uuid;
  v_flipped uuid;
begin
  select * into s from public.submissions where id = p_submission;
  if not found then
    return query select 'not_found'::text, null::uuid, null::numeric, null::boolean, null::uuid;
    return;
  end if;
  v_auth := public.review_authority(p_submission, p_reviewer);
  if v_auth is null then
    return query select 'forbidden'::text, null::uuid, null::numeric, null::boolean, null::uuid;
    return;
  end if;
  if (s.kind = 'audio' and s.storage_path is null)
     or (s.kind = 'video' and s.tg_file_id is null)
     or (s.kind = 'text' and s.text_answer is null) then
    return query select 'incomplete'::text, null::uuid, null::numeric, null::boolean, null::uuid;
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
    if v_auth = 'curator' then
      return query select 'already_reviewed'::text, null::uuid, null::numeric, null::boolean, null::uuid;
      return;
    end if;
    v_override := true;
  end if;

  insert into public.reviews (submission_id, reviewer_id, channel, scores, total, comment, is_override)
  values (p_submission, p_reviewer, p_channel, p_scores, v_total, nullif(btrim(coalesce(p_comment, '')), ''), v_override)
  returning id into v_id;
  return query select 'ok'::text, v_id, v_total, v_override, s.student_id;
end
$$;

-- ---------------------------------------------------------------------------
-- Draft scoring from Telegram: one criterion at a time, atomic per key (jsonb_set), only while the
-- submission is still pending. Returns the new draft, or null when nothing was updated.
-- ---------------------------------------------------------------------------
create function public.set_draft_score(p_submission uuid, p_criterion text, p_value int) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  v jsonb;
begin
  if p_criterion not in ('completeness', 'pronunciation', 'grammar', 'fluency') or p_value not between 1 and 5 then
    raise exception 'invalid draft score' using errcode = '22023';
  end if;
  update public.submissions
  set draft_scores = jsonb_set(draft_scores, array[p_criterion], to_jsonb(p_value), true)
  where id = p_submission and status = 'pending'
  returning draft_scores into v;
  return v;
end
$$;

revoke execute on function
  public.review_authority(uuid, uuid), public.submit_review(uuid, uuid, public.review_channel, jsonb, text),
  public.set_draft_score(uuid, text, int)
  from public, anon, authenticated;
grant execute on function
  public.review_authority(uuid, uuid), public.submit_review(uuid, uuid, public.review_channel, jsonb, text),
  public.set_draft_score(uuid, text, int)
  to service_role;

revoke truncate, trigger, references on all tables in schema public from anon, authenticated;
