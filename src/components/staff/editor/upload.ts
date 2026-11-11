"use client";

import { createClient } from "@/lib/supabase/browser";
import type { Uploader } from "./actions-type";

/** Uploads straight to the private `content` bucket using the one-time token the server issued for exactly this path. */
export const uploadToContentBucket: Uploader = async (path, token, file) => {
  const { error } = await createClient().storage.from("content").uploadToSignedUrl(path, token, file, { contentType: file.type });
  return { ok: !error };
};
