'use strict';

// ==========================================
// 1. GLOBAL STATE & REFERENSI DOM
// ==========================================
let isGameMode = false;
let currentGameRound = 1; // Maksimal 3
let gameTimeouts = []; // Array untuk menampung ID setTimeout
let gameClusterLayer = null; // Layer khusus 10 marker game
let gameScore = 0;

// Data soal & pilihan
let targetGameData = null;
let poolGameData = []; // 10 data terpilih untuk map
let usedGameQIDs = new Set(); // Mencegah QID jadi target di ronde berikutnya

// State pemulihan UI Filter
let savedFilterState = {};

// Referensi DOM (Pastikan HTML memiliki ID ini)
const btnMulaiGame = document.getElementById('btn-mulai-game');
const navBeranda = document.getElementById('nav-beranda');
const navHasil = document.getElementById('nav-hasil-container');
const btnMenuInduk = document.getElementById('btn-menu-induk'); 
const gameDialog = document.getElementById('game-dialog');
const gameMessage = document.getElementById('game-message');
const gameOverlay = document.getElementById('game-overlay');

function getGamePrefix() {
    let prefix = 'letak';
    if (['Kabupaten dan kota'].includes(currentNamaKlaster)) prefix = 'provinsi';
    else if (['Tempat lahir tokoh'].includes(currentNamaKlaster)) prefix = 'tempat lahir';
    else if (['Latar karya sastra'].includes(currentNamaKlaster)) prefix = 'latar';
    else if (['Publikasi', 'Media massa'].includes(currentNamaKlaster)) prefix = 'tempat terbit';
    else if (['Lukisan', 'Lontar', 'Naskah'].includes(currentNamaKlaster)) prefix = 'koleksi';
    else if (['Gempa bumi dan tsunami', 'Peristiwa lainnya', 'Perang & konflik', 'Bencana lainnya'].includes(currentNamaKlaster)) prefix = 'pusat kejadian/terdampak';
    else if (['Situs arkeologi lainnya'].includes(currentNamaKlaster)) prefix = 'letak';
    else if (['Prasasti', 'Artefak'].includes(currentNamaKlaster)) prefix = 'lokasi sekarang';

    if (currentKategoriUtama === 'alam') {
        if (['Bahasa'].includes(currentNamaKlaster)) prefix = 'wilayah penutur utama';
        else if (['Hidangan', 'Pakaian', 'Tari dan pertunjukan', 'Ritual dan upacara', 'Budaya rakyat'].includes(currentNamaKlaster)) prefix = `${currentNamaKlaster.toLowerCase()} khas`;
    }
    return prefix;
}


// ==========================================
// 2. TOMBOL MULAI, BATAL & SKIP
// ==========================================
btnMulaiGame.addEventListener('click', function(e) {
    e.preventDefault();
    e.stopPropagation();

    // 1. Validasi Syarat Game
    let validRecords = Object.values(Records).filter(r => r.lat && r.lon && r.imageFilename);
    let uniqueRegions = new Set();
    validRecords.forEach(r => {
        let provArray = Object.keys(r.designations).filter(p => p !== 'all' && ProvinceIndex[p] && ProvinceIndex[p].name !== 'Wilayah Lainnya/Tidak Spesifik');
        provArray.forEach(p => uniqueRegions.add(p));
    });

    if (validRecords.length < 10 || uniqueRegions.size < 4) {
        tampilkanDialog("Pencarian saat ini belum memenuhi syarat Mode Game.<br><br>Pastikan ada <b>minimal 10 data bergambar</b> yang tersebar di <b>minimal 4 wilayah/provinsi berbeda</b>.", "alert", "Syarat Belum Terpenuhi");
        return;
    }

    // 2. Simpan State Filter Pengguna Saat Ini
    savedFilterState = {
        region: currentRegionFilter,
        usia: currentUsiaFilter,
        sort: currentUsiaSort,
        search: currentSearchQuery,
        features: Array.from(activeFeatures),
        isAllActive: document.getElementById('btn-all') ? document.getElementById('btn-all').classList.contains('active') : false
    };

    isGameMode = true;
    currentGameRound = 1;
    gameScore = 0; // <--- TAMBAHKAN BARIS INI
    usedGameQIDs.clear();
    clearAllGameTimeouts();

    // 3. UI Navigasi Mode Game
    if (typeof window.setMobilePanelExpanded === 'function') window.setMobilePanelExpanded(false, false);
    const panelMobile = document.getElementById('panel');
    if (panelMobile) {
        panelMobile.style.pointerEvents = 'none'; 
        panelMobile.style.opacity = '0.5'; 
    }
    
    navHasil.classList.add('nav-disabled');
    navBeranda.textContent = "Batal Game"; 
    navBeranda.classList.add('text-danger'); 
    btnMenuInduk.textContent = "Skip ⏭️";
    btnMenuInduk.classList.add('text-primary');
    document.getElementById('submenu-atas').classList.add('d-none');

    // 4. Bersihkan Peta Utama (Isolasi)
    Cluster.clearLayers();
    if (Map) Map.closePopup();
    
    // 5. Mulai Ronde 1
    jalankanRonde();
});

