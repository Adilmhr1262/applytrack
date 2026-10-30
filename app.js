"use strict";
/* ApplyTrack: vanilla JS + IndexedDB. All user text is rendered with
   textContent / DOM nodes only, never as markup, so text in a company
   name, title, or note is shown literally and never executed. */

var STATUSES = ["Saved", "Applied", "Screening", "Interview", "Offer", "Rejected", "Withdrawn"];
var CLOSED = ["Rejected", "Withdrawn"];
var DB_NAME = "ApplyTrackDB";
var DB_VERSION = 1;

var state = { apps: [], editingId: null, prefs: loadPrefs() };

function loadPrefs() {
  try {
    var raw = localStorage.getItem("applytrack-prefs");
    if (raw) {
      var p = JSON.parse(raw);
      return {
        defaultStatus: STATUSES.indexOf(p.defaultStatus) >= 0 ? p.defaultStatus : "Applied",
        defaultSort: ["newest", "oldest", "followup"].indexOf(p.defaultSort) >= 0 ? p.defaultSort : "newest"
      };
    }
  } catch (e) { /* fall through to defaults */ }
  return { defaultStatus: "Applied", defaultSort: "newest" };
}
function savePrefs() {
  try { localStorage.setItem("applytrack-prefs", JSON.stringify(state.prefs)); } catch (e) { /* storage unavailable */ }
}

function $(id) { return document.getElementById(id); }
function el(tag, cls, text) {
  var n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined && text !== null) n.textContent = text;
  return n;
}
function todayISO() {
  var d = new Date();
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}
function isValidDate(s) {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  var d = new Date(s + "T00:00:00");
  return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}
function isValidUrl(s) {
  if (!s) return true;
  try { var u = new URL(s); return u.protocol === "http:" || u.protocol === "https:"; }
  catch (e) { return false; }
}
function fmtDate(s) {
  if (!s) return "";
  var d = new Date(s + "T00:00:00");
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}
function showToast(msg) {
  var t = $("toast");
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(showToast._t);
  showToast._t = setTimeout(function () { t.hidden = true; }, 4000);
}

/* ---------- IndexedDB ---------- */
var dbPromise = null;
function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise(function (resolve, reject) {
    var req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = function () {
      var db = req.result;
      if (!db.objectStoreNames.contains("applications")) db.createObjectStore("applications", { keyPath: "id" });
    };
    req.onsuccess = function () { resolve(req.result); };
    req.onerror = function () { reject(req.error); };
  });
  return dbPromise;
}
function tx(store, mode, run) {
  return openDB().then(function (db) {
    return new Promise(function (resolve, reject) {
      var t = db.transaction(store, mode);
      var req = run(t.objectStore(store));
      t.oncomplete = function () { resolve(req.result); };
      t.onerror = function () { reject(t.error); };
    });
  });
}
function getAllApps() { return tx("applications", "readonly", function (s) { return s.getAll(); }); }
function putApp(app) { return tx("applications", "readwrite", function (s) { return s.put(app); }); }
function deleteApp(id) { return tx("applications", "readwrite", function (s) { return s.delete(id); }); }
function clearApps() { return tx("applications", "readwrite", function (s) { return s.clear(); }); }
/* Replace is atomic: clear and all puts run in ONE IndexedDB transaction,
   so if any write fails the transaction aborts and the old data is left
   untouched. Callers only swap in-memory state after this resolves. */
function replaceAllApps(apps) {
  return openDB().then(function (db) {
    return new Promise(function (resolve, reject) {
      var t = db.transaction("applications", "readwrite");
      var s = t.objectStore("applications");
      s.clear();
      apps.forEach(function (a) { s.put(a); });
      t.oncomplete = function () { resolve(); };
      t.onerror = function () { reject(t.error); };
    });
  });
}

/* ---------- Validation ---------- */
function validateRecord(r, partial) {
  var errors = [];
  if (typeof r.company !== "string" || !r.company.trim()) errors.push("Company is required.");
  if (typeof r.title !== "string" || !r.title.trim()) errors.push("Job title is required.");
  if (STATUSES.indexOf(r.status) < 0) errors.push("Status is not one of the allowed values.");
  if (!isValidDate(r.dateApplied)) errors.push("Application date must be a valid date.");
  if (r.followUpDate && !isValidDate(r.followUpDate)) errors.push("Follow-up date must be a valid date.");
  if (!isValidUrl(r.url || "")) errors.push("Job posting URL must start with http:// or https://.");
  ["location", "salary", "notes"].forEach(function (k) {
    if (r[k] !== undefined && r[k] !== null && typeof r[k] !== "string") errors.push(k + " must be text.");
  });
  if (r.history !== undefined) {
    if (!Array.isArray(r.history)) errors.push("History must be a list.");
    else r.history.forEach(function (h) {
      if (!h || STATUSES.indexOf(h.status) < 0 || !h.at) errors.push("A history entry is invalid.");
    });
  }
  return errors;
}

