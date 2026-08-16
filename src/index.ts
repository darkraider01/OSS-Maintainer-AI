import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { CaspianGateway } from './gateway/caspian-gateway.js';
import { createCommClient } from './gateway/caspian/client.js';
import { EventBus } from './gateway/event-bus.js';
import { createWebhookServer } from './gateway/webhook-server.js';
import type { WebhookServer } from './gateway/webhook-server.js';
import { DeduplicationService } from './gateway/adapters/deduplication-service.js';
import { ConversationService } from './gateway/adapters/conversation-service.js';
import { IdentityService } from './gateway/adapters/identity-service.js';
import { MessagePersistenceService } from './gateway/adapters/message-persistence-service.js';
import { CommunicationService } from './gateway/adapters/communication-service.js';
import { GitHubGateway } from './gateway/github-gateway.js';
import { createGitHubAppClient } from './gateway/github/client.js';
import type { GitHubClientLike } from './gateway/github/client.js';
import { ensureGitHubBotActor } from './gateway/github/bot-identity.js';
import { extractGitHubReplyTarget, postGitHubReply } from './gateway/github/egress.js';
import { ResilientExecutor } from './core/resilience/resilient-executor.js';
import { metrics } from './core/observability/metrics.js';
import { PendingDeliveryStore } from './core/delivery/pending-delivery-store.js';
import { DeliveryRecoveryWorker } from './core/delivery/delivery-recovery-worker.js';
import type { Deliverer } from './core/delivery/delivery-recovery-worker.js';
import type { ProviderKey } from './gateway/unified-event.js';
import { createAuthRouter } from './web/auth-routes.js';
import type { AuthRouter } from './web/auth-routes.js';
import { GitHubOAuthClient } from './web/oauth/github-oauth.js';
import { SlackOAuthClient } from './web/oauth/slack-oauth.js';
import { DiscordOAuthClient } from './web/oauth/discord-oauth.js';
import { Runtime as AgentRuntime } from './core/runtime.js';
import { runSqliteMigrations } from './db/migrate-sqlite.js';

export interface Runtime {
  bus: EventBus;
  gateway: CaspianGateway;
  agentRuntime: AgentRuntime;
  webhookServer?: WebhookServer;
  shutdown(): Promise<void>;
}

/**
 * Wire ingress to the internal event bus.
 *
 * FR-1: messages arrive through Caspian (Slack/Discord) or, for GitHub, a
 * direct webhook (GitHub is not a Caspian channel in the live environment).
 * Both paths get normalized into the same Unified Event Model and reach the
 * same `MaintainerAgent`; a reply goes back out on the same conversation.
 */
