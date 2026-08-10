import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { CaspianGateway } from '../../src/gateway/caspian-gateway.js';
import { EventBus } from '../../src/gateway/event-bus.js';
import { createWebhookServer } from '../../src/gateway/webhook-server.js';
import type { WebhookServer } from '../../src/gateway/webhook-server.js';
import { createAuthRouter } from '../../src/web/auth-routes.js';
import type { OAuthClientLike, OAuthProfile } from '../../src/web/oauth/types.js';
import { IdentityService } from '../../src/gateway/adapters/identity-service.js';
import { db } from '../../src/db/client.js';
import { actorAccounts } from '../../src/db/schema/actor_accounts.js';
import { runSqliteMigrations } from '../helpers/migrate-sqlite.js';
import { fakeClient } from '../helpers/fixtures.js';

let server: WebhookServer;

function stubOAuthClient(profile: OAuthProfile): OAuthClientLike {
  return {
    getAuthorizeUrl: (state, redirectUri) =>
      `https://provider.example/authorize?state=${state}&redirect_uri=${encodeURIComponent(redirectUri)}`,
    exchangeCodeForProfile: async () => profile,
  };
}

function cookiesFrom(response: Response): Record<string, string> {
  const raw = (response.headers as any).getSetCookie
    ? (response.headers as any).getSetCookie()
    : [response.headers.get('set-cookie') || ''].filter(Boolean);
  const cookies: Record<string, string> = {};
  for (const entry of raw as string[]) {
    const [pair] = entry.split(';');
    const idx = pair.indexOf('=');
    if (idx === -1) continue;
    cookies[pair.slice(0, idx).trim()] = pair.slice(idx + 1).trim();
  }
  return cookies;
}

function cookieHeader(cookies: Record<string, string>): string {
  return Object.entries(cookies)
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');
}

beforeAll(() => {
  runSqliteMigrations();
});

beforeEach(async () => {
  const identityService = new IdentityService();
  const authRouter = createAuthRouter({
    identityService,
    oauthClients: {
      github: stubOAuthClient({
        providerUserId: 'gh-42',
        username: 'octocat',
        avatarUrl: 'https://avatars/octocat.png',
      }),
      slack: stubOAuthClient({ providerUserId: 'U012345', username: 'ada', avatarUrl: null }),
      discord: stubOAuthClient({ providerUserId: 'd-999', username: 'gopher', avatarUrl: null }),
    },
    baseUrl: 'https://example.com',
  });

  const caspianGateway = new CaspianGateway({
    client: fakeClient(),
    bus: new EventBus(),
    enabledChannels: [],
    webhookSecret: 'unused-in-this-suite',
  });

  server = await createWebhookServer({
    gateway: caspianGateway,
    port: 0,
    path: '/webhooks/caspian',
    auth: authRouter,
  });
});

afterEach(async () => {
  await server.close();
});

describe('account-linking dashboard routes', () => {
  it('shows connect buttons for all three providers when no session exists', async () => {
    const response = await fetch(`http://127.0.0.1:${server.port}/dashboard`);
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toContain('/auth/github');
    expect(html).toContain('/auth/slack');
    expect(html).toContain('/auth/discord');
    expect(html).not.toContain('Connected as');
  });

  it('redirects to the provider authorize URL and sets a state cookie', async () => {
    const response = await fetch(`http://127.0.0.1:${server.port}/auth/github`, {
      redirect: 'manual',
    });

    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toContain('https://provider.example/authorize');
    const cookies = cookiesFrom(response);
    expect(cookies.oauth_state_github).toBeDefined();
  });

  it('completes the callback, establishes a session, and shows the linked account on the dashboard', async () => {
    const start = await fetch(`http://127.0.0.1:${server.port}/auth/github`, { redirect: 'manual' });
    const stateCookie = cookiesFrom(start);
    const state = stateCookie.oauth_state_github;

    const callback = await fetch(
      `http://127.0.0.1:${server.port}/auth/github/callback?code=abc&state=${state}`,
      { redirect: 'manual', headers: { Cookie: cookieHeader(stateCookie) } }
    );
    expect(callback.status).toBe(302);
    expect(callback.headers.get('location')).toBe('/dashboard');
    const sessionCookies = cookiesFrom(callback);
    expect(sessionCookies.link_session).toBeDefined();

    const dashboard = await fetch(`http://127.0.0.1:${server.port}/dashboard`, {
      headers: { Cookie: cookieHeader(sessionCookies) },
    });
    const html = await dashboard.text();
    expect(html).toContain('Connected as octocat');
  });

  it('rejects a callback with a missing or mismatched state', async () => {
    const response = await fetch(
      `http://127.0.0.1:${server.port}/auth/github/callback?code=abc&state=wrong`,
      { redirect: 'manual' }
    );
    expect(response.status).toBe(400);
  });

  it('linking a second provider in the same session merges into one shared actor', async () => {
    const start1 = await fetch(`http://127.0.0.1:${server.port}/auth/github`, {
      redirect: 'manual',
    });
    const state1cookies = cookiesFrom(start1);
    const callback1 = await fetch(
      `http://127.0.0.1:${server.port}/auth/github/callback?code=abc&state=${state1cookies.oauth_state_github}`,
      { redirect: 'manual', headers: { Cookie: cookieHeader(state1cookies) } }
    );
    const sessionCookies = cookiesFrom(callback1);

    const start2 = await fetch(`http://127.0.0.1:${server.port}/auth/discord`, {
      redirect: 'manual',
      headers: { Cookie: cookieHeader(sessionCookies) },
    });
    const state2cookies = cookiesFrom(start2);
    const combinedCookies = { ...sessionCookies, ...state2cookies };

    const callback2 = await fetch(
      `http://127.0.0.1:${server.port}/auth/discord/callback?code=abc&state=${state2cookies.oauth_state_discord}`,
      { redirect: 'manual', headers: { Cookie: cookieHeader(combinedCookies) } }
    );
    expect(callback2.status).toBe(302);

    const finalSessionCookies = { ...combinedCookies, ...cookiesFrom(callback2) };
    const dashboard = await fetch(`http://127.0.0.1:${server.port}/dashboard`, {
      headers: { Cookie: cookieHeader(finalSessionCookies) },
    });
    const html = await dashboard.text();
    expect(html).toContain('Connected as octocat');
    expect(html).toContain('Connected as gopher');

    const rows = await db
      .select({ actorId: actorAccounts.actorId, provider: actorAccounts.provider })
      .from(actorAccounts)
      .where(eq(actorAccounts.providerUserId, 'gh-42'));
    const discordRows = await db
      .select({ actorId: actorAccounts.actorId })
      .from(actorAccounts)
      .where(eq(actorAccounts.providerUserId, 'd-999'));
    expect(discordRows[0].actorId).toBe(rows[0].actorId);
  });

  it('logout clears the session cookie', async () => {
    const response = await fetch(`http://127.0.0.1:${server.port}/auth/logout`, {
      redirect: 'manual',
    });
    expect(response.status).toBe(302);
    const cookies = cookiesFrom(response);
    expect(cookies.link_session).toBe('');
  });
});
