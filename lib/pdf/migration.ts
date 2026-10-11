// Migration 018 (the names PDF): how the app notices a project that has not run it yet. A leaf module (no imports),
// so the plain name actions can use it without loading the PDF code.

type DbError = { message: string; code?: string };

export const NEEDS_018 =
  "Run supabase/migrations/018_names_pdf.sql to keep a log of your PDFs and sort each name only once. This PDF was made anyway; copy its password now.";

/** A database answer for the column / table that migration 018 adds and this project does not have yet. */
export const missing018 = (e: DbError | null | undefined) =>
  !!e && (e.code === "42703" || e.code === "42P01" || e.code === "PGRST204" || e.code === "PGRST205" ||
    /meaning_category|relation .*exports.* does not exist|schema cache/i.test(e.message));
