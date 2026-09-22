import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import * as cheerio from "cheerio";

const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36";

export function detectNovelSite(rawUrl) {
  const url = new URL(rawUrl);
  const host = url.hostname.toLowerCase();
  if (host === "ncode.syosetu.com" || host.endsWith(".syosetu.com")) return "narou";
  if (host === "kakuyomu.jp" || host.endsWith(".kakuyomu.jp")) return "kakuyomu";
  if (host === "alphapolis.co.jp" || host.endsWith(".alphapolis.co.jp")) return "alphapolis";
  if (host === "caita.ai" || host.endsWith(".caita.ai")) return "caita";
  return "generic";
}

function clean(text) {
  return String(text || "").replace(/\r/g, "").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

async function fetchHtml(url, extraHeaders = {}) {
  const response = await fetch(url, {
    redirect: "follow",
    headers: { "user-agent": USER_AGENT, accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8", "accept-language": "ja,en-US;q=0.9,en;q=0.8", "cache-control": "no-cache", "upgrade-insecure-requests": "1", ...extraHeaders }
  });
  if (!response.ok) throw new Error("HTTP " + response.status + " while fetching " + url);
  return { url: response.url, html: await response.text() };
}

function uniqueLinks($, baseUrl, predicate) {
  const seen = new Set();
  const out = [];
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href");
    if (!href) return;
    let absolute;
    try { absolute = new URL(href, baseUrl).toString(); } catch { return; }
    if (!predicate(absolute) || seen.has(absolute)) return;
    seen.add(absolute);
    out.push({ url: absolute, label: clean($(el).text()) });
  });
  return out;
}

function narouRoot(rawUrl) {
  const u = new URL(rawUrl);
  const m = u.pathname.match(/^\/(n[0-9a-z]+)(?:\/\d+)?\/?$/i);
  return m ? u.origin + "/" + m[1].toLowerCase() + "/" : null;
}

async function narouIndex(rawUrl) {
  const root = narouRoot(rawUrl);
  if (!root) throw new Error("Unsupported Narou URL.");
  const { html } = await fetchHtml(root);
  const $ = cheerio.load(html);
  const title = clean($(".p-novel__title").first().text()) || clean($(".novel_title").first().text()) || clean($("h1").first().text());
  const author = clean($(".p-novel__author").first().text()) || clean($(".novel_writername").first().text());
  const synopsis = clean($(".p-novel__summary").first().text()) || clean($("#novel_ex").first().text());
  const code = new URL(root).pathname.split("/").filter(Boolean)[0];
  let episodes = uniqueLinks($, root, href => {
    const u = new URL(href);
    return u.hostname === "ncode.syosetu.com" && new RegExp("^/" + code + "/\\d+/?$", "i").test(u.pathname);
  });
  if (!episodes.length) episodes = [{ url: root, label: title || "本文" }];
  return { site: "narou", workUrl: root, title, author, synopsis, episodes };
}

async function narouEpisode(url) {
  const { html, url: finalUrl } = await fetchHtml(url);
  const $ = cheerio.load(html);
  const title = clean($(".p-novel__title").first().text()) || clean($(".novel_subtitle").first().text()) || clean($("h1").first().text());
  const body = clean($(".p-novel__text").text()) || clean($("#novel_honbun").text()) || clean($("article").text());
  if (!body) throw new Error("Narou body not found: " + finalUrl);
  return { url: finalUrl, title, body };
}

function kakuyomuRoot(rawUrl) {
  const u = new URL(rawUrl);
  const m = u.pathname.match(/^\/works\/(\d+)/);
  return m ? u.origin + "/works/" + m[1] : null;
}