/* ---------- Views ---------- */
function showView(name) {
  document.querySelectorAll(".view").forEach(function (v) { v.hidden = true; v.classList.remove("is-active"); });
  var view = $("view-" + name);
  view.hidden = false;
  view.classList.add("is-active");
  document.querySelectorAll(".nav-btn").forEach(function (b) {
    b.classList.toggle("is-active", b.getAttribute("data-nav") === name);
  });
  var titles = { dashboard: "Dashboard", applications: "Applications", form: "Add application", settings: "Settings" };
  document.title = "ApplyTrack — " + (titles[name] || "Dashboard");
  if (name === "dashboard") renderDashboard();
  if (name === "applications") renderList();
}
function gotoView(name) {
  if (location.hash !== "#" + name) location.hash = name;
  else showView(name);
}
window.addEventListener("hashchange", function () {
  var name = location.hash.replace("#", "");
  if (["dashboard", "applications", "form", "settings"].indexOf(name) >= 0) showView(name);
});
document.querySelectorAll("[data-nav]").forEach(function (b) {
  b.addEventListener("click", function () { gotoView(b.getAttribute("data-nav")); });
});
document.querySelectorAll("[data-goto-form]").forEach(function (b) {
  b.addEventListener("click", function () { openForm(null); gotoView("form"); });
});

/* ---------- Dashboard ---------- */
function renderDashboard() {
  var apps = state.apps;
  var active = apps.filter(function (a) { return CLOSED.indexOf(a.status) < 0; });
  $("stat-total").textContent = String(apps.length);
  $("stat-active").textContent = String(active.length);
  $("stat-interviews").textContent = String(apps.filter(function (a) { return a.status === "Interview"; }).length);
  $("stat-offers").textContent = String(apps.filter(function (a) { return a.status === "Offer"; }).length);

  var today = todayISO();
  var withFollow = active.filter(function (a) { return a.followUpDate; }).sort(function (a, b) {
    return a.followUpDate < b.followUpDate ? -1 : 1;
  });
  var overdue = withFollow.filter(function (a) { return a.followUpDate < today; });
  var upcoming = withFollow.filter(function (a) { return a.followUpDate >= today; });
  var overdueBox = $("followups-overdue"), upcomingBox = $("followups-upcoming");
  overdueBox.replaceChildren(); upcomingBox.replaceChildren();
  $("followups-empty").hidden = withFollow.length > 0;
  if (overdue.length) {
    overdueBox.appendChild(el("h3", null, "Overdue (" + overdue.length + ")"));
    overdue.forEach(function (a) { overdueBox.appendChild(followupRow(a, true)); });
  }
  if (upcoming.length) {
    upcomingBox.appendChild(el("h3", null, "Upcoming"));
    upcoming.slice(0, 10).forEach(function (a) { upcomingBox.appendChild(followupRow(a, false)); });
  }

  var events = [];
  apps.forEach(function (a) {
    (a.history || []).forEach(function (h) {
      events.push({ app: a, at: h.at, status: h.status, kind: h.kind || "changed" });
    });
  });
  events.sort(function (a, b) { return b.at < a.at ? -1 : (b.at > a.at ? 1 : 0); });
  var list = $("activity-list");
  list.replaceChildren();
  $("activity-empty").hidden = events.length > 0;
  events.slice(0, 8).forEach(function (e) {
    var li = el("li");
    var verb = e.kind === "created" ? "Added as " : "Moved to ";
    li.appendChild(el("span", null, e.app.company + " — " + e.app.title + ": " + verb + e.status));
    li.appendChild(el("span", "meta", fmtDate(e.at.slice(0, 10))));
    list.appendChild(li);
  });

  var pipe = $("pipeline-list");
  pipe.replaceChildren();
  STATUSES.forEach(function (s) {
    var li = el("li");
    li.appendChild(el("span", null, s));
    li.appendChild(el("strong", null, String(apps.filter(function (a) { return a.status === s; }).length)));
    pipe.appendChild(li);
  });
}
function followupRow(a, isOverdue) {
  /* A real button, not a clickable div, so keyboard users can activate
     it with Enter or Space like any other control. */
  var row = el("button", "followup-item");
  row.type = "button";
  row.setAttribute("aria-label", "Edit application: " + a.title + " at " + a.company);
  var left = el("span");
  left.appendChild(el("span", null, a.company + " — " + a.title));
  left.appendChild(el("span", "sub", "Status: " + a.status));
  var due = el("span", "due" + (isOverdue ? " overdue" : " soon"), (isOverdue ? "Overdue: " : "") + fmtDate(a.followUpDate));
  row.appendChild(left); row.appendChild(due);
  row.addEventListener("click", function () { openForm(a.id); gotoView("form"); });
  return row;
}

