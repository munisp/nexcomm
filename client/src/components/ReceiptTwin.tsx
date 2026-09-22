/**
 * ReceiptTwin.tsx (INNOV-D — Innovation 7)
 * Warehouse Receipt Digital Twin card: commodity/grade/quantity summary,
 * custody timeline, and QR/code verification minting.
 *
 * Usage: <ReceiptTwin receiptId={receipt.id} />
 */
import { useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Package,
  Warehouse,
  CalendarClock,
  History,
  QrCode,
  Loader2,
  ShieldCheck,
} from "lucide-react";
import { toast } from "sonner";
import { ReceiptQr } from "./ReceiptQr";

interface ReceiptTwinProps {
  receiptId: number;
}

function statusVariant(status: string): "default" | "secondary" | "destructive" | "outline" {
  switch (status) {
    case "ACTIVE":
      return "default";
    case "PLEDGED":
      return "secondary";
    case "REDEEMED":
      return "outline";
    default:
      return "destructive";
  }
}

export function ReceiptTwin({ receiptId }: ReceiptTwinProps) {
  const [minted, setMinted] = useState<{ code: string; verifyPath: string } | null>(null);

  const twin = trpc.receiptTwin.getDigitalTwin.useQuery({ receiptId });
  const generate = trpc.receiptTwin.generateVerification.useMutation({
    onSuccess: (data) => setMinted({ code: data.code, verifyPath: data.verifyPath }),
    onError: (err) => toast.error(err.message ?? "Could not mint verification code"),
  });

  const verifyUrl = useMemo(() => {
    const path =
      minted?.verifyPath ??
      (twin.data?.verification ? `/verify-receipt/${twin.data.verification.code}` : null);
    if (!path) return null;
    return `${window.location.origin}${path}`;
  }, [minted, twin.data]);

  if (twin.isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-10">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  if (twin.error || !twin.data) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-muted-foreground">
          Digital twin unavailable for this receipt.
        </CardContent>
      </Card>
    );
  }

  const { receipt, timeline } = twin.data;
  const code = minted?.code ?? twin.data.verification?.code ?? null;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="flex items-center gap-2 text-base">
          <Package className="h-4 w-4 text-muted-foreground" />
          Receipt {receipt.receiptNumber}
        </CardTitle>
        <Badge variant={statusVariant(receipt.status)}>{receipt.status}</Badge>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <p className="text-xs text-muted-foreground">Commodity</p>
            <p className="font-medium text-foreground">{receipt.commodity}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Grade</p>
            <p className="font-medium text-foreground">{receipt.grade ?? "—"}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Quantity</p>
            <p className="font-medium text-foreground">
              {Number(receipt.quantity).toLocaleString()} {receipt.unit}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Warehouse</p>
            <p className="flex items-center gap-1 font-medium text-foreground">
              <Warehouse className="h-3.5 w-3.5 text-muted-foreground" />
              {receipt.warehouseName ?? "—"}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Deposit date</p>
            <p className="flex items-center gap-1 font-medium text-foreground">
              <CalendarClock className="h-3.5 w-3.5 text-muted-foreground" />
              {new Date(receipt.depositDate).toLocaleDateString()}
            </p>
          </div>
        </div>

        <Separator />

        <div>
          <p className="mb-2 flex items-center gap-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            <History className="h-3.5 w-3.5" /> Custody timeline
          </p>
          {timeline.length === 0 ? (
            <p className="text-sm text-muted-foreground">No custody events recorded yet.</p>
          ) : (
            <ol className="relative ml-2 space-y-3 border-l border-border pl-4">
              {timeline.map((ev, i) => (
                <li key={i} className="relative text-sm">
                  <span className="absolute -left-[21px] mt-1.5 h-2.5 w-2.5 rounded-full bg-muted-foreground/50" />
                  <p className="font-medium text-foreground">{ev.event.replace(/_/g, " ")}</p>
                  <p className="text-xs text-muted-foreground">
                    {new Date(ev.at).toLocaleString()}
                    {ev.details ? ` — ${ev.details}` : ""}
                  </p>
                </li>
              ))}
            </ol>
          )}
        </div>

        <Separator />

        <div className="space-y-3">
          <p className="flex items-center gap-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            <ShieldCheck className="h-3.5 w-3.5" /> Public verification
          </p>
          {code && verifyUrl ? (
            <ReceiptQr code={code} verifyUrl={verifyUrl} />
          ) : (
            <Button
              variant="outline"
              size="sm"
              disabled={generate.isPending}
              onClick={() => generate.mutate({ receiptId })}
            >
              {generate.isPending ? (
                <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
              ) : (
                <QrCode className="mr-1 h-3.5 w-3.5" />
              )}
              Generate verification QR
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export default ReceiptTwin;
