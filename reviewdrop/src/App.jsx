import { useState, useEffect, useRef } from 'react'
import { supabase, getProjects, upsertProject, deleteProject as dbDeleteProject,
  uploadPage, getPageUrl,
  getAllProjectComments, addComment, updateComment, deleteComment, uploadCommentImage,
  getReplies, addReply, deleteReply,
} from './supabase.js'

// ─── Design tokens ────────────────────────────────────────────────────────────
const T = {
  bg: '#F7F8FA', surface: '#FFFFFF', border: '#E4E7EC', borderHov: '#B0BAC9',
  text: '#111827', textSub: '#6B7280', textMuted: '#9CA3AF',
  primary: '#0D7C66', primaryHov: '#0A6655', primaryBg: '#E8F5F2',
  danger: '#DC2626', dangerBg: '#FEF2F2', success: '#059669', successBg: '#ECFDF5',
  navy: '#0F172A',
  shadow: '0 1px 3px rgba(0,0,0,0.08), 0 1px 2px rgba(0,0,0,0.04)',
  shadowMd: '0 4px 12px rgba(0,0,0,0.08)',
  shadowLg: '0 20px 40px rgba(0,0,0,0.12)',
  radius: '8px', radiusLg: '12px',
}

const COLORS = [
  { bg: '#0D7C66' }, { bg: '#2563EB' }, { bg: '#7C3AED' },
  { bg: '#DC2626' }, { bg: '#D97706' },
]

function makeProjectKey(file) {
  return file.name.replace(/[^a-z0-9]/gi, '-').toLowerCase().slice(0, 40) + '-' + file.size
}

