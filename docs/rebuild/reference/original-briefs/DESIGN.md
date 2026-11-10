---
version: alpha
name: ERAD Library
description: Ericsson Design System (EDS) based component library for ERAD, version 0.1. Light theme values are normative in the frontmatter; dark theme values are listed in the Themes section.
colors:
  primary: "#1174e6"
  layer-system: "#0c0c0c"
  layer-application: "#ebebeb"
  layer-content: "#fafafa"
  text-main: "#242424"
  text-secondary: "#6a6a6a"
  text-contrast: "#ffffff"
  text-link: "#0069c2"
  text-disabled: "#a4a4a4"
  text-on-primary: "#ffffff"
  fill-btn-primary-idle: "#1174e6"
  fill-btn-primary-hover: "#0069c2"
  fill-btn-primary-press: "#005499"
  fill-btn-default-hover: "#4e4e4e"
  fill-btn-default-press: "#242424"
  fill-input-idle: "#ffffff"
  fill-input-disabled: "#f2f2f2"
  fill-input-selected: "#1174e6"
  fill-input-selected-hover: "#0069c2"
  fill-input-prefix: "#fafafa"
  fill-item-idle: "#ffffff"
  fill-item-hover: "#dcdcdc"
  fill-item-selected: "#1174e6"
  fill-item-selected-hover: "#0069c2"
  fill-item-tooltip: "#4e4e4e"
  fill-cell-hover: "#dcdcdc"
  fill-cell-selected: "#d3e3f7"
  fill-cell-striped: "#ebebeb"
  border-btn-idle: "#242424"
  border-item-idle: "#878787"
  border-item-hover: "#6a6a6a"
  border-item-subtle: "#dcdcdc"
  border-item-selected: "#1174e6"
  border-input-idle: "#878787"
  border-input-hover: "#6a6a6a"
  border-input-error: "#bb0b02"
  border-cell-idle: "#878787"
  border-focus: "#a56ebe"
  status-critical: "#ed0e00"
  status-major: "#d46617"
  status-minor: "#fad22d"
  status-warning: "#1174e6"
  status-cleared: "#329864"
  status-indeterminate: "#6a6a6a"
  status-purple: "#a56ebe"
  gradient-ai-start: "#1174e6"
  gradient-ai-end: "#8653f3"
  shadow-elevation-1: "#00000033"
  shadow-elevation-2: "#00000026"
  shadow-elevation-3: "#0000001a"
typography:
  label-12:
    fontFamily: Ericsson Hilda
    fontSize: 12px
    lineHeight: 14px
    fontWeight: 400
    letterSpacing: 0px
  label-14:
    fontFamily: Ericsson Hilda
    fontSize: 14px
    lineHeight: 16px
    fontWeight: 400
    letterSpacing: 0px
  label-14-medium:
    fontFamily: Ericsson Hilda
    fontSize: 14px
    lineHeight: 16px
    fontWeight: 500
    letterSpacing: 0px
  label-14-bold:
    fontFamily: Ericsson Hilda
    fontSize: 14px
    lineHeight: 16px
    fontWeight: 700
    letterSpacing: 0px
  paragraph-14:
    fontFamily: Ericsson Hilda
    fontSize: 14px
    lineHeight: 21px
    fontWeight: 400
    letterSpacing: 0px
  title-14:
    fontFamily: Ericsson Hilda
    fontSize: 14px
    lineHeight: 24px
    fontWeight: 400
    letterSpacing: 0px
  title-16:
    fontFamily: Ericsson Hilda
    fontSize: 16px
    lineHeight: 18px
    fontWeight: 400
    letterSpacing: 0px
  title-16-medium:
    fontFamily: Ericsson Hilda
    fontSize: 16px
    lineHeight: 18px
    fontWeight: 500
    letterSpacing: 0px
  title-18:
    fontFamily: Ericsson Hilda
    fontSize: 18px
    lineHeight: 20px
    fontWeight: 400
    letterSpacing: 0px
  title-18-medium:
    fontFamily: Ericsson Hilda
    fontSize: 18px
    lineHeight: 20px
    fontWeight: 500
    letterSpacing: 0px
rounded:
  none: 0px
  hairline: 1px
  control: 3px
  control-focus: 5px
  badge: 8px
  pill: 12px
spacing:
  none: 0px
  xxs: 1px
  xs: 2px
  s: 4px
  m: 8px
  l: 12px
  xl: 16px
  xxl: 24px
  xxxl: 32px
  overlap: -1px
