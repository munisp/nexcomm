/**
 * NEXCOM Exchange — DeliveryTimeline (INNOVATION 9)
 * ─────────────────────────────────────────────────────────────────────────────
 * Vertical milestone stepper for a delivery order. Honest rendering:
 *   • recorded milestones (operator-reported) — solid markers with location/note
 *   • derived milestones (implied by flat status, no operator report) — dashed
 *     markers labeled "inferred"
 *   • ETA chip is always labeled ESTIMATE (heuristic, not carrier data)
 *
 * Usage:
 *   const q = trpc.logistics.getDeliveryTimeline.useQuery({ deliveryId });
 *   <DeliveryTimeline milestones={q.data.milestones} sparse={q.data.sparse} eta={...} />
 */
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, Circle, CircleDashed, MapPin, PackageCheck, Truck, Warehouse, ClipboardCheck, CalendarClock } from "lucide-react";

export type TimelineMilestone = {
  milestone: "PICKUP_SCHEDULED" | "IN_TRANSIT" | "WAREHOUSE_ARRIVED" | "QUALITY_CHECKED" | "DELIVERED";
  occurredAt: Date | string;
  derived: boolean;
  note: string | null;
  location: string | null;
};

const STAGE_META: Record<TimelineMilestone["milestone"], { label: string; icon: typeof Truck }> = {
  PICKUP_SCHEDULED: { label: "Pickup scheduled", icon: CalendarClock },
  IN_TRANSIT: { label: "In transit", icon: Truck },
  WAREHOUSE_ARRIVED: { label: "Arrived at warehouse", icon: Warehouse },
  QUALITY_CHECKED: { label: "Quality checked", icon: ClipboardCheck },
  DELIVERED: { label: "Delivered", icon: PackageCheck },
};

const STAGE_ORDER: TimelineMilestone["milestone"][] = [
  "PICKUP_SCHEDULED",
  "IN_TRANSIT",
  "WAREHOUSE_ARRIVED",
  "QUALITY_CHECKED",
  "DELIVERED",
];

export function DeliveryTimeline({
  milestones,
  sparse,
  eta,
}: {
  milestones: TimelineMilestone[];
  sparse?: boolean;
  eta?: { minDays: number; maxDays: number } | null;
}) {
  const byStage = new Map(milestones.map((m) => [m.milestone, m]));
  const reachedUpTo = Math.max(-1, ...milestones.map((m) => STAGE_ORDER.indexOf(m.milestone)));

  return (
    <div className="space-y-0">
      {sparse && (
        <p className="text-xs text-muted-foreground mb-3 rounded-md border border-dashed p-2">
          Limited tracking history — some stages are inferred from the delivery status and have approximate timestamps.
        </p>
      )}
      <ol className="relative border-l border-border ml-3 space-y-5">
        {STAGE_ORDER.map((stage, idx) => {
          const entry = byStage.get(stage);
          const reached = idx <= reachedUpTo && !!entry;
          const pending = !entry && idx > reachedUpTo;
          const meta = STAGE_META[stage];
          const Icon = entry?.derived ? CircleDashed : reached ? CheckCircle2 : pending ? Circle : meta.icon;
          return (
            <li key={stage} className="ml-6">
              <span
                className={`absolute -left-3 flex h-6 w-6 items-center justify-center rounded-full bg-background ${
                  entry && !entry.derived
                    ? "text-primary"
                    : entry?.derived
                      ? "text-muted-foreground"
                      : "text-muted-foreground/40"
                }`}
              >
                <Icon className="w-5 h-5" />
              </span>
              <div className="flex items-center gap-2 flex-wrap">
                <p className={`text-sm font-medium ${entry ? "" : "text-muted-foreground/60"}`}>{meta.label}</p>
                {entry?.derived && (
                  <Badge variant="outline" className="text-[10px] font-normal">inferred</Badge>
                )}
              </div>
              {entry ? (
                <div className="text-xs text-muted-foreground space-y-0.5 mt-0.5">
                  <p>{new Date(entry.occurredAt).toLocaleString("en-NG", { dateStyle: "medium", timeStyle: "short" })}</p>
                  {entry.location && (
                    <p className="flex items-center gap-1"><MapPin className="w-3 h-3" />{entry.location}</p>
                  )}
                  {entry.note && <p className="italic">{entry.note}</p>}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground/50 mt-0.5">Pending</p>
              )}
            </li>
          );
        })}
      </ol>
      {eta && (
        <div className="mt-4 flex items-center gap-2">
          <Badge variant="secondary" className="text-xs">
            ESTIMATE — arrives in {eta.minDays}–{eta.maxDays} days
          </Badge>
          <span className="text-[11px] text-muted-foreground">heuristic, not carrier-confirmed</span>
        </div>
      )}
    </div>
  );
}
