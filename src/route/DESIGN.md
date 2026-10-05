---
name: "Route Recovery"
description: "Light floor instrument and graphite mission console for a local grid simulation"
colors:
  primary: "#b6441b"
  primary-hover: "#8f3212"
  paper: "#f1f3f2"
  surface: "#fffefa"
  ink: "#253338"
  muted: "#59666a"
  line: "#d6dbd6"
  focus: "#2e6880"
  console: "#26383d"
  console-text: "#fcfcf7"
  console-rule: "#506366"
  floor: "#f3f4ef"
  wall: "#45575d"
  wall-inset: "#50646a"
  obstacle: "#f0c4ad"
  restricted: "#ece4c6"
  restricted-stripe: "#ddd3aa"
  goal-stroke: "#376679"
  goal-text: "#2c596b"
  goal-fill: "#eaf0ee"
  complete-text: "#c5e8cb"
  complete-fill: "#284c3d"
  blocked-text: "#ffcaaf"
  blocked-fill: "#493c35"
  white: "#ffffff"
typography:
  title:
    fontFamily: "Manrope, -apple-system, BlinkMacSystemFont, \"Segoe UI\", sans-serif"
    fontSize: "1.5rem"
    fontWeight: 750
    lineHeight: 1.2
    letterSpacing: "-.035em"
  mission-headline:
    fontFamily: "Manrope, -apple-system, BlinkMacSystemFont, \"Segoe UI\", sans-serif"
    fontSize: "1.75rem"
    fontWeight: 750
    lineHeight: 1.18
    letterSpacing: "-.03em"
  body:
    fontFamily: "Manrope, -apple-system, BlinkMacSystemFont, \"Segoe UI\", sans-serif"
    fontSize: ".875rem"
    lineHeight: 1.5
  label:
    fontFamily: "Manrope, -apple-system, BlinkMacSystemFont, \"Segoe UI\", sans-serif"
    fontSize: ".75rem"
  metric:
    fontFamily: "Manrope, -apple-system, BlinkMacSystemFont, \"Segoe UI\", sans-serif"
    fontSize: "1.75rem"
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: "-.03em"
rounded:
  instrument: "12px"
  control: "7px"
  choice: "6px"
  status: "4px"
  robot: "8px"
  circle: "50%"
  cell: "0px"
spacing:
  desktop-gutter: "48px"
  tablet-gutter: "28px"
  mobile-gutter: "16px"
  workspace-gap: "24px"
  console-padding: "24px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.white}"
    rounded: "{rounded.control}"
    padding: "11px 17px"
    height: "44px"
  button-primary-hover:
    backgroundColor: "{colors.primary-hover}"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "11px 17px"
    height: "44px"
  button-quiet:
    backgroundColor: "transparent"
    textColor: "{colors.muted}"
    rounded: "{rounded.control}"
    padding: "11px 17px"
    height: "44px"
  scenario-select:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "8px 32px 8px 12px"
    height: "46px"
    width: "305px"
  edit-choice-selected:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.white}"
    rounded: "{rounded.choice}"
    padding: "11px 13px"
    height: "44px"
  floor-panel:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.instrument}"
  mission-console:
    backgroundColor: "{colors.console}"
    textColor: "{colors.console-text}"
    rounded: "{rounded.instrument}"
    padding: "{spacing.console-padding}"
  status-blocked:
    backgroundColor: "{colors.blocked-fill}"
    textColor: "{colors.blocked-text}"
    rounded: "{rounded.status}"
    padding: "4px 8px"
  status-complete:
    backgroundColor: "{colors.complete-fill}"
    textColor: "{colors.complete-text}"
    rounded: "{rounded.status}"
    padding: "4px 8px"
---

# Design System: Route Recovery

## Overview

**Creative North Star: "The mission instrument"**

The current operating surface uses a light editable floor alongside a separate graphite mission console. Burnt-orange movement and slate-blue goal details make the route readable without turning the map into decoration. This record replaces the former warm-paper/system-font description; the root DESIGN.md now describes the whole portfolio.

The desk-served landing in `src/desk/public/route-landing.css` uses the same instrument vocabulary with a bounded local simulation. PRODUCT.md retains the limits of that simulation and optional sponsor actions.

**Key Characteristics:**

- An actual nine-by-seven floor with coordinate rulers and visible constraints.
- A graphite mission console containing state, counts, intervention, and event history.
- Self-hosted Manrope, native controls, explicit labels, and compact map measurements.

## Colors

### Primary

Burnt orange belongs to delivery actions and the dotted permitted route. The darker companion supplies primary hover. Slate blue distinguishes keyboard focus and the circular goal without competing with movement.

### Secondary

Complete and blocked states receive separate text, fill, and border treatments inside the dark console. The goal, wall, obstruction, and restricted region each have their own visual mark as well as color.

### Neutral

Neutral gray paper surrounds a near-white enclosure and a pale map. Graphite carries the console; its light text and muted rules remain separate from the page's dark-on-light ink. Use the token names in frontmatter to preserve that contrast.

**The State Label Rule.** Every map or mission category uses a label, shape, symbol, or pattern alongside color.

