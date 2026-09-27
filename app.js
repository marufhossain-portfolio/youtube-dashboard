(function () {
  "use strict";

  var API_KEY = "AIzaSyAArMRCMQ3x96mrbR_G4kqfellbSoqlG6Q";
  var CHANNEL_ID = "UCwX-QozeDV2M6tJfAtE-B6w";
  var UPLOADS_PLAYLIST = "UUwX-QozeDV2M6tJfAtE-B6w";

  var channel = null;
  var videos = [];

  var el = function (id) { return document.getElementById(id); };
  var searchInput = el("searchInput");
  var sortSelect = el("sortSelect");
  var videoGrid = el("videoGrid");
  var loading = el("loading");
  var resultCount = el("resultCount");
  var refreshBtn = el("refreshBtn");
  var refreshIcon = el("refreshIcon");
  var footerInfo = el("footerInfo");

  function yt(path) {
    return fetch("https://www.googleapis.com/youtube/v3/" + path + (path.indexOf("?") >= 0 ? "&" : "?") + "key=" + API_KEY)
      .then(function (r) {
        if (!r.ok) throw new Error("YouTube API " + r.status);
        return r.json();
      });
  }

  function fmtNum(n) {
    n = Number(n || 0);
    if (n >= 1e9) return (n / 1e9).toFixed(1).replace(/\.0$/, "") + "B";
    if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, "") + "M";
    if (n >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, "") + "K";
    return String(n);
  }

  function fmtDate(iso) {
    var d = new Date(iso);
    var opts = { year: "numeric", month: "short", day: "numeric" };
    return d.toLocaleDateString(undefined, opts);
  }

  function fmtDuration(iso) {
    if (!iso) return "";
    var m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
    if (!m) return "";
    var h = m[1] ? parseInt(m[1]) : 0;
    var min = m[2] ? parseInt(m[2]) : 0;
    var s = m[3] ? parseInt(m[3]) : 0;
    if (h > 0) return h + ":" + String(min).padStart(2, "0") + ":" + String(s).padStart(2, "0");
    return min + ":" + String(s).padStart(2, "0");
  }

  function escapeHtml(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  async function fetchChannel() {
    var data = await yt("channels?part=snippet,statistics,contentDetails&id=" + CHANNEL_ID);
    if (!data.items || !data.items.length) throw new Error("Channel not found");
    var c = data.items[0];
    channel = {
      title: c.snippet.title,
      handle: c.snippet.customUrl || "",
      description: c.snippet.description || "",
      publishedAt: c.snippet.publishedAt,
      avatar: (c.snippet.thumbnails && (c.snippet.thumbnails.high || c.snippet.thumbnails.medium || c.snippet.thumbnails.default || {}).url) || "",
      subscribers: Number(c.statistics.subscriberCount || 0),
      views: Number(c.statistics.viewCount || 0),
      videos: Number(c.statistics.videoCount || 0),
    };
  }

  async function fetchAllVideoIds() {
    var ids = [];
    var pageToken = "";
    do {
      var data = await yt(
        "playlistItems?part=contentDetails&playlistId=" + UPLOADS_PLAYLIST +
        "&maxResults=50" + (pageToken ? "&pageToken=" + pageToken : "")
      );
      for (var i = 0; i < data.items.length; i++) {
        var vid = data.items[i].contentDetails.videoId;
        if (vid) ids.push(vid);
      }
      pageToken = data.nextPageToken || "";
    } while (pageToken);
    return ids;
  }

  async function fetchVideoDetails(ids) {
    var out = [];
    for (var i = 0; i < ids.length; i += 50) {
      var batch = ids.slice(i, i + 50);
      var data = await yt("videos?part=snippet,statistics,contentDetails&id=" + batch.join(","));
      for (var j = 0; j < data.items.length; j++) {
        var v = data.items[j];
        out.push({
          id: v.id,
          title: v.snippet.title,
          description: v.snippet.description,
          publishedAt: v.snippet.publishedAt,
          thumb: ((v.snippet.thumbnails && (v.snippet.thumbnails.medium || v.snippet.thumbnails.high || v.snippet.thumbnails.default || {})).url) || "",
          views: Number(v.statistics.viewCount || 0),
          likes: Number(v.statistics.likeCount || 0),
          comments: Number(v.statistics.commentCount || 0),
          duration: fmtDuration(v.contentDetails.duration),
        });
      }
    }
    return out;
  }

  function renderChannel() {
    if (!channel) return;
    el("channelHandle").textContent = "@" + channel.handle;
    el("channelName").textContent = channel.title;
    el("channelAvatar").src = channel.avatar;
    el("channelDesc").textContent = channel.description;
    el("channelMeta").innerHTML =
      '<span class="meta-chip">@' + escapeHtml(channel.handle) + "</span>" +
      '<span class="meta-chip">Since ' + fmtDate(channel.publishedAt) + "</span>";

    el("statSubs").textContent = fmtNum(channel.subscribers);
    el("statViews").textContent = fmtNum(channel.views);
    el("statVideos").textContent = videos.length ? String(videos.length) : fmtNum(channel.videos);
    var totalLikes = videos.reduce(function (a, v) { return a + v.likes; }, 0);
    el("statLikes").textContent = fmtNum(totalLikes);
  }

  function filteredSorted() {
    var q = searchInput.value.trim().toLowerCase();
    var sort = sortSelect.value;
    var list = videos.slice();
    if (q) {
      list = list.filter(function (v) {
        return (v.title + " " + v.description).toLowerCase().indexOf(q) >= 0;
      });
    }
    list.sort(function (a, b) {
      if (sort === "views") return b.views - a.views;
      if (sort === "likes") return b.likes - a.likes;
      if (sort === "comments") return b.comments - a.comments;
      return new Date(b.publishedAt) - new Date(a.publishedAt);
    });
    return list;
  }

  function renderGrid() {
    var list = filteredSorted();
    resultCount.textContent = list.length + " video" + (list.length === 1 ? "" : "s") +
      (videos.length && list.length !== videos.length ? " (filtered from " + videos.length + ")" : "");

    if (!list.length) {
      videoGrid.innerHTML = '<div class="loading">No videos found.</div>';
      return;
    }
    var html = "";
    for (var i = 0; i < list.length; i++) {
      var v = list[i];
      html +=
        '<a class="video-card" href="https://www.youtube.com/watch?v=' + v.id + '" target="_blank" rel="noopener">' +
          '<div class="thumb-wrap">' +
            '<img src="' + escapeHtml(v.thumb) + '" alt="" loading="lazy" />' +
            (v.duration ? '<span class="duration">' + escapeHtml(v.duration) + "</span>" : "") +
          "</div>" +
          '<div class="video-body">' +
            '<div class="video-title">' + escapeHtml(v.title) + "</div>" +
            '<div class="video-stats">' +
              '<span>▶ ' + fmtNum(v.views) + "</span>" +
              '<span>👍 ' + fmtNum(v.likes) + "</span>" +
              '<span>💬 ' + fmtNum(v.comments) + "</span>" +
            "</div>" +
            '<div class="video-date">' + fmtDate(v.publishedAt) + "</div>" +
          "</div>" +
        "</a>";
    }
    videoGrid.innerHTML = html;
  }

  async function load(manual) {
    if (manual) { refreshBtn.classList.add("loading"); }
    try {
      loading.style.display = "block";
      await fetchChannel();
      var ids = await fetchAllVideoIds();
      videos = await fetchVideoDetails(ids);
      renderChannel();
      renderGrid();
      footerInfo.textContent = "Live data via YouTube Data API · " + videos.length + " videos loaded";
    } catch (err) {
      videoGrid.innerHTML = '<div class="loading">Error: ' + escapeHtml(err.message) + "</div>";
      footerInfo.textContent = "Error loading data";
    } finally {
      loading.style.display = "none";
      if (manual) { refreshBtn.classList.remove("loading"); }
    }
  }

  var debounce = function (fn, ms) {
    var t; return function () { clearTimeout(t); t = setTimeout(fn, ms); };
  };

  searchInput.addEventListener("input", debounce(renderGrid, 200));
  sortSelect.addEventListener("change", renderGrid);
  refreshBtn.addEventListener("click", function () { load(true); });

  load(false);
})();
