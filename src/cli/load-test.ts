/* eslint-disable no-console */
import { performance } from 'node:perf_hooks';
import { randomUUID } from 'node:crypto';
import { CommunicationService } from '../gateway/adapters/communication-service.js';
import { DeduplicationService } from '../gateway/adapters/deduplication-service.js';
import { ConversationService } from '../gateway/adapters/conversation-service.js';
import { IdentityService } from '../gateway/adapters/identity-service.js';
import { MessagePersistenceService } from '../gateway/adapters/message-persistence-service.js';
import { EventBus } from '../gateway/event-bus.js';
import { Runtime as AgentRuntime } from '../core/runtime.js';
import { runSqliteMigrations } from '../db/migrate-sqlite.js';

/**
 * Repeatable load-testing harness for Issue #28. Exercises the real
 * in-process pipeline (CommunicationService -> EventBus -> WorkflowEngine ->
 * MaintainerAgent) end to end, against the same SQLite dev DB and
 * MockLLMProvider used everywhere else in this repo's dev/test path — no
 * separate "load test mode" code path to drift from what actually runs.
 *
 * Usage: pnpm run load-test -- --scenario=<name> [--repos=N] [--conversations=N]
 *        [--concurrency=N] [--messagesPerConversation=N] [--channel=slack|github] [--json]
 */

export interface ScenarioOptions {
  name: string;
  repositories: number;
  conversations: number;
  concurrency: number;
  messagesPerConversation: number;
  channel: 'slack' | 'github';
  /** Exercises different WorkflowRouter routes, since they have different cost profiles. */
  textStyle: 'general' | 'bug_report' | 'escalation';
}

export interface ScenarioResult {
  name: string;
  options: ScenarioOptions;
  totalEvents: number;
  successCount: number;
  droppedCount: number; // rate-limited/duplicate — ingest() returned null
  errorCount: number; // ingest() threw
  wallMs: number;
  throughputPerSec: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  maxMs: number;
  errorRate: number;
  memHeapUsedBeforeMB: number;
  memHeapUsedAfterMB: number;
  memRssAfterMB: number;
  cpuUserMs: number;
  cpuSystemMs: number;
}

function percentile(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) return 0;
  const idx = Math.min(
    sortedAsc.length - 1,
    Math.max(0, Math.ceil((p / 100) * sortedAsc.length) - 1)
  );
  return sortedAsc[idx];
}

const TEXT_STYLES: Record<ScenarioOptions['textStyle'], (i: number, m: number) => string> = {
  general: (i, m) => `Load test message ${m} for conversation ${i}`,
  bug_report: (i, m) =>
    `The SDK crashes when I call connect() (load test ${i}/${m}). Steps to reproduce: 1. install 2. run.`,
  escalation: (i, m) =>
    `I found a security vulnerability — please escalate this (load test ${i}/${m}).`,
};

function buildRawMessage(
  options: ScenarioOptions,
  conversationIndex: number,
  messageIndex: number
) {
  const repoIndex = conversationIndex % options.repositories;
  const conversationId = `LOADTEST_${options.name}_${repoIndex}_${conversationIndex}_${randomUUID()}`;
  const id = `${conversationId}_m${messageIndex}`;
  const text = TEXT_STYLES[options.textStyle](conversationIndex, messageIndex);

  if (options.channel === 'github') {
    return {
      id,
      conversationId,
      channel: 'github',
      sender: { id: `user_${conversationIndex}`, username: `user${conversationIndex}` },
      text,
      repositoryContext: {
        provider: 'github',
        owner: `load-test-org-${repoIndex}`,
        repositoryName: `repo-${repoIndex}`,
      },
    };
  }
  return {
    id,
    conversationId,
    channel: 'slack',
    sender: { id: `user_${conversationIndex}`, username: `user${conversationIndex}` },
    text,
  };
}

