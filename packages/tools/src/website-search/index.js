/**
 * Website Search Tool
 *
 * This tool is specifically crafted for conducting semantic searches within the content of a particular website.
 * Leveraging a Retrieval-Augmented Generation (RAG) model, it navigates through the information provided on a given URL.
 * Users have the flexibility to either initiate a search across any website known or discovered during its usage or to
 * concentrate the search on a predefined, specific website.
 *
 * The tool uses the following components:
 * - A RAG Toolkit instance, which handles the RAG process
 * - A Chunker instance, which chunks and processes text for the RAG model
 * - An Embeddings instance, which handles embeddings for the RAG model
 * - A VectorStore instance, which stores vectors for the RAG model
 * - An LLM instance, which handles the language model for the RAG model
 * - A promptQuestionTemplate, which defines the template for asking questions
 * - An OpenAI API key, which is used for interacting with the OpenAI API
 * - The input should be a JSON object with a "url" field containing the URL to process and a "query" field containing the question to ask.
 * - The output is the answer to the question, generated using the RAG approach.
 * - For more information about the RAG Toolkit, visit:
 *
 * @example
 * const tool = new WebsiteSearch({
 *  OPENAI_API_KEY: 'your-openai-api-key',
 *  url: 'https://example.com',
 * });
 * const result = await tool._call({ query: 'question to ask' });
 *
 */

import { Tool } from '@langchain/core/tools';
import { CheerioWebBaseLoader } from '@langchain/community/document_loaders/web/cheerio';
import RagToolkit from '../../dist/rag-toolkit/index.esm';
import { z } from 'zod';

export class WebsiteSearch extends Tool {
  constructor(fields) {
    super(fields);
    this.OPENAI_API_KEY = fields.OPENAI_API_KEY;
    this.url = fields.url;
    this.chunkOptions = fields.chunkOptions;
    this.embeddings = fields.embeddings;
    this.vectorStore = fields.vectorStore;
    this.llmInstance = fields.llmInstance;
    this.promptQuestionTemplate = fields.promptQuestionTemplate;
    this.name = 'website-search';
    this.description =
      'A tool for conducting semantic searches within the content of a particular website using the RAG approach. Input should be a URL and a question string.';

    // Define the input schema using Zod
    this.schema = z.object({
      url: z.string().describe('The URL to process.'),
      query: z.string().describe('The question to ask.'),
    });
    this.ragToolkit = new RagToolkit({
      chunkOptions: this.chunkOptions,
      embeddings: this.embeddings,
      vectorStore: this.vectorStore,
      llmInstance: this.llmInstance,
      promptQuestionTemplate: this.promptQuestionTemplate,
      env: { OPENAI_API_KEY: this.OPENAI_API_KEY },
    });
    this.ragToolkit.registerLoader(
      'web',
      (source) => new CheerioWebBaseLoader(source)
    );
  }

  async _call(input) {
    const { url, query } = input;
    if (url && url !== '') {
      this.url = url;
    }
    if (!this.url || this.url === '') {
      return "ERROR_MISSING_URL: No url was provided for analysis. Agent should provide valid url in the 'url' field.";
    }
    if (!query || query === '') {
      return "ERROR_MISSING_QUERY: No question was provided. Agent should provide a question in the 'query' field.";
    }

    try {
      const ragToolkit = this.ragToolkit;
      await ragToolkit.addDocuments([{ source: this.url, type: 'web' }]);
      const response = await ragToolkit.askQuestion(query);
      return response;
    } catch (error) {
      return `ERROR_WEBSITE_SEARCH_PROCESSING: An unexpected error occurred: in WebsiteSearch tool. Details: ${error.message}. Agent should verify content format and query validity.`;
    }
  }
}
