import type { Intent } from '../intent/intent-types.js';
import type { EscalationWorkflow, Workflow } from './workflow-types.js';

/**
 * Routes a classified intent to the workflow that handles it. Every
 * non-escalation intent must have a registered workflow, with `general_qa`
 * acting as the catch-all. Escalation is routed separately (it's a
 * cross-cutting override, not a normal intent route) — see MaintainerAgent.
 */
export class WorkflowRouter {
  private readonly routes = new Map<Intent, Workflow>();

  constructor(readonly escalationWorkflow: EscalationWorkflow) {}

  register(intent: Intent, workflow: Workflow): void {
    this.routes.set(intent, workflow);
  }

  route(intent: Intent): Workflow {
    const workflow = this.routes.get(intent) ?? this.routes.get('general_qa');
    if (!workflow) {
      throw new Error('WorkflowRouter has no general_qa fallback registered');
    }
    return workflow;
  }
}
