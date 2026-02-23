// app.js
const cfg = window.SITE_CONFIG;

const els = {
  repoLine: document.getElementById("repoLine"),
  refreshBtn: document.getElementById("refreshBtn"),
  settingsBtn: document.getElementById("settingsBtn"),
  addInventoryBtn: document.getElementById("addInventoryBtn"),
  addShoppingBtn: document.getElementById("addShoppingBtn"),

  tabInventory: document.getElementById("tabInventory"),
  tabShopping: document.getElementById("tabShopping"),
  searchInput: document.getElementById("searchInput"),
  statusFilter: document.getElementById("statusFilter"),
  sortSelect: document.getElementById("sortSelect"),

  statsRow: document.getElementById("statsRow"),
  listTitle: document.getElementById("listTitle"),
  countPill: document.getElementById("countPill"),
  toggleViewBtn: document.getElementById("toggleViewBtn"),
  listContainer: document.getElementById("listContainer"),
  groupsContainer: document.getElementById("groupsContainer"),

  modalBackdrop: document.getElementById("modalBackdrop"),
  settingsModal: document.getElementById("settingsModal"),
  closeSettingsBtn: document.getElementById("closeSettingsBtn"),
  tokenInput: document.getElementById("tokenInput"),
  saveTokenBtn: document.getElementById("saveTokenBtn"),
  clearTokenBtn: document.getElementById("clearTokenBtn"),
};

const state = {
  activeTab: "inventory", // inventory | shopping
  viewMode: "cards",      // cards | table
  allIssues: [],
  filtered: [],
};

// Cache + ETag (prevents blank UI + reduces API calls)
const CACHE_KEY = "fi_cache_v1";
const ETAG_KEY  = "fi_etag_v1";
const CACHE_TTL_MS = 1000 * 60 * 10; // 10 minutes

init();

function init(){
  els.repoLine.textContent = `${cfg.repoOwner}/${cfg.repoName}`;
  els.addInventoryBtn.href = issueNewUrl("inventory");
  els.addShoppingBtn.href  = issueNewUrl("shopping");

  // build status filter
  for (const s of cfg.statusLabels){
    const opt = document.createElement("option");
    opt.value = s;
    opt.textContent = s;
    els.statusFilter.appendChild(opt);
  }

  // load token
  els.tokenInput.value = getToken() || "";

  // events
  els.refreshBtn.addEventListener("click", loadAll);
  els.tabInventory.addEventListener("click", () => setTab("inventory"));
  els.tabShopping.addEventListener("click", () => setTab("shopping"));

  els.searchInput.addEventListener("input", applyFilters);
  els.statusFilter.addEventListener("change", applyFilters);
  els.sortSelect.addEventListener("change", applyFilters);

  els.toggleViewBtn.addEventListener("click", () => {
    state.viewMode = (state.viewMode === "cards") ? "table" : "cards";
    els.toggleViewBtn.textContent = (state.viewMode === "cards") ? "Table View" : "Card View";
    render();
  });

  els.settingsBtn.addEventListener("click", openSettings);
  els.closeSettingsBtn.addEventListener("click", closeSettings);
  els.modalBackdrop.addEventListener("click", closeSettings);

  els.saveTokenBtn.addEventListener("click", () => {
    const t = (els.tokenInput.value || "").trim();
    if (!t) return;
    localStorage.setItem("fi_token", t);
    closeSettings();
    loadAll();
  });
  els.clearTokenBtn.addEventListener("click", () => {
    localStorage.removeItem("fi_token");
    els.tokenInput.value = "";
    closeSettings();
    loadAll();
  });

  loadAll();
}

function issueNewUrl(kind){
  const base = `https://github.com/${cfg.repoOwner}/${cfg.repoName}/issues/new`;

  if (kind === "inventory"){
    const template = "inventory.yml";
    const labels = encodeURIComponent(`${cfg.inventoryLabel},In Stock`);
    return `${base}?template=${encodeURIComponent(template)}&labels=${labels}`;
  }

  // shopping
  {
    const template = "shopping.yml";
    const labels = encodeURIComponent(`${cfg.shoppingLabel},Looking For`);
    return `${base}?template=${encodeURIComponent(template)}&labels=${labels}`;
  }
}

