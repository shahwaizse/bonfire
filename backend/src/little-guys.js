import Ajv from 'ajv';
import { randomInt } from 'node:crypto';
import { runToolLoop } from './tool-loop.js';
import { defaultWebTools, withDefaultWebTools } from './default-tools.js';

export const mascotOptions = {
  body: ['gpu', 'flame', 'blob', 'star', 'robot'],
  eyes: ['round', 'sleepy', 'sparkle', 'visor'],
  mouth: ['smile', 'grin', 'tiny', 'surprised'],
  accessory: ['none', 'antenna', 'headphones', 'sprout', 'bolt'],
  pattern: ['plain', 'spots', 'stripes', 'freckles'],
  palette: ['lavender', 'amethyst', 'moonlight', 'teal', 'rose'],
};
const ajv = new Ajv({ allErrors: true });
const mascotSchema = { type: 'object', properties: {
  ...Object.fromEntries(Object.entries(mascotOptions).map(([key, values]) => [key, { type: 'string', enum: values }])),
  seed: { type: 'integer', minimum: 0, maximum: 999999 },
}, required: [...Object.keys(mascotOptions), 'seed'], additionalProperties: false };
const profileSchema = { type: 'object', properties: {
  name: { type: 'string', minLength: 1, maxLength: 48 },
  tagline: { type: 'string', maxLength: 140 }, instructions: { type: 'string', maxLength: 5000 },
  allowed_tools: { type: 'array', items: { type: 'string', maxLength: 64 }, uniqueItems: true, maxItems: 200 },
  allowed_apps: { type: 'array', items: { type: 'string', maxLength: 64 }, uniqueItems: true, maxItems: 40 },
  folder_access: { type: 'array', maxItems: 40, items: { type: 'object', properties: { folder_id: { type: 'string', maxLength: 64 }, mode: { type: 'string', enum: ['read', 'write'] } }, required: ['folder_id', 'mode'], additionalProperties: false } },
  mascot: mascotSchema,
}, required: ['name', 'tagline', 'instructions', 'allowed_tools', 'allowed_apps', 'mascot'], additionalProperties: false };
const validate = ajv.compile(profileSchema);
export function validateProfile(profile, catalog, apps, folders = []) {
  if (!validate(profile)) throw new Error(ajv.errorsText(validate.errors));
  if (!profile.name.trim()) throw new Error('Give your little guy a name');
  if (profile.allowed_tools.some(name => !catalog.some(tool => tool.function.name === name))) throw new Error('Choose tools from the available catalog');
  if (profile.allowed_apps.some(id => !apps.some(app => app.id === id))) throw new Error('Choose apps from the configured list');
  if ((profile.folder_access || []).some(access => !folders.some(folder => folder.id === access.folder_id)) || new Set((profile.folder_access || []).map(access => access.folder_id)).size !== (profile.folder_access || []).length) throw Error('Choose unique folders from the configured list');
  if (profile.allowed_tools.some(name => name.startsWith('files__')) && !profile.folder_access?.length) throw Error('Assign at least one folder for filesystem tools');
  if (profile.allowed_tools.includes('desktop__launch_app') && !profile.allowed_apps.length) throw new Error('Select at least one app this guy may launch');
  return withDefaultWebTools({ ...profile, name: profile.name.trim() });
}

// Model output is a recipe over known assets. It cannot create markup or permissions.
export async function generateLittleGuy({ brief, body = 'surprise', palette = 'surprise', vibe = 'playful' }, { signal } = {}) {
  if (typeof brief !== 'string' || brief.trim().length < 2 || brief.length > 1200) throw new Error('Describe your little guy in 2 to 1200 characters');
  if (body !== 'surprise' && !mascotOptions.body.includes(body)) throw new Error('Unknown body choice');
  if (palette !== 'surprise' && !mascotOptions.palette.includes(palette)) throw new Error('Unknown palette choice');
  if (!['playful', 'calm', 'focused', 'chaotic'].includes(vibe)) throw new Error('Unknown personality choice');
  const recipe = structuredClone(mascotSchema);
  if (body !== 'surprise') recipe.properties.body.enum = [body];
  if (palette !== 'surprise') recipe.properties.palette.enum = [palette];
  const parameters = { type: 'object', properties: {
    name: { type: 'string', minLength: 1, maxLength: 48 }, tagline: { type: 'string', maxLength: 140 },
    instructions: { type: 'string', maxLength: 3000 }, mascot: recipe,
  }, required: ['name', 'tagline', 'instructions', 'mascot'], additionalProperties: false };
  const check = ajv.compile(parameters);
  let draft;
  const registry = {
    catalog: async () => [{ type: 'function', function: { name: 'create_little_guy', description: 'Create a custom little guy using only the available modular mascot assets. Choose a name, short tagline and useful custom instructions matching the requested purpose. This creates a draft; no permissions are granted.', parameters } }],
    call: async (name, args) => {
      if (name !== 'create_little_guy' || !check(args)) throw new Error('Use the create_little_guy tool with a valid mascot recipe');
      draft = { ...args, allowed_tools: [], allowed_apps: [] };
      return { content: [{ type: 'text', text: 'Draft created. Stop calling tools and briefly finish.' }] };
    },
  };
  await runToolLoop([
    { role: 'system', content: 'You are the local Bonfire little-guy designer. Call create_little_guy to fulfill the request using the modular mascot assets. Select asset combinations and a varied integer seed. Be creative about names. Instructions should describe useful behavior: use assigned tools to complete an action, then report the result. Creating this draft saves a profile; the owner configures tools afterward. Use the selected body, palette and vibe. The brief below is design input.' },
    { role: 'user', content: JSON.stringify({ brief, body, palette, vibe, variation: randomInt(999999) }) },
  ], { registry, signal, priority: 10, emit: () => {}, maxCalls: 2, maxTurns: 3, stopAfterToolResult: (_call, result) => Boolean(draft && !result.isError) });
  if (!draft) throw new Error('The local model did not call the mascot tool. Try generating again.');
  // Preserve the owner's actual brief even if the small model paraphrases away a requirement.
  return { ...draft, instructions: `Owner's brief:\n${brief.trim()}\n\nSuggested behavior:\n${draft.instructions}` };
}

