(function () {
  "use strict";

  var API_KEY = "AIzaSyAArMRCMQ3x96mrbR_G4kqfellbSoqlG6Q";
  var CHANNEL_ID = "UCwX-QozeDV2M6tJfAtE-B6w";
  var UPLOADS_PLAYLIST = "UUwX-QozeDV2M6tJfAtE-B6w";

  var channel = null;
  var videos = [];
  var categoriesMap = {};
  var charts = {};

  var STOPWORDS = new Set([
    "the","a","an","and","or","of","in","on","at","to","for","is","are","was","were","be","been","being",
    "with","by","from","as","it","its","this","that","these","those","your","you","i","we","they","he","she",
    "all","so","but","if","do","does","did","not","no","yes","will","can","could","should","would","may","might",
    "have","has","had","am","what","when","where","who","whom","which","how","why","my","me","us","our","them",
    "his","her","their","there","here","then","than","also","just","very","about","into","over","under","up","down",
    "out","more","most","some","any","each","every","other","new","now","get","got","one","two","three","vs"
  ]);

  var el = function (id) { return document.getElementById(id); };
  var searchInput = el("searchInput");
  var sortSelect = el("sortSelect");
  var videoGrid = el("videoGrid");
  var loading = el("loading");
  var resultCount = el("resultCount");
  var refreshBtn = el("refreshBtn");
  var footerInfo = el("footerInfo");

  function yt(path) {
    return fetch("https://www.googleapis.com/youtube/v3/" + path + (path.indexOf("?") >= 0 ? "&" : "?") + "key=" + API_KEY)
      .then(function (r) { if (!r.ok) throw new Error("YouTube API " + r.status); return r.json(); });
  }

  function fmtNum(n) {
    n = Number(n || 0);
    if (n >= 1e9) return (n / 1e9).toFixed(2).replace(/\.?0+$/, "") + "B";
    if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, "") + "M";
    if (n >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, "") + "K";
    return String(n);
  }

  function fmtDate(iso) {
    return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  }

  function fmtDuration(iso) {
    if (!iso) return "";
    var s = parseDurationSecs(iso);
    if (s < 60) return "0:" + String(s).padStart(2, "0");
    var m = Math.floor(s / 60), sec = s % 60;
    if (m < 60) return m + ":" + String(sec).padStart(2, "0");
    var h = Math.floor(m / 60); m = m % 60;
    return h + ":" + String(m).padStart(2, "0") + ":" + String(sec).padStart(2, "0");
  }

  function parseDurationSecs(iso) {
    if (!iso) return 0;
    var m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
    if (!m) return 0;
    return (m[1] ? parseInt(m[1]) * 3600 : 0) + (m[2] ? parseInt(m[2]) * 60 : 0) + (m[3] ? parseInt(m[3]) : 0);
  }

  function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  // ---------- fetch ----------
  async function fetchChannel() {
    var data = await yt("channels?part=snippet,statistics,contentDetails&id=" + CHANNEL_ID);
    var c = data.items[0];
    channel = {
      title: c.snippet.title,
      handle: c.snippet.customUrl || "",
      description: c.snippet.description || "",
      country: c.snippet.country || "",
      publishedAt: c.snippet.publishedAt,
      avatar: (c.snippet.thumbnails && (c.snippet.thumbnails.high || c.snippet.thumbnails.medium || c.snippet.thumbnails.default || {}).url) || "",
      subscribers: Number(c.statistics.subscriberCount || 0),
      views: Number(c.statistics.viewCount || 0),
      videos: Number(c.statistics.videoCount || 0),
    };
  }

  async function fetchAllVideoIds() {
    var ids = [], pageToken = "";
    do {
      var data = await yt("playlistItems?part=contentDetails&playlistId=" + UPLOADS_PLAYLIST + "&maxResults=50" + (pageToken ? "&pageToken=" + pageToken : ""));
      for (var i = 0; i < data.items.length; i++) { var v = data.items[i].contentDetails.videoId; if (v) ids.push(v); }
      pageToken = data.nextPageToken || "";
    } while (pageToken);
    return ids;
  }

  function mapLimit(items, limit, fn) {
    var idx = 0, results = new Array(items.length);
    function worker() {
      if (idx >= items.length) return Promise.resolve();
      var i = idx++;
      return Promise.resolve(fn(items[i], i)).then(function (r) { results[i] = r; return worker(); });
    }
    var ws = [];
    for (var w = 0; w < Math.min(limit, items.length); w++) ws.push(worker());
    return Promise.all(ws).then(function () { return results; });
  }

  async function fetchVideoDetails(ids) {
    var batches = [];
    for (var i = 0; i < ids.length; i += 50) batches.push(ids.slice(i, i + 50));
    var results = await mapLimit(batches, 6, async function (batch) {
      var data = await yt("videos?part=snippet,statistics,contentDetails&id=" + batch.join(","));
      return data.items;
    });
    var out = [];
    for (var k = 0; k < results.length; k++) {
      for (var j = 0; j < results[k].length; j++) {
        var v = results[k][j];
        out.push({
          id: v.id,
          title: v.snippet.title,
          description: v.snippet.description || "",
          tags: v.snippet.tags || [],
          categoryId: v.snippet.categoryId || "",
          publishedAt: v.snippet.publishedAt,
          thumb: ((v.snippet.thumbnails && (v.snippet.thumbnails.medium || v.snippet.thumbnails.high || v.snippet.thumbnails.default || {})).url) || "",
          views: Number(v.statistics.viewCount || 0),
          likes: Number(v.statistics.likeCount || 0),
          comments: Number(v.statistics.commentCount || 0),
          duration: fmtDuration(v.contentDetails.duration),
          durationSecs: parseDurationSecs(v.contentDetails.duration),
        });
      }
    }
    return out;
  }

  async function fetchCategories() {
    var data = await yt("videoCategories?part=snippet&regionCode=US");
    for (var i = 0; i < data.items.length; i++) {
      categoriesMap[data.items[i].id] = data.items[i].snippet.title;
    }
  }

  // ---------- analytics ----------
  function engagement(v) { return v.views > 0 ? (v.likes / v.views) * 100 : 0; }

  function monthKey(iso) { return iso.slice(0, 7); }

  function monthLabel(key) {
    var d = new Date(key + "-01T00:00:00");
    return d.toLocaleDateString(undefined, { year: "2-digit", month: "short" });
  }

  function topBy(fn, n) {
    var list = videos.slice().sort(function (a, b) { return fn(b) - fn(a); }).slice(0, n);
    return list;
  }

  function computeTopTags() {
    var map = {};
    for (var i = 0; i < videos.length; i++) {
      var v = videos[i];
      for (var j = 0; j < v.tags.length; j++) {
        var t = v.tags[j].trim().toLowerCase();
        if (!t) continue;
        map[t] = (map[t] || 0) + v.views;
      }
    }
    return Object.entries(map).sort(function (a, b) { return b[1] - a[1]; }).slice(0, 30);
  }

  function computeTopKeywords() {
    var map = {};
    for (var i = 0; i < videos.length; i++) {
      var words = videos[i].title.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/);
      for (var j = 0; j < words.length; j++) {
        var w = words[j];
        if (w.length < 3 || STOPWORDS.has(w) || /^\d+$/.test(w)) continue;
        map[w] = (map[w] || 0) + videos[i].views;
      }
    }
    return Object.entries(map).sort(function (a, b) { return b[1] - a[1]; }).slice(0, 40);
  }

  function computeUploadTimeline() {
    var map = {};
    for (var i = 0; i < videos.length; i++) {
      var k = monthKey(videos[i].publishedAt);
      map[k] = (map[k] || 0) + 1;
    }
    return Object.keys(map).sort().map(function (k) { return { key: k, label: monthLabel(k), count: map[k] }; });
  }

  function computeViewsByMonth() {
    var map = {};
    for (var i = 0; i < videos.length; i++) {
      var k = monthKey(videos[i].publishedAt);
      map[k] = (map[k] || 0) + videos[i].views;
    }
    return Object.keys(map).sort().map(function (k) { return { key: k, label: monthLabel(k), views: map[k] }; });
  }

  function computeDurationBreakdown() {
    var buckets = { "Shorts (<1min)": 0, "1–5 min": 0, "5–10 min": 0, "10+ min": 0 };
    for (var i = 0; i < videos.length; i++) {
      var s = videos[i].durationSecs;
      if (s < 60) buckets["Shorts (<1min)"]++;
      else if (s < 300) buckets["1–5 min"]++;
      else if (s < 600) buckets["5–10 min"]++;
      else buckets["10+ min"]++;
    }
    return buckets;
  }

  function computeCategoryBreakdown() {
    var map = {};
    for (var i = 0; i < videos.length; i++) {
      var c = categoriesMap[videos[i].categoryId] || "Other";
      map[c] = (map[c] || 0) + 1;
    }
    return map;
  }

  function computeBestDay() {
    var days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    var counts = new Array(7).fill(0), sums = new Array(7).fill(0);
    for (var i = 0; i < videos.length; i++) {
      var d = new Date(videos[i].publishedAt).getDay();
      counts[d]++; sums[d] += videos[i].views;
    }
    return days.map(function (name, d) { return { label: name, avg: counts[d] ? Math.round(sums[d] / counts[d]) : 0, count: counts[d] }; });
  }

  function computeBestHour() {
    var counts = new Array(24).fill(0), sums = new Array(24).fill(0);
    for (var i = 0; i < videos.length; i++) {
      var h = new Date(videos[i].publishedAt).getHours();
      counts[h]++; sums[h] += videos[i].views;
    }
    return counts.map(function (c, h) { return { label: h + ":00", avg: c ? Math.round(sums[h] / c) : 0 }; });
  }

  function computeMonthlyPerf() {
    var map = {};
    for (var i = 0; i < videos.length; i++) {
      var k = monthKey(videos[i].publishedAt);
      if (!map[k]) map[k] = { count: 0, views: 0 };
      map[k].count++; map[k].views += videos[i].views;
    }
    return Object.keys(map).sort().map(function (k) {
      return { label: monthLabel(k), count: map[k].count, avg: Math.round(map[k].views / map[k].count) };
    });
  }

  // ---------- render ----------
  function renderChannel() {
    if (!channel) return;
    el("channelHandle").textContent = "@" + channel.handle;
    el("channelName").textContent = channel.title;
    el("channelAvatar").src = channel.avatar;
    el("channelDesc").textContent = channel.description;
    var meta = '<span class="meta-chip">@' + escapeHtml(channel.handle) + "</span>";
    if (channel.country) meta += '<span class="meta-chip">📍 ' + escapeHtml(channel.country) + "</span>";
    meta += '<span class="meta-chip">Since ' + fmtDate(channel.publishedAt) + "</span>";
    el("channelMeta").innerHTML = meta;

    var totalLikes = videos.reduce(function (a, v) { return a + v.likes; }, 0);
    var totalComments = videos.reduce(function (a, v) { return a + v.comments; }, 0);
    var avgEng = videos.length ? (videos.reduce(function (a, v) { return a + engagement(v); }, 0) / videos.length) : 0;

    el("statSubs").textContent = fmtNum(channel.subscribers);
    el("statViews").textContent = fmtNum(channel.views);
    el("statVideos").textContent = String(videos.length);
    el("statLikes").textContent = fmtNum(totalLikes);
    el("statComments").textContent = fmtNum(totalComments);
    el("statEngagement").textContent = avgEng.toFixed(2) + "%";
  }

  function renderTopVideos() {
    var tViews = topBy(function (v) { return v.views; }, 15);
    var tLikes = topBy(function (v) { return v.likes; }, 15);
    var tComments = topBy(function (v) { return v.comments; }, 15);
    var maxViews = tViews.length ? tViews[0].views : 1;
    var maxLikes = tLikes.length ? tLikes[0].likes : 1;
    var maxComments = tComments.length ? tComments[0].comments : 1;

    function build(list, metric, get, max) {
      return list.map(function (v, i) {
        var val = get(v);
        return '<div class="rank-item"><span class="rank-idx">' + (i + 1) + "</span>" +
          '<div class="rank-bar-wrap"><div class="rank-title">' +
            '<a class="t" href="https://www.youtube.com/watch?v=' + v.id + '" target="_blank" rel="noopener" title="' + escapeHtml(v.title) + '">' + escapeHtml(v.title) + "</a>" +
            '<span class="v">' + fmtNum(val) + "</span>" +
          "</div><div class='rank-bar'><div class='rank-bar-fill' style='width:" + ((val / max) * 100) + "%'></div></div></div></div>";
      }).join("");
    }

    el("topViews").innerHTML = build(tViews, "views", function (v) { return v.views; }, maxViews);
    el("topLikes").innerHTML = build(tLikes, "likes", function (v) { return v.likes; }, maxLikes);
    el("topComments").innerHTML = build(tComments, "comments", function (v) { return v.comments; }, maxComments);

    var tEng = topBy(engagement, 20).filter(function (v) { return v.views >= 100; });
    var maxEng = tEng.length ? engagement(tEng[0]) : 1;
    el("topEngagement").innerHTML = tEng.map(function (v, i) {
      var e = engagement(v);
      return '<div class="rank-item"><span class="rank-idx">' + (i + 1) + "</span>" +
        '<div class="rank-bar-wrap"><div class="rank-title">' +
          '<a class="t" href="https://www.youtube.com/watch?v=' + v.id + '" target="_blank" rel="noopener" title="' + escapeHtml(v.title) + '">' + escapeHtml(v.title) + "</a>" +
          '<span class="v">' + e.toFixed(2) + "%</span>" +
        "</div><div class='rank-bar'><div class='rank-bar-fill' style='width:" + ((e / maxEng) * 100) + "%'></div></div></div></div>";
    }).join("");
  }

  function renderTagsKeywords() {
    var tags = computeTopTags();
    var maxTag = tags.length ? tags[0][1] : 1;
    el("topTags").innerHTML = tags.map(function (t, i) {
      return '<div class="rank-item"><span class="rank-idx">' + (i + 1) + "</span>" +
        '<div class="rank-bar-wrap"><div class="rank-title">' +
          '<span class="t">#' + escapeHtml(t[0]) + "</span>" +
          '<span class="v">' + fmtNum(t[1]) + "</span>" +
        "</div><div class='rank-bar'><div class='rank-bar-fill' style='width:" + ((t[1] / maxTag) * 100) + "%'></div></div></div></div>";
    }).join("");

    var kw = computeTopKeywords();
    var maxKw = kw.length ? kw[0][1] : 1;
    el("topKeywords").innerHTML = kw.map(function (t, i) {
      return '<div class="rank-item"><span class="rank-idx">' + (i + 1) + "</span>" +
        '<div class="rank-bar-wrap"><div class="rank-title">' +
          '<span class="t">' + escapeHtml(t[0]) + "</span>" +
          '<span class="v">' + fmtNum(t[1]) + "</span>" +
        "</div><div class='rank-bar'><div class='rank-bar-fill' style='width:" + ((t[1] / maxKw) * 100) + "%'></div></div></div></div>";
    }).join("");
  }

  function destroyCharts() {
    Object.keys(charts).forEach(function (k) { if (charts[k]) { charts[k].destroy(); } });
    charts = {};
  }

  function barChart(canvasId, labels, data, color) {
    var ctx = el(canvasId);
    if (!ctx) return;
    charts[canvasId] = new Chart(ctx, {
      type: "bar",
      data: { labels: labels, datasets: [{ data: data, backgroundColor: color || "rgba(255,0,0,.6)", borderRadius: 3 }] },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { ticks: { color: "#aaa", maxRotation: 45, autoSkip: true }, grid: { color: "#2a2a2a" } },
          y: { ticks: { color: "#aaa", callback: function (v) { return fmtNum(v); } }, grid: { color: "#2a2a2a" } },
        },
      },
    });
  }

  function doughnutChart(canvasId, labels, data, colors) {
    var ctx = el(canvasId);
    if (!ctx) return;
    charts[canvasId] = new Chart(ctx, {
      type: "doughnut",
      data: { labels: labels, datasets: [{ data: data, backgroundColor: colors || ["#ff0000", "#3ea6ff", "#f5a623", "#2ba640", "#a06bff", "#ff6b81", "#00c2c2"] }] },
      options: {
        responsive: true, maintainAspectRatio: false, cutout: "55%",
        plugins: { legend: { position: "right", labels: { color: "#aaa", boxWidth: 12 } } },
      },
    });
  }

  function renderOverview() {
    destroyCharts();
    var tl = computeUploadTimeline();
    barChart("chartUploads", tl.map(function (x) { return x.label; }), tl.map(function (x) { return x.count; }), "rgba(62,166,255,.6)");

    var vb = computeViewsByMonth();
    barChart("chartViewsMonth", vb.map(function (x) { return x.label; }), vb.map(function (x) { return x.views; }), "rgba(255,0,0,.6)");

    var dur = computeDurationBreakdown();
    doughnutChart("chartDuration", Object.keys(dur), Object.values(dur), ["#ff0000", "#3ea6ff", "#f5a623", "#2ba640"]);

    var cat = computeCategoryBreakdown();
    doughnutChart("chartCategory", Object.keys(cat), Object.values(cat));
  }

  function renderInsights() {
    destroyCharts();
    var days = computeBestDay();
    barChart("chartDay", days.map(function (x) { return x.label; }), days.map(function (x) { return x.avg; }), "rgba(160,107,255,.6)");

    var hours = computeBestHour();
    barChart("chartHour", hours.map(function (x) { return x.label; }), hours.map(function (x) { return x.avg; }), "rgba(43,166,64,.6)");

    var mp = computeMonthlyPerf();
    charts["chartMonthlyPerf"] = new Chart(el("chartMonthlyPerf"), {
      type: "bar",
      data: {
        labels: mp.map(function (x) { return x.label; }),
        datasets: [
          { label: "Videos", data: mp.map(function (x) { return x.count; }), backgroundColor: "rgba(62,166,255,.6)", borderRadius: 3, yAxisID: "y" },
          { label: "Avg views", data: mp.map(function (x) { return x.avg; }), backgroundColor: "rgba(255,0,0,.5)", borderRadius: 3, yAxisID: "y1" },
        ],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { labels: { color: "#aaa" } } },
        scales: {
          x: { ticks: { color: "#aaa", maxRotation: 45, autoSkip: true }, grid: { color: "#2a2a2a" } },
          y: { position: "left", ticks: { color: "#aaa", callback: function (v) { return fmtNum(v); } }, grid: { color: "#2a2a2a" } },
          y1: { position: "right", ticks: { color: "#aaa", callback: function (v) { return fmtNum(v); } }, grid: { drawOnChartArea: false } },
        },
      },
    });
  }

  function filteredSorted() {
    var q = searchInput.value.trim().toLowerCase();
    var sort = sortSelect.value;
    var list = videos.slice();
    if (q) list = list.filter(function (v) { return (v.title + " " + v.description).toLowerCase().indexOf(q) >= 0; });
    list.sort(function (a, b) {
      if (sort === "views") return b.views - a.views;
      if (sort === "likes") return b.likes - a.likes;
      if (sort === "comments") return b.comments - a.comments;
      if (sort === "engagement") return engagement(b) - engagement(a);
      return new Date(b.publishedAt) - new Date(a.publishedAt);
    });
    return list;
  }

  function renderGrid() {
    var list = filteredSorted();
    resultCount.textContent = list.length + " video" + (list.length === 1 ? "" : "s");
    if (!list.length) { videoGrid.innerHTML = '<div class="loading">No videos found.</div>'; return; }
    var html = "";
    for (var i = 0; i < list.length; i++) {
      var v = list[i];
      html += '<a class="video-card" href="https://www.youtube.com/watch?v=' + v.id + '" target="_blank" rel="noopener">' +
        '<div class="thumb-wrap"><img src="' + escapeHtml(v.thumb) + '" alt="" loading="lazy" />' +
        (v.duration ? '<span class="duration">' + escapeHtml(v.duration) + "</span>" : "") + "</div>" +
        '<div class="video-body">' +
          '<div class="video-title">' + escapeHtml(v.title) + "</div>" +
          '<div class="video-stats"><span>▶ ' + fmtNum(v.views) + "</span><span>👍 " + fmtNum(v.likes) + "</span><span>💬 " + fmtNum(v.comments) + "</span></div>" +
          '<div class="video-date">' + fmtDate(v.publishedAt) + "</div>" +
        "</div></a>";
    }
    videoGrid.innerHTML = html;
  }

  // ---------- tabs ----------
  el("tabBar").addEventListener("click", function (e) {
    var btn = e.target.closest(".tab");
    if (!btn) return;
    var name = btn.getAttribute("data-tab");
    document.querySelectorAll(".tab").forEach(function (t) { t.classList.toggle("active", t === btn); });
    document.querySelectorAll(".tab-panel").forEach(function (p) { p.classList.remove("active"); });
    el("panel-" + name).classList.add("active");
    if (name === "overview") renderOverview();
    if (name === "insights") renderInsights();
    if (name === "top") renderTopVideos();
    if (name === "tags") renderTagsKeywords();
    if (name === "videos") renderGrid();
  });

  var debounce = function (fn, ms) { var t; return function () { clearTimeout(t); t = setTimeout(fn, ms); }; };
  searchInput.addEventListener("input", debounce(renderGrid, 200));
  sortSelect.addEventListener("change", renderGrid);
  refreshBtn.addEventListener("click", function () { load(true); });

  // ---------- init ----------
  async function load(manual) {
    if (manual) refreshBtn.classList.add("loading");
    try {
      loading.style.display = "block";
      await fetchChannel();
      renderChannel();
      await fetchCategories();
      var ids = await fetchAllVideoIds();
      videos = await fetchVideoDetails(ids);
      renderChannel();
      renderTopVideos();
      renderTagsKeywords();
      renderOverview();
      renderGrid();
      footerInfo.textContent = "Live data via YouTube Data API · " + videos.length + " videos · " + fmtDate(new Date().toISOString());
    } catch (err) {
      videoGrid.innerHTML = '<div class="loading">Error: ' + escapeHtml(err.message) + "</div>";
      footerInfo.textContent = "Error loading data";
    } finally {
      loading.style.display = "none";
      if (manual) refreshBtn.classList.remove("loading");
    }
  }

  load(false);
})();
