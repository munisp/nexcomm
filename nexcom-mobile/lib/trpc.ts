import { createTRPCReact } from '@trpc/react-query';
import { httpBatchLink } from '@trpc/client';
import superjson from 'superjson';
import type { AppRouter } from '../../../nexcom-exchange/server/routers';

export const trpc = createTRPCReact<AppRouter>();

export function getTRPCClient(baseUrl: string, token?: string) {
  return trpc.createClient({
    links: [
      httpBatchLink({
        url: `${baseUrl}/api/trpc`,
        transformer: superjson,
        headers() {
          return {
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            'Content-Type': 'application/json',
          };
        },
      }),
    ],
  });
}
