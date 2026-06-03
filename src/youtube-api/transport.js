// YouTube API transport layer. Contains authenticated fetch calls, token refresh handling, errors, and test injection hooks.
import { getToken, signInUser, clearToken } from "../auth.js";

async function defaultCallApi(path, params = {}, method = "GET", body = null, retry) {
  const token = await getToken();
  const url = new URL("https://www.googleapis.com/youtube/v3/" + path);
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null) url.searchParams.set(k, v);
  });
  const init = {
    method,
    headers: { Authorization: "Bearer " + token, Accept: "application/json" },
  };
  if (body) {
    init.headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(body);
  }
  const resp = await fetch(url.toString(), init);
  if (!resp.ok) {
    if ((resp.status === 401 || resp.status === 403) && !retry) {
      clearToken();
      try {
        await signInUser();
      } catch (e) {
        const text = await resp.text();
        const err = new Error("API " + path + " failed: " + resp.status);
        err.status = resp.status;
        err.body = text;
        err.error = e;
        throw err;
      }
      return defaultCallApi(path, params, method, body, true);
    }
    const text = await resp.text();
    const err = new Error("API " + path + " failed: " + resp.status);
    err.status = resp.status;
    err.body = text;
    try {
      err.error = JSON.parse(text);
    } catch {
      err.error = text;
    }
    throw err;
  }
  return resp.json();
}

let callApiImpl = defaultCallApi;

export function __setCallApi(fn) {
  callApiImpl = fn;
}

export async function callApi(path, params = {}, method = "GET", body = null, retry) {
  return callApiImpl(path, params, method, body, retry);
}
