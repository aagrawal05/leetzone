// The few animations that need script: rows sliding to a new rank, numbers
// counting up, and a ticker. Everything here is a no-op under
// prefers-reduced-motion (the stylesheet handles the CSS side).

const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
export const still = () => reduced.matches;

/** FLIP: measure the elements, let `mutate` reorder them, then animate each
 *  from where it was to where it now is. */
export function flip(elements, mutate) {
  if (still()) return mutate();
  const before = new Map();
  for (const el of elements()) before.set(el, el.getBoundingClientRect().top);
  mutate();
  for (const el of elements()) {
    const was = before.get(el);
    if (was === undefined) continue;
    const dy = was - el.getBoundingClientRect().top;
    if (Math.abs(dy) < 1) continue;
    el.animate(
      [{ transform: `translateY(${dy}px)` }, { transform: "none" }],
      { duration: 240, easing: "ease-out" },
    );
  }
}

/** Show `to` in `el`, counting from the number it showed before. */
export function countUp(el, to, format = String) {
  const from = Number(el.dataset.value ?? to);
  el.dataset.value = to;
  cancelAnimationFrame(Number(el.dataset.raf));
  if (from === to || still()) { el.textContent = format(to); return; }
  const start = performance.now();
  const duration = 600;
  const step = (t) => {
    const k = Math.min(1, (t - start) / duration);
    const eased = 1 - (1 - k) ** 3;
    el.textContent = format(Math.round(from + (to - from) * eased));
    if (k < 1) el.dataset.raf = requestAnimationFrame(step);
  };
  el.dataset.raf = requestAnimationFrame(step);
}

/** Restart a one-shot CSS animation class on an element. */
export function pulse(el, cls) {
  el.classList.remove(cls);
  void el.offsetWidth;
  el.classList.add(cls);
}

/** Call `fn` on every animation frame until the returned function is called.
 *  Frames stop while the tab is hidden, which is what a clock wants. */
export function ticker(fn) {
  let raf = requestAnimationFrame(function frame() {
    fn();
    raf = requestAnimationFrame(frame);
  });
  return () => cancelAnimationFrame(raf);
}
