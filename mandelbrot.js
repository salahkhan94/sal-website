(function () {
  const canvas = document.getElementById("mandelbrot");
  if (!canvas) return;

  const MAX_CANVAS = 4096;
  const state = { cx: -0.5, cy: 0, scale: 1.2 };
  let renderer = null;
  let drawQueued = false;

  function queueDraw() {
    if (drawQueued) return;
    drawQueued = true;
    requestAnimationFrame(function () {
      drawQueued = false;
      if (renderer) renderer.draw();
    });
  }

  function screenToWorld(clientX, clientY) {
    const iw = Math.max(1, window.innerWidth);
    const ih = Math.max(1, window.innerHeight);
    const mx = (clientX / iw) * canvas.width;
    const my = (clientY / ih) * canvas.height;
    const h = Math.max(1, canvas.height);
    const uvx = (mx - canvas.width / 2) / h;
    const uvy = (canvas.height / 2 - my) / h;
    return {
      x: state.cx + uvx * (2 * state.scale),
      y: state.cy + uvy * (2 * state.scale),
    };
  }

  function zoomAtScreen(factor, clientX, clientY) {
    const before = screenToWorld(clientX, clientY);
    state.scale = Math.min(8, Math.max(5e-5, state.scale * factor));
    const after = screenToWorld(clientX, clientY);
    state.cx += before.x - after.x;
    state.cy += before.y - after.y;
    queueDraw();
  }

  function panCss(cssDx, cssDy) {
    const iw = Math.max(1, window.innerWidth);
    const ih = Math.max(1, window.innerHeight);
    const dxCanvas = cssDx * (canvas.width / iw);
    const dyCanvas = cssDy * (canvas.height / ih);
    const h = Math.max(1, canvas.height);
    const step = (2 * state.scale) / h;
    state.cx -= dxCanvas * step;
    state.cy += dyCanvas * step;
    queueDraw();
  }

  function makeWebGlRenderer() {
    const gl =
      canvas.getContext("webgl", {
        alpha: false,
        antialias: false,
        depth: false,
        stencil: false,
        premultipliedAlpha: false,
      }) ||
      canvas.getContext("experimental-webgl", {
        alpha: false,
        antialias: false,
        depth: false,
        stencil: false,
        premultipliedAlpha: false,
      });

    if (!gl) return null;

    function fragmentShaderSource(precision) {
      return (
        "precision " +
        precision +
        " float;\n" +
        "uniform vec2 u_resolution;\n" +
        "uniform vec2 u_center;\n" +
        "uniform float u_scale;\n" +
        "vec3 palette(float t) {\n" +
        "  vec3 a = vec3(0.08, 0.14, 0.18);\n" +
        "  vec3 b = vec3(0.15, 0.42, 0.42);\n" +
        "  vec3 c = vec3(0.55, 0.92, 0.88);\n" +
        "  vec3 d = vec3(0.12, 0.35, 0.45);\n" +
        "  return mix(a, b, t) + c * (0.28 * cos(6.28318 * (d * t + 0.02)));\n" +
        "}\n" +
        "void main() {\n" +
        "  vec2 p = gl_FragCoord.xy;\n" +
        "  vec2 uv = (p - 0.5 * u_resolution) / u_resolution.y;\n" +
        "  vec2 c = u_center + vec2(uv.x, -uv.y) * (2.0 * u_scale);\n" +
        "  vec2 z = vec2(0.0);\n" +
        "  float iter = -1.0;\n" +
        "  for (int i = 0; i < 255; i++) {\n" +
        "    if (dot(z, z) > 4.0) {\n" +
        "      iter = float(i);\n" +
        "      break;\n" +
        "    }\n" +
        "    z = vec2(z.x * z.x - z.y * z.y, 2.0 * z.x * z.y) + c;\n" +
        "  }\n" +
        "  if (iter < 0.0) {\n" +
        "    gl_FragColor = vec4(0.04, 0.08, 0.12, 1.0);\n" +
        "    return;\n" +
        "  }\n" +
        "  float len = length(z);\n" +
        "  float nu = log2(log2(max(len, 1.0e-4)));\n" +
        "  float smoothIter = iter + 1.0 - nu;\n" +
        "  float t = smoothIter / 128.0;\n" +
        "  vec3 col = palette(clamp(t, 0.0, 1.0));\n" +
        "  gl_FragColor = vec4(col, 1.0);\n" +
        "}\n"
      );
    }

    function compile(type, src) {
      const sh = gl.createShader(type);
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
        gl.deleteShader(sh);
        return null;
      }
      return sh;
    }

    const fmt = gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.HIGH_FLOAT);
    const precision = fmt && fmt.precision > 0 ? "highp" : "mediump";

    const vs = compile(
      gl.VERTEX_SHADER,
      "attribute vec2 a_pos;\nvoid main(){ gl_Position = vec4(a_pos, 0.0, 1.0); }\n"
    );
    const fs = compile(gl.FRAGMENT_SHADER, fragmentShaderSource(precision));
    if (!vs || !fs) return null;

    const program = gl.createProgram();
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return null;

    const locPos = gl.getAttribLocation(program, "a_pos");
    const uResolution = gl.getUniformLocation(program, "u_resolution");
    const uCenter = gl.getUniformLocation(program, "u_center");
    const uScale = gl.getUniformLocation(program, "u_scale");

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
      gl.STATIC_DRAW
    );

    function resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      let w = Math.max(1, Math.floor(window.innerWidth * dpr));
      let h = Math.max(1, Math.floor(window.innerHeight * dpr));
      w = Math.min(MAX_CANVAS, w);
      h = Math.min(MAX_CANVAS, h);
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      gl.viewport(0, 0, canvas.width, canvas.height);
    }

    function draw() {
      resize();
      gl.disable(gl.BLEND);
      gl.useProgram(program);
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.enableVertexAttribArray(locPos);
      gl.vertexAttribPointer(locPos, 2, gl.FLOAT, false, 0, 0);
      gl.uniform2f(uResolution, canvas.width, canvas.height);
      gl.uniform2f(uCenter, state.cx, state.cy);
      gl.uniform1f(uScale, state.scale);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    }

    return { draw };
  }

  function makeCanvas2dRenderer() {
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) return null;

    let sampleW = 360;
    let sampleH = 220;
    let imageData = null;
    let pixels = null;

    function resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      let w = Math.max(1, Math.floor(window.innerWidth * dpr));
      let h = Math.max(1, Math.floor(window.innerHeight * dpr));
      w = Math.min(MAX_CANVAS, w);
      h = Math.min(MAX_CANVAS, h);
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }

      const target = Math.min(760, Math.max(320, Math.floor(w * 0.45)));
      const ratio = h / w;
      const nextW = target;
      const nextH = Math.max(180, Math.floor(target * ratio));
      if (nextW !== sampleW || nextH !== sampleH || !imageData) {
        sampleW = nextW;
        sampleH = nextH;
        imageData = ctx.createImageData(sampleW, sampleH);
        pixels = imageData.data;
      }
    }

    function palette(t) {
      const r = Math.min(255, Math.max(0, Math.floor(40 + 190 * t + 30 * Math.cos(10 * t))));
      const g = Math.min(255, Math.max(0, Math.floor(55 + 160 * t + 45 * Math.sin(8 * t + 0.4))));
      const b = Math.min(255, Math.max(0, Math.floor(70 + 120 * t + 65 * Math.cos(7 * t + 0.2))));
      return [r, g, b];
    }

    function draw() {
      resize();
      const maxIter = 90;
      let p = 0;
      for (let y = 0; y < sampleH; y++) {
        const uvY = (sampleH / 2 - y) / sampleH;
        for (let x = 0; x < sampleW; x++) {
          const uvX = (x - sampleW / 2) / sampleH;
          const cx = state.cx + uvX * (2 * state.scale);
          const cy = state.cy + uvY * (2 * state.scale);
          let zx = 0;
          let zy = 0;
          let i = 0;
          for (; i < maxIter; i++) {
            const xx = zx * zx - zy * zy + cx;
            const yy = 2 * zx * zy + cy;
            zx = xx;
            zy = yy;
            if (zx * zx + zy * zy > 4) break;
          }
          if (i === maxIter) {
            pixels[p++] = 10;
            pixels[p++] = 22;
            pixels[p++] = 30;
            pixels[p++] = 255;
          } else {
            const t = i / maxIter;
            const c = palette(t);
            pixels[p++] = c[0];
            pixels[p++] = c[1];
            pixels[p++] = c[2];
            pixels[p++] = 255;
          }
        }
      }
      ctx.putImageData(imageData, 0, 0);
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(canvas, 0, 0, sampleW, sampleH, 0, 0, canvas.width, canvas.height);
    }

    return { draw };
  }

  renderer = makeWebGlRenderer() || makeCanvas2dRenderer();
  if (!renderer) {
    canvas.style.display = "none";
    return;
  }

  function onWheel(e) {
    if (!e.shiftKey) return;
    e.preventDefault();
    zoomAtScreen(Math.exp(e.deltaY * 0.0012), e.clientX, e.clientY);
  }
  window.addEventListener("wheel", onWheel, { passive: false, capture: true });

  function eventTargetElement(target) {
    if (!target) return null;
    if (target.nodeType === 1) return target;
    if (target.nodeType === 3) return target.parentElement;
    return null;
  }

  function isPanBlocker(el) {
    const node = eventTargetElement(el);
    if (!node || typeof node.closest !== "function") return true;
    return !!node.closest(
      "a, button, input, textarea, select, label, [role='button'], .fractal-controls"
    );
  }

  let shiftPanning = false;
  let lastPanX = 0;
  let lastPanY = 0;

  window.addEventListener(
    "mousedown",
    function (e) {
      if (!e.shiftKey || e.button !== 0) return;
      if (isPanBlocker(e.target)) return;
      shiftPanning = true;
      lastPanX = e.clientX;
      lastPanY = e.clientY;
      document.body.classList.add("fractal-panning");
      e.preventDefault();
    },
    true
  );

  window.addEventListener(
    "mousemove",
    function (e) {
      if (!shiftPanning) return;
      if (!e.shiftKey) {
        shiftPanning = false;
        document.body.classList.remove("fractal-panning");
        return;
      }
      e.preventDefault();
      const dx = e.clientX - lastPanX;
      const dy = e.clientY - lastPanY;
      lastPanX = e.clientX;
      lastPanY = e.clientY;
      panCss(dx, dy);
    },
    { capture: true, passive: false }
  );

  function endShiftPan() {
    if (!shiftPanning) return;
    shiftPanning = false;
    document.body.classList.remove("fractal-panning");
  }
  window.addEventListener("mouseup", endShiftPan, true);
  window.addEventListener(
    "keyup",
    function (e) {
      if (e.key === "Shift") endShiftPan();
    },
    true
  );

  function bindBtn(id, fn) {
    const el = document.getElementById(id);
    if (el) el.addEventListener("click", fn);
  }
  bindBtn("fractal-zoom-in", function () {
    zoomAtScreen(0.9, window.innerWidth / 2, window.innerHeight / 2);
  });
  bindBtn("fractal-zoom-out", function () {
    zoomAtScreen(1.1, window.innerWidth / 2, window.innerHeight / 2);
  });
  bindBtn("fractal-reset", function () {
    state.cx = -0.5;
    state.cy = 0;
    state.scale = 1.2;
    queueDraw();
  });

  window.addEventListener("resize", queueDraw);
  window.addEventListener("orientationchange", function () {
    requestAnimationFrame(queueDraw);
  });

  if (document.readyState === "complete") {
    queueDraw();
  } else {
    window.addEventListener("load", queueDraw);
    document.addEventListener("DOMContentLoaded", queueDraw);
    requestAnimationFrame(queueDraw);
  }
})();