async function kakuyomuIndex(rawUrl) {
  const root = kakuyomuRoot(rawUrl);
  if (!root) throw new Error("Unsupported Kakuyomu URL.");
  const { html } = await fetchHtml(root);
  const $ = cheerio.load(html);
  const title = clean($("h1").first().text()) || clean($("meta[property=\"og:title\"]").attr("content"));
  const author = clean($("[itemprop=\"author\"]").first().text()) || clean($("a[href^=\"/users/\"]").first().text());
  const synopsis = clean($("[itemprop=\"description\"]").first().text()) || clean($("meta[property=\"og:description\"]").attr("content"));
  const workId = new URL(root).pathname.split("/").filter(Boolean)[1];
  const episodes = uniqueLinks($, root, href => {
    const u = new URL(href);
    return u.hostname === "kakuyomu.jp" && new RegExp("^/works/" + workId + "/episodes/\\d+").test(u.pathname);
  });
  if (!episodes.length) throw new Error("Kakuyomu episode list was not found. Layout may have changed or access may be restricted.");
  return { site: "kakuyomu", workUrl: root, title, author, synopsis, episodes };
}

async function kakuyomuEpisode(url) {
  const { html, url: finalUrl } = await fetchHtml(url);
  const $ = cheerio.load(html);
  const title = clean($("h1").first().text()) || clean($("[itemprop=\"name\"]").first().text());
  let body = "";
  for (const selector of ["[itemprop=\"articleBody\"]", ".widget-episodeBody", ".episode-body", "article"]) {
    body = clean($(selector).first().text());
    if (body) break;
  }
  if (!body) throw new Error("Kakuyomu body not found: " + finalUrl);
  return { url: finalUrl, title, body };
}


function alphapolisRoot(rawUrl) {
  const u = new URL(rawUrl);
  const match = u.pathname.match(
    /^\/novel\/(\d+)\/(\d+)(?:\/episode\/\d+)?\/?$/i
  );
  return match ? u.origin + "/novel/" + match[1] + "/" + match[2] : null;
}

async function alphapolisIndex(rawUrl) {
  const root = alphapolisRoot(rawUrl);
  if (!root) throw new Error("Unsupported Alphapolis URL.");
  const { html } = await fetchHtml(root, { referer: "https://www.alphapolis.co.jp/" });
  const $ = cheerio.load(html);
  const title =
    clean($("h1.title").first().text()) ||
    clean($('meta[property="og:title"]').attr("content")) ||
    clean($("h1").first().text());
  const author =
    clean($(".author").first().text()) ||
    clean($('[class*="author"]').first().text());
  const synopsis =
    clean($(".abstract").first().text()) ||
    clean($('[class*="abstract"]').first().text()) ||
    clean($('meta[property="og:description"]').attr("content")) ||
    clean($('meta[name="description"]').attr("content"));
  const rootUrl = new URL(root);
  const prefix = rootUrl.pathname.replace(/\/$/, "") + "/episode/";
  const episodeAnchors = $(".episode a[href]");
  const seen = new Set();
  const episodes = [];
  episodeAnchors.each((_, element) => {
    const href = $(element).attr("href");
    if (!href) return;
    let absolute;
    try {
      absolute = new URL(href, root).toString();
    } catch {
      return;
    }
    const u = new URL(absolute);
    if (
      u.hostname !== rootUrl.hostname ||
      !u.pathname.startsWith(prefix) ||
      !/\/episode\/\d+\/?$/.test(u.pathname) ||
      seen.has(absolute)
    ) {
      return;
    }
    seen.add(absolute);
    episodes.push({ url: absolute, label: clean($(element).text()) });
  });
  if (!episodes.length) {
    const fallback = uniqueLinks($, root, href => {
      const u = new URL(href);
      return (
        u.hostname === rootUrl.hostname &&
        u.pathname.startsWith(prefix) &&
        /\/episode\/\d+\/?$/.test(u.pathname)
      );
    });
    episodes.push(...fallback);
  }
  if (!episodes.length) {
    throw new Error(
      "Alphapolis episode list was not found. The work may be unavailable, paid/rental-only, age-gated, or the site layout may have changed."
    );
  }
  return {
    site: "alphapolis",
    workUrl: root,
    title,
    author,
    synopsis,
    episodes
  };
}

