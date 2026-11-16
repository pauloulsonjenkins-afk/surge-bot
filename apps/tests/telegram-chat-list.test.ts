/** The login's chat list read raw (telegram/chat-list.ts): a Community dialog (newer API layer) must not break it. */
import { test } from "node:test";
import assert from "node:assert/strict";
import "../src/telegram/use-new-layer";
import { Api } from "telegram";
import { returnBigInt } from "telegram/Helpers";
import { listChats, loadChatList } from "../src/telegram/chat-list";

test("chats are listed and a Community dialog is left out instead of failing the whole list", async () => {
  const channel = new Api.Channel({ id: returnBigInt(111), title: "Alerts", photo: new Api.ChatPhotoEmpty(), date: 0, broadcast: true } as never);
  const bot = new Api.User({ id: returnBigInt(222), firstName: "Alert Bot", bot: true } as never);
  const result = new Api.messages.Dialogs({
    dialogs: [
      new Api.Dialog({ peer: new Api.PeerChannel({ channelId: returnBigInt(111) }) } as never),
      { className: "DialogCommunity", communityId: returnBigInt(333) } as never,
      new Api.Dialog({ peer: new Api.PeerUser({ userId: returnBigInt(222) }) } as never),
    ],
    messages: [],
    chats: [channel],
    users: [bot],
  });
  const asked: unknown[] = [];
  const client = { invoke: async (req: unknown) => (asked.push(req), result) } as never;
  assert.deepEqual(await listChats(client, 80), [
    { id: "-100111", title: "Alerts", kind: "channel" },
    { id: "222", title: "Alert Bot", kind: "bot" },
  ]);
  await loadChatList(client, 100);
  assert.equal(asked.length, 2);
  assert.ok(asked[1] instanceof Api.messages.GetDialogs);
});
