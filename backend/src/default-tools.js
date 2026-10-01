export const defaultWebTools = ['search_web', 'read_webpage'];
export function withDefaultWebTools(profile) {
  return { ...profile, allowed_tools: [...new Set([...(profile.allowed_tools || []), ...defaultWebTools])] };
}
