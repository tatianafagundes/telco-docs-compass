# Effective documents: names editable, approved content protected

## What changes for people
- On an **approved** or **effective** document, people with edit rights can still change the **name** and **description**.
- The approved content is protected: the file (no new or restored versions), the confirmed details, and the validity/expiry date can't be changed. Where those controls appear, they show a short reason instead: "This document is approved, so its content stays as it was approved. You can still rename it or update its description."
- Sensitivity and legal holds keep working as today (they control access and retention, not content).
- Superseded, expired and archived documents stay fully closed, as today.
- Connected systems get the same rule: a change to name/description is accepted; a change to details, dates or attachments returns a clear 409 "approvedContentLocked" explaining that only name and description can change.

## Rule
```text
status          name/description   details, dates, file/versions
draft/in_review editable           editable
approved        editable           protected
effective       editable           protected
superseded+     closed             closed
```

## Technical details
- `src/services/document-rules.ts`: add `APPROVED_STATUSES`, `contentProtected(status)` and pure `metadataPatchAllowed(status, fieldNames)` returning ok or the blocked fields.
- `src/services/document-write.functions.ts`: `updateMetadata` rejects protected fields with `doc.edit.approvedContent` (name/description/sensitivity still pass); `addVersion` (incl. restore) and the extraction-review write reject on approved/effective.
- `src/services/tmf-gateway.ts` `patchDocument`: same check; attachment changes on approved/effective refused with 409.
- `src/services/document-actions.ts`: split `editState` into name/description vs content, with the reason text above; panel/version/review UI reads these.
- Tests (kept in project):
  - `src/services/__tests__/document-rules.test.ts`: one test per status row of the table, plus "rename on effective allowed", "characteristic on effective blocked", "expiry on approved blocked".
  - `src/services/__tests__/document-actions.test.ts`: rename available on effective; content edit unavailable with reason.
  - `e2e/tmf-api.py`: new section — PATCH name on effective doc succeeds; PATCH characteristic/validFor returns 409; content unchanged afterwards.
- Update contract notes, AGENTS.md rule and rebuild handbook business rules (new BR).
