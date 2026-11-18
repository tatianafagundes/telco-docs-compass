# Accessibility

## Standard

The target is WCAG 2.2 level AA, which is what the Ericsson Design System (EDS) asks products to meet. The app already uses EDS-style tokens (colours, type scale, focus ring) through CSS variables, so the look follows EDS without using the EDS component library. Keep it that way: Lovable generates shadcn/Radix components, and replacing them would break the preview.

## How it is checked

- Automated: an axe-core scan with the WCAG 2.0, 2.1 and 2.2 A and AA rules, run in a browser against the pages and their states: documents, shared, holds, the three admin pages, the open document panel, the edit dialog, and rows while hovered. Last run: no violations in those states.
- Hovered rows matter: a row that changes background on hover can drop its secondary text under 4.5:1. `src/test/hover-contrast.test.ts` keeps the fix in place.
- axe finds roughly a third of the problems. It cannot judge whether labels make sense or whether the keyboard order is logical. Before a release, walk the main flows with the keyboard alone and with a screen reader.

## Known notes

- With a dropdown menu open, axe reports `aria-hidden-focus` on the app root. It comes from how the menu library hides the page behind it while the trigger keeps focus. It lasts only while the menu is open.

- Status colours (the EDS greens, reds and ambers) are for icons, borders and stripes, never for text: as text they fall under 4.5:1. The review page's "All details checked" line was fixed this way.
- The review page lists the details read from a document as a listbox whose options contain buttons and inputs. Options should not hold interactive content. The fix is to make the rows a plain list with their own focus handling; it changes how the keyboard moves through the review, so it needs a person to test it with a screen reader before it ships. The automated scan now covers this page with every row selected in turn: no violations.

## When you add a screen

- Every control has a name; every input has a visible label.
- Do not carry meaning by colour alone: statuses show a word as well.
- Secondary text on any coloured or hover background must reach 4.5:1.
- Everything reachable by mouse is reachable by keyboard, with a visible focus ring.
