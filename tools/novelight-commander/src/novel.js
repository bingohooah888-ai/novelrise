import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import * as cheerio from "cheerio";

const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36 NOVELIGHT-Commander/0.6";
const BROWSER_USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36";

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
    headers: { "user-agent": USER_AGENT, accept: "text/html,application/xhtml+xml", ...extraHeaders }
  });
  if (!response.ok) throw new Error("HTTP " + response.status + " while fetching " + url);
  return { url: response.url, html: await response.text() };
}


function browserCandidates() {
  const configured = String(process.env.NOVELIGHT_COMMANDER_BROWSER_PATH || "").trim();
  const candidates = configured ? [configured] : [];
  if (process.platform === "win32") {
    const roots = [
      process.env.PROGRAMFILES,
      process.env["PROGRAMFILES(X86)"],
      process.env.LOCALAPPDATA
    ].filter(Boolean);
    for (const root of roots) {
      candidates.push(path.join(root, "Google", "Chrome", "Application", "chrome.exe"));
      candidates.push(path.join(root, "Microsoft", "Edge", "Application", "msedge.exe"));
    }
  } else if (process.platform === "darwin") {
    candidates.push("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome");
    candidates.push("/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge");
  } else {
    candidates.push("google-chrome", "chromium", "chromium-browser", "microsoft-edge", "msedge");
  }
  return [...new Set(candidates.filter(Boolean))];
}

async function browserExecutableAvailable(executable) {
  if (!path.isAbsolute(executable)) return true;
  try {
    await fs.access(executable);
    return true;
  } catch {
    return false;
  }
}

async function dumpDomWithBrowser(executable, url) {
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), "novelight-caita-"));
  const args = [
    "--headless=new",
    "--disable-gpu",
    "--disable-dev-shm-usage",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-sync",
    "--disable-component-update",
    "--metrics-recording-only",
    "--window-size=1280,900",
    "--virtual-time-budget=7000",
    "--user-data-dir=" + profile,
    "--user-agent=" + BROWSER_USER_AGENT,
    "--dump-dom",
    url
  ];
  try {
    return await new Promise((resolve, reject) => {
      const child = spawn(executable, args, {
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"]
      });
      let stdout = "";
      let stderr = "";
      let settled = false;
      const finish = (error, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (error) reject(error);
        else resolve(value);
      };
      const timer = setTimeout(() => {
        child.kill();
        finish(new Error("Browser render timed out."));
      }, 60000);
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", chunk => {
        stdout += chunk;
        if (stdout.length > 16_000_000) {
          child.kill();
          finish(new Error("Browser render output exceeded 16 MB."));
        }
      });
      child.stderr.on("data", chunk => {
        if (stderr.length < 1_000_000) stderr += chunk;
      });
      child.on("error", error => finish(error));
      child.on("close", code => {
        if (settled) return;
        if (code === 0 && /<html[\s>]/i.test(stdout)) {
          finish(null, stdout);
          return;
        }
        finish(
          new Error(
            "Browser render failed with code " +
              code +
              (stderr.trim() ? ": " + stderr.trim().slice(-1500) : "")
          )
        );
      });
    });
  } finally {
    await fs.rm(profile, { recursive: true, force: true }).catch(() => {});
  }
}

async function renderPublicHtml(url) {
  const errors = [];
  for (const executable of browserCandidates()) {
    if (!(await browserExecutableAvailable(executable))) continue;
    try {
      return await dumpDomWithBrowser(executable, url);
    } catch (error) {
      errors.push(
        path.basename(executable) +
          ": " +
          (error instanceof Error ? error.message : String(error))
      );
    }
  }
  throw new Error(
    "No usable Chrome/Edge browser was available for public-page rendering." +
      (errors.length ? " Attempts: " + errors.join(" | ") : "")
  );
}

function textWithBreaks($, element) {
  const clone = $(element).clone();
  clone.find("script,style,noscript,svg,button").remove();
  clone.find("br").replaceWith("\n");
  clone.find("p,li,blockquote,section").each((_, node) => {
    $(node).append("\n");
  });
  return clean(clone.text());
}

