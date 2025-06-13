// Manage OAuth token using chrome.identity without gapi
if (typeof chrome !== 'undefined') {
  chrome.storage.local.set({ authStatus: false });
}
let currentToken = null;

export function signInUser() {
  if (typeof chrome === 'undefined') {
    return Promise.reject(new Error('chrome API unavailable'));
  }
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

export function getToken() {
  if (typeof chrome === 'undefined') {
    return Promise.reject(new Error('chrome API unavailable'));
  }
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

export function signIn() {
  return signInUser().catch(err => {
    console.error('Sign-in failed', err);
    throw err;
  });
}

export function setupAuthStatusListener(callback) {
  if (typeof chrome === 'undefined') return;
  chrome.storage.onChanged.addListener(function (changes) {
    if ('authStatus' in changes) {
      callback(changes['authStatus'].newValue);
    }
  });
  chrome.storage.local.get(['authStatus'], function (result) {
    callback(result.authStatus);
  });
}
