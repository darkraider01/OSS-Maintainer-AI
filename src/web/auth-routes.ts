import { randomBytes } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { actorAccounts } from '../db/schema/actor_accounts.js';
import { logger } from '../config/logger.js';
import type { OAuthClientLike } from './oauth/types.js';
import { OAuthExchangeError } from './oauth/types.js';
import { createLinkSession, getLinkSession, setLinkSessionActor } from './link-session-store.js';

type LinkableProvider = 'github' | 'slack' | 'discord';

/** The slice of `IdentityService` this router needs — kept narrow and injectable, like the rest of the app's services. */
export interface IdentityLinker {
  resolveActor(params: {
    provider: LinkableProvider;
    providerUserId: string;
    username: string;
    displayName?: string | null;
    avatarUrl?: string | null;
    email?: string | null;
  }): Promise<string>;
  linkProviderToActor(
    targetActorId: string,
    params: {
      provider: LinkableProvider;
      providerUserId: string;
      username: string;
      displayName?: string | null;
      avatarUrl?: string | null;
      email?: string | null;
    }
  ): Promise<{ actorId: string; merged: boolean }>;
}

export interface AuthRoutesOptions {
  identityService: IdentityLinker;
  oauthClients: Record<LinkableProvider, OAuthClientLike>;
  /** Public base URL (no trailing slash) used to build each provider's redirect_uri. */
  baseUrl: string;
}

const PROVIDER_LABELS: Record<LinkableProvider, string> = {
  github: 'GitHub',
  slack: 'Slack',
  discord: 'Discord',
};

const SESSION_COOKIE = 'link_session';
const STATE_COOKIE_TTL_SECONDS = 300;
const SESSION_COOKIE_TTL_SECONDS = 1800;

function parseCookies(header: string | undefined): Record<string, string> {
  const cookies: Record<string, string> = {};
  if (!header) return cookies;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (key) cookies[key] = decodeURIComponent(value);
  }
  return cookies;
}

function serializeCookie(name: string, value: string, options: { maxAgeSeconds: number }): string {
  return [
    `${name}=${encodeURIComponent(value)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${options.maxAgeSeconds}`,
  ].join('; ');
}