async function renderPDF(file) {
  if (!window.pdfjsLib) {
    await new Promise((res, rej) => {
      const s = document.createElement('script')
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js'
      s.onload = res; s.onerror = rej; document.head.appendChild(s)
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

// ─── renderText: highlight @mentions ─────────────────────────────────────────
function renderText(text) {
  if (!text) return null
  return text.split(/(@\w+)/g).map((part, i) =>
    /^@\w+$/.test(part)
      ? <span key={i} style={{ color: T.primary, fontWeight: 600 }}>{part}</span>
      : part
  )
}

// ─── Btn ──────────────────────────────────────────────────────────────────────
function Btn({ children, onClick, variant = 'primary', size = 'md', disabled, style = {} }) {
  const [hov, setHov] = useState(false)
  const sizes = { sm: { padding: '5px 12px', fontSize: 12 }, md: { padding: '8px 16px', fontSize: 13 }, lg: { padding: '10px 20px', fontSize: 14 } }
  const variants = {
    primary: { background: hov ? T.primaryHov : T.primary, color: '#fff' },
    secondary: { background: hov ? T.border : T.surface, color: T.text, border: `1px solid ${T.border}` },
    ghost: { background: hov ? T.bg : 'transparent', color: T.textSub },
    danger: { background: hov ? '#B91C1C' : T.danger, color: '#fff' },
  }
  return (
    <button onClick={disabled ? undefined : onClick} disabled={disabled}
      onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}
      style={{ border: 'none', cursor: disabled ? 'default' : 'pointer', fontWeight: 600, borderRadius: T.radius, transition: 'all 0.15s', display: 'inline-flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap', fontFamily: 'inherit', opacity: disabled ? 0.5 : 1, ...sizes[size], ...variants[variant], ...style }}>
      {children}
    </button>
  )
}

function Badge({ children, color = 'gray' }) {
  const colors = { red: { background: T.dangerBg, color: T.danger }, green: { background: T.successBg, color: T.success }, gray: { background: T.bg, color: T.textSub }, teal: { background: T.primaryBg, color: T.primary } }
  return <span style={{ ...colors[color], fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 20 }}>{children}</span>
}

// ─── Inline editable name ─────────────────────────────────────────────────────
function InlineName({ name, onCommit, style = {}, inputStyle = {} }) {
  const [editing, setEditing] = useState(false)
  const [val, setVal] = useState(name)
  const inputRef = useRef()

  useEffect(() => { setVal(name) }, [name])

  function start(e) {
    e.stopPropagation()
    setVal(name)
    setEditing(true)
    setTimeout(() => { inputRef.current?.focus(); inputRef.current?.select() }, 30)
  }

  function commit() {
    setEditing(false)
    if (val.trim() && val.trim() !== name) onCommit(val.trim())
    else setVal(name)
  }

  if (editing) return (
    <input ref={inputRef} value={val}
      onChange={e => setVal(e.target.value)}
      onBlur={commit}
      onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') { setVal(name); setEditing(false) } }}
      onClick={e => e.stopPropagation()}
      style={{ fontSize: 14, fontWeight: 600, color: T.text, border: `1.5px solid ${T.primary}`, borderRadius: 5, padding: '1px 6px', outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box', boxShadow: `0 0 0 3px ${T.primaryBg}`, width: '100%', ...inputStyle }}
    />
  )

  return (
    <span onDoubleClick={start} title="Double-click to rename"
      style={{ cursor: 'text', userSelect: 'none', ...style }}>
      {name}
    </span>
  )
}

// ─── MentionTextarea ──────────────────────────────────────────────────────────
function MentionTextarea({ value, onChange, onKeyDown, authors = [], placeholder, rows = 3, autoFocus, style = {} }) {
  const [mentionQuery, setMentionQuery] = useState(null)
  const [mentionStart, setMentionStart] = useState(-1)
  const ref = useRef()

  function handleChange(e) {
    const val = e.target.value
    const pos = e.target.selectionStart
    const before = val.slice(0, pos)
    const match = before.match(/@(\w*)$/)
    if (match) {
      setMentionQuery(match[1])
      setMentionStart(match.index)
    } else {
      setMentionQuery(null)
      setMentionStart(-1)
    }
    onChange(e)
  }

  function selectMention(name) {
    const pos = ref.current.selectionStart
    const before = value.slice(0, mentionStart)
    const after = value.slice(pos)
    const newVal = before + '@' + name + ' ' + after
    onChange({ target: { value: newVal } })
    setMentionQuery(null)
    setTimeout(() => {
      const np = mentionStart + name.length + 2
      ref.current.setSelectionRange(np, np)
      ref.current.focus()
    }, 0)
  }

  const filtered = mentionQuery !== null
    ? authors.filter(a => a.toLowerCase().startsWith(mentionQuery.toLowerCase())).slice(0, 5)
    : []

  return (
    <div style={{ position: 'relative' }}>
      <textarea ref={ref} value={value} onChange={handleChange} onKeyDown={onKeyDown}
        placeholder={placeholder} rows={rows} autoFocus={autoFocus}
        style={{ width: '100%', padding: '8px 10px', borderRadius: T.radius, border: `1px solid ${T.border}`, background: T.surface, color: T.text, fontSize: 13, outline: 'none', resize: 'vertical', boxSizing: 'border-box', fontFamily: 'inherit', ...style }} />
      {filtered.length > 0 && (
        <div style={{ position: 'absolute', bottom: 'calc(100% + 4px)', left: 0, background: T.surface, border: `1px solid ${T.border}`, borderRadius: T.radius, boxShadow: T.shadowMd, zIndex: 1000, minWidth: 170, overflow: 'hidden' }}>
          {filtered.map(name => (
            <div key={name}
              onMouseDown={e => { e.preventDefault(); selectMention(name) }}
              style={{ padding: '7px 12px', cursor: 'pointer', fontSize: 13, color: T.text, display: 'flex', alignItems: 'center', gap: 8 }}
              onMouseEnter={e => e.currentTarget.style.background = T.bg}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
              <div style={{ width: 20, height: 20, borderRadius: '50%', background: T.primary, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontWeight: 700, fontSize: 10, flexShrink: 0 }}>{name[0]?.toUpperCase()}</div>
              @{name}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Reply Item ───────────────────────────────────────────────────────────────
function ReplyItem({ reply, onDelete }) {
  const [hov, setHov] = useState(false)
  return (
    <div onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}
      style={{ position: 'relative', display: 'flex', gap: 8 }}>
      <div style={{ width: 24, height: 24, borderRadius: '50%', background: reply.color || T.primary, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontWeight: 700, fontSize: 11, flexShrink: 0, marginTop: 1 }}>{reply.author[0]?.toUpperCase()}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 2 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: T.text }}>{reply.author}</span>
          <span style={{ fontSize: 10, color: T.textMuted }}>{new Date(reply.created_at).toLocaleString()}</span>
        </div>
        <div style={{ fontSize: 12, color: T.text, lineHeight: 1.55 }}>{renderText(reply.text)}</div>
        {reply.image_url && (
          <a href={reply.image_url} target="_blank" rel="noopener noreferrer"
            style={{ display: 'block', marginTop: 6, borderRadius: 6, overflow: 'hidden', border: `1px solid ${T.border}` }}>
            <img src={reply.image_url} alt="attachment" style={{ width: '100%', display: 'block', maxHeight: 120, objectFit: 'cover' }} />
          </a>
        )}
      </div>
      {hov && (
        <button onClick={() => onDelete(reply.id)}
          style={{ position: 'absolute', top: 0, right: 0, background: 'none', border: 'none', color: T.textMuted, cursor: 'pointer', fontSize: 14, padding: '0 2px', lineHeight: 1 }}>×</button>
      )}
    </div>
  )
}

// ─── Project Card ─────────────────────────────────────────────────────────────
function ProjectCard({ project, onOpen, onDelete, onRename }) {
  const [hov, setHov] = useState(false)

  return (
    <div onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}
      style={{ background: T.surface, borderRadius: T.radiusLg, border: `1px solid ${hov ? T.borderHov : T.border}`, overflow: 'hidden', transition: 'all 0.15s', boxShadow: hov ? T.shadowMd : T.shadow, transform: hov ? 'translateY(-2px)' : 'none', position: 'relative', display: 'flex', flexDirection: 'column' }}>

      {/* Thumbnail */}
      <div onClick={() => onOpen(project)} style={{ height: 148, background: T.bg, overflow: 'hidden', position: 'relative', flexShrink: 0, cursor: 'pointer' }}>
        {project.thumbnail_url
          ? <img src={project.thumbnail_url} alt={project.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          : <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 40, color: T.textMuted }}>{project.type === 'pdf' ? '📄' : '🖼️'}</div>}
        <div style={{ position: 'absolute', top: 10, left: 10 }}>
          <Badge color="gray">{project.type === 'pdf' ? `PDF · ${project.page_count}p` : 'Image'}</Badge>
        </div>
      </div>

      {/* Info */}
      <div style={{ padding: '12px 14px', flex: 1 }}>
        <div style={{ marginBottom: 8, overflow: 'hidden' }}>
          <InlineName name={project.name} onCommit={newName => onRename(project.key, newName)}
            style={{ fontSize: 14, fontWeight: 600, color: T.text, display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} />
          {hov && <div style={{ fontSize: 10, color: T.textMuted, marginTop: 2 }}>Double-click name to rename</div>}
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

      {hov && (
        <button onClick={e => { e.stopPropagation(); onDelete(project.key) }}
          style={{ position: 'absolute', top: 10, right: 10, width: 28, height: 28, borderRadius: 6, background: 'rgba(255,255,255,0.95)', border: `1px solid ${T.border}`, color: T.danger, cursor: 'pointer', fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: T.shadow }}>×</button>
      )}
    </div>
  )
}

// ─── Page Canvas (one per page, stacked vertically) ───────────────────────────
function PageCanvas({ pageIndex, url, comments, placing, onPlace, onSelectComment, selectedId, pendingPage, pendingPos }) {
  const imgRef = useRef()

  function handleClick(e) {
    if (!placing) return
    const rect = imgRef.current.getBoundingClientRect()
    onPlace(pageIndex, { x: ((e.clientX - rect.left) / rect.width) * 100, y: ((e.clientY - rect.top) / rect.height) * 100 })
  }

  return (
    <div style={{ marginBottom: 24 }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: T.textMuted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>Page {pageIndex + 1}</div>
      <div style={{ position: 'relative', borderRadius: T.radius, overflow: 'hidden', boxShadow: T.shadowLg }}>
        <img ref={imgRef} src={url} alt={`Page ${pageIndex + 1}`} onClick={handleClick}
          style={{ display: 'block', width: '100%', cursor: placing ? 'crosshair' : 'default', userSelect: 'none' }}
          draggable={false} />
        {comments.map(c => (
          <div key={c.id} onClick={e => { e.stopPropagation(); onSelectComment(c) }}
            title={`${c.author}: ${c.text}`}
            style={{ position: 'absolute', left: `${c.x}%`, top: `${c.y}%`, transform: 'translate(-50%, -100%)', cursor: 'pointer', zIndex: 10, filter: selectedId === c.id ? `drop-shadow(0 0 6px ${c.color})` : 'drop-shadow(0 2px 6px rgba(0,0,0,0.3))', transition: 'filter 0.15s' }}>
            <div style={{ width: 32, height: 32, borderRadius: '50% 50% 50% 0', background: c.resolved ? T.textMuted : c.color, border: '2.5px solid white', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontWeight: 800, fontSize: 13, opacity: c.resolved ? 0.5 : 1 }}>
              {c.author[0]?.toUpperCase()}
            </div>
          </div>
        ))}
        {pendingPage === pageIndex && pendingPos && (
          <div style={{ position: 'absolute', left: `${pendingPos.x}%`, top: `${pendingPos.y}%`, transform: 'translate(-50%, -100%)', width: 32, height: 32, borderRadius: '50% 50% 50% 0', background: '#0D7C66', border: '2.5px solid white', opacity: 0.85, pointerEvents: 'none', animation: 'bob 0.8s ease-in-out infinite' }} />
        )}
      </div>
    </div>
  )
}

// ─── Main App ─────────────────────────────────────────────────────────────────
export default function App() {
  const [view, setView] = useState('gallery')
  const [projects, setProjects] = useState([])
  const [activeProject, setActiveProject] = useState(null)
  const [pageUrls, setPageUrls] = useState([])
  const [allComments, setAllComments] = useState([])
  const [placing, setPlacing] = useState(false)
  const [pendingPage, setPendingPage] = useState(null)
  const [pendingPos, setPendingPos] = useState(null)
  const [form, setForm] = useState({ author: '', text: '', color: 0 })
  const [commentImage, setCommentImage] = useState(null)
  const commentImageRef = useRef()
  const [selected, setSelected] = useState(null)
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState('')
  const [showList, setShowList] = useState(false)
  const fileRef = useRef()
  const realtimeRef = useRef()

  // ── Reply state ──
  const [replies, setReplies] = useState([])
  const [showReplyForm, setShowReplyForm] = useState(false)
  const [replyForm, setReplyForm] = useState({ author: '', text: '' })
  const [savingReply, setSavingReply] = useState(false)
  const repliesRealtimeRef = useRef()

  useEffect(() => { loadProjects() }, [])

  useEffect(() => {
    if (!activeProject) return
    loadAllComments()
    if (realtimeRef.current) realtimeRef.current.unsubscribe()
    realtimeRef.current = supabase
      .channel(`proj-${activeProject.key}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'comments', filter: `project_key=eq.${activeProject.key}` }, loadAllComments)
      .subscribe()
    return () => { if (realtimeRef.current) realtimeRef.current.unsubscribe() }
  }, [activeProject])

  // Load + subscribe to replies when selected comment changes
  useEffect(() => {
    if (!selected) {
      setReplies([])
      setShowReplyForm(false)
      return
    }
    loadReplies(selected.id)
    if (repliesRealtimeRef.current) repliesRealtimeRef.current.unsubscribe()
    repliesRealtimeRef.current = supabase
      .channel(`replies-${selected.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'replies', filter: `comment_id=eq.${selected.id}` }, () => loadReplies(selected.id))
      .subscribe()
    return () => { if (repliesRealtimeRef.current) repliesRealtimeRef.current.unsubscribe() }
  }, [selected?.id])

  async function loadProjects() {
    try { setProjects((await getProjects()) || []) } catch (e) { console.error(e) }
  }

  async function loadAllComments() {
    if (!activeProject) return
    try { setAllComments((await getAllProjectComments(activeProject.key)) || []) } catch {}
  }

  async function loadReplies(commentId) {
    try { setReplies((await getReplies(commentId)) || []) } catch {}
  }

  async function handleFile(e) {
    const file = e.target.files[0]; if (!file) return
    setUploading(true); setUploadProgress('Reading file…')
    try {
      const isPDF = file.type === 'application/pdf'
      const key = makeProjectKey(file)
      const name = file.name.replace(/\.[^.]+$/, '')
      let dataUrls = []
      if (isPDF) { setUploadProgress('Rendering PDF pages…'); dataUrls = await renderPDF(file) }
      else { dataUrls = await new Promise(res => { const r = new FileReader(); r.onload = ev => res([ev.target.result]); r.readAsDataURL(file) }) }
      const uploadedUrls = []
      for (let i = 0; i < dataUrls.length; i++) {
        setUploadProgress(`Uploading page ${i + 1} of ${dataUrls.length}…`)
        uploadedUrls.push(await uploadPage(key, i, dataUrls[i]))
      }
      const project = { key, name, type: isPDF ? 'pdf' : 'image', page_count: dataUrls.length, thumbnail_url: uploadedUrls[0], open_count: 0, resolved_count: 0, uploaded_at: new Date().toISOString() }
      setUploadProgress('Saving…')
      await upsertProject(project); await loadProjects()
      setPageUrls(uploadedUrls); setActiveProject(project); setAllComments([])
      setSelected(null); setPendingPage(null); setPendingPos(null); setPlacing(false); setShowList(false)
      setView('review')
    } catch (err) { alert('Upload failed: ' + err.message) }
    finally { setUploading(false); setUploadProgress(''); e.target.value = '' }
  }

  async function openProject(project) {
    setLoading(true); setActiveProject(project)
    setAllComments([]); setSelected(null); setPendingPage(null); setPendingPos(null); setPlacing(false); setShowList(false)
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

  async function handleRename(key, newName) {
    try {
      await supabase.from('projects').update({ name: newName }).eq('key', key)
      setProjects(prev => prev.map(p => p.key === key ? { ...p, name: newName } : p))
      if (activeProject?.key === key) setActiveProject(p => ({ ...p, name: newName }))
    } catch (e) { alert('Rename failed: ' + e.message) }
  }

  function handlePlace(pageIndex, pos) {
    setPendingPage(pageIndex); setPendingPos(pos); setPlacing(false)
  }

  async function dropComment() {
    if (!form.author.trim() || !form.text.trim() || pendingPage === null) return
    setSaving(true)
    try {
      let image_url = null
      if (commentImage) {
        image_url = await uploadCommentImage(activeProject.key, commentImage.file)
      }
      await addComment({ project_key: activeProject.key, page: pendingPage, x: pendingPos.x, y: pendingPos.y, author: form.author.trim(), text: form.text.trim(), color: COLORS[form.color].bg, resolved: false, image_url })
      setPendingPage(null); setPendingPos(null); setForm(f => ({ ...f, text: '' })); setCommentImage(null)
      await updateProjectCounts(activeProject.key)
    } catch (e) { alert('Failed to save: ' + e.message) }
    setSaving(false)
  }

  async function handleResolve(comment) {
    try {
      await updateComment(comment.id, { resolved: !comment.resolved })
      await loadAllComments(); await updateProjectCounts(activeProject.key)
      setSelected(c => c?.id === comment.id ? { ...c, resolved: !c.resolved } : c)
    } catch (e) { alert('Failed: ' + e.message) }
  }

  async function handleDelete(id) {
    try {
      await deleteComment(id)
      setSelected(null)
      setReplies([])
      setShowReplyForm(false)
      await updateProjectCounts(activeProject.key)
    } catch (e) { alert('Failed: ' + e.message) }
  }

  async function submitReply() {
    if (!replyForm.author.trim() || !replyForm.text.trim()) return
    setSavingReply(true)
    try {
      await addReply({ comment_id: selected.id, author: replyForm.author.trim(), text: replyForm.text.trim(), color: selected.color })
      setReplyForm(f => ({ ...f, text: '' }))
      setShowReplyForm(false)
    } catch (e) { alert('Failed: ' + e.message) }
    setSavingReply(false)
  }

  async function handleDeleteReply(id) {
    try {
      await deleteReply(id)
      setReplies(prev => prev.filter(r => r.id !== id))
    } catch (e) { alert('Failed: ' + e.message) }
  }

  async function updateProjectCounts(projectKey) {
    const all = await getAllProjectComments(projectKey)
    const open_count = all.filter(c => !c.resolved).length
    const resolved_count = all.filter(c => c.resolved).length
    await supabase.from('projects').update({ open_count, resolved_count }).eq('key', projectKey)
    setProjects(prev => prev.map(p => p.key === projectKey ? { ...p, open_count, resolved_count } : p))
  }

  const openComments = allComments.filter(c => !c.resolved)
  const doneComments = allComments.filter(c => c.resolved)
  const knownAuthors = [...new Set(allComments.map(c => c.author).filter(Boolean))]

  return (
    <div style={{ fontFamily: "'Inter', system-ui, sans-serif", height: '100vh', display: 'flex', flexDirection: 'column', background: T.bg, color: T.text }}>

      {/* ── Header ── */}
      <header style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '0 20px', background: T.surface, borderBottom: `1px solid ${T.border}`, flexShrink: 0, height: 56, boxShadow: T.shadow }}>
        <button onClick={() => setView('gallery')}
          style={{ display: 'flex', alignItems: 'center', gap: 8, border: 'none', background: 'none', cursor: 'pointer', padding: 0 }}>
          <div style={{ width: 28, height: 28, borderRadius: 7, background: T.primary, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontWeight: 800, fontSize: 14 }}>R</div>
          <span style={{ fontWeight: 700, fontSize: 16, color: T.navy, letterSpacing: -0.3 }}>ReviewDrop</span>
        </button>
        <div style={{ width: 1, height: 24, background: T.border }} />
        <nav style={{ display: 'flex', gap: 2 }}>
          {[{ id: 'gallery', label: '🗂 Projects', count: projects.length }].concat(activeProject ? [{ id: 'review', label: '✏️ Review' }] : []).map(item => (
            <button key={item.id} onClick={() => setView(item.id)}
              style={{ padding: '6px 12px', borderRadius: T.radius, background: view === item.id ? T.primaryBg : 'transparent', color: view === item.id ? T.primary : T.textSub, border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: view === item.id ? 600 : 500, display: 'flex', alignItems: 'center', gap: 6 }}>
              {item.label}
              {item.count > 0 && <span style={{ background: T.border, color: T.textSub, borderRadius: 10, padding: '0 6px', fontSize: 11 }}>{item.count}</span>}
            </button>
          ))}
        </nav>

        {/* Breadcrumb with double-click rename */}
        {view === 'review' && activeProject && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 4 }}>
            <span style={{ color: T.textMuted }}>›</span>
            <InlineName
              name={activeProject.name}
              onCommit={newName => handleRename(activeProject.key, newName)}
              style={{ fontSize: 13, fontWeight: 600, color: T.text, maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
              inputStyle={{ fontSize: 13, width: 200 }}
            />
          </div>
        )}

        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
          {view === 'review' && activeProject && (
            <>
              <Btn variant={placing ? 'danger' : 'secondary'} onClick={() => { setPlacing(!placing); setPendingPage(null); setPendingPos(null) }}>
                {placing ? '✕ Cancel' : '📌 Pin Comment'}
              </Btn>
              <Btn variant="secondary" onClick={() => { setShowList(!showList); setSelected(null) }}>
                {openComments.length > 0 && <span style={{ background: T.danger, color: 'white', borderRadius: 10, padding: '0 5px', fontSize: 10, fontWeight: 800 }}>{openComments.length}</span>}
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
                <div style={{ fontSize: 14, color: T.textSub, lineHeight: 1.7 }}>Upload a screenshot or PDF to get started. Each file becomes a project your team can comment on in real time.</div>
              </div>
              <Btn size="lg" onClick={() => fileRef.current.click()}>↑ Upload Screenshot or PDF</Btn>
              <div style={{ display: 'flex', gap: 10 }}>
                {[{ icon: '🖼️', label: 'PNG / JPG / WebP' }, { icon: '📄', label: 'PDF (multi-page)' }].map(t => (
                  <div key={t.label} style={{ padding: '8px 16px', borderRadius: T.radius, background: T.surface, border: `1px solid ${T.border}`, fontSize: 12, color: T.textSub, display: 'flex', gap: 6, alignItems: 'center' }}>
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
                {projects.map(p => <ProjectCard key={p.key} project={p} onOpen={openProject} onDelete={handleDeleteProject} onRename={handleRename} />)}
              </div>
            </>
          )}
        </div>
      )}

      {/* ── REVIEW ── */}
      {view === 'review' && (
        <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>

          {/* Scrollable canvas — all pages stacked */}
          <div style={{ flex: 1, overflow: 'auto', background: '#E8EAED', padding: 24 }}>
            {loading ? (
              <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: T.textSub, gap: 8 }}>⏳ Loading…</div>
            ) : pageUrls.length === 0 ? (
              <div style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12 }}>
                <span style={{ fontSize: 32 }}>⚠️</span>
                <div style={{ fontSize: 14, color: T.textSub }}>Could not load this file.</div>
                <Btn variant="secondary" onClick={() => setView('gallery')}>← Back to Projects</Btn>
              </div>
            ) : (
              pageUrls.map((url, i) => (
                <PageCanvas key={i} pageIndex={i} url={url}
                  comments={allComments.filter(c => c.page === i)}
                  placing={placing}
                  onPlace={handlePlace}
                  onSelectComment={c => { setSelected(c); setShowList(false); setShowReplyForm(false) }}
                  selectedId={selected?.id}
                  pendingPage={pendingPage}
                  pendingPos={pendingPos}
                />
              ))
            )}
          </div>

          {/* Comment detail */}
          {selected && !showList && (
            <aside style={{ width: 300, background: T.surface, borderLeft: `1px solid ${T.border}`, display: 'flex', flexDirection: 'column', flexShrink: 0, boxShadow: '-2px 0 8px rgba(0,0,0,0.04)' }}>
              <div style={{ padding: '14px 16px', borderBottom: `1px solid ${T.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontWeight: 700, fontSize: 14, color: T.navy }}>Comment</span>
                <button onClick={() => setSelected(null)} style={{ background: 'none', border: 'none', color: T.textMuted, cursor: 'pointer', fontSize: 20, lineHeight: 1 }}>×</button>
              </div>
              <div style={{ padding: 16, flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 12 }}>

                {/* Main comment */}
                <div style={{ borderLeft: `3px solid ${selected.color}`, background: T.bg, borderRadius: `0 ${T.radius} ${T.radius} 0`, padding: '12px 12px 12px 14px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                    <div style={{ width: 30, height: 30, borderRadius: '50%', background: selected.color, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontWeight: 700, fontSize: 13, flexShrink: 0 }}>{selected.author[0]?.toUpperCase()}</div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: T.text }}>{selected.author}</div>
                      <div style={{ fontSize: 11, color: T.textMuted }}>{new Date(selected.created_at).toLocaleString()} · p.{selected.page + 1}</div>
                    </div>
                    {selected.resolved && <Badge color="green">✓ Done</Badge>}
                  </div>
                  <div style={{ fontSize: 13, color: T.text, lineHeight: 1.6 }}>{renderText(selected.text)}</div>
                  {selected.image_url && (
                    <a href={selected.image_url} target="_blank" rel="noopener noreferrer" style={{ display: 'block', marginTop: 10, borderRadius: T.radius, overflow: 'hidden', border: `1px solid ${T.border}` }}>
                      <img src={selected.image_url} alt="attachment" style={{ width: '100%', display: 'block', maxHeight: 200, objectFit: 'cover' }} />
                    </a>
                  )}
                </div>

                {/* Replies */}
                {replies.length > 0 && (
                  <div style={{ marginLeft: 8, paddingLeft: 12, borderLeft: `2px solid ${T.border}`, display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {replies.map(r => <ReplyItem key={r.id} reply={r} onDelete={handleDeleteReply} />)}
                  </div>
                )}

                {/* Reply button / form */}
                {!showReplyForm ? (
                  <button
                    onClick={() => {
                      setShowReplyForm(true)
                      setReplyForm(f => ({ ...f, author: f.author || form.author }))
                    }}
                    style={{ alignSelf: 'flex-start', fontSize: 12, color: T.primary, background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600, padding: '2px 0' }}>
                    ↩ Reply
                  </button>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8, background: T.bg, borderRadius: T.radius, padding: 10 }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: T.textSub, textTransform: 'uppercase', letterSpacing: 0.5 }}>Reply</div>
                    <input value={replyForm.author}
                      onChange={e => setReplyForm(f => ({ ...f, author: e.target.value }))}
                      placeholder="Your name"
                      autoFocus
                      style={{ width: '100%', padding: '7px 10px', borderRadius: T.radius, border: `1px solid ${T.border}`, background: T.surface, color: T.text, fontSize: 12, outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit' }} />
                    <MentionTextarea
                      value={replyForm.text}
                      onChange={e => setReplyForm(f => ({ ...f, text: e.target.value }))}
                      onKeyDown={e => e.key === 'Enter' && e.metaKey && submitReply()}
                      authors={knownAuthors}
                      placeholder="Reply… (type @ to tag, ⌘↵ to send)"
                      rows={2}
                    />
                    <div style={{ display: 'flex', gap: 6 }}>
                      <Btn size="sm" onClick={submitReply} disabled={!replyForm.author.trim() || !replyForm.text.trim() || savingReply}>
                        {savingReply ? 'Sending…' : 'Send'}
                      </Btn>
                      <Btn size="sm" variant="ghost" onClick={() => setShowReplyForm(false)}>Cancel</Btn>
                    </div>
                  </div>
                )}

                {/* Action buttons */}
                <div style={{ display: 'flex', gap: 8, marginTop: 'auto' }}>
                  <Btn variant={selected.resolved ? 'secondary' : 'primary'} onClick={() => handleResolve(selected)} style={{ flex: 1 }}>
                    {selected.resolved ? '↩ Reopen' : '✓ Resolve'}
                  </Btn>
                  <Btn variant="danger" onClick={() => handleDelete(selected.id)}>🗑</Btn>
                </div>
              </div>
            </aside>
          )}

          {/* Threads panel */}
          {showList && (
            <aside style={{ width: 300, background: T.surface, borderLeft: `1px solid ${T.border}`, display: 'flex', flexDirection: 'column', flexShrink: 0, overflow: 'hidden', boxShadow: '-2px 0 8px rgba(0,0,0,0.04)' }}>
              <div style={{ padding: '14px 16px', borderBottom: `1px solid ${T.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontWeight: 700, fontSize: 14, color: T.navy }}>All Threads ({allComments.length})</span>
                <button onClick={() => setShowList(false)} style={{ background: 'none', border: 'none', color: T.textMuted, cursor: 'pointer', fontSize: 20, lineHeight: 1 }}>×</button>
              </div>
              <div style={{ flex: 1, overflow: 'auto' }}>
                {allComments.length === 0 && <div style={{ padding: 24, textAlign: 'center', color: T.textSub, fontSize: 13 }}>No comments yet.</div>}
                {openComments.length > 0 && <div style={{ padding: '10px 16px 4px', fontSize: 11, color: T.textMuted, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase' }}>Open · {openComments.length}</div>}
                {openComments.map(c => (
                  <div key={c.id} onClick={() => { setSelected(c); setShowList(false); setShowReplyForm(false) }}
                    style={{ padding: '11px 16px', cursor: 'pointer', borderBottom: `1px solid ${T.border}` }}
                    onMouseEnter={e => e.currentTarget.style.background = T.bg}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                    <div style={{ display: 'flex', gap: 9 }}>
                      <div style={{ width: 26, height: 26, borderRadius: '50%', background: c.color, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontWeight: 700, fontSize: 12, flexShrink: 0, marginTop: 1 }}>{c.author[0]?.toUpperCase()}</div>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                          <span style={{ fontSize: 13, fontWeight: 600, color: T.text }}>{c.author}</span>
                          <span style={{ fontSize: 10, color: T.textMuted }}>p.{c.page + 1}</span>
                        </div>
                        <div style={{ fontSize: 12, color: T.textSub, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.image_url ? '🖼 ' : ''}{c.text}</div>
                      </div>
                    </div>
                  </div>
                ))}
                {doneComments.length > 0 && (
                  <>
                    <div style={{ padding: '10px 16px 4px', fontSize: 11, color: T.textMuted, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase', borderTop: `1px solid ${T.border}`, marginTop: 4 }}>Resolved · {doneComments.length}</div>
                    {doneComments.map(c => (
                      <div key={c.id} onClick={() => { setSelected(c); setShowList(false); setShowReplyForm(false) }}
                        style={{ padding: '11px 16px', cursor: 'pointer', borderBottom: `1px solid ${T.border}`, opacity: 0.5 }}>
                        <div style={{ display: 'flex', gap: 9 }}>
                          <div style={{ width: 26, height: 26, borderRadius: '50%', background: T.textMuted, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontWeight: 700, fontSize: 12, flexShrink: 0 }}>{c.author[0]?.toUpperCase()}</div>
                          <div>
                            <div style={{ fontSize: 13, fontWeight: 600, color: T.textSub }}>{c.author} ✓ <span style={{ fontSize: 10, color: T.textMuted }}>p.{c.page + 1}</span></div>
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

      {/* Drop comment popup */}
      {pendingPage !== null && (
        <div style={{ position: 'fixed', bottom: 24, right: 24, width: 300, background: T.surface, borderRadius: T.radiusLg, boxShadow: T.shadowLg, border: `1px solid ${T.border}`, zIndex: 9999, overflow: 'hidden' }}>
          <div style={{ padding: '12px 16px', borderBottom: `1px solid ${T.border}`, fontWeight: 700, fontSize: 14, color: T.navy, display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: T.bg }}>
            <span>📌 Comment on page {pendingPage + 1}</span>
            <button onClick={() => { setPendingPage(null); setPendingPos(null); setCommentImage(null) }} style={{ background: 'none', border: 'none', color: T.textMuted, cursor: 'pointer', fontSize: 20, lineHeight: 1 }}>×</button>
          </div>
          <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div>
              <label style={{ fontSize: 11, fontWeight: 600, color: T.textSub, textTransform: 'uppercase', letterSpacing: 0.5, display: 'block', marginBottom: 5 }}>Your name</label>
              <input value={form.author} onChange={e => setForm(f => ({ ...f, author: e.target.value }))} placeholder="e.g. Sarah" autoFocus
                style={{ width: '100%', padding: '8px 10px', borderRadius: T.radius, border: `1px solid ${T.border}`, background: T.surface, color: T.text, fontSize: 13, outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit' }} />
            </div>
            <div>
              <label style={{ fontSize: 11, fontWeight: 600, color: T.textSub, textTransform: 'uppercase', letterSpacing: 0.5, display: 'block', marginBottom: 5 }}>Feedback</label>
              <MentionTextarea
                value={form.text}
                onChange={e => setForm(f => ({ ...f, text: e.target.value }))}
                onKeyDown={e => e.key === 'Enter' && e.metaKey && dropComment()}
                authors={knownAuthors}
                placeholder="Your feedback… (type @ to tag, ⌘↵ to submit)"
                rows={3}
              />
            </div>
            <div style={{ display: 'flex', gap: 7, alignItems: 'center' }}>
              <span style={{ fontSize: 11, fontWeight: 600, color: T.textSub, textTransform: 'uppercase', letterSpacing: 0.5 }}>Color</span>
              {COLORS.map((c, i) => (
                <div key={i} onClick={() => setForm(f => ({ ...f, color: i }))}
                  style={{ width: 22, height: 22, borderRadius: '50%', background: c.bg, cursor: 'pointer', border: form.color === i ? `3px solid ${T.navy}` : '2px solid transparent', boxSizing: 'border-box', transform: form.color === i ? 'scale(1.15)' : 'scale(1)', transition: 'transform 0.1s' }} />
              ))}
            </div>

            {/* Image attachment */}
            <div>
              <input ref={commentImageRef} type="file" accept="image/*" style={{ display: 'none' }}
                onChange={e => {
                  const file = e.target.files[0]; if (!file) return
                  const preview = URL.createObjectURL(file)
                  setCommentImage({ file, preview })
                  e.target.value = ''
                }} />
              {commentImage ? (
                <div style={{ position: 'relative', borderRadius: T.radius, overflow: 'hidden', border: `1px solid ${T.border}` }}>
                  <img src={commentImage.preview} alt="attachment" style={{ width: '100%', display: 'block', maxHeight: 160, objectFit: 'cover' }} />
                  <button onClick={() => setCommentImage(null)}
                    style={{ position: 'absolute', top: 6, right: 6, width: 22, height: 22, borderRadius: '50%', background: 'rgba(0,0,0,0.6)', border: 'none', color: '#fff', cursor: 'pointer', fontSize: 14, lineHeight: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>×</button>
                </div>
              ) : (
                <button onClick={() => commentImageRef.current?.click()}
                  style={{ width: '100%', padding: '7px 10px', borderRadius: T.radius, border: `1.5px dashed ${T.border}`, background: 'transparent', color: T.textSub, fontSize: 12, cursor: 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, transition: 'border-color 0.15s' }}
                  onMouseEnter={e => e.currentTarget.style.borderColor = T.primary}
                  onMouseLeave={e => e.currentTarget.style.borderColor = T.border}>
                  🖼 Attach screenshot
                </button>
              )}
            </div>
            <Btn onClick={dropComment} disabled={!form.author.trim() || !form.text.trim() || saving} style={{ width: '100%', justifyContent: 'center' }}>
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
