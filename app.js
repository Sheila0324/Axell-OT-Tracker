/* ===================================================
   OT TRACKER — Application Logic
   Supabase backend · Vanilla JS · No framework
   =================================================== */

'use strict';

// ─────────────────────────────────────────────────────────
// 1. SUPABASE CLIENT
// ─────────────────────────────────────────────────────────

const STORAGE_BUCKET = 'session-media';
let supabaseClient;

function initSupabase() {
  const url = window.SUPABASE_URL;
  const key = window.SUPABASE_ANON_KEY;

  if (!url || !key || url.includes('YOUR_PROJECT') || key.includes('YOUR_ANON')) {
    document.getElementById('app-loading').classList.add('hidden');
    document.body.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:center;min-height:100dvh;padding:24px;font-family:system-ui;text-align:center;background:#FDF8F3;">
        <div style="max-width:400px;">
          <div style="font-size:3rem;margin-bottom:16px;">⚙️</div>
          <h1 style="font-size:1.3rem;font-weight:800;color:#2C2018;margin-bottom:12px;">Setup Required</h1>
          <p style="color:#7A6857;line-height:1.6;margin-bottom:16px;">
            Open <code style="background:#F5E6D8;padding:2px 6px;border-radius:4px;">config.js</code>
            and replace the placeholder values with your real Supabase Project URL and anon key.
          </p>
          <p style="font-size:.82rem;color:#B09A86;">See <code>SETUP.md</code> for step-by-step instructions.</p>
        </div>
      </div>`;
    return false;
  }

  const { createClient } = window.supabase;
  supabaseClient = createClient(url, key);
  return true;
}

// ─────────────────────────────────────────────────────────
// 2. AUTH
// ─────────────────────────────────────────────────────────

async function getCurrentSession() {
  const { data: { session } } = await supabaseClient.auth.getSession();
  return session;
}

async function signIn(email, password) {
  const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

async function signOut() {
  await supabaseClient.auth.signOut();
}

// ─────────────────────────────────────────────────────────
// 3. DATA LAYER — Sessions
// ─────────────────────────────────────────────────────────

async function dbLoadSessions() {
  const { data, error } = await supabaseClient
    .from('sessions')
    .select(`
      id, date, therapist_name, activities, notes_recommendations,
      tags, created_at,
      session_media (id, storage_path, file_name, mime_type, thumbnail)
    `)
    .order('date', { ascending: false })
    .order('created_at', { ascending: false });

  if (error) throw error;
  return data || [];
}

async function dbGetSession(id) {
  const { data, error } = await supabaseClient
    .from('sessions')
    .select(`
      id, date, therapist_name, activities, notes_recommendations,
      tags, created_at,
      session_media (id, storage_path, file_name, mime_type, thumbnail)
    `)
    .eq('id', id)
    .single();

  if (error) throw error;
  return data;
}

async function dbUpsertSession(fields) {
  const payload = {
    date:                  fields.date,
    therapist_name:        fields.therapist_name,
    activities:            fields.activities,
    notes_recommendations: fields.notes_recommendations,
    tags:                  fields.tags,
  };
  if (fields.id) payload.id = fields.id;

  const { data, error } = await supabaseClient
    .from('sessions')
    .upsert(payload)
    .select('id')
    .single();

  if (error) throw error;
  return data.id;
}

async function dbDeleteSession(sessionId, mediaItems) {
  // Delete storage files first
  if (mediaItems && mediaItems.length > 0) {
    const paths = mediaItems.map(m => m.storage_path).filter(Boolean);
    if (paths.length) {
      await supabaseClient.storage.from(STORAGE_BUCKET).remove(paths);
    }
  }
  // Delete session record (cascades to session_media)
  const { error } = await supabaseClient.from('sessions').delete().eq('id', sessionId);
  if (error) throw error;
}

// ─────────────────────────────────────────────────────────
// 4. DATA LAYER — Media
// ─────────────────────────────────────────────────────────

async function dbUploadMedia(sessionId, file, thumbnail) {
  const ext  = file.name.split('.').pop().toLowerCase();
  const path = `${sessionId}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;

  const { error: uploadError } = await supabaseClient.storage
    .from(STORAGE_BUCKET)
    .upload(path, file, { contentType: file.type, upsert: false });

  if (uploadError) throw uploadError;

  const { error: insertError } = await supabaseClient
    .from('session_media')
    .insert({
      session_id:   sessionId,
      storage_path: path,
      file_name:    file.name,
      mime_type:    file.type,
      thumbnail:    thumbnail,
    });

  if (insertError) throw insertError;
}

async function dbDeleteMedia(mediaId, storagePath) {
  if (storagePath) {
    await supabaseClient.storage.from(STORAGE_BUCKET).remove([storagePath]);
  }
  await supabaseClient.from('session_media').delete().eq('id', mediaId);
}

async function getSignedUrl(storagePath) {
  const { data, error } = await supabaseClient.storage
    .from(STORAGE_BUCKET)
    .createSignedUrl(storagePath, 3600); // 1 hour
  if (error) throw error;
  return data.signedUrl;
}

// ─────────────────────────────────────────────────────────
// 5. DATA LAYER — Therapists (autocomplete)
// ─────────────────────────────────────────────────────────

async function dbLoadTherapists() {
  const { data, error } = await supabaseClient.from('therapists').select('name');
  if (error) return [];
  return (data || []).map(t => t.name);
}

async function dbSaveTherapist(name) {
  await supabaseClient.from('therapists').upsert({ name });
}

// ─────────────────────────────────────────────────────────
// 6. MEDIA UTILITIES — Canvas thumbnails
// ─────────────────────────────────────────────────────────

function generateImageThumbnail(file, maxSize = 160) {
  return new Promise(resolve => {
    const reader = new FileReader();
    reader.onload = e => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const ratio  = Math.min(maxSize / img.width, maxSize / img.height);
        canvas.width  = Math.round(img.width  * ratio);
        canvas.height = Math.round(img.height * ratio);
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', 0.72));
      };
      img.onerror = () => resolve(null);
      img.src = e.target.result;
    };
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(file);
  });
}

