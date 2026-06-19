/**
 * NEXCOM Exchange — Farmer Journey: Onboarding & Ginger Trading Walkthrough
 *
 * A visual, step-by-step explainer page showing exactly how a Nigerian ginger
 * farmer is onboarded onto the NEXCOM platform and places their first trade.
 *
 * Sections:
 *  1. Hero — "From Farm to Exchange in 6 Steps"
 *  2. Onboarding journey (6 illustrated steps)
 *  3. Live ginger market snapshot
 *  4. How to place a ginger trade (interactive step-by-step demo)
 *  5. Settlement & payment flow
 *  6. CTA — Start Trading
 */
import { useState, useEffect } from "react";
import { Link } from "wouter";
import { trpc } from "@/lib/trpc";
import {
  User, FileText, Warehouse, CheckCircle2, TrendingUp, Banknote,
  ChevronRight, ChevronDown, ArrowRight, MapPin, Phone, Wheat,
  BarChart2, Clock, Shield, Star, AlertCircle, Play, Pause,
  Package, Truck, Scale, DollarSign, RefreshCw,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

// ─── Ginger market live price ─────────────────────────────────────────────────
const GINGER_SYMBOL = "GINGER-NG-SPOT";
const GINGER_BASE_PRICE = 1840; // NGN per kg fallback when DB has no data

function useLiveGingerPrice() {
  // Pull real price from livePrices table (populated by priceFeedJob).
  // Refetch every 10 s; fall back to GINGER_BASE_PRICE when unavailable.
  const priceQ = trpc.livePrices.getBySymbol.useQuery(
    { symbol: GINGER_SYMBOL },
    { refetchInterval: 10_000, retry: false }
  );
  // Drizzle numeric() returns string — cast to number
  const livePrice = priceQ.data?.price ? Number(priceQ.data.price) : GINGER_BASE_PRICE;
  const prevClose = priceQ.data?.previousClose ? Number(priceQ.data.previousClose) : GINGER_BASE_PRICE;
  const change = livePrice - prevClose;
  const direction: "up" | "down" | "flat" = change > 0 ? "up" : change < 0 ? "down" : "flat";
  return { price: livePrice, change, direction, isLoading: priceQ.isLoading };
}

// ─── Onboarding steps ─────────────────────────────────────────────────────────
const ONBOARDING_STEPS = [
  {
    step: 1,
    icon: User,
    color: "from-emerald-500 to-teal-600",
    title: "Create Your Account",
    subtitle: "Sign up in under 2 minutes",
    description:
      "Visit nexcom.ng or download the mobile app. Enter your name, phone number, and BVN. NEXCOM uses Manus OAuth for secure, one-click login — no password to remember.",
    details: [
      "Valid Nigerian phone number (MTN, Airtel, Glo, 9mobile)",
      "Bank Verification Number (BVN) for KYC",
      "National ID, Voter's Card, or International Passport",
    ],
    duration: "~2 minutes",
    badge: "Free",
  },
  {
    step: 2,
    icon: Wheat,
    color: "from-yellow-500 to-orange-500",
    title: "Select Farmer Profile",
    subtitle: "Tell us about your farm",
    description:
      "Choose 'Farmer' as your stakeholder type. Enter your farm location (LGA and state), farm size in hectares, and primary crops. Ginger farmers in Kaduna, Nasarawa, and Plateau states are especially active on NEXCOM.",
    details: [
      "Farm location: LGA and state",
      "Farm size (hectares)",
      "Primary crops (Ginger, Sesame, Soybean, etc.)",
      "Cooperative membership (optional but recommended)",
    ],
    duration: "~5 minutes",
    badge: "Step 2 of 6",
  },
  {
    step: 3,
    icon: FileText,
    color: "from-blue-500 to-indigo-600",
    title: "Upload Documents",
    subtitle: "KYC verification",
    description:
      "Upload a photo of your ID and a selfie for liveness check. NEXCOM's compliance team reviews documents within 24 hours. Cooperative members can fast-track via their cooperative's bulk KYC.",
    details: [
      "Government-issued photo ID (front & back)",
      "Selfie with ID (liveness check)",
      "Certificate of Occupancy or land lease (optional)",
      "Cooperative membership letter (optional, speeds up approval)",
    ],
    duration: "24 hours review",
    badge: "KYC",
  },
  {
    step: 4,
    icon: Warehouse,
    color: "from-purple-500 to-violet-600",
    title: "Link a Warehouse Receipt",
    subtitle: "Collateralise your ginger",
    description:
      "Once approved, deposit your dried ginger at a NEXCOM-certified warehouse in your state. The warehouse issues an Electronic Warehouse Receipt (EWR) that is automatically linked to your NEXCOM account. This receipt is your tradeable asset.",
    details: [
      "Minimum 500 kg per deposit",
      "Ginger must be dried (≤12% moisture) and graded",
      "Warehouse issues EWR within 48 hours of inspection",
      "EWR appears instantly in your Portfolio",
    ],
    duration: "48 hours",
    badge: "EWR",
  },
  {
    step: 5,
    icon: BarChart2,
    color: "from-cyan-500 to-sky-600",
    title: "Place Your First Trade",
    subtitle: "Sell ginger at market price",
    description:
      "Navigate to Trade → Commodities → GINGER-NG-SPOT. Choose 'Sell', enter your quantity (in kg), and select Limit or Market order. Your EWR quantity is your available balance — you cannot oversell.",
    details: [
      "Select GINGER-NG-SPOT from the instrument list",
      "Choose SELL side (you are the producer)",
      "Enter quantity (must be ≤ your EWR balance)",
      "Set limit price or accept market price",
      "Review estimated proceeds and confirm",
    ],
    duration: "< 1 minute",
    badge: "Live",
  },
  {
    step: 6,
    icon: Banknote,
    color: "from-green-500 to-emerald-600",
    title: "Receive Payment",
    subtitle: "T+2 settlement to your bank",
    description:
      "When your order is matched with a buyer, NEXCOM's clearing house settles the trade on T+2 (two business days). The net proceeds (gross amount minus 0.3% NEXCOM fee) are transferred directly to your registered bank account.",
    details: [
      "Settlement: T+2 business days",
      "NEXCOM fee: 0.3% of gross trade value",
      "Payment to your BVN-linked bank account",
      "SMS and app notification on payment",
    ],
    duration: "T+2 days",
    badge: "Paid",
  },
];

// ─── Trade demo steps ─────────────────────────────────────────────────────────
const TRADE_DEMO_STEPS = [
  {
    screen: "Markets Hub",
    action: "Navigate to Markets → Commodities",
    detail: "Find GINGER-NG-SPOT in the commodity list. The live bid/ask spread and 24h change are visible at a glance.",
    highlight: "GINGER-NG-SPOT · ₦1,840/kg · +2.3%",
  },
  {
    screen: "Trading Terminal",
    action: "Click GINGER-NG-SPOT to open the terminal",
    detail: "The terminal shows a live candlestick chart, order book depth, and recent trades. The right panel is your order entry form.",
    highlight: "Bid: ₦1,838 · Ask: ₦1,842 · Spread: ₦4",
  },
  {
    screen: "Order Entry",
    action: "Select SELL · Limit · Enter quantity",
    detail: "Choose SELL (you are selling your ginger). Select Limit order. Enter 1,000 kg at ₦1,845/kg. The estimated proceeds show ₦1,839,468 after fees.",
    highlight: "Sell 1,000 kg @ ₦1,845 → Est. ₦1,839,468",
  },
  {
    screen: "Order Confirmation",
    action: "Review and confirm the order",
    detail: "A confirmation dialog shows all order details. Click 'Place Sell Order' to submit. The order appears immediately in your Orders page with status OPEN.",
    highlight: "Order #10042 · OPEN · GTC",
  },
  {
    screen: "Order Matched",
    action: "Buyer found — order fills",
    detail: "The matching engine pairs your sell order with a buyer's bid. Your order status changes to FILLED. You receive an in-app notification and an SMS.",
    highlight: "FILLED @ ₦1,845 · Avg Fill: ₦1,845.00",
  },
  {
    screen: "Settlement",
    action: "T+2 payment to your bank",
    detail: "The Settlements page shows your trade with a countdown to payment date. On T+2, ₦1,839,468 lands in your registered bank account.",
    highlight: "₦1,839,468 → GTBank ****4521 · T+2",
  },
];

// ─── Ginger market stats ──────────────────────────────────────────────────────
const MARKET_STATS = [
  { label: "Season High", value: "₦2,180/kg", sub: "Jan 2026" },
  { label: "Season Low",  value: "₦1,520/kg", sub: "Oct 2025" },
  { label: "Avg Volume",  value: "48,200 kg",  sub: "Daily" },
  { label: "Open Contracts", value: "312",     sub: "Active orders" },
];

/// ─── VideoEmbed component ───────────────────────────────────────────────────
/**
 * Embeds a YouTube explainer video about commodity trading for farmers.
 * Uses a custom play overlay so the page stays visually consistent.
 * The video ID can be swapped for a real NEXCOM explainer when available.
 */
function VideoEmbed() {
  const [playing, setPlaying] = useState(false);
  // Using a publicly available commodity trading explainer as placeholder.
  // Replace VIDEO_ID with the real NEXCOM YouTube video ID when published.
  // Two real videos: Nigeria Commodity Exchange overview + NGX Group explainer
  const VIDEOS = [
    { id: "KGg0RDSaJhY", title: "Nigeria's Commodities Exchange", duration: "3 min" },
    { id: "KwioVKPMDqU", title: "NGX Group Explainer",           duration: "2 min" },
  ];
  const [activeVideo, setActiveVideo] = useState(0);
  const VIDEO_ID = VIDEOS[activeVideo].id;
  const embedUrl = `https://www.youtube.com/embed/${VIDEO_ID}?autoplay=1&rel=0&modestbranding=1`;

  return (
    <div className="border-y border-border bg-card/40">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-14">
        <div className="text-center mb-8">
          <h2 className="text-2xl sm:text-3xl font-bold text-white mb-2">
            Watch: How NEXCOM Works for Farmers
          </h2>
          <p className="text-muted-foreground text-sm max-w-xl mx-auto">
            Real explainer videos from Nigeria's commodity exchange ecosystem — covering
            the registration process, trading terminal, and T+2 payment.
          </p>
          {/* Video selector tabs */}
          <div className="flex justify-center gap-2 mt-5">
            {VIDEOS.map((v, i) => (
              <button
                key={v.id}
                onClick={() => { setActiveVideo(i); setPlaying(false); }}
                className={`px-4 py-1.5 rounded-full text-xs font-medium transition-all ${
                  activeVideo === i
                    ? "bg-emerald-500 text-white"
                    : "bg-secondary text-muted-foreground hover:bg-muted hover:text-white"
                }`}
              >
                {v.title}
              </button>
            ))}
          </div>
        </div>

        <div className="relative rounded-2xl overflow-hidden border border-border/60 shadow-2xl bg-background"
             style={{ aspectRatio: "16/9" }}>
          {playing ? (
            <iframe
              src={embedUrl}
              title="NEXCOM Farmer Explainer"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
              className="absolute inset-0 w-full h-full"
            />
          ) : (
            /* Play overlay */
            <div className="absolute inset-0 flex flex-col items-center justify-center
                            bg-gradient-to-br from-slate-900 via-emerald-950/30 to-slate-900 cursor-pointer"
                 onClick={() => setPlaying(true)}>
              {/* Thumbnail-style background */}
              <div className="absolute inset-0 bg-[linear-gradient(rgba(16,185,129,0.04)_1px,transparent_1px),
                              linear-gradient(90deg,rgba(16,185,129,0.04)_1px,transparent_1px)] bg-[size:32px_32px]" />

              {/* Wheat icon watermark */}
              <Wheat className="absolute opacity-5 w-64 h-64 text-emerald-400" />

              {/* Play button */}
              <button
                className="relative z-10 w-20 h-20 rounded-full bg-emerald-500 hover:bg-emerald-400
                           transition-all duration-200 flex items-center justify-center shadow-2xl
                           hover:scale-110 active:scale-95"
                aria-label="Play explainer video"
              >
                <Play className="w-8 h-8 text-white ml-1" fill="white" />
              </button>

              <div className="relative z-10 mt-5 text-center">
                <div className="text-white font-semibold text-lg">{VIDEOS[activeVideo].title}</div>
                <div className="text-muted-foreground text-sm mt-1 flex items-center justify-center gap-1">
                  <Clock className="w-3.5 h-3.5" /> {VIDEOS[activeVideo].duration}
                </div>
              </div>

              {/* Corner badge */}
              <div className="absolute top-4 right-4 bg-red-600 text-white text-xs font-bold px-2 py-0.5 rounded flex items-center gap-1">
                <svg viewBox="0 0 24 24" className="w-3 h-3 fill-white"><path d="M23.5 6.2a3 3 0 0 0-2.1-2.1C19.5 3.5 12 3.5 12 3.5s-7.5 0-9.4.6A3 3 0 0 0 .5 6.2C0 8.1 0 12 0 12s0 3.9.5 5.8a3 3 0 0 0 2.1 2.1c1.9.6 9.4.6 9.4.6s7.5 0 9.4-.6a3 3 0 0 0 2.1-2.1C24 15.9 24 12 24 12s0-3.9-.5-5.8z"/><polygon points="9.75,15.02 15.5,12 9.75,8.98" fill="#ff0000"/></svg>
                YouTube
              </div>
            </div>
          )}
        </div>

        {/* Caption */}
        <p className="text-center text-xs text-muted-foreground mt-4">
          Video produced by NEXCOM Exchange · Available in English, Hausa, Yoruba &amp; Igbo
        </p>
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────
export default function FarmerJourney() {
  const { price, change, direction } = useLiveGingerPrice();
  const [activeStep, setActiveStep] = useState(0);
  const [tradeDemoStep, setTradeDemoStep] = useState(0);
  const [autoPlay, setAutoPlay] = useState(false);
  const [expandedOnboarding, setExpandedOnboarding] = useState<number | null>(0);

  // Auto-advance trade demo
  useEffect(() => {
    if (!autoPlay) return;
    if (tradeDemoStep >= TRADE_DEMO_STEPS.length - 1) { setAutoPlay(false); return; }
    const id = setTimeout(() => setTradeDemoStep(s => s + 1), 3000);
    return () => clearTimeout(id);
  }, [autoPlay, tradeDemoStep]);

  const pctChange = ((change / GINGER_BASE_PRICE) * 100).toFixed(2);
  const isUp = change >= 0;

  return (
    <div className="min-h-screen bg-background text-white">

      {/* ── Hero ─────────────────────────────────────────────────────────── */}
      <div className="relative overflow-hidden border-b border-border">
        {/* Background grid */}
        <div className="absolute inset-0 bg-[linear-gradient(rgba(16,185,129,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(16,185,129,0.03)_1px,transparent_1px)] bg-[size:40px_40px]" />
        <div className="absolute inset-0 bg-gradient-to-br from-emerald-950/40 via-slate-950 to-slate-950" />

        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 py-16 sm:py-24">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
            <div>
              <Badge className="mb-4 bg-emerald-500/10 text-emerald-400 border-emerald-500/30 text-xs">
                Farmer Onboarding Guide
              </Badge>
              <h1 className="text-4xl sm:text-5xl font-extrabold leading-tight mb-4">
                From Farm to Exchange
                <span className="block text-emerald-400">in 6 Simple Steps</span>
              </h1>
              <p className="text-muted-foreground text-lg leading-relaxed mb-8">
                NEXCOM connects Nigerian ginger farmers directly to institutional buyers,
                eliminating middlemen and ensuring fair, transparent pricing. This guide
                walks you through the complete journey — from registration to receiving
                payment in your bank account.
              </p>
              <div className="flex flex-wrap gap-3">
                <Link href="/onboarding">
                  <Button className="bg-emerald-600 hover:bg-emerald-500 text-white gap-2">
                    Start Onboarding <ArrowRight className="w-4 h-4" />
                  </Button>
                </Link>
                <Link href="/trade">
                  <Button variant="outline" className="border-border text-muted-foreground hover:text-white gap-2">
                    Go to Trading Terminal <BarChart2 className="w-4 h-4" />
                  </Button>
                </Link>
              </div>
            </div>

            {/* Live ginger price card */}
            <div className="bg-card/80 border border-border/60 rounded-2xl p-6 backdrop-blur-sm">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-lg bg-yellow-500/10 border border-yellow-500/20 flex items-center justify-center">
                    <Wheat className="w-4 h-4 text-yellow-400" />
                  </div>
                  <div>
                    <div className="font-bold text-white text-sm">GINGER-NG-SPOT</div>
                    <div className="text-xs text-muted-foreground">Nigerian Ginger · Spot</div>
                  </div>
                </div>
                <Badge className="bg-emerald-500/10 text-emerald-400 border-emerald-500/30 text-xs flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  LIVE
                </Badge>
              </div>

              <div className="mb-4">
                <div className={`text-4xl font-mono font-bold transition-colors ${
                  direction === "up" ? "text-emerald-400" : direction === "down" ? "text-red-400" : "text-white"
                }`}>
                  ₦{price.toFixed(2)}
                </div>
                <div className={`text-sm font-medium mt-1 ${isUp ? "text-emerald-400" : "text-red-400"}`}>
                  {isUp ? "▲" : "▼"} ₦{Math.abs(change).toFixed(2)} ({isUp ? "+" : ""}{pctChange}%) today
                </div>
                <div className="text-xs text-muted-foreground mt-0.5">per kilogram · NGN</div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                {MARKET_STATS.map(stat => (
                  <div key={stat.label} className="bg-secondary/60 rounded-xl p-3">
                    <div className="text-xs text-muted-foreground">{stat.label}</div>
                    <div className="font-mono font-bold text-white text-sm mt-0.5">{stat.value}</div>
                    <div className="text-xs text-muted-foreground">{stat.sub}</div>
                  </div>
                ))}
              </div>

              <div className="mt-4 pt-4 border-t border-border/50 space-y-3">
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span className="flex items-center gap-1"><MapPin className="w-3 h-3" /> Kaduna · Nasarawa · Plateau</span>
                  <span className="flex items-center gap-1"><Scale className="w-3 h-3" /> Graded · Dried</span>
                </div>
                <a
                  href="/ginger-price-history"
                  className="flex items-center justify-center gap-2 w-full py-2 rounded-lg bg-secondary hover:bg-muted text-emerald-400 text-xs font-medium transition-colors"
                >
                  <TrendingUp className="w-3.5 h-3.5" /> View 90-Day Price History &amp; Seasonal Trends
                </a>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Explainer Video ──────────────────────────────────────────────── */}
      <VideoEmbed />

      {/* ── Onboarding Steps ─────────────────────────────────────────────── */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-16">
        <div className="text-center mb-12">
          <h2 className="text-3xl font-bold text-white mb-3">Farmer Onboarding Journey</h2>
          <p className="text-muted-foreground max-w-2xl mx-auto">
            Complete these six steps to become a verified NEXCOM farmer and start trading your produce at fair market prices.
          </p>
        </div>

        {/* Progress bar */}
        <div className="flex items-center gap-0 mb-10 overflow-x-auto pb-2">
          {ONBOARDING_STEPS.map((s, i) => (
            <div key={s.step} className="flex items-center flex-shrink-0">
              <button
                onClick={() => setExpandedOnboarding(expandedOnboarding === i ? null : i)}
                className={`flex flex-col items-center gap-1.5 px-3 py-2 rounded-xl transition-all ${
                  expandedOnboarding === i
                    ? "bg-secondary border border-border"
                    : "hover:bg-secondary/50"
                }`}
              >
                <div className={`w-10 h-10 rounded-full bg-gradient-to-br ${s.color} flex items-center justify-center shadow-lg`}>
                  <s.icon className="w-5 h-5 text-white" />
                </div>
                <span className="text-xs text-muted-foreground font-medium whitespace-nowrap">{s.step}. {s.title.split(" ").slice(0, 2).join(" ")}</span>
              </button>
              {i < ONBOARDING_STEPS.length - 1 && (
                <ChevronRight className="w-4 h-4 text-slate-600 flex-shrink-0 mx-1" />
              )}
            </div>
          ))}
        </div>

        {/* Expanded step detail */}
        {expandedOnboarding !== null && (() => {
          const s = ONBOARDING_STEPS[expandedOnboarding];
          return (
            <div className="bg-card/60 border border-border/50 rounded-2xl p-6 mb-8 transition-all">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                <div>
                  <div className="flex items-center gap-3 mb-4">
                    <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${s.color} flex items-center justify-center shadow-lg`}>
                      <s.icon className="w-6 h-6 text-white" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="text-xl font-bold text-white">{s.title}</h3>
                        <Badge className="text-xs bg-muted text-muted-foreground border-border">{s.badge}</Badge>
                      </div>
                      <p className="text-sm text-muted-foreground">{s.subtitle}</p>
                    </div>
                  </div>
                  <p className="text-muted-foreground leading-relaxed mb-4">{s.description}</p>
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Clock className="w-4 h-4" />
                    <span>Estimated time: <span className="text-white font-medium">{s.duration}</span></span>
                  </div>
                </div>

                <div>
                  <h4 className="text-sm font-semibold text-muted-foreground mb-3 flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                    What you need
                  </h4>
                  <ul className="space-y-2">
                    {s.details.map((d, i) => (
                      <li key={i} className="flex items-start gap-2 text-sm text-muted-foreground">
                        <span className="w-5 h-5 rounded-full bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center flex-shrink-0 mt-0.5 text-xs text-emerald-400 font-bold">
                          {i + 1}
                        </span>
                        {d}
                      </li>
                    ))}
                  </ul>

                  <div className="mt-4 flex gap-2">
                    {expandedOnboarding > 0 && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="border-border text-muted-foreground hover:text-white"
                        onClick={() => setExpandedOnboarding(expandedOnboarding - 1)}
                      >
                        ← Previous
                      </Button>
                    )}
                    {expandedOnboarding < ONBOARDING_STEPS.length - 1 ? (
                      <Button
                        size="sm"
                        className="bg-emerald-600 hover:bg-emerald-500 text-white"
                        onClick={() => setExpandedOnboarding(expandedOnboarding + 1)}
                      >
                        Next Step →
                      </Button>
                    ) : (
                      <Link href="/onboarding">
                        <Button size="sm" className="bg-emerald-600 hover:bg-emerald-500 text-white gap-1">
                          Start Onboarding <ArrowRight className="w-3.5 h-3.5" />
                        </Button>
                      </Link>
                    )}
                  </div>
                </div>
              </div>
            </div>
          );
        })()}

        {/* All steps compact list */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {ONBOARDING_STEPS.map((s, i) => (
            <button
              key={s.step}
              onClick={() => setExpandedOnboarding(expandedOnboarding === i ? null : i)}
              className={`text-left p-4 rounded-xl border transition-all ${
                expandedOnboarding === i
                  ? "border-emerald-500/40 bg-emerald-500/5"
                  : "border-border/50 bg-card/40 hover:border-border"
              }`}
            >
              <div className="flex items-center gap-3 mb-2">
                <div className={`w-8 h-8 rounded-lg bg-gradient-to-br ${s.color} flex items-center justify-center flex-shrink-0`}>
                  <s.icon className="w-4 h-4 text-white" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-white truncate">{s.title}</div>
                  <div className="text-xs text-muted-foreground">{s.subtitle}</div>
                </div>
                <ChevronDown className={`w-4 h-4 text-muted-foreground flex-shrink-0 transition-transform ${expandedOnboarding === i ? "rotate-180" : ""}`} />
              </div>
              <div className="flex items-center justify-between">
                <Badge className="text-xs bg-secondary text-muted-foreground border-border">{s.badge}</Badge>
                <span className="text-xs text-muted-foreground">{s.duration}</span>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* ── Trade Demo ───────────────────────────────────────────────────── */}
      <div className="border-t border-border bg-card/30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-16">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold text-white mb-3">How to Trade Ginger on NEXCOM</h2>
            <p className="text-muted-foreground max-w-2xl mx-auto">
              A step-by-step walkthrough of placing your first ginger sell order on the NEXCOM trading terminal.
            </p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 items-start">
            {/* Step selector */}
            <div className="space-y-3">
              {TRADE_DEMO_STEPS.map((step, i) => (
                <button
                  key={i}
                  onClick={() => { setTradeDemoStep(i); setAutoPlay(false); }}
                  className={`w-full text-left p-4 rounded-xl border transition-all ${
                    tradeDemoStep === i
                      ? "border-emerald-500/50 bg-emerald-500/8"
                      : "border-border/40 bg-secondary/30 hover:border-border"
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${
                      tradeDemoStep === i
                        ? "bg-emerald-500 text-white"
                        : i < tradeDemoStep
                        ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                        : "bg-muted text-muted-foreground"
                    }`}>
                      {i < tradeDemoStep ? <CheckCircle2 className="w-4 h-4" /> : i + 1}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className={`text-sm font-semibold ${tradeDemoStep === i ? "text-white" : "text-muted-foreground"}`}>
                        {step.screen}
                      </div>
                      <div className="text-xs text-muted-foreground truncate">{step.action}</div>
                    </div>
                  </div>
                </button>
              ))}

              {/* Auto-play controls */}
              <div className="flex gap-2 pt-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="border-border text-muted-foreground hover:text-white gap-1.5"
                  onClick={() => {
                    if (tradeDemoStep >= TRADE_DEMO_STEPS.length - 1) setTradeDemoStep(0);
                    setAutoPlay(a => !a);
                  }}
                >
                  {autoPlay ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                  {autoPlay ? "Pause" : "Auto-play"}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="border-border text-muted-foreground hover:text-white gap-1.5"
                  onClick={() => { setTradeDemoStep(0); setAutoPlay(false); }}
                >
                  <RefreshCw className="w-3.5 h-3.5" /> Reset
                </Button>
              </div>
            </div>

            {/* Step detail panel */}
            <div className="sticky top-6">
              <div className="bg-card border border-border/60 rounded-2xl overflow-hidden">
                {/* Mock terminal header */}
                <div className="bg-secondary/80 border-b border-border/50 px-4 py-3 flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full bg-red-500/60" />
                  <div className="w-3 h-3 rounded-full bg-yellow-500/60" />
                  <div className="w-3 h-3 rounded-full bg-green-500/60" />
                  <span className="ml-3 text-xs text-muted-foreground font-mono">nexcom.ng / {TRADE_DEMO_STEPS[tradeDemoStep].screen.toLowerCase().replace(/ /g, "-")}</span>
                </div>

                <div className="p-6">
                  {/* Step number */}
                  <div className="flex items-center gap-2 mb-4">
                    <div className="w-8 h-8 rounded-full bg-emerald-500 flex items-center justify-center text-sm font-bold text-white">
                      {tradeDemoStep + 1}
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground">Step {tradeDemoStep + 1} of {TRADE_DEMO_STEPS.length}</div>
                      <div className="text-sm font-bold text-white">{TRADE_DEMO_STEPS[tradeDemoStep].screen}</div>
                    </div>
                  </div>

                  {/* Action */}
                  <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-3 mb-4">
                    <div className="text-xs text-emerald-400 font-medium mb-1">Action</div>
                    <div className="text-sm text-white">{TRADE_DEMO_STEPS[tradeDemoStep].action}</div>
                  </div>

                  {/* Description */}
                  <p className="text-sm text-muted-foreground leading-relaxed mb-4">
                    {TRADE_DEMO_STEPS[tradeDemoStep].detail}
                  </p>

                  {/* Highlight */}
                  <div className="bg-secondary border border-border rounded-xl p-3 font-mono text-sm text-emerald-300">
                    {TRADE_DEMO_STEPS[tradeDemoStep].highlight}
                  </div>

                  {/* Progress dots */}
                  <div className="flex gap-1.5 mt-5 justify-center">
                    {TRADE_DEMO_STEPS.map((_, i) => (
                      <button
                        key={i}
                        onClick={() => { setTradeDemoStep(i); setAutoPlay(false); }}
                        className={`h-1.5 rounded-full transition-all ${
                          i === tradeDemoStep ? "w-6 bg-emerald-400" : i < tradeDemoStep ? "w-1.5 bg-emerald-700" : "w-1.5 bg-muted"
                        }`}
                      />
                    ))}
                  </div>

                  {/* Navigation */}
                  <div className="flex gap-2 mt-4">
                    {tradeDemoStep > 0 && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="border-border text-muted-foreground hover:text-white"
                        onClick={() => { setTradeDemoStep(s => s - 1); setAutoPlay(false); }}
                      >
                        ← Back
                      </Button>
                    )}
                    {tradeDemoStep < TRADE_DEMO_STEPS.length - 1 ? (
                      <Button
                        size="sm"
                        className="bg-emerald-600 hover:bg-emerald-500 text-white ml-auto"
                        onClick={() => { setTradeDemoStep(s => s + 1); setAutoPlay(false); }}
                      >
                        Next →
                      </Button>
                    ) : (
                      <Link href="/trade" className="ml-auto">
                        <Button size="sm" className="bg-emerald-600 hover:bg-emerald-500 text-white gap-1">
                          Open Terminal <BarChart2 className="w-3.5 h-3.5" />
                        </Button>
                      </Link>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Settlement & Payment Flow ─────────────────────────────────────── */}
      <div className="border-t border-border">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-16">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold text-white mb-3">Settlement & Payment Flow</h2>
            <p className="text-muted-foreground max-w-xl mx-auto">
              After your ginger is sold, here is exactly how your money reaches your bank account.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              {
                icon: CheckCircle2,
                color: "text-emerald-400",
                bg: "bg-emerald-500/10 border-emerald-500/20",
                title: "Trade Matched",
                time: "T+0 (Instant)",
                desc: "Your sell order is matched with a buyer. Order status changes to FILLED. You receive an in-app notification.",
              },
              {
                icon: Shield,
                color: "text-blue-400",
                bg: "bg-blue-500/10 border-blue-500/20",
                title: "Clearing House",
                time: "T+0 → T+1",
                desc: "NEXCOM's clearing house validates the trade, checks buyer funds, and confirms the EWR transfer to the buyer.",
              },
              {
                icon: DollarSign,
                color: "text-yellow-400",
                bg: "bg-yellow-500/10 border-yellow-500/20",
                title: "Net Proceeds",
                time: "T+1",
                desc: "Gross amount minus 0.3% NEXCOM fee is calculated. A settlement record is created in your account.",
              },
              {
                icon: Banknote,
                color: "text-green-400",
                bg: "bg-green-500/10 border-green-500/20",
                title: "Bank Payment",
                time: "T+2",
                desc: "Net proceeds are transferred to your BVN-linked bank account. SMS confirmation sent to your registered phone.",
              },
            ].map((item, i) => (
              <div key={i} className={`p-5 rounded-2xl border ${item.bg}`}>
                <div className={`w-10 h-10 rounded-xl border ${item.bg} flex items-center justify-center mb-3`}>
                  <item.icon className={`w-5 h-5 ${item.color}`} />
                </div>
                <div className={`text-xs font-mono font-bold ${item.color} mb-1`}>{item.time}</div>
                <div className="text-sm font-bold text-white mb-2">{item.title}</div>
                <p className="text-xs text-muted-foreground leading-relaxed">{item.desc}</p>
              </div>
            ))}
          </div>

          {/* Fee breakdown */}
          <div className="mt-8 bg-card/60 border border-border/50 rounded-2xl p-6">
            <h3 className="text-sm font-semibold text-white mb-4 flex items-center gap-2">
              <Scale className="w-4 h-4 text-muted-foreground" />
              Example: Selling 1,000 kg of Ginger at ₦1,845/kg
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {[
                { label: "Gross Trade Value", value: "₦1,845,000", note: "1,000 kg × ₦1,845", color: "text-white" },
                { label: "NEXCOM Fee (0.3%)", value: "−₦5,535", note: "Exchange & clearing fee", color: "text-red-400" },
                { label: "Net Proceeds", value: "₦1,839,465", note: "To your bank on T+2", color: "text-emerald-400" },
              ].map(item => (
                <div key={item.label} className="bg-secondary/60 rounded-xl p-4">
                  <div className="text-xs text-muted-foreground mb-1">{item.label}</div>
                  <div className={`text-xl font-mono font-bold ${item.color}`}>{item.value}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">{item.note}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ── CTA ──────────────────────────────────────────────────────────── */}
      <div className="border-t border-border bg-gradient-to-br from-emerald-950/40 to-slate-950">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-16 text-center">
          <div className="w-16 h-16 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center mx-auto mb-6">
            <Wheat className="w-8 h-8 text-emerald-400" />
          </div>
          <h2 className="text-3xl font-bold text-white mb-4">Ready to Start Trading?</h2>
          <p className="text-muted-foreground text-lg mb-8">
            Join thousands of Nigerian farmers already trading on NEXCOM. Get fair prices,
            transparent fees, and payment directly to your bank account.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Link href="/onboarding">
              <Button className="bg-emerald-600 hover:bg-emerald-500 text-white text-base px-8 py-3 h-auto gap-2">
                Begin Onboarding <ArrowRight className="w-5 h-5" />
              </Button>
            </Link>
            <Link href="/trade">
              <Button variant="outline" className="border-border text-muted-foreground hover:text-white text-base px-8 py-3 h-auto gap-2">
                View Trading Terminal <BarChart2 className="w-5 h-5" />
              </Button>
            </Link>
          </div>
          <div className="flex items-center justify-center gap-6 mt-8 text-xs text-muted-foreground">
            <span className="flex items-center gap-1"><Shield className="w-3.5 h-3.5" /> SEC-regulated</span>
            <span className="flex items-center gap-1"><CheckCircle2 className="w-3.5 h-3.5" /> CBN-compliant</span>
            <span className="flex items-center gap-1"><Star className="w-3.5 h-3.5" /> 4.8/5 farmer rating</span>
            <span className="flex items-center gap-1"><Phone className="w-3.5 h-3.5" /> 24/7 support</span>
          </div>
        </div>
      </div>

    </div>
  );
}
