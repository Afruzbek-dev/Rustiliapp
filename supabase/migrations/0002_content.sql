-- 0002_content: course content (modules → lessons → parts → blocks → exercises), words,
-- texts, tests. Spec §2, §6, §7, §12.
--
-- Ruling (plan Task 5): correct answers do NOT live in exercises.answer; they live in
-- exercise_keys, which has no policy for students or curators. RLS cannot hide columns,
-- so a separate table is what guarantees "answers are never sent to the client".
--
-- Read access:
--   student : courses in active_course_ids(); blocks/exercises/tests only when published
--   curator : everything in curated_course_ids() except exercise_keys
--   teacher : everything in their own courses (read + write); admin: everything

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type public.part_kind as enum ('grammar', 'conversation');
create type public.block_type as enum
  ('video', 'audio', 'rule_image', 'text', 'reading', 'exercise', 'speaking', 'words');
create type public.exercise_type as enum
  ('classify', 'fill_blank', 'conjugate', 'choose', 'match', 'arrange', 'listen_pick', 'open_text', 'speaking');
create type public.check_mode as enum ('auto', 'review');
create type public.test_section as enum ('vocab', 'grammar', 'reading', 'listening', 'writing');
create type public.text_source as enum ('lesson', 'library');

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table public.modules (
  id        uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses (id) on delete cascade,
  position  int not null,
  title     text not null,
  constraint modules_position_key unique (course_id, position) deferrable initially deferred
);

create table public.lessons (
  id        uuid primary key default gen_random_uuid(),
  module_id uuid not null references public.modules (id) on delete cascade,
  position  int not null,
  title     text not null,
  objective text,
  constraint lessons_position_key unique (module_id, position) deferrable initially deferred
);

create table public.lesson_parts (
  id        uuid primary key default gen_random_uuid(),
  lesson_id uuid not null references public.lessons (id) on delete cascade,
  position  smallint not null check (position in (1, 2)),
  kind      public.part_kind not null,
  title     text not null,
  constraint lesson_parts_position_key unique (lesson_id, position)
);

create table public.blocks (
  id             uuid primary key default gen_random_uuid(),
  lesson_part_id uuid not null references public.lesson_parts (id) on delete cascade,
  position       int not null,
  type           public.block_type not null,
  payload        jsonb not null default '{}',
  published      boolean not null default false,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  -- deferrable so the editor can reorder blocks inside one transaction
  constraint blocks_position_key unique (lesson_part_id, position) deferrable initially deferred
);

-- course_id is denormalised so test-only exercises (no block) still have an owner course
-- for RLS; a trigger keeps it equal to the block's course when block_id is set.
create table public.exercises (
  id         uuid primary key default gen_random_uuid(),
  course_id  uuid not null references public.courses (id) on delete cascade,
  block_id   uuid references public.blocks (id) on delete cascade,
  type       public.exercise_type not null,
  prompt     text,
  payload    jsonb not null default '{}',
  check_mode public.check_mode not null default 'auto',
  xp         int not null default 10 check (xp >= 0),
  created_at timestamptz not null default now()
);
create index exercises_block_id_idx on public.exercises (block_id);
create index exercises_course_id_idx on public.exercises (course_id);

create table public.exercise_keys (
  exercise_id uuid primary key references public.exercises (id) on delete cascade,
  answer      jsonb not null
);

create table public.words (
  id         uuid primary key default gen_random_uuid(),
  course_id  uuid not null references public.courses (id) on delete cascade,
  ru         text not null,
  stress     text,
  uz         text not null,
  pos        text,
  gender     text,
  example_ru text,
  example_uz text,
  audio_path text
);
create index words_course_id_idx on public.words (course_id);

create table public.lesson_words (
  lesson_id uuid not null references public.lessons (id) on delete cascade,
  word_id   uuid not null references public.words (id) on delete cascade,
  primary key (lesson_id, word_id)
);
create index lesson_words_word_id_idx on public.lesson_words (word_id);

