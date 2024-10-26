import { Timestamp } from "firebase-admin/firestore";

export type Site = {
  createdAt: Timestamp;
  url: string;
  sitemapId?: string;
  sitemapError?: string;
}
