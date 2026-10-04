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
| `DATABASE_PATH` | SQLite file |
| `STORAGE_DRIVER`, `STORAGE_LOCAL_DIR` | file storage |
| `DEV_USER_EMAIL` | the single development user |
| `SCAN_IMAGE_RETENTION_HOURS` | auto-delete scan photos N hours after a model exists (0 = keep until deleted) |

## AI providers
`src/lib/ai/types.ts` defines `AIProvider` (`analyzeObject`, `reconstructModel`, `modifyModel`, `generateFunctionalPart`, `checkPrintability`, `planTurn`). `src/lib/ai/registry.ts` composes it from backends:
- vision/chat/design → `anthropic.ts` (or offline `local.ts`)
- reconstruction → `meshy.ts`

To swap a backend (Tripo, Rodin, Luma, a self-hosted COLMAP/2DGS or TRELLIS service…) implement the same function signature and change one line in the registry.

## Database
SQLite via Drizzle (`src/lib/db/schema.ts`): `users, projects, scans, scan_images, models, model_versions, prompts, print_profiles, jobs`. Migrations live in `drizzle/` and run automatically. After schema changes: `npm run db:generate`. To use Postgres, switch the Drizzle dialect/driver in `db/client.ts` and `drizzle.config.ts`.

## Storage
`src/lib/storage/index.ts` is a small interface (`put/get/exists/delete/deletePrefix`). `local` is implemented; add an S3/R2 driver by implementing it and returning it for `STORAGE_DRIVER=s3`. Layout per project:
```
<project-name>-<id>/scan/images/0001.jpg … (+ thumbs/)
<project-name>-<id>/models/model-v1.stl, model-v2.stl …
<project-name>-<id>/exports/model-v2.3mf
```

## Background jobs
Analysis, reconstruction and chat turns are jobs in the `jobs` table with progress + stage. The browser polls; you can close the page and return. Jobs interrupted by a restart are re-queued, and provider state (e.g. the Meshy task id) is persisted so they resume without paying twice. The worker is in-process (`jobs/queue.ts`, started via `instrumentation.ts`) – fine for one node; for scale-out move `processNext` into a worker or swap in BullMQ/Inngest/pg-boss (handlers are queue-agnostic).

## Authentication
`src/lib/auth.ts#getCurrentUser` returns a development user. Every route/service already filters by user id; plug Auth.js/Clerk/Supabase in there.

## Privacy
Photos have metadata stripped, are stored only in your storage, and are sent to the configured AI services *only* for analysis/reconstruction. “Delete photos” and “Delete project” remove DB rows **and** files. Optional automatic purge via `SCAN_IMAGE_RETENTION_HOURS`.

## Production
```bash
npm run build && npm start
```
Needs a Node host with a persistent disk (SQLite + local storage) – e.g. a VM, Fly.io/Railway with a volume, or Docker. Serverless platforms (Vercel) need Postgres + S3-compatible storage + an external worker; the interfaces above are the seams for that. Serve over HTTPS for the camera. `sharp`, `better-sqlite3` and `manifold-3d` are marked as server-external in `next.config.mjs`.

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
