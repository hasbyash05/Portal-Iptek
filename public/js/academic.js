import { fetchAuth } from './auth.js';
export const API_BASE = '/api';

export async function loadPengurusMateri() {
  loadInstructors();
  loadSchedules();
  loadMateriList('list-pengurus-materi', true);
  loadDocumentTemplates('list-pengurus-templates', true);
}

export function getAuthTokenParam() {
  const token = localStorage.getItem('iptek_token');
  return token ? `?token=${encodeURIComponent(token)}` : '';
}

export async function loadDocumentTemplates(containerId, showActions) {
  try {
    const res = await fetchAuth(`${API_BASE}/templates`);
    const data = await res.json();
    const container = document.getElementById(containerId);
    if (!container) return;
    const items = data.data || [];

    if (items.length === 0) {
      container.innerHTML = '<p class="text-muted">Belum ada template dokumen yang diunggah.</p>';
    } else {
      container.innerHTML = items.map(t => `
        <div class="materi-item" style="border: 1px solid #e4e4e7; padding: 1.2rem; border-radius: 8px; margin-bottom: 1rem; background: #ffffff;">
          <div class="materi-content">
            <span style="font-size: 0.75rem; font-weight: 700; background: #f4f4f5; color: #27272a; padding: 3px 8px; border-radius: 4px; text-transform: uppercase;">${t.category}</span>
            <h4 style="margin-top: 0.5rem; margin-bottom: 0.3rem; font-size: 1.05rem; color: #18181b;">${t.title}</h4>
            <p style="color: #4b5563; font-size: 0.88rem; margin-bottom: 0.8rem;">${t.description || 'Tidak ada deskripsi'}</p>
            <div class="materi-meta" style="font-size: 0.78rem; color: #71717a;">
              <span><i class="fa-solid fa-user"></i> Diunggah oleh: ${t.uploaded_by}</span>
            </div>
          </div>
          <div class="materi-actions" style="margin-top: 1rem; display: flex; gap: 0.5rem;">
            <a href="${t.download_url}${getAuthTokenParam()}" target="_blank" class="btn btn-primary btn-sm"><i class="fa-solid fa-download"></i> Unduh Dokumen</a>
            ${showActions ? `<button onclick="deleteDocumentTemplate(${t.id})" class="btn btn-logout btn-sm"><i class="fa-solid fa-trash"></i> Hapus</button>` : ''}
          </div>
        </div>
      `).join('');
    }
  } catch (err) {
    console.error('Gagal memuat template dokumen:', err);
  }
}

