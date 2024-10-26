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

You will need a Firebase project to deploy to that has at minimum the following services enabled:

- Firestore
- Cloud Functions

For this project, I will assume you know the basics of setting up a firebase project and have the **latest** firebase CLI installed.

### Install

1. Clone the repository.
2. Run `npm install` in the `functions` folder of the project.
3. Run `firebase login` in the root directory to login to your firebase account.
4. Run `firebase use your-project-id` in the root directory replacing 'your-project-id' with your Firebase Project ID. This will associate this code base with your firebase project.

   - You can run `firebase projects:list` to get a list of your projects and their Project D.

5. Run `firebase deploy` to deploy the project to Firebase or follow the instructions below to run locally.

### Running Locally

If you are using VSCode there is a launch configuration in `.vscode/tasks.json` that will automatically run the terminal commands needed to kill the functions emulator ports if they're still running, setup TSC build, and then start the emulator.

If you are not using VSCode you can run the following commands in the `functions` directory:

- run `npm run build:watch`.
- then `npm run dev`.

## How it Works
