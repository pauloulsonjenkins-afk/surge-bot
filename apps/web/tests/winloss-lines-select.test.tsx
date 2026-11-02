/** The by-strategy profit lines: the key lists each strategy with its latest figure, best first, as buttons to pick one line. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { WinLossLines } from "@/components/admin/WinLossLines";

const data = [
  { label: "1 Nov", k0: 1, k1: -2, k2: 0 },
  { label: "2 Nov", k0: 3.5, k1: -4, k2: 0 },
];
const series = [
  { key: "k0", name: "Time to fight", color: "#d98a00" },
  { key: "k1", name: "Matched odds home", color: "#0fa37f" },
  { key: "k2", name: "Early Pressure", color: "#3f7ce0" },
];

test("selectable: one button per strategy with its latest figure, best first, none picked at the start", () => {
  const html = renderToStaticMarkup(<WinLossLines data={data} series={series} selectable />);
  const buttons = [...html.matchAll(/<button[^>]*aria-pressed="(true|false)"[^>]*>([\s\S]*?)<\/button>/g)];
  assert.equal(buttons.length, 3);
  assert.ok(buttons.every((b) => b[1] === "false"));
  const names = buttons.map((b) => (/Time to fight|Matched odds home|Early Pressure/.exec(b[2]!) ?? [""])[0]);
  assert.deepEqual(names, ["Time to fight", "Early Pressure", "Matched odds home"], "3.5, then 0, then -4");
  assert.match(buttons[0]![2]!, /£3\.50/);
  assert.match(buttons[2]![2]!, /£4\.00/);
  assert.ok(!html.includes("Show all lines"), "only offered once a line is picked");
});

test("not selectable: the plain key, as before", () => {
  const html = renderToStaticMarkup(<WinLossLines data={data} series={series} />);
  assert.ok(!html.includes("aria-pressed"));
  assert.match(html, /Time to fight/);
});
