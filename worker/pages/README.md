# Extra pages (one worker, several Supabase projects)

Each `*.env` file here is one more page the worker serves (git-ignored: it holds a service-role key).
Copy `example.env.example` to `<id>.env` (e.g. `name-nest.env`), fill it in, and restart the worker.

- `PAGE_ID` (default: the file name) — lower-case letters, digits, hyphens. Also this page's ComfyUI names
  (`<id>/raw`, `<id>/reel-voice`, `<id>/reel-music`, voice clips in the input folder's `<id>/`, client `<id>-worker`).
- `PAGE_LABEL` — shown in the log; the default PC folder is `<OneDrive>\Pictures\<PAGE_LABEL>`.
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` — that page's project (run `supabase/schema.sql` there first).
- `OUTPUT_ROOT` — PC backup folder for its cards; `REELS_OUTPUT` — its full reel videos (default `<OUTPUT_ROOT>\Reels`).
- `PREVIEW_MOMENT`, `PREVIEW_CAST`, `PREVIEW_DOLL_CAST` — optional theme-preview scene (default: Unique Names').

`worker.env` keeps working as before: it is the `unique-names` page, unless a file here has the same `PAGE_ID` or the
same `SUPABASE_URL` (then that file wins). ComfyUI, poll and heartbeat settings stay in `worker.env` (one ComfyUI).
A file with a missing key, a bad id, or an id/project already used is skipped and named at the top of `worker.log`.
