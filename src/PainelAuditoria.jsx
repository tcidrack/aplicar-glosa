import { useState, useRef, useEffect, useReducer } from "react";
import { flushSync } from "react-dom";
import {
  FilePlus, Folder, Undo2, Trash2, Save, Download,
  ChevronLeft, ChevronRight, Minus, Plus, Pencil, Type, Highlighter,
  Moon, Sun, Stamp, Copy, X, Redo2, Move,
} from "lucide-react";
import "./PainelAuditoria.css";

// bibliotecas auto-hospedadas (empacotadas no bundle — sem CDN de terceiros)
import * as pdfjsLib from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.js?url";
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import JSZip from "jszip";
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

const LOGO_MAIDA =
  "https://maida.health/wp-content/themes/melhortema/assets/images/logo-light.svg";

// hex → rgba com transparência (para o canvas)
const hexA = (h, al) => {
  const n = parseInt(h.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${al})`;
};

// ---- carimbos ----
// nome do dono a partir do arquivo: "carimbo-aline-batista.png" → "Aline Batista"
const stampName = (file) =>
  file
    .replace(/\.(png|jpe?g)$/i, "")
    .replace(/^carimbo[-_]*/i, "")
    .replace(/[-_]+/g, " ")
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase()) || "Carimbo";

// carimbos da pasta local (src/carimbos é ignorada pelo git — sigilosa;
// entram apenas em builds feitos nesta máquina)
// ?inline → embute como data-URI base64 no bundle (sem asset baixável em /assets)
const stampFiles = import.meta.glob("./carimbos/*.{png,jpg,jpeg}", {
  eager: true, query: "?inline", import: "default",
});
const LOCAL_STAMPS = Object.entries(stampFiles).map(([path, url]) => {
  const file = path.split("/").pop();
  return { key: "f:" + file, nome: stampName(file), url, local: false };
});

// carimbos adicionados pelo usuário no navegador (nunca saem do dispositivo)
const loadUserStamps = () => {
  try { return JSON.parse(localStorage.getItem("carimbos") || "[]"); }
  catch { return []; }
};


// botão redondo (× fechar / excluir)
function RoundBtn({ style, title, onAction, bg, children }) {
  return (
    <button
      onPointerDown={(e) => { e.stopPropagation(); e.preventDefault(); onAction(); }}
      title={title}
      style={{
        position: "absolute", width: 22, height: 22, borderRadius: "50%",
        border: "none", background: bg, color: "#fff", fontSize: 14,
        lineHeight: "22px", textAlign: "center", cursor: "pointer", padding: 0,
        boxShadow: "0 1px 3px rgba(0,0,0,.3)", zIndex: 3, touchAction: "none", ...style,
      }}
    >
      {children}
    </button>
  );
}

// ---- caixa de texto editável, móvel e redimensionável (estilo Canva) ----
function TextBox({ a, scale, editing, selected, interactive, onChange, onMove,
  onResize, onMeasure, onStartEdit, onEndEdit, onSelect, onDelete, onCancel, onDuplicate }) {
  const boxRef = useRef(null);
  const inputRef = useRef(null);
  const drag = useRef(null);
  const rez = useRef(null);

  const [hover, setHover] = useState(false);

  // foca ao entrar em edição (após o DOM assentar, evita blur imediato)
  useEffect(() => {
    if (!editing) return;
    const id = requestAnimationFrame(() => {
      const el = inputRef.current;
      if (el) { el.focus({ preventScroll: true }); el.select(); }
    });
    return () => cancelAnimationFrame(id);
  }, [editing]);

  // mede tamanho real e reporta em coords do documento
  const measure = () => {
    const el = boxRef.current; if (!el) return;
    onMeasure(el.offsetWidth / scale, el.offsetHeight / scale);
  };
  useEffect(() => { if (!editing) measure(); });

  const startDrag = (e) => {
    if (editing) return;
    e.stopPropagation();
    onSelect();
    drag.current = { px: e.clientX, py: e.clientY, x: a.x, y: a.y, moved: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const moveDrag = (e) => {
    if (!drag.current) return;
    const d = drag.current;
    const nx = d.x + (e.clientX - d.px) / scale;
    const ny = d.y + (e.clientY - d.py) / scale;
    if (Math.abs(e.clientX - d.px) + Math.abs(e.clientY - d.py) > 2) d.moved = true;
    onMove(Math.max(0, nx), Math.max(0, ny));
  };
  const endDrag = () => { drag.current = null; measure(); };

  // ---- redimensionar o tamanho da fonte (arrastar alça no canto) ----
  const startResize = (e) => {
    e.stopPropagation();
    const r = boxRef.current.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    rez.current = { cx, cy, startSize: a.size,
      startDist: Math.hypot(e.clientX - cx, e.clientY - cy) || 1 };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const moveResize = (e) => {
    const rc = rez.current; if (!rc) return;
    const dist = Math.hypot(e.clientX - rc.cx, e.clientY - rc.cy);
    onResize(Math.max(6, Math.min(200, rc.startSize * (dist / rc.startDist))));
  };
  const endResize = () => { if (rez.current) { rez.current = null; measure(); } };

  const commonStyle = {
    position: "absolute",
    left: a.x * scale,
    top: a.y * scale,
    color: a.color,
    fontSize: a.size * scale,
    fontWeight: 600,
    fontFamily: "sans-serif",
    lineHeight: 1.25,
    whiteSpace: "pre",
    pointerEvents: interactive ? "auto" : "none",
    touchAction: "none", // arraste com o dedo sem rolar a página
  };

  if (editing) {
    return (
      <div style={{ position: "absolute", left: a.x * scale, top: a.y * scale,
        pointerEvents: interactive ? "auto" : "none" }}>
        <input
          ref={inputRef}
          value={a.text}
          placeholder="digite…"
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); onEndEdit(); }
            if (e.key === "Escape") { e.preventDefault(); onCancel(); }
          }}
          onBlur={onEndEdit}
          style={{
            display: "block",
            color: a.color, fontSize: a.size * scale, fontWeight: 600,
            fontFamily: "sans-serif", lineHeight: 1.25,
            padding: "2px 5px", margin: 0,
            border: "2px solid var(--accent)", borderRadius: 5, outline: "none",
            boxShadow: "0 2px 10px rgba(0,0,0,.18)", background: "#fff", minWidth: 90,
          }}
        />
        {/* × desistir de escrever */}
        <RoundBtn bg="#111827" title="Fechar / desistir" onAction={onCancel}
          style={{ top: -9, right: -9 }}>×</RoundBtn>
      </div>
    );
  }

  const showBox = selected || hover;
  const handles = [
    { key: "tl", pos: { top: -8, left: -8, cursor: "nwse-resize" } },
    { key: "bl", pos: { bottom: -8, left: -8, cursor: "nesw-resize" } },
    { key: "br", pos: { bottom: -8, right: -8, cursor: "nwse-resize" } },
  ];
  return (
    <div
      ref={boxRef}
      onPointerDown={startDrag}
      onPointerMove={moveDrag}
      onPointerUp={endDrag}
      onDoubleClick={(e) => { e.stopPropagation(); onStartEdit(); }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      title={interactive ? "Duplo clique para editar · arraste para mover" : undefined}
      style={{
        ...commonStyle,
        padding: "2px 5px",
        cursor: interactive ? "move" : "default",
        borderRadius: 5,
        border: showBox ? "1.5px dashed var(--accent)" : "1.5px solid transparent",
        background: showBox ? "rgba(255,255,255,.10)" : "transparent",
        userSelect: "none",
      }}
    >
      {a.text || " "}
      {selected && interactive && (
        <>
          <RoundBtn bg="#d92d20" title="Excluir" onAction={onDelete} style={{ top: -10, right: -10 }}>
          ×
          </RoundBtn>
          <RoundBtn bg="#1f6feb" title="Duplicar texto" onAction={onDuplicate}
            style={{ top: -10, left: -10 }}>
            <Copy style={{ width: 12, height: 12, margin: "0 auto" }} />
          </RoundBtn>
          {handles.map((h) => (
            <div
              key={h.key}
              onPointerDown={startResize}
              onPointerMove={moveResize}
              onPointerUp={endResize}
              style={{
                position: "absolute", width: 16, height: 16, borderRadius: 4,
                background: "#fff", border: "1.5px solid var(--accent)",
                boxShadow: "0 1px 3px rgba(0,0,0,.3)", zIndex: 2,
                touchAction: "none", ...h.pos,
              }}
            />
          ))}
          {/* alça de mover: alvo grande e separado do × (evita excluir sem querer) */}
          <div
            onPointerDown={startDrag} onPointerMove={moveDrag} onPointerUp={endDrag}
            title="Arraste para mover"
            style={{
              position: "absolute", bottom: -30, left: "50%", transform: "translateX(-50%)",
              width: 34, height: 24, borderRadius: 12,
              background: "var(--accent)", color: "var(--accent-contrast)",
              display: "flex", alignItems: "center", justifyContent: "center",
              boxShadow: "0 1px 4px rgba(0,0,0,.35)", zIndex: 3, cursor: "move", touchAction: "none",
            }}
          >
            <Move style={{ width: 16, height: 16 }} />
          </div>
        </>
      )}
    </div>
  );
}

// ---- carimbo inserido no PDF: mover, redimensionar (proporção fixa) e excluir ----
function StampBox({ a, scale, selected, interactive, onMove, onResize, onSelect, onDelete, onDuplicate }) {
  const boxRef = useRef(null);
  const drag = useRef(null);
  const rez = useRef(null);
  const [hover, setHover] = useState(false);

  const startDrag = (e) => {
    e.stopPropagation();
    onSelect();
    drag.current = { px: e.clientX, py: e.clientY, x: a.x, y: a.y };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const moveDrag = (e) => {
    if (!drag.current) return;
    const d = drag.current;
    onMove(Math.max(0, d.x + (e.clientX - d.px) / scale),
           Math.max(0, d.y + (e.clientY - d.py) / scale));
  };
  const endDrag = () => { drag.current = null; };

  const startResize = (e) => {
    e.stopPropagation();
    const r = boxRef.current.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    rez.current = { cx, cy, w0: a.w, h0: a.h,
      d0: Math.hypot(e.clientX - cx, e.clientY - cy) || 1 };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const moveResize = (e) => {
    const rc = rez.current; if (!rc) return;
    const k = Math.hypot(e.clientX - rc.cx, e.clientY - rc.cy) / rc.d0;
    const w = Math.max(24, Math.min(600, rc.w0 * k));
    onResize(w, w * (rc.h0 / rc.w0)); // mantém a proporção
  };
  const endResize = () => { rez.current = null; };

  const showBox = selected || hover;
  const handles = [
    { key: "tl", pos: { top: -8, left: -8, cursor: "nwse-resize" } },
    { key: "bl", pos: { bottom: -8, left: -8, cursor: "nesw-resize" } },
    { key: "br", pos: { bottom: -8, right: -8, cursor: "nwse-resize" } },
  ];
  return (
    <div
      ref={boxRef}
      onPointerDown={startDrag}
      onPointerMove={moveDrag}
      onPointerUp={endDrag}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      title={interactive ? "Arraste p/ mover · cantos p/ tamanho" : undefined}
      style={{
        position: "absolute",
        left: a.x * scale,
        top: a.y * scale,
        width: a.w * scale,
        height: a.h * scale,
        cursor: interactive ? "move" : "default",
        borderRadius: 5,
        border: showBox ? "1.5px dashed var(--accent)" : "1.5px solid transparent",
        pointerEvents: interactive ? "auto" : "none",
        touchAction: "none",
        userSelect: "none",
      }}
    >
      <img src={a.url} alt="" draggable={false} onContextMenu={(e) => e.preventDefault()}
        style={{ width: "100%", height: "100%", pointerEvents: "none", userSelect: "none" }} />
      {selected && interactive && (
        <>
          <RoundBtn bg="#d92d20" title="Excluir" onAction={onDelete}
            style={{ top: -10, right: -10 }}>×</RoundBtn>
          <RoundBtn bg="#1f6feb" title="Duplicar carimbo" onAction={onDuplicate}
            style={{ top: -10, left: -10 }}>
            <Copy style={{ width: 12, height: 12, margin: "0 auto" }} />
          </RoundBtn>
          {handles.map((h) => (
            <div
              key={h.key}
              onPointerDown={startResize}
              onPointerMove={moveResize}
              onPointerUp={endResize}
              style={{
                position: "absolute", width: 16, height: 16, borderRadius: 4,
                background: "#fff", border: "1.5px solid var(--accent)",
                boxShadow: "0 1px 3px rgba(0,0,0,.3)", zIndex: 2,
                touchAction: "none", ...h.pos,
              }}
            />
          ))}
        </>
      )}
    </div>
  );
}

export default function PainelAuditoria() {
  const ready = true; // libs empacotadas no bundle — sempre disponíveis
  const [loadErr] = useState("");

  const [tema, setTema] = useState(() => localStorage.getItem("tema") || "claro");
  useEffect(() => { localStorage.setItem("tema", tema); }, [tema]);

  const store = useRef({ docs: [] });
  const seq = useRef(0);
  const [activeId, setActiveId] = useState(null);
  const [page, setPage] = useState(1);
  const [scale, setScale] = useState(1.3);
  const [tool, setTool] = useState("strike");
  const [color, setColor] = useState("#d92d20");
  const [thickness, setThickness] = useState(2);
  const [saving, setSaving] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [stampsOpen, setStampsOpen] = useState(false);
  const [userStamps, setUserStamps] = useState(loadUserStamps);
  const [dialog, setDialog] = useState(null); // alert/confirm customizado
  const showAlert = (title, message) => setDialog({ title, message, alert: true });
  const showConfirm = (title, message, onConfirm, opts = {}) =>
    setDialog({ title, message, onConfirm, confirmText: opts.confirmText || "Confirmar" });
  const [editingId, setEditingId] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const textSeq = useRef(0);
  const editOrig = useRef("");
  const [, tick] = useReducer((x) => x + 1, 0);

  // limpa edição/seleção ao trocar de documento ou página
  useEffect(() => { setEditingId(null); setSelectedId(null); }, [activeId, page]);

  const baseRef = useRef(null);
  const overlayRef = useRef(null);
  const wrapRef = useRef(null);
  const mainRef = useRef(null);
  const fileRef = useRef(null);
  const folderRef = useRef(null);
  const stampFileRef = useRef(null);
  const drawing = useRef(false);
  const startPt = useRef(null);
  const panning = useRef(null); // arrastar para navegar no modo neutro
  const redo = useRef([]);      // pilha de refazer: { docId, page, ann }
  const focal = useRef(null);   // ponto (coords doc) a centralizar após mudar o zoom
  const lastTap = useRef(null); // detecção de duplo toque
  const pointers = useRef(new Map()); // ponteiros ativos no overlay
  const pinch = useRef(null);   // estado da pinça (2 dedos)

  const getActive = () => store.current.docs.find((d) => d.id === activeId);

  // ---- folder input attribute ----
  useEffect(() => {
    if (folderRef.current) folderRef.current.setAttribute("webkitdirectory", "");
  }, [ready]);

  // ---- render da página ----
  useEffect(() => {
    if (!ready || !activeId) return;
    let cancelled = false;
    (async () => {
      const doc = getActive();
      if (!doc) return;
      if (!doc.pdfDoc) {
        // isEvalSupported:false → mitiga GHSA-wgrm-67xf-hhpq (exec. de JS em PDF malicioso)
        doc.pdfDoc = await pdfjsLib.getDocument({ data: doc.bytes.slice(0), isEvalSupported: false }).promise;
        doc.numPages = doc.pdfDoc.numPages;
        tick();
      }
      const pageObj = await doc.pdfDoc.getPage(page);
      if (cancelled) return;
      // auto-fit: na 1ª abertura do doc, ajusta o zoom à largura disponível (celular)
      if (!doc.autoFit) {
        doc.autoFit = true;
        const avail = mainRef.current ? mainRef.current.clientWidth - 32 : 0;
        if (avail > 0) {
          const vp1 = pageObj.getViewport({ scale: 1 });
          const fit = Math.min(1.3, Math.max(0.5, avail / vp1.width));
          if (fit < scale - 0.01) { setScale(fit); return; } // re-renderiza com o novo zoom
        }
      }
      const vp = pageObj.getViewport({ scale });
      const b = baseRef.current, o = overlayRef.current;
      if (!b || !o) return;
      b.width = o.width = Math.floor(vp.width);
      b.height = o.height = Math.floor(vp.height);
      await pageObj.render({ canvasContext: b.getContext("2d"), viewport: vp }).promise;
      drawOverlay();
      // centraliza no ponto do zoom (duplo clique/toque ou pinça)
      if (focal.current && mainRef.current) {
        const m = mainRef.current, f = focal.current;
        m.scrollLeft = f.x * scale - m.clientWidth / 2;
        m.scrollTop = f.y * scale - m.clientHeight / 2;
        focal.current = null;
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, activeId, page, scale]);

  // ---- overlay ----
  const paint = (ctx, a) => {
    const s = scale;
    if (a.type === "strike") {
      ctx.strokeStyle = a.color; ctx.lineWidth = a.thickness * s; ctx.lineCap = "round";
      ctx.beginPath(); ctx.moveTo(a.x1 * s, a.y1 * s); ctx.lineTo(a.x2 * s, a.y2 * s); ctx.stroke();
    } else if (a.type === "highlight") {
      const x = Math.min(a.x1, a.x2) * s, y = Math.min(a.y1, a.y2) * s;
      const w = Math.abs(a.x2 - a.x1) * s, h = Math.abs(a.y2 - a.y1) * s;
      ctx.fillStyle = hexA(a.color || "#ffd600", 0.38); ctx.fillRect(x, y, w, h);
    }
    // texto é renderizado como caixa DOM (ver TextBox), não no canvas
  };
  const drawOverlay = (preview) => {
    const o = overlayRef.current; if (!o) return;
    const ctx = o.getContext("2d"); ctx.clearRect(0, 0, o.width, o.height);
    const doc = getActive(); if (!doc) return;
    (doc.annotations[page] || []).forEach((a) => paint(ctx, a));
    if (preview) paint(ctx, preview);
  };

  // ---- coordenadas ----
  const toDoc = (e) => {
    const r = overlayRef.current.getBoundingClientRect();
    return { x: (e.clientX - r.left) / scale, y: (e.clientY - r.top) / scale };
  };

  // ---- zoom no ponto (duplo clique/toque) ----
  const zoomAt = (p) => {
    const m = mainRef.current, b = baseRef.current;
    if (!m || !b) return;
    let novo;
    if (scale < 2.99) novo = Math.min(3, scale * 1.5);
    else {
      // já no máximo: volta ao ajuste de largura
      const pageW = b.width / scale;
      novo = Math.min(1.3, Math.max(0.5, (m.clientWidth - 32) / pageW));
    }
    if (Math.abs(novo - scale) < 0.01) return;
    focal.current = p;
    setScale(novo);
  };
  const onDblClick = (e) => {
    if (tool === "text") return; // no modo texto o clique cria/edita caixas
    zoomAt(toDoc(e));
  };

  // ---- pinça (2 dedos) ----
  const pinchDist = () => {
    const pts = [...pointers.current.values()];
    return Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) || 1;
  };
  const pinchMid = () => {
    const pts = [...pointers.current.values()];
    return { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
  };

  // ---- desenho / navegação ----
  const onDown = (e) => {
    const doc = getActive(); if (!doc) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    e.currentTarget.setPointerCapture(e.pointerId);
    if (pointers.current.size === 2) {
      // 2º dedo: vira pinça — cancela desenho/pan em andamento
      drawing.current = false; panning.current = null; drawOverlay();
      const mid = pinchMid();
      const r = overlayRef.current.getBoundingClientRect();
      pinch.current = {
        d0: pinchDist(), scale0: scale, k: 1,
        mid: { x: (mid.x - r.left) / scale, y: (mid.y - r.top) / scale },
      };
      return;
    }
    if (pinch.current) return; // ignora dedos extras durante a pinça
    const p = toDoc(e);
    // duplo toque → zoom no ponto (no mouse o dblclick nativo cuida disso)
    if (e.pointerType === "touch") {
      const t = Date.now(), lt = lastTap.current;
      lastTap.current = { t, x: e.clientX, y: e.clientY };
      if (lt && t - lt.t < 350 && Math.hypot(e.clientX - lt.x, e.clientY - lt.y) < 25) {
        lastTap.current = null;
        zoomAt(p);
        return;
      }
    }
    if (tool === "text") {
      if (editingId) return;   // já há uma caixa em edição: não cria outra (o blur finaliza)
      // flushSync + foco síncrono dentro do gesto → abre o teclado no celular
      flushSync(() => addText(p));
      const inp = wrapRef.current && wrapRef.current.querySelector("input");
      if (inp) inp.focus();
      return;
    }
    setSelectedId(null);
    if (tool !== "strike" && tool !== "highlight") {
      // modo neutro: arrastar para navegar pelo documento (mouse ou dedo)
      const m = mainRef.current; if (!m) return;
      panning.current = { x: e.clientX, y: e.clientY, sl: m.scrollLeft, st: m.scrollTop };
      return;
    }
    drawing.current = true; startPt.current = p;
  };
  const onMove = (e) => {
    if (pointers.current.has(e.pointerId))
      pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch.current && pointers.current.size >= 2) {
      // preview do zoom via CSS (sem re-renderizar o pdf.js a cada frame)
      const pc = pinch.current;
      let k = pinchDist() / pc.d0;
      k = Math.min(3 / pc.scale0, Math.max(0.5 / pc.scale0, k));
      pc.k = k;
      const w = wrapRef.current;
      if (w) {
        w.style.transformOrigin = `${pc.mid.x * pc.scale0}px ${pc.mid.y * pc.scale0}px`;
        w.style.transform = `scale(${k})`;
      }
      return;
    }
    if (panning.current) {
      const m = mainRef.current, pn = panning.current;
      if (m) {
        m.scrollLeft = pn.sl - (e.clientX - pn.x);
        m.scrollTop = pn.st - (e.clientY - pn.y);
      }
      return;
    }
    if (!drawing.current) return;
    const p = toDoc(e), s = startPt.current;
    const prev = tool === "strike"
      ? { type: "strike", x1: s.x, y1: s.y, x2: p.x, y2: p.y, color, thickness }
      : { type: "highlight", x1: s.x, y1: s.y, x2: p.x, y2: p.y, color };
    drawOverlay(prev);
  };
  const onUp = (e) => {
    pointers.current.delete(e.pointerId);
    if (pinch.current) {
      if (pointers.current.size < 2) {
        // fim da pinça: aplica o zoom de verdade (1 re-render nítido)
        const pc = pinch.current; pinch.current = null;
        const w = wrapRef.current;
        if (w) { w.style.transform = ""; w.style.transformOrigin = ""; }
        const novo = Math.min(3, Math.max(0.5, pc.scale0 * pc.k));
        if (Math.abs(novo - scale) > 0.01) { focal.current = pc.mid; setScale(novo); }
      }
      return;
    }
    if (panning.current) { panning.current = null; return; }
    if (!drawing.current) return;
    drawing.current = false;
    const p = toDoc(e), s = startPt.current, doc = getActive();
    if (Math.hypot(p.x - s.x, p.y - s.y) > 3) {
      const a = tool === "strike"
        ? { type: "strike", x1: s.x, y1: s.y, x2: p.x, y2: p.y, color, thickness }
        : { type: "highlight", x1: s.x, y1: s.y, x2: p.x, y2: p.y, color };
      (doc.annotations[page] = doc.annotations[page] || []).push(a);
      doc.saved = false; redo.current = []; tick();
    }
    drawOverlay();
  };
  // ---- caixas de texto (estilo Canva) ----
  const findText = (id) => {
    const d = getActive(); if (!d) return null;
    return (d.annotations[page] || []).find((a) => a.id === id) || null;
  };
  const addText = (p) => {
    const doc = getActive(); if (!doc) return;
    const id = "t" + ++textSeq.current;
    // tamanho proporcional ao zoom → ~15px na tela (no mobile não nasce gigante)
    const size = Math.max(9, Math.min(22, Math.round(15 / scale)));
    (doc.annotations[page] = doc.annotations[page] || []).push({
      type: "text", id, x: p.x, y: p.y, text: "", size, color, w: 120, h: 24,
    });
    doc.saved = false; editOrig.current = ""; redo.current = [];
    setSelectedId(id); setEditingId(id); tick();
  };
  // seleciona ferramenta; clicar de novo na ativa desmarca (modo neutro = navegar)
  const selectTool = (id) => {
    setTool(tool === id ? "select" : id);
    setSelectedId(null);
  };
  const updateText = (id, text) => {
    const a = findText(id); if (!a) return;
    a.text = text; getActive().saved = false; tick();
  };
  const moveText = (id, x, y) => {
    const a = findText(id); if (!a) return;
    a.x = x; a.y = y; getActive().saved = false; tick();
  };
  const resizeText = (id, size) => {
    const a = findText(id); if (!a) return;
    a.size = size; getActive().saved = false; tick();
  };
  const measureText = (id, w, h) => {
    const a = findText(id); if (!a) return;
    if (Math.abs((a.w || 0) - w) > 0.5 || Math.abs((a.h || 0) - h) > 0.5) {
      a.w = w; a.h = h;
    }
  };
  const deleteText = (id) => {
    const d = getActive(); if (!d) return;
    d.annotations[page] = (d.annotations[page] || []).filter((a) => a.id !== id);
    d.saved = false;
    setEditingId(null); setSelectedId(null); tick();
  };
  const endEditText = (id) => {
    const a = findText(id);
    if (a && !a.text.trim()) { deleteText(id); setTool("select"); return; }
    setEditingId(null);
    setTool("select"); // desmarca a ferramenta Texto após inserir
  };
  // inicia edição guardando o texto original (para permitir desistir/reverter)
  const startEditText = (id) => {
    const a = findText(id);
    editOrig.current = a ? a.text : "";
    setSelectedId(id); setEditingId(id);
  };
  // desistir de escrever: reverte ao texto original; se ficar vazio, remove a caixa
  const cancelText = (id) => {
    const a = findText(id);
    if (a) a.text = editOrig.current;
    if (!a || !a.text.trim()) { deleteText(id); setTool("select"); return; }
    getActive().saved = false;
    setEditingId(null); setTool("select"); tick();
  };
  // duplica qualquer anotação já inserida (texto ou carimbo)
  const duplicateAnn = (id) => {
    const doc = getActive(); const a = findText(id);
    if (!doc || !a) return;
    const prefix = a.type === "stamp" ? "s" : "t";
    const novo = { ...a, id: prefix + ++textSeq.current, x: a.x + 15, y: a.y + 15 };
    (doc.annotations[page] = doc.annotations[page] || []).push(novo);
    doc.saved = false; redo.current = [];
    setSelectedId(novo.id); tick();
  };

  // ---- carimbos ----
  const allStamps = [...LOCAL_STAMPS, ...userStamps];
  const addStamp = (stamp, ratio) => {
    const doc = getActive(); if (!doc) return;
    const m = mainRef.current;
    const w = 150, h = w * (ratio || 0.4);
    // centro da área visível, em coords do documento
    const x = m ? (m.scrollLeft + m.clientWidth / 2) / scale - w / 2 : 40;
    const y = m ? (m.scrollTop + m.clientHeight / 2) / scale - h / 2 : 40;
    const id = "s" + ++textSeq.current;
    (doc.annotations[page] = doc.annotations[page] || []).push({
      type: "stamp", id, x: Math.max(0, x), y: Math.max(0, y), w, h, url: stamp.url,
    });
    doc.saved = false; redo.current = [];
    setSelectedId(id); setStampsOpen(false); setTool("select"); tick();
  };
  const resizeStamp = (id, w, h) => {
    const a = findText(id); if (!a) return;
    a.w = w; a.h = h; getActive().saved = false; tick();
  };
  // upload de carimbo do próprio usuário — fica apenas neste navegador (localStorage)
  const addUserStamp = (file) => {
    const reader = new FileReader();
    reader.onload = () => {
      const novo = { key: "u:" + Date.now(), nome: stampName(file.name), url: reader.result, local: true };
      const lista = [...userStamps, novo];
      setUserStamps(lista);
      try { localStorage.setItem("carimbos", JSON.stringify(lista)); }
      catch { showAlert("Não foi possível salvar", "O carimbo pode ser grande demais. Tente uma imagem menor."); }
    };
    reader.readAsDataURL(file);
  };
  const removeUserStamp = (key) => {
    const lista = userStamps.filter((s) => s.key !== key);
    setUserStamps(lista);
    localStorage.setItem("carimbos", JSON.stringify(lista));
  };

  // ---- ações ----
  const addFiles = async (fileList) => {
    const arr = [...fileList].filter((f) => f.type === "application/pdf" || /\.pdf$/i.test(f.name));
    for (const f of arr) {
      const bytes = await f.arrayBuffer();
      store.current.docs.push({
        id: ++seq.current, name: f.name, bytes, pdfDoc: null,
        numPages: 0, page: 1, annotations: {}, saved: false,
      });
    }
    tick();
    if (!activeId && store.current.docs.length) { setActiveId(store.current.docs[0].id); setPage(1); }
  };
  const selectDoc = (id) => {
    const old = getActive(); if (old) old.page = page;
    const d = store.current.docs.find((x) => x.id === id);
    setActiveId(id); setPage(d.page || 1);
    setSidebarOpen(false); // fecha a gaveta no mobile
  };
  const removeDoc = (id) => {
    const docs = store.current.docs;
    const d = docs.find((x) => x.id === id); if (!d) return;
    const doRemove = () => {
      const list = store.current.docs;
      const idx = list.findIndex((x) => x.id === id);
      store.current.docs = list.filter((x) => x.id !== id);
      if (id === activeId) {
        const rest = store.current.docs;
        const next = rest[idx] || rest[idx - 1] || null;
        setActiveId(next ? next.id : null);
        setPage(next ? next.page || 1 : 1);
      }
      tick();
    };
    const temMarcas = !d.saved && Object.values(d.annotations).some((l) => l.length);
    if (temMarcas)
      showConfirm("Remover documento", `Remover "${d.name}"? As marcações não salvas serão perdidas.`, doRemove, { confirmText: "Remover" });
    else doRemove();
  };
  const undo = () => {
    const d = getActive(); const l = d && d.annotations[page];
    if (l && l.length) {
      const ann = l.pop();
      redo.current.push({ docId: activeId, page, ann });
      setSelectedId(null); drawOverlay(); tick();
    }
  };
  const redoAction = () => {
    const item = redo.current.pop(); if (!item) return;
    const d = store.current.docs.find((x) => x.id === item.docId); if (!d) return;
    (d.annotations[item.page] = d.annotations[item.page] || []).push(item.ann);
    drawOverlay(); tick();
  };
  const clearPage = () => {
    const d = getActive();
    if (!d || !(d.annotations[page] || []).length) return;
    showConfirm("Limpar página", "Remover todas as marcações desta página?", () => {
      d.annotations[page] = []; setSelectedId(null); drawOverlay(); tick();
    }, { confirmText: "Limpar" });
  };
  const prevPage = () => { if (page > 1) { const d = getActive(); d.page = page - 1; setPage(page - 1); } };
  const nextPage = () => { const d = getActive(); if (d && page < d.numPages) { d.page = page + 1; setPage(page + 1); } };

  // atalhos de teclado (lê versão atual via ref)
  const kb = useRef({});
  kb.current = { undo, redoAction, prevPage, nextPage, deleteText, editingId, selectedId };
  useEffect(() => {
    const h = (e) => {
      // não interferir enquanto o usuário digita num campo
      const t = e.target;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if ((e.key === "Delete" || e.key === "Backspace") && kb.current.selectedId && !kb.current.editingId) {
        e.preventDefault(); kb.current.deleteText(kb.current.selectedId); return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z" && !e.shiftKey) { e.preventDefault(); kb.current.undo(); }
      if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === "y" || (e.key.toLowerCase() === "z" && e.shiftKey))) { e.preventDefault(); kb.current.redoAction(); }
      if (e.key === "ArrowLeft") kb.current.prevPage();
      if (e.key === "ArrowRight") kb.current.nextPage();
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  // ---- exportar ----
  const hexRgb = (h) => {
    const n = parseInt(h.slice(1), 16);
    return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
  };
  const buildPdf = async (d) => {
    const out = await PDFDocument.load(d.bytes);
    const font = await out.embedFont(StandardFonts.HelveticaBold);
    const pages = out.getPages();
    const stampCache = new Map(); // url → PDFImage (embeda cada carimbo 1x por documento)
    const embedStamp = async (url) => {
      if (stampCache.has(url)) return stampCache.get(url);
      const bytes = await (await fetch(url)).arrayBuffer();
      const isJpg = url.startsWith("data:image/jpeg") || /\.jpe?g($|\?)/i.test(url);
      const img = isJpg ? await out.embedJpg(bytes) : await out.embedPng(bytes);
      stampCache.set(url, img);
      return img;
    };
    for (const [pg, list] of Object.entries(d.annotations)) {
      const pageObj = pages[pg - 1]; if (!pageObj) continue;
      const H = pageObj.getHeight();
      for (const a of list) {
        if (a.type === "strike")
          pageObj.drawLine({ start: { x: a.x1, y: H - a.y1 }, end: { x: a.x2, y: H - a.y2 }, thickness: a.thickness, color: hexRgb(a.color) });
        else if (a.type === "highlight") {
          const x = Math.min(a.x1, a.x2), w = Math.abs(a.x2 - a.x1);
          const yTop = Math.min(a.y1, a.y2), h = Math.abs(a.y2 - a.y1);
          pageObj.drawRectangle({ x, y: H - yTop - h, width: w, height: h, color: hexRgb(a.color || "#ffd600"), opacity: 0.38 });
        } else if (a.type === "text") {
          // desenha só o texto (sem caixa/borda/fundo), fixo e não editável
          String(a.text || "").split("\n").forEach((ln, i) => {
            if (!ln) return;
            pageObj.drawText(ln, {
              x: a.x + 1,
              y: H - a.y - a.size * (i + 1), // baseline ~1 tamanho abaixo do topo (casa com a tela)
              size: a.size,
              font,
              color: hexRgb(a.color),
            });
          });
        } else if (a.type === "stamp") {
          const img = await embedStamp(a.url);
          pageObj.drawImage(img, { x: a.x, y: H - a.y - a.h, width: a.w, height: a.h });
        }
      }
    }
    return out.save();
  };
  const outName = (n) => n.replace(/\.pdf$/i, "") + " - AUDITADO.pdf";
  const dl = (bytes, name, type = "application/pdf") => {
    const url = URL.createObjectURL(new Blob([bytes], { type }));
    const a = document.createElement("a"); a.href = url; a.download = name; a.click();
    URL.revokeObjectURL(url);
  };
  const doSaveOne = async () => {
    const d = getActive(); if (!d) return;
    setSaving(true);
    try { dl(await buildPdf(d), outName(d.name)); d.saved = true; tick(); }
    catch (e) { showAlert("Erro ao gerar", e.message); }
    finally { setSaving(false); }
  };
  const saveOne = () => {
    const d = getActive(); if (!d) return;
    const temCarimbo = Object.values(d.annotations).some((l) => l.some((a) => a.type === "stamp"));
    if (!temCarimbo)
      showConfirm("Salvar sem carimbo?",
        "Você não inseriu nenhum carimbo neste documento. Deseja salvar mesmo assim?",
        doSaveOne, { confirmText: "Salvar assim" });
    else doSaveOne();
  };
  const saveAll = async () => {
    const alvo = store.current.docs.filter((d) => Object.values(d.annotations).some((l) => l.length));
    if (!alvo.length) return;
    setSaving(true);
    try {
      const zip = new JSZip();
      for (const d of alvo) { zip.file(outName(d.name), await buildPdf(d)); d.saved = true; }
      const blob = await zip.generateAsync({ type: "blob" });
      dl(blob, "auditados.zip", "application/zip"); tick();
      setSidebarOpen(false);
    } catch (e) { showAlert("Erro ao compactar", e.message); }
    finally { setSaving(false); }
  };

  // ---- derivados ----
  const docs = store.current.docs;
  const marked = docs.filter((d) => Object.values(d.annotations).some((l) => l.length)).length;
  const pct = docs.length ? Math.round((marked / docs.length) * 100) : 0;
  const active = getActive();
  const hasMarks = active && (active.annotations[page] || []).length > 0;
  const statusOf = (d) => {
    if (d.saved) return ["Salvo", "bg-green-100 text-green-700"];
    if (Object.values(d.annotations).some((l) => l.length)) return ["Marcado", "bg-amber-100 text-amber-700"];
    return ["Pendente", "bg-slate-100 text-slate-500"];
  };

  const tools = [
    { id: "strike", label: "Traço", Icon: Pencil },
    { id: "text", label: "Texto", Icon: Type },
    { id: "highlight", label: "Destaque", Icon: Highlighter },
  ];

  return (
    <div className={"flex flex-col app-shell text-[var(--text)] select-none tema-" + tema}
      style={{ background: "var(--bg)" }}>
      {/* barra da marca */}
      <div className="flex items-center justify-between gap-2 px-3 md:px-4 py-2.5">
        <div className="flex items-center gap-2 md:gap-3 min-w-0">
          <img src={LOGO_MAIDA} alt="Maida" className="h-6 md:h-8" />
          <div className="flex flex-col leading-tight text-white min-w-0">
            <b className="text-sm md:text-base truncate">Painel de Auditoria</b>
            <span className="text-xs opacity-80 hidden sm:block">Auditoria médica — marcação de cortes em lote</span>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {/* abre a fila de documentos no mobile */}
          <button className="btn-tema md:hidden" onClick={() => setSidebarOpen(true)}>
            <Folder className="w-4 h-4" />
            Docs{docs.length ? ` (${docs.length})` : ""}
          </button>
          <button className="btn-tema" onClick={() => setTema(tema === "claro" ? "escuro" : "claro")}>
            {tema === "claro" ? <Moon className="w-4 h-4" /> : <Sun className="w-4 h-4" />}
            <span className="hidden sm:inline">{tema === "claro" ? "Escuro" : "Claro"}</span>
          </button>
        </div>
      </div>

      {/* toolbar (compacta no celular: só ícones, quebra linha se precisar) */}
      <header className="flex flex-wrap items-center gap-2 md:gap-3 px-2 md:px-4 py-2 bg-[var(--surface)] border-y border-[var(--border)] shadow-sm z-10">
        <div className="flex shrink-0 items-center gap-1.5 pr-2 md:pr-3 border-r border-[var(--border)]">
          {tools.map(({ id, label, Icon }) => (
            <button key={id} onClick={() => selectTool(id)} title={label}
              className={"flex items-center gap-1.5 px-2.5 md:px-3 py-2 rounded-lg text-sm border font-semibold transition-colors whitespace-nowrap " +
                (tool === id
                  ? "bg-[var(--accent)] border-[var(--accent)] text-[var(--accent-contrast)]"
                  : "bg-[var(--surface)] border-[var(--border)] text-[var(--text)] hover:bg-[var(--hover)]")}>
              <Icon className="w-4 h-4" /><span className="hidden sm:inline">{label}</span>
            </button>
          ))}
          <button onClick={() => { if (getActive()) setStampsOpen(true); }} title="Carimbo"
            disabled={!active}
            className={"flex items-center gap-1.5 px-2.5 md:px-3 py-2 rounded-lg text-sm border font-semibold transition-colors whitespace-nowrap disabled:opacity-40 " +
              (stampsOpen
                ? "bg-[var(--accent)] border-[var(--accent)] text-[var(--accent-contrast)]"
                : "bg-[var(--surface)] border-[var(--border)] text-[var(--text)] hover:bg-[var(--hover)]")}>
            <Stamp className="w-4 h-4" /><span className="hidden sm:inline">Carimbo</span>
          </button>
        </div>

        <div className="flex shrink-0 items-center gap-1.5 pr-2 md:pr-3 border-r border-[var(--border)]">
          <span className="text-xs uppercase tracking-wide text-[var(--muted)] hidden sm:inline">Cor</span>
          <label title="Escolher cor"
            className="w-8 h-8 rounded-md border flex items-center justify-center overflow-hidden ring-2 ring-[var(--accent)] border-[var(--accent)]">
            <input type="color" value={color} onChange={(e) => setColor(e.target.value)} className="color-input" />
          </label>
        </div>

        <div className="flex shrink-0 items-center gap-2 pr-2 md:pr-3 border-r border-[var(--border)]">
          <span className="text-xs uppercase tracking-wide text-[var(--muted)] hidden sm:inline">Espessura</span>
          <input type="range" min="1" max="5" step="0.5" value={thickness}
            onChange={(e) => setThickness(parseFloat(e.target.value))} className="w-16 md:w-20"
            style={{ accentColor: "var(--accent)" }} />
          <span className="text-xs text-[var(--muted)] w-5 text-center hidden sm:inline">{thickness}</span>
        </div>

        <div className="flex shrink-0 items-center gap-1.5 pr-2 md:pr-3 border-r border-[var(--border)]">
          <button onClick={undo} disabled={!hasMarks} title="Desfazer"
            className="flex items-center gap-1.5 px-2.5 md:px-3 py-2 rounded-lg text-sm border border-[var(--border)] bg-[var(--surface)] text-[var(--text)] hover:bg-[var(--hover)] disabled:opacity-40 whitespace-nowrap">
            <Undo2 className="w-4 h-4" /><span className="hidden sm:inline">Desfazer</span>
          </button>
          <button onClick={redoAction} disabled={redo.current.length === 0} title="Refazer"
            className="flex items-center gap-1.5 px-2.5 md:px-3 py-2 rounded-lg text-sm border border-[var(--border)] bg-[var(--surface)] text-[var(--text)] hover:bg-[var(--hover)] disabled:opacity-40 whitespace-nowrap">
            <Redo2 className="w-4 h-4" /><span className="hidden sm:inline">Refazer</span>
          </button>
          <button onClick={clearPage} disabled={!hasMarks} title="Limpar página"
            className="flex items-center gap-1.5 px-2.5 md:px-3 py-2 rounded-lg text-sm border border-[var(--border)] bg-[var(--surface)] text-[var(--text)] hover:bg-[var(--hover)] disabled:opacity-40 whitespace-nowrap">
            <Trash2 className="w-4 h-4" /><span className="hidden sm:inline">Limpar página</span>
          </button>
        </div>

        <button onClick={saveOne} disabled={!active || saving} title="Salvar este"
          className="flex shrink-0 items-center gap-1.5 px-2.5 md:px-3 py-2 rounded-lg text-sm font-semibold bg-[var(--accent)] text-[var(--accent-contrast)] hover:opacity-90 disabled:opacity-40 whitespace-nowrap">
          <Save className="w-4 h-4" /><span className="hidden sm:inline">Salvar este</span>
        </button>
      </header>

      <div className="flex flex-1 min-h-0 relative">
        {/* backdrop da gaveta (mobile) */}
        {sidebarOpen && (
          <div className="fixed inset-0 z-30 bg-black/50 md:hidden"
            onClick={() => setSidebarOpen(false)} />
        )}
        {/* sidebar: gaveta no mobile, fixa no desktop */}
        <aside className={
          "w-72 flex flex-col bg-[var(--surface)] border-r border-[var(--border)] " +
          "fixed inset-y-0 left-0 z-40 transform transition-transform duration-200 " +
          (sidebarOpen ? "translate-x-0 " : "-translate-x-full ") +
          "md:static md:translate-x-0 md:min-h-0 md:z-auto md:transform-none"
        }>
          <div className="p-3 border-b border-[var(--border)]">
            <div className="flex gap-2">
              <button onClick={() => fileRef.current.click()}
                className="flex-1 flex items-center justify-center gap-1.5 px-2 py-2 rounded-lg text-xs border border-[var(--border)] text-[var(--text)] hover:bg-[var(--hover)]">
                <FilePlus className="w-4 h-4" />PDFs
              </button>
              <button onClick={() => folderRef.current.click()}
                className="flex-1 flex items-center justify-center gap-1.5 px-2 py-2 rounded-lg text-xs border border-[var(--border)] text-[var(--text)] hover:bg-[var(--hover)]">
                <Folder className="w-4 h-4" />Pasta
              </button>
            </div>
            <input ref={fileRef} type="file" accept="application/pdf" multiple hidden
              onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }} />
            <input ref={folderRef} type="file" hidden
              onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }} />
            <div className="flex justify-between text-xs text-[var(--muted)] mt-2.5">
              <span>{docs.length ? `${marked} de ${docs.length} com marcação` : "0 documentos"}</span>
              <span>{docs.length ? pct + "%" : ""}</span>
            </div>
            <div className="h-1.5 bg-[var(--panel)] rounded-full mt-1.5 overflow-hidden">
              <div className="h-full transition-all" style={{ width: pct + "%", background: "var(--accent)" }} />
            </div>
          </div>

          <div className="flex-1 overflow-auto p-2 maida-scroll">
            {docs.map((d) => {
              const [txt, cls] = statusOf(d);
              return (
                <div key={d.id} onClick={() => selectDoc(d.id)}
                  className={"animated-card flex flex-col gap-1 p-2.5 rounded-xl cursor-pointer border " +
                    (d.id === activeId
                      ? "bg-[var(--panel)] border-[var(--accent)]"
                      : "border-transparent hover:bg-[var(--hover)]")}>
                  <div className="flex items-center justify-between gap-1">
                    <span className={"text-xs font-bold px-2 py-0.5 rounded-full uppercase " + cls}>{txt}</span>
                    <button onClick={(e) => { e.stopPropagation(); removeDoc(d.id); }}
                      title="Remover da fila"
                      className="w-7 h-7 flex items-center justify-center rounded-md text-[var(--muted)] hover:text-red-500 hover:bg-[var(--hover)]">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                  <span className="text-sm font-semibold truncate text-[var(--text)]">{d.name}</span>
                </div>
              );
            })}
          </div>

          <div className="p-3 border-t border-[var(--border)]">
            <button onClick={saveAll} disabled={marked === 0 || saving}
              className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-sm font-semibold bg-[var(--accent)] text-[var(--accent-contrast)] hover:opacity-90 disabled:opacity-40">
              <Download className="w-4 h-4" />Baixar todos auditados (.zip)
            </button>
          </div>
        </aside>

        {/* workspace */}
        <main ref={mainRef} className="flex-1 overflow-auto flex justify-center p-3 md:p-6 maida-scroll">
          {loadErr ? (
            <div className="m-auto max-w-md text-center text-red-500 text-sm">{loadErr}</div>
          ) : !ready ? (
            <div className="m-auto text-white/70 text-sm">Carregando bibliotecas…</div>
          ) : !active ? (
            <div className="m-auto max-w-md text-center text-[var(--text)]">
              <div className="border-2 border-dashed border-[var(--border)] rounded-xl p-10 bg-[var(--surface)]">
                <h2 className="text-lg text-[var(--text)] font-semibold mb-2">Nenhum documento na fila</h2>
                <p className="text-sm leading-relaxed text-[var(--muted)]">Clique em <b>PDFs</b> (ou <b>Pasta</b>) para carregar os arquivos.</p>
                <p className="text-sm leading-relaxed mt-3 text-[var(--muted)]">
                  Depois <b>arraste o traço</b> sobre cada procedimento a auditar e clique em <b>Salvar este</b>.
                  No fim, <b>baixe todos</b> num .zip.
                </p>
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-3">
              <div ref={wrapRef} className="relative bg-white shadow rounded" style={{ lineHeight: 0 }}>
                <canvas ref={baseRef} className="block rounded" />
                <canvas ref={overlayRef} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp}
                  onPointerCancel={onUp} onDoubleClick={onDblClick}
                  className="absolute top-0 left-0 rounded"
                  style={{ cursor: tool === "text" ? "text" : (tool === "strike" || tool === "highlight") ? "crosshair" : "grab", touchAction: "none" }} />
                {/* camada de caixas de texto e carimbos (pointer-events só nos elementos) */}
                <div className="absolute top-0 left-0 w-full h-full" style={{ pointerEvents: "none" }}>
                  {(active.annotations[page] || [])
                    .filter((a) => a.type === "text" || a.type === "stamp")
                    .map((a) => a.type === "stamp" ? (
                      <StampBox
                        key={a.id}
                        a={a}
                        scale={scale}
                        selected={selectedId === a.id}
                        interactive={tool !== "strike" && tool !== "highlight"}
                        onMove={(x, y) => moveText(a.id, x, y)}
                        onResize={(w, h) => resizeStamp(a.id, w, h)}
                        onSelect={() => setSelectedId(a.id)}
                        onDelete={() => deleteText(a.id)}
                        onDuplicate={() => duplicateAnn(a.id)}
                      />
                    ) : (
                      <TextBox
                        key={a.id}
                        a={a}
                        scale={scale}
                        editing={editingId === a.id}
                        selected={selectedId === a.id}
                        interactive={tool !== "strike" && tool !== "highlight"}
                        onChange={(t) => updateText(a.id, t)}
                        onMove={(x, y) => moveText(a.id, x, y)}
                        onResize={(s) => resizeText(a.id, s)}
                        onMeasure={(w, h) => measureText(a.id, w, h)}
                        onStartEdit={() => startEditText(a.id)}
                        onEndEdit={() => endEditText(a.id)}
                        onSelect={() => setSelectedId(a.id)}
                        onDelete={() => deleteText(a.id)}
                        onCancel={() => cancelText(a.id)}
                        onDuplicate={() => duplicateAnn(a.id)}
                      />
                    ))}
                </div>
              </div>
            </div>
          )}
        </main>
      </div>

      {/* diálogo customizado (alert/confirm) */}
      {dialog && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/50" onClick={() => setDialog(null)} />
          <div className="relative bg-[var(--surface)] rounded-xl shadow-2xl p-5 w-full max-w-sm border border-[var(--border)]">
            <b className="text-[var(--text)] block mb-2">{dialog.title}</b>
            <p className="text-sm text-[var(--muted)] mb-4 leading-relaxed">{dialog.message}</p>
            <div className="flex justify-end gap-2">
              {!dialog.alert && (
                <button onClick={() => setDialog(null)}
                  className="px-3 py-2 rounded-lg text-sm border border-[var(--border)] text-[var(--text)] hover:bg-[var(--hover)]">
                  Cancelar
                </button>
              )}
              <button onClick={() => { const cb = dialog.onConfirm; setDialog(null); if (cb) cb(); }}
                className="px-3 py-2 rounded-lg text-sm font-semibold bg-[var(--accent)] text-[var(--accent-contrast)] hover:opacity-90">
                {dialog.alert ? "OK" : dialog.confirmText}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* painel de carimbos */}
      {stampsOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/50" onClick={() => setStampsOpen(false)} />
          <div className="relative bg-[var(--surface)] rounded-xl shadow-2xl p-4 w-full max-w-md max-h-[80vh] overflow-auto maida-scroll border border-[var(--border)]">
            <div className="flex items-center justify-between mb-3">
              <b className="text-[var(--text)]">Escolha o seu carimbo</b>
              <button onClick={() => setStampsOpen(false)} title="Fechar"
                className="w-8 h-8 flex items-center justify-center rounded-md text-[var(--muted)] hover:bg-[var(--hover)]">
                <X className="w-4 h-4" />
              </button>
            </div>
            {allStamps.length === 0 && (
              <p className="text-sm text-[var(--muted)] mb-3 leading-relaxed">
                Nenhum carimbo neste dispositivo ainda. Clique em <b>Adicionar carimbo</b> e
                escolha a imagem (PNG) do seu carimbo — ela fica salva <b>somente neste navegador</b>,
                não é enviada para nenhum servidor.
              </p>
            )}
            <div className="grid grid-cols-2 gap-2 mb-3">
              {allStamps.map((s) => (
                <div key={s.key}
                  onClick={(e) => {
                    const img = e.currentTarget.querySelector("img");
                    addStamp(s, img && img.naturalWidth ? img.naturalHeight / img.naturalWidth : 0.4);
                  }}
                  className="relative border border-[var(--border)] rounded-lg p-2 cursor-pointer bg-white hover:border-[var(--accent)] hover:shadow">
                  <img src={s.url} alt={s.nome} draggable={false} onContextMenu={(e) => e.preventDefault()}
                    className="w-full h-16 object-contain pointer-events-none" />
                  <div className="text-xs font-bold text-center mt-1.5 truncate text-slate-800">{s.nome}</div>
                  {s.local && (
                    <button onClick={(ev) => { ev.stopPropagation(); removeUserStamp(s.key); }}
                      title="Remover deste dispositivo"
                      className="absolute -top-2 -right-2 w-6 h-6 rounded-full bg-red-600 text-white text-xs shadow">
                      ×
                    </button>
                  )}
                </div>
              ))}
            </div>
            <button onClick={() => stampFileRef.current.click()}
              className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-sm border border-[var(--border)] text-[var(--text)] hover:bg-[var(--hover)]">
              <FilePlus className="w-4 h-4" />Adicionar carimbo (fica só neste dispositivo)
            </button>
            <input ref={stampFileRef} type="file" accept="image/png,image/jpeg" hidden
              onChange={(e) => { const f = e.target.files[0]; if (f) addUserStamp(f); e.target.value = ""; }} />
          </div>
        </div>
      )}

      {/* footer */}
      <footer className="app-footer flex flex-wrap items-center justify-center gap-2 md:gap-3 px-2 md:px-4 py-1.5 bg-[var(--surface)] border-t border-[var(--border)] text-xs text-[var(--muted)]">
        <span className="truncate max-w-xs hidden md:block">{active ? active.name : "—"}</span>
        <div className="flex-1 hidden md:block" />
        <div className="flex items-center gap-1.5">
          <button onClick={prevPage} disabled={!active || page <= 1}
            className="px-3 py-1.5 md:px-2.5 md:py-1 rounded-md border border-[var(--border)] text-[var(--text)] hover:bg-[var(--hover)] disabled:opacity-40"><ChevronLeft className="w-4 h-4" /></button>
          <span className="w-24 text-center">Página {active ? page : 0} / {active ? active.numPages : 0}</span>
          <button onClick={nextPage} disabled={!active || page >= (active ? active.numPages : 0)}
            className="px-3 py-1.5 md:px-2.5 md:py-1 rounded-md border border-[var(--border)] text-[var(--text)] hover:bg-[var(--hover)] disabled:opacity-40"><ChevronRight className="w-4 h-4" /></button>
        </div>
        <div className="flex-1 hidden md:block" />
        <div className="flex items-center gap-1.5">
          <button onClick={() => setScale((s) => Math.max(0.5, s - 0.15))} disabled={!active}
            className="px-3 py-1.5 md:px-2.5 md:py-1 rounded-md border border-[var(--border)] text-[var(--text)] hover:bg-[var(--hover)] disabled:opacity-40"><Minus className="w-4 h-4" /></button>
          <span className="w-12 text-center">{Math.round(scale * 100)}%</span>
          <button onClick={() => setScale((s) => Math.min(3, s + 0.15))} disabled={!active}
            className="px-3 py-1.5 md:px-2.5 md:py-1 rounded-md border border-[var(--border)] text-[var(--text)] hover:bg-[var(--hover)] disabled:opacity-40"><Plus className="w-4 h-4" /></button>
        </div>
      </footer>
    </div>
  );
}
