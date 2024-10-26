import { onRequest } from "firebase-functions/v2/https";
import { db } from "../init";
import { SITES_COLLECTION } from "../types/collections";
import { logger } from "firebase-functions/v2";
import { FieldValue } from "firebase-admin/firestore";

/*
This is another way to start the sitemap process running, by making an http request to a specific endpoint.

NOTE THIS IS NOT A GOOD PRACTICE FOR PRODUCTION. This is just a way to trigger the sitemap process in development. In production, you should use the onSiteCreatedCrawlSite trigger to start the sitemap process.

This function is triggered when a HTTP request is made to the endpoint /sitemapRequest?url=url. It will create a new site document in the sites collection with the url provided in the query parameter. This will trigger the onSiteCreatedCrawlSite function to start the sitemap process.
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
        createdAt: FieldValue.serverTimestamp()
      });
      //onDocumentCreated will trigger the sitemap processing
    }

    res.status(200).send("Request is being processed");
    return;
  } catch (error) {
    logger.error(error);
    res.status(500).send("Error");
    return;
  }
});