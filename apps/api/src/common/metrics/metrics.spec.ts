import {
  decGauge,
  incCounter,
  incGauge,
  registerMetric,
  renderMetrics,
  resetMetricsForTest,
  setGauge,
} from './metrics';

describe('metrics registry', () => {
  beforeEach(() => {
    resetMetricsForTest();
    registerMetric('test_counter', 'test counter', 'counter');
    registerMetric('test_gauge', 'test gauge', 'gauge');
    setGauge('ai_active_streams', {}, 0);
  });

  it('输出 Prometheus 文本格式与标签', () => {
    incCounter('test_counter', { outcome: 'success' });
    incCounter('test_counter', { outcome: 'success' });
    incCounter('test_counter', { outcome: 'error' });
    setGauge('test_gauge', {}, 3);

    const text = renderMetrics();

    expect(text).toContain('# HELP test_counter test counter');
    expect(text).toContain('# TYPE test_counter counter');
    expect(text).toContain('test_counter{outcome="success"} 2');
    expect(text).toContain('test_counter{outcome="error"} 1');
    expect(text).toContain('test_gauge 3');
  });

  it('gauge 支持增减', () => {
    incGauge('ai_active_streams');
    incGauge('ai_active_streams');
    decGauge('ai_active_streams');

    expect(renderMetrics()).toContain('ai_active_streams 1');
  });

  it('标签值会转义引号与换行', () => {
    incCounter('test_counter', { tool: 'a"b\nc' });

    expect(renderMetrics()).toContain('test_counter{tool="a\\"b\\nc"} 1');
  });
});