function generateVideoThumbnail(file, maxSize = 160) {
  return new Promise(resolve => {
    const url   = URL.createObjectURL(file);
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.muted   = true;
    video.playsInline = true;
    video.src     = url;
    video.onloadeddata = () => {
      video.currentTime = Math.min(0.5, video.duration / 4 || 0);
    };
    video.onseeked = () => {
      try {
        const canvas = document.createElement('canvas');
        const ratio  = Math.min(maxSize / (video.videoWidth || 160), maxSize / (video.videoHeight || 160));
        canvas.width  = Math.round((video.videoWidth  || 160) * ratio);
        canvas.height = Math.round((video.videoHeight || 160) * ratio);
        canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(url);
        resolve(canvas.toDataURL('image/jpeg', 0.72));
      } catch { URL.revokeObjectURL(url); resolve(null); }
    };
    video.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
    // Fallback if seeked never fires
    setTimeout(() => { URL.revokeObjectURL(url); resolve(null); }, 5000);
  });
}

// ─────────────────────────────────────────────────────────
// 7. STATE
// ─────────────────────────────────────────────────────────

const state = {
  sessions:         [],
  filteredSessions: [],
  currentSessionId: null,
  editSessionId:    null,
  allTags:          [],
  activeTag:        'all',
  searchQuery:      '',

  // Form
  formMediaItems:  [],   // { file?, existingId?, storagePath?, name, type, thumbnail, isNew, markedForDelete }
  formTags:        [],

  // Autocomplete cache
  therapistNames: [],
};

// ─────────────────────────────────────────────────────────
// 8. ROUTER
// ─────────────────────────────────────────────────────────

function showView(viewId) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  const el = document.getElementById(viewId);
  if (el) el.classList.add('active');
  window.scrollTo({ top: 0 });
}

// ─────────────────────────────────────────────────────────
// 9. TOAST
// ─────────────────────────────────────────────────────────

function showToast(message, type = 'default', duration = 2800) {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  const icon = type === 'success' ? '✓' : type === 'error' ? '✕' : 'ℹ';
  toast.textContent = `${icon} ${message}`;
  container.appendChild(toast);
  setTimeout(() => {
    toast.classList.add('leaving');
    toast.addEventListener('animationend', () => toast.remove(), { once: true });
  }, duration);
}

// ─────────────────────────────────────────────────────────
// 10. UTILITIES
// ─────────────────────────────────────────────────────────

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formatDate(dateStr) {
  // dateStr: YYYY-MM-DD
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return {
    day:        String(d).padStart(2, '0'),
    month:      date.toLocaleString('default', { month: 'short' }).toUpperCase(),
    year:       String(y),
    monthYear:  date.toLocaleString('default', { month: 'short' }) + ' ' + y,
    full:       date.toLocaleDateString('default', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }),
    monthGroup: date.toLocaleString('default', { month: 'long', year: 'numeric' }),
  };
}

