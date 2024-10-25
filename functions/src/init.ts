import { initializeApp } from "firebase-admin/app";
import { getStorage } from "firebase-admin/storage";

import { getFirestore } from "firebase-admin/firestore";
import { getFunctions } from "firebase-admin/functions";

import * as dotEnv from "dotenv";

// Initialize Firebase Admin SDK once globally
export const isDevelopment = process.env.FUNCTIONS_EMULATOR === "true";
if (isDevelopment) {
  console.info("Running in development mode");
  dotEnv.config({ path: ".env.local" });

  initializeApp();
} else {
  // Initialize Firebase Admin SDK for production
  initializeApp();

}

// Firestore and Storage instances obtained for operations
export const db = getFirestore();
export const storage = getStorage();
export const functions = getFunctions();

