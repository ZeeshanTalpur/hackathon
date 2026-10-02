export default function Loading() {
  return (
    <div className="min-h-screen bg-[#f3efe6] text-[#141820]">
      <div className="flex items-center justify-between border-b border-black/5 px-4 py-4 md:px-8">
        <div className="h-7 w-40 animate-pulse rounded-full bg-black/10" />
        <div className="h-11 w-11 animate-pulse rounded-2xl bg-black/10" />
      </div>
      <div className="mx-auto grid max-w-6xl gap-6 px-4 py-6 md:grid-cols-[minmax(16rem,22rem)_minmax(0,1fr)] md:px-8">
        <div className="h-72 animate-pulse rounded-3xl bg-white" />
        <div className="h-64 animate-pulse rounded-3xl bg-[#0e1424]" />
      </div>
    </div>
  );
}
