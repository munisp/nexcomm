import { useState } from "react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { TrendingUp, TrendingDown, Zap } from "lucide-react";

interface OptionsChainProps {
  underlyingContractId?: number;
  defaultSpotPrice?: number;
}

function fmt(n: number, d = 4) {
  return n.toLocaleString("en-NG", { minimumFractionDigits: d, maximumFractionDigits: d });
}

function MoneynessBadge({ m }: { m: string }) {
  const cls = m === "ITM"
    ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30"
    : m === "OTM"
      ? "bg-red-500/15 text-red-400 border-red-500/30"
      : "bg-amber-500/15 text-amber-400 border-amber-500/30";
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium border ${cls}`}>{m}</span>
  );
}

export default function OptionsChain({ underlyingContractId, defaultSpotPrice = 45000 }: OptionsChainProps) {
  const [spotPrice, setSpotPrice] = useState(defaultSpotPrice);
  const [spotInput, setSpotInput] = useState(String(defaultSpotPrice));
  const [buyOpen, setBuyOpen] = useState(false);
  const [selectedContract, setSelectedContract] = useState<{ id: number; symbol: string; type: string; strike: number; premium: number } | null>(null);
  const [buyQty, setBuyQty] = useState("1");

  const utils = trpc.useUtils();

  const chainQuery = trpc.options.listActiveOptions.useQuery({
    underlyingContractId,
    optionType: "ALL",
    spotPrice,
  });

  const buyMutation = trpc.options.buyOption.useMutation({
    onSuccess: (data) => {
      toast.success(`Bought ${buyQty} × ${selectedContract?.symbol} @ ₦${fmt(data.premium, 2)} premium. Total cost: ₦${fmt(data.totalCost, 2)}`);
      utils.options.myOptionsPositions.invalidate();
      setBuyOpen(false);
      setBuyQty("1");
      setSelectedContract(null);
    },
    onError: (e) => toast.error(e.message),
  });

  const items = chainQuery.data ?? [];
  const calls = items.filter(i => i.contract.optionType === "CALL");
  const puts = items.filter(i => i.contract.optionType === "PUT");

  function GreeksRow({ item }: { item: typeof items[0] }) {
    const g = item.greeks;
    const premium = g?.premium ?? 0;
    const moneyness = (item as { moneyness?: string }).moneyness ?? "ATM";

    return (
      <TableRow
        className="cursor-pointer hover:bg-muted/40 transition-colors"
        onClick={() => {
          setSelectedContract({
            id: item.contract.id,
            symbol: item.contract.symbol,
            type: item.contract.optionType,
            strike: parseFloat(item.contract.strikePrice),
            premium,
          });
          setBuyOpen(true);
        }}
      >
        <TableCell className="font-mono text-xs">{item.contract.symbol}</TableCell>
        <TableCell className="text-right font-mono">₦{fmt(parseFloat(item.contract.strikePrice), 0)}</TableCell>
        <TableCell className="text-right">
          <MoneynessBadge m={moneyness} />
        </TableCell>
        <TableCell className="text-right font-mono text-sm font-semibold">
          {g ? `₦${fmt(g.premium, 2)}` : "—"}
        </TableCell>
        <TableCell className="text-right text-xs text-muted-foreground">
          {g ? fmt(g.delta, 4) : "—"}
        </TableCell>
        <TableCell className="text-right text-xs text-muted-foreground">
          {g ? fmt(g.gamma, 6) : "—"}
        </TableCell>
        <TableCell className="text-right text-xs text-muted-foreground">
          {g ? fmt(g.theta, 4) : "—"}
        </TableCell>
        <TableCell className="text-right text-xs text-muted-foreground">
          {g ? fmt(g.vega, 4) : "—"}
        </TableCell>
        <TableCell className="text-right">
          <span className="text-xs text-muted-foreground">{item.contract.openInterest.toLocaleString()}</span>
        </TableCell>
        <TableCell className="text-right">
          <Button
            size="sm"
            variant="outline"
            className="h-6 text-xs px-2"
            onClick={e => {
              e.stopPropagation();
              setSelectedContract({
                id: item.contract.id,
                symbol: item.contract.symbol,
                type: item.contract.optionType,
                strike: parseFloat(item.contract.strikePrice),
                premium,
              });
              setBuyOpen(true);
            }}
          >
            Buy
          </Button>
        </TableCell>
      </TableRow>
    );
  }

  function ChainTable({ items }: { items: typeof calls }) {
    if (items.length === 0) {
      return (
        <div className="py-10 text-center text-muted-foreground text-sm">
          No active options contracts found.
        </div>
      );
    }
    return (
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Symbol</TableHead>
            <TableHead className="text-right">Strike</TableHead>
            <TableHead className="text-right">Moneyness</TableHead>
            <TableHead className="text-right">Premium</TableHead>
            <TableHead className="text-right">Δ Delta</TableHead>
            <TableHead className="text-right">Γ Gamma</TableHead>
            <TableHead className="text-right">Θ Theta/d</TableHead>
            <TableHead className="text-right">ν Vega/%</TableHead>
            <TableHead className="text-right">OI</TableHead>
            <TableHead className="text-right">Action</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map(item => <GreeksRow key={item.contract.id} item={item} />)}
        </TableBody>
      </Table>
    );
  }

  return (
    <Card className="bg-card border-border">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Zap className="w-4 h-4 text-amber-400" />
            Options Chain
          </CardTitle>
          <div className="flex items-center gap-2">
            <Label className="text-xs text-muted-foreground whitespace-nowrap">Spot Price (₦)</Label>
            <Input
              type="number"
              className="w-32 h-8 text-sm"
              value={spotInput}
              onChange={e => setSpotInput(e.target.value)}
              onBlur={() => {
                const v = parseFloat(spotInput);
                if (!isNaN(v) && v > 0) setSpotPrice(v);
              }}
              onKeyDown={e => {
                if (e.key === "Enter") {
                  const v = parseFloat(spotInput);
                  if (!isNaN(v) && v > 0) setSpotPrice(v);
                }
              }}
            />
            <span className="text-xs text-muted-foreground">Press Enter to reprice</span>
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <Tabs defaultValue="calls">
          <TabsList className="mx-4 mb-2">
            <TabsTrigger value="calls" className="gap-1.5">
              <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />
              Calls ({calls.length})
            </TabsTrigger>
            <TabsTrigger value="puts" className="gap-1.5">
              <TrendingDown className="w-3.5 h-3.5 text-red-400" />
              Puts ({puts.length})
            </TabsTrigger>
          </TabsList>
          <TabsContent value="calls" className="mt-0">
            <ChainTable items={calls} />
          </TabsContent>
          <TabsContent value="puts" className="mt-0">
            <ChainTable items={puts} />
          </TabsContent>
        </Tabs>
      </CardContent>

      {/* Buy Dialog */}
      <Dialog open={buyOpen} onOpenChange={setBuyOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Buy Option</DialogTitle>
          </DialogHeader>
          {selectedContract && (
            <div className="space-y-4 py-2">
              <div className="bg-muted rounded-lg p-3 space-y-1 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Contract</span>
                  <span className="font-mono font-medium">{selectedContract.symbol}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Type</span>
                  <Badge variant={selectedContract.type === "CALL" ? "default" : "secondary"}>
                    {selectedContract.type}
                  </Badge>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Strike</span>
                  <span className="font-mono">₦{fmt(selectedContract.strike, 0)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Premium / unit</span>
                  <span className="font-mono font-semibold text-amber-400">₦{fmt(selectedContract.premium, 2)}</span>
                </div>
              </div>
              <div className="space-y-1">
                <Label>Quantity (contracts)</Label>
                <Input
                  type="number"
                  min="1"
                  value={buyQty}
                  onChange={e => setBuyQty(e.target.value)}
                />
              </div>
              <div className="bg-muted/50 rounded p-2 text-sm flex justify-between">
                <span className="text-muted-foreground">Estimated Total Cost</span>
                <span className="font-mono font-bold">
                  ₦{fmt(selectedContract.premium * parseFloat(buyQty || "0"), 2)}
                </span>
              </div>
              <Button
                className="w-full"
                disabled={buyMutation.isPending || !buyQty || parseFloat(buyQty) <= 0}
                onClick={() => buyMutation.mutate({
                  contractId: selectedContract.id,
                  quantity: parseFloat(buyQty),
                  spotPrice,
                })}
              >
                {buyMutation.isPending ? "Buying…" : `Buy ${buyQty} × ${selectedContract.symbol}`}
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </Card>
  );
}
