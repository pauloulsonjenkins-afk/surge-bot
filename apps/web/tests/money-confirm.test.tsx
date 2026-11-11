/** A big stake or loss limit needs its figure typed again: what counts as typed, and the loss limit's share of the balance. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { typedFigure } from "@/components/ui/ConfirmDialog";
import { LossLimitShare } from "@/components/admin/views/SendingView";

test("the figure typed: a pound sign, a percent sign and spaces around it are ignored", () => {
  assert.equal(typedFigure("45"), "45");
  assert.equal(typedFigure(" £45 "), "45");
  assert.equal(typedFigure("£ 45"), "45");
  assert.equal(typedFigure("4.5%"), "4.5");
  assert.equal(typedFigure("4.5 %"), "4.5");
  assert.notEqual(typedFigure("450"), "45");
  assert.equal(typedFigure(""), "");
});

test("a loss limit is shown as a share of the balance, with a warning above 20%", () => {
  const high = renderToStaticMarkup(<LossLimitShare limit={45} balance={73.61} />);
  assert.match(high, /£45 is 61% of your £73\.61 balance/);
  assert.match(high, /20% would be £14/);
  assert.match(high, /type the figure again/);
  const fine = renderToStaticMarkup(<LossLimitShare limit={10} balance={73.61} />);
  assert.match(fine, /£10 is 14% of your £73\.61 balance\./);
  assert.ok(!fine.includes("too high"));
});

test("no limit, or no balance read yet, shows nothing", () => {
  assert.equal(renderToStaticMarkup(<LossLimitShare limit={0} balance={73.61} />), "");
  assert.equal(renderToStaticMarkup(<LossLimitShare limit={10} balance={null} />), "");
  assert.equal(renderToStaticMarkup(<LossLimitShare limit={Number("abc")} balance={73.61} />), "");
});
