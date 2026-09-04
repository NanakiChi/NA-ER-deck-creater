"use strict";

const ATTRS = ["炎", "大地", "嵐", "波濤", "稲妻"];
const TYPES = ["リーダー", "ユニット", "スキル", "アイテム"];
const RARITIES = ["L", "SPL", "C", "R", "SR", "UR", "SPR", "P"];
const DECK_SIZE = 40; // non-leader cards
const TRIGGER_CAP = 8; // deck-wide cap on cards with a triggered ability
const STORAGE_KEY = "nivelarena-deck-v1";

let CARDS = [];
let byId = new Map();
let byCardNo = new Map();

const state = {
  filters: {
    search: "",
    attrs: new Set(), types: new Set(), rarities: new Set(), costs: new Set(),
    keywords: new Set(), affiliations: new Set(),
    triggerOnly: false, usableOnly: false,
  },
  sort: "cardNo",
  deck: { leaderId: null, secondaryAttr: null, cards: {} }, // cards: { id: count }
};

// "アタッカー、 ミックス" -> ["アタッカー", "ミックス"]
function cardKeywords(c) {
  return (c.keyword || "").split("、").map(s => s.trim()).filter(s => s && s !== "-");
}
// "エフェクト / 実験体" -> ["実験体"]; "エフェクト" tags every unit, so it filters nothing useful.
function cardAffiliations(c) {
  return (c.affiliation || "").split("/").map(s => s.trim()).filter(s => s && s !== "-" && s !== "エフェクト");
}
// Cards the current leader's attributes don't allow. Leaders themselves are never off-color.
function isOffColor(c) {
  const leader = currentLeader();
  return !!leader && c.cardType !== "リーダー"
    && c.attribute !== leader.attribute
    && c.attribute !== state.deck.secondaryAttr;
}

function loadDeck() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") {
        state.deck.leaderId = parsed.leaderId || null;
        state.deck.secondaryAttr = parsed.secondaryAttr || null;
        state.deck.cards = parsed.cards || {};
      }
    }
  } catch (e) { /* ignore */ }
}
function saveDeck() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state.deck)); } catch (e) { /* ignore */ }
}

function toast(msg) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.remove("show"), 1800);
}

async function init() {
  const res = await fetch("data/cards.json");
  CARDS = await res.json();
  for (const c of CARDS) {
    byId.set(c.id, c);
    if (!byCardNo.has(c.cardNo)) byCardNo.set(c.cardNo, []);
    byCardNo.get(c.cardNo).push(c);
  }
  loadDeck();
  buildFilterChips();
  bindGlobalEvents();
  renderAll();
}

function buildFilterChips() {
  const attrRow = document.getElementById("filterAttribute");
  attrRow.innerHTML = ATTRS.map(a => chipHtml("attr", a, a)).join("");
  const typeRow = document.getElementById("filterType");
  typeRow.innerHTML = TYPES.map(t => chipHtml("type", t, t)).join("");
  const rarityRow = document.getElementById("filterRarity");
  rarityRow.innerHTML = RARITIES.map(r => chipHtml("rarity", r, r)).join("");

  const costs = Array.from(new Set(CARDS.map(c => c.cost).filter(v => v !== null))).sort((a, b) => a - b);
  const costRow = document.getElementById("filterCost");
  costRow.innerHTML = costs.map(c => chipHtml("cost", String(c), String(c))).join("");

  const keywords = tagsByFrequency(cardKeywords);
  document.getElementById("filterKeyword").innerHTML =
    keywords.map(k => chipHtml("keyword", k, k)).join("");
  const affiliations = tagsByFrequency(cardAffiliations);
  document.getElementById("filterAffiliation").innerHTML =
    affiliations.map(a => chipHtml("affiliation", a, a)).join("");

  const FILTER_SET_NAMES = {
    attr: "attrs", type: "types", rarity: "rarities", cost: "costs",
    keyword: "keywords", affiliation: "affiliations",
  };
  // Scoped to #filters: the leader slot's secondary-attribute chips are handled separately.
  document.querySelectorAll("#filters .chip").forEach(chip => {
    chip.addEventListener("click", () => {
      const group = chip.dataset.group;
      const set = state.filters[FILTER_SET_NAMES[group]];
      if (set.has(chip.dataset.value)) set.delete(chip.dataset.value); else set.add(chip.dataset.value);
      chip.classList.toggle("active");
      renderGrid();
    });
  });

  const advanced = document.getElementById("advancedFilters");
  const btnAdvanced = document.getElementById("btnToggleAdvanced");
  btnAdvanced.addEventListener("click", () => {
    const open = advanced.hidden;
    advanced.hidden = !open;
    btnAdvanced.setAttribute("aria-expanded", String(open));
    btnAdvanced.textContent = open ? "詳細フィルター ▴" : "詳細フィルター ▾";
  });

  document.getElementById("toggleTriggerOnly").addEventListener("change", (e) => {
    state.filters.triggerOnly = e.target.checked;
    renderGrid();
  });
  document.getElementById("toggleUsableOnly").addEventListener("change", (e) => {
    state.filters.usableOnly = e.target.checked;
    renderGrid();
  });
  document.getElementById("sortSelect").addEventListener("change", (e) => {
    state.sort = e.target.value;
    renderGrid();
  });

  document.getElementById("btnResetFilters").addEventListener("click", () => {
    state.filters.search = "";
    document.getElementById("searchInput").value = "";
    for (const key of ["attrs", "types", "rarities", "costs", "keywords", "affiliations"]) {
      state.filters[key].clear();
    }
    state.filters.triggerOnly = false;
    state.filters.usableOnly = false;
    document.getElementById("toggleTriggerOnly").checked = false;
    document.getElementById("toggleUsableOnly").checked = false;
    document.querySelectorAll("#filters .chip.active").forEach(c => c.classList.remove("active"));
    renderGrid();
  });
}

