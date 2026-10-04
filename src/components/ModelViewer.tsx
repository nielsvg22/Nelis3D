"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { STLLoader } from "three/addons/loaders/STLLoader.js";
import { toCreasedNormals } from "three/addons/utils/BufferGeometryUtils.js";
import { Icon, Spinner, cx, type IconName } from "./ui";

export interface ViewerProps {
  /** URL of the STL for the version to show – the viewer loads exactly this mesh file. */
  url: string | null;
  /** change when the mesh changes (e.g. version id) */
  meshKey: string | null;
  bed?: { x: number; y: number };
  overhangDeg?: number;
  onSnapshot?: (png: Blob) => void;
  className?: string;
  emptyHint?: React.ReactNode;
}

interface Toggles {
  wireframe: boolean;
  transparent: boolean;
  grid: boolean;
  axes: boolean;
  dims: boolean;
  overhang: boolean;
  bed: boolean;
}

const LABELS: Record<keyof Toggles, { icon: IconName; title: string }> = {
  wireframe: { icon: "wire", title: "Wireframe" },
  transparent: { icon: "ghost", title: "Transparency" },
  grid: { icon: "grid", title: "Grid" },
  axes: { icon: "axes", title: "Axes (X red · Y green · Z blue)" },
  dims: { icon: "ruler", title: "Dimensions & bounding box" },
  overhang: { icon: "warn", title: "Highlight overhangs" },
  bed: { icon: "printer", title: "Show build plate" },
};

