// yt-dlp command builder for the list manager. It produces a copyable
// PowerShell command and never downloads anything itself.
const YOUTUBE_WATCH_URL = "https://www.youtube.com/watch?v=";

const FORMAT_OPTIONS = {
  best: [],
  mp4: ["-f", "bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/b"],
  "mp4-720": [
    "-f",
    "bv*[height<=720][ext=mp4]+ba[ext=m4a]/b[height<=720][ext=mp4]/b[height<=720]",
  ],
  mp3: ["-f", "bestaudio/best", "-x", "--audio-format", "mp3"],
  m4a: ["-f", "bestaudio[ext=m4a]/bestaudio/best", "-x", "--audio-format", "m4a"],
};

function quotePowerShell(value) {
  return `"${String(value).replace(/`/g, "``").replace(/"/g, '`"')}"`;
}

function normalizePath(value) {
  return String(value || "").trim();
}

export function buildVideoUrls(queue) {
  if (!Array.isArray(queue)) return [];
  const seen = new Set();
  const urls = [];
  for (const video of queue) {
    const id = String(video?.id || "").trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    urls.push(`${YOUTUBE_WATCH_URL}${encodeURIComponent(id)}`);
  }
  return urls;
}

export function buildYtdlpCommand(queue, options = {}) {
  const urls = buildVideoUrls(queue);
  if (!urls.length) return "";

  const args = ["--batch-file", "-"];
  args.push(...(FORMAT_OPTIONS[options.format] || FORMAT_OPTIONS.best));

  if (options.quiet === true) args.push("--quiet", "--no-warnings");
  if (options.ignoreErrors !== false) args.push("--ignore-errors");
  if (options.continueDownloads !== false) args.push("--continue");
  if (options.noOverwrites) args.push("--no-overwrites");
  if (options.windowsFilenames !== false) args.push("--windows-filenames");
  if (options.embedMetadata) args.push("--embed-metadata");
  if (options.embedThumbnail) args.push("--embed-thumbnail");
  if (options.downloadArchive) args.push("--download-archive", "downloaded.txt");
  if (options.cookiesFromBrowser) args.push("--cookies-from-browser", options.cookiesFromBrowser);

  const outputDir = normalizePath(options.outputDir) || ".";
  const outputTemplate = "%(title).200B [%(id)s].%(ext)s";
  args.push("-P", outputDir, "-o", outputTemplate);

  const quotedArgs = args.map(quotePowerShell).join(" ");
  const quotedUrls = urls.map((url) => `  ${quotePowerShell(url)}`).join(",\n");
  return `$urls = @(\n${quotedUrls}\n)\n$urls | yt-dlp ${quotedArgs}`;
}