// Distinct tag values, most common first, so the useful chips come first.
function tagsByFrequency(extract) {
  const counts = new Map();
  for (const c of CARDS) {
    for (const tag of extract(c)) counts.set(tag, (counts.get(tag) || 0) + 1);
  }
  return Array.from(counts.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "ja")).map(e => e[0]);
}

function chipHtml(group, value, label) {
  const attrAttr = group === "attr" ? ` data-attr="${value}"` : "";
  return `<span class="chip" data-group="${group}" data-value="${value}"${attrAttr}>${label}</span>`;
}

function bindGlobalEvents() {
  document.getElementById("searchInput").addEventListener("input", (e) => {
    state.filters.search = e.target.value.trim();
    renderGrid();
  });

  document.getElementById("btnClear").addEventListener("click", () => {
    if (!confirm("デッキを空にしますか？")) return;
    state.deck.leaderId = null;
    state.deck.secondaryAttr = null;
    state.deck.cards = {};
    saveDeck();
    renderAll();
  });

  document.getElementById("cardModalBackdrop").addEventListener("click", (e) => {
    if (e.target.id === "cardModalBackdrop") closeModal();
  });

  document.getElementById("btnExport").addEventListener("click", exportDeck);
  document.getElementById("btnImport").addEventListener("click", () => {
    document.getElementById("importModalBackdrop").classList.add("open");
  });
  document.getElementById("btnImportCancel").addEventListener("click", () => {
    document.getElementById("importModalBackdrop").classList.remove("open");
  });
  document.getElementById("btnImportConfirm").addEventListener("click", importDeck);

  document.getElementById("btnHandSim").addEventListener("click", openHandModal);
  document.getElementById("btnHandRedraw").addEventListener("click", drawHand);
  document.getElementById("btnHandClose").addEventListener("click", closeHandModal);
  document.getElementById("handSize").addEventListener("change", drawHand);
  document.getElementById("handModalBackdrop").addEventListener("click", (e) => {
    if (e.target.id === "handModalBackdrop") closeHandModal();
  });
  document.getElementById("btnDeckImage").addEventListener("click", exportDeckImage);

  document.getElementById("btnDeckFab").addEventListener("click", () => setDeckDrawer(true));
  document.getElementById("btnDeckClose").addEventListener("click", () => setDeckDrawer(false));
  document.getElementById("drawerBackdrop").addEventListener("click", () => setDeckDrawer(false));

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      closeModal();
      document.getElementById("importModalBackdrop").classList.remove("open");
      closeHandModal();
      setDeckDrawer(false);
      return;
    }
    // "/" jumps to search, unless the user is already typing somewhere.
    const tag = document.activeElement && document.activeElement.tagName;
    if (e.key === "/" && tag !== "INPUT" && tag !== "TEXTAREA" && tag !== "SELECT") {
      e.preventDefault();
      document.getElementById("searchInput").focus();
    }
  });
}

function setDeckDrawer(open) {
  document.getElementById("deckPane").classList.toggle("open", open);
  document.getElementById("drawerBackdrop").classList.toggle("open", open);
  // Hides the floating button, which would otherwise show through the backdrop.
  document.body.classList.toggle("drawer-open", open);
}

function openHandModal() {
  if (!totalDeckCount()) { toast("先にデッキにカードを追加してください"); return; }
  document.getElementById("handModalBackdrop").classList.add("open");
  drawHand();
}

function closeHandModal() {
  document.getElementById("handModalBackdrop").classList.remove("open");
}

