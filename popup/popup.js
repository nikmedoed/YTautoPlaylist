var authorizeButton = document.getElementById('authorize-button');
var addButton = document.getElementById('add-button');


authorizeButton.onclick = handleAuthClick;
addButton.onclick = handleAdd;

chrome.storage.onChanged.addListener(function(changes, namespace) {
    if ("authStatus" in changes){
        updateSigninStatus(changes["authStatus"].newValue)
    }
})
chrome.storage.local.get(['authStatus'], function(result) {
    updateSigninStatus(result.authStatus);
})

function updateSigninStatus(isSignedIn) {
    if (isSignedIn) {
        chrome.browserAction.onClicked.removeListener(handleAuthClick);
        chrome.browserAction.onClicked.addListener(handleAdd);
    } else {
        chrome.browserAction.onClicked.removeListener(handleAdd);
        chrome.browserAction.onClicked.addListener(handleAuthClick);
    }
}

function handleAuthClick(event) {
    chrome.runtime.sendMessage({type: "signIn"})
}


function handleAdd(event) {
    chrome.runtime.sendMessage({type: "process"})
}


// function updateSigninStatus(isSignedIn) {
//     if (isSignedIn) {
//         authorizeButton.style.display = 'none';
//         addButton.style.display = 'block';
//     } else {
//         authorizeButton.style.display = 'block';
//         addButton.style.display = 'none';
//     }
// }


// insert to browser action in manifest 
// "default_popup": "popup/popup.html"