const $ = (s, root = document) => root.querySelector(s);

function showState(name) {
  const panel = $('#spotifyPanel');
  panel.querySelectorAll('.state').forEach((el) => {
    el.hidden = el.dataset.state !== name;
  });
}

function renderPreview(data) {
  $('#previewName').textContent = data.playlistName;
  $('#previewMeta').textContent = `Spotify · ${data.tracks.length} músicas`;
  if (data.coverUrl) $('#previewCover').src = data.coverUrl;
  showState('preview');
}

function renderTrackList(tracks) {
  const ul = $('#trackList');
  ul.innerHTML = '';
  tracks.forEach((t, i) => {
    const li = document.createElement('li');
    li.dataset.idx = i;
    li.innerHTML = `<span class="num">${i + 1}</span><span class="name">${escapeHtml(t.artist)} — ${escapeHtml(t.name)}</span><span class="status"></span>`;
    ul.appendChild(li);
  });
}

function setTrackStatus(idx, icon) {
  const li = $('#trackList').querySelector(`li[data-idx="${idx}"]`);
  if (li) li.querySelector('.status').textContent = icon;
}

function showError(message) {
  $('#errorMessage').textContent = message;
  showState('error');
}

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

export function initSpotifyTab() {
  let currentData = null;
  let currentTotal = 0;
  let completed = 0;

  $('#spotifyFetch').addEventListener('click', async () => {
    const url = $('#spotifyUrl').value.trim();
    if (!url) return;
    showState('loading');
    const resp = await window.api.spotify.fetchPlaylist(url);
    if (!resp.ok) {
      showError(resp.userMessage || 'Falha ao buscar a playlist.');
      return;
    }
    currentData = resp.data;
    renderPreview(currentData);
  });

  $('#previewCancel').addEventListener('click', () => {
    currentData = null;
    showState('empty');
  });

  $('#previewStart').addEventListener('click', async () => {
    currentTotal = currentData.tracks.length;
    completed = 0;
    renderTrackList(currentData.tracks);
    $('#counter').textContent = `0 / ${currentTotal}`;
    $('#bar').style.width = '0%';
    showState('downloading');

    const unsub = window.api.download.onProgress((evt) => {
      if (evt.type === 'started') setTrackStatus(evt.trackIdx, '↻');
      else if (evt.type === 'done') {
        setTrackStatus(evt.trackIdx, '✓');
        completed++;
      } else if (evt.type === 'not_found') {
        setTrackStatus(evt.trackIdx, '✗');
        completed++;
      } else if (evt.type === 'skipped') {
        setTrackStatus(evt.trackIdx, '·');
        completed++;
      }
      $('#counter').textContent = `${completed} / ${currentTotal}`;
      $('#bar').style.width = `${Math.round((completed / currentTotal) * 100)}%`;
    });

    const resp = await window.api.download.start({
      playlistName: currentData.playlistName,
      tracks: currentData.tracks,
    });
    unsub();

    if (!resp.ok) { showError(resp.userMessage || 'Erro ao baixar.'); return; }
    const okCount = resp.data.ok.length;
    const failed = resp.data.failed.length;
    $('#summary').innerHTML =
      `<div style="font-size:28px;font-weight:700;">${okCount} / ${currentTotal}</div>` +
      `<div>músicas baixadas</div>` +
      (failed ? `<div style="margin-top:8px;color:#cc6633">⚠ ${failed} não encontradas</div>` : '');
    showState('done');
  });

  $('#downloadCancel').addEventListener('click', () => {
    window.api.download.cancel();
  });

  $('#openFolder').addEventListener('click', async () => {
    const cfg = await window.api.config.get();
    await window.api.shell.openFolder(`${cfg.outputDir}/${currentData.playlistName}`);
  });

  $('#anotherPlaylist').addEventListener('click', () => {
    $('#spotifyUrl').value = '';
    showState('empty');
  });

  $('#errorRetry').addEventListener('click', () => showState('empty'));

  showState('empty');
}
