import { useEffect, useRef } from 'react';
import * as THREE from 'three';

/**
 * Fondo 3D del inicio: entradas troqueladas flotando entre haces de luz de escenario.
 *
 * - Three.js puro, aislado en este componente (no se mezcla con Motion) y cargado en diferido.
 * - Se pausa cuando el hero sale de pantalla o la pestaña está oculta (no consume GPU de fondo).
 * - prefers-reduced-motion: dibuja un único cuadro estático, sin animación ni parallax.
 * - tema "claro" | "oscuro": niebla, luces y mezcla de los haces se adaptan (sobre fondo claro la mezcla aditiva no se ve).
 * - Si el navegador no tiene WebGL no renderiza nada y queda el degradé CSS de respaldo del contenedor.
 */

const ANCHO = 3.2;
const ALTO = 1.6;
const POS_TALON = ANCHO / 2 - 0.95; // x del troquel que separa el talón

/** Contorno de una entrada: rectángulo redondeado con las dos muescas del troquel. */
const formaEntrada = () => {
  const w = ANCHO / 2;
  const h = ALTO / 2;
  const r = 0.14;
  const n = 0.16;
  const s = new THREE.Shape();
  s.moveTo(-w + r, -h);
  s.lineTo(POS_TALON - n, -h);
  s.absarc(POS_TALON, -h, n, Math.PI, 0, true);
  s.lineTo(w - r, -h);
  s.quadraticCurveTo(w, -h, w, -h + r);
  s.lineTo(w, h - r);
  s.quadraticCurveTo(w, h, w - r, h);
  s.lineTo(POS_TALON + n, h);
  s.absarc(POS_TALON, h, n, 0, Math.PI, true);
  s.lineTo(-w + r, h);
  s.quadraticCurveTo(-w, h, -w, h - r);
  s.lineTo(-w, -h + r);
  s.quadraticCurveTo(-w, -h, -w + r, -h);
  return s;
};

/** Textura de la cara de la entrada: fondo, troquel punteado, bloques de texto y un patrón tipo QR en el talón. */
const texturaEntrada = ({ fondo, tinta, acento }) => {
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 512;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 1024, 512);
  grad.addColorStop(0, fondo[0]);
  grad.addColorStop(1, fondo[1]);
  g.fillStyle = grad;
  g.fillRect(0, 0, 1024, 512);

  const xTalon = ((POS_TALON + ANCHO / 2) / ANCHO) * 1024;
  g.strokeStyle = tinta;
  g.globalAlpha = 0.35;
  g.setLineDash([10, 14]);
  g.lineWidth = 4;
  g.beginPath();
  g.moveTo(xTalon, 30);
  g.lineTo(xTalon, 482);
  g.stroke();
  g.setLineDash([]);

  // Bloques de "texto"
  g.globalAlpha = 0.9;
  g.fillStyle = tinta;
  g.font = '700 54px "Geist Variable", system-ui, sans-serif';
  g.fillText('ENTRADA', 60, 110);
  g.globalAlpha = 0.45;
  [[60, 170, 420], [60, 210, 300], [60, 400, 220], [60, 440, 160]].forEach(([x, y, w]) => g.fillRect(x, y, w, 16));
  g.globalAlpha = 1;
  g.fillStyle = acento;
  g.fillRect(60, 300, 120, 44);

  // Patrón tipo QR (módulos aleatorios + tres marcadores de posición)
  const qx = xTalon + 50;
  const qy = 146;
  const lado = 220;
  const m = 11;
  const t = lado / m;
  g.fillStyle = tinta;
  for (let i = 0; i < m; i++) {
    for (let j = 0; j < m; j++) {
      const esquina = (i < 3 && j < 3) || (i > m - 4 && j < 3) || (i < 3 && j > m - 4);
      if (!esquina && Math.random() > 0.52) g.fillRect(qx + i * t, qy + j * t, t - 2, t - 2);
    }
  }
  for (const [ox, oy] of [[0, 0], [m - 3, 0], [0, m - 3]]) {
    g.fillRect(qx + ox * t, qy + oy * t, t * 3, t * 3);
    g.clearRect(qx + ox * t + t * 0.6, qy + oy * t + t * 0.6, t * 1.8, t * 1.8);
    g.fillStyle = fondo[1];
    g.fillRect(qx + ox * t + t * 0.6, qy + oy * t + t * 0.6, t * 1.8, t * 1.8);
    g.fillStyle = tinta;
    g.fillRect(qx + ox * t + t, qy + oy * t + t, t, t);
  }

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  // Las UV de ExtrudeGeometry están en unidades de la forma: se normalizan a [0,1]
  tex.repeat.set(1 / ANCHO, 1 / ALTO);
  tex.offset.set(0.5, 0.5);
  return tex;
};

