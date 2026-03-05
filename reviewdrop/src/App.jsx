import { useState, useEffect, useRef } from 'react'
import { supabase, getProjects, upsertProject, deleteProject as dbDeleteProject,
  uploadPage, getPageUrl,
  getComments, addComment, updateComment, deleteComment,
  subscribeToComments, getAllProjectComments,
} from './supabase.js'

const COLORS = [
  { bg: '#3B82F6', label: 'Blue' },
  { bg: '#F43F5E', label: 'Rose' },
  { bg: '#10B981', label: 'Green' },
  { bg: '#F59E0B', label: 'Amber' },
  { bg: '#8B5CF6', label: 'Purple' },
]

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeProjectKey(file) {
  return file.name.replace(/[^a-z0-9]/gi, '-').toLowerCase().slice(0, 40)
    + '-' + file.size
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

// ─── Gallery Card ─────────────────────────────────────────────────────────────

function ProjectCard({ project, onOpen, onDelete }) {
  const [hovered, setHovered] = useState(false)
  return (
    <div
      onClick={() => onOpen(project)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background: '#111827', borderRadius: 12,
        border: `1px solid ${hovered ? '#3B82F6' : '#1F2D40'}`,
        overflow: 'hidden', cursor: 'pointer',
        transform: hovered ? 'translateY(-3px)' : 'translateY(0)',
        transition: 'all 0.15s', display: 'flex', flexDirection: 'column',
        position: 'relative',
      }}
    >
      {/* Thumbnail */}
      <div style={{ height: 150, background: '#0A0F1E', overflow: 'hidden', flexShrink: 0, position: 'relative' }}>
        {project.thumbnail_url ? (
          <img src={project.thumbnail_url} alt={project.name}
            style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        ) : (
          <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 40 }}>
            {project.type === 'pdf' ? '📄' : '🖼️'}
          </div>
        )}
        <div style={{ position: 'absolute', top: 8, right: 8, background: 'rgba(10,15,30,0.85)', borderRadius: 6, padding: '2px 7px', fontSize: 10, fontWeight: 700, color: '#94A3B8' }}>
          {project.type === 'pdf' ? `PDF · ${project.page_count}p` : 'IMG'}
        </div>
      </div>

      {/* Info */}
      <div style={{ padding: '10px 12px' }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#E2E8F0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {project.name}
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 6 }}>
          <div style={{ fontSize: 11, color: '#475569' }}>
            {new Date(project.uploaded_at).toLocaleDateString()}
          </div>
          <div style={{ display: 'flex', gap: 5 }}>
            {project.open_count > 0 && (
              <span style={{ fontSize: 10, background: '#F43F5E22', color: '#F43F5E', borderRadius: 8, padding: '1px 6px', fontWeight: 700 }}>
                {project.open_count} open
              </span>
            )}
            {project.resolved_count > 0 && (
              <span style={{ fontSize: 10, background: '#10B98122', color: '#10B981', borderRadius: 8, padding: '1px 6px', fontWeight: 700 }}>
                {project.resolved_count} done
              </span>
            )}
            {!project.open_count && !project.resolved_count && (
              <span style={{ fontSize: 10, color: '#334155' }}>no comments</span>
            )}
          </div>
        </div>
      </div>

      {/* Delete btn */}
      {hovered && (
        <button
          onClick={e => { e.stopPropagation(); onDelete(project.key) }}
          style={{ position: 'absolute', top: 8, left: 8, width: 26, height: 26, borderRadius: 6, background: 'rgba(69,10,10,0.9)', border: 'none', color: '#FCA5A5', cursor: 'pointer', fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        >×</button>
      )}
    </div>
  )
}

// ─── Main App ─────────────────────────────────────────────────────────────────

