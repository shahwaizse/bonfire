# Remote MCP connectors

Open **Tools & connectors** in the left sidebar. Under **Add MCP connector**, enter a name and server URL, then choose its authentication method. There are no built-in connector entries.

For example, to connect Notion, use `https://mcp.notion.com/mcp` with **Browser sign-in (OAuth)**. Add the connector, click its Connect button, and complete workspace authorization in your browser. If a popup is blocked, use **Continue sign-in**. No developer dashboard integration or API key is needed for Notion's [official OAuth flow](https://developers.notion.com/guides/mcp/build-mcp-client).

After connecting:

1. Tool lists start collapsed. Check the service checkbox to enable all available tools, or expand the service to choose individual tools. Editing tools are marked **Changes data**.
2. Save the enabled tools.
3. Click **Assign to a little guy**, select a guy and check the service to assign all its enabled tools, or expand it to pick individual tools. Then save the profile.
4. Chat with that guy. For a first experiment, ask it to find a known page and summarize it with a link.

Plain Bonfire chats do not receive remote connector tools. Each guy sees only its assigned tools. Workspace authorization is controlled by Notion; Bonfire's tool selections do not narrow the upstream OAuth grant. Editing tools can run when that guy calls them, without another confirmation per call.

**Try a tool** runs a real request with JSON arguments and displays its result independently of the local model. Read the displayed argument schema. Editing tools modify the real workspace.

## Free-only behavior

Bonfire excludes Notion AI tools, regardless of subscription. Other tools requiring an account upgrade are unavailable when reported by Notion's tool-access map. Some accounts may advertise only AI search: search will then be unavailable in this version, even though Notion documents a limited keyword fallback. Fetching known pages and other available basic tools can still be enabled. This client does not enable a paid plan or provide a payment method. Custom providers have their own pricing; choose free endpoints/accounts.

## Custom servers

Use a name and Streamable HTTP endpoint. Bonfire generates a short ID from the name, adding a numeric suffix if it is already taken. Existing saved IDs remain unchanged. Authentication can be anonymous, bearer token, or OAuth browser sign-in. OAuth servers need to support public dynamic client registration and the loopback callback. HTTPS is required except for localhost. Legacy SSE and stdio servers are not added through this panel; existing local stdio configuration still uses `backend/mcp.json`.

## Storage and reconnecting

Connector metadata, tokens, client registration and PKCE verifier are encrypted with Windows DPAPI for the current Windows account in Git-ignored `backend/data/connectors.dpapi`. Tokens are not sent to the frontend or included in model prompts. This initial credential store requires Windows. `BONFIRE_CONNECTOR_STORE` can override its location; keep it outside tracked folders.

Saved enabled connections reconnect in the background on startup. OAuth refresh is handled by the official MCP SDK. Expired or revoked authorization may require another sign-in. Disconnect clears local OAuth credentials; remove also deletes the connector entry. Revoke Bonfire's grant in Notion's connection settings if you want to remove upstream access.

Remote inputs are validated against discovered schemas; operations have 45-second timeouts. Only tools explicitly enabled in settings and assigned to the selected guy can execute. These transport and permission checks do not change the model's content instructions.

Bulk selection saves an explicit list of the tools currently available; tools added by a server later are not automatically enabled or assigned. Profiles and connector selections support up to 200 tools.

Assigned services use [on-demand tool discovery](tool-discovery.md). The local model receives a small working set of relevant schemas and can call `search_tools` to load others. Selecting a whole service no longer inserts every schema into every message.