/* ---------- Applications list ---------- */
function filteredApps() {
  var q = $("search-input").value.trim().toLowerCase();
  var status = $("filter-status").value;
  var sort = $("sort-select").value;
  var list = state.apps.filter(function (a) {
    if (status !== "all" && a.status !== status) return false;
    if (q && (a.company + " " + a.title).toLowerCase().indexOf(q) < 0) return false;
    return true;
  });
  if (sort === "newest") list.sort(function (a, b) { return (b.dateApplied + b.createdAt) < (a.dateApplied + a.createdAt) ? -1 : 1; });
  if (sort === "oldest") list.sort(function (a, b) { return (a.dateApplied + a.createdAt) < (b.dateApplied + b.createdAt) ? -1 : 1; });
  if (sort === "followup") list.sort(function (a, b) {
    if (!a.followUpDate && !b.followUpDate) return 0;
    if (!a.followUpDate) return 1;
    if (!b.followUpDate) return -1;
    return a.followUpDate < b.followUpDate ? -1 : 1;
  });
  return list;
}
function renderList() {
  var list = filteredApps();
  var box = $("app-list");
  box.replaceChildren();
  $("apps-empty").hidden = list.length > 0;
  $("result-count").textContent = list.length + " of " + state.apps.length + " applications shown.";
  list.forEach(function (a) {
    var card = el("article", "card app-card");
    var top = el("div", "app-top");
    var head = el("div");
    head.appendChild(el("h3", null, a.title));
    head.appendChild(el("div", "company", a.company));
    var badge = el("span", "badge " + a.status, a.status);
    top.appendChild(head); top.appendChild(badge);
    card.appendChild(top);

    var meta = el("div", "app-meta");
    if (a.location) meta.appendChild(el("span", null, a.location));
    meta.appendChild(el("span", null, "Applied " + fmtDate(a.dateApplied)));
    if (a.followUpDate) meta.appendChild(el("span", null, "Follow-up " + fmtDate(a.followUpDate)));
    if (a.salary) meta.appendChild(el("span", null, "Salary: " + a.salary));
    if (a.url) {
      var link = el("a", null, "Open job listing");
      link.href = a.url; link.target = "_blank"; link.rel = "noopener noreferrer";
      meta.appendChild(link);
    }
    card.appendChild(meta);
    if (a.notes) card.appendChild(el("p", "notes", a.notes));

    var actions = el("div", "app-actions");
    var statusWrap = el("label", "inline-status", "Status: ");
    var sel = el("select");
    STATUSES.forEach(function (s) {
      var opt = el("option", null, s); opt.value = s; if (s === a.status) opt.selected = true; sel.appendChild(opt);
    });
    sel.setAttribute("aria-label", "Change status for " + a.title + " at " + a.company);
    sel.addEventListener("change", function () { changeStatus(a.id, sel.value); });
    statusWrap.appendChild(sel);
    actions.appendChild(statusWrap);

    var editBtn = el("button", "btn", "Edit"); editBtn.type = "button";
    editBtn.addEventListener("click", function () { openForm(a.id); gotoView("form"); });
    var dupBtn = el("button", "btn", "Duplicate"); dupBtn.type = "button";
    dupBtn.addEventListener("click", function () { duplicateApp(a); });
    var delBtn = el("button", "btn btn-danger", "Delete"); delBtn.type = "button";
    delBtn.addEventListener("click", function () { removeApp(a); });
    actions.appendChild(editBtn); actions.appendChild(dupBtn); actions.appendChild(delBtn);
    card.appendChild(actions);
    box.appendChild(card);
  });
}
function changeStatus(id, next) {
  var app = state.apps.find(function (a) { return a.id === id; });
  if (!app || app.status === next) return;
  app.status = next;
  app.history.push({ status: next, at: new Date().toISOString(), kind: "changed" });
  putApp(app).then(refresh).then(function () { showToast("Status updated to " + next + "."); });
}
function duplicateApp(a) {
  var copy = JSON.parse(JSON.stringify(a));
  copy.id = "app-" + Date.now() + "-" + Math.floor(Math.random() * 100000);
  copy.createdAt = new Date().toISOString();
  copy.history = [{ status: copy.status, at: copy.createdAt, kind: "created" }];
  state.apps.push(copy);
  putApp(copy).then(refresh).then(function () { showToast("Application duplicated."); renderList(); });
}
function removeApp(a) {
  if (!window.confirm("Delete the application for " + a.title + " at " + a.company + "? This cannot be undone.")) return;
  state.apps = state.apps.filter(function (x) { return x.id !== a.id; });
  deleteApp(a.id).then(refresh).then(function () { showToast("Application deleted."); });
}

