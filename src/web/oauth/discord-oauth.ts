import type { OAuthClientLike, OAuthProfile } from './types.js';
import { OAuthExchangeError } from './types.js';

type FetchLike = typeof fetch;

/** Standard Discord OAuth2, `identify` scope only — no message/guild access requested. */
export class DiscordOAuthClient implements OAuthClientLike {
  constructor(
    private readonly clientId: string,
    private readonly clientSecret: string,
    private readonly fetchImpl: FetchLike = fetch
  ) {}

  getAuthorizeUrl(state: string, redirectUri: string): string {
    const url = new URL('https://discord.com/api/oauth2/authorize');
    url.searchParams.set('client_id', this.clientId);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', 'identify');
    url.searchParams.set('state', state);
    return url.toString();
  }

  async exchangeCodeForProfile(code: string, redirectUri: string): Promise<OAuthProfile> {
    const tokenResponse = await this.fetchImpl('https://discord.com/api/oauth2/token', {
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
      access_token?: string;
      error?: string;
      error_description?: string;
    };
    if (!tokenData.access_token) {
      throw new OAuthExchangeError(
        'discord',
        tokenData.error_description || 'token exchange failed'
      );
    }

    const profileResponse = await this.fetchImpl('https://discord.com/api/users/@me', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    if (!profileResponse.ok) {
      throw new OAuthExchangeError('discord', `profile fetch failed: ${profileResponse.status}`);
    }
    const profile = (await profileResponse.json()) as {
      id: string;
      username: string;
      avatar: string | null;
    };

    return {
      providerUserId: profile.id,
      username: profile.username,
      avatarUrl: profile.avatar
        ? `https://cdn.discordapp.com/avatars/${profile.id}/${profile.avatar}.png`
        : null,
    };
  }
}
