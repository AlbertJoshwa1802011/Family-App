function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-ink-800 p-4">
      <div className="text-2xl font-bold text-white">{value}</div>
      <div className="mt-1 text-sm text-slate-400">{label}</div>
    </div>
  );
}

export function Dashboard() {
  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold text-white">Dashboard</h1>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Documents" value="—" />
        <StatCard label="Expiring soon" value="—" />
        <StatCard label="Family members" value="—" />
        <StatCard label="Storage used" value="—" />
      </div>
      <div className="rounded-xl border border-dashed border-white/10 p-6 text-sm text-slate-400">
        Upcoming expiries and recent documents will appear here (Phases 2–3).
      </div>
    </div>
  );
}
