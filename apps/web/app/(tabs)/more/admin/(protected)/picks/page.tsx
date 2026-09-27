"use client";

import { useRecentPicks } from "@/queries/use-picks";

export default function PicksPage() {
  const { data, isLoading, error } = useRecentPicks(50);

  return (
    <div className="p-6">
      <h1 className="text-2xl font-semibold mb-2">Picks received</h1>
      <p className="text-sm text-muted-foreground mb-6">
        Every live pick the engine has actually captured, most recent first. This is real
        data from the engine&rsquo;s database, not a mock — it has nothing to do with the trades
        shown on the main dashboard, since no trades have been placed yet.
      </p>

      {isLoading && <p>Loading…</p>}
      {error && <p className="text-red-600">{(error as Error).message}</p>}
      {data && data.length === 0 && <p>No picks captured yet.</p>}

      {data && data.length > 0 && (
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="text-left border-b">
              <th className="py-2 pr-4">Received</th>
              <th className="py-2 pr-4">Signature verified</th>
              <th className="py-2">Body</th>
            </tr>
          </thead>
          <tbody>
            {data.map((p) => (
              <tr key={p.id} className="border-b align-top">
                <td className="py-2 pr-4 whitespace-nowrap">
                  {new Date(p.receivedAt).toLocaleString()}
                </td>
                <td className="py-2 pr-4">{p.signatureVerified ? "Yes" : "No"}</td>
                <td className="py-2 font-mono text-xs whitespace-pre-wrap break-all">{p.body}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