function drawHand() {
  const pool = deckEntries();
  // Fisher-Yates: every ordering equally likely, so the hand is a fair sample.
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const size = Math.min(parseInt(document.getElementById("handSize").value, 10), pool.length);
  const hand = pool.slice(0, size);

  document.getElementById("handHelp").textContent =
    `デッキ${pool.length}枚から${size}枚を引きました（平均コスト ${(hand.reduce((s, c) => s + c.cost, 0) / size).toFixed(1)}）`;
  const cards = document.getElementById("handCards");
  cards.innerHTML = hand.map(c => `
    <div class="hand-card" data-id="${c.id}">
      <img src="${c.image}" alt="${escapeHtml(c.name)}">
      <div class="hc-name"><span class="hc-cost">${c.cost}</span> ${escapeHtml(c.name)}</div>
    </div>`).join("");
  cards.querySelectorAll(".hand-card").forEach(el => {
    el.addEventListener("click", () => openModal(byId.get(el.dataset.id)));
  });
}

async function exportDeckImage() {
  const entries = deckEntries();
  const leader = currentLeader();
  if (!entries.length && !leader) { toast("先にデッキを作成してください"); return; }
  toast("画像を生成しています…");

  const grouped = new Map();
  for (const c of entries) {
    const g = grouped.get(c.id) || { c, count: 0 };
    g.count++;
    grouped.set(c.id, g);
  }
  const rows = Array.from(grouped.values()).sort((a, b) =>
    TYPES.indexOf(a.c.cardType) - TYPES.indexOf(b.c.cardType)
    || a.c.cost - b.c.cost
    || a.c.name.localeCompare(b.c.name, "ja"));

  const PAD = 32, COLS = 6, CW = 150, CH = 210, GAP = 12, LABEL = 22;
  const LEADER_TOP = PAD + 68;
  // The grid has to clear the leader card, not just the title text.
  const headerH = leader ? LEADER_TOP + CH + GAP : PAD + 58;
  const gridRows = Math.ceil(rows.length / COLS);
  const canvas = document.createElement("canvas");
  canvas.width = PAD * 2 + COLS * CW + (COLS - 1) * GAP;
  canvas.height = headerH + gridRows * (CH + LABEL + GAP) + PAD;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#14161c";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = "#eceef2";
  ctx.font = "bold 24px 'Hiragino Sans', 'Yu Gothic UI', sans-serif";
  ctx.fillText("NivelArena デッキ", PAD, PAD + 24);
  ctx.fillStyle = "#9aa2b1";
  ctx.font = "15px 'Hiragino Sans', 'Yu Gothic UI', sans-serif";
  const summary = `${entries.length}/${DECK_SIZE}枚　トリガー ${triggerCountInDeck()}/${TRIGGER_CAP}`
    + (leader ? `　属性: ${leader.attribute}${state.deck.secondaryAttr ? " / " + state.deck.secondaryAttr : ""}` : "");
  ctx.fillText(summary, PAD, PAD + 50);

  if (leader) {
    await drawCardImage(ctx, leader.image, PAD, LEADER_TOP, CW, CH);
    ctx.fillStyle = "#eceef2";
    ctx.font = "bold 18px 'Hiragino Sans', 'Yu Gothic UI', sans-serif";
    ctx.fillText("リーダー", PAD + CW + 16, LEADER_TOP + 24);
    ctx.font = "16px 'Hiragino Sans', 'Yu Gothic UI', sans-serif";
    ctx.fillText(leader.name, PAD + CW + 16, LEADER_TOP + 50);
    ctx.fillStyle = "#9aa2b1";
    ctx.font = "14px 'Hiragino Sans', 'Yu Gothic UI', sans-serif";
    ctx.fillText(`${leader.cardNo} / ${leader.rarity}`, PAD + CW + 16, LEADER_TOP + 74);
  }

  for (let i = 0; i < rows.length; i++) {
    const { c, count } = rows[i];
    const x = PAD + (i % COLS) * (CW + GAP);
    const y = headerH + Math.floor(i / COLS) * (CH + LABEL + GAP);
    await drawCardImage(ctx, c.image, x, y, CW, CH);
    ctx.fillStyle = "#eceef2";
    ctx.font = "bold 15px 'Hiragino Sans', 'Yu Gothic UI', sans-serif";
    ctx.fillText(`×${count}`, x, y + CH + 17);
    ctx.fillStyle = "#9aa2b1";
    ctx.font = "13px 'Hiragino Sans', 'Yu Gothic UI', sans-serif";
    ctx.fillText(truncateToWidth(ctx, c.name, CW - 32), x + 30, y + CH + 17);
  }

  canvas.toBlob(blob => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `nivelarena-deck-${new Date().toISOString().slice(0, 10)}.png`;
    a.click();
    URL.revokeObjectURL(url);
    toast("デッキ画像を保存しました");
  }, "image/png");
}

function drawCardImage(ctx, src, x, y, w, h) {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => { ctx.drawImage(img, x, y, w, h); resolve(); };
    img.onerror = () => {
      // A missing image must not abort the export; leave a placeholder block.
      ctx.fillStyle = "#22262f";
      ctx.fillRect(x, y, w, h);
      resolve();
    };
    img.src = src;
  });
}