navBeranda.addEventListener('click', function(e) {
    if (isGameMode) {
        e.preventDefault(); 
        akhiriGameMode();
    }
});

btnMenuInduk.addEventListener('click', function(e) {
    if (isGameMode) {
        e.preventDefault();
        e.stopPropagation();
        
        clearAllGameTimeouts();
        currentGameRound++;
        if (currentGameRound > 3) {
            akhiriGameMode(true); // Selesai
        } else {
            jalankanRonde();
        }
    }
});

// ==========================================
// 3. LOGIKA RONDE GAME
// ==========================================
function jalankanRonde() {
    clearAllGameTimeouts();
    if (Map) Map.closePopup();
    if (gameClusterLayer) {
        Map.removeLayer(gameClusterLayer);
        gameClusterLayer = null;
    }
    
    gameDialog.classList.remove('d-none');
    gameOverlay.classList.remove('lock-screen', 'd-none');
    document.getElementById('game-title').textContent = `Tantangan ${currentGameRound}/3`;
    gameDialog.style.border = "none";

    // Buat Layer Khusus Game
    gameClusterLayer = L.markerClusterGroup({
        maxClusterRadius: 40,
        spiderfyOnMaxZoom: true,
        zoomToBoundsOnClick: true
    });

    // Ambil Data Memenuhi Syarat
    let allValid = Object.values(Records).filter(r => r.lat && r.lon && r.imageFilename);
    let availableForTarget = allValid.filter(r => !usedGameQIDs.has(r.id));
    
    // Pilih Target
    targetGameData = availableForTarget[Math.floor(Math.random() * availableForTarget.length)];
    usedGameQIDs.add(targetGameData.id);

    // Pilih 9 Distractor (Untuk dimunculkan di peta)
    let distractorPool = allValid.filter(r => r.id !== targetGameData.id);
    let shuffledDistractors = distractorPool.sort(() => 0.5 - Math.random()).slice(0, 9);
    
    poolGameData = [targetGameData, ...shuffledDistractors];
    
    if (currentGameRound === 1) setupGame1();
    else if (currentGameRound === 2) setupGame2();
    else if (currentGameRound === 3) setupGame3();

    Map.addLayer(gameClusterLayer);
    
    // Zoom agar semua marker game terlihat
    let groupBounds = L.featureGroup(gameClusterLayer.getLayers()).getBounds();
    Map.flyToBounds(groupBounds, { duration: 1.5, padding: [30, 30] });
}