/** Haz de luz de escenario: cono abierto aditivo que se desvanece hacia la base. */
const crearHaz = (color, claro) => {
  const geo = new THREE.ConeGeometry(4.2, 26, 48, 1, true);
  geo.translate(0, -13, 0); // el vértice del cono queda en el origen (el reflector)
  const mat = new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(color) }, uIntensidad: { value: claro ? 0.13 : 0.3 } },
    vertexShader: `varying float vAltura; void main(){ vAltura = uv.y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `uniform vec3 uColor; uniform float uIntensidad; varying float vAltura;
      void main(){ float a = pow(vAltura, 2.2) * uIntensidad; gl_FragColor = vec4(uColor, a); }`,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: claro ? THREE.NormalBlending : THREE.AdditiveBlending,
  });
  return new THREE.Mesh(geo, mat);
};

export default function EscenaEntradas({ className = '', tema = 'oscuro' }) {
  const contenedor = useRef(null);

  useEffect(() => {
    const el = contenedor.current;
    if (!el) return undefined;
    const reducir = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const movil = window.matchMedia('(max-width: 767px)').matches;
    const claro = tema === 'claro';

    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: !movil, alpha: true, powerPreference: 'high-performance' });
    } catch {
      return undefined; // sin WebGL: queda el fondo CSS
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, movil ? 1.5 : 1.75));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.domElement.className = 'h-full w-full opacity-0 transition-opacity duration-1000';
    el.appendChild(renderer.domElement);

    const escena = new THREE.Scene();
    escena.fog = new THREE.FogExp2(claro ? 0xf4f4f5 : 0x09090b, claro ? 0.03 : 0.032);
    const camara = new THREE.PerspectiveCamera(42, 1, 0.1, 80);
    camara.position.set(0, 0, 15);

    // Luces: ambiente fría tenue + dos reflectores que barren como en un escenario
    escena.add(new THREE.AmbientLight(claro ? 0xffffff : 0x6366f1, claro ? 1.7 : 1.1));
    escena.add(new THREE.HemisphereLight(claro ? 0xffffff : 0xc7d2fe, claro ? 0xe0e7ff : 0x09090b, 1.2));
    const reflectores = [
      { luz: new THREE.SpotLight(0x818cf8, 600, 60, 0.42, 0.6, 1.3), haz: crearHaz(claro ? 0x6366f1 : 0x818cf8, claro), x: 7, fase: 0 },
      { luz: new THREE.SpotLight(0xe0e7ff, 380, 60, 0.38, 0.7, 1.3), haz: crearHaz(claro ? 0x818cf8 : 0xc7d2fe, claro), x: -3, fase: Math.PI * 0.8 },
    ];
    for (const r of reflectores) {
      r.luz.position.set(r.x, 13, 4);
      r.haz.position.copy(r.luz.position);
      escena.add(r.luz, r.luz.target, r.haz);
    }

    // Entradas: tres variantes de material, cada una un InstancedMesh (pocas draw calls)
    const geometria = new THREE.ExtrudeGeometry(formaEntrada(), {
      depth: 0.035, bevelEnabled: true, bevelThickness: 0.012, bevelSize: 0.012, bevelSegments: 2, curveSegments: 18,
    });
    geometria.center();
    const variantes = [
      { fondo: ['#4f46e5', '#312e81'], tinta: '#e0e7ff', acento: '#c7d2fe' },
      { fondo: ['#f4f4f5', '#d4d4d8'], tinta: '#18181b', acento: '#4f46e5' },
      { fondo: ['#27272a', '#09090b'], tinta: '#a5b4fc', acento: '#6366f1' },
    ];
    const total = movil ? 18 : 40;
    const porVariante = Math.ceil(total / variantes.length);
    const auxiliar = new THREE.Object3D();
    const grupos = variantes.map((v) => {
      const mapa = texturaEntrada(v);
      const material = new THREE.MeshStandardMaterial({
        map: mapa, roughness: 0.42, metalness: 0.18,
        // Un poco de emisión con la propia textura: las entradas se leen aunque estén fuera de los haces
        emissive: 0xffffff, emissiveMap: mapa, emissiveIntensity: claro ? 0.12 : 0.32,
      });
      const malla = new THREE.InstancedMesh(geometria, material, porVariante);
      malla.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      const estados = Array.from({ length: porVariante }, () => ({
        // Más densidad hacia la derecha: la izquierda del hero lleva el texto
        x: THREE.MathUtils.randFloat(-9, 17),
        y: THREE.MathUtils.randFloat(-10, 10),
        z: THREE.MathUtils.randFloat(-20, 3),
        rx: Math.random() * Math.PI,
        ry: Math.random() * Math.PI,
        rz: Math.random() * Math.PI,
        vr: THREE.MathUtils.randFloat(0.08, 0.28) * (Math.random() > 0.5 ? 1 : -1),
        vy: THREE.MathUtils.randFloat(0.25, 0.6),
        escala: THREE.MathUtils.randFloat(0.7, 1.15),
      }));
      escena.add(malla);
      return { malla, estados, material, mapa };
    });

    // Partículas en suspensión iluminadas por los haces
    const nParticulas = movil ? 160 : 420;
    const posiciones = new Float32Array(nParticulas * 3);
    for (let i = 0; i < nParticulas; i++) {
      posiciones.set([THREE.MathUtils.randFloat(-18, 18), THREE.MathUtils.randFloat(-11, 11), THREE.MathUtils.randFloat(-20, 6)], i * 3);
    }
    const geoParticulas = new THREE.BufferGeometry();
    geoParticulas.setAttribute('position', new THREE.BufferAttribute(posiciones, 3));
    const matParticulas = new THREE.PointsMaterial({
      color: claro ? 0x6366f1 : 0xc7d2fe, size: 0.05, transparent: true, opacity: claro ? 0.35 : 0.55, depthWrite: false,
      blending: claro ? THREE.NormalBlending : THREE.AdditiveBlending,
    });
    const particulas = new THREE.Points(geoParticulas, matParticulas);
    escena.add(particulas);

    const actualizar = (t, dt) => {
      for (const { malla, estados } of grupos) {
        estados.forEach((s, i) => {
          if (dt) {
            s.y += s.vy * dt;
            if (s.y > 11) { s.y = -11; s.x = THREE.MathUtils.randFloat(-9, 17); }
            s.rx += s.vr * dt * 0.6;
            s.ry += s.vr * dt;
          }
          auxiliar.position.set(s.x, s.y + Math.sin(t * 0.6 + i) * 0.25, s.z);
          auxiliar.rotation.set(s.rx, s.ry, s.rz);
          auxiliar.scale.setScalar(s.escala);
          auxiliar.updateMatrix();
          malla.setMatrixAt(i, auxiliar.matrix);
        });
        malla.instanceMatrix.needsUpdate = true;
      }
      reflectores.forEach((r, i) => {
        const ang = Math.sin(t * 0.35 + r.fase) * 0.55;
        const objetivo = new THREE.Vector3(r.x + Math.sin(ang) * 14, -12, -4 + Math.cos(t * 0.25 + i) * 4);
        r.luz.target.position.copy(objetivo);
        r.haz.lookAt(objetivo);
        r.haz.rotateX(-Math.PI / 2);
      });
      particulas.rotation.y = t * 0.015;
    };

    // Cámara que sigue al puntero con amortiguación (parallax decorativo)
    const puntero = { x: 0, y: 0 };
    const alMover = (e) => {
      puntero.x = (e.clientX / window.innerWidth) * 2 - 1;
      puntero.y = (e.clientY / window.innerHeight) * 2 - 1;
    };
    if (!reducir) window.addEventListener('pointermove', alMover, { passive: true });

    const ajustar = () => {
      const { clientWidth: w, clientHeight: h } = el;
      if (!w || !h) return;
      renderer.setSize(w, h, false);
      camara.aspect = w / h;
      camara.updateProjectionMatrix();
      if (reducir) renderer.render(escena, camara);
    };
    const ro = new ResizeObserver(ajustar);
    ro.observe(el);
    ajustar();

    let visible = true;
    let raf = 0;
    let anterior = performance.now();
    const reloj0 = anterior;
    const cuadro = (ahora) => {
      raf = requestAnimationFrame(cuadro);
      if (!visible || document.hidden) { anterior = ahora; return; }
      const dt = Math.min((ahora - anterior) / 1000, 0.05);
      anterior = ahora;
      const t = (ahora - reloj0) / 1000;
      actualizar(t, dt);
      camara.position.x += (puntero.x * 1.4 - camara.position.x) * 0.035;
      camara.position.y += (-puntero.y * 0.9 - camara.position.y) * 0.035;
      camara.lookAt(2, 0, 0);
      renderer.render(escena, camara);
    };

    const io = new IntersectionObserver(([entrada]) => { visible = entrada.isIntersecting; }, { threshold: 0 });
    io.observe(el);

    if (reducir) {
      actualizar(4, 0);
      camara.lookAt(2, 0, 0);
      renderer.render(escena, camara);
    } else {
      raf = requestAnimationFrame(cuadro);
    }
    requestAnimationFrame(() => renderer.domElement.classList.replace('opacity-0', 'opacity-100'));

    return () => {
      cancelAnimationFrame(raf);
      io.disconnect();
      ro.disconnect();
      window.removeEventListener('pointermove', alMover);
      geometria.dispose();
      for (const { material, mapa } of grupos) { material.dispose(); mapa.dispose(); }
      for (const r of reflectores) { r.haz.geometry.dispose(); r.haz.material.dispose(); r.luz.dispose(); }
      geoParticulas.dispose();
      matParticulas.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [tema]);

  return <div ref={contenedor} aria-hidden="true" className={`pointer-events-none ${className}`} />;
}
