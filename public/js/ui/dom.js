// Element builder. Strings only ever become text nodes or attribute values, so
// nothing a player or the server sends can turn into markup.

const SVG_NS = "http://www.w3.org/2000/svg";
const SVG_TAGS = new Set(["svg", "g", "path", "line", "circle", "rect", "text", "polyline", "title"]);

/** h("button.primary", {type: "button", onclick}, "start") */
export function h(spec, props, ...children) {
  const [tag, ...classes] = spec.split(".");
  const el = SVG_TAGS.has(tag) ? document.createElementNS(SVG_NS, tag) : document.createElement(tag);
  if (classes.length) el.setAttribute("class", classes.join(" "));
  if (props != null && (typeof props !== "object" || props instanceof Node || Array.isArray(props))) {
    children.unshift(props);
  } else if (props) {
    set(el, props);
  }
  append(el, children);
  return el;
}

/** Apply props to an existing element: on* are listeners, `class` adds to the
 *  spec's classes, false/null removes an attribute, true sets it bare. */
export function set(el, props) {
  for (const [key, value] of Object.entries(props)) {
    if (key.startsWith("on")) el.addEventListener(key.slice(2), value);
    else if (key === "class") { if (value) el.classList.add(...String(value).split(" ").filter(Boolean)); }
    else if (key === "text") el.textContent = value;
    else if (key === "dataset") Object.assign(el.dataset, value);
    else if (value === false || value == null) el.removeAttribute(key);
    else el.setAttribute(key, value === true ? "" : String(value));
  }
  return el;
}

function append(el, children) {
  for (const child of children.flat(Infinity)) {
    if (child == null || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
}

export function replace(el, ...children) {
  el.replaceChildren();
  append(el, children);
  return el;
}

/** Write text only when it changed, so unchanged nodes are not touched (keeps
 *  selections, avoids restarting CSS animations on siblings). */
export function text(el, value) {
  const s = String(value);
  if (el.textContent !== s) el.textContent = s;
  return el;
}

/** Reconcile `parent`'s children with `items` by key, reusing elements.
 *  `create(item)` builds a new element; `update(el, item, index)` refreshes it.
 *  Returns the elements in order. */
export function keyed(parent, items, keyOf, create, update) {
  const old = new Map();
  for (const el of parent.children) old.set(el.dataset.key, el);
  const out = [];
  let cursor = parent.firstElementChild;
  items.forEach((item, i) => {
    const key = String(keyOf(item));
    let el = old.get(key);
    if (el) old.delete(key);
    else { el = create(item); el.dataset.key = key; el.dataset.fresh = "1"; }
    update?.(el, item, i);
    if (el === cursor) cursor = cursor.nextElementSibling;
    else parent.insertBefore(el, cursor);
    out.push(el);
  });
  for (const el of old.values()) el.remove();
  return out;
}
