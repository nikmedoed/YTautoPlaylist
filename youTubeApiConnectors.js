// return promise with auth user subscritions list of dicts {title: "Channel name", id: "....", videos: tempVideoCount}
function getSubscriptionsId(pTok) {
  return gapi.client.youtube.subscriptions
    .list({
      part: 'snippet,contentDetails',
      maxResults: 50,
      mine: true,
      pageToken: pTok
    })
    .then(
      response => {
        console.log(
          'Items count',
          response.result.items.length,
          'NextPage',
          response.result.nextPageToken
        )
        // console.log("Items", response.result.items);
        let subs = response.result.items.map(element => {
          return {
            title: element.snippet.title,
            id: element.snippet.resourceId.channelId,
            videos: element.contentDetails.totalItemCount
          }
        })
        // console.log("Items", subs);
        if (response.result.nextPageToken) {
          return getSubscriptionsId(response.result.nextPageToken).then(
            response => subs.concat(response)
          )
        } else {
          return subs
        }
      },
      err => {
        console.error('Execute error', err)
      }
    )
}

//  return promise with uploads list id by userid
function getUploadsLists(userid) {
  return gapi.client.youtube.channels
    .list({
      part: 'contentDetails',
      id: userid.join(','),
      maxResults: 50
    })
    .then(
      function (response) {
        // console.log("Response getUploadsLists", response);
        return response.result.items.map(
          element => element.contentDetails.relatedPlaylists.uploads
        )
      },
      function (err) {
        console.error('userid', userid, 'Execute error getUploadsLists', err)
      }
    )
}

function getNewVideos(
  playlist,
  startDate = new Date(new Date() - 604800000),
  nextP
) {
  return gapi.client.youtube.playlistItems
    .list({
      part: 'contentDetails',
      maxResults: 50,
      playlistId: playlist,
      nextPageToken: nextP
    })
    .then(
      function (response) {
        newVid = response.result.items
          .map(element => {
            return {
              vId: element.contentDetails.videoId,
              pubDate: new Date(element.contentDetails.videoPublishedAt),
              videoInfo: element
            }
          })
          .filter(item => item.pubDate > startDate)
        if (response.totalResults == newVid.length && response.nextPageToken) {
          return getNewVideos(playlist, startDate, response.nextPageToken).then(
            e => newVid.concat(e)
          )
        } else {
          return newVid
        }
      },
      function (err) {
        console.error('Execute error', err, playlist)
        return []
      }
    )
}

function errorMessage(vId, count, message) {
  console.log(`Video id: ${vId} :: Count: ${count}\n${message}`)
}


//ToDo:  Упростить, сделать линейнее
function addListToWL(storeDateFunction, playlistId, list, count = 0) {
  if (count == list.length) {
    let mes = 'OK, added: ' + count
    console.log(mes)
    return count
  } else {
    let targetVideo = list[count]
    let vId = targetVideo.vId
    return addVideoToWL(vId, playlistId)
      .then(succ => {
        console.log(`OK: ${vId}, count ${count}/${list.length}`)
        // storeDateFunction(targetVideo.pubDate)
        return addListToWL(storeDateFunction, playlistId, list, count + 1)
      })
      .catch(err => {
        switch (err.result.error.errors[0].reason) {
          case 'videoAlreadyInPlaylist':
            errorMessage(vId, count, err.result.error.message)
            return addListToWL(storeDateFunction, playlistId, list, count + 1)
          case 'backendError':
            errorMessage(vId, count, 'Backend Error')
            return addListToWL(storeDateFunction, playlistId, list, count)
          case "rateLimitExceeded":
            errorMessage(vId, count, 'rate Limit Exceeded, 8 min pause')
            return new Promise((resolve, reject) => {
              setTimeout(() => {
                resolve(addListToWL(storeDateFunction, playlistId, list, count));
              }, 8 * 60 * 1000 + 500);
            });
          case 'quotaExceeded':
            errorMessage(vId, count, 'Quota exceeded')
            return count
          default:
            errorMessage(vId, count, err.result.error.message)
            console.error(err.result, err)
            return count
        }
      })
  }
}


function createPlayList(title) {
  return gapi.client.youtube.playlists.insert({
    part: 'snippet,status',
    resource: {
      status: { privacyStatus: 'unlisted' },
      snippet: { title: title }
    }
  })
}

function addVideoToWL(vId, playlistId) {
  return gapi.client.youtube.playlistItems.insert({
    part: 'snippet',
    resource: {
      snippet: {
        playlistId: playlistId,
        resourceId: {
          kind: 'youtube#video',
          videoId: vId
        }
      }
    }
  })
}

function getVideoInfo(idList, nextP) {
  return gapi.client.youtube.videos
    .list({
      part: 'snippet,contentDetails,liveStreamingDetails', //statistics
      maxResults: 50,
      id: idList.join(','),
      pageToken: nextP
    })
    .then(
      function (response) {
        // console.log(response)
        info = response.result.items.map(el => {
          return {
            vId: el.id,
            pubDate: el.snippet.publishedAt,
            id: el.id,
            ...el.snippet,
            ...el.contentDetails,
            // date: el.snippet.publishedAt,            
            // channel: el.snippet.channelId,
            // title: el.snippet.title,
            // channelTitle: el.snippet.channelTitle,
            // tags: el.snippet.tags,
            // broadcast: el.snippet.liveBroadcastContent,
            // duration: el.contentDetails.duration, //PT1H43M45S,
            liveStreamingDetails: el.liveStreamingDetails
          }
        })
        if (response.nextPageToken) {
          return getVideoInfo(idList, response.nextPageToken).then(e =>
            info.concat(e)
          )
        } else {
          return info
        }
      },
      function (err) {
        console.error('Execute error', err)
      }
    )
}
