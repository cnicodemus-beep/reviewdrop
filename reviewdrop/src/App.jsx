import { useState, useEffect, useRef } from 'react'
import { supabase, getProjects, upsertProject, deleteProject as dbDeleteProject,
  uploadPage, getPageUrl,
  getComments, addComment, updateComment, deleteComment,
  subscribeToComments, getAllProjectComments,
} from './supabase.js'

// ─── Design tokens (Clearstory-inspired) ─────────────────────────────────────
const T = {
  bg:        '#F7F8FA',
  surface:   '#FFFFFF',
  border:    '#E4E7EC',
  borderHov: '#B0BAC9',
  text:      '#111827',
  textSub:   '#6B7280',
  textMuted: '#9CA3AF',
  primary:   '#0D7C66',   // teal-green
  primaryHov:'#0A6655',
  primaryBg: '#E8F5F2',
  danger:    '#DC2626',
  dangerBg:  '#FEF2F2',
  success:   '#059669',
  successBg: '#ECFDF5',
  warning:   '#D97706',
  warningBg: '#FFFBEB',
  navy:      '#0F172A',
  shadow:    '0 1px 3px rgba(0,0,0,0.08), 0 1px 2px rgba(0,0,0,0.04)',
  shadowMd:  '0 4px 12px rgba(0,0,0,0.08), 0 2px 4px rgba(0,0,0,0.04)',
  shadowLg:  '0 20px 40px rgba(0,0,0,0.12)',
  radius:    '8px',
  radiusLg:  '12px',
}

const COLORS = [
  { bg: '#0D7C66', label: 'Teal' },
  { bg: '#2563EB', label: 'Blue' },
  { bg: '#7C3AED', label: 'Purple' },
  { bg: '#DC2626', label: 'Red' },
  { bg: '#D97706', label: 'Amber' },
]

// ─── Helpers ──────────────────────────────────────────────────────────────────
function makeProjectKey(file) {
  return file.name.replace(/[^a-z0-9]/gi, '-').toLowerCase().slice(0, 40) + '-' + file.size
}

async function renderPDF(file) {
  if (!window.pdfjsLib) {
    await new Promise((res, rej) => {
      const s = document.createElement('script')
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js'
      s.onload = res; s.onerror = rej
      document.head.appendChild(s)
    })
    window.pdfjsLib.GlobalWorkerOptions.workerSrc =
      'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js'
  }
  const buf = await file.arrayBuffer()
  const pdf = await window.pdfjsLib.getDocument({ data: buf }).promise
  const pages = []
  for (let i = 1; i <= pdf.numPages; i++) {
    const pg = await pdf.getPage(i)
    const vp = pg.getViewport({ scale: 2 })
    const canvas = document.createElement('canvas')
    canvas.width = vp.width; canvas.height = vp.height
    await pg.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise
    pages.push(canvas.toDataURL('image/jpeg', 0.85))
  }
  return pages
}

// ─── Btn component ────────────────────────────────────────────────────────────
function Btn({ children, onClick, variant = 'primary', size = 'md', disabled, style = {} }) {
  const [hov, setHov] = useState(false)
  const base = {
    border: 'none', cursor: disabled ? 'default' : 'pointer', fontWeight: 600,
    borderRadius: T.radius, transition: 'all 0.15s', display: 'inline-flex',
    alignItems: 'center', gap: 6, whiteSpace: 'nowrap', fontFamily: 'inherit',
    opacity: disabled ? 0.5 : 1,
  }
  const sizes = { sm: { padding: '5px 12px', fontSize: 12 }, md: { padding: '8px 16px', fontSize: 13 }, lg: { padding: '10px 20px', fontSize: 14 } }
  const variants = {
    primary:  { background: hov ? T.primaryHov : T.primary, color: '#fff' },
    secondary:{ background: hov ? T.border : T.surface, color: T.text, border: `1px solid ${T.border}` },
    ghost:    { background: hov ? T.bg : 'transparent', color: T.textSub },
    danger:   { background: hov ? '#B91C1C' : T.danger, color: '#fff' },
  }
  return (
    <button onClick={disabled ? undefined : onClick} disabled={disabled}
      onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}
      style={{ ...base, ...sizes[size], ...variants[variant], ...style }}>
      {children}
    </button>
  )
}