components:
  button-default:
    textColor: "{colors.text-main}"
    borderColor: "{colors.border-btn-idle}"
    typography: "{typography.label-14}"
    rounded: "{rounded.control}"
    padding: 8px 12px
    height: 32px
  button-default-hover:
    backgroundColor: "{colors.fill-btn-default-hover}"
    textColor: "{colors.text-contrast}"
  button-default-press:
    backgroundColor: "{colors.fill-btn-default-press}"
    textColor: "{colors.text-contrast}"
  button-primary:
    backgroundColor: "{colors.fill-btn-primary-idle}"
    textColor: "{colors.text-on-primary}"
    typography: "{typography.label-14}"
    rounded: "{rounded.control}"
    padding: 8px 12px
    height: 32px
  button-primary-hover:
    backgroundColor: "{colors.fill-btn-primary-hover}"
  button-primary-press:
    backgroundColor: "{colors.fill-btn-primary-press}"
  button-primary-ai:
    textColor: "{colors.text-on-primary}"
    typography: "{typography.label-14}"
    rounded: "{rounded.control}"
    padding: 8px 12px
    height: 32px
  button-default-ai:
    textColor: "{colors.text-main}"
    typography: "{typography.label-14}"
    rounded: "{rounded.control}"
    padding: 8px 12px
    height: 32px
  button-default-ai-hover:
    backgroundColor: "{colors.fill-btn-default-hover}"
    textColor: "{colors.text-contrast}"
  button-default-ai-press:
    backgroundColor: "{colors.fill-btn-default-press}"
    textColor: "{colors.text-contrast}"
  button-icon-only:
    padding: 8px
    size: 32px
  text-field:
    backgroundColor: "{colors.fill-input-idle}"
    textColor: "{colors.text-main}"
    borderColor: "{colors.border-input-idle}"
    typography: "{typography.label-14}"
    rounded: "{rounded.none}"
    padding: 8px
    height: 32px
  text-field-placeholder:
    textColor: "{colors.text-secondary}"
  text-field-hover:
    borderColor: "{colors.border-input-hover}"
  text-field-focus:
    borderColor: "{colors.border-focus}"
  text-field-error:
    borderColor: "{colors.border-input-error}"
  text-field-read-only:
    backgroundColor: "{colors.fill-input-disabled}"
  text-field-disabled:
    backgroundColor: "{colors.fill-input-disabled}"
    borderColor: "{colors.border-item-subtle}"
  text-field-prefix:
    backgroundColor: "{colors.fill-input-prefix}"
  text-field-label:
    textColor: "{colors.text-main}"
    typography: "{typography.label-14}"
  text-field-message:
    typography: "{typography.label-12}"
  text-field-ai-chat:
    backgroundColor: "{colors.fill-input-idle}"
    borderColor: "{colors.border-input-idle}"
    rounded: "{rounded.badge}"
    padding: 8px
    height: 72px
  checkbox:
    backgroundColor: "{colors.fill-input-idle}"
    borderColor: "{colors.border-input-idle}"
    rounded: "{rounded.none}"
    size: 16px
  checkbox-hover:
    borderColor: "{colors.border-input-hover}"
  checkbox-checked:
    backgroundColor: "{colors.fill-input-selected}"
    textColor: "{colors.text-on-primary}"
  checkbox-checked-hover:
    backgroundColor: "{colors.fill-input-selected-hover}"
  radio-control:
    size: 16px
  radio:
    backgroundColor: "{colors.fill-input-idle}"
    borderColor: "{colors.border-input-idle}"
    size: 12px
  radio-hover:
    borderColor: "{colors.border-input-hover}"
  radio-dot:
    backgroundColor: "{colors.fill-input-selected}"
    size: 6px
  radio-dot-hover:
    backgroundColor: "{colors.fill-input-selected-hover}"
  dropdown:
    textColor: "{colors.text-main}"
    borderColor: "{colors.border-btn-idle}"
    typography: "{typography.label-14}"
    rounded: "{rounded.control}"
    padding: 8px 8px 8px 12px
    height: 36px
  dropdown-hover:
    backgroundColor: "{colors.fill-btn-default-hover}"
    textColor: "{colors.text-contrast}"
  dropdown-press:
    backgroundColor: "{colors.fill-btn-default-press}"
    textColor: "{colors.text-contrast}"
  menu:
    backgroundColor: "{colors.fill-item-idle}"
    rounded: "{rounded.none}"
  menu-item:
    backgroundColor: "{colors.fill-item-idle}"
    textColor: "{colors.text-main}"
    typography: "{typography.label-14}"
    padding: 8px
    height: 32px
  menu-item-hover:
    backgroundColor: "{colors.fill-item-hover}"
  menu-item-selected:
    backgroundColor: "{colors.fill-item-selected}"
    textColor: "{colors.text-contrast}"
  menu-item-selected-hover:
    backgroundColor: "{colors.fill-item-selected-hover}"
  menu-item-nested:
    padding: 8px 8px 8px 16px
  menu-group-header:
    typography: "{typography.label-12}"
    padding: 8px
    height: 30px
  menu-divider:
    backgroundColor: "{colors.border-item-subtle}"
    height: 1px
  pill:
    textColor: "{colors.text-main}"
    borderColor: "{colors.border-item-idle}"
    typography: "{typography.label-14}"
    rounded: "{rounded.pill}"
    padding: 4px 8px
    height: 24px
  pill-hover:
    backgroundColor: "{colors.fill-item-hover}"
  pill-deselected:
    textColor: "{colors.text-secondary}"
  pill-deselected-hover:
    backgroundColor: "{colors.fill-item-hover}"
    textColor: "{colors.text-main}"
    borderColor: "{colors.border-item-hover}"
  tag:
    backgroundColor: "{colors.fill-input-idle}"
    textColor: "{colors.status-indeterminate}"
    typography: "{typography.label-14}"
    rounded: "{rounded.badge}"
    padding: 4px 8px
    height: 24px
  tag-small:
    typography: "{typography.label-12}"
    rounded: "{rounded.control}"
    padding: 1px 8px
    height: 16px
  card:
    borderColor: "{colors.border-item-idle}"
    typography: "{typography.paragraph-14}"
    rounded: "{rounded.none}"
    padding: 8px
  card-title:
    typography: "{typography.title-16-medium}"
  card-hover:
    backgroundColor: "{colors.fill-input-idle}"
    borderColor: "{colors.border-item-hover}"
  card-selected:
    backgroundColor: "{colors.fill-input-idle}"
    borderColor: "{colors.border-item-selected}"
  card-draggable:
    backgroundColor: "{colors.fill-input-idle}"
    borderColor: "{colors.border-item-idle}"
    padding: 16px
  card-draggable-disabled:
    backgroundColor: "{colors.fill-input-disabled}"
    borderColor: "{colors.border-item-subtle}"
  table-header-row:
    borderColor: "{colors.border-cell-idle}"
    height: 48px
  table-header-cell:
    typography: "{typography.label-14-medium}"
    borderColor: "{colors.border-cell-idle}"
    padding: 16px
    height: 48px
  table-row:
    borderColor: "{colors.border-cell-idle}"
    height: 48px
  table-row-hover:
    backgroundColor: "{colors.fill-cell-hover}"
  table-row-selected:
    backgroundColor: "{colors.fill-cell-selected}"
  table-row-striped:
    backgroundColor: "{colors.fill-cell-striped}"
  table-row-disabled:
    backgroundColor: "{colors.fill-input-disabled}"
  table-cell:
    typography: "{typography.label-14}"
    padding: 16px
  tooltip:
    backgroundColor: "{colors.fill-item-tooltip}"
    textColor: "{colors.text-contrast}"
    typography: "{typography.label-14}"
    rounded: "{rounded.none}"
    padding: 8px
  tab-nav-item:
    textColor: "{colors.text-main}"
    typography: "{typography.label-12}"
    padding: 8px 4px
    width: 80px
    height: 58px
  tab-nav-item-hover:
    backgroundColor: "{colors.fill-item-hover}"
  tab-nav-item-selected:
    backgroundColor: "{colors.fill-cell-selected}"
    borderColor: "{colors.border-item-selected}"
  nav-item:
    textColor: "{colors.text-main}"
    typography: "{typography.label-14}"
    padding: 12px 8px
    width: 240px
    height: 40px
  nav-item-level-2:
    padding: 12px 8px 12px 20px
  nav-item-level-3:
    padding: 12px 8px 12px 32px
  nav-item-hover:
    backgroundColor: "{colors.fill-item-hover}"
  nav-item-selected:
    backgroundColor: "{colors.fill-item-selected}"
    textColor: "{colors.text-on-primary}"
  nav-item-selected-hover:
    backgroundColor: "{colors.fill-item-selected-hover}"
  tree-node:
    textColor: "{colors.text-main}"
    typography: "{typography.label-14}"
    height: 16px
  scrollbar:
    size: 8px
  scrollbar-thumb:
    backgroundColor: "{colors.border-item-idle}"
  link:
    textColor: "{colors.text-link}"
    typography: "{typography.label-14}"
  system-header:
    backgroundColor: "{colors.layer-system}"
    textColor: "{colors.text-on-primary}"
    typography: "{typography.label-14}"
    padding: 16px
    height: 48px
  application-header:
    backgroundColor: "{colors.layer-application}"
    padding: 8px 16px 8px 32px
    height: 60px
  page-header:
    typography: "{typography.title-18-medium}"
    padding: 0px 16px
    height: 32px
  side-panel:
    backgroundColor: "{colors.layer-content}"
    borderColor: "{colors.border-item-idle}"
    padding: 16px
    width: 356px
  side-panel-collapsed:
    padding: 16px 0px
    width: 80px
  dialog:
    backgroundColor: "{colors.layer-content}"
    borderColor: "{colors.border-item-idle}"
    rounded: "{rounded.none}"
    padding: 24px
    width: 572px
  divider:
    backgroundColor: "{colors.border-item-idle}"
    height: 1px
  focus-ring:
    borderColor: "{colors.border-focus}"
    rounded: "{rounded.control-focus}"
