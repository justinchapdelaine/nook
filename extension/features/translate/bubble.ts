// The selection bubble: a small panel under the selected text that shows
// the translation as it streams in. It lives in a closed shadow root, so the
// page's styles can't reach it and page scripts can't read it, and in the
// top layer (a popover), so it sits above the page whatever its z-indexes.
// All text goes in through textContent: model output is never parsed as HTML.

const STYLE = `
.bubble {
  color-scheme: light dark;
  position: absolute;
  inset: auto;
  margin: 0;
  box-sizing: border-box;
  inline-size: max-content;
  max-inline-size: min(28rem, calc(100vw - 16px));
  max-block-size: 50vh;
  overflow: auto;
  padding: 10px 12px;
  border: 1px solid light-dark(#d0d4da, #44474e);
  border-radius: 10px;
  background: light-dark(#ffffff, #1f2024);
  color: light-dark(#1b1c1f, #e3e3e8);
  box-shadow: 0 4px 16px rgb(0 0 0 / 0.2);
  font: 15px/1.5 system-ui, sans-serif;
  text-align: start;
  opacity: 0;
  transition-property: opacity, display, overlay;
  transition-duration: 0.15s;
  transition-behavior: allow-discrete;
}
.bubble:popover-open {
  opacity: 1;
  @starting-style { opacity: 0; }
}
@media (prefers-reduced-motion: reduce) {
  .bubble { transition-duration: 0.05s; }
}
header {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: light-dark(#5f6368, #a8abb3);
}
.status { flex: 1; }
.status.working::before {
  content: "";
  display: inline-block;
  inline-size: 6px;
  block-size: 6px;
  margin-inline-end: 6px;
  vertical-align: middle;
  border-radius: 50%;
  background: currentColor;
}
@media (prefers-reduced-motion: no-preference) {
  .status.working::before { animation: pulse 1.2s ease-in-out infinite; }
}
@keyframes pulse { 50% { opacity: 0.25; } }
button {
  all: unset;
  display: grid;
  place-items: center;
  min-inline-size: 24px;
  min-block-size: 24px;
  border-radius: 6px;
  font-size: 16px;
  line-height: 1;
  cursor: pointer;
  color: inherit;
}
button:hover { background: light-dark(#eef0f3, #2e3036); }
button:focus-visible { outline: 2px solid light-dark(#1a62d6, #8ab4f8); outline-offset: 1px; }
.text {
  margin: 6px 0 0;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.text:empty { display: none; }
`;

/** Gap between the selection and the bubble, and the least space kept from the viewport's edges. */
const GAP = 8;

export interface BubbleView {
  /** The line above the text: what is happening, or what happened. `working` adds a pulsing dot. */
  setStatus(text: string, working?: boolean): void;
  /** `lang` marks the text's language, for screen readers and fonts. */
  setText(text: string, lang?: string): void;
  close(): void;
}

/** Opens a bubble next to `anchor` (a rectangle in viewport coordinates). `onClose` runs once, however it closes. */
export function openBubble(anchor: DOMRect, onClose: () => void): BubbleView {
  const host = document.createElement("div");
  // Keep the page's styles off the host element itself; the shadow root shields the rest.
  host.style.setProperty("all", "initial", "important");
  const root = host.attachShadow({ mode: "closed" });
  const style = document.createElement("style");
  style.textContent = STYLE;

  const bubble = document.createElement("section");
  bubble.className = "bubble";
  bubble.setAttribute("popover", "manual");
  bubble.setAttribute("aria-label", "Nook translation");

  const header = document.createElement("header");
  const status = document.createElement("span");
  status.className = "status";
  status.setAttribute("role", "status");
  const closeButton = document.createElement("button");
  closeButton.type = "button";
  closeButton.setAttribute("aria-label", "Close");
  closeButton.textContent = "×";
  header.append(status, closeButton);

  const text = document.createElement("p");
  text.className = "text";
  bubble.append(header, text);
  root.append(style, bubble);
  document.documentElement.append(host);

  let closed = false;
  let resize: ResizeObserver | undefined;
  const close = () => {
    if (closed) return;
    closed = true;
    resize?.disconnect();
    document.removeEventListener("keydown", onKey, true);
    document.removeEventListener("pointerdown", onPointer, true);
    host.remove();
    onClose();
  };
  const onKey = (event: KeyboardEvent) => {
    if (event.key === "Escape") close();
  };
  const onPointer = (event: PointerEvent) => {
    if (!event.composedPath().includes(host)) close();
  };
  document.addEventListener("keydown", onKey, true);
  document.addEventListener("pointerdown", onPointer, true);
  closeButton.addEventListener("click", close);

  bubble.showPopover();
  // Top-layer elements with position: absolute are placed against the
  // document, so the bubble scrolls with the text it belongs to. Fix the
  // anchor in document coordinates now, so placing it again after the page
  // scrolled still puts it next to the text.
  const opened = { scrollX, scrollY, innerWidth, innerHeight };
  const place = () => {
    const { width, height } = bubble.getBoundingClientRect();
    const below = anchor.bottom + GAP;
    const fitsBelow = below + height <= opened.innerHeight - GAP || anchor.top - GAP - height < GAP;
    const top = fitsBelow ? below : anchor.top - GAP - height;
    const left = Math.max(GAP, Math.min(anchor.left, opened.innerWidth - width - GAP));
    bubble.style.top = `${top + opened.scrollY}px`;
    bubble.style.left = `${left + opened.scrollX}px`;
  };
  place();
  // Growing text can push the bubble past the bottom of the viewport; place it again as it grows.
  resize = new ResizeObserver(place);
  resize.observe(bubble);

  return {
    setStatus(value, working = false) {
      status.textContent = value;
      status.classList.toggle("working", working);
    },
    setText(value, lang) {
      text.textContent = value;
      if (lang) text.lang = lang;
    },
    close,
  };
}
