# p3b gates - /Users/earatat/telco-docs-compass/src/services/__tests__/invariant-gates.test.ts

Listing of the gate folder: 13 files (12 *.test.ts + the 2 integration ones). No explicit runner list: vitest picks up *.test.ts, so the new file is already in `bun run test`.
Final: `bun run test` = 14 files passed, 2 skipped; 185 passed, 1 expected fail, 17 skipped. `npx tsc --noEmit` clean.

## Gates written (describe / it - invariant - BR)
- Inv 5 / BR-022: reason text exact; null/undefined/empty creator exempt; %s (reviewer, manager, tenant_admin, master_admin) author cannot approve; other reviewer / null creator can.
- Inv 5 / BR-025: viewer and contributor, author or not, fail with the ROLE reason; gate reason is reported before four-eyes.
- Inv 6 / BR-020/021/023: singular/plural texts (1 / 3); count and no reason when done; required+pending with confidence 0.999/band high still blocks; rejected is not a confirmation; optional or non-extractable never block.
- Inv 7 / BR-010: all 49 pairs vs the literal spec table; archived has no next; BR-011 in_review->draft refused, send back needs review, null outside in_review; BR-013 frozen = exactly superseded, expired, archived.
- Inv 8 / BR-050: hold > retention > floor (detail = reason / retain date / floor date); floor created+12d = 2026-11-13 blocks, +11d = today does not (hand calculated); no blocker case.
- Inv 8 / BR-051/052: soft delete texts, role before hold; retain_until == today (soft allowed, permanent blocked); admins only (4 roles refused, 2 allowed); hold before retention in purge, role before hold.
- Inv 11 / BR-112: limit 5, hits 1..6 -> 5 true then false; reset at s=0/45/59 -> 60/15/1.
- Inv 10 / BR-120/121/122: 6 attempts, backoff 30/120/600/1800/7200, gaveUp at 6; 2xx delivered even on attempt 6; max(backoff, Retry-After) with cap (100, 10, 3600, 5000, 5000@attempt5 -> 7200); HTTP date -> 90 s; garbage ignored.
- BR-130/131: both tables, "deleted" for all 7 statuses, 11 refused values (incl. "deleted", internal names, case variants, empty).
- Total 36 `it` entries (it.each expands the four-eyes roles).

## Proof of red
Perturbed my own file only (production untouched): added in_review->draft to the spec table, 7200->7201, "2026-11-13"->"2026-11-14", last rate expectation false->true. Result: 4 failed (BR-010 table, BR-050 floor, BR-112 sixth request, BR-121 backoff). File restored from backup, green again.

## Divergences SPEC vs SOURCE
1. BR-122 "An invalid value is ignored" - src/services/event-delivery-rules.ts:24-25: after the /^\d+$/ test, falls back to Date.parse(). In V8 Date.parse("-2999") and Date.parse("2999.5") give year 2999, so parseRetryAfter returns ~3.2e10 s and outcomeAfter waits the 3600 s cap instead of the plain backoff (30 s). Spec: null / ignored. Marked `it.fails` with comment "SPEC vs SOURCE ... owner's decision pending". (Harmless-looking cases like "-5" / "5.5" parse to past dates -> 0 -> same wait as ignored, so I did not use them.)
No string divergences found: all 4 delete texts, the four-eyes text, both gate texts, role reasons match the spec byte for byte.

## Adversarial cases and what they showed
- Author with tenant_admin/master_admin: code correctly refuses (isOwnDocument does not look at role).
- Creator null / "" with caller "": exempt, no false match.
- Below reviewer + author: role reason wins, as BR-025 says (footerAction).
- retain_until == today: soft delete allowed, permanent blocked, as spec (> vs >=).
- High-confidence pending required field: blocks; confidence is never read.
- Retry-After above cap vs 7200 backoff: correct.
- NOT-A-DIVERGENCE-BUT-WORTH-KNOWING (server, not pure, no gate): src/services/document-write.functions.ts:368-376 (transition) checks role, then four-eyes (line 370, doc.approve.ownDocument), THEN pending details (line 376, doc.approve.requiredPending). BR-025 order is role -> gate -> four-eyes, but that is stated for the footer UI (review-flow-rules.ts footerAction, which does follow it). When an author's document also has pending details, the UI says "N required details need checking" while the server returns ownDocument. Spec BR-020/022 do not fix a server order; flagging for the owner/rebuild, not asserted.

## Gates NOT written (forbidden forms or out of reach)
- BR-115 isolation between systems: decideRate(hits, limit, now) has no system argument; counters live in SQL/tmf-gateway. A pure gate would need to simulate a counter in the test = deriving the expected value from my own implementation (form 2). Needs an integration gate on the counter store.
- "Header and footer show the same approve state" style equalities: both call footerAction, one implementation (form 1).
- toTmfStatus vs statesForTmfStatus consistency: both read TO_TMF_STATUS (form 1); I grave the spec table literally instead.
- BR-022 server enforcement and BR-140 (systemMayApprove, tmf-gateway.ts): server/gateway I/O paths; systemMayApprove is pure but not in the requested invariants list; existing tests cover it.
- Invariants 1-4, 9, 12 and BR-053 (tombstone), BR-125: need DB/UI, not pure modules.
