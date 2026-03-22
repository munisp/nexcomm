/**
 * NEXCOM gRPC Client
 * ─────────────────────────────────────────────────────────────────────────────
 * Provides typed client stubs for all three NEXCOM gRPC services.
 * Used by tRPC procedures to call the gRPC server via localhost.
 *
 * Usage:
 *   import { getMatchingEngineClient } from "./grpc/client";
 *   const client = getMatchingEngineClient();
 *   const result = await grpcCall(client, "SubmitOrder", { ... });
 */
import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";
import path from "path";
import { fileURLToPath } from "url";
import { promisify } from "util";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROTO_PATH = path.resolve(__dirname, "../../proto/nexcom.proto");
const GRPC_PORT = process.env.GRPC_PORT || "50051";
const GRPC_HOST = `localhost:${GRPC_PORT}`;

// ─── Load proto ───────────────────────────────────────────────────────────────
const packageDef = protoLoader.loadSync(PROTO_PATH, {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
});
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const proto = (grpc.loadPackageDefinition(packageDef) as any).nexcom;

// ─── Singleton clients ────────────────────────────────────────────────────────
let _matchingEngineClient: grpc.Client | undefined;
let _settlementClient: grpc.Client | undefined;
let _alertClient: grpc.Client | undefined;

export function getMatchingEngineClient(): grpc.Client {
  if (!_matchingEngineClient || _matchingEngineClient.getChannel().getConnectivityState(false) === grpc.connectivityState.SHUTDOWN) {
    _matchingEngineClient = new proto.MatchingEngine(
      GRPC_HOST,
      grpc.credentials.createInsecure()
    );
  }
  return _matchingEngineClient!;
}

export function getSettlementClient(): grpc.Client {
  if (!_settlementClient) {
    _settlementClient = new proto.SettlementService(
      GRPC_HOST,
      grpc.credentials.createInsecure()
    );
  }
  return _settlementClient!;
}

export function getPriceAlertClient(): grpc.Client {
  if (!_alertClient) {
    _alertClient = new proto.PriceAlertService(
      GRPC_HOST,
      grpc.credentials.createInsecure()
    );
  }
  return _alertClient!;
}

// ─── Promisified call helper ──────────────────────────────────────────────────
/**
 * Wraps a gRPC unary call in a Promise.
 * @example
 *   const result = await grpcCall<SubmitOrderResponse>(
 *     getMatchingEngineClient(), "SubmitOrder", { ... }
 *   );
 */
export function grpcCall<TResponse>(
  client: grpc.Client,
  method: string,
  request: Record<string, unknown>
): Promise<TResponse> {
  return new Promise((resolve, reject) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fn = (client as any)[method].bind(client);
    if (typeof fn !== "function") {
      reject(new Error(`gRPC method ${method} not found on client`));
      return;
    }
    fn(request, (err: grpc.ServiceError | null, response: TResponse) => {
      if (err) {
        reject(new Error(`gRPC ${method} failed: ${err.message} (code ${err.code})`));
      } else {
        resolve(response);
      }
    });
  });
}

// ─── Health check ─────────────────────────────────────────────────────────────
export async function checkGrpcHealth(): Promise<boolean> {
  try {
    const client = getMatchingEngineClient();
    await grpcCall(client, "GetOrderBook", { symbol: "HEALTH_CHECK", depth: 1 });
    return true;
  } catch {
    return false;
  }
}

// ─── Graceful shutdown ────────────────────────────────────────────────────────
export function closeGrpcClients() {
  _matchingEngineClient?.close();
  _settlementClient?.close();
  _alertClient?.close();
  _matchingEngineClient = undefined;
  _settlementClient = undefined;
  _alertClient = undefined;
}
