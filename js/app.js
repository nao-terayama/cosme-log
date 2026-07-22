/* Cosme log — 画面の動き */
'use strict';

// ---------- 定数 ----------

const CATEGORIES = ['スキンケア', 'メイク', 'オーラルケア', 'ボディケア', 'ヘアケア', 'ネイル', 'その他'];

// カテゴリごとのアイテム種別(初期セット)
const ITEM_TYPES = {
  'スキンケア': ['化粧水', '乳液', '美容液', 'クリーム', '洗顔', 'クレンジング', '日焼け止め', 'パック'],
  'メイク': ['日中用乳液', '下地', 'ファンデーション', 'フェイスパウダー', 'アイシャドウ', 'アイライナー', 'アイブロウ', 'マスカラ', 'リップ', 'チーク'],
  'オーラルケア': ['歯磨き粉', '歯ブラシ', 'マウスウォッシュ', 'フロス・歯間ブラシ'],
  'ボディケア': ['ボディソープ', 'ボディクリーム', 'ハンドクリーム', 'デオドラント', '入浴剤'],
  'ヘアケア': ['シャンプー', 'コンディショナー', 'トリートメント', 'ヘアウォーター', 'ヘアミルク', 'ヘアオイル', 'スタイリング剤'],
  'ネイル': ['ネイルカラー', 'ベースコート', 'トップコート', 'ネイルケア'],
  'その他': [],
};

const STATUS_LABELS = { stock: 'ストック', inUse: '使用中', finished: '使い切った' };
const REPEAT_LABELS = { yes: 'リピートしたい', maybe: '検討中', no: 'しない' };

// アイテム種別のカスタマイズ(設定画面で編集。カテゴリごとに初期セットを上書き)
let itemTypesOverride = {};

function getItemTypes(category) {
  if (itemTypesOverride[category]) return itemTypesOverride[category];
  return ITEM_TYPES[category] || [];
}

// ---------- 状態 ----------

const state = {
  products: [],
  filterCategory: '',
  filterItemType: '',
  filterStatus: '',
  filterRating: '',
  filterRepeat: '',
  keyword: '',
  sortKey: 'createdAt',
  sortDir: 'desc',
  editingId: null,   // 編集中の商品id(新規はnull)
  detailId: null,    // 詳細表示中の商品id
  formIngredients: [],
  formImageBlob: null,     // フォームで選んだ画像
  formImageChanged: false, // 画像を変更・削除したか
  formStatus: 'stock',
  formRating: 0,
  formRepeat: '',
  formBack: 'home',        // フォームの「戻る」の行き先: home / add / search / detail
  rakutenAppId: '',        // 楽天アプリケーションID(設定画面で登録)
  rakutenAccessKey: '',    // 楽天アクセスキー(pk_〜。2026年の新APIで必須になった)
  rakutenAffiliateId: '',  // 楽天アフィリエイトID(任意)
  searchOriginJan: '',     // バーコード読み取りから来た場合のJANコード
};

// 画像表示用URLの後片付けリスト(メモリ節約)
let objectUrls = [];
function revokeObjectUrls() {
  objectUrls.forEach((u) => URL.revokeObjectURL(u));
  objectUrls = [];
}
function blobUrl(blob) {
  const u = URL.createObjectURL(blob);
  objectUrls.push(u);
  return u;
}

// ---------- 小道具 ----------

const $ = (sel) => document.querySelector(sel);

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// '2026-07-15' → '2026/07/15'
function fmtDate(s) {
  return s ? s.replaceAll('-', '/') : '';
}

// 開封日にPAO(か月)を足した使用期限を求める(月末の日付ズレも考慮)
function calcExpiry(openedDate, pao) {
  if (!openedDate || !pao) return null;
  const [y, m, d] = openedDate.split('-').map(Number);
  const base = new Date(y, m - 1 + Number(pao), 1);
  const lastDay = new Date(base.getFullYear(), base.getMonth() + 1, 0).getDate();
  base.setDate(Math.min(d, lastDay));
  return base;
}

function daysUntil(date) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((date - today) / 86400000);
}

