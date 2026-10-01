import Ajv from 'ajv';
import { countTokens } from './llama.js';

const searchSchema = { type: 'function', function: {
  name: 'search_tools',
  description: 'Find and load assigned tools by service, action, or exact tool name. Search before using a tool not currently listed. Loading tools does not execute them.',
  parameters: { type: 'object', properties: { query: { type: 'string', minLength: 1, maxLength: 300 }, limit: { type: 'integer', minimum: 1, maximum: 3 } }, required: ['query'], additionalProperties: false },
} };
const validateSearch = new Ajv().compile(searchSchema.function.parameters);
const stopWords = new Set('a an and are as at be by can do for from give hi i in is it me my of on or please that the this to tool tools use with you your'.split(' '));
const aliases = { find: 'search', lookup: 'search', locate: 'search', summarize: 'fetch', summary: 'fetch', read: 'fetch', retrieve: 'fetch', edit: 'update', change: 'update', modify: 'update', add: 'create', make: 'create', remove: 'delete', launch: 'open' };
function words(value) {
  return [...new Set((String(value).toLowerCase().match(/[\p{L}\p{N}]+/gu) || []).flatMap(word => {
    const root = word.endsWith('s') && word.length > 4 ? word.slice(0, -1) : word;
    return [root, ...(aliases[root] ? [aliases[root]] : [])];
  }).filter(word => !stopWords.has(word)))];
}

// Keep structural constraints, required fields, enums and references intact.
// Annotation verbosity is not needed to validate or construct arguments.
function compactSchema(value) {
  if (Array.isArray(value)) return value.map(compactSchema);
  if (!value || typeof value !== 'object') return value;
  const output = {};
  for (const [key, item] of Object.entries(value)) {
    if (['$schema', 'title', 'examples', 'default', '$comment'].includes(key)) continue;
    // Property names and enum/default values are data, not schema annotations.
    if (['properties', '$defs', 'definitions', 'patternProperties', 'dependentSchemas'].includes(key)) output[key] = Object.fromEntries(Object.entries(item).map(([name, schema]) => [name, compactSchema(schema)]));
    else if (key === 'description') output[key] = String(item).slice(0, 160);
    else if (['enum', 'const'].includes(key)) output[key] = item;
    else output[key] = compactSchema(item);
  }
  return output;
}
function compactTool(tool) {
  return { type: 'function', function: { name: tool.function.name, description: tool.function.description.slice(0, 500), parameters: compactSchema(tool.function.parameters) } };
}
const textResult = data => ({ content: [{ type: 'text', text: JSON.stringify(data) }] });

