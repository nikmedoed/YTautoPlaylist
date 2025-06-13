var authorizeButton = document.getElementById('authorize-button');
var addButton = document.getElementById('add-button');
var logsButton = document.getElementById('logs-button');
var logArea = document.getElementById('log');


authorizeButton.onclick = handleAuthClick;
addButton.onclick = handleAdd;
logsButton.onclick = handleLogs;

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
        authorizeButton.style.display = 'none';
        addButton.style.display = 'block';
    } else {
        authorizeButton.style.display = 'block';
        addButton.style.display = 'none';
    }
}

function handleAuthClick(event) {
    chrome.runtime.sendMessage({type: "signIn"})
}


function handleAdd(event) {
    chrome.runtime.sendMessage({type: "process"})
}

function handleLogs(event) {
    chrome.runtime.sendMessage({type: 'getLogs'}, response => {
        if (response && response.logs) {
            logArea.textContent = response.logs.join('\n');
        }
    })
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


