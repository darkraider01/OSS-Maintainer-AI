import type { Tool } from '../agent/agent-types.js';
import type { ToolDefinition } from '../llm/llm-provider.js';

/**
 * Real tool router (#15), scoped to what this app actually needs: a place
 * to register `Tool` implementations and hand the LLM their declarations.
 * Not a generalized plugin system — deliberately small (PRD §11: "don't
 * build a complicated distributed system").
 */
export class ToolRegistry {
  private readonly tools = new Map<string, Tool>();

  register(tool: Tool): void {
    this.tools.set(tool.name, tool);
  }

  find(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  list(): Tool[] {
    return [...this.tools.values()];
  }

  definitions(): ToolDefinition[] {
    return this.list().map((tool) => ({
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    }));
  }
}
