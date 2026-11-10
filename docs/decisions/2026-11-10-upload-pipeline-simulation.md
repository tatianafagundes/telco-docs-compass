# Upload pipeline simulation and reset

- **Pipeline:** scanning and reading are simulated by `advancePipeline`, stepped from the browser every ~0.7 s. Markers: `TEST-QUARANTINE` or `.exe` → quarantined; `TEST-UNREADABLE` → failed reading, also on retry. Seeded documents never move.
- **Progress bar:** files are sent in one request each, so the bar moves per finished file, not per byte; it never reaches 100 % while any file is still being checked.
- **Failed upload:** the half-registered document is deleted again, so "Nothing was added" stays true.
- **Duplicate name:** the dialog warns and adds a separate document; "Add as new version" from the dialog is not built yet — the person opens the existing document instead.
- **Delete in the progress panel:** follows the existing role rule (manager and above); contributors see the reason text.
- **Reset test data:** a server function, not an edge function (see AGENTS.md). The activity log is append-only, so added documents become purged tombstones, unlinked from their records, with their files removed. Seeded documents whose status was changed during a session are not rolled back.
