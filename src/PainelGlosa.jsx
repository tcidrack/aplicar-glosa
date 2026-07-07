import { useState, useRef, useEffect, useReducer } from "react";
import {
  FilePlus, Folder, Undo2, Trash2, Save, Download,
  ChevronLeft, ChevronRight, Minus, Plus, Pencil, Type, Highlighter,
  Moon, Sun,
} from "lucide-react";
import "./PainelGlosa.css";

// bibliotecas auto-hospedadas (empacotadas no bundle — sem CDN de terceiros)
import * as pdfjsLib from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.js?url";
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import JSZip from "jszip";
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

const LOGO_MAIDA =
  "https://maida.health/wp-content/themes/melhortema/assets/images/logo-light.svg";

const COLORS = [
  "#d92d20", "#f97316", "#facc15", "#22c55e",
  "#1f6feb", "#8b5cf6", "#FF0073", "#111827",
];

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
  onResize, onMeasure, onStartEdit, onEndEdit, onSelect, onDelete, onCancel }) {
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

export default function PainelGlosa() {
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
  const drawing = useRef(false);
  const startPt = useRef(null);

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
      ctx.fillStyle = "rgba(255,214,0,.38)"; ctx.fillRect(x, y, w, h);
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

  // ---- desenho ----
  const onDown = (e) => {
    const doc = getActive(); if (!doc) return;
    const p = toDoc(e);
    if (tool === "text") {
      if (editingId) return;   // já há uma caixa em edição: não cria outra (o blur finaliza)
      addText(p); return;
    }
    setSelectedId(null);
    if (tool !== "strike" && tool !== "highlight") return; // modo neutro: só deseleciona
    drawing.current = true; startPt.current = p;
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onMove = (e) => {
    if (!drawing.current) return;
    const p = toDoc(e), s = startPt.current;
    const prev = tool === "strike"
      ? { type: "strike", x1: s.x, y1: s.y, x2: p.x, y2: p.y, color, thickness }
      : { type: "highlight", x1: s.x, y1: s.y, x2: p.x, y2: p.y };
    drawOverlay(prev);
  };
  const onUp = (e) => {
    if (!drawing.current) return;
    drawing.current = false;
    const p = toDoc(e), s = startPt.current, doc = getActive();
    if (Math.hypot(p.x - s.x, p.y - s.y) > 3) {
      const a = tool === "strike"
        ? { type: "strike", x1: s.x, y1: s.y, x2: p.x, y2: p.y, color, thickness }
        : { type: "highlight", x1: s.x, y1: s.y, x2: p.x, y2: p.y };
      (doc.annotations[page] = doc.annotations[page] || []).push(a);
      doc.saved = false; tick();
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
    (doc.annotations[page] = doc.annotations[page] || []).push({
      type: "text", id, x: p.x, y: p.y, text: "", size: 16, color, w: 120, h: 24,
    });
    doc.saved = false; editOrig.current = "";
    setSelectedId(id); setEditingId(id); tick();
  };
  // abre uma caixa no centro da página visível (usado ao clicar na ferramenta Texto)
  const addTextCenter = () => {
    const b = baseRef.current; if (!b) return;
    addText({ x: (b.width / scale) / 2 - 45, y: (b.height / scale) * 0.15 });
  };
  // seleciona ferramenta; ao escolher Texto já abre uma caixinha pronta pra editar
  const selectTool = (id) => {
    setTool(id);
    setSelectedId(null);
    if (id === "text" && getActive()) addTextCenter();
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
  const undo = () => {
    const d = getActive(); const l = d && d.annotations[page];
    if (l && l.length) { l.pop(); drawOverlay(); tick(); }
  };
  const clearPage = () => {
    const d = getActive();
    if (d && (d.annotations[page] || []).length &&
        window.confirm("Remover todas as marcações desta página?")) {
      d.annotations[page] = []; drawOverlay(); tick();
    }
  };
  const prevPage = () => { if (page > 1) { const d = getActive(); d.page = page - 1; setPage(page - 1); } };
  const nextPage = () => { const d = getActive(); if (d && page < d.numPages) { d.page = page + 1; setPage(page + 1); } };

  // atalhos de teclado (lê versão atual via ref)
  const kb = useRef({});
  kb.current = { undo, prevPage, nextPage, deleteText, editingId, selectedId };
  useEffect(() => {
    const h = (e) => {
      // não interferir enquanto o usuário digita num campo
      const t = e.target;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if ((e.key === "Delete" || e.key === "Backspace") && kb.current.selectedId && !kb.current.editingId) {
        e.preventDefault(); kb.current.deleteText(kb.current.selectedId); return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") { e.preventDefault(); kb.current.undo(); }
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
    const form = out.getForm();
    const pages = out.getPages();
    let fi = 0;
    for (const [pg, list] of Object.entries(d.annotations)) {
      const pageObj = pages[pg - 1]; if (!pageObj) continue;
      const H = pageObj.getHeight();
      for (const a of list) {
        if (a.type === "strike")
          pageObj.drawLine({ start: { x: a.x1, y: H - a.y1 }, end: { x: a.x2, y: H - a.y2 }, thickness: a.thickness, color: hexRgb(a.color) });
        else if (a.type === "highlight") {
          const x = Math.min(a.x1, a.x2), w = Math.abs(a.x2 - a.x1);
          const yTop = Math.min(a.y1, a.y2), h = Math.abs(a.y2 - a.y1);
          pageObj.drawRectangle({ x, y: H - yTop - h, width: w, height: h, color: rgb(1, 0.84, 0), opacity: 0.38 });
        } else if (a.type === "text") {
          // campo de formulário editável (o destinatário pode alterar no leitor de PDF)
          const tf = form.createTextField(`glosa_${pg}_${fi++}`);
          tf.setText(a.text || "");
          tf.setFontSize(a.size);
          const w = a.w || (a.size * ((a.text ? a.text.length : 4)) * 0.55);
          const h = a.h || (a.size * 1.5);
          tf.addToPage(pageObj, {
            x: a.x, y: H - a.y - h, width: w, height: h,
            textColor: hexRgb(a.color), borderWidth: 0,
          });
        }
      }
    }
    try { form.updateFieldAppearances(font); } catch { /* usa aparência padrão */ }
    return out.save();
  };
  const outName = (n) => n.replace(/\.pdf$/i, "") + " - GLOSADO.pdf";
  const dl = (bytes, name, type = "application/pdf") => {
    const url = URL.createObjectURL(new Blob([bytes], { type }));
    const a = document.createElement("a"); a.href = url; a.download = name; a.click();
    URL.revokeObjectURL(url);
  };
  const saveOne = async () => {
    const d = getActive(); if (!d) return;
    setSaving(true);
    try { dl(await buildPdf(d), outName(d.name)); d.saved = true; tick(); }
    catch (e) { alert("Erro ao gerar: " + e.message); }
    finally { setSaving(false); }
  };
  const saveAll = async () => {
    const alvo = store.current.docs.filter((d) => Object.values(d.annotations).some((l) => l.length));
    if (!alvo.length) return;
    setSaving(true);
    try {
      const zip = new JSZip();
      for (const d of alvo) { zip.file(outName(d.name), await buildPdf(d)); d.saved = true; }
      const blob = await zip.generateAsync({ type: "blob" });
      dl(blob, "glosados.zip", "application/zip"); tick();
      setSidebarOpen(false);
    } catch (e) { alert("Erro ao compactar: " + e.message); }
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

  const isCustom = !COLORS.includes(color);

  return (
    <div className={"flex flex-col h-screen text-[var(--text)] select-none tema-" + tema}
      style={{ background: "var(--bg)" }}>
      {/* barra da marca */}
      <div className="flex items-center justify-between gap-2 px-3 md:px-4 py-2.5">
        <div className="flex items-center gap-2 md:gap-3 min-w-0">
          <img src={LOGO_MAIDA} alt="Maida" className="h-6 md:h-8" />
          <div className="flex flex-col leading-tight text-white min-w-0">
            <b className="text-sm md:text-base truncate">Painel de Glosa</b>
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

      {/* toolbar (rolável na horizontal no celular) */}
      <header className="flex flex-nowrap overflow-x-auto md:flex-wrap md:overflow-visible items-center gap-3 px-3 md:px-4 py-2 bg-[var(--surface)] border-y border-[var(--border)] shadow-sm z-10 maida-scroll">
        <div className="flex shrink-0 items-center gap-1.5 pr-3 border-r border-[var(--border)]">
          {tools.map(({ id, label, Icon }) => (
            <button key={id} onClick={() => selectTool(id)}
              className={"flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm border font-semibold transition-colors whitespace-nowrap " +
                (tool === id
                  ? "bg-[var(--accent)] border-[var(--accent)] text-[var(--accent-contrast)]"
                  : "bg-[var(--surface)] border-[var(--border)] text-[var(--text)] hover:bg-[var(--hover)]")}>
              <Icon className="w-4 h-4" />{label}
            </button>
          ))}
        </div>

        <div className="flex shrink-0 items-center gap-1.5 pr-3 border-r border-[var(--border)]">
          <span className="text-xs uppercase tracking-wide text-[var(--muted)]">Cor</span>
          {COLORS.map((c) => (
            <button key={c} onClick={() => setColor(c)}
              className={"w-7 h-7 rounded-md border flex items-center justify-center " +
                (color === c ? "ring-2 ring-[var(--accent)] border-[var(--accent)]" : "border-[var(--border)]")}>
              <span className="w-3.5 h-3.5 rounded" style={{ background: c }} />
            </button>
          ))}
          <label title="Cor personalizada"
            className={"w-7 h-7 rounded-md border flex items-center justify-center overflow-hidden " +
              (isCustom ? "ring-2 ring-[var(--accent)] border-[var(--accent)]" : "border-[var(--border)]")}>
            <input type="color" value={color} onChange={(e) => setColor(e.target.value)} className="color-input" />
          </label>
        </div>

        <div className="flex shrink-0 items-center gap-2 pr-3 border-r border-[var(--border)]">
          <span className="text-xs uppercase tracking-wide text-[var(--muted)]">Espessura</span>
          <input type="range" min="1" max="5" step="0.5" value={thickness}
            onChange={(e) => setThickness(parseFloat(e.target.value))} className="w-20"
            style={{ accentColor: "var(--accent)" }} />
          <span className="text-xs text-[var(--muted)] w-5 text-center">{thickness}</span>
        </div>

        <div className="flex shrink-0 items-center gap-1.5 pr-3 border-r border-[var(--border)]">
          <button onClick={undo} disabled={!hasMarks}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm border border-[var(--border)] bg-[var(--surface)] text-[var(--text)] hover:bg-[var(--hover)] disabled:opacity-40 whitespace-nowrap">
            <Undo2 className="w-4 h-4" />Desfazer
          </button>
          <button onClick={clearPage} disabled={!hasMarks}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm border border-[var(--border)] bg-[var(--surface)] text-[var(--text)] hover:bg-[var(--hover)] disabled:opacity-40 whitespace-nowrap">
            <Trash2 className="w-4 h-4" />Limpar página
          </button>
        </div>

        <button onClick={saveOne} disabled={!active || saving}
          className="flex shrink-0 items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-semibold bg-[var(--accent)] text-[var(--accent-contrast)] hover:opacity-90 disabled:opacity-40 whitespace-nowrap">
          <Save className="w-4 h-4" />Salvar este
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
              onChange={(e) => addFiles(e.target.files)} />
            <input ref={folderRef} type="file" hidden onChange={(e) => addFiles(e.target.files)} />
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
                  <span className={"self-start text-xs font-bold px-2 py-0.5 rounded-full uppercase " + cls}>{txt}</span>
                  <span className="text-sm font-semibold truncate text-[var(--text)]">{d.name}</span>
                </div>
              );
            })}
          </div>

          <div className="p-3 border-t border-[var(--border)]">
            <button onClick={saveAll} disabled={marked === 0 || saving}
              className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-sm font-semibold bg-[var(--accent)] text-[var(--accent-contrast)] hover:opacity-90 disabled:opacity-40">
              <Download className="w-4 h-4" />Baixar todos glosados (.zip)
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
                  Depois <b>arraste o traço</b> sobre cada procedimento a glosar e clique em <b>Salvar este</b>.
                  No fim, <b>baixe todos</b> num .zip.
                </p>
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-3">
              <div ref={wrapRef} className="relative bg-white shadow rounded" style={{ lineHeight: 0 }}>
                <canvas ref={baseRef} className="block rounded" />
                <canvas ref={overlayRef} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp}
                  className="absolute top-0 left-0 rounded"
                  style={{ cursor: tool === "text" ? "text" : (tool === "strike" || tool === "highlight") ? "crosshair" : "default", touchAction: "none" }} />
                {/* camada de caixas de texto (pointer-events só nas caixas) */}
                <div className="absolute top-0 left-0 w-full h-full" style={{ pointerEvents: "none" }}>
                  {(active.annotations[page] || [])
                    .filter((a) => a.type === "text")
                    .map((a) => (
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
                      />
                    ))}
                </div>
              </div>
            </div>
          )}
        </main>
      </div>

      {/* footer */}
      <footer className="flex flex-wrap items-center justify-center gap-2 md:gap-3 px-2 md:px-4 py-1.5 bg-[var(--surface)] border-t border-[var(--border)] text-xs text-[var(--muted)]">
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
