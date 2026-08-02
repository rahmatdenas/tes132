'use strict';

const CHUNK_SIZE = 35;
var currentRenderIndex = 0;
var currentFilteredRecords = [];
var isFilterEventAttached = false; 

function potongJadiKelompok(array, ukuran) {
  let hasilPotongan = [];
  for (let i = 0; i < array.length; i += ukuran) {
    hasilPotongan.push(array.slice(i, i + ukuran));
  }
  return hasilPotongan;
}

function formatWikidataDate(dateString, precision) {
  if (!dateString) return null;  
  let cleanStr = dateString.replace(/^[+-]/, '');   
  let yearStr  = cleanStr.substring(0, 4);
  let monthStr = cleanStr.substring(5, 7);
  let dayStr   = cleanStr.substring(8, 10);
  let yearNum  = parseInt(yearStr);
  const bulanIndo = ['', 'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
  let prec = parseInt(precision) || 9; 
  if (prec === 11) {
    return `${parseInt(dayStr)} ${bulanIndo[parseInt(monthStr)]} ${yearStr}`;
  } 
  else if (prec === 10) {
    return `${bulanIndo[parseInt(monthStr)]} ${yearStr}`;
  } 
  else if (prec === 9) {
    return yearStr;
  } 
  else if (prec === 8) {
    return `${yearStr}-an`;
  } 
  else if (prec === 7) {
    let century = Math.ceil(yearNum / 100);
    return `abad ke-${century}`;
  } 
  else {
    return yearStr;
  }
}

function loadPrimaryData() {
  let tiketPencarianIni = currentSearchToken;
  
  doPreProcessing();

  populateProvinceTypesData() 
    .then(() => {
      if (currentSearchToken !== tiketPencarianIni) throw 'ABORTED';
      if (globalFetchController && globalFetchController.signal.aborted && !window.hentikanPencarian) throw 'ABORTED';
      
      return populateCoordinatesData().then(() => {
         if (currentSearchToken !== tiketPencarianIni) throw 'ABORTED';
         if (globalFetchController && globalFetchController.signal.aborted && !window.hentikanPencarian) throw 'ABORTED';
         populateMapAndIndex();
      });
    })
    .then(() => {
      if (currentSearchToken !== tiketPencarianIni) throw 'ABORTED';
      if (globalFetchController && globalFetchController.signal.aborted && !window.hentikanPencarian) throw 'ABORTED';
      
      enableApp(); 
      applyIntersectionFilter(); 

      let btnAll = document.getElementById('btn-all');
      if (btnAll) {
        btnAll.classList.remove('disabled'); 
        btnAll.classList.add('active');      
      }

      populateImageAndWikipediaData();
    })
 .catch(error => {
       if (error === 'ABORTED' || (error && error.name === 'AbortError')) {
         console.log("Pencarian dibatalkan atau diganti. Data kadaluarsa dibuang.");
         return; 
       }

       isFetching = false;
       PrimaryDataIsLoaded = false;

       let indexList = document.getElementById('index-list');
       if (indexList) {         
         indexList.innerHTML = `
           <div class="empty-state-container">
             <h3 class="empty-state-title text-error">Gagal Menarik Data</h3>
             <p class="empty-state-desc">Pastikan internet stabil atau tutup dan coba lagi nanti. Jika data gagal dimuat karena terlalu banyak (lebih dari 20.000), silakan persempit pencarian.</p>
             <a href="#" onclick="window.location.href = window.location.pathname; return false;" class="btn-primary-large">Kembali</a>
           </div>
         `;
       }
  
       console.error("Data utama gagal dimuat. Cek koneksi atau server Wikidata.", error);
    });
}

function doPreProcessing() {
  let anchorElem = document.getElementById('wdqs-link');
  if (anchorElem) {
    anchorElem.href = 'https://query.wikidata.org/#' + encodeURIComponent(ABOUT_SPARQL_QUERY);
  }
  processHashChange();
}

var currentKategoriUtama = 'general'; 
var currentNamaKlaster = 'Objek';     
var currentNamaWilayah = 'Semua Wilayah'; 

function populateProvinceTypesData() {
  let inputTxt = document.getElementById('jenis-input').value.trim();
  
  let kategoriUtama = document.getElementById('kategori-wilayah-utama').value;
  let provDropdown = document.getElementById('provinsi-input');
  let negaraDropdown = document.getElementById('negara-input');
  
  let provInput = (kategoriUtama === 'provinsi') ? provDropdown.value : kategoriUtama; 
  
  let jenisDropdown = document.getElementById('jenis-dropdown');
  let opsiTerpilih = jenisDropdown.options[jenisDropdown.selectedIndex];

  if (jenisDropdown.value === 'custom') {
    currentNamaKlaster = 'Objek'; 
  } else {
    currentNamaKlaster = opsiTerpilih.text; 
  }

  currentKategoriUtama = opsiTerpilih.getAttribute('data-kategori') || 'general';
  let propLokasi = opsiTerpilih.getAttribute('data-lokasi') || 'P131';
  let propTahun = opsiTerpilih.getAttribute('data-tahun') || 'P571';
  
  if (kategoriUtama === 'luar_negeri') {
    currentNamaWilayah = negaraDropdown.options[negaraDropdown.selectedIndex].text;
  } else if (kategoriUtama === 'all') {
    currentNamaWilayah = 'Seluruh Indonesia';
  } else {
    currentNamaWilayah = provDropdown.options[provDropdown.selectedIndex].text;
  }
  
  let brandingDesc = document.getElementById('branding-desc');
  if (brandingDesc) {
    brandingDesc.textContent = `${currentNamaKlaster} di ${currentNamaWilayah}`;
  }

  let indexList = document.getElementById('index-list');
  if (indexList) {
    indexList.innerHTML = `
      <div class="empty-state-container">
        <h3 id="loading-text" class="empty-state-title">
          Sedang Menarik Data<br/>${currentNamaKlaster} di ${currentNamaWilayah}
        </h3>
        <p class="empty-state-desc">Harap menunggu sebentar...</p>
        <div class="loader loader-center"></div>
      <div id="wadah-tombol-berhenti" class="mt-42"></div>
      </div>
    `;
  }
  
  function eksekusiKueriKeWikidata(kueriFinal) {
    console.log("Kueri yang dikirim:", kueriFinal);
    return queryWdqsPaginated(
      kueriFinal,
      function(result) {
        let qid = result.SQ.value;
        
        if (!(qid in Records)) Records[qid] = new SimpleRecord(); 
        
        let record = Records[qid];
        record.id = qid;

        record.title = ('sLabel' in result && result.sLabel.value) ? result.sLabel.value : '[ERROR: No title]';

        let provQid = result.PQ ? result.PQ.value : 'Q_UNKNOWN';
        let provLabel = result.pLabel ? result.pLabel.value : 'Wilayah Lainnya/Tidak Spesifik';

        if (!(provQid in ProvinceIndex)) {
          ProvinceIndex[provQid] = new ProvinceIndexEntry();
          ProvinceIndex[provQid].name = provLabel; 
        }
        if (!(provQid in record.designations)) record.designations[provQid] = provLabel; 
        
        record.areaTags.add(provQid);
        
        if ('lLabel' in result && result.lLabel.value) record.lokasiSpesifik = result.lLabel.value;
        
        if (!record.tahunBerdiri && result.tM && result.tM.value) {
          let precision = result.tP ? result.tP.value : 9;
          record.tahunBerdiri = formatWikidataDate(result.tM.value, precision);        
          record.rawTahunBerdiri = result.tM.value.replace(/^[+-]/, '');
        }
      },
      function() {
        populateProvinceIndex(); 
        Object.values(Records).forEach(record => { record.indexTitle = record.title });
      },
      5000 
    );
  }

  let baseQuery = KUMPULAN_KUERI_0['universal'];
  
  if (inputTxt.toLowerCase() === 'apapun') {
    baseQuery = KUMPULAN_KUERI_0['apapun'];
    currentNamaKlaster = 'Objek'; 
  }

  let wilayahClause1 = '';
  let unionEkstra = ''; 
  let hierarkiLokasi = '?l wdt:P131* ?p .'; 
  let kurungBuka = '';
  let kurungTutup = '';
  
  const klasterKhususNasional = ['Kabupaten dan kota', 'Gempa bumi dan tsunami', 'Peristiwa lainnya', 'Publikasi', 'Lukisan'];
  let isKhususNasional = klasterKhususNasional.includes(currentNamaKlaster);
  let filterNasional = '?s wdt:P17 wd:Q252 .';
  
  if (currentNamaKlaster === 'Publikasi') {
    filterNasional = '?s wdt:P407 wd:Q9240 .';
  }

  if (provInput === 'luar_negeri') {
    let negaraDropdown = document.getElementById('negara-input');
    let negaraValue = negaraDropdown.value;
    
    baseQuery = KUMPULAN_KUERI_0['luar_negeri'];
    let dynamicQuery = baseQuery;

    if (inputTxt.toLowerCase() === 'apapun') {
      dynamicQuery = dynamicQuery.replace(/VALUES \?j \{ <PLACEHOLDER_JENIS> \}/g, '');
    } else {
      dynamicQuery = dynamicQuery.replace(/<PLACEHOLDER_JENIS>/g, inputTxt);
    }
    
    dynamicQuery = dynamicQuery
      .replace(/<PLACEHOLDER_NEGARA>/g, negaraValue)
      .replace(/<PLACEHOLDER_PROP_LOKASI>/g, propLokasi)
      .replace(/<PLACEHOLDER_PROP_TAHUN>/g, propTahun);
      
    return eksekusiKueriKeWikidata(dynamicQuery); 
  }
  
  if (provInput === 'all') {
    wilayahClause1 = '?p wdt:P31 wd:Q5098 .';
    
    if (isKhususNasional && inputTxt.toLowerCase() !== 'apapun') {
      baseQuery = KUMPULAN_KUERI_0['khusus_negara_all'];
    }
  } else {
    wilayahClause1 = `?p wdt:P131 ${provInput}.`;
    let wilayahClause2 = `BIND(${provInput} AS ?p) BIND(${provInput} AS ?l)`; 
    
    kurungBuka = '{';
    kurungTutup = '}';
    
    unionEkstra = `
    UNION {
      ${wilayahClause2}
      ?s wdt:P31 ?j ;
         wdt:${propLokasi} ?l .
    }`;
    
    if (inputTxt.toLowerCase() === 'apapun') {
       unionEkstra = `
       UNION {
         ${wilayahClause2}
         ?s wdt:P17 wd:Q252 ;
            wdt:P625 [] ;
            wdt:P18 [] ;
            wdt:P131 ?l .
       }`;
    }
  }
  
  let dynamicQuery = baseQuery
    .replace(/<PLACEHOLDER_FILTER_NASIONAL>/g, filterNasional)
    .replace(/<PLACEHOLDER_KURUNG_BUKA>/g, kurungBuka)  
    .replace(/<PLACEHOLDER_KURUNG_TUTUP>/g, kurungTutup)  
    .replace(/<PLACEHOLDER_WILAYAH_1>/g, wilayahClause1)
    .replace(/<PLACEHOLDER_PROP_LOKASI>/g, propLokasi)
    .replace(/<PLACEHOLDER_PROP_TAHUN>/g, propTahun)
    .replace(/<PLACEHOLDER_HIERARKI_LOKASI>/g, hierarkiLokasi)
    .replace(/<PLACEHOLDER_UNION_EKSTRA>/g, unionEkstra) 
    .replace(/<PLACEHOLDER_JENIS>/g, inputTxt);

  return eksekusiKueriKeWikidata(dynamicQuery);
}

async function populateCoordinatesData() {
  let daftarQid = Object.keys(Records).map(id => 'wd:' + id);
  if (daftarQid.length === 0) return;

  let jenisDropdown = document.getElementById('jenis-dropdown');
  let opsiTerpilih = jenisDropdown.options[jenisDropdown.selectedIndex];
  let namaKlaster = (jenisDropdown.value === 'custom') ? 'Objek' : opsiTerpilih.text;
  let propLokasi = opsiTerpilih.getAttribute('data-lokasi') || 'P131';

  let templateKueri = KUMPULAN_KUERI_1['universal'];

  const klasterTanpaKoordinatLangsung = [
    'Hidangan', 'Pakaian', 'Tari dan pertunjukan', 'Ritual dan upacara',  'Artefak',
    'Budaya rakyat', 'Lukisan', 'Lontar', 'Naskah', 'Perang & konflik',
    'Tempat lahir tokoh', 'Bahasa', 'Publikasi', 'Media massa', 'Latar karya sastra'
  ];

  let klausaKoordinat = !klasterTanpaKoordinatLangsung.includes(namaKlaster) 
    ? `?site p:P625 ?coordStatement .` 
    : `?site wdt:${propLokasi} ?p131Lokasi . FILTER(?p131Lokasi != wd:Q252) ?p131Lokasi p:P625 ?coordStatement .`;

  let kelompokCicilan = potongJadiKelompok(daftarQid, 1000);
  
  let batchSize = 4; 
  let tiketPencarianIni = currentSearchToken;
  for (let i = 0; i < kelompokCicilan.length; i += batchSize) {
    if (currentSearchToken !== tiketPencarianIni) break;
    let potonganBatch = kelompokCicilan.slice(i, i + batchSize);
    
    let progressText = document.querySelector('#index-list p');
    if (progressText) {
      let persentase = Math.round((i / kelompokCicilan.length) * 100);
      progressText.innerHTML = `Menyusun koordinat... (${persentase}%)`;
    }

    let daftarJanji = potonganBatch.map(cicilan => {
      let kueriFinal = templateKueri
        .replace(/<PLACEHOLDER_QIDS>/g, cicilan.join(' '))
        .replace(/<PLACEHOLDER_KLAUSA_KOORDINAT>/g, klausaKoordinat);

      return queryWdqsThenProcess(kueriFinal, function(result) {
        let record = Records[result.siteQid.value];
        if (!record) return; 
        let wktBits = result.coord.value.split(/\(|\)| /);
        record.lat = parseFloat(wktBits[2]);
        record.lon = parseFloat(wktBits[1]);
}, null, null, 0);
    });

    try {
      await Promise.all(daftarJanji);
    } catch (error) {
      if (error === 'ABORTED') throw error;
      console.warn("Gagal tarik sebagian koordinat, lanjut ke batch berikutnya...", error);
    }
  }

  BootstrapDataIsLoaded = true;
}

async function populateImageAndWikipediaData() {
  let daftarQid = Object.values(Records)
    .sort((a, b) => a.indexTitle.localeCompare(b.indexTitle))
    .map(record => 'wd:' + record.id);
  
  if (daftarQid.length === 0) return;

  let kelompokCicilan = potongJadiKelompok(daftarQid, 1000);
  
  let btnImg = document.getElementById('btn-image') || document.querySelector('[data-filter="image"]');
  let btnArt = document.getElementById('btn-article') || document.querySelector('[data-filter="article"]');
  
  let totalData = daftarQid.length;
  let signal = typeof globalFetchController !== 'undefined' ? globalFetchController.signal : null;



  const tarikSatuKloter = async (cicilan) => {
    let kueriFinal = SPARQL_QUERY_3_TEMPLATE.replace('<PLACEHOLDER_QIDS>', cicilan.join(' '));
    
    return queryWdqsThenProcess(kueriFinal, function(result) {
      let rawQid = result.siteQid.value;
      let cleanQid = rawQid.includes('entity/') ? rawQid.split('entity/')[1] : rawQid;
      let record = Records[cleanQid];      
      
      if (!record) return; 

 if ('image' in result) {
      record.imageFilename = extractImageFilename(result.image);
      
      if (record.popup && record.popup.isOpen() && !record.popup._hasImage) {
        let encodedFilename = encodeURIComponent(record.imageFilename);
        let imgUrl = `${COMMONS_WIKI_URL_PREF}Special:FilePath/${encodedFilename}?width=250`;
        let imgHtml = `
          <div class="popup-img-container">
            <img src="${imgUrl}" draggable="false" class="popup-img" onload="let p = Records['${cleanQid}'].popup; if (p) p.update();">
          </div>
        `;
        record.popup.setContent(imgHtml + `${record.title}`);
        record.popup._hasImage = true;
      }
    }

      if ('wikipediaUrlTitle' in result) {
        let rawArt = result.wikipediaUrlTitle.value;
        record.articleTitle = decodeURIComponent(rawArt.substring(rawArt.lastIndexOf('/') + 1));
      }
}, null, signal, 0);
  };

  const evaluasiHasilKloter = (hasilKloter) => {
    for (let hasil of hasilKloter) {
      if (hasil.status === 'rejected') {
        if (hasil.reason === 'ABORTED' || (hasil.reason && hasil.reason.name === 'AbortError')) {
          throw 'ABORTED';
        }
        console.warn("Sebagian kloter gambar/artikel gagal ditarik. Sistem mengabaikan dan berlanjut...", hasil.reason);
      }
    }
  };

try {
    if (totalData <= 20000) {
      let daftarJanji = kelompokCicilan.map(cicilan => tarikSatuKloter(cicilan));
      let hasilKloter = await Promise.allSettled(daftarJanji);
      
      evaluasiHasilKloter(hasilKloter);
      if (signal && signal.aborted) throw 'ABORTED';
      
      if (btnImg) btnImg.classList.remove('disabled');
      if (btnArt) btnArt.classList.remove('disabled');

      if (activeFeatures.has('image') || activeFeatures.has('article')) {
        applyIntersectionFilter(true); 
      }

    } else {
      if (btnImg) btnImg.classList.remove('disabled');
      if (btnArt) btnArt.classList.remove('disabled');
      let batchSize = 3; 
      let chunksCompleted = 0;

      for (let i = 0; i < kelompokCicilan.length; i += batchSize) {
        if (signal && signal.aborted) throw 'ABORTED'; 

        let potonganBatch = kelompokCicilan.slice(i, i + batchSize);
        let daftarJanji = potonganBatch.map(cicilan => tarikSatuKloter(cicilan));
        
        let hasilKloter = await Promise.allSettled(daftarJanji);
        evaluasiHasilKloter(hasilKloter);

        chunksCompleted += potonganBatch.length;
        let persentase = Math.round((chunksCompleted / kelompokCicilan.length) * 100);
        
        if (btnImg) btnImg.textContent = `Gambar (${persentase}%)`;
        if (btnArt) btnArt.textContent = `Artikel (${persentase}%)`;
      }
      
      if (btnImg) btnImg.textContent = 'Memiliki Gambar';
      if (btnArt) btnArt.textContent = 'Memiliki Artikel';

      if (activeFeatures.has('image') || activeFeatures.has('article')) {
        applyIntersectionFilter(true); 
      }
    }
  isFetching = false;
  } catch (error) {
  isFetching = false;
    if (error === 'ABORTED' || (error && error.name === 'AbortError')) {
      console.log('Penarikan gambar/artikel dihentikan dengan rapi (AbortController).');
    } else {
      console.error("Proses penarikan gambar terhenti akibat fatal error:", error);
    }
  }

  if (signal && signal.aborted) return;
}

function populateImportantEventsData(qid) {
  let record = Records[qid];
  let queryStr = getSparqlQuery4(qid);

  record.events = []; 

  const ALLOWED_EVENTS = [
    'konstruksi', 
    'dibuka untuk umum', 
    'upacara pembukaan', 
    'renovasi', 
    'pembangunan kembali'
  ];

  return queryWdqsThenProcess(
    queryStr,
    function(result) {
      if ('eventLabel' in result && result.eventLabel.value) {
        let labelKecil = result.eventLabel.value.toLowerCase();
        
        if (ALLOWED_EVENTS.includes(labelKecil)) {
          let rawDateStr = (result.pointInTime ? result.pointInTime.value : null) || 
                           (result.startTime ? result.startTime.value : null) || 
                           (result.endTime ? result.endTime.value : null);
          let extractYear = rawDateStr ? parseInt(rawDateStr.match(/([+-]?\d{4,})/)[0]) : 9999;

          let eventObj = { label: result.eventLabel.value, time: '', sortYear: extractYear };
          
          let pt = result.pointInTime ? formatWikidataDate(result.pointInTime.value, result.ptPrecision ? result.ptPrecision.value : 9) : null;
          let st = result.startTime ? formatWikidataDate(result.startTime.value, result.stPrecision ? result.stPrecision.value : 9) : null;
          let et = result.endTime ? formatWikidataDate(result.endTime.value, result.etPrecision ? result.etPrecision.value : 9) : null;

          if (pt) {
            eventObj.time = pt;
          } else if (st && et) {
            eventObj.time = `${st}–${et}`;
          } else if (st) {
            eventObj.time = `${st} (dimulai)`; 
          } else if (et) {
            eventObj.time = `${et} (diselesaikan)`; 
          }

          let isDuplicate = record.events.some(e => e.label === eventObj.label && e.time === eventObj.time);
          if (!isDuplicate) record.events.push(eventObj);
        }
      }
    },
    function() {
      populateStatusAndCapacityData(qid); 
},
    null,    // <-- signal
    15000    // <-- PERUBAHAN DI SINI: timeout 15 detik
  ).catch(error => {
    console.warn("Gagal menarik data peristiwa historis (offline).", error);
    record._gagalOffline = true;
    populateStatusAndCapacityData(qid);
  });
}

function populateStatusAndCapacityData(qid) {
  let record = Records[qid];
  let queryStr = getSparqlQuery6(qid); 

  record.dynamicProps = {};

  return queryWdqsThenProcess(
    queryStr,
    function(result) {
      Object.keys(result).forEach(key => {
        if (key !== 'siteQid' && result[key].value) {
          record.dynamicProps[key] = result[key].value;
        }
      });
    },
    function() {
      renderDynamicDataInPanel(qid); 
},
    null,    // <-- signal
    15000    // <-- PERUBAHAN DI SINI: timeout 15 detik
  ).catch(error => {
    console.warn("Gagal menarik data kapasitas/status (offline).", error);
    record._gagalOffline = true;
    renderDynamicDataInPanel(qid);
  });
}

function renderDynamicDataInPanel(qid) {
  let record = Records[qid];
  
  if (!record.panelElem) return;
  let container = record.panelElem.querySelector(`#events-container-${qid}`);
  if (!container) return; 

  let html = '';
  let wikiBaseUrl = `https://www.wikidata.org/wiki/${qid}`;

  if (record.events && record.events.length > 0) {
    const EVENT_ORDER = {
      'konstruksi': 1, 'dibuka untuk umum': 2,
      'upacara pembukaan': 3, 'renovasi': 4,
      'pembangunan kembali': 5
    };

    record.events.sort((a, b) => {
      if (a.sortYear !== b.sortYear) {
        return a.sortYear - b.sortYear;
      }
      let orderA = EVENT_ORDER[a.label.toLowerCase()] || 99;
      let orderB = EVENT_ORDER[b.label.toLowerCase()] || 99;
      return orderA - orderB;
    });

    record.events.forEach(ev => {
      let capLabel = ev.label.charAt(0).toUpperCase() + ev.label.slice(1);
      let timeText = ev.time ? ev.time : ''; 
      html += `<p>${capLabel}: ${timeText}</p>`;
    });
  }

  const labelKamus = {
    ketinggian: 'Ketinggian', luas: 'Luas', kapasitas: 'Kapasitas',
    kondisi: 'Kondisi', lamanResmi: 'Laman resmi', fasilitasList: 'Fasilitas',
    arsitek: 'Arsitek', gayaList: 'Gaya arsitektur', populasi: 'Jumlah penduduk',
    kepalaDaerah: 'Kepala daerah', jalurList: 'Jalur penghubung', jumlahKoleksi: 'Jumlah koleksi',
    spesialisasiList: 'Spesialisasi', tglTemu: 'Tanggal penemuan', tempatTemu: 'Lokasi penemuan',
    bahasaList: 'Bahasa', bentukList: 'Bentuk karya', penulisList: 'Penulis/pencipta',
    subjekList: 'Subjek utama', kolektorList: 'Koleksi dari', pemredList: 'Pimpinan redaksi',
    pendiriList: 'Pendiri', penerbit: 'Penerbit', bahanList: 'Bahan utama',
    caraList: 'Cara pembuatan', penutur: 'Jumlah penutur', tglWafat: 'Wafat',
    pekerjaanList: 'Pekerjaan', pegunungan: 'Bagian dari', korban: 'Korban jiwa',
    agamaList: 'Agama', bagianDari: 'Bagian dari', berakhirPada: 'Berhenti terbit',
    pencipta: 'Pencipta', genreList: 'Genre',
    panjang: 'Panjang', koleksiKaryaList: 'Tempat koleksi karya disimpan',
    tinggi: 'Tinggi', lebar: 'Lebar',
    aksaraList: 'Sistem penulisan'
  };

  let urlWikibooks = null;

  if (record.dynamicProps && Object.keys(record.dynamicProps).length > 0) {
    
    if (record.dynamicProps.wikibooks) {
      urlWikibooks = record.dynamicProps.wikibooks;
      delete record.dynamicProps.wikibooks;
    }

    if (record.dynamicProps.tipeList) {
      let headerTextElem = record.panelElem.querySelector(`#header-text-${qid}`);
      if (headerTextElem && record.dynamicProps.tipeList.trim() !== '') {
        let tipeRapi = record.dynamicProps.tipeList
          .split(', ')
          .map(kata => kata.charAt(0).toUpperCase() + kata.slice(1))
          .join(', ');
          
        headerTextElem.textContent = tipeRapi;
      }
      delete record.dynamicProps.tipeList;
    }

    for (let key in record.dynamicProps) {
      let rawValue = record.dynamicProps[key];
      let formattedValue = rawValue;
      let titleLabel = labelKamus[key] || key; 

      if (key === 'populasi' || key === 'penutur') {
        let [angka, tahun] = rawValue.split('|');
        let angkaRapi = parseInt(angka).toLocaleString('id-ID');
        formattedValue = tahun !== 'null' ? `${angkaRapi} jiwa (${tahun})` : `${angkaRapi} jiwa`;
      } 
      else if (key === 'kepalaDaerah') {
        let [nama, tahun, wikiUrl] = rawValue.split('|');
        let teksNama = nama;
        if (wikiUrl && wikiUrl !== 'kosong') {
          teksNama = `<span class="koordinat-link"><a href="${wikiUrl}" target="_blank" rel="noopener noreferrer">${nama}</a></span>`;
        }
        formattedValue = tahun !== 'null' ? `${teksNama} (sejak ${tahun})` : teksNama;
      }
      else if (key === 'luas') {
        let [angka, satuan, bagian] = rawValue.split('|');
        let angkaRapi = parseFloat(angka).toLocaleString('id-ID');
        let teksLuas = satuan ? `${angkaRapi} ${satuan}` : angkaRapi;
        formattedValue = bagian ? `${teksLuas} (untuk ${bagian})` : teksLuas;
      }
      else if (key === 'jumlahKoleksi') {
        let [angka, satuan] = rawValue.split('|');
        let angkaRapi = parseInt(angka).toLocaleString('id-ID');
        formattedValue = satuan ? `${angkaRapi} ${satuan}` : angkaRapi;
      }
      else if (key === 'kapasitas' || key === 'korban') {
        formattedValue = parseInt(rawValue).toLocaleString('id-ID');
      }
      else if (key === 'panjang' || key === 'tinggi' || key === 'lebar') { 
        let [angka, satuan] = rawValue.split('|');
        let angkaRapi = parseFloat(angka).toLocaleString('id-ID');
        formattedValue = satuan ? `${angkaRapi} ${satuan}` : angkaRapi;
      }
      else if (key === 'ketinggian') {
        formattedValue = parseInt(rawValue).toLocaleString('id-ID') + " mdpl";
      }
      else if (key === 'lamanResmi') {
        const displayUrl = rawValue.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '');
        formattedValue = `<span class="koordinat-link"><a href="${rawValue}" target="_blank" rel="noopener noreferrer" class="break-all">${displayUrl}</a></span>`;
      }
      else if (key === 'tglTemu' || key === 'tglWafat' || key === 'berakhirPada'){
        let [waktu, presisi] = rawValue.split('|');
        formattedValue = formatWikidataDate(waktu, presisi);
      }
      else if (key === 'bahanList' || key === 'caraList') {
        formattedValue = formattedValue.toLowerCase();
      }
      else if (key === 'bahasaList') {
        formattedValue = formattedValue.replace(/\bbahasa\s+/gi, '');
      }

      html += `<p>${titleLabel}: ${formattedValue}</p>`;
    }
  }

  let tautanTambah = `<p><a href="${wikiBaseUrl}" target="_blank" class="sunting-linktambah text-italic" title="Tambahkan data di Wikidata">Lengkapi data di Wikidata!</a></p>`;
  html += tautanTambah;

  container.insertAdjacentHTML('beforebegin', html);
  container.remove();

  if (urlWikibooks) {
    let arsipContainer = record.panelElem.querySelector(`#arsip-container-${qid}`);
    
    if (arsipContainer) {
      let wikibooksHtml = `
        <div class="mt-10">
          <h2 class="mb-7">Resep & Panduan</h2>
          <p class="wikipedia-link">
            <a href="${urlWikibooks}" target="_blank">
              <img src="img/wikibook_tiny_logo.png" alt="" />
              <span>Lihat di Wikibuku</span>
            </a>
          </p>
        </div>
      `;
      arsipContainer.insertAdjacentHTML('beforebegin', wikibooksHtml);
    }
  }
}