// ─── Badge ────────────────────────────────────────────────────────────────────
function Badge({ children, color = 'gray' }) {
  const colors = {
    red:   { background: T.dangerBg,  color: T.danger },
    green: { background: T.successBg, color: T.success },
    gray:  { background: T.bg,        color: T.textSub },
    teal:  { background: T.primaryBg, color: T.primary },
  }
  return (
    <span style={{ ...colors[color], fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 20, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      {children}
    </span>
  )
}

// ─── Project Card ─────────────────────────────────────────────────────────────
function ProjectCard({ project, onOpen, onDelete }) {
  const [hov, setHov] = useState(false)
  return (
    <div onClick={() => onOpen(project)}
      onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}
      style={{ background: T.surface, borderRadius: T.radiusLg, border: `1px solid ${hov ? T.borderHov : T.border}`, overflow: 'hidden', cursor: 'pointer', transition: 'all 0.15s', boxShadow: hov ? T.shadowMd : T.shadow, transform: hov ? 'translateY(-2px)' : 'none', position: 'relative', display: 'flex', flexDirection: 'column' }}>

      {/* Thumbnail */}
      <div style={{ height: 148, background: T.bg, overflow: 'hidden', position: 'relative', flexShrink: 0 }}>
        {project.thumbnail_url
          ? <img src={project.thumbnail_url} alt={project.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          : <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 40, color: T.textMuted }}>{project.type === 'pdf' ? '📄' : '🖼️'}</div>
        }
        <div style={{ position: 'absolute', top: 10, left: 10 }}>
          <Badge color="gray">{project.type === 'pdf' ? `PDF · ${project.page_count}p` : 'Image'}</Badge>
        </div>
      </div>

      {/* Info */}
      <div style={{ padding: '12px 14px', flex: 1 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: T.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginBottom: 8 }}>
          {project.name}
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 12, color: T.textMuted }}>{new Date(project.uploaded_at).toLocaleDateString()}</span>
          <div style={{ display: 'flex', gap: 5 }}>
            {project.open_count > 0 && <Badge color="red">{project.open_count} open</Badge>}
            {project.resolved_count > 0 && <Badge color="green">{project.resolved_count} done</Badge>}
            {!project.open_count && !project.resolved_count && <span style={{ fontSize: 11, color: T.textMuted }}>No comments</span>}
          </div>
        </div>
      </div>

      {/* Delete */}
      {hov && (
        <button onClick={e => { e.stopPropagation(); onDelete(project.key) }}
          style={{ position: 'absolute', top: 10, right: 10, width: 28, height: 28, borderRadius: 6, background: 'rgba(255,255,255,0.95)', border: `1px solid ${T.border}`, color: T.danger, cursor: 'pointer', fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: T.shadow }}>
          ×
        </button>
      )}
    </div>
  )
}