function todayString() {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth()+1).padStart(2,'0')}-${String(n.getDate()).padStart(2,'0')}`;
}

function formatCreatedAt(ts) {
  return new Date(ts).toLocaleString('default', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit',
  });
}

function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

function truncate(str, max = 180) {
  if (!str) return '';
  return str.length > max ? str.slice(0, max).trimEnd() + '…' : str;
}

// ─────────────────────────────────────────────────────────
// 11. TIMELINE VIEW
// ─────────────────────────────────────────────────────────

async function loadAndRenderTimeline() {
  try {
    state.sessions = await dbLoadSessions();
  } catch (err) {
    console.error('Load sessions error:', err);
    showToast('Could not load sessions.', 'error');
    state.sessions = [];
  }
  rebuildTagSet();
  applyFilters();
  renderTagFilterBar();
  renderSessionCards();
  updateSessionCountLabel();
}

function rebuildTagSet() {
  const tagSet = new Set();
  state.sessions.forEach(s => (s.tags || []).forEach(t => tagSet.add(t)));
  state.allTags = [...tagSet].sort();
}

function applyFilters() {
  let result = [...state.sessions];

  if (state.activeTag && state.activeTag !== 'all') {
    result = result.filter(s => (s.tags || []).includes(state.activeTag));
  }

  if (state.searchQuery.trim()) {
    const q = state.searchQuery.toLowerCase();
    result = result.filter(s =>
      (s.activities            || '').toLowerCase().includes(q) ||
      (s.notes_recommendations || '').toLowerCase().includes(q) ||
      (s.therapist_name        || '').toLowerCase().includes(q) ||
      (s.tags || []).some(t => t.toLowerCase().includes(q))
    );
  }

  state.filteredSessions = result;
}

function updateSessionCountLabel() {
  const el    = document.getElementById('session-count-label');
  const total = state.sessions.length;
  const shown = state.filteredSessions.length;
  if (!el) return;
  if (total === 0) { el.textContent = 'No sessions yet'; }
  else if (shown === total) { el.textContent = `${total} session${total !== 1 ? 's' : ''}`; }
  else { el.textContent = `${shown} of ${total} sessions`; }
}

function renderTagFilterBar() {
  const row  = document.getElementById('tag-filter-row');
  const tags = state.allTags;
  if (!row) return;

  if (!tags.length) { row.innerHTML = ''; return; }

  row.innerHTML = [
    `<button class="tag-pill all ${state.activeTag === 'all' ? 'active' : ''}" data-tag="all">All</button>`,
    ...tags.map(t =>
      `<button class="tag-pill ${state.activeTag === t ? 'active' : ''}" data-tag="${escapeHtml(t)}">${escapeHtml(t)}</button>`
    )
  ].join('');

  row.querySelectorAll('.tag-pill').forEach(pill => {
    pill.addEventListener('click', () => {
      state.activeTag = pill.dataset.tag;
      applyFilters();
      renderTagFilterBar();
      renderSessionCards();
      updateSessionCountLabel();
    });
  });
}

function renderSessionCards() {
  const container = document.getElementById('timeline-list');
  if (!container) return;
  const sessions = state.filteredSessions;

  if (!sessions.length) {
    const isFiltered = state.activeTag !== 'all' || state.searchQuery.trim();
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">${isFiltered ? '🔍' : '🌱'}</div>
        <h2>${isFiltered ? 'No matching sessions' : 'Ready to track progress!'}</h2>
        <p>${isFiltered
          ? 'Try adjusting your search or clearing the filter.'
          : 'Tap the <strong>+</strong> button to add your first session after an OT appointment.'
        }</p>
      </div>`;
    return;
  }

  let lastMonthGroup = null;
  const fragments = [];

  for (const session of sessions) {
    const d = formatDate(session.date);
    if (d.monthGroup !== lastMonthGroup) {
      lastMonthGroup = d.monthGroup;
      fragments.push(`<div class="timeline-month-divider"><span>${escapeHtml(d.monthGroup)}</span></div>`);
    }
    fragments.push(buildCardHTML(session));
  }

  container.innerHTML = fragments.join('');

  container.querySelectorAll('.session-card').forEach(card => {
    card.addEventListener('click', () => openDetail(card.dataset.id));
    card.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(card.dataset.id); }
    });
  });
}

function buildCardHTML(session) {
  const d    = formatDate(session.date);
  const tags = (session.tags || [])
    .map(t => `<span class="tag-chip">${escapeHtml(t)}</span>`).join('');

  const preview = truncate(
    [session.activities, session.notes_recommendations].filter(Boolean).join(' · ')
  );

  const media = session.session_media || [];
  let mediaHTML = '';

  if (media.length) {
    const maxThumb = Math.min(3, media.length);
    const thumbs = [];
    for (let i = 0; i < maxThumb; i++) {
      const m       = media[i];
      const isVideo = (m.mime_type || '').startsWith('video/');
      if (m.thumbnail) {
        thumbs.push(`
          <div class="media-thumb ${isVideo ? 'video-thumb' : ''}">
            <img src="${m.thumbnail}" alt="${escapeHtml(m.file_name || '')}" loading="lazy" />
          </div>`);
      } else {
        thumbs.push(`<div class="media-thumb" style="display:flex;align-items:center;justify-content:center;font-size:1.5rem;">${isVideo ? '🎬' : '🖼️'}</div>`);
      }
    }
    const extra = media.length - maxThumb;
    if (extra > 0) thumbs.push(`<div class="media-more">+${extra}</div>`);
    mediaHTML = `<div class="card-media-strip">${thumbs.join('')}</div>`;
  }

  return `
    <article class="session-card" data-id="${escapeHtml(String(session.id))}" role="listitem" tabindex="0"
      aria-label="Session on ${escapeHtml(d.full)}, therapist: ${escapeHtml(session.therapist_name || 'Unknown')}">
      <div class="card-header">
        <div class="date-badge" aria-hidden="true">
          <div class="day">${d.day}</div>
          <div class="month">${d.month}</div>
        </div>
        <div class="card-meta">
          <div class="card-therapist">
            <span class="therapist-chip">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
              ${escapeHtml(session.therapist_name || 'Unknown')}
            </span>
            <span class="card-year">${d.year}</span>
          </div>
          ${preview ? `<div class="card-preview">${escapeHtml(preview)}</div>` : ''}
        </div>
      </div>
      ${tags ? `<div class="card-tags">${tags}</div>` : ''}
      ${mediaHTML}
    </article>`;
}

