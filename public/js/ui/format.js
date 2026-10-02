// Formatting, and the one toast.

import { h } from "./dom.js";

/** 754000 -> "12:34". Rounds up, so a clock reads 0:01 until it is really over. */
export function clock(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}

/** An elapsed time, rounded down: "4:07". */
export function elapsed(ms) {
  if (ms == null) return "–";
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export const pct = (x) => `${Math.round((x ?? 0) * 100)}%`;
export const num = (x) => Math.round(x ?? 0).toLocaleString("en-US");
export const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

const DATE = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" });
const DATETIME = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
export const date = (ms) => DATE.format(ms);
export const dateTime = (ms) => DATETIME.format(ms);

export const ordinal = (n) => {
  const tail = n % 100;
  if (tail >= 11 && tail <= 13) return `${n}th`;
  return `${n}${["th", "st", "nd", "rd"][n % 10] ?? "th"}`;
};

/** "dynamic-programming" -> "dynamic programming", for topics /api/meta did not name. */
export const unslug = (slug) => slug.replaceAll("-", " ");

/** Minutes for people, seconds for the server. */
export const minutes = (sec) => Math.round(sec / 60);

/** A brief message in the corner; announced by the aria-live region. */
export function toast(message, kind = "") {
  const host = document.getElementById("toasts");
  const el = h("div.toast", { class: kind }, message);
  host.append(el);
  while (host.children.length > 3) host.firstElementChild.remove();
  setTimeout(() => {
    el.classList.add("leaving");
    setTimeout(() => el.remove(), 250);
  }, 3800);
}

export async function copy(value, done = "copied") {
  try {
    await navigator.clipboard.writeText(value);
    toast(done);
  } catch {
    // No clipboard permission: show it so it can be copied by hand.
    window.prompt("Copy this:", value);
  }
}
