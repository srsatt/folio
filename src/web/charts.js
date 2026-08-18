function initFlintCharts() {
  const source = document.querySelector("#folio-charts");
  if (!source) return;
  const charts = JSON.parse(source.textContent || "[]");
  const plotly = globalThis.Plotly;
  for (const chart of charts) {
    const target = document.getElementById(chart.id);
    if (!target) continue;
    if (!plotly?.newPlot) {
      target.textContent = "Plotly runtime unavailable.";
      target.dataset.folioChartError = "true";
      continue;
    }
    plotly.newPlot(target, chart.data, { ...chart.layout, autosize: true }, {
      displaylogo: false,
      responsive: true,
      scrollZoom: false,
    }).catch(() => {
      target.textContent = "Chart could not be rendered.";
      target.dataset.folioChartError = "true";
    });
  }
}

if (typeof document !== "undefined") initFlintCharts();
