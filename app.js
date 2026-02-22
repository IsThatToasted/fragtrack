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
    // IMPORTANT: filename must match your actual template file name
    const template = "inventory.yml";
    const title = encodeURIComponent("[INV] <Design House> - <Name>");
    const labels = encodeURIComponent(`${cfg.inventoryLabel},In Stock`);
    return `${base}?template=${encodeURIComponent(template)}&title=${title}&labels=${labels}`;
  }

  // shopping
  {
    const template = "shopping.yml";
    const title = encodeURIComponent("[SHOP] <Design House> - <Name>");
    const labels = encodeURIComponent(`${cfg.shoppingLabel},Looking For`);
    return `${base}?template=${encodeURIComponent(template)}&title=${title}&labels=${labels}`;
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

async function ghFetch(url){
  const headers = { "Accept": "application/vnd.github+json" };
  const tok = getToken();
  if (tok) headers.Authorization = `token ${tok}`;
  const res = await fetch(url, { headers });
  if (!res.ok){
    const txt = await res.text().catch(()=> "");
    throw new Error(`GitHub API error ${res.status}: ${txt || res.statusText}`);
  }
  return res.json();
}

async function loadAll(){
  // pull issues (open + closed) so you can mark Sold/Closed later if you want
  // we’ll fetch multiple pages
  try{
    els.refreshBtn.textContent = "Refreshing…";
    const perPage = 100;
    let page = 1;
    let all = [];
    while (true){
      const url = `${apiBase()}/issues?state=all&per_page=${perPage}&page=${page}`;
      const chunk = await ghFetch(url);
      // Filter out PRs
      const issuesOnly = chunk.filter(x => !x.pull_request);
      all = all.concat(issuesOnly);
      if (chunk.length < perPage) break;
      page++;
      if (page > 10) break; // safety cap
    }

    state.allIssues = all.map(normalizeIssue);
    applyFilters();
  }catch(err){
    els.listContainer.innerHTML = renderError(err.message);
    els.groupsContainer.innerHTML = "";
    els.statsRow.innerHTML = "";
    els.countPill.textContent = "0";
  }finally{
    els.refreshBtn.textContent = "Refresh";
  }
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
  // Issue forms render as markdown bullets like:
  // ### Design House
  // Dior
  //
  // We'll parse by heading blocks:
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
  // Finds:
  // ### HeadingText
  // value (until next ###)
  const re = new RegExp(`^###\\s+${escapeRegExp(headingText)}\\s*\\n([\\s\\S]*?)(?=\\n###\\s+|$)`, "m");
  const m = markdown.match(re);
  if (!m) return "";
  // clean typical issue form artifacts
  let v = (m[1] || "").trim();
  v = v.replace(/\r/g,"");
  // remove checkbox line if user didn’t edit
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
            <div class="k">${isInv ? "Desired Sell" : "Desired $/mL"}</div>
            <div class="v">${isInv ? money(it.desiredSell) : money4(it.desiredPerMl)}</div>
          </div>
          <div class="box">
            <div class="k">${isInv ? "Paid $/mL" : "Desired Buy $/mL"}</div>
            <div class="v">${money4(it.pricePerMl ?? it.desiredPerMl)}</div>
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
  // keep it neutral; status has its own style
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