function openSettings(){
  els.modalBackdrop.classList.remove("hidden");
  els.settingsModal.classList.remove("hidden");
}
function closeSettings(){
  els.modalBackdrop.classList.add("hidden");
  els.settingsModal.classList.add("hidden");
}

function getToken(){
  return localStorage.getItem("fi_token");
}

function apiBase(){
  return `https://api.github.com/repos/${cfg.repoOwner}/${cfg.repoName}`;
}

// --- Cache helpers ---
function saveCache(issues){
  const payload = { ts: Date.now(), issues };
  localStorage.setItem(CACHE_KEY, JSON.stringify(payload));
}
function loadCache(){
  try{
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const payload = JSON.parse(raw);
    if (!payload?.ts || !Array.isArray(payload.issues)) return null;
    return payload;
  }catch{
    return null;
  }
}
function isCacheFresh(payload){
  return payload && (Date.now() - payload.ts) < CACHE_TTL_MS;
}

function buildRateLimitMessage(remaining, resetEpoch){
  let msg = "GitHub API rate limit hit.";
  if (remaining !== null && remaining !== undefined) msg += ` Remaining: ${remaining}.`;
  if (resetEpoch){
    const ms = Number(resetEpoch) * 1000;
    if (Number.isFinite(ms)){
      const mins = Math.max(1, Math.ceil((ms - Date.now()) / 60000));
      msg += ` Try again in about ${mins} minute${mins === 1 ? "" : "s"}.`;
    }
  }
  msg += " Add a GitHub token in Settings to prevent this.";
  return msg;
}

// upgraded fetch: handles rate limit + supports ETag / 304
async function ghFetch(url, { useEtag = false } = {}){
  const headers = { "Accept": "application/vnd.github+json" };
  const tok = getToken();
  if (tok) headers.Authorization = `token ${tok}`;

  if (useEtag){
    const et = localStorage.getItem(ETAG_KEY);
    if (et) headers["If-None-Match"] = et;
  }

  const res = await fetch(url, { headers });

  // Rate limit / forbidden / too many requests
  if (res.status === 403 || res.status === 429){
    const remaining = res.headers.get("x-ratelimit-remaining");
    const reset = res.headers.get("x-ratelimit-reset");
    const msg = buildRateLimitMessage(remaining, reset);
    const err = new Error(msg);
    err.__rateLimited = true;
    throw err;
  }

  if (res.status === 304){
    return { __notModified: true };
  }

  if (!res.ok){
    const txt = await res.text().catch(()=> "");
    throw new Error(`GitHub API error ${res.status}: ${txt || res.statusText}`);
  }

  const etag = res.headers.get("etag");
  if (useEtag && etag) localStorage.setItem(ETAG_KEY, etag);

  return res.json();
}

async function loadAll(){
  try{
    els.refreshBtn.textContent = "Refreshing…";

    // If we have fresh cache and nothing loaded yet, render instantly
    const cached = loadCache();
    if (cached && isCacheFresh(cached) && state.allIssues.length === 0){
      state.allIssues = cached.issues.map(normalizeIssue);
      applyFilters(); // renders
    }

    const perPage = 100;
    let page = 1;
    let all = [];

    // First page with ETag to avoid unnecessary hits
    const firstUrl = `${apiBase()}/issues?state=all&per_page=${perPage}&page=1`;
    const first = await ghFetch(firstUrl, { useEtag: true });

    if (first && first.__notModified){
      const c = loadCache();
      if (c && c.issues){
        state.allIssues = c.issues.map(normalizeIssue);
        applyFilters();
        return;
      }
      // no cache; do a normal fetch
      const retry = await ghFetch(firstUrl, { useEtag: false });
      all = all.concat(retry.filter(x => !x.pull_request));
      page = 2;
    } else {
      all = all.concat(first.filter(x => !x.pull_request));
      page = 2;
    }

    // Remaining pages
    while (true){
      const url = `${apiBase()}/issues?state=all&per_page=${perPage}&page=${page}`;
      const chunk = await ghFetch(url);
      const issuesOnly = chunk.filter(x => !x.pull_request);
      all = all.concat(issuesOnly);

      if (chunk.length < perPage) break;
      page++;
      if (page > 10) break; // safety cap
    }

    // cache raw issues
    saveCache(all);

    state.allIssues = all.map(normalizeIssue);
    applyFilters();
  }catch(err){
    // fallback to cache
    const cached = loadCache();
    if (cached && cached.issues){
      state.allIssues = cached.issues.map(normalizeIssue);
      applyFilters();
      // show warning banner, but keep data visible
      try{
        els.listContainer.insertAdjacentHTML("afterbegin", renderBanner(err.message));
      }catch{
        // ignore if container not ready
      }
      return;
    }

    // no cache -> show full error
    els.listContainer.innerHTML = renderError(err.message);
    els.groupsContainer.innerHTML = "";
    els.statsRow.innerHTML = "";
    els.countPill.textContent = "0";
  }finally{
    els.refreshBtn.textContent = "Refresh";
  }
}

