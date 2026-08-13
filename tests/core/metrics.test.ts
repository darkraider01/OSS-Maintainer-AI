import { describe, expect, it } from 'vitest';
import { Counter, Histogram, MetricsRegistry } from '../../src/core/observability/metrics.js';

describe('Counter', () => {
  it('renders zero when never incremented', () => {
    const counter = new Counter('test_total', 'A test counter');
    expect(counter.render()).toContain('test_total 0');
  });

  it('accumulates per label combination independently', () => {
    const counter = new Counter('test_total', 'A test counter', ['provider']);
    counter.inc({ provider: 'github' });
    counter.inc({ provider: 'github' });
    counter.inc({ provider: 'slack' });

    const rendered = counter.render();
    expect(rendered).toContain('test_total{provider="github"} 2');
    expect(rendered).toContain('test_total{provider="slack"} 1');
  });
});

describe('Histogram', () => {
  it('places observations into the correct cumulative buckets', () => {
    const histogram = new Histogram('test_duration_seconds', 'A test histogram', [], [0.1, 1, 10]);
    histogram.observeSeconds(0.05);
    histogram.observeSeconds(0.5);
    histogram.observeSeconds(5);

    const rendered = histogram.render();
    expect(rendered).toContain('test_duration_seconds_bucket{le="0.1"} 1');
    expect(rendered).toContain('test_duration_seconds_bucket{le="1"} 2');
    expect(rendered).toContain('test_duration_seconds_bucket{le="10"} 3');
    expect(rendered).toContain('test_duration_seconds_bucket{le="+Inf"} 3');
    expect(rendered).toContain('test_duration_seconds_count 3');
    expect(rendered).toContain('test_duration_seconds_sum 5.55');
  });
});

describe('MetricsRegistry', () => {
  it('renders every registered metric in Prometheus text exposition format', () => {
    const registry = new MetricsRegistry();
    registry.eventsReceivedTotal.inc({ provider: 'github' });
    registry.escalationsTotal.inc({ reason: 'sensitive_topic' });

    const output = registry.render();
    expect(output).toContain('# TYPE events_received_total counter');
    expect(output).toContain('events_received_total{provider="github"} 1');
    expect(output).toContain('escalations_total{reason="sensitive_topic"} 1');
    expect(output).toContain('# TYPE llm_request_duration_seconds histogram');
  });
});
