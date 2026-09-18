(() => {
  "use strict";

  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => Array.from(document.querySelectorAll(selector));

  const COLORS = {
    ink: "#ededed",
    muted: "#aaaaaa",
    faint: "#777777",
    grid: "#202020",
    zero: "#444444",
    real: "#a6bfae",
    imag: "#999ba9",
    density: "#d4d4d4",
    potential: "#6f7d85",
    potentialFill: "rgba(130, 140, 145, 0.12)",
    energy: "rgba(180, 166, 139, 0.68)",
    paper: "#0c0c0c",
  };

  const DEFAULTS = { energy: 1, height: 2, width: 0.5, gap: 0.5, shape: "rectangle", dx: 0.005 };
  const PRESETS = {
    tunnel: DEFAULTS,
    above: { energy: 3, height: 1.5, width: 0.5, gap: 0.5, shape: "rectangle", dx: 0.005 },
    double: { energy: 1, height: 2, width: 0.35, gap: 0.5, shape: "double", dx: 0.005 },
  };
  const LIMITS = {
    energy: { min: 0.05, max: 5, step: 0.05 },
    height: { min: 0, max: 8, step: 0.1 },
    width: { min: 0, max: 2, step: 0.01 },
    gap: { min: 0, max: 2, step: 0.01 },
  };
  const SWEEP_CONFIG = {
    width: { min: 0, max: 2, step: 0.01, label: "Barrier width a", unit: "nm" },
    height: { min: 0, max: 8, step: 0.1, label: "Barrier height V₀", unit: "eV" },
    energy: { min: 0.05, max: 5, step: 0.05, label: "Incident energy E", unit: "eV" },
  };

  const elements = {
    form: $("#parameterForm"),
    dx: $("#dxSelect"),
    gapGroup: $("#gapGroup"),
    errorBanner: $("#errorBanner"),
    errorText: $("#errorText"),
    waveCanvas: $("#waveCanvas"),
    waveWrap: $("#waveCanvasWrap"),
    waveLoading: $("#waveLoading"),
    waveTooltip: $("#waveTooltip"),
    sweepCanvas: $("#sweepCanvas"),
    sweepWrap: $("#sweepCanvasWrap"),
    sweepLoading: $("#sweepLoading"),
    sweepTooltip: $("#sweepTooltip"),
    sweepVariable: $("#sweepVariable"),
    sweepStart: $("#sweepStart"),
    sweepStop: $("#sweepStop"),
    logScale: $("#logScale"),
    runSweep: $("#runSweepButton"),
    phaseButton: $("#phaseButton"),
    phaseReadout: $("#phaseReadout"),
  };

  const state = {
    sim: null,
    sweep: null,
    visible: { real: true, imag: true, density: true, potential: true },
    phase: 0,
    phasePlaying: false,
    animationFrame: 0,
    lastFrameTime: 0,
    simulateRequest: 0,
    sweepRequest: 0,
    simulateController: null,
    sweepController: null,
    sweepStale: false,
    simulateTimer: 0,
    lastErrorAction: "simulate",
    wavePlot: null,
    sweepPlot: null,
  };

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function finiteNumber(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function formatNumber(value, digits = 6) {
    if (!Number.isFinite(value)) return "—";
    const magnitude = Math.abs(value);
    if (magnitude !== 0 && (magnitude < 1e-4 || magnitude >= 1e5)) {
      const [mantissa, exponent] = value.toExponential(3).split("e");
      return `${mantissa} × 10${superscript(Number(exponent))}`;
    }
    return value.toFixed(digits).replace(/\.?0+$/, "");
  }

  function formatTick(value) {
    if (!Number.isFinite(value)) return "";
    if (value !== 0 && Math.abs(value) < 0.001) {
      const [mantissa, exponent] = value.toExponential(0).split("e");
      return `${mantissa} × 10${superscript(Number(exponent))}`;
    }
    if (Math.abs(value) >= 100) return value.toFixed(0);
    if (Math.abs(value) >= 10) return value.toFixed(1).replace(/\.0$/, "");
    return value.toFixed(2).replace(/\.?0+$/, "");
  }

  function currentParams() {
    const shape = $("input[name='shape']:checked")?.value || DEFAULTS.shape;
    return {
      energy: finiteNumber($("#energyNumber").value, DEFAULTS.energy),
      height: finiteNumber($("#heightNumber").value, DEFAULTS.height),
      width: finiteNumber($("#widthNumber").value, DEFAULTS.width),
      shape,
      gap: finiteNumber($("#gapNumber").value, DEFAULTS.gap),
      dx: finiteNumber(elements.dx.value, DEFAULTS.dx),
    };
  }

  function paramsQuery(params) {
    return new URLSearchParams({
      energy: String(params.energy),
      height: String(params.height),
      width: String(params.width),
      shape: params.shape,
      gap: String(params.gap),
      dx: String(params.dx),
    });
  }

  function setError(message, action = "simulate") {
    state.lastErrorAction = action;
    elements.errorText.textContent = message;
    elements.errorBanner.hidden = false;
  }

  function clearError() {
    elements.errorBanner.hidden = true;
  }

  async function readJson(response) {
    if (!response.ok) {
      let detail = "";
      try {
        const body = await response.json();
        detail = body.error || body.message || body.detail || "";
      } catch (_) {
        detail = "";
      }
      throw new Error(detail || `Solver returned ${response.status}`);
    }
    return response.json();
  }

  function validateSimulation(data) {
    const series = [data?.x, data?.potential, data?.real, data?.imag, data?.density];
    if (!series.every(Array.isArray) || series.some((arr) => arr.length !== series[0].length) || series[0].length < 2) {
      throw new Error("Incomplete wavefunction data");
    }
    if (![data.transmission, data.reflection, data.conservation_error].every(Number.isFinite)) {
      throw new Error("Invalid numerical metrics");
    }
    return data;
  }

  function validateSweep(data) {
    if (!Array.isArray(data?.values) || !Array.isArray(data?.transmission) || data.values.length !== data.transmission.length || data.values.length < 2) {
      throw new Error("Incomplete sweep data");
    }
    return data;
  }

  async function simulate() {
    window.clearTimeout(state.simulateTimer);
    state.simulateController?.abort();
    const requestId = ++state.simulateRequest;
    const controller = new AbortController();
    state.simulateController = controller;
    elements.waveLoading.hidden = false;
    const params = currentParams();

    try {
      const response = await fetch(`/api/simulate?${paramsQuery(params)}`, { signal: controller.signal });
      const data = validateSimulation(await readJson(response));
      if (requestId !== state.simulateRequest) return;
      state.sim = data;
      state.phase = 0;
      clearError();
      updateMetrics(data);
      document.dispatchEvent(new CustomEvent("quantum:solution", { detail: data }));
      updatePresetState();
      drawWave();
    } catch (error) {
      if (error.name === "AbortError" || requestId !== state.simulateRequest) return;
      setError(error.message || "Cannot connect to the solver. Please retry.", "simulate");
    } finally {
      if (requestId === state.simulateRequest) elements.waveLoading.hidden = true;
    }
  }

  function invalidateSimulation() {
    state.simulateRequest += 1;
    state.simulateController?.abort();
    state.simulateController = null;
  }

  function invalidateSweep(message = "Parameters changed · showing previous result") {
    state.sweepRequest += 1;
    state.sweepController?.abort();
    state.sweepController = null;
    elements.sweepLoading.hidden = true;
    elements.runSweep.disabled = false;
    state.sweepStale = Boolean(state.sweep);
    $("#sweepError").textContent = state.sweep ? message : "No sweep yet";
  }

  function scheduleSimulation() {
    window.clearTimeout(state.simulateTimer);
    invalidateSimulation();
    invalidateSweep();
    elements.waveLoading.hidden = false;
    state.simulateTimer = window.setTimeout(simulate, 200);
  }

  async function runSweep() {
    const variable = elements.sweepVariable.value;
    const config = SWEEP_CONFIG[variable];
    const start = finiteNumber(elements.sweepStart.value, config.min);
    const stop = finiteNumber(elements.sweepStop.value, config.max);
    if (start < config.min || stop > config.max || start >= stop) {
      setError(`Sweep range must be within ${config.min}–${config.max} ${config.unit}, with the end larger than the start.`, "sweep");
      return;
    }

    state.sweepController?.abort();
    const requestId = ++state.sweepRequest;
    const controller = new AbortController();
    state.sweepController = controller;
    const query = paramsQuery(currentParams());
    query.set("variable", variable);
    query.set("start", String(start));
    query.set("stop", String(stop));
    query.set("count", "81");
    elements.sweepLoading.hidden = false;
    elements.runSweep.disabled = true;
    state.sweepStale = Boolean(state.sweep);
    if (state.sweep) $("#sweepError").textContent = "Recomputing sweep with current parameters…";

    try {
      const response = await fetch(`/api/sweep?${query}`, { signal: controller.signal });
      const data = validateSweep(await readJson(response));
      if (requestId !== state.sweepRequest) return;
      state.sweep = data;
      state.sweepStale = false;
      clearError();
      drawSweep();
      const maxError = finiteNumber(data.max_conservation_error, NaN);
      $("#sweepError").textContent = Number.isFinite(maxError)
        ? `Maximum conservation error ${formatNumber(maxError, 4)}`
        : `${data.values.length} sweep points`;
    } catch (error) {
      if (error.name === "AbortError" || requestId !== state.sweepRequest) return;
      if (state.sweep) {
        state.sweepStale = true;
        $("#sweepError").textContent = "Sweep failed · showing previous result";
      }
      setError(error.message || "Sweep failed. Check parameters and retry.", "sweep");
    } finally {
      if (requestId === state.sweepRequest) {
        elements.sweepLoading.hidden = true;
        elements.runSweep.disabled = false;
      }
    }
  }

  function updateMetrics(data) {
    $("#transmissionValue").textContent = formatNumber(data.transmission);
    $("#reflectionValue").textContent = formatNumber(data.reflection);
    $("#conservationValue").textContent = formatNumber(data.conservation_error);
    $("#transmissionBar").style.width = `${clamp(data.transmission, 0, 1) * 100}%`;
    $("#reflectionNote").textContent = `T + R = ${formatNumber(data.transmission + data.reflection)}`;

    if (Number.isFinite(data.absolute_error)) {
      $("#analyticErrorValue").textContent = formatNumber(data.absolute_error);
      $("#analyticNote").textContent = `Analytic T = ${formatNumber(data.analytic_transmission)}`;
    } else {
      $("#analyticErrorValue").textContent = "N/A";
      $("#analyticNote").textContent = "Analytic reference: rectangles only";
    }

    const regimeMap = {
      tunneling: "Classically forbidden · tunneling",
      threshold: "Near threshold",
      above: "Above-barrier scattering",
    };
    $("#regimePill").textContent = regimeMap[data.regime] || "Stationary scattering";
    $("#methodName").textContent = "Finite differences · transparent leads";
    const actualDx = Number.isFinite(data.dx) ? data.dx : currentParams().dx;
    const points = Number.isFinite(data.points) ? data.points : data.x.length;
    const gapText = data.params?.shape === "double" && Number.isFinite(data.effective_gap)
      ? ` · Actual gap ${formatNumber(data.effective_gap, 4)} nm`
      : "";
    $("#gridMeta").textContent = `Actual Δx ${formatNumber(actualDx, 5)} nm · ${points} points${gapText}`;
    elements.waveCanvas.setAttribute(
      "aria-label",
      `Wavefunction and barrier. Transmission ${formatNumber(data.transmission)}, reflection ${formatNumber(data.reflection)}.`,
    );
  }

  function setupCanvas(canvas) {
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));
    const pixelWidth = Math.round(width * dpr);
    const pixelHeight = Math.round(height * dpr);
    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;
    }
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    return { ctx, width, height, dpr };
  }

  function niceMax(value) {
    if (!Number.isFinite(value) || value <= 0) return 1;
    const exponent = 10 ** Math.floor(Math.log10(value));
    const fraction = value / exponent;
    const nice = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10;
    return nice * exponent;
  }

  function drawText(ctx, text, x, y, options = {}) {
    ctx.save();
    ctx.fillStyle = options.color || COLORS.muted;
    ctx.font = `${options.weight || 400} ${options.size || 10}px ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
    ctx.textAlign = options.align || "center";
    ctx.textBaseline = options.baseline || "middle";
    if (options.rotate) {
      ctx.translate(x, y);
      ctx.rotate(options.rotate);
      ctx.fillText(text, 0, 0);
    } else {
      ctx.fillText(text, x, y);
    }
    ctx.restore();
  }

  function drawWave() {
    const data = state.sim;
    if (!data) return;
    const { ctx, width, height } = setupCanvas(elements.waveCanvas);
    const margin = { left: 58, right: 52, top: 18, bottom: 31 };
    const plot = { x: margin.left, y: margin.top, w: width - margin.left - margin.right, h: height - margin.top - margin.bottom };
    if (plot.w <= 30 || plot.h <= 30) return;
    const xMin = data.x[0];
    const xMax = data.x[data.x.length - 1];
    const phaseCos = Math.cos(state.phase);
    const phaseSin = Math.sin(state.phase);
    const rotatedReal = new Array(data.x.length);
    const rotatedImag = new Array(data.x.length);
    let amplitudeMax = 1;
    let densityMax = 1;
    let potentialMax = Math.max(
      finiteNumber(data.params?.height, 0),
      finiteNumber(data.params?.energy, 0),
      1,
    );

    for (let i = 0; i < data.x.length; i += 1) {
      const re = finiteNumber(data.real[i]);
      const im = finiteNumber(data.imag[i]);
      rotatedReal[i] = re * phaseCos + im * phaseSin;
      rotatedImag[i] = im * phaseCos - re * phaseSin;
      amplitudeMax = Math.max(amplitudeMax, Math.abs(rotatedReal[i]), Math.abs(rotatedImag[i]));
      densityMax = Math.max(densityMax, finiteNumber(data.density[i]));
      potentialMax = Math.max(potentialMax, finiteNumber(data.potential[i]));
    }
    const leftMax = niceMax(Math.max(amplitudeMax, densityMax) * 1.08);
    potentialMax = niceMax(potentialMax * 1.08);
    const yMin = -leftMax;
    const yMax = leftMax;
    const sx = (x) => plot.x + ((x - xMin) / (xMax - xMin || 1)) * plot.w;
    const sy = (y) => plot.y + ((yMax - y) / (yMax - yMin)) * plot.h;
    const spy = (v) => plot.y + (1 - v / potentialMax) * plot.h;
    state.wavePlot = { plot, xMin, xMax, sx, sy, spy, rotatedReal, rotatedImag, leftMax, potentialMax };

    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = COLORS.paper;
    ctx.fillRect(0, 0, width, height);

    ctx.save();
    ctx.beginPath();
    ctx.rect(plot.x, plot.y, plot.w, plot.h);
    ctx.clip();

    for (let i = 0; i <= 4; i += 1) {
      const y = plot.y + (plot.h * i) / 4;
      ctx.beginPath();
      ctx.strokeStyle = i === 2 ? COLORS.zero : COLORS.grid;
      ctx.lineWidth = i === 2 ? 1.1 : 1;
      ctx.moveTo(plot.x, y);
      ctx.lineTo(plot.x + plot.w, y);
      ctx.stroke();
    }
    for (let i = 0; i <= 6; i += 1) {
      const x = plot.x + (plot.w * i) / 6;
      ctx.beginPath();
      ctx.strokeStyle = COLORS.grid;
      ctx.lineWidth = 1;
      ctx.moveTo(x, plot.y);
      ctx.lineTo(x, plot.y + plot.h);
      ctx.stroke();
    }

    if (state.visible.potential) {
      ctx.beginPath();
      ctx.moveTo(sx(data.x[0]), plot.y + plot.h);
      for (let i = 0; i < data.x.length; i += 1) ctx.lineTo(sx(data.x[i]), spy(finiteNumber(data.potential[i])));
      ctx.lineTo(sx(data.x[data.x.length - 1]), plot.y + plot.h);
      ctx.closePath();
      ctx.fillStyle = COLORS.potentialFill;
      ctx.fill();
      drawSeries(ctx, data.x, data.potential, sx, spy, COLORS.potential, 1.3);
    }

    const energyY = spy(finiteNumber(data.params?.energy, 0));
    if (energyY >= plot.y && energyY <= plot.y + plot.h) {
      ctx.setLineDash([5, 5]);
      ctx.strokeStyle = COLORS.energy;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(plot.x, energyY);
      ctx.lineTo(plot.x + plot.w, energyY);
      ctx.stroke();
      ctx.setLineDash([]);
      drawText(ctx, "E", plot.x + 8, energyY - 7, { color: "#ad7447", size: 9, align: "left" });
    }

    if (state.visible.density) drawSeries(ctx, data.x, data.density, sx, sy, COLORS.density, 1.65);
    if (state.visible.imag) drawSeries(ctx, data.x, rotatedImag, sx, sy, COLORS.imag, 1.35);
    if (state.visible.real) drawSeries(ctx, data.x, rotatedReal, sx, sy, COLORS.real, 1.65);
    ctx.restore();

    ctx.strokeStyle = "#404040";
    ctx.lineWidth = 1;
    ctx.strokeRect(plot.x, plot.y, plot.w, plot.h);

    for (let i = 0; i <= 4; i += 1) {
      const y = plot.y + (plot.h * i) / 4;
      const leftValue = yMax - ((yMax - yMin) * i) / 4;
      const rightValue = potentialMax * (1 - i / 4);
      drawText(ctx, formatTick(leftValue), plot.x - 9, y, { align: "right", size: 9 });
      drawText(ctx, formatTick(rightValue), plot.x + plot.w + 9, y, { align: "left", size: 9 });
    }
    for (let i = 0; i <= 6; i += 1) {
      const x = plot.x + (plot.w * i) / 6;
      const value = xMin + ((xMax - xMin) * i) / 6;
      drawText(ctx, formatTick(value), x, plot.y + plot.h + 14, { size: 9 });
    }
    drawText(ctx, "Relative amplitude / density", 12, plot.y + plot.h / 2, { size: 9, rotate: -Math.PI / 2 });
    drawText(ctx, "Potential / eV", width - 10, plot.y + plot.h / 2, { size: 9, rotate: Math.PI / 2 });
    elements.phaseReadout.textContent = `Phase φ = ${state.phase.toFixed(2)} rad`;
  }

  function drawSeries(ctx, xs, ys, xScale, yScale, color, lineWidth, dashed = false) {
    if (!xs.length) return;
    const maxSegments = 1800;
    const stride = Math.max(1, Math.floor(xs.length / maxSegments));
    ctx.save();
    ctx.beginPath();
    let started = false;
    for (let i = 0; i < xs.length; i += stride) {
      const x = xScale(finiteNumber(xs[i]));
      const yValue = Number(ys[i]);
      if (!Number.isFinite(yValue)) {
        started = false;
        continue;
      }
      const y = yScale(yValue);
      if (!started) {
        ctx.moveTo(x, y);
        started = true;
      } else {
        ctx.lineTo(x, y);
      }
    }
    const last = xs.length - 1;
    if (last % stride !== 0 && Number.isFinite(Number(ys[last]))) ctx.lineTo(xScale(xs[last]), yScale(ys[last]));
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    if (dashed) ctx.setLineDash([6, 5]);
    ctx.stroke();
    ctx.restore();
  }

  function drawSweep() {
    const data = state.sweep;
    if (!data) return;
    const { ctx, width, height } = setupCanvas(elements.sweepCanvas);
    const margin = { left: 58, right: 20, top: 17, bottom: 43 };
    const plot = { x: margin.left, y: margin.top, w: width - margin.left - margin.right, h: height - margin.top - margin.bottom };
    if (plot.w <= 30 || plot.h <= 30) return;
    const xMin = Math.min(...data.values);
    const xMax = Math.max(...data.values);
    const log = elements.logScale.checked;
    const positive = data.transmission.filter((v) => Number.isFinite(v) && v > 0);
    const analyticPositive = Array.isArray(data.analytic) ? data.analytic.filter((v) => Number.isFinite(v) && v > 0) : [];
    const allPositive = positive.concat(analyticPositive);
    const minPositive = allPositive.length ? Math.min(...allPositive) : 1e-300;
    const floorExponent = Math.max(-300, Math.floor(Math.log10(minPositive)));
    const floor = 10 ** floorExponent;
    const yMin = log ? Math.min(1e-2, floor) : 0;
    const yMax = 1;
    const sx = (x) => plot.x + ((x - xMin) / (xMax - xMin || 1)) * plot.w;
    const sy = log
      ? (value) => {
          const safe = Math.max(yMin, finiteNumber(value, yMin));
          return plot.y + ((Math.log10(yMax) - Math.log10(safe)) / (Math.log10(yMax) - Math.log10(yMin))) * plot.h;
        }
      : (value) => plot.y + (1 - clamp(finiteNumber(value), yMin, yMax)) * plot.h;
    state.sweepPlot = { plot, xMin, xMax, sx, sy, yMin, yMax, log, data };

    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = COLORS.paper;
    ctx.fillRect(0, 0, width, height);

    const yTicks = log ? logTicks(yMin) : [0, 0.25, 0.5, 0.75, 1];
    for (const tick of yTicks) {
      const y = sy(tick);
      ctx.beginPath();
      ctx.strokeStyle = COLORS.grid;
      ctx.moveTo(plot.x, y);
      ctx.lineTo(plot.x + plot.w, y);
      ctx.stroke();
      drawText(ctx, log ? `10${superscript(Math.round(Math.log10(tick)))}` : formatTick(tick), plot.x - 9, y, { align: "right", size: 9 });
    }
    for (let i = 0; i <= 6; i += 1) {
      const x = plot.x + (plot.w * i) / 6;
      const value = xMin + ((xMax - xMin) * i) / 6;
      ctx.beginPath();
      ctx.strokeStyle = COLORS.grid;
      ctx.moveTo(x, plot.y);
      ctx.lineTo(x, plot.y + plot.h);
      ctx.stroke();
      drawText(ctx, formatTick(value), x, plot.y + plot.h + 15, { size: 9 });
    }

    ctx.save();
    ctx.beginPath();
    ctx.rect(plot.x, plot.y, plot.w, plot.h);
    ctx.clip();
    drawSeries(ctx, data.values, data.transmission, sx, sy, COLORS.real, 1.8);
    if (Array.isArray(data.analytic) && data.analytic.some(Number.isFinite)) {
      drawSeries(ctx, data.values, data.analytic, sx, sy, COLORS.imag, 1.4, true);
    }
    ctx.restore();
    ctx.strokeStyle = "#404040";
    ctx.strokeRect(plot.x, plot.y, plot.w, plot.h);

    const config = SWEEP_CONFIG[data.variable] || SWEEP_CONFIG[elements.sweepVariable.value];
    drawText(ctx, `${config.label} / ${config.unit}`, plot.x + plot.w / 2, height - 9, { size: 9 });
    drawText(ctx, log ? "Transmission T (log)" : "Transmission T", 12, plot.y + plot.h / 2, { size: 9, rotate: -Math.PI / 2 });
    const hasZero = data.transmission.some((value) => Number(value) === 0)
      || (Array.isArray(data.analytic) && data.analytic.some((value) => Number(value) === 0));
    if (log && hasZero) {
      drawText(ctx, "T = 0: plotted at axis floor (below floating-point resolution)", plot.x + plot.w - 5, plot.y + 11, {
        align: "right",
        size: 9,
        color: COLORS.faint,
      });
    }
    elements.sweepCanvas.setAttribute("aria-label", `${config.label} transmission sweep with ${data.values.length} data points.`);
    updateInsight(data.variable || elements.sweepVariable.value, data.params);
  }

  function logTicks(min) {
    const exponent = Math.floor(Math.log10(min));
    const ticks = [];
    const span = Math.abs(exponent);
    const step = Math.max(1, Math.ceil(span / 6));
    for (let exp = 0; exp >= exponent; exp -= step) ticks.push(10 ** exp);
    if (ticks[ticks.length - 1] !== 10 ** exponent) ticks.push(10 ** exponent);
    return ticks;
  }

  function superscript(value) {
    const chars = { "-": "⁻", "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹" };
    return String(value).split("").map((char) => chars[char] || char).join("");
  }

  function updateInsight(variable, params = state.sweep?.params || currentParams()) {
    let widthContent;
    if (params?.shape === "double") {
      widthContent = {
        label: "Double-barrier interference",
        title: "Width sweeps can reveal resonances",
        text: "Multiple reflections interfere coherently between two barriers. Changing barrier width changes coupling and phase, so transmission can have resonance peaks instead of falling monotonically.",
        formula: "2kd + ϕ ≈ 2πn",
        detail: "Peak positions and widths depend on the well, barriers and interface phases",
      };
    } else if (params?.shape === "triangle") {
      widthContent = {
        label: "WKB approximation",
        title: "Width extends the evanescent region",
        text: "A triangular barrier has a position-dependent decay rate. Integrate the attenuation across the forbidden region; the constant-κ rectangle approximation does not directly apply.",
        formula: "T ∝ e<sup>−2∫κ(x)dx</sup>",
        detail: "κ(x) = √[2m(V(x) − E)] / ℏ",
      };
    } else {
      widthContent = {
        label: "Thick rectangle approximation",
        title: "Width controls exponential decay",
        text: "For a thick rectangular barrier with E < V₀, the wave is evanescent inside. Transmission decreases approximately exponentially with width. Use the log axis to inspect small values.",
        formula: "T ∝ e<sup>−2κa</sup>",
        detail: "κ = √[2m(V₀ − E)] / ℏ",
      };
    }
    const content = {
      width: widthContent,
      height: {
        label: "Tunneling relation",
        title: "Height changes the decay rate",
        text: "A larger V₀ − E increases the evanescent decay constant κ. Near E ≈ V₀, the solution transitions smoothly from tunneling to above-barrier scattering.",
        formula: "κ ∝ √(V₀ − E)",
        detail: "For rectangular barriers with E < V₀",
      },
      energy: {
        label: "Schematic resonance condition",
        title: "Energy reveals thresholds and resonances",
        text: "Higher energy generally increases transmission. Double barriers can produce sharp resonances through constructive interference between repeated reflections.",
        formula: "2kd + ϕ ≈ 2πn",
        detail: "Resonance depends on well width and interface phase shifts",
      },
    }[variable];
    $("#insightTitle").textContent = content.title;
    $("#insightText").textContent = content.text;
    $(".insight-formula span").textContent = content.label;
    $(".insight-formula strong").innerHTML = content.formula;
    $(".insight-formula small").textContent = content.detail;
  }

  function syncRangeFill(range) {
    const min = finiteNumber(range.min);
    const max = finiteNumber(range.max, 1);
    const value = finiteNumber(range.value);
    const pct = ((value - min) / (max - min || 1)) * 100;
    range.style.setProperty("--fill", `${clamp(pct, 0, 100)}%`);
  }

  function bindPair(name) {
    const range = $(`#${name}Range`);
    const number = $(`#${name}Number`);
    const limit = LIMITS[name];
    range.addEventListener("input", () => {
      number.value = range.value;
      syncRangeFill(range);
      clearPresetState();
      scheduleSimulation();
    });
    number.addEventListener("input", () => {
      const value = Number(number.value);
      if (Number.isFinite(value)) {
        range.value = String(clamp(value, limit.min, limit.max));
        syncRangeFill(range);
        clearPresetState();
        scheduleSimulation();
      }
    });
    number.addEventListener("change", () => {
      number.value = String(clamp(finiteNumber(number.value, DEFAULTS[name]), limit.min, limit.max));
      range.value = number.value;
      syncRangeFill(range);
      scheduleSimulation();
    });
    syncRangeFill(range);
  }

  function setParams(params) {
    for (const name of ["energy", "height", "width", "gap"]) {
      const value = params[name];
      $(`#${name}Range`).value = String(value);
      $(`#${name}Number`).value = String(value);
      syncRangeFill($(`#${name}Range`));
    }
    const shapeRadio = $(`input[name='shape'][value='${params.shape}']`);
    if (shapeRadio) shapeRadio.checked = true;
    elements.dx.value = String(params.dx);
    updateGapState();
    updatePresetState();
    scheduleSimulation();
  }

  function updateGapState() {
    const enabled = currentParams().shape === "double";
    elements.gapGroup.classList.toggle("is-disabled", !enabled);
    $("#gapRange").disabled = !enabled;
    $("#gapNumber").disabled = !enabled;
  }

  function clearPresetState() {
    $$(".preset").forEach((button) => button.classList.remove("active"));
  }

  function updatePresetState() {
    const current = currentParams();
    let match = null;
    for (const [name, preset] of Object.entries(PRESETS)) {
      const same = Object.keys(preset).every((key) => String(current[key]) === String(preset[key]));
      if (same) match = name;
    }
    $$(".preset").forEach((button) => button.classList.toggle("active", button.dataset.preset === match));
  }

  function updateSweepRange() {
    const variable = elements.sweepVariable.value;
    const config = SWEEP_CONFIG[variable];
    invalidateSweep("Sweep variable changed · showing previous result");
    for (const [input, value] of [[elements.sweepStart, config.min], [elements.sweepStop, config.max]]) {
      input.min = String(config.min);
      input.max = String(config.max);
      input.step = String(config.step);
      input.value = String(value);
    }
    if (state.sweep) drawSweep();
    else {
      updateInsight(variable);
      drawSweepPlaceholder();
    }
  }

  function drawSweepPlaceholder() {
    const { ctx, width, height } = setupCanvas(elements.sweepCanvas);
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = COLORS.paper;
    ctx.fillRect(0, 0, width, height);
    const left = 58;
    const right = width - 20;
    const top = 17;
    const bottom = height - 43;
    ctx.strokeStyle = COLORS.grid;
    for (let i = 0; i <= 4; i += 1) {
      const y = top + ((bottom - top) * i) / 4;
      ctx.beginPath();
      ctx.moveTo(left, y);
      ctx.lineTo(right, y);
      ctx.stroke();
    }
    ctx.strokeStyle = "#404040";
    ctx.strokeRect(left, top, right - left, bottom - top);
    drawText(ctx, "Choose a variable and select Run sweep", (left + right) / 2, (top + bottom) / 2, { size: 11, color: COLORS.faint });
  }

  function nearestIndex(values, target) {
    let low = 0;
    let high = values.length - 1;
    while (low < high) {
      const mid = Math.floor((low + high) / 2);
      if (values[mid] < target) low = mid + 1;
      else high = mid;
    }
    if (low > 0 && Math.abs(values[low - 1] - target) < Math.abs(values[low] - target)) return low - 1;
    return low;
  }

  function wavePointerMove(event) {
    if (!state.sim || !state.wavePlot) return;
    const rect = elements.waveCanvas.getBoundingClientRect();
    const px = event.clientX - rect.left;
    const py = event.clientY - rect.top;
    const plot = state.wavePlot;
    if (px < plot.plot.x || px > plot.plot.x + plot.plot.w || py < plot.plot.y || py > plot.plot.y + plot.plot.h) {
      elements.waveTooltip.hidden = true;
      return;
    }
    const xValue = plot.xMin + ((px - plot.plot.x) / plot.plot.w) * (plot.xMax - plot.xMin);
    const i = nearestIndex(state.sim.x, xValue);
    elements.waveTooltip.innerHTML = `<strong>x = ${formatNumber(state.sim.x[i], 4)} nm</strong>Re ψ = ${formatNumber(plot.rotatedReal[i], 4)}<br>Im ψ = ${formatNumber(plot.rotatedImag[i], 4)}<br>|ψ|² = ${formatNumber(state.sim.density[i], 4)}<br>V = ${formatNumber(state.sim.potential[i], 4)} eV`;
    elements.waveTooltip.style.left = `${clamp(px, 0, rect.width - 150)}px`;
    elements.waveTooltip.style.top = `${clamp(py, 54, rect.height - 54)}px`;
    elements.waveTooltip.hidden = false;
  }

  function sweepPointerMove(event) {
    if (!state.sweep || !state.sweepPlot) return;
    const rect = elements.sweepCanvas.getBoundingClientRect();
    const px = event.clientX - rect.left;
    const py = event.clientY - rect.top;
    const plot = state.sweepPlot;
    if (px < plot.plot.x || px > plot.plot.x + plot.plot.w || py < plot.plot.y || py > plot.plot.y + plot.plot.h) {
      elements.sweepTooltip.hidden = true;
      return;
    }
    const value = plot.xMin + ((px - plot.plot.x) / plot.plot.w) * (plot.xMax - plot.xMin);
    const i = nearestIndex(state.sweep.values, value);
    const config = SWEEP_CONFIG[state.sweep.variable] || SWEEP_CONFIG[elements.sweepVariable.value];
    const analytic = Array.isArray(state.sweep.analytic) ? state.sweep.analytic[i] : null;
    elements.sweepTooltip.innerHTML = `<strong>${config.label} = ${formatNumber(state.sweep.values[i], 4)} ${config.unit}</strong>Numerical T = ${formatNumber(state.sweep.transmission[i])}${Number.isFinite(analytic) ? `<br>Analytic T = ${formatNumber(analytic)}` : ""}`;
    elements.sweepTooltip.style.left = `${clamp(px, 0, rect.width - 165)}px`;
    elements.sweepTooltip.style.top = `${clamp(py, 45, rect.height - 45)}px`;
    elements.sweepTooltip.hidden = false;
  }

  function togglePhase() {
    state.phasePlaying = !state.phasePlaying;
    elements.phaseButton.setAttribute("aria-pressed", String(state.phasePlaying));
    elements.phaseButton.querySelector("span").textContent = state.phasePlaying ? "Pause phase" : "Play phase";
    if (state.phasePlaying) {
      state.lastFrameTime = performance.now();
      state.animationFrame = requestAnimationFrame(animatePhase);
    } else {
      cancelAnimationFrame(state.animationFrame);
    }
  }

  function animatePhase(time) {
    if (!state.phasePlaying) return;
    const delta = Math.min(80, time - state.lastFrameTime);
    state.lastFrameTime = time;
    state.phase = (state.phase + delta * 0.00075) % (Math.PI * 2);
    drawWave();
    state.animationFrame = requestAnimationFrame(animatePhase);
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function downloadPng() {
    if (!state.sim) return;
    drawWave();
    elements.waveCanvas.toBlob((blob) => {
      if (blob) downloadBlob(blob, `quantum-wave-${state.sim.params.shape}.png`);
    }, "image/png");
  }

  function downloadCsv() {
    if (!state.sim) {
      setError("Wavefunction data is not ready yet. Wait for the calculation to finish.", "simulate");
      return;
    }
    const rows = ["x_nm,potential_eV,real_psi,imag_psi,density"];
    for (let i = 0; i < state.sim.x.length; i += 1) {
      rows.push([
        state.sim.x[i],
        state.sim.potential[i],
        state.sim.real[i],
        state.sim.imag[i],
        state.sim.density[i],
      ].map((value) => Number(value).toPrecision(12)).join(","));
    }
    downloadBlob(new Blob([`\uFEFF${rows.join("\n")}\n`], { type: "text/csv;charset=utf-8" }), `quantum-tunneling-${state.sim.params.shape}.csv`);
  }

  function handleResize() {
    drawWave();
    if (state.sweep) drawSweep();
    else drawSweepPlaceholder();
  }

  function installEvents() {
    ["energy", "height", "width", "gap"].forEach(bindPair);

    $$(`input[name='shape']`).forEach((radio) => radio.addEventListener("change", () => {
      updateGapState();
      clearPresetState();
      scheduleSimulation();
    }));
    elements.dx.addEventListener("change", () => {
      clearPresetState();
      scheduleSimulation();
    });

    $$(".preset").forEach((button) => button.addEventListener("click", () => setParams(PRESETS[button.dataset.preset])));
    $("#resetButton").addEventListener("click", () => setParams(DEFAULTS));
    $("#retryButton").addEventListener("click", () => state.lastErrorAction === "sweep" ? runSweep() : simulate());
    elements.runSweep.addEventListener("click", runSweep);
    elements.sweepVariable.addEventListener("change", updateSweepRange);
    [elements.sweepStart, elements.sweepStop].forEach((input) => input.addEventListener("input", () => {
      invalidateSweep("Sweep range changed · showing previous result");
    }));
    elements.logScale.addEventListener("change", () => state.sweep ? drawSweep() : drawSweepPlaceholder());
    elements.phaseButton.addEventListener("click", togglePhase);
    $("#downloadPngButton").addEventListener("click", downloadPng);
    $("#downloadCsvButton").addEventListener("click", downloadCsv);

    $$("#legend button").forEach((button) => button.addEventListener("click", () => {
      const series = button.dataset.series;
      state.visible[series] = !state.visible[series];
      button.setAttribute("aria-pressed", String(state.visible[series]));
      drawWave();
    }));

    elements.waveCanvas.addEventListener("pointermove", wavePointerMove);
    elements.waveCanvas.addEventListener("pointerleave", () => { elements.waveTooltip.hidden = true; });
    elements.sweepCanvas.addEventListener("pointermove", sweepPointerMove);
    elements.sweepCanvas.addEventListener("pointerleave", () => { elements.sweepTooltip.hidden = true; });

    if ("ResizeObserver" in window) {
      let resizeFrame = 0;
      const observer = new ResizeObserver(() => {
        cancelAnimationFrame(resizeFrame);
        resizeFrame = requestAnimationFrame(handleResize);
      });
      observer.observe(elements.waveWrap);
      observer.observe(elements.sweepWrap);
    } else {
      window.addEventListener("resize", handleResize);
    }

    document.addEventListener("visibilitychange", () => {
      if (document.hidden && state.phasePlaying) togglePhase();
    });
  }

  function init() {
    installEvents();
    updateGapState();
    updateSweepRange();
    simulate();
  }

  init();
})();
