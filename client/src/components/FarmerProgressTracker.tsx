/**
 * FarmerProgressTracker
 *
 * A compact progress bar widget for the Dashboard showing the 5 key milestones
 * a farmer must complete before their first live trade on NEXCOM.
 *
 * Data comes from trpc.onboarding.farmerProgress — derived from existing DB rows,
 * no extra table required.
 */
import { Link } from "wouter";
import { trpc } from "@/lib/trpc";
import { CheckCircle2, Circle, ChevronRight, Wheat } from "lucide-react";

export default function FarmerProgressTracker() {
  const { data, isLoading } = trpc.onboarding.farmerProgress.useQuery(undefined, {
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });

  if (isLoading) {
    return (
      <div className="bg-white/5 border border-white/10 rounded-xl p-4 animate-pulse">
        <div className="h-4 bg-white/10 rounded w-40 mb-3" />
        <div className="h-2 bg-white/10 rounded-full mb-3" />
        <div className="space-y-2">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="h-3 bg-white/10 rounded w-full" />
          ))}
        </div>
      </div>
    );
  }

  if (!data || data.totalCount === 0) return null;

  const { steps, completedCount, totalCount } = data;
  const pct = Math.round((completedCount / totalCount) * 100);
  const allDone = completedCount === totalCount;

  return (
    <div className="bg-white/5 border border-white/10 rounded-xl p-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Wheat className="w-4 h-4 text-amber-400 flex-shrink-0" />
          <span className="text-sm font-semibold text-white">Farmer Journey</span>
        </div>
        <span className={`text-xs font-medium ${allDone ? "text-emerald-400" : "text-muted-foreground"}`}>
          {completedCount}/{totalCount} complete
        </span>
      </div>

      {/* Progress bar */}
      <div className="h-1.5 bg-white/10 rounded-full overflow-hidden mb-4">
        <div
          className={`h-full rounded-full transition-all duration-700 ${
            allDone ? "bg-emerald-400" : "bg-amber-400"
          }`}
          style={{ width: `${pct}%` }}
        />
      </div>

      {/* Steps */}
      <ol className="space-y-2">
        {steps.map((step, idx) => {
          const isNext = !step.completed && (idx === 0 || steps[idx - 1]?.completed);
          const content = (
            <div
              className={`flex items-start gap-2.5 rounded-lg px-2 py-1.5 transition-colors ${
                isNext ? "bg-amber-500/10" : ""
              }`}
            >
              {step.completed ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0 mt-0.5" />
              ) : (
                <Circle className={`w-4 h-4 flex-shrink-0 mt-0.5 ${isNext ? "text-amber-400" : "text-gray-600"}`} />
              )}
              <div className="flex-1 min-w-0">
                <div className={`text-xs font-medium leading-tight ${
                  step.completed ? "text-emerald-300 line-through decoration-emerald-500/50"
                    : isNext ? "text-amber-300"
                    : "text-muted-foreground"
                }`}>
                  {step.label}
                </div>
                {isNext && (
                  <div className="text-xs text-muted-foreground mt-0.5 leading-tight">{step.description}</div>
                )}
              </div>
              {isNext && step.href && (
                <ChevronRight className="w-3.5 h-3.5 text-amber-400 flex-shrink-0 mt-0.5" />
              )}
            </div>
          );

          if (isNext && step.href) {
            return (
              <li key={step.id}>
                <Link href={step.href}>{content}</Link>
              </li>
            );
          }

          return <li key={step.id}>{content}</li>;
        })}
      </ol>

      {allDone && (
        <div className="mt-3 text-center text-xs text-emerald-400 font-medium">
          🎉 You're fully onboarded — happy trading!
        </div>
      )}
    </div>
  );
}
