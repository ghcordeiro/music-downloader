import { initTab } from './tab.js';

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
}
