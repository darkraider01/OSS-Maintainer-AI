import { describe, expect, it, vi } from 'vitest';
import { GitHubOAuthClient } from '../../src/web/oauth/github-oauth.js';
import { SlackOAuthClient } from '../../src/web/oauth/slack-oauth.js';
import { DiscordOAuthClient } from '../../src/web/oauth/discord-oauth.js';
import { OAuthExchangeError } from '../../src/web/oauth/types.js';

/** Returns a fake `fetch` that yields each response in order, one per call. */
function sequenceFetch(responses: Array<{ ok?: boolean; status?: number; json: unknown }>) {
  let call = 0;
  return vi.fn(async () => {
    const r = responses[call++];
    return {
      ok: r.ok ?? true,
      status: r.status ?? 200,
      json: async () => r.json,
    } as Response;
  });
}

describe('GitHubOAuthClient', () => {
  it('builds an authorize URL with client id, redirect uri, scope, and state', () => {
    const client = new GitHubOAuthClient('cid', 'csecret');
    const url = new URL(client.getAuthorizeUrl('state123', 'https://example.com/auth/github/callback'));
    expect(url.origin + url.pathname).toBe('https://github.com/login/oauth/authorize');
    expect(url.searchParams.get('client_id')).toBe('cid');
    expect(url.searchParams.get('redirect_uri')).toBe('https://example.com/auth/github/callback');
    expect(url.searchParams.get('scope')).toBe('read:user');
    expect(url.searchParams.get('state')).toBe('state123');
  });

  it('exchanges a code for a normalized profile', async () => {
    const fetchImpl = sequenceFetch([
      { json: { access_token: 'tok_123' } },
      { json: { id: 4242, login: 'octocat', avatar_url: 'https://avatars/octocat.png' } },
    ]);
    const client = new GitHubOAuthClient('cid', 'csecret', fetchImpl as any);

    const profile = await client.exchangeCodeForProfile('code', 'https://example.com/callback');

    expect(profile).toEqual({
      providerUserId: '4242',
      username: 'octocat',
      avatarUrl: 'https://avatars/octocat.png',
    });
  });

  it('throws OAuthExchangeError when the token exchange fails', async () => {
    const fetchImpl = sequenceFetch([{ json: { error: 'bad_verification_code' } }]);
    const client = new GitHubOAuthClient('cid', 'csecret', fetchImpl as any);

    await expect(client.exchangeCodeForProfile('bad', 'https://example.com/callback')).rejects.toThrow(
      OAuthExchangeError
    );
  });
});

describe('SlackOAuthClient', () => {
  it('builds an authorize URL for the identity.basic user scope', () => {
    const client = new SlackOAuthClient('cid', 'csecret');
    const url = new URL(client.getAuthorizeUrl('state123', 'https://example.com/auth/slack/callback'));
    expect(url.origin + url.pathname).toBe('https://slack.com/oauth/v2/authorize');
    expect(url.searchParams.get('user_scope')).toBe('identity.basic');
  });

  it('exchanges a code for a normalized profile via oauth.v2.access + users.identity', async () => {
    const fetchImpl = sequenceFetch([
      { json: { ok: true, authed_user: { access_token: 'tok_123' } } },
      {
        json: {
          ok: true,
          user: { id: 'U012345', name: 'Ada Lovelace', image_192: 'https://avatars/ada.png' },
        },
      },
    ]);
    const client = new SlackOAuthClient('cid', 'csecret', fetchImpl as any);

    const profile = await client.exchangeCodeForProfile('code', 'https://example.com/callback');

    expect(profile).toEqual({
      providerUserId: 'U012345',
      username: 'Ada Lovelace',
      avatarUrl: 'https://avatars/ada.png',
    });
  });

  it('throws OAuthExchangeError when the token exchange reports ok:false', async () => {
    const fetchImpl = sequenceFetch([{ json: { ok: false, error: 'invalid_code' } }]);
    const client = new SlackOAuthClient('cid', 'csecret', fetchImpl as any);

    await expect(client.exchangeCodeForProfile('bad', 'https://example.com/callback')).rejects.toThrow(
      OAuthExchangeError
    );
  });

  it('throws OAuthExchangeError when users.identity reports ok:false', async () => {
    const fetchImpl = sequenceFetch([
      { json: { ok: true, authed_user: { access_token: 'tok_123' } } },
      { json: { ok: false, error: 'invalid_auth' } },
    ]);
    const client = new SlackOAuthClient('cid', 'csecret', fetchImpl as any);

    await expect(client.exchangeCodeForProfile('code', 'https://example.com/callback')).rejects.toThrow(
      OAuthExchangeError
    );
  });
});

describe('DiscordOAuthClient', () => {
  it('builds an authorize URL with the identify scope', () => {
    const client = new DiscordOAuthClient('cid', 'csecret');
    const url = new URL(
      client.getAuthorizeUrl('state123', 'https://example.com/auth/discord/callback')
    );
    expect(url.origin + url.pathname).toBe('https://discord.com/api/oauth2/authorize');
    expect(url.searchParams.get('scope')).toBe('identify');
  });

  it('exchanges a code for a profile and builds the avatar CDN URL', async () => {
    const fetchImpl = sequenceFetch([
      { json: { access_token: 'tok_123' } },
      { json: { id: '999888777', username: 'gopher', avatar: 'abc123hash' } },
    ]);
    const client = new DiscordOAuthClient('cid', 'csecret', fetchImpl as any);

    const profile = await client.exchangeCodeForProfile('code', 'https://example.com/callback');

    expect(profile).toEqual({
      providerUserId: '999888777',
      username: 'gopher',
      avatarUrl: 'https://cdn.discordapp.com/avatars/999888777/abc123hash.png',
    });
  });

  it('returns a null avatarUrl when the user has no custom avatar', async () => {
    const fetchImpl = sequenceFetch([
      { json: { access_token: 'tok_123' } },
      { json: { id: '999888777', username: 'gopher', avatar: null } },
    ]);
    const client = new DiscordOAuthClient('cid', 'csecret', fetchImpl as any);

    const profile = await client.exchangeCodeForProfile('code', 'https://example.com/callback');

    expect(profile.avatarUrl).toBeNull();
  });

  it('throws OAuthExchangeError when the profile fetch fails', async () => {
    const fetchImpl = sequenceFetch([
      { json: { access_token: 'tok_123' } },
      { ok: false, status: 401, json: {} },
    ]);
    const client = new DiscordOAuthClient('cid', 'csecret', fetchImpl as any);

    await expect(client.exchangeCodeForProfile('code', 'https://example.com/callback')).rejects.toThrow(
      OAuthExchangeError
    );
  });
});
