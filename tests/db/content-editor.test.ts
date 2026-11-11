import { beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { asService, pool, sql, withUser } from './helpers';
import {
  createActiveStudent,
  createBlock,
  createCourse,
  createCourseWorld,
  createExercise,
  createLesson,
  createProfile,
} from './fixtures';

const rejects = async (p: Promise<unknown>, re: RegExp) => {
  await expect(p).rejects.toThrow(re);
};

describe('0016 content editor', () => {
  let A: Awaited<ReturnType<typeof createCourseWorld>>;
  let B: Awaited<ReturnType<typeof createCourseWorld>>;
  let admin: string;
  let student: string;
  let lessonA: Awaited<ReturnType<typeof createLesson>>;

  beforeAll(async () => {
    A = await createCourseWorld();
    B = await createCourseWorld();
    admin = await createProfile('admin');
    student = await createActiveStudent(A.cohort, A.group);
    lessonA = await createLesson(A.course);
  });

  describe('content bucket', () => {
    const name = (course: string) => `${course}/${randomUUID()}.mp3`;
    const put = (path: string) => sql(`insert into storage.objects (bucket_id, name) values ('content', $1)`, [path]);

    it('is private, 20 MB, mime-restricted', async () => {
      const [b] = await sql(`select public, file_size_limit, allowed_mime_types from storage.buckets where id = 'content'`);
      expect(b.public).toBe(false);
      expect(Number(b.file_size_limit)).toBe(20971520);
      expect(b.allowed_mime_types).toContain('audio/mpeg');
    });

    it('teacher reads/writes only under own course folder', async () => {
      const own = name(A.course);
      const foreign = name(B.course);
      await put(own);
      await put(foreign);
      const read = (uid: string, n: string) =>
        withUser(uid, (q) => q(`select name from storage.objects where bucket_id='content' and name=$1`, [n]));
      expect(await read(A.teacher, own)).toHaveLength(1);
      expect(await read(A.teacher, foreign)).toHaveLength(0);
      expect(await read(B.teacher, own)).toHaveLength(0);
      const ins = (uid: string, n: string) =>
        withUser(uid, (q) => q(`insert into storage.objects (bucket_id, name) values ('content', $1)`, [n]));
      await ins(A.teacher, name(A.course));
      await rejects(ins(A.teacher, name(B.course)), /row-level security/);
      await rejects(ins(A.teacher, `${A.course}/../x.mp3`), /row-level security/);
      await rejects(ins(A.teacher, 'loose.mp3'), /row-level security/);
      // admin may write anywhere, but a path without a course never matches
      await ins(admin, name(B.course));
      await rejects(ins(admin, 'loose.mp3'), /row-level security/);
    });

    it('students, curators and anon have no access', async () => {
      const own = name(A.course);
      await put(own);
      for (const uid of [student, A.curator, null]) {
        const rows = await withUser(uid, (q) =>
          q(`select name from storage.objects where bucket_id='content' and name=$1`, [own]),
        ).catch(() => []);
        expect(rows).toHaveLength(0);
        await rejects(
          withUser(uid, (q) => q(`insert into storage.objects (bucket_id, name) values ('content', $1)`, [name(A.course)])),
          /row-level security|permission denied/,
        );
      }
    });

    it('delete is limited to own course folder', async () => {
      const own = name(A.course);
      const foreign = name(B.course);
      await put(own);
      await put(foreign);
      const del = (uid: string, n: string) =>
        withUser(uid, (q) => q(`delete from storage.objects where bucket_id='content' and name=$1 returning name`, [n]));
      expect(await del(B.teacher, own)).toHaveLength(0);
      expect(await del(A.teacher, foreign)).toHaveLength(0);
      expect(await del(A.teacher, own)).toHaveLength(1);
    });
  });

  describe('M5: no cross-course moves', () => {
    it('rejects moving module/lesson/part/block to another course', async () => {
      const la = await createLesson(A.course);
      const lb = await createLesson(B.course);
      const block = await createBlock(la.part1, 1, false, 'text');
      await rejects(sql('update public.modules set course_id = $1 where id = $2', [B.course, la.module]), /another course/);
      await rejects(sql('update public.lessons set module_id = $1 where id = $2', [lb.module, la.lesson]), /another course/);
      await rejects(sql('update public.lesson_parts set lesson_id = $1 where id = $2', [lb.lesson, la.part1]), /another course/);
      await rejects(sql('update public.blocks set lesson_part_id = $1 where id = $2', [lb.part1, block]), /another course/);
      // inside one course is fine
      await sql('update public.blocks set lesson_part_id = $1 where id = $2', [la.part2, block]);
    });
  });

  describe('media path', () => {
    it('must be under the block course folder', async () => {
      const own = `${A.course}/${randomUUID()}.mp3`;
      const foreign = `${B.course}/${randomUUID()}.mp3`;
      await sql(`insert into public.blocks (lesson_part_id, position, type, payload) values ($1, 90, 'audio', $2)`, [
        lessonA.part1,
        JSON.stringify({ path: own, title: 'x' }),
      ]);
      await rejects(
        sql(`insert into public.blocks (lesson_part_id, position, type, payload) values ($1, 91, 'audio', $2)`, [
          lessonA.part1,
          JSON.stringify({ path: foreign, title: 'x' }),
        ]),
        /media path/,
      );
      await rejects(
        sql(`insert into public.blocks (lesson_part_id, position, type, payload) values ($1, 92, 'rule_image', $2)`, [
          lessonA.part1,
          JSON.stringify({ path: `${A.course}/../${B.course}/a.png`, alt: 'x' }),
        ]),
        /media path/,
      );
    });
  });

  describe('editor functions', () => {
    const call = <T>(fn: string, args: unknown[]) =>
      sql(`select * from public.${fn}(${args.map((_, i) => `$${i + 1}`).join(', ')})`, args) as unknown as Promise<T[]>;

    it('create module/lesson authorises the actor', async () => {
      const [{ editor_create_module: m }] = await call<{ editor_create_module: string }>('editor_create_module', [
        A.teacher, A.course, '2-modul',
      ]);
      const [{ editor_create_lesson: l }] = await call<{ editor_create_lesson: string }>('editor_create_lesson', [
        A.teacher, m, 'Yangi',
      ]);
      const parts = await sql('select position, kind from public.lesson_parts where lesson_id = $1 order by position', [l]);
      expect(parts.map((p) => p.kind)).toEqual(['grammar', 'conversation']);
      await rejects(call('editor_create_lesson', [B.teacher, m, 'x']), /forbidden/);
      await rejects(call('editor_create_lesson', [student, m, 'x']), /forbidden/);
      await rejects(call('editor_create_lesson', [A.curator, m, 'x']), /forbidden/);
      await rejects(call('editor_create_lesson', [A.teacher, randomUUID(), 'x']), /forbidden/);
      await call('editor_create_lesson', [admin, m, 'admin ok']);
    });

    it('only service_role can execute them', async () => {
      await asService((q) => q(`select public.can_edit_course_as($1, $2)`, [A.teacher, A.course]));
      await rejects(
        withUser(A.teacher, (q) => q(`select public.editor_create_module($1, $2, 'x')`, [A.teacher, A.course])),
        /permission denied/,
      );
    });

    it('save lesson: optimistic concurrency by updated_at', async () => {
      const lesson = await createLesson(A.course);
      const [{ updated_at }] = await sql('select updated_at::text as updated_at from public.lessons where id = $1', [lesson.lesson]);
      const [ok] = await call<{ outcome: string; updated_at: string }>('editor_save_lesson', [
        A.teacher, lesson.lesson, 'Yangi nom', 'Maqsad', updated_at,
      ]);
      expect(ok.outcome).toBe('ok');
      const [stale] = await call<{ outcome: string }>('editor_save_lesson', [
        A.teacher, lesson.lesson, 'Boshqa', null, updated_at,
      ]);
      expect(stale.outcome).toBe('conflict');
      const [row] = await sql('select title, objective from public.lessons where id = $1', [lesson.lesson]);
      expect(row).toEqual({ title: 'Yangi nom', objective: 'Maqsad' });
      await rejects(call('editor_save_lesson', [B.teacher, lesson.lesson, 'x', null, ok.updated_at]), /forbidden/);
    });

    it('blocks: create, exercise keys stay out of payload, conflict, reorder keeps tokens', async () => {
      const l = await createLesson(A.course);
      const text = (await call<{ block_id: string; updated_at: string }>('editor_create_block', [
        A.teacher, l.part1, 'text', JSON.stringify({ body: 'abc' }), null,
      ]))[0];
      const ex = (await call<{ block_id: string; updated_at: string }>('editor_create_block', [
        A.teacher, l.part1, 'exercise',
        '{}',
        JSON.stringify({
          type: 'choose', prompt: 'p', check_mode: 'auto', xp: 10,
          payload: { items: [{ id: 'a', text: 't', options: ['x', 'y'] }] },
          key: { a: 1 },
        }),
      ]))[0];
      const [e] = await sql('select id, payload from public.exercises where block_id = $1', [ex.block_id]);
      expect(JSON.stringify(e.payload)).not.toContain('"a":1');
      const [k] = await sql('select answer from public.exercise_keys where exercise_id = $1', [e.id]);
      expect(k.answer).toEqual({ a: 1 });
      const [b] = await sql('select payload, published, position from public.blocks where id = $1', [ex.block_id]);
      expect(b.payload).toEqual({ exerciseId: e.id });
      expect(b.published).toBe(false);
      expect(b.position).toBe(2);

      // a student cannot read the key; teacher of B cannot either
      expect(await withUser(student, (q) => q('select * from public.exercise_keys where exercise_id = $1', [e.id]))).toHaveLength(0);
      expect(await withUser(B.teacher, (q) => q('select * from public.exercise_keys where exercise_id = $1', [e.id]))).toHaveLength(0);

      const s1 = (await call<{ outcome: string; updated_at: string }>('editor_save_block', [
        A.teacher, text.block_id, JSON.stringify({ body: 'new' }), null, text.updated_at,
      ]))[0];
      expect(s1.outcome).toBe('ok');
      const s2 = (await call<{ outcome: string }>('editor_save_block', [
        A.teacher, text.block_id, JSON.stringify({ body: 'stale' }), null, text.updated_at,
      ]))[0];
      expect(s2.outcome).toBe('conflict');
      await rejects(call('editor_save_block', [B.teacher, text.block_id, '{}', null, s1.updated_at]), /forbidden/);

      // reorder: tokens untouched, order changes
      await call('editor_reorder_blocks', [A.teacher, l.part1, [ex.block_id, text.block_id]]);
      const order = await sql('select id from public.blocks where lesson_part_id = $1 order by position', [l.part1]);
      expect(order.map((r) => r.id)).toEqual([ex.block_id, text.block_id]);
      const [after] = await sql('select updated_at::text as updated_at from public.blocks where id = $1', [text.block_id]);
      expect(after.updated_at).toBe(s1.updated_at);
      await rejects(call('editor_reorder_blocks', [A.teacher, l.part1, [ex.block_id]]), /invalid order/);
      await rejects(call('editor_reorder_blocks', [A.teacher, l.part1, [ex.block_id, ex.block_id]]), /invalid order/);
      await rejects(call('editor_reorder_blocks', [B.teacher, l.part1, [ex.block_id, text.block_id]]), /forbidden/);

      // exercise save updates key + moves the token
      const s3 = (await call<{ outcome: string; updated_at: string }>('editor_save_block', [
        A.teacher, ex.block_id, null,
        JSON.stringify({ type: 'choose', prompt: 'q', payload: { items: [{ id: 'a', text: 't', options: ['x', 'y'] }] }, key: { a: 0 } }),
        ex.updated_at,
      ]))[0];
      expect(s3.outcome).toBe('ok');
      const [k2] = await sql('select answer from public.exercise_keys where exercise_id = $1', [e.id]);
      expect(k2.answer).toEqual({ a: 0 });
    });

    it('delete refuses blocks students already answered', async () => {
      const l = await createLesson(A.course);
      const blk = await createBlock(l.part1, 1, true);
      const ex = await createExercise(blk);
      await sql(`insert into public.attempts (student_id, exercise_id, answer, is_correct) values ($1, $2, '{}', true)`, [student, ex]);
      const [r] = await call<{ editor_delete_block: string }>('editor_delete_block', [A.teacher, blk]);
      expect(r.editor_delete_block).toBe('has_student_data');
      const free = await createBlock(l.part1, 2, false, 'text');
      expect((await call<{ editor_delete_block: string }>('editor_delete_block', [A.teacher, free]))[0].editor_delete_block).toBe('ok');
      await rejects(call('editor_delete_block', [B.teacher, blk]), /forbidden/);
    });

    // {blockId: updated_at} exactly as the server's check would capture it
    const checked = async (lesson: string) => {
      const rows = await sql(
        `select b.id, b.updated_at::text as t from public.blocks b join public.lesson_parts p on p.id = b.lesson_part_id where p.lesson_id = $1`,
        [lesson],
      );
      return JSON.stringify(Object.fromEntries(rows.map((r) => [r.id, r.t])));
    };
    const publish = async (lesson: string, on: boolean, actor = A.teacher) =>
      call<{ editor_set_lesson_published: number }>('editor_set_lesson_published', [actor, lesson, on, on ? await checked(lesson) : null]);

    it('publish flips all blocks of the lesson; student sees them only when published', async () => {
      const l = await createLesson(A.course);
      await rejects(publish(l.lesson, true), /no blocks/);
      const blk = (await call<{ block_id: string }>('editor_create_block', [A.teacher, l.part1, 'text', JSON.stringify({ body: 'x' }), null]))[0].block_id;
      const seen = () => withUser(student, (q) => q('select id from public.blocks where id = $1', [blk]));
      expect(await seen()).toHaveLength(0);
      await rejects(publish(l.lesson, true, B.teacher), /forbidden/);
      expect((await publish(l.lesson, true))[0].editor_set_lesson_published).toBe(1);
      expect(await seen()).toHaveLength(1);
      // publishing is not a content change: open editors keep a valid concurrency token
      const created = (await call<{ block_id: string; updated_at: string }>('editor_create_block', [A.teacher, l.part2, 'text', '{}', null]))[0];
      await publish(l.lesson, false);
      await publish(l.lesson, true);
      const [after] = await sql('select updated_at::text as t from public.blocks where id = $1', [created.block_id]);
      expect(after.t).toBe(created.updated_at);
      await publish(l.lesson, false);
      expect(await seen()).toHaveLength(0);
    });

    it('M1: publish is atomic with its check (changed / added blocks, missing key, test item)', async () => {
      const l = await createLesson(A.course);
      const blk = (await call<{ block_id: string; updated_at: string }>('editor_create_block', [A.teacher, l.part1, 'text', JSON.stringify({ body: 'x' }), null]))[0];
      // the client validated the lesson, then a concurrent save edited the block
      const stale = await checked(l.lesson);
      await call('editor_save_block', [A.teacher, blk.block_id, JSON.stringify({ body: 'edited after the check' }), null, blk.updated_at]);
      await rejects(call('editor_set_lesson_published', [A.teacher, l.lesson, true, stale]), /changed since/);
      expect(await sql('select published from public.blocks where id = $1', [blk.block_id])).toEqual([{ published: false }]);
      // a block added after the check
      const fresh = await checked(l.lesson);
      await call('editor_create_block', [A.teacher, l.part2, 'text', '{}', null]);
      await rejects(call('editor_set_lesson_published', [A.teacher, l.lesson, true, fresh]), /changed since/);
      // a missing token map is refused
      await rejects(call('editor_set_lesson_published', [A.teacher, l.lesson, true, null]), /checked block tokens/);

      // an exercise without a key / a test item cannot go live even with matching tokens
      const l2 = await createLesson(A.course);
      const ex = (await call<{ block_id: string }>('editor_create_block', [
        A.teacher, l2.part1, 'exercise', '{}',
        JSON.stringify({ type: 'choose', prompt: 'p', payload: { items: [] }, key: {} }),
      ]))[0].block_id;
      const [{ id: exId }] = await sql('select id from public.exercises where block_id = $1', [ex]);
      await sql('delete from public.exercise_keys where exercise_id = $1', [exId]);
      await rejects(publish(l2.lesson, true), /test item or has no answer key/);
      await sql(`insert into public.exercise_keys (exercise_id, answer) values ($1, '{}')`, [exId]);
      const [t] = await sql(`insert into public.tests (course_id, title) values ($1, 'T') returning id`, [A.course]);
      await sql(`insert into public.test_items (test_id, exercise_id, section, position) values ($1, $2, 'grammar', 1)`, [t.id, exId]);
      await rejects(publish(l2.lesson, true), /test item or has no answer key/);
    });

    it('I1: a non-object / missing key never erases the key of an existing exercise', async () => {
      const l = await createLesson(A.course);
      const b = (await call<{ block_id: string; updated_at: string }>('editor_create_block', [
        A.teacher, l.part1, 'exercise', '{}',
        JSON.stringify({ type: 'choose', prompt: 'p', payload: { items: [] }, key: { a: 1 } }),
      ]))[0];
      const [{ id: exId }] = await sql('select id from public.exercises where block_id = $1', [b.block_id]);
      const s1 = (await call<{ updated_at: string }>('editor_save_block', [
        A.teacher, b.block_id, null, JSON.stringify({ type: 'choose', prompt: 'q', payload: { items: [] }, key: null }), b.updated_at,
      ]))[0];
      const s2 = (await call<{ updated_at: string }>('editor_save_block', [
        A.teacher, b.block_id, null, JSON.stringify({ type: 'choose', prompt: 'r', payload: { items: [] }, key: 'junk' }), s1.updated_at,
      ]))[0];
      expect(s2.updated_at).toBeTruthy();
      expect((await sql('select answer from public.exercise_keys where exercise_id = $1', [exId]))[0].answer).toEqual({ a: 1 });
    });

    it('I2: deleting a block whose exercise is a test item is refused (in_test)', async () => {
      const l = await createLesson(A.course);
      const blk = await createBlock(l.part1, 1, false);
      const ex = await createExercise(blk);
      const [t] = await sql(`insert into public.tests (course_id, title) values ($1, 'T') returning id`, [A.course]);
      await sql(`insert into public.test_items (test_id, exercise_id, section, position) values ($1, $2, 'grammar', 1)`, [t.id, ex]);
      expect((await call<{ editor_delete_block: string }>('editor_delete_block', [A.teacher, blk]))[0].editor_delete_block).toBe('in_test');
      expect(await sql('select 1 from public.blocks where id = $1', [blk])).toHaveLength(1);
    });

    it('M5: the exercise type is locked once students answered it', async () => {
      const l = await createLesson(A.course);
      const b = (await call<{ block_id: string; updated_at: string }>('editor_create_block', [
        A.teacher, l.part1, 'exercise', '{}',
        JSON.stringify({ type: 'choose', prompt: 'p', payload: { items: [] }, key: {} }),
      ]))[0];
      const [{ id: exId }] = await sql('select id from public.exercises where block_id = $1', [b.block_id]);
      const same = (await call<{ outcome: string; updated_at: string }>('editor_save_block', [
        A.teacher, b.block_id, null, JSON.stringify({ type: 'choose', prompt: 'ok', payload: { items: [] }, key: {} }), b.updated_at,
      ]))[0];
      expect(same.outcome).toBe('ok');
      await sql(`insert into public.attempts (student_id, exercise_id, answer, is_correct) values ($1, $2, '{}', true)`, [student, exId]);
      await rejects(
        call('editor_save_block', [A.teacher, b.block_id, null, JSON.stringify({ type: 'classify', prompt: 'x', payload: {}, key: {} }), same.updated_at]),
        /type locked/,
      );
      // same type is still editable
      expect((await call<{ outcome: string }>('editor_save_block', [A.teacher, b.block_id, null, JSON.stringify({ type: 'choose', prompt: 'again', payload: { items: [] }, key: {} }), same.updated_at]))[0].outcome).toBe('ok');
      expect((await sql('select * from public.exercises_with_student_data($1)', [[exId]])).map((r) => r.exercises_with_student_data)).toEqual([exId]);
    });

    it('M2: delete locks the exercise: a concurrent attempt cannot slip past the student-data check', async () => {
      const l = await createLesson(A.course);
      const blk = await createBlock(l.part1, 1, false);
      const ex = await createExercise(blk);
      const c1 = await pool.connect();
      const c2 = await pool.connect();
      try {
        await c1.query('begin');
        const r = await c1.query('select public.editor_delete_block($1, $2) as r', [A.teacher, blk]);
        expect(r.rows[0].r).toBe('ok'); // deleted, not committed: holds the exercise lock
        await c2.query('begin');
        const insert = c2.query(`insert into public.attempts (student_id, exercise_id, answer, is_correct) values ($1, $2, '{}', true)`, [student, ex]);
        const settled = insert.then(() => 'inserted', (e: Error) => e.message);
        await new Promise((res) => setTimeout(res, 150));
        await c1.query('commit');
        expect(await settled).toMatch(/foreign key|violates/);
      } finally {
        await c2.query('rollback').catch(() => undefined);
        await c1.query('rollback').catch(() => undefined);
        c1.release();
        c2.release();
      }
    });

    it('words: import dedupes, links, validates; save/unlink are authorised', async () => {
      const l = await createLesson(A.course);
      const rows = [
        { ru: 'книга', uz: 'kitob' },
        { ru: 'книга', uz: 'KITOB' },
        { ru: 'дом', uz: 'uy', example_ru: 'Это дом' },
      ];
      const [r1] = await call<{ inserted: number; linked: number; skipped: number }>('editor_import_words', [A.teacher, l.lesson, JSON.stringify(rows)]);
      expect(r1).toEqual({ inserted: 2, linked: 0, skipped: 1 });
      const l2 = await createLesson(A.course);
      const [r2] = await call<{ inserted: number; linked: number; skipped: number }>('editor_import_words', [A.teacher, l2.lesson, JSON.stringify(rows)]);
      expect(r2).toEqual({ inserted: 0, linked: 2, skipped: 1 });
      expect(await sql('select 1 from public.words where course_id = $1 and lower(ru) = $2', [A.course, 'книга'])).toHaveLength(1);
      await rejects(call('editor_import_words', [A.teacher, l.lesson, JSON.stringify([{ ru: 'x', uz: ' ' }])]), /invalid word row/);
      await rejects(call('editor_import_words', [B.teacher, l.lesson, JSON.stringify(rows)]), /forbidden/);

      const [{ editor_save_word: w }] = await call<{ editor_save_word: string }>('editor_save_word', [A.teacher, l.lesson, null, JSON.stringify({ ru: 'стол', uz: 'stol' })]);
      await call('editor_save_word', [A.teacher, l.lesson, w, JSON.stringify({ ru: 'стол', uz: 'stol (mebel)' })]);
      expect((await sql('select uz from public.words where id = $1', [w]))[0].uz).toBe('stol (mebel)');
      await rejects(call('editor_save_word', [A.teacher, l2.lesson, w, JSON.stringify({ ru: 'a', uz: 'b' })]), /forbidden/);
      await rejects(call('editor_save_word', [B.teacher, l.lesson, w, JSON.stringify({ ru: 'a', uz: 'b' })]), /forbidden/);
      await rejects(call('editor_unlink_word', [B.teacher, l.lesson, w]), /forbidden/);
      await call('editor_unlink_word', [A.teacher, l.lesson, w]);
      expect(await sql('select 1 from public.lesson_words where lesson_id = $1 and word_id = $2', [l.lesson, w])).toHaveLength(0);
    });

    it('teacher of another course unaffected by an unused course', async () => {
      const c = await createCourse(A.teacher);
      expect(c).toBeTruthy();
    });
  });
});
