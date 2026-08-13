import { describe, expect, it } from 'vitest';
import { ToolRegistry } from '../../src/core/tools/tool-registry.js';
import type { Tool } from '../../src/core/agent/agent-types.js';

function makeTool(name: string): Tool {
  return {
    name,
    description: `${name} description`,
    parameters: { type: 'object', properties: {} },
    execute: async () => ({ ok: true }),
  };
}

describe('ToolRegistry', () => {
  it('registers and finds tools by name', () => {
    const registry = new ToolRegistry();
    const tool = makeTool('search_documentation');
    registry.register(tool);
    expect(registry.find('search_documentation')).toBe(tool);
    expect(registry.find('unknown')).toBeUndefined();
  });

  it('exposes LLM-facing definitions without the execute() implementation', () => {
    const registry = new ToolRegistry();
    registry.register(makeTool('a'));
    registry.register(makeTool('b'));

    const definitions = registry.definitions();
    expect(definitions).toHaveLength(2);
    expect(definitions[0]).toEqual({
      name: 'a',
      description: 'a description',
      parameters: { type: 'object', properties: {} },
    });
    expect((definitions[0] as any).execute).toBeUndefined();
  });
});
