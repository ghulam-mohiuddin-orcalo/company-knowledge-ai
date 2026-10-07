import { fileURLToPath } from 'node:url';
import type { NextConfig } from 'next';

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? '';
const oidcAuthority = process.env.NEXT_PUBLIC_OIDC_AUTHORITY ?? '';
const origin = (url: string) => {
  try {
    return new URL(url).origin;
  } catch {
    return '';
  }
};

/**
 * Security headers. The UI only talks to the API and the identity provider;
 * no framing, plugins or third-party scripts. Next.js needs inline scripts for
 * hydration (and eval in development).
 */
const contentSecurityPolicy = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${process.env.NODE_ENV === 'development' ? " 'unsafe-eval'" : ''}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  `connect-src 'self' ${origin(apiUrl)} ${origin(oidcAuthority)}`.trim(),
  "frame-ancestors 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  `form-action 'self' ${origin(oidcAuthority)}`.trim(),
].join('; ');

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // Container images (E9-T01) ship the self-contained server; the monorepo root
  // is the tracing root so workspace packages are included.
  ...(process.env.NEXT_STANDALONE === 'true'
    ? {
        output: 'standalone' as const,
        outputFileTracingRoot: fileURLToPath(
          new URL('../../', import.meta.url),
        ),
      }
    : {}),
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Content-Security-Policy', value: contentSecurityPolicy },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'no-referrer' },
          { key: 'X-Frame-Options', value: 'DENY' },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=()',
          },
        ],
      },
    ];
  },
};

export default nextConfig;
