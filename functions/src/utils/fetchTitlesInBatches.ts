
import { isDevelopment } from "../init";
import { Cluster } from "puppeteer-cluster";
import puppeteer from "puppeteer";

import { SiteMapItem } from "../types/sitemap";
import { logger } from "firebase-functions/v2";

//Constants
export const MAX_PAGES_PER_BATCH = 10;

const puppeteerOptions = {
  headless: true,
  args: [
    "--no-sandbox",
    "--disable-gpu",
    "--disable-setuid-sandbox",
    "--disable-dev-shm-usage",
    "--disable-web-security",
  ],
}

type FetchTitlesInBatchesProps = {
  urls: { url: string, lastmod: string }[];
  progressCallback?: (progress: number) => void;
};


// The default puppeteer user agent is blocked by many sites
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36";

/*
NOTE: these plugins are not compatible with puppeteer-cluster but are great resources for single page puppeteer
https://www.npmjs.com/package/puppeteer-extra
puppeteer.use(AdblockerPlugin({ blockTrackers: true }));
puppeteer.use(BlockResourcesPlugin({ blockedTypes: new Set(["image", "stylesheet", "font", "media"]) }));

*/

export async function fetchTitlesInBatches(props: FetchTitlesInBatchesProps): Promise<SiteMapItem[]> {
  logger.info("Fetching titles in batches");
  const { urls, progressCallback } = props;

  // Initialize the cluster
  const cluster = await Cluster.launch({
    puppeteer,
    puppeteerOptions,
    concurrency: Cluster.CONCURRENCY_PAGE,
    maxConcurrency: MAX_PAGES_PER_BATCH, // Don't go too high, we don't want to get blocked, banned, or rate limited
    monitor: isDevelopment, // Enable monitoring in development, disabled in production as its way too verbose
    workerCreationDelay: 100, // Delay between spawning workers
  });

  try {
    let completed = 0;
    const results: SiteMapItem[] = [];

    // Handle task errors
    cluster.on("taskerror", (err, data) => {
      logger.error(`Error crawling ${data.url}: ${err.message}`);
    });

    // Define the task
    await cluster.task(async ({ page, data: { url, lastmod } }) => {
      try {
        await page.setUserAgent(USER_AGENT);
        //make sure we wait for the page to load before we try to get the title
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 });
        const title = await page.title();
        const description = await page.evaluate(() => {
          const descriptionTag = document.querySelector("meta[name='description']");
          return descriptionTag ? descriptionTag.getAttribute("content") : undefined;
        });
        results.push({ url, lastmod, title, description: description ?? "" });
      } catch (error) {
        logger.warn(`Failed to fetch title for ${url}: ${error}`);
        results.push({ url, lastmod, title: "", description: undefined });
      } finally {
        completed++;
        progressCallback?.(Math.round((completed / urls.length) * 100));
      }
    });

    // Queue URLs
    urls.forEach(urlData => {
      cluster.queue(urlData);
    });

    logger.info("Queued all URLs");

    await cluster.idle();
    return results;
  } catch (error) {
    logger.error("Error crawling site", error);
    throw new Error(`Failed to fetch titles in batches: ${error}`);
  } finally {
    await cluster.close();
  }
}

