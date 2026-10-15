/** 浏览器 Performance 面板可查看，不记录选区、文章内容或凭证。 */
export function recordReadingTiming(name: 'dictionary' | 'first-answer' | 'answer-complete', start: number): void {
  try {
    const key = `feedfuse.reading.${name}`;
    if (performance.getEntriesByName(key).length >= 200) performance.clearMeasures(key);
    performance.measure(key, { start, end: performance.now() });
  } catch {
    // 性能观测不能影响阅读功能（部分浏览器不支持带选项的 measure）。
  }
}
