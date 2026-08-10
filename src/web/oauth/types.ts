export interface OAuthProfile {
  providerUserId: string;
  username: string;
  avatarUrl: string | null;
}

/** One provider's "Sign in with X" flow. Mockable via the injected `fetch` in each implementation. */
export interface OAuthClientLike {
  getAuthorizeUrl(state: string, redirectUri: string): string;
  exchangeCodeForProfile(code: string, redirectUri: string): Promise<OAuthProfile>;
}

export class OAuthExchangeError extends Error {
  constructor(
    readonly provider: string,
    message: string
  ) {
    super(message);
    this.name = 'OAuthExchangeError';
  }
}