---

# ERAD Library

## Overview

ERAD Library is the component library for ERAD, version 0.1, built on the Ericsson Design System (EDS). It uses the EDS semantic color, size and effect tokens, the EDS text styles in Ericsson Hilda, and the EDS icon library, and adds the ERAD application shell, search and results, cards, pills and tags, tables, side panels, trees and AI-assisted controls. Accordions and timelines also ship in the library but are not yet specified here.

The direction is a dense, utilitarian, desktop enterprise UI: one typeface at 14px on a 16px line height for almost all text, 32px controls, 1px borders, small corners used sparingly, tonal gray layers instead of shadows for page structure, and a small set of saturated status colors reserved for meaning. Every semantic color has a light and a dark value and components switch theme by token, not by variant.

Component entries use `borderColor` as an extension property because 1px borders are the primary structural device of this system. A `-state` entry lists only the properties that change from its base entry; a `-selected-hover` entry builds on `-selected`.

## Colors

Components bind to semantic role tokens, never to raw hex values, and never create new primitives. EDS primitive names follow `hue-NN`, where NN is the HSL lightness percentage: gray-14 is `#242424`, blue-48 is `#1174e6`.

Three role families recur in the token names and decide how selection looks:

- **item**: menu options, navigation items, list and tree rows, cards. Selected items take the solid blue `fill-item-selected`.
- **input**: text fields, dropdown triggers, checkboxes, radios, switches. A checked control takes the solid blue `fill-input-selected` with a white mark.
- **cell**: table rows and cells, and tab navigation items. Selected cells take the light blue `fill-cell-selected` and keep `text-main` text.

Pills have no solid selected state: the default pill is the active state, and a deselected pill is shown by `text-secondary` text.

**Text roles**: `text-main` for almost everything; `text-secondary` for de-emphasized labels, placeholders and deselected pills; `text-contrast` on inverted neutral fills such as tooltips and hovered or pressed default buttons; `text-on-primary` on blue and gradient fills and on the system header; `text-link` for links; and `text-disabled` where disabled text sits inside an enabled container. `text-on-primary` is white in both themes, while `text-contrast` inverts with the theme, so the two are not interchangeable. Selected navigation items use `text-on-primary`, but selected menu options inherit `text-contrast` from EDS despite sitting on the same blue fill; that pairing falls below 4.5:1 in dark theme and is flagged for the design team.

- **Layers** establish page hierarchy. `layer-system` is near-black in both themes. `layer-application` (header, navigation, tree background) is light gray in light theme and near-black in dark theme. `layer-content` is off-white in light theme and dark gray in dark theme. Items and inputs sit on the content layer as pure white in light theme.
- **Primary blue** `primary` is the same value as `fill-btn-primary-idle`, the selected fills and borders, the checked input fill, and the warning status. It is the only accent color; use `primary` only where no role token applies.
- **Interactive fills** darken on interaction in light theme: default buttons go to `fill-btn-default-hover` then `fill-btn-default-press`, primary buttons to `fill-btn-primary-hover` then `fill-btn-primary-press`, and selected items to `fill-item-selected-hover`. Items and cells hover with the light gray `fill-item-hover` and `fill-cell-hover`.
- **Borders** are 1px and gray. Buttons and dropdown triggers use the dark `border-btn-idle`; items, inputs and table cells use the mid-gray `border-item-idle`, `border-input-idle` and `border-cell-idle`, which darken on hover. `border-item-subtle` separates content inside menus and cards and outlines disabled fields; it is decorative and never the only boundary of an interactive control. A field in error switches its own border to `border-input-error`.
- **Focus** is `border-focus` purple, a 1px ring. The same purple primitive is shared only with `status-purple`.
- **Status** colors follow the EDS alarm scale: critical red, major orange, minor yellow, warning blue, cleared green, indeterminate gray, plus purple. On tags the status color is a 1px border plus a background of the status color mixed into `fill-input-idle` at 5% in light theme and 10% in dark, written as `color-mix(in srgb, var(--status-x) 5%, var(--fill-input-idle))`, with the label kept in `status-indeterminate` gray.
- **AI gradient** is a left-to-right (90deg) linear gradient from `gradient-ai-start` to `gradient-ai-end`, and it marks AI-initiated actions only. The AI primary button fills with it; the AI default button uses it as a 1px border over a transparent fill. No other surface takes the gradient.
- **Shadow colors** are black at 20%, 15% and 10% alpha in light theme and 80%, 60% and 40% in dark theme.

## Themes

Implement every color token as a CSS custom property named after the token, defined on `:root` with the light value and redefined under `:root[data-theme="dark"]` with the dark value. Component CSS references the custom properties only. Light is the default theme; a product may opt into following the system color-scheme preference by setting `data-theme` at boot.

| Token | Light | Dark |
|---|---|---|
| primary | #1174e6 | #0077db |
| layer-system | #0c0c0c | #0c0c0c |
| layer-application | #ebebeb | #181818 |
| layer-content | #fafafa | #242424 |
| text-main | #242424 | #ffffff |
| text-secondary | #6a6a6a | #8b8b8b |
| text-contrast | #ffffff | #242424 |
| text-link | #0069c2 | #008cff |
| text-disabled | #a4a4a4 | #767676 |
| text-on-primary | #ffffff | #ffffff |
| fill-btn-primary-idle | #1174e6 | #0077db |
| fill-btn-primary-hover | #0069c2 | #0267bc |
| fill-btn-primary-press | #005499 | #005499 |
| fill-btn-default-hover | #4e4e4e | #f2f2f2 |
| fill-btn-default-press | #242424 | #adadad |
| fill-input-idle | #ffffff | #181818 |
| fill-input-disabled | #f2f2f2 | #242424 |
| fill-input-selected | #1174e6 | #0077db |
| fill-input-selected-hover | #0069c2 | #0267bc |
| fill-input-prefix | #fafafa | #242424 |
| fill-item-idle | #ffffff | #181818 |
| fill-item-hover | #dcdcdc | #4e4e4e |
| fill-item-selected | #1174e6 | #0077db |
| fill-item-selected-hover | #0069c2 | #0267bc |
| fill-item-tooltip | #4e4e4e | #f2f2f2 |
| fill-cell-hover | #dcdcdc | #4e4e4e |
| fill-cell-selected | #d3e3f7 | #1c364d |
| fill-cell-striped | #ebebeb | #181818 |
| border-btn-idle | #242424 | #f2f2f2 |
| border-item-idle | #878787 | #767676 |
| border-item-hover | #6a6a6a | #adadad |
| border-item-subtle | #dcdcdc | #4e4e4e |
| border-item-selected | #1174e6 | #0077db |
| border-input-idle | #878787 | #767676 |
| border-input-hover | #6a6a6a | #adadad |
| border-input-error | #bb0b02 | #dc2d37 |
| border-cell-idle | #878787 | #767676 |
| border-focus | #a56ebe | #8e45b0 |
| status-critical | #ed0e00 | #dc2d37 |
| status-major | #d46617 | #e66e19 |
| status-minor | #fad22d | #fad22d |
| status-warning | #1174e6 | #0077db |
| status-cleared | #329864 | #288964 |
| status-indeterminate | #6a6a6a | #adadad |
| status-purple | #a56ebe | #8e45b0 |
| gradient-ai-start | #1174e6 | #3d95fd |
| gradient-ai-end | #8653f3 | #a07af3 |
| shadow-elevation-1 | #00000033 | #000000cc |
| shadow-elevation-2 | #00000026 | #00000099 |
| shadow-elevation-3 | #0000001a | #00000066 |

