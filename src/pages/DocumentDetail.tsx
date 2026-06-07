import { Link, useParams } from "react-router-dom";

export function DocumentDetail() {
  const { id } = useParams();
  return (
    <div className="space-y-4">
      <Link to="/documents" className="text-sm text-vault-500 hover:underline">
        ← Back to documents
      </Link>
      <h1 className="text-xl font-semibold text-white">Document {id}</h1>
      <div className="rounded-xl border border-dashed border-white/10 p-6 text-sm text-slate-400">
        Document details, files, versions, and expiry reminders appear here
        (Phases 2–3).
      </div>
    </div>
  );
}
