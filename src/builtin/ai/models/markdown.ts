/**
 * Markdown as models write it, parsed into blocks and inline pieces for the chat to render as React
 * elements (features/chat/src/components/Markdown.tsx). It never produces HTML: raw HTML in an
 * answer stays text, and links only keep http(s) and mailto addresses.
 *
 * Covered: ATX headings, paragraphs (a single newline is a line break), fenced code, block quotes,
 * bullet, numbered and task lists (nested by indent), GitHub tables, rules, and inline code,
 * **bold**, *italic*, ~~strike~~, [links](https://…), <https://…> and bare URLs. An unclosed fence
 * runs to the end, so an answer still streaming in renders as it will end up.
 */

export type MdInline =
  | { type: "text"; text: string }
  | { type: "code"; text: string }
  | { type: "strong" | "em" | "del"; children: MdInline[] }
  | { type: "link"; href: string; children: MdInline[] }
  | { type: "br" };

export type MdAlign = "left" | "center" | "right" | null;

export type MdListItem = { checked: boolean | null; children: MdBlock[] };

export type MdBlock =
  | { type: "heading"; level: 1 | 2 | 3 | 4 | 5 | 6; children: MdInline[] }
  | { type: "paragraph"; children: MdInline[] }
  | { type: "code"; lang: string; text: string }
  | { type: "quote"; children: MdBlock[] }
  | { type: "list"; ordered: boolean; start: number; items: MdListItem[] }
  | { type: "table"; align: MdAlign[]; head: MdInline[][]; rows: MdInline[][][] }
  | { type: "rule" };

