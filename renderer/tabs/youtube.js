import { initTab } from './tab.js';

export function initYoutubeTab() {
  initTab({
    panelId: '#youtubePanel',
    urlInputId: '#youtubeUrl',
    fetchBtnId: '#youtubeFetch',
    previewCoverId: '#youtubeCover',
    previewNameId: '#youtubeName',
    previewMetaId: '#youtubeMeta',
    previewCancelId: '#youtubePreviewCancel',
    previewStartId: '#youtubePreviewStart',
    barId: '#youtubeBar',
    counterId: '#youtubeCounter',
    trackListId: '#youtubeTrackList',
    downloadCancelId: '#youtubeDownloadCancel',
    summaryId: '#youtubeSummary',
    openFolderId: '#youtubeOpenFolder',
    anotherId: '#youtubeAnother',
    errorMessageId: '#youtubeErrorMessage',
    errorRetryId: '#youtubeErrorRetry',
    fetchPlaylistFn: (url) => window.api.youtube.fetchPlaylist(url),
  });
}
