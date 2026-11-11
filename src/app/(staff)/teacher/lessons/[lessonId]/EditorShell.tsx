"use client";

import { LessonEditor } from "@/components/staff/editor/LessonEditor";
import type { EditorActions } from "@/components/staff/editor/actions-type";
import { uploadToContentBucket } from "@/components/staff/editor/upload";
import type { EditorData } from "@/lib/editor/types";
import {
  createBlockAction,
  createLessonAction,
  deleteBlockAction,
  importWordsAction,
  reorderBlocksAction,
  requestUploadAction,
  saveBlockAction,
  saveLessonAction,
  saveWordAction,
  setPublishedAction,
  unlinkWordAction,
} from "../actions";

const actions: EditorActions = {
  saveLesson: saveLessonAction,
  createBlock: createBlockAction,
  saveBlock: saveBlockAction,
  deleteBlock: deleteBlockAction,
  reorderBlocks: reorderBlocksAction,
  setPublished: setPublishedAction,
  importWords: importWordsAction,
  saveWord: saveWordAction,
  unlinkWord: unlinkWordAction,
  requestUpload: requestUploadAction,
  createLesson: createLessonAction,
};

export function EditorShell({ data }: { data: EditorData }) {
  return <LessonEditor data={data} actions={actions} uploader={uploadToContentBucket} />;
}
