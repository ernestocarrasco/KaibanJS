/**
 * Jina URL to Markdown
 *
 * This tool integrates with Jina (https://jina.ai/), a web scraping
 * and crawling service designed to turn websites into LLM-ready data.
 *
 * Jina allows you to extract clean, well-formatted markdown or structured data
 * from websites, making it ideal for AI applications, particularly those using
 * Large Language Models (LLMs).
 *
 * Key features of Jina:
 * - Scrapes and crawls websites, even those with dynamic content
 * - Converts web content into clean, LLM-ready markdown
 * - Handles challenges like rate limits, JavaScript rendering, and anti-bot mechanisms
 * - Offers flexible pricing plans, including a free tier for small-scale use
 *
 * Usage:
 * const tool = new JinaUrlToMarkdown();
 * const result = await tool._call({ url: 'https://example.com' });
 * or
 * const tool = new JinaUrlToMarkdown({ apiKey: 'your-api-key', options: { 'targetSelector': ['body', '.class', '#id'], 'retainImages': 'none' } });
 * const result = await tool._call({ url: 'https://example.com' });
 *
 * For more information about Jina, visit: https://jina.ai/, https://r.jina.ai/docs
 */

import { Tool } from '@langchain/core/tools';
import { z } from 'zod';
import ky from 'ky';
import { HTTPError } from 'ky';

export class JinaUrlToMarkdown extends Tool {
  constructor(fields) {
    super(fields);
    this.name = 'jina-url-to-markdown';
    this.apiKey = fields.apiKey;
    this.options = fields.options || {};
    this.description = `Fetches web content from a specified URL and returns it in Markdown format. Input should be a JSON object with a "url".`;

    this.headers = { 'Content-Type': 'application/json' };

    if (this.apiKey) {
      this.headers.Authorization = `Bearer ${this.apiKey}`;
    }
    // Define the input schema using Zod
    this.schema = z.object({
      url: z.string().describe('The URL to scrape and retrieve content from.'),
    });

    this.httpClient = ky;
  }

  async _call(input) {
    try {
      const response = await this.httpClient
        .post(`https://r.jina.ai/`, {
          json: {
            url: input.url,
            ...this.options,
          },
          headers: this.headers,
        })
        .json();

      return response?.data || 'The API returned an empty response.';
    } catch (error) {
      if (error instanceof HTTPError) {
        const statusCode = error.response.status;
        let errorType = 'Unknown';
        if (statusCode >= 400 && statusCode < 500) {
          errorType = 'Client Error';
        } else if (statusCode >= 500) {
          errorType = 'Server Error';
        }
        return `API request failed: ${errorType} (${statusCode})`;
      } else {
        return `An unexpected error occurred: ${error.message}`;
      }
    }
  }
}
