---
inclusion: auto
name: structure
description: Where code lives in this repository and where new code goes. Read before adding or moving files.
---
# Structure

See `docs/architecture/ARCHITECTURE.md` for the map and the "where do I change X" table. Short version:

| Need | Put it in |
| --- | --- |
| A page | `src/routes/` (file-based routing; the root layout is `__root.tsx`) |
| UI | `src/components/<area>/`. Primitives in `erad/`. `ui/` is generated: do not edit |
| Data hook for a screen | `src/hooks/` |
| A rule about documents, roles, status, search, upload | a pure file in `src/services/` (`*-rules.ts`) with a test |
| Something a screen asks the server to do | a server function in `src/services/*.functions.ts` |
| An endpoint for other systems | a thin route under `src/routes/api/public/tmf-api/`, with the logic in `src/services/tmf-gateway.ts` and the mapping in `tmf667-mapper.ts` |
| Background work | a route under `src/routes/api/public/` called by the scheduler, with the work in a service file |
| A test helper | `src/test/` |
| A decision and its reason | `docs/decisions/` (one short file) |

Rules of the house:

- No file in `src/services` over 300 lines. Files already over are listed in `src/test/repo-hygiene.test.ts` and may not grow: put new code in a new file next to them.
- A module folder under `src/services` has a `README.md` with the seven standard sections (see `AGENTS.md`).
- Every file starts with a short comment: what it is responsible for and what it must not know about.
- Docs and code change in the same commit. A doc that names a file that is gone is a bug.
