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
        spiderfyOnMaxZoom: false, // <--- TAMBAHAN: Matikan paksa fitur mekar!
zoomToBoundsOnClick: false
    });

    // ---> TAMBAHAN WAJIB: Event klik kluster KHUSUS layer game
gameClusterLayer.on('clusterclick', function (a) {
    if (currentGameRound !== 1) return; 

    let cluster = a.layer;
    let bounds = cluster.getBounds();
    let isSamePoint = bounds.getSouthWest().equals(bounds.getNorthEast());
    
    let currentZoom = Map.getZoom();
    let maxZoom = Map.getMaxZoom();

    // JIKA TITIK BERTUMPUK PERSIS ATAU ZOOM MENTOK -> LANGSUNG EVALUASI
    if (isSamePoint || currentZoom >= maxZoom) {
        let anakKluster = cluster.getAllChildMarkers();
        let targetDitemukan = false;

        for (let i = 0; i < anakKluster.length; i++) {
            if (anakKluster[i] === targetGameData.mapMarkerGame) {
                targetDitemukan = true;
                break;
            }
        }

        if (targetDitemukan) {
            evaluasiJawabanGame(true, targetGameData.title, targetGameData.id, targetGameData.mapMarkerGame);
        } else {
            evaluasiJawabanGame(false, "Area Titik Bertumpuk", null, targetGameData.mapMarkerGame);
        }
    } 
    // JIKA KLASTER NORMAL (Titik Berbeda) -> LAKUKAN ZOOM-IN SECARA MANUAL
    else {
        Map.fitBounds(bounds, { padding: [30, 30], maxZoom: maxZoom });
    }
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
    // --- PERUBAHAN LOGIKA ZOOM ---
    if (currentGameRound === 1) {
        // Hanya Ronde 1 yang memiliki marker di peta, biarkan peta zoom ke kumpulan marker tersebut
        let groupBounds = L.featureGroup(gameClusterLayer.getLayers()).getBounds();
        Map.flyToBounds(groupBounds, { duration: 1.5, padding: [30, 30] });
    } else {
        // Ronde 2 & 3: Tampilkan seluruh wilayah Indonesia secara pas di layar
        Map.fitBounds([
            [MAX_PH_LAT, MAX_PH_LON], 
            [MIN_PH_LAT, MIN_PH_LON]
        ], { 
            duration: 1.5, 
            padding: [20, 20] 
        });
    }
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
        
        // ---> TAMBAHAN WAJIB: Simpan referensi marker ke data record 
        // agar nanti bisa dicocokkan saat kluster diklik
        record.mapMarkerGame = marker; 
        
        // Event klik normal (untuk marker yang berdiri sendiri / tidak bertumpuk)
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
    
 // 3. Ambil Semua Wilayah Benar
    let provIdsBenar = Object.keys(targetGameData.designations).filter(p => p !== 'all' && ProvinceIndex[p] && ProvinceIndex[p].name !== 'Wilayah Lainnya/Tidak Spesifik');
    
    // Petakan ke nama-nama wilayahnya (Misal: ["Jawa Barat", "Jawa Timur", "Jawa Tengah"])
    let semuaNamaWilayahBenar = provIdsBenar.map(id => ProvinceIndex[id].name);
    
    // Pilih HANYA 1 secara acak untuk dijadikan jawaban benar di layar
    let namaWilayahBenar = semuaNamaWilayahBenar.length > 0 
        ? semuaNamaWilayahBenar[Math.floor(Math.random() * semuaNamaWilayahBenar.length)] 
        : "Wilayah Khusus";

    // 4. Cari 3 Wilayah Salah (Distractor) yang PASTI SALAH
    let semuaWilayahPengecoh = Object.keys(ProvinceIndex)
        .filter(k => k !== 'all' && ProvinceIndex[k] && ProvinceIndex[k].name !== 'Wilayah Lainnya/Tidak Spesifik')
        .map(k => ProvinceIndex[k].name)
        // FILTER MUTLAK: Pastikan nama pengecoh TIDAK ADA dalam daftar wilayah yang benar
        .filter(nama => !semuaNamaWilayahBenar.includes(nama)); 
    
    // Buang duplikat jika ada, lalu acak dan ambil 3
    semuaWilayahPengecoh = [...new Set(semuaWilayahPengecoh)];
    let distractors = semuaWilayahPengecoh.sort(() => 0.5 - Math.random()).slice(0, 3);
    
    let options = [{ nama: namaWilayahBenar, benar: true }, ...distractors.map(d => ({ nama: d, benar: false }))];
    options.sort(() => 0.5 - Math.random());

    // 5. Render Tombol Pilihan
let markerRahasia = L.marker([targetGameData.lat, targetGameData.lon], { icon: ikonTetesanAir });
    renderTombolPilihanGanda(options, markerRahasia);
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

// --- TAMBAHAN BARU ---
    let markerRahasia = L.marker([targetGameData.lat, targetGameData.lon], { icon: ikonTetesanAir });
    renderTombolPilihanGanda(options, markerRahasia);
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

function evaluasiJawabanGame(isBenar, titleDiklik, qidDiklik, markerSistem) {
    if (isBenar) gameScore++; 
    gameOverlay.classList.add('lock-screen');
    document.getElementById('game-title').textContent = isBenar ? "Tepat Sekali! 🎉" : "Sayang Sekali ❌";
    
    if (currentGameRound === 1) {
        if (isBenar) gameMessage.innerHTML = `Anda berhasil menemukan <strong>${targetGameData.title}</strong>!`;
        else gameMessage.innerHTML = `Anda memilih <strong>${titleDiklik}</strong>.<br>Mengarahkan ke lokasi yang benar...`;
    }

    gameDialog.style.border = isBenar ? "3px solid green" : "3px solid red";

    // Masukkan marker rahasia ke peta HANYA setelah pemain selesai menjawab (Khusus Ronde 2 & 3)
    if (markerSistem && !gameClusterLayer.hasLayer(markerSistem)) {
        gameClusterLayer.addLayer(markerSistem);
    }
    
    // Animasi Terbang
    let durasiTerbang = isBenar ? 1.5 : 2.5;
    let waktuTungguBukaPopup = isBenar ? 1700 : 2700;

    Map.flyTo([targetGameData.lat, targetGameData.lon], 17, { duration: durasiTerbang });

    let t1 = setTimeout(() => {
        // --- PERBAIKAN TOTAL: Tanpa spiderfy, langsung buka panel dan cek popup aman ---
        bukaPanelEksklusif(targetGameData.id);
        
        let parent = gameClusterLayer ? gameClusterLayer.getVisibleParent(markerSistem) : null;
        if (!parent || !parent.spiderfy) {
            if (markerSistem) markerSistem.openPopup();
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
    clearAllGameTimeouts();
    
    // Sembunyikan kotak game
    if (gameDialog) gameDialog.classList.add('d-none');

    if (isMenang) {
        // TAHAN KUNCIAN! Pastikan mode game masih true dan panel terkunci
        gameOverlay.classList.add('lock-screen');
        gameOverlay.classList.remove('d-none');
        
        const panelMobile = document.getElementById('panel');
        if (panelMobile) {
            panelMobile.style.pointerEvents = 'none';
            panelMobile.style.opacity = '0.5';
        }

        setTimeout(() => {
            let pesanSkor = gameScore > 0 
                ? `Selamat! Anda menjawab benar <b>${gameScore} dari 3</b> pertanyaan!<br><br>Mau mencoba lagi?`
                : `Anda belum berhasil menjawab pertanyaan dengan benar!<br><br>Mau mencoba lagi?`;
            
            // Tunggu user menjawab dialog INI sebelum mereset UI
            tampilkanDialog(pesanSkor, "confirm", "Skor Akhir 🏆").then(mauMainLagi => {
                // SETELAH DIJAWAB, barulah kita bersihkan kunciannya
                lakukanPembersihanUIGame();
                
                if (mauMainLagi) {
                    document.getElementById('btn-mulai-game').click();
                }
            });
        }, 500);
    } else {
        // Jika diberhentikan paksa (Batal Game), langsung bersihkan
        lakukanPembersihanUIGame();
    }
}

// FUNGSI BARU: Pembersihan dipisah agar bisa dieksekusi setelah dialog ditutup
function lakukanPembersihanUIGame() {
    isGameMode = false; // Buka kunci navigasi hash

    // 1. Bersihkan UI Game
    if (gameClusterLayer) {
        Map.removeLayer(gameClusterLayer);
        gameClusterLayer = null;
    }
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
}