const FENCE = /^ {0,3}(`{3,}|~{3,})\s*([^`\s]*)[^`]*$/;
const HEADING = /^ {0,3}(#{1,6})(?:\s+(.*?))?(?:\s+#+)?\s*$/;
const RULE = /^ {0,3}([-*_])(?:\s*\1){2,}\s*$/;
const QUOTE = /^ {0,3}> ?(.*)$/;
const ITEM = /^( {0,12})([-*+]|\d{1,9}[.)])(?:\s+(.*))?$/;
const TABLE_DIVIDER = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;

const isBlank = (line: string) => !line.trim();

/** The cells of a table row, without the outer pipes; `\|` stays a pipe. */
function cells(line: string): string[] {
  let row = line.trim();
  if (row.startsWith("|")) row = row.slice(1);
  if (row.endsWith("|") && !row.endsWith("\\|")) row = row.slice(0, -1);
  return row.split(/(?<!\\)\|/).map((cell) => cell.trim().replace(/\\\|/g, "|"));
}

function startsBlock(line: string, next: string | undefined): boolean {
  return (
    FENCE.test(line) ||
    HEADING.test(line) ||
    RULE.test(line) ||
    QUOTE.test(line) ||
    ITEM.test(line) ||
    (line.includes("|") && next !== undefined && TABLE_DIVIDER.test(next) && next.includes("-"))
  );
}

/** Removes up to `width` columns of leading spaces (a tab counts as four). */
function dedent(line: string, width: number): string {
  let removed = 0;
  let at = 0;
  while (at < line.length && removed < width) {
    if (line[at] === " ") removed += 1;
    else if (line[at] === "\t") removed += 4;
    else break;
    at += 1;
  }
  return line.slice(at);
}

export function parseMarkdown(source: string): MdBlock[] {
  return parseBlocks(source.replace(/\r\n?/g, "\n").split("\n"));
}

function parseBlocks(lines: string[]): MdBlock[] {
  const blocks: MdBlock[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (isBlank(line)) {
      i += 1;
      continue;
    }

    const fence = FENCE.exec(line);
    if (fence) {
      const marker = fence[1];
      const indent = line.length - line.trimStart().length;
      const body: string[] = [];
      i += 1;
      while (i < lines.length && !new RegExp(`^ {0,3}${marker[0] === "`" ? "`" : "~"}{${marker.length},}\\s*$`).test(lines[i])) {
        body.push(dedent(lines[i], indent));
        i += 1;
      }
      i += 1; // the closing fence, if there is one
      blocks.push({ type: "code", lang: fence[2] ?? "", text: body.join("\n") });
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      blocks.push({ type: "heading", level: heading[1].length as 1 | 2 | 3 | 4 | 5 | 6, children: parseInline(heading[2] ?? "") });
      i += 1;
      continue;
    }

    if (RULE.test(line)) {
      blocks.push({ type: "rule" });
      i += 1;
      continue;
    }

    if (QUOTE.test(line)) {
      const body: string[] = [];
      while (i < lines.length && !isBlank(lines[i])) {
        const quoted = QUOTE.exec(lines[i]);
        // A line without ">" continues the quote's paragraph (lazy continuation).
        body.push(quoted ? quoted[1] : lines[i]);
        i += 1;
      }
      blocks.push({ type: "quote", children: parseBlocks(body) });
      continue;
    }

    const item = ITEM.exec(line);
    if (item) {
      const [list, next] = parseList(lines, i);
      blocks.push(list);
      i = next;
      continue;
    }

    if (line.includes("|") && i + 1 < lines.length && TABLE_DIVIDER.test(lines[i + 1]) && lines[i + 1].includes("-")) {
      const head = cells(line);
      const align = cells(lines[i + 1]).map((cell): MdAlign => {
        const left = cell.startsWith(":");
        const right = cell.endsWith(":");
        return left && right ? "center" : right ? "right" : left ? "left" : null;
      });
      i += 2;
      const rows: MdInline[][][] = [];
      while (i < lines.length && !isBlank(lines[i]) && lines[i].includes("|")) {
        const row = cells(lines[i]);
        rows.push(head.map((_, column) => parseInline(row[column] ?? "")));
        i += 1;
      }
      blocks.push({ type: "table", align: head.map((_, column) => align[column] ?? null), head: head.map((cell) => parseInline(cell)), rows });
      continue;
    }

    const paragraph: string[] = [line.trim()];
    i += 1;
    while (i < lines.length && !isBlank(lines[i]) && !startsBlock(lines[i], lines[i + 1])) {
      paragraph.push(lines[i].trim());
      i += 1;
    }
    blocks.push({ type: "paragraph", children: parseInline(paragraph.join("\n")) });
  }
  return blocks;
}

/** A list from line `from`: items of the same kind at the first item's indent, with what's under them. */
function parseList(lines: string[], from: number): [MdBlock, number] {
  const first = ITEM.exec(lines[from])!;
  const indent = first[1].length;
  const ordered = /\d/.test(first[2]);
  const items: MdListItem[] = [];
  let i = from;
  while (i < lines.length) {
    const match = ITEM.exec(lines[i]);
    if (!match || match[1].length !== indent || /\d/.test(match[2]) !== ordered) break;
    // Text under the item lines up with its content, after the marker.
    const width = indent + match[2].length + 1;
    const body: string[] = [match[3] ?? ""];
    i += 1;
    while (i < lines.length) {
      const line = lines[i];
      if (isBlank(line)) {
        // A blank line stays in the item only when indented text follows it.
        const after = lines.slice(i + 1).find((l) => !isBlank(l));
        if (after === undefined || after.length - after.trimStart().length < width) break;
        body.push("");
        i += 1;
        continue;
      }
      const lead = line.length - line.trimStart().length;
      const sibling = ITEM.exec(line);
      if (sibling && sibling[1].length <= indent) break;
      if (lead < width && !sibling && startsBlock(line, lines[i + 1])) break;
      body.push(lead >= width ? dedent(line, width) : line.trimStart());
      i += 1;
    }
    let checked: boolean | null = null;
    const task = /^\[([ xX])\]\s+/.exec(body[0]);
    if (task) {
      checked = task[1] !== " ";
      body[0] = body[0].slice(task[0].length);
    }
    items.push({ checked, children: parseBlocks(body) });
  }
  const start = ordered ? Number.parseInt(first[2], 10) : 1;
  return [{ type: "list", ordered, start, items }, i];
}

/** Only these addresses become links; anything else (javascript:, data:, …) stays text. */
export function safeHref(href: string): string | null {
  const value = href.trim();
  return /^(https?:\/\/|mailto:)/i.test(value) ? value : null;
}

const PUNCTUATION = /[!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~]/;
const BARE_URL = /^https?:\/\/[^\s<>"]*[^\s<>".,:;!?'")\]]/;

/** Inline markdown: code spans first, then links, emphasis and URLs. */
export function parseInline(text: string): MdInline[] {
  const out: MdInline[] = [];
  let buffer = "";
  const flush = () => {
    if (buffer) out.push({ type: "text", text: buffer });
    buffer = "";
  };
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    const rest = text.slice(i);

    if (ch === "\\" && i + 1 < text.length && PUNCTUATION.test(text[i + 1])) {
      buffer += text[i + 1];
      i += 2;
      continue;
    }

    if (ch === "\n") {
      flush();
      out.push({ type: "br" });
      i += 1;
      continue;
    }

    if (ch === "`") {
      const run = /^`+/.exec(rest)![0];
      const close = text.indexOf(run, i + run.length);
      if (close !== -1) {
        flush();
        let code = text.slice(i + run.length, close).replace(/\n/g, " ");
        if (/^ .* $/.test(code)) code = code.slice(1, -1);
        out.push({ type: "code", text: code });
        i = close + run.length;
        continue;
      }
      buffer += run;
      i += run.length;
      continue;
    }

    if (ch === "[" || (ch === "!" && text[i + 1] === "[")) {
      const open = ch === "!" ? i + 1 : i;
      const link = readLink(text, open);
      if (link) {
        const href = safeHref(link.href);
        flush();
        const label = parseInline(link.label || link.href);
        // Images are shown as links: an answer shouldn't load addresses by itself.
        out.push(href ? { type: "link", href, children: label } : { type: "text", text: link.label });
        i = link.end;
        continue;
      }
    }

    if (ch === "<") {
      const auto = /^<((?:https?:\/\/|mailto:)[^\s<>]+)>/i.exec(rest);
      if (auto) {
        flush();
        out.push({ type: "link", href: auto[1], children: [{ type: "text", text: auto[1].replace(/^mailto:/i, "") }] });
        i += auto[0].length;
        continue;
      }
    }

    if ((ch === "h" || ch === "H") && (i === 0 || /[\s(*_~]/.test(text[i - 1]))) {
      const url = BARE_URL.exec(rest);
      if (url) {
        flush();
        out.push({ type: "link", href: url[0], children: [{ type: "text", text: url[0] }] });
        i += url[0].length;
        continue;
      }
    }

    if (ch === "*" || ch === "_" || ch === "~") {
      const span = readEmphasis(text, i);
      if (span) {
        flush();
        out.push({ type: span.type, children: parseInline(span.inner) });
        i = span.end;
        continue;
      }
      const run = new RegExp(`^\\${ch}+`).exec(rest)![0];
      buffer += run;
      i += run.length;
      continue;
    }

    buffer += ch;
    i += 1;
  }
  flush();
  return out;
}

/** `[label](href "title")` at `at`, with nested brackets in the label. */
function readLink(text: string, at: number): { label: string; href: string; end: number } | null {
  let depth = 0;
  let close = -1;
  for (let j = at; j < text.length; j++) {
    if (text[j] === "\\") {
      j += 1;
      continue;
    }
    if (text[j] === "[") depth += 1;
    else if (text[j] === "]") {
      depth -= 1;
      if (depth === 0) {
        close = j;
        break;
      }
    } else if (text[j] === "\n" && text[j + 1] === "\n") return null;
  }
  if (close === -1 || text[close + 1] !== "(") return null;
  let parens = 0;
  for (let j = close + 2; j < text.length; j++) {
    const c = text[j];
    if (c === "\n" || (c === " " && parens === 0 && !/^\s+"[^"]*"\)/.test(text.slice(j)))) return null;
    if (c === "(") parens += 1;
    else if (c === ")") {
      if (parens === 0) {
        const inside = text.slice(close + 2, j).trim();
        const href = inside.replace(/\s+"[^"]*"$/, "").replace(/^<(.*)>$/, "$1");
        return { label: text.slice(at + 1, close), href, end: j + 1 };
      }
      parens -= 1;
    }
  }
  return null;
}

/** `**x**`, `__x__`, `*x*`, `_x_` or `~~x~~` at `at`. */
function readEmphasis(text: string, at: number): { type: "strong" | "em" | "del"; inner: string; end: number } | null {
  const ch = text[at];
  const double = text[at + 1] === ch;
  if (ch === "~" && !double) return null;
  const marker = double ? ch + ch : ch;
  const type = ch === "~" ? "del" : double ? "strong" : "em";
  const start = at + marker.length;
  // Opens only before text, and `_` not inside a word (snake_case stays as it is).
  if (start >= text.length || /\s/.test(text[start])) return null;
  if (ch === "_" && at > 0 && /[\p{L}\p{N}]/u.test(text[at - 1])) return null;
  let j = start;
  while (j < text.length) {
    const found = text.indexOf(marker, j);
    if (found === -1) return null;
    if (text[found - 1] === "\\") {
      j = found + 1;
      continue;
    }
    const after = text[found + marker.length];
    // A single marker next to another (`**`) belongs to a strong span, not this one.
    if (!double && (after === ch || text[found - 1] === ch) && found > start) {
      j = found + (after === ch ? 2 : 1);
      continue;
    }
    if (found === start || /\s/.test(text[found - 1])) {
      j = found + 1;
      continue;
    }
    if (ch === "_" && after !== undefined && /[\p{L}\p{N}]/u.test(after)) {
      j = found + 1;
      continue;
    }
    const inner = text.slice(start, found);
    if (inner.includes("\n\n")) return null;
    return { type, inner, end: found + marker.length };
  }
  return null;
}
