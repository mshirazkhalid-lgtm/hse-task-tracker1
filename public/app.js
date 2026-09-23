(function () {
  "use strict";

  var STATUS_META = {
    overdue: { label: "Overdue" }, at_risk: { label: "Due soon" }, delayed_start: { label: "Delayed start" },
    in_progress: { label: "In progress" }, upcoming: { label: "Upcoming" }, completed: { label: "Completed" }
  };
  var TILE_ORDER = ["overdue", "at_risk", "delayed_start", "in_progress", "completed"];
  var TILE_LABEL = { overdue: "Overdue", at_risk: "Due soon", delayed_start: "Delayed start", in_progress: "In progress", completed: "Completed" };
  var STATUS_RANK = { overdue: 0, at_risk: 1, delayed_start: 2, in_progress: 3, upcoming: 4, completed: 5 };
  var POLL_MS = 25000;

  var state = {
    me: null, tasks: [], officers: [],
    activeTile: "", search: "", entity: "", officer: "",
    sortKey: "status", sortDir: "asc",
    editingId: null
  };

  function $(id) { return document.getElementById(id); }
  function esc(s) { return (s == null ? "" : String(s)).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function fmtDate(s) {
    if (!s) return "—";
    var d = new Date(s); if (isNaN(d.getTime())) return "—";
    var months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    return d.getUTCDate() + " " + months[d.getUTCMonth()] + " " + d.getUTCFullYear();
  }
  function toDateInput(s) { return s ? String(s).slice(0, 10) : ""; }

  async function api(path, opts) {
    opts = opts || {};
    opts.headers = Object.assign({ "Content-Type": "application/json" }, opts.headers || {});
    var res = await fetch(path, opts);
    if (res.status === 401) { showView("login"); throw new Error("not_signed_in"); }
    if (!res.ok) {
      var body = {}; try { body = await res.json(); } catch (e) {}
      throw new Error(body.error || ("request_failed_" + res.status));
    }
    var ct = res.headers.get("content-type") || "";
    return ct.indexOf("application/json") !== -1 ? res.json() : res.text();
  }

  function showView(name) {
    ["loginView", "pendingView", "deniedView", "appView"].forEach(function (id) { $(id).hidden = true; });
    if (name === "login") $("loginView").hidden = false;
    if (name === "pending") $("pendingView").hidden = false;
    if (name === "denied") $("deniedView").hidden = false;
    if (name === "app") $("appView").hidden = false;
  }

  // ---------- rendering ----------
  function distinctValues(field) {
    var seen = {}, out = [];
    state.tasks.forEach(function (t) { var v = (t[field] || "").trim(); if (v && !seen[v]) { seen[v] = 1; out.push(v); } });
    out.sort();
    return out;
  }
  function fillSelect(sel, values, placeholder, current) {
    var html = '<option value="">' + placeholder + "</option>";
    values.forEach(function (v) { html += '<option value="' + esc(v) + '"' + (v === current ? " selected" : "") + ">" + esc(v) + "</option>"; });
    sel.innerHTML = html;
  }
  function fillDatalist(dl, values) {
    var seen = {}, html = "";
    values.forEach(function (v) { if (!seen[v]) { seen[v] = 1; html += '<option value="' + esc(v) + '">'; } });
    dl.innerHTML = html;
  }
  function refreshFilterOptions() {
    fillSelect($("entityFilter"), distinctValues("entity"), "All entities", state.entity);
    fillDatalist($("entityList"), distinctValues("entity"));
    if (state.me.role === "manager") {
      var opts = ['<option value="">Everyone</option>', '<option value="me"' + (state.officer === "me" ? " selected" : "") + ">My own list</option>"];
      state.officers.forEach(function (o) {
        opts.push('<option value="' + o.id + '"' + (String(state.officer) === String(o.id) ? " selected" : "") + ">" + esc(o.name) + "</option>");
      });
      $("officerFilter").innerHTML = opts.join("");
      $("officerFilter").hidden = false;
    }
  }

  function filteredTasksIgnoringTile() {
    var saved = state.activeTile; state.activeTile = "";
    var list = filteredTasks();
    state.activeTile = saved;
    return list;
  }
  function filteredTasks() {
    var q = state.search.trim().toLowerCase();
    return state.tasks.filter(function (t) {
      if (state.activeTile && t.status !== state.activeTile) return false;
      if (state.entity && t.entity !== state.entity) return false;
      if (state.officer === "me" && t.ownerUserId !== state.me.id) return false;
      else if (state.officer && state.officer !== "me" && String(t.ownerUserId) !== String(state.officer)) return false;
      if (q) {
        var hay = [t.description, t.entity, t.ownerName, t.remarks].join(" ").toLowerCase();
        if (hay.indexOf(q) === -1) return false;
      }
      return true;
    });
  }
  function sortTasks(list) {
    var key = state.sortKey, dir = state.sortDir === "desc" ? -1 : 1;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === "status") { av = STATUS_RANK[a.status]; bv = STATUS_RANK[b.status]; }
      else { av = a[key]; bv = b[key]; }
      if (av == null) av = ""; if (bv == null) bv = "";
      if (av < bv) return -1 * dir; if (av > bv) return 1 * dir;
      return (a.sn || 0) - (b.sn || 0);
    });
  }

  function renderStats() {
    var counts = { overdue: 0, at_risk: 0, delayed_start: 0, in_progress: 0, completed: 0 };
    filteredTasksIgnoringTile().forEach(function (t) { if (counts.hasOwnProperty(t.status)) counts[t.status]++; });
    var html = "";
    TILE_ORDER.forEach(function (k) {
      html += '<button class="tile' + (state.activeTile === k ? " active" : "") + '" data-k="' + k + '">' +
        '<div class="tile-n mono">' + counts[k] + '</div><div class="tile-l">' + TILE_LABEL[k] + "</div></button>";
    });
    $("stats").innerHTML = html;
    Array.prototype.forEach.call($("stats").querySelectorAll(".tile"), function (el) {
      el.addEventListener("click", function () {
        var k = el.getAttribute("data-k");
        state.activeTile = state.activeTile === k ? "" : k;
        renderTable();
      });
    });
  }

  function renderTable() {
    renderStats();
    var list = sortTasks(filteredTasks());
    var isManager = state.me.role === "manager";
    Array.prototype.forEach.call(document.querySelectorAll(".officer-col"), function (el) { el.hidden = !isManager; });
    var tbody = $("tbody");
    if (list.length === 0) {
      tbody.innerHTML = ""; $("emptyState").hidden = false; renderPrintReport(list); return;
    }
    $("emptyState").hidden = true;
    var html = "";
    list.forEach(function (t) {
      var pct = Math.max(0, Math.min(100, Number(t.completionPct) || 0));
      var dueLabel = t.dueDate ? fmtDate(t.dueDate) : "—";
      if (t.dueDate && t.status === "overdue") {
        var lateDays = Math.round((Date.now() - new Date(t.dueDate).getTime()) / 86400000);
        dueLabel = fmtDate(t.dueDate) + ' <span class="muted">(' + lateDays + "d late)</span>";
      }
      html += '<tr data-id="' + t.id + '">' +
        '<td data-label="SN" class="mono muted">' + (t.sn != null ? t.sn : "—") + "</td>" +
        '<td data-label="Task"><div class="task-desc">' + esc(t.description || "(untitled task)") + "</div></td>" +
        '<td data-label="Entity">' + esc(t.entity || "—") + "</td>" +
        (isManager ? '<td data-label="Officer" class="officer-col">' + esc(t.ownerName || "") + "</td>" : "") +
        '<td data-label="Planned start" class="mono">' + fmtDate(t.plannedStart) + "</td>" +
        '<td data-label="Due" class="mono">' + dueLabel + "</td>" +
        '<td data-label="Progress"><div class="prog-wrap"><div class="prog-bar"><div class="prog-fill" style="width:' + pct + '%"></div></div><span class="prog-pct mono">' + pct + "%</span></div></td>" +
        '<td data-label="Status"><span class="badge ' + t.status + '">' + STATUS_META[t.status].label + "</span></td></tr>";
    });
    tbody.innerHTML = html;
    Array.prototype.forEach.call(tbody.querySelectorAll("tr"), function (tr) {
      tr.addEventListener("click", function () { openForm(tr.getAttribute("data-id")); });
    });
    renderPrintReport(list);
    refreshFilterOptions();
  }

  function renderPrintReport(list) {
    var counts = { overdue: 0, at_risk: 0, delayed_start: 0, completed: 0 };
    list.forEach(function (t) { if (counts.hasOwnProperty(t.status)) counts[t.status]++; });
    $("prTitle").textContent = state.me.role === "manager" ? "HSE Task Tracker — Team Report" : "HSE Task Tracker — My Tasks";
    $("prMeta").textContent = "Generated " + new Date().toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" }) + (state.me.role === "manager" ? " · " + state.me.name : "");
    $("prStats").innerHTML = '<div><b>' + counts.overdue + '</b>Overdue</div><div><b>' + counts.at_risk + '</b>Due soon</div>' +
      '<div><b>' + counts.delayed_start + '</b>Delayed start</div><div><b>' + counts.completed + '</b>Completed</div><div><b>' + list.length + '</b>Total shown</div>';
    var rows = "";
    list.forEach(function (t) {
      rows += "<tr><td>" + esc(t.sn != null ? t.sn : "") + "</td><td>" + esc(t.description) + "</td><td>" + esc(t.entity) + "</td><td>" +
        esc(state.me.role === "manager" ? t.ownerName : "") + "</td><td>" + esc(fmtDate(t.plannedStart)) + "</td><td>" + esc(fmtDate(t.dueDate)) + "</td><td>" +
        (Math.round(Number(t.completionPct) || 0)) + "%</td><td>" + esc(STATUS_META[t.status].label) + "</td><td>" + esc(t.remarks) + "</td></tr>";
    });
    $("prBody").innerHTML = rows;
  }

  // ---------- form panel ----------
  var scrim = $("scrim"), panel = $("formPanel");
  function openPanel() { scrim.classList.add("open"); panel.classList.add("open"); }
  function closePanel() { scrim.classList.remove("open"); panel.classList.remove("open"); state.editingId = null; }
  scrim.addEventListener("click", closePanel);
  $("formClose").addEventListener("click", closePanel);
  $("formCancel").addEventListener("click", closePanel);
  $("f_completion").addEventListener("input", function () { $("f_completionLabel").textContent = this.value + "%"; });

  function fillAssigneeSelect(currentOwnerId) {
    var sel = $("f_assignee");
    var html = '<option value="">Keep on my own list</option>';
    state.officers.forEach(function (o) {
      html += '<option value="' + o.id + '"' + (String(currentOwnerId) === String(o.id) ? " selected" : "") + ">" + esc(o.name) + "</option>";
    });
    sel.innerHTML = html;
  }

  async function openForm(id) {
    var isNew = !id;
    var t = isNew ? null : state.tasks.find(function (x) { return String(x.id) === String(id); });
    state.editingId = isNew ? null : id;
    $("formTitle").textContent = t ? "Edit task #" + (t.sn != null ? t.sn : "") : "New task";
    $("f_description").value = t ? (t.description || "") : "";
    $("f_entity").value = t ? (t.entity || "") : "";
    $("f_plannedStart").value = t ? toDateInput(t.plannedStart) : "";
    $("f_dueDate").value = t ? toDateInput(t.dueDate) : "";
    $("f_actualStart").value = t ? toDateInput(t.actualStart) : "";
    $("f_actualEnd").value = t ? toDateInput(t.actualEnd) : "";
    $("f_completion").value = t ? (Number(t.completionPct) || 0) : 0;
    $("f_completionLabel").textContent = $("f_completion").value + "%";
    $("f_remarks").value = t ? (t.remarks || "") : "";

    $("assigneeField").hidden = state.me.role !== "manager";
    if (state.me.role === "manager") fillAssigneeSelect(t ? t.ownerUserId : "");

    var hBlock = $("historyBlock"), hList = $("historyList");
    if (t) {
      hBlock.hidden = false;
      hList.innerHTML = '<div class="muted" style="font-size:12.5px;">Loading…</div>';
      try {
        var hist = await api("/api/tasks/" + t.id + "/history");
        if (!hist.length) hList.innerHTML = '<div class="muted" style="font-size:12.5px;">No changes recorded yet.</div>';
        else {
          hList.innerHTML = hist.map(function (h) {
            var changesTxt = (h.changes || []).map(function (c) { return c.field; }).join(", ") || "created";
            return '<div class="history-item"><div>' + esc(h.by_name || "someone") + " updated <b>" + esc(changesTxt) + "</b></div>" +
              '<div class="history-when mono">' + new Date(h.at).toLocaleString() + "</div></div>";
          }).join("");
        }
      } catch (e) { hList.innerHTML = ""; }
    } else {
      hBlock.hidden = true;
    }
    openPanel();
  }
  $("newTaskBtn").addEventListener("click", function () { openForm(null); });

  function readForm() {
    return {
      description: $("f_description").value.trim(),
      entity: $("f_entity").value.trim(),
      plannedStart: $("f_plannedStart").value || null,
      dueDate: $("f_dueDate").value || null,
      actualStart: $("f_actualStart").value || null,
      actualEnd: $("f_actualEnd").value || null,
      completionPct: Number($("f_completion").value) || 0,
      remarks: $("f_remarks").value.trim(),
      assigneeUserId: state.me.role === "manager" ? ($("f_assignee").value || null) : undefined
    };
  }

  $("formSave").addEventListener("click", async function () {
    var data = readForm();
    if (!data.description) { $("f_description").focus(); return; }
    var btn = $("formSave"); btn.disabled = true; btn.textContent = "Saving…";
    try {
      if (state.editingId) await api("/api/tasks/" + state.editingId, { method: "PUT", body: JSON.stringify(data) });
      else await api("/api/tasks", { method: "POST", body: JSON.stringify(data) });
      closePanel();
      await loadTasks();
    } catch (e) {
      alert("Couldn't save: " + e.message);
    } finally {
      btn.disabled = false; btn.textContent = "Save task";
    }
  });

  // ---------- admin pending panel ----------
  var adminScrim = $("adminScrim"), adminPanel = $("adminPanel");
  function openAdmin() { adminScrim.classList.add("open"); adminPanel.classList.add("open"); loadPending(); }
  function closeAdmin() { adminScrim.classList.remove("open"); adminPanel.classList.remove("open"); }
  adminScrim.addEventListener("click", closeAdmin);
  $("adminClose").addEventListener("click", closeAdmin);
  $("adminPendingBtn").addEventListener("click", openAdmin);

  async function loadPending() {
    var list = await api("/api/admin/pending");
    var body = $("adminBody");
    if (!list.length) { body.innerHTML = '<p class="muted" id="adminEmpty">No pending requests.</p>'; updatePendingBadge(0); return; }
    updatePendingBadge(list.length);
    body.innerHTML = list.map(function (u) {
      return '<div class="pending-row" data-id="' + u.id + '"><div><b>' + esc(u.name) + '</b><br/><span class="muted" style="font-size:12px;">' + esc(u.email) + '</span></div>' +
        '<div style="display:flex; gap:6px;"><button class="btn btn-primary btn-sm" data-act="approve">Approve</button><button class="btn btn-ghost btn-sm" data-act="deny">Deny</button></div></div>';
    }).join("");
    Array.prototype.forEach.call(body.querySelectorAll("[data-act]"), function (b) {
      b.addEventListener("click", async function () {
        var row = b.closest(".pending-row");
        await api("/api/admin/pending/" + row.getAttribute("data-id") + "/" + b.getAttribute("data-act"), { method: "POST" });
        loadPending();
      });
    });
  }
  function updatePendingBadge(n) {
    var btn = $("adminPendingBtn");
    btn.textContent = n > 0 ? "Pending requests (" + n + ")" : "Pending requests";
    btn.classList.toggle("btn-primary", n > 0);
    btn.classList.toggle("btn-ghost", n === 0);
  }

  // ---------- toolbar ----------
  $("search").addEventListener("input", function () { state.search = this.value; renderTable(); });
  $("entityFilter").addEventListener("change", function () { state.entity = this.value; renderTable(); });
  $("officerFilter").addEventListener("change", function () { state.officer = this.value; renderTable(); });
  Array.prototype.forEach.call(document.querySelectorAll("thead th[data-sort]"), function (th) {
    th.addEventListener("click", function () {
      var k = th.getAttribute("data-sort");
      if (state.sortKey === k) state.sortDir = state.sortDir === "asc" ? "desc" : "asc"; else { state.sortKey = k; state.sortDir = "asc"; }
      renderTable();
    });
  });
  $("exportCsvBtn").addEventListener("click", function () { window.location = "/api/export.csv"; });
  $("exportPdfBtn").addEventListener("click", function () { renderPrintReport(sortTasks(filteredTasks())); window.print(); });

  // ---------- push alerts ----------
  function urlBase64ToUint8Array(base64String) {
    var padding = "=".repeat((4 - (base64String.length % 4)) % 4);
    var base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
    var raw = atob(base64), out = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; ++i) out[i] = raw.charCodeAt(i);
    return out;
  }
  async function updateAlertsBtn() {
    var btn = $("alertsBtn");
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) { btn.hidden = true; return; }
    try {
      var reg = await navigator.serviceWorker.ready;
      var sub = await reg.pushManager.getSubscription();
      var on = !!sub;
      btn.textContent = on ? "🔔 Alerts on" : "🔔 Enable alerts";
      btn.classList.toggle("btn-primary", on);
      btn.classList.toggle("btn-ghost", !on);
    } catch (e) {}
  }
  $("alertsBtn").addEventListener("click", async function () {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) return;
    try {
      var reg = await navigator.serviceWorker.ready;
      var existing = await reg.pushManager.getSubscription();
      if (existing) {
        await api("/api/push/unsubscribe", { method: "POST", body: JSON.stringify({ endpoint: existing.endpoint }) });
        await existing.unsubscribe();
        updateAlertsBtn();
        return;
      }
      var keyRes = await api("/api/push/public-key");
      if (!keyRes.key) { alert("Push notifications aren't configured on the server yet (missing VAPID keys)."); return; }
      var sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(keyRes.key) });
      await api("/api/push/subscribe", { method: "POST", body: JSON.stringify(sub.toJSON()) });
      updateAlertsBtn();
    } catch (e) {
      if (Notification.permission === "denied") alert("Notifications are blocked for this site in your browser settings.");
      console.warn("push subscribe failed", e);
    }
  });

  // ---------- boot ----------
  async function loadTasks() {
    state.tasks = await api("/api/tasks");
    renderTable();
  }

  var pollTimer = null;
  function startPolling() {
    if (pollTimer) return;
    pollTimer = setInterval(function () { loadTasks().catch(function () {}); }, POLL_MS);
  }

  async function boot() {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(function () {});
    }
    var me;
    try { me = await api("/api/me"); } catch (e) { showView("login"); return; }
    state.me = me;
    if (me.status === "pending") { $("pendingName").textContent = me.name; showView("pending"); return; }
    if (me.status === "denied") { showView("denied"); return; }

    showView("app");
    $("viewerName").textContent = me.name;
    $("viewerRole").textContent = me.role === "manager" ? "Manager" : "HSE Officer";
    $("viewerRole").className = "role-pill " + (me.role === "manager" ? "manager" : "officer");
    $("brandSub").textContent = me.role === "manager" ? "Team overview — everyone's tasks" : "Your tasks — assigned by your HSE manager";
    $("officerFilter").hidden = me.role !== "manager";
    $("adminPendingBtn").hidden = me.role !== "manager";

    if (me.role === "manager") {
      $("topNoticeText").textContent = "You're viewing the full team. HSE officers only ever see their own list — never yours or each other's.";
      $("topNotice").hidden = false;
      state.officers = await api("/api/officers");
      loadPending().catch(function () {});
    } else {
      $("topNoticeText").textContent = "This is your own task list. Your HSE manager can see it and assign new tasks here.";
      $("topNotice").hidden = false;
    }

    await loadTasks();
    updateAlertsBtn();
    startPolling();
  }

  boot();
})();