function populateProvinceIndex() {
  if (!ProvinceIndex['all']) ProvinceIndex['all'] = new ProvinceIndexEntry();

  Object.values(Records).forEach(record => {
    ProvinceIndex['all'].total++;
    Object.keys(record.designations).forEach(provQid => {
      if (ProvinceIndex[provQid]) {
        ProvinceIndex[provQid].total++;
      }
    });
  });
}

function populateMapAndIndex() {
  let listIndex = document.getElementById('index-list');
  let mapMarkers = [];
  
  Object.entries(Records).forEach(entry => {
    let qid = entry[0], record = entry[1];
    
    if (!record.isCompound && record.lat && record.lon) {
      let mapMarker = L.marker(
        [record.lat, record.lon],
        { icon: ikonTetesanAir }
      );
      record.mapMarker = mapMarker;
      
      mapMarker.bindPopup(record.title, { 
        closeButton: false,
        maxWidth: 200 
      });

      mapMarker.togglePopup = function() {
        if (!this.isPopupOpen()) {
          this.openPopup();
        }
      };

      mapMarker.on('mousedown touchstart', function() {
        this._bukaSaatDisentuh = this.isPopupOpen();
      });

      mapMarker.on('click', function() {
        if (this._bukaSaatDisentuh) {
          if (typeof window.setMobilePanelExpanded === 'function') {
            window.setMobilePanelExpanded(true, true);
          }
        }
      });
      mapMarker.on('dblclick', function(e) {
        L.DomEvent.stopPropagation(e);
        if (typeof window.setMobilePanelExpanded === 'function') {
          window.setMobilePanelExpanded(true, true);
        }
      });
      
      let popup = mapMarker.getPopup();
      popup._qid = qid;
      record.popup = popup;
      mapMarkers.push(mapMarker);
    }
    
    let li = document.createElement('li');
    let a = document.createElement('a');
    a.href = '#' + qid;
    a.textContent = record.indexTitle; 
    
    li.appendChild(a);
    record.indexLi = li;
  });
  
  populateProvinceIndexNodes(); 
  generateFilterSelect();
}

