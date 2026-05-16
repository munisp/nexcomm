/**
 * LivenessChallengeModal.tsx
 * ─────────────────────────────────────────────────────────────────────────────
 * Full active liveness challenge UI with:
 *  - Camera capture via getUserMedia
 *  - Per-challenge instruction display (BLINK, TURN_LEFT, TURN_RIGHT, SMILE, NOD, RAISE_EYEBROWS)
 *  - Frame capture → S3 upload → verifyLiveness tRPC call
 *  - Passive liveness check on first frame
 *  - Face match (selfie vs document) as final step
 *  - Real-time confidence score display
 *  - Spoof detection warning
 */

import { useRef, useState, useCallback, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import {
  Camera, CheckCircle2, XCircle, AlertTriangle, Eye, ArrowLeft,
  ArrowRight, Smile, ChevronUp, RotateCcw, Loader2,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────
export type LivenessResult = {
  passed: boolean;
  sessionId: string;
  faceMatchScore?: number;
  spoofType?: string;
  spoofConfidence?: number;
  overallResult?: string;
};

interface LivenessChallengeModalProps {
  open: boolean;
  onClose: () => void;
  onComplete: (result: LivenessResult) => void;
  applicationId: string;
  /** URL of the document photo for face matching (optional) */
  documentPhotoUrl?: string;
  /** Title shown in the modal header */
  title?: string;
}

// ─── Challenge metadata ───────────────────────────────────────────────────────
const CHALLENGE_META: Record<string, { label: string; instruction: string; icon: React.ReactNode }> = {
  BLINK:          { label: "Blink",         instruction: "Please blink both eyes slowly",          icon: <Eye className="w-8 h-8" /> },
  TURN_LEFT:      { label: "Turn Left",     instruction: "Slowly turn your head to the left",      icon: <ArrowLeft className="w-8 h-8" /> },
  TURN_RIGHT:     { label: "Turn Right",    instruction: "Slowly turn your head to the right",     icon: <ArrowRight className="w-8 h-8" /> },
  SMILE:          { label: "Smile",         instruction: "Give a natural smile",                   icon: <Smile className="w-8 h-8" /> },
  NOD:            { label: "Nod",           instruction: "Nod your head up and down once",         icon: <ChevronUp className="w-8 h-8" /> },
  RAISE_EYEBROWS: { label: "Raise Brows",  instruction: "Raise your eyebrows briefly",            icon: <Eye className="w-8 h-8" /> },
};

// ─── Component ────────────────────────────────────────────────────────────────
export default function LivenessChallengeModal({
  open,
  onClose,
  onComplete,
  applicationId,
  documentPhotoUrl,
  title = "Identity Verification",
}: LivenessChallengeModalProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [phase, setPhase] = useState<"idle" | "starting" | "passive" | "challenges" | "facematch" | "done" | "error">("idle");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [challenges, setChallenges] = useState<string[]>([]);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [captureState, setCaptureState] = useState<"waiting" | "capturing" | "processing">("waiting");
  const [passiveResult, setPassiveResult] = useState<string | null>(null);
  const [faceMatchScore, setFaceMatchScore] = useState<number | null>(null);
  const [spoofWarning, setSpoofWarning] = useState<string | null>(null);
  const [overallResult, setOverallResult] = useState<"PASS" | "FAIL" | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);

  const startLiveness = trpc.kycService.startLiveness.useMutation();
  const verifyLiveness = trpc.kycService.verifyLiveness.useMutation();
  const passiveLiveness = trpc.kycService.passiveLiveness.useMutation();
  const faceMatch = trpc.kycService.faceMatch.useMutation();

  // ─── Camera helpers ──────────────────────────────────────────────────────────
  const startCamera = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
    } catch (err) {
      setErrorMsg("Camera access denied. Please allow camera access and try again.");
      setPhase("error");
    }
  }, []);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  // Capture a frame from the video and return it as a Blob
  const captureFrame = useCallback((): Promise<Blob | null> => {
    return new Promise((resolve) => {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (!video || !canvas) return resolve(null);
      canvas.width = video.videoWidth || 640;
      canvas.height = video.videoHeight || 480;
      const ctx = canvas.getContext("2d");
      if (!ctx) return resolve(null);
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      canvas.toBlob((blob) => resolve(blob), "image/jpeg", 0.92);
    });
  }, []);

  // Upload a blob to S3 via the server upload endpoint and return the URL
  const uploadFrame = useCallback(async (blob: Blob): Promise<string> => {
    const formData = new FormData();
    formData.append("file", blob, "liveness-frame.jpg");
    const res = await fetch("/api/upload", { method: "POST", body: formData });
    if (!res.ok) throw new Error("Frame upload failed");
    const json = await res.json() as { url: string };
    return json.url;
  }, []);

  // ─── Lifecycle ───────────────────────────────────────────────────────────────
  useEffect(() => {
    if (open) {
      setPhase("idle");
      setSessionId(null);
      setChallenges([]);
      setCurrentIdx(0);
      setCaptureState("waiting");
      setPassiveResult(null);
      setFaceMatchScore(null);
      setSpoofWarning(null);
      setOverallResult(null);
      setErrorMsg(null);
      setUploadProgress(0);
    } else {
      stopCamera();
    }
  }, [open, stopCamera]);

  // ─── Step 1: Start session + camera ──────────────────────────────────────────
  const handleStart = useCallback(async () => {
    setPhase("starting");
    await startCamera();
    try {
      const data = await startLiveness.mutateAsync({ applicationId }) as Record<string, unknown>;
      if (data?.error) throw new Error(String(data.error));
      setSessionId(String(data.session_id ?? ""));
      const rawChallenges = (data.challenges as string[]) ?? ["BLINK", "TURN_LEFT", "SMILE"];
      setChallenges(rawChallenges);
      setPhase("passive"); // run passive check first
    } catch (err) {
      setErrorMsg(`Failed to start session: ${String(err)}`);
      setPhase("error");
    }
  }, [applicationId, startCamera, startLiveness]);

  // ─── Step 2: Passive liveness on first frame ─────────────────────────────────
  const handlePassiveCheck = useCallback(async () => {
    setCaptureState("capturing");
    await new Promise((r) => setTimeout(r, 500)); // brief pause for camera to settle
    const blob = await captureFrame();
    if (!blob) { setCaptureState("waiting"); return; }
    setCaptureState("processing");
    setUploadProgress(30);
    try {
      const url = await uploadFrame(blob);
      setUploadProgress(70);
      const result = await passiveLiveness.mutateAsync({ imageUrl: url, applicationId }) as Record<string, unknown>;
      setUploadProgress(100);
      const r = String(result?.result ?? "UNKNOWN");
      setPassiveResult(r);
      if (r === "LIKELY_LIVE") {
        setPhase("challenges");
      } else {
        setSpoofWarning(`Passive check: ${r.replace(/_/g, " ")}. Please ensure you are a real person in good lighting.`);
        setPhase("challenges"); // allow to continue but warn
      }
    } catch {
      setPhase("challenges"); // degrade gracefully
    } finally {
      setCaptureState("waiting");
      setUploadProgress(0);
    }
  }, [applicationId, captureFrame, passiveLiveness, uploadFrame]);

  // ─── Step 3: Per-challenge capture ───────────────────────────────────────────
  const handleCaptureChallenge = useCallback(async () => {
    if (!sessionId) return;
    setCaptureState("capturing");
    await new Promise((r) => setTimeout(r, 300));
    const blob = await captureFrame();
    if (!blob) { setCaptureState("waiting"); return; }
    setCaptureState("processing");
    setUploadProgress(20);
    try {
      const url = await uploadFrame(blob);
      setUploadProgress(60);
      const data = await verifyLiveness.mutateAsync({ sessionId, imageUrl: url }) as Record<string, unknown>;
      setUploadProgress(100);

      if (data?.spoof_type && data.spoof_type !== "NONE" && data.spoof_type !== "UNKNOWN") {
        setSpoofWarning(`Spoof detected: ${String(data.spoof_type).replace(/_/g, " ")}`);
      }

      if (data?.session_complete) {
        const result = String(data.overall_result ?? "FAIL") as "PASS" | "FAIL";
        setOverallResult(result);
        setFaceMatchScore((data.face_match_score as number) ?? null);
        // Run face match if document photo is provided
        if (documentPhotoUrl && result === "PASS") {
          setPhase("facematch");
        } else {
          setPhase("done");
          onComplete({
            passed: result === "PASS",
            sessionId,
            faceMatchScore: (data.face_match_score as number) ?? undefined,
            spoofType: String(data.spoof_type ?? ""),
            spoofConfidence: (data.spoof_confidence as number) ?? undefined,
            overallResult: result,
          });
        }
      } else {
        const nextIdx = Number(data?.current_challenge_index ?? currentIdx + 1);
        setCurrentIdx(nextIdx);
      }
    } catch (err) {
      toast.error(`Challenge failed: ${String(err)}`);
    } finally {
      setCaptureState("waiting");
      setUploadProgress(0);
    }
  }, [sessionId, captureFrame, uploadFrame, verifyLiveness, currentIdx, documentPhotoUrl, onComplete]);

  // ─── Step 4: Face match ───────────────────────────────────────────────────────
  const handleFaceMatch = useCallback(async () => {
    if (!documentPhotoUrl || !sessionId) return;
    setCaptureState("capturing");
    const blob = await captureFrame();
    if (!blob) { setCaptureState("waiting"); return; }
    setCaptureState("processing");
    setUploadProgress(30);
    try {
      const selfieUrl = await uploadFrame(blob);
      setUploadProgress(70);
      const data = await faceMatch.mutateAsync({
        selfieUrl,
        documentImageUrl: documentPhotoUrl,
        applicationId,
      }) as Record<string, unknown>;
      setUploadProgress(100);
      const score = (data?.similarity_score as number) ?? 0;
      setFaceMatchScore(score);
      const passed = data?.matched === true;
      setPhase("done");
      onComplete({
        passed: overallResult === "PASS" && passed,
        sessionId,
        faceMatchScore: score,
        overallResult: overallResult ?? "FAIL",
      });
    } catch {
      setPhase("done");
      onComplete({ passed: overallResult === "PASS", sessionId, overallResult: overallResult ?? "FAIL" });
    } finally {
      setCaptureState("waiting");
      setUploadProgress(0);
    }
  }, [documentPhotoUrl, sessionId, captureFrame, uploadFrame, faceMatch, applicationId, overallResult, onComplete]);

  // ─── Derived state ────────────────────────────────────────────────────────────
  const currentChallenge = challenges[currentIdx];
  const challengeMeta = currentChallenge ? (CHALLENGE_META[currentChallenge] ?? { label: currentChallenge, instruction: `Perform: ${currentChallenge}`, icon: <Camera className="w-8 h-8" /> }) : null;
  const progressPct = challenges.length > 0 ? Math.round((currentIdx / challenges.length) * 100) : 0;

  // ─── Render ───────────────────────────────────────────────────────────────────
  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) { stopCamera(); onClose(); } }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Camera className="w-5 h-5 text-primary" />
            {title}
          </DialogTitle>
          <DialogDescription>
            We need to verify that you are a real person. Please follow the on-screen instructions.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Spoof warning */}
          {spoofWarning && (
            <Alert variant="destructive">
              <AlertTriangle className="w-4 h-4" />
              <AlertDescription>{spoofWarning}</AlertDescription>
            </Alert>
          )}

          {/* Camera feed */}
          {(phase === "passive" || phase === "challenges" || phase === "facematch") && (
            <div className="relative rounded-lg overflow-hidden bg-black aspect-video">
              <video ref={videoRef} autoPlay muted playsInline className="w-full h-full object-cover" />
              <canvas ref={canvasRef} className="hidden" />
              {/* Face guide overlay */}
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div className="w-48 h-56 border-2 border-primary/60 rounded-full opacity-60" />
              </div>
              {captureState === "capturing" && (
                <div className="absolute inset-0 bg-white/20 flex items-center justify-center">
                  <div className="w-4 h-4 bg-white rounded-full animate-ping" />
                </div>
              )}
              {captureState === "processing" && (
                <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                  <Loader2 className="w-8 h-8 text-white animate-spin" />
                </div>
              )}
            </div>
          )}

          {/* Upload progress */}
          {uploadProgress > 0 && uploadProgress < 100 && (
            <Progress value={uploadProgress} className="h-1" />
          )}

          {/* Phase: idle */}
          {phase === "idle" && (
            <div className="text-center space-y-4 py-4">
              <Camera className="w-16 h-16 mx-auto text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                This check takes about 30 seconds. Make sure you are in a well-lit area and your face is clearly visible.
              </p>
              <Button onClick={handleStart} className="w-full">
                Start Liveness Check
              </Button>
            </div>
          )}

          {/* Phase: starting */}
          {phase === "starting" && (
            <div className="text-center py-8">
              <Loader2 className="w-10 h-10 mx-auto animate-spin text-primary" />
              <p className="mt-3 text-sm text-muted-foreground">Starting camera and session…</p>
            </div>
          )}

          {/* Phase: passive */}
          {phase === "passive" && (
            <div className="space-y-3">
              <p className="text-sm font-medium text-center">Look directly at the camera and hold still</p>
              <Button
                onClick={handlePassiveCheck}
                disabled={captureState !== "waiting"}
                className="w-full"
              >
                {captureState !== "waiting" ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                Capture
              </Button>
            </div>
          )}

          {/* Phase: challenges */}
          {phase === "challenges" && challengeMeta && (
            <div className="space-y-3">
              <div className="flex items-center justify-between text-sm text-muted-foreground">
                <span>Challenge {currentIdx + 1} of {challenges.length}</span>
                <Badge variant="outline">{Math.round(progressPct)}%</Badge>
              </div>
              <Progress value={progressPct} className="h-2" />
              <div className="flex flex-col items-center gap-2 py-2">
                <div className="text-primary">{challengeMeta.icon}</div>
                <p className="font-semibold text-lg">{challengeMeta.label}</p>
                <p className="text-sm text-muted-foreground text-center">{challengeMeta.instruction}</p>
              </div>
              <Button
                onClick={handleCaptureChallenge}
                disabled={captureState !== "waiting"}
                className="w-full"
              >
                {captureState !== "waiting" ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                Capture Challenge
              </Button>
            </div>
          )}

          {/* Phase: facematch */}
          {phase === "facematch" && (
            <div className="space-y-3">
              <div className="flex flex-col items-center gap-2 py-2">
                <Camera className="w-8 h-8 text-primary" />
                <p className="font-semibold">Face Matching</p>
                <p className="text-sm text-muted-foreground text-center">
                  Look straight at the camera. We will compare your face with your ID document.
                </p>
              </div>
              <Button
                onClick={handleFaceMatch}
                disabled={captureState !== "waiting"}
                className="w-full"
              >
                {captureState !== "waiting" ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                Capture for Face Match
              </Button>
            </div>
          )}

          {/* Phase: done */}
          {phase === "done" && (
            <div className="text-center space-y-4 py-4">
              {overallResult === "PASS" ? (
                <CheckCircle2 className="w-16 h-16 mx-auto text-green-500" />
              ) : (
                <XCircle className="w-16 h-16 mx-auto text-red-500" />
              )}
              <div>
                <p className="font-semibold text-lg">
                  {overallResult === "PASS" ? "Verification Passed" : "Verification Failed"}
                </p>
                {faceMatchScore !== null && (
                  <p className="text-sm text-muted-foreground mt-1">
                    Face match score: <span className="font-medium">{Math.round(faceMatchScore * 100)}%</span>
                  </p>
                )}
              </div>
              <Button variant="outline" onClick={() => { stopCamera(); onClose(); }} className="w-full">
                Close
              </Button>
            </div>
          )}

          {/* Phase: error */}
          {phase === "error" && (
            <div className="text-center space-y-4 py-4">
              <AlertTriangle className="w-16 h-16 mx-auto text-destructive" />
              <p className="text-sm text-destructive">{errorMsg}</p>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => { stopCamera(); onClose(); }} className="flex-1">
                  Cancel
                </Button>
                <Button onClick={() => { setPhase("idle"); setErrorMsg(null); }} className="flex-1">
                  <RotateCcw className="w-4 h-4 mr-2" /> Retry
                </Button>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
