-- 0016_content_editor: everything the teacher lesson editor (Task 26) needs in the database.
--
--  1. private `content` storage bucket. Object name: <courseId>/<uuid>.<ext>. A teacher may read,
--     upload, replace and delete ONLY under the folder of a course they teach (admin: any course).
--     Students, curators and anon have NO policy: they only ever get 1-hour signed URLs that the
--     server signs for published blocks (src/server/content-media.ts).
--  2. M5 (ledger): exercises.course_id is a denormalised copy of the block's course. Moving a
--     module/lesson/part/block to ANOTHER course would leave it stale, so such moves are forbidden
--     by triggers (moves inside one course never change it).
--  3. a block's media path must live under its own course folder (otherwise a teacher could point a
--     block at another course's file and have the server sign it).
--  4. blocks.updated_at only moves when content changes (reordering / publishing must not invalidate the
--     optimistic-concurrency tokens of open editors); lessons get an updated_at too.
--  5. editor_* functions: atomic, authorised writes. SECURITY DEFINER, search_path pinned, EXECUTE for
--     service_role ONLY. Each takes the acting user (p_actor) and re-checks it in SQL
--     (admin, or teacher of the course); a failed check raises 42501 'forbidden' (also for unknown
--     ids, so existence is not an oracle). Answer keys are written to exercise_keys only; they
--     never enter blocks.payload / exercises.payload.

-- ---------------------------------------------------------------------------
-- 1. content bucket
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'content', 'content', false, 20971520,
  array['audio/mpeg', 'audio/mp3', 'audio/mp4', 'audio/x-m4a', 'audio/ogg', 'audio/wav', 'audio/x-wav', 'audio/wave', 'audio/webm',
        'image/png', 'image/jpeg', 'image/webp']
)
on conflict (id) do nothing;

-- Course id encoded in an object name, or null when the name does not have the shape
-- <uuid>/<uuid>.<ext>.
create function public.content_object_course(p_name text) returns uuid
language sql immutable as $$
  select case
    when p_name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(mp3|m4a|mp4|ogg|wav|webm|png|jpg|jpeg|webp)$'
    then split_part(p_name, '/', 1)::uuid
  end
$$;

-- teaches_course(null) is true for admins, so a missing course must be rejected explicitly.
create function public.can_write_content_object(p_name text) returns boolean
language sql stable security definer set search_path = public as $$
  select public.content_object_course(p_name) is not null
     and public.teaches_course(public.content_object_course(p_name))
$$;

revoke execute on function public.can_write_content_object(text) from public, anon;
grant execute on function public.can_write_content_object(text) to authenticated, service_role;

create policy content_objects_select on storage.objects for select to authenticated
  using (bucket_id = 'content' and public.can_write_content_object(name));
create policy content_objects_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'content' and public.can_write_content_object(name));
create policy content_objects_update on storage.objects for update to authenticated
  using (bucket_id = 'content' and public.can_write_content_object(name))
  with check (bucket_id = 'content' and public.can_write_content_object(name));
create policy content_objects_delete on storage.objects for delete to authenticated
  using (bucket_id = 'content' and public.can_write_content_object(name));

-- 0009 revoked write grants from authenticated; teachers need them back (RLS above is what limits
-- them: no other bucket has an insert/update/delete policy). On hosted Supabase the grants exist
-- already and the tables belong to supabase_storage_admin, so failures here must not block.
do $$
begin
  grant insert, update, delete on storage.objects to authenticated;
exception when insufficient_privilege then
  null;
end $$;

-- ---------------------------------------------------------------------------
-- 2. M5: no cross-course moves
-- ---------------------------------------------------------------------------
create function public.forbid_cross_course_move() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_old uuid;
  v_new uuid;