function populateProvinceIndexNodes() {
  Object.values(Records).forEach(record => {
    if (record.mapMarker) ProvinceIndex['all'].mapMarkers.push(record.mapMarker);
    ProvinceIndex['all'].indexLis.push(record.indexLi);
    
    Object.keys(record.designations).forEach(provQid => {
      if (record.mapMarker && ProvinceIndex[provQid]) {
        ProvinceIndex[provQid].mapMarkers.push(record.mapMarker);
      }
      if (ProvinceIndex[provQid]) {
        ProvinceIndex[provQid].indexLis.push(record.indexLi);
      }
    });
  });
  
  Object.values(ProvinceIndex).forEach(indexItem => {
    indexItem.indexLis = indexItem.indexLis
      .map(li => [li, li.textContent])
      .sort((a, b) => a[1] > b[1] ? 1 : -1)
      .map(item => item[0]);
  });
}

var currentRegionFilter = 'all';
var currentUsiaFilter = 'all';
var currentUsiaSort = 'default'; 
var activeFeatures = new Set(); 
var currentSearchQuery = '';
var userLocation = null;
var userRadiusCircle = null;

function generateFilterSelect() {
  currentRegionFilter = 'all';
  currentUsiaFilter = 'all';
  activeFeatures.clear();
  currentSearchQuery = '';

let selectKombinasi = document.getElementById('filter-sort-kombinasi');
  if (selectKombinasi) {
    // 1. GENERATE OPSI HTML DARI JS
    selectKombinasi.innerHTML = `
      <option value="default">Semua Usia</option>
      <option value="filter-muda-50">&lt; 50 Tahun</option>
      <option value="filter-tua-50">&gt; 50 Tahun</option>
      <option value="filter-muda-100">&lt; 100 Tahun</option>
      <option value="filter-tua-100">&gt; 100 Tahun</option>
      <option value="filter-tua-200">&gt; 200 Tahun</option>
      <option value="filter-tua-300">&gt; 300 Tahun</option>
      <option value="filter-tua-400">&gt; 400 Tahun</option>
      <option value="filter-tua-500">&gt; 500 Tahun</option>
      <option value="sort-termuda">Terbaru dulu</option>
      <option value="sort-tertua">Tertua dulu</option>
    `;
    selectKombinasi.value = 'default';
    
    if (currentKategoriUtama === 'alam') {
      selectKombinasi.classList.add('d-none');
    } else {
      selectKombinasi.classList.remove('d-none'); 
    }

// 2. LOGIKA KETIKA DROPDOWN BERUBAH
    selectKombinasi.addEventListener('change', function() {
      let pilihan = this.value;
      currentUsiaFilter = 'all'; 
      currentUsiaSort = 'default'; 

      if (pilihan.startsWith('sort-')) {
        // Jika pengguna memilih "Urutkan" (termuda/tertua)
        currentUsiaSort = pilihan.replace('sort-', ''); 
      } 
else if (pilihan.startsWith('filter-')) {
        currentUsiaFilter = pilihan.replace('filter-', ''); 
        
        // Cek apakah pengguna memilih filter "<" (muda) atau ">" (tua)
        if (pilihan.includes('muda')) {
          currentUsiaSort = 'termuda'; // Jika < 50 atau < 100, urutkan dari yang paling muda dulu
        } else {
          currentUsiaSort = 'tertua';  // Jika > 50, > 100 dst, urutkan dari yang paling kuno/tua dulu
        }
      }
      
      applyIntersectionFilter();
    });
  }
    
  let searchInput = document.getElementById('search-input');
  if (searchInput) searchInput.value = '';

  let btnAll = document.getElementById('btn-all');
  if (btnAll) btnAll.classList.add('active');
  document.querySelectorAll('.feat-btn:not(#btn-all)').forEach(b => b.classList.remove('active'));

  let selectRegion = document.getElementById('filter-region');

  selectRegion.innerHTML = `<option value="all">Semua Wilayah – ${ProvinceIndex['all'].total}</option>`;
  selectRegion.innerHTML += `<option value="terdekat">Sekitar Anda (10 km)</option>`;
  
  Object.keys(ProvinceIndex)
    .filter(qid => qid !== 'all')
    .map(qid => { return { qid: qid, name: ProvinceIndex[qid].name, total: ProvinceIndex[qid].total }; })
    .sort((a, b) => {
      if (a.name === 'Wilayah Lainnya/Tidak Spesifik') return 1;
      if (b.name === 'Wilayah Lainnya/Tidak Spesifik') return -1;
      return a.name.localeCompare(b.name);
    })
    .forEach(prov => {
      let option = document.createElement('option');
      option.value = prov.qid;
      option.textContent = `${prov.name} – ${prov.total}`;
      selectRegion.appendChild(option);
    });

  applyIntersectionFilter();
  
  if (!isFilterEventAttached) {
    selectRegion.addEventListener('change', function() {
      if (window.TombolGPSMap) window.TombolGPSMap.stop();
      Map.off('locationfound');
      Map.off('locationerror');
      
      if (userRadiusCircle) {
        Map.removeLayer(userRadiusCircle);
        userRadiusCircle = null;
      }
      
      let opsiTerdekat = Array.from(this.options).find(opt => opt.value === 'terdekat');
      if (opsiTerdekat) opsiTerdekat.text = "Sekitar Anda (Radius 10 km)";

      if (this.value === 'terdekat') {
        jalankanFilterGPS(this);
      } else {
        currentRegionFilter = this.value;
        userLocation = null; 
        applyIntersectionFilter();
      }
    });

    if (selectKombinasi) {
   selectKombinasi.addEventListener('change', function() {
  let pilihan = this.value;
  currentUsiaFilter = 'all'; 

  if (pilihan === 'filter-usia-muda-50') {
    currentUsiaFilter = 'muda_50';         
  } else if (pilihan === 'filter-usia-50') {
    currentUsiaFilter = 'usia_50'; 
  } else if (pilihan === 'filter-usia-100') {
    currentUsiaFilter = 'usia_100'; 
  } else if (pilihan === 'filter-usia-200') {
    currentUsiaFilter = 'usia_200'; 
  } else if (pilihan === 'filter-usia-300') {
    currentUsiaFilter = 'usia_300'; 
  }
  applyIntersectionFilter();
});
    }

    if (btnAll) {
      btnAll.addEventListener('click', function() {
        userLocation = null;
        if (window.TombolGPSMap) window.TombolGPSMap.stop();
        
        if (userRadiusCircle) Map.removeLayer(userRadiusCircle);
        
        activeFeatures.clear();
        btnAll.classList.add('active');
        document.querySelectorAll('.feat-btn:not(#btn-all)').forEach(b => b.classList.remove('active'));

        currentRegionFilter = 'all';
        if (selectRegion) selectRegion.value = 'all';

        currentUsiaFilter = 'all';
        currentUsiaSort = 'default'; // INI YANG TERLEWAT
        if (selectKombinasi) selectKombinasi.value = 'default';

        currentSearchQuery = '';
        if (searchInput) searchInput.value = '';

        applyIntersectionFilter();
      });
    }

    document.querySelectorAll('.feat-btn:not(#btn-all)').forEach(btn => {
      btn.addEventListener('click', function() {
        let filterType = this.getAttribute('data-filter');

        if (activeFeatures.has(filterType)) {
          activeFeatures.delete(filterType);
          this.classList.remove('active');
        } else {
          activeFeatures.add(filterType);
          this.classList.add('active');
        }

        if (activeFeatures.size === 0) {
          if (btnAll) btnAll.classList.add('active');
        } else {
          if (btnAll) btnAll.classList.remove('active');
        }

        applyIntersectionFilter();
      });
    });

    if (searchInput) {
      searchInput.addEventListener('input', function() {
        currentSearchQuery = this.value.toLowerCase();
        
        if (searchDebounceToken) {
          clearTimeout(searchDebounceToken);
        }
        
        searchDebounceToken = setTimeout(() => {
          applyIntersectionFilter(); 
        }, 300);
      });
    }

    isFilterEventAttached = true; 
  }
}

