/**
 * Render a multi-series dataset as an SVG line chart.
 *
 * @param {Array<{name: string, data: Array<{x: number, y: number}>}>} dataset
 *   One entry per series. Each series contains an ordered list of `{x, y}` points.
 * @param {{width: number, height: number, padding: number}} viewport
 *   The SVG viewport size in pixels, plus the padding reserved inside the axes.
 * @returns {string} SVG markup containing one `<path>` per series.
 */
export function renderChart(dataset, viewport) {
  const { width, height, padding } = viewport;

  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">`;
  const palette = ['#1f77b4', '#ff7f0e', '#2ca02c', '#d62728', '#9467bd', '#8c564b'];

  for (let i = 0; i < dataset.length; i++) {
    const series = dataset[i];
    const color = palette[i % palette.length];
    const pts = series.data || [];

    let d = '';

    if (pts.length > 0) {
      let xMin = Infinity;
      let xMax = -Infinity;
      let yMin = Infinity;
      let yMax = -Infinity;

      for (const p of pts) {
        if (p.x < xMin) xMin = p.x;
        if (p.x > xMax) xMax = p.x;
        if (p.y < yMin) yMin = p.y;
        if (p.y > yMax) yMax = p.y;
      }

      const xSpan = xMax - xMin;
      const ySpan = yMax - yMin;
      const innerW = width - 2 * padding;
      const innerH = height - 2 * padding;
      const xCenter = width / 2;
      const yCenter = height / 2;

      for (let j = 0; j < pts.length; j++) {
        const p = pts[j];
        const sx = xSpan === 0 ? xCenter : padding + ((p.x - xMin) / xSpan) * innerW;
        const sy = ySpan === 0 ? yCenter : height - padding - ((p.y - yMin) / ySpan) * innerH;

        if (j === 0) {
          d += 'M ' + sx + ' ' + sy;
        } else {
          d += ' L ' + sx + ' ' + sy;
        }
      }
    }

    svg += `<path fill="none" stroke="${color}" d="${d}"/>`;
  }

  svg += '</svg>';
  return svg;
}
