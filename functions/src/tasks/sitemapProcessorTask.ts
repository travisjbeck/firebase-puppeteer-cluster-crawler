/* 
This is a Cloud Run Task that processes a sitemap for a site given a URL
1. it first fetches the sitemap for the site (if it exists)
2. processes the sitemap to generate a list of unique URLS sorted by last modified date
3. chooses the latest MAX_CRAWL_LENGTH URLs to process (tune this number as needed)
4. fetches the title and meta description for each URL in batches of MAX_PAGES_PER_BATCH (tune this number as needed)


We use a task queue to process the sitemap because these tasks can take a long time.
Currently the max timeout for db trigger functions is 9 minutes.  
Task queue functions have a maximum timeout of 1,800s (30 minutes)

Internally, the crawler will timeout each individual page after 30 seconds if it doesn't respond. So the max time for a page to be processed is 30 seconds. Although pages are processed MAX_PAGES_PER_BATCH at a time You can see how this can take a while to process a large sitemap.

Worst case scenario is crawling 300 pages, all 300 timeout after 30 seconds and we have a batch of 10 at a time. This would take 300 * 30 / 10 = 900 seconds or 15 minutes to process the entire sitemap.

Also, you can't simply crank up the MAX_PAGES_PER_BATCH to speed things up. You'll get rate limited, banned, or blocked by the sites you're crawling. So you have to be careful with how you tune this.

*/

import { db } from "../init";
import { logger } from "firebase-functions/v2";
import { fetchTitlesInBatches } from "../utils/fetchTitlesInBatches";
import { fetchSitemapUrls } from "../utils/fetchSitemapUrls";
import { onTaskDispatched } from "firebase-functions/v2/tasks";
import { Sitemap, SiteMapItem } from "../types/sitemap";
import { SITEMAPS_COLLECTION, SITES_COLLECTION } from "../types/collections";
import {
  DocumentReference,
  DocumentSnapshot,
  FieldValue,
  Timestamp,
  WriteBatch
} from "firebase-admin/firestore";
import { Site } from "../types/site";

// Constants
const PROGRESS_UPDATE_THRESHOLD = 10;
const TIMEOUT_SECONDS = 900; //15 minutes. Max is 1800 or 30 minutes
const MEMORY = "8GiB";//You need PLENTY of memory for this cluster, tune as needed
const CPU_CORES = 4; //You also need a good amount of CPU for the cluster to not get bogged down, tune as needed

export interface SitemapProcessorProps {
  siteId: string;
}

interface SitemapProcessorContext {
  siteSnapshot: DocumentSnapshot<Site>;
  sitemapRef: DocumentReference<Sitemap>;
  site: Site;
}

// Error class for better error handling
class SitemapProcessingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SitemapProcessingError";
  }
}

// Helper functions
async function initializeContext(siteId: string): Promise<SitemapProcessorContext> {
  const siteSnapshot = await db.collection(SITES_COLLECTION).doc(siteId).get() as DocumentSnapshot<Site>;
  const site = siteSnapshot.data();

  if (!site) {
    throw new SitemapProcessingError("Site not found");
  }

  return {
    siteSnapshot,
    sitemapRef: db.collection(SITEMAPS_COLLECTION).doc() as DocumentReference<Sitemap>,
    site
  };
}

async function createInitialSitemap(
  context: SitemapProcessorContext,
  siteId: string
): Promise<void> {
  await context.sitemapRef.set({
    lastUpdated: Timestamp.now(),
    createdAt: Timestamp.now(),
    status: "processing",
    url: context.site.url,
    statusMessage: "Fetching Sitemap",
    siteId,
  });
}

async function updateProgress(
  progress: number,
  lastProgress: number,
  sitemapRef?: DocumentReference<Sitemap>,
): Promise<number> {
  if ((progress >= lastProgress + PROGRESS_UPDATE_THRESHOLD) && sitemapRef) {
    logger.info(`${progress}% complete`);
    await sitemapRef.update({ progress });
    return progress;
  }
  return lastProgress;
}

async function commitFinalChanges(
  context: SitemapProcessorContext,
  pages: SiteMapItem[]
): Promise<void> {
  const batch: WriteBatch = db.batch();

  batch.update(context.sitemapRef, {
    lastUpdated: Timestamp.now(),
    pages,
    statusMessage: "Complete",
    progress: 100,
    status: "complete",
  });

  batch.update(context.siteSnapshot.ref, {
    sitemapId: context.sitemapRef.id,
    sitemapError: FieldValue.delete(),
    status: "complete",
  });

  await batch.commit();
}

async function handleError(
  error: Error,
  context: SitemapProcessorContext | null,
): Promise<void> {
  logger.warn({ error }, "Error creating sitemap");
  if (!context) {
    return
  }
  await context.siteSnapshot.ref.update({
    sitemapError: error.message || "Error creating sitemap",
  });
  await context.sitemapRef.delete();
}

// Main processing function
async function processSitemap(siteId: string): Promise<SiteMapItem[] | undefined> {
  let context: SitemapProcessorContext | null = null;

  try {
    // Initialize context
    context = await initializeContext(siteId) as SitemapProcessorContext;

    if (!context) {
      throw new SitemapProcessingError("Invalid context");
    }

    // Clear previous errors
    await context.siteSnapshot.ref.update({
      sitemapError: FieldValue.delete(),
      status: "processing",
    });

    // Create initial sitemap
    await createInitialSitemap(context, siteId);

    // Fetch sitemap URLs
    const urls = await fetchSitemapUrls(context.site.url);
    if (!urls) {
      throw new SitemapProcessingError("Sitemap not found");
    }

    // Update status
    logger.info(`Processing titles for ${urls.length} Pages`);
    await context.sitemapRef.update({
      statusMessage: `Crawling ${urls.length} pages`,
    });

    // Process pages
    let lastProgress = 0;
    const pagesWithTitles = await fetchTitlesInBatches({
      urls,
      async progressCallback(progress) {
        lastProgress = await updateProgress(progress, lastProgress, context?.sitemapRef,);
      }
    });

    // Filter and validate pages
    const pages = pagesWithTitles.filter(item => (item.title?.length ?? 0) > 0);
    if (!pages.length) {
      throw new SitemapProcessingError("Failed to crawl sitemap");
    }

    // Commit final changes
    await commitFinalChanges(context, pages);

    logger.info(`Sitemap completed for ${context.site.url}`);
    return pages;

  } catch (error) {
    console.log(error);

    if (error instanceof SitemapProcessingError) {
      await handleError(error, context);
    } else {
      await handleError(
        new SitemapProcessingError("Unknown error occurred"),
        context
      );
    }
    return undefined;
  }
}

// Cloud Function
export const sitemapProcessorTask = onTaskDispatched({
  retryConfig: { maxAttempts: 1 },
  rateLimits: { maxConcurrentDispatches: 1 },//You can't really run this in parallel, it will just bog down the cluster since each task will spawn a new puppeteer cluster
  timeoutSeconds: TIMEOUT_SECONDS,
  memory: MEMORY,
  cpu: CPU_CORES,
}, async (req) => {
  const { siteId } = req.data as SitemapProcessorProps;

  if (!siteId) {
    throw new SitemapProcessingError("Invalid Parameters");
  }

  await processSitemap(siteId);
});

export { processSitemap };