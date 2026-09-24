import type { UrlMatch } from './extract.js';

/** One platform whose alert emails have a dedicated parser. */
export interface AlertPlatform {
  /** Adapter id of the same platform in @nlpf/sources, so alert and poll listings share ids. */
  id: string;
  /** Sender domains (subdomains included) whose mail is read with this parser. */
  senderDomains: string[];
  /** Accepts only this platform's listing detail URLs. */
  match(url: URL): UrlMatch | null;
}