function truncateToWidth(ctx, text, maxWidth) {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let s = text;
  while (s.length > 1 && ctx.measureText(s + "…").width > maxWidth) s = s.slice(0, -1);
  return s + "…";
}

function passesFilter(c) {
  const f = state.filters;
  if (f.attrs.size && !f.attrs.has(c.attribute)) return false;
  if (f.types.size && !f.types.has(c.cardType)) return false;
  if (f.rarities.size && !f.rarities.has(c.rarity)) return false;
  if (f.costs.size && !(c.cost !== null && f.costs.has(String(c.cost)))) return false;
  if (f.keywords.size && !cardKeywords(c).some(k => f.keywords.has(k))) return false;
  if (f.affiliations.size && !cardAffiliations(c).some(a => f.affiliations.has(a))) return false;
  if (f.triggerOnly && !c.hasTrigger) return false;
  if (f.usableOnly && isOffColor(c)) return false;
  if (f.search) {
    const q = f.search.toLowerCase();
    const hay = (c.name + " " + c.cardNo + " " + stripTags(c.effectHtml) + " " + c.keyword + " " + c.affiliation).toLowerCase();
    if (!hay.includes(q)) return false;
  }
  return true;
}

function stripTags(html) {
  const div = document.createElement("div");
  div.innerHTML = html;
  return div.textContent || "";
}

function copiesInDeckForCardNo(cardNo, excludeVariantId) {
  const variants = byCardNo.get(cardNo) || [];
  let total = 0;
  for (const v of variants) {
    if (excludeVariantId && v.id === excludeVariantId) continue;
    total += state.deck.cards[v.id] || 0;
  }
  return total;
}

function totalDeckCount() {
  return Object.values(state.deck.cards).reduce((a, b) => a + b, 0);
}

function triggerCountInDeck() {
  let total = 0;
  for (const [id, count] of Object.entries(state.deck.cards)) {
    const c = byId.get(id);
    if (c && c.hasTrigger) total += count;
  }
  return total;
}

function currentLeader() {
  return state.deck.leaderId ? byId.get(state.deck.leaderId) : null;
}

function renderAll() {
  renderGrid();
  renderLeaderSlot();
  renderDeckList();
  renderDeckStats();
  renderDeckStatsPanel();
  renderValidity();
}

// Every non-leader card in the deck, one entry per copy.
function deckEntries() {
  const entries = [];
  for (const [id, count] of Object.entries(state.deck.cards)) {
    const c = byId.get(id);
    if (!c || count <= 0) continue;
    for (let i = 0; i < count; i++) entries.push(c);
  }
  return entries;
}

function renderDeckStatsPanel() {
  const el = document.getElementById("deckStatsPanel");
  const entries = deckEntries();
  if (!entries.length) {
    el.innerHTML = `<div class="dsp-empty">カードを追加するとコスト分布が表示されます</div>`;
    return;
  }

  const counts = new Map();
  for (const c of entries) counts.set(c.cost, (counts.get(c.cost) || 0) + 1);
  // Always show at least 0-5 so a low deck's curve doesn't render as a couple of bars.
  const maxCost = Math.max(5, ...counts.keys());
  const peak = Math.max(...counts.values());
  let bars = "";
  for (let cost = 0; cost <= maxCost; cost++) {
    const n = counts.get(cost) || 0;
    const share = Math.round((n / entries.length) * 100);
    // Bars carry one value each, so every bar is direct-labeled; the title adds the share.
    bars += `
      <div class="cc-col" title="コスト${cost}: ${n}枚（${share}%）">
        <span class="cc-count">${n || ""}</span>
        <div class="cc-track">
          <div class="cc-bar${n ? "" : " is-empty"}" style="height:${n ? Math.max(6, (n / peak) * 100) : 0}%"></div>
        </div>
        <span class="cc-x">${cost}</span>
      </div>`;
  }

  const avg = (entries.reduce((s, c) => s + c.cost, 0) / entries.length).toFixed(1);
  const attrCounts = new Map();
  for (const c of entries) attrCounts.set(c.attribute, (attrCounts.get(c.attribute) || 0) + 1);
  // Name + count carry the identity here: 波濤 and 嵐 are too close to tell apart by color alone.
  const attrRows = Array.from(attrCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([attr, n]) => `
      <span class="attr-row">
        <span class="attr-swatch" style="background: var(--attr-${attr})"></span>
        ${attr} <strong>${n}</strong>枚
      </span>`).join("");

  el.innerHTML = `
    <div class="dsp-title">コスト分布</div>
    <div class="cost-curve">${bars}</div>
    <div class="stat-tiles">
      <span class="stat-tile">平均コスト<strong>${avg}</strong></span>
      <span class="stat-tile">種類数<strong>${new Set(entries.map(c => c.cardNo)).size}</strong></span>
    </div>
    <div class="attr-breakdown">${attrRows}</div>`;
}