// ─────────────────────────────────────────────────────────
// 12. DETAIL VIEW
// ─────────────────────────────────────────────────────────

let detailMediaRecords = [];
let lightboxIndex = 0;

async function openDetail(sessionId) {
  state.currentSessionId = sessionId;

  // Find session in loaded state first (fast), fall back to DB fetch
  let session = state.sessions.find(s => String(s.id) === String(sessionId));
  if (!session) {
    try { session = await dbGetSession(sessionId); }
    catch { showToast('Session not found.', 'error'); return; }
  }

  const d = formatDate(session.date);

  document.getElementById('detail-day').textContent        = d.day;
  document.getElementById('detail-month-year').textContent = `${d.month} ${d.year}`;
  document.getElementById('detail-therapist').textContent  = session.therapist_name || '—';

  const tagsEl = document.getElementById('detail-tags');
  tagsEl.innerHTML = (session.tags || [])
    .map(t => `<span class="tag-chip">${escapeHtml(t)}</span>`).join('');

  document.getElementById('detail-activities').textContent =
    session.activities || '(no activities recorded)';
  document.getElementById('detail-notes').textContent =
    session.notes_recommendations || '(no notes recorded)';
  document.getElementById('detail-created-at').textContent =
    formatCreatedAt(session.created_at);

  // Media gallery — use thumbnails, load full URLs lazily on lightbox open
  detailMediaRecords = session.session_media || [];
  const grid         = document.getElementById('detail-media-grid');
  const mediaSection = document.getElementById('detail-media-section');

  if (!detailMediaRecords.length) {
    mediaSection.style.display = 'none';
    grid.innerHTML = '';
  } else {
    mediaSection.style.display = '';
    grid.innerHTML = '';

    detailMediaRecords.forEach((m, idx) => {
      const isVideo = (m.mime_type || '').startsWith('video/');
      const item    = document.createElement('div');
      item.className = 'gallery-item';
      item.setAttribute('role', 'button');
      item.setAttribute('tabindex', '0');
      item.setAttribute('aria-label', `${isVideo ? 'Video' : 'Photo'}: ${m.file_name || ''}`);

      if (isVideo) {
        item.innerHTML = `
          <img src="${m.thumbnail || ''}" alt="${escapeHtml(m.file_name || '')}"
               style="width:100%;height:100%;object-fit:cover;" />
          <div class="play-btn" aria-hidden="true">▶</div>`;
      } else {
        item.innerHTML = `<img src="${m.thumbnail || ''}" alt="${escapeHtml(m.file_name || '')}" />`;
      }

      item.addEventListener('click', () => openLightbox(idx));
      item.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openLightbox(idx); }
      });
      grid.appendChild(item);
    });
  }

  showView('view-detail');
}

// ─────────────────────────────────────────────────────────
// 13. LIGHTBOX
// ─────────────────────────────────────────────────────────

function openLightbox(index) {
  lightboxIndex = index;
  document.getElementById('lightbox').classList.add('open');
  document.body.style.overflow = 'hidden';
  renderLightboxItem();
}

function closeLightbox() {
  document.getElementById('lightbox').classList.remove('open');
  document.body.style.overflow = '';
  const content = document.getElementById('lightbox-content');
  content.querySelectorAll('video').forEach(v => v.pause());
  content.innerHTML = '';
}

async function renderLightboxItem() {
  const content = document.getElementById('lightbox-content');
  const counter = document.getElementById('lightbox-counter');
  content.querySelectorAll('video').forEach(v => v.pause());

  const m = detailMediaRecords[lightboxIndex];
  if (!m) return;

  counter.textContent = `${lightboxIndex + 1} / ${detailMediaRecords.length}`;
  document.getElementById('lightbox-prev').style.display = lightboxIndex > 0 ? '' : 'none';
  document.getElementById('lightbox-next').style.display =
    lightboxIndex < detailMediaRecords.length - 1 ? '' : 'none';

  // Show thumbnail immediately while loading full URL
  const isVideo = (m.mime_type || '').startsWith('video/');
  if (m.thumbnail) {
    content.innerHTML = `<img src="${m.thumbnail}" alt="Loading…"
      style="max-width:94vw;max-height:80dvh;border-radius:12px;object-fit:contain;" />`;
  } else {
    content.innerHTML = `<div style="color:white;font-size:0.9rem;">Loading…</div>`;
  }

  try {
    const url = await getSignedUrl(m.storage_path);
    if (isVideo) {
      content.innerHTML = `
        <video controls autoplay playsinline
          style="max-width:94vw;max-height:80dvh;border-radius:12px;">
          <source src="${url}" type="${escapeHtml(m.mime_type || '')}" />
        </video>`;
    } else {
      content.innerHTML = `<img src="${url}" alt="${escapeHtml(m.file_name || '')}"
        style="max-width:94vw;max-height:80dvh;border-radius:12px;object-fit:contain;" />`;
    }
  } catch (err) {
    console.error('Signed URL error:', err);
    content.innerHTML = `<div style="color:rgba(255,255,255,.7);font-size:.9rem;text-align:center;">
      Could not load media.<br><small>Check your connection.</small></div>`;
  }
}

