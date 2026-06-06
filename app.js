/* ==========================================================================
   APP LOGIC - DASHBOARD ABSENSI & KETERLAMBATAN SISWA (SERVERLESS)
   ========================================================================== */

// --- App State ---
let state = {
  students: [],     // Array of { id, nama, nisn, kelas }
  attendance: [],   // Array of { id, student_id, tanggal, status, keterangan }
  lateLogs: [],     // Array of { id, student_id, tanggal, jam, keterangan }
  githubSettings: {
    token: '',
    repo: '',
    branch: 'main',
    path: 'database.json'
  },
  storageMode: 'local', // 'local' or 'github'
  currentView: 'dashboard',
  theme: 'dark',
  githubSha: ''         // GitHub file SHA for updates
};

// --- Initializer ---
document.addEventListener('DOMContentLoaded', () => {
  // Load Theme
  initTheme();
  
  // Set Current Date Display
  updateDateDisplay();

  // Load Saved Settings and Data
  loadSettings();
  loadData();

  // Switch to initial view
  switchMenu('dashboard');

  // Trigger Lucide Icons rendering
  lucide.createIcons();

  // Handle outside clicks for searchable dropdown
  document.addEventListener('click', (e) => {
    const container = document.querySelector('.searchable-select-container');
    const dropdown = document.getElementById('terlambat-dropdown-list');
    if (container && !container.contains(e.target)) {
      dropdown.style.display = 'none';
    }
  });

  // Setup Drag & Drop for Excel Upload
  setupDragAndDrop();
});

// --- Theme Management ---
function initTheme() {
  const savedTheme = localStorage.getItem('theme') || 'dark';
  state.theme = savedTheme;
  if (savedTheme === 'light') {
    document.body.classList.remove('dark-theme');
    document.body.classList.add('light-theme');
    document.getElementById('theme-icon-light').style.display = 'none';
    document.getElementById('theme-icon-dark').style.display = 'block';
  } else {
    document.body.classList.remove('light-theme');
    document.body.classList.add('dark-theme');
    document.getElementById('theme-icon-light').style.display = 'block';
    document.getElementById('theme-icon-dark').style.display = 'none';
  }
}

function toggleTheme() {
  const newTheme = state.theme === 'dark' ? 'light' : 'dark';
  state.theme = newTheme;
  localStorage.setItem('theme', newTheme);
  initTheme();
  showToast(`Tema diganti ke ${newTheme === 'dark' ? 'Gelap' : 'Terang'}`, 'info');
  
  // Re-render charts to adapt to colors if needed
  if (state.currentView === 'dashboard') {
    renderDashboardCharts();
  }
}

function updateDateDisplay() {
  const dateOptions = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
  const todayStr = new Date().toLocaleDateString('id-ID', dateOptions);
  document.getElementById('current-date-display').textContent = todayStr;
  
  // Fill default dates for inputs
  const todayISO = new Date().toISOString().split('T')[0];
  const dateInputAbsensi = document.getElementById('absensi-tanggal');
  if (dateInputAbsensi) dateInputAbsensi.value = todayISO;
  
  const dateInputTerlambat = document.getElementById('terlambat-tanggal');
  if (dateInputTerlambat) dateInputTerlambat.value = todayISO;

  // Set default hours for late log
  const now = new Date();
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const timeInput = document.getElementById('terlambat-jam');
  if (timeInput) timeInput.value = `${hours}:${minutes}`;

  // Populate recap years
  const yearSelects = [
    document.getElementById('rekap-tahun'),
    document.getElementById('laporan-absen-tahun'),
    document.getElementById('laporan-terlambat-tahun')
  ];
  const currentYear = now.getFullYear();
  yearSelects.forEach(select => {
    if (select) {
      select.innerHTML = '';
      for (let y = currentYear - 2; y <= currentYear + 2; y++) {
        const option = document.createElement('option');
        option.value = y;
        option.textContent = y;
        if (y === currentYear) option.selected = true;
        select.appendChild(option);
      }
    }
  });

  // Populate recap months
  const currentMonthStr = String(now.getMonth() + 1).padStart(2, '0');
  const monthSelects = [
    document.getElementById('rekap-bulan'),
    document.getElementById('laporan-absen-bulan'),
    document.getElementById('laporan-terlambat-bulan')
  ];
  monthSelects.forEach(select => {
    if (select) {
      select.value = currentMonthStr;
    }
  });
}

// --- Local Storage Settings & Data Loader ---
function loadSettings() {
  const savedMode = localStorage.getItem('storageMode') || 'local';
  state.storageMode = savedMode;
  
  const savedGhSettings = localStorage.getItem('githubSettings');
  if (savedGhSettings) {
    state.githubSettings = JSON.parse(savedGhSettings);
  }

  // Pre-fill github form
  document.getElementById('gh-token').value = state.githubSettings.token || '';
  document.getElementById('gh-repo').value = state.githubSettings.repo || '';
  document.getElementById('gh-branch').value = state.githubSettings.branch || 'main';
  document.getElementById('gh-path').value = state.githubSettings.path || 'database.json';

  updateSyncBadge();
}

function loadData() {
  if (state.storageMode === 'github') {
    // Attempt loading from GitHub
    syncPullFromGithub(true); // silent load
  } else {
    // Load from LocalStorage
    const localDb = localStorage.getItem('schoolDb');
    if (localDb) {
      try {
        const parsed = JSON.parse(localDb);
        state.students = parsed.students || [];
        state.attendance = parsed.attendance || [];
        state.lateLogs = parsed.lateLogs || [];
      } catch (e) {
        console.error('Error parsing local DB', e);
        showToast('Gagal memuat database lokal, file rusak.', 'error');
      }
    }
    updateStorageExplanation();
    refreshAllUI();
  }
}

function saveLocalState() {
  const dbData = {
    students: state.students,
    attendance: state.attendance,
    lateLogs: state.lateLogs
  };
  localStorage.setItem('schoolDb', JSON.stringify(dbData));
}

async function persistData() {
  saveLocalState();
  if (state.storageMode === 'github') {
    await syncPushToGithub();
  }
}

// --- GitHub API Sync Engine ---
function updateSyncBadge() {
  const indicator = document.getElementById('sync-status-indicator');
  const text = document.getElementById('sync-status-text');
  
  indicator.className = 'sync-status';
  if (state.storageMode === 'local') {
    indicator.classList.add('status-offline');
    text.textContent = 'Mode Lokal (Offline)';
  } else {
    indicator.classList.add('status-connected');
    text.textContent = `Awan: ${state.githubSettings.repo}`;
  }
}

function updateStorageExplanation() {
  const expEl = document.getElementById('storage-status-explanation');
  const syncCard = document.getElementById('gh-sync-tools-card');
  if (!expEl) return;

  if (state.storageMode === 'local') {
    expEl.innerHTML = `Aplikasi sedang menggunakan <strong>Local Storage (Mode Demo)</strong> di browser Anda. Semua data disimpan secara lokal pada komputer ini. Untuk berkolaborasi dengan guru-guru lain, sambungkan ke repositori GitHub.`;
    if (syncCard) syncCard.style.display = 'none';
  } else {
    expEl.innerHTML = `Aplikasi terhubung ke GitHub repositori <strong>${state.githubSettings.repo}</strong> (${state.githubSettings.branch}). File data disimpan di <code>${state.githubSettings.path}</code>. Data tersinkronisasi otomatis saat ada perubahan.`;
    if (syncCard) syncCard.style.display = 'block';
  }
}

// Global loader toggle
function toggleLoader(show, text = 'Memuat...') {
  const overlay = document.getElementById('loading-overlay');
  const textEl = document.getElementById('loading-text');
  if (overlay) {
    overlay.style.display = show ? 'flex' : 'none';
    if (textEl) textEl.textContent = text;
  }
}

async function githubApiRequest(endpoint, method = 'GET', body = null) {
  const url = `https://api.github.com${endpoint}`;
  const headers = {
    'Authorization': `token ${state.githubSettings.token}`,
    'Accept': 'application/vnd.github.v3+json',
    'Content-Type': 'application/json'
  };

  const options = { method, headers };
  if (body) {
    options.body = JSON.stringify(body);
  }

  const response = await fetch(url, options);
  if (!response.ok) {
    const errData = await response.json().catch(() => ({}));
    throw new Error(errData.message || `HTTP ${response.status}`);
  }
  return response.json();
}

