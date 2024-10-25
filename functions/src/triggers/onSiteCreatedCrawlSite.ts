import { DocumentSnapshot, FieldValue } from "firebase-admin/firestore";
import { Site } from "../types/site";
import { onDocumentCreated } from "firebase-functions/firestore";
import { SITEMAPS_COLLECTION, SITES_COLLECTION } from "../types/collections";
import { functions, db, isDevelopment } from "../init";
import { logger } from "firebase-functions/v2";
import { processSitemap, SitemapProcessorProps } from "../tasks/sitemapProcessorTask";
import { getFunctionUrl } from "../utils/getFunctionUrl";


/**
 This function is triggered when a `site` Document is created. It will then queue a task to process the sitemap. a Site document must at minimum have a valid `url` field.
 
 If the site already has a sitemap, it will not create a new one.
 
 */

export const onSiteCreatedCrawlSite = onDocumentCreated({
  timeoutSeconds: 30,
  document: `${SITES_COLLECTION}/{siteId}`,
}, async (event) => {

  const siteSnapshot = event.data as DocumentSnapshot<Site>;

  try {
    const site = siteSnapshot.data();

    if (!site) {
      throw new Error("Site not found");
    }

    const url = site.url;
    if (!url) {
      throw new Error("Site url not found");
    }

    //if the site is already processing, skip
    //we flag this in our createSitemapRequest function by saving the sitemap with a status of "processing"
    if (site.status) {
      logger.info(`Site already processing, skipping sitemap creation for ${url}`);
      return;
    }

    const siteId = event.params.siteId;

    //make sure a sitemap doesn't already exist for this url
    const existingSitemap = await db.collection(SITEMAPS_COLLECTION)
      .where("url", "==", url)
      .get();

    if (existingSitemap.docs.length > 0) {
      logger.info(`Sitemap already exists for ${url}`);
      await siteSnapshot.ref.update({
        sitemapId: existingSitemap.docs[0].id,
        sitemapError: FieldValue.delete(),
      });
      return;
    }

    if (isDevelopment) {
      //if we are in development, process the sitemap immediately, there is no local Google Cloud Run Queue
      await processSitemap(siteId);
      return;
    }

    //queue the sitemap processor task
    const queue = functions.taskQueue("sitemapProcessorTask");
    const targetUri = await getFunctionUrl("sitemapProcessorTask");

    const data: SitemapProcessorProps = {
      siteId,
    }

    await queue.enqueue(data, {
      dispatchDeadlineSeconds: 60 * 10, // 10 minutes
      uri: targetUri,
    })


    return;
  } catch (error) {
    await siteSnapshot.ref.update({
      sitemapError: "Error creating sitemap",
    });
    return;
  }

});