async function alphapolisEpisode(url, workUrl) {
  const { html, url: finalUrl } = await fetchHtml(url, {
    referer: workUrl || alphapolisRoot(url) || "https://www.alphapolis.co.jp/"
  });
  const $ = cheerio.load(html);
  const title =
    clean($(".episode-title").first().text()) ||
    clean($('[class*="episode"][class*="title"]').first().text()) ||
    clean($("h1").first().text()) ||
    clean($("h2").first().text());
  const body = clean($("#novelBody").first().text());
  if (!body) {
    throw new Error(
      "Alphapolis body not found. The episode may be unavailable, paid/rental-only, age-gated, or the site layout may have changed: " +
        finalUrl
    );
  }
  return { url: finalUrl, title, body };
}

function caitaEpisodeUrl(rawUrl) {
  const u = new URL(rawUrl);
  const match = u.pathname.match(/^\/viewer\/episode\/([0-9A-HJKMNP-TV-Z]{26})\/?$/i);
  return match ? u.origin + "/viewer/episode/" + match[1].toUpperCase() : null;
}

function browserCandidates() {
  if (process.platform !== "win32") return [];
  const roots = [
    process.env.PROGRAMFILES,
    process.env["PROGRAMFILES(X86)"],
    process.env.LOCALAPPDATA
  ].filter(Boolean);
  const candidates = [];
  for (const root of roots) {
    candidates.push(path.join(root, "Microsoft", "Edge", "Application", "msedge.exe"));
    candidates.push(path.join(root, "Google", "Chrome", "Application", "chrome.exe"));
  }
  return [...new Set(candidates)];
}

async function findBrowserExecutable() {
  for (const candidate of browserCandidates()) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch {}
  }
  throw new Error("Caita requires Microsoft Edge or Google Chrome on this Windows PC.");
}

async function dumpDomWithBrowser(url) {
  const executable = await findBrowserExecutable();
  const profileDir = await fs.mkdtemp(path.join(os.tmpdir(), "novelight-caita-"));
  try {
    return await new Promise((resolve, reject) => {
      const child = spawn(
        executable,
        [
          "--headless=new",
          "--disable-gpu",
          "--disable-extensions",
          "--no-first-run",
          "--no-default-browser-check",
          "--user-agent=" + USER_AGENT,
          "--user-data-dir=" + profileDir,
          "--virtual-time-budget=12000",
          "--dump-dom",
          url
        ],
        { shell: false, windowsHide: true }
      );
      let stdout = "";
      let stderr = "";
      let settled = false;
      const timer = setTimeout(() => {
        child.kill();
        if (!settled) {
          settled = true;
          reject(new Error("Caita browser render timed out."));
        }
      }, 45000);
      child.stdout?.on("data", chunk => {
        if (stdout.length < 16 * 1024 * 1024) stdout += chunk.toString();
      });
      child.stderr?.on("data", chunk => {
        if (stderr.length < 1024 * 1024) stderr += chunk.toString();
      });
      child.on("error", error => {
        clearTimeout(timer);
        if (!settled) {
          settled = true;
          reject(error);
        }
      });
      child.on("close", code => {
        clearTimeout(timer);
        if (settled) return;
        settled = true;
        if (code !== 0 || !stdout.trim()) {
          reject(new Error("Caita browser render failed: " + clean(stderr).slice(0, 800)));
          return;
        }
        resolve(stdout);
      });
    });
  } finally {
    await fs.rm(profileDir, { recursive: true, force: true }).catch(() => {});
  }
}

function reserveLoopbackPort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(error => {
        if (error) reject(error);
        else if (!port) reject(new Error("Could not reserve a browser debug port."));
        else resolve(port);
      });
    });
  });
}

async function waitForCdpPage(port, expectedUrl) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch("http://127.0.0.1:" + port + "/json/list");
      if (response.ok) {
        const targets = await response.json();
        const page =
          targets.find(
            target =>
              target?.type === "page" &&
              String(target?.url || "").startsWith(expectedUrl)
          ) ||
          targets.find(
            target =>
              target?.type === "page" &&
              String(target?.url || "").includes("caita.ai/")
          );
        if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
      }
    } catch {}
    await sleep(250);
  }
  throw new Error("Caita visible browser did not expose a page target.");
}

