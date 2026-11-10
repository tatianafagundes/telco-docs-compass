# Design review of every screen

## Goal
A clear, honest review of every screen through several designer lenses, followed by fixes for what matters most. The north star guides priorities: people should quickly find and trust the right, approved document.

## Screens in scope
Sign-in, Documents (record list), Record page with document panel, Detail review, Shared with me (list and document), Holds and retention, Admin (types, policies, countries, holds, retention, deletion history), Add documents dialog and progress, Manage access dialog, and empty, loading, error and unavailable states. The developer-only design review page is excluded here (its redesign is tracked separately).

## Lenses
1. **Product / customer-first:** does each screen answer "is this the right, approved document?" within seconds? Is the next step obvious?
2. **Apple-like visual design:** calm hierarchy, generous spacing, one clear primary action per area, restrained colour, consistent type scale.
3. **Interaction design:** fewer clicks, predictable panels and dialogs, clear feedback after each action, safe undo or escape.
4. **Content design:** plain words, sentence case, warm tone, consistent naming (record, document, share), banned phrases absent, useful reasons on unavailable actions.
5. **Accessibility (WCAG 2.2 AA):** contrast in light and dark, focus order and visibility, 200% zoom, target sizes, screen-reader names.
6. **Information architecture:** navigation labels, where things live, role-based views (viewer, manager, admin, group admin).
7. **Responsive layout:** 1280, 1440 and 1920 widths, plus a narrow laptop/tablet check (about 800px, matching the current preview).
8. **Trust and compliance:** status, version, hold and retention signals visible where decisions are made; no leaks of other countries' details.

## How
- Capture every screen in light and dark, at each width, signed in as each relevant account (Sweden viewer, manager, admin; Norway manager; group admin).
- Score each screen per lens (good / needs work / problem) with screenshots as evidence.
- Deliver a short review report in Files: top issues ranked by impact on the north star, quick wins, and larger changes.
- Then fix: all quick wins and problems in this pass; larger changes listed for your choice.

## What you get
- A review report (PDF) with screenshots and ranked findings.
- Fixes applied to the screens, re-checked with fresh screenshots.
- A list of bigger redesign ideas, each with a one-line reason, for you to approve or skip.

## Technical details
- Playwright capture script under `/tmp/browser/design-review/`, signed in through the app's sign-in page with the test accounts.
- Automated checks during capture: contrast of text on tokens, horizontal overflow, focus visible on tab, unnamed buttons, target size under 24px.
- Fixes stay within ERAD tokens and primitives (`src/styles/tokens.css`, `src/components/erad/`); no new libraries; English only.
- Re-run `e2e/share-isolation.py` and the unit tests after fixes to confirm nothing regressed.
