import { initSpotifyTab } from './tabs/spotify.js';
import { initYoutubeTab } from './tabs/youtube.js';
import { initSoundcloudTab } from './tabs/soundcloud.js';

const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => Array.from(root.querySelectorAll(s));

async function init() {
  const cfg = await window.api.config.get();
  if (!cfg.firstRunCompleted) {
    showWelcome(cfg);
  } else {
    showMain();
  }
}

function showWelcome(cfg) {
  let currentDir = cfg.outputDir;
  const render = () => { $('#welcomeFolder').textContent = `📁 ${currentDir}`; };
  $('#welcome').hidden = false;
  render();

  $('#welcomeChangeFolder').addEventListener('click', async () => {
    const r = await window.api.dialog.pickFolder(currentDir);
    if (r.ok) { currentDir = r.path; render(); }
  });

  $('#welcomeStart').addEventListener('click', async () => {
    await window.api.config.set({ outputDir: currentDir, firstRunCompleted: true });
    $('#welcome').hidden = true;
    showMain();
  });
}

function showMain() {
  $('#main').hidden = false;
  initSpotifyTab();
  initYoutubeTab();
  initSoundcloudTab();
  wireTabSwitching();

  async function refreshSettingsRows() {
    const cfg = await window.api.config.get();
    $('#settingsFolder').textContent = cfg.outputDir;
  }

  async function refreshSpotifySettings() {
    const status = await window.api.spotifyAccount.getStatus();
    const statusEl = $('#settingsSpotifyStatus');
    const actionEl = $('#settingsSpotifyAction');
    if (status.connected) {
      statusEl.textContent = `✓ Conectado como ${status.email} (${status.plan})`;
      actionEl.textContent = 'Desconectar';
      actionEl.onclick = async () => {
        await window.api.spotifyAccount.disconnect();
        await refreshSpotifySettings();
      };
    } else {
      statusEl.textContent = 'Não conectado · downloads do Spotify usam YouTube como fonte.';
      actionEl.textContent = 'Conectar Spotify';
      actionEl.onclick = async () => {
        const res = await window.api.spotifyAccount.connect();
        if (!res.ok) alert(res.userMessage || 'Falha ao conectar.');
        await refreshSpotifySettings();
      };
    }
  }

  $('#settingsBtn').addEventListener('click', async () => {
    await refreshSettingsRows();
    await refreshSpotifySettings();
    $('#settingsDialog').showModal();
  });

  $('#settingsChangeFolder').addEventListener('click', async () => {
    const cfg = await window.api.config.get();
    const r = await window.api.dialog.pickFolder(cfg.outputDir);
    if (r.ok) {
      await window.api.config.set({ outputDir: r.path });
      await refreshSettingsRows();
    }
  });

  $('#settingsResetLibrary').addEventListener('click', async () => {
    if (confirm('Apagar histórico de downloads? Tracks já no disco continuam, mas o app deixará de pular re-downloads.')) {
      await window.api.library.reset();
    }
  });

  window.addEventListener('app:tier3', (e) => {
    const { userMessage, reference } = e.detail;
    $('#tier3Message').textContent = userMessage;
    $('#tier3Reference').textContent = reference || '------';
    $('#tier3Dialog').showModal();
  });
}

function wireTabSwitching() {
  const tabs = $$('.tab');
  const panels = {
    spotify: $('#spotifyPanel'),
    youtube: $('#youtubePanel'),
    soundcloud: $('#soundcloudPanel'),
  };
  tabs.forEach((btn) => {
    btn.addEventListener('click', () => {
      tabs.forEach(t => t.classList.toggle('active', t === btn));
      Object.entries(panels).forEach(([name, el]) => { el.hidden = name !== btn.dataset.tab; });
    });
  });
}

init().catch(console.error);
