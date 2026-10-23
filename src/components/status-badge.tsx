import { STATUS_LABEL } from "@/lib/format";

const STYLE: Record<string, string> = {
  new: "bg-amber-100 text-amber-900",
  preparing: "bg-blue-100 text-blue-900",
  ready: "bg-green-100 text-green-900",
  served: "bg-stone-200 text-stone-700",
  cancelled: "bg-red-100 text-red-800",
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium ${STYLE[status] ?? "bg-stone-100"}`}
    >
      {STATUS_LABEL[status] ?? status}
    </span>
  );
}