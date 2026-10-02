export default function OperatorLoading() {
  return (
    <div className="flex flex-col gap-4">
      <div className="h-8 w-48 animate-pulse rounded-full bg-black/10" />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {Array.from({ length: 6 }, (_, index) => (
          <div key={index} className="h-24 animate-pulse rounded-3xl bg-white" />
        ))}
      </div>
      <div className="h-72 animate-pulse rounded-3xl bg-white" />
    </div>
  );
}
