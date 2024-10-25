//https://firebase.google.com/docs/functions/task-functions?gen=2nd
import { GoogleAuth } from "google-auth-library";

export let auth: GoogleAuth;

interface FunctionResponseData {
  serviceConfig?: {
    uri?: string;
  };
}
/**
 * Get the URL of a given v2 cloud function.
 *
 * @param {string} name the function's name
 * @param {string} location the function's location
 * @return {Promise<string>} The URL of the function
 */
export async function getFunctionUrl(name: string, location = "us-central1"): Promise<string> {
  if (!auth) {
    auth = new GoogleAuth({
      scopes: "https://www.googleapis.com/auth/cloud-platform",
    });
  }
  const projectId = await auth.getProjectId();
  const url = "https://cloudfunctions.googleapis.com/v2beta/" +
    `projects/${projectId}/locations/${location}/functions/${name}`;

  const client = await auth.getClient();
  const res = await client.request({ url });
  const uri = (res.data as FunctionResponseData).serviceConfig?.uri;
  if (!uri) {
    throw new Error(`Unable to retrieve uri for function at ${url}`);
  }
  return uri;
}
