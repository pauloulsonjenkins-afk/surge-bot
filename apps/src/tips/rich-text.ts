/**
 * Plain words from a Telegram "rich message" (layer 233): the formatted posts some channels now send, where the words
 * aren't in `message` but in `richMessage.blocks`, a tree of page blocks (paragraphs, headers, lists, tables) holding
 * rich text (bold, links, emoji). Both Teams to Score's freebies come like this (9 Nov 2026).
 *
 * Only the words are kept: each block ends a line, so "⚽ GOG FCC vs Clube de Salgaocar" and "ODDS: 4/7 (1.57)" stay on
 * lines of their own, as the classifier expects. Pure: no Telegram calls.
 */

type Node = { className?: string; [k: string]: unknown };

/** Fields that never hold words worth reading (ids, sizes, links, pictures). */
const SKIP = new Set(["className", "CONSTRUCTOR_ID", "SUBCLASS_OF_ID", "classType", "originalArgs", "photos", "documents", "url", "webpageId", "photoId", "videoId", "documentId", "audioId", "posterPhotoId", "geo", "channel", "flags"]);

function isNode(v: unknown): v is Node {
  return typeof v === "object" && v !== null && !Array.isArray(v) && !Buffer.isBuffer(v);
}

/** A block or row: its words end a line. */
function endsLine(cls: string): boolean {
  return /^(PageBlock|PageListItem|PageListOrderedItem|PageTableRow)/.test(cls);
}

function walk(v: unknown, out: string[]): void {
  if (Array.isArray(v)) {
    for (const x of v) walk(x, out);
    return;
  }
  if (!isNode(v)) return;
  const cls = v.className ?? "";
  if (cls === "TextPlain") {
    if (typeof v.text === "string") out.push(v.text);
    return;
  }
  if (cls === "TextCustomEmoji") {
    if (typeof v.alt === "string") out.push(v.alt);
    return;
  }
  if (cls === "TextMath" || cls === "PageBlockMath") {
    if (typeof v.source === "string") out.push(v.source);
    if (endsLine(cls)) out.push("\n");
    return;
  }
  if (cls === "TextDiff") {
    walk(v.text, out);
    return;
  }
  for (const [k, x] of Object.entries(v)) {
    if (SKIP.has(k) || k.startsWith("_") || typeof x !== "object") continue;
    walk(x, out);
    if (cls === "PageTableCell") out.push(" ");
  }
  if (endsLine(cls)) out.push("\n");
}

/** The words of a message's rich part, one block per line, or "" when it has none. */
export function richMessageText(rich: unknown): string {
  if (!isNode(rich)) return "";
  const out: string[] = [];
  walk(rich.blocks, out);
  return out
    .join("")
    .split("\n")
    .map((l) => l.replace(/[ \t]+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

/** True when Telegram sent only the start of a long rich post (the rest needs messages.getRichMessage). */
export function richMessageIsPart(rich: unknown): boolean {
  return isNode(rich) && rich.part === true;
}

/** A message's words: its plain text, else the words of its rich part. */
export function messageWords(m: { message?: string; richMessage?: unknown }): string {
  const plain = m.message ?? "";
  if (plain.trim()) return plain;
  return richMessageText(m.richMessage);
}