function sortCards(items) {
  const byName = (a, b) => a.name.localeCompare(b.name, "ja");
  // null cost/power (leaders, and non-units) always sort last rather than as 0.
  const num = (v, dir) => v === null || v === undefined ? Infinity : dir * v;
  const sorters = {
    cardNo: (a, b) => a.cardNo.localeCompare(b.cardNo) || byName(a, b),
    costAsc: (a, b) => num(a.cost, 1) - num(b.cost, 1) || byName(a, b),
    costDesc: (a, b) => num(a.cost, -1) - num(b.cost, -1) || byName(a, b),
    powerAsc: (a, b) => num(a.power, 1) - num(b.power, 1) || byName(a, b),
    powerDesc: (a, b) => num(a.power, -1) - num(b.power, -1) || byName(a, b),
    name: byName,
    rarity: (a, b) => RARITIES.indexOf(a.rarity) - RARITIES.indexOf(b.rarity) || byName(a, b),
  };
  return items.slice().sort(sorters[state.sort] || sorters.cardNo);
}

function renderGrid() {
  const grid = document.getElementById("cardGrid");
  const items = sortCards(CARDS.filter(passesFilter));
  document.getElementById("resultCount").textContent = `${items.length}件`;
  grid.innerHTML = items.map(c => cardTileHtml(c)).join("");
  grid.querySelectorAll(".card-tile").forEach(tile => {
    const id = tile.dataset.id;
    tile.querySelector(".tile-img-wrap").addEventListener("click", () => openModal(byId.get(id)));
    const btn = tile.querySelector(".tile-action");
    if (btn) {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const c = byId.get(id);
        if (c.cardType === "リーダー") selectLeader(c); else quickAdd(c);
      });
    }
  });
}

function cardTileHtml(c) {
  const count = state.deck.cards[c.id] || 0;
  const isLeaderSelected = state.deck.leaderId === c.id;
  const badge = c.cardType === "リーダー"
    ? (isLeaderSelected ? `<div class="in-deck-badge">LD</div>` : "")
    : (count > 0 ? `<div class="in-deck-badge">${count}</div>` : "");
  const actionLabel = c.cardType === "リーダー" ? "選択" : "+1";
  return `
    <div class="card-tile${isOffColor(c) ? " off-color" : ""}" data-id="${c.id}" title="${escapeHtml(c.name)}">
      <div class="tile-img-wrap">
        <img src="${c.image}" loading="lazy" alt="${escapeHtml(c.name)}">
        ${badge}
        ${c.hasTrigger ? `<div class="trigger-badge tile-trigger-badge" title="トリガー効果">T</div>` : ""}
      </div>
      <div class="tile-name">${escapeHtml(c.name)}</div>
      <div class="tile-info">
        <span class="rarity-badge">${c.rarity}</span>
        <span>${c.cost !== null ? "コスト" + c.cost : ""}</span>
        <button class="btn btn-small tile-action">${actionLabel}</button>
      </div>
    </div>`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, m => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
}

function quickAdd(c) {
  const leader = currentLeader();
  if (!leader) { toast("先にリーダーを選択してください"); return; }
  let justLockedSecondary = false;
  if (c.attribute !== leader.attribute) {
    if (!state.deck.secondaryAttr) {
      state.deck.secondaryAttr = c.attribute;
      justLockedSecondary = true;
    } else if (c.attribute !== state.deck.secondaryAttr) {
      toast(`このカードの属性(${c.attribute})は使えません（リーダー: ${leader.attribute} / 第2属性: ${state.deck.secondaryAttr}）`);
      return;
    }
  }
  const currentCopies = copiesInDeckForCardNo(c.cardNo);
  if (currentCopies >= c.maxCopies) {
    if (justLockedSecondary) state.deck.secondaryAttr = null; // roll back, nothing was actually added
    toast(`このカードは最大${c.maxCopies}枚までです`);
    return;
  }
  if (totalDeckCount() >= DECK_SIZE) {
    if (justLockedSecondary) state.deck.secondaryAttr = null;
    toast(`デッキは${DECK_SIZE}枚までです`);
    return;
  }
  if (c.hasTrigger && triggerCountInDeck() >= TRIGGER_CAP) {
    if (justLockedSecondary) state.deck.secondaryAttr = null;
    toast(`トリガー効果を持つカードはデッキ全体で最大${TRIGGER_CAP}枚までです`);
    return;
  }
  state.deck.cards[c.id] = (state.deck.cards[c.id] || 0) + 1;
  saveDeck();
  renderAll();
  if (justLockedSecondary) toast(`第2属性を「${c.attribute}」に設定しました`);
}