## Typography

Everything is set in **Ericsson Hilda**, a proprietary Ericsson typeface. Shipped UI must load Hilda; add a fallback stack for environments where the face is unavailable, treating it as a degradation rather than an approved alternative. Letter spacing is always 0 and line heights are fixed pixel values, not multipliers. Weights are Regular, Medium and Bold only, and weight alone never carries meaning that is not also in the markup.

- **Label 14 (16) Regular** is the default for everything: button labels, inputs, pills, tags, table cells, menu items, tooltips, navigation and tree items. Reach for another style only when one of the rules below applies.
- **Label 12 (14) Regular** is for secondary metadata: text-area counters, timeline timestamps, menu group headers, range-slider units, input validation messages, and tab navigation captions.
- **Label 14 Medium** marks a title inside a dense component: table column headers and titles, timeline titles, and calendar month or year in the date picker. It also carries the value text of a read-only field.
- **Label 14 Bold** marks the parent level of the selected item in a tree.
- **Paragraph 14 (21)** is the only style with reading line height. Use it for body content inside accordions, cards, dialogs and notifications.
- **Title 16 Medium** is the standard component and section title: cards, panels, dialog headers. **Title 16 Regular** carries the AI assistant's status messages, and upstream is also used for wizard content titles and data-visualization segment labels.
- **Title 18 Medium** is the current level in a breadcrumb and the page title in the page header. **Title 18 Regular** is the system layer title.
- **Title 14 (24)** is 14px text on a 24px line for inline status text that must align with a 24px or 32px row, such as the "Searching" indicator next to a spinner.

## Layout

Heights in this document are outer sizes, and they are minimums at 100% zoom: text must scale to 200% without clipping, growing the control rather than truncating. Figma draws the 1px stroke inside the padding, so a 32px button is 8px padding, a 16px line and 8px padding with the border overlapping the padding. In CSS use `box-sizing: border-box`, the stated height, and either subtract 1px from the padding on bordered sides or draw the border as an inset 1px box-shadow; content is vertically centered. Two exceptions draw their line outside the box: the side panel border and the tab navigation focus ring.

Spacing follows a 4px base with 1px and 2px steps for hairline adjustments: 1, 2, 4, 8, 12, 16, 24, 32. The scale is the EDS `Padding` scale under ERAD names: `xxs` is Padding XXS, then XS, S, M, L, XL, XXL and XXXL in order, with `none` Padding None and `overlap` Padding Overlap. Components use 4px between an icon and its label, 8px as the default internal padding, stack gap and spacing between header icons or dialog actions, 12px within a header title group, 16px between sections inside a card, panel or dialog and as standard table cell padding, 24px between page-header actions and between dialog header and content, and 32px as horizontal padding on the application header. Dialog content sits 40px above its action row. A -1px overlap collapses adjoining 1px borders, for example a text field and its attached prefix or button. Stroke widths are 1px by default, 2px for a selected indicator and 4px for a progress or position indicator.

Control heights: buttons, text fields, menu items and page headers are 32px; dropdown triggers are 36px; navigation items are 40px; table rows and header rows are 48px; pills and tags are 24px (small tags 16px); checkboxes are 16px and radio rings 12px. Icons are 16px inside controls, pills, fields and headers, and 24px in tab navigation items. Icons come from the EDS icon library and take the current text color. Any 16px interactive glyph, such as a pill remove cross, a field icon, a checkbox or a radio, needs a pointer target of at least 24px.

Page shell, top to bottom: the 48px system header on `layer-system` (product name at left, 16px action icons at right 8px apart, 16px padding), the 60px application header on `layer-application` (navigation toggle at left with 32px left padding, actions at right with 16px right padding), then the content area on `layer-content` with 16px horizontal padding. Side navigation and browse trees sit on `layer-application` in a 248px container; see Components for item metrics. Page headers are a 32px row with 16px horizontal padding, title at left and actions at right.

This product diverges on the navigation toggle's position: it lives fixed in the footer of the side navigation instead, in the same place on every screen — see `docs/decisions/2026-09-14-toggle-da-nav-no-rodape.md`. With the toggle gone the application header had nothing left to anchor, so the product omits it: Dashboard, Quotes and Settings go from the system header to a page header (16px above it, title at left, `New quote` at right) placed outside the padded content area, so title and content share one left edge; the quote screens carry their own record chrome.

The shell is designed at 1920px: the system header, application header and page header have a 1920px maximum width and the tab container 1888px, so the shell centers rather than stretches on wider screens. Tooltips have a 360px maximum width, read-only fields 366px, and cards and accordions a 324px minimum width. There are no responsive breakpoints; the layout is desktop only.

Tables have three EDS density modes: Standard (16px cell padding, 48px rows), Compact (8px horizontal and 10px vertical padding) and Tiny (4px padding). The frontmatter documents Standard.

## Motion

Motion is sparse. Most state changes are instant, including table row hover, card and panel hover, button and pill hover, and dialog interactions. Several instant transitions carry a dormant 300ms duration in the source; ignore it.

Where a component genuinely animates, it uses ease-out `cubic-bezier(0, 0, 0.58, 1)` unless noted:

- The hover-revealed quick-action icon row inside cards and panel headers fades in over 250ms and out over 200ms.
- Dropdown open and press, and panel expand and collapse, take 150ms.
- Search pill overflow scrolling and title-card hover take 200ms.
- The navigation drawer opens over 300ms with ease-in `cubic-bezier(0.42, 0, 1, 1)` and closes with an overshoot `cubic-bezier(0.45, 1.45, 0.8, 1)`.
- The AI assistant blinks every 700ms, and advances its status messages over 300ms with the same ease-in curve as the drawer.

Under `prefers-reduced-motion: reduce`, all of these collapse to instant changes.

## Elevation & Depth

Page structure is conveyed by the tonal layers, not shadows: system layer over application layer over content layer, with items and inputs as the lightest surface on top in light theme. Borders, not shadows, separate cards, cells, inputs, panels and dialogs at rest.

Shadows are reserved for three explicit meanings:

