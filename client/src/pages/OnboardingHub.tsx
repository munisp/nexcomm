/**
 * NEXCOM Exchange — Unified Onboarding Hub
 * Role-aware entry point that detects existing profiles and routes to the
 * correct onboarding PWA or dashboard for each stakeholder type.
 */
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { getLoginUrl } from "@/const";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
import { PageSkeleton } from "@/components/PageSkeleton";
  Sprout,
  TrendingUp,
  Building2,
  Warehouse,
  BarChart3,
  ArrowRight,
  CheckCircle2,
  Clock,
  XCircle,
  AlertCircle,
  LogIn,
} from "lucide-react";

// ── Types ──────────────────────────────────────────────────────────────────────
type KycStatus = "PENDING" | "UNDER_REVIEW" | "APPROVED" | "REJECTED";

interface StakeholderCard {
  key: "farmer" | "trader" | "broker" | "warehouseOp" | "marketMaker";
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  description: string;
  color: string;
  gradient: string;
  onboardingPath: string;
  dashboardPath: string;
  audience: string;
}

const STAKEHOLDER_CARDS: StakeholderCard[] = [
  {
    key: "farmer",
    icon: <Sprout className="w-8 h-8" />,
    title: "Farmer",
    subtitle: "Sell your harvest on the exchange",
    description:
      "Register your farm, list crops, submit KYC, and access live commodity prices. Get paid directly when buyers settle.",
    color: "text-green-400",
    gradient: "from-green-900/40 to-emerald-900/20",
    onboardingPath: "/farmer-onboarding",
    dashboardPath: "/farmer-dashboard",
    audience: "Smallholder & commercial farmers",
  },
  {
    key: "trader",
    icon: <TrendingUp className="w-8 h-8" />,
    title: "Trader",
    subtitle: "Trade spot & derivatives markets",
    description:
      "Open a trading account, complete identity verification, declare capital, and start trading commodities, futures, and options.",
    color: "text-blue-400",
    gradient: "from-blue-900/40 to-cyan-900/20",
    onboardingPath: "/trader-onboarding",
    dashboardPath: "/trader-dashboard",
    audience: "Retail & institutional traders",
  },
  {
    key: "broker",
    icon: <Building2 className="w-8 h-8" />,
    title: "Broker",
    subtitle: "Manage client accounts & orders",
    description:
      "Register your brokerage firm, upload SEC/CBN licenses, configure commission rates, and manage sub-accounts for your clients.",
    color: "text-purple-400",
    gradient: "from-purple-900/40 to-violet-900/20",
    onboardingPath: "/broker-onboarding",
    dashboardPath: "/broker-dashboard",
    audience: "Licensed brokerage firms",
  },
  {
    key: "warehouseOp",
    icon: <Warehouse className="w-8 h-8" />,
    title: "Warehouse Operator",
    subtitle: "Issue & manage commodity receipts",
    description:
      "Register your storage facility, obtain NWR certification, declare capacity per commodity, and issue electronic warehouse receipts.",
    color: "text-orange-400",
    gradient: "from-orange-900/40 to-amber-900/20",
    onboardingPath: "/warehouse-onboarding",
    dashboardPath: "/warehouse-dashboard",
    audience: "Certified storage facilities",
  },
  {
    key: "marketMaker",
    icon: <BarChart3 className="w-8 h-8" />,
    title: "Market Maker",
    subtitle: "Provide liquidity & tight spreads",
    description:
      "Register your trading desk, commit to instrument obligations, post performance bond, and earn rebates for maintaining two-sided quotes.",
    color: "text-yellow-400",
    gradient: "from-yellow-900/40 to-amber-900/20",
    onboardingPath: "/market-maker-onboarding",
    dashboardPath: "/market-maker-onboarding-dashboard",
    audience: "Proprietary trading firms",
  },
];

