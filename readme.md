## Firebase Puppeteer Cluster Crawler

This is a simple project that uses Puppeteer to crawl a website and save the data to a Firebase database. It uses a cluster of Puppeteer instances to speed up the crawling process.

The difficulty in getting puppeteer to work on firebase or serverless in general is the lack of static file system. This project uses a cache within the project directory. That is declared in `.puppeteerrc.cjs` in the root of the `functions` directory.

```javascript
const { join } = require("path");

/**
 * @type {import("puppeteer").Configuration}
 */
module.exports = {
  // Changes the cache location for Puppeteer.
  cacheDirectory: join(__dirname, ".cache", "puppeteer"),
};
```

We also add a post install step to `package.json` so that firebase can download the necessary binaries.

```json
{
  "scripts": {
    "postinstall": "puppeteer browsers install chrome"
  }
}
```

## Setup

You will need a firebase project to deploy to that has at minimum the following services enabled:

- Firestore
- Cloud Functions

For this project, I will assume you know the basics of setting up a firebase project and have the firebase CLI installed.

## TO BE CONTINUED
