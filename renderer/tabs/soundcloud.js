import { initTab } from './tab.js';

export function initSoundcloudTab() {
  initTab({
    panelId: '#soundcloudPanel',
    urlInputId: '#soundcloudUrl',
    fetchBtnId: '#soundcloudFetch',
    previewCoverId: '#soundcloudCover',
    previewNameId: '#soundcloudName',
    previewMetaId: '#soundcloudMeta',
    previewCancelId: '#soundcloudPreviewCancel',
    previewStartId: '#soundcloudPreviewStart',
    barId: '#soundcloudBar',
    counterId: '#soundcloudCounter',
    trackListId: '#soundcloudTrackList',
    downloadCancelId: '#soundcloudDownloadCancel',
    summaryId: '#soundcloudSummary',
    openFolderId: '#soundcloudOpenFolder',
    anotherId: '#soundcloudAnother',
    errorMessageId: '#soundcloudErrorMessage',
    errorRetryId: '#soundcloudErrorRetry',
    fetchPlaylistFn: (url) => window.api.soundcloud.fetchPlaylist(url),
  });
}
