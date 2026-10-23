import type { Server } from 'node:http';

export function hostAllowed(hostname: string | undefined, allowed: string[]): boolean;
export function resolveInside(root: string, urlPath: string): string | null;
export function createStaticServer(opts: {
  root: string;
  headersFor: (host: string | undefined) => Record<string, string>;
  allowedHosts: string[];
  hostnameOf: (h: string | undefined) => string | undefined;
}): Server;