begin
  if tg_table_name = 'modules' then
    v_old := old.course_id;
    v_new := new.course_id;
  elsif tg_table_name = 'lessons' then
    v_old := public.module_course_id(old.module_id);
    v_new := public.module_course_id(new.module_id);
  elsif tg_table_name = 'lesson_parts' then
    v_old := public.lesson_course_id(old.lesson_id);
    v_new := public.lesson_course_id(new.lesson_id);
  else
    v_old := public.part_course_id(old.lesson_part_id);
    v_new := public.part_course_id(new.lesson_part_id);
  end if;
  if v_old is distinct from v_new then
    raise exception 'content cannot be moved to another course' using errcode = '23514';
  end if;
  return new;
end
$$;

create trigger modules_no_cross_course before update of course_id on public.modules
  for each row execute function public.forbid_cross_course_move();
create trigger lessons_no_cross_course before update of module_id on public.lessons
  for each row execute function public.forbid_cross_course_move();
create trigger lesson_parts_no_cross_course before update of lesson_id on public.lesson_parts
  for each row execute function public.forbid_cross_course_move();
create trigger blocks_no_cross_course before update of lesson_part_id on public.blocks
  for each row execute function public.forbid_cross_course_move();

-- ---------------------------------------------------------------------------
-- 3. media path must stay inside the block's course folder
-- ---------------------------------------------------------------------------
create function public.blocks_check_media_path() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_course uuid := public.part_course_id(new.lesson_part_id);
begin
  if new.type in ('audio', 'rule_image') and new.payload ? 'path' then
    if jsonb_typeof(new.payload -> 'path') <> 'string'
       or split_part(new.payload ->> 'path', '/', 1) <> v_course::text
       or public.content_object_course(new.payload ->> 'path') is distinct from v_course then
      raise exception 'media path must be <courseId>/<file> of the block''s own course' using errcode = '23514';
    end if;
  end if;
  return new;
end
$$;

create trigger blocks_check_media_path before insert or update of payload, type on public.blocks
  for each row execute function public.blocks_check_media_path();

-- ---------------------------------------------------------------------------
-- 4. updated_at semantics
-- ---------------------------------------------------------------------------
drop trigger blocks_touch_updated_at on public.blocks;

create function public.blocks_touch() returns trigger
language plpgsql set search_path = public as $$
begin
  -- `published` is deliberately NOT a content change: publishing a lesson must not invalidate the
  -- concurrency tokens of editors that are open on its blocks.
  if new.payload is distinct from old.payload
     or new.type is distinct from old.type then
    new.updated_at := clock_timestamp();
  end if;
  return new;
end
$$;

create trigger blocks_touch_updated_at before update on public.blocks
  for each row execute function public.blocks_touch();

alter table public.lessons add column updated_at timestamptz not null default now();

create function public.lessons_touch() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.title is distinct from old.title or new.objective is distinct from old.objective then
    new.updated_at := clock_timestamp();
  end if;
  return new;
end
$$;

create trigger lessons_touch_updated_at before update on public.lessons
  for each row execute function public.lessons_touch();