// ── KYC Status Badge ───────────────────────────────────────────────────────────
function KycBadge({ status }: { status: KycStatus }) {
  if (status === "APPROVED")
    return (
      <Badge className="bg-green-500/20 text-green-400 border-green-500/30 gap-1">
        <CheckCircle2 className="w-3 h-3" /> Approved
      </Badge>
    );
  if (status === "UNDER_REVIEW")
    return (
      <Badge className="bg-yellow-500/20 text-yellow-400 border-yellow-500/30 gap-1">
        <Clock className="w-3 h-3" /> Under Review
      </Badge>
    );
  if (status === "REJECTED")
    return (
      <Badge className="bg-red-500/20 text-red-400 border-red-500/30 gap-1">
        <XCircle className="w-3 h-3" /> Rejected
      </Badge>
    );
  return (
    <Badge className="bg-slate-500/20 text-slate-400 border-slate-500/30 gap-1">
      <AlertCircle className="w-3 h-3" /> Not Started
    </Badge>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────────
export default function OnboardingHub() {
  const [, navigate] = useLocation();
  const { user, loading: authLoading, isAuthenticated } = useAuth();

  const { data: status, isLoading: statusLoading } =
    trpc.onboardingHub.getMyOnboardingStatus.useQuery(undefined, {
      enabled: isAuthenticated,
    });

  const isLoading = authLoading || statusLoading;

  function getProfileStatus(key: StakeholderCard["key"]) {
    if (!status) return null;
    const profile = status[key];
    return profile ?? null;
  }

  function handleCardClick(card: StakeholderCard) {
    if (!isAuthenticated) {
      window.location.href = getLoginUrl();
      return;
    }
    const profile = getProfileStatus(card.key);
    if (profile?.kycStatus === "APPROVED") {
      navigate(card.dashboardPath);
    } else {
      navigate(card.onboardingPath);
    }
  }

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      {/* Header */}
      <div className="border-b border-slate-800 bg-slate-900/60 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-green-400 to-emerald-600 flex items-center justify-center font-bold text-sm">
              N
            </div>
            <span className="font-semibold text-lg tracking-tight">NEXCOM Exchange</span>
          </div>
          {isAuthenticated ? (
            <div className="flex items-center gap-3">
              <span className="text-sm text-slate-400">{user?.name}</span>
              <Button
                size="sm"
                variant="outline"
                className="border-slate-700 text-slate-300 hover:bg-slate-800"
                onClick={() => navigate("/dashboard")}
              >
                Go to Dashboard
              </Button>
            </div>
          ) : (
            <Button
              size="sm"
              className="bg-green-600 hover:bg-green-500"
              onClick={() => (window.location.href = getLoginUrl())}
            >
              <LogIn className="w-4 h-4 mr-2" />
              Sign In
            </Button>
          )}
        </div>
      </div>

      {/* Hero */}
      <div className="max-w-6xl mx-auto px-4 pt-16 pb-12 text-center">
        <div className="inline-flex items-center gap-2 bg-green-500/10 border border-green-500/20 rounded-full px-4 py-1.5 text-sm text-green-400 mb-6">
          <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
          Nigeria's Premier Commodity Exchange
        </div>
        <h1 className="text-4xl md:text-5xl font-bold mb-4 bg-gradient-to-r from-white via-slate-200 to-slate-400 bg-clip-text text-transparent">
          Join NEXCOM Exchange
        </h1>
        <p className="text-slate-400 text-lg max-w-2xl mx-auto">
          Choose your role on the exchange. Each stakeholder type has a dedicated
          onboarding flow, KYC process, and dashboard tailored to their needs.
        </p>
        {!isAuthenticated && (
          <p className="mt-4 text-sm text-yellow-400/80">
            You'll be asked to sign in before completing your profile.
          </p>
        )}
      </div>

      {/* Stakeholder Cards Grid */}
      <div className="max-w-6xl mx-auto px-4 pb-20">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {STAKEHOLDER_CARDS.map((card) => {
            const profile = getProfileStatus(card.key);
            const kycStatus: KycStatus = (profile?.kycStatus as KycStatus) ?? "PENDING";
            const isRegistered = !!profile;
            const isApproved = kycStatus === "APPROVED";

  if (statusLoading) return <PageSkeleton cards={2} tableRows={4} tableCols={3} />;
            return (
              <button
                key={card.key}
                onClick={() => handleCardClick(card)}
                className={`
                  group relative text-left rounded-2xl border p-6 transition-all duration-200
                  bg-gradient-to-br ${card.gradient}
                  ${isApproved
                    ? "border-green-500/40 hover:border-green-400/60"
                    : "border-slate-700/60 hover:border-slate-600"
                  }
                  hover:scale-[1.02] hover:shadow-xl hover:shadow-black/40
                  focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-slate-950 focus:ring-slate-600
                `}
              >
                {/* Icon + Status */}
                <div className="flex items-start justify-between mb-4">
                  <div className={`${card.color} bg-slate-800/60 rounded-xl p-3`}>
                    {card.icon}
                  </div>
                  {isLoading ? (
                    <div className="h-6 w-20 bg-slate-700/50 rounded-full animate-pulse" />
                  ) : (
                    <KycBadge status={kycStatus} />
                  )}
                </div>

                {/* Title */}
                <h3 className="text-xl font-bold text-white mb-1">{card.title}</h3>
                <p className={`text-sm font-medium mb-3 ${card.color}`}>{card.subtitle}</p>
                <p className="text-slate-400 text-sm leading-relaxed mb-4">{card.description}</p>

                {/* Audience tag */}
                <div className="flex items-center justify-between">
                  <span className="text-xs text-slate-500 bg-slate-800/60 rounded-full px-3 py-1">
                    {card.audience}
                  </span>
                  <div className="flex items-center gap-1.5 text-sm font-medium group-hover:gap-2.5 transition-all">
                    <span className={isApproved ? "text-green-400" : "text-slate-300"}>
                      {isApproved
                        ? "View Dashboard"
                        : isRegistered
                        ? "Continue Setup"
                        : "Get Started"}
                    </span>
                    <ArrowRight className={`w-4 h-4 ${isApproved ? "text-green-400" : "text-slate-400"}`} />
                  </div>
                </div>

                {/* Progress indicator for in-progress registrations */}
                {isRegistered && !isApproved && (
                  <div className="mt-4 pt-4 border-t border-slate-700/50">
                    <div className="flex items-center gap-2 text-xs text-slate-500">
                      <div className="flex-1 bg-slate-700/50 rounded-full h-1">
                        <div
                          className={`h-1 rounded-full transition-all ${
                            kycStatus === "UNDER_REVIEW"
                              ? "w-2/3 bg-yellow-500"
                              : kycStatus === "REJECTED"
                              ? "w-1/3 bg-red-500"
                              : "w-1/3 bg-blue-500"
                          }`}
                        />
                      </div>
                      <span>
                        {kycStatus === "UNDER_REVIEW"
                          ? "KYC in review"
                          : kycStatus === "REJECTED"
                          ? "KYC rejected — resubmit"
                          : "Profile created"}
                      </span>
                    </div>
                  </div>
                )}
              </button>
            );
          })}
        </div>

        {/* Footer note */}
        <div className="mt-12 text-center text-sm text-slate-500">
          <p>
            Already have an account?{" "}
            <button
              className="text-green-400 hover:text-green-300 underline underline-offset-2"
              onClick={() => navigate("/dashboard")}
            >
              Go to the main trading dashboard
            </button>
          </p>
          <p className="mt-2">
            Need help?{" "}
            <a
              href="mailto:support@nexcom.ng"
              className="text-blue-400 hover:text-blue-300 underline underline-offset-2"
            >
              Contact support
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}
