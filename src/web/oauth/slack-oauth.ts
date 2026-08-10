import type { OAuthClientLike, OAuthProfile } from './types.js';
import { OAuthExchangeError } from './types.js';

type FetchLike = typeof fetch;

/**
 * Classic "Sign in with Slack" via the `identity.basic` user token scope —
 * distinct from Caspian's own Slack connection, which this app holds no
 * direct credentials for. Uses the standard `oauth.v2.access` + `users.identity`
 * pair rather than the newer OpenID Connect flow, since `identity.basic` is
 * always available as a plain user scope (no separate "Sign In with Slack"
 * feature needs enabling on the Slack app).
 */
export class SlackOAuthClient implements OAuthClientLike {
  constructor(
    private readonly clientId: string,
    private readonly clientSecret: string,
    private readonly fetchImpl: FetchLike = fetch
  ) {}

  getAuthorizeUrl(state: string, redirectUri: string): string {
    const url = new URL('https://slack.com/oauth/v2/authorize');
    url.searchParams.set('client_id', this.clientId);
    url.searchParams.set('user_scope', 'identity.basic');
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('state', state);
    return url.toString();
  }

  async exchangeCodeForProfile(code: string, redirectUri: string): Promise<OAuthProfile> {
    const tokenResponse = await this.fetchImpl('https://slack.com/api/oauth.v2.access', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: this.clientId,
        client_secret: this.clientSecret,
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
      }),
    });
    const tokenData = (await tokenResponse.json()) as {
      ok: boolean;
      error?: string;
      authed_user?: { access_token?: string };
    };
    const userAccessToken = tokenData.authed_user?.access_token;
    if (!tokenData.ok || !userAccessToken) {
      throw new OAuthExchangeError('slack', tokenData.error || 'token exchange failed');
    }

    const identityResponse = await this.fetchImpl('https://slack.com/api/users.identity', {
      headers: { Authorization: `Bearer ${userAccessToken}` },
    });
    const identity = (await identityResponse.json()) as {
      ok: boolean;
      error?: string;
      user?: { id: string; name: string; image_192?: string | null };
    };
    if (!identity.ok || !identity.user) {
      throw new OAuthExchangeError('slack', identity.error || 'profile fetch failed');
    }

    return {
      providerUserId: identity.user.id,
      username: identity.user.name,
      avatarUrl: identity.user.image_192 || null,
    };
  }
}