- **Elevation 1 (temporary)**: `0 2px 4px` in `shadow-elevation-1`. A component displayed over other components temporarily: dropdown and select menus, breadcrumb menus, time and date picker popovers, tooltips and notifications.
- **Elevation 2 (hover or focus)**: `0 4px 8px` in `shadow-elevation-2`. A component lifted and waiting for further mouse interaction (close, select, drag): notifications, draggable cards and the AI floating button on hover. A bottom action bar uses the same shadow inverted upward.
- **Elevation 3 (selected or drag)**: `0 8px 16px` in `shadow-elevation-3`. A component at the highest z position because it is being dragged: draggable cards while dragging.

Dark theme uses the same offsets and blurs with the darker shadow colors. Keyboard focus never raises elevation; it is shown by the focus ring only.

## Shapes

Corners are small and purposeful. Buttons (default, primary and both AI variants) and dropdown triggers use the 3px `control` radius (EDS Radius M). Pills use the 12px `pill` radius on a 24px height (EDS Radius XL). Tags use the 8px `badge` radius (EDS Radius L), small tags 3px, and notification counters are fully round. Text fields, checkboxes, tooltips, menus, cards, table rows, panels and dialogs are square-cornered and rely on their 1px border. The 1px `hairline` radius (EDS Radius S) is used once, on the tab navigation focus ring.

The focus ring is a separate 1px `border-focus` line. On buttons, pills, navigation items, checkboxes and links it is drawn 2px outside the control, following the control's corners: 5px (`control-focus`) around a 3px button, 14px around a pill, square around square controls. On cards it is drawn on the card bounds with no offset. Text fields do not use a ring; their own 1px border switches to `border-focus`.

## Components

- **Buttons** are 32px high, Label 14, with a 16px icon 4px from the label. The default button has no fill and a 1px `border-btn-idle` border; on hover it fills with `fill-btn-default-hover` and the label switches to `text-contrast`, and on press it fills with `fill-btn-default-press`. The primary button is filled `fill-btn-primary-idle` with `text-on-primary` text and no border, darkening on hover and press. The AI primary button fills with the AI gradient and takes a 10% then 20% black overlay for hover and press; the AI default button carries the gradient as its 1px border with `text-main` text and hovers and presses like a default button. Icon-only buttons are 32px square with 8px padding and otherwise follow the default button; they need an `aria-label`, which a tooltip does not replace.
- **Text fields** are 32px high, square-cornered, with 8px padding, `fill-input-idle` fill and a 1px `border-input-idle` border that becomes `border-input-hover` on hover, `border-focus` on focus and `border-input-error` on error. Placeholder text is `text-secondary`. Read-only fields take `fill-input-disabled` with no border. A top label sits 4px above the field in Label 14 and can carry a required marker and a 16px tooltip icon 4px after the text; selects, number fields, text areas and radio groups use the same label. Mark a required field with `required` or `aria-required`, never with the asterisk alone. Validation messages use Label 12, name the problem in text, and are linked to the field with `aria-describedby` while the field sets `aria-invalid`. Number field prefixes and suffixes sit in a `fill-input-prefix` box attached with the -1px overlap. The AI chat field is a 72px, 8px-radius variant using the ordinary field tokens.
- **Checkboxes** are 16px squares: `fill-input-idle` with a 1px `border-input-idle` border unchecked; `fill-input-selected` with a white check or dash (indeterminate) when checked; hover uses `border-input-hover` unchecked and `fill-input-selected-hover` checked. **Radios** are a 12px `fill-input-idle` ring with a 1px `border-input-idle` border, centered in a 16px control box; checked adds a 6px `fill-input-selected` dot and keeps the ring; hover darkens ring and dot.
- **Dropdown triggers** are 36px high with 3px corners, 12px left and 8px right padding, bordered with `border-btn-idle` like a button, and hover and press like a default button. The open menu is a square `fill-item-idle` surface with an Elevation 1 shadow and no border, holding 32px `menu-item` rows with 8px padding. Items hover with `fill-item-hover`; selected items are solid `fill-item-selected` with `text-contrast` (`fill-item-selected-hover` on hover); group headers are 30px Label 12 rows; dividers are 1px `border-item-subtle` lines; nested items indent to 16px left padding; disabled items fade their content row to 40%.
- **Pills** (search criteria, status, tab, legend) are 24px high, fully rounded, 1px `border-item-idle`, 4px by 8px padding. Hover fills with `fill-item-hover`, and a deselected pill returns to `text-main` with `border-item-hover` on hover. A removable pill carries a 16px cross icon after the label and disappears when removed. Status pills carry a 16px alarm icon before the label.
- **Tags** are 24px chips with 8px corners (small: 16px high, 3px corners, 1px vertical padding) whose border, background wash and label follow the status-tag recipe in Colors. The status must also be named in the label or exposed through an icon or `aria-label`; the border and wash alone do not carry meaning.
- **Cards** have 8px padding, a 16px gap between title area, content and actions, and a 1px `border-item-idle` border on a transparent background. Title is Title 16 Medium, body is Paragraph 14. Type 1 cards hover with `border-item-hover` and a `fill-input-idle` fill and select with `border-item-selected`; Type 2 cards hover with `fill-item-hover` and no border. Draggable cards have 16px padding and a `fill-input-idle` fill, take Elevation 2 on hover and Elevation 3 while dragging, and when disabled take `fill-input-disabled` with `border-item-subtle`.
- **Tables** use 48px header and body rows, 16px cell padding, Label 14 cell text, and a 1px `border-cell-idle` line under each row and header cell. Rows are transparent at rest over the content layer and fill with `fill-cell-hover` on hover, `fill-cell-selected` when selected, `fill-cell-striped` for alternating rows, and `fill-input-disabled` when disabled; striping is decorative and never the only row boundary. Selectable rows carry a checkbox or radio cell and expose `aria-selected`; the header row then starts with a 46px checkbox cell holding a 16px checkbox and a 16px more-actions icon. Header cells are Label 14 Medium with a 4px gap, an optional 16px leading icon, and a 16px sort icon and optional 16px tooltip icon after the label. A header can host a per-column filter field; enabling it on one column requires a filter placeholder on every other header cell. Selected rows keep `text-main` for all cell text. Expandable rows add a 32px chevron cell before the content and reveal a second content area indented 32px when open. Row actions sit at the trailing edge and appear only on hover; make them permanent by keeping them visible in the idle state.
- **Side panels** are 356px wide expanded and 80px collapsed, on `layer-content`, with 16px padding, a 16px gap between sections, and a 1px `border-item-idle` border drawn outside the panel box. A browse panel carries its 1px divider on its right edge and uses 12px vertical and 16px horizontal padding. Panel titles use Title 16 Medium.
- **Dialogs** are 572px wide `layer-content` surfaces with a 1px `border-item-idle` border and no shadow or scrim, 24px padding, 24px between header and content, 16px between content sections, and 40px above a right-aligned action row whose buttons sit 8px apart with the default button before the primary.
- **Navigation items** are 240px by 40px Label 14 rows with 12px vertical and 8px horizontal padding on `layer-application`, indenting 12px per level (8px, 20px and 32px left padding for levels one to three). Hover fills `fill-item-hover`; the selected item is solid `fill-item-selected` with `text-on-primary`, and `fill-item-selected-hover` on hover. Navigation and trees share this slot structure but differ in behavior: navigation highlights the selected item, while a **tree** never highlights selection and supports selecting several nodes at once. Tree nodes are unfilled 16px Label 14 rows indenting 16px per level.
- **Tab navigation items** are 80px by 58px and stack a 24px icon over a Label 12 caption with 8px vertical and 4px horizontal padding and a 4px gap. Selected items take `fill-cell-selected` and a 1px `border-item-selected` border drawn inside.
- **Tooltips** are square 8px-padded bubbles in `fill-item-tooltip` with `text-contrast` Label 14 text, an Elevation 1 shadow, and a 6px-deep triangular tail pointing at the trigger. They open on hover and on keyboard focus of the trigger, stay open while the pointer is over them, and close on Escape.
- **Links** are Label 14 in `text-link` with no underline at rest; on hover they gain a 1px underline in the link color. The dash-underline variant is `text-main` with a 1px `text-main` underline that turns `border-item-selected` blue on hover. Inline links inside body text are underlined at rest.
- **Dividers** are 1px lines: `border-item-idle` between regions and around panels, `border-item-subtle` inside menus and cards. Solid and dotted variants both exist; the library does not say when to choose dotted.
- **Scroll bars** are 8px. The track takes the color of the layer it sits on (system, application or content) and the thumb uses `border-item-idle`. They are native browser components, so the rendered result varies by browser.
- **State precedence**: where a `-selected-hover` entry exists, selected plus hover uses it; otherwise selected wins over hover, hover over striped, striped over idle. Disabled suppresses hover and press. The focus ring is drawn on top of any state. Every meaningful visual state is also exposed in the accessibility tree (`aria-selected`, `aria-current`, `aria-checked`, `aria-expanded`, `aria-invalid`, `disabled`).
- **Disabled** buttons, checkboxes, radios, pills and tab items render at 40% opacity and keep their idle border. Text fields and cards instead switch to `fill-input-disabled` with a `border-item-subtle` border at full opacity, except a field's external label, which fades to 40%; table rows switch to `fill-input-disabled`, and menu items fade only their content row. Disabled controls stay in place and in the accessibility tree.

