import * as cheerio from "cheerio";

const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36 NOVELIGHT-Commander/0.5";

export function detectNovelSite(rawUrl) {
  const url = new URL(rawUrl);
  const host = url.hostname.toLowerCase();
  if (host === "ncode.syosetu.com" || host.endsWith(".syosetu.com")) return "narou";
  if (host === "kakuyomu.jp" || host.endsWith(".kakuyomu.jp")) return "kakuyomu";
  if (host === "alphapolis.co.jp" || host.endsWith(".alphapolis.co.jp")) return "alphapolis";
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
  const index = site === "narou" ? await narouIndex(rawUrl) : site === "kakuyomu" ? await kakuyomuIndex(rawUrl) : site === "alphapolis" ? await alphapolisIndex(rawUrl) : await genericPage(rawUrl);
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
