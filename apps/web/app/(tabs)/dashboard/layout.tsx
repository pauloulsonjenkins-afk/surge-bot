// Never served from a prerendered copy: the page must go through proxy.ts on every visit, so signed-out visitors
// and members are sent to the Members area instead of being handed a cached page.
export const dynamic = "force-dynamic";

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
