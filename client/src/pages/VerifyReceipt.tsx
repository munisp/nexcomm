/**
 * VerifyReceipt.tsx (INNOV-D — Innovation 7)
 * Public warehouse-receipt verification page at /verify-receipt/:code?
 * Anyone can paste (or scan) a verification code and see a redacted digital
 * twin — commodity, grade, quantity, warehouse name, status, issue date.
 * No authentication required; no owner PII is ever shown.
 */
import { useEffect, useState } from "react";
import { useParams } from "wouter";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  ShieldCheck,
  ShieldX,
  Search,
  Loader2,
  Package,
  Warehouse,
  CalendarClock,
} from "lucide-react";

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

export default function VerifyReceipt() {
  const params = useParams<{ code?: string }>();
  const [code, setCode] = useState(params.code ?? "");
  const [submitted, setSubmitted] = useState<string | null>(params.code ?? null);

  const query = trpc.receiptTwin.verifyByCode.useQuery(
    { code: submitted ?? "" },
    { enabled: !!submitted, retry: false, refetchOnWindowFocus: false },
  );

  // Keep the manual input in sync when arriving via /verify-receipt/:code
  useEffect(() => {
    if (params.code) {
      setCode(params.code);
      setSubmitted(params.code);
    }
  }, [params.code]);

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = code.trim();
    if (trimmed) setSubmitted(trimmed);
  };

  const result = query.data;

  return (
    <div className="mx-auto flex min-h-screen max-w-xl flex-col gap-6 bg-background px-4 py-10">
      <header className="text-center">
        <h1 className="flex items-center justify-center gap-2 text-2xl font-semibold text-foreground">
          <ShieldCheck className="h-6 w-6 text-primary" />
          NEXCOM Receipt Verification
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Verify the authenticity of an electronic warehouse receipt. No login required.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Enter verification code</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="flex flex-col gap-3">
            <Label htmlFor="code">Verification code</Label>
            <Input
              id="code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="e.g. 9f2c… (from the receipt QR code)"
              autoComplete="off"
              className="font-mono"
            />
            <Button type="submit" disabled={!code.trim() || query.isFetching}>
              {query.isFetching ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Search className="mr-2 h-4 w-4" />
              )}
              Verify
            </Button>
          </form>
        </CardContent>
      </Card>

      {query.isFetching && submitted && (
        <Card>
          <CardContent className="flex items-center justify-center py-10">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </CardContent>
        </Card>
      )}

      {query.isError && !query.isFetching && (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-8 text-center">
            <ShieldX className="h-8 w-8 text-destructive" />
            <p className="font-medium text-foreground">Verification failed</p>
            <p className="text-sm text-muted-foreground">
              This code could not be verified. Check the code and try again, or contact the
              receipt holder for a fresh verification link.
            </p>
          </CardContent>
        </Card>
      )}

      {result && !query.isFetching && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <CardTitle className="flex items-center gap-2 text-base">
              <ShieldCheck className="h-4 w-4 text-primary" />
              Verified receipt {result.receiptNumber}
            </CardTitle>
            <Badge variant={statusVariant(result.status)}>{result.status}</Badge>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <p className="text-xs text-muted-foreground">Commodity</p>
              <p className="flex items-center gap-1 font-medium text-foreground">
                <Package className="h-3.5 w-3.5 text-muted-foreground" />
                {result.commodity}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Grade</p>
              <p className="font-medium text-foreground">{result.grade ?? "—"}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Quantity</p>
              <p className="font-medium text-foreground">
                {Number(result.quantity).toLocaleString()} {result.unit}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Warehouse</p>
              <p className="flex items-center gap-1 font-medium text-foreground">
                <Warehouse className="h-3.5 w-3.5 text-muted-foreground" />
                {result.warehouseName ?? "—"}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">State</p>
              <p className="font-medium text-foreground">{result.state ?? "—"}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Issue date</p>
              <p className="flex items-center gap-1 font-medium text-foreground">
                <CalendarClock className="h-3.5 w-3.5 text-muted-foreground" />
                {new Date(result.issueDate).toLocaleDateString()}
              </p>
            </div>
            <p className="col-span-2 mt-2 text-xs text-muted-foreground">
              Verified at {new Date(result.verifiedAt).toLocaleString()}. This view is
              intentionally redacted — owner identity and exact storage location are never
              disclosed publicly.
            </p>
          </CardContent>
        </Card>
      )}

      {!submitted && (
        <p className="text-center text-xs text-muted-foreground">
          Scan the QR code on a warehouse receipt or paste its verification code above.
        </p>
      )}
    </div>
  );
}