// ─────────────────────────────────────────────────────────
// 14. ADD / EDIT MODAL
// ─────────────────────────────────────────────────────────

function openModal(sessionId = null) {
  state.editSessionId  = sessionId;
  state.formMediaItems = [];
  state.formTags       = [];

  const title   = document.getElementById('modal-title');
  const saveBtn = document.getElementById('btn-save');

  title.textContent = sessionId ? 'Edit Session' : 'New Session';
  saveBtn.innerHTML = `
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
      <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/>
      <polyline points="17 21 17 13 7 13 7 21"/>
      <polyline points="7 3 7 8 15 8"/>
    </svg>
    ${sessionId ? 'Save Changes' : 'Save Session'}`;

  resetForm();

  if (sessionId) {
    populateFormForEdit(sessionId);
  } else {
    document.getElementById('field-date').value = todayString();
  }

  document.getElementById('modal-entry').classList.add('open');
  document.body.style.overflow = 'hidden';
  setTimeout(() => document.getElementById('field-date').focus(), 350);
}

function closeModal() {
  document.getElementById('modal-entry').classList.remove('open');
  document.body.style.overflow = '';
  resetForm();
}

function resetForm() {
  const form = document.getElementById('entry-form');
  if (form) form.reset();
  ['field-date', 'field-therapist', 'field-activities', 'field-notes'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  state.formTags = [];
  renderFormTags();
  state.formMediaItems = [];
  document.getElementById('media-preview-grid').innerHTML = '';
}

async function populateFormForEdit(sessionId) {
  let session = state.sessions.find(s => String(s.id) === String(sessionId));
  if (!session) {
    try { session = await dbGetSession(sessionId); }
    catch { return; }
  }

  document.getElementById('field-date').value       = session.date;
  document.getElementById('field-therapist').value  = session.therapist_name || '';
  document.getElementById('field-activities').value = session.activities || '';
  document.getElementById('field-notes').value      = session.notes_recommendations || '';

  state.formTags = [...(session.tags || [])];
  renderFormTags();

  for (const m of (session.session_media || [])) {
    state.formMediaItems.push({
      existingId:    m.id,
      storagePath:   m.storage_path,
      name:          m.file_name,
      type:          m.mime_type,
      thumbnail:     m.thumbnail,
      isNew:         false,
      markedForDelete: false,
    });
  }
  renderFormMediaPreviews();
}

// ─────────────────────────────────────────────────────────
// 15. TAGS INPUT
// ─────────────────────────────────────────────────────────

function renderFormTags() {
  const wrap  = document.getElementById('tags-input-wrap');
  const input = document.getElementById('tags-text-input');
  if (!wrap || !input) return;

  wrap.querySelectorAll('.tag-badge').forEach(b => b.remove());

  state.formTags.forEach((tag, i) => {
    const badge = document.createElement('span');
    badge.className = 'tag-badge';
    badge.innerHTML = `${escapeHtml(tag)}<button type="button" class="remove-tag" aria-label="Remove ${escapeHtml(tag)}" data-index="${i}">✕</button>`;
    badge.querySelector('.remove-tag').addEventListener('click', e => {
      e.stopPropagation();
      state.formTags.splice(i, 1);
      renderFormTags();
    });
    wrap.insertBefore(badge, input);
  });
}

function addTag(raw) {
  const tag = raw.trim().toLowerCase().replace(/,+$/, '');
  if (!tag || state.formTags.includes(tag)) return;
  state.formTags.push(tag);
  renderFormTags();
}

function initTagsInput() {
  const wrap  = document.getElementById('tags-input-wrap');
  const input = document.getElementById('tags-text-input');
  if (!wrap || !input) return;

  input.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      if (input.value.trim()) { addTag(input.value); input.value = ''; }
    } else if (e.key === 'Backspace' && !input.value && state.formTags.length) {
      state.formTags.pop();
      renderFormTags();
    }
  });

  input.addEventListener('blur', () => {
    if (input.value.trim()) { addTag(input.value); input.value = ''; }
  });

  wrap.addEventListener('click', () => input.focus());
}

// ─────────────────────────────────────────────────────────
// 16. MEDIA UPLOAD
// ─────────────────────────────────────────────────────────

async function handleFileInput(files) {
  for (const file of Array.from(files)) {
    const isVideo = file.type.startsWith('video/');
    const isImage = file.type.startsWith('image/');
    if (!isVideo && !isImage) {
      showToast(`Skipped "${file.name}" — only images and videos.`, 'error');
      continue;
    }

    let thumbnail = null;
    try {
      thumbnail = isVideo ? await generateVideoThumbnail(file) : await generateImageThumbnail(file);
    } catch (err) { console.warn('Thumbnail error:', err); }

    state.formMediaItems.push({
      file, thumbnail,
      name:  file.name,
      type:  file.type,
      isNew: true,
      markedForDelete: false,
    });
  }
  renderFormMediaPreviews();
}