function setSecondaryAttribute(attr) {
  const leader = currentLeader();
  if (!leader || attr === leader.attribute) return;

  if (state.deck.secondaryAttr === attr) {
    // toggle off
    const affected = Object.keys(state.deck.cards).filter(id => byId.get(id)?.attribute === attr);
    if (affected.length && !confirm(`第2属性（${attr}）を解除すると、該当カード${affected.length}種類がデッキから削除されます。よろしいですか？`)) return;
    for (const id of affected) delete state.deck.cards[id];
    state.deck.secondaryAttr = null;
  } else {
    const oldAttr = state.deck.secondaryAttr;
    const affected = oldAttr ? Object.keys(state.deck.cards).filter(id => byId.get(id)?.attribute === oldAttr) : [];
    if (affected.length && !confirm(`第2属性を${oldAttr}から${attr}に変更すると、${oldAttr}のカード${affected.length}種類がデッキから削除されます。よろしいですか？`)) return;
    for (const id of affected) delete state.deck.cards[id];
    state.deck.secondaryAttr = attr;
  }
  saveDeck();
  renderAll();
}

function removeOne(c) {
  const cur = state.deck.cards[c.id] || 0;
  if (cur <= 1) delete state.deck.cards[c.id]; else state.deck.cards[c.id] = cur - 1;
  saveDeck();
  renderAll();
}

function selectLeader(c) {
  const prevLeader = currentLeader();
  if (!prevLeader || prevLeader.attribute !== c.attribute) {
    state.deck.secondaryAttr = null;
  }
  state.deck.leaderId = c.id;
  saveDeck();
  renderAll();
  closeModal();
}

function renderLeaderSlot() {
  const slot = document.getElementById("leaderSlot");
  const leader = currentLeader();
  if (!leader) {
    slot.innerHTML = `<div class="leader-slot-placeholder">リーダー未選択<br><span>カード一覧のリーダーをクリックして選択</span></div>`;
    return;
  }
  const secondaryChoices = ATTRS.filter(a => a !== leader.attribute);
  slot.innerHTML = `
    <div class="leader-slot-main">
      <img src="${leader.image}" alt="${escapeHtml(leader.name)}">
      <div class="leader-info">
        <div class="lname">${escapeHtml(leader.name)}</div>
        <div>${leader.cardNo} / <span class="rarity-badge">${leader.rarity}</span> / 属性: ${leader.attribute}</div>
      </div>
      <button class="btn btn-small" id="btnLeaderDetail">詳細</button>
      <button class="btn btn-small" id="btnLeaderClear">解除</button>
    </div>
    <div class="secondary-attr-row">
      <span class="second-label">第2属性${state.deck.secondaryAttr ? "" : "（未確定・別色を追加すると自動確定）"}:</span>
      ${secondaryChoices.map(a => `<span class="chip sec-attr-chip${a === state.deck.secondaryAttr ? " active" : ""}" data-attr="${a}">${a}</span>`).join("")}
    </div>`;
  document.getElementById("btnLeaderDetail").addEventListener("click", () => openModal(leader));
  document.getElementById("btnLeaderClear").addEventListener("click", () => {
    state.deck.leaderId = null;
    state.deck.secondaryAttr = null;
    saveDeck();
    renderAll();
  });
  slot.querySelectorAll(".sec-attr-chip").forEach(chip => {
    chip.addEventListener("click", () => setSecondaryAttribute(chip.dataset.attr));
  });
}

function renderDeckList() {
  const list = document.getElementById("deckList");
  const groups = { "ユニット": [], "スキル": [], "アイテム": [] };
  for (const [id, count] of Object.entries(state.deck.cards)) {
    if (count <= 0) continue;
    const c = byId.get(id);
    if (!c) continue;
    if (!groups[c.cardType]) groups[c.cardType] = [];
    groups[c.cardType].push({ c, count });
  }
  let html = "";
  for (const type of TYPES.filter(t => t !== "リーダー")) {
    const rows = groups[type] || [];
    if (!rows.length) continue;
    rows.sort((a, b) => (a.c.cost ?? 0) - (b.c.cost ?? 0) || a.c.name.localeCompare(b.c.name, "ja"));
    const subtotal = rows.reduce((s, r) => s + r.count, 0);
    html += `<div class="deck-group-title">${type}（${subtotal}）</div>`;
    const triggerOver = triggerCountInDeck() > TRIGGER_CAP;
    for (const { c, count } of rows) {
      const overLimit = copiesInDeckForCardNo(c.cardNo) > c.maxCopies || (c.hasTrigger && triggerOver);
      html += `
        <div class="deck-row ${overLimit ? "over-limit" : ""}" data-id="${c.id}">
          <img src="${c.image}" alt="">
          <span class="drow-cost">${c.cost ?? "-"}</span>
          <span class="drow-name">${escapeHtml(c.name)}${c.hasTrigger ? ` <span class="trigger-badge" title="トリガー効果">T</span>` : ""}</span>
          <span class="rarity-badge">${c.rarity}</span>
          <span class="stepper">
            <button class="drow-minus">−</button>
            <span class="count">${count}</span>
            <button class="drow-plus">＋</button>
          </span>
        </div>`;
    }
  }
  list.innerHTML = html || `<div class="deck-group-title">まだカードがありません</div>`;
  list.querySelectorAll(".deck-row").forEach(row => {
    const id = row.dataset.id;
    const c = byId.get(id);
    row.querySelector(".drow-name").addEventListener("click", () => openModal(c));
    row.querySelector("img").addEventListener("click", () => openModal(c));
    row.querySelector(".drow-minus").addEventListener("click", () => removeOne(c));
    row.querySelector(".drow-plus").addEventListener("click", () => quickAdd(c));
  });
}

