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
    chrome.browserAction.onClicked.removeListener(signIn);
    chrome.browserAction.onClicked.addListener(process);
  } else {
    chrome.browserAction.onClicked.removeListener(process);
    chrome.browserAction.onClicked.addListener(signIn);
  }
}

function signIn() {
  console.log("howtosignIn?");
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
      .then((e) =>
        Promise.all(e.map((el) => getNewVideos(el, startDate)))
          .then((e) => [].concat(...e))
      )
      .then(el => filterID(el.map(a => a.vId)))
      .then((el) => {
        elems = el.sort((a, b) => new Date(a.pubDate) - new Date(b.pubDate));
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
  title = `WL ${formatDate(list[0].pubDate)} - ${formatDate(list[list.length - 1].pubDate)}`
  return createPlayList(title)
    .then(plst => {
      let playlistId = plst.result.id
      console.log(`Created playlist`)
      console.log(playlistId)
      addListToWL(storeDate, playlistId, list)
        .then(count => {
          storeDate((list[count - 1] || list[list.length - 1]).pubDate)
          console.log(`https://www.youtube.com/playlist?list=${playlistId}`)
        })
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
function filterID(list) {

  const TITLEFILTER = {
    'UC7Elc-kLydl-NAV4g204pDQ': ['новости |', 'военное положение |'],
    'UCt7sv-NKh44rHAEb-qCCxvA': ['ostronews', 'iphone'],
    'UC8zQiuT0m1TELequJ5sp5zw': ['подкаст', 'подкаст', 'спецэфир'],
    'UC3cJiUuZlpF-pkzqvSskTpg': ['разгоны #', 'чувс', 'книжный клуб'],
    'UCixlrqz8w-oa4UzdKyHLMaA': ['yet another podcast'],
    'UCn9bv143ECsDMw-kJCNN7QA': ['подземелья чикен']
  }
  

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
  ]

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
      video.liveStreamingDetails
      && video.liveStreamingDetails.actualStartTime != video.liveStreamingDetails.scheduledStartTime
      && BROADCASTFILLTER.includes(video.channelId)
    )
  ]

  return Promise.all(list
    .slice(0, Math.ceil(list.length / 50))
    .map(elem => getVideoInfo(list.splice(-50))))
    .then(e => [].concat(...e))
    .then(list => list
      .filter(video => filters.every(fltr => fltr(video)))
    )

  // .then(list => list
  //   .filter(video => !filters.every(fltr => fltr(video)))
  // )
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

// chrome.extension.onMessage.addListener(
//     function(request, sender, sendResponse) {
//         switch (request['type']){
//             case "signIn":
//                 signIn()
//             break
//             case "process":
//                 process()
//             break
//         }
//         // sendResponse({success: true})
//         // return true
//     }
// );

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
