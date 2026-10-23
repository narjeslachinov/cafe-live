export function LiveDot({ connected }: { connected: boolean }) {
  return (
    <span
      role="status"
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs ${
        connected ? "bg-green-100 text-green-800" : "bg-amber-100 text-amber-900"
      }`}
    >
      <span
        className={`h-2 w-2 rounded-full ${connected ? "bg-green-600" : "animate-pulse bg-amber-600"}`}
      />
      {connected ? "زنده" : "قطع شد؛ در حال اتصال…"}
    </span>
  );
}