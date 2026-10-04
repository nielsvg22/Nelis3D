# Nelis3D

Scan a real object with your phone → tell the AI what you want → get a **real, checked 3D mesh** → export STL/3MF for the **Creality K1 Max**.

Nothing here is a mock: the viewer loads the generated mesh file, edits are real CSG operations, and the print check analyses the actual triangles.

## How it works (honest overview)

| Step | Implementation | Runs where | Cost |
|---|---|---|---|
| Capture | Browser camera (`getUserMedia`), on-device blur/light/motion/angle feedback; or photo upload | Phone | free |
| Preprocess | `sharp`: EXIF rotate, strip GPS/metadata, resize, sharpness score | Server | free |
| Analyse object | Claude vision → structured analysis (name, size estimate, features, feasibility, questions) | Anthropic API | per token |
| Photo → 3D mesh | **Meshy** multi-image-to-3D (pluggable `reconstructModel`) | Meshy API | paid credits |
| Cleanup | weld, de-dupe, consistent winding, outward normals | Server | free |
| Modify / design | Claude plans **edit ops** or a **CadSpec** (parametric CSG JSON); the mesh is built with `manifold-3d` (watertight booleans, WASM) | Anthropic + server | per token |
| Print check | topology, loose parts, BVH wall-thickness, self-intersection, overhang, build volume, orientation search | Server | free |
| Export | binary STL, standards-compliant 3MF (mm, centred on the K1 Max plate, profile metadata) | Server | free |
| Print | Download 3MF → open in Creality Print. Direct send = future (see `lib/printing/connector.ts`) | – | – |

**Limits you should know about**
- Photo reconstruction quality is whatever the reconstruction service delivers. Shiny, transparent or featureless objects fail; the app then shows recovery options instead of pretending success. Scale from photos is an *estimate* – correct it in the “Object analysis” card.
- Reconstructed meshes are often not watertight; the print check says so and offers “Repair mesh”. Boolean edits (holes, cuts, …) need a closed solid.
- The Meshy integration is written against its documented REST API but has **not** been exercised against a live key in this repo's CI. Treat first use as a smoke test.
- Without any API key the app still works for: uploading STL/OBJ/3MF, resize/scale, repair, print check, export, and an offline rule-based assistant (`%` scaling, “20 cm wide”, holes, cut, box with lid, phone holder).

## Quick start

```bash
npm install
cp .env.example .env.local     # add keys (see below)
npm run dev                    # http://localhost:3000
```
The database is created and migrated automatically on first request.

### Using the camera on your iPhone
`getUserMedia` requires **HTTPS** (except `localhost`). Options: `npx next dev --experimental-https` and open `https://<your-LAN-ip>:3000`, a tunnel (Cloudflare Tunnel / ngrok), or deploy. The “Use the iPhone camera app instead” button and **Upload photos** work over plain HTTP.

## Environment variables
See `.env.example`. Keys are only ever read from the environment (`src/lib/env.ts`).

| Variable | Purpose |
|---|---|
| `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` | analysis, chat planning, parametric design |
| `MESHY_API_KEY`, `MESHY_AI_MODEL` | photo → mesh reconstruction |
| `AI_PROVIDER` | `auto` (use keys present) or `local` (force offline) |
| `DATABASE_URL` | Postgres connection string (unset ⇒ embedded PGlite) |
| `STORAGE_DRIVER`, `STORAGE_LOCAL_DIR` | `postgres` or `local` file storage |
| `CRON_SECRET` | protects `/api/cron/maintenance` |
| `DEV_USER_EMAIL` | the single development user |
| `SCAN_IMAGE_RETENTION_HOURS` | auto-delete scan photos N hours after a model exists (0 = keep until deleted) |

## AI providers
`src/lib/ai/types.ts` defines `AIProvider` (`analyzeObject`, `reconstructModel`, `modifyModel`, `generateFunctionalPart`, `checkPrintability`, `planTurn`). `src/lib/ai/registry.ts` composes it from backends:
- vision/chat/design → `anthropic.ts` (or offline `local.ts`)
- reconstruction → `meshy.ts`

To swap a backend (Tripo, Rodin, Luma, a self-hosted COLMAP/2DGS or TRELLIS service…) implement the same function signature and change one line in the registry.

