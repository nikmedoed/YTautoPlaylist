import { signIn, setupAuthStatusListener } from './auth.js';
import {
  getSubscriptionsId,
  getUploadsLists,
  getNewVideos,
  addListToWL,
  createPlayList,
  getVideoInfo,
  isShort,
} from './youTubeApiConnectors.js';
import { logMessage, storeDate, parseDuration, formatDate } from './utils.js';
import { filterID } from './filters.js';

const originalLog = console.log.bind(console);
const logMessages = [];
console.log = (...args) => {
  logMessages.push(args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' '));
  if (logMessages.length > 100) logMessages.shift();
  originalLog(...args);
};

// Development helpers. Set DEV to true to always start from the last 24h.
// Optionally set START_FROM_VIDEO_ID to resume from a particular video.
const DEV = false;
const START_FROM_VIDEO_ID = null;

chrome.storage.sync.get(["lastVideoDate"], function (result) {
  if (!result.lastVideoDate) {
    storeDate(new Date(Date.now() - 604800000));
  }
});

setupAuthStatusListener(updateSigninStatus);

function updateSigninStatus(isSignedIn) {
  if (isSignedIn) {
    chrome.action.onClicked.removeListener(signIn);
    chrome.action.onClicked.addListener(process);
  } else {
    chrome.action.onClicked.removeListener(process);
    chrome.action.onClicked.addListener(signIn);
  }
}

function process() {
  if (DEV) {
    main(new Date(Date.now() - 24 * 60 * 60 * 1000));
    return;
  }
  chrome.storage.sync.get(["lastVideoDate"], async result => {
    let mainDate;
    if (START_FROM_VIDEO_ID) {
      const info = await getVideoInfo([START_FROM_VIDEO_ID]);
      mainDate = new Date(info[0].pubDate);
      await storeDate(mainDate);
    } else {
      mainDate = result.lastVideoDate ? new Date(result.lastVideoDate) : new Date(Date.now() - 24 * 60 * 60 * 1000);
    }
    console.log("startDate", mainDate);
    main(mainDate);
  });
}

async function main(startDate = new Date(Date.now() - 604800000)) {
  const subs = await getSubscriptionsId();
  console.log('Subscriptions count:', subs.length);
  console.log('Subscriptions list:', subs);

  const ids = subs.map(s => s.id);
  const uploads = [];
  while (ids.length) {
    uploads.push(...await getUploadsLists(ids.splice(-50)));
  }
  console.log('Subscriptions upload lists count:', uploads.length);
  console.log('Subscriptions getUploadsLists:', uploads);

  console.log('Loading videos from', uploads.length, 'playlists');
  const results = await Promise.all(
    uploads.map(pl => getNewVideos(pl, startDate).then(r => ({ playlist: pl, videos: r.videos, pages: r.pages })))
  );

  const allVideos = [];
  const playlistMap = {};
  const stats = {};
  for (const r of results) {
    if (r.videos.length === 0) continue;
    stats[r.playlist] = { new: r.videos.length, filtered: 0, shorts: 0, add: 0 };
    for (const v of r.videos) {
      playlistMap[v.vId] = r.playlist;
      allVideos.push(v);
    }
  }
  console.log('Fetched', allVideos.length, 'videos');

  const { videos, shorts, filtered } = await filterID(allVideos.map(a => a.vId));
  for (const id of filtered) {
    const pl = playlistMap[id];
    if (stats[pl]) stats[pl].filtered++;
  }
  for (const v of videos) {
    const pl = playlistMap[v.vId];
    stats[pl].add++;
    v.playlist = pl;
  }
  for (const id of shorts) {
    const pl = playlistMap[id];
    if (stats[pl]) stats[pl].shorts++;
  }
  for (const [pl, st] of Object.entries(stats)) {
    if (st.new || st.filtered || st.shorts || st.add) {
      console.log(`Playlist ${pl} new ${st.new}, filtered ${st.filtered}, shorts ${st.shorts}, to playlist ${st.add}`);
    }
  }
  console.log('After filtering:', videos.length, 'videos');

  const unique = [];
  const seen = new Set();
  for (const v of videos.sort((a, b) => new Date(a.pubDate) - new Date(b.pubDate))) {
    if (!seen.has(v.vId)) {
      seen.add(v.vId);
      unique.push(v);
    }
  }

  console.log('New Videos:', unique);
  console.log(
    unique
      .map(e => [
        parseDuration(e.duration),
        formatDate(e.pubDate),
        e.channelTitle,
        e.title,
        e.vId
      ].join('\t'))
      .join('\n')
  );

  return createListAndAddVideos(unique);
}

function createListAndAddVideos(list) {
  if (!list || list.length === 0) {
    console.warn('No videos to add');
    return Promise.resolve(0);
  }
  const title = `WL ${formatDate(list[0].pubDate)} - ${formatDate(list[list.length - 1].pubDate)}`
  return createPlayList(title)
    .then(plst => {
      let playlistId = plst.id
      console.log(`Created playlist https://www.youtube.com/playlist?list=${playlistId}`)
      return addListToWL(storeDate, playlistId, list)
        .then(count => {
          storeDate((list[count - 1] || list[list.length - 1]).pubDate)
          console.log(`https://www.youtube.com/playlist?list=${playlistId}`)
          return count
        })
    })
    .catch(err => {
      const reason = err.error?.errors?.[0]?.reason || ''
      switch (reason) {
        case 'rateLimitExceeded':
          logMessage('warn', 'create', list.length, 'Rate limit exceeded, retry in 8 min')
          return new Promise(r => setTimeout(r, 8 * 60 * 1000 + 500)).then(() => createListAndAddVideos(list))
        case 'quotaExceeded':
          logMessage('error', 'create', list.length, 'Quota exceeded')
          return 0
        default:
          logMessage('error', 'create', list.length, err.error?.message || err.message)
          return 0
      }
    })
}





chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  switch (request.type) {
    case 'signIn':
      signIn();
      break;
    case 'process':
      process();
      break;
    case 'getLogs':
      sendResponse({ logs: logMessages });
      return true;
  }
  return true;
});


