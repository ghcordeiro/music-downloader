import { initSpotifyTab } from './tabs/spotify.js';

const $ = (s, root = document) => root.querySelector(s);

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
}

init().catch((err) => {
  console.error(err);
});