async function readDomThroughCdp(webSocketUrl) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(webSocketUrl);
    let settled = false;
    const requestId = 1;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        socket.close();
        reject(new Error("Caita visible browser DOM read timed out."));
      }
    }, 20000);

    socket.addEventListener("open", () => {
      socket.send(
        JSON.stringify({
          id: requestId,
          method: "Runtime.evaluate",
          params: {
            expression: "document.documentElement.outerHTML",
            returnByValue: true
          }
        })
      );
    });
    socket.addEventListener("message", event => {
      let message;
      try {
        message = JSON.parse(String(event.data));
      } catch {
        return;
      }
      if (message.id !== requestId) return;
      clearTimeout(timer);
      settled = true;
      socket.close();
      const html = message?.result?.result?.value;
      if (typeof html !== "string" || !html.trim()) {
        reject(new Error("Caita visible browser returned an empty DOM."));
        return;
      }
      resolve(html);
    });
    socket.addEventListener("error", () => {
      clearTimeout(timer);
      if (!settled) {
        settled = true;
        reject(new Error("Caita visible browser DevTools connection failed."));
      }
    });
  });
}

async function dumpDomWithVisibleBrowser(url) {
  const executable = await findBrowserExecutable();
  const profileDir = await fs.mkdtemp(path.join(os.tmpdir(), "novelight-caita-visible-"));
  const port = await reserveLoopbackPort();
  let child;
  try {
    child = spawn(
      executable,
      [
        "--disable-extensions",
        "--no-first-run",
        "--no-default-browser-check",
        "--start-minimized",
        "--user-data-dir=" + profileDir,
        "--remote-debugging-address=127.0.0.1",
        "--remote-debugging-port=" + port,
        "--app=" + url
      ],
      { shell: false, windowsHide: false }
    );
    await new Promise((resolve, reject) => {
      const timer = setTimeout(resolve, 1200);
      child.once("error", error => {
        clearTimeout(timer);
        reject(error);
      });
    });
    const webSocketUrl = await waitForCdpPage(port, url);
    await sleep(12000);
    return await readDomThroughCdp(webSocketUrl);
  } finally {
    child?.kill();
    await sleep(500).catch(() => {});
    await fs.rm(profileDir, { recursive: true, force: true }).catch(() => {});
  }
}

function extractCaitaPage(html, finalUrl) {
  const $ = cheerio.load(html);
  $("script,style,noscript,nav,header,footer,aside").remove();
  const title =
    clean($('meta[property="og:title"]').attr("content")) ||
    clean($("h1").first().text()) ||
    clean($("title").first().text());
  const author =
    clean($('[class*="author"]').first().text()) ||
    clean($('meta[name="author"]').attr("content"));
  let body = "";
  for (const selector of [
    '[itemprop="articleBody"]',
    '[class*="episode-body"]',
    '[class*="episodeBody"]',
    '[class*="viewer"][class*="body"]',
    '[data-testid*="episode"]',
    '[role="main"]',
    "#__next",
    "#root",
    "article",
    "main",
    "body"
  ]) {
    const texts = $(selector)
      .toArray()
      .map(node => clean($(node).text()))
      .filter(Boolean)
      .sort((a, b) => b.length - a.length);
    if (texts[0] && texts[0].length > body.length) body = texts[0];
  }
  const blockedPage = /(?:just a moment|checking your browser|access denied|cloudflare|enable javascript and cookies|unusual traffic)/i.test(
    [title, body].join("\n")
  );
  if (!body || body.length < 80 || blockedPage) {
    throw new Error(
      "Caita body not found after render: " +
        finalUrl +
        " (renderedTextChars=" +
        body.length +
        ", blockedPage=" +
        blockedPage +
        ")"
    );
  }
  return {
    site: "caita",
    workUrl: finalUrl,
    title,
    author,
    synopsis: "",
    episodes: [{ url: finalUrl, label: title || "本文" }],
    inlineEpisode: { url: finalUrl, title, body }
  };
}

