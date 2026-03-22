/**
 * NEXCOM Exchange — Blockchain Tokenization
 * Commodity tokenization, fractional ownership, IPFS metadata,
 * on-chain settlement, and cross-chain bridge operations.
 * Uses blockchainRouter: health, getChainStatus, tokenizeCommodity,
 * listTokens, transferToken, fractionalizeToken, getMyFractionPortfolio,
 * ipfsStatus, getBlockNumber.
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Link2, Coins, RefreshCw, Activity, Shield, Globe, Database, Layers } from "lucide-react";

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    ONLINE: "bg-green-500/10 text-green-400 border-green-500/30",
    OFFLINE: "bg-red-500/10 text-red-400 border-red-500/30",
    ACTIVE: "bg-green-500/10 text-green-400 border-green-500/30",
    PENDING: "bg-yellow-500/10 text-yellow-400 border-yellow-500/30",
    CONFIRMED: "bg-green-500/10 text-green-400 border-green-500/30",
    FAILED: "bg-red-500/10 text-red-400 border-red-500/30",
    CONNECTED: "bg-green-500/10 text-green-400 border-green-500/30",
    DISCONNECTED: "bg-red-500/10 text-red-400 border-red-500/30",
  };
  return <Badge variant="outline" className={map[status] ?? "bg-muted/50 text-muted-foreground"}>{status}</Badge>;
}

const COMMODITY_TYPES = ["MAIZE", "WHEAT", "SORGHUM", "RICE", "SOYBEANS", "COTTON", "COCOA", "COFFEE", "SESAME", "GROUNDNUT", "PALM_OIL", "CASSAVA"];

export default function BlockchainTokenization() {
  const { user } = useAuth();
  const [tokenizePage, setTokenizePage] = useState(1);
  const [showTokenizeDialog, setShowTokenizeDialog] = useState(false);
  const [showTransferDialog, setShowTransferDialog] = useState(false);
  const [showFractionalizeDialog, setShowFractionalizeDialog] = useState(false);
  const [selectedTokenId, setSelectedTokenId] = useState("");

  // Tokenize form state
  const [commodityId, setCommodityId] = useState("");
  const [commodityType, setCommodityType] = useState("MAIZE");
  const [quantity, setQuantity] = useState("100");
  const [unit, setUnit] = useState("MT");
  const [warehouseReceiptId, setWarehouseReceiptId] = useState("");

  // Transfer form state
  const [transferTo, setTransferTo] = useState("");
  const [transferAmount, setTransferAmount] = useState("1");

  // Fractionalize form state
  const [fractions, setFractions] = useState("100");
  const [fractionPrice, setFractionPrice] = useState("1000");

  const { data: health } = trpc.blockchain.health.useQuery(undefined, { refetchInterval: 15000 });
  const { data: chainStatus, refetch: refetchChains } = trpc.blockchain.getChainStatus.useQuery(undefined, { refetchInterval: 30000 });
  const { data: tokens, refetch: refetchTokens } = trpc.blockchain.listTokens.useQuery({ page: tokenizePage, limit: 20 }, { refetchInterval: 60000 });
  const { data: myPortfolio } = trpc.blockchain.getMyFractionPortfolio.useQuery(undefined, { enabled: !!user, refetchInterval: 60000 });
  const { data: ipfsStatus } = trpc.blockchain.ipfsStatus.useQuery(undefined, { refetchInterval: 30000 });
  const { data: blockNumber } = trpc.blockchain.getBlockNumber.useQuery(undefined, { refetchInterval: 15000 });

  const tokenizeMutation = trpc.blockchain.tokenizeCommodity.useMutation({
    onSuccess: (data) => {
      const d = data as { error?: string; token_id?: string };
      if (d.error) { toast.error(d.error); return; }
      toast.success(`Commodity tokenized! Token ID: ${d.token_id ?? "created"}`);
      setShowTokenizeDialog(false);
      refetchTokens();
    },
    onError: (e: { message: string }) => toast.error(e.message),
  });

  const transferMutation = trpc.blockchain.transferToken.useMutation({
    onSuccess: (data) => {
      const d = data as { error?: string; tx_hash?: string };
      if (d.error) { toast.error(d.error); return; }
      toast.success(`Transfer submitted! TX: ${d.tx_hash ?? "pending"}`);
      setShowTransferDialog(false);
      refetchTokens();
    },
    onError: (e: { message: string }) => toast.error(e.message),
  });

  const fractionalizeMutation = trpc.blockchain.fractionalizeToken.useMutation({
    onSuccess: (data) => {
      const d = data as { error?: string };
      if (d.error) { toast.error(d.error); return; }
      toast.success("Token fractionalized successfully");
      setShowFractionalizeDialog(false);
      refetchTokens();
    },
    onError: (e: { message: string }) => toast.error(e.message),
  });

  const tokensData = tokens as { tokens?: Record<string, unknown>[]; total?: number; error?: string } | undefined;
  const tokensArr = Array.isArray(tokensData?.tokens) ? tokensData.tokens : [];
  const chainsData = chainStatus as { chains?: Record<string, unknown>[]; error?: string } | undefined;
  const chainsArr = Array.isArray(chainsData?.chains) ? chainsData.chains : [];
  const portfolioData = myPortfolio as { fractions?: Record<string, unknown>[]; error?: string } | undefined;
  const portfolioArr = Array.isArray(portfolioData?.fractions) ? portfolioData.fractions : [];
  const ipfsData = ipfsStatus as { online?: boolean; peer_count?: number; error?: string } | undefined;
  const blockNum = blockNumber as { block_number?: number; chain?: string; error?: string } | undefined;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Link2 className="w-6 h-6 text-cyan-400" />
            Blockchain Tokenization
          </h1>
          <p className="text-muted-foreground text-sm mt-1">Commodity tokenization, fractional ownership, IPFS metadata, and cross-chain bridge</p>
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge status={health?.online ? "ONLINE" : "OFFLINE"} />
          <Button variant="outline" size="sm" onClick={() => { refetchChains(); refetchTokens(); }}>
            <RefreshCw className="w-4 h-4 mr-1" /> Refresh
          </Button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="bg-card border-border"><CardContent className="p-4"><div className="flex items-center justify-between"><div><p className="text-xs text-muted-foreground">Total Tokens</p><p className="text-2xl font-bold text-foreground">{tokensData?.total ?? tokensArr.length}</p></div><Coins className="w-8 h-8 text-cyan-400 opacity-60" /></div></CardContent></Card>
        <Card className="bg-card border-border"><CardContent className="p-4"><div className="flex items-center justify-between"><div><p className="text-xs text-muted-foreground">Connected Chains</p><p className="text-2xl font-bold text-foreground">{chainsArr.length}</p></div><Globe className="w-8 h-8 text-purple-400 opacity-60" /></div></CardContent></Card>
        <Card className="bg-card border-border"><CardContent className="p-4"><div className="flex items-center justify-between"><div><p className="text-xs text-muted-foreground">IPFS Peers</p><p className="text-2xl font-bold text-foreground">{ipfsData?.peer_count ?? "—"}</p></div><Database className="w-8 h-8 text-green-400 opacity-60" /></div></CardContent></Card>
        <Card className="bg-card border-border"><CardContent className="p-4"><div className="flex items-center justify-between"><div><p className="text-xs text-muted-foreground">Block Number</p><p className="text-2xl font-bold text-foreground">{blockNum?.block_number?.toLocaleString() ?? "—"}</p></div><Activity className="w-8 h-8 text-blue-400 opacity-60" /></div></CardContent></Card>
      </div>

      <Tabs defaultValue="tokens">
        <TabsList className="bg-muted/30">
          <TabsTrigger value="tokens">Token Registry</TabsTrigger>
          <TabsTrigger value="portfolio">My Portfolio</TabsTrigger>
          <TabsTrigger value="chains">Chain Status</TabsTrigger>
          <TabsTrigger value="ipfs">IPFS Storage</TabsTrigger>
        </TabsList>

        {/* Token Registry */}
        <TabsContent value="tokens" className="mt-4">
          <Card className="bg-card border-border">
            <CardHeader>
              <div className="flex items-center justify-between">
                <div><CardTitle className="text-base">Tokenized Commodities</CardTitle><CardDescription>All on-chain commodity tokens</CardDescription></div>
                <Button onClick={() => setShowTokenizeDialog(true)} size="sm">
                  <Coins className="w-4 h-4 mr-2" /> Tokenize Commodity
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {tokensArr.length === 0 ? (
                <p className="text-center text-muted-foreground py-8">{health?.online ? "No tokens found" : "Blockchain service offline"}</p>
              ) : (
                <>
                  <Table>
                    <TableHeader><TableRow><TableHead>Token ID</TableHead><TableHead>Commodity</TableHead><TableHead className="text-right">Quantity</TableHead><TableHead>Unit</TableHead><TableHead>Owner</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader>
                    <TableBody>
                      {tokensArr.map((token: Record<string, unknown>, i: number) => (
                        <TableRow key={i}>
                          <TableCell className="font-mono text-xs">{String(token.token_id ?? token.id ?? "").slice(0, 12)}...</TableCell>
                          <TableCell className="font-semibold">{String(token.commodity_type ?? token.type ?? "")}</TableCell>
                          <TableCell className="text-right">{Number(token.quantity ?? 0).toLocaleString()}</TableCell>
                          <TableCell className="text-muted-foreground">{String(token.unit ?? "MT")}</TableCell>
                          <TableCell className="font-mono text-xs">{String(token.owner_id ?? token.owner ?? "").slice(0, 8)}...</TableCell>
                          <TableCell><StatusBadge status={String(token.status ?? "ACTIVE").toUpperCase()} /></TableCell>
                          <TableCell className="text-right">
                            <div className="flex gap-1 justify-end">
                              <Button size="sm" variant="outline" onClick={() => { setSelectedTokenId(String(token.token_id ?? token.id ?? "")); setShowTransferDialog(true); }}>Transfer</Button>
                              <Button size="sm" variant="outline" onClick={() => { setSelectedTokenId(String(token.token_id ?? token.id ?? "")); setShowFractionalizeDialog(true); }}>Fractionalize</Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  <div className="flex justify-between items-center mt-4">
                    <Button variant="outline" size="sm" disabled={tokenizePage <= 1} onClick={() => setTokenizePage(p => p - 1)}>Previous</Button>
                    <span className="text-xs text-muted-foreground">Page {tokenizePage}</span>
                    <Button variant="outline" size="sm" disabled={tokensArr.length < 20} onClick={() => setTokenizePage(p => p + 1)}>Next</Button>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* My Portfolio */}
        <TabsContent value="portfolio" className="mt-4">
          <Card className="bg-card border-border">
            <CardHeader><CardTitle className="text-base">My Fractional Portfolio</CardTitle><CardDescription>Your fractional token holdings</CardDescription></CardHeader>
            <CardContent>
              {portfolioArr.length === 0 ? (
                <p className="text-center text-muted-foreground py-8">{health?.online ? "No fractional holdings" : "Blockchain service offline"}</p>
              ) : (
                <Table>
                  <TableHeader><TableRow><TableHead>Token ID</TableHead><TableHead>Commodity</TableHead><TableHead className="text-right">Fractions</TableHead><TableHead className="text-right">Value</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {portfolioArr.map((f: Record<string, unknown>, i: number) => (
                      <TableRow key={i}>
                        <TableCell className="font-mono text-xs">{String(f.token_id ?? "").slice(0, 12)}...</TableCell>
                        <TableCell className="font-semibold">{String(f.commodity_type ?? "")}</TableCell>
                        <TableCell className="text-right">{Number(f.fraction_count ?? 0).toLocaleString()}</TableCell>
                        <TableCell className="text-right">₦{Number(f.total_value ?? 0).toLocaleString()}</TableCell>
                        <TableCell><StatusBadge status={String(f.status ?? "ACTIVE").toUpperCase()} /></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Chain Status */}
        <TabsContent value="chains" className="mt-4">
          <Card className="bg-card border-border">
            <CardHeader><CardTitle className="text-base">Connected Blockchain Networks</CardTitle></CardHeader>
            <CardContent>
              {chainsArr.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                  <Globe className="w-10 h-10 mb-2 text-muted-foreground/50" />
                  <p>{health?.online ? "No chains connected" : "Blockchain service offline"}</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {chainsArr.map((chain: Record<string, unknown>, i: number) => (
                    <div key={i} className="p-4 rounded-lg bg-muted/20 border border-border">
                      <div className="flex items-center justify-between mb-2">
                        <span className="font-semibold text-foreground">{String(chain.name ?? chain.chain ?? "")}</span>
                        <StatusBadge status={String(chain.status ?? "CONNECTED").toUpperCase()} />
                      </div>
                      <div className="space-y-1 text-xs text-muted-foreground">
                        <div className="flex justify-between"><span>Chain ID</span><span className="font-mono">{String(chain.chain_id ?? "—")}</span></div>
                        <div className="flex justify-between"><span>Block Height</span><span className="font-mono">{Number(chain.block_height ?? 0).toLocaleString()}</span></div>
                        <div className="flex justify-between"><span>Gas Price</span><span className="font-mono">{String(chain.gas_price ?? "—")}</span></div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* IPFS Storage */}
        <TabsContent value="ipfs" className="mt-4">
          <Card className="bg-card border-border">
            <CardHeader><CardTitle className="text-base">IPFS Decentralized Storage</CardTitle><CardDescription>Commodity metadata and document storage</CardDescription></CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="p-4 rounded-lg bg-muted/20 border border-border">
                  <p className="text-xs text-muted-foreground">IPFS Status</p>
                  <StatusBadge status={ipfsData?.online ? "ONLINE" : "OFFLINE"} />
                </div>
                <div className="p-4 rounded-lg bg-muted/20 border border-border">
                  <p className="text-xs text-muted-foreground">Connected Peers</p>
                  <p className="text-2xl font-bold text-foreground mt-1">{ipfsData?.peer_count ?? "—"}</p>
                </div>
                <div className="p-4 rounded-lg bg-muted/20 border border-border">
                  <p className="text-xs text-muted-foreground">Latest Block</p>
                  <p className="text-lg font-bold text-foreground mt-1">{blockNum?.block_number?.toLocaleString() ?? "—"}</p>
                  <p className="text-xs text-muted-foreground">{blockNum?.chain ?? ""}</p>
                </div>
              </div>
              {ipfsData?.error && (
                <div className="mt-4 p-3 rounded bg-yellow-500/10 border border-yellow-500/30">
                  <p className="text-xs text-yellow-400">{ipfsData.error}</p>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Tokenize Dialog */}
      <Dialog open={showTokenizeDialog} onOpenChange={setShowTokenizeDialog}>
        <DialogContent>
          <DialogHeader><DialogTitle>Tokenize Commodity</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div><Label className="text-xs text-muted-foreground">Commodity ID</Label><Input value={commodityId} onChange={(e) => setCommodityId(e.target.value)} placeholder="e.g. WR-2024-001" className="mt-1" /></div>
            <div>
              <Label className="text-xs text-muted-foreground">Commodity Type</Label>
              <Select value={commodityType} onValueChange={setCommodityType}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>{COMMODITY_TYPES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label className="text-xs text-muted-foreground">Quantity</Label><Input type="number" value={quantity} onChange={(e) => setQuantity(e.target.value)} className="mt-1" /></div>
              <div>
                <Label className="text-xs text-muted-foreground">Unit</Label>
                <Select value={unit} onValueChange={setUnit}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="MT">MT (Metric Ton)</SelectItem><SelectItem value="KG">KG</SelectItem><SelectItem value="BAG">BAG</SelectItem></SelectContent>
                </Select>
              </div>
            </div>
            <div><Label className="text-xs text-muted-foreground">Warehouse Receipt ID (optional)</Label><Input value={warehouseReceiptId} onChange={(e) => setWarehouseReceiptId(e.target.value)} placeholder="WR-..." className="mt-1" /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowTokenizeDialog(false)}>Cancel</Button>
            <Button onClick={() => tokenizeMutation.mutate({ commodityId, commodityType, quantity: parseFloat(quantity), unit, warehouseReceiptId: warehouseReceiptId || undefined })} disabled={tokenizeMutation.isPending || !commodityId}>
              {tokenizeMutation.isPending ? "Tokenizing..." : "Tokenize"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Transfer Dialog */}
      <Dialog open={showTransferDialog} onOpenChange={setShowTransferDialog}>
        <DialogContent>
          <DialogHeader><DialogTitle>Transfer Token</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div><Label className="text-xs text-muted-foreground">Token ID</Label><Input value={selectedTokenId} readOnly className="mt-1 font-mono text-xs" /></div>
            <div><Label className="text-xs text-muted-foreground">Recipient User ID</Label><Input value={transferTo} onChange={(e) => setTransferTo(e.target.value)} placeholder="User ID" className="mt-1" /></div>
            <div><Label className="text-xs text-muted-foreground">Amount</Label><Input type="number" value={transferAmount} onChange={(e) => setTransferAmount(e.target.value)} className="mt-1" /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowTransferDialog(false)}>Cancel</Button>
            <Button onClick={() => transferMutation.mutate({ tokenId: selectedTokenId, toAccountId: transferTo, quantity: parseFloat(transferAmount) })} disabled={transferMutation.isPending || !transferTo}>
              {transferMutation.isPending ? "Transferring..." : "Transfer"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Fractionalize Dialog */}
      <Dialog open={showFractionalizeDialog} onOpenChange={setShowFractionalizeDialog}>
        <DialogContent>
          <DialogHeader><DialogTitle>Fractionalize Token</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div><Label className="text-xs text-muted-foreground">Token ID</Label><Input value={selectedTokenId} readOnly className="mt-1 font-mono text-xs" /></div>
            <div><Label className="text-xs text-muted-foreground">Number of Fractions</Label><Input type="number" value={fractions} onChange={(e) => setFractions(e.target.value)} className="mt-1" /></div>
            <div><Label className="text-xs text-muted-foreground">Price per Fraction (₦)</Label><Input type="number" value={fractionPrice} onChange={(e) => setFractionPrice(e.target.value)} className="mt-1" /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowFractionalizeDialog(false)}>Cancel</Button>
            <Button onClick={() => fractionalizeMutation.mutate({ tokenId: selectedTokenId, totalFractions: parseInt(fractions), pricePerFraction: parseFloat(fractionPrice) })} disabled={fractionalizeMutation.isPending}>
              {fractionalizeMutation.isPending ? "Fractionalizing..." : "Fractionalize"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {!health?.online && (
        <Card className="border-yellow-500/30 bg-yellow-500/5">
          <CardContent className="p-4 flex items-center gap-3">
            <Shield className="w-5 h-5 text-yellow-400 flex-shrink-0" />
            <div>
              <p className="text-sm font-semibold text-yellow-400">Blockchain Service Offline</p>
              <p className="text-xs text-muted-foreground">Start: <code className="bg-muted px-1 rounded">cd services/blockchain && go run main.go</code> or <code className="bg-muted px-1 rounded">docker-compose up blockchain</code></p>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
