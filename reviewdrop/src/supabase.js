import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const supabase = createClient(supabaseUrl, supabaseKey)

// ─── Projects ────────────────────────────────────────────────────────────────

export async function getProjects() {
  const { data, error } = await supabase
    .from('projects')
    .select('*')
    .order('uploaded_at', { ascending: false })
  if (error) throw error
  return data
}

export async function upsertProject(project) {
  const { error } = await supabase
    .from('projects')
    .upsert(project, { onConflict: 'key' })
  if (error) throw error
}

export async function deleteProject(key) {
  // Delete comments
  await supabase.from('comments').delete().eq('project_key', key)
  // Delete storage files
  const { data: files } = await supabase.storage
    .from('reviewdrop-files')
    .list(key)
  if (files?.length) {
    const paths = files.map(f => `${key}/${f.name}`)
    await supabase.storage.from('reviewdrop-files').remove(paths)
  }
  // Delete project row
  const { error } = await supabase.from('projects').delete().eq('key', key)
  if (error) throw error
}

// ─── File Storage ─────────────────────────────────────────────────────────────

export async function uploadPage(projectKey, pageIndex, dataUrl) {
  const base64 = dataUrl.split(',')[1]
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  const blob = new Blob([bytes], { type: 'image/jpeg' })
  const path = `${projectKey}/page-${pageIndex}.jpg`
  const { error } = await supabase.storage
    .from('reviewdrop-files')
    .upload(path, blob, { upsert: true, contentType: 'image/jpeg' })
  if (error) throw error
  return getPageUrl(projectKey, pageIndex)
}

export function getPageUrl(projectKey, pageIndex) {
  const { data } = supabase.storage
    .from('reviewdrop-files')
    .getPublicUrl(`${projectKey}/page-${pageIndex}.jpg`)
  return data.publicUrl
}

// ─── Comments ────────────────────────────────────────────────────────────────

export async function getComments(projectKey, page) {
  const { data, error } = await supabase
    .from('comments')
    .select('*')
    .eq('project_key', projectKey)
    .eq('page', page)
    .order('created_at', { ascending: true })
  if (error) throw error
  return data
}

export async function getAllProjectComments(projectKey) {
  const { data, error } = await supabase
    .from('comments')
    .select('*')
    .eq('project_key', projectKey)
  if (error) throw error
  return data
}

export async function addComment(comment) {
  const { data, error } = await supabase
    .from('comments')
    .insert(comment)
    .select()
    .single()
  if (error) throw error
  return data
}

export async function updateComment(id, updates) {
  const { error } = await supabase
    .from('comments')
    .update(updates)
    .eq('id', id)
  if (error) throw error
}

export async function deleteComment(id) {
  const { error } = await supabase
    .from('comments')
    .delete()
    .eq('id', id)
  if (error) throw error
}

// ─── Comment Images ──────────────────────────────────────────────────────────

export async function uploadCommentImage(projectKey, file) {
  const ext = file.type === 'image/png' ? 'png' : file.type === 'image/gif' ? 'gif' : 'jpg'
  const uid = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2)
  const path = `${projectKey}/comments/${uid}.${ext}`
  const { error } = await supabase.storage
    .from('reviewdrop-files')
    .upload(path, file, { upsert: false, contentType: file.type })
  if (error) throw error
  const { data } = supabase.storage.from('reviewdrop-files').getPublicUrl(path)
  return data.publicUrl
}

// ─── Realtime subscription ───────────────────────────────────────────────────

export function subscribeToComments(projectKey, page, callback) {
  return supabase
    .channel(`comments-${projectKey}-${page}`)
    .on('postgres_changes', {
      event: '*',
      schema: 'public',
      table: 'comments',
      filter: `project_key=eq.${projectKey}`,
    }, callback)
    .subscribe()
}
