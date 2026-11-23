# Regression after publishing

Some checks need the hosted environment: the server-side key that the app uses for privileged writes
exists only there, so a local dev server cannot register documents, mint system keys or run the
gateway end to end. Run these against the preview once a change is on `main`.

## 1. Screens (5 minutes, by hand)

Log in as a manager of the Sweden tenant and as its admin, then check:

- Documents: the start page lists recent and expiring documents; opening one shows the side panel.
- A document in review: approve it (needs another person than the one who added it), see the activity entry.
- Legal hold: place one on a document, try to delete it (refused), release it.
- Holds and retention: the three tabs load.
- Admin, Connected systems: connect a system, see the key once, rotate it, disconnect it.
- Bulk: select two documents, start a change, see the progress and the summary.
- Upload: open a record (for example order O-7731), "Add documents", send a PDF. It appears with version 1
  and leaves "uploading" once the file is in. Also try a file type the document type does not accept
  (refused with a reason).
- Check details with a required detail nobody read (a quote made through the API shows it): the page says
  "Required details not read" with a field for each one, the stepper stays on Check details, and the footer
  says how many are left. Enter a value and Save: the field goes, "Approve document" becomes available once
  nothing is left (another person than the author approves). Local runs cannot save (the server key is only
  in the hosted app), so this is the one place the write is checked end to end.
- Finding where to add: on Documents, "Add documents" opens "Choose a record"; type `O-77`, choose the order, then
  "Choose files" and a PDF. The order's page opens with the type step "Adding to O-7731 …". Cancel it: focus is on
  Add documents and the hint offers "Choose a different record". As a viewer the button is
  unavailable with its reason. The side panel and each result row link to the document's record.

- UI review P2: Admin shows its areas under Admin in the left navigation (no tabs), and the page title is
  the area. Document types say "Inherited", "Changed here" or "Locked" with the group named once above.
  A record lists documents in a table that sorts by Name, Type and Changed. A document in review with
  details to check shows "Check details" as its one primary action and "Send back to draft" in More actions.
  Searching shows "n documents for "word"" with Clear and Sort by on one row. Connected systems
  lists disconnected ones collapsed under "Disconnected (n)".
- Log in page: dark in both themes, legal warning at the bottom, "Log in". Log out from the account menu:
  "You have logged out. Log in again to continue."
- Share level: share a document "Can view" with a Sweden contributor who has no access to its record. They
  open it from Shared with me and cannot change it; the server refuses an edit too. As the group
  administrator, adding documents is refused by the server ("works with settings and counts, not documents").
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
- Documents expire in the scheduled job; opening a list also expires the reader's tenant, at most
  once a minute, so expiry still happens if the scheduler is not set up.

## Rolling back

The commit before this work on `main` is tagged locally as `pre-hardening-main` (`8cd46ff`). To undo,
revert the range in a new commit (`git revert --no-commit 8cd46ff..HEAD`, then commit and push); do
not force-push `main`.