create table public.texts (
  id         uuid primary key default gen_random_uuid(),
  course_id  uuid not null references public.courses (id) on delete cascade,
  title      text not null,
  body       text not null,
  audio_path text,
  source     public.text_source not null default 'lesson'
);

create table public.tests (
  id              uuid primary key default gen_random_uuid(),
  course_id       uuid not null references public.courses (id) on delete cascade,
  after_module_id uuid references public.modules (id) on delete set null,
  title           text not null,
  time_limit_min  int check (time_limit_min > 0),
  pass_score      numeric(5, 2),
  published       boolean not null default false
);

create table public.test_items (
  test_id     uuid not null references public.tests (id) on delete cascade,
  exercise_id uuid not null references public.exercises (id) on delete cascade,
  section     public.test_section not null,
  position    int not null,
  primary key (test_id, exercise_id),
  constraint test_items_position_key unique (test_id, position) deferrable initially deferred
);
create index test_items_exercise_id_idx on public.test_items (exercise_id);

-- ---------------------------------------------------------------------------
-- Course lookups (security definer so policies can resolve a parent's course
-- without depending on the caller's visibility of the parent).
-- ---------------------------------------------------------------------------
create function public.module_course_id(p_module uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select m.course_id from public.modules m where m.id = p_module
$$;

create function public.lesson_course_id(p_lesson uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select m.course_id from public.lessons l join public.modules m on m.id = l.module_id where l.id = p_lesson
$$;

create function public.part_course_id(p_part uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select m.course_id
  from public.lesson_parts p
  join public.lessons l on l.id = p.lesson_id
  join public.modules m on m.id = l.module_id
  where p.id = p_part
$$;

create function public.block_course_id(p_block uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select public.part_course_id(b.lesson_part_id) from public.blocks b where b.id = p_block
$$;

create function public.exercise_course_id(p_exercise uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select e.course_id from public.exercises e where e.id = p_exercise
$$;

create function public.word_course_id(p_word uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select w.course_id from public.words w where w.id = p_word
$$;

create function public.test_course_id(p_test uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select t.course_id from public.tests t where t.id = p_test
$$;

create function public.test_is_published(p_test uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select t.published from public.tests t where t.id = p_test), false)
$$;

-- An exercise is visible to students when its block is published, or when it is an
-- item of a published test.
create function public.exercise_is_published(p_exercise uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
           select 1 from public.exercises e join public.blocks b on b.id = e.block_id
           where e.id = p_exercise and b.published
         )
      or exists (
           select 1 from public.test_items ti join public.tests t on t.id = ti.test_id
           where ti.exercise_id = p_exercise and t.published
         )
$$;

-- Staff/curator read access to a course's content (drafts included, keys excluded).
create function public.can_review_course(p_course uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.teaches_course(p_course)
      or p_course in (select public.curated_course_ids())
$$;

-- Any read access to a course's structure (modules, lessons, parts, words, texts).
create function public.can_view_course(p_course uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.can_review_course(p_course)
      or p_course in (select public.active_course_ids())
$$;

-- These helpers only serve RLS policies for signed-in users (and server code).
revoke execute on function
  public.module_course_id(uuid), public.lesson_course_id(uuid), public.part_course_id(uuid),
  public.block_course_id(uuid), public.exercise_course_id(uuid), public.word_course_id(uuid),
  public.test_course_id(uuid), public.test_is_published(uuid), public.exercise_is_published(uuid),
  public.can_review_course(uuid), public.can_view_course(uuid)
  from public, anon;
grant execute on function
  public.module_course_id(uuid), public.lesson_course_id(uuid), public.part_course_id(uuid),
  public.block_course_id(uuid), public.exercise_course_id(uuid), public.word_course_id(uuid),
  public.test_course_id(uuid), public.test_is_published(uuid), public.exercise_is_published(uuid),
  public.can_review_course(uuid), public.can_view_course(uuid)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Integrity triggers
-- ---------------------------------------------------------------------------
create function public.exercises_sync_course() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_course uuid;
begin
  if new.block_id is not null then
    v_course := public.block_course_id(new.block_id);
    if new.course_id is null then
      new.course_id := v_course;
    elsif new.course_id is distinct from v_course then
      raise exception 'exercise course_id must match its block''s course' using errcode = '23514';
    end if;
  end if;
  return new;
end
$$;

create trigger exercises_sync_course
  before insert or update of course_id, block_id on public.exercises
  for each row execute function public.exercises_sync_course();

create function public.touch_updated_at() returns trigger
language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  return new;
end
$$;

create trigger blocks_touch_updated_at
  before update on public.blocks
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.modules       enable row level security;
alter table public.lessons       enable row level security;
alter table public.lesson_parts  enable row level security;
alter table public.blocks        enable row level security;
alter table public.exercises     enable row level security;
alter table public.exercise_keys enable row level security;
alter table public.words         enable row level security;
alter table public.lesson_words  enable row level security;
alter table public.texts         enable row level security;
alter table public.tests         enable row level security;
alter table public.test_items    enable row level security;

-- anon never reads content
revoke all on public.modules, public.lessons, public.lesson_parts, public.blocks, public.exercises,
  public.exercise_keys, public.words, public.lesson_words, public.texts, public.tests, public.test_items
  from anon;

-- modules -------------------------------------------------------------------
create policy modules_select on public.modules for select to authenticated
  using (public.can_view_course(course_id));
create policy modules_insert on public.modules for insert to authenticated
  with check (public.teaches_course(course_id));
create policy modules_update on public.modules for update to authenticated
  using (public.teaches_course(course_id)) with check (public.teaches_course(course_id));
create policy modules_delete on public.modules for delete to authenticated
  using (public.teaches_course(course_id));

-- lessons -------------------------------------------------------------------
create policy lessons_select on public.lessons for select to authenticated
  using (public.can_view_course(public.module_course_id(module_id)));
create policy lessons_insert on public.lessons for insert to authenticated
  with check (public.teaches_course(public.module_course_id(module_id)));
create policy lessons_update on public.lessons for update to authenticated
  using (public.teaches_course(public.module_course_id(module_id)))
  with check (public.teaches_course(public.module_course_id(module_id)));
create policy lessons_delete on public.lessons for delete to authenticated
  using (public.teaches_course(public.module_course_id(module_id)));

-- lesson_parts --------------------------------------------------------------
create policy lesson_parts_select on public.lesson_parts for select to authenticated
  using (public.can_view_course(public.lesson_course_id(lesson_id)));
create policy lesson_parts_insert on public.lesson_parts for insert to authenticated
  with check (public.teaches_course(public.lesson_course_id(lesson_id)));
create policy lesson_parts_update on public.lesson_parts for update to authenticated
  using (public.teaches_course(public.lesson_course_id(lesson_id)))
  with check (public.teaches_course(public.lesson_course_id(lesson_id)));
create policy lesson_parts_delete on public.lesson_parts for delete to authenticated
  using (public.teaches_course(public.lesson_course_id(lesson_id)));

-- blocks --------------------------------------------------------------------
create policy blocks_select on public.blocks for select to authenticated
  using (
    public.can_review_course(public.part_course_id(lesson_part_id))
    or (published and public.part_course_id(lesson_part_id) in (select public.active_course_ids()))
  );
create policy blocks_insert on public.blocks for insert to authenticated
  with check (public.teaches_course(public.part_course_id(lesson_part_id)));
create policy blocks_update on public.blocks for update to authenticated
  using (public.teaches_course(public.part_course_id(lesson_part_id)))
  with check (public.teaches_course(public.part_course_id(lesson_part_id)));
create policy blocks_delete on public.blocks for delete to authenticated
  using (public.teaches_course(public.part_course_id(lesson_part_id)));

-- exercises -----------------------------------------------------------------
create policy exercises_select on public.exercises for select to authenticated
  using (
    public.can_review_course(course_id)
    or (course_id in (select public.active_course_ids()) and public.exercise_is_published(id))
  );
create policy exercises_insert on public.exercises for insert to authenticated
  with check (public.teaches_course(course_id));
create policy exercises_update on public.exercises for update to authenticated
  using (public.teaches_course(course_id)) with check (public.teaches_course(course_id));
create policy exercises_delete on public.exercises for delete to authenticated
  using (public.teaches_course(course_id));

-- exercise_keys: teacher/admin only. No policy for students or curators. ---------
create policy exercise_keys_select on public.exercise_keys for select to authenticated
  using (public.teaches_course(public.exercise_course_id(exercise_id)));
create policy exercise_keys_insert on public.exercise_keys for insert to authenticated
  with check (public.teaches_course(public.exercise_course_id(exercise_id)));
create policy exercise_keys_update on public.exercise_keys for update to authenticated
  using (public.teaches_course(public.exercise_course_id(exercise_id)))
  with check (public.teaches_course(public.exercise_course_id(exercise_id)));
create policy exercise_keys_delete on public.exercise_keys for delete to authenticated
  using (public.teaches_course(public.exercise_course_id(exercise_id)));

-- words / lesson_words / texts ------------------------------------------------
create policy words_select on public.words for select to authenticated
  using (public.can_view_course(course_id));
create policy words_insert on public.words for insert to authenticated
  with check (public.teaches_course(course_id));
create policy words_update on public.words for update to authenticated
  using (public.teaches_course(course_id)) with check (public.teaches_course(course_id));
create policy words_delete on public.words for delete to authenticated
  using (public.teaches_course(course_id));

create policy lesson_words_select on public.lesson_words for select to authenticated
  using (public.can_view_course(public.lesson_course_id(lesson_id)));
create policy lesson_words_insert on public.lesson_words for insert to authenticated
  with check (
    public.teaches_course(public.lesson_course_id(lesson_id))
    and public.word_course_id(word_id) = public.lesson_course_id(lesson_id)
  );
create policy lesson_words_delete on public.lesson_words for delete to authenticated
  using (public.teaches_course(public.lesson_course_id(lesson_id)));

create policy texts_select on public.texts for select to authenticated
  using (public.can_view_course(course_id));
create policy texts_insert on public.texts for insert to authenticated
  with check (public.teaches_course(course_id));
create policy texts_update on public.texts for update to authenticated
  using (public.teaches_course(course_id)) with check (public.teaches_course(course_id));
create policy texts_delete on public.texts for delete to authenticated
  using (public.teaches_course(course_id));

-- tests / test_items ----------------------------------------------------------
create policy tests_select on public.tests for select to authenticated
  using (
    public.can_review_course(course_id)
    or (published and course_id in (select public.active_course_ids()))
  );
create policy tests_insert on public.tests for insert to authenticated
  with check (
    public.teaches_course(course_id)
    and (after_module_id is null or public.module_course_id(after_module_id) = course_id)
  );
create policy tests_update on public.tests for update to authenticated
  using (public.teaches_course(course_id))
  with check (
    public.teaches_course(course_id)
    and (after_module_id is null or public.module_course_id(after_module_id) = course_id)
  );
create policy tests_delete on public.tests for delete to authenticated
  using (public.teaches_course(course_id));

create policy test_items_select on public.test_items for select to authenticated
  using (
    public.can_review_course(public.test_course_id(test_id))
    or (public.test_is_published(test_id) and public.test_course_id(test_id) in (select public.active_course_ids()))
  );
create policy test_items_insert on public.test_items for insert to authenticated
  with check (
    public.teaches_course(public.test_course_id(test_id))
    and public.exercise_course_id(exercise_id) = public.test_course_id(test_id)
  );
create policy test_items_update on public.test_items for update to authenticated
  using (public.teaches_course(public.test_course_id(test_id)))
  with check (
    public.teaches_course(public.test_course_id(test_id))
    and public.exercise_course_id(exercise_id) = public.test_course_id(test_id)
  );
create policy test_items_delete on public.test_items for delete to authenticated
  using (public.teaches_course(public.test_course_id(test_id)));

-- ---------------------------------------------------------------------------
-- API roles never truncate, add triggers to, or reference tables directly.
-- ---------------------------------------------------------------------------
revoke truncate, trigger, references on all tables in schema public from anon, authenticated;