// 成分の文字列を「、」「，」「,」「・」「改行」で分割して配列にする
function splitIngredients(text) {
  return text
    .split(/[、，,・\n\r]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

// ---------- 画面切り替え ----------

const VIEW_NAMES = ['home', 'add', 'scan', 'search', 'form', 'detail', 'settings', 'stats'];

function showView(name, title) {
  VIEW_NAMES.forEach((v) => {
    $(`#view-${v}`).classList.toggle('hidden', v !== name);
  });
  $('#hdrTitle').textContent = title || 'Cosme log';
  $('#btnBack').classList.toggle('hidden', name === 'home');
  $('#btnSettings').classList.toggle('hidden', name !== 'home');
  $('#btnStats').classList.toggle('hidden', name !== 'home');
  window.scrollTo(0, 0);
}

function currentView() {
  return VIEW_NAMES.find((v) => !$(`#view-${v}`).classList.contains('hidden')) || 'home';
}

function goHome() {
  state.detailId = null;
  state.editingId = null;
  renderList();
  showView('home');
}

// ---------- 一覧 ----------

function buildFilterOptions() {
  const catSel = $('#filterCategory');
  catSel.innerHTML = '';
  catSel.appendChild(new Option('カテゴリ: すべて', ''));
  CATEGORIES.forEach((c) => catSel.appendChild(new Option(c, c)));

  const stSel = $('#filterStatus');
  stSel.innerHTML = '';
  stSel.appendChild(new Option('状態: すべて', ''));
  Object.entries(STATUS_LABELS).forEach(([v, label]) => stSel.appendChild(new Option(label, v)));

  const rtSel = $('#filterRating');
  rtSel.innerHTML = '';
  rtSel.appendChild(new Option('評価: すべて', ''));
  rtSel.appendChild(new Option('★5', '5'));
  rtSel.appendChild(new Option('★4以上', '4'));
  rtSel.appendChild(new Option('★3以上', '3'));
  rtSel.appendChild(new Option('評価なし', 'none'));

  const rpSel = $('#filterRepeat');
  rpSel.innerHTML = '';
  rpSel.appendChild(new Option('リピート: すべて', ''));
  Object.entries(REPEAT_LABELS).forEach(([v, label]) => rpSel.appendChild(new Option(label, v)));
  rpSel.appendChild(new Option('未設定', 'none'));

  buildFilterItemTypeOptions();
}

// カテゴリの絞り込みに合わせて、アイテム種別の絞り込みの選択肢を作り直す
function buildFilterItemTypeOptions() {
  const sel = $('#filterItemType');
  sel.innerHTML = '';
  const cat = state.filterCategory;
  if (!cat) {
    sel.appendChild(new Option('種別: 先にカテゴリを選択', ''));
    sel.disabled = true;
    return;
  }
  sel.disabled = false;
  sel.appendChild(new Option('種別: すべて', ''));
  getItemTypes(cat).forEach((t) => sel.appendChild(new Option(t, t)));
}

async function loadProducts() {
  state.products = await dbGetAllProducts();
}

function renderList() {
  revokeObjectUrls();

  let items = state.products.slice();
  if (state.filterCategory) items = items.filter((p) => p.category === state.filterCategory);
  if (state.filterItemType) items = items.filter((p) => p.itemType === state.filterItemType);
  if (state.filterStatus) items = items.filter((p) => p.status === state.filterStatus);
  if (state.filterRating) {
    if (state.filterRating === 'none') items = items.filter((p) => !p.rating);
    else items = items.filter((p) => (p.rating || 0) >= Number(state.filterRating));
  }
  if (state.filterRepeat) {
    if (state.filterRepeat === 'none') items = items.filter((p) => !p.repeat);
    else items = items.filter((p) => p.repeat === state.filterRepeat);
  }
  const kw = state.keyword.trim().toLowerCase();
  if (kw) {
    items = items.filter((p) =>
      (p.name || '').toLowerCase().includes(kw) || (p.brand || '').toLowerCase().includes(kw));
  }

  const key = state.sortKey;
  const dir = state.sortDir === 'asc' ? 1 : -1;
  const numericKeys = { price: true, rating: true };
  const missing = (v) => v == null || v === '';
  items.sort((a, b) => {
    let av = a[key];
    let bv = b[key];
    // 値がないものは常に後ろへ
    if (missing(av) && missing(bv)) return 0;
    if (missing(av)) return 1;
    if (missing(bv)) return -1;
    if (numericKeys[key]) { av = Number(av); bv = Number(bv); }
    if (av === bv) return 0;
    return av < bv ? -dir : dir;
  });

  const list = $('#productList');
  list.innerHTML = '';

  $('#emptyMsg').classList.toggle('hidden', state.products.length !== 0);
  $('#listCount').textContent =
    state.products.length === 0 ? '' : `${items.length}件`;

  items.forEach((p) => {
    const card = document.createElement('div');
    card.className = 'card';

    const thumb = document.createElement('div');
    thumb.className = 'thumb';
    if (p.image) {
      const img = document.createElement('img');
      img.src = blobUrl(p.image);
      img.alt = '';
      thumb.appendChild(img);
    } else {
      thumb.textContent = '画像なし';
    }

    const body = document.createElement('div');
    body.className = 'card-body';

    const name = document.createElement('div');
    name.className = 'card-name';
    name.textContent = p.name;

    const brand = document.createElement('div');
    brand.className = 'card-brand';
    brand.textContent = p.brand || '';

    const meta = document.createElement('div');
    meta.className = 'card-meta';

    const badge = document.createElement('span');
    badge.className = `badge badge-${p.status}`;
    badge.textContent = STATUS_LABELS[p.status] || p.status;
    meta.appendChild(badge);

    // 使用期限の警告バッジ(使い切った商品には出さない)
    if (p.status !== 'finished') {
      const expiry = calcExpiry(p.openedDate, p.pao);
      if (expiry) {
        const days = daysUntil(expiry);
        if (days < 0) {
          const warn = document.createElement('span');
          warn.className = 'badge badge-expired';
          warn.textContent = '期限切れ';
          meta.appendChild(warn);
        } else if (days <= 30) {
          const warn = document.createElement('span');
          warn.className = 'badge badge-soon';
          warn.textContent = `期限まで${days}日`;
          meta.appendChild(warn);
        }
      }
    }

    const cat = document.createElement('span');
    cat.className = 'card-cat';
    cat.textContent = p.itemType ? `${p.category}・${p.itemType}` : p.category;
    meta.appendChild(cat);

    body.append(name, brand, meta);
    card.append(thumb, body);
    card.addEventListener('click', () => openDetail(p.id));
    list.appendChild(card);
  });
}

// ---------- フォーム ----------

function buildCategoryOptions() {
  const sel = $('#fCategory');
  sel.innerHTML = '';
  sel.appendChild(new Option('選択してください', ''));
  CATEGORIES.forEach((c) => sel.appendChild(new Option(c, c)));
}

function buildItemTypeOptions(category, selected) {
  const sel = $('#fItemType');
  sel.innerHTML = '';
  sel.appendChild(new Option('未選択', ''));
  getItemTypes(category).forEach((t) => sel.appendChild(new Option(t, t)));
  // 過去に登録した値が初期リストにない場合も選べるようにしておく
  if (selected && ![...sel.options].some((o) => o.value === selected)) {
    sel.appendChild(new Option(selected, selected));
  }
  sel.value = selected || '';
}

function setSeg(segEl, value) {
  [...segEl.querySelectorAll('button')].forEach((b) => {
    b.classList.toggle('on', b.dataset.value === value);
  });
}

function renderRating() {
  const box = $('#fRating');
  box.innerHTML = '';
  for (let i = 1; i <= 5; i++) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = '★';
    b.classList.toggle('on', i <= state.formRating);
    b.setAttribute('aria-label', `星${i}`);
    b.addEventListener('click', () => {
      // 同じ星をもう一度押すと取り消し
      state.formRating = state.formRating === i ? 0 : i;
      renderRating();
    });
    box.appendChild(b);
  }
}

function renderIngredientChips() {
  const box = $('#ingredientChips');
  box.innerHTML = '';
  state.formIngredients.forEach((ing, idx) => {
    const chip = document.createElement('span');
    chip.className = 'chip';
    const label = document.createElement('span');
    label.textContent = ing;
    const x = document.createElement('button');
    x.type = 'button';
    x.className = 'chip-x';
    x.textContent = '×';
    x.setAttribute('aria-label', `${ing}を削除`);
    x.addEventListener('click', () => {
      state.formIngredients.splice(idx, 1);
      renderIngredientChips();
    });
    chip.append(label, x);
    box.appendChild(chip);
  });
}

function updateImagePreview() {
  const img = $('#fImagePreview');
  const removeBtn = $('#btnRemoveImage');
  revokeObjectUrls(); // フォーム表示中は一覧が見えないのでまとめて解放してOK
  if (state.formImageBlob) {
    img.src = blobUrl(state.formImageBlob);
    img.classList.remove('hidden');
    removeBtn.classList.remove('hidden');
  } else {
    img.removeAttribute('src');
    img.classList.add('hidden');
    removeBtn.classList.add('hidden');
  }
}

// フォームを開く(product=nullなら新規。prefillで楽天の検索結果を流し込める)
function openForm(product, prefill) {
  state.editingId = product ? product.id : null;
  state.formBack = product ? 'detail' : 'add';
  state.formIngredients = product ? (product.ingredients || []).slice() : [];
  state.formImageBlob = product ? product.image || null : null;
  state.formImageChanged = false;
  state.formStatus = product ? product.status : 'stock';
  state.formRating = product ? product.rating || 0 : 0;
  state.formRepeat = product ? product.repeat || '' : '';

  $('#fName').value = product ? product.name : '';
  $('#fBrand').value = product ? product.brand || '' : '';
  $('#fCategory').value = product ? product.category : '';
  buildItemTypeOptions(product ? product.category : '', product ? product.itemType : '');
  $('#fVolume').value = product ? product.volume || '' : '';
  $('#fPrice').value = product && product.price != null ? product.price : '';
  $('#fJan').value = product ? product.janCode || '' : '';
  $('#fPurchaseDate').value = product ? product.purchaseDate || '' : '';
  $('#fPurchasePlace').value = product ? product.purchasePlace || '' : '';
  $('#fOpenedDate').value = product ? product.openedDate || '' : '';
  $('#fPao').value = product && product.pao != null ? product.pao : '';
  $('#fFinishedDate').value = product ? product.finishedDate || '' : '';
  $('#fIngredientsRaw').value = '';
  $('#fIngredientOne').value = '';
  $('#fReview').value = product ? product.review || '' : '';
  $('#fImage').value = '';

  // 楽天の検索結果からの流し込み(商品名などは後から自由に編集できる)
  if (!product && prefill) {
    if (prefill.name) $('#fName').value = prefill.name;
    if (prefill.price != null) $('#fPrice').value = prefill.price;
    if (prefill.janCode) $('#fJan').value = prefill.janCode;
    if (prefill.image) {
      state.formImageBlob = prefill.image;
      state.formImageChanged = true;
    }
  }

  setSeg($('#fStatusSeg'), state.formStatus);
  setSeg($('#fRepeatSeg'), state.formRepeat);
  renderRating();
  renderIngredientChips();
  updateImagePreview();

  showView('form', product ? '商品を編集' : '商品を登録');
}

async function saveForm() {
  const name = $('#fName').value.trim();
  const category = $('#fCategory').value;
  if (!name) { alert('商品名を入力してください'); $('#fName').focus(); return; }
  if (!category) { alert('カテゴリを選択してください'); return; }

  // 貼り付けたまま「整形して追加」を押し忘れていたら、保存時に自動で取り込む
  const rawLeft = $('#fIngredientsRaw').value.trim();
  if (rawLeft) {
    addIngredientsFromText(rawLeft);
    $('#fIngredientsRaw').value = '';
  }

  const priceVal = $('#fPrice').value;
  const paoVal = $('#fPao').value;
  const now = new Date().toISOString();

  const data = {
    name,
    brand: $('#fBrand').value.trim(),
    janCode: $('#fJan').value.trim(),
    volume: $('#fVolume').value.trim(),
    price: priceVal === '' ? null : Number(priceVal),
    ingredients: state.formIngredients.slice(),
    category,
    itemType: $('#fItemType').value,
    purchaseDate: $('#fPurchaseDate').value,
    purchasePlace: $('#fPurchasePlace').value.trim(),
    openedDate: $('#fOpenedDate').value,
    pao: paoVal === '' ? null : Number(paoVal),
    status: state.formStatus,
    finishedDate: $('#fFinishedDate').value,
    rating: state.formRating || null,
    repeat: state.formRepeat || '',
    review: $('#fReview').value.trim(),
    updatedAt: now,
  };

  // 「使用中」なのに開封日が空なら今日を入れる
  if (data.status === 'inUse' && !data.openedDate) data.openedDate = todayStr();
  // 「使い切った」なのに日付が空なら今日を入れる
  if (data.status === 'finished' && !data.finishedDate) data.finishedDate = todayStr();

  if (state.editingId != null) {
    const orig = await dbGetProduct(state.editingId);
    data.id = orig.id;
    data.createdAt = orig.createdAt;
    data.image = state.formImageChanged ? state.formImageBlob : orig.image || null;
    await dbPutProduct(data);
    await loadProducts();
    openDetail(orig.id);
  } else {
    data.createdAt = now;
    data.image = state.formImageBlob;
    const newId = await dbAddProduct(data);
    await loadProducts();
    openDetail(newId);
  }
}

function addIngredientsFromText(text) {
  const parts = splitIngredients(text);
  parts.forEach((p) => {
    if (!state.formIngredients.includes(p)) state.formIngredients.push(p);
  });
  renderIngredientChips();
}

// ---------- 詳細 ----------

async function openDetail(id) {
  const p = await dbGetProduct(id);
  if (!p) { goHome(); return; }
  state.detailId = id;
  state.editingId = null;
  renderDetail(p);
  showView('detail', '商品の詳細');
}

function renderDetail(p) {
  revokeObjectUrls();
  const box = $('#detailContent');
  box.innerHTML = '';

  // --- 上部: 画像・名前 ---
  const hero = document.createElement('div');
  hero.className = 'detail-hero';
  if (p.image) {
    const img = document.createElement('img');
    img.src = blobUrl(p.image);
    img.alt = '';
    hero.appendChild(img);
  }
  const nameEl = document.createElement('div');
  nameEl.className = 'detail-name';
  nameEl.textContent = p.name;
  hero.appendChild(nameEl);
  if (p.brand) {
    const brandEl = document.createElement('div');
    brandEl.className = 'detail-brand';
    brandEl.textContent = p.brand;
    hero.appendChild(brandEl);
  }
  const tags = document.createElement('div');
  tags.className = 'detail-tags';
  [p.category, p.itemType].filter(Boolean).forEach((t) => {
    const chip = document.createElement('span');
    chip.className = 'chip chip-static';
    chip.textContent = t;
    tags.appendChild(chip);
  });
  hero.appendChild(tags);
  box.appendChild(hero);

  // --- ステータスと期限 ---
  const stBox = document.createElement('div');
  stBox.className = 'detail-status-box';

  const stLine = document.createElement('div');
  stLine.className = 'detail-status-line';
  const badge = document.createElement('span');
  badge.className = `badge badge-${p.status}`;
  badge.textContent = STATUS_LABELS[p.status] || p.status;
  stLine.append('現在のステータス: ', badge);
  stBox.appendChild(stLine);

  if (p.status === 'stock') {
    const b = document.createElement('button');
    b.className = 'btn btn-primary btn-block';
    b.type = 'button';
    b.textContent = '使い始めた(使用中にする)';
    b.addEventListener('click', () => advanceStatus(p.id, 'inUse'));
    stBox.appendChild(b);
  } else if (p.status === 'inUse') {
    const b = document.createElement('button');
    b.className = 'btn btn-primary btn-block';
    b.type = 'button';
    b.textContent = '使い切った にする';
    b.addEventListener('click', () => advanceStatus(p.id, 'finished'));
    stBox.appendChild(b);
  }

  // 使用期限(開封日 + PAO)
  const expiry = calcExpiry(p.openedDate, p.pao);
  if (expiry) {
    const days = daysUntil(expiry);
    const line = document.createElement('div');
    const dateText = `${expiry.getFullYear()}/${String(expiry.getMonth() + 1).padStart(2, '0')}/${String(expiry.getDate()).padStart(2, '0')}`;
    if (days < 0) {
      line.className = 'expiry-line expiry-over';
      line.textContent = `使用期限: ${dateText}(${-days}日過ぎています)`;
    } else if (days <= 30) {
      line.className = 'expiry-line expiry-soon';
      line.textContent = `使用期限: ${dateText}(あと${days}日)`;
    } else {
      line.className = 'expiry-line expiry-ok';
      line.textContent = `使用期限: ${dateText}(あと${days}日)`;
    }
    stBox.appendChild(line);
  } else if (p.status === 'inUse' && !p.pao) {
    const line = document.createElement('div');
    line.className = 'expiry-line expiry-ok';
    line.textContent = '開封後の期限(か月)を登録すると、使用期限を表示できます';
    stBox.appendChild(line);
  }

  box.appendChild(stBox);

  // --- 項目一覧(値があるものだけ) ---
  const table = document.createElement('dl');
  table.className = 'detail-table';

  const addRow = (label, value, valueEl) => {
    if (!valueEl && (value == null || value === '')) return;
    const row = document.createElement('div');
    row.className = 'detail-row';
    const dt = document.createElement('dt');
    dt.textContent = label;
    const dd = document.createElement('dd');
    if (valueEl) dd.appendChild(valueEl); else dd.textContent = value;
    row.append(dt, dd);
    table.appendChild(row);
  };

  addRow('容量', p.volume);
  addRow('価格', p.price != null ? `¥${p.price.toLocaleString()}` : '');
  addRow('JANコード', p.janCode);
  addRow('購入日', fmtDate(p.purchaseDate));
  addRow('購入場所', p.purchasePlace);
  addRow('開封日', fmtDate(p.openedDate));
  addRow('開封後期限', p.pao != null ? `${p.pao}か月` : '');
  addRow('使い切った日', fmtDate(p.finishedDate));

  if (p.rating) {
    const stars = document.createElement('span');
    stars.className = 'detail-stars';
    stars.textContent = '★'.repeat(p.rating) + '☆'.repeat(5 - p.rating);
    addRow('星評価', null, stars);
  }
  addRow('リピート', REPEAT_LABELS[p.repeat] || '');

  if (p.ingredients && p.ingredients.length > 0) {
    const chips = document.createElement('div');
    chips.className = 'chips';
    p.ingredients.forEach((ing) => {
      const c = document.createElement('span');
      c.className = 'chip chip-static';
      c.textContent = ing;
      chips.appendChild(c);
    });
    addRow('成分', null, chips);
  }

  addRow('メモ', p.review);

  if (table.children.length > 0) box.appendChild(table);

  const dates = document.createElement('p');
  dates.className = 'detail-dates';
  dates.textContent = `登録: ${fmtDate(p.createdAt.slice(0, 10))} / 更新: ${fmtDate(p.updatedAt.slice(0, 10))}`;
  box.appendChild(dates);
}

// ステータスを1段階進める(日付の自動入力つき)
async function advanceStatus(id, newStatus) {
  const p = await dbGetProduct(id);
  if (!p) return;
  p.status = newStatus;
  if (newStatus === 'inUse' && !p.openedDate) p.openedDate = todayStr();
  if (newStatus === 'finished' && !p.finishedDate) p.finishedDate = todayStr();
  p.updatedAt = new Date().toISOString();
  await dbPutProduct(p);
  await loadProducts();
  openDetail(id);
}

async function deleteCurrent() {
  const p = await dbGetProduct(state.detailId);
  if (!p) return;
  if (!confirm(`「${p.name}」を削除します。よろしいですか?`)) return;
  await dbDeleteProduct(p.id);
  await loadProducts();
  goHome();
}

// ---------- 設定画面 ----------

function openSettings() {
  $('#settingAppId').value = state.rakutenAppId || '';
  $('#settingAccessKey').value = state.rakutenAccessKey || '';
  $('#settingAffiliateId').value = state.rakutenAffiliateId || '';
  $('#appIdStatus').textContent = '';
  $('#exportStatus').textContent = '';
  $('#importStatus').textContent = '';
  renderTypeManager();
  showView('settings', '設定');
}

// --- アイテム種別の管理 ---

function renderTypeManager() {
  const sel = $('#typeCategorySelect');
  if (sel.options.length === 0) {
    CATEGORIES.forEach((c) => sel.appendChild(new Option(c, c)));
  }
  renderTypeChips();
}

function renderTypeChips() {
  const cat = $('#typeCategorySelect').value;
  const box = $('#typeChips');
  box.innerHTML = '';
  const types = getItemTypes(cat);
  if (types.length === 0) {
    const p = document.createElement('span');
    p.className = 'stats-empty';
    p.textContent = 'このカテゴリには種別がまだありません。下から追加できます。';
    box.appendChild(p);
  }
  types.forEach((t) => {
    const chip = document.createElement('span');
    chip.className = 'chip';
    const label = document.createElement('span');
    label.textContent = t;
    const x = document.createElement('button');
    x.type = 'button';
    x.className = 'chip-x';
    x.textContent = '×';
    x.setAttribute('aria-label', `${t}を削除`);
    x.addEventListener('click', () => removeItemType(t));
    chip.append(label, x);
    box.appendChild(chip);
  });
  // 初期セットから変更されているときだけ「戻す」ボタンを見せる
  $('#btnResetTypes').classList.toggle('hidden', !itemTypesOverride[cat]);
}

async function saveTypesOverride() {
  await dbPutSetting('itemTypesOverride', itemTypesOverride);
}

async function addItemType() {
  const input = $('#typeNewInput');
  const v = input.value.trim();
  if (!v) return;
  const cat = $('#typeCategorySelect').value;
  const list = getItemTypes(cat).slice();
  if (!list.includes(v)) {
    list.push(v);
    itemTypesOverride[cat] = list;
    await saveTypesOverride();
  }
  input.value = '';
  renderTypeChips();
}

async function removeItemType(t) {
  const cat = $('#typeCategorySelect').value;
  itemTypesOverride[cat] = getItemTypes(cat).filter((x) => x !== t);
  await saveTypesOverride();
  renderTypeChips();
}

async function resetItemTypes() {
  const cat = $('#typeCategorySelect').value;
  delete itemTypesOverride[cat];
  await saveTypesOverride();
  renderTypeChips();
}

// --- バックアップ(書き出し・読み込み)と全削除 ---

function blobToDataURL(blob) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.onerror = () => reject(fr.error);
    fr.readAsDataURL(blob);
  });
}