export async function bootstrap(options?: { client?: any }): Promise<Runtime> {
  logger.info(
    {
      env: env.NODE_ENV,
      ingress: env.CASPIAN_INGRESS_MODE,
      channels: env.CASPIAN_ENABLED_CHANNELS,
      githubEnabled: env.GITHUB_ENABLED,
      authEnabled: env.AUTH_ENABLED,
    },
    'Bootstrapping OSS-Maintainer-AI Core Engine...'
  );

  // Same dialect condition src/db/client.ts uses to pick SQLite over
  // Postgres. Without this, a fresh checkout's first `pnpm run dev` hits
  // "no such table: actor_accounts" on the very first inbound message -
  // demo-cli.ts and load-test.ts already migrate themselves; bootstrap()
  // is the one real entry point that didn't.
  if (env.NODE_ENV !== 'production' && !process.env.DATABASE_URL) {
    runSqliteMigrations();
  }

  const client = options?.client || createCommClient();
  const bus = new EventBus();
  const caspianEgressExecutor = new ResilientExecutor('caspian-egress');
  const pendingDeliveryStore = new PendingDeliveryStore();

  const dedupService = new DeduplicationService();
  const convService = new ConversationService();
  const identityService = new IdentityService();
  const persistenceService = new MessagePersistenceService();

  // GitHub egress: constructed once (if enabled), reused by the eventPublisher's
  // respond() wiring below and the one-time bot-identity seed.
  const githubClient: GitHubClientLike | undefined = env.GITHUB_ENABLED
    ? createGitHubAppClient()
    : undefined;

  const commService = new CommunicationService(
    dedupService,
    convService,
    identityService,
    persistenceService,
    async (envelope) => {
      if (envelope.payload.provider === 'github' && githubClient) {
        envelope.respond = async (text: string) => {
          // eslint-disable-next-line no-console
          console.log('→ LLM response generated');
          const target = extractGitHubReplyTarget(envelope.payload.metadata);
          if (!target) {
            logger.warn(
              { eventId: envelope.eventId },
              'Missing GitHub owner/repo/issueNumber metadata; cannot post reply'
            );
            return;
          }
          try {
            await postGitHubReply(githubClient!, target, text);
            // eslint-disable-next-line no-console
            console.log('→ GitHub comment posted');
          } catch (error) {
            // postIssueComment already exhausted its own in-process retries
            // (ResilientExecutor) — this is a durable fallback, not a race
            // with that retry logic (PRD §10: "don't lose the event").
            logger.error(
              { err: error, eventId: envelope.eventId },
              'GitHub reply delivery failed after retries; queued for recovery'
            );
            await pendingDeliveryStore.enqueue({
              provider: 'github',
              conversationId: envelope.payload.conversationId,
              target: target as unknown as Record<string, unknown>,
              text,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        };
      } else {
        envelope.respond = async (text: string) => {
          metrics.providerRequestsTotal.inc({ provider: 'caspian' });
          try {
            await caspianEgressExecutor.execute(() =>
              client.reply(envelope.payload.providerEventId, text)
            );
          } catch (error) {
            metrics.providerFailuresTotal.inc({ provider: 'caspian' });
            logger.error(
              { err: error, eventId: envelope.eventId },
              'Caspian reply delivery failed after retries; queued for recovery'
            );
            await pendingDeliveryStore.enqueue({
              provider: envelope.payload.provider,
              conversationId: envelope.payload.conversationId,
              target: { providerEventId: envelope.payload.providerEventId },
              text,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        };
      }
      await bus.publish(envelope as any);
    }
  );

  const githubRoute: { gateway: GitHubGateway; path: string } | undefined = env.GITHUB_ENABLED
    ? {
        gateway: new GitHubGateway({
          communicationService: commService,
          webhookSecret: env.GITHUB_WEBHOOK_SECRET as string,
          receiveMode: env.GITHUB_RECEIVE_MODE,
          botLogin: env.GITHUB_APP_SLUG ? `${env.GITHUB_APP_SLUG}[bot]` : undefined,
        }),
        path: env.GITHUB_WEBHOOK_PATH,
      }
    : undefined;

  const [statsOwner, statsRepo] = env.GITHUB_STATS_REPO?.split('/') ?? [];
  const statsRepository =
    statsOwner && statsRepo ? { owner: statsOwner, repo: statsRepo } : undefined;

  const authRouter: AuthRouter | undefined = env.AUTH_ENABLED
    ? createAuthRouter({
        identityService,
        oauthClients: {
          github: new GitHubOAuthClient(
            env.GITHUB_OAUTH_CLIENT_ID as string,
            env.GITHUB_OAUTH_CLIENT_SECRET as string
          ),
          slack: new SlackOAuthClient(
            env.SLACK_OAUTH_CLIENT_ID as string,
            env.SLACK_OAUTH_CLIENT_SECRET as string
          ),
          discord: new DiscordOAuthClient(
            env.DISCORD_OAUTH_CLIENT_ID as string,
            env.DISCORD_OAUTH_CLIENT_SECRET as string
          ),
        },
        baseUrl: env.AUTH_BASE_URL as string,
        githubClient,
        statsRepository,
      })
    : undefined;

  const gateway = new CaspianGateway({
    client,
    bus,
    enabledChannels: env.CASPIAN_ENABLED_CHANNELS,
    webhookSecret: env.CASPIAN_WEBHOOK_SECRET,
    communicationService: commService,
  });

  const agentRuntime = new AgentRuntime({
    demoMode: env.DEMO_MODE,
    apiKey: env.LLM_API_KEY,
    provider: env.LLM_PROVIDER,
    githubClient,
    maintainerMentionConfig: {
      github: env.MAINTAINER_GITHUB_USERNAME,
      slack: env.MAINTAINER_SLACK_MENTION,
      discord: env.MAINTAINER_DISCORD_MENTION,
    },
  });

  // Registered before the agent-execution subscriber so the trace line prints first.
  if (env.GITHUB_ENABLED) {
    bus.subscribe(async (envelope) => {
      if (envelope?.payload?.provider === 'github') {
        // eslint-disable-next-line no-console
        console.log('→ MaintainerAgent executing');
      }
    });
  }

  bus.subscribe(async (envelope) => {
    if (envelope.payload) {
      await agentRuntime.processEvent(envelope);
    }
  });

  // Webhook mode reaches the gateway through HTTP, so no SDK handler is attached.
  if (env.CASPIAN_INGRESS_MODE === 'poll') gateway.start();

  // GitHub always needs its own bot identity seeded so isSelfEvent() can catch its own comments.
  if (env.GITHUB_ENABLED && githubClient && env.GITHUB_APP_SLUG) {
    ensureGitHubBotActor(identityService, githubClient, env.GITHUB_APP_SLUG).catch((error) => {
      logger.error({ err: error }, 'Failed to seed GitHub bot identity');
    });
  }

  const controller = new AbortController();
  let webhookServer: WebhookServer | undefined;
  let stopRecoveryWorker: (() => void) | undefined;

  // Tests stop here: the transport is what needs a live gateway, not the wiring.
  if (env.NODE_ENV !== 'test' && !env.DEMO_MODE) {
    // GitHub and the auth dashboard both always need a public HTTP endpoint,
    // independent of Caspian's ingress mode.
    const needsHttpServer =
      env.CASPIAN_INGRESS_MODE === 'webhook' || Boolean(githubRoute) || Boolean(authRouter);
    if (needsHttpServer) {
      webhookServer = await createWebhookServer({
        gateway,
        port: env.PORT,
        path: env.CASPIAN_WEBHOOK_PATH,
        github: githubRoute,
        auth: authRouter,
      });
    }
    if (env.CASPIAN_INGRESS_MODE === 'poll') {
      // Runs until the signal aborts; failures surface to the caller.
      void gateway.listen({ signal: controller.signal }).catch((error) => {
        logger.error({ err: error }, 'Caspian listen loop stopped');
      });
    }

    // Sweeps pending_deliveries for anything the in-process retries above
    // couldn't land (PRD §10 durable retry). Same deliverers the live
    // egress paths use, so recovery behaves identically to a fresh send.
    const deliverers: Partial<Record<ProviderKey, Deliverer>> = {
      ...(githubClient
        ? {
            github: async (target: Record<string, unknown>, text: string) => {
              await postGitHubReply(githubClient, target as any, text);
            },
          }
        : {}),
      slack: (target, text) => client.reply((target as any).providerEventId, text),
      discord: (target, text) => client.reply((target as any).providerEventId, text),
    };
    stopRecoveryWorker = new DeliveryRecoveryWorker(pendingDeliveryStore, deliverers).start();
  }

  return {
    bus,
    gateway,
    agentRuntime,
    webhookServer,
    shutdown: async () => {
      controller.abort();
      stopRecoveryWorker?.();
      await webhookServer?.close();
      logger.info('Shutdown complete');
    },
  };
}

// Auto-run if executed directly, avoiding execution in test context
if (process.env.NODE_ENV !== 'test' && !env.DEMO_MODE) {
  bootstrap()
    .then((runtime) => {
      for (const signal of ['SIGINT', 'SIGTERM'] as const) {
        process.once(signal, () => {
          logger.info({ signal }, 'Received shutdown signal');
          void runtime.shutdown().finally(() => process.exit(0));
        });
      }
    })
    .catch((err) => {
      logger.error(err, 'Fatal bootstrap execution error');
      process.exit(1);
    });
}