// ─── Main App ─────────────────────────────────────────────────────────────────
export default function App() {
  const [view, setView] = useState('gallery')
  const [projects, setProjects] = useState([])
  const [activeProject, setActiveProject] = useState(null)
  const [pageUrls, setPageUrls] = useState([])
  const [currentPage, setCurrentPage] = useState(0)
  const [comments, setComments] = useState([])
  const [placing, setPlacing] = useState(false)
  const [pending, setPending] = useState(null)
  const [form, setForm] = useState({ author: '', text: '', color: 0 })
  const [selected, setSelected] = useState(null)
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState('')
  const [showList, setShowList] = useState(false)
  const imgRef = useRef()
  const fileRef = useRef()
  const realtimeRef = useRef()

  useEffect(() => { loadProjects() }, [])

  useEffect(() => {
    if (!activeProject) return
    loadComments()
    if (realtimeRef.current) realtimeRef.current.unsubscribe()
    realtimeRef.current = subscribeToComments(activeProject.key, currentPage, () => loadComments())
    return () => { if (realtimeRef.current) realtimeRef.current.unsubscribe() }
  }, [activeProject, currentPage])

  async function loadProjects() {
    try { setProjects((await getProjects()) || []) } catch (e) { console.error(e) }
  }

  async function loadComments() {
    if (!activeProject) return
    try { setComments((await getComments(activeProject.key, currentPage)) || []) } catch (e) { console.error(e) }
  }

  async function handleFile(e) {
    const file = e.target.files[0]; if (!file) return
    setUploading(true); setUploadProgress('Reading file…')
    try {
      const isPDF = file.type === 'application/pdf'
      const key = makeProjectKey(file)
      const name = file.name.replace(/\.[^.]+$/, '')
      let dataUrls = []
      if (isPDF) {
        setUploadProgress('Rendering PDF pages…')
        dataUrls = await renderPDF(file)
      } else {
        dataUrls = await new Promise(res => {
          const r = new FileReader()
          r.onload = ev => res([ev.target.result])
          r.readAsDataURL(file)
        })
      }
      const uploadedUrls = []
      for (let i = 0; i < dataUrls.length; i++) {
        setUploadProgress(`Uploading page ${i + 1} of ${dataUrls.length}…`)
        uploadedUrls.push(await uploadPage(key, i, dataUrls[i]))
      }
      const project = { key, name, type: isPDF ? 'pdf' : 'image', page_count: dataUrls.length, thumbnail_url: uploadedUrls[0], open_count: 0, resolved_count: 0, uploaded_at: new Date().toISOString() }
      setUploadProgress('Saving…')
      await upsertProject(project)
      await loadProjects()
      setPageUrls(uploadedUrls); setActiveProject(project); setCurrentPage(0)
      setComments([]); setSelected(null); setPending(null); setPlacing(false); setShowList(false)
      setView('review')
    } catch (err) { alert('Upload failed: ' + err.message) }
    finally { setUploading(false); setUploadProgress(''); e.target.value = '' }
  }

  async function openProject(project) {
    setLoading(true); setActiveProject(project); setCurrentPage(0)
    setComments([]); setSelected(null); setPending(null); setPlacing(false); setShowList(false)
    const urls = []
    for (let i = 0; i < project.page_count; i++) urls.push(getPageUrl(project.key, i))
    setPageUrls(urls); setView('review'); setLoading(false)
  }

  async function handleDeleteProject(key) {
    if (!confirm('Delete this project and all its comments?')) return
    try {
      await dbDeleteProject(key); await loadProjects()
      if (activeProject?.key === key) { setActiveProject(null); setView('gallery') }
    } catch (e) { alert('Failed to delete: ' + e.message) }
  }

  function handleImageClick(e) {
    if (!placing) return
    const rect = imgRef.current.getBoundingClientRect()
    setPending({ x: ((e.clientX - rect.left) / rect.width) * 100, y: ((e.clientY - rect.top) / rect.height) * 100 })
    setPlacing(false)
  }

  async function dropComment() {
    if (!form.author.trim() || !form.text.trim() || !pending) return
    setSaving(true)
    try {
      const c = await addComment({ project_key: activeProject.key, page: currentPage, x: pending.x, y: pending.y, author: form.author.trim(), text: form.text.trim(), color: COLORS[form.color].bg, resolved: false })
      setPending(null); setForm(f => ({ ...f, text: '' })); setSelected(c)
      await updateProjectCounts(activeProject.key)
    } catch (e) { alert('Failed to save: ' + e.message) }
    setSaving(false)
  }

  async function handleResolve(comment) {
    try {
      await updateComment(comment.id, { resolved: !comment.resolved })
      await loadComments(); await updateProjectCounts(activeProject.key)
      setSelected(c => c?.id === comment.id ? { ...c, resolved: !c.resolved } : c)
    } catch (e) { alert('Failed to update: ' + e.message) }
  }

  async function handleDelete(id) {
    try { await deleteComment(id); setSelected(null); await updateProjectCounts(activeProject.key) }
    catch (e) { alert('Failed to delete: ' + e.message) }
  }

  async function updateProjectCounts(projectKey) {
    const all = await getAllProjectComments(projectKey)
    const open_count = all.filter(c => !c.resolved).length
    const resolved_count = all.filter(c => c.resolved).length
    await supabase.from('projects').update({ open_count, resolved_count }).eq('key', projectKey)
    setProjects(prev => prev.map(p => p.key === projectKey ? { ...p, open_count, resolved_count } : p))
  }

  const open = comments.filter(c => !c.resolved)
  const done = comments.filter(c => c.resolved)

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div style={{ fontFamily: "'Inter', system-ui, sans-serif", height: '100vh', display: 'flex', flexDirection: 'column', background: T.bg, color: T.text }}>

      {/* ── Header ── */}
      <header style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '0 20px', background: T.surface, borderBottom: `1px solid ${T.border}`, flexShrink: 0, height: 56, boxShadow: T.shadow }}>

        {/* Logo */}
        <button onClick={() => setView('gallery')}
          style={{ display: 'flex', alignItems: 'center', gap: 8, border: 'none', background: 'none', cursor: 'pointer', padding: 0 }}>
          <div style={{ width: 28, height: 28, borderRadius: 7, background: T.primary, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontWeight: 800, fontSize: 14 }}>R</div>
          <span style={{ fontWeight: 700, fontSize: 16, color: T.navy, letterSpacing: -0.3 }}>ReviewDrop</span>
        </button>

        {/* Divider */}
        <div style={{ width: 1, height: 24, background: T.border }} />

        {/* Nav */}
        <nav style={{ display: 'flex', gap: 2 }}>
          {[{ id: 'gallery', label: '🗂 Projects', count: projects.length }].concat(
            activeProject ? [{ id: 'review', label: '✏️ Review' }] : []
          ).map(item => (
            <button key={item.id} onClick={() => setView(item.id)}
              style={{ padding: '6px 12px', borderRadius: T.radius, background: view === item.id ? T.primaryBg : 'transparent', color: view === item.id ? T.primary : T.textSub, border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: view === item.id ? 600 : 500, display: 'flex', alignItems: 'center', gap: 6 }}>
              {item.label}
              {item.count > 0 && <span style={{ background: T.border, color: T.textSub, borderRadius: 10, padding: '0 6px', fontSize: 11 }}>{item.count}</span>}
            </button>
          ))}
        </nav>

        {/* Breadcrumb in review */}
        {view === 'review' && activeProject && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 4 }}>
            <span style={{ color: T.textMuted }}>›</span>
            <span style={{ fontSize: 13, fontWeight: 600, color: T.text, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{activeProject.name}</span>
            {pageUrls.length > 1 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginLeft: 4 }}>
                <button onClick={() => { setCurrentPage(p => Math.max(0, p - 1)); setSelected(null) }} disabled={currentPage === 0}
                  style={{ padding: '3px 8px', borderRadius: 6, background: T.bg, border: `1px solid ${T.border}`, color: currentPage === 0 ? T.textMuted : T.text, cursor: currentPage === 0 ? 'default' : 'pointer', fontSize: 12 }}>‹</button>
                <span style={{ fontSize: 12, color: T.textSub, minWidth: 50, textAlign: 'center' }}>{currentPage + 1} / {pageUrls.length}</span>
                <button onClick={() => { setCurrentPage(p => Math.min(pageUrls.length - 1, p + 1)); setSelected(null) }} disabled={currentPage === pageUrls.length - 1}
                  style={{ padding: '3px 8px', borderRadius: 6, background: T.bg, border: `1px solid ${T.border}`, color: currentPage === pageUrls.length - 1 ? T.textMuted : T.text, cursor: currentPage === pageUrls.length - 1 ? 'default' : 'pointer', fontSize: 12 }}>›</button>
              </div>
            )}
          </div>
        )}

        {/* Right actions */}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
          {view === 'review' && activeProject && (
            <>
              <Btn variant={placing ? 'danger' : 'secondary'} onClick={() => { setPlacing(!placing); setPending(null) }}>
                {placing ? '✕ Cancel' : '📌 Pin Comment'}
              </Btn>
              <Btn variant="secondary" onClick={() => { setShowList(!showList); setSelected(null) }}>
                {open.length > 0 && <span style={{ background: T.danger, color: 'white', borderRadius: 10, padding: '0 5px', fontSize: 10, fontWeight: 800 }}>{open.length}</span>}
                Threads
              </Btn>
            </>
          )}
          <Btn onClick={() => fileRef.current.click()} disabled={uploading}>
            {uploading ? uploadProgress : '↑ Upload'}
          </Btn>
          <input ref={fileRef} type="file" accept="image/*,.pdf,application/pdf" onChange={handleFile} style={{ display: 'none' }} />
          {saving && <span style={{ fontSize: 12, color: T.textMuted }}>Saving…</span>}
        </div>
      </header>

      {/* Placing banner */}
      {placing && (
        <div style={{ background: T.primary, color: 'white', textAlign: 'center', padding: '7px', fontSize: 13, fontWeight: 600, flexShrink: 0 }}>
          🎯 Click anywhere on the image to drop a feedback pin
        </div>
      )}

      {/* ── GALLERY ── */}
      {view === 'gallery' && (
        <div style={{ flex: 1, overflow: 'auto', padding: 28 }}>
          {projects.length === 0 ? (
            <div style={{ maxWidth: 480, margin: '80px auto 0', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
              <div style={{ width: 72, height: 72, borderRadius: 20, background: T.primaryBg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 32 }}>🗂️</div>
              <div>
                <div style={{ fontSize: 22, fontWeight: 700, color: T.navy, marginBottom: 8 }}>No projects yet</div>
                <div style={{ fontSize: 14, color: T.textSub, lineHeight: 1.7 }}>Upload a screenshot or PDF to start collecting feedback. Each file becomes a project your team can comment on in real time.</div>
              </div>
              <Btn size="lg" onClick={() => fileRef.current.click()}>↑ Upload Screenshot or PDF</Btn>
              <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
                {[{ icon: '🖼️', label: 'PNG / JPG / WebP' }, { icon: '📄', label: 'PDF (multi-page)' }].map(t => (
                  <div key={t.label} style={{ padding: '8px 16px', borderRadius: T.radius, background: T.surface, border: `1px solid ${T.border}`, fontSize: 12, color: T.textSub, display: 'flex', gap: 6, alignItems: 'center', boxShadow: T.shadow }}>
                    {t.icon} {t.label}
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
                <div>
                  <h1 style={{ fontSize: 20, fontWeight: 700, color: T.navy, margin: 0 }}>Projects</h1>
                  <p style={{ fontSize: 13, color: T.textSub, margin: '2px 0 0' }}>{projects.length} project{projects.length !== 1 ? 's' : ''}</p>
                </div>
                <Btn onClick={() => fileRef.current.click()}>↑ New Upload</Btn>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))', gap: 16 }}>
                {projects.map(p => <ProjectCard key={p.key} project={p} onOpen={openProject} onDelete={handleDeleteProject} />)}
              </div>
            </>
          )}
        </div>
      )}

      {/* ── REVIEW ── */}
      {view === 'review' && (
        <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>

          {/* Canvas */}
          <div style={{ flex: 1, overflow: 'auto', background: '#E8EAED' }}>
            {loading ? (
              <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: T.textSub, gap: 8 }}>
                <span style={{ fontSize: 18 }}>⏳</span> Loading…
              </div>
            ) : pageUrls.length === 0 ? (
              <div style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12 }}>
                <span style={{ fontSize: 32 }}>⚠️</span>
                <div style={{ fontSize: 14, color: T.textSub }}>Could not load this file.</div>
                <Btn variant="secondary" onClick={() => setView('gallery')}>← Back to Projects</Btn>
              </div>
            ) : (
              <div style={{ padding: 24 }}>
                <div style={{ boxShadow: T.shadowLg, borderRadius: T.radius, overflow: 'hidden', position: 'relative' }}>
                  <img ref={imgRef} src={pageUrls[currentPage]} alt="review" onClick={handleImageClick}
                    style={{ display: 'block', width: '100%', cursor: placing ? 'crosshair' : 'default', userSelect: 'none' }}
                    draggable={false}
                  />
                  {/* Pins */}
                  {comments.map(c => (
                    <div key={c.id} onClick={e => { e.stopPropagation(); setSelected(c); setShowList(false) }}
                      title={`${c.author}: ${c.text}`}
                      style={{ position: 'absolute', left: `${c.x}%`, top: `${c.y}%`, transform: 'translate(-50%, -100%)', cursor: 'pointer', zIndex: 10, filter: selected?.id === c.id ? `drop-shadow(0 0 6px ${c.color})` : 'drop-shadow(0 2px 6px rgba(0,0,0,0.3))', transition: 'filter 0.15s' }}>
                      <div style={{ width: 32, height: 32, borderRadius: '50% 50% 50% 0', background: c.resolved ? T.textMuted : c.color, border: '2.5px solid white', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontWeight: 800, fontSize: 13, opacity: c.resolved ? 0.5 : 1 }}>
                        {c.author[0]?.toUpperCase()}
                      </div>
                    </div>
                  ))}
                  {/* Ghost pin */}
                  {pending && (
                    <div style={{ position: 'absolute', left: `${pending.x}%`, top: `${pending.y}%`, transform: 'translate(-50%, -100%)', width: 32, height: 32, borderRadius: '50% 50% 50% 0', background: COLORS[form.color].bg, border: '2.5px solid white', opacity: 0.85, pointerEvents: 'none', animation: 'bob 0.8s ease-in-out infinite' }} />
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Comment detail */}
          {selected && !showList && (
            <aside style={{ width: 300, background: T.surface, borderLeft: `1px solid ${T.border}`, display: 'flex', flexDirection: 'column', flexShrink: 0, boxShadow: '-2px 0 8px rgba(0,0,0,0.04)' }}>
              <div style={{ padding: '14px 16px', borderBottom: `1px solid ${T.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontWeight: 700, fontSize: 14, color: T.navy }}>Comment</span>
                <button onClick={() => setSelected(null)} style={{ background: 'none', border: 'none', color: T.textMuted, cursor: 'pointer', fontSize: 20, lineHeight: 1, borderRadius: 4, padding: '0 2px' }}>×</button>
              </div>
              <div style={{ padding: 16, flex: 1, overflow: 'auto' }}>
                <div style={{ borderLeft: `3px solid ${selected.color}`, paddingLeft: 12, marginBottom: 16, background: T.bg, borderRadius: `0 ${T.radius} ${T.radius} 0`, padding: '12px 12px 12px 14px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                    <div style={{ width: 30, height: 30, borderRadius: '50%', background: selected.color, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontWeight: 700, fontSize: 13, flexShrink: 0 }}>
                      {selected.author[0]?.toUpperCase()}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: T.text }}>{selected.author}</div>
                      <div style={{ fontSize: 11, color: T.textMuted }}>{new Date(selected.created_at).toLocaleString()}</div>
                    </div>
                    {selected.resolved && <Badge color="green">✓ Done</Badge>}
                  </div>
                  <div style={{ fontSize: 13, color: T.text, lineHeight: 1.6 }}>{selected.text}</div>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <Btn variant={selected.resolved ? 'secondary' : 'primary'} onClick={() => handleResolve(selected)} style={{ flex: 1 }}>
                    {selected.resolved ? '↩ Reopen' : '✓ Resolve'}
                  </Btn>
                  <Btn variant="danger" onClick={() => handleDelete(selected.id)}>🗑</Btn>
                </div>
              </div>
            </aside>
          )}

          {/* Threads list */}
          {showList && (
            <aside style={{ width: 300, background: T.surface, borderLeft: `1px solid ${T.border}`, display: 'flex', flexDirection: 'column', flexShrink: 0, overflow: 'hidden', boxShadow: '-2px 0 8px rgba(0,0,0,0.04)' }}>
              <div style={{ padding: '14px 16px', borderBottom: `1px solid ${T.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontWeight: 700, fontSize: 14, color: T.navy }}>Threads — Page {currentPage + 1}</span>
                <button onClick={() => setShowList(false)} style={{ background: 'none', border: 'none', color: T.textMuted, cursor: 'pointer', fontSize: 20, lineHeight: 1 }}>×</button>
              </div>
              <div style={{ flex: 1, overflow: 'auto' }}>
                {comments.length === 0 && (
                  <div style={{ padding: 24, textAlign: 'center', color: T.textSub, fontSize: 13 }}>No comments on this page yet.</div>
                )}
                {open.length > 0 && (
                  <div style={{ padding: '10px 16px 4px', fontSize: 11, color: T.textMuted, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase' }}>Open · {open.length}</div>
                )}
                {open.map(c => (
                  <div key={c.id} onClick={() => { setSelected(c); setShowList(false) }}
                    style={{ padding: '11px 16px', cursor: 'pointer', borderBottom: `1px solid ${T.border}`, transition: 'background 0.1s' }}
                    onMouseEnter={e => e.currentTarget.style.background = T.bg}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                    <div style={{ display: 'flex', gap: 9 }}>
                      <div style={{ width: 26, height: 26, borderRadius: '50%', background: c.color, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontWeight: 700, fontSize: 12, flexShrink: 0, marginTop: 1 }}>{c.author[0]?.toUpperCase()}</div>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: T.text }}>{c.author}</div>
                        <div style={{ fontSize: 12, color: T.textSub, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.text}</div>
                        <div style={{ fontSize: 11, color: T.textMuted, marginTop: 3 }}>{new Date(c.created_at).toLocaleString()}</div>
                      </div>
                    </div>
                  </div>
                ))}
                {done.length > 0 && (
                  <>
                    <div style={{ padding: '10px 16px 4px', fontSize: 11, color: T.textMuted, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase', borderTop: `1px solid ${T.border}`, marginTop: 4 }}>Resolved · {done.length}</div>
                    {done.map(c => (
                      <div key={c.id} onClick={() => { setSelected(c); setShowList(false) }}
                        style={{ padding: '11px 16px', cursor: 'pointer', borderBottom: `1px solid ${T.border}`, opacity: 0.5 }}>
                        <div style={{ display: 'flex', gap: 9 }}>
                          <div style={{ width: 26, height: 26, borderRadius: '50%', background: T.textMuted, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontWeight: 700, fontSize: 12, flexShrink: 0 }}>{c.author[0]?.toUpperCase()}</div>
                          <div>
                            <div style={{ fontSize: 13, fontWeight: 600, color: T.textSub }}>{c.author} ✓</div>
                            <div style={{ fontSize: 12, color: T.textMuted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.text}</div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </>
                )}
              </div>
            </aside>
          )}
        </div>
      )}

      {/* ── Drop comment popup ── */}
      {pending && (
        <div style={{ position: 'fixed', bottom: 24, right: 24, width: 300, background: T.surface, borderRadius: T.radiusLg, boxShadow: T.shadowLg, border: `1px solid ${T.border}`, zIndex: 9999, overflow: 'hidden' }}>
          <div style={{ padding: '12px 16px', borderBottom: `1px solid ${T.border}`, fontWeight: 700, fontSize: 14, color: T.navy, display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: T.bg }}>
            <span>📌 Leave a comment</span>
            <button onClick={() => setPending(null)} style={{ background: 'none', border: 'none', color: T.textMuted, cursor: 'pointer', fontSize: 20, lineHeight: 1 }}>×</button>
          </div>
          <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div>
              <label style={{ fontSize: 11, fontWeight: 600, color: T.textSub, textTransform: 'uppercase', letterSpacing: 0.5, display: 'block', marginBottom: 5 }}>Your name</label>
              <input value={form.author} onChange={e => setForm(f => ({ ...f, author: e.target.value }))} placeholder="e.g. Sarah" autoFocus
                style={{ width: '100%', padding: '8px 10px', borderRadius: T.radius, border: `1px solid ${T.border}`, background: T.surface, color: T.text, fontSize: 13, outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit' }} />
            </div>
            <div>
              <label style={{ fontSize: 11, fontWeight: 600, color: T.textSub, textTransform: 'uppercase', letterSpacing: 0.5, display: 'block', marginBottom: 5 }}>Feedback</label>
              <textarea value={form.text} onChange={e => setForm(f => ({ ...f, text: e.target.value }))}
                onKeyDown={e => e.key === 'Enter' && e.metaKey && dropComment()}
                placeholder="What's your feedback here? (⌘↵ to submit)" rows={3}
                style={{ width: '100%', padding: '8px 10px', borderRadius: T.radius, border: `1px solid ${T.border}`, background: T.surface, color: T.text, fontSize: 13, outline: 'none', resize: 'vertical', boxSizing: 'border-box', fontFamily: 'inherit' }} />
            </div>
            <div style={{ display: 'flex', gap: 7, alignItems: 'center' }}>
              <span style={{ fontSize: 11, fontWeight: 600, color: T.textSub, textTransform: 'uppercase', letterSpacing: 0.5 }}>Color</span>
              {COLORS.map((c, i) => (
                <div key={i} onClick={() => setForm(f => ({ ...f, color: i }))}
                  style={{ width: 22, height: 22, borderRadius: '50%', background: c.bg, cursor: 'pointer', border: form.color === i ? `3px solid ${T.navy}` : `2px solid transparent`, boxSizing: 'border-box', transition: 'transform 0.1s', transform: form.color === i ? 'scale(1.15)' : 'scale(1)' }} />
              ))}
            </div>
            <Btn onClick={dropComment} disabled={!form.author.trim() || !form.text.trim() || saving}
              style={{ width: '100%', justifyContent: 'center' }}>
              {saving ? 'Saving…' : 'Drop Comment ✓'}
            </Btn>
          </div>
        </div>
      )}

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');
        * { box-sizing: border-box; }
        input::placeholder, textarea::placeholder { color: ${T.textMuted}; }
        input:focus, textarea:focus { border-color: ${T.primary} !important; box-shadow: 0 0 0 3px ${T.primaryBg}; }
        @keyframes bob { 0%,100%{transform:translate(-50%,-105%) scale(1)} 50%{transform:translate(-50%,-115%) scale(1.1)} }
      `}</style>
    </div>
  )
}
