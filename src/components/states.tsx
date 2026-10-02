export function ErrorState({ title, detail }: { title: string; detail?: string }) {
  return (
    <div className="rounded-2xl border border-red-200 bg-white p-4 text-sm shadow-sm">
      <p className="font-medium text-red-800">{title}</p>
      {detail ? <p className="mt-1 text-slate-600">{detail}</p> : null}
    </div>
  );
}

export function EmptyState({ title, detail }: { title: string; detail?: string }) {
  return (
    <div className="rounded-2xl border border-black/5 bg-white p-4 text-sm shadow-sm">
      <p className="font-medium">{title}</p>
      {detail ? <p className="mt-1 text-slate-500">{detail}</p> : null}
    </div>
  );
}

export function LoadingState({ label = 'Loading' }: { label?: string }) {
  return (
    <div className="rounded-2xl border border-black/5 bg-white p-4 text-sm text-slate-500 shadow-sm">{label}…</div>
  );
}

export function DemoDataNotice() {
  return null;
}