function dedupeRepeatedText(text) {
  const value = clean(text);
  if (value.length < 400) return value;
  const marker = value.slice(0, Math.min(180, Math.floor(value.length / 4)));
  const repeatAt = value.indexOf(marker, Math.floor(value.length / 3));
  if (repeatAt > 0) {
    const first = clean(value.slice(0, repeatAt));
    const second = clean(value.slice(repeatAt));
    if (first.length >= 200 && first === second) return first;
  }
  return value;
}

function caitaSeriesRoot(rawUrl) {
  const u = new URL(rawUrl);
  const match = u.pathname.match(/^\/series\/([0-9A-Z]{26})(?:\/.*)?$/i);
  return match ? u.origin + "/series/" + match[1].toUpperCase() : null;
}

function caitaEpisodeUrl(rawUrl) {
  const u = new URL(rawUrl);
  const match = u.pathname.match(/^\/viewer\/episode\/([0-9A-Z]{26})\/?$/i);
  return match ? u.origin + "/viewer/episode/" + match[1].toUpperCase() : null;
}

export function extractCaitaSeriesDocument(html, pageUrl) {
  const $ = cheerio.load(html);
  const title =
    clean($('meta[property="og:title"]').attr("content")) ||
    clean($("h1").first().text()) ||
    clean($("title").first().text());
  const author =
    clean($('a[href^="/timeline/profile/"]').first().text()) ||
    clean($('[class*="author"]').first().text());
  const synopsis =
    clean($('[class*="synopsis"]').first().text()) ||
    clean($('[class*="description"]').first().text()) ||
    clean($('meta[property="og:description"]').attr("content")) ||
    clean($('meta[name="description"]').attr("content"));
  const episodes = uniqueLinks($, pageUrl, href => {
    const u = new URL(href);
    return (
      u.hostname === "caita.ai" &&
      /^\/viewer\/episode\/[0-9A-Z]{26}\/?$/i.test(u.pathname)
    );
  });
  return { title, author, synopsis, episodes };
}

export function extractCaitaEpisodeDocument(html, pageUrl) {
  const $ = cheerio.load(html);
  const title =
    clean($('meta[property="og:title"]').attr("content")) ||
    clean($("h1").first().text()) ||
    clean($("h2").first().text()) ||
    clean($("title").first().text());

  const selectors = [
    ['[data-testid="episode-body"]', 5000],
    ['[class*="episode-body"]', 4500],
    ['[class*="episodeBody"]', 4500],
    ['[class*="novel-body"]', 4200],
    ['[class*="novelBody"]', 4200],
    ['[class*="viewer"][class*="body"]', 3500],
    ["article", 1200],
    ["main", 0]
  ];
  const candidates = [];
  for (const [selector, bonus] of selectors) {
    $(selector).each((_, element) => {
      let text = dedupeRepeatedText(textWithBreaks($, element));
      if (title && text.startsWith(title)) {
        text = clean(text.slice(title.length));
      }
      if (text.length < 30) return;
      const blockCount = $(element).find("p,br,blockquote").length;
      const linkChars = clean($(element).find("a").text()).length;
      const score = text.length + Math.min(blockCount, 80) * 60 - linkChars * 2 + bonus;
      candidates.push({ text, score });
    });
  }
  candidates.sort((a, b) => b.score - a.score);
  const body = candidates[0]?.text || "";
  if (!body) {
    throw new Error("Caita body not found in the rendered public page.");
  }

  const seriesLinks = uniqueLinks($, pageUrl, href => {
    const u = new URL(href);
    return u.hostname === "caita.ai" && /^\/series\/[0-9A-Z]{26}\/?$/i.test(u.pathname);
  });
  const seriesUrl = seriesLinks[0]?.url || "";
  const seriesTitle = seriesLinks[0]?.label || "";
  return { url: pageUrl, title, body, seriesUrl, seriesTitle };
}