function renderDeckStats() {
  const el = document.getElementById("deckStats");
  const total = totalDeckCount();
  const leader = currentLeader();
  const trig = triggerCountInDeck();
  el.innerHTML = `デッキ: <strong>${total + (leader ? 1 : 0)}</strong> / 41 枚　`
    + `(リーダー${leader ? "1" : "0"} + その他<strong>${total}</strong>/${DECK_SIZE})　`
    + `トリガー: <strong>${trig}</strong>/${TRIGGER_CAP}`;
  document.getElementById("btnDeckFab").textContent = `デッキ ${total}/${DECK_SIZE}`;
}

function renderValidity() {
  const el = document.getElementById("deckValidity");
  const leader = currentLeader();
  const errors = [];
  if (!leader) errors.push("リーダーが選択されていません。");
  const total = totalDeckCount();
  if (total !== DECK_SIZE) errors.push(`カード枚数が${DECK_SIZE}枚ではありません（現在${total}枚）。`);

  if (leader) {
    const allowed = new Set([leader.attribute]);
    if (state.deck.secondaryAttr) allowed.add(state.deck.secondaryAttr);
    const mismatched = new Set();
    for (const id of Object.keys(state.deck.cards)) {
      const c = byId.get(id);
      if (c && !allowed.has(c.attribute)) mismatched.add(c.name);
    }
    if (mismatched.size) {
      errors.push(`リーダー(${leader.attribute})・第2属性(${state.deck.secondaryAttr || "未選択"})以外の属性のカードがあります: ${Array.from(mismatched).join("、")}`);
    }
  }

  const seenGroups = new Set();
  const overLimit = [];
  for (const id of Object.keys(state.deck.cards)) {
    const c = byId.get(id);
    if (!c || seenGroups.has(c.cardNo)) continue;
    seenGroups.add(c.cardNo);
    const total2 = copiesInDeckForCardNo(c.cardNo);
    if (total2 > c.maxCopies) overLimit.push(`${c.name}（${total2}/${c.maxCopies}枚）`);
  }
  if (overLimit.length) errors.push(`同一カードの上限を超えています: ${overLimit.join("、")}`);

  const trigCount = triggerCountInDeck();
  if (trigCount > TRIGGER_CAP) errors.push(`トリガー効果を持つカードがデッキ全体で${TRIGGER_CAP}枚を超えています（現在${trigCount}枚）。`);

  if (errors.length === 0) {
    el.className = "deck-validity ok";
    el.innerHTML = `<span class="ok-line">✓ このデッキは公式ルールに適合しています</span>`;
  } else {
    el.className = "deck-validity bad";
    el.innerHTML = `デッキルール違反:<ul>${errors.map(e => `<li>${escapeHtml(e)}</li>`).join("")}</ul>`;
  }
}

