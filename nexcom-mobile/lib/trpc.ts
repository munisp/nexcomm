/**
 * NEXCOM Mobile — typed tRPC client.
 * AppRouter lives in this monorepo at server/routers.ts.
 * The Authorization header is resolved asynchronously from SecureStore on
 * every request, so 401-immune stale tokens are never sent.
 */
import { createTRPCReact } from '@trpc/react-query';
import { httpBatchLink } from '@trpc/client';
import superjson from 'superjson';
import type { AppRouter } from '../../server/routers';
import { getValidAccessToken } from './auth';

export const trpc = createTRPCReact<AppRouter>();

export function getTRPCClient(baseUrl: string) {
  return trpc.createClient({
    links: [
      httpBatchLink({
        url: `${baseUrl}/api/trpc`,
        transformer: superjson,
        async headers() {
          const token = await getValidAccessToken();
          return {
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            'Content-Type': 'application/json',
          };
        },
      }),
    ],
  });
}