function renderBanner(msg){
  return `
    <div class="item" style="margin:12px; border-color: rgba(255,204,102,.55);">
      <div class="itemName">Using last saved data</div>
      <div class="itemSub">${escapeHtml(msg)}</div>
    </div>
  `;
}

function normalizeIssue(issue){
  const labels = (issue.labels || []).map(l => (typeof l === "string" ? l : l.name)).filter(Boolean);

  const isInventory = labels.includes(cfg.inventoryLabel);
  const isShopping  = labels.includes(cfg.shoppingLabel);

  const parsed = parseIssueBody(issue.body || "");

  // prefer parsed fields; if missing, try to infer from title pattern
  const inferred = inferFromTitle(issue.title || "");

  const designHouse = parsed.design_house || inferred.design_house || "";
  const fragranceName = parsed.fragrance_name || inferred.fragrance_name || "";
  const type = parsed.type || inferred.type || "";
  const ml = toNum(parsed.ml || inferred.ml);

  const pricePaid = toNum(parsed.price_paid);
  const desiredSell = toNum(parsed.desired_sell);
  const desiredBuy  = toNum(parsed.desired_buy);

  const sourceLink = parsed.source_link || "";

  const status = cfg.statusLabels.find(s => labels.includes(s)) || "—";

  // compute metrics
  const pricePerMl = (ml && pricePaid) ? (pricePaid / ml) : null;
  const desiredPerMl = (ml && (desiredSell || desiredBuy)) ? ((desiredSell || desiredBuy) / ml) : null;

  // 10mL sample target price (based on desired per mL)
  const sample10Price = (desiredPerMl && Number.isFinite(desiredPerMl)) ? (desiredPerMl * 10) : null;

  return {
    id: issue.id,
    number: issue.number,
    url: issue.html_url,
    title: issue.title || "",
    updated_at: issue.updated_at,
    state: issue.state, // open/closed

    labels,
    isInventory,
    isShopping,

    designHouse,
    fragranceName,
    type,
    ml,

    pricePaid,
    desiredSell,
    desiredBuy,
    sourceLink,

    status,
    pricePerMl,
    desiredPerMl,
    sample10Price,
  };
}

function inferFromTitle(title){
  // patterns like:
  // [INV] Dior - Sauvage (EDP) 100ml
  // Dior - Sauvage 100ml
  const out = {};
  const t = title.replace(/^\[[^\]]+\]\s*/,"").trim();

  // extract ml
  const mlMatch = t.match(/(\d+(?:\.\d+)?)\s*(ml|mL)\b/);
  if (mlMatch) out.ml = mlMatch[1];

  // extract type (EDP/EDT/Parfum/etc)
  const typeMatch = t.match(/\b(EDP|EDT|Parfum|Extrait|EDC|Cologne)\b/i);
  if (typeMatch) out.type = typeMatch[1].toUpperCase();

  // house - name split
  const parts = t.split(" - ");
  if (parts.length >= 2){
    out.design_house = parts[0].trim();
    out.fragrance_name = parts.slice(1).join(" - ").trim().replace(/\s*\(.*?\)\s*/g,"").trim();
  }
  return out;
}

