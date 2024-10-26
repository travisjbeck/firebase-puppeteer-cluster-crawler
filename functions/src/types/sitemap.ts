import { Timestamp } from "firebase-admin/firestore";

export type Sitemap = {
  lastUpdated?: Timestamp;
  createdAt: Timestamp;
  progress?: number;
  pages?: SiteMapItem[];
  status: "new" | "processing" | "complete";
  statusMessage?: string;
  url: string;
  siteId: string;
}


export interface SiteMapItem {
  url: string,
  title?: string,
  lastmod: string,
  description?: string,
}
