import { onRequest } from "firebase-functions/v2/https";
import { db, functions, isDevelopment } from "../init";
import { SITES_COLLECTION } from "../types/collections";
import { processSitemap, SitemapProcessorProps } from "../tasks/sitemapProcessorTask";
import { logger } from "firebase-functions/v2";
import { getFunctionUrl } from "../utils/getFunctionUrl";
import { FieldValue } from "firebase-admin/firestore";

/*
This is another way to start the sitemap process running, by making an http request to a specific endpoint.

NOTE THIS IS NOT A GOOD PRACTICE FOR PRODUCTION. This is just a way to trigger the sitemap process in development. In production, you should use the onSiteCreatedCrawlSite trigger to start the sitemap process.

This function is triggered when a HTTP request is made to the endpoint /sitemapRequest?url=url. It will then queue a task to process the sitemap or process it immediately when running locally.
*/
export const createSitemap = onRequest({
  memory: "1GiB",
  timeoutSeconds: 540,
}, async (req, res) => {
  try {
    const { url } = req.query;
    if (!url) {
      res.status(400).send("Missing url parameter");
      return;
    }

    if (url) {
      const siteDoc = db.collection(SITES_COLLECTION).doc();
      await siteDoc.set({
        url,
        createdAt: FieldValue.serverTimestamp(),
        status: "processing",
      });
      if (isDevelopment) {
        logger.info("Running in development mode");
        //if we are in development, process the sitemap immediately, there is no local Google Cloud Run Queue
        await processSitemap(siteDoc.id);
      } else {
        //queue the sitemap processor task
        const queue = functions.taskQueue("SitemapProcessor");
        const targetUri = await getFunctionUrl("SitemapProcessor");

        const data: SitemapProcessorProps = {
          siteId: siteDoc.id,
        }

        await queue.enqueue(data, {
          dispatchDeadlineSeconds: 60 * 10, // 10 minutes
          uri: targetUri,
        })
      }
    }

    res.status(200).send("Request is being processed");
    return;
  } catch (error) {
    logger.error(error);
    res.status(500).send("Error");
    return;
  }
});