// ------------------------------------------
// GAME 1: Cari Marker di Peta
// ------------------------------------------
function setupGame1() {
let prefix = getGamePrefix();
    let kataTanya = (prefix === 'letak' || prefix === 'lokasi sekarang') ? 'lokasi' : prefix;
    
    gameMessage.innerHTML = `Temukan di peta ${kataTanya}:<br><strong style="font-size:20px; color:#d9534f;">${targetGameData.title}</strong>?`;
    
    // Peta bisa diklik
    poolGameData.forEach(record => {
        let marker = L.marker([record.lat, record.lon], { icon: ikonTetesanAir });
        
        // Event khusus game
        marker.on('click', function() {
            let isBenar = (record.id === targetGameData.id);
            evaluasiJawabanGame(isBenar, record.title, record.id, marker);
        });
        
        gameClusterLayer.addLayer(marker);
    });
}

// ------------------------------------------
// GAME 2: Tebak Wilayah (Pilihan Ganda)
// ------------------------------------------
function setupGame2() {
let prefix = getGamePrefix();
    let kataTanya = (prefix === 'letak' || prefix === 'lokasi sekarang') ? 'lokasi' : prefix;
    
    gameMessage.innerHTML = `Di manakah ${kataTanya} dari:<br><strong style="font-size:20px; color:#d9534f;">${targetGameData.title}</strong>?`;
    
    // 2. Siapkan Marker BISU di peta
    poolGameData.forEach(record => {
        let marker = L.marker([record.lat, record.lon], { icon: ikonTetesanAir, interactive: false }); // interactive: false = BISU
        gameClusterLayer.addLayer(marker);
    });

    // 3. Ambil Wilayah Benar
    let provIdsBenar = Object.keys(targetGameData.designations).filter(p => p !== 'all' && ProvinceIndex[p] && ProvinceIndex[p].name !== 'Wilayah Lainnya/Tidak Spesifik');
    let namaWilayahBenar = provIdsBenar.length > 0 ? ProvinceIndex[provIdsBenar[0]].name : "Wilayah Khusus";

    // 4. Cari 3 Wilayah Salah (Distractor)
    let semuaWilayahUnik = Object.keys(ProvinceIndex)
        .filter(k => k !== 'all' && ProvinceIndex[k].name !== 'Wilayah Lainnya/Tidak Spesifik' && ProvinceIndex[k].name !== namaWilayahBenar)
        .map(k => ProvinceIndex[k].name);
    
    let distractors = semuaWilayahUnik.sort(() => 0.5 - Math.random()).slice(0, 3);
    let options = [{ nama: namaWilayahBenar, benar: true }, ...distractors.map(d => ({ nama: d, benar: false }))];
    options.sort(() => 0.5 - Math.random());

    // 5. Render Tombol Pilihan
    renderTombolPilihanGanda(options, targetGameData.mapMarker); // Kirim marker asli untuk evaluasi
}

// ------------------------------------------
// GAME 3: Tebak Nama dari Gambar
// ------------------------------------------
function setupGame3() {
let imgUrl = `${COMMONS_WIKI_URL_PREF}Special:FilePath/${encodeURIComponent(targetGameData.imageFilename)}?width=500`;
    
    let tanyaNama = `Apa nama ${currentNamaKlaster.toLowerCase()} ini?`;
    if (currentNamaKlaster === 'Tempat lahir tokoh') {
        tanyaNama = `Siapa nama tokoh ini?`;
    }

    gameMessage.innerHTML = `
        ${tanyaNama}<br>
        <img src="${imgUrl}" style="width:100%; max-height:180px; object-fit:cover; border-radius:8px; margin-top:10px; border:2px solid #ddd;">
    `;

    // Marker Bisu
    poolGameData.forEach(record => {
        let marker = L.marker([record.lat, record.lon], { icon: ikonTetesanAir, interactive: false });
        gameClusterLayer.addLayer(marker);
    });

    // Cari distractor dari provinsi yang sama jika ada
    let provIdsBenar = Object.keys(targetGameData.designations).filter(p => p !== 'all' && ProvinceIndex[p]);
    let provTarget = provIdsBenar.length > 0 ? provIdsBenar[0] : null;

    let distractorPool = [];
    if (provTarget) {
        distractorPool = Object.values(Records).filter(r => r.id !== targetGameData.id && r.areaTags.has(provTarget));
    }
    
    // Jika kurang dari 3, ambil acak dari tempat lain
    if (distractorPool.length < 3) {
        let sisanya = Object.values(Records).filter(r => r.id !== targetGameData.id && !distractorPool.includes(r));
        distractorPool = distractorPool.concat(sisanya.sort(() => 0.5 - Math.random()).slice(0, 3 - distractorPool.length));
    }

    let distractors = distractorPool.sort(() => 0.5 - Math.random()).slice(0, 3);
    let options = [{ nama: targetGameData.title, benar: true }, ...distractors.map(d => ({ nama: d.title, benar: false }))];
    options.sort(() => 0.5 - Math.random());

    renderTombolPilihanGanda(options, targetGameData.mapMarker);
}

// ------------------------------------------
// HELPER UI: Render Tombol Game 2 & 3
// ------------------------------------------
function renderTombolPilihanGanda(options, markerTargetAsli) {
    let htmlTombol = `<div class="game-options-grid mt-10" style="display:grid; grid-template-columns:1fr 1fr; gap:10px;">`;
    options.forEach((opt, idx) => {
        htmlTombol += `<button class="btn-game-option" data-benar="${opt.benar}" data-nama="${opt.nama}" style="padding:10px; border:1px solid #ccc; background:#f9f9f9; border-radius:5px; cursor:pointer; font-size:13px; font-weight:bold;">${opt.nama}</button>`;
    });
    htmlTombol += `</div>`;
    
    gameMessage.insertAdjacentHTML('beforeend', htmlTombol);

    let buttons = gameMessage.querySelectorAll('.btn-game-option');
    buttons.forEach(btn => {
        btn.addEventListener('click', function() {
            let isBenar = this.getAttribute('data-benar') === 'true';
            let namaDiklik = this.getAttribute('data-nama');
            
            // Matikan tombol agar tidak di-spam klik
            buttons.forEach(b => b.disabled = true);
            
            // Jika salah, warnai yang benar dengan hijau agar user tahu
            if (!isBenar) {
                this.style.background = "#ffcccc";
                this.style.borderColor = "red";
                let btnBenar = gameMessage.querySelector('.btn-game-option[data-benar="true"]');
                if(btnBenar) {
                    btnBenar.style.background = "#ccffcc";
                    btnBenar.style.borderColor = "green";
                }
            } else {
                this.style.background = "#ccffcc";
                this.style.borderColor = "green";
            }

            evaluasiJawabanGame(isBenar, namaDiklik, targetGameData.id, markerTargetAsli);
        });
    });
}


// ==========================================
// 4. EVALUASI JAWABAN (ANIMASI & TIMEOUT)
// ==========================================
Tepat sekali sayangku! Anda sangat pintar karena menyadari bahwa logika isSamePoint dan maxZoom sudah Anda miliki di JS 1. Kita sama sekali tidak perlu membuat event clusterclick baru, cukup menyisipkan logika game ke dalam kode JS 1 Anda yang sudah sangat rapi itu!

Ini adalah cara paling aman dan bersih agar tidak ada bentrok fungsi antara peta reguler dan game.

Berikut adalah 2 perubahan pasti yang harus Anda lakukan:

1. Perubahan di evaluasiJawabanGame (di file JS Game)
Ganti seluruh fungsi evaluasiJawabanGame Anda dengan kode di bawah ini. Saya sudah menambahkan waktu ekstra (200ms) pada timer dan memperbaiki cara Leaflet mengecek status kluster dengan parameter bawaan Anda:

JavaScript
function evaluasiJawabanGame(isBenar, titleDiklik, qidDiklik, markerSistem) {
    if (isBenar) gameScore++; // <--- TAMBAHAN UNTUK MENGHITUNG SKOR
    gameOverlay.classList.add('lock-screen');
    document.getElementById('game-title').textContent = isBenar ? "Tepat Sekali! 🎉" : "Sayang Sekali ❌";
    
    if (currentGameRound === 1) {
        if (isBenar) gameMessage.innerHTML = `Anda berhasil menemukan <strong>${targetGameData.title}</strong>!`;
        else gameMessage.innerHTML = `Anda memilih <strong>${titleDiklik}</strong>.<br>Mengarahkan ke lokasi yang benar...`;
    }

    gameDialog.style.border = isBenar ? "3px solid green" : "3px solid red";
    
    // Animasi Terbang
    let durasiTerbang = isBenar ? 1.5 : 2.5;
    
    // --- FIX BUG RACE CONDITION ---
    // Ditambah 200ms dari durasi terbang (1500 -> 1700, 2500 -> 2700) 
    // agar animasi peta dijamin berhenti sebelum Leaflet mencoba membuka popup
    let waktuTungguBukaPopup = isBenar ? 1700 : 2700;

    Map.flyTo([targetGameData.lat, targetGameData.lon], 17, { duration: durasiTerbang });

    let t1 = setTimeout(() => {
        // --- FIX BUG LEAFLET MARKERCLUSTER ---
        // Gunakan getVisibleParent untuk mengecek apakah marker sedang sembunyi di dalam kluster
        let parent = gameClusterLayer ? gameClusterLayer.getVisibleParent(markerSistem) : null;
        
        if (parent && parent.spiderfy) {
            // Jika ia berupa kluster (memiliki fungsi spiderfy), maka urai dulu
            gameClusterLayer.zoomToShowLayer(markerSistem, function() {
                markerSistem.openPopup();
                bukaPanelEksklusif(targetGameData.id);
            });
        } else {
            // Jika marker sudah berdiri sendiri di peta, langsung buka
            if (markerSistem) markerSistem.openPopup();
            bukaPanelEksklusif(targetGameData.id);
        }

        // Tahan 5 Detik, lalu tutup dan lanjut ronde
        let t2 = setTimeout(() => {
            if (Map) Map.closePopup();
            tutupPanelEksklusif();
            
            currentGameRound++;
            if (currentGameRound > 3) akhiriGameMode(true);
            else jalankanRonde();

        }, 5000);
        gameTimeouts.push(t2);

    }, waktuTungguBukaPopup);

    gameTimeouts.push(t1);
}

// ==========================================
// 5. HELPER PANEL (Tanpa Ubah URL Hash)
// ==========================================
function bukaPanelEksklusif(qid) {
    displayRecordDetails(qid); // Panggil fungsi JS 2
    if (typeof window.setMobilePanelExpanded === 'function') {
        window.setMobilePanelExpanded(true, true);
    }

    // --- TAMBAHAN BARU ---
    // 1. Sembunyikan kotak dialog game agar tidak menutupi layar
    const gameDialog = document.getElementById('game-dialog');
    if (gameDialog) gameDialog.classList.add('d-none');

    // 2. Normalkan panel (hapus efek blur) agar user bisa membaca dengan jelas
    const panelMobile = document.getElementById('panel');
    if (panelMobile) {
        panelMobile.style.pointerEvents = 'auto';
        panelMobile.style.opacity = '1';
    }
    // ---------------------
}
function tutupPanelEksklusif() {
    displayPanelContent('index'); // Kembalikan panel ke index
    if (typeof window.setMobilePanelExpanded === 'function') {
        window.setMobilePanelExpanded(false, false);
    }

    // --- TAMBAHAN BARU ---
    // Kembalikan efek blur/kunci panel jika game masih berlanjut ke ronde berikutnya
    const panelMobile = document.getElementById('panel');
    if (panelMobile && isGameMode) {
        panelMobile.style.pointerEvents = 'none';
        panelMobile.style.opacity = '0.5';
    }
    // ---------------------
}
// ==========================================
// 6. MANAJEMEN TIMEOUT & AKHIRI GAME
// ==========================================
function clearAllGameTimeouts() {
    gameTimeouts.forEach(t => clearTimeout(t));
    gameTimeouts = [];
}