-- ---------------------------------------------------------------------------
-- 5. editor functions
-- ---------------------------------------------------------------------------
create function public.can_edit_course_as(p_actor uuid, p_course uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select p_actor is not null and p_course is not null and exists (
    select 1 from public.profiles p
    where p.id = p_actor
      and (p.role = 'admin'
           or (p.role = 'teacher'
               and exists (select 1 from public.courses c where c.id = p_course and c.teacher_id = p_actor)))
  )
$$;

create function public.editor_require(p_actor uuid, p_course uuid) returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.can_edit_course_as(p_actor, p_course) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
end
$$;

-- modules / lessons ----------------------------------------------------------
create function public.editor_create_module(p_actor uuid, p_course uuid, p_title text) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
begin
  perform public.editor_require(p_actor, p_course);
  if p_title is null or length(btrim(p_title)) not between 1 and 200 then
    raise exception 'invalid title' using errcode = '22023';
  end if;
  perform 1 from public.courses where id = p_course for update;
  insert into public.modules (course_id, position, title)
  values (p_course, coalesce((select max(position) from public.modules where course_id = p_course), 0) + 1, btrim(p_title))
  returning id into v_id;
  return v_id;
end
$$;

create function public.editor_create_lesson(p_actor uuid, p_module uuid, p_title text) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
begin
  perform public.editor_require(p_actor, public.module_course_id(p_module));
  if p_title is null or length(btrim(p_title)) not between 1 and 200 then
    raise exception 'invalid title' using errcode = '22023';
  end if;
  perform 1 from public.modules where id = p_module for update;
  insert into public.lessons (module_id, position, title)
  values (p_module, coalesce((select max(position) from public.lessons where module_id = p_module), 0) + 1, btrim(p_title))
  returning id into v_id;
  insert into public.lesson_parts (lesson_id, position, kind, title) values
    (v_id, 1, 'grammar', 'Grammatika'),
    (v_id, 2, 'conversation', 'Razgovor');
  return v_id;
end
$$;

-- Optimistic concurrency: p_expected is the updated_at the editor last saw (text, microseconds kept).
create function public.editor_save_lesson(
  p_actor uuid, p_lesson uuid, p_title text, p_objective text, p_expected text
) returns table (outcome text, updated_at text)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare
  v_cur timestamptz;
begin
  perform public.editor_require(p_actor, public.lesson_course_id(p_lesson));
  if p_title is null or length(btrim(p_title)) not between 1 and 200
     or (p_objective is not null and length(p_objective) > 1000) then
    raise exception 'invalid lesson' using errcode = '22023';
  end if;
  select l.updated_at into v_cur from public.lessons l where l.id = p_lesson for update;
  if v_cur is distinct from p_expected::timestamptz then
    return query select 'conflict'::text, v_cur::text;
    return;
  end if;
  update public.lessons l
     set title = btrim(p_title), objective = nullif(btrim(coalesce(p_objective, '')), '')
   where l.id = p_lesson
  returning l.updated_at into v_cur;
  return query select 'ok'::text, v_cur::text;
end
$$;

-- blocks ---------------------------------------------------------------------
-- p_exercise (exercise / speaking blocks only): {type, prompt, payload, check_mode, xp, key}
create function public.editor_write_exercise(p_block uuid, p_course uuid, p_exercise jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_ex uuid;
  v_type public.exercise_type := (p_exercise ->> 'type')::public.exercise_type;
  v_old public.exercise_type;
  v_key jsonb := p_exercise -> 'key';
begin
  select e.id, e.type into v_ex, v_old from public.exercises e where e.block_id = p_block for update;
  if v_ex is null then
    insert into public.exercises (course_id, block_id, type, prompt, payload, check_mode, xp)
    values (
      p_course, p_block, v_type,
      nullif(p_exercise ->> 'prompt', ''),
      coalesce(p_exercise -> 'payload', '{}'::jsonb),
      coalesce(p_exercise ->> 'check_mode', 'auto')::public.check_mode,
      coalesce((p_exercise ->> 'xp')::int, 10)
    )
    returning id into v_ex;
  else
    -- M5: students already answered it, so its type (and so the meaning of their answers) is frozen
    if v_old is distinct from v_type
       and (exists (select 1 from public.attempts a where a.exercise_id = v_ex)
            or exists (select 1 from public.submissions s where s.exercise_id = v_ex)) then
      raise exception 'exercise type locked' using errcode = '23514';
    end if;
    update public.exercises
       set type = v_type,
           prompt = nullif(p_exercise ->> 'prompt', ''),
           payload = coalesce(p_exercise -> 'payload', '{}'::jsonb),
           check_mode = coalesce(p_exercise ->> 'check_mode', 'auto')::public.check_mode,
           xp = coalesce((p_exercise ->> 'xp')::int, 10)
     where id = v_ex;
  end if;
  if v_type = 'speaking' then
    delete from public.exercise_keys where exercise_id = v_ex;
  elsif v_key is not null and jsonb_typeof(v_key) in ('object', 'array') then
    insert into public.exercise_keys (exercise_id, answer) values (v_ex, v_key)
    on conflict (exercise_id) do update set answer = excluded.answer;
  elsif not exists (select 1 from public.exercise_keys where exercise_id = v_ex) then
    insert into public.exercise_keys (exercise_id, answer) values (v_ex, '{}'::jsonb);
  end if;
  -- a missing / non-object key NEVER erases the key of an existing exercise
  update public.blocks set payload = jsonb_build_object('exerciseId', v_ex) where id = p_block;
end
$$;

revoke execute on function public.editor_write_exercise(uuid, uuid, jsonb) from public, anon, authenticated, service_role;

create function public.editor_create_block(
  p_actor uuid, p_part uuid, p_type public.block_type, p_payload jsonb, p_exercise jsonb
) returns table (block_id uuid, updated_at text)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare
  v_course uuid := public.part_course_id(p_part);
  v_id uuid;
  v_upd timestamptz;
begin
  perform public.editor_require(p_actor, v_course);
  if p_type in ('exercise', 'speaking') and p_exercise is null then
    raise exception 'exercise data required' using errcode = '22023';
  end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' or length(p_payload::text) > 200000 then
    raise exception 'invalid payload' using errcode = '22023';
  end if;
  perform 1 from public.lesson_parts where id = p_part for update;
  insert into public.blocks (lesson_part_id, position, type, payload, published)
  values (
    p_part,
    coalesce((select max(b.position) from public.blocks b where b.lesson_part_id = p_part), 0) + 1,
    p_type,
    case when p_type in ('exercise', 'speaking') then '{}'::jsonb else p_payload end,
    false
  )
  returning id into v_id;
  if p_type in ('exercise', 'speaking') then
    perform public.editor_write_exercise(v_id, v_course, p_exercise);
  end if;
  select b.updated_at into v_upd from public.blocks b where b.id = v_id;
  return query select v_id, v_upd::text;
end
$$;

create function public.editor_save_block(
  p_actor uuid, p_block uuid, p_payload jsonb, p_exercise jsonb, p_expected text
) returns table (outcome text, updated_at text)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare
  v_course uuid := public.block_course_id(p_block);
  v_type public.block_type;
  v_cur timestamptz;
begin
  perform public.editor_require(p_actor, v_course);
  select b.type, b.updated_at into v_type, v_cur from public.blocks b where b.id = p_block for update;
  if v_cur is distinct from p_expected::timestamptz then
    return query select 'conflict'::text, v_cur::text;
    return;
  end if;
  if v_type in ('exercise', 'speaking') then
    if p_exercise is null then
      raise exception 'exercise data required' using errcode = '22023';
    end if;
    perform public.editor_write_exercise(p_block, v_course, p_exercise);
    -- the exercise lives outside blocks.payload, so move the concurrency token explicitly
    update public.blocks b set updated_at = clock_timestamp() where b.id = p_block;
  else
    if p_payload is null or jsonb_typeof(p_payload) <> 'object' or length(p_payload::text) > 200000 then
      raise exception 'invalid payload' using errcode = '22023';
    end if;
    update public.blocks b set payload = p_payload where b.id = p_block;
    -- an identical payload does not touch the token; make the save visible anyway
    update public.blocks b set updated_at = clock_timestamp() where b.id = p_block;
  end if;
  select b.updated_at into v_cur from public.blocks b where b.id = p_block;
  return query select 'ok'::text, v_cur::text;
end
$$;

-- 'ok' | 'has_student_data' (students already answered it: deleting would erase their work)
--      | 'in_test' (the exercise is an item of a test: deleting would silently shrink the test).
-- The exercise rows are locked FOR UPDATE first: an attempt insert takes a FOR KEY SHARE lock on its
-- exercise (foreign key), so it either commits before our check (we see it) or waits and then fails
-- on the deleted row. Nothing can slip in between the check and the delete.
create function public.editor_delete_block(p_actor uuid, p_block uuid) returns text
language plpgsql security definer set search_path = public as $$
begin
  perform public.editor_require(p_actor, public.block_course_id(p_block));
  perform 1 from public.blocks where id = p_block for update;
  perform 1 from public.exercises where block_id = p_block for update;
  if exists (
       select 1 from public.exercises e join public.test_items ti on ti.exercise_id = e.id where e.block_id = p_block
     ) then
    return 'in_test';
  end if;
  if exists (
       select 1 from public.exercises e
       where e.block_id = p_block
         and (exists (select 1 from public.attempts a where a.exercise_id = e.id)
              or exists (select 1 from public.submissions s where s.exercise_id = e.id))
     ) then
    return 'has_student_data';
  end if;
  delete from public.blocks where id = p_block;
  return 'ok';
end
$$;

-- p_ids must be exactly the blocks of the part, in the new order.
create function public.editor_reorder_blocks(p_actor uuid, p_part uuid, p_ids uuid[]) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.editor_require(p_actor, public.part_course_id(p_part));
  perform 1 from public.lesson_parts where id = p_part for update;
  if p_ids is null
     or coalesce(array_length(p_ids, 1), 0) <> (select count(*) from public.blocks where lesson_part_id = p_part)
     or (select count(distinct x) from unnest(p_ids) as x) <> coalesce(array_length(p_ids, 1), 0)
     or exists (
          select 1 from unnest(p_ids) as x
          where not exists (select 1 from public.blocks b where b.id = x and b.lesson_part_id = p_part)
        ) then
    raise exception 'invalid order' using errcode = '22023';
  end if;
  update public.blocks b
     set position = o.ord
    from unnest(p_ids) with ordinality as o(id, ord)
   where b.id = o.id;
end
$$;

-- Flips every block of the lesson. Returns the number of blocks changed.
-- Publishing is ATOMIC with its check: p_checked is {blockId: updated_at} exactly as the server
-- validated it. The blocks are locked FOR UPDATE and compared; any block added, removed or edited
-- since (40001) , a missing answer key or a test-item exercise (23514) refuses the publish, so a
-- concurrent save can never go live unchecked.
create function public.editor_set_lesson_published(
  p_actor uuid, p_lesson uuid, p_published boolean, p_checked jsonb default null
) returns int
language plpgsql security definer set search_path = public as $$
declare
  v_n int;
  v_have int;
  v_bad int;
begin
  perform public.editor_require(p_actor, public.lesson_course_id(p_lesson));
  perform 1 from public.lesson_parts where lesson_id = p_lesson order by id for update;
  perform 1 from public.blocks b join public.lesson_parts p on p.id = b.lesson_part_id
   where p.lesson_id = p_lesson order by b.id for update of b;
  if p_published then
    select count(*) into v_have from public.blocks b join public.lesson_parts p on p.id = b.lesson_part_id where p.lesson_id = p_lesson;
    if v_have = 0 then
      raise exception 'lesson has no blocks' using errcode = '22023';
    end if;
    if p_checked is null or jsonb_typeof(p_checked) <> 'object' then
      raise exception 'publish needs the checked block tokens' using errcode = '22023';
    end if;
    select count(*) into v_bad
      from public.blocks b join public.lesson_parts p on p.id = b.lesson_part_id
     where p.lesson_id = p_lesson
       and (not (p_checked ? b.id::text) or (p_checked ->> b.id::text)::timestamptz is distinct from b.updated_at);
    if v_bad > 0 or (select count(*) from jsonb_object_keys(p_checked)) <> v_have then
      raise exception 'lesson changed since it was checked' using errcode = '40001';
    end if;
    if exists (
         select 1 from public.blocks b join public.lesson_parts p on p.id = b.lesson_part_id
         join public.exercises e on e.block_id = b.id
         where p.lesson_id = p_lesson
           and (exists (select 1 from public.test_items ti where ti.exercise_id = e.id)
                or (e.type <> 'speaking' and not exists (select 1 from public.exercise_keys k where k.exercise_id = e.id)))
       ) then
      raise exception 'exercise is a test item or has no answer key' using errcode = '23514';
    end if;
  end if;
  update public.blocks b
     set published = p_published
    from public.lesson_parts p
   where p.id = b.lesson_part_id and p.lesson_id = p_lesson and b.published is distinct from p_published;
  get diagnostics v_n = row_count;
  return v_n;
end
$$;

-- Exercises (of those given) that students already answered; used by the editor to lock their type.
create function public.exercises_with_student_data(p_ids uuid[]) returns setof uuid
language sql stable security definer set search_path = public as $$
  select e.id from public.exercises e
   where e.id = any (p_ids)
     and (exists (select 1 from public.attempts a where a.exercise_id = e.id)
          or exists (select 1 from public.submissions s where s.exercise_id = e.id))
$$;

-- words ----------------------------------------------------------------------
-- NOTE (review M7): words belong to the COURSE and are shared by every lesson that links them, so
-- editing a word in one lesson changes it everywhere.
-- p_rows: [{ru, stress, uz, pos, gender, example_ru, example_uz}]. A row whose (ru, uz) already
-- exists in the course (case-insensitive) reuses that word. Returns counts.
create function public.editor_import_words(p_actor uuid, p_lesson uuid, p_rows jsonb)
returns table (inserted int, linked int, skipped int)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare
  v_course uuid := public.lesson_course_id(p_lesson);
  v_row jsonb;
  v_ru text;
  v_uz text;
  v_word uuid;
  v_ins int := 0;
  v_link int := 0;
  v_skip int := 0;
  v_n int;
begin
  perform public.editor_require(p_actor, v_course);
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 500 then
    raise exception 'invalid rows' using errcode = '22023';
  end if;
  perform 1 from public.lessons where id = p_lesson for update;
  for v_row in select * from jsonb_array_elements(p_rows) loop
    v_ru := btrim(coalesce(v_row ->> 'ru', ''));
    v_uz := btrim(coalesce(v_row ->> 'uz', ''));
    if v_ru = '' or v_uz = '' or length(v_ru) > 200 or length(v_uz) > 200 then
      raise exception 'invalid word row' using errcode = '22023';
    end if;
    select w.id into v_word from public.words w
     where w.course_id = v_course and lower(w.ru) = lower(v_ru) and lower(w.uz) = lower(v_uz)
     order by w.id limit 1;
    if v_word is null then
      insert into public.words (course_id, ru, stress, uz, pos, gender, example_ru, example_uz)
      values (
        v_course, v_ru, nullif(btrim(coalesce(v_row ->> 'stress', '')), ''), v_uz,
        nullif(btrim(coalesce(v_row ->> 'pos', '')), ''), nullif(btrim(coalesce(v_row ->> 'gender', '')), ''),
        nullif(btrim(coalesce(v_row ->> 'example_ru', '')), ''), nullif(btrim(coalesce(v_row ->> 'example_uz', '')), '')
      )
      returning id into v_word;
      v_ins := v_ins + 1;
      insert into public.lesson_words (lesson_id, word_id) values (p_lesson, v_word);
    else
      insert into public.lesson_words (lesson_id, word_id) values (p_lesson, v_word) on conflict do nothing;
      get diagnostics v_n = row_count;
      if v_n = 1 then v_link := v_link + 1; else v_skip := v_skip + 1; end if;
    end if;
  end loop;
  return query select v_ins, v_link, v_skip;
end
$$;

-- p_word null: create + link. Otherwise update a word that is linked to this lesson.
create function public.editor_save_word(p_actor uuid, p_lesson uuid, p_word uuid, p_fields jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_course uuid := public.lesson_course_id(p_lesson);
  v_id uuid := p_word;
  v_ru text := btrim(coalesce(p_fields ->> 'ru', ''));
  v_uz text := btrim(coalesce(p_fields ->> 'uz', ''));
begin
  perform public.editor_require(p_actor, v_course);
  if v_ru = '' or v_uz = '' or length(v_ru) > 200 or length(v_uz) > 200 then
    raise exception 'invalid word' using errcode = '22023';
  end if;
  if p_word is null then
    insert into public.words (course_id, ru, stress, uz, pos, gender, example_ru, example_uz)
    values (
      v_course, v_ru, nullif(btrim(coalesce(p_fields ->> 'stress', '')), ''), v_uz,
      nullif(btrim(coalesce(p_fields ->> 'pos', '')), ''), nullif(btrim(coalesce(p_fields ->> 'gender', '')), ''),
      nullif(btrim(coalesce(p_fields ->> 'example_ru', '')), ''), nullif(btrim(coalesce(p_fields ->> 'example_uz', '')), '')
    )
    returning id into v_id;
    insert into public.lesson_words (lesson_id, word_id) values (p_lesson, v_id);
  else
    if not exists (
         select 1 from public.lesson_words lw join public.words w on w.id = lw.word_id
         where lw.lesson_id = p_lesson and lw.word_id = p_word and w.course_id = v_course
       ) then
      raise exception 'forbidden' using errcode = '42501';
    end if;
    update public.words
       set ru = v_ru, uz = v_uz,
           stress = nullif(btrim(coalesce(p_fields ->> 'stress', '')), ''),
           pos = nullif(btrim(coalesce(p_fields ->> 'pos', '')), ''),
           gender = nullif(btrim(coalesce(p_fields ->> 'gender', '')), ''),
           example_ru = nullif(btrim(coalesce(p_fields ->> 'example_ru', '')), ''),
           example_uz = nullif(btrim(coalesce(p_fields ->> 'example_uz', '')), '')
     where id = p_word;
  end if;
  return v_id;
end
$$;

create function public.editor_unlink_word(p_actor uuid, p_lesson uuid, p_word uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.editor_require(p_actor, public.lesson_course_id(p_lesson));
  delete from public.lesson_words where lesson_id = p_lesson and word_id = p_word;
end
$$;

-- service role only ------------------------------------------------------------
revoke execute on function
  public.can_edit_course_as(uuid, uuid), public.editor_require(uuid, uuid),
  public.editor_create_module(uuid, uuid, text), public.editor_create_lesson(uuid, uuid, text),
  public.editor_save_lesson(uuid, uuid, text, text, text),
  public.editor_create_block(uuid, uuid, public.block_type, jsonb, jsonb),
  public.editor_save_block(uuid, uuid, jsonb, jsonb, text),
  public.editor_delete_block(uuid, uuid), public.editor_reorder_blocks(uuid, uuid, uuid[]),
  public.editor_set_lesson_published(uuid, uuid, boolean, jsonb), public.exercises_with_student_data(uuid[]),
  public.editor_import_words(uuid, uuid, jsonb), public.editor_save_word(uuid, uuid, uuid, jsonb),
  public.editor_unlink_word(uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function
  public.can_edit_course_as(uuid, uuid), public.editor_require(uuid, uuid),
  public.editor_create_module(uuid, uuid, text), public.editor_create_lesson(uuid, uuid, text),
  public.editor_save_lesson(uuid, uuid, text, text, text),
  public.editor_create_block(uuid, uuid, public.block_type, jsonb, jsonb),
  public.editor_save_block(uuid, uuid, jsonb, jsonb, text),
  public.editor_delete_block(uuid, uuid), public.editor_reorder_blocks(uuid, uuid, uuid[]),
  public.editor_set_lesson_published(uuid, uuid, boolean, jsonb), public.exercises_with_student_data(uuid[]),
  public.editor_import_words(uuid, uuid, jsonb), public.editor_save_word(uuid, uuid, uuid, jsonb),
  public.editor_unlink_word(uuid, uuid, uuid)
  to service_role;

-- Defence in depth: API roles never need these table privileges.
revoke truncate, trigger, references on all tables in schema public from anon, authenticated;
