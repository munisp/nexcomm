/**
 * NEXCOM Exchange — Delivery Tracking (INNOVATION 9)
 * ─────────────────────────────────────────────────────────────────────────────
 * Physical-settlement tracking page: pick a delivery → vertical milestone
 * timeline (honest sparse states) + state-to-state ETA chip (labeled ESTIMATE).
 *
 * Route registration (App.tsx — sibling-owned, see MANIFEST snippet):
 *   import DeliveryTracking from "./pages/DeliveryTracking";  (or React.lazy)
 *   <Route path="/delivery-tracking" component={DeliveryTracking} />
 */
import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { trpc } from "@/lib/trpc";
import { PageSkeleton } from "@/components/PageSkeleton";
import { DeliveryTimeline } from "@/components/DeliveryTimeline";
import { Truck, Package, Calculator } from "lucide-react";

const NIGERIAN_STATES = [
  "Abia","Adamawa","Akwa Ibom","Anambra","Bauchi","Bayelsa","Benue","Borno","Cross River","Delta",
  "Ebonyi","Edo","Ekiti","Enugu","FCT","Gombe","Imo","Jigawa","Kaduna","Kano","Katsina","Kebbi",
  "Kogi","Kwara","Lagos","Nasarawa","Niger","Ogun","Ondo","Osun","Oyo","Plateau","Rivers","Sokoto",
  "Taraba","Yobe","Zamfara",
];

export default function DeliveryTracking() {
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [fromState, setFromState] = useState("Kano");
  const [toState, setToState] = useState("Lagos");

  const listQuery = trpc.delivery.list.useQuery({ page: 1, limit: 50 });
  const timelineQuery = trpc.logistics.getDeliveryTimeline.useQuery(
    { deliveryId: selectedId! },
    { enabled: selectedId !== null }
  );
  const etaQuery = trpc.logistics.estimateWindow.useQuery(
    { fromState, toState },
    { enabled: selectedId !== null, staleTime: Infinity }
  );

  if (listQuery.isLoading) return <PageSkeleton cards={0} tableRows={5} tableCols={3} />;

  const deliveries = listQuery.data?.deliveries ?? [];
  const timeline = timelineQuery.data;

  return (
    <div className="container mx-auto px-4 py-6 space-y-6 max-w-5xl">
      <div className="flex items-center gap-3">
        <Truck className="w-6 h-6 text-primary" />
        <div>
          <h1 className="text-2xl font-bold">Delivery Tracking</h1>
          <p className="text-sm text-muted-foreground">
            Physical settlement milestones for your delivery orders.
          </p>
        </div>
      </div>

      {deliveries.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground">
            <Package className="w-10 h-10 mx-auto mb-3 opacity-40" />
            <p>No delivery orders yet. Deliveries created from warehouse receipts will appear here.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-6 md:grid-cols-[320px_1fr]">
          {/* Delivery list */}
          <Card className="h-fit">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Your deliveries</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {deliveries.map((d) => (
                <button
                  key={d.id}
                  onClick={() => setSelectedId(d.id)}
                  className={`w-full text-left rounded-md border p-3 transition-colors ${
                    selectedId === d.id ? "border-primary bg-primary/5" : "hover:bg-muted/50"
                  }`}
                  aria-pressed={selectedId === d.id}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium truncate">
                      {d.commodity} · {d.quantity} {d.unit}
                    </span>
                    <Badge variant={d.status === "DELIVERED" ? "default" : "secondary"} className="text-[10px] shrink-0">
                      {d.status}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground truncate mt-0.5">{d.deliveryAddress}</p>
                </button>
              ))}
            </CardContent>
          </Card>

          {/* Timeline + ETA */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Milestones</CardTitle>
              {timeline && (
                <CardDescription>
                  {timeline.delivery.commodity} → {timeline.delivery.deliveryAddress}
                </CardDescription>
              )}
            </CardHeader>
            <CardContent>
              {selectedId === null ? (
                <p className="text-sm text-muted-foreground py-8 text-center">Select a delivery to view its timeline.</p>
              ) : timelineQuery.isLoading ? (
                <PageSkeleton cards={0} tableRows={4} tableCols={2} />
              ) : timelineQuery.isError ? (
                <p className="text-sm text-destructive py-8 text-center">
                  Could not load the timeline. <Button variant="link" onClick={() => timelineQuery.refetch()}>Retry</Button>
                </p>
              ) : timeline ? (
                <>
                  <DeliveryTimeline
                    milestones={timeline.milestones}
                    sparse={timeline.sparse}
                    eta={etaQuery.data ? { minDays: etaQuery.data.minDays, maxDays: etaQuery.data.maxDays } : null}
                  />

                  {/* ETA heuristic controls */}
                  <div className="mt-6 rounded-md border p-4 space-y-3">
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide flex items-center gap-1">
                      <Calculator className="w-3.5 h-3.5" /> Delivery window estimate
                    </p>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <Label htmlFor="eta-from">Origin state</Label>
                        <select
                          id="eta-from"
                          className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
                          value={fromState}
                          onChange={(e) => setFromState(e.target.value)}
                        >
                          {NIGERIAN_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
                        </select>
                      </div>
                      <div className="space-y-1">
                        <Label htmlFor="eta-to">Destination state</Label>
                        <select
                          id="eta-to"
                          className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
                          value={toState}
                          onChange={(e) => setToState(e.target.value)}
                        >
                          {NIGERIAN_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
                        </select>
                      </div>
                    </div>
                    {etaQuery.data && (
                      <p className="text-xs text-muted-foreground">{etaQuery.data.basis}</p>
                    )}
                  </div>
                </>
              ) : null}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