function updateFeatureCounts(totalValidRecords) {
  let searchInput = document.getElementById('search-input');
  if (searchInput) {
    searchInput.placeholder = `Menampilkan ${totalValidRecords} hasil (atau ketik yang ingin dicari)`;
  }
}

function applyIntersectionFilter(preventZoom = false) {
  if (!PrimaryDataIsLoaded) return;
// --- TAMBAHAN UNTUK GAME ---
  if (typeof isGameMode !== 'undefined' && isGameMode === true) {
      return; // Cegah filter dan render normal berjalan saat game aktif!
  }
  // --------------------------
if (Map) Map.stop();
  if (typeof flightDebounceToken !== 'undefined' && flightDebounceToken) {
    clearTimeout(flightDebounceToken);
  }
  Cluster.clearLayers();
  let ol = document.getElementById('index-list');
  ol.innerHTML = '';
// --- TAMBAHAN KODE MODE GALERI ---
  if (activeFeatures.has('image')) {
    ol.classList.add('mode-galeri');
  } else {
    ol.classList.remove('mode-galeri');
  }
  let validMarkers = [];
  
  let btnAll = document.getElementById('btn-all');
  if (btnAll) {
    if (currentSearchQuery.trim() === '' && 
        currentRegionFilter === 'all' && 
        currentUsiaFilter === 'all' && 
        activeFeatures.size === 0) {
      btnAll.classList.add('active');
      btnAll.textContent = 'Semua Hasil'; 
    } else {
      btnAll.classList.remove('active');
      btnAll.textContent = 'Pulihkan'; 
    }
  }

  let validRecords = Object.values(Records).filter(record => {
    
    let matchRegion = false;
    
    if (currentRegionFilter === 'all') {
      matchRegion = true;
    } 
    else if (currentRegionFilter === 'terdekat') {
      if (userLocation && record.lat && record.lon) {
        let jarakMeter = Map.distance([userLocation.lat, userLocation.lon], [record.lat, record.lon]);
        if (jarakMeter <= 10000) { 
          record.jarakDariUser = (jarakMeter / 1000).toFixed(1); 
          matchRegion = true;
        }
      }
    } 
    else {
      matchRegion = record.areaTags.has(currentRegionFilter);
    }

    let matchFeature = true;
    
    if (activeFeatures.size > 0) {
      if (activeFeatures.has('image') && !record.imageFilename) matchFeature = false;
      if (activeFeatures.has('article') && record.articleTitle === undefined) matchFeature = false;
    }

    let matchSearch = true;
    if (currentSearchQuery.trim() !== '') {
      let cleanQuery = currentSearchQuery.replace(/[-'\s]/g, '');
      if (record.indexTitle) {
        let cleanTitle = record.indexTitle.toLowerCase().replace(/[-'\s]/g, '');
        matchSearch = cleanTitle.includes(cleanQuery);
      } else {
        matchSearch = false;
      }
    }

let matchUsia = true;
  if (currentUsiaFilter !== 'all') {                 
    if (record.rawTahunBerdiri) {
      let tahunBangunan = parseInt(record.rawTahunBerdiri.substring(0, 4));
      
      let parts = currentUsiaFilter.split('-');
      let tipeFilter = parts[0]; 
      let batasUmur = parseInt(parts[1]);
      let batasTahun = new Date().getFullYear() - batasUmur;

      if (tipeFilter === 'muda') {
        matchUsia = tahunBangunan > batasTahun;      
      } else if (tipeFilter === 'tua') {
        matchUsia = tahunBangunan <= batasTahun;     
      }
    } else {
      matchUsia = false; 
    }
  }
    
    return matchRegion && matchFeature && matchSearch && matchUsia;

}).sort((a, b) => {
    // JIKA ADA FILTER USIA AKTIF ATAU URUTKAN AKTIF
    if (currentUsiaFilter !== 'all' || currentUsiaSort !== 'default') {
      let aHasYear = !!a.rawTahunBerdiri;
      let bHasYear = !!b.rawTahunBerdiri;

      if (aHasYear && bHasYear) {
        if (currentUsiaSort === 'termuda') {
          // Termuda dulu: Tahun besar (2020) di atas Tahun kecil (1900)
          return b.rawTahunBerdiri.localeCompare(a.rawTahunBerdiri); 
        } else {
          // Tertua dulu (default jika filter aktif): Tahun kecil (1900) di atas Tahun besar (2020)
          return a.rawTahunBerdiri.localeCompare(b.rawTahunBerdiri);
        }
      } else if (aHasYear && !bHasYear) {
        return -1; 
      } else if (!aHasYear && bHasYear) {
        return 1;  
      }
    }
    
    return a.indexTitle.localeCompare(b.indexTitle);    
  });

  currentFilteredRecords = validRecords;
  currentRenderIndex = 0; 

  renderNextChunk();
  updateFeatureCounts(validRecords.length);
validRecords.forEach(record => {
    if (record.mapMarker) validMarkers.push(record.mapMarker);
  });

  if (validMarkers.length > 0) {
    Cluster.addLayers(validMarkers);
    if (!preventZoom) {
      Map.flyToBounds(Cluster.getBounds(), { duration: 0.5 });
    }
  }
}

function generateRecordDetails(qid) {
  let record = Records[qid];
  let titleHtml = `<h1>${record.title}</h1>`;
  let figureHtml = generateFigure(record.imageFilename, record.title);

  if (record.imageFilename) {
    figureHtml = figureHtml.replace('<figure class="', '<figure class="gambar-utama ');
  }

  let articleHtml;
  if (record.articleTitle) {
    articleHtml = '<div class="article main-text loading"><div class="loader"></div></div>';
  } else {
    let namaAmanURL = encodeURIComponent(record.title);
    let gFormUrl = `https://docs.google.com/forms/d/e/1FAIpQLSeHMSn6cwcgbZ0xx1CJ5tGXDQacYgzRZUG51STByKUROWXgmg/viewform?usp=pp_url&entry.2138396049=${namaAmanURL}`;
    articleHtml = `<div class="article main-text nodata"><p>${currentNamaKlaster} ini belum memiliki artikel. <a href="${gFormUrl}" target="_blank" rel="noopener noreferrer" class="sunting-linktambah no-border">Tambahkan!</a></p></div>`;
  }
  
  let wikiUrlUtama = `https://www.wikidata.org/wiki/${qid}`;
  let tautanSuntingRingkasan = `<a href="${wikiUrlUtama}" target="_blank" class="sunting-link" title="Sunting data di Wikidata" aria-label="Sunting data di Wikidata"></a>`;

  let designationsHtml = `<h2 class="header-flex">
                            <div><span id="header-text-${qid}" class="mr-7">Informasi</span>${tautanSuntingRingkasan}</div>
                          </h2>`;

  designationsHtml += '<ul class="designations">';

  let arrayProvinsi = Object.values(record.designations);
  let isTidakSpesifik = arrayProvinsi.includes('Wilayah Lainnya/Tidak Spesifik') || arrayProvinsi.length === 0;
  let spesifik = record.lokasiSpesifik; 
  if (spesifik === 'Wilayah Lainnya/Tidak Spesifik') spesifik = null;
  let namaLokasi = '';

  if (isTidakSpesifik) {
    if (spesifik) {
      namaLokasi = spesifik;
    } else {
      namaLokasi = 'Belum ada data';
    }
  } else {
    let arrayProvinsiBersih = arrayProvinsi.filter(p => p !== 'Wilayah Lainnya/Tidak Spesifik');
    let teksDaftarProvinsi = arrayProvinsiBersih.join(', '); 
    
    if (spesifik && !arrayProvinsiBersih.map(p => p.toLowerCase()).includes(spesifik.toLowerCase())) {
      namaLokasi = `${spesifik}, ${teksDaftarProvinsi}`; 
    } else {
      namaLokasi = teksDaftarProvinsi;
    }
  }

  let prefixLokasi = 'Letak'; 
  let showTahun = true; 
  let prefixTahun = 'Didirikan';

  if (['Kabupaten dan kota'].includes(currentNamaKlaster)) {
    prefixLokasi = 'Provinsi';
    prefixTahun = 'Hari jadi';
  } else if (['Tempat lahir tokoh'].includes(currentNamaKlaster)) {
    prefixLokasi = 'Tempat lahir';
    prefixTahun = 'Lahir';
  } else if (['Latar karya sastra'].includes(currentNamaKlaster)) {
    prefixLokasi = 'Latar';
    prefixTahun = 'Terbit perdana';
  } else if (['Publikasi', 'Media massa'].includes(currentNamaKlaster)) {
    prefixLokasi = 'Tempat terbit';
    prefixTahun = 'Terbit perdana';
  } else if (['Lukisan'].includes(currentNamaKlaster)) {
    prefixLokasi = 'Koleksi';
    prefixTahun = 'Dilukis';
  } else if (['Lontar', 'Naskah'].includes(currentNamaKlaster)) {
    prefixLokasi = 'Koleksi';
    prefixTahun = 'Ditulis';
  } else if (['Gempa bumi dan tsunami', 'Peristiwa lainnya', 'Perang & konflik', 'Bencana lainnya'].includes(currentNamaKlaster)) {
    prefixLokasi = 'Pusat kejadian/terdampak';
    prefixTahun = 'Pada';
  } else if (['Situs arkeologi lainnya'].includes(currentNamaKlaster)) {
    prefixLokasi = 'Letak';
    prefixTahun = 'Era/periode';
  } else if (['Prasasti', 'Artefak'].includes(currentNamaKlaster)) {
    prefixLokasi = 'Lokasi sekarang';
    prefixTahun = 'Tarikh';
  }
  
  if (currentKategoriUtama === 'alam') {
    showTahun = false;
    if (['Bahasa'].includes(currentNamaKlaster)) {
      prefixLokasi = 'Wilayah penutur utama';
    } else if (['Hidangan', 'Pakaian', 'Tari dan pertunjukan', 'Ritual dan upacara', 'Budaya rakyat'].includes(currentNamaKlaster)) {
      prefixLokasi = `${currentNamaKlaster} khas`;
    } else {
      prefixLokasi = 'Letak';
    }
  }

let infoLokasiHtml = '';
  if (record.lat && record.lon) {
    let mapsUrl = `https://www.google.com/maps?q=${record.lat},${record.lon}`;
    // Tambahkan class 'link-peta-dialog' dan simpan data URL serta nama lokasi
    infoLokasiHtml = `<p class="koordinat-link">${prefixLokasi}: <a href="#" class="link-peta-dialog" data-url="${mapsUrl}" data-lokasi="${namaLokasi}" title="Buka di Google Maps">${namaLokasi}</a></p>`;
  } else {
    infoLokasiHtml = 
      `<p class="koordinat-link">${prefixLokasi}: ${namaLokasi}</p>` +
      `<p>Koordinat: <span class="text-muted-italic">Data belum tersedia</span></p>`;
  }

  let infoTahunHtml = '';
  if (showTahun) {
    if (record.tahunBerdiri) {
      infoTahunHtml = `<p>${prefixTahun}: ${record.tahunBerdiri}</p>`;
    } else {
      infoTahunHtml = `<p>${prefixTahun}: <span class="text-muted-italic">Data belum tersedia</span></p>`;
    }
  }

  let eventsHtmlPlaceholder = `
   <div id="events-container-${qid}" class="loading">
     <div class="loader loader-small mt-8"></div>
   </div>`;

  designationsHtml += '<li>' + infoLokasiHtml + infoTahunHtml + eventsHtmlPlaceholder + '</li></ul>';
  let arsipHtml = `<div id="arsip-container-${qid}" class="loading"><div class="loader loader-small mt-8"></div></div>`;

  let panelElem = document.createElement('div');
  
  if (currentNamaKlaster === 'Tempat lahir tokoh') {
    panelElem.classList.add('mode-tokoh');
  }
  
  panelElem.innerHTML = titleHtml + figureHtml + articleHtml + designationsHtml + arsipHtml;
  record.panelElem = panelElem;

  if (record.articleTitle) displayArticleExtract(record.articleTitle, panelElem.querySelector('.article'));

  // --- MULAI PENAMBAHAN KODE DIALOG PETA TAMBHAAN GOOGLE FLASH LITE SI OON ---
  let linkPeta = panelElem.querySelector('.link-peta-dialog');
  if (linkPeta) {
    linkPeta.addEventListener('click', function(e) {
      e.preventDefault(); // Mencegah halaman melompat ke atas karena href="#"
      
      let urlTujuan = this.getAttribute('data-url');
      let namaTujuan = this.getAttribute('data-lokasi');
      
      // Memanggil fungsi dialog kustom dari JS 1
      tampilkanDialog(`Petunjuk arah menuju lokasi objek`, 'confirm', 'Buka Google Maps?')
        .then(yakin => {
          if (yakin) {
            // Jika pengguna klik [Ya], buka tab baru
            window.open(urlTujuan, '_blank', 'noopener,noreferrer');
          }
          // Jika batal, tidak terjadi apa-apa
        });
    });
  }
  
  queryOsm(qid);
}

function populateHistoricalImagesData(qid) {
  let record = Records[qid];
  let queryStr = getSparqlQuery5(qid); 

  record.vicinityImages = [];
  record.pastImage = undefined;
  record.interiorImage = undefined; 
  record.commonsCat = undefined; 

  return queryWdqsThenProcess(
    queryStr,
    function(result) {
      if ('vicinityImage' in result) {
        let filename = extractImageFilename(result.vicinityImage);
        let captionText = result.vicinityCaption ? result.vicinityCaption.value : '';
        
        let isDuplicate = record.vicinityImages.some(img => img.file === filename);
        if (!isDuplicate) {
          record.vicinityImages.push({ file: filename, caption: captionText });
        }
      }
      
      if ('pastImage' in result) {
        if (!record.pastImage) { 
          let filename = extractImageFilename(result.pastImage);
          let captionText = result.pastCaption ? result.pastCaption.value : '';
          record.pastImage = { file: filename, caption: captionText };
        }
      }

      if ('interiorImage' in result) {
        if (!record.interiorImage) { 
          let filename = extractImageFilename(result.interiorImage);
          let captionText = result.interiorCaption ? result.interiorCaption.value : '';
          record.interiorImage = { file: filename, caption: captionText };
        }
      }
      
      if ('commonsCat' in result) {
        record.commonsCat = result.commonsCat.value;
      }
    },
    function() {
      renderHistoricalImagesInPanel(qid);
},
    null,    // <-- signal
    15000    // <-- PERUBAHAN DI SINI: timeout 15 detik
    ).catch(error => {
    console.warn("Gagal menarik foto arsip (offline).", error);
    let record = Records[qid];
    record._gagalOffline = true; 
    
    if (record.panelElem) {
      let arsipContainer = record.panelElem.querySelector(`#arsip-container-${qid}`);
      if (arsipContainer) arsipContainer.remove(); 
    }
  });
}

function renderHistoricalImagesInPanel(qid) {
  let record = Records[qid];
  
  if (!record.panelElem) return;
  let container = record.panelElem.querySelector(`#arsip-container-${qid}`);
  if (!container) return; 

  let html = '';
  
  function buildImageBlock(imgObj, teksPengganti) {
    let block = '<div class="arsip-block">';
    block += generateFigure(imgObj.file);
    if (imgObj.caption && imgObj.caption.trim() !== '') {
      block += `<div class="article main-text"><p>${imgObj.caption}</p></div>`;
    } else {
      block += `<div class="article main-text nodata"><p>${teksPengganti}</p></div>`;
    }
    block += '</div>';
    return block;
  }

  if (record.pastImage) {
    html += buildImageBlock(record.pastImage, 'Suasana/bentuk/tampilan sebelumnya');
  }

  if (record.interiorImage) {
    html += buildImageBlock(record.interiorImage, 'Pemandangan di dalam');
  }
  
  if (record.vicinityImages && record.vicinityImages.length > 0) {
    record.vicinityImages.forEach(imgObj => {
      html += buildImageBlock(imgObj, 'Objek di sekitar');
    });
  }

  if (record.commonsCat) {
    html += '<h2 class="mt-10 mb-7">Galeri lainnya</h2>';
    html += 
      '<p class="wikipedia-link mb-0">' +
        `<a href="https://commons.wikimedia.org/wiki/Category:${encodeURIComponent(record.commonsCat)}" target="_blank">` +
          '<img src="img/wikicommons_tiny_logo.png" alt="" />' +
          '<span>Lihat di Wikimedia Commons</span>' +
        '</a>' +
      '</p>';
  }

  if (html !== '') {
    let wikiUrlGaleri = `https://www.wikidata.org/wiki/${qid}#P18`;
    let tautanSuntingGaleri = `<a href="${wikiUrlGaleri}" target="_blank" class="sunting-link" title="Sunting data galeri di Wikidata" aria-label="Sunting data galeri di Wikidata"></a>`;
    
    let judulGaleriUtama = '';
    if (record.pastImage || record.interiorImage || (record.vicinityImages && record.vicinityImages.length > 0)) {
      judulGaleriUtama = `<h2 class="mt-10 mb-10">Galeri ${tautanSuntingGaleri}</h2>`;
    }
    
    container.innerHTML = judulGaleriUtama + html;
    container.classList.remove('loading');
  } else {
    container.innerHTML = '';
    container.classList.remove('loading');
    container.classList.add('d-none');
  }
}

function displayArticleExtract(title, elem) {
  let url = new URL('https://id.wikipedia.org/w/api.php');
  let params = {
    action: 'query', format: 'json', prop: 'extracts',
    exintro: 1, redirects: true, titles: title, origin: '*' 
  };
  Object.keys(params).forEach(key => url.searchParams.append(key, params[key]));

  fetch(url, { signal: globalFetchController.signal })
    .then(response => {
      if (!response.ok) throw new Error('Koneksi ke server Wikipedia gagal');
      return response.json();
    })
    .then(data => {
      if (!data.query || !data.query.pages) {
        throw new Error('Struktur data Wikipedia tidak ditemukan');
      }

      let rawExtract = Object.values(data.query.pages)[0].extract || '';
      
      let kumpulanParagraf = rawExtract.match(/<p[^>]*>[\s\S]+?<\/p>/g);
      let paragrafPilihan = kumpulanParagraf ? kumpulanParagraf.find(text => text.length > 50) : null;

      if (paragrafPilihan) {
        paragrafPilihan = paragrafPilihan.replace(/^<p[^>]*>(\s|<br\s*\/?>| )*/i, '<p>');
        paragrafPilihan = paragrafPilihan.replace(/<span[^>]*>[^<]*code:\s*[a-z\-]+\s*is deprecated[^<]*<\/span>/gi, '');
        paragrafPilihan = paragrafPilihan.replace(/<[^>]*>[^<]*(is deprecated|Lua error|Script error)[^<]*<\/[^>]*>/gi, '');
        paragrafPilihan = paragrafPilihan.replace(/code:\s*[a-z\-]+\s*is deprecated/gi, '');
      } else {
        paragrafPilihan = '<p>Ringkasan artikel belum memadai.</p>'; 
      }

      if (elem) {
        elem.innerHTML =
          paragrafPilihan +
          '<p class="wikipedia-link">' +
            `<a href="https://id.wikipedia.org/wiki/${encodeURIComponent(title)}" target="_blank">` +
              '<img src="img/wikipedia_tiny_logo.png" alt="" />' +
              '<span>Baca selengkapnya di Wikipedia</span>' +
            '</a>' +
          '</p>';
          
        elem.classList.remove('loading');
      }
    })
    .catch(error => {
      if (error.name === 'AbortError') {
        console.log('Penarikan Wikipedia dibatalkan (reset).');
        return;
      }
      console.error('Gagal memuat artikel Wikipedia:', error);
      if (elem) {
        elem.innerHTML = '<p class="nodata text-error mt-10">Gagal memuat ringkasan artikel. Periksa koneksi internet Anda.</p>';
        elem.classList.remove('loading');
      }
    });
}

function renderNextChunk() {
  let ol = document.getElementById('index-list');
  if (!ol) return;

  let nextBatch = currentFilteredRecords.slice(currentRenderIndex, currentRenderIndex + CHUNK_SIZE);  
  if (nextBatch.length === 0) return;
  
  let isGalleryMode = activeFeatures.has('image'); 

  if (isGalleryMode) {
    // 1. Buat dua kolom nyata jika belum ada di dalam index-list
    let colKiri = ol.querySelector('#kolom-kiri');
    let colKanan = ol.querySelector('#kolom-kanan');
    
    if (!colKiri || !colKanan) {
      ol.innerHTML = ''; // Pastikan bersih
      colKiri = document.createElement('div');
      colKiri.id = 'kolom-kiri';
      colKiri.className = 'kolom-masonry';
      
      colKanan = document.createElement('div');
      colKanan.id = 'kolom-kanan';
      colKanan.className = 'kolom-masonry';
      
      ol.appendChild(colKiri);
      ol.appendChild(colKanan);
    }

    // 2. Distribusikan ganjil-genap
    nextBatch.forEach((record, index) => {
      if (!record.galleryLi) {
        let li = document.createElement('li');
        li.className = 'gallery-item';
        let imgUrl = `${COMMONS_WIKI_URL_PREF}Special:FilePath/${encodeURIComponent(record.imageFilename)}?width=300`;
        
        li.innerHTML = `
          <a href="#${record.id}" class="gallery-link">
            <img src="${imgUrl}" loading="lazy" alt="${record.title}">
            <div class="gallery-caption">${record.indexTitle}</div>
          </a>
        `;
        record.galleryLi = li;
      }
      
      record.galleryLi.classList.remove('d-none');
      
      // Masukkan ke kiri atau kanan berdasarkan urutan
      // (index keseluruhan agar stabil saat scroll batch berikutnya)
      let globalIndex = currentRenderIndex + index;
      if (globalIndex % 2 === 0) {
        colKiri.appendChild(record.galleryLi);
      } else {
        colKanan.appendChild(record.galleryLi);
      }
    });

  } else {
    // --- MODE LIST NORMAL ---
    let fragment = document.createDocumentFragment();
    nextBatch.forEach(record => {
      if (record.indexLi) {
        record.indexLi.classList.remove('d-none'); 
        fragment.appendChild(record.indexLi);
      }
    });
    ol.appendChild(fragment);
  }

  currentRenderIndex += CHUNK_SIZE; 
}

let scrollContainer = document.getElementById('index-container'); 

if (scrollContainer) {
  scrollContainer.addEventListener('scroll', function() {
    if (this.scrollTop + this.clientHeight >= this.scrollHeight - 10) {
      renderNextChunk(); 
    }
  });
}

function queryOsm(qid) {
  let signal = typeof globalFetchController !== 'undefined' ? globalFetchController.signal : null;
  let queryStr = `[out:json][timeout:25];\n(\n  way["wikidata"="${qid}"];\n  relation["wikidata"="${qid}"];\n);\nout body;\n>;\nout skel qt;`;
  let url = 'https://overpass-api.de/api/interpreter?data=' + encodeURIComponent(queryStr);

  fetch(url, { signal: signal })
    .then(response => {
      if (!response.ok) throw new Error('Koneksi ke Overpass API gagal');
      return response.json();
    })
    .then(data => {
      if (typeof osmtogeojson !== 'function') return; 
      
      let geoJson = osmtogeojson(data);
      if (!geoJson || geoJson.features.length === 0) return;
      
      // CATATAN: style Leaflet di bawah ini BUKAN inline CSS HTML, 
      // melainkan "objek konfigurasi data Leaflet" untuk API render canvas mereka.
      // Jadi tidak dipindah ke kelas CSS.
      let shapeLayer = L.geoJSON(geoJson, {
        style: { color: '#ff3333', opacity: 0.7, fill: true },
        filter: feature => feature.geometry.type !== 'Point',
      });
      
      Records[qid].shapeLayer = shapeLayer;

      if (window.location.hash.replace('#', '') === qid) {
        if (currentActiveShapeLayer) Map.removeLayer(currentActiveShapeLayer);
        shapeLayer.addTo(Map);
        currentActiveShapeLayer = shapeLayer;
      }
    })
    .catch(error => {
      if (error.name === 'AbortError') {
        console.log('Penarikan poligon peta (OSM) dibatalkan.');
      } else {
        console.warn('ERROR loading from Overpass API:', error);
      }
    });
}

class ProvinceIndexEntry {
  constructor() {
    this.name       = '';
    this.total      = 0;
    this.mapMarkers = [];
    this.indexLis   = [];
  }
}

class Record {
  constructor(isCompound) {
    this.isCompound = isCompound;
    this.title = undefined;
    this.imageFilename = '';
    this.articleTitle = undefined;
    this.designations = {}; 
    this.panelElem = undefined;
    this.indexLi = undefined;
    this.galleryLi = undefined;
    this.tahunBerdiri = undefined;
    this.rawTahunBerdiri = undefined;
    this.events = [];
    this.areaTags = new Set();
    this.vicinityImages = [];
    this.interiorImage = undefined;
  }
}

class SimpleRecord extends Record {
  constructor() {
    super(false);
    this.lat        = undefined;
    this.lon        = undefined;
    this.mapMarker  = undefined;
    this.popup      = undefined;
    this.shapeLayer = undefined;
  }
}

class CompoundRecord extends Record {
  constructor() {
    super(true);
    this.parts = []; 
  }
}