async function caitaPage(rawUrl) {
  const episodeUrl = caitaEpisodeUrl(rawUrl);
  if (!episodeUrl) throw new Error("Unsupported Caita URL. Use a public /viewer/episode/<id> URL.");

  try {
    const fetched = await fetchHtml(episodeUrl, {
      referer: "https://caita.ai/",
      "sec-fetch-dest": "document",
      "sec-fetch-mode": "navigate",
      "sec-fetch-site": "same-origin",
      "sec-fetch-user": "?1"
    });
    return extractCaitaPage(fetched.html, fetched.url);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/HTTP 403|Caita body not found/i.test(message)) throw error;
  }

  try {
    const renderedHtml = await dumpDomWithBrowser(episodeUrl);
    return extractCaitaPage(renderedHtml, episodeUrl);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/Caita body not found after render|Caita browser render/i.test(message)) {
      throw error;
    }
  }

  const visibleHtml = await dumpDomWithVisibleBrowser(episodeUrl);
  return extractCaitaPage(visibleHtml, episodeUrl);
}

async function genericPage(url) {
  const { html, url: finalUrl } = await fetchHtml(url);
  const $ = cheerio.load(html);
  $("script,style,noscript,nav,header,footer").remove();
  const title = clean($("h1").first().text()) || clean($("title").first().text());
  const body = clean($("main").text()) || clean($("body").text());
  return { site: "generic", workUrl: finalUrl, title, author: "", synopsis: "", episodes: [{ url: finalUrl, label: title || "本文" }], inlineEpisode: { url: finalUrl, title, body } };
}

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

export async function readNovel(rawUrl, options = {}) {
  const site = detectNovelSite(rawUrl);
  const delayMs = Math.max(300, Number(options.delayMs || 700));
  const maxEpisodes = Math.max(1, Math.min(1000, Number(options.maxEpisodes || 500)));
  const index = site === "narou" ? await narouIndex(rawUrl) : site === "kakuyomu" ? await kakuyomuIndex(rawUrl) : site === "alphapolis" ? await alphapolisIndex(rawUrl) : site === "caita" ? await caitaPage(rawUrl) : await genericPage(rawUrl);
  const selected = index.episodes.slice(0, maxEpisodes);
  const episodes = [];
  const failures = [];
  for (let i = 0; i < selected.length; i += 1) {
    const item = selected[i];
    try {
      const cached = options.cachedEpisodes?.[item.url];
      if (cached && !options.refreshExisting) {
        episodes.push({ ...cached, number: i + 1, cached: true });
      } else {
        let episode;
        if (index.inlineEpisode && i === 0) episode = index.inlineEpisode;
        else if (site === "narou") episode = await narouEpisode(item.url);
        else if (site === "kakuyomu") episode = await kakuyomuEpisode(item.url);
        else if (site === "alphapolis") episode = await alphapolisEpisode(item.url, index.workUrl);
        else episode = (await genericPage(item.url)).inlineEpisode;
        episodes.push({ number: i + 1, url: episode.url, title: episode.title || item.label || ("Episode " + (i + 1)), body: episode.body, cached: false });
      }
    } catch (error) {
      failures.push({ number: i + 1, url: item.url, error: error instanceof Error ? error.message : String(error) });
    }
    if (i < selected.length - 1) await sleep(delayMs);
  }
  return {
    site, workUrl: index.workUrl, title: index.title, author: index.author, synopsis: index.synopsis,
    discoveredEpisodes: index.episodes.length, requestedEpisodes: selected.length, fetchedEpisodes: episodes.length,
    complete: failures.length === 0 && selected.length === index.episodes.length,
    truncated: selected.length < index.episodes.length, failures, episodes
  };
}