/* ---------- Form ---------- */
function openForm(id) {
  state.editingId = id || null;
  var form = $("app-form");
  form.reset();
  $("field-id").value = id || "";
  $("history-card").hidden = true;
  ["company", "title", "url", "date", "followup"].forEach(function (k) { $("error-" + k).hidden = true; });
  $("form-error").hidden = true;
  if (id) {
    var a = state.apps.find(function (x) { return x.id === id; });
    if (!a) return;
    $("form-heading").textContent = "Edit application";
    $("save-btn").textContent = "Save changes";
    $("field-company").value = a.company;
    $("field-title").value = a.title;
    $("field-location").value = a.location || "";
    $("field-url").value = a.url || "";
    $("field-date").value = a.dateApplied;
    $("field-followup").value = a.followUpDate || "";
    $("field-status").value = a.status;
    $("field-salary").value = a.salary || "";
    $("field-notes").value = a.notes || "";
    var hist = $("history-list");
    hist.replaceChildren();
    (a.history || []).slice().reverse().forEach(function (h) {
      var li = el("li");
      li.appendChild(el("span", null, (h.kind === "created" ? "Added as " : "Moved to ") + h.status));
      li.appendChild(el("span", "meta", fmtDate(h.at.slice(0, 10))));
      hist.appendChild(li);
    });
    $("history-card").hidden = false;
  } else {
    $("form-heading").textContent = "Add application";
    $("save-btn").textContent = "Save application";
    $("field-date").value = todayISO();
    $("field-status").value = state.prefs.defaultStatus;
  }
}
$("app-form").addEventListener("submit", function (e) {
  e.preventDefault();
  var now = new Date().toISOString();
  var rec = {
    company: $("field-company").value.trim(),
    title: $("field-title").value.trim(),
    location: $("field-location").value.trim(),
    url: $("field-url").value.trim(),
    dateApplied: $("field-date").value,
    followUpDate: $("field-followup").value || "",
    status: $("field-status").value,
    salary: $("field-salary").value.trim(),
    notes: $("field-notes").value.trim()
  };
  var errors = validateRecord(rec);
  $("error-company").hidden = !!rec.company;
  $("error-title").hidden = !!rec.title;
  $("error-url").hidden = isValidUrl(rec.url);
  $("error-date").hidden = isValidDate(rec.dateApplied);
  $("error-followup").hidden = !rec.followUpDate || isValidDate(rec.followUpDate);
  if (errors.length) {
    var fe = $("form-error");
    fe.textContent = errors.join(" ");
    fe.hidden = false;
    return;
  }
  $("form-error").hidden = true;
  if (state.editingId) {
    var app = state.apps.find(function (x) { return x.id === state.editingId; });
    if (!app) return;
    var changed = app.status !== rec.status;
    Object.assign(app, rec);
    if (changed) app.history.push({ status: rec.status, at: now, kind: "changed" });
    putApp(app).then(refresh).then(function () {
      showToast("Application updated.");
      gotoView("applications");
    });
  } else {
    var fresh = Object.assign({}, rec, {
      id: "app-" + Date.now() + "-" + Math.floor(Math.random() * 100000),
      createdAt: now,
      history: [{ status: rec.status, at: now, kind: "created" }]
    });
    state.apps.push(fresh);
    putApp(fresh).then(refresh).then(function () {
      showToast("Application saved.");
      gotoView("applications");
    });
  }
});
$("cancel-btn").addEventListener("click", function () { gotoView("applications"); });

