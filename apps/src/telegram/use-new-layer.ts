/**
 * Makes GramJS speak Telegram's current API layer (api-layer.ts) instead of the layer 198 it ships with.
 *
 * Why: Telegram swaps any post the client's layer can't show for "unsupported" and drops its words. On 9 Nov 2026 that
 * was 250 of the Both Teams to Score channel's 400 latest posts, its daily freebies among them (they carry a bet-slip
 * card, a media type newer than layer 198), so the free tip reader never saw them.
 *
 * How: GramJS builds its classes at start-up from a schema text module (telegram/tl/apiTl.js). This puts the newer text
 * in Node's module cache under that module's name before GramJS first loads, then raises the layer GramJS announces when
 * it connects. It must run before anything requires "telegram": every file that loads GramJS imports this first.
 *
 * Classes the newer layer dropped but GramJS's own helpers still check with `instanceof` (the old keyboard buttons) get
 * empty stand-ins, so those checks answer "no" instead of throwing. The engine doesn't use buttons.
 */
import Module from "node:module";
import { TELEGRAM_API_LAYER, TELEGRAM_API_TL } from "./api-layer";
import { log } from "../server/log";

const DROPPED = [
  "KeyboardButtonUrl",
  "KeyboardButtonCallback",
  "KeyboardButtonRequestPhone",
  "KeyboardButtonRequestGeoLocation",
  "KeyboardButtonSwitchInline",
  "KeyboardButtonGame",
  "KeyboardButtonBuy",
  "KeyboardButtonUrlAuth",
  "InputKeyboardButtonUrlAuth",
  "KeyboardButtonRequestPoll",
  "InputKeyboardButtonUserProfile",
  "KeyboardButtonUserProfile",
  "KeyboardButtonWebView",
  "KeyboardButtonSimpleWebView",
  "KeyboardButtonRequestPeer",
  "InputKeyboardButtonRequestPeer",
  "KeyboardButtonCopy",
];

/** The layer GramJS is using: TELEGRAM_API_LAYER once this has run, 198 if GramJS loaded first. */
export let telegramLayer = 198;

function install(): void {
  const apiPath = require.resolve("telegram/tl/api.js");
  if (require.cache[apiPath]) {
    log.error(`Telegram: GramJS loaded before the layer ${TELEGRAM_API_LAYER} schema could be put in place; staying on its own layer. Newer posts will arrive without their words.`);
    return;
  }
  const schemaPath = require.resolve("telegram/tl/apiTl.js");
  const m = new Module(schemaPath);
  m.filename = schemaPath;
  m.loaded = true;
  m.exports = TELEGRAM_API_TL;
  require.cache[schemaPath] = m;

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const all = require("telegram/tl/AllTLObjects") as { LAYER: number };
  all.LAYER = TELEGRAM_API_LAYER;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Api } = require("telegram/tl/api") as { Api: Record<string, unknown> };
  for (const name of DROPPED) if (!(name in Api)) Api[name] = class {};
  telegramLayer = TELEGRAM_API_LAYER;
}

install();