function openModal(c) {
  const backdrop = document.getElementById("cardModalBackdrop");
  const modal = document.getElementById("cardModal");
  const variants = byCardNo.get(c.cardNo) || [c];
  const count = state.deck.cards[c.id] || 0;
  const isLeader = c.cardType === "リーダー";
  const isSelectedLeader = state.deck.leaderId === c.id;

  modal.innerHTML = `
    <button class="btn btn-small mc-close" id="mcClose">閉じる</button>
    <div class="mc-body">
      <img class="mc-img" id="mcImg" src="${c.image}" alt="${escapeHtml(c.name)}">
      <div class="mc-info">
        <h2>${escapeHtml(c.name)}${c.hasTrigger ? ` <span class="trigger-badge" title="トリガー効果を持つカード">T</span>` : ""}</h2>
        <div class="mc-sub">${c.cardNo} / ${c.cardType} / 属性: ${c.attribute}</div>
        <div class="mc-stats">
          <div><span>コスト: </span>${c.cost ?? "-"}</div>
          <div><span>レアリティ: </span>${c.rarity}</div>
          <div><span>パワー: </span>${c.power ?? "-"}</div>
          <div><span>ヒット: </span>${c.hit ?? "-"}</div>
          <div><span>所属: </span>${escapeHtml(c.affiliation || "-")}</div>
          <div><span>キーワード: </span>${escapeHtml(c.keyword || "-")}</div>
        </div>
        <div class="mc-effect">${c.effectHtml || "(効果テキストなし)"}</div>
        <div class="mc-sub" style="margin-top:8px;">${escapeHtml(c.productName)}</div>
        ${variants.length > 1 ? `<div class="mc-variants">${variants.map(v => `<img data-vid="${v.id}" class="${v.id === c.id ? "active" : ""}" src="${v.image}" title="${v.rarity}">`).join("")}</div>` : ""}
        <div class="mc-actions">
          ${isLeader
            ? `<button class="btn btn-primary" id="mcSelectLeader" ${isSelectedLeader ? "disabled" : ""}>${isSelectedLeader ? "選択中のリーダー" : "リーダーとして選択"}</button>`
            : `<button class="btn btn-ghost" id="mcMinus" ${count === 0 ? "disabled" : ""}>−1</button>
               <span style="align-self:center;font-size:13px;">デッキ内: ${count}枚</span>
               <button class="btn btn-primary" id="mcPlus">＋1</button>`
          }
        </div>
      </div>
    </div>`;

  modal.querySelector("#mcClose").addEventListener("click", closeModal);
  const plus = modal.querySelector("#mcPlus");
  if (plus) plus.addEventListener("click", () => { quickAdd(c); openModal(byId.get(c.id)); });
  const minus = modal.querySelector("#mcMinus");
  if (minus) minus.addEventListener("click", () => { removeOne(c); openModal(byId.get(c.id)); });
  const selLeader = modal.querySelector("#mcSelectLeader");
  if (selLeader) selLeader.addEventListener("click", () => selectLeader(c));
  modal.querySelectorAll(".mc-variants img").forEach(img => {
    img.addEventListener("click", () => openModal(byId.get(img.dataset.vid)));
  });

  backdrop.classList.add("open");
}

function closeModal() {
  document.getElementById("cardModalBackdrop").classList.remove("open");
}

function exportDeck() {
  const leader = currentLeader();
  const lines = [];
  lines.push(`# NivelArena デッキ (${new Date().toLocaleDateString("ja-JP")})`);
  lines.push(leader ? `Leader: ${leader.cardNo} ${leader.name}` : "Leader: (未選択)");
  if (state.deck.secondaryAttr) lines.push(`Secondary: ${state.deck.secondaryAttr}`);
  lines.push("");
  const grouped = {};
  for (const [id, count] of Object.entries(state.deck.cards)) {
    const c = byId.get(id);
    if (!c || count <= 0) continue;
    grouped[c.cardNo] = grouped[c.cardNo] || { c, count: 0 };
    grouped[c.cardNo].count += count;
  }
  const rows = Object.values(grouped).sort((a, b) => a.c.cardNo.localeCompare(b.c.cardNo));
  for (const { c, count } of rows) lines.push(`${count}x ${c.cardNo} ${c.name}`);
  const text = lines.join("\n");
  navigator.clipboard?.writeText(text).then(() => toast("デッキをクリップボードにコピーしました")).catch(() => {
    prompt("コピーしてください:", text);
  });
}

function importDeck() {
  const text = document.getElementById("importText").value;
  const lines = text.split(/\r?\n/);
  const newCards = {};
  let newLeaderId = null;
  let newSecondaryAttr = null;
  for (const line of lines) {
    const leaderMatch = line.match(/^Leader:\s*(\S+)/);
    if (leaderMatch) {
      const cardNo = leaderMatch[1];
      const variants = byCardNo.get(cardNo);
      if (variants && variants.length) newLeaderId = variants[0].id;
      continue;
    }
    const secondaryMatch = line.match(/^Secondary:\s*(\S+)/);
    if (secondaryMatch) {
      newSecondaryAttr = secondaryMatch[1];
      continue;
    }
    const m = line.match(/^(\d+)x\s+(\S+)/);
    if (m) {
      const count = parseInt(m[1], 10);
      const cardNo = m[2];
      const variants = byCardNo.get(cardNo);
      if (variants && variants.length) newCards[variants[0].id] = (newCards[variants[0].id] || 0) + count;
    }
  }
  if (Object.keys(newCards).length === 0 && !newLeaderId) {
    toast("読み込めるデッキ情報が見つかりませんでした");
    return;
  }
  state.deck.leaderId = newLeaderId;
  state.deck.secondaryAttr = newSecondaryAttr;
  state.deck.cards = newCards;
  saveDeck();
  renderAll();
  document.getElementById("importModalBackdrop").classList.remove("open");
  toast("デッキを読み込みました");
}

init();