function renderFormMediaPreviews() {
  const grid = document.getElementById('media-preview-grid');
  if (!grid) return;
  grid.innerHTML = '';

  state.formMediaItems
    .filter(item => !item.markedForDelete)
    .forEach((item, visualIdx) => {
      // Map visual index back to real index
      const realIdx = state.formMediaItems.indexOf(item);
      const isVideo = (item.type || '').startsWith('video/');
      const div     = document.createElement('div');
      div.className = 'preview-item';

      const thumb = item.thumbnail
        ? `<img src="${item.thumbnail}" alt="${escapeHtml(item.name || '')}" />`
        : `<div style="display:flex;align-items:center;justify-content:center;height:100%;font-size:1.8rem;">${isVideo ? '🎬' : '🖼️'}</div>`;

      div.innerHTML = `
        ${thumb}
        <button class="remove-media" aria-label="Remove ${escapeHtml(item.name || '')}" type="button">✕</button>
        <span class="media-type-badge">${isVideo ? 'VID' : 'IMG'}</span>`;

      div.querySelector('.remove-media').addEventListener('click', e => {
        e.stopPropagation();
        if (state.formMediaItems[realIdx].isNew) {
          // Just remove new items
          state.formMediaItems.splice(realIdx, 1);
        } else {
          // Mark existing items for deletion
          state.formMediaItems[realIdx].markedForDelete = true;
        }
        renderFormMediaPreviews();
      });

      grid.appendChild(div);
    });
}

function initMediaUpload() {
  const zone  = document.getElementById('media-upload-zone');
  const input = document.getElementById('media-file-input');
  if (!zone || !input) return;

  input.addEventListener('change', () => {
    if (input.files.length) handleFileInput(input.files);
    input.value = '';
  });

  zone.addEventListener('dragover',  e => { e.preventDefault(); zone.classList.add('drag-over'); });
  zone.addEventListener('dragleave', ()  => zone.classList.remove('drag-over'));
  zone.addEventListener('drop', e => {
    e.preventDefault();
    zone.classList.remove('drag-over');
    if (e.dataTransfer.files.length) handleFileInput(e.dataTransfer.files);
  });
}

// ─────────────────────────────────────────────────────────
// 17. THERAPIST AUTOCOMPLETE
// ─────────────────────────────────────────────────────────

function initTherapistAutocomplete() {
  const input    = document.getElementById('field-therapist');
  const dropdown = document.getElementById('therapist-dropdown');
  if (!input || !dropdown) return;

  function showDropdown(matches) {
    if (!matches.length) { dropdown.classList.remove('open'); return; }
    dropdown.innerHTML = matches
      .slice(0, 6)
      .map(name => `
        <div class="autocomplete-option" role="option" tabindex="-1" data-name="${escapeHtml(name)}">
          <span class="opt-icon">👤</span>${escapeHtml(name)}
        </div>`)
      .join('');
    dropdown.querySelectorAll('.autocomplete-option').forEach(opt => {
      opt.addEventListener('mousedown', e => {
        e.preventDefault();
        input.value = opt.dataset.name;
        dropdown.classList.remove('open');
      });
      // Touch support
      opt.addEventListener('touchend', e => {
        e.preventDefault();
        input.value = opt.dataset.name;
        dropdown.classList.remove('open');
      });
    });
    dropdown.classList.add('open');
  }

  input.addEventListener('input', () => {
    const q = input.value.trim().toLowerCase();
    const matches = q
      ? state.therapistNames.filter(n => n.toLowerCase().includes(q))
      : state.therapistNames;
    showDropdown(matches);
  });

  input.addEventListener('focus', () => {
    if (state.therapistNames.length) showDropdown(
      input.value.trim()
        ? state.therapistNames.filter(n => n.toLowerCase().includes(input.value.toLowerCase()))
        : state.therapistNames
    );
  });

  input.addEventListener('blur', () => setTimeout(() => dropdown.classList.remove('open'), 200));
}

// ─────────────────────────────────────────────────────────
// 18. FORM SUBMISSION
// ─────────────────────────────────────────────────────────

