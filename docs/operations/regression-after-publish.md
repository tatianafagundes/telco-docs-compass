# Regression after publishing

Some checks need the hosted environment: the server-side key that the app uses for privileged writes
exists only there, so a local dev server cannot register documents, mint system keys or run the
gateway end to end. Run these against the preview once a change is on `main`.

## 1. Screens (5 minutes, by hand)

Sign in as a manager of the Sweden tenant and as its admin, then check:

- Documents: the start page lists recent and expiring documents; opening one shows the side panel.
- A document in review: approve it (needs another person than the one who added it), see the activity entry.
- Legal hold: place one on a document, try to delete it (refused), release it.
- Holds and retention: the three tabs load.
- Admin, Connected systems: connect a system, see the key once, rotate it, disconnect it.
- Bulk: select two documents, start a change, see the progress and the summary.

## 2. API end to end (automated)

From a checkout, with Python 3 and `pip install requests playwright` then `python -m playwright install chromium`:

```
BASE_URL=<preview address> SKIP_SLOW=1 python3 e2e/tmf-api.py
BASE_URL=<preview address> python3 e2e/share-isolation.py
```

They create temporary system keys and "TMF test" documents and remove the keys at the end. Leftover
test documents: Admin as the group admin, "Reset test data". Exit code 1 means a check failed; the
output lists which.

## 3. What changed in behaviour (so a difference is not taken for a bug)

- A keep-until date protects the document through that day; deletion is possible the day after.
- A connected system cannot approve a document added by the person who connected it.
- A request repeated with the same Idempotency-Key while the first is running answers 409
  `idempotencyInProgress` (API) or "try again" (screens).
- Bodies over the limit answer 413; a record filter matching over 1000 documents answers 400 `filterTooBroad`.
- Token requests are limited per caller and per system; a system holds at most 10 live tokens.
- Documents expire in the scheduled job, not when the list is opened. If the scheduler does not run,
  expiry waits for it.

## Rolling back

The commit before this work on `main` is tagged locally as `pre-hardening-main` (`8cd46ff`). To undo,
revert the range in a new commit (`git revert --no-commit 8cd46ff..HEAD`, then commit and push); do
not force-push `main`.
