import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { toast } from "sonner";
import { PageSkeleton } from "@/components/PageSkeleton";
import {
  Calendar,
  FileText,
  Users,
  Plus,
  Eye,
  EyeOff,
  Trash2,
  BarChart3,
  Download,
} from "lucide-react";

export default function IRAdmin() {
  const [createEventOpen, setCreateEventOpen] = useState(false);
  const [createDocOpen, setCreateDocOpen] = useState(false);
  const [createShareholderOpen, setCreateShareholderOpen] = useState(false);

  // Event form state
  const [eventForm, setEventForm] = useState({
    companySymbol: "",
    companyName: "",
    eventType: "EARNINGS_RELEASE",
    title: "",
    description: "",
    eventDate: "",
    venue: "",
    webcastUrl: "",
    dividendPerShare: "",
    dividendCurrency: "NGN",
    exDividendDate: "",
    recordDate: "",
    paymentDate: "",
    epsActual: "",
    epsEstimate: "",
    revenueActual: "",
    revenueEstimate: "",
  });

  // Document form state
  const [docForm, setDocForm] = useState({
    companySymbol: "",
    companyName: "",
    documentType: "ANNUAL_REPORT",
    title: "",
    description: "",
    fiscalYear: "",
    fiscalPeriod: "",
    fileUrl: "",
    fileKey: "",
    fileSizeBytes: "",
    mimeType: "application/pdf",
  });

  // Shareholder form state
  const [shareholderForm, setShareholderForm] = useState({
    companySymbol: "",
    userId: "",
    shareholderName: "",
    shareholderType: "INDIVIDUAL",
    sharesHeld: "",
    totalShares: "",
    acquisitionDate: "",
  });

  const utils = trpc.useUtils();

  const { data: stats, isLoading: statsLoading } = trpc.investorRelations.adminGetStats.useQuery();
  const { data: allEventsData } = trpc.investorRelations.adminListAllEvents.useQuery();
  const allEvents = allEventsData?.events ?? [];
  const { data: allDocuments = [] } = trpc.investorRelations.adminListAllDocuments.useQuery();

  const createEvent = trpc.investorRelations.adminCreateEvent.useMutation({
    onSuccess: () => {
      toast.success("Event created");
      setCreateEventOpen(false);
      utils.investorRelations.adminListAllEvents.invalidate();
      utils.investorRelations.adminGetStats.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  const publishEvent = trpc.investorRelations.adminPublishEvent.useMutation({
    onSuccess: (data) => {
      toast.success(data.isPublished ? "Event published" : "Event unpublished");
      utils.investorRelations.adminListAllEvents.invalidate();
      utils.investorRelations.adminGetStats.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  const deleteEvent = trpc.investorRelations.adminDeleteEvent.useMutation({
    onSuccess: () => {
      toast.success("Event deleted");
      utils.investorRelations.adminListAllEvents.invalidate();
      utils.investorRelations.adminGetStats.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  const createDoc = trpc.investorRelations.adminCreateDocument.useMutation({
    onSuccess: () => {
      toast.success("Document created");
      setCreateDocOpen(false);
      utils.investorRelations.adminListAllDocuments.invalidate();
      utils.investorRelations.adminGetStats.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  const publishDoc = trpc.investorRelations.adminPublishDocument.useMutation({
    onSuccess: (data) => {
      toast.success(data.isPublished ? "Document published" : "Document unpublished");
      utils.investorRelations.adminListAllDocuments.invalidate();
      utils.investorRelations.adminGetStats.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  const deleteDoc = trpc.investorRelations.adminDeleteDocument.useMutation({
    onSuccess: () => {
      toast.success("Document deleted");
      utils.investorRelations.adminListAllDocuments.invalidate();
      utils.investorRelations.adminGetStats.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  const createShareholder = trpc.investorRelations.adminUpsertShareholder.useMutation({
    onSuccess: () => {
      toast.success("Shareholder record saved");
      setCreateShareholderOpen(false);
      utils.investorRelations.adminGetStats.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  const handleCreateEvent = () => {
    if (!eventForm.companySymbol || !eventForm.title || !eventForm.eventDate) {
      toast.error("Symbol, title, and date are required");
      return;
    }
    createEvent.mutate({
      companySymbol: eventForm.companySymbol,
      companyName: eventForm.companyName || eventForm.companySymbol,
      eventType: eventForm.eventType as any,
      title: eventForm.title,
      description: eventForm.description || undefined,
      eventDate: eventForm.eventDate,
      venue: eventForm.venue || undefined,
      webcastUrl: eventForm.webcastUrl || undefined,
      dividendPerShare: eventForm.dividendPerShare || undefined,
      dividendCurrency: eventForm.dividendCurrency || undefined,
      exDividendDate: eventForm.exDividendDate || undefined,
      recordDate: eventForm.recordDate || undefined,
      paymentDate: eventForm.paymentDate || undefined,
      epsActual: eventForm.epsActual || undefined,
      epsEstimate: eventForm.epsEstimate || undefined,
      revenueActual: eventForm.revenueActual || undefined,
      revenueEstimate: eventForm.revenueEstimate || undefined,
    });
  };

  const handleCreateDoc = () => {
    if (!docForm.companySymbol || !docForm.title || !docForm.fileUrl || !docForm.fileKey) {
      toast.error("Symbol, title, and file URL/key are required");
      return;
    }
    createDoc.mutate({
      companySymbol: docForm.companySymbol,
      companyName: docForm.companyName || docForm.companySymbol,
      documentType: docForm.documentType as any,
      title: docForm.title,
      description: docForm.description || undefined,
      fiscalYear: docForm.fiscalYear ? parseInt(docForm.fiscalYear) : undefined,
      fiscalPeriod: docForm.fiscalPeriod || undefined,
      fileUrl: docForm.fileUrl,
      fileKey: docForm.fileKey,
      fileSizeBytes: docForm.fileSizeBytes ? parseInt(docForm.fileSizeBytes) : undefined,
      mimeType: docForm.mimeType,
    });
  };

  const handleCreateShareholder = () => {
    if (!shareholderForm.companySymbol || !shareholderForm.shareholderName || !shareholderForm.userId) {
      toast.error("Symbol, name, and user ID are required");
      return;
    }
    createShareholder.mutate({
      companySymbol: shareholderForm.companySymbol,
      userId: parseInt(shareholderForm.userId),
      shareholderName: shareholderForm.shareholderName,
      shareholderType: shareholderForm.shareholderType as any,
      sharesHeld: shareholderForm.sharesHeld,
      totalShares: shareholderForm.totalShares,
      acquisitionDate: shareholderForm.acquisitionDate || undefined,
    });
  };

  if (statsLoading) return <PageSkeleton cards={4} tableRows={8} tableCols={5} />;
  return (
    <div className="container py-8 max-w-7xl">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-foreground">IR Administration</h1>
        <p className="text-muted-foreground mt-1">Manage investor relations events, documents, and shareholder data</p>
      </div>

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center gap-2 mb-1">
                <Calendar className="h-4 w-4 text-blue-500" />
                <span className="text-sm text-muted-foreground">Events</span>
              </div>
              <div className="text-2xl font-bold">{stats.totalEvents}</div>
              <div className="text-xs text-muted-foreground">{stats.publishedEvents} published</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center gap-2 mb-1">
                <FileText className="h-4 w-4 text-green-500" />
                <span className="text-sm text-muted-foreground">Documents</span>
              </div>
              <div className="text-2xl font-bold">{stats.totalDocuments}</div>
              <div className="text-xs text-muted-foreground">{stats.totalDownloads} downloads</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center gap-2 mb-1">
                <Users className="h-4 w-4 text-purple-500" />
                <span className="text-sm text-muted-foreground">Shareholders</span>
              </div>
              <div className="text-2xl font-bold">{stats.totalShareholders}</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center gap-2 mb-1">
                <BarChart3 className="h-4 w-4 text-orange-500" />
                <span className="text-sm text-muted-foreground">Subscriptions</span>
              </div>
              <div className="text-2xl font-bold">{stats.totalSubscriptions}</div>
            </CardContent>
          </Card>
        </div>
      )}

      <Tabs defaultValue="events">
        <TabsList className="mb-6">
          <TabsTrigger value="events">Events</TabsTrigger>
          <TabsTrigger value="documents">Documents</TabsTrigger>
          <TabsTrigger value="shareholders">Shareholders</TabsTrigger>
        </TabsList>

        {/* ── Events Tab ─────────────────────────────────────────────────── */}
        <TabsContent value="events">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold">Corporate Events ({allEvents.length})</h2>
            <Dialog open={createEventOpen} onOpenChange={setCreateEventOpen}>
              <DialogTrigger asChild>
                <Button size="sm"><Plus className="h-4 w-4 mr-1" />Add Event</Button>
              </DialogTrigger>
              <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle>Create IR Event</DialogTitle>
                </DialogHeader>
                <div className="grid grid-cols-2 gap-3 mt-4">
                  <div>
                    <Label>Company Symbol *</Label>
                    <Input value={eventForm.companySymbol} onChange={(e) => setEventForm(f => ({ ...f, companySymbol: e.target.value.toUpperCase() }))} placeholder="DANGCEM" />
                  </div>
                  <div>
                    <Label>Company Name</Label>
                    <Input value={eventForm.companyName} onChange={(e) => setEventForm(f => ({ ...f, companyName: e.target.value }))} placeholder="Dangote Cement PLC" />
                  </div>
                  <div>
                    <Label>Event Type *</Label>
                    <Select value={eventForm.eventType} onValueChange={(v) => setEventForm(f => ({ ...f, eventType: v }))}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {["EARNINGS_RELEASE","DIVIDEND_ANNOUNCEMENT","AGM","EGM","RIGHTS_ISSUE","BONUS_ISSUE","STOCK_SPLIT","MERGER_ACQUISITION","REGULATORY_FILING","INVESTOR_PRESENTATION","ROADSHOW","OTHER"].map(t => (
                          <SelectItem key={t} value={t}>{t.replace(/_/g, " ")}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Event Date *</Label>
                    <Input type="datetime-local" value={eventForm.eventDate} onChange={(e) => setEventForm(f => ({ ...f, eventDate: e.target.value }))} />
                  </div>
                  <div className="col-span-2">
                    <Label>Title *</Label>
                    <Input value={eventForm.title} onChange={(e) => setEventForm(f => ({ ...f, title: e.target.value }))} placeholder="Q3 2025 Earnings Release" />
                  </div>
                  <div className="col-span-2">
                    <Label>Description</Label>
                    <Textarea value={eventForm.description} onChange={(e) => setEventForm(f => ({ ...f, description: e.target.value }))} rows={2} />
                  </div>
                  <div>
                    <Label>Venue</Label>
                    <Input value={eventForm.venue} onChange={(e) => setEventForm(f => ({ ...f, venue: e.target.value }))} />
                  </div>
                  <div>
                    <Label>Webcast URL</Label>
                    <Input value={eventForm.webcastUrl} onChange={(e) => setEventForm(f => ({ ...f, webcastUrl: e.target.value }))} placeholder="https://..." />
                  </div>
                  {eventForm.eventType === "DIVIDEND_ANNOUNCEMENT" && <>
                    <div>
                      <Label>Dividend Per Share</Label>
                      <Input value={eventForm.dividendPerShare} onChange={(e) => setEventForm(f => ({ ...f, dividendPerShare: e.target.value }))} placeholder="0.50" />
                    </div>
                    <div>
                      <Label>Currency</Label>
                      <Input value={eventForm.dividendCurrency} onChange={(e) => setEventForm(f => ({ ...f, dividendCurrency: e.target.value }))} placeholder="NGN" />
                    </div>
                    <div>
                      <Label>Ex-Dividend Date</Label>
                      <Input type="date" value={eventForm.exDividendDate} onChange={(e) => setEventForm(f => ({ ...f, exDividendDate: e.target.value }))} />
                    </div>
                    <div>
                      <Label>Payment Date</Label>
                      <Input type="date" value={eventForm.paymentDate} onChange={(e) => setEventForm(f => ({ ...f, paymentDate: e.target.value }))} />
                    </div>
                  </>}
                  {eventForm.eventType === "EARNINGS_RELEASE" && <>
                    <div>
                      <Label>EPS Actual</Label>
                      <Input value={eventForm.epsActual} onChange={(e) => setEventForm(f => ({ ...f, epsActual: e.target.value }))} placeholder="2.45" />
                    </div>
                    <div>
                      <Label>EPS Estimate</Label>
                      <Input value={eventForm.epsEstimate} onChange={(e) => setEventForm(f => ({ ...f, epsEstimate: e.target.value }))} placeholder="2.30" />
                    </div>
                    <div>
                      <Label>Revenue Actual (₦)</Label>
                      <Input value={eventForm.revenueActual} onChange={(e) => setEventForm(f => ({ ...f, revenueActual: e.target.value }))} />
                    </div>
                    <div>
                      <Label>Revenue Estimate (₦)</Label>
                      <Input value={eventForm.revenueEstimate} onChange={(e) => setEventForm(f => ({ ...f, revenueEstimate: e.target.value }))} />
                    </div>
                  </>}
                </div>
                <Button className="w-full mt-4" onClick={handleCreateEvent} disabled={createEvent.isPending}>
                  Create Event
                </Button>
              </DialogContent>
            </Dialog>
          </div>

          <div className="space-y-3">
            {allEvents.map((event) => (
              <Card key={event.id}>
                <CardContent className="pt-3 pb-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className="font-bold text-xs bg-primary/10 text-primary px-1.5 py-0.5 rounded">{event.companySymbol}</span>
                        <Badge variant="outline" className="text-xs">{event.eventType.replace(/_/g, " ")}</Badge>
                        <Badge variant={event.isPublished ? "default" : "secondary"} className="text-xs">
                          {event.isPublished ? "Published" : "Draft"}
                        </Badge>
                      </div>
                      <p className="font-medium text-sm truncate">{event.title}</p>
                      <p className="text-xs text-muted-foreground">{new Date(event.eventDate).toLocaleDateString()}</p>
                    </div>
                    <div className="flex items-center gap-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => publishEvent.mutate({ id: event.id, publish: !event.isPublished })}
                        title={event.isPublished ? "Unpublish" : "Publish"}
                      >
                        {event.isPublished ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-destructive hover:text-destructive"
                        onClick={() => { if (confirm("Delete this event?")) deleteEvent.mutate({ id: event.id }); }}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
            {allEvents.length === 0 && (
              <div className="text-center py-12 text-muted-foreground">
                <Calendar className="h-10 w-10 mx-auto mb-2 opacity-30" />
                <p>No events yet. Add your first corporate event.</p>
              </div>
            )}
          </div>
        </TabsContent>

        {/* ── Documents Tab ──────────────────────────────────────────────── */}
        <TabsContent value="documents">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold">Documents ({allDocuments.length})</h2>
            <Dialog open={createDocOpen} onOpenChange={setCreateDocOpen}>
              <DialogTrigger asChild>
                <Button size="sm"><Plus className="h-4 w-4 mr-1" />Add Document</Button>
              </DialogTrigger>
              <DialogContent className="max-w-xl max-h-[80vh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle>Add IR Document</DialogTitle>
                </DialogHeader>
                <div className="grid grid-cols-2 gap-3 mt-4">
                  <div>
                    <Label>Company Symbol *</Label>
                    <Input value={docForm.companySymbol} onChange={(e) => setDocForm(f => ({ ...f, companySymbol: e.target.value.toUpperCase() }))} />
                  </div>
                  <div>
                    <Label>Company Name</Label>
                    <Input value={docForm.companyName} onChange={(e) => setDocForm(f => ({ ...f, companyName: e.target.value }))} />
                  </div>
                  <div>
                    <Label>Document Type *</Label>
                    <Select value={docForm.documentType} onValueChange={(v) => setDocForm(f => ({ ...f, documentType: v }))}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {["ANNUAL_REPORT","INTERIM_REPORT","QUARTERLY_REPORT","PROSPECTUS","CIRCULAR","PRESS_RELEASE","PRESENTATION","FINANCIAL_STATEMENT","REGULATORY_FILING","OTHER"].map(t => (
                          <SelectItem key={t} value={t}>{t.replace(/_/g, " ")}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Fiscal Year</Label>
                    <Input type="number" value={docForm.fiscalYear} onChange={(e) => setDocForm(f => ({ ...f, fiscalYear: e.target.value }))} placeholder="2025" />
                  </div>
                  <div className="col-span-2">
                    <Label>Title *</Label>
                    <Input value={docForm.title} onChange={(e) => setDocForm(f => ({ ...f, title: e.target.value }))} placeholder="Annual Report 2024" />
                  </div>
                  <div className="col-span-2">
                    <Label>File URL * (CDN URL from S3)</Label>
                    <Input value={docForm.fileUrl} onChange={(e) => setDocForm(f => ({ ...f, fileUrl: e.target.value }))} placeholder="https://cdn.example.com/..." />
                  </div>
                  <div className="col-span-2">
                    <Label>File Key *</Label>
                    <Input value={docForm.fileKey} onChange={(e) => setDocForm(f => ({ ...f, fileKey: e.target.value }))} placeholder="ir-docs/annual-report-2024.pdf" />
                  </div>
                </div>
                <Button className="w-full mt-4" onClick={handleCreateDoc} disabled={createDoc.isPending}>
                  Add Document
                </Button>
              </DialogContent>
            </Dialog>
          </div>

          <div className="space-y-3">
            {allDocuments.map((doc) => (
              <Card key={doc.id}>
                <CardContent className="pt-3 pb-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className="font-bold text-xs bg-primary/10 text-primary px-1.5 py-0.5 rounded">{doc.companySymbol}</span>
                        <Badge variant="outline" className="text-xs">{doc.documentType.replace(/_/g, " ")}</Badge>
                        {doc.fiscalYear && <Badge variant="secondary" className="text-xs">{doc.fiscalYear}</Badge>}
                        <Badge variant={doc.isPublished ? "default" : "secondary"} className="text-xs">
                          {doc.isPublished ? "Published" : "Draft"}
                        </Badge>
                      </div>
                      <p className="font-medium text-sm truncate">{doc.title}</p>
                      <p className="text-xs text-muted-foreground">{doc.downloadCount} downloads</p>
                    </div>
                    <div className="flex items-center gap-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => publishDoc.mutate({ id: doc.id, publish: !doc.isPublished })}
                        title={doc.isPublished ? "Unpublish" : "Publish"}
                      >
                        {doc.isPublished ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-destructive hover:text-destructive"
                        onClick={() => { if (confirm("Delete this document?")) deleteDoc.mutate({ id: doc.id }); }}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
            {allDocuments.length === 0 && (
              <div className="text-center py-12 text-muted-foreground">
                <FileText className="h-10 w-10 mx-auto mb-2 opacity-30" />
                <p>No documents yet. Add your first IR document.</p>
              </div>
            )}
          </div>
        </TabsContent>

        {/* ── Shareholders Tab ───────────────────────────────────────────── */}
        <TabsContent value="shareholders">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold">Shareholder Registry</h2>
            <Dialog open={createShareholderOpen} onOpenChange={setCreateShareholderOpen}>
              <DialogTrigger asChild>
                <Button size="sm"><Plus className="h-4 w-4 mr-1" />Add / Update Shareholder</Button>
              </DialogTrigger>
              <DialogContent className="max-w-xl">
                <DialogHeader>
                  <DialogTitle>Add / Update Shareholder</DialogTitle>
                </DialogHeader>
                <div className="grid grid-cols-2 gap-3 mt-4">
                  <div>
                    <Label>Company Symbol *</Label>
                    <Input value={shareholderForm.companySymbol} onChange={(e) => setShareholderForm(f => ({ ...f, companySymbol: e.target.value.toUpperCase() }))} />
                  </div>
                  <div>
                    <Label>User ID *</Label>
                    <Input type="number" value={shareholderForm.userId} onChange={(e) => setShareholderForm(f => ({ ...f, userId: e.target.value }))} />
                  </div>
                  <div className="col-span-2">
                    <Label>Shareholder Name *</Label>
                    <Input value={shareholderForm.shareholderName} onChange={(e) => setShareholderForm(f => ({ ...f, shareholderName: e.target.value }))} />
                  </div>
                  <div>
                    <Label>Type</Label>
                    <Select value={shareholderForm.shareholderType} onValueChange={(v) => setShareholderForm(f => ({ ...f, shareholderType: v }))}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {["INDIVIDUAL","INSTITUTIONAL","INSIDER","GOVERNMENT"].map(t => (
                          <SelectItem key={t} value={t}>{t}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Acquisition Date</Label>
                    <Input type="date" value={shareholderForm.acquisitionDate} onChange={(e) => setShareholderForm(f => ({ ...f, acquisitionDate: e.target.value }))} />
                  </div>
                  <div>
                    <Label>Shares Held *</Label>
                    <Input value={shareholderForm.sharesHeld} onChange={(e) => setShareholderForm(f => ({ ...f, sharesHeld: e.target.value }))} placeholder="1000000" />
                  </div>
                  <div>
                    <Label>Total Shares Outstanding *</Label>
                    <Input value={shareholderForm.totalShares} onChange={(e) => setShareholderForm(f => ({ ...f, totalShares: e.target.value }))} placeholder="10000000" />
                  </div>
                </div>
                <Button className="w-full mt-4" onClick={handleCreateShareholder} disabled={createShareholder.isPending}>
                  Save Shareholder
                </Button>
              </DialogContent>
            </Dialog>
          </div>
          <div className="text-center py-12 text-muted-foreground">
            <Users className="h-10 w-10 mx-auto mb-2 opacity-30" />
            <p>Use the "Add / Update Shareholder" button to manage registry entries.</p>
            <p className="text-xs mt-1">View shareholder data on the public IR Portal page.</p>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
