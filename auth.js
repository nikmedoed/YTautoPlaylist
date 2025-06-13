// Manage OAuth token using chrome.identity without gapi
chrome.storage.local.set({ authStatus: false });
let currentToken = null;

function signInUser() {
  return new Promise((resolve, reject) => {
    chrome.identity.getAuthToken({ interactive: true }, token => {
      if (chrome.runtime.lastError || !token) {
        console.error('Failed to obtain token', chrome.runtime.lastError);
        chrome.storage.local.set({ authStatus: false });
        reject(chrome.runtime.lastError);
      } else {
        currentToken = token;
        chrome.storage.local.set({ authStatus: true });
        resolve(token);
      }
    });
  });
}

function getToken() {
  if (currentToken) return Promise.resolve(currentToken);
  return new Promise((resolve, reject) => {
    chrome.identity.getAuthToken({ interactive: false }, token => {
      if (chrome.runtime.lastError || !token) {
        reject(chrome.runtime.lastError);
      } else {
        currentToken = token;
        resolve(token);
      }
    });
  });
}