function clearCookie(name: string): string {
  return serializeCookie(name, '', { maxAgeSeconds: 0 });
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function sendHtml(response: ServerResponse, status: number, html: string): void {
  response.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' });
  response.end(html);
}

function pageShell(title: string, body: string): string {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>${escapeHtml(title)}</title>
<style>
  body { font-family: system-ui, sans-serif; max-width: 480px; margin: 60px auto; padding: 0 20px; color: #1a1a1a; }
  h1 { font-size: 1.4rem; }
  .provider { display: flex; align-items: center; justify-content: space-between; padding: 12px 16px; border: 1px solid #ddd; border-radius: 8px; margin-bottom: 10px; }
  .connected { color: #1a7f37; font-weight: 600; }
  a.button { display: inline-block; padding: 8px 14px; background: #1a1a1a; color: #fff; border-radius: 6px; text-decoration: none; }
  .error { color: #b42318; }
</style>
</head>
<body>${body}</body>
</html>`;
}

function renderDashboardPage(
  linkedAccounts: Array<{ provider: string; username: string }>
): string {
  const rows = (Object.keys(PROVIDER_LABELS) as LinkableProvider[])
    .map((provider) => {
      const account = linkedAccounts.find((a) => a.provider === provider);
      const label = PROVIDER_LABELS[provider];
      return account
        ? `<div class="provider"><span>${label}</span><span class="connected">Connected as ${escapeHtml(account.username)}</span></div>`
        : `<div class="provider"><span>${label}</span><a class="button" href="/auth/${provider}">Connect ${label}</a></div>`;
    })
    .join('\n');

  return pageShell(
    'OSS-Maintainer-AI — Link your accounts',
    `<h1>Link your accounts</h1>
     <p>Connect GitHub, Slack, and Discord so OSS-Maintainer-AI remembers your conversation across all three.</p>
     ${rows}
     ${linkedAccounts.length > 0 ? '<p><a href="/auth/logout">Start over with a different identity</a></p>' : ''}`
  );
}

function renderErrorPage(message: string): string {
  return pageShell(
    'OSS-Maintainer-AI — Sign-in error',
    `<h1 class="error">Something went wrong</h1><p>${escapeHtml(message)}</p><p><a href="/dashboard">Back to dashboard</a></p>`
  );
}

/**
 * Account-linking dashboard, sharing the existing webhook HTTP server/port
 * (`src/gateway/webhook-server.ts`). Not part of the provider-ingress
 * pipeline — this is a browser-facing surface for a human to prove they
 * control the same identity on GitHub/Slack/Discord.
 */
export function createAuthRouter(options: AuthRoutesOptions) {
  const { identityService, oauthClients, baseUrl } = options;

  async function handleDashboard(
    request: IncomingMessage,
    response: ServerResponse
  ): Promise<void> {
    const cookies = parseCookies(request.headers.cookie);
    const session = cookies[SESSION_COOKIE] ? await getLinkSession(cookies[SESSION_COOKIE]) : null;

    let linkedAccounts: Array<{ provider: string; username: string }> = [];
    if (session?.actorId) {
      linkedAccounts = await db
        .select({ provider: actorAccounts.provider, username: actorAccounts.username })
        .from(actorAccounts)
        .where(eq(actorAccounts.actorId, session.actorId));
    }

    sendHtml(response, 200, renderDashboardPage(linkedAccounts));
  }

  function handleStart(response: ServerResponse, provider: LinkableProvider): void {
    const state = randomBytes(16).toString('hex');
    const redirectUri = `${baseUrl}/auth/${provider}/callback`;
    const authorizeUrl = oauthClients[provider].getAuthorizeUrl(state, redirectUri);
    response.writeHead(302, {
      Location: authorizeUrl,
      'Set-Cookie': serializeCookie(`oauth_state_${provider}`, state, {
        maxAgeSeconds: STATE_COOKIE_TTL_SECONDS,
      }),
    });
    response.end();
  }

  async function handleCallback(
    request: IncomingMessage,
    response: ServerResponse,
    provider: LinkableProvider
  ): Promise<void> {
    const url = new URL(request.url || '/', 'http://localhost');
    const code = url.searchParams.get('code');
    const stateParam = url.searchParams.get('state');
    const cookies = parseCookies(request.headers.cookie);
    const expectedState = cookies[`oauth_state_${provider}`];

    if (!code || !stateParam || !expectedState || stateParam !== expectedState) {
      logger.warn({ provider }, 'Rejected OAuth callback: missing or mismatched state');
      sendHtml(
        response,
        400,
        renderErrorPage('Your sign-in attempt expired or was invalid. Please try again.')
      );
      return;
    }

    let profile;
    try {
      const redirectUri = `${baseUrl}/auth/${provider}/callback`;
      profile = await oauthClients[provider].exchangeCodeForProfile(code, redirectUri);
    } catch (error) {
      logger.warn({ err: error, provider }, 'OAuth code exchange failed');
      const message =
        error instanceof OAuthExchangeError
          ? error.message
          : `Could not verify your ${PROVIDER_LABELS[provider]} account.`;
      sendHtml(response, 502, renderErrorPage(message));
      return;
    }

    let sessionId = cookies[SESSION_COOKIE];
    let session = sessionId ? await getLinkSession(sessionId) : null;
    if (!session) {
      session = await createLinkSession();
      sessionId = session.id;
    }

    const linkParams = {
      provider,
      providerUserId: profile.providerUserId,
      username: profile.username,
      avatarUrl: profile.avatarUrl,
    };

    if (!session.actorId) {
      const actorId = await identityService.resolveActor(linkParams);
      await setLinkSessionActor(sessionId, actorId);
    } else {
      await identityService.linkProviderToActor(session.actorId, linkParams);
    }

    response.writeHead(302, {
      Location: '/dashboard',
      'Set-Cookie': [
        serializeCookie(SESSION_COOKIE, sessionId, { maxAgeSeconds: SESSION_COOKIE_TTL_SECONDS }),
        clearCookie(`oauth_state_${provider}`),
      ],
    });
    response.end();
  }

  function handleLogout(response: ServerResponse): void {
    response.writeHead(302, { Location: '/dashboard', 'Set-Cookie': clearCookie(SESSION_COOKIE) });
    response.end();
  }

  /** Returns `true` if this router handled the request, `false` to fall through to the caller's 404. */
  async function handle(
    request: IncomingMessage,
    response: ServerResponse,
    pathname: string
  ): Promise<boolean> {
    if (request.method !== 'GET') return false;

    if (pathname === '/dashboard') {
      await handleDashboard(request, response);
      return true;
    }
    if (pathname === '/auth/logout') {
      handleLogout(response);
      return true;
    }

    const match = /^\/auth\/(github|slack|discord)(\/callback)?$/.exec(pathname);
    if (match) {
      const provider = match[1] as LinkableProvider;
      if (match[2]) {
        await handleCallback(request, response, provider);
      } else {
        handleStart(response, provider);
      }
      return true;
    }

    return false;
  }

  return { handle };
}

export type AuthRouter = ReturnType<typeof createAuthRouter>;
