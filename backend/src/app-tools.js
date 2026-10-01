import Ajv from 'ajv';
import { search } from './search.js';
import { searchImages } from './image-search.js';
import { readPage } from './page-reader.js';
import { mcpRegistry } from './mcp.js';
import { filesystemTools } from './filesystem-tools.js';

export const searchToolSchemas = [
  { type: 'function', function: { name: 'search_images', description: 'Find requested photos and show a Pictures gallery below the answer. Resolve the subject from history. Returns metadata, not pixels. Not for code/SVG generation.', parameters: {
    type: 'object', properties: { query: { type: 'string', minLength: 2, maxLength: 300 }, count: { type: 'integer', minimum: 1, maximum: 8 } }, required: ['query'], additionalProperties: false,
  } } },
  { type: 'function', function: { name: 'search_web', description: 'Search current/latest/changing facts or requested sources/verification. Skip timeless explanations, ordinary code, arithmetic and translation. Cite returned source numbers.', parameters: {
    type: 'object', properties: { query: { type: 'string', minLength: 2, maxLength: 300 }, count: { type: 'integer', minimum: 1, maximum: 5 } }, required: ['query'], additionalProperties: false,
  } } },
  { type: 'function', function: { name: 'read_webpage', description: 'Read a supplied HTTP(S) URL or verify a search result. Returns extracted text and a citation number.', parameters: {
    type: 'object', properties: { url: { type: 'string', pattern: '^https?://.+$', maxLength: 2000 } }, required: ['url'], additionalProperties: false,
  } } },
];
const ajv = new Ajv({ strict: false });
const validators = new Map(searchToolSchemas.map(tool => [tool.function.name, ajv.compile(tool.function.parameters)]));

export class AppTools {
  constructor({ mcp = mcpRegistry, webEnabled = false, emit = () => {}, searchFn = search, imageSearchFn = searchImages, readFn = readPage } = {}) {
    Object.assign(this, { mcp, webEnabled, emit, searchFn, imageSearchFn, readFn });
    this.sources = [];
    this.images = [];
    this.searchCalls = 0;
    this.readCalls = 0;
    this.validators = validators;
  }
  async catalog() {
    return [...await this.mcp.catalog(), ...filesystemTools.catalog(), ...searchToolSchemas.filter(tool => this.webEnabled || tool.function.name !== 'search_web')];
  }
  isReadOnly(name) { return name.startsWith('files__') ? filesystemTools.isReadOnly(name) : this.validators.has(name) || this.mcp.isReadOnly?.(name) === true; }
  isRemote(name) { return this.mcp.isRemote?.(name) === true; }
  addSource(source) {
    let index = this.sources.findIndex(item => item.url === source.url);
    if (index < 0) { this.sources.push(source); index = this.sources.length - 1; }
    return index + 1;
  }
  async call(name, args, { signal, folderAccess, agentId } = {}) {
    if (name.startsWith('files__')) return filesystemTools.call(name, args, { signal, folderAccess, agentId });
    if (!this.validators.has(name)) return this.mcp.call(name, args, { signal });
    if (!this.validators.get(name)(args)) throw new Error('Invalid search tool arguments');
    if (name === 'search_web' && !this.webEnabled) throw new Error('Web search is disabled for this request');
    signal?.throwIfAborted();
    if (name === 'read_webpage') {
      if (++this.readCalls > 3) throw new Error('Page read limit reached');
      this.emit('status', 'Reading source...');
      const page = await this.readFn(args.url, { signal });
      const citation = this.addSource({ title: page.title, url: page.url, snippet: page.excerpt.slice(0, 500), kind: 'web', source: 'page read' });
      this.emit('page_read', page);
      this.emit('search_results', this.sources);
      return textResult({ citation, title: page.title, url: page.url, excerpt: page.excerpt, retrieved_at: page.retrieved_at, cached: Boolean(page.cached) });
    }
    if (++this.searchCalls > 3) throw new Error('Search limit reached for this request');
    if (name === 'search_images') {
      this.emit('status', `Searching pictures: ${args.query}`);
      const found = await this.imageSearchFn(args.query, { count: args.count || 6, signal });
      for (const image of found) {
        if (!this.images.some(item => item.url === image.url) && this.images.length < 12) this.images.push({ ...image, query: args.query });
      }
      this.emit('image_results', this.images);
      return textResult({ query: args.query, count: found.length, gallery_displayed: found.length > 0,
        instruction: found.length ? 'The host already displays these pictures underneath the response. Introduce them in one brief sentence. Do not write gallery tags, placeholders or duplicate Markdown images.' : 'No images were found. Explain honestly.',
        images: found.map(image => ({ title: image.title, source_url: image.source_url })) });
    }
    this.emit('status', `Searching web: ${args.query}`);
    const found = await this.searchFn(args.query, args.count || 4, undefined, { signal });
    const evidence = found.map(source => ({ citation: this.addSource(source), title: source.title, url: source.url, snippet: source.snippet.slice(0, 1200), retrieved_at: source.retrieved_at, cached: Boolean(source.cached) }));
    this.emit('search_results', this.sources);
    return textResult({ results: evidence });
  }
}
const textResult = value => ({ content: [{ type: 'text', text: JSON.stringify(value) }] });
