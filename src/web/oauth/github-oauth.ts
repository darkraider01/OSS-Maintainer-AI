import type { OAuthClientLike, OAuthProfile } from './types.js';
import { OAuthExchangeError } from './types.js';

type FetchLike = typeof fetch;

/**
 * Standard GitHub OAuth (`login/oauth/authorize` + `login/oauth/access_token`),
 * using the same GitHub App's built-in OAuth client credentials — not a
 * separate App, and not the App's own JWT/installation-token auth used
 * elsewhere for webhook egress.
 */
export class GitHubOAuthClient implements OAuthClientLike {
  constructor(
    private readonly clientId: string,
    private readonly clientSecret: string,
    private readonly fetchImpl: FetchLike = fetch
  ) {}

  getAuthorizeUrl(state: string, redirectUri: string): string {
    const url = new URL('https://github.com/login/oauth/authorize');
    url.searchParams.set('client_id', this.clientId);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('scope', 'read:user');
    url.searchParams.set('state', state);
    return url.toString();
  }

  async exchangeCodeForProfile(code: string, redirectUri: string): Promise<OAuthProfile> {
    const tokenResponse = await this.fetchImpl('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        client_id: this.clientId,
        client_secret: this.clientSecret,
        code,
        redirect_uri: redirectUri,
      }),
    });
    const tokenData = (await tokenResponse.json()) as {
      access_token?: string;
      error?: string;
      error_description?: string;
    };
    if (!tokenData.access_token) {
      throw new OAuthExchangeError(
        'github',
        tokenData.error_description || 'token exchange failed'
      );
    }

    const profileResponse = await this.fetchImpl('https://api.github.com/user', {
      headers: {
        Authorization: `Bearer ${tokenData.access_token}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'oss-maintainer-ai',
      },
    });
    if (!profileResponse.ok) {
      throw new OAuthExchangeError('github', `profile fetch failed: ${profileResponse.status}`);
    }
    const profile = (await profileResponse.json()) as {
      id: number;
      login: string;
      avatar_url: string | null;
    };

    return {
      providerUserId: String(profile.id),
      username: profile.login,
      avatarUrl: profile.avatar_url,
    };
  }
}