function parseIssueBody(body){
  // Issue forms render as markdown headings:
  // ### Design House
  // Dior
  const fields = ["design_house","fragrance_name","type","ml","price_paid","desired_sell","desired_buy","source_link"];
  const map = {};
  for (const f of fields){
    const label = toHeadingLabel(f);
    const val = readHeadingValue(body, label);
    if (val) map[f] = val;
  }
  return map;
}

function toHeadingLabel(field){
  switch(field){
    case "design_house": return "Design House";
    case "fragrance_name": return "Fragrance Name";
    case "type": return "Type";
    case "ml": return "Size (mL)";
    case "price_paid": return "Price Paid (USD)";
    case "desired_sell": return "Desired Sell Price (USD)";
    case "desired_buy": return "Desired Purchase Price (USD)";
    case "source_link": return "Source Link (optional)";
    default: return field;
  }
}

function readHeadingValue(markdown, headingText){
  const re = new RegExp(`^###\\s+${escapeRegExp(headingText)}\\s*\\n([\\s\\S]*?)(?=\\n###\\s+|$)`, "m");
  const m = markdown.match(re);
  if (!m) return "";
  let v = (m[1] || "").trim();
  v = v.replace(/\r/g,"");
  v = v.replace(/^_No response_$/i,"").trim();
  return v;
}

