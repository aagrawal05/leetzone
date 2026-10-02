// Isolated world, leetcode.com. The HUD's stylesheet, adopted into its closed
// shadow root so neither side's CSS reaches the other. Tokens match the site.
"use strict";

var HUD_CSS = `
:host {
  all: initial;
  --bg: #ffffff; --fg: #1a1a1a; --muted: #6b6b6b; --line: #e4e4e0; --surface: #f6f6f3;
  --accent: #c2410c; --easy: #0f766e; --medium: #b45309; --hard: #b91c1c; --good: #15803d;
  --shadow: 0 6px 24px rgba(0, 0, 0, 0.14);
}
@media (prefers-color-scheme: dark) {
  :host {
    --bg: #0e0e10; --fg: #e8e6e3; --muted: #8f8f8f; --line: #2a2a2e; --surface: #17171a;
    --accent: #fb923c; --easy: #2dd4bf; --medium: #fbbf24; --hard: #f87171; --good: #4ade80;
    --shadow: 0 6px 24px rgba(0, 0, 0, 0.5);
  }
}
* { box-sizing: border-box; margin: 0; padding: 0; }
[hidden] { display: none !important; }

.panel {
  position: fixed; top: 0; left: 0; width: 264px; pointer-events: auto;
  font: 12.5px/1.6 ui-monospace, Menlo, Monaco, "Cascadia Mono", "Segoe UI Mono", "Liberation Mono", monospace;
  color: var(--fg); background: var(--bg);
  border: 1px solid var(--line); border-radius: 6px; box-shadow: var(--shadow);
  overflow: hidden;
  /* Never taller than the viewport: the body scrolls instead. */
  display: flex; flex-direction: column; max-height: 100vh;
}
.panel.collapsed { width: auto; }
.panel.collapsed .body { display: none; }

.bar {
  display: flex; align-items: center; gap: 8px; padding: 5px 6px 5px 10px;
  background: var(--surface); border-bottom: 1px solid var(--line);
  cursor: grab; user-select: none; touch-action: none; white-space: nowrap;
}
.bar:active { cursor: grabbing; }
.panel.collapsed .bar { border-bottom: 0; }
.mark { color: var(--accent); font-weight: 700; }
.code { color: var(--muted); }
.mini { font-variant-numeric: tabular-nums; }
.panel:not(.collapsed) .mini { display: none; }
.grow { flex: 1; }
.dot { width: 6px; height: 6px; border-radius: 50%; background: var(--muted); }
.toggle {
  font: inherit; color: var(--muted); background: none; border: 0; border-radius: 4px;
  width: 22px; height: 22px; line-height: 1; cursor: pointer;
  transition: color 120ms ease-out, background-color 120ms ease-out;
}
.toggle:hover { color: var(--fg); background: var(--line); }
.toggle:focus-visible, a:focus-visible { outline: 1px solid var(--accent); outline-offset: 1px; }

.body { padding: 10px; display: grid; gap: 8px; overflow-y: auto; }
.head { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
.clock { font-size: 22px; line-height: 1.2; font-weight: 600; font-variant-numeric: tabular-nums; letter-spacing: -0.02em; }
.panel[data-phase="countdown"] .head { flex-direction: column; align-items: center; gap: 0; padding: 6px 0; }
.panel[data-phase="countdown"] .clock { font-size: 44px; color: var(--accent); }
.clock.tick { animation: pop 240ms ease-out; }
.sub { color: var(--muted); }

.drain { height: 3px; border-radius: 2px; background: var(--line); overflow: hidden; }
.fill {
  height: 100%; width: 100%; background: var(--accent); transform-origin: left center;
  transition: transform 260ms linear, background-color 240ms ease-out;
}
.urgent .clock { color: var(--hard); }
.urgent .fill { background: var(--hard); animation: pulse 1s ease-in-out infinite; }

a { color: inherit; text-decoration: none; }
.nudge {
  display: block; padding: 6px 8px; border: 1px solid var(--accent); border-radius: 6px;
  color: var(--accent); transition: background-color 120ms ease-out;
}
.nudge:hover { background: var(--surface); }
.note { color: var(--muted); }

.questions { list-style: none; display: grid; gap: 4px; }
.q {
  display: grid; grid-template-columns: auto 1fr auto; column-gap: 8px; align-items: baseline;
  padding: 5px 8px; border: 1px solid var(--line); border-radius: 6px;
  transition: border-color 120ms ease-out, background-color 120ms ease-out;
  animation: rise 240ms ease-out;
}
.q:hover { background: var(--surface); }
.q.here { border-color: var(--fg); }
.q .label { color: var(--muted); }
.q .title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.q .status { grid-column: 2 / 4; color: var(--muted); font-size: 11.5px; }
.q.solved .status { color: var(--good); }
.Easy { color: var(--easy); }
.Medium { color: var(--medium); }
.Hard { color: var(--hard); }

.me { display: flex; justify-content: space-between; gap: 8px; padding-top: 8px; border-top: 1px solid var(--line); }
.me .rank { font-weight: 600; }
.board { list-style: none; font-size: 11.5px; font-variant-numeric: tabular-nums; }
.row { display: grid; grid-template-columns: 2.5ch 1fr auto; column-gap: 8px; color: var(--muted); }
.row .name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.row.self { color: var(--fg); }
.row.self .name::after { content: " (you)"; color: var(--muted); }
.row.left .name { text-decoration: line-through; }
.row.gap { margin-top: 3px; padding-top: 3px; border-top: 1px dashed var(--line); }

.final { font-size: 16px; font-weight: 600; }
.site { color: var(--accent); }
.site:hover, .q:hover .title { text-decoration: underline; }

.flash {
  padding: 5px 8px; border-radius: 6px; border: 1px solid currentColor;
  animation: flash 240ms ease-out;
  position: sticky; bottom: 0; background: var(--bg); /* in view even when the body scrolls */
}
.flash.good { color: var(--good); }
.flash.bad { color: var(--hard); }
.flash.quiet { color: var(--muted); }
.offline { color: var(--muted); font-size: 11.5px; }

@keyframes pop { from { transform: scale(1.18); opacity: 0.5; } to { transform: none; opacity: 1; } }
@keyframes rise { from { transform: translateY(4px); opacity: 0; } to { transform: none; opacity: 1; } }
@keyframes flash { from { transform: scale(0.97); opacity: 0; } to { transform: none; opacity: 1; } }
@keyframes pulse { 50% { opacity: 0.45; } }
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation: none !important; transition: none !important; }
}
`;