async function testGithubConnection() {
  const token = document.getElementById('gh-token').value.trim();
  const repo = document.getElementById('gh-repo').value.trim();
  
  if (!token || !repo) {
    showToast('Token dan Nama Repositori wajib diisi!', 'warning');
    return;
  }

  toggleLoader(true, 'Menguji koneksi ke GitHub...');
  try {
    // Fetch repo details to test connection
    const data = await fetch(`https://api.github.com/repos/${repo}`, {
      headers: {
        'Authorization': `token ${token}`,
        'Accept': 'application/vnd.github.v3+json'
      }
    });

    if (data.ok) {
      showToast('Koneksi ke repositori GitHub berhasil!', 'success');
    } else {
      const err = await data.json().catch(() => ({}));
      showToast(`Koneksi Gagal: ${err.message || data.statusText}`, 'error');
    }
  } catch (error) {
    showToast(`Koneksi Error: ${error.message}`, 'error');
  } finally {
    toggleLoader(false);
  }
}

async function handleGithubSave(event) {
  event.preventDefault();
  
  const token = document.getElementById('gh-token').value.trim();
  const repo = document.getElementById('gh-repo').value.trim();
  const branch = document.getElementById('gh-branch').value.trim() || 'main';
  const path = document.getElementById('gh-path').value.trim() || 'database.json';

  if (!token || !repo) {
    showToast('Token dan Repositori wajib diisi untuk mengaktifkan sinkronisasi!', 'warning');
    return;
  }

  toggleLoader(true, 'Menyimpan dan menyinkronkan data...');

  // Update temp settings
  state.githubSettings = { token, repo, branch, path };
  state.storageMode = 'github';

  try {
    // Attempt download or create database file on GitHub
    await syncPullFromGithub(false);
    
    // Save settings to LocalStorage only if successful
    localStorage.setItem('storageMode', 'github');
    localStorage.setItem('githubSettings', JSON.stringify(state.githubSettings));
    
    updateSyncBadge();
    updateStorageExplanation();
    showToast('Pengaturan GitHub disimpan & data disinkronisasi!', 'success');
  } catch (error) {
    console.error('Failed GitHub Sync on Save', error);
    // Revert storage mode to local since sync failed
    state.storageMode = 'local';
    updateSyncBadge();
    updateStorageExplanation();
    showToast(`Sinkronisasi Awal Gagal: ${error.message}. Kembali ke Mode Lokal.`, 'error');
  } finally {
    toggleLoader(false);
  }
}

function switchLocalStorageMode() {
  state.storageMode = 'local';
  localStorage.setItem('storageMode', 'local');
  updateSyncBadge();
  updateStorageExplanation();
  
  // Reload local storage data
  loadData();
  showToast('Beralih ke Penyimpanan Lokal (Offline).', 'info');
}

async function syncPullFromGithub(silent = false) {
  if (!state.githubSettings.token || !state.githubSettings.repo) {
    if (!silent) showToast('Token GitHub atau repositori belum diatur!', 'warning');
    return;
  }

  if (!silent) toggleLoader(true, 'Mengunduh data terbaru dari GitHub...');
  
  try {
    const repo = state.githubSettings.repo;
    const path = state.githubSettings.path;
    const branch = state.githubSettings.branch;

    // Fetch the file contents
    const endpoint = `/repos/${repo}/contents/${path}?ref=${branch}`;
    let fileData;
    try {
      fileData = await githubApiRequest(endpoint, 'GET');
    } catch (err) {
      if (err.message.includes('Not Found')) {
        // File does not exist, let's create a new template database on GitHub
        if (!silent) showToast('File database tidak ditemukan di GitHub. Membuat file baru...', 'info');
        state.githubSha = '';
        await syncPushToGithub(true); // force template push
        if (!silent) toggleLoader(false);
        return;
      } else {
        throw err;
      }
    }

    state.githubSha = fileData.sha;
    const rawContent = atob(fileData.content.replace(/\s/g, ''));
    const parsedDb = JSON.parse(rawContent);

    state.students = parsedDb.students || [];
    state.attendance = parsedDb.attendance || [];
    state.lateLogs = parsedDb.lateLogs || [];

    // Save copy locally
    saveLocalState();
    refreshAllUI();
    
    if (!silent) showToast('Data berhasil diunduh dari GitHub!', 'success');
  } catch (error) {
    console.error('GitHub Pull Error:', error);
    if (!silent) showToast(`Gagal mengunduh dari GitHub: ${error.message}`, 'error');
  } finally {
    if (!silent) toggleLoader(false);
  }
}

async function syncPushToGithub(isNewFile = false) {
  if (!state.githubSettings.token || !state.githubSettings.repo) {
    return;
  }

  const indicator = document.getElementById('sync-status-indicator');
  const text = document.getElementById('sync-status-text');
  if (indicator) {
    indicator.className = 'sync-status status-syncing';
    text.textContent = 'Menyinkronkan...';
  }

  try {
    const repo = state.githubSettings.repo;
    const path = state.githubSettings.path;
    const branch = state.githubSettings.branch;

    // 1. Fetch current SHA to prevent edit conflict if not creating a new file
    if (!isNewFile) {
      try {
        const fileInfo = await githubApiRequest(`/repos/${repo}/contents/${path}?ref=${branch}`, 'GET');
        state.githubSha = fileInfo.sha;
      } catch (err) {
        // Ignore if file doesn't exist, it means we create it
        if (!err.message.includes('Not Found')) {
          throw err;
        }
      }
    }

    // 2. Prepare payload
    const dbPayload = {
      students: state.students,
      attendance: state.attendance,
      lateLogs: state.lateLogs
    };
    
    const base64Content = btoa(unescape(encodeURIComponent(JSON.stringify(dbPayload, null, 2))));
    
    const body = {
      message: `update: data sekolah tanggal ${new Date().toISOString().split('T')[0]}`,
      content: base64Content,
      branch
    };

    if (state.githubSha) {
      body.sha = state.githubSha;
    }

    const res = await githubApiRequest(`/repos/${repo}/contents/${path}`, 'PUT', body);
    state.githubSha = res.content.sha;
    
    showToast('Data berhasil disimpan ke awan GitHub!', 'success');
  } catch (error) {
    console.error('GitHub Push Error:', error);
    showToast(`Gagal menyimpan ke GitHub: ${error.message}. Menggunakan penyimpanan lokal.`, 'error');
  } finally {
    updateSyncBadge();
  }
}

// Manual button triggers
function syncPullFromGithubManual() {
  syncPullFromGithub(false);
}

async function syncPushToGithubManual() {
  toggleLoader(true, 'Mengunggah data lokal ke GitHub...');
  await syncPushToGithub();
  toggleLoader(false);
}

// --- Toast Notifications ---
function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  
  let iconName = 'info';
  if (type === 'success') iconName = 'check-circle';
  if (type === 'error') iconName = 'alert-triangle';
  if (type === 'warning') iconName = 'alert-circle';

  toast.innerHTML = `
    <i data-lucide="${iconName}"></i>
    <span>${message}</span>
    <div class="toast-progress"></div>
  `;

  container.appendChild(toast);
  lucide.createIcons();

  // Slide-in auto removal
  setTimeout(() => {
    toast.style.animation = 'slideIn 0.3s reverse ease-out forwards';
    setTimeout(() => {
      toast.remove();
    }, 350);
  }, 3500);
}

