// Two inline-SVG visuals: a magnitude bar for table cells, and a single-series
// line chart with a tooltip. Colours come from the stylesheet's tokens.

import { h, replace } from "./dom.js";

/** A thin horizontal bar, `fraction` (0..1) of the cell wide. Decorative: the
 *  number it stands for is always printed beside it. */
export function bar(fraction) {
  const width = Math.max(0, Math.min(1, fraction || 0)) * 100;
  return h("svg.bar-svg", { viewBox: "0 0 100 6", preserveAspectRatio: "none", "aria-hidden": "true" },
    h("rect.track", { x: 0, y: 2, width: 100, height: 2 }),
    h("rect.fill", { x: 0, y: 0, width, height: 6, rx: 2 }),
  );
}

/** A round number at or above `max` that divides into `steps` tidy ticks.
 *  Ticks are whole numbers (scores are), so no two labels read the same. */
function ceiling(max, steps) {
  const rough = Math.max(max / steps, 1);
  const pow = 10 ** Math.floor(Math.log10(rough));
  const unit = [1, 2, 2.5, 5, 10].find((m) => m * pow >= rough && Number.isInteger(m * pow)) * pow;
  return unit * steps;
}

/** points: [{value, label, lines: [string]}], oldest first, evenly spaced.
 *  `lines` is the tooltip text. Redraws itself to the width it is given. */
export function lineChart(points, { caption, height = 200 }) {
  const svgHost = h("div");
  const tip = h("div.chart-tip", { hidden: true, role: "status" });
  const el = h("figure.chart", svgHost, tip, h("figcaption.sr", caption));
  const pad = { top: 12, right: 14, bottom: 26, left: 44 };
  const TICKS = 4;
  const top = ceiling(Math.max(...points.map((p) => p.value)), TICKS);
  let xs = [];
  let ys = [];
  let active = -1;

  function show(i) {
    if (i === active) return;
    active = i;
    svgHost.querySelectorAll(".pt").forEach((c, j) => c.classList.toggle("on", j === i));
    const guide = svgHost.querySelector(".guide");
    tip.hidden = i < 0;
    guide?.setAttribute("visibility", i < 0 ? "hidden" : "visible");
    if (i < 0) return;
    guide?.setAttribute("x1", xs[i]);
    guide?.setAttribute("x2", xs[i]);
    replace(tip, points[i].lines.map((line, n) => h(n ? "div.muted" : "div", line)));
    // Keep the tooltip inside the figure: flip to the left of the point past halfway.
    const right = xs[i] > el.clientWidth / 2;
    tip.style.left = right ? "" : `${xs[i] + 10}px`;
    tip.style.right = right ? `${el.clientWidth - xs[i] + 10}px` : "";
    tip.style.top = `${Math.max(0, ys[i] - 14)}px`;
  }

  function draw() {
    const width = Math.max(240, el.clientWidth);
    const innerW = width - pad.left - pad.right;
    const innerH = height - pad.top - pad.bottom;
    const step = points.length > 1 ? innerW / (points.length - 1) : 0;
    xs = points.map((_, i) => pad.left + (points.length > 1 ? i * step : innerW / 2));
    ys = points.map((p) => pad.top + innerH * (1 - p.value / top));
    const base = pad.top + innerH;

    const grid = Array.from({ length: TICKS + 1 }, (_, i) => {
      const y = pad.top + (innerH * i) / TICKS;
      return [
        h(i === TICKS ? "line.axis" : "line.grid", { x1: pad.left, x2: width - pad.right, y1: y, y2: y }),
        h("text.tick", { x: pad.left - 8, y: y + 4, "text-anchor": "end" }, Math.round(top * (1 - i / TICKS))),
      ];
    });
    const ends = points.length > 1
      ? [h("text.tick", { x: xs[0], y: height - 6, "text-anchor": "start" }, points[0].label),
         h("text.tick", { x: xs.at(-1), y: height - 6, "text-anchor": "end" }, points.at(-1).label)]
      : [h("text.tick", { x: xs[0], y: height - 6, "text-anchor": "middle" }, points[0].label)];

    const svg = h("svg", { width, height, viewBox: `0 0 ${width} ${height}`, role: "img", "aria-label": caption },
      grid,
      ends,
      h("line.guide", { y1: pad.top, y2: base, visibility: "hidden" }),
      h("polyline.series", { points: xs.map((x, i) => `${x},${ys[i]}`).join(" ") }),
      points.map((p, i) => h("g", { tabindex: 0, role: "img", "aria-label": p.lines.join(", "), onfocus: () => show(i), onblur: () => show(-1) },
        h("circle.pt", { cx: xs[i], cy: ys[i], r: 4 }),
      )),
    );

    // The nearest point to the pointer, anywhere over the plot.
    svg.addEventListener("pointermove", (event) => {
      const x = event.clientX - svg.getBoundingClientRect().left;
      let best = 0;
      xs.forEach((px, i) => { if (Math.abs(px - x) < Math.abs(xs[best] - x)) best = i; });
      show(best);
    });
    svg.addEventListener("pointerleave", () => show(-1));

    active = -1;
    tip.hidden = true;
    replace(svgHost, svg);
  }

  new ResizeObserver(draw).observe(el);
  return el;
}
