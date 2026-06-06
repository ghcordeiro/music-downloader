const $ = (s, root = document) => root.querySelector(s);

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

export function initTab(config) {
  const {
    panelId, urlInputId, fetchBtnId,
    previewCoverId, previewNameId, previewMetaId,
    previewCancelId, previewStartId,
    barId, counterId, trackListId, downloadCancelId,
    summaryId, openFolderId, anotherId,
    errorMessageId, errorRetryId,
    fetchPlaylistFn,
  } = config;

  const panel = $(panelId);
  let currentData = null;
  let currentTotal = 0;
  let completed = 0;

  function showState(name) {
    panel.querySelectorAll('.state').forEach(el => { el.hidden = el.dataset.state !== name; });
  }

  function renderPreview(data) {
    $(previewNameId).textContent = data.playlistName;
    $(previewMetaId).textContent = `${data.platform === 'spotify' ? 'Spotify' : data.platform === 'youtube' ? 'YouTube' : 'SoundCloud'} · ${data.tracks.length} ${data.tracks.length === 1 ? 'música' : 'músicas'}`;
    if (data.coverUrl) $(previewCoverId).src = data.coverUrl;
  }

  function renderTrackList(tracks) {
    const ul = $(trackListId);
    ul.innerHTML = '';
    tracks.forEach((t, i) => {
      const li = document.createElement('li');
      li.dataset.idx = i;
      li.innerHTML = `<span class="num">${i + 1}</span><span class="name">${escapeHtml(t.artist)} — ${escapeHtml(t.name)}</span><span class="status"></span>`;
      ul.appendChild(li);
    });
  }

  function setTrackStatus(idx, icon) {
    const li = $(trackListId).querySelector(`li[data-idx="${idx}"]`);
    if (li) li.querySelector('.status').textContent = icon;
  }

  function showError(msg) {
    $(errorMessageId).textContent = msg;
    showState('error');
  }

  $(fetchBtnId).addEventListener('click', async () => {
    const url = $(urlInputId).value.trim();
    if (!url) return;
    showState('loading');
    const resp = await fetchPlaylistFn(url);
    if (!resp.ok) {
      if (resp.code === 'UNEXPECTED') {
        window.dispatchEvent(new CustomEvent('app:tier3', { detail: { userMessage: resp.userMessage, reference: resp.reference } }));
        showState('empty');
        return;
      }
      showError(resp.userMessage || 'Erro.');
      return;
    }
    currentData = resp.data;
    renderPreview(currentData);
    showState('preview');
  });

  $(previewCancelId).addEventListener('click', () => {
    currentData = null;
    showState('empty');
  });

  $(previewStartId).addEventListener('click', async () => {
    currentTotal = currentData.tracks.length;
    completed = 0;
    renderTrackList(currentData.tracks);
    $(counterId).textContent = `0 / ${currentTotal}`;
    $(barId).style.width = '0%';
    showState('downloading');

    const unsub = window.api.download.onProgress((evt) => {
      if (evt.type === 'started') setTrackStatus(evt.trackIdx, '↻');
      else if (evt.type === 'done') { setTrackStatus(evt.trackIdx, '✓'); completed++; }
      else if (evt.type === 'not_found') { setTrackStatus(evt.trackIdx, '✗'); completed++; }
      else if (evt.type === 'skipped') { setTrackStatus(evt.trackIdx, '·'); completed++; }
      $(counterId).textContent = `${completed} / ${currentTotal}`;
      $(barId).style.width = `${Math.round((completed / currentTotal) * 100)}%`;
    });

    const resp = await window.api.download.start({
      playlistName: currentData.playlistName,
      platform: currentData.platform,
      sourceId: currentData.sourceId,
      tracks: currentData.tracks,
    });
    unsub();
    if (!resp.ok) {
      if (resp.code === 'UNEXPECTED') {
        window.dispatchEvent(new CustomEvent('app:tier3', { detail: { userMessage: resp.userMessage, reference: resp.reference } }));
        showState('empty');
        return;
      }
      showError(resp.userMessage || 'Erro ao baixar.');
      return;
    }

    const okCount = resp.data.ok.length;
    const failed = resp.data.failed.length;
    $(summaryId).innerHTML =
      `<div style="font-size:28px;font-weight:700;">${okCount} / ${currentTotal}</div>` +
      `<div>músicas baixadas</div>` +
      (failed ? `<div style="margin-top:8px;color:#cc6633">⚠ ${failed} não encontradas</div>` : '');
    showState('done');
  });

  $(downloadCancelId).addEventListener('click', () => window.api.download.cancel());

  $(openFolderId).addEventListener('click', async () => {
    const cfg = await window.api.config.get();
    await window.api.shell.openFolder(`${cfg.outputDir}/${currentData.playlistName}`);
  });

  $(anotherId).addEventListener('click', () => {
    $(urlInputId).value = '';
    showState('empty');
  });

  $(errorRetryId).addEventListener('click', () => showState('empty'));

  showState('empty');
}
