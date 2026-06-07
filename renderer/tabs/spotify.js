import { initTab } from './tab.js';

async function refreshSpotifyAuthBanner() {
  const banner = document.querySelector('#spotifyAuthBanner');
  const pill = document.querySelector('#spotifyAuthPill');
  const pillText = document.querySelector('#spotifyAuthPillText');
  if (!banner || !pill) return;

  const status = await window.api.spotifyAccount.getStatus();
  const cfg = await window.api.config.get();

  if (status.connected) {
    banner.hidden = true;
    pill.hidden = false;
    const planLabel = status.plan === 'premium'
      ? 'Premium · 320 kbps'
      : `${status.plan} · 160 kbps (upgrade pra 320)`;
    pillText.textContent = `✓ Conectado como ${status.email} · ${planLabel}`;
  } else {
    pill.hidden = true;
    const dismissedAt = cfg.spotifyBannerDismissedAt;
    const dismissedRecently = dismissedAt && (Date.now() - new Date(dismissedAt).getTime() < 7 * 86400 * 1000);
    banner.hidden = !!dismissedRecently;
  }
}

async function triggerOAuthFlow() {
  const dialog = document.querySelector('#oauthDialog');
  dialog.showModal();
  const result = await window.api.spotifyAccount.connect();
  dialog.close();
  if (!result.ok) {
    alert(result.userMessage || 'Falha ao conectar Spotify.');
  }
  await refreshSpotifyAuthBanner();
}

async function disconnectSpotify() {
  await window.api.spotifyAccount.disconnect();
  await refreshSpotifyAuthBanner();
}

async function dismissBanner() {
  const cfg = await window.api.config.get();
  await window.api.config.set({ ...cfg, spotifyBannerDismissedAt: new Date().toISOString() });
  await refreshSpotifyAuthBanner();
}

function wireSpotifyAuth() {
  const connectBtn = document.querySelector('#spotifyConnectBtn');
  const disconnectBtn = document.querySelector('#spotifyDisconnectBtn');
  const dismissBtn = document.querySelector('#spotifyAuthBannerDismiss');
  const oauthRetry = document.querySelector('#oauthDialogRetry');
  const oauthCancel = document.querySelector('#oauthDialogCancel');

  if (connectBtn) connectBtn.addEventListener('click', triggerOAuthFlow);
  if (disconnectBtn) disconnectBtn.addEventListener('click', disconnectSpotify);
  if (dismissBtn) dismissBtn.addEventListener('click', dismissBanner);
  if (oauthRetry) oauthRetry.addEventListener('click', triggerOAuthFlow);
  if (oauthCancel) oauthCancel.addEventListener('click', () => document.querySelector('#oauthDialog').close());

  refreshSpotifyAuthBanner();

  if (window.api.spotifyAccount?.onStatusChange) {
    window.api.spotifyAccount.onStatusChange(() => refreshSpotifyAuthBanner());
  }
}

export function initSpotifyTab() {
  initTab({
    panelId: '#spotifyPanel',
    urlInputId: '#spotifyUrl',
    fetchBtnId: '#spotifyFetch',
    previewCoverId: '#previewCover',
    previewNameId: '#previewName',
    previewMetaId: '#previewMeta',
    previewCancelId: '#previewCancel',
    previewStartId: '#previewStart',
    barId: '#bar',
    counterId: '#counter',
    trackListId: '#trackList',
    downloadCancelId: '#downloadCancel',
    summaryId: '#summary',
    openFolderId: '#openFolder',
    anotherId: '#anotherPlaylist',
    errorMessageId: '#errorMessage',
    errorRetryId: '#errorRetry',
    fetchPlaylistFn: (url) => window.api.spotify.fetchPlaylist(url),
  });
  wireSpotifyAuth();
}
