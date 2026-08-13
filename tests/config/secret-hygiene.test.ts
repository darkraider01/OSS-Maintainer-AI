import { describe, expect, it, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { eq } from 'drizzle-orm';
import { db } from '../../src/db/client.js';
import { messages } from '../../src/db/schema/messages.js';
import { CommunicationService } from '../../src/gateway/adapters/communication-service.js';
import { DeduplicationService } from '../../src/gateway/adapters/deduplication-service.js';
import { ConversationService } from '../../src/gateway/adapters/conversation-service.js';
import { IdentityService } from '../../src/gateway/adapters/identity-service.js';
import { MessagePersistenceService } from '../../src/gateway/adapters/message-persistence-service.js';
import { runSqliteMigrations } from '../helpers/migrate-sqlite.js';

/** Real-secret shapes this repo's own tooling could plausibly emit — GitHub/Slack tokens, long hex/base64 blobs. */
const REAL_SECRET_PATTERNS = [
  /ghp_[A-Za-z0-9]{20,}/,
  /github_pat_[A-Za-z0-9_]{20,}/,
  /xox[bpc]-[A-Za-z0-9-]{10,}/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\b[A-Za-z0-9+/]{40,}={0,2}\b/, // long base64
];

describe('secret hygiene (#26)', () => {
  it('.env.example contains only placeholders — no real-secret-shaped values', () => {
    const content = readFileSync('.env.example', 'utf-8');
    for (const pattern of REAL_SECRET_PATTERNS) {
      expect(content).not.toMatch(pattern);
    }
  });

  it('.env.example never hardcodes a non-empty, non-placeholder value for a *_SECRET/*_KEY/*_TOKEN variable', () => {
    const content = readFileSync('.env.example', 'utf-8');
    const lines = content
      .split('\n')
      .filter((l) => /^[A-Z_]+_(SECRET|KEY|TOKEN|PRIVATE_KEY)=/.test(l));
    expect(lines.length).toBeGreaterThan(0); // sanity: we're actually checking something

    for (const line of lines) {
      const [, value] = line.split('=');
      const trimmed = (value ?? '').trim();
      // Empty, or an obvious human-readable placeholder (contains "your_"/"here") — never a real secret.
      const isPlaceholder = trimmed === '' || /your_|_here|<.*>/i.test(trimmed);
      expect(isPlaceholder, `Suspicious non-placeholder value for: ${line}`).toBe(true);
    }
  });

  describe('persisted message content', () => {
    beforeAll(() => {
      runSqliteMigrations();
    });

    it('never stores the raw provider payload — only the extracted text/subject', async () => {
      const commService = new CommunicationService(
        new DeduplicationService(),
        new ConversationService(),
        new IdentityService(),
        new MessagePersistenceService(),
        async () => {}
      );

      const secretLookingValue = 'xoxb-fake-internal-token-should-never-be-persisted';
      const envelope = await commService.ingest(
        {
          id: `secret_test_${Date.now()}`,
          conversationId: `C_SECRET_${Date.now()}`,
          channel: 'slack',
          sender: { id: 'U_1', username: 'reporter' },
          text: 'a perfectly normal message',
          raw: {
            // Simulates a provider payload that happens to carry an internal
            // credential in a field this app doesn't need — it must never
            // reach persisted storage even though it's present on the raw
            // inbound object.
            internal_bot_token: secretLookingValue,
          },
        },
        'slack'
      );

      expect(envelope).not.toBeNull();
      const rows = await db
        .select({ content: messages.content })
        .from(messages)
        .where(eq(messages.conversationId, envelope!.payload.conversationId));

      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) {
        expect(row.content).not.toContain(secretLookingValue);
      }
    });
  });
});