function escapeRegExp(s){ return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

function toNum(x){
  if (x === null || x === undefined) return null;
  const s = String(x).trim();
  if (!s) return null;
  const n = Number(s.replace(/[^0-9.]/g,""));
  return Number.isFinite(n) ? n : null;
}

function setTab(tab){
  state.activeTab = tab;
  els.tabInventory.classList.toggle("active", tab === "inventory");
  els.tabShopping.classList.toggle("active", tab === "shopping");
  els.listTitle.textContent = (tab === "inventory") ? "Inventory Items" : "Shopping List";
  applyFilters();
}

function applyFilters(){
  const q = (els.searchInput.value || "").trim().toLowerCase();
  const status = els.statusFilter.value;
  const sort = els.sortSelect.value;

  let items = state.allIssues.filter(it => state.activeTab === "inventory" ? it.isInventory : it.isShopping);

  if (status && status !== "__ALL__"){
    items = items.filter(it => it.labels.includes(status));
  }

  if (q){
    items = items.filter(it => {
      const hay = [
        it.designHouse, it.fragranceName, it.type,
        String(it.ml ?? ""),
        (it.labels || []).join(" "),
      ].join(" ").toLowerCase();
      return hay.includes(q);
    });
  }

  items = sortItems(items, sort);

  state.filtered = items;
  render();
}

function sortItems(items, mode){
  const copy = [...items];
  const by = (fn) => copy.sort((a,b) => fn(a,b));
  switch(mode){
    case "updated_desc":
      return by((a,b) => (b.updated_at || "").localeCompare(a.updated_at || ""));
    case "house_asc":
      return by((a,b) => (a.designHouse||"").localeCompare(b.designHouse||""));
    case "name_asc":
      return by((a,b) => (a.fragranceName||"").localeCompare(b.fragranceName||""));
    case "ppm_asc":
      return by((a,b) => (a.pricePerMl ?? Infinity) - (b.pricePerMl ?? Infinity));
    case "ppm_desc":
      return by((a,b) => (b.pricePerMl ?? -Infinity) - (a.pricePerMl ?? -Infinity));
    default:
      return copy;
  }
}

function money(n){
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return `$${n.toFixed(2)}`;
}
function money4(n){
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return `$${n.toFixed(4)}`;
}
function money2(n){
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return `$${n.toFixed(2)}`;
}

function render(){
  els.countPill.textContent = String(state.filtered.length);

  renderStats();
  renderGroups();

  if (state.viewMode === "cards"){
    els.listContainer.innerHTML = renderCards(state.filtered);
  } else {
    els.listContainer.innerHTML = renderTable(state.filtered);
  }
}

function renderError(msg){
  return `
    <div class="list">
      <div class="item">
        <div class="itemName">Couldn’t load issues</div>
        <div class="itemSub">${escapeHtml(msg)}</div>
        <div class="itemSub">If this repo is private, you’ll need a token in Settings. Public repos may hit rate limits without a token.</div>
      </div>
    </div>
  `;
}

function renderStats(){
  const items = state.filtered;

  const totalMl = sum(items.map(x => x.ml).filter(Boolean));
  let totalPaid = null;
  let totalDesired = null;

  if (state.activeTab === "inventory"){
    const paid = sum(items.map(x => x.pricePaid).filter(Boolean));
    const desired = sum(items.map(x => x.desiredSell).filter(Boolean));
    totalPaid = paid || 0;
    totalDesired = desired || 0;
  } else {
    const desired = sum(items.map(x => x.desiredBuy).filter(Boolean));
    totalDesired = desired || 0;
  }

  const avgPpm = avg(items.map(x => x.pricePerMl).filter(v => Number.isFinite(v)));
  const avgDesiredPpm = avg(items.map(x => x.desiredPerMl).filter(v => Number.isFinite(v)));

  const statusCounts = {};
  for (const it of items){
    const s = cfg.statusLabels.find(lbl => it.labels.includes(lbl)) || "—";
    statusCounts[s] = (statusCounts[s] || 0) + 1;
  }

  const topStatus = Object.entries(statusCounts).sort((a,b)=>b[1]-a[1])[0];

  const stats = [];
  stats.push(statBox("Items", String(items.length)));
  stats.push(statBox("Total mL", totalMl ? `${totalMl.toFixed(0)} mL` : "—"));
  if (state.activeTab === "inventory"){
    stats.push(statBox("Total Paid", money(totalPaid)));
    stats.push(statBox("Total Desired Sell", money(totalDesired)));
  } else {
    stats.push(statBox("Total Desired Buy", money(totalDesired)));
  }
  stats.push(statBox("Avg $/mL", money4(avgPpm)));
  stats.push(statBox("Avg Desired $/mL", money4(avgDesiredPpm)));
  stats.push(statBox("Top Status", topStatus ? `${topStatus[0]} (${topStatus[1]})` : "—"));

  els.statsRow.innerHTML = stats.join("");
}

function statBox(k,v){
  return `<div class="stat"><div class="k">${escapeHtml(k)}</div><div class="v">${escapeHtml(v)}</div></div>`;
}

function renderGroups(){
  const groups = new Map();
  for (const it of state.filtered){
    const key = it.designHouse || "Unknown";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(it);
  }

  const entries = Array.from(groups.entries()).sort((a,b)=>a[0].localeCompare(b[0]));
  const html = entries.map(([house, arr]) => {
    const count = arr.length;
    const ml = sum(arr.map(x => x.ml).filter(Boolean));
    const paid = sum(arr.map(x => x.pricePaid).filter(Boolean));
    const desired = sum(arr.map(x => (state.activeTab==="inventory" ? x.desiredSell : x.desiredBuy)).filter(Boolean));

    const meta = [
      `${count} item${count===1?"":"s"}`,
      ml ? `${ml.toFixed(0)} mL` : null,
      state.activeTab==="inventory"
        ? (paid ? `Paid ${money(paid)}` : null)
        : null,
      desired ? `Desired ${money(desired)}` : null,
    ].filter(Boolean).join(" • ");

    return `
      <div class="group">
        <div class="groupTop">
          <div>
            <div class="groupName">${escapeHtml(house)}</div>
            <div class="groupMeta">${escapeHtml(meta || "—")}</div>
          </div>
          <div class="badge">${escapeHtml(String(count))}</div>
        </div>
      </div>
    `;
  }).join("");

  els.groupsContainer.innerHTML = html || `<div class="muted" style="padding:12px;">No items.</div>`;
}

function renderCards(items){
  if (!items.length) return `<div class="list"><div class="muted">No matches.</div></div>`;

  const html = items.map(it => {
    const isInv = state.activeTab === "inventory";
    const primaryMoney = isInv ? it.pricePaid : it.desiredBuy;
    const desiredMoney = isInv ? it.desiredSell : it.desiredBuy;

    const badges = (it.labels || [])
      .filter(l => l !== cfg.inventoryLabel && l !== cfg.shoppingLabel)
      .slice(0, 8)
      .map(l => badgeForLabel(l))
      .join("");

    const link = it.sourceLink
      ? `<a class="badge" href="${escapeAttr(it.sourceLink)}" target="_blank" rel="noreferrer">Source</a>`
      : "";

    const issueLink = `<a class="badge" href="${escapeAttr(it.url)}" target="_blank" rel="noreferrer">Issue #${it.number}</a>`;

    return `
      <div class="item">
        <div class="itemTop">
          <div>
            <div class="itemName">${escapeHtml(it.designHouse || "Unknown")} — ${escapeHtml(it.fragranceName || it.title)}</div>
            <div class="itemSub">${escapeHtml([it.type, it.ml ? `${it.ml} mL` : null].filter(Boolean).join(" • ") || "—")}</div>
          </div>
          <div class="badges">
            ${badgeForStatus(it.status)}
            ${badges}
            ${link}
            ${issueLink}
          </div>
        </div>

        <div class="kv">
          <div class="box">
            <div class="k">${isInv ? "Price Paid" : "Desired Buy"}</div>
            <div class="v">${money(primaryMoney)}</div>
          </div>

          <div class="box">
            <div class="k">${isInv ? "Desired Sell" : "Desired Buy"}</div>
            <div class="v">${money(desiredMoney)}</div>
          </div>

          <div class="box">
            <div class="k">${isInv ? "Paid $/mL" : "Desired Buy $/mL"}</div>
            <div class="v">${money4(isInv ? it.pricePerMl : it.desiredPerMl)}</div>
          </div>

          <div class="box">
            <div class="k">Target (10mL sample)</div>
            <div class="v">${money2(it.sample10Price)}</div>
          </div>
        </div>
      </div>
    `;
  }).join("");

  return `<div class="list">${html}</div>`;
}

function renderTable(items){
  if (!items.length) return `<div class="tableWrap"><div class="muted">No matches.</div></div>`;

  const isInv = state.activeTab === "inventory";

  const rows = items.map(it => `
    <tr>
      <td>${escapeHtml(it.designHouse || "Unknown")}</td>
      <td>${escapeHtml(it.fragranceName || "")}</td>
      <td>${escapeHtml(it.type || "—")}</td>
      <td>${it.ml ? escapeHtml(String(it.ml)) : "—"}</td>
      <td>${escapeHtml(it.status || "—")}</td>
      <td>${money(isInv ? it.pricePaid : it.desiredBuy)}</td>
      <td>${money(isInv ? it.desiredSell : it.desiredBuy)}</td>
      <td>${money4(isInv ? it.pricePerMl : it.desiredPerMl)}</td>
      <td>${money4(it.desiredPerMl)}</td>
      <td>${money2(it.sample10Price)}</td>
      <td>
        ${it.sourceLink ? `<a href="${escapeAttr(it.sourceLink)}" target="_blank" rel="noreferrer">Source</a>` : "—"}
        &nbsp;|&nbsp;
        <a href="${escapeAttr(it.url)}" target="_blank" rel="noreferrer">Issue</a>
      </td>
    </tr>
  `).join("");

  return `
    <div class="tableWrap">
      <table>
        <thead>
          <tr>
            <th>House</th>
            <th>Name</th>
            <th>Type</th>
            <th>mL</th>
            <th>Status</th>
            <th>${isInv ? "Price Paid" : "Desired Buy"}</th>
            <th>${isInv ? "Desired Sell" : "Desired Buy"}</th>
            <th>${isInv ? "Paid $/mL" : "Desired $/mL"}</th>
            <th>Desired $/mL</th>
            <th>10mL Target</th>
            <th>Links</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}

function badgeForStatus(status){
  const cls =
    status === "In Stock" ? "good" :
    status === "In Transit" ? "warn" :
    status === "Looking For" ? "bad" :
    "";
  return `<span class="badge ${cls}">${escapeHtml(status || "—")}</span>`;
}

function badgeForLabel(label){
  if (cfg.statusLabels.includes(label)) return "";
  return `<span class="badge">${escapeHtml(label)}</span>`;
}

function sum(arr){ return arr.reduce((a,b)=>a+(Number.isFinite(b)?b:0), 0); }
function avg(arr){
  if (!arr.length) return null;
  return sum(arr)/arr.length;
}

function escapeHtml(s){
  return String(s ?? "")
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}

function escapeAttr(s){ return escapeHtml(s).replaceAll("`","&#096;"); }