async function caitaRenderedOrDirect(url, parser, validator = null) {
  let directError = "";
  try {
    const direct = await fetchHtml(url, {
      referer: "https://caita.ai/",
      "accept-language": "ja-JP,ja;q=0.9,en;q=0.7"
    });
    try {
      const parsed = parser(direct.html, direct.url);
      if (!validator || validator(parsed)) {
        return { parsed, rendered: false };
      }
      directError = "Direct page did not contain the required public novel structure.";
    } catch (error) {
      directError = error instanceof Error ? error.message : String(error);
    }
  } catch (error) {
    directError = error instanceof Error ? error.message : String(error);
  }

  let renderedHtml;
  try {
    renderedHtml = await renderPublicHtml(url);
  } catch (error) {
    throw new Error(
      "Caita public page could not be read. Direct fetch: " +
        directError +
        " Browser fallback: " +
        (error instanceof Error ? error.message : String(error))
    );
  }
  try {
    const parsed = parser(renderedHtml, url);
    if (validator && !validator(parsed)) {
      throw new Error("Rendered page did not contain the required public novel structure.");
    }
    return { parsed, rendered: true };
  } catch (error) {
    throw new Error(
      "Caita public page rendered, but novel content was not found. " +
        (error instanceof Error ? error.message : String(error))
    );
  }
}

async function caitaIndex(rawUrl) {
  const seriesRoot = caitaSeriesRoot(rawUrl);
  if (seriesRoot) {
    const { parsed } = await caitaRenderedOrDirect(
      seriesRoot,
      extractCaitaSeriesDocument,
      parsed => parsed.episodes.length > 0
    );
    if (!parsed.episodes.length) {
      throw new Error(
        "Caita episode list was not found. The series may be unavailable, access-restricted, or the site layout may have changed."
      );
    }
    return {
      site: "caita",
      workUrl: seriesRoot,
      title: parsed.title,
      author: parsed.author,
      synopsis: parsed.synopsis,
      episodes: parsed.episodes,
      partial: false
    };
  }

  const episodeUrl = caitaEpisodeUrl(rawUrl);
  if (!episodeUrl) throw new Error("Unsupported Caita URL.");
  const { parsed: episode } = await caitaRenderedOrDirect(
    episodeUrl,
    extractCaitaEpisodeDocument
  );

  if (episode.seriesUrl) {
    try {
      const { parsed: series } = await caitaRenderedOrDirect(
        episode.seriesUrl,
        extractCaitaSeriesDocument,
        parsed => parsed.episodes.length > 0
      );
      if (series.episodes.length) {
        return {
          site: "caita",
          workUrl: episode.seriesUrl,
          title: series.title || episode.seriesTitle || episode.title,
          author: series.author,
          synopsis: series.synopsis,
          episodes: series.episodes,
          partial: false
        };
      }
    } catch {
      // The public episode itself is still useful even when the series index cannot be discovered.
    }
  }

  return {
    site: "caita",
    workUrl: episode.seriesUrl || episodeUrl,
    title: episode.seriesTitle || episode.title,
    author: "",
    synopsis: "",
    episodes: [{ url: episodeUrl, label: episode.title || "本文" }],
    inlineEpisode: episode,
    partial: true
  };
}

async function caitaEpisode(url) {
  const { parsed } = await caitaRenderedOrDirect(
    url,
    extractCaitaEpisodeDocument
  );
  return { url: parsed.url, title: parsed.title, body: parsed.body };
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
  const index = site === "narou" ? await narouIndex(rawUrl) : site === "kakuyomu" ? await kakuyomuIndex(rawUrl) : site === "alphapolis" ? await alphapolisIndex(rawUrl) : site === "caita" ? await caitaIndex(rawUrl) : await genericPage(rawUrl);
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
        else if (site === "caita") episode = await caitaEpisode(item.url);
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
    complete: !index.partial && failures.length === 0 && selected.length === index.episodes.length,
    truncated: Boolean(index.partial) || selected.length < index.episodes.length, failures, episodes
  };
}