## Typography

Manrope is served from the shared local WOFF2 with system fallbacks; font size and licensing are recorded in root DESIGN.md. The current app uses 14px body copy and principal controls, 12px coordinates and compact state labels, and a stronger mission headline. Counts use tabular numerals. The app title reduces to 1.1875rem at 600px. The landing has its own larger display role in root DESIGN.md.

## Layout

The shell has a 1480px maximum and 48px desktop gutters, expanding gutters to 56px from 1600px. The floor shares a two-column workspace with a 320px console and a 24px gap. At 1080px, gutters become 28px, the console narrows to 280px, and the gap becomes 20px. The coordinate-framed floor has a 730px maximum width and retains its nine-by-seven aspect ratio.

At 800px, the floor and console stack; the console internally uses two columns. At 600px, gutters become 16px, the scenario selector fills the available width, transport controls use a three-column grid, and the console returns to one column. A compact mission-state line appears by the mobile controls. The optional recovery and cloud sections follow the primary workspace. Their field grids reflow at 800px, 600px, and 500px as defined in CSS.

The landing's map is capped at 500px, right-aligned beside the heading at desktop and left-aligned after stacking at 800px. Its controls act on the local simulation. The supplied review captures under `.impeccable/review/redesign/` record the assembled surfaces; this document adds no separate deployment claim.

**The Floor First Rule.** Let controls and the console reflow before changing the map's cell proportions or burying the current mission state.

## Elevation & Depth

The floor and console use solid fill and a border rather than floating panel shadows. Walls have an inset tonal stroke. The robot has one small shadow (`0 3px 6px #25333824`) so its location stays legible. Hovering a cell adds an inset outline. Depth serves map interpretation.

## Shapes

Instrument enclosures have rounded corners, but map cells remain square. The robot is a rounded rectangle and the goal is circular; these shapes remain distinguishable on a monochrome view. Selected edit choices use an ink fill. The restricted-cell diagonal pattern is functional map notation, so decorative-gradient restrictions do not prohibit it.

## Components

### Buttons and navigation

Primary, outlined secondary, and quiet buttons share the local control shape and minimum height. Hover changes background or border over 150ms; active buttons receive an ink border. Disabled buttons use 0.48 opacity and an unavailable cursor. Keyboard focus uses a visible 3px slate-blue outline with a 3px offset. Transport icons are CSS geometry with semantic button text. Desk-mounted overview links use a 44px target and change to orange on hover; they are hidden when the standalone server cannot serve those routes.

### Fields and floor tools

The native scenario selector is 305px wide on desktop, 275px at 800px, and full-width at 600px. Recovery fields use the same softened control shape. Edit-mode radio choices retain native checked, disabled, and focused states; focus transfers to the visible choice outline. Scope and model consent controls retain explicit labels.

### Editable floor

Grid cells are real buttons. Robot, goal, obstacle, wall, and restriction marks are composed in HTML/CSS; the dotted SVG route does not intercept input. The dashed orange plan and solid slate executed trace remain separate, with current, next, and goal coordinates above the map. The executed trace comes from recorded move events. Arrow keys move focus between cells. Edits update simulation state; protected cells reject invalid changes. The map is not a prerecorded success animation.

### Mission console

Written mission state accompanies the colored chip. Metrics and newest-first event rows use fine slate rules. Completion follows actual arrival, and a no-route state holds the robot. The local recovery suggestion, optional model decision, and optional cloud-job record remain separate evidence sources. An execution or evidence error stops the run and makes the reset requirement visible.

### Motion

The same robot element persists across renders. Its visual move runs only when the simulation records exactly one adjacent move in the same scenario (280ms in the app, 260ms on the landing). The DOM location and coordinate are current first. Rapid stepping cancels the previous transform at its recorded cell before starting the next move, so interpolation cannot cut diagonally across a wall. Pause, blockage, failure, reset, scenario change, and page hiding stop robot motion; the landing simulation also pauses in the background.

Changed cells and revised permitted plans receive a bounded emphasis (380ms). State labels fade briefly (200ms in the app, 180ms on the landing), while feedback and new app event rows receive a color emphasis (360ms). Every effect runs once with no retained fill; repeated changes replace the prior effect. Reduced-motion changes, page hiding, and page exit cancel active effects, while current labels, coordinates, and both traces remain visible. Reduced-motion styles also disable CSS transitions and smooth scrolling. The map has no decorative travel loop.

## Do's and Don'ts

### Do:

- **Do** preserve map proportions, coordinate labels, native keyboard operation, and visible focus.
- **Do** keep the graphite console separate from the editable floor.
- **Do** make the blocked, paused, and complete states explicit in text near the working map.
- **Do** keep the local-simulation boundary visible on the landing and in the app.

### Don't:

- **Don't** return the app to the superseded warm rust-paper/system-font styling.
- **Don't** flatten the robot and goal into identical markers or remove restriction patterns.
- **Don't** imply model inference, physical robot behavior, or validated safety from a local grid result.
- **Don't** use a prerecorded route animation in place of state-driven movement.
