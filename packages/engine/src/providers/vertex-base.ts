/** Vertex AI publisher base URL for a project + location. Global uses the apex host;
 *  a region uses the {location}-aiplatform host. The publisher segment defaults to
 *  `google` (Gemini); pass `anthropic` for Claude on Model Garden. */
export function vertexBaseUrl(project: string, location: string, publisher = 'google'): string {
  const host = location === 'global' ? 'aiplatform.googleapis.com' : `${location}-aiplatform.googleapis.com`;
  return `https://${host}/v1/projects/${project}/locations/${location}/publishers/${publisher}`;
}