async function handleSave() {
  const saveBtn = document.getElementById('btn-save');
  saveBtn.disabled = true;
  saveBtn.innerHTML = `<div class="btn-spinner"></div> Saving…`;

  try {
    const date          = document.getElementById('field-date').value;
    const therapistName = document.getElementById('field-therapist').value.trim();
    const activities    = document.getElementById('field-activities').value.trim();
    const notes         = document.getElementById('field-notes').value.trim();

    if (!date) {
      showToast('Please select a date.', 'error');
      return;
    }

    // 1. Upsert session
    const sessionId = await dbUpsertSession({
      id:                    state.editSessionId || undefined,
      date,
      therapist_name:        therapistName,
      activities,
      notes_recommendations: notes,
      tags:                  [...state.formTags],
    });

    // 2. Delete removed existing media
    const toDelete = state.formMediaItems.filter(m => !m.isNew && m.markedForDelete);
    for (const item of toDelete) {
      try { await dbDeleteMedia(item.existingId, item.storagePath); }
      catch (e) { console.warn('Media delete error:', e); }
    }

    // 3. Upload new media
    const toUpload = state.formMediaItems.filter(m => m.isNew && !m.markedForDelete);
    for (const item of toUpload) {
      try { await dbUploadMedia(sessionId, item.file, item.thumbnail); }
      catch (e) {
        console.error('Upload error:', e);
        showToast(`Upload failed for "${item.name}". Continuing…`, 'error', 4000);
      }
    }

    // 4. Remember therapist
    if (therapistName) {
      dbSaveTherapist(therapistName).catch(() => {});
      if (!state.therapistNames.includes(therapistName)) {
        state.therapistNames.push(therapistName);
      }
    }

    closeModal();
    showToast(state.editSessionId ? 'Session updated!' : 'Session saved!', 'success');
    await loadAndRenderTimeline();

    // If editing from detail view, refresh it
    if (state.editSessionId) {
      await openDetail(sessionId);
    }

  } catch (err) {
    console.error('Save error:', err);
    showToast('Something went wrong. Please try again.', 'error');
  } finally {
    saveBtn.disabled = false;
    saveBtn.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/>
        <polyline points="17 21 17 13 7 13 7 21"/>
        <polyline points="7 3 7 8 15 8"/>
      </svg>
      Save Session`;
  }
}

// ─────────────────────────────────────────────────────────
// 19. DELETE SESSION
// ─────────────────────────────────────────────────────────

function openDeleteConfirm() {
  document.getElementById('confirm-dialog').classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeDeleteConfirm() {
  document.getElementById('confirm-dialog').classList.remove('open');
  document.body.style.overflow = '';
}

async function handleConfirmDelete() {
  closeDeleteConfirm();
  try {
    // Find media for this session
    const session = state.sessions.find(s => String(s.id) === String(state.currentSessionId));
    await dbDeleteSession(state.currentSessionId, session?.session_media || []);
    showToast('Session deleted.', 'default');
    await loadAndRenderTimeline();
    showView('view-timeline');
  } catch (err) {
    console.error('Delete error:', err);
    showToast('Could not delete session.', 'error');
  }
}

// ─────────────────────────────────────────────────────────
// 20. LOGIN VIEW
// ─────────────────────────────────────────────────────────

function initLoginForm() {
  const form        = document.getElementById('login-form');
  const emailInput  = document.getElementById('login-email');
  const passInput   = document.getElementById('login-password');
  const errorEl     = document.getElementById('login-error');
  const submitBtn   = document.getElementById('btn-login');
  const togglePass  = document.getElementById('toggle-password');

  // Password show/hide toggle
  togglePass.addEventListener('click', () => {
    const isPass = passInput.type === 'password';
    passInput.type = isPass ? 'text' : 'password';
    togglePass.setAttribute('aria-label', isPass ? 'Hide password' : 'Show password');
    document.getElementById('eye-icon').setAttribute('opacity', isPass ? '0.5' : '1');
  });

  form.addEventListener('submit', async e => {
    e.preventDefault();
    errorEl.classList.add('hidden');
    errorEl.textContent = '';

    const email    = emailInput.value.trim();
    const password = passInput.value;

    if (!email || !password) {
      errorEl.textContent = 'Please enter your email and password.';
      errorEl.classList.remove('hidden');
      return;
    }

    submitBtn.disabled = true;
    submitBtn.innerHTML = `<div class="btn-spinner"></div> Signing in…`;

    try {
      await signIn(email, password);
      // onAuthStateChange will handle showing the app
    } catch (err) {
      console.error('Login error:', err);
      errorEl.textContent = err.message || 'Invalid email or password.';
      errorEl.classList.remove('hidden');
      submitBtn.disabled = false;
      submitBtn.textContent = 'Sign In';
      passInput.focus();
    }
  });
}

// ─────────────────────────────────────────────────────────
// 21. SEARCH BAR
// ─────────────────────────────────────────────────────────

function initSearchBar() {
  const toggleBtn  = document.getElementById('btn-toggle-search');
  const searchBar  = document.getElementById('search-bar');
  const searchInput= document.getElementById('search-input');
  const clearBtn   = document.getElementById('search-clear');
  if (!toggleBtn || !searchBar) return;

  toggleBtn.addEventListener('click', () => {
    const isOpen = !searchBar.classList.contains('hidden');
    if (isOpen) {
      searchBar.classList.add('hidden');
      toggleBtn.classList.remove('active');
      state.searchQuery = '';
      searchInput.value = '';
      clearBtn.classList.remove('visible');
      applyFilters();
      renderSessionCards();
      updateSessionCountLabel();
    } else {
      searchBar.classList.remove('hidden');
      toggleBtn.classList.add('active');
      setTimeout(() => searchInput.focus(), 100);
    }
  });

  const doSearch = debounce(() => {
    state.searchQuery = searchInput.value;
    clearBtn.classList.toggle('visible', !!searchInput.value);
    applyFilters();
    renderSessionCards();
    updateSessionCountLabel();
  }, 280);

  searchInput.addEventListener('input', doSearch);

  clearBtn.addEventListener('click', () => {
    searchInput.value = '';
    state.searchQuery = '';
    clearBtn.classList.remove('visible');
    applyFilters();
    renderSessionCards();
    updateSessionCountLabel();
    searchInput.focus();
  });

  let lastScrollY = 0;
  window.addEventListener('scroll', () => {
    searchBar.classList.toggle('shadow', window.scrollY > 0);
    lastScrollY = window.scrollY;
  }, { passive: true });
}

// ─────────────────────────────────────────────────────────
// 22. KEYBOARD SHORTCUTS
// ─────────────────────────────────────────────────────────

function initKeyboard() {
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      if (document.getElementById('lightbox').classList.contains('open')) {
        closeLightbox();
      } else if (document.getElementById('confirm-dialog').classList.contains('open')) {
        closeDeleteConfirm();
      } else if (document.getElementById('modal-entry').classList.contains('open')) {
        closeModal();
      }
    }

    if (document.getElementById('lightbox').classList.contains('open')) {
      if (e.key === 'ArrowLeft'  && lightboxIndex > 0) { lightboxIndex--; renderLightboxItem(); }
      if (e.key === 'ArrowRight' && lightboxIndex < detailMediaRecords.length - 1) { lightboxIndex++; renderLightboxItem(); }
    }
  });
}

// ─────────────────────────────────────────────────────────
// 23. EVENT WIRING
// ─────────────────────────────────────────────────────────

function wireEvents() {
  // FAB
  document.getElementById('fab-add')?.addEventListener('click', () => openModal(null));

  // Modal
  document.getElementById('modal-close')?.addEventListener('click', closeModal);
  document.getElementById('btn-cancel')?.addEventListener('click',  closeModal);
  document.getElementById('modal-entry')?.addEventListener('click', e => {
    if (e.target === document.getElementById('modal-entry')) closeModal();
  });
  document.getElementById('btn-save')?.addEventListener('click', handleSave);

  // Back
  document.getElementById('btn-back')?.addEventListener('click', () => showView('view-timeline'));

  // Edit / Delete
  document.getElementById('btn-edit-entry')?.addEventListener('click', () => openModal(state.currentSessionId));
  document.getElementById('btn-delete-entry')?.addEventListener('click', openDeleteConfirm);

  // Confirm dialog
  document.getElementById('confirm-cancel')?.addEventListener('click', closeDeleteConfirm);
  document.getElementById('confirm-delete')?.addEventListener('click', handleConfirmDelete);

  // Lightbox
  document.getElementById('lightbox-close')?.addEventListener('click', closeLightbox);
  document.getElementById('lightbox-prev')?.addEventListener('click', () => {
    if (lightboxIndex > 0) { lightboxIndex--; renderLightboxItem(); }
  });
  document.getElementById('lightbox-next')?.addEventListener('click', () => {
    if (lightboxIndex < detailMediaRecords.length - 1) { lightboxIndex++; renderLightboxItem(); }
  });
  document.getElementById('lightbox')?.addEventListener('click', e => {
    if (e.target === document.getElementById('lightbox')) closeLightbox();
  });

  // Sign out
  document.getElementById('btn-signout')?.addEventListener('click', async () => {
    await signOut();
    // onAuthStateChange handles the rest
  });
}

// ─────────────────────────────────────────────────────────
// 24. APP BOOTSTRAP
// ─────────────────────────────────────────────────────────

async function startApp() {
  // Load therapist names for autocomplete
  state.therapistNames = await dbLoadTherapists();

  // Wire all UI events
  wireEvents();
  initTagsInput();
  initMediaUpload();
  initTherapistAutocomplete();
  initSearchBar();
  initKeyboard();

  // Show the timeline
  showView('view-timeline');
  await loadAndRenderTimeline();
}

async function init() {
  // Validate config
  if (!initSupabase()) return;

  // Init login form (visible even before auth check)
  initLoginForm();

  // Listen for auth state changes (login / logout)
  supabaseClient.auth.onAuthStateChange((event, session) => {
    if (session) {
      // Authenticated → show app
      document.getElementById('app-loading').classList.add('hidden');
      startApp().catch(err => {
        console.error('App start error:', err);
        showToast('Failed to load. Please refresh.', 'error', 6000);
      });
    } else {
      // Not authenticated → show login
      document.getElementById('app-loading').classList.add('hidden');
      showView('view-login');
    }
  });

  // Check existing session immediately (no waiting for change event)
  const existingSession = await getCurrentSession();
  if (!existingSession) {
    document.getElementById('app-loading').classList.add('hidden');
    showView('view-login');
  }
  // If session exists, onAuthStateChange INITIAL_SESSION event fires and calls startApp()
}

document.addEventListener('DOMContentLoaded', () => {
  init().catch(err => {
    console.error('Init error:', err);
    document.getElementById('app-loading').classList.add('hidden');
    showToast('Failed to start app. Please refresh.', 'error', 8000);
  });
});
