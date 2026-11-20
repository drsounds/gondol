/**
 * Keyboard shortcut helpers. Shortcuts are written as "+"-joined strings such as "Mod+Shift+P",
 * "Mod+[" or "?", where "Mod" is ⌘ on Apple platforms and Ctrl elsewhere.
 */

export function isMac(): boolean {
  return typeof navigator !== "undefined" && /Mac|iPhone|iPad|iPod/.test(navigator.platform);
}

interface ParsedShortcut {
  mod: boolean;
  ctrl: boolean;
  meta: boolean;
  alt: boolean;
  shift: boolean;
  key: string;
}

function parseShortcut(shortcut: string): ParsedShortcut {
  // Split on "+" but keep a literal "+" key (e.g. "Mod++").
  const parts = shortcut.split(/\+(?!$)/);
  const parsed: ParsedShortcut = { mod: false, ctrl: false, meta: false, alt: false, shift: false, key: "" };
  for (const part of parts) {
    switch (part.toLowerCase()) {
      case "mod":
        parsed.mod = true;
        break;
      case "ctrl":
      case "control":
        parsed.ctrl = true;
        break;
      case "meta":
      case "cmd":
        parsed.meta = true;
        break;
      case "alt":
      case "option":
        parsed.alt = true;
        break;
      case "shift":
        parsed.shift = true;
        break;
      default:
        parsed.key = part;
    }
  }
  return parsed;
}

/** event.code for keys whose event.key changes with Shift/Alt or keyboard layout. */
const CODE_FOR_KEY: Record<string, string> = {
  "[": "BracketLeft",
  "]": "BracketRight",
  "\\": "Backslash",
  ";": "Semicolon",
  "'": "Quote",
  ",": "Comma",
  ".": "Period",
  "/": "Slash",
  "`": "Backquote",
  "-": "Minus",
  "=": "Equal",
};

/** Named keys written in shortcuts, by the event.key they stand for. */
const NAMED_KEYS: Record<string, string> = { space: " ", esc: "escape", del: "delete", left: "arrowleft", right: "arrowright", up: "arrowup", down: "arrowdown" };

function keyMatches(event: KeyboardEvent, key: string): boolean {
  const want = NAMED_KEYS[key.toLowerCase()] ?? key.toLowerCase();
  if (want === " ") return event.key === " " || event.code === "Space";
  if (event.key.toLowerCase() === want) return true;
  if (/^[a-z]$/.test(want)) return event.code === `Key${want.toUpperCase()}`;
  if (/^[0-9]$/.test(want)) return event.code === `Digit${want}`;
  const code = CODE_FOR_KEY[key];
  return code !== undefined && event.code === code;
}

/** Whether a keydown event matches a shortcut string like "Mod+Shift+P". */
export function matchesShortcut(event: KeyboardEvent, shortcut: string): boolean {
  const s = parseShortcut(shortcut);
  if (!s.key) return false;
  const mac = isMac();
  const wantMeta = s.meta || (s.mod && mac);
  const wantCtrl = s.ctrl || (s.mod && !mac);
  if (event.metaKey !== wantMeta || event.ctrlKey !== wantCtrl || event.altKey !== s.alt) return false;
  // A bare printable symbol like "?" already implies whatever Shift the layout needs.
  const symbolOnly = !s.mod && !s.ctrl && !s.meta && !s.alt && !s.shift && s.key.length === 1 && !/[a-z0-9]/i.test(s.key);
  if (symbolOnly) return event.key === s.key;
  if (event.shiftKey !== s.shift) return false;
  return keyMatches(event, s.key);
}

/** Whether keyboard focus is in something the user types into. */
export function isEditableElement(target: EventTarget | null): boolean {
  if (!target || typeof HTMLElement === "undefined" || !(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  if (tag === "TEXTAREA" || tag === "SELECT") return true;
  if (tag === "INPUT") {
    const type = (target as HTMLInputElement).type;
    return !["button", "checkbox", "radio", "range", "reset", "submit", "color", "file", "image"].includes(type);
  }
  return false;
}

/** Whether focus is on a control that answers single keys itself (Space presses a button). */
export function isControlElement(target: EventTarget | null): boolean {
  if (!target || typeof HTMLElement === "undefined" || !(target instanceof HTMLElement)) return false;
  if (isEditableElement(target)) return true;
  return !!target.closest("button, a[href], summary, input, [role='button'], [role='menuitem'], [role='option'], [role='checkbox'], [role='radio'], [role='switch'], [role='slider'], [role='tab']");
}

/** Whether a shortcut is a key on its own (no Mod, Ctrl, Alt or Meta), like "Space" or "?". */
export function isBareShortcut(shortcut: string): boolean {
  const s = parseShortcut(shortcut);
  return !s.mod && !s.ctrl && !s.meta && !s.alt;
}

const KEY_LABELS: Record<string, string> = {
  space: "Space",
  arrowleft: "←",
  arrowright: "→",
  arrowup: "↑",
  arrowdown: "↓",
  left: "←",
  right: "→",
  up: "↑",
  down: "↓",
  escape: "Esc",
  esc: "Esc",
  enter: "↵",
};

/** Display form of a shortcut: "⌘⇧P" on Apple platforms, "Ctrl+Shift+P" elsewhere. */
export function formatShortcut(shortcut: string): string {
  const s = parseShortcut(shortcut);
  const mac = isMac();
  const key = KEY_LABELS[s.key.toLowerCase()] ?? (s.key.length === 1 ? s.key.toUpperCase() : s.key);
  if (mac) {
    return [s.ctrl && "⌃", s.alt && "⌥", s.shift && "⇧", (s.mod || s.meta) && "⌘", key].filter(Boolean).join("");
  }
  return [(s.mod || s.ctrl) && "Ctrl", s.meta && "Win", s.alt && "Alt", s.shift && "Shift", key].filter(Boolean).join("+");
}