## Do's and Don'ts

- Do use Label 14 (16) Regular for all text unless a rule in Typography names another style.
- Do bind every color to a semantic role token so light and dark theme switch by custom property.
- Do show keyboard focus on `:focus-visible` with `outline: 1px solid var(--border-focus)` and a 2px offset (0 on cards), which forced-colors mode preserves.
- Do pair every status color with text that names the status or with a 16px alarm icon, on tags as well as pills.
- Do keep purple exclusively for focus and the purple status.
- Don't write a hex value or invent a primitive in component code.
- Don't use a shadow to separate resting surfaces, or any shadow outside the three elevations.
- Don't convey a state by color, striping or border alone, and never set `outline: none` without an equivalent indicator.
- Don't use the deprecated Figma components: the old table (`Depricated design/Table`), the retired embedded tooltips (`_🚫Tooltip/Tooltip Embeded🚫` and `_Tooltip/Embeded in icon (Expired)`), or the Material 3 styles and variables left in the library file.
- Don't extend or instance the example components (`Dialog/Simple (Example)`, `Table/🔩 Accessories/Manage columns`); build the same layout from the component instances they are composed of.
- Don't take metrics from the CPQ components (`CPQ/Dialog/Dialog`); they use 40px buttons and 48px fields at 4px radius, which contradict this system.

## Divergências registradas

- **Reflow a 200 % de zoom no produto Document Management (decisão de 2026-11-06, contra `:543`, "There are no responsive breakpoints; the layout is desktop only").** O layout continua desenhado para desktop (1440 e 1920), mas precisa refluir a 200 % de zoom do navegador para cumprir WCAG 2.2 AA 1.4.10. A 1440 com 200 % a janela útil tem 720 px CSS; a simulação da rodada 1 (`docs/research/simulated-round-1.md`, participante P6) mostrou ~124 px para a tabela com o painel aberto e ~190 px para a lista de campos da revisão de extração. Abaixo de 1280 px CSS: a navegação recolhe para 80 px (o estado recolhido que a régua já define), os painéis laterais de 356 px passam a sobrepor o conteúdo em vez de espremê-lo, e a revisão de extração empilha página sobre campos abaixo de 900 px. Não é layout móvel; nenhuma tela ganha versão de celular. Quando o ERAD especificar comportamento de zoom, realinhar.