// --- Menu Routing & UI Switching ---
function switchMenu(menuName) {
  // Hide all views
  const views = document.querySelectorAll('.content-view');
  views.forEach(view => view.classList.remove('active'));

  // Deactivate all sidebar items
  const menuButtons = document.querySelectorAll('.sidebar-menu .menu-item, .sidebar-footer .menu-item');
  menuButtons.forEach(btn => btn.classList.remove('active'));

  // Show selected view
  const targetView = document.getElementById(`view-${menuName}`);
  if (targetView) targetView.classList.add('active');

  // Activate selected menu button
  const targetBtn = document.getElementById(`btn-menu-${menuName}`);
  if (targetBtn) targetBtn.classList.add('active');

  state.currentView = menuName;

  // Change Navbar Titles
  const titleEl = document.getElementById('page-title');
  const subtitleEl = document.getElementById('page-subtitle');
  
  if (menuName === 'dashboard') {
    titleEl.textContent = 'Dashboard Utama';
    subtitleEl.textContent = 'Ringkasan data kehadiran dan siswa terlambat';
    renderDashboard();
  } else if (menuName === 'upload') {
    titleEl.textContent = 'Upload Data Siswa';
    subtitleEl.textContent = 'Impor daftar siswa menggunakan template berkas Excel';
    renderStudentListTable();
  } else if (menuName === 'absensi') {
    titleEl.textContent = 'Absensi Harian';
    subtitleEl.textContent = 'Pencatatan daftar hadir siswa berdasarkan kelas';
    populateClassSelect('absensi-kelas');
    loadAttendanceGrid();
  } else if (menuName === 'terlambat') {
    titleEl.textContent = 'Siswa Terlambat';
    subtitleEl.textContent = 'Input pencatatan jam dan keterangan siswa datang terlambat';
    renderLateLogsToday();
  } else if (menuName === 'rekap') {
    titleEl.textContent = 'Rekapitulasi Data';
    subtitleEl.textContent = 'Rangkuman dan riwayat absensi & keterlambatan per bulan';
    populateClassSelect('rekap-kelas');
    loadRekapData();
  } else if (menuName === 'laporan') {
    titleEl.textContent = 'Unduh Laporan Bulanan';
    subtitleEl.textContent = 'Ekspor hasil rekapitulasi data siswa ke berkas Microsoft Excel';
    populateClassSelect('laporan-absen-kelas');
  } else if (menuName === 'github') {
    titleEl.textContent = 'Integrasi Awan GitHub';
    subtitleEl.textContent = 'Konfigurasi akun dan repositori database online';
    updateStorageExplanation();
  }

  // Close modals or searchable dropdowns if any
  const lateDropdown = document.getElementById('terlambat-dropdown-list');
  if (lateDropdown) lateDropdown.style.display = 'none';

  window.scrollTo(0, 0);
  lucide.createIcons();
}

// --- Data Refresh helper ---
function refreshAllUI() {
  if (state.currentView === 'dashboard') renderDashboard();
  if (state.currentView === 'upload') renderStudentListTable();
  if (state.currentView === 'absensi') loadAttendanceGrid();
  if (state.currentView === 'terlambat') renderLateLogsToday();
  if (state.currentView === 'rekap') loadRekapData();
}

// Populates dropdown lists with list of unique classes in students database
function populateClassSelect(elementId) {
  const select = document.getElementById(elementId);
  if (!select) return;

  const currentVal = select.value;
  select.innerHTML = '';

  // Get distinct classes
  const classes = [...new Set(state.students.map(s => s.kelas))].sort();
  
  if (elementId === 'rekap-kelas' || elementId === 'filter-siswa-kelas') {
    const optAll = document.createElement('option');
    optAll.value = '';
    optAll.textContent = 'Semua Kelas';
    select.appendChild(optAll);
  } else {
    const optSelect = document.createElement('option');
    optSelect.value = '';
    optSelect.textContent = 'Pilih Kelas';
    select.appendChild(optSelect);
  }

  classes.forEach(cls => {
    const opt = document.createElement('option');
    opt.value = cls;
    opt.textContent = cls;
    select.appendChild(opt);
  });

  // Keep selected value if it still exists
  if (classes.includes(currentVal)) {
    select.value = currentVal;
  }
}

// ==========================================================================
// MENU 1: UPLOAD DATA SISWA
// ==========================================================================

function setupDragAndDrop() {
  const dropzone = document.getElementById('excel-dropzone');
  if (!dropzone) return;

  ['dragenter', 'dragover'].forEach(eventName => {
    dropzone.addEventListener(eventName, (e) => {
      e.preventDefault();
      dropzone.classList.add('dragover');
    }, false);
  });

  ['dragleave', 'drop'].forEach(eventName => {
    dropzone.addEventListener(eventName, (e) => {
      e.preventDefault();
      dropzone.classList.remove('dragover');
    }, false);
  });

  dropzone.addEventListener('drop', (e) => {
    const dt = e.dataTransfer;
    const files = dt.files;
    if (files.length) {
      document.getElementById('excel-file-input').files = files;
      handleExcelUpload({ target: { files: files } });
    }
  }, false);
}

// Holds parsed temp students list before saving
let tempImportedStudents = [];

