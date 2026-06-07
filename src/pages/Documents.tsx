import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api } from "../lib/api";

interface DocumentSummary {
  id: string;
  title: string;
  category: string;
  expiryDate?: string | null;
}

export function Documents() {
  const { data, isLoading } = useQuery({
    queryKey: ["documents"],
    queryFn: () => api<{ documents: DocumentSummary[] }>("/documents"),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-white">Documents</h1>
        <button className="rounded-lg bg-vault-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-vault-500">
          + Add
        </button>
      </div>

      {isLoading ? (
        <p className="text-sm text-slate-400">Loading…</p>
      ) : data && data.documents.length > 0 ? (
        <ul className="divide-y divide-white/10 rounded-xl border border-white/10">
          {data.documents.map((doc) => (
            <li key={doc.id}>
              <Link
                to={`/documents/${doc.id}`}
                className="flex items-center justify-between px-4 py-3 hover:bg-white/5"
              >
                <span className="text-white">{doc.title}</span>
                <span className="text-xs text-slate-400">{doc.category}</span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <div className="rounded-xl border border-dashed border-white/10 p-8 text-center text-sm text-slate-400">
          No documents yet. Document storage lands in Phase 2.
        </div>
      )}
    </div>
  );
}