async function exportData() {
  $('#exportStatus').textContent = '書き出しの準備をしています…';
  const products = await dbGetAllProducts();
  const out = [];
  for (const p of products) {
    const q = { ...p };
    q.image = p.image instanceof Blob ? await blobToDataURL(p.image) : null;
    out.push(q);
  }
  const payload = {
    app: 'cosme-log',
    version: 1,
    exportedAt: new Date().toISOString(),
    itemTypesOverride,
    products: out,
  };
  const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `cosmelog_backup_${todayStr()}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  $('#exportStatus').textContent =
    `${products.length}件を書き出しました。iPhoneでは「ファイル」アプリのダウンロードに保存されます。`;
}

async function importData(file) {
  try {
    const text = await file.text();
    const json = JSON.parse(text);
    const list = json && json.products;
    if (!Array.isArray(list)) throw new Error('productsがありません');
    if (!confirm(`バックアップから${list.length}件を読み込みます。今あるデータはそのまま残り、読み込んだ分が追加されます。よろしいですか?`)) {
      return;
    }
    let n = 0;
    for (const p of list) {
      const q = { ...p };
      delete q.id; // idは新しく振り直す
      if (typeof q.image === 'string' && q.image.startsWith('data:')) {
        try { q.image = await (await fetch(q.image)).blob(); } catch (e) { q.image = null; }
      } else if (!(q.image instanceof Blob)) {
        q.image = null;
      }
      if (!q.name || !q.category) continue;
      if (!q.status) q.status = 'stock';
      if (!q.createdAt) q.createdAt = new Date().toISOString();
      if (!q.updatedAt) q.updatedAt = q.createdAt;
      await dbAddProduct(q);
      n++;
    }
    if (json.itemTypesOverride && typeof json.itemTypesOverride === 'object') {
      itemTypesOverride = { ...itemTypesOverride, ...json.itemTypesOverride };
      await saveTypesOverride();
      renderTypeChips();
    }
    await loadProducts();
    $('#importStatus').textContent = `${n}件を読み込みました。`;
  } catch (err) {
    console.error(err);
    alert('読み込めませんでした。Cosme logで書き出したバックアップファイルかどうか確認してください。');
  }
}

async function wipeAllProducts() {
  if (!confirm('商品データをすべて削除します。よろしいですか?')) return;
  if (!confirm('本当に削除しますか? この操作は元に戻せません。')) return;
  await dbClearProducts();
  await loadProducts();
  alert('商品データをすべて削除しました。');
}

async function saveAppId() {
  const id = $('#settingAppId').value.trim();
  const key = $('#settingAccessKey').value.trim();
  const aff = $('#settingAffiliateId').value.trim();
  await dbPutSetting('rakutenAppId', id);
  await dbPutSetting('rakutenAccessKey', key);
  await dbPutSetting('rakutenAffiliateId', aff);
  state.rakutenAppId = id;
  state.rakutenAccessKey = key;
  state.rakutenAffiliateId = aff;
  if (id && key) {
    $('#appIdStatus').textContent = '保存しました。検索とバーコード読み取りが使えます。';
  } else if (id || key) {
    $('#appIdStatus').textContent = '保存しました。検索にはアプリケーションIDとアクセスキーの両方が必要です。';
  } else {
    $('#appIdStatus').textContent = '空にして保存しました。';
  }
}

// ---------- 統計・振り返り ----------

function openStats() {
  renderStats();
  showView('stats', '統計・振り返り');
}

function renderStats() {
  revokeObjectUrls();
  const box = $('#statsContent');
  box.innerHTML = '';
  const products = state.products;

  // 1. カテゴリ別の登録数
  const catCard = document.createElement('div');
  catCard.className = 'stats-card';
  const h1 = document.createElement('h2');
  h1.textContent = 'カテゴリ別の登録数';
  catCard.appendChild(h1);
  const counts = CATEGORIES.map((c) => ({ c, n: products.filter((p) => p.category === c).length }))
    .filter((x) => x.n > 0);
  if (counts.length === 0) {
    const p = document.createElement('p');
    p.className = 'stats-empty';
    p.textContent = 'まだ商品が登録されていません。';
    catCard.appendChild(p);
  } else {
    const max = Math.max(...counts.map((x) => x.n));
    counts.forEach(({ c, n }) => {
      const row = document.createElement('div');
      row.className = 'stats-row';
      const label = document.createElement('span');
      label.className = 'stats-label';
      label.textContent = c;
      const track = document.createElement('div');
      track.className = 'stats-bar-track';
      const bar = document.createElement('div');
      bar.className = 'stats-bar';
      bar.style.width = `${Math.round((n / max) * 100)}%`;
      track.appendChild(bar);
      const val = document.createElement('span');
      val.className = 'stats-value';
      val.textContent = `${n}個`;
      row.append(label, track, val);
      catCard.appendChild(row);
    });
  }
  box.appendChild(catCard);

  // 2. 月別の購入金額(価格と購入日が入っているものだけ。直近12か月分)
  const monthCard = document.createElement('div');
  monthCard.className = 'stats-card';
  const h2 = document.createElement('h2');
  h2.textContent = '月別の購入金額';
  monthCard.appendChild(h2);
  const byMonth = {};
  products.forEach((p) => {
    if (p.price != null && p.purchaseDate) {
      const m = p.purchaseDate.slice(0, 7); // 例: 2026-07
      byMonth[m] = (byMonth[m] || 0) + Number(p.price);
    }
  });
  const months = Object.keys(byMonth).sort().reverse().slice(0, 12);
  if (months.length === 0) {
    const p = document.createElement('p');
    p.className = 'stats-empty';
    p.textContent = '価格と購入日が入った商品がまだありません。';
    monthCard.appendChild(p);
  } else {
    const maxAmt = Math.max(...months.map((m) => byMonth[m]));
    months.forEach((m) => {
      const [y, mo] = m.split('-');
      const row = document.createElement('div');
      row.className = 'stats-row';
      const label = document.createElement('span');
      label.className = 'stats-label';
      label.textContent = `${y}年${Number(mo)}月`;
      const track = document.createElement('div');
      track.className = 'stats-bar-track';
      const bar = document.createElement('div');
      bar.className = 'stats-bar';
      bar.style.width = `${Math.round((byMonth[m] / maxAmt) * 100)}%`;
      track.appendChild(bar);
      const val = document.createElement('span');
      val.className = 'stats-value';
      val.textContent = `¥${byMonth[m].toLocaleString()}`;
      row.append(label, track, val);
      monthCard.appendChild(row);
    });
    const note = document.createElement('p');
    note.className = 'stats-note';
    note.textContent = '※ 価格と購入日を入力した商品だけを集計しています。';
    monthCard.appendChild(note);
  }
  box.appendChild(monthCard);

  // 3. リピートしたい商品(次に買うものリスト)
  const repCard = document.createElement('div');
  repCard.className = 'stats-card';
  const h3 = document.createElement('h2');
  h3.textContent = 'リピートしたい商品(次に買うものリスト)';
  repCard.appendChild(h3);
  const reps = products.filter((p) => p.repeat === 'yes');
  if (reps.length === 0) {
    const p = document.createElement('p');
    p.className = 'stats-empty';
    p.textContent = '「リピートしたい」にした商品がここに並びます。';
    repCard.appendChild(p);
  } else {
    reps.forEach((p) => {
      const card = document.createElement('div');
      card.className = 'card';
      card.style.marginTop = '10px';
      const thumb = document.createElement('div');
      thumb.className = 'thumb';
      if (p.image) {
        const img = document.createElement('img');
        img.src = blobUrl(p.image);
        img.alt = '';
        thumb.appendChild(img);
      } else {
        thumb.textContent = '画像なし';
      }
      const body = document.createElement('div');
      body.className = 'card-body';
      const name = document.createElement('div');
      name.className = 'card-name';
      name.textContent = p.name;
      const brand = document.createElement('div');
      brand.className = 'card-brand';
      brand.textContent = p.brand || '';
      body.append(name, brand);
      card.append(thumb, body);
      card.addEventListener('click', () => openDetail(p.id));
      repCard.appendChild(card);
    });
  }
  box.appendChild(repCard);
}

// ---------- 登録方法の選択 ----------

function openAdd() {
  const hasId = !!(state.rakutenAppId && state.rakutenAccessKey);
  $('#btnMethodScan').disabled = !hasId;
  $('#btnMethodSearch').disabled = !hasId;
  $('#addApiNote').classList.toggle('hidden', hasId);
  showView('add', '商品を登録');
}

// ---------- バーコード読み取り ----------

let zxingReader = null;
let scanHandled = false;
let scanAudioCtx = null; // 読み取り成功音用(タップ時に作る必要がある)

function playScanSound() {
  try {
    if (!scanAudioCtx) return;
    const o = scanAudioCtx.createOscillator();
    const g = scanAudioCtx.createGain();
    o.frequency.value = 1320;
    g.gain.value = 0.08;
    o.connect(g);
    g.connect(scanAudioCtx.destination);
    o.start();
    o.stop(scanAudioCtx.currentTime + 0.12);
  } catch (e) { /* 音が出なくても読み取りは続行 */ }
}

async function startScan() {
  scanHandled = false;
  showView('scan', 'バーコード読み取り');
  $('#scanStatus').textContent = 'カメラを起動しています…';
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (AC && !scanAudioCtx) scanAudioCtx = new AC();
    if (scanAudioCtx && scanAudioCtx.state === 'suspended') scanAudioCtx.resume();
  } catch (e) { /* 音はおまけなので失敗しても無視 */ }
  try {
    const hints = new Map();
    hints.set(ZXing.DecodeHintType.POSSIBLE_FORMATS, [ZXing.BarcodeFormat.EAN_13, ZXing.BarcodeFormat.EAN_8]);
    zxingReader = new ZXing.BrowserMultiFormatReader(hints);
    await zxingReader.decodeFromConstraints(
      { audio: false, video: { facingMode: { ideal: 'environment' } } },
      $('#scanVideo'),
      (result) => { if (result) onBarcodeDetected(result.getText()); }
    );
    $('#scanStatus').textContent = 'バーコードを枠の中に写してください';
  } catch (err) {
    console.error(err);
    $('#scanStatus').textContent = 'カメラを起動できませんでした。ブラウザのカメラ許可を確認してください。';
  }
}

function stopScan() {
  if (zxingReader) {
    try { zxingReader.reset(); } catch (e) { /* すでに停止済みなら無視 */ }
    zxingReader = null;
  }
}

function onBarcodeDetected(code) {
  if (scanHandled) return;
  scanHandled = true;
  playScanSound();
  if (navigator.vibrate) navigator.vibrate(80);
  stopScan();
  openSearch(code, true);
}

// ---------- 楽天で商品検索 ----------

function openSearch(query, fromBarcode) {
  state.searchOriginJan = fromBarcode ? query : '';
  $('#searchInput').value = query || '';
  $('#searchResults').innerHTML = '';
  $('#searchStatus').textContent = fromBarcode
    ? `バーコード(${query})を読み取りました。楽天で探しています…`
    : '';
  showView('search', '楽天で商品検索');
  if (fromBarcode) runSearch();
}

async function runSearch() {
  const q = $('#searchInput').value.trim();
  if (!q) return;
  const status = $('#searchStatus');
  status.textContent = '検索しています…';
  $('#searchResults').innerHTML = '';
  try {
    // 2026年2月刷新後の新しい楽天API(旧 app.rakuten.co.jp は2026年5月で停止)
    const url = new URL('https://openapi.rakuten.co.jp/ichibams/api/IchibaItem/Search/20260701');
    url.searchParams.set('applicationId', state.rakutenAppId);
    url.searchParams.set('accessKey', state.rakutenAccessKey);
    if (state.rakutenAffiliateId) url.searchParams.set('affiliateId', state.rakutenAffiliateId);
    url.searchParams.set('keyword', q);
    url.searchParams.set('hits', '15');
    url.searchParams.set('formatVersion', '2');
    const res = await fetch(url);
    if (!res.ok) {
      let msg = '検索に失敗しました。少し時間をおいてもう一度お試しください。';
      if (res.status === 401 || res.status === 403) {
        msg = 'アプリケーションIDまたはアクセスキーが正しくないようです。設定画面で、2つとも正しく貼り付けられているか確認してください。';
      }
      try {
        const ej = await res.json();
        const em = (ej && ej.errors && ej.errors.errorMessage) || '';
        if (/access key/i.test(em)) {
          msg = 'アクセスキーが正しくないようです。設定画面で「pk_」で始まるキーを確認してください。';
        } else if (/application/i.test(em)) {
          msg = 'アプリケーションIDが正しくないようです。設定画面で確認してください。';
        } else if (/auth/i.test(em)) {
          msg = '楽天の認証がうまくいきませんでした。設定画面のアプリケーションIDとアクセスキーが正しいか確認してください。';
        }
      } catch (e) { /* エラー内容が読めない場合は上のメッセージのまま */ }
      status.textContent = `${msg} 下のボタンから手動でも入力できます。`;
      return;
    }
    const json = await res.json();
    // 新APIは items(小文字)、旧APIは Items(大文字)だったため両対応。
    // formatVersion=1の入れ子形({item: {...}})が来ても中身を取り出す
    const items = (json.items || json.Items || []).map((it) => it.item || it);
    if (items.length === 0) {
      status.textContent = '見つかりませんでした。言葉を変えて再検索するか、下のボタンから手動で入力できます。';
      return;
    }
    status.textContent = `${items.length}件見つかりました。登録したい商品を選んでください。`;
    renderSearchResults(items);
  } catch (err) {
    console.error(err);
    status.textContent = '通信エラーで検索できませんでした。電波の良い場所でもう一度お試しください。';
  }
}

// 検索結果の画像URL(小さいサイズ指定を大きめに差し替える)
function resultImageUrl(item) {
  const arr = item.mediumImageUrls || [];
  if (arr.length === 0) return '';
  const first = typeof arr[0] === 'string' ? arr[0] : arr[0].imageUrl || '';
  return first.replace('_ex=128x128', '_ex=512x512');
}

function renderSearchResults(items) {
  const box = $('#searchResults');
  box.innerHTML = '';
  items.forEach((item) => {
    const card = document.createElement('div');
    card.className = 'card';

    const thumb = document.createElement('div');
    thumb.className = 'thumb';
    const imgUrl = resultImageUrl(item);
    if (imgUrl) {
      const img = document.createElement('img');
      img.src = imgUrl;
      img.alt = '';
      img.loading = 'lazy';
      thumb.appendChild(img);
    } else {
      thumb.textContent = '画像なし';
    }

    const body = document.createElement('div');
    body.className = 'card-body';

    const name = document.createElement('div');
    name.className = 'card-name';
    name.textContent = item.itemName || '';

    const price = document.createElement('div');
    price.className = 'result-price';
    price.textContent = item.itemPrice != null ? `¥${Number(item.itemPrice).toLocaleString()}` : '';

    const shop = document.createElement('div');
    shop.className = 'result-shop';
    shop.textContent = item.shopName || '';

    body.append(name, price, shop);
    card.append(thumb, body);
    card.addEventListener('click', () => selectSearchItem(item));
    box.appendChild(card);
  });
}

// 画像を取り込んでBlobにする(直接ダメなら中継サービス経由で再挑戦)
async function fetchImageBlob(url) {
  try {
    const r = await fetch(url);
    if (r.ok) return await r.blob();
  } catch (e) { /* 直接はCORSで失敗することが多い */ }
  try {
    const proxied = 'https://images.weserv.nl/?url=' + encodeURIComponent(url.replace(/^https?:\/\//, ''));
    const r2 = await fetch(proxied);
    if (r2.ok) return await r2.blob();
  } catch (e) { /* 中継サービスもダメなら画像なしで続行 */ }
  return null;
}

async function selectSearchItem(item) {
  $('#searchStatus').textContent = '商品情報を取り込んでいます…';
  const imgUrl = resultImageUrl(item);
  const blob = imgUrl ? await fetchImageBlob(imgUrl) : null;
  openForm(null, {
    name: item.itemName || '',
    price: item.itemPrice != null ? Number(item.itemPrice) : null,
    janCode: state.searchOriginJan,
    image: blob,
  });
  state.formBack = 'search';
  $('#searchStatus').textContent = `${$('#searchResults').children.length}件見つかりました。登録したい商品を選んでください。`;
  if (!blob && imgUrl) {
    alert('商品情報を取り込みました(画像だけ取り込めなかったので、必要なら「写真を選ぶ」から設定してください)');
  }
}

// ---------- イベント登録 ----------

function setupEvents() {
  $('#btnAdd').addEventListener('click', () => openAdd());
  $('#btnSettings').addEventListener('click', () => openSettings());
  $('#btnStats').addEventListener('click', () => openStats());

  $('#btnBack').addEventListener('click', () => {
    const view = currentView();
    if (view === 'form') {
      if (state.formBack === 'detail' && state.editingId != null) {
        openDetail(state.editingId); // 編集をやめて詳細に戻る
      } else if (state.formBack === 'search') {
        showView('search', '楽天で商品検索'); // 検索結果に戻る
      } else if (state.formBack === 'add') {
        openAdd();
      } else {
        goHome();
      }
    } else if (view === 'scan') {
      stopScan();
      openAdd();
    } else if (view === 'search') {
      openAdd();
    } else {
      goHome(); // add / settings / detail はホームへ
    }
  });

  // 登録方法の選択
  $('#btnMethodScan').addEventListener('click', () => startScan());
  $('#btnMethodSearch').addEventListener('click', () => openSearch('', false));
  $('#btnMethodManual').addEventListener('click', () => openForm(null));
  $('#btnGoSettings').addEventListener('click', () => openSettings());

  // バーコード読み取り
  $('#btnScanCancel').addEventListener('click', () => {
    stopScan();
    openAdd();
  });

  // 楽天検索
  $('#btnSearch').addEventListener('click', () => runSearch());
  $('#searchInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); runSearch(); }
  });
  $('#btnSearchManual').addEventListener('click', () => {
    openForm(null, { janCode: state.searchOriginJan });
    state.formBack = 'search';
  });

  // 設定
  $('#btnSaveAppId').addEventListener('click', () => {
    saveAppId().catch((err) => {
      console.error(err);
      alert('保存に失敗しました。もう一度お試しください。');
    });
  });

  // アイテム種別の管理
  $('#typeCategorySelect').addEventListener('change', () => renderTypeChips());
  $('#btnAddType').addEventListener('click', () => {
    addItemType().catch((err) => { console.error(err); alert('追加に失敗しました。'); });
  });
  $('#typeNewInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); $('#btnAddType').click(); }
  });
  $('#btnResetTypes').addEventListener('click', () => {
    resetItemTypes().catch((err) => { console.error(err); alert('戻せませんでした。'); });
  });

  // バックアップと全削除
  $('#btnExport').addEventListener('click', () => {
    exportData().catch((err) => {
      console.error(err);
      alert('書き出しに失敗しました。もう一度お試しください。');
    });
  });
  $('#importFile').addEventListener('change', (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    importData(file).catch((err) => {
      console.error(err);
      alert('読み込みに失敗しました。');
    });
  });
  $('#btnWipe').addEventListener('click', () => {
    wipeAllProducts().catch((err) => {
      console.error(err);
      alert('削除に失敗しました。');
    });
  });

  // ホーム画面追加の案内バナー
  $('#btnDismissA2hs').addEventListener('click', () => {
    $('#a2hsBanner').classList.add('hidden');
    dbPutSetting('a2hsDismissed', true).catch(() => { /* 保存できなくても閉じる */ });
  });

  $('#filterCategory').addEventListener('change', (e) => {
    state.filterCategory = e.target.value;
    state.filterItemType = ''; // カテゴリを変えたら種別の絞り込みはリセット
    buildFilterItemTypeOptions();
    renderList();
  });
  $('#filterItemType').addEventListener('change', (e) => {
    state.filterItemType = e.target.value;
    renderList();
  });
  $('#filterStatus').addEventListener('change', (e) => {
    state.filterStatus = e.target.value;
    renderList();
  });
  $('#filterRating').addEventListener('change', (e) => {
    state.filterRating = e.target.value;
    renderList();
  });
  $('#filterRepeat').addEventListener('change', (e) => {
    state.filterRepeat = e.target.value;
    renderList();
  });
  $('#homeSearch').addEventListener('input', (e) => {
    state.keyword = e.target.value;
    renderList();
  });
  $('#sortSelect').addEventListener('change', (e) => {
    const [key, dir] = e.target.value.split(':');
    state.sortKey = key;
    state.sortDir = dir;
    renderList();
  });

  $('#fCategory').addEventListener('change', (e) => {
    buildItemTypeOptions(e.target.value, '');
  });

  $('#fStatusSeg').addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    state.formStatus = btn.dataset.value;
    setSeg($('#fStatusSeg'), state.formStatus);
    // 「使用中」を選んだら開封日、「使い切った」を選んだら使い切った日を自動で今日に
    if (state.formStatus === 'inUse' && !$('#fOpenedDate').value) {
      $('#fOpenedDate').value = todayStr();
    }
    if (state.formStatus === 'finished' && !$('#fFinishedDate').value) {
      $('#fFinishedDate').value = todayStr();
    }
  });

  $('#fRepeatSeg').addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    // 同じボタンをもう一度押すと取り消し
    state.formRepeat = state.formRepeat === btn.dataset.value ? '' : btn.dataset.value;
    setSeg($('#fRepeatSeg'), state.formRepeat);
  });

  $('#btnFormat').addEventListener('click', () => {
    const raw = $('#fIngredientsRaw').value;
    if (!raw.trim()) return;
    addIngredientsFromText(raw);
    $('#fIngredientsRaw').value = '';
  });

  $('#btnAddIngredient').addEventListener('click', () => {
    const v = $('#fIngredientOne').value.trim();
    if (!v) return;
    addIngredientsFromText(v);
    $('#fIngredientOne').value = '';
  });

  $('#fImage').addEventListener('change', (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    state.formImageBlob = file;
    state.formImageChanged = true;
    updateImagePreview();
  });

  $('#btnRemoveImage').addEventListener('click', () => {
    state.formImageBlob = null;
    state.formImageChanged = true;
    $('#fImage').value = '';
    updateImagePreview();
  });

  $('#productForm').addEventListener('submit', (e) => {
    e.preventDefault();
    saveForm().catch((err) => {
      console.error(err);
      alert('保存に失敗しました。もう一度お試しください。');
    });
  });

  $('#btnEdit').addEventListener('click', async () => {
    const p = await dbGetProduct(state.detailId);
    if (p) openForm(p);
  });

  $('#btnDelete').addEventListener('click', () => {
    deleteCurrent().catch((err) => {
      console.error(err);
      alert('削除に失敗しました。');
    });
  });
}

// ---------- PWA(オフライン対応・ホーム画面追加の案内) ----------

function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch((err) => {
      console.error('Service Worker登録失敗:', err); // 失敗してもアプリ自体は動く
    });
  }
}

// ホーム画面に追加済み(アプリとして起動)かどうか
function isStandalone() {
  return window.navigator.standalone === true
    || window.matchMedia('(display-mode: standalone)').matches;
}

async function maybeShowA2hsBanner() {
  if (isStandalone()) return;
  const dismissed = await dbGetSetting('a2hsDismissed');
  if (dismissed) return;
  $('#a2hsBanner').classList.remove('hidden');
}

// ---------- 起動 ----------

async function init() {
  buildFilterOptions();
  buildCategoryOptions();
  setupEvents();
  try {
    state.rakutenAppId = (await dbGetSetting('rakutenAppId')) || '';
    state.rakutenAccessKey = (await dbGetSetting('rakutenAccessKey')) || '';
    state.rakutenAffiliateId = (await dbGetSetting('rakutenAffiliateId')) || '';
    itemTypesOverride = (await dbGetSetting('itemTypesOverride')) || {};
    await loadProducts();
  } catch (err) {
    console.error(err);
    alert('データの読み込みに失敗しました。ページを開き直してみてください。');
  }
  renderList();
  showView('home');
  registerServiceWorker();
  maybeShowA2hsBanner().catch(() => { /* 案内が出せなくても致命的ではない */ });
}

init();
