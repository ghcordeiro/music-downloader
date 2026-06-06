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
  $('#welcome').hidden = false;
  $('#welcomeFolder').textContent = `📁 ${cfg.outputDir}`;
  $('#welcomeStart').addEventListener('click', async () => {
    await window.api.config.set({ firstRunCompleted: true });
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