## Database
Postgres via Drizzle (`src/lib/db/schema.ts`): `users, projects, scans, scan_images, models, model_versions, prompts, print_profiles, jobs, files`.
- `DATABASE_URL` set → node-postgres (Neon, Supabase, any Postgres). Used on Vercel.
- unset → **PGlite**, an embedded Postgres in `./data/pglite` (zero-setup local dev, same schema).
Migrations live in `drizzle/` and are applied automatically (with an advisory lock) on first use. After schema changes: `npm run db:generate`.

## Storage
`src/lib/storage/index.ts` is a small interface (`put/get/exists/delete/deletePrefix`) with two drivers: `local` (disk, dev default) and `postgres` (private `files` table; default when `DATABASE_URL`/`VERCEL` is set – no extra service needed). Add S3/R2/Vercel Blob by implementing the interface. Logical layout per project:
```
<project-name>-<id>/scan/images/0001.jpg … (+ thumbs/)
<project-name>-<id>/models/model-v1.stl, model-v2.stl …
<project-name>-<id>/exports/model-v2.3mf
```

## Background jobs
Analysis, reconstruction and chat turns are rows in `jobs` with progress + stage, executed in short **steps** (no resident worker, so it runs on serverless): a step starts right after the request (`after()`), the open page's polling keeps long jobs moving (e.g. polling Meshy), and a daily cron (`/api/cron/maintenance`) is the safety net. `jobs.state` stores provider state (the Meshy task id) so nothing is started or paid twice. You can close the page; reconstruction continues on the provider side and is finished the next time you open the project (or by the cron). To use a real queue (Inngest/QStash/BullMQ) call `advanceJob` from its consumer.

## Authentication
`src/lib/auth.ts#getCurrentUser` returns a development user. Every route/service already filters by user id; plug Auth.js/Clerk/Supabase in there.

## Privacy
Photos have metadata stripped, are stored only in your storage, and are sent to the configured AI services *only* for analysis/reconstruction. “Delete photos” and “Delete project” remove DB rows **and** files. Optional automatic purge via `SCAN_IMAGE_RETENTION_HOURS`.

## Deploy on Vercel
1. Create a Postgres (Neon via Vercel Marketplace) and set `DATABASE_URL` (+ `CRON_SECRET`, and the AI keys) in the Vercel project's environment variables.
2. Import the repo in Vercel (framework: Next.js) – `vercel.json` sets the region and the daily cron. Or `vercel deploy --prod` with the CLI.
3. Keep **Vercel Authentication** (Project → Settings → Deployment Protection) on until real accounts exist – the app currently has a single development user.

Serverless limits that shaped the design: request/response bodies ≈ 4.5 MB (photos are shrunk and uploaded in batches in the browser; meshes are streamed; **3D-model uploads are limited to ≈4 MB** on Vercel), function duration ≤ 300 s (jobs are stepped), no writable disk (files live in Postgres). `sharp`, `pg`, `pglite` and `manifold-3d` are server-external in `next.config.mjs`.

## Production elsewhere
`npm run build && npm start` on any Node host with `DATABASE_URL` (or a persistent disk for PGlite).

## K1 Max profile
`src/lib/printing/profiles.ts`: 300×300×300 mm, 0.4 mm nozzle, PLA default (+ PETG, ABS, ASA, TPU – add more there). Per-project settings (material, layer height, infill, supports) drive the print check thresholds (min wall, overhang angle) and the metadata embedded in the 3MF.

## Develop
`npm test` (geometry kernel, I/O round-trips, print check) · `npm run typecheck` · pipeline map: `src/lib/pipeline/stages.ts`.

## Not built yet
Direct printer sending / slicing / queue (interface sketched), mesh hole-filling and thickening, segmentation service, UI translations (UI is English; the assistant answers in your language), real accounts.

## On your phone
- **Install it:** open the app in Safari → Share → *Add to Home Screen* (Android Chrome: *Install app*). It runs full-screen with its own icon (`src/app/manifest.ts`, icons in `public/icons`, regenerate with `node scripts/make-icons.mjs`). The app needs a connection to the server – there is no offline mode.
- **Camera needs HTTPS** (see Quick start). Over plain HTTP use *Upload photos* or *Use the iPhone camera app instead*.
- Layout on phones: viewer → AI chat → dimensions / print check / settings / export → versions. Inputs are ≥16px (no Safari zoom-on-focus), tap targets ≥40px, safe-area insets respected.
