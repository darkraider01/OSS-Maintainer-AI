import type { ProviderKey } from '../../gateway/unified-event.js';

export interface MaintainerMentionConfig {
  github?: string;
  slack?: string;
  discord?: string;
}

/**
 * There's no cross-conversation "send to a different channel" capability in
 * this app's Caspian/GitHub client abstractions (`CaspianClientLike.reply`
 * only replies to the message it's given; the GitHub client only posts to
 * the issue/PR it's given) — so a real, verifiable escalation notification
 * means @-mentioning a human in the escalation reply itself. That's not a
 * downgrade: platform-native mentions do actually page the tagged person.
 * Returns null when unconfigured for that provider — same log-only
 * behavior as before this existed.
 */
export function buildMaintainerMention(
  provider: ProviderKey,
  config: MaintainerMentionConfig
): string | null {
  switch (provider) {
    case 'github':
      return config.github ? `@${config.github}` : null;
    case 'slack':
      return config.slack ?? null;
    case 'discord':
      return config.discord ?? null;
    default:
      return null;
  }
}