- **`AgreementTrail` (`app/src/app/components/agreement/AgreementTrail.tsx`, fatia 15, 2026-09-18).** § Components, Side panels (`:406-413`, `:589`) especifica um painel COLAPSÁVEL — 356px expandido / 80px recolhido, `data-collapsed` — para navegação ou inspeção ao lado de conteúdo primário. O trilho de contexto da fase Agreement não colapsa: não tem gatilho, não tem estado recolhido, é leitura fixa ao lado do stepper. Ele toma emprestada só a MEDIDA do side panel (356px, `--width-side-panel`, 16px de padding, borda 1px fora da caixa) e não herda a classe `.erad-panel` nem o `data-collapsed` que ela carrega. Quando o ERAD especificar um painel de leitura não colapsável, realinhar. O trilho `Account and support` da tela da ordem (`OrderScreen.tsx`, fatia 19) toma emprestada a MESMA medida, pelo mesmo motivo. Fatia 23 (2026-09-21) aprofunda a divergência: com o cartão `Order status` acima dele, o par cartão+trilho passa da altura da viewport a 1440×900, e o trilho perde `position: sticky` — um side panel de verdade fica visível ao lado do conteúdo que rola; este agora rola JUNTO com a página. Fatia 24 (2026-09-21) muda a MEDIDA emprestada: o padding do `<aside>` cai de 16px (side panel, `:589`) para `var(--spacing-m)` (8px) — o mesmo dos `Card` ERAD (8px, `:587`) que ficam empilhados na mesma coluna acima dele. Dois blocos com recuos diferentes, um embaixo do outro, liam como desalinhamento; o `AgreementTrail` continua com 16px, porque não tem nenhum `Card` acima com que alinhar. Quando o ERAD especificar um painel de leitura não colapsável, realinhar os dois.
- **Rótulo do dono do risco dentro do motivo (`OrderScreen.tsx`, fatia 19, 2026-09-19).** § Typography não documenta a mistura de dois estilos na mesma caixa de texto: o motivo do risco é um `<p>` Paragraph 14 (21px de altura de linha, leitura), e o rótulo do dono (`Waiting on the customer:` / `Waiting on you:`) vai num `<span>` Label 14 Medium (16px de altura de linha) dentro dele — o peso marca quem precisa agir, sem quebrar a sentença em dois blocos nem depender só de cor. O `innerText` continua uma frase contígua; a leitura de tela não perde nada, porque o `span` não carrega semântica própria. Quando o ERAD especificar como marcar um trecho dentro de um parágrafo de leitura, realinhar.
- **Ícone da categoria `Equipment` (`app/src/app/components/icons/index.tsx:169-180`, `catalog-data.ts:322`, fatia 16).** O § Overview diz que os componentes usam "a biblioteca de ícones EDS". O subset gerado (`eds-icons.ts`, via `demo-analysis/tools/gen_icons.py`) não tem um glifo de equipamento de rede — os candidatos do EDS existem (`radio-base-antenna`, `hardware-platform`, `wifi-modem`) mas não foram incluídos no `WANT` gerado. `Equipment` usa `Router` do `lucide-react` como segunda exceção nomeada, com o mesmo contrato de chamada dos glifos EDS (16px default, decorativo, `aria-hidden`, `currentColor`) — mesmo padrão já registrado para `Sparkles`, logo acima no arquivo de ícones. Troca fica para depois de 30/09: editar `WANT` em `gen_icons.py`, regenerar o subset, trocar o import.
- **Timeline (`app/src/app/components/OrderScreen.tsx`, `order-post-sale.ts`, fatia 20, 2026-09-20; layout refeito fatia 23, 2026-09-21).** § Overview (`:432`) já cita "Accordions and timelines also ship in the library but are not yet specified here" — não há medida, componente nem recipe para uma timeline na ERAD Library 0.1. A timeline (spec `docs/design/2026-09-21-spec-ordem-layout-timeline.md`, substitui a grade `176px 16px 1fr` da fatia 20) é feita só com tokens: grid por linha `16px minmax(0,1fr) auto` (eixo · texto · data), 8px de gap, 32px de altura mínima, data à direita em `text-secondary`, `Today` como rótulo no eixo (não como régua de largura total) e o `<ol>` com `max-width: 800px`. O 800px é um número solto: a régua não tem token de medida de leitura. É a largura natural do conteúdo a 1440 (~770px), arredondada para cima — sem o limite, a 1920 a data ficaria a ~1.100px do título do evento, o mesmo problema de "data longe do evento" (T1) só que invertido. Quando o ERAD especificar uma timeline, realinhar. Fatia 24 (2026-09-21): os 800px viram a custom property local `--order-timeline-measure`, que também define a largura do Card `Timeline` no modo de duas colunas (§ abaixo) — uma fonte só para a medida, em vez de repetir o literal.
- **`Today` ganha um traço no eixo (`OrderScreen.tsx`, fatia 24, 2026-09-21).** A timeline não tem recipe na régua (ver entrada acima). Um `<span data-today-tick>` de 12×2px em `--text-secondary` atravessa o eixo na altura do centro do rótulo `Today`. A largura usa `--spacing-l` (12px) como DIMENSÃO, não como espaçamento entre elementos — não existe token de tamanho de 12px, e o ponto de 8px da timeline (`TimelineDot`) já é, pelo mesmo motivo, um número inline. Quando o ERAD especificar uma timeline, realinhar.
- **Duas colunas na timeline quando há largura e oferta (`OrderScreen.tsx`, `erad-components.css`, fatia 24, 2026-09-21; contra `:543`, "There are no responsive breakpoints").** A 1920, com `Next best offer` presente, o Card `Timeline` (818px = `--order-timeline-measure` + padding + borda) e o Card da oferta (mínimo `--width-card-min`, 324px, a mesma régua de largura mínima de card) ficam lado a lado dentro da coluna principal, via `@container` — não é um breakpoint de PÁGINA, é uma consulta ao tamanho da própria coluna, que já desconta navegação e trilho. Sem oferta, ou com a coluna mais estreita que 1158px (800 + 2×8 + 2×1 + 16 + 324), a timeline volta a ocupar a largura toda e a oferta empilha abaixo dela, como antes desta fatia. Motivo: a 1920 sobravam ~458px vazios dentro do Card da timeline com a oferta empilhada embaixo. Quando o ERAD especificar layout de coluna para cards, realinhar.
- **Datas da timeline em Label 14, não 12 (`OrderScreen.tsx`, fatia 20, 2026-09-20; estendida r27, 2026-09-19; estendida fatia 27, 2026-09-22).** § Typography (`:523`) lista "timeline timestamps" em Label 12 (14) Regular — a apresentação de 30/09 é remota, por streaming, e Label 12 não se lê a essa distância projetada. As datas da timeline usam Label 14, como o resto do cartão; os títulos continuam Label 14 Medium, como a régua já pede (`:524`, "timeline titles"). A rodada r27 (docs/design/2026-09-20-spec-ordem-timeline.md §V3) estendeu a mesma divergência, pelo mesmo motivo, a: o preço da próxima oferta e o rodapé `Suggested by…` no bloco `Next best offer`, a consequência do caso (`1 of 12 sites waits on this case`) e o rótulo `Today`. A fatia 27 (docs/design/2026-09-22-spec-largura-e-calma.md §7.2) acrescenta a frase `At risk since …` do cartão `Order status` — era o último Label 12 que sobrava dentro daquele cartão, e a apresentação continua remota. Quando a apresentação deixar de ser remota, considerar voltar à régua.
- **A faixa de verificações da Solution/Lines vira grade de duas colunas (`QuoteWorkspace.tsx`, `SolutionChecks`, fatia 22, 2026-09-21).** Nenhuma seção deste documento especifica um `role="status"` que precise alinhar mais de uma linha de tag+frase entre si — a região existia como uma única linha `flex` (`ScopeCheckRow`). Com a viabilidade de rede (`Feasibility`) e o escopo (`Scope`) podendo aparecer juntos, a região virou `display: grid` com `grid-template-columns: max-content minmax(0,1fr)` para as duas frases começarem na mesma coluna x — o mesmo problema, em espírito, que o § Layout já resolve para tabelas com `grid-template-columns` em vez de larguras fixas por linha, aplicado aqui a duas linhas de status em vez de células. Com zero ou uma verificação a renderização tem que ficar pixel-idêntica à versão `flex` anterior (medido, não só declarado); a divergência é ter formalizado a grade como o padrão da região mesmo quando só uma linha aparece hoje na maioria das cotações. Quando o ERAD especificar uma região de status com múltiplas linhas alinhadas, realinhar.
- **Ícone de domínio dentro de uma tag `indeterminate`, não um ícone de alarme (`QuoteWorkspace.tsx`, tag `Feasibility`, fatia 22, 2026-09-21).** § Do's and Don'ts (`:605`) pede para "pair every status color with text that names the status or with a 16px alarm icon" — a leitura corrente é que o ícone de uma tag de status é um dos glifos `severity-*` do § Components (`SEVERITY_ICON`, um por tom). A tag `Feasibility` é tom `indeterminate` (cinza, sem alarme nenhum: a viabilidade não é um problema, é uma leitura de rede) e carrega `Globe` — o glifo EDS `network`, já usado como ícone de CATEGORIA em `catalog-data.ts` (`CATEGORY_META`), não como ícone de severidade — porque o rótulo `Feasibility` já nomeia o domínio, e o que falta comunicar é QUE DOMÍNIO a tag pertence (rede), não QUANTO GRAVE ela é. `Scope`, na mesma faixa, continua com o ícone de alarme (`AlertCircle`/`warning-circle`) porque aquele É um achado que pede atenção. Quando o ERAD especificar um ícone de domínio (em vez de severidade) dentro de uma tag, realinhar. Fatia 25 (2026-09-21) dá à `Feasibility` um segundo estado, aprovado: essa tag troca para `tone="cleared"` com `icon={<CheckCircle />}` — o mesmo par tom+ícone já usado em `Done`/`Step complete` nesta mesma tela (`QuoteWorkspace.tsx:2462`, `:3143`), não um caso novo. A divergência acima (ícone de domínio em vez de severidade) continua valendo só para o estado de aviso, que manteve `Globe`/`indeterminate` sem mudança.
- **Uma medida de coluna para a cotação — `--quote-measure`, 620px, PISO só para a lista de soluções, EXATO para o resto (`QuoteWorkspace.tsx`, `erad-components.css`, fatia 27, 2026-09-22; valor revisto fatia 28; largura fluida fatia 28b; desenho final fatia 28c, todas 2026-09-23).** § Layout (`:543`) dá medidas para tooltip (360px), campo somente-leitura (366px) e mínimo de card (324px), e nenhuma para uma coluna de leitura. Mesma lacuna que a fatia 24 já registrou com `--order-timeline-measure` (entrada acima, `:619`). A fatia 27 nomeou a medida (`--quote-measure`) em 680px — a largura que `ReviewView` já usava desde a fatia 15 — e a aplicou também à decisão (era 620, `CustomerDecisionView`) e ao stepper do agreement (era 660, `AgreementView`). A fatia 28 baixou o valor para 620px: medido por Playwright, o nó rolável (`.erad-quote-scroll`) tem 1288px a 1536×864 — o notebook real da Tatiana a 125% — e 680px não cabe duas vezes aí (precisaria de 1376). 620px cabe (precisa de 1256) sem deixar de excluir 1440×900 (1192px de contêiner). A fatia 28b, no mesmo dia, corrigiu um efeito colateral visto ao vivo: com 620 FIXO nas duas colunas do `Quote review`, sobravam ~415px vazios à direita a 1920 — as duas colunas (`repeat(2, minmax(var(--quote-measure), 1fr))`) e o cartão de `Awaiting customer decision` passaram a FLUIDOS e IGUAIS entre si (812px cada a 1920, medido). A fatia 28c, ainda no mesmo dia e medida na tela com ela, revisou de novo: colunas iguais deixavam o cartão `Quote pricing` (620 de conteúdo, teto próprio) com 812 de BORDA — vazio dentro do próprio cartão. Desenho final: `grid-template-columns: var(--quote-measure) minmax(var(--quote-measure), 1fr)` — a coluna ESQUERDA (verificações, estado, `Quote pricing`) fica EXATA em 620, sem crescer; só a LISTA de soluções (direita) absorve o que sobra do contêiner (1004px a 1920, medido). Com a coluna da esquerda de volta a 620, o teto interno que a 28b tinha dado ao `QuotePricingBlock` saiu de novo (não faz falta: a coluna que o contém já é a medida certa). Pela mesma razão, `.erad-decision-card` (que usava uma conta em `cqw` para simular a divisão de duas colunas iguais) voltou a `grid-template-columns: var(--quote-measure) var(--width-side-panel)`, literal — sem a correção, a trilha ficava em 812 (a metade do contêiner) enquanto a coluna do Review já tinha voltado a 620, reabrindo o mesmo vão de ~544px entre rótulo e valor, agora nessa tela (achado nesta rodada, não relatado por ela). `.erad-decision-card` mantém `width: fit-content` (fatia 28b) para o cartão não esticar além do conteúdo. Quando o ERAD especificar uma medida de leitura, realinhar `--order-timeline-measure` e `--quote-measure` juntos.
- **Um segundo limiar de container query, agora na cotação (`erad-components.css`, fatia 27, 2026-09-22; limiar revisto fatia 28, 2026-09-23; contra `:543`, "There are no responsive breakpoints").** 1256px = 2 × `--quote-measure` + `--spacing-xl`, consultado sobre a largura do nó rolável da cotação (`.erad-quote-scroll`), nunca sobre a viewport — mesmo mecanismo da divergência acima de `.erad-order-main` (fatia 24, `:621`). Literal porque `var()` não resolve em condição de container query. A fatia 27 fixou 1376px (2×680+16) contando com ~1656px de janela para a virada; medido de verdade, o contêiner a 1920 tem 1672px, a 1536 tem 1288px e a 1440 tem 1192px — a fatia 27 estimou a olho, ~32px otimista. Com 1376 o notebook real da Tatiana (1536×864, Windows a 125%) nunca via duas colunas fora do palco a 1920. O novo limiar, 1256, deixa 1536 entrar (1288 ≥ 1256) e mantém 1440 fora (1192 < 1256). Quando o ERAD especificar layout de coluna, realinhar as duas.
- **Gap de coluna de página: 16px em toda a jornada da cotação (`QuoteWorkspace.tsx`, fatia 27, 2026-09-22; estende a divergência de `.erad-order-lead`, `:621`).** O agreement usava 24px (`gap: 'var(--spacing-xxl)'` no `flex` antigo). § Layout (`:535`) reserva 24px para ações de page header e para a distância entre cabeçalho e conteúdo de diálogo, e 16px "between sections inside a card, panel or dialog"; não há regra para colunas de PÁGINA. A tela da ordem já usa 16px entre a coluna principal e o trilho; as três telas da cotação (Review, Awaiting customer decision, Complete agreement) passam a usar o mesmo 16px entre suas duas colunas. Quando o ERAD especificar um gap de coluna de página, realinhar.
- **Uma linha de `Order details` pode sair da tela por ser referência interna, não só por repetição (`OrderScreen.tsx`, fatia 27 §8, 2026-09-22; estende o mecanismo `screenHidden`/`erad-print-only` da fatia 24, `:24` acima não numerada — ver § "O que está resolvido" da spec).** Até a fatia 24, uma linha só saía da tela por repetir um fato já visível em outro bloco da MESMA tela (`screenHidden: boolean`). A fatia 27 dá um segundo motivo: `Credit approval` e `Contract envelope` não repetem nada — são referência interna (papelada de crédito e jurídico) que nunca se lê numa tela, só no pacote impresso e na confirmação do passo 5 do agreement. `screenHidden` vira `'repeated' | 'reference'`, gravado no DOM via `data-print-reason` no `dt`, e o gate (`order_pack_check.py`) exige provas OPOSTAS de cada um: `repeated` precisa do fato visível em algum lugar da tela; `reference` precisa do CONTRÁRIO — ausente de toda tela, presente só no pacote. Não há entrada na régua para "por que uma linha de detalhe está oculta"; quando o ERAD especificar isso, realinhar.