export function ModelViewer({ url, meshKey, bed = { x: 300, y: 300 }, overhangDeg = 45, onSnapshot, className, emptyHint }: ViewerProps) {
  const host = useRef<HTMLDivElement>(null);
  const three = useRef<ThreeState | null>(null);
  const [toggles, setToggles] = useState<Toggles>({ wireframe: false, transparent: false, grid: true, axes: true, dims: true, overhang: false, bed: false });
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [size, setSize] = useState<{ x: number; y: number; z: number } | null>(null);
  const [expanded, setExpanded] = useState(false);
  const snapshotCb = useRef(onSnapshot);
  snapshotCb.current = onSnapshot;

  // ── scene setup (once) ───────────────────────────────────────────────
  useEffect(() => {
    const el = host.current!;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: false, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0xf1f2f5, 1);
    renderer.domElement.style.cssText = "position:absolute;inset:0;width:100%;height:100%;touch-action:none;outline:none";
    el.prepend(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(35, 1, 0.5, 20000);
    camera.up.set(0, 0, 1);
    camera.position.set(220, -260, 180);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.09;
    controls.screenSpacePanning = true;

    scene.add(new THREE.HemisphereLight(0xffffff, 0xb8bcc8, 1.15));
    const key = new THREE.DirectionalLight(0xffffff, 1.6);
    key.position.set(200, -150, 300);
    scene.add(key);
    const fill = new THREE.DirectionalLight(0xdfe6ff, 0.6);
    fill.position.set(-250, 200, 100);
    scene.add(fill);

    const helpers = new THREE.Group();
    scene.add(helpers);
    const grid = new THREE.GridHelper(300, 30, 0xb9bdc9, 0xdadde5);
    grid.rotation.x = Math.PI / 2;
    const axes = new THREE.AxesHelper(40);
    const bedBox = new THREE.LineLoop(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-bed.x / 2, -bed.y / 2, 0), new THREE.Vector3(bed.x / 2, -bed.y / 2, 0), new THREE.Vector3(bed.x / 2, bed.y / 2, 0), new THREE.Vector3(-bed.x / 2, bed.y / 2, 0)]),
      new THREE.LineBasicMaterial({ color: 0x2f5bff }),
    );
    const bbox = new THREE.Box3Helper(new THREE.Box3(), new THREE.Color(0x2f5bff));
    bbox.visible = false;
    helpers.add(grid, axes, bedBox, bbox);

    const material = new THREE.MeshStandardMaterial({ color: 0xdfe3ec, roughness: 0.52, metalness: 0.05, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
    const labels = {
      x: mkLabel(el, "Width"),
      y: mkLabel(el, "Depth"),
      z: mkLabel(el, "Height"),
    };

    const st: ThreeState = { renderer, scene, camera, controls, material, mesh: null, helpers: { grid, axes, bedBox, bbox }, labels, box: new THREE.Box3(), raf: 0, frame: () => {}, dispose: () => {} };
    three.current = st;

    const resize = () => {
      const w = el.clientWidth, h = el.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    resize();

    const v = new THREE.Vector3();
    const place = (div: HTMLElement, p: THREE.Vector3, visible: boolean) => {
      v.copy(p).project(camera);
      const on = visible && v.z < 1 && Math.abs(v.x) < 1.1 && Math.abs(v.y) < 1.1;
      div.style.display = on ? "block" : "none";
      if (on) div.style.transform = `translate(-50%,-50%) translate(${((v.x + 1) / 2) * el.clientWidth}px,${((1 - v.y) / 2) * el.clientHeight}px)`;
    };
    st.frame = () => {
      controls.update();
      renderer.render(scene, camera);
      const b = st.box;
      const showDims = !!st.mesh && st.showDims;
      if (showDims) {
        place(labels.x, new THREE.Vector3((b.min.x + b.max.x) / 2, b.min.y, b.min.z), true);
        place(labels.y, new THREE.Vector3(b.max.x, (b.min.y + b.max.y) / 2, b.min.z), true);
        place(labels.z, new THREE.Vector3(b.min.x, b.min.y, (b.min.z + b.max.z) / 2), true);
      } else Object.values(labels).forEach((l) => (l.style.display = "none"));
    };
    const loop = () => {
      st.raf = requestAnimationFrame(loop);
      if (!document.hidden) st.frame();
    };
    loop();

    st.dispose = () => {
      cancelAnimationFrame(st.raf);
      ro.disconnect();
      controls.dispose();
      st.mesh?.geometry.dispose();
      material.dispose();
      renderer.dispose();
      renderer.domElement.remove();
      Object.values(labels).forEach((l) => l.remove());
    };
    return () => st.dispose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── load mesh ────────────────────────────────────────────────────────
  useEffect(() => {
    const st = three.current;
    if (!st) return;
    if (!url) {
      if (st.mesh) {
        st.scene.remove(st.mesh);
        st.mesh.geometry.dispose();
        st.mesh = null;
      }
      st.helpers.bbox.visible = false;
      setSize(null);
      setStatus("idle");
      return;
    }
    const ac = new AbortController();
    setStatus("loading");
    (async () => {
      try {
        const res = await fetch(url, { signal: ac.signal });
        if (!res.ok) throw new Error(String(res.status));
        const raw = new STLLoader().parse(await res.arrayBuffer());
        raw.computeBoundingBox();
        const tris = raw.attributes.position.count / 3;
        const geo = tris < 400_000 ? toCreasedNormals(raw, THREE.MathUtils.degToRad(35)) : raw;
        if (geo !== raw) raw.dispose();
        geo.computeBoundingBox();
        if (st.mesh) {
          st.scene.remove(st.mesh);
          st.mesh.geometry.dispose();
        }
        const mesh = new THREE.Mesh(geo, st.material);
        st.scene.add(mesh);
        st.mesh = mesh;
        st.box.copy(geo.boundingBox!);
        st.helpers.bbox.box.copy(st.box);
        const s = st.box.getSize(new THREE.Vector3());
        setSize({ x: s.x, y: s.y, z: s.z });
        const f = (n: number) => `${n.toFixed(1)} mm`;
        st.labels.x.textContent = `Width ${f(s.x)}`;
        st.labels.y.textContent = `Depth ${f(s.y)}`;
        st.labels.z.textContent = `Height ${f(s.z)}`;
        applyOverhang(st, overhangDeg, geo);
        frameCamera(st);
        applyToggles(st, togglesRef.current);
        setStatus("ready");
        if (snapshotCb.current) {
          requestAnimationFrame(() => snapshot(st).then((b) => b && snapshotCb.current?.(b)));
        }
      } catch (e) {
        if ((e as Error).name !== "AbortError") setStatus("error");
      }
    })();
    return () => ac.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, meshKey]);

  // ── toggles ──────────────────────────────────────────────────────────
  const togglesRef = useRef(toggles);
  togglesRef.current = toggles;
  useEffect(() => {
    if (three.current) applyToggles(three.current, toggles);
  }, [toggles]);

  const reset = useCallback(() => three.current && frameCamera(three.current), []);
  const flip = (k: keyof Toggles) => setToggles((t) => ({ ...t, [k]: !t[k] }));

  return (
    <div className={cx(expanded ? "fixed inset-0 z-50 bg-bg" : (className ?? "relative size-full"), "overflow-hidden")}>
      <div ref={host} className="absolute inset-0 select-none">
        {status === "loading" && (
          <div className="pointer-events-none absolute inset-0 grid place-items-center">
            <div className="flex items-center gap-2 rounded-full bg-white/90 px-3 py-1.5 text-xs text-ink-2 shadow"><Spinner /> Loading 3D model…</div>
          </div>
        )}
        {status === "idle" && !url && <div className="absolute inset-0 grid place-items-center p-8 text-center text-sm text-ink-3">{emptyHint ?? "No 3D model yet"}</div>}
        {status === "error" && <div className="absolute inset-0 grid place-items-center text-sm text-bad">Could not load the 3D file.</div>}
      </div>

      {size && toggles.dims && (
        <div className="pointer-events-none absolute left-3 top-3 rounded-xl bg-white/90 px-3 py-2 font-mono text-[11px] leading-5 text-ink shadow-sm ring-1 ring-black/5 backdrop-blur">
          <div>Width <b>{size.x.toFixed(1)}</b> mm</div>
          <div>Depth <b>{size.y.toFixed(1)}</b> mm</div>
          <div>Height <b>{size.z.toFixed(1)}</b> mm</div>
        </div>
      )}

      <div className="absolute right-3 top-3 flex gap-1.5">
        <IconBtn title="Reset camera" onClick={reset}><Icon name="reset" /></IconBtn>
        <IconBtn title={expanded ? "Exit full screen" : "Full screen"} onClick={() => setExpanded((e) => !e)}><Icon name={expanded ? "shrink" : "expand"} /></IconBtn>
      </div>

      <div className="absolute inset-x-0 bottom-3 flex justify-center px-3">
        <div className="scroll-thin flex max-w-full gap-0.5 overflow-x-auto rounded-full bg-white/90 p-1 shadow-sm ring-1 ring-black/5 backdrop-blur">
          {(Object.keys(LABELS) as (keyof Toggles)[]).map((k) => (
            <button key={k} title={LABELS[k].title} aria-label={LABELS[k].title} aria-pressed={toggles[k]} onClick={() => flip(k)}
              className={cx("grid size-10 shrink-0 place-items-center rounded-full transition sm:size-8", toggles[k] ? "bg-ink text-white" : "text-ink-2 hover:bg-black/5")}>
              <Icon name={LABELS[k].icon} />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function IconBtn(p: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button {...p} aria-label={p.title} className="grid size-10 place-items-center rounded-full bg-white/90 text-ink-2 shadow-sm sm:size-8 ring-1 ring-black/5 backdrop-blur transition hover:text-ink" />;
}

// ───────────────────────────── three helpers ─────────────────────────────
interface ThreeState {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  material: THREE.MeshStandardMaterial;
  mesh: THREE.Mesh | null;
  helpers: { grid: THREE.Object3D; axes: THREE.Object3D; bedBox: THREE.Object3D; bbox: THREE.Box3Helper };
  labels: { x: HTMLElement; y: HTMLElement; z: HTMLElement };
  box: THREE.Box3;
  raf: number;
  frame: () => void;
  dispose: () => void;
  showDims?: boolean;
}

function mkLabel(parent: HTMLElement, text: string) {
  const d = document.createElement("div");
  d.textContent = text;
  d.style.cssText = "position:absolute;left:0;top:0;pointer-events:none;display:none;padding:2px 7px;border-radius:999px;background:#2f5bff;color:#fff;font:600 10.5px/16px ui-monospace,Menlo,monospace;white-space:nowrap;box-shadow:0 1px 4px rgba(0,0,0,.2)";
  parent.appendChild(d);
  return d;
}

function applyToggles(st: ThreeState, t: Toggles) {
  st.material.wireframe = t.wireframe;
  st.material.transparent = t.transparent;
  st.material.opacity = t.transparent ? 0.45 : 1;
  st.material.depthWrite = !t.transparent;
  st.material.vertexColors = t.overhang;
  st.material.needsUpdate = true;
  st.helpers.grid.visible = t.grid;
  st.helpers.axes.visible = t.axes;
  st.helpers.bedBox.visible = t.bed;
  st.helpers.bbox.visible = t.dims && !!st.mesh;
  st.showDims = t.dims;
}

function frameCamera(st: ThreeState) {
  const box = st.box.isEmpty() ? new THREE.Box3(new THREE.Vector3(-50, -50, 0), new THREE.Vector3(50, 50, 80)) : st.box;
  const c = box.getCenter(new THREE.Vector3());
  const r = box.getSize(new THREE.Vector3()).length() / 2 || 50;
  const dist = r / Math.sin(THREE.MathUtils.degToRad(st.camera.fov / 2)) * 1.3;
  const dir = new THREE.Vector3(0.75, -1, 0.7).normalize();
  st.camera.position.copy(c).addScaledVector(dir, dist);
  st.camera.near = Math.max(0.1, dist / 500);
  st.camera.far = dist * 40;
  st.camera.updateProjectionMatrix();
  st.controls.target.copy(c);
  st.controls.update();
}

/** Colour faces that need support (steeper than the limit, not lying on the bed) red. */
function applyOverhang(st: ThreeState, limitDeg: number, geo: THREE.BufferGeometry) {
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const minZ = geo.boundingBox!.min.z;
  const nzLimit = -Math.sin(THREE.MathUtils.degToRad(limitDeg));
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3();
  for (let i = 0; i < pos.count; i += 3) {
    a.fromBufferAttribute(pos, i); b.fromBufferAttribute(pos, i + 1); c.fromBufferAttribute(pos, i + 2);
    n.crossVectors(b.clone().sub(a), c.clone().sub(a)).normalize();
    const bad = n.z < nzLimit && Math.max(a.z, b.z, c.z) - minZ > 0.15;
    for (let k = 0; k < 3; k++) {
      colors[(i + k) * 3] = bad ? 0.93 : 0.87;
      colors[(i + k) * 3 + 1] = bad ? 0.2 : 0.89;
      colors[(i + k) * 3 + 2] = bad ? 0.22 : 0.93;
    }
  }
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  void st;
}

/** Transparent 480×360 render of the mesh for project cards / version thumbnails. */
async function snapshot(st: ThreeState): Promise<Blob | null> {
  if (!st.mesh) return null;
  const { renderer, scene, camera } = st;
  const hidden: THREE.Object3D[] = [st.helpers.grid, st.helpers.axes, st.helpers.bedBox, st.helpers.bbox].filter((o) => o.visible);
  hidden.forEach((o) => (o.visible = false));
  const prev = { size: renderer.getSize(new THREE.Vector2()), alpha: renderer.getClearAlpha(), cam: camera.position.clone(), target: st.controls.target.clone(), aspect: camera.aspect };
  const prevWire = st.material.wireframe, prevVC = st.material.vertexColors, prevT = st.material.transparent;
  st.material.wireframe = false; st.material.vertexColors = false; st.material.transparent = false;
  st.material.needsUpdate = true;
  try {
    frameCamera(st);
    renderer.setClearAlpha(0);
    renderer.setSize(480, 360, false);
    camera.aspect = 480 / 360;
    camera.updateProjectionMatrix();
    renderer.render(scene, camera);
    const out = document.createElement("canvas");
    out.width = 480; out.height = 360;
    out.getContext("2d")!.drawImage(renderer.domElement, 0, 0, 480, 360);
    return await new Promise<Blob | null>((r) => out.toBlob(r, "image/png"));
  } finally {
    hidden.forEach((o) => (o.visible = true));
    st.material.wireframe = prevWire; st.material.vertexColors = prevVC; st.material.transparent = prevT; st.material.needsUpdate = true;
    renderer.setClearAlpha(prev.alpha);
    renderer.setSize(prev.size.x, prev.size.y, false);
    camera.aspect = prev.aspect;
    camera.position.copy(prev.cam);
    st.controls.target.copy(prev.target);
    camera.updateProjectionMatrix();
    st.controls.update();
  }
}