function akhiriGameMode(isMenang = false) {
    isGameMode = false;
    clearAllGameTimeouts();

    // 1. Bersihkan UI Game
    if (gameClusterLayer) {
        Map.removeLayer(gameClusterLayer);
        gameClusterLayer = null;
    }
    gameDialog.classList.add('d-none');
    gameOverlay.classList.remove('lock-screen');
    gameOverlay.classList.add('d-none');
    document.getElementById('game-title').textContent = "Tantangan Game!";

    // 2. Kembalikan Navigasi Menu
    navHasil.classList.remove('nav-disabled');
    navBeranda.textContent = "Beranda";
    navBeranda.classList.remove('text-danger');
    btnMenuInduk.textContent = "Lainnya";
    btnMenuInduk.classList.remove('text-primary');
    
    let subMenu = document.getElementById('submenu-atas');
    if(subMenu) subMenu.classList.add('d-none');

    // 3. Buka Kunci Mobile Panel
    const panelMobile = document.getElementById('panel'); 
    if (panelMobile) {
        panelMobile.style.pointerEvents = 'auto'; 
        panelMobile.style.opacity = '1'; 
    }
    
    // 4. Pulihkan Filter ke State Awal
    if (Object.keys(savedFilterState).length > 0) {
        currentRegionFilter = savedFilterState.region;
        currentUsiaFilter = savedFilterState.usia;
        currentUsiaSort = savedFilterState.sort;
        currentSearchQuery = savedFilterState.search;
        activeFeatures = new Set(savedFilterState.features);
        
        let selectRegion = document.getElementById('filter-region');
        if(selectRegion) selectRegion.value = currentRegionFilter;
        
        let selectKombinasi = document.getElementById('filter-sort-kombinasi');
        if(selectKombinasi) selectKombinasi.value = (currentUsiaFilter !== 'all' || currentUsiaSort !== 'default') ? (currentUsiaFilter === 'all' ? `sort-${currentUsiaSort}` : `filter-${currentUsiaFilter}`) : 'default';

        let searchInput = document.getElementById('search-input');
        if(searchInput) searchInput.value = currentSearchQuery;

        document.querySelectorAll('.feat-btn').forEach(btn => {
            let type = btn.getAttribute('data-filter');
            if (activeFeatures.has(type)) btn.classList.add('active');
            else btn.classList.remove('active');
        });
        
        let btnAll = document.getElementById('btn-all');
        if (btnAll) {
            if (savedFilterState.isAllActive) btnAll.classList.add('active');
            else btnAll.classList.remove('active');
        }
    }

    // 5. Render Ulang Marker Normal
    applyIntersectionFilter(true);
    tutupPanelEksklusif();
    Map.closePopup();
if (isMenang) {
        setTimeout(() => {
            let pesanSkor = gameScore > 0 
                ? `Selamat! Anda menjawab benar <b>${gameScore} dari 3</b> pertanyaan!<br><br>Mau mencoba lagi?`
                : `Anda belum berhasil menjawab pertanyaan dengan benar!<br><br>Mau mencoba lagi?`;
            
            // Menggunakan tipe 'confirm' agar muncul tombol Ya dan Tutup/Tidak
            tampilkanDialog(pesanSkor, "confirm", "Skor Akhir 🏆").then(mauMainLagi => {
                if (mauMainLagi) {
                    // Memicu klik tombol mulai game secara otomatis untuk ronde baru
                    document.getElementById('btn-mulai-game').click();
                }
            });
        }, 500);
    }
}
