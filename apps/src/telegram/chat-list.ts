/**
 * The login's chat list, read without GramJS's Dialog wrapper.
 *
 * Telegram's newer API layer (use-new-layer.ts) can send a "Community" dialog (dialogCommunity), which has no `peer`.
 * GramJS 2.26's `getDialogs` builds a Dialog for every entry and throws on it ("Cannot cast Community to any kind of
 * int"), so the catch-up sync failed after every restart and the admin's chat picker could fail too. The raw request
 * still fills GramJS's entity cache (it skips what it can't read), which is all that loading the list is for.
 */
import "./use-new-layer";
import { returnBigInt } from "telegram/Helpers";
import { Api, utils, type TelegramClient } from "telegram";

async function rawDialogs(client: TelegramClient, limit: number) {
  return client.invoke(new Api.messages.GetDialogs({ offsetDate: 0, offsetId: 0, offsetPeer: new Api.InputPeerEmpty(), limit, hash: returnBigInt(0) }));
}

/** Loads up to `limit` chats so a chat known only by its number can be found afterwards. */
export async function loadChatList(client: TelegramClient, limit: number): Promise<void> {
  await rawDialogs(client, limit);
}

export interface ChatChoice {
  id: string;
  title: string;
  kind: "channel" | "group" | "bot" | "person";
}

/** The chats to choose from, newest first, leaving out dialog kinds that aren't a chat (a Community). */
export async function listChats(client: TelegramClient, limit: number): Promise<ChatChoice[]> {
  const res = await rawDialogs(client, limit);
  if (!("dialogs" in res)) return [];
  const entities = new Map<string, Api.TypeChat | Api.TypeUser>();
  for (const e of [...res.chats, ...res.users]) {
    try {
      entities.set(utils.getPeerId(e).toString(), e);
    } catch {
      // A kind of chat GramJS can't number: left out.
    }
  }
  const out: ChatChoice[] = [];
  for (const d of res.dialogs) {
    const peer = (d as { peer?: Api.TypePeer }).peer;
    if (!peer) continue;
    let id: string;
    try {
      id = utils.getPeerId(peer).toString();
    } catch {
      continue;
    }
    const e = entities.get(id) as { className?: string; title?: string; username?: string; bot?: boolean; megagroup?: boolean; broadcast?: boolean; firstName?: string; lastName?: string } | undefined;
    const isChannel = e?.className === "Channel" && !e.megagroup;
    const isGroup = e?.className === "Chat" || (e?.className === "Channel" && !!e.megagroup);
    const kind = isChannel ? "channel" : isGroup ? "group" : e?.bot ? "bot" : "person";
    const name = e?.title ?? [e?.firstName, e?.lastName].filter(Boolean).join(" ");
    out.push({ id, title: name || (e?.username ? `@${e.username}` : "(untitled)"), kind });
  }
  return out;
}
