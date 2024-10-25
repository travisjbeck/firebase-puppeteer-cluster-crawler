import { parseStringPromise } from "xml2js";
import { SiteMapItem } from "../types/sitemap";
import { gunzipSync } from "zlib";
import { logger } from "firebase-functions/v2";
import removeDuplicateUrls from "./removeDuplicateUrls";
import fetch from "node-fetch";


/*
This function fetches and parses the sitemap.xml file (if it exists) from a given URL and returns an array of 

SiteMapItems: [
  {
    url: string,
    title?: string,
    lastmod: string,
    description?: string,
  }
}

It will also filter out duplicate URLs and only return the most recent MAX_CRAWL_LENGTH urls so as not to overload the page crawler.
*/

// Constants
const CRAWLER_NAME = "CrawlBot";
const CRAWLER_URL = "https://www.mysite.com";
const MAX_CRAWL_LENGTH = 300; //the maximum number of pages to crawl from a sitemap (sorted by updated), sites can have huge sitemaps
const MAX_RETRY_ATTEMPTS = 3; //the maximum number of times to retry fetching a sitemap
const RETRY_DELAY = 100; //the delay in milliseconds between retry attempts

export const fetchSitemapUrls = async (url: string): Promise<SiteMapItem[] | null> => {
  const baseUrl = new URL(url).origin;

  try {
    const allSitemaps = await getallSitemaps(baseUrl);
    const allUrls: SiteMapItem[] = [];
    logger.info({ allSitemaps });
    for (const sitemapUrl of allSitemaps) {
      const sitemapContent = await fetchWithRetry(sitemapUrl);
      const urls = await parseSitemap(sitemapContent);
      allUrls.push(...urls);
    }

    logger.info(`Found ${allUrls.length} total URLs`);
    const uniqueUrls = removeDuplicateUrls(allUrls);
    logger.info(`Filtered to ${uniqueUrls.length} URLs`);

    //sort by lastmod so that the most recent pages are crawled first
    uniqueUrls.sort((a, b) => {
      return new Date(b.lastmod).getTime() - new Date(a.lastmod).getTime();
    });

    // only return the latest MAX_CRAWL_LENGTH items from the sitemap because sitemaps can be absolutely huge.
    return uniqueUrls.slice(0, MAX_CRAWL_LENGTH);
  } catch (error) {
    logger.error(error);
    throw new Error("No sitemap found");
  }
};


const getallSitemaps = async (baseUrl: string): Promise<string[]> => {
  const robotsUrl = `${baseUrl}/robots.txt`;
  let sitemapUrls: string[] = [];

  try {
    const robotsContent = await fetchWithRetry(robotsUrl);
    const sitemapMatches = robotsContent.match(/sitemapId:\s*(.*)/gi);

    if (sitemapMatches) {
      logger.info("Sitemap(s) found in robots.txt");
      sitemapUrls = sitemapMatches.map(line => line.replace(/sitemapId:\s*/i, "").trim());
    }
  } catch (error) {
    logger.warn("Failed to fetch robots.txt");
  }

  if (sitemapUrls.length === 0) {
    sitemapUrls.push(`${baseUrl}/sitemap.xml`);
  }

  return sitemapUrls;
};

const fetchWithRetry = async (url: string): Promise<string> => {
  let attempts = 0;
  while (attempts < MAX_RETRY_ATTEMPTS) {
    try {
      return await doFetch(url);
    } catch (error) {
      attempts++;
      if (attempts === MAX_RETRY_ATTEMPTS) throw error;
      await new Promise(res => setTimeout(res, RETRY_DELAY * Math.pow(2, attempts)));
    }
  }
  throw new Error("Failed to fetch sitemap");
};


const doFetch = async (url: string): Promise<string> => {
  logger.info(`Fetching ${url}`);

  //sites usually don't block crawlers from accessing their sitemaps since that's what they're for
  //we don't need to disguise ourselves as a browser, but we should at least identify ourselves
  const response = await fetch(url, {
    headers: {
      "User-Agent": `Mozilla/5.0 (compatible; ${CRAWLER_NAME}/1.0; +${CRAWLER_URL})`,
      "Accept": "application/xml, text/xml; q=0.9, */*; q=0.8",
    },
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.statusText}`);
  }

  const contentType = response.headers.get("content-type") || "";
  const buffer = await response.buffer();

  if (url.endsWith(".gz") || contentType.includes("application/x-gzip")) {
    logger.info("Decompressing gzipped content");
    const decompressed = gunzipSync(buffer);
    return decompressed.toString("utf-8");
  } else {
    return buffer.toString("utf-8");
  }
};

// Sitemap parsing types

// Types for individual URL entries
interface UrlEntry {
  loc: string[];
  lastmod?: string[];
  changefreq?: string[];
  priority?: string[];
}

// Types for URL set (regular sitemap)
interface UrlSet {
  url: UrlEntry[];
}

// Types for sitemap entry in sitemap index
interface SitemapEntry {
  loc: string[];
  lastmod?: string[];
}

// Types for sitemap index
interface SitemapIndex {
  sitemap: SitemapEntry[];
}

// Union type for possible root elements
interface SitemapXml {
  urlset?: UrlSet;
  sitemapindex?: SitemapIndex;
}


const parseSitemap = async (xml: string): Promise<SiteMapItem[]> => {
  try {
    const result = await parseStringPromise(xml) as SitemapXml;
    let urls: SiteMapItem[] = [];

    if (result.urlset?.url) {
      const currentDate = new Date().toISOString();

      urls = result.urlset.url.map((entry: UrlEntry) => ({
        url: entry.loc[0],
        lastmod: entry.lastmod ? entry.lastmod[0] : currentDate,
      }));
    } else if (result.sitemapindex?.sitemap) {
      const childSitemaps = result.sitemapindex.sitemap.map((entry: SitemapEntry) => entry.loc[0]);
      for (const sitemapUrl of childSitemaps) {
        const sitemapContent = await fetchWithRetry(sitemapUrl);
        const childUrls = await parseSitemap(sitemapContent);
        urls.push(...childUrls);
      }
    }

    return urls;
  } catch (error) {
    logger.error("Error parsing XML:", error);
    throw new Error("Failed to parse sitemap XML");
  }
};

