// Obsidian augments HTMLElement.prototype with DOM-sugar helpers (createEl,
// empty, setAttr, addClass…). src/engrave.ts uses a small subset of them, so to
// run the renderer in a plain browser we polyfill just those methods. This is
// the *entire* browser-port surface for the renderer — everything else in
// src/ is already DOM-free or uses standard APIs.
//
// Import this module for its side effects before any code that touches engrave.

interface DomElementInfo {
  cls?: string | string[];
  text?: string;
  attr?: Record<string, string | number | boolean | null>;
  title?: string;
  href?: string;
  type?: string;
  value?: string;
  placeholder?: string;
}

function applyClasses(el: Element, cls?: string | string[]): void {
  if (!cls) {
    return;
  }

  const classes = Array.isArray(cls) ? cls : cls.split(/\s+/);
  el.classList.add(...classes.filter((name) => name.length > 0));
}

function createElement<K extends keyof HTMLElementTagNameMap>(
  parent: HTMLElement,
  tag: K,
  info?: DomElementInfo | string
): HTMLElementTagNameMap[K] {
  const el = parent.ownerDocument.createElement(tag);
  const options: DomElementInfo = typeof info === "string" ? { text: info } : info ?? {};

  applyClasses(el, options.cls);

  if (options.text !== undefined) {
    el.textContent = options.text;
  }

  if (options.title !== undefined) {
    el.title = options.title;
  }

  if (options.attr) {
    for (const [name, raw] of Object.entries(options.attr)) {
      if (raw === null || raw === false) {
        continue;
      }
      el.setAttribute(name, String(raw));
    }
  }

  for (const key of ["href", "type", "value", "placeholder"] as const) {
    if (options[key] !== undefined) {
      (el as Record<string, unknown>)[key] = options[key];
    }
  }

  parent.appendChild(el);

  return el;
}

// Augment the prototype only once (HMR re-imports this module).
const proto = HTMLElement.prototype as unknown as Record<string, unknown>;

if (!proto.__drumDomShim) {
  proto.__drumDomShim = true;

  proto.createEl = function (this: HTMLElement, tag: string, info?: DomElementInfo | string) {
    return createElement(this, tag as keyof HTMLElementTagNameMap, info);
  };

  proto.createDiv = function (this: HTMLElement, info?: DomElementInfo | string) {
    return createElement(this, "div", info);
  };

  proto.createSpan = function (this: HTMLElement, info?: DomElementInfo | string) {
    return createElement(this, "span", info);
  };

  proto.empty = function (this: HTMLElement) {
    while (this.firstChild) {
      this.removeChild(this.firstChild);
    }
  };

  proto.setAttr = function (this: HTMLElement, name: string, value: string | number | boolean) {
    this.setAttribute(name, String(value));
  };

  proto.setText = function (this: HTMLElement, text: string) {
    this.textContent = text;
  };

  proto.addClass = function (this: HTMLElement, ...classes: string[]) {
    this.classList.add(...classes);
  };

  proto.removeClass = function (this: HTMLElement, ...classes: string[]) {
    this.classList.remove(...classes);
  };

  proto.toggleClass = function (this: HTMLElement, cls: string, force?: boolean) {
    this.classList.toggle(cls, force);
  };

  proto.setCssProps = function (this: HTMLElement, props: Record<string, string>) {
    for (const [name, value] of Object.entries(props)) {
      this.style.setProperty(name, value);
    }
  };
}

// Mirror Obsidian's type augmentation so engrave.ts (and the app) typecheck
// against the same surface the plugin build sees from obsidian.d.ts.
declare global {
  interface HTMLElement {
    createEl<K extends keyof HTMLElementTagNameMap>(tag: K, info?: DomElementInfo | string): HTMLElementTagNameMap[K];
    createDiv(info?: DomElementInfo | string): HTMLDivElement;
    createSpan(info?: DomElementInfo | string): HTMLSpanElement;
    empty(): void;
    setAttr(name: string, value: string | number | boolean): void;
    setText(text: string): void;
    addClass(...classes: string[]): void;
    removeClass(...classes: string[]): void;
    toggleClass(cls: string, force?: boolean): void;
    setCssProps(props: Record<string, string>): void;
  }
}

export {};
