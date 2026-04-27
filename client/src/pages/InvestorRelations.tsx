import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { PageSkeleton } from "@/components/PageSkeleton";
import {
  Calendar,
  FileText,
  Users,
  Bell,
  BellOff,
  Download,
  ExternalLink,
  Search,
  TrendingUp,
  TrendingDown,
  Minus,
} from "lucide-react";

const EVENT_TYPE_LABELS: Record<string, string> = {
  EARNINGS_RELEASE: "Earnings",
  DIVIDEND_ANNOUNCEMENT: "Dividend",
  AGM: "AGM",
  EGM: "EGM",
  RIGHTS_ISSUE: "Rights Issue",
  BONUS_ISSUE: "Bonus Issue",
  STOCK_SPLIT: "Stock Split",
  MERGER_ACQUISITION: "M&A",
  REGULATORY_FILING: "Regulatory",
  INVESTOR_PRESENTATION: "Presentation",
  ROADSHOW: "Roadshow",
  OTHER: "Other",
};

const EVENT_TYPE_COLORS: Record<string, string> = {
  EARNINGS_RELEASE: "bg-blue-100 text-blue-800",
  DIVIDEND_ANNOUNCEMENT: "bg-green-100 text-green-800",
  AGM: "bg-purple-100 text-purple-800",
  EGM: "bg-orange-100 text-orange-800",
  RIGHTS_ISSUE: "bg-yellow-100 text-yellow-800",
  BONUS_ISSUE: "bg-emerald-100 text-emerald-800",
  STOCK_SPLIT: "bg-teal-100 text-teal-800",
  MERGER_ACQUISITION: "bg-red-100 text-red-800",
  REGULATORY_FILING: "bg-gray-100 text-gray-800",
  INVESTOR_PRESENTATION: "bg-indigo-100 text-indigo-800",
  ROADSHOW: "bg-pink-100 text-pink-800",
  OTHER: "bg-slate-100 text-slate-800",
};

const DOC_TYPE_LABELS: Record<string, string> = {
  ANNUAL_REPORT: "Annual Report",
  INTERIM_REPORT: "Interim Report",
  QUARTERLY_REPORT: "Quarterly Report",
  PROSPECTUS: "Prospectus",
  CIRCULAR: "Circular",
  PRESS_RELEASE: "Press Release",
  PRESENTATION: "Presentation",
  FINANCIAL_STATEMENT: "Financial Statement",
  REGULATORY_FILING: "Regulatory Filing",
  OTHER: "Other",
};