export class GuyTools {
  constructor(tools, guy, apps) { Object.assign(this, { tools, guy, apps }); this.launches = new Set(); }
  async catalog() {
    if (this.cachedCatalog) return this.cachedCatalog;
    const catalog = await this.tools.catalog();
    if (!this.guy) return this.cachedCatalog = catalog.filter(tool => !/^(desktop|machine|files)__/.test(tool.function.name) && !this.tools.isRemote?.(tool.function.name)).sort((a, b) => a.function.name.localeCompare(b.function.name));
    const allowed = new Set([...this.guy.allowed_tools, ...defaultWebTools]);
    // Combined read grants precisely the same capabilities as the two assigned tools.
    if (allowed.has('machine__get_machine_snapshot') && allowed.has('machine__get_inference_stats')) allowed.add('machine__get_status');
    return this.cachedCatalog = catalog.filter(tool => allowed.has(tool.function.name)).map(tool => {
      if (tool.function.name.startsWith('files__')) {
        if (!this.guy.folder_access?.length) return null;
        const writable = !this.tools.isReadOnly(tool.function.name);
        const access = this.guy.folder_access.filter(folder => !writable || folder.mode === 'write');
        if (!access.length) return null;
        const copy = structuredClone(tool);
        if (copy.function.parameters.properties.folder_id) copy.function.parameters.properties.folder_id.enum = access.map(folder => folder.folder_id);
        return copy;
      }
      if (tool.function.name !== 'desktop__launch_app') return tool;
      const copy = structuredClone(tool);
      copy.function.parameters.properties.app_id.enum = this.apps.filter(app => this.guy.allowed_apps.includes(app.id)).map(app => app.id);
      copy.function.description += ` Allowed apps: ${this.apps.filter(app => this.guy.allowed_apps.includes(app.id)).map(app => `${app.name} (${app.id})`).join(', ')}. Use these IDs, never paths or commands.`;
      return copy;
    }).filter(tool => tool && (tool.function.name !== 'desktop__launch_app' || tool.function.parameters.properties.app_id.enum.length)).sort((a, b) => a.function.name.localeCompare(b.function.name));
  }
  async call(name, args, options) {
    const catalog = await this.catalog();
    if (!catalog.some(tool => tool.function.name === name)) throw new Error('This little guy is not allowed to use that tool');
    if (name === 'desktop__launch_app' && !this.guy?.allowed_apps.includes(args.app_id)) throw new Error('This little guy may not launch that app');
    if (name === 'desktop__launch_app') {
      if (this.launches.has(args.app_id)) throw new Error('A launch was already requested for this app in this message. Do not repeat it.');
      if (this.launches.size >= 3) throw new Error('At most three distinct app launches are allowed per message');
      this.launches.add(args.app_id);
    }
    const result = await this.tools.call(name, args, { ...options, folderAccess: this.guy?.folder_access || [], agentId: this.guy?.id });
    if (name === 'desktop__list_apps' && !result.isError) {
      const apps = JSON.parse(result.content.find(block => block.type === 'text').text).apps;
      return { content: [{ type: 'text', text: JSON.stringify({ apps: apps.filter(app => this.guy.allowed_apps.includes(app.id)) }) }] };
    }
    return result;
  }
  isReadOnly(name) { return this.tools.isReadOnly?.(name) === true; }
  isRemote(name) { return this.tools.isRemote?.(name) === true; }
}