function handleExcelUpload(event) {
  const file = event.target.files[0];
  if (!file) return;

  document.getElementById('uploaded-file-name').textContent = `File terpilih: ${file.name}`;

  const reader = new FileReader();
  toggleLoader(true, 'Membaca file Excel...');
  
  reader.onload = (e) => {
    try {
      const data = new Uint8Array(e.target.result);
      const workbook = XLSX.read(data, { type: 'array' });
      const firstSheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[firstSheetName];
      const json = XLSX.utils.sheet_to_json(worksheet);

      if (json.length === 0) {
        showToast('Berkas Excel kosong atau format tidak sesuai.', 'error');
        toggleLoader(false);
        return;
      }

      // Columns mapping: find appropriate keys (case insensitive check)
      const mappedStudents = [];
      const firstRow = json[0];
      
      const keyNama = Object.keys(firstRow).find(k => k.toLowerCase().trim() === 'nama');
      const keyNisn = Object.keys(firstRow).find(k => k.toLowerCase().trim() === 'nisn');
      const keyKelas = Object.keys(firstRow).find(k => k.toLowerCase().trim() === 'kelas');

      if (!keyNama || !keyNisn || !keyKelas) {
        showToast('Kolom "Nama", "NISN", dan "Kelas" wajib ada di berkas Excel!', 'error');
        toggleLoader(false);
        return;
      }

      json.forEach(row => {
        if (row[keyNama] && row[keyNisn] && row[keyKelas]) {
          mappedStudents.push({
            id: String(row[keyNisn]).trim(), // Using NISN as unique student ID
            nama: String(row[keyNama]).trim(),
            nisn: String(row[keyNisn]).trim(),
            kelas: String(row[keyKelas]).trim()
          });
        }
      });

      if (mappedStudents.length === 0) {
        showToast('Tidak ada baris data siswa yang valid ditemukan.', 'warning');
        toggleLoader(false);
        return;
      }

      tempImportedStudents = mappedStudents;

      // Render Preview
      const previewBody = document.getElementById('import-preview-body');
      previewBody.innerHTML = '';
      mappedStudents.forEach((std, idx) => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td>${idx + 1}</td>
          <td class="font-semibold">${std.nama}</td>
          <td>${std.nisn}</td>
          <td><span class="badge badge-success" style="background-color: var(--color-primary-glow); color: var(--color-primary);">${std.kelas}</span></td>
        `;
        previewBody.appendChild(tr);
      });

      document.getElementById('import-count').textContent = mappedStudents.length;
      document.getElementById('import-preview-section').style.display = 'block';
      showToast(`Berhasil membaca ${mappedStudents.length} siswa. Harap klik Simpan ke Database.`, 'info');

    } catch (error) {
      console.error(error);
      showToast('Gagal memproses file Excel.', 'error');
    } finally {
      toggleLoader(false);
    }
  };

  reader.readAsArrayBuffer(file);
}

function cancelImport() {
  tempImportedStudents = [];
  document.getElementById('import-preview-section').style.display = 'none';
  document.getElementById('excel-file-input').value = '';
  document.getElementById('uploaded-file-name').textContent = 'Belum ada file terpilih.';
  showToast('Impor data dibatalkan', 'info');
}

async function saveImportedStudents() {
  if (tempImportedStudents.length === 0) return;

  toggleLoader(true, 'Menyimpan data siswa...');
  try {
    // Merge or overwrite strategy: Let's upsert by NISN
    const studentMap = new Map();
    // Load existing
    state.students.forEach(s => studentMap.set(s.nisn, s));
    // Add/Update new
    tempImportedStudents.forEach(s => studentMap.set(s.nisn, s));

    state.students = Array.from(studentMap.values());
    
    // Save state
    await persistData();

    // Clear and hide preview
    tempImportedStudents = [];
    document.getElementById('import-preview-section').style.display = 'none';
    document.getElementById('excel-file-input').value = '';
    document.getElementById('uploaded-file-name').textContent = 'Belum ada file terpilih.';

    populateClassSelect('filter-siswa-kelas');
    renderStudentListTable();
    showToast('Data siswa berhasil diimpor & disimpan!', 'success');
  } catch (error) {
    showToast(`Gagal menyimpan: ${error.message}`, 'error');
  } finally {
    toggleLoader(false);
  }
}

function downloadExcelTemplate() {
  // Create workbook & sheet
  const wb = XLSX.utils.book_new();
  const data = [
    { Nama: 'Budi Santoso', NISN: '1023456789', Kelas: 'X RPL 1' },
    { Nama: 'Siti Rahma', NISN: '1098765432', Kelas: 'X RPL 1' },
    { Nama: 'Andi Wijaya', NISN: '1054321678', Kelas: 'XI TKJ 2' }
  ];
  const ws = XLSX.utils.json_to_sheet(data);
  XLSX.utils.book_append_sheet(wb, ws, 'Template Siswa');
  
  // Download file
  XLSX.writeFile(wb, 'Template_Data_Siswa.xlsx');
  showToast('Mengunduh file template...', 'info');
}

// Render registered students list in table below
function renderStudentListTable() {
  const body = document.getElementById('student-list-body');
  const searchName = document.getElementById('search-siswa-nama').value.toLowerCase().trim();
  const filterClass = document.getElementById('filter-siswa-kelas').value;

  body.innerHTML = '';

  let filtered = state.students;

  if (filterClass) {
    filtered = filtered.filter(s => s.kelas === filterClass);
  }

  if (searchName) {
    filtered = filtered.filter(s => s.nama.toLowerCase().includes(searchName) || s.nisn.includes(searchName));
  }

  // Populate filter class dropdown once if class list changes
  const clsSelect = document.getElementById('filter-siswa-kelas');
  if (clsSelect && clsSelect.options.length <= 1) {
    populateClassSelect('filter-siswa-kelas');
  }

  if (filtered.length === 0) {
    body.innerHTML = `<tr><td colspan="5" class="text-center text-muted">Tidak ada siswa yang sesuai filter.</td></tr>`;
    return;
  }

  filtered.forEach((std, idx) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${idx + 1}</td>
      <td class="font-semibold">${std.nama}</td>
      <td>${std.nisn}</td>
      <td><span class="badge badge-success" style="background-color: var(--color-primary-glow); color: var(--color-primary);">${std.kelas}</span></td>
      <td class="text-center">
        <button class="btn btn-secondary btn-sm" onclick="editStudent('${std.id}')" title="Edit Siswa"><i data-lucide="edit-3" style="width:14px;height:14px;"></i></button>
        <button class="btn btn-danger btn-sm ml-2" onclick="deleteStudent('${std.id}')" title="Hapus Siswa"><i data-lucide="trash-2" style="width:14px;height:14px;"></i></button>
      </td>
    `;
    body.appendChild(tr);
  });
  lucide.createIcons();
}

// Simple Student Add/Edit Modal control
function openStudentAddModal() {
  document.getElementById('student-modal-title').textContent = 'Tambah Siswa Baru';
  document.getElementById('student-modal-id').value = '';
  document.getElementById('student-modal-nama').value = '';
  document.getElementById('student-modal-nisn').value = '';
  document.getElementById('student-modal-kelas').value = '';
  document.getElementById('student-modal').style.display = 'flex';
}

function editStudent(id) {
  const std = state.students.find(s => s.id === id);
  if (!std) return;

  document.getElementById('student-modal-title').textContent = 'Edit Data Siswa';
  document.getElementById('student-modal-id').value = std.id;
  document.getElementById('student-modal-nama').value = std.nama;
  document.getElementById('student-modal-nisn').value = std.nisn;
  document.getElementById('student-modal-kelas').value = std.kelas;
  document.getElementById('student-modal').style.display = 'flex';
}

function closeStudentModal() {
  document.getElementById('student-modal').style.display = 'none';
}

async function handleStudentFormSubmit(event) {
  event.preventDefault();
  const id = document.getElementById('student-modal-id').value;
  const nama = document.getElementById('student-modal-nama').value.trim();
  const nisn = document.getElementById('student-modal-nisn').value.trim();
  const kelas = document.getElementById('student-modal-kelas').value.trim();

  if (!nama || !nisn || !kelas) {
    showToast('Harap isi semua kolom wajib!', 'warning');
    return;
  }

  toggleLoader(true, 'Menyimpan data siswa...');
  try {
    if (id) {
      // Edit mode
      const idx = state.students.findIndex(s => s.id === id);
      if (idx !== -1) {
        state.students[idx] = { id, nama, nisn, kelas };
      }
    } else {
      // Add mode
      // Check if NISN unique
      if (state.students.some(s => s.nisn === nisn)) {
        showToast('Siswa dengan NISN tersebut sudah terdaftar!', 'error');
        toggleLoader(false);
        return;
      }
      state.students.push({ id: nisn, nama, nisn, kelas });
    }

    await persistData();
    closeStudentModal();
    renderStudentListTable();
    showToast('Data siswa berhasil disimpan!', 'success');
  } catch (error) {
    showToast(`Gagal menyimpan: ${error.message}`, 'error');
  } finally {
    toggleLoader(false);
  }
}

async function deleteStudent(id) {
  if (!confirm('Apakah Anda yakin ingin menghapus data siswa ini? Semua catatan absensi & keterlambatannya juga akan hilang.')) {
    return;
  }

  toggleLoader(true, 'Menghapus siswa...');
  try {
    // 1. Delete student
    state.students = state.students.filter(s => s.id !== id);
    // 2. Cascade delete attendance and late logs
    state.attendance = state.attendance.filter(a => a.student_id !== id);
    state.lateLogs = state.lateLogs.filter(l => l.student_id !== id);

    await persistData();
    renderStudentListTable();
    showToast('Data siswa berhasil dihapus!', 'success');
  } catch (error) {
    showToast(`Gagal menghapus: ${error.message}`, 'error');
  } finally {
    toggleLoader(false);
  }
}

// ==========================================================================
// MENU 2: ABSENSI SISWA
// ==========================================================================

function loadAttendanceGrid() {
  const selectKelas = document.getElementById('absensi-kelas');
  const dateInput = document.getElementById('absensi-tanggal');
  
  if (selectKelas.options.length <= 1) {
    populateClassSelect('absensi-kelas');
  }

  const kelas = selectKelas.value;
  const tanggal = dateInput.value;

  const panel = document.getElementById('attendance-panel');
  const emptyState = document.getElementById('attendance-empty-state');
  
  if (!kelas || !tanggal) {
    panel.style.display = 'none';
    emptyState.style.display = 'block';
    return;
  }

  // Hide empty state, show grid
  emptyState.style.display = 'none';
  panel.style.display = 'block';
  
  document.getElementById('attendance-panel-subtitle').textContent = `Kelas: ${kelas} | Tanggal: ${formatLocalDate(tanggal)}`;

  // Filter students of selected class
  const classStudents = state.students.filter(s => s.kelas === kelas);
  const body = document.getElementById('attendance-grid-body');
  body.innerHTML = '';

  if (classStudents.length === 0) {
    body.innerHTML = `<tr><td colspan="5" class="text-center py-4 text-muted">Belum ada data siswa di kelas ini. Silakan tambahkan/unggah data siswa kelas ${kelas} di menu Upload.</td></tr>`;
    return;
  }

  // Load existing attendance for this class & date
  const existingRecordsMap = new Map();
  state.attendance
    .filter(a => a.tanggal === tanggal)
    .forEach(a => existingRecordsMap.set(a.student_id, a));

  classStudents.forEach((std, idx) => {
    const record = existingRecordsMap.get(std.id) || { status: 'hadir', keterangan: '' };
    
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${idx + 1}</td>
      <td class="font-semibold">${std.nama}</td>
      <td>${std.nisn}</td>
      <td>
        <div class="attendance-options">
          <input type="radio" name="att-${std.id}" id="hadir-${std.id}" value="hadir" class="attendance-radio-input input-hadir" ${record.status === 'hadir' ? 'checked' : ''}>
          <label for="hadir-${std.id}" class="attendance-radio-label">HADIR</label>

          <input type="radio" name="att-${std.id}" id="sakit-${std.id}" value="sakit" class="attendance-radio-input input-sakit" ${record.status === 'sakit' ? 'checked' : ''}>
          <label for="sakit-${std.id}" class="attendance-radio-label">SAKIT</label>

          <input type="radio" name="att-${std.id}" id="izin-${std.id}" value="izin" class="attendance-radio-input input-izin" ${record.status === 'izin' ? 'checked' : ''}>
          <label for="izin-${std.id}" class="attendance-radio-label">IZIN</label>

          <input type="radio" name="att-${std.id}" id="alpha-${std.id}" value="alpha" class="attendance-radio-input input-alpha" ${record.status === 'alpha' ? 'checked' : ''}>
          <label for="alpha-${std.id}" class="attendance-radio-label">ALPHA</label>
        </div>
      </td>
      <td>
        <input type="text" id="ket-${std.id}" class="form-input form-input-sm" value="${record.keterangan || ''}" placeholder="Keterangan (opsional)">
      </td>
    `;
    body.appendChild(tr);
  });
}

function bulkSetAttendance(status) {
  const selectKelas = document.getElementById('absensi-kelas').value;
  const classStudents = state.students.filter(s => s.kelas === selectKelas);
  classStudents.forEach(std => {
    const radio = document.getElementById(`${status}-${std.id}`);
    if (radio) radio.checked = true;
  });
  showToast(`Semua siswa di-set ${status.toUpperCase()}`, 'info');
}

async function saveAttendance() {
  const selectKelas = document.getElementById('absensi-kelas').value;
  const tanggal = document.getElementById('absensi-tanggal').value;
  
  if (!selectKelas || !tanggal) return;

  const classStudents = state.students.filter(s => s.kelas === selectKelas);
  if (classStudents.length === 0) return;

  toggleLoader(true, 'Menyimpan data absensi...');
  
  try {
    // Remove old attendance records of this class on this date to replace
    const studentIdsSet = new Set(classStudents.map(s => s.id));
    state.attendance = state.attendance.filter(a => !(a.tanggal === tanggal && studentIdsSet.has(a.student_id)));

    // Read new records from UI
    classStudents.forEach(std => {
      const selectedRadio = document.querySelector(`input[name="att-${std.id}"]:checked`);
      const status = selectedRadio ? selectedRadio.value : 'hadir';
      const keterangan = document.getElementById(`ket-${std.id}`).value.trim();
      
      state.attendance.push({
        id: `${tanggal}_${std.id}`,
        student_id: std.id,
        tanggal,
        status,
        keterangan
      });
    });

    await persistData();
    showToast('Data absensi kelas berhasil disimpan!', 'success');
  } catch (error) {
    showToast(`Gagal menyimpan absensi: ${error.message}`, 'error');
  } finally {
    toggleLoader(false);
  }
}

// ==========================================================================
// MENU 3: SISWA TERLAMBAT
// ==========================================================================

function showStudentDropdown() {
  const list = document.getElementById('terlambat-dropdown-list');
  list.innerHTML = '';
  
  if (state.students.length === 0) {
    list.innerHTML = '<div class="dropdown-item text-muted">Belum ada data siswa. Impor dahulu.</div>';
    list.style.display = 'block';
    return;
  }

  filterStudentDropdown();
  list.style.display = 'block';
}

function filterStudentDropdown() {
  const query = document.getElementById('terlambat-search-input').value.toLowerCase().trim();
  const list = document.getElementById('terlambat-dropdown-list');
  list.innerHTML = '';

  const filtered = state.students.filter(s => 
    s.nama.toLowerCase().includes(query) || s.nisn.includes(query) || s.kelas.toLowerCase().includes(query)
  ).slice(0, 8); // limit results for speed

  if (filtered.length === 0) {
    list.innerHTML = '<div class="dropdown-item text-muted">Siswa tidak ditemukan</div>';
    return;
  }

  filtered.forEach(std => {
    const item = document.createElement('div');
    item.className = 'dropdown-item';
    item.innerHTML = `
      <span class="item-nama font-semibold">${std.nama}</span>
      <span class="item-kelas">${std.kelas}</span>
    `;
    item.onclick = () => selectStudentForLate(std);
    list.appendChild(item);
  });
}

function selectStudentForLate(student) {
  document.getElementById('terlambat-search-input').value = student.nama;
  document.getElementById('terlambat-siswa-id').value = student.id;
  document.getElementById('terlambat-kelas-display').value = student.kelas;
  document.getElementById('terlambat-dropdown-list').style.display = 'none';
}

async function handleLateSubmit(event) {
  event.preventDefault();

  const studentId = document.getElementById('terlambat-siswa-id').value;
  const tanggal = document.getElementById('terlambat-tanggal').value;
  const jam = document.getElementById('terlambat-jam').value;
  const keterangan = document.getElementById('terlambat-keterangan').value.trim();

  if (!studentId || !tanggal || !jam) {
    showToast('Harap pilih siswa, tanggal, dan jam terlambat!', 'warning');
    return;
  }

  toggleLoader(true, 'Mencatat keterlambatan...');
  try {
    const newLog = {
      id: `late_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
      student_id: studentId,
      tanggal,
      jam,
      keterangan
    };

    state.lateLogs.push(newLog);
    await persistData();

    // Reset Form except date
    document.getElementById('terlambat-siswa-id').value = '';
    document.getElementById('terlambat-search-input').value = '';
    document.getElementById('terlambat-kelas-display').value = '';
    document.getElementById('terlambat-keterangan').value = '';
    
    // Refresh list
    renderLateLogsToday();
    showToast('Data keterlambatan berhasil dicatat!', 'success');
  } catch (error) {
    showToast(`Gagal mencatat: ${error.message}`, 'error');
  } finally {
    toggleLoader(false);
  }
}

function renderLateLogsToday() {
  const tanggal = document.getElementById('terlambat-tanggal').value;
  const body = document.getElementById('late-today-table-body');
  const badge = document.getElementById('late-today-badge');

  body.innerHTML = '';
  
  if (!tanggal) return;

  const todayLates = state.lateLogs.filter(l => l.tanggal === tanggal);
  badge.textContent = `${todayLates.length} Siswa`;

  if (todayLates.length === 0) {
    body.innerHTML = `<tr><td colspan="5" class="text-center text-muted">Belum ada siswa terlambat dicatat pada tanggal ini.</td></tr>`;
    return;
  }

  todayLates.forEach((log) => {
    const student = state.students.find(s => s.id === log.student_id) || { nama: 'Siswa Terhapus', kelas: '-', nisn: '-' };
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="font-semibold">${student.nama}</td>
      <td><span class="badge badge-success" style="background-color: var(--color-primary-glow); color: var(--color-primary);">${student.kelas}</span></td>
      <td class="text-warning font-semibold"><i data-lucide="clock" class="v-middle mr-1" style="width:14px;height:14px;"></i>${log.jam}</td>
      <td>${log.keterangan || '<span class="text-muted">-</span>'}</td>
      <td class="text-center">
        <button class="btn btn-danger btn-sm" onclick="deleteLateLog('${log.id}')" title="Hapus Catatan"><i data-lucide="trash-2" style="width:14px;height:14px;"></i></button>
      </td>
    `;
    body.appendChild(tr);
  });
  lucide.createIcons();
}

async function deleteLateLog(logId) {
  if (!confirm('Hapus catatan keterlambatan ini?')) return;

  toggleLoader(true, 'Menghapus catatan...');
  try {
    state.lateLogs = state.lateLogs.filter(l => l.id !== logId);
    await persistData();
    renderLateLogsToday();
    showToast('Catatan keterlambatan dihapus.', 'success');
  } catch (error) {
    showToast(`Gagal menghapus: ${error.message}`, 'error');
  } finally {
    toggleLoader(false);
  }
}

// ==========================================================================
// MENU 4: REKAP DATA SISWA
// ==========================================================================

let activeRekapTab = 'absensi';

function switchRekapTab(tabName) {
  activeRekapTab = tabName;
  
  const buttons = document.querySelectorAll('.tab-button');
  buttons.forEach(btn => btn.classList.remove('active'));
  document.getElementById(`tab-rekap-${tabName}`).classList.add('active');

  const contents = document.querySelectorAll('.rekap-tab-content');
  contents.forEach(c => c.style.display = 'none');
  document.getElementById(`rekap-tab-${tabName}-content`).style.display = 'block';

  loadRekapData();
}

function loadRekapData() {
  const bulan = document.getElementById('rekap-bulan').value;
  const tahun = document.getElementById('rekap-tahun').value;
  const kelas = document.getElementById('rekap-kelas').value;
  const search = document.getElementById('rekap-search').value.toLowerCase().trim();

  const labelBulan = document.getElementById('rekap-bulan').options[document.getElementById('rekap-bulan').selectedIndex].text;
  const subAbsensi = document.getElementById('rekap-absensi-subtitle');
  const subTerlambat = document.getElementById('rekap-terlambat-subtitle');

  const formattedSubtitle = `Bulan: ${labelBulan} ${tahun} | Kelas: ${kelas || 'Semua Kelas'}`;
  if (subAbsensi) subAbsensi.textContent = formattedSubtitle;
  if (subTerlambat) subTerlambat.textContent = formattedSubtitle;

  if (activeRekapTab === 'absensi') {
    renderRekapAbsensi(bulan, tahun, kelas, search);
  } else {
    renderRekapTerlambat(bulan, tahun, kelas, search);
  }
}

function renderRekapAbsensi(bulan, tahun, kelas, search) {
  const body = document.getElementById('rekap-absensi-table-body');
  body.innerHTML = '';

  let filteredStudents = state.students;
  if (kelas) {
    filteredStudents = filteredStudents.filter(s => s.kelas === kelas);
  }
  if (search) {
    filteredStudents = filteredStudents.filter(s => s.nama.toLowerCase().includes(search) || s.nisn.includes(search));
  }

  if (filteredStudents.length === 0) {
    body.innerHTML = `<tr><td colspan="9" class="text-center text-muted py-4">Tidak ada data siswa sesuai filter.</td></tr>`;
    return;
  }

  // Filter attendance of this month & year
  const prefix = `${tahun}-${bulan}-`;
  const monthAtt = state.attendance.filter(a => a.tanggal.startsWith(prefix));

  filteredStudents.forEach((std, idx) => {
    const studentAtt = monthAtt.filter(a => a.student_id === std.id);
    
    let hadir = 0, sakit = 0, izin = 0, alpha = 0;
    studentAtt.forEach(a => {
      if (a.status === 'hadir') hadir++;
      else if (a.status === 'sakit') sakit++;
      else if (a.status === 'izin') izin++;
      else if (a.status === 'alpha') alpha++;
    });

    const totalMarked = hadir + sakit + izin + alpha;
    const persentase = totalMarked > 0 ? Math.round((hadir / totalMarked) * 100) : 100;

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${idx + 1}</td>
      <td class="text-left font-semibold">${std.nama}</td>
      <td>${std.kelas}</td>
      <td>${std.nisn}</td>
      <td class="text-success font-semibold">${hadir}</td>
      <td class="text-warning font-semibold">${sakit}</td>
      <td class="text-info font-semibold">${izin}</td>
      <td class="text-danger font-semibold">${alpha}</td>
      <td>
        <div class="d-flex align-center justify-center gap-2">
          <span class="font-semibold text-primary">${persentase}%</span>
          <div style="width: 50px; height: 6px; background: rgba(255,255,255,0.05); border-radius: 3px; overflow: hidden;">
            <div style="width: ${persentase}%; height: 100%; background: linear-gradient(to right, var(--color-primary), var(--color-success));"></div>
          </div>
        </div>
      </td>
    `;
    body.appendChild(tr);
  });
}

function renderRekapTerlambat(bulan, tahun, kelas, search) {
  const body = document.getElementById('rekap-terlambat-table-body');
  body.innerHTML = '';

  let filteredStudents = state.students;
  if (kelas) {
    filteredStudents = filteredStudents.filter(s => s.kelas === kelas);
  }
  if (search) {
    filteredStudents = filteredStudents.filter(s => s.nama.toLowerCase().includes(search) || s.nisn.includes(search));
  }

  if (filteredStudents.length === 0) {
    body.innerHTML = `<tr><td colspan="6" class="text-center text-muted py-4">Tidak ada data siswa sesuai filter.</td></tr>`;
    return;
  }

  // Filter late logs of this month & year
  const prefix = `${tahun}-${bulan}-`;
  const monthLates = state.lateLogs.filter(l => l.tanggal.startsWith(prefix));

  let hasData = false;

  filteredStudents.forEach((std) => {
    const studentLates = monthLates.filter(l => l.student_id === std.id).sort((a, b) => a.tanggal.localeCompare(b.tanggal));
    if (studentLates.length === 0 && search === '') {
      // If we are not searching name, only show students who have at least 1 late record to prevent table clutter
      return;
    }

    hasData = true;

    // Build details string
    let detailsHtml = '<span class="text-muted">Tidak terlambat</span>';
    if (studentLates.length > 0) {
      detailsHtml = studentLates.map(l => 
        `<span class="badge badge-warning" style="margin: 2px;" title="${l.keterangan || 'Tanpa keterangan'}">${formatLocalDate(l.tanggal)} (${l.jam})</span>`
      ).join(' ');
    }

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${body.children.length + 1}</td>
      <td class="text-left font-semibold">${std.nama}</td>
      <td>${std.kelas}</td>
      <td>${std.nisn}</td>
      <td class="text-warning font-semibold text-center">${studentLates.length}x</td>
      <td class="text-left">${detailsHtml}</td>
    `;
    body.appendChild(tr);
  });

  if (!hasData) {
    body.innerHTML = `<tr><td colspan="6" class="text-center text-muted py-4">Tidak ada data keterlambatan bulan ini.</td></tr>`;
  }
}

// ==========================================================================
// MENU 5: UNDUH LAPORAN
// ==========================================================================

function downloadLaporanAbsensi() {
  const bulan = document.getElementById('laporan-absen-bulan').value;
  const tahun = document.getElementById('laporan-absen-tahun').value;
  const kelas = document.getElementById('laporan-absen-kelas').value;
  const labelBulan = document.getElementById('laporan-absen-bulan').options[document.getElementById('laporan-absen-bulan').selectedIndex].text;

  let filteredStudents = state.students;
  if (kelas) {
    filteredStudents = filteredStudents.filter(s => s.kelas === kelas);
  }

  if (filteredStudents.length === 0) {
    showToast(kelas ? `Data siswa kelas ${kelas} masih kosong.` : 'Data siswa masih kosong. Tidak ada data untuk diekspor.', 'warning');
    return;
  }

  toggleLoader(true, 'Menyusun laporan absensi...');

  try {
    const prefix = `${tahun}-${bulan}-`;
    const studentIds = new Set(filteredStudents.map(s => s.id));
    const monthAtt = state.attendance.filter(a => a.tanggal.startsWith(prefix) && studentIds.has(a.student_id));

    // 1. Sheet 1: Rekapitulasi Akumulasi Bulanan
    const rekapData = filteredStudents.map((std, idx) => {
      const studentAtt = monthAtt.filter(a => a.student_id === std.id);
      let hadir = 0, sakit = 0, izin = 0, alpha = 0;
      studentAtt.forEach(a => {
        if (a.status === 'hadir') hadir++;
        else if (a.status === 'sakit') sakit++;
        else if (a.status === 'izin') izin++;
        else if (a.status === 'alpha') alpha++;
      });
      const totalMarked = hadir + sakit + izin + alpha;
      const persentase = totalMarked > 0 ? `${Math.round((hadir / totalMarked) * 100)}%` : '100%';

      return {
        'No': idx + 1,
        'Nama Siswa': std.nama,
        'Kelas': std.kelas,
        'NISN': std.nisn,
        'Hadir': hadir,
        'Sakit': sakit,
        'Izin': izin,
        'Alpha': alpha,
        'Persentase Kehadiran': persentase
      };
    });

    // 2. Sheet 2: Log Rincian Transaksi
    const logData = monthAtt.map((att, idx) => {
      const std = state.students.find(s => s.id === att.student_id) || { nama: 'Siswa Terhapus', kelas: '-', nisn: '-' };
      return {
        'No': idx + 1,
        'Tanggal': formatLocalDate(att.tanggal),
        'Nama Siswa': std.nama,
        'Kelas': std.kelas,
        'NISN': std.nisn,
        'Status': att.status.toUpperCase(),
        'Keterangan': att.keterangan || '-'
      };
    }).sort((a, b) => a.Tanggal.localeCompare(b.Tanggal));

    // Create Excel Workbook
    const wb = XLSX.utils.book_new();
    
    const wsRekap = XLSX.utils.json_to_sheet(rekapData);
    XLSX.utils.book_append_sheet(wb, wsRekap, 'Rekap Absensi Bulanan');
    
    if (logData.length > 0) {
      const wsLog = XLSX.utils.json_to_sheet(logData);
      XLSX.utils.book_append_sheet(wb, wsLog, 'Rincian Absensi Harian');
    }

    const fileKelasSuffix = kelas ? `_${kelas.replace(/\s+/g, '_')}` : '_Semua_Kelas';
    XLSX.writeFile(wb, `Laporan_Absensi_Siswa${fileKelasSuffix}_${labelBulan}_${tahun}.xlsx`);
    showToast('Laporan absensi berhasil diunduh!', 'success');
  } catch (error) {
    showToast(`Gagal mengekspor laporan: ${error.message}`, 'error');
  } finally {
    toggleLoader(false);
  }
}

function downloadLaporanTerlambat() {
  const bulan = document.getElementById('laporan-terlambat-bulan').value;
  const tahun = document.getElementById('laporan-terlambat-tahun').value;
  const labelBulan = document.getElementById('laporan-terlambat-bulan').options[document.getElementById('laporan-terlambat-bulan').selectedIndex].text;

  if (state.students.length === 0) {
    showToast('Data siswa masih kosong. Tidak ada data untuk diekspor.', 'warning');
    return;
  }

  toggleLoader(true, 'Menyusun laporan keterlambatan...');

  try {
    const prefix = `${tahun}-${bulan}-`;
    const monthLates = state.lateLogs.filter(l => l.tanggal.startsWith(prefix));

    // 1. Sheet 1: Rincian Log Keterlambatan (dengan Tanggal, Jam, Keterangan)
    const logData = monthLates.map((log, idx) => {
      const std = state.students.find(s => s.id === log.student_id) || { nama: 'Siswa Terhapus', kelas: '-', nisn: '-' };
      return {
        'No': idx + 1,
        'Tanggal': formatLocalDate(log.tanggal),
        'Nama Siswa': std.nama,
        'Kelas': std.kelas,
        'NISN': std.nisn,
        'Jam': log.jam,
        'Keterangan': log.keterangan || '-'
      };
    }).sort((a, b) => a.Tanggal.localeCompare(b.Tanggal));

    // 2. Sheet 2: Rekap Frekuensi Terlambat
    const rekapData = state.students.map((std, idx) => {
      const freq = monthLates.filter(l => l.student_id === std.id).length;
      return {
        'No': idx + 1,
        'Nama Siswa': std.nama,
        'Kelas': std.kelas,
        'NISN': std.nisn,
        'Frekuensi Terlambat (Kali)': freq
      };
    }).filter(row => row['Frekuensi Terlambat (Kali)'] > 0);

    if (logData.length === 0 && rekapData.length === 0) {
      showToast(`Tidak ada catatan siswa terlambat pada bulan ${labelBulan} ${tahun}. Laporan kosong.`, 'warning');
      toggleLoader(false);
      return;
    }

    const wb = XLSX.utils.book_new();
    
    if (logData.length > 0) {
      const wsLog = XLSX.utils.json_to_sheet(logData);
      XLSX.utils.book_append_sheet(wb, wsLog, 'Rincian Siswa Terlambat');
    }

    const wsRekap = XLSX.utils.json_to_sheet(rekapData);
    XLSX.utils.book_append_sheet(wb, wsRekap, 'Rekap Frekuensi Terlambat');

    XLSX.writeFile(wb, `Laporan_Keterlambatan_Siswa_${labelBulan}_${tahun}.xlsx`);
    showToast('Laporan keterlambatan berhasil diunduh!', 'success');
  } catch (error) {
    showToast(`Gagal mengekspor laporan: ${error.message}`, 'error');
  } finally {
    toggleLoader(false);
  }
}

// ==========================================================================
// DASHBOARD VIEW CORE RENDER
// ==========================================================================

function renderDashboard() {
  const todayISO = new Date().toISOString().split('T')[0];
  
  // Total registered students
  document.getElementById('dash-total-siswa').textContent = state.students.length;

  // Filter today's attendance
  const todayAtt = state.attendance.filter(a => a.tanggal === todayISO);
  let hadir = 0, sakit = 0, izin = 0, alpha = 0;
  todayAtt.forEach(a => {
    if (a.status === 'hadir') hadir++;
    else if (a.status === 'sakit') sakit++;
    else if (a.status === 'izin') izin++;
    else if (a.status === 'alpha') alpha++;
  });

  const totalTodayMarked = hadir + sakit + izin + alpha;
  const attendanceRate = totalTodayMarked > 0 ? Math.round((hadir / totalTodayMarked) * 100) : 0;
  
  document.getElementById('dash-kehadiran-percent').textContent = `${attendanceRate}%`;
  document.getElementById('dash-kehadiran-subtext').textContent = totalTodayMarked > 0 
    ? `Kehadiran dari ${totalTodayMarked} siswa diabsen`
    : 'Belum ada absensi kelas hari ini';

  document.getElementById('dash-total-absen').textContent = sakit + izin + alpha;
  document.getElementById('dash-absen-details').textContent = `Sakit: ${sakit} | Izin: ${izin} | Alfa: ${alpha}`;

  // Today's lates
  const todayLates = state.lateLogs.filter(l => l.tanggal === todayISO);
  document.getElementById('dash-total-terlambat').textContent = todayLates.length;
  document.getElementById('dash-terlambat-subtext').textContent = `${todayLates.length} siswa terlambat hari ini`;

  // Render Charts
  renderDashboardCharts(hadir, sakit, izin, alpha);

  // Render Top Sering Terlambat (This month)
  renderTopLateStudentsThisMonth();

  // Render Recent Late Activities
  renderRecentLateActivities(todayISO);
}

function renderDashboardCharts(hadir = 0, sakit = 0, izin = 0, alpha = 0) {
  // 1. Render Attendance Donut Chart (SVG)
  const donutContainer = document.getElementById('attendance-donut-chart');
  const legendContainer = document.getElementById('attendance-legend');
  
  donutContainer.innerHTML = '';
  legendContainer.innerHTML = '';

  const total = hadir + sakit + izin + alpha;
  
  if (total === 0) {
    donutContainer.innerHTML = `
      <svg width="200" height="200" viewBox="0 0 200 200">
        <circle cx="100" cy="100" r="70" fill="none" stroke="rgba(255,255,255,0.05)" stroke-width="20" />
        <text x="100" y="105" text-anchor="middle" fill="var(--text-muted)" font-size="12" font-weight="500">TIDAK ADA DATA</text>
      </svg>
    `;
    legendContainer.innerHTML = `
      <div class="legend-item"><span class="legend-color" style="background:#64748b"></span><span>Belum Diabsen (0)</span></div>
    `;
  } else {
    // Math logic for SVG Donut segments
    const radius = 70;
    const circumference = 2 * Math.PI * radius; // ~439.8
    
    const parts = [
      { name: 'Hadir', count: hadir, color: 'var(--color-success)' },
      { name: 'Sakit', count: sakit, color: 'var(--color-warning)' },
      { name: 'Izin', count: izin, color: 'var(--color-info)' },
      { name: 'Alpha', count: alpha, color: 'var(--color-danger)' }
    ].filter(p => p.count > 0);

    let svgInner = '';
    let currentOffset = 0;

    parts.forEach(part => {
      const percentage = part.count / total;
      const strokeDashArray = `${percentage * circumference} ${circumference}`;
      const strokeDashOffset = -currentOffset;
      
      svgInner += `
        <circle cx="100" cy="100" r="${radius}" 
          fill="none" 
          stroke="${part.color}" 
          stroke-width="20" 
          stroke-dasharray="${strokeDashArray}" 
          stroke-dashoffset="${strokeDashOffset}"
          transform="rotate(-90 100 100)"
          style="transition: stroke-dashoffset 0.5s ease" />
      `;
      currentOffset += percentage * circumference;
    });

    // Inner center text
    const pctHadir = Math.round((hadir / total) * 100);
    svgInner += `
      <circle cx="100" cy="100" r="58" fill="var(--bg-app)" />
      <text x="100" y="98" text-anchor="middle" fill="var(--text-main)" font-size="24" font-weight="800" font-family="var(--font-heading)">${pctHadir}%</text>
      <text x="100" y="118" text-anchor="middle" fill="var(--text-muted)" font-size="11" font-weight="600" letter-spacing="0.5">HADIR</text>
    `;

    donutContainer.innerHTML = `<svg width="200" height="200" viewBox="0 0 200 200">${svgInner}</svg>`;

    // Legend
    parts.forEach(part => {
      const pct = Math.round((part.count / total) * 100);
      legendContainer.innerHTML += `
        <div class="legend-item">
          <span class="legend-color" style="background:${part.color}"></span>
          <span>${part.name}: <strong>${part.count}</strong> (${pct}%)</span>
        </div>
      `;
    });
  }

  // 2. Render Late Monthly Trend Chart (SVG)
  const trendContainer = document.getElementById('late-trend-chart');
  trendContainer.innerHTML = '';

  // Get recent 6 months
  const now = new Date();
  const monthsData = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const yMonth = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const label = d.toLocaleDateString('id-ID', { month: 'short' });
    monthsData.push({ yMonth, label, count: 0 });
  }

  // Populate data counts
  monthsData.forEach(m => {
    m.count = state.lateLogs.filter(l => l.tanggal.startsWith(m.yMonth)).length;
  });

  const maxCount = Math.max(...monthsData.map(m => m.count), 5); // default min height scale of 5
  
  // Create beautiful SVG Bar Chart
  const svgWidth = 350;
  const svgHeight = 180;
  const padding = 30;
  const graphWidth = svgWidth - padding * 2;
  const graphHeight = svgHeight - padding * 2;
  const barWidth = 24;
  const colSpacing = graphWidth / monthsData.length;

  let barElements = '';
  let gridLines = '';
  let labels = '';

  // Horizontal Gridlines (3 lines)
  for (let idx = 0; idx <= 3; idx++) {
    const yVal = padding + (graphHeight / 3) * idx;
    const gridLabel = Math.round(maxCount - (maxCount / 3) * idx);
    gridLines += `
      <line x1="${padding}" y1="${yVal}" x2="${svgWidth - padding}" y2="${yVal}" stroke="var(--border-color)" stroke-width="1" stroke-dasharray="3,3" />
      <text x="${padding - 8}" y="${yVal + 4}" fill="var(--text-muted)" font-size="9" text-anchor="end">${gridLabel}</text>
    `;
  }

  // Draw Bars
  monthsData.forEach((m, idx) => {
    const barHeight = m.count > 0 ? (m.count / maxCount) * graphHeight : 2; // tiny indicator if 0
    const xPos = padding + colSpacing * idx + (colSpacing - barWidth) / 2;
    const yPos = padding + graphHeight - barHeight;

    // Glowing gradients or colors
    barElements += `
      <rect x="${xPos}" y="${yPos}" width="${barWidth}" height="${barHeight}" 
        fill="url(#lateGrad)" rx="4"
        style="transition: all 0.5s ease" />
      <!-- Value Hover indicator -->
      <text x="${xPos + barWidth/2}" y="${yPos - 6}" text-anchor="middle" fill="var(--color-warning)" font-size="9" font-weight="700">${m.count}</text>
    `;

    // Labels
    labels += `
      <text x="${xPos + barWidth/2}" y="${padding + graphHeight + 16}" text-anchor="middle" fill="var(--text-muted)" font-size="11" font-weight="500">${m.label}</text>
    `;
  });

  trendContainer.innerHTML = `
    <svg width="100%" height="180" viewBox="0 0 ${svgWidth} ${svgHeight}" style="overflow:visible;">
      <defs>
        <linearGradient id="lateGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#fbbf24" />
          <stop offset="100%" stop-color="#f59e0b" />
        </linearGradient>
      </defs>
      ${gridLines}
      ${barElements}
      ${labels}
    </svg>
  `;
}

function renderTopLateStudentsThisMonth() {
  const body = document.getElementById('dash-top-late-body');
  body.innerHTML = '';

  const today = new Date();
  const currentMonthPrefix = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-`;

  // Filter logs of this month
  const thisMonthLates = state.lateLogs.filter(l => l.tanggal.startsWith(currentMonthPrefix));

  // Count per student
  const countMap = new Map();
  thisMonthLates.forEach(log => {
    countMap.set(log.student_id, (countMap.get(log.student_id) || 0) + 1);
  });

  const sortedTop = Array.from(countMap.entries())
    .map(([studentId, count]) => {
      const student = state.students.find(s => s.id === studentId) || { nama: 'Siswa Terhapus', kelas: '-' };
      return { student, count };
    })
    .sort((a, b) => b.count - a.count)
    .slice(0, 5); // top 5

  if (sortedTop.length === 0) {
    body.innerHTML = `<tr><td colspan="3" class="text-center py-4 text-muted">Belum ada siswa terlambat bulan ini.</td></tr>`;
    return;
  }

  sortedTop.forEach(item => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="font-semibold">${item.student.nama}</td>
      <td><span class="badge badge-success" style="background-color: var(--color-primary-glow); color: var(--color-primary);">${item.student.kelas}</span></td>
      <td class="text-center font-bold text-warning">${item.count}x</td>
    `;
    body.appendChild(tr);
  });
}

function renderRecentLateActivities(todayISO) {
  const container = document.getElementById('dash-recent-activities');
  container.innerHTML = '';

  const todayLates = state.lateLogs
    .filter(l => l.tanggal === todayISO)
    .sort((a, b) => b.jam.localeCompare(a.jam))
    .slice(0, 5); // recent 5 of today

  if (todayLates.length === 0) {
    container.innerHTML = `<div class="timeline-empty text-muted text-center py-4">Belum ada aktivitas keterlambatan hari ini.</div>`;
    return;
  }

  todayLates.forEach(log => {
    const student = state.students.find(s => s.id === log.student_id) || { nama: 'Siswa Terhapus', kelas: '-' };
    
    const div = document.createElement('div');
    div.className = 'timeline-item';
    div.innerHTML = `
      <div class="timeline-dot"></div>
      <div class="timeline-header">
        <span class="font-semibold">${student.nama} (${student.kelas})</span>
        <span class="timeline-time">${log.jam}</span>
      </div>
      <div class="timeline-desc text-muted">${log.keterangan || 'Tanpa keterangan'}</div>
    `;
    container.appendChild(div);
  });
}

// --- Helper Date Formatter ---
function formatLocalDate(dateStr) {
  if (!dateStr) return '';
  const [y, m, d] = dateStr.split('-');
  if (!d) return dateStr;
  
  const dateObj = new Date(y, m - 1, d);
  return dateObj.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
}