export default function InvestorRelations() {
  const { isAuthenticated } = useAuth();
  const [eventFilter, setEventFilter] = useState("ALL");
  const [docFilter, setDocFilter] = useState("ALL");
  const [symbolFilter, setSymbolFilter] = useState("");
  const [shareholderSymbol, setShareholderSymbol] = useState("DANGCEM");

  const { data: eventsData, isLoading: eventsLoading } = trpc.investorRelations.listEvents.useQuery({
    eventType: eventFilter as any,
    companySymbol: symbolFilter || undefined,
    publishedOnly: true,
    limit: 100,
  });
  const events = eventsData?.events ?? [];

  const { data: documentsData, isLoading: docsLoading } = trpc.investorRelations.listDocuments.useQuery({
    documentType: docFilter as any,
    companySymbol: symbolFilter || undefined,
    publishedOnly: true,
    limit: 100,
  });
  const documents = documentsData?.documents ?? [];

  const { data: shareholderData, isLoading: shareholdersLoading } = trpc.investorRelations.listShareholders.useQuery({
    companySymbol: shareholderSymbol,
    limit: 50,
  });

  const { data: mySubscriptions = [] } = trpc.investorRelations.getMySubscriptions.useQuery(
    undefined,
    { enabled: isAuthenticated }
  );

  const upsertSub = trpc.investorRelations.upsertSubscription.useMutation({
    onSuccess: () => {
      toast.success("Subscription updated");
      utils.investorRelations.getMySubscriptions.invalidate();
    },
  });

  const removeSub = trpc.investorRelations.removeSubscription.useMutation({
    onSuccess: () => {
      toast.success("Unsubscribed");
      utils.investorRelations.getMySubscriptions.invalidate();
    },
  });

  const downloadDoc = trpc.investorRelations.downloadDocument.useMutation({
    onSuccess: (data) => {
      window.open(data.fileUrl, "_blank");
      toast.success(`Opening ${data.title}`);
    },
    onError: (err) => toast.error(err.message),
  });

  const utils = trpc.useUtils();

  const isSubscribed = (symbol: string) =>
    mySubscriptions.some((s) => s.companySymbol === symbol);

  const toggleSubscription = (symbol: string) => {
    if (!isAuthenticated) {
      toast.error("Please log in to subscribe to company updates");
      return;
    }
    if (isSubscribed(symbol)) {
      removeSub.mutate({ companySymbol: symbol });
    } else {
      upsertSub.mutate({ companySymbol: symbol });
    }
  };

  const getEpsVariance = (actual: string | null, estimate: string | null) => {
    if (!actual || !estimate) return null;
    const a = parseFloat(actual);
    const e = parseFloat(estimate);
    if (e === 0) return null;
    return ((a - e) / Math.abs(e)) * 100;
  };

  return (
    <div className="container py-8 max-w-7xl">
      <div className="flex items-start justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Investor Relations</h1>
          <p className="text-muted-foreground mt-1">
            Corporate events, financial documents, and shareholder information
          </p>
        </div>
        {isAuthenticated && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Bell className="h-4 w-4" />
            <span>{mySubscriptions.length} company subscriptions</span>
          </div>
        )}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-6">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Filter by company symbol (e.g. DANGCEM)"
            value={symbolFilter}
            onChange={(e) => setSymbolFilter(e.target.value.toUpperCase())}
            className="pl-9"
          />
        </div>
      </div>

      <Tabs defaultValue="events">
        <TabsList className="mb-6">
          <TabsTrigger value="events" className="flex items-center gap-2">
            <Calendar className="h-4 w-4" />
            Event Calendar
          </TabsTrigger>
          <TabsTrigger value="documents" className="flex items-center gap-2">
            <FileText className="h-4 w-4" />
            Document Library
          </TabsTrigger>
          <TabsTrigger value="shareholders" className="flex items-center gap-2">
            <Users className="h-4 w-4" />
            Shareholder Registry
          </TabsTrigger>
        </TabsList>

        {/* ── Event Calendar ─────────────────────────────────────────────── */}
        <TabsContent value="events">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold">Corporate Events</h2>
            <Select value={eventFilter} onValueChange={setEventFilter}>
              <SelectTrigger className="w-48">
                <SelectValue placeholder="All event types" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All Types</SelectItem>
                {Object.entries(EVENT_TYPE_LABELS).map(([k, v]) => (
                  <SelectItem key={k} value={k}>{v}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {eventsLoading ? (
            <div className="grid gap-4">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-32 rounded-lg bg-muted animate-pulse" />
              ))}
            </div>
          ) : events.length === 0 ? (
            <div className="text-center py-16 text-muted-foreground">
              <Calendar className="h-12 w-12 mx-auto mb-3 opacity-30" />
              <p>No events found</p>
            </div>
          ) : (
            <div className="grid gap-4">
              {events.map((event) => {
                const epsVariance = getEpsVariance(event.epsActual, event.epsEstimate);
                const subscribed = isSubscribed(event.companySymbol);
  if (eventsLoading) return <PageSkeleton cards={4} tableRows={8} tableCols={4} />;
                return (
                  <Card key={event.id} className="hover:shadow-md transition-shadow">
                    <CardContent className="pt-4">
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1 flex-wrap">
                            <span className="font-bold text-sm bg-primary/10 text-primary px-2 py-0.5 rounded">
                              {event.companySymbol}
                            </span>
                            <Badge className={`text-xs ${EVENT_TYPE_COLORS[event.eventType] || "bg-gray-100 text-gray-800"}`}>
                              {EVENT_TYPE_LABELS[event.eventType] || event.eventType}
                            </Badge>
                          </div>
                          <h3 className="font-semibold text-foreground">{event.title}</h3>
                          {event.description && (
                            <p className="text-sm text-muted-foreground mt-1 line-clamp-2">{event.description}</p>
                          )}

                          {/* Dividend details */}
                          {event.dividendPerShare && (
                            <div className="mt-2 flex flex-wrap gap-4 text-sm">
                              <span className="text-green-600 font-medium">
                                Dividend: {event.dividendCurrency || "NGN"} {parseFloat(event.dividendPerShare).toFixed(4)} per share
                              </span>
                              {event.exDividendDate && (
                                <span className="text-muted-foreground">
                                  Ex-date: {new Date(event.exDividendDate).toLocaleDateString()}
                                </span>
                              )}
                              {event.paymentDate && (
                                <span className="text-muted-foreground">
                                  Payment: {new Date(event.paymentDate).toLocaleDateString()}
                                </span>
                              )}
                            </div>
                          )}

                          {/* Earnings details */}
                          {event.epsActual && (
                            <div className="mt-2 flex flex-wrap gap-4 text-sm">
                              <span className="text-foreground">
                                EPS: <strong>{parseFloat(event.epsActual).toFixed(4)}</strong>
                                {event.epsEstimate && (
                                  <span className="text-muted-foreground ml-1">
                                    (est. {parseFloat(event.epsEstimate).toFixed(4)})
                                  </span>
                                )}
                              </span>
                              {epsVariance !== null && (
                                <span className={`flex items-center gap-1 font-medium ${epsVariance >= 0 ? "text-green-600" : "text-red-600"}`}>
                                  {epsVariance >= 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                                  {epsVariance >= 0 ? "+" : ""}{epsVariance.toFixed(1)}% vs est.
                                </span>
                              )}
                            </div>
                          )}

                          <div className="mt-2 flex items-center gap-4 text-xs text-muted-foreground">
                            <span className="flex items-center gap-1">
                              <Calendar className="h-3 w-3" />
                              {new Date(event.eventDate).toLocaleDateString("en-NG", {
                                weekday: "short", year: "numeric", month: "short", day: "numeric",
                              })}
                              {!event.isAllDay && ` at ${new Date(event.eventDate).toLocaleTimeString("en-NG", { hour: "2-digit", minute: "2-digit" })}`}
                            </span>
                            {event.venue && <span>{event.venue}</span>}
                          </div>
                        </div>

                        <div className="flex flex-col items-end gap-2 shrink-0">
                          {event.webcastUrl && (
                            <Button size="sm" variant="outline" asChild>
                              <a href={event.webcastUrl} target="_blank" rel="noopener noreferrer">
                                <ExternalLink className="h-3 w-3 mr-1" />
                                Webcast
                              </a>
                            </Button>
                          )}
                          <Button
                            size="sm"
                            variant={subscribed ? "default" : "outline"}
                            onClick={() => toggleSubscription(event.companySymbol)}
                          >
                            {subscribed ? (
                              <><BellOff className="h-3 w-3 mr-1" />Unsubscribe</>
                            ) : (
                              <><Bell className="h-3 w-3 mr-1" />Subscribe</>
                            )}
                          </Button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>

        {/* ── Document Library ───────────────────────────────────────────── */}
        <TabsContent value="documents">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold">Document Library</h2>
            <Select value={docFilter} onValueChange={setDocFilter}>
              <SelectTrigger className="w-48">
                <SelectValue placeholder="All document types" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All Types</SelectItem>
                {Object.entries(DOC_TYPE_LABELS).map(([k, v]) => (
                  <SelectItem key={k} value={k}>{v}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {docsLoading ? (
            <div className="grid gap-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-20 rounded-lg bg-muted animate-pulse" />
              ))}
            </div>
          ) : documents.length === 0 ? (
            <div className="text-center py-16 text-muted-foreground">
              <FileText className="h-12 w-12 mx-auto mb-3 opacity-30" />
              <p>No documents found</p>
            </div>
          ) : (
            <div className="grid gap-3">
              {documents.map((doc) => (
                <Card key={doc.id} className="hover:shadow-md transition-shadow">
                  <CardContent className="pt-4">
                    <div className="flex items-center justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          <span className="font-bold text-sm bg-primary/10 text-primary px-2 py-0.5 rounded">
                            {doc.companySymbol}
                          </span>
                          <Badge variant="outline" className="text-xs">
                            {DOC_TYPE_LABELS[doc.documentType] || doc.documentType}
                          </Badge>
                          {doc.fiscalYear && (
                            <Badge variant="secondary" className="text-xs">
                              {doc.fiscalPeriod ? `${doc.fiscalPeriod} ` : ""}{doc.fiscalYear}
                            </Badge>
                          )}
                        </div>
                        <h3 className="font-medium text-foreground truncate">{doc.title}</h3>
                        {doc.description && (
                          <p className="text-sm text-muted-foreground mt-0.5 line-clamp-1">{doc.description}</p>
                        )}
                        <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                          <span>{new Date(doc.createdAt).toLocaleDateString()}</span>
                          {doc.fileSizeBytes && (
                            <span>{(doc.fileSizeBytes / 1024 / 1024).toFixed(1)} MB</span>
                          )}
                          <span>{doc.downloadCount} downloads</span>
                        </div>
                      </div>
                      <Button
                        size="sm"
                        onClick={() => downloadDoc.mutate({ id: doc.id })}
                        disabled={downloadDoc.isPending}
                      >
                        <Download className="h-3 w-3 mr-1" />
                        Download
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* ── Shareholder Registry ───────────────────────────────────────── */}
        <TabsContent value="shareholders">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold">Shareholder Registry</h2>
            <div className="flex items-center gap-2">
              <Input
                placeholder="Company symbol"
                value={shareholderSymbol}
                onChange={(e) => setShareholderSymbol(e.target.value.toUpperCase())}
                className="w-40"
              />
            </div>
          </div>

          {shareholdersLoading ? (
            <div className="h-64 rounded-lg bg-muted animate-pulse" />
          ) : !shareholderData || shareholderData.shareholders.length === 0 ? (
            <div className="text-center py-16 text-muted-foreground">
              <Users className="h-12 w-12 mx-auto mb-3 opacity-30" />
              <p>No shareholder data for {shareholderSymbol}</p>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-4">
                <Card>
                  <CardContent className="pt-4">
                    <div className="text-2xl font-bold">{shareholderData.shareholders.length}</div>
                    <div className="text-sm text-muted-foreground">Registered Shareholders</div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-4">
                    <div className="text-2xl font-bold">
                      {parseFloat(shareholderData.totalShares.toString()).toLocaleString()}
                    </div>
                    <div className="text-sm text-muted-foreground">Total Shares Outstanding</div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-4">
                    <div className="text-2xl font-bold">{parseFloat(shareholderData.topHoldersPct).toFixed(2)}%</div>
                    <div className="text-sm text-muted-foreground">Top Holders Concentration</div>
                  </CardContent>
                </Card>
              </div>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Top Shareholders — {shareholderSymbol}</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b text-muted-foreground">
                          <th className="text-left py-2 pr-4">#</th>
                          <th className="text-left py-2 pr-4">Shareholder</th>
                          <th className="text-left py-2 pr-4">Type</th>
                          <th className="text-right py-2 pr-4">Shares Held</th>
                          <th className="text-right py-2">Holding %</th>
                        </tr>
                      </thead>
                      <tbody>
                        {shareholderData.shareholders.map((s, idx) => (
                          <tr key={s.id} className="border-b last:border-0 hover:bg-muted/30">
                            <td className="py-2 pr-4 text-muted-foreground">{idx + 1}</td>
                            <td className="py-2 pr-4 font-medium">{s.shareholderName}</td>
                            <td className="py-2 pr-4">
                              <Badge variant="outline" className="text-xs">{s.shareholderType}</Badge>
                            </td>
                            <td className="py-2 pr-4 text-right font-mono">
                              {parseFloat(s.sharesHeld).toLocaleString()}
                            </td>
                            <td className="py-2 text-right">
                              <div className="flex items-center justify-end gap-2">
                                <div className="w-20 bg-muted rounded-full h-1.5">
                                  <div
                                    className="bg-primary h-1.5 rounded-full"
                                    style={{ width: `${Math.min(parseFloat(s.holdingPct), 100)}%` }}
                                  />
                                </div>
                                <span className="font-medium w-12 text-right">
                                  {parseFloat(s.holdingPct).toFixed(2)}%
                                </span>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
