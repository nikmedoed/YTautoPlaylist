import { parseVideoId } from '../utils.js';

document.addEventListener('DOMContentLoaded', () => {
  const startInput = document.getElementById('startDate');
  const saveBtn = document.getElementById('saveStartDate');
  const videoInput = document.getElementById('videoId');
  const useBtn = document.getElementById('useVideoId');

  chrome.storage.sync.get(['lastVideoDate'], res => {
    if (res.lastVideoDate) {
      const d = new Date(res.lastVideoDate);
      startInput.value = d.toISOString().slice(0, 16);
    }
  });

  saveBtn?.addEventListener('click', () => {
    const val = startInput.value;
    const dt = new Date(val);
    if (String(dt) !== 'Invalid Date') {
      chrome.runtime.sendMessage({ type: 'setStartDate', date: dt.toISOString() });
    }
  });

  useBtn?.addEventListener('click', () => {
    const id = parseVideoId(videoInput.value);
    if (!id) return;
    chrome.runtime.sendMessage({ type: 'videoDate', videoId: id }, response => {
      if (response && response.date) {
        startInput.value = response.date.slice(0, 16);
      }
    });
  });
});