/* ---------- Filters, prefs, backup ---------- */
$("search-input").addEventListener("input", renderList);
$("filter-status").addEventListener("change", renderList);
$("sort-select").addEventListener("change", renderList);

$("export-btn").addEventListener("click", function () {
  var payload = { app: "ApplyTrack", version: 1, exportedAt: new Date().toISOString(), applications: state.apps };
  var blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  var a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "applytrack-backup.json";
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  showToast("Backup exported.");
});
$("import-file").addEventListener("change", function (e) {
  var file = e.target.files[0];
  if (!file) return;
  var errBox = $("import-error"), okBox = $("import-success");
  errBox.hidden = true; okBox.hidden = true;
  var reader = new FileReader();
  reader.onload = function () {
    try {
      var data = JSON.parse(reader.result);
      if (!data || !Array.isArray(data.applications)) throw new Error("The file must contain an applications list.");
      if (data.version !== 1) throw new Error("Unsupported backup version. Only version 1 backups can be imported.");
      if (data.app !== "ApplyTrack") throw new Error("This is not an ApplyTrack backup.");
      var seen = {};
      data.applications.forEach(function (r) {
        if (!r || typeof r.id !== "string" || !r.id) throw new Error("An application is missing an id.");
        if (seen[r.id]) throw new Error("Two applications share the same id.");
        seen[r.id] = true;
        var errs = validateRecord(r);
        if (errs.length) throw new Error(errs.join(" "));
        if (typeof r.createdAt !== "string" || isNaN(Date.parse(r.createdAt))) throw new Error("An application is missing a valid created date.");
        if (!Array.isArray(r.history) || r.history.length === 0) throw new Error("An application is missing its status history.");
        r.history.forEach(function (h) {
          if (!h || typeof h.at !== "string" || isNaN(Date.parse(h.at))) throw new Error("A history entry has an invalid date.");
          if (h.kind !== "created" && h.kind !== "changed") throw new Error("A history entry must have kind created or changed.");
        });
      });
      /* Validation passed for every record: only now replace the data. */
      replaceAllApps(data.applications).then(function () {
        state.apps = data.applications;
        refresh().then(function () {
          okBox.textContent = "Imported " + data.applications.length + " applications. Your previous data was replaced.";
          okBox.hidden = false;
          showToast("Backup imported.");
          gotoView("settings");
        });
      }).catch(function (err) {
        /* The single-transaction replace failed, so old data is intact.
           Say so plainly instead of leaving the user with no feedback. */
        errBox.textContent = "Import failed and your existing data was not changed. " + (err && err.message ? err.message : "The database write did not complete.");
        errBox.hidden = false;
      });
    } catch (err) {
      errBox.textContent = "Import failed. Nothing was changed. " + err.message;
      errBox.hidden = false;
    }
    e.target.value = "";
  };
  reader.readAsText(file);
});
$("save-prefs-btn").addEventListener("click", function () {
  state.prefs.defaultStatus = $("pref-default-status").value;
  state.prefs.defaultSort = $("pref-default-sort").value;
  savePrefs();
  $("sort-select").value = state.prefs.defaultSort;
  showToast("Preferences saved.");
});
$("clear-btn").addEventListener("click", function () {
  if (!window.confirm("Delete ALL applications and preferences? This cannot be undone.")) return;
  clearApps().then(function () {
    try { localStorage.removeItem("applytrack-prefs"); } catch (e) {}
    state.apps = [];
    state.prefs = loadPrefs();
    $("pref-default-status").value = state.prefs.defaultStatus;
    $("pref-default-sort").value = state.prefs.defaultSort;
    $("sort-select").value = state.prefs.defaultSort;
    return refresh();
  }).then(function () { showToast("All data deleted."); gotoView("dashboard"); });
});

/* ---------- Boot ---------- */
function refresh() {
  return getAllApps().then(function (apps) {
    state.apps = apps.sort(function (a, b) { return (b.dateApplied + b.createdAt) < (a.dateApplied + a.createdAt) ? -1 : 1; });
    var current = location.hash.replace("#", "");
    if (current === "applications") renderList();
    else renderDashboard();
  });
}
function init() {
  $("pref-default-status").value = state.prefs.defaultStatus;
  $("pref-default-sort").value = state.prefs.defaultSort;
  $("sort-select").value = state.prefs.defaultSort;
  var start = location.hash.replace("#", "");
  if (["dashboard", "applications", "form", "settings"].indexOf(start) < 0) start = "dashboard";
  refresh().then(function () { showView(start); });
  if (start === "form") openForm(null);
}
init();