export class DiscoverableTools {
  constructor(registry, { query = '', signal, tokenBudget = 2400 } = {}) {
    Object.assign(this, { registry, query, signal, tokenBudget });
    this.active = []; this.loaded = new Set();
  }
  async initialize() {
    this.ready ||= (async () => {
      this.full = await this.registry.catalog();
      this.byName = new Map(this.full.map(tool => [tool.function.name, tool]));
      this.costs = new Map();
      this.compact = new Map(this.full.map(tool => [tool.function.name, compactTool(tool)]));
      const hasRemote = this.full.some(tool => this.registry.isRemote?.(tool.function.name));
      this.lazy = hasRemote || this.full.length > 10 || JSON.stringify(this.full).length > 10000;
      if (!this.lazy) { this.active = this.full; return; }
      this.searchCost = await countTokens(JSON.stringify(searchSchema), { signal: this.signal });
      this.core = this.full.filter(tool => !tool.function.name.includes('__'));
      this.deferred = this.full.filter(tool => !this.core.includes(tool));
      this.index = this.deferred.map(tool => ({ tool, name: words(tool.function.name), description: words(tool.function.description + ' ' + Object.keys(tool.function.parameters?.properties || {}).join(' ')) }));
      const candidates = this.rank(this.query).slice(0, 2).map(entry => entry.tool);
      // Load a provider's explicitly named prerequisite when it is also assigned.
      const prerequisites = this.deferred.filter(tool => candidates.some(candidate => {
        const leaf = tool.function.name.split('__').at(-1).replace(/^[^-]+-/, '').replaceAll('-', '_');
        return leaf.length > 8 && candidate.function.description.toLowerCase().includes(`call ${leaf}`);
      }));
      await this.activate([...candidates, ...prerequisites.slice(0, 1)]);
    })();
    return this.ready;
  }
  rank(query) {
    const terms = words(query);
    const actions = new Set(['search', 'fetch', 'list', 'get', 'create', 'update', 'delete', 'move', 'duplicate', 'upload', 'download', 'spawn', 'stop', 'send', 'wait', 'query']);
    const requestedActions = terms.filter(term => actions.has(term));
    return this.index.map(entry => {
      let score = 0;
      for (const term of terms) {
        const frequency = this.index.filter(other => other.name.includes(term) || other.description.includes(term)).length;
        const weight = Math.log(1 + this.index.length / (1 + frequency));
        score += (entry.name.includes(term) ? 5 : entry.description.includes(term) ? 1 : 0) * weight;
      }
      if (entry.tool.function.name.toLowerCase() === query.toLowerCase().trim()) score += 100;
      const leaf = entry.tool.function.name.split('__').at(-1).split(/[-_]/);
      const action = leaf.find(word => actions.has(word));
      if (requestedActions.length && action) score += requestedActions.includes(action) ? 12 : -12;
      // Specialized search variants should not displace a general search unless requested.
      for (const noun of ['agent', 'session', 'comment', 'attachment', 'folder', 'view', 'database']) {
        if (entry.name.includes(noun) && !terms.includes(noun)) score -= 5;
      }
      return { ...entry, score };
    }).filter(entry => entry.score > 0).sort((a, b) => b.score - a.score || a.tool.function.name.localeCompare(b.tool.function.name));
  }
  async cost(tool) {
    const name = tool.function.name;
    if (!this.costs.has(name)) this.costs.set(name, await countTokens(JSON.stringify(tool), { signal: this.signal }));
    return this.costs.get(name);
  }
  async activate(candidates, exact = false) {
    // Rotate the working set rather than accumulating schemas across searches.
    const selected = [searchSchema], seen = new Set(['search_tools']); let used = this.searchCost;
    const ordered = [...this.core, ...candidates]; const skipped = [];
    const budget = exact ? Math.max(this.tokenBudget, 4200) : this.tokenBudget;
    for (const original of ordered) {
      if (seen.has(original.function.name)) continue;
      seen.add(original.function.name);
      const tool = this.compact.get(original.function.name), cost = await this.cost(tool);
      if (used + cost > budget) { skipped.push(original.function.name); continue; }
      selected.push(tool); used += cost; this.loaded.add(tool.function.name);
    }
    this.active = selected; return skipped;
  }
  async catalog() { await this.initialize(); return this.active; }
  async fullCatalog() { await this.initialize(); return this.full; }
  async context() {
    await this.initialize();
    if (!this.lazy) return '';
    const groups = new Map();
    for (const tool of this.deferred) { const service = tool.function.name.split('__')[0]; groups.set(service, (groups.get(service) || 0) + 1); }
    return `Assigned tool services (schemas load on demand): ${[...groups].map(([name, count]) => `${name}: ${count} tools`).join('; ')}. Only the tools currently listed have loaded schemas. Use search_tools with a service and action or exact tool name to load more, then call the loaded native tool. Search changes the working set; earlier tools may need reloading. Loading a tool does not execute it.`;
  }
  isReadOnly(name) { return name !== 'search_tools' && this.registry.isReadOnly?.(name) === true; }
  async call(name, args, options) {
    await this.initialize();
    if (name !== 'search_tools' || !this.lazy) return this.registry.call(name, args, options);
    if (!validateSearch(args)) throw Error('search_tools requires a query and an optional limit from 1 to 3');
    const exact = this.byName.has(args.query.trim());
    const matches = exact ? [this.byName.get(args.query.trim())] : this.rank(args.query).slice(0, args.limit || 3).map(entry => entry.tool);
    const skipped = await this.activate(matches, exact);
    return textResult({ matches: matches.map(tool => ({ name: tool.function.name, description: tool.function.description.slice(0, 300), loaded: !skipped.includes(tool.function.name), ...(skipped.includes(tool.function.name) ? { reason: exact ? 'This schema is too large for this model context. The provider needs a smaller tool schema.' : 'Schema exceeds the working-set budget. Search this exact tool alone.' } : {}) })),
      instruction: matches.length ? 'Loaded tools appear in the next turn. Call them natively with their listed arguments.' : 'No assigned tool matched. Try a service name, another action, or an exact tool name.' });
  }
}
