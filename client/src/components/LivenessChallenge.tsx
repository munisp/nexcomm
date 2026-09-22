/**
 * LivenessChallenge.tsx  (DOCAI deposit snippet)
 * ─────────────────────────────────────────────────────────────────────────────
 * Camera-based active liveness UX for the docai challenge-response protocol:
 *  - getUserMedia camera capture (front camera, fallback error state)
 *  - Server-issued challenge sequence stepper (blink / turn_left /
 *    turn_right / smile) with per-step timing windows from the server
 *  - Frame capture per step (canvas → JPEG base64) for anti-spoof analysis
 *  - Single submit → trpc.liveness.verifyChallenge → pass/fail + reasons
 *  - Low-saturation design per existing portal tokens (slate/zinc palette,
 *    shadcn primitives, lucide icons)
 *
 * Registration snippet (see MANIFEST.md — this file does not edit App.tsx):
 *   import { LivenessChallenge } from "@/components/LivenessChallenge";
 *   <LivenessChallenge
 *     applicationId={applicationId}
 *     documentPhotoUrl={documentPhotoUrl}
 *     onComplete={(verdict) => { ... }}
 *   />
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { trpc } from "@/lib/trpc";
import {
  Camera, CheckCircle2, XCircle, AlertTriangle, Eye, ArrowLeft,
  ArrowRight, Smile, Loader2, ShieldCheck,
} from "lucide-react";

// ─── Types (mirror of server/routers/livenessRouter.ts) ───────────────────────
type IssuedChallenge = {
  challenge_id: string;
  nonce: string;
  sequence: string[];
  expires_at_epoch: number;
  per_challenge_ms: number;
};

export type LivenessVerdict = {
  passed: boolean;
  state: string;
  reasons: string[];
  spoof_score: number | null;
  face_match_score: number | null;
};

interface LivenessChallengeProps {
  applicationId?: string;
  documentPhotoUrl?: string;
  requireFaceMatch?: boolean;
  onComplete: (verdict: LivenessVerdict) => void;
}

const ACTION_META: Record<string, { label: string; instruction: string; icon: React.ReactNode }> = {
  blink:      { label: "Blink",      instruction: "Blink both eyes slowly",        icon: <Eye className="w-10 h-10 text-zinc-500" /> },
  turn_left:  { label: "Turn left",  instruction: "Turn your head to the left",    icon: <ArrowLeft className="w-10 h-10 text-zinc-500" /> },
  turn_right: { label: "Turn right", instruction: "Turn your head to the right",   icon: <ArrowRight className="w-10 h-10 text-zinc-500" /> },
  smile:      { label: "Smile",      instruction: "Smile naturally at the camera", icon: <Smile className="w-10 h-10 text-zinc-500" /> },
};

type Phase = "init" | "camera" | "challenge" | "submitting" | "done" | "error";

export function LivenessChallenge({
  applicationId,
  documentPhotoUrl,
  requireFaceMatch = false,
  onComplete,
}: LivenessChallengeProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [phase, setPhase] = useState<Phase>("init");
  const [error, setError] = useState<string | null>(null);
  const [challenge, setChallenge] = useState<IssuedChallenge | null>(null);
  const [step, setStep] = useState(0);
  const [timeLeftMs, setTimeLeftMs] = useState(0);
  const [responses, setResponses] = useState<
    Array<{ action: string; passed: boolean; face_detected: boolean; latency_ms: number }>
  >([]);
  const [frames, setFrames] = useState<string[]>([]);
  const [selfieFrame, setSelfieFrame] = useState<string | null>(null);
  const [verdict, setVerdict] = useState<LivenessVerdict | null>(null);
  const stepStartedAt = useRef<number>(0);

  const issueMutation = trpc.liveness.issueChallenge.useMutation();
  const verifyMutation = trpc.liveness.verifyChallenge.useMutation();

  // ── Camera lifecycle ────────────────────────────────────────────────────────
  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  useEffect(() => () => stopCamera(), [stopCamera]);

  const startCamera = useCallback(async () => {
    setError(null);
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
      setPhase("camera");
    } catch (err) {
      setError(
        "Camera access is required for liveness verification. " +
          (err instanceof Error ? err.message : String(err)),
      );
      setPhase("error");
    }
  }, []);

  const captureFrame = useCallback((): string | null => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || video.videoWidth === 0) return null;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d")?.drawImage(video, 0, 0);
    return canvas.toDataURL("image/jpeg", 0.8).split(",")[1] ?? null;
  }, []);

  // ── Challenge flow ──────────────────────────────────────────────────────────
  const beginChallenge = useCallback(async () => {
    setError(null);
    try {
      const issued = await issueMutation.mutateAsync({ applicationId });
      setChallenge(issued);
      setStep(0);
      setResponses([]);
      setFrames([]);
      setPhase("challenge");
      stepStartedAt.current = performance.now();
      setTimeLeftMs(issued.per_challenge_ms);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPhase("error");
    }
  }, [applicationId, issueMutation]);

  // Per-step countdown; timeout = honest fail (server enforces windows too)
  useEffect(() => {
    if (phase !== "challenge" || !challenge) return;
    const tick = setInterval(() => {
      const elapsed = performance.now() - stepStartedAt.current;
      setTimeLeftMs(Math.max(0, challenge.per_challenge_ms - elapsed));
      if (elapsed >= challenge.per_challenge_ms) {
        recordStep(false); // window elapsed without user confirmation
      }
    }, 100);
    return () => clearInterval(tick);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, challenge, step]);

  const recordStep = useCallback(
    (userConfirmed: boolean) => {
      if (!challenge) return;
      const action = challenge.sequence[step];
      const latency = Math.round(performance.now() - stepStartedAt.current);
      const frame = captureFrame();
      if (frame) {
        setFrames((prev) => [...prev.slice(-7), frame]);
        if (step === challenge.sequence.length - 1) setSelfieFrame(frame);
      }
      const nextResponses = [
        ...responses,
        {
          action,
          // The client can only attest "user attempted"; the server applies
          // timing-window validation. face_detected stays true here — when a
          // client-side face detector is wired in, set this from it.
          passed: userConfirmed,
          face_detected: true,
          latency_ms: latency,
        },
      ];
      setResponses(nextResponses);
      if (step + 1 < challenge.sequence.length) {
        setStep(step + 1);
        stepStartedAt.current = performance.now();
        setTimeLeftMs(challenge.per_challenge_ms);
      } else {
        void submit(nextResponses);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [challenge, step, responses, captureFrame],
  );

  const submit = useCallback(
    async (finalResponses: typeof responses) => {
      if (!challenge) return;
      setPhase("submitting");
      try {
        const result = await verifyMutation.mutateAsync({
          challenge_id: challenge.challenge_id,
          nonce: challenge.nonce,
          responses: finalResponses,
          frames,
          selfie_frame: selfieFrame ?? undefined,
          document_photo_url: documentPhotoUrl,
          require_face_match: requireFaceMatch,
        });
        setVerdict(result);
        setPhase("done");
        onComplete(result);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        setPhase("error");
      } finally {
        stopCamera();
      }
    },
    [challenge, frames, selfieFrame, documentPhotoUrl, requireFaceMatch,
     verifyMutation, onComplete, stopCamera],
  );

  // ── Render (low-saturation: zinc/slate tokens, shadcn primitives) ───────────
  const currentAction = challenge ? ACTION_META[challenge.sequence[step]] : null;

  return (
    <div className="w-full max-w-md mx-auto rounded-lg border border-zinc-200 bg-white p-6 shadow-sm">
      <div className="flex items-center gap-2 mb-4">
        <ShieldCheck className="w-5 h-5 text-zinc-600" />
        <h3 className="text-base font-medium text-zinc-800">Liveness verification</h3>
      </div>

      <canvas ref={canvasRef} className="hidden" />

      {phase === "init" && (
        <div className="space-y-4">
          <p className="text-sm text-zinc-500">
            You'll be asked to perform a few quick actions on camera. This takes
            under a minute and must be completed in one sitting.
          </p>
          <Button onClick={startCamera} className="w-full bg-zinc-700 hover:bg-zinc-800">
            <Camera className="w-4 h-4 mr-2" /> Start camera
          </Button>
        </div>
      )}

      {(phase === "camera" || phase === "challenge" || phase === "submitting") && (
        <div className="space-y-4">
          <div className="relative overflow-hidden rounded-md bg-zinc-100">
            <video ref={videoRef} muted playsInline className="w-full aspect-[4/3] object-cover" />
            {phase === "challenge" && (
              <div className="absolute top-2 right-2 rounded bg-white/80 px-2 py-1 text-xs font-mono text-zinc-700">
                {(timeLeftMs / 1000).toFixed(1)}s
              </div>
            )}
          </div>

          {phase === "camera" && (
            <Button onClick={beginChallenge} disabled={issueMutation.isPending}
                    className="w-full bg-zinc-700 hover:bg-zinc-800">
              {issueMutation.isPending
                ? <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                : null}
              Begin verification
            </Button>
          )}

          {phase === "challenge" && challenge && currentAction && (
            <div className="space-y-3 text-center">
              <Progress
                value={((step + 1) / challenge.sequence.length) * 100}
                className="h-1.5 bg-zinc-200"
              />
              <div className="flex flex-col items-center gap-2 py-2">
                {currentAction.icon}
                <p className="text-sm font-medium text-zinc-800">
                  Step {step + 1} of {challenge.sequence.length}: {currentAction.label}
                </p>
                <p className="text-sm text-zinc-500">{currentAction.instruction}</p>
              </div>
              <Button onClick={() => recordStep(true)}
                      className="w-full bg-zinc-700 hover:bg-zinc-800">
                Done — next
              </Button>
            </div>
          )}

          {phase === "submitting" && (
            <div className="flex items-center justify-center gap-2 py-4 text-sm text-zinc-500">
              <Loader2 className="w-4 h-4 animate-spin" /> Verifying…
            </div>
          )}
        </div>
      )}

      {phase === "done" && verdict && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            {verdict.passed
              ? <CheckCircle2 className="w-5 h-5 text-emerald-700" />
              : <XCircle className="w-5 h-5 text-red-700" />}
            <p className="text-sm font-medium text-zinc-800">
              {verdict.passed ? "Liveness verified" : "Verification failed"}
            </p>
          </div>
          {verdict.spoof_score === null && (
            <p className="text-xs text-zinc-400">
              Passive anti-spoofing model not deployed — decision based on
              challenge-response only.
            </p>
          )}
          {verdict.reasons.length > 0 && (
            <p className="text-xs text-zinc-500">
              Reasons: {verdict.reasons.join(", ")}
            </p>
          )}
        </div>
      )}

      {phase === "error" && (
        <Alert className="border-red-200 bg-red-50">
          <AlertTriangle className="h-4 w-4 text-red-700" />
          <AlertDescription className="text-sm text-red-800">
            {error ?? "Verification could not be completed. Please try again."}
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}

export default LivenessChallenge;
