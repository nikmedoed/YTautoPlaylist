importScripts('keys.js', 'auth.js', 'youTubeApiConnectors.js');

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
  return new Promise(resolve => {
    chrome.storage.sync.set({ lastVideoDate: date.toString() }, () => {
      console.log("lastVideoDate is set to " + date);
      resolve();
    });
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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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

// TODO На пустом списке для добавления ломается
// TODO Теперь требуется использоавть приложение только на странице ютуба, иначе куки не видит
// TODO аккумулировать id + ошибки
// TODO проверять наличие логина, иначе ошибка
// TODO иногда пытается добавлять 2 раза подряд видео, первый успешный, второй с ошибкой, т.к. видео уже в листе
// TODO добавлять все видео со страницы в смотреть позде (со страницы пользователя, к примеру)
// TODO удалять просмотренное из WL
// TODO при первом запуске выводить страницу настроек, на которой будет пояснение за работу
// TODO устанавливать частоту итераций
// TODO судя по всем количичество видео сверять смысла нет, т.к. это тратит столько же, сколько посмотреть список видео и проверить появилось ли что-то свежее
// TODO сохранять подписки в базу, получать листы только для новых подписок
// TODO Допилить метод с подписками до поиска новых
// TODO Не смотреть видео на тех каналах, где число видео с прошлого раза не поменялось
// TODO Если закончилась квота, паузиться на сутки с добавлением и вообще везде, где пауза проихошла выжидать
// TODO добавить фильтрацию
// TODO сохранять очередь добавления, чтобы возвращаться к недобавленному
// TODO организовать циклическое еженедельно добавление
// TODO отлавливать блок по квоте
// TODO обрабатывать вразумительнее ошибки
// TODO всплывающее окно со статусом загрузки
function main(startDate = new Date(new Date() - 604800000)) {
  return (
    getSubscriptionsId()
      .then((res) => {
        console.log("Subscriptions count:", res.length);
        console.log("Subscriptions list:", res);
        return res;
      })
      .then((res) => res.map((item) => item.id))
      .then((l) => Promise.all(
        l.slice(0, Math.ceil(l.length / 50))
          .map((elem) => getUploadsLists(l.splice(-50)))
      )
        .then((e) => [].concat(...e))
      )
      .then((res) => {
        console.log("Subscriptions upload lists count:", res.length);
        console.log("Subscriptions getUploadsLists:", res);
        return res;
      })
      .then((e) => {
        console.log('Loading videos from', e.length, 'playlists');
        return Promise.all(e.map(pl => getNewVideos(pl, startDate).then(r => ({ playlist: pl, videos: r.videos, pages: r.pages }))))
          .then(res => res);
      })
      .then(results => {
        const allVideos = [];
        const playlistMap = {};
        const stats = {};
        results.forEach(r => {
          if (r.videos.length === 0) return;
          stats[r.playlist] = { new: r.videos.length, filtered: 0, shorts: 0, add: 0 };
          r.videos.forEach(v => {
            playlistMap[v.vId] = r.playlist;
            allVideos.push(v);
          });
        });
        console.log('Fetched', allVideos.length, 'videos');
        return filterID(allVideos.map(a => a.vId)).then(({ videos, shorts, filtered }) => {
          filtered.forEach(id => {
            const pl = playlistMap[id];
            if (stats[pl]) stats[pl].filtered++;
          });
          videos.forEach(v => {
            const pl = playlistMap[v.vId];
            stats[pl].add++;
            v.playlist = pl;
          });
          shorts.forEach(id => {
            const pl = playlistMap[id];
            if (stats[pl]) stats[pl].shorts++;
          });
          Object.entries(stats).forEach(([pl, st]) => {
            if (st.new || st.filtered || st.shorts || st.add) {
              console.log(`Playlist ${pl} new ${st.new}, filtered ${st.filtered}, shorts ${st.shorts}, to playlist ${st.add}`);
            }
          });
          console.log('After filtering:', videos.length, 'videos');
          return videos;
        });
      })
      .then((el) => {
        const seen = new Set();
        elems = el
          .sort((a, b) => new Date(a.pubDate) - new Date(b.pubDate))
          .filter(v => {
            if (seen.has(v.vId)) return false;
            seen.add(v.vId);
            return true;
          });
        return elems;
      })
      .then(list => {
        console.log('New Videos:', list)
        // console.log(list.map(e => `${formatDate(e.pubDate)}`).join("\n"))
        console.log(list.map(e => [
          parseDuration(e.duration),
          formatDate(e.pubDate),
          e.channelTitle,
          e.title,
          e.vId].join('\t')).join("\n"))
        return list
      })
      .then(createListAndAddVideos)
  );
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
  title = `WL ${formatDate(list[0].pubDate)} - ${formatDate(list[list.length - 1].pubDate)}`
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
          console.error('Rate limit exceeded while creating playlist')
          break
        case 'quotaExceeded':
          console.error('Quota exceeded while creating playlist')
          break
        default:
          console.error('Failed to create playlist', err.error?.message || err.message)
      }
      return 0
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


// виды фильтров Канал+длительность
// наличие в названии
// канал + тег
// тег
// длительность
// трансляция ли + канал/название
async function filterID(list) {
  console.log('Fetching info for', list.length, 'videos');
  const TITLEFILTER = {
    'UC7Elc-kLydl-NAV4g204pDQ': ['новости |', 'военное положение |'],
    'UCt7sv-NKh44rHAEb-qCCxvA': ['ostronews', 'iphone'],
    'UC8zQiuT0m1TELequJ5sp5zw': ['подкаст', 'подкаст', 'спецэфир'],
    'UC3cJiUuZlpF-pkzqvSskTpg': ['разгоны #', 'чувс', 'книжный клуб'],
    'UCixlrqz8w-oa4UzdKyHLMaA': ['yet another podcast'],
    'UCn9bv143ECsDMw-kJCNN7QA': ['подземелья чикен']
  };
  const BROADCASTFILLTER = [
    'UC7Elc-kLydl-NAV4g204pDQ',
    'UCt7sv-NKh44rHAEb-qCCxvA',
    'UCUGfDbfRIx51kJGGHIFo8Rw',
    'UCBG57608Hukev3d0d-gvLhQ',
    'UCjQdM9q_Vd2gBN9Xy_zRDJQ',
    'UCKRC-fNrU-XvZTrwXN4Xxcg',
    'UC5EgIZja1sE3IF9U_CKEVew',
    'UCBq6jERElPLXL5cEy-sA9Tw',
    'UC6uFoHcr_EEK6DgCS-LeTNA',
    'UCY649zJeJVhhJa-rvWThZ2g',
    'UCUmlB9SwrBVevETZV0wrVRw',
    'UCQ_LYRUJzBfh-mvU14xCNMw',
    'UCTUyoZMfksbNIHfWJjwr5aQ'
  ];
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
      BROADCASTFILLTER.includes(video.channelId)
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

// chrome.notifications.create(null,
//     {
//         title: "J{J{J{J{J",
//         message: "sdfsfkjshdfkjsdfkjhsdfjhk",
//         type: "progress",
//         iconUrl: "icon/icon.png",
//         priority: 2,
//         progress: 0,
//         silent: true,
//         buttons: [{title: "OK"}]
//     },
//     async e => {
//         let id = e
//         console.log(id)
//         for (var i = 1; i < 101; i++) {
//             chrome.notifications.update(id,
//             {
//                 title: `Добавление ${i}/100`,
//                 progress: i
//             },function() { return true})
//             await sleep(1500);
//         }
//         return
//     })
//             chrome.notifications.update(id,
//         for (var i = 1; i < 101; i++) {
//             chrome.notifications.update(id,
//             {
//                 title: `Добавление ${i}/100`,
//                 progress: i
//             },function() { return true})
//             await sleep(1500);
//         }
//         return
//     })
//             {
//         for (var i = 1; i < 101; i++) {
//             chrome.notifications.update(id,
//             {
//                 title: `Добавление ${i}/100`,
//                 progress: i
//             },function() { return true})
//             await sleep(1500);
//         }
//         return
//     })
//                 title: `Добавление /100`,
//         for (var i = 1; i < 101; i++) {
//             chrome.notifications.update(id,
//             {
//                 title: `Добавление ${i}/100`,
//                 progress: i
//             },function() { return true})
//             await sleep(1500);
//         }
//         return
//     })
//                 progress: i
//         for (var i = 1; i < 101; i++) {
//             chrome.notifications.update(id,
//             {
//                 title: `Добавление ${i}/100`,
//                 progress: i
//             },function() { return true})
//             await sleep(1500);
//         }
//         return
//     })
//             },function() { return true})
//         for (var i = 1; i < 101; i++) {
//             chrome.notifications.update(id,
//             {
//                 title: `Добавление ${i}/100`,
//                 progress: i
//             },function() { return true})
//             await sleep(1500);
//         }
//         return
//     })
//             await sleep(1500);
//         for (var i = 1; i < 101; i++) {
//             chrome.notifications.update(id,
//             {
//                 title: `Добавление ${i}/100`,
//                 progress: i
//             },function() { return true})
//             await sleep(1500);
//         }
//         return
//     })
//         }
//         for (var i = 1; i < 101; i++) {
//             chrome.notifications.update(id,
//             {
//                 title: `Добавление ${i}/100`,
//                 progress: i
//             },function() { return true})
//             await sleep(1500);
//         }
//         return
//     })
//         return
//         for (var i = 1; i < 101; i++) {
//             chrome.notifications.update(id,
//             {
//                 title: `Добавление ${i}/100`,
//                 progress: i
//             },function() { return true})
//             await sleep(1500);
//         }
//         return
//     })