export async function submitDocumentTemplate(e) {
  e.preventDefault();
  const title = document.getElementById('template-title').value;
  const category = document.getElementById('template-category').value;
  const desc = document.getElementById('template-desc').value;
  const fileInput = document.getElementById('template-file');

  if (!fileInput.files[0]) {
    alert('Silakan pilih file template dokumen terlebih dahulu.');
    return;
  }

  const formData = new FormData();
  formData.append('title', title);
  formData.append('category', category);
  formData.append('description', desc);
  formData.append('template_file', fileInput.files[0]);

  try {
    const res = await fetchAuth(`${API_BASE}/templates`, {
      method: 'POST',
      body: formData
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || 'Gagal mengunggah template dokumen');

    alert('Template dokumen berhasil diunggah!');
    document.getElementById('template-title').value = '';
    document.getElementById('template-category').value = '';
    document.getElementById('template-desc').value = '';
    fileInput.value = '';
    loadDocumentTemplates('list-pengurus-templates', true);
  } catch (err) {
    alert(`Error: ${err.message}`);
  }
}

export async function deleteDocumentTemplate(id) {
  if (!confirm('Apakah Anda yakin ingin menghapus template dokumen ini?')) return;
  try {
    const res = await fetchAuth(`${API_BASE}/templates/${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Gagal menghapus template dokumen');
    alert('Template dokumen berhasil dihapus.');
    loadDocumentTemplates('list-pengurus-templates', true);
  } catch (err) {
    alert(`Error: ${err.message}`);
  }
}

export async function loadInstructors() {
  try {
    const res = await fetchAuth(`${API_BASE}/materials/instructors`);
    const data = await res.json();
    const select = document.getElementById('jadwal-instructor');
    if (!select) return;
    const items = data.data || [];
    select.innerHTML = '<option value="">-- Pilih Pemateri --</option>' +
      items.map(i => `<option value="${i.id}">${i.nama_lengkap}${i.divisi ? ' (' + i.divisi + ')' : ''}</option>`).join('') +
      '<option value="other" style="font-weight: bold; color: #18181b;">+ Pemateri Lainnya / Dosen Pembimbing...</option>';
  } catch (err) {
    console.error('Gagal memuat daftar pemateri:', err);
  }
}

export function toggleCustomInstructor(val) {
  const groupEl = document.getElementById('group-instructor-other');
  const inputEl = document.getElementById('jadwal-instructor-other');
  if (!groupEl) return;
  if (val === 'other') {
    groupEl.style.display = 'block';
    if (inputEl) inputEl.required = true;
  } else {
    groupEl.style.display = 'none';
    if (inputEl) {
      inputEl.required = false;
      inputEl.value = '';
    }
  }
}

export async function loadSchedules() {
  try {
    const res = await fetchAuth(`${API_BASE}/materials/schedules`);
    const data = await res.json();
    const items = data.data || [];

    // Render tabel Pengurus
    const tbody = document.getElementById('table-jadwal');
    if (tbody) {
      if (items.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" class="text-center">Belum ada jadwal pertemuan.</td></tr>';
      } else {
        tbody.innerHTML = items.map(s => {
          const dateFormatted = new Date(s.date).toLocaleDateString('id-ID', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
          const materialsList = s.materials || [];
          const materialsBadge = materialsList.map(m => `
            <span style="display: inline-flex; align-items: center; gap: 6px; background: #f4f4f5; border: 1px solid #e4e4e7; padding: 3px 8px; border-radius: 6px; font-size: 0.8rem; margin: 2px;">
              <a href="/api/materials/download/${m.id}${getAuthTokenParam()}" target="_blank" style="color: #18181b; text-decoration: none; font-weight: 600;"><i class="fa-solid fa-download"></i> ${m.title}</a>
              <button onclick="unlinkMaterial(${s.id}, ${m.id})" style="background: none; border: none; color: #dc2626; cursor: pointer; font-size: 0.85rem;" title="Lepas file ini">&times;</button>
            </span>
          `).join('');
          const materialCell = `
            <div style="display: flex; flex-wrap: wrap; gap: 4px; align-items: center;">
              ${materialsBadge}
              <button onclick="showLinkMaterial(${s.id})" class="btn btn-outline btn-sm" style="padding: 3px 8px; font-size: 0.78rem;"><i class="fa-solid fa-plus"></i> ${materialsList.length > 0 ? 'Tambah Materi' : 'Tautkan Materi'}</button>
            </div>`;
          return `
            <tr>
              <td><strong>${dateFormatted}</strong></td>
              <td>${s.topic}${s.description ? '<br><small style="color: #71717a;">' + s.description + '</small>' : ''}</td>
              <td>${s.instructor ? s.instructor.nama_lengkap : '-'}${s.instructor && s.instructor.divisi ? '<br><small style="color: #71717a;">' + s.instructor.divisi + '</small>' : ''}</td>
              <td>${materialCell}</td>
              <td><button onclick="deleteSchedule(${s.id})" class="btn btn-logout btn-sm"><i class="fa-solid fa-trash"></i></button></td>
            </tr>`;
        }).join('');
      }
    }

    // Render tabel Anggota
    const tbodyAnggota = document.getElementById('table-jadwal-anggota');
    if (tbodyAnggota) {
      if (items.length === 0) {
        tbodyAnggota.innerHTML = '<tr><td colspan="4" class="text-center">Belum ada jadwal pertemuan.</td></tr>';
      } else {
        tbodyAnggota.innerHTML = items.map(s => {
          const dateFormatted = new Date(s.date).toLocaleDateString('id-ID', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
          const materialsList = s.materials || [];
          const materialCell = materialsList.length === 0
            ? '<span style="color: #71717a;">Belum ada materi</span>'
            : `<div style="display: flex; flex-wrap: wrap; gap: 4px;">
                ${materialsList.map(m => `
                  <a href="/api/materials/download/${m.id}${getAuthTokenParam()}" target="_blank" class="btn btn-outline btn-sm" style="padding: 3px 8px; font-size: 0.8rem;"><i class="fa-solid fa-download"></i> ${m.title}</a>
                `).join('')}
               </div>`;
          return `
            <tr>
              <td><strong>${dateFormatted}</strong></td>
              <td>${s.topic}${s.description ? '<br><small style="color: #71717a;">' + s.description + '</small>' : ''}</td>
              <td>${s.instructor ? s.instructor.nama_lengkap : '-'}</td>
              <td>${materialCell}</td>
            </tr>`;
        }).join('');
      }
    }
  } catch (err) {
    console.error('Gagal memuat jadwal:', err);
  }
}

export async function unlinkMaterial(scheduleId, materialId) {
  if (!confirm('Apakah Anda yakin ingin melepaskan materi ini dari jadwal?')) return;
  try {
    const res = await fetchAuth(`${API_BASE}/materials/schedules/${scheduleId}/link/${materialId}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Gagal melepaskan materi');
    loadSchedules();
  } catch (err) {
    alert(`Error: ${err.message}`);
  }
}

export async function submitJadwal(e) {
  e.preventDefault();
  const date = document.getElementById('jadwal-date').value;
  const topic = document.getElementById('jadwal-topic').value;
  const description = document.getElementById('jadwal-desc').value;
  const instructorSelect = document.getElementById('jadwal-instructor').value;
  const instructorOther = document.getElementById('jadwal-instructor-other') ? document.getElementById('jadwal-instructor-other').value : '';

  const payload = { date, topic, description };
  if (instructorSelect === 'other') {
    if (!instructorOther || !instructorOther.trim()) {
      alert('Silakan masukkan nama pemateri / dosen pembimbing.');
      return;
    }
    payload.instructor_name = instructorOther.trim();
  } else {
    payload.instructor_id = parseInt(instructorSelect);
  }

  try {
    const res = await fetchAuth(`${API_BASE}/materials/schedules`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || 'Gagal menyimpan jadwal');

    alert('Jadwal pertemuan berhasil dibuat!');
    document.getElementById('jadwal-date').value = '';
    document.getElementById('jadwal-topic').value = '';
    document.getElementById('jadwal-desc').value = '';
    document.getElementById('jadwal-instructor').value = '';
    toggleCustomInstructor('');
    loadSchedules();
  } catch (err) {
    alert(`Error: ${err.message}`);
  }
}

export async function deleteSchedule(id) {
  if (!confirm('Apakah Anda yakin ingin menghapus jadwal ini?')) return;
  try {
    const res = await fetchAuth(`${API_BASE}/materials/schedules/${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Gagal menghapus jadwal');
    alert('Jadwal berhasil dihapus.');
    loadSchedules();
  } catch (err) {
    alert(`Error: ${err.message}`);
  }
}

export async function showLinkMaterial(scheduleId) {
  try {
    const res = await fetchAuth(`${API_BASE}/materials`);
    const data = await res.json();
    const items = data.data || [];

    if (items.length === 0) {
      alert('Belum ada materi yang diunggah. Silakan upload materi terlebih dahulu.');
      return;
    }

    document.getElementById('link-schedule-id').value = scheduleId;
    const select = document.getElementById('link-materi-select');
    select.innerHTML = '<option value="">-- Pilih Materi Pembelajaran --</option>' +
      items.map(m => `<option value="${m.id}">${m.title} (Minggu ke-${m.week_number})</option>`).join('');

    const modal = document.getElementById('modal-link-materi');
    modal.style.display = 'flex';
  } catch (err) {
    alert(`Error: ${err.message}`);
  }
}

export function closeLinkMaterialModal() {
  const modal = document.getElementById('modal-link-materi');
  if (modal) modal.style.display = 'none';
}

export async function submitLinkMaterial(e) {
  e.preventDefault();
  const scheduleId = document.getElementById('link-schedule-id').value;
  const materialId = document.getElementById('link-materi-select').value;

  if (!materialId) {
    alert('Silakan pilih materi terlebih dahulu.');
    return;
  }

  try {
    const linkRes = await fetchAuth(`${API_BASE}/materials/schedules/${scheduleId}/link`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ material_id: parseInt(materialId) })
    });
    const linkData = await linkRes.json();
    if (!linkRes.ok) throw new Error(linkData.message || 'Gagal menautkan materi');

    closeLinkMaterialModal();
    alert(linkData.message);
    loadSchedules();
  } catch (err) {
    alert(`Error: ${err.message}`);
  }
}

export async function loadMateriList(containerId, showActions) {
  try {
    const res = await fetchAuth(`${API_BASE}/materials`);
    const data = await res.json();
    const container = document.getElementById(containerId);
    const items = data.data || [];

    if (items.length === 0) {
      container.innerHTML = '<p class="text-muted">Belum ada materi yang diunggah.</p>';
    } else {
      container.innerHTML = items.map(m => `
        <div class="materi-item">
          <div class="materi-content">
            <h4>${m.title}</h4>
            <p>${m.description || 'Tidak ada deskripsi'}</p>
            <div class="materi-meta">
              <span><i class="fa-solid fa-user"></i> ${m.uploaded_by} (${m.divisi})</span>
              <span><i class="fa-solid fa-calendar"></i> Minggu ke-${m.week_number} (${m.year})</span>
            </div>
          </div>
          <div class="materi-actions">
            <a href="${m.download_url}${getAuthTokenParam()}" target="_blank" class="btn btn-outline btn-sm"><i class="fa-solid fa-download"></i> Download</a>
            ${showActions ? `<button onclick="deleteMateri(${m.id})" class="btn btn-logout btn-sm"><i class="fa-solid fa-trash"></i></button>` : ''}
          </div>
        </div>
      `).join('');
    }
  } catch (err) {
    console.error('Gagal memuat materi:', err);
  }
}

export async function submitMateri(e) {
  e.preventDefault();
  const title = document.getElementById('materi-title').value;
  const desc = document.getElementById('materi-desc').value;
  const fileInput = document.getElementById('materi-file');

  const formData = new FormData();
  formData.append('title', title);
  formData.append('description', desc);
  if (fileInput.files[0]) {
    formData.append('material_file', fileInput.files[0]);
  }

  try {
    const res = await fetchAuth(`${API_BASE}/materials`, {
      method: 'POST',
      body: formData
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || 'Gagal mengunggah materi');

    alert('Materi berhasil diunggah!');
    document.getElementById('materi-title').value = '';
    document.getElementById('materi-desc').value = '';
    fileInput.value = '';
    loadPengurusMateri();
  } catch (err) {
    alert(`Error: ${err.message}`);
  }
}

export async function deleteMateri(id) {
  if (!confirm('Apakah Anda yakin ingin menghapus materi ini?')) return;
  try {
    const res = await fetchAuth(`${API_BASE}/materials/${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Gagal menghapus materi');
    alert('Materi dihapus.');
    loadPengurusMateri();
  } catch (err) {
    alert(`Error: ${err.message}`);
  }
}

export async function loadAnggotaMateri() {
  loadSchedules();
  loadDocumentTemplates('list-anggota-templates', false);
}

