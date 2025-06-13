import { signInUser } from './auth.js';
import {
  getSubscriptionsId,
  getUploadsLists,
  getNewVideos,
  addListToWL,
  createPlayList,
  getVideoInfo,
  isShort,
} from './youTubeApiConnectors.js';
import { logMessage } from './logger.js';
import { TITLEFILTER, BROADCASTFILTER } from './constants.js';

const originalLog = console.log.bind(console);
const logMessages = [];
console.log = (...args) => {
  logMessages.push(args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' '));
  if (logMessages.length > 100) logMessages.shift();
  originalLog(...args);
};

chrome.storage.sync.get(["lastVideoDate"], function (result) {
  if (!result.lastVideoDate) {
    storeDate(new Date(new Date() - 604800000));
  }
});

function storeDate(date) {
  return chrome.storage.sync.set({ lastVideoDate: date.toString() }, function () {
    console.log("lastVideoDate is set to " + date);
  });
}

chrome.storage.onChanged.addListener(function (changes, namespace) {
  if ("authStatus" in changes) {
    updateSigninStatus(changes["authStatus"].newValue);
  }
});
chrome.storage.local.get(["authStatus"], function (result) {
  updateSigninStatus(result.authStatus);
});

function updateSigninStatus(isSignedIn) {
  if (isSignedIn) {
    chrome.action.onClicked.removeListener(signIn);
    chrome.action.onClicked.addListener(process);
  } else {
    chrome.action.onClicked.removeListener(process);
    chrome.action.onClicked.addListener(signIn);
  }
}

function signIn() {
  signInUser().catch(err => console.error('Sign-in failed', err));
}

// Legacy helper used for notification progress examples
// function sleep(ms) {
//   return new Promise(resolve => setTimeout(resolve, ms));
// }

function process() {

  main(new Date(Date.now() - 24 * 60 * 60 * 1000))

  // getVideoInfo(["fzmm4cCXPs4"]).then((e) => {
  //   // console.log('Date: '+ e)
  //   storeDate(new Date(e[0].pubDate));
  // });

  // chrome.storage.sync.get(["lastVideoDate"], function (result) {
  //   mainDate = new Date(result.lastVideoDate);
  //   console.log("startDate", mainDate);
  //   main(mainDate);
  // });
}

// document.querySelector('.post__title').textContent,
//window.location.href
// var button = document.createElement("button");
// button.innerHTML = "Save to Google Spreadsheets";



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
function formatDate(date) {
  const options = {
    year: '2-digit',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric'
  }
  return date.toLocaleString("ru", options)
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

function parseDuration(duration) {
  var reptms = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/;
  var hours = 0, minutes = 0, seconds = 0, totalseconds;

  if (reptms.test(duration)) {
    var matches = reptms.exec(duration);
    if (matches[1]) hours = Number(matches[1]);
    if (matches[2]) minutes = Number(matches[2]);
    if (matches[3]) seconds = Number(matches[3]);
    totalseconds = hours * 3600 + minutes * 60 + seconds;
  }
  return totalseconds
}


async function filterID(list) {
  console.log('Fetching info for', list.length, 'videos');
  const filters = [
    video => parseDuration(video.duration) > 61,
    video => {
      let titfilt = TITLEFILTER[video.channelId];
      if (titfilt && titfilt.length > 0) {
        let title = video.title.toLowerCase();
        return !titfilt.some(tit => title.includes(tit));
      }
      return true;
    },
    video => !(
      video.liveStreamingDetails &&
      video.liveStreamingDetails.actualStartTime != video.liveStreamingDetails.scheduledStartTime &&
      BROADCASTFILTER.includes(video.channelId)
    )
  ];
  const chunks = [];
  while (list.length) {
    chunks.push(await getVideoInfo(list.splice(-50)));
  }
  let info = [].concat(...chunks);
  console.log('Got details for', info.length, 'videos');
  const toCheck = [];
  const filtered = [];
  for (const video of info) {
    if (filters.every(fltr => fltr(video))) {
      toCheck.push(video);
    } else {
      filtered.push(video.vId);
    }
  }
  console.log('After basic filters:', toCheck.length, 'videos');
  const videos = [];
  const shorts = [];
  const quickShort = v =>
    parseDuration(v.duration) < 60 ||
    (v.tags && v.tags.some(t => /shorts/i.test(t))) ||
    v.title.toLowerCase().includes('#short');
  let checked = 0;
  const concurrency = 5;
  let index = 0;
  async function worker() {
    while (index < toCheck.length) {
      const video = toCheck[index++];
      if (quickShort(video)) {
        shorts.push(video.vId);
        checked++;
        continue;
      }
      try {
        const short = await isShort(video);
        if (short) shorts.push(video.vId); else videos.push(video);
      } catch (err) {
        console.error('Failed short check', err);
        videos.push(video);
      }
      checked++;
      if (checked % 5 === 0 || checked === toCheck.length) {
        console.log('Short checks', checked, '/', toCheck.length);
      }
    }
  }
  await Promise.all(Array(concurrency).fill(0).map(worker));
  console.log('After short filter:', videos.length, 'videos');
  return { videos, shorts, filtered };
}

// document.querySelector('#go-to-options').addEventListener(function() {
//     if (chrome.runtime.openOptionsPage) {
//       chrome.runtime.openOptionsPage();
//     } else {
//       window.open(chrome.runtime.getURL('options.html'));
//     }
//   });
// in manifest

// "content_scripts": [
//     {
//         "matches": [
//             "https://bumbu.me/*"
//     ],
//         "js": [
//             "inject.js"
//     ],
//     "run_at": "document_end"
//     }
// ],

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

// Example of progress notification, kept for future reference
// chrome.notifications.create(null, {/* ... */});