export default function App() {
  const [view, setView] = useState('gallery') // gallery | review
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

  // Load projects on mount
  useEffect(() => {
    loadProjects()
  }, [])

  // Load comments + subscribe to realtime when project/page changes
  useEffect(() => {
    if (!activeProject) return
    loadComments()

    // Unsubscribe previous
    if (realtimeRef.current) realtimeRef.current.unsubscribe()

    // Subscribe to realtime updates
    realtimeRef.current = subscribeToComments(activeProject.key, currentPage, () => {
      loadComments()
    })

    return () => { if (realtimeRef.current) realtimeRef.current.unsubscribe() }
  }, [activeProject, currentPage])

  async function loadProjects() {
    try {
      const data = await getProjects()
      setProjects(data || [])
    } catch (e) {
      console.error('Failed to load projects:', e)
    }
  }

  async function loadComments() {
    if (!activeProject) return
    try {
      const data = await getComments(activeProject.key, currentPage)
      setComments(data || [])
    } catch (e) {
      console.error('Failed to load comments:', e)
    }
  }

  // ── File Upload ────────────────────────────────────────────────────────────
  async function handleFile(e) {
    const file = e.target.files[0]
    if (!file) return
    setUploading(true)
    setUploadProgress('Reading file…')

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
          const reader = new FileReader()
          reader.onload = ev => res([ev.target.result])
          reader.readAsDataURL(file)
        })
      }

      // Upload all pages to Supabase Storage
      const uploadedUrls = []
      for (let i = 0; i < dataUrls.length; i++) {
        setUploadProgress(`Uploading page ${i + 1} of ${dataUrls.length}…`)
        const url = await uploadPage(key, i, dataUrls[i])
        uploadedUrls.push(url)
      }

      const project = {
        key,
        name,
        type: isPDF ? 'pdf' : 'image',
        page_count: dataUrls.length,
        thumbnail_url: uploadedUrls[0],
        open_count: 0,
        resolved_count: 0,
        uploaded_at: new Date().toISOString(),
      }

      setUploadProgress('Saving project…')
      await upsertProject(project)
      await loadProjects()

      setPageUrls(uploadedUrls)
      setActiveProject(project)
      setCurrentPage(0)
      setComments([])
      setSelected(null)
      setPending(null)
      setPlacing(false)
      setShowList(false)
      setView('review')
    } catch (err) {
      alert('Upload failed: ' + err.message)
      console.error(err)
    } finally {
      setUploading(false)
      setUploadProgress('')
      e.target.value = ''
    }
  }

  async function openProject(project) {
    setLoading(true)
    setActiveProject(project)
    setCurrentPage(0)
    setComments([])
    setSelected(null)
    setPending(null)
    setPlacing(false)
    setShowList(false)

    // Build page URLs from storage
    const urls = []
    for (let i = 0; i < project.page_count; i++) {
      urls.push(getPageUrl(project.key, i))
    }
    setPageUrls(urls)
    setView('review')
    setLoading(false)
  }

  async function handleDeleteProject(key) {
    if (!confirm('Delete this project and all its comments?')) return
    try {
      await dbDeleteProject(key)
      await loadProjects()
      if (activeProject?.key === key) {
        setActiveProject(null)
        setView('gallery')
      }
    } catch (e) {
      alert('Failed to delete: ' + e.message)
    }
  }

  // ── Comment Actions ────────────────────────────────────────────────────────
  function handleImageClick(e) {
    if (!placing) return
    const rect = imgRef.current.getBoundingClientRect()
    setPending({
      x: ((e.clientX - rect.left) / rect.width) * 100,
      y: ((e.clientY - rect.top) / rect.height) * 100,
    })
    setPlacing(false)
  }

  async function dropComment() {
    if (!form.author.trim() || !form.text.trim() || !pending) return
    setSaving(true)
    try {
      const c = await addComment({
        project_key: activeProject.key,
        page: currentPage,
        x: pending.x,
        y: pending.y,
        author: form.author.trim(),
        text: form.text.trim(),
        color: COLORS[form.color].bg,
        resolved: false,
      })
      setPending(null)
      setForm(f => ({ ...f, text: '' }))
      setSelected(c)
      await updateProjectCounts(activeProject.key)
    } catch (e) {
      alert('Failed to save comment: ' + e.message)
    }
    setSaving(false)
  }

  async function handleResolve(comment) {
    try {
      await updateComment(comment.id, { resolved: !comment.resolved })
      await loadComments()
      await updateProjectCounts(activeProject.key)
      setSelected(c => c?.id === comment.id ? { ...c, resolved: !c.resolved } : c)
    } catch (e) {
      alert('Failed to update: ' + e.message)
    }
  }

  async function handleDelete(id) {
    try {
      await deleteComment(id)
      setSelected(null)
      await updateProjectCounts(activeProject.key)
    } catch (e) {
      alert('Failed to delete: ' + e.message)
    }
  }

  async function updateProjectCounts(projectKey) {
    const all = await getAllProjectComments(projectKey)
    const open_count = all.filter(c => !c.resolved).length
    const resolved_count = all.filter(c => c.resolved).length
    await supabase
      .from('projects')
      .update({ open_count, resolved_count })
      .eq('key', projectKey)
    setProjects(prev => prev.map(p =>
      p.key === projectKey ? { ...p, open_count, resolved_count } : p
    ))
  }

  const open = comments.filter(c => !c.resolved)
  const done = comments.filter(c => c.resolved)

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div style={{ fontFamily: 'system-ui, sans-serif', height: '100vh', display: 'flex', flexDirection: 'column', background: '#0A0F1E', color: '#E2E8F0' }}>

      {/* ── Header ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 16px', background: '#111827', borderBottom: '1px solid #1F2D40', flexShrink: 0 }}>
        <button onClick={() => setView('gallery')}
          style={{ fontWeight: 800, fontSize: 16, background: 'linear-gradient(135deg,#60A5FA,#A78BFA)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', border: 'none', cursor: 'pointer', padding: 0, whiteSpace: 'nowrap' }}>
          ◆ ReviewDrop
        </button>

        {view === 'review' && activeProject && (
          <>
            <span style={{ color: '#334155' }}>/</span>
            <span style={{ fontSize: 13, color: '#94A3B8', fontWeight: 600, maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {activeProject.name}
            </span>
            {pageUrls.length > 1 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <button onClick={() => { setCurrentPage(p => Math.max(0, p - 1)); setSelected(null) }} disabled={currentPage === 0}
                  style={{ padding: '3px 8px', borderRadius: 6, background: '#1E293B', border: '1px solid #334155', color: currentPage === 0 ? '#334155' : '#94A3B8', cursor: currentPage === 0 ? 'default' : 'pointer', fontSize: 12 }}>‹</button>
                <span style={{ fontSize: 12, color: '#64748B' }}>{currentPage + 1} / {pageUrls.length}</span>
                <button onClick={() => { setCurrentPage(p => Math.min(pageUrls.length - 1, p + 1)); setSelected(null) }} disabled={currentPage === pageUrls.length - 1}
                  style={{ padding: '3px 8px', borderRadius: 6, background: '#1E293B', border: '1px solid #334155', color: currentPage === pageUrls.length - 1 ? '#334155' : '#94A3B8', cursor: currentPage === pageUrls.length - 1 ? 'default' : 'pointer', fontSize: 12 }}>›</button>
              </div>
            )}
          </>
        )}

        {/* Nav tabs */}
        <div style={{ display: 'flex', gap: 4, marginLeft: 6 }}>
          <button onClick={() => setView('gallery')}
            style={{ padding: '5px 12px', borderRadius: 7, background: view === 'gallery' ? '#1E40AF' : 'transparent', color: view === 'gallery' ? '#93C5FD' : '#475569', border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
            🗂 Gallery {projects.length > 0 && `(${projects.length})`}
          </button>
          {activeProject && (
            <button onClick={() => setView('review')}
              style={{ padding: '5px 12px', borderRadius: 7, background: view === 'review' ? '#1E40AF' : 'transparent', color: view === 'review' ? '#93C5FD' : '#475569', border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
              ✏️ Review
            </button>
          )}
        </div>

        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
          {view === 'review' && activeProject && (
            <>
              <button onClick={() => { setPlacing(!placing); setPending(null) }}
                style={{ padding: '7px 14px', borderRadius: 8, background: placing ? '#F43F5E' : '#8B5CF6', color: 'white', fontWeight: 600, border: 'none', cursor: 'pointer', fontSize: 13 }}>
                {placing ? '✕ Cancel' : '📌 Pin Comment'}
              </button>
              <button onClick={() => { setShowList(!showList); setSelected(null) }}
                style={{ padding: '7px 14px', borderRadius: 8, background: showList ? '#1E40AF' : '#1E293B', color: '#93C5FD', fontWeight: 600, border: '1px solid #2D3748', cursor: 'pointer', fontSize: 13 }}>
                {open.length > 0 && <span style={{ background: '#F43F5E', color: 'white', borderRadius: 10, padding: '0 5px', fontSize: 10, marginRight: 4, fontWeight: 800 }}>{open.length}</span>}
                Threads
              </button>
            </>
          )}
          <button onClick={() => fileRef.current.click()} disabled={uploading}
            style={{ padding: '7px 14px', borderRadius: 8, background: 'linear-gradient(135deg,#3B82F6,#8B5CF6)', color: 'white', fontWeight: 700, border: 'none', cursor: uploading ? 'default' : 'pointer', fontSize: 13, opacity: uploading ? 0.7 : 1, whiteSpace: 'nowrap' }}>
            {uploading ? uploadProgress : '↑ Upload'}
          </button>
          <input ref={fileRef} type="file" accept="image/*,.pdf,application/pdf" onChange={handleFile} style={{ display: 'none' }} />
          {saving && <span style={{ fontSize: 11, color: '#64748B' }}>saving…</span>}
        </div>
      </div>

      {placing && (
        <div style={{ background: '#7C3AED', color: 'white', textAlign: 'center', padding: '6px', fontSize: 12, fontWeight: 600, flexShrink: 0 }}>
          🎯 Click anywhere on the screenshot to drop your feedback pin
        </div>
      )}

      {/* ── GALLERY ── */}
      {view === 'gallery' && (
        <div style={{ flex: 1, overflow: 'auto', padding: 24 }}>
          {projects.length === 0 ? (
            <div style={{ height: '100%', minHeight: 400, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16 }}>
              <div style={{ fontSize: 52 }}>🗂️</div>
              <div style={{ fontSize: 20, fontWeight: 700, color: '#475569' }}>No projects yet</div>
              <div style={{ fontSize: 13, color: '#334155', maxWidth: 340, textAlign: 'center', lineHeight: 1.7 }}>
                Upload a screenshot or PDF to get started. Each file becomes a project your whole team can comment on.
              </div>
              <button onClick={() => fileRef.current.click()}
                style={{ padding: '10px 24px', borderRadius: 10, background: 'linear-gradient(135deg,#3B82F6,#8B5CF6)', color: 'white', fontWeight: 700, fontSize: 14, border: 'none', cursor: 'pointer' }}>
                ↑ Upload Screenshot or PDF
              </button>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'center' }}>
                {[{ icon: '🖼️', label: 'PNG / JPG / WebP' }, { icon: '📄', label: 'PDF (multi-page)' }].map(t => (
                  <div key={t.label} style={{ padding: '8px 16px', borderRadius: 8, background: '#111827', border: '1px solid #1F2D40', fontSize: 12, color: '#475569', display: 'flex', gap: 6, alignItems: 'center' }}>
                    <span>{t.icon}</span><span>{t.label}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
                <div style={{ fontSize: 18, fontWeight: 700, color: '#94A3B8' }}>
                  Projects <span style={{ color: '#334155', fontSize: 14, fontWeight: 400 }}>({projects.length})</span>
                </div>
                <button onClick={() => fileRef.current.click()}
                  style={{ padding: '7px 16px', borderRadius: 8, background: 'linear-gradient(135deg,#3B82F6,#8B5CF6)', color: 'white', fontWeight: 700, border: 'none', cursor: 'pointer', fontSize: 13 }}>
                  ↑ New Upload
                </button>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 16 }}>
                {projects.map(p => (
                  <ProjectCard key={p.key} project={p} onOpen={openProject} onDelete={handleDeleteProject} />
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {/* ── REVIEW ── */}
      {view === 'review' && (
        <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>

          {/* Canvas */}
          <div style={{ flex: 1, overflow: 'auto', background: '#0A0F1E' }}>
            {loading ? (
              <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#475569' }}>Loading…</div>
            ) : pageUrls.length === 0 ? (
              <div style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, color: '#334155' }}>
                <div style={{ fontSize: 36 }}>⚠️</div>
                <div style={{ fontSize: 14, color: '#475569' }}>Could not load this file.</div>
                <button onClick={() => setView('gallery')} style={{ padding: '7px 16px', borderRadius: 8, background: '#1E293B', color: '#94A3B8', border: '1px solid #334155', cursor: 'pointer', fontSize: 13 }}>← Gallery</button>
              </div>
            ) : (
              <div style={{ position: 'relative', display: 'inline-block', minWidth: '100%' }}>
                <img ref={imgRef} src={pageUrls[currentPage]} alt="review"
                  onClick={handleImageClick}
                  style={{ display: 'block', width: '100%', cursor: placing ? 'crosshair' : 'default', userSelect: 'none' }}
                  draggable={false}
                />
                {/* Pins */}
                {comments.map(c => (
                  <div key={c.id}
                    onClick={e => { e.stopPropagation(); setSelected(c); setShowList(false) }}
                    title={`${c.author}: ${c.text}`}
                    style={{ position: 'absolute', left: `${c.x}%`, top: `${c.y}%`, transform: 'translate(-50%, -100%)', cursor: 'pointer', zIndex: 10, filter: selected?.id === c.id ? 'drop-shadow(0 0 8px white)' : 'drop-shadow(0 2px 6px rgba(0,0,0,0.5))', transition: 'filter 0.15s' }}>
                    <div style={{ width: 32, height: 32, borderRadius: '50% 50% 50% 0', background: c.resolved ? '#6B7280' : c.color, border: '2.5px solid white', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontWeight: 800, fontSize: 13, opacity: c.resolved ? 0.55 : 1 }}>
                      {c.author[0]?.toUpperCase()}
                    </div>
                  </div>
                ))}
                {/* Ghost pin */}
                {pending && (
                  <div style={{ position: 'absolute', left: `${pending.x}%`, top: `${pending.y}%`, transform: 'translate(-50%, -100%)', width: 32, height: 32, borderRadius: '50% 50% 50% 0', background: COLORS[form.color].bg, border: '2.5px solid white', opacity: 0.8, pointerEvents: 'none', animation: 'bob 0.8s ease-in-out infinite' }} />
                )}
              </div>
            )}
          </div>

          {/* Comment detail panel */}
          {selected && !showList && (
            <div style={{ width: 300, background: '#111827', borderLeft: '1px solid #1F2D40', display: 'flex', flexDirection: 'column', flexShrink: 0 }}>
              <div style={{ padding: '12px 16px', borderBottom: '1px solid #1F2D40', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontWeight: 700, fontSize: 13 }}>Comment</span>
                <button onClick={() => setSelected(null)} style={{ background: 'none', border: 'none', color: '#475569', cursor: 'pointer', fontSize: 20, lineHeight: 1 }}>×</button>
              </div>
              <div style={{ padding: 16, flex: 1, overflow: 'auto' }}>
                <div style={{ borderLeft: `3px solid ${selected.color}`, paddingLeft: 12, marginBottom: 16 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                    <div style={{ width: 30, height: 30, borderRadius: '50%', background: selected.color, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontWeight: 800, fontSize: 13, flexShrink: 0 }}>
                      {selected.author[0]?.toUpperCase()}
                    </div>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 700 }}>{selected.author}</div>
                      <div style={{ fontSize: 10, color: '#475569' }}>
                        {new Date(selected.created_at).toLocaleString()}
                      </div>
                    </div>
                    {selected.resolved && (
                      <span style={{ marginLeft: 'auto', fontSize: 10, background: '#064E3B', color: '#6EE7B7', padding: '2px 7px', borderRadius: 10, fontWeight: 600 }}>RESOLVED</span>
                    )}
                  </div>
                  <div style={{ fontSize: 14, color: '#CBD5E1', lineHeight: 1.6 }}>{selected.text}</div>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={() => handleResolve(selected)}
                    style={{ flex: 1, padding: '9px', borderRadius: 8, background: selected.resolved ? '#374151' : '#065F46', color: selected.resolved ? '#9CA3AF' : '#6EE7B7', border: 'none', cursor: 'pointer', fontWeight: 600, fontSize: 12 }}>
                    {selected.resolved ? '↩ Reopen' : '✓ Resolve'}
                  </button>
                  <button onClick={() => handleDelete(selected.id)}
                    style={{ padding: '9px 13px', borderRadius: 8, background: '#450A0A', color: '#FCA5A5', border: 'none', cursor: 'pointer', fontSize: 14 }}>🗑</button>
                </div>
              </div>
            </div>
          )}

          {/* Threads list */}
          {showList && (
            <div style={{ width: 300, background: '#111827', borderLeft: '1px solid #1F2D40', display: 'flex', flexDirection: 'column', flexShrink: 0, overflow: 'hidden' }}>
              <div style={{ padding: '12px 16px', borderBottom: '1px solid #1F2D40', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontWeight: 700, fontSize: 13 }}>Page {currentPage + 1} Comments ({comments.length})</span>
                <button onClick={() => setShowList(false)} style={{ background: 'none', border: 'none', color: '#475569', cursor: 'pointer', fontSize: 20, lineHeight: 1 }}>×</button>
              </div>
              <div style={{ flex: 1, overflow: 'auto' }}>
                {comments.length === 0 && (
                  <div style={{ padding: 24, textAlign: 'center', color: '#334155', fontSize: 13 }}>No comments on this page yet.</div>
                )}
                {open.length > 0 && <div style={{ padding: '8px 16px 4px', fontSize: 10, color: '#475569', fontWeight: 800, letterSpacing: 1, textTransform: 'uppercase' }}>Open · {open.length}</div>}
                {open.map(c => (
                  <div key={c.id} onClick={() => { setSelected(c); setShowList(false) }}
                    style={{ padding: '11px 16px', cursor: 'pointer', borderBottom: '1px solid #0D1526' }}
                    onMouseEnter={e => e.currentTarget.style.background = '#1E293B'}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                    <div style={{ display: 'flex', gap: 9 }}>
                      <div style={{ width: 24, height: 24, borderRadius: '50%', background: c.color, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontWeight: 800, fontSize: 11, flexShrink: 0, marginTop: 1 }}>{c.author[0]?.toUpperCase()}</div>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 12, fontWeight: 700, color: '#CBD5E1' }}>{c.author}</div>
                        <div style={{ fontSize: 12, color: '#475569', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.text}</div>
                        <div style={{ fontSize: 10, color: '#334155', marginTop: 3 }}>{new Date(c.created_at).toLocaleString()}</div>
                      </div>
                    </div>
                  </div>
                ))}
                {done.length > 0 && (
                  <>
                    <div style={{ padding: '12px 16px 4px', fontSize: 10, color: '#334155', fontWeight: 800, letterSpacing: 1, textTransform: 'uppercase', borderTop: '1px solid #1F2D40', marginTop: 4 }}>Resolved · {done.length}</div>
                    {done.map(c => (
                      <div key={c.id} onClick={() => { setSelected(c); setShowList(false) }}
                        style={{ padding: '11px 16px', cursor: 'pointer', borderBottom: '1px solid #0D1526', opacity: 0.4 }}>
                        <div style={{ display: 'flex', gap: 9 }}>
                          <div style={{ width: 24, height: 24, borderRadius: '50%', background: '#374151', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontWeight: 800, fontSize: 11, flexShrink: 0 }}>{c.author[0]?.toUpperCase()}</div>
                          <div>
                            <div style={{ fontSize: 12, fontWeight: 700, color: '#6B7280' }}>{c.author} ✓</div>
                            <div style={{ fontSize: 12, color: '#374155', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.text}</div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Drop comment popup */}
      {pending && (
        <div style={{ position: 'fixed', bottom: 24, right: 24, width: 290, background: '#111827', borderRadius: 14, boxShadow: '0 24px 64px rgba(0,0,0,0.7)', border: '1px solid #1F2D40', zIndex: 9999, overflow: 'hidden' }}>
          <div style={{ padding: '11px 14px', background: '#0A0F1E', fontWeight: 700, fontSize: 13, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>📌 Drop a comment</span>
            <button onClick={() => setPending(null)} style={{ background: 'none', border: 'none', color: '#475569', cursor: 'pointer', fontSize: 18, lineHeight: 1 }}>×</button>
          </div>
          <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <input value={form.author} onChange={e => setForm(f => ({ ...f, author: e.target.value }))} placeholder="Your name" autoFocus
              style={{ padding: '8px 10px', borderRadius: 7, border: '1px solid #2D3748', background: '#0A0F1E', color: '#E2E8F0', fontSize: 13, outline: 'none', width: '100%', boxSizing: 'border-box' }} />
            <textarea value={form.text} onChange={e => setForm(f => ({ ...f, text: e.target.value }))}
              onKeyDown={e => e.key === 'Enter' && e.metaKey && dropComment()}
              placeholder="Your feedback… (⌘↵ to submit)" rows={3}
              style={{ padding: '8px 10px', borderRadius: 7, border: '1px solid #2D3748', background: '#0A0F1E', color: '#E2E8F0', fontSize: 13, outline: 'none', resize: 'vertical', width: '100%', boxSizing: 'border-box' }} />
            <div style={{ display: 'flex', gap: 7, alignItems: 'center' }}>
              <span style={{ fontSize: 10, color: '#475569', fontWeight: 600, marginRight: 2 }}>COLOR</span>
              {COLORS.map((c, i) => (
                <div key={i} onClick={() => setForm(f => ({ ...f, color: i }))}
                  style={{ width: 22, height: 22, borderRadius: '50%', background: c.bg, cursor: 'pointer', border: form.color === i ? '2.5px solid white' : '2.5px solid transparent', boxSizing: 'border-box', transform: form.color === i ? 'scale(1.2)' : 'scale(1)', transition: 'transform 0.1s' }} />
              ))}
            </div>
            <button onClick={dropComment} disabled={!form.author.trim() || !form.text.trim() || saving}
              style={{ padding: '10px', borderRadius: 8, background: form.author.trim() && form.text.trim() ? COLORS[form.color].bg : '#1E293B', color: 'white', border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: 13, opacity: saving ? 0.7 : 1 }}>
              {saving ? 'Saving…' : 'Drop Comment ✓'}
            </button>
          </div>
        </div>
      )}

      <style>{`
        input::placeholder, textarea::placeholder { color: #334155 !important; }
        @keyframes bob { 0%,100%{transform:translate(-50%,-105%) scale(1)} 50%{transform:translate(-50%,-115%) scale(1.1)} }
      `}</style>
    </div>
  )
}
