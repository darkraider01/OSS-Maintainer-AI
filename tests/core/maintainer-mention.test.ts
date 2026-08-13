import { describe, expect, it } from 'vitest';
import { buildMaintainerMention } from '../../src/core/escalation/maintainer-mention.js';

describe('buildMaintainerMention', () => {
  it('builds an @-mention for GitHub from a plain username', () => {
    expect(buildMaintainerMention('github', { github: 'darkraider01' })).toBe('@darkraider01');
  });

  it('passes Slack/Discord mention syntax through verbatim', () => {
    expect(buildMaintainerMention('slack', { slack: '<@U0123ABC>' })).toBe('<@U0123ABC>');
    expect(buildMaintainerMention('discord', { discord: '<@123456789012345678>' })).toBe(
      '<@123456789012345678>'
    );
  });

  it('returns null when that provider has no mention configured', () => {
    expect(buildMaintainerMention('github', {})).toBeNull();
    expect(buildMaintainerMention('slack', { github: 'someone' })).toBeNull();
  });

  it('returns null for providers with no mention concept (email, telegram, unknown)', () => {
    expect(buildMaintainerMention('email', { github: 'x', slack: 'y', discord: 'z' })).toBeNull();
    expect(buildMaintainerMention('telegram', { github: 'x' })).toBeNull();
    expect(buildMaintainerMention('unknown', {})).toBeNull();
  });
});