export async function runScenario(options: ScenarioOptions): Promise<ScenarioResult> {
  const bus = new EventBus();
  const commService = new CommunicationService(
    new DeduplicationService(),
    new ConversationService(),
    new IdentityService(),
    new MessagePersistenceService(),
    async (envelope) => {
      envelope.respond = async () => {};
      await bus.publish(envelope as any);
    }
  );

  const agentRuntime = new AgentRuntime({ demoMode: true });
  bus.subscribe(async (envelope) => {
    if (envelope.payload) await agentRuntime.processEvent(envelope);
  });

  const tasks: Array<() => Promise<{ ok: boolean; dropped: boolean; ms: number }>> = [];
  for (let c = 0; c < options.conversations; c += 1) {
    for (let m = 0; m < options.messagesPerConversation; m += 1) {
      const rawMessage = buildRawMessage(options, c, m);
      tasks.push(async () => {
        const start = performance.now();
        try {
          const envelope = await commService.ingest(rawMessage, options.channel);
          return {
            ok: envelope !== null,
            dropped: envelope === null,
            ms: performance.now() - start,
          };
        } catch {
          return { ok: false, dropped: false, ms: performance.now() - start };
        }
      });
    }
  }

  if (global.gc) global.gc();
  const memBefore = process.memoryUsage();
  const cpuBefore = process.cpuUsage();
  const wallStart = performance.now();

  const results: Array<{ ok: boolean; dropped: boolean; ms: number }> = [];
  let cursor = 0;
  async function worker() {
    while (cursor < tasks.length) {
      const task = tasks[cursor];
      cursor += 1;
      results.push(await task());
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, options.concurrency) }, () => worker()));

  const wallMs = performance.now() - wallStart;
  const memAfter = process.memoryUsage();
  const cpuAfter = process.cpuUsage(cpuBefore);

  const successTimings = results
    .filter((r) => r.ok)
    .map((r) => r.ms)
    .sort((a, b) => a - b);
  const droppedCount = results.filter((r) => r.dropped).length;
  const errorCount = results.filter((r) => !r.ok && !r.dropped).length;

  return {
    name: options.name,
    options,
    totalEvents: tasks.length,
    successCount: successTimings.length,
    droppedCount,
    errorCount,
    wallMs,
    throughputPerSec: tasks.length / (wallMs / 1000),
    p50Ms: percentile(successTimings, 50),
    p95Ms: percentile(successTimings, 95),
    p99Ms: percentile(successTimings, 99),
    maxMs: successTimings[successTimings.length - 1] ?? 0,
    errorRate: tasks.length > 0 ? errorCount / tasks.length : 0,
    memHeapUsedBeforeMB: memBefore.heapUsed / 1024 / 1024,
    memHeapUsedAfterMB: memAfter.heapUsed / 1024 / 1024,
    memRssAfterMB: memAfter.rss / 1024 / 1024,
    cpuUserMs: cpuAfter.user / 1000,
    cpuSystemMs: cpuAfter.system / 1000,
  };
}

function printResult(result: ScenarioResult): void {
  console.log(`\n=== ${result.name} ===`);
  console.log(
    `repos=${result.options.repositories} conversations=${result.options.conversations} ` +
      `messagesPerConversation=${result.options.messagesPerConversation} concurrency=${result.options.concurrency} channel=${result.options.channel}`
  );
  console.log(
    `total=${result.totalEvents} success=${result.successCount} dropped=${result.droppedCount} errors=${result.errorCount}`
  );
  console.log(
    `wall=${result.wallMs.toFixed(0)}ms throughput=${result.throughputPerSec.toFixed(1)}/s errorRate=${(result.errorRate * 100).toFixed(2)}%`
  );
  console.log(
    `p50=${result.p50Ms.toFixed(1)}ms p95=${result.p95Ms.toFixed(1)}ms p99=${result.p99Ms.toFixed(1)}ms max=${result.maxMs.toFixed(1)}ms`
  );
  console.log(
    `heapUsed ${result.memHeapUsedBeforeMB.toFixed(1)}MB -> ${result.memHeapUsedAfterMB.toFixed(1)}MB, rss=${result.memRssAfterMB.toFixed(1)}MB`
  );
  console.log(
    `cpu user=${result.cpuUserMs.toFixed(0)}ms system=${result.cpuSystemMs.toFixed(0)}ms`
  );
}

function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const arg of argv) {
    const match = /^--([^=]+)=(.*)$/.exec(arg);
    if (match) out[match[1]] = match[2];
    else if (arg.startsWith('--')) out[arg.slice(2)] = 'true';
  }
  return out;
}

async function main() {
  // Suppresses WorkflowEngine's demo-mode console trace block — cheap per
  // call, but expensive enough at load-test volume to skew the numbers.
  process.env.LOAD_TEST_QUIET = 'true';

  const args = parseArgs(process.argv.slice(2));
  runSqliteMigrations();

  const options: ScenarioOptions = {
    name: args.scenario || 'adhoc',
    repositories: Number(args.repos ?? 1),
    conversations: Number(args.conversations ?? 100),
    concurrency: Number(args.concurrency ?? 50),
    messagesPerConversation: Number(args.messagesPerConversation ?? 1),
    channel: (args.channel as 'slack' | 'github') || 'slack',
    textStyle: (args.textStyle as ScenarioOptions['textStyle']) || 'general',
  };

  const result = await runScenario(options);
  printResult(result);

  if (args.json) {
    console.log(JSON.stringify(result));
  }
}

// Only auto-run when invoked directly (pnpm run load-test / compiled dist/cli/load-test.js),
// not when imported by other scripts/tests.
if (process.argv[1] && /load-test\.(ts|js)$/.test(process.argv[1])) {
  main().catch((err) => {
    console.error('Load test crashed:', err);
    process.exit(1);
  });
}
