import { redirect } from "next/navigation";

// Telegram now lives on the Settings page. This keeps old links and bookmarks working.
export default function TelegramMoved() {
  redirect("/more/admin/settings");
}
