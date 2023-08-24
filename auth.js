chrome.storage.local.set({authStatus: false})

function onGAPILoad() {
    return gapi.load("client:auth2", 
        {
            callback: function() {                
                return gapi.client.init({
                        apiKey: API_KEY,
                        discoveryDocs: YTREST,
                    }).then(function () {
                        console.log('gapi initialized')
                        setToken()
                    }, function(error) {
                        console.log('error', error)
                    })
            },
            onerror: function() {
                console.log('gapi.client failed to load!');
            },
            timeout: 5000, // 5 seconds.
            ontimeout: function() {
                console.log('gapi.client could not load in a timely manner!');
            }
        })
}

function setToken(){
    chrome.identity.getAuthToken({interactive: true}, function(token) {   
        gapi.auth.setToken({
            'access_token': token,
        });
        gapi.client.setApiKey(API_KEY);                
        console.log("Token OK")
        chrome.storage.local.set({authStatus: true})
    })
}

function authenticate() {
    return gapi.auth2.getAuthInstance()
        .signIn({scope: "https://www.googleapis.com/auth/youtube"})
        .then(function() { console.log("Sign-in successful"); },
                function(err) { console.error("Error signing in", err); });
}

function loadClient() {
    gapi.client.setApiKey(API_KEY);
    return gapi.client.load("https://www.googleapis.com/discovery/v1/apis/youtube/v3/rest")
        .then(function(res) { console.log("GAPI client loaded for API", res); },
            function(err) { console.error("Error loading GAPI client for API", err); });
}




// gapi.auth2.init({client_id: EXTOAuthID})
// .then(
//     response => {
//         console.log("inited", response);
//     },
//     function(err) { console.error("Error initing ", err); }
// );