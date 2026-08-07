/* eslint-disable no-console */
import { bootstrap } from '../index.js';
import { runSqliteMigrations } from '../db/migrate-sqlite.js';
import { logger } from '../config/logger.js';

process.env.DEMO_MODE = 'true';
const mode = process.argv[2] || 'both';

async function runDemo() {
  console.log('\n==================================================');
  console.log('       OSS-Maintainer-AI Zero-Config Demo         ');
  console.log('==================================================\n');

  // 1. Ensure SQLite database is set up
  console.log('Initializing local SQLite database...');
  runSqliteMigrations();

  // 2. Mock Caspian Client to intercept agent egress response
  const mockReplies: Array<{ messageId: string; text: string }> = [];
  const fakeCaspianClient = {
    onMessage: () => {},
    reply: async (messageId: string, text: string) => {
      mockReplies.push({ messageId, text });
      console.log('\n=== Egress Response Sent to Caspian ===');
      console.log(`Target Event ID: ${messageId}`);
      console.log(`Response Payload:\n${text}`);
      console.log('=======================================\n');
    },
    listen: async () => {},
  };

  // 3. Bootstrap runtime with mock client
  const runtime = await bootstrap({ client: fakeCaspianClient });
  // Add slack to enabled channels list manually for demo routing
  (runtime.gateway as any).enabledChannels.add('slack');

  if (mode === 'github' || mode === 'both') {
    console.log('--------------------------------------------------');
    console.log('Demonstrating GitHub Issue Event Ingestion Flow');
    console.log('--------------------------------------------------');
    const rawGithubMessage = {
      id: 'issue_msg_github_demo',
      conversationId: 'github_thread_issue_5',
      channel: 'github',
      sender: {
        id: 'user_octocat_1',
        login: 'octocat',
        display_name: 'The GitHub Octocat',
      },
      text: 'How do I run the local development build in this project?',
      subject: 'Local setup question',
      raw: {
        id: 'issue_msg_github_demo',
        conversation_id: 'github_thread_issue_5',
        channel: 'github',
        sender: {
          id: 'user_octocat_1',
          login: 'octocat',
        },
        text: 'How do I run the local development build in this project?',
      },
    };

    await runtime.gateway.ingest(rawGithubMessage as any);
  }

  if (mode === 'slack' || mode === 'both') {
    console.log('--------------------------------------------------');
    console.log('Demonstrating Slack Mention Event Ingestion Flow');
    console.log('--------------------------------------------------');
    const rawSlackMessage = {
      id: 'slack_ts_slack_demo',
      conversationId: 'slack_channel_C123',
      channel: 'slack',
      sender: {
        id: 'user_slack_dev_2',
        username: 'slackdev',
        display_name: 'Slack Developer',
      },
      text: 'hello @maintainer-agent how does the communication normalization work?',
      subject: null,
      raw: {
        id: 'slack_ts_slack_demo',
        conversation_id: 'slack_channel_C123',
        channel: 'slack',
        sender: {
          id: 'user_slack_dev_2',
          username: 'slackdev',
        },
        text: 'hello @maintainer-agent how does the communication normalization work?',
        ts: '17890000.000100',
        thread_ts: '17890000.000000',
      },
    };

    await runtime.gateway.ingest(rawSlackMessage as any);
  }

  await runtime.shutdown();
  console.log('Demo completed successfully.\n');
}

runDemo().catch((err) => {
  logger.error({ err }, 'Demo script execution crashed');
  process.exit(1);
});
