import { beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { asService, sql, withUser } from './helpers';
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

    it('publish flips all blocks of the lesson; student sees them only when published', async () => {
      const l = await createLesson(A.course);
      await rejects(call('editor_set_lesson_published', [A.teacher, l.lesson, true]), /no blocks/);
      const blk = (await call<{ block_id: string }>('editor_create_block', [A.teacher, l.part1, 'text', JSON.stringify({ body: 'x' }), null]))[0].block_id;
      const seen = () => withUser(student, (q) => q('select id from public.blocks where id = $1', [blk]));
      expect(await seen()).toHaveLength(0);
      await rejects(call('editor_set_lesson_published', [B.teacher, l.lesson, true]), /forbidden/);
      expect((await call<{ editor_set_lesson_published: number }>('editor_set_lesson_published', [A.teacher, l.lesson, true]))[0].editor_set_lesson_published).toBe(1);
      expect(await seen()).toHaveLength(1);
      // publishing is not a content change: open editors keep a valid concurrency token
      const [tok] = await sql('select updated_at::text as t from public.blocks where id = $1', [blk]);
      const created = (await call<{ block_id: string; updated_at: string }>('editor_create_block', [A.teacher, l.part2, 'text', '{}', null]))[0];
      await call('editor_set_lesson_published', [A.teacher, l.lesson, false]);
      await call('editor_set_lesson_published', [A.teacher, l.lesson, true]);
      const [after] = await sql('select updated_at::text as t from public.blocks where id = $1', [created.block_id]);
      expect(after.t).toBe(created.updated_at);
      expect(tok.t).toBeTruthy();
      await call('editor_set_lesson_published', [A.teacher, l.lesson, false]);
      expect(await seen()).toHaveLength(0);
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
