/**
 * ReceiptQr.tsx (INNOV-D — Innovation 7)
 * Printable QR/code block for a warehouse-receipt verification code.
 * Renders a QR canvas (via the installed `qrcode` package) encoding the
 * public verify URL, plus the code as text with a copy button.
 */
import { useEffect, useRef } from "react";
import QRCode from "qrcode";
import { Button } from "@/components/ui/button";
import { Copy, Printer } from "lucide-react";
import { toast } from "sonner";

interface ReceiptQrProps {
  code: string;
  /** Absolute or relative verify URL encoded into the QR. */
  verifyUrl: string;
}

export function ReceiptQr({ code, verifyUrl }: ReceiptQrProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!canvasRef.current) return;
    QRCode.toCanvas(canvasRef.current, verifyUrl, {
      width: 192,
      margin: 2,
      color: { dark: "#0f172a", light: "#ffffff" },
    }).catch(console.error);
  }, [verifyUrl]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(verifyUrl);
      toast.success("Verification link copied");
    } catch {
      toast.error("Could not copy to clipboard");
    }
  };

  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-border bg-card p-4 print:border-black">
      <canvas ref={canvasRef} aria-label="Receipt verification QR code" />
      <div className="w-full text-center">
        <p className="text-xs text-muted-foreground">Verification code</p>
        <p className="break-all font-mono text-xs text-foreground">{code}</p>
        <p className="mt-1 break-all text-xs text-muted-foreground">{verifyUrl}</p>
      </div>
      <div className="flex gap-2 print:hidden">
        <Button variant="outline" size="sm" onClick={copy}>
          <Copy className="mr-1 h-3.5 w-3.5" /> Copy link
        </Button>
        <Button variant="outline" size="sm" onClick={() => window.print()}>
          <Printer className="mr-1 h-3.5 w-3.5" /> Print
        </Button>
      </div>
    </div>
  );
}

export default ReceiptQr;
