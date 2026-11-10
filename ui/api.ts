import { App } from "@modelcontextprotocol/ext-apps";
import type { Review } from "./types";

let accessToken = "";
let bridge: App | null = null;
export const embedded = window.parent !== window;
export const setAccessToken = (token: string) => {
  accessToken = token;
};
export async function api<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const response = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...options.headers,
    },
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(
      typeof error.detail === "string"
        ? error.detail
        : `Request failed (${response.status}).`,
    );
  }
  return response.json();
}
export async function connectHost(
  onReview: (review: Review) => void,
  onError: (message: string) => void,
) {
  bridge = new App({ name: "Review Helper", version: "0.1.0" }, {});
  bridge.ontoolresult = async (result) => {
    const review = result._meta?.review as Review | undefined;
    if (review) onReview(review);
    else if (typeof result._meta?.review_id === "string") {
      try {
        onReview(await workspace(result._meta.review_id));
      } catch (e) {
        onError((e as Error).message);
      }
    }
  };
  bridge.onhostcontextchanged = (ctx) => {
    if (ctx.theme) document.documentElement.dataset.theme = ctx.theme;
    applyHostContext(ctx);
  };
  try {
    await bridge.connect();
    const ctx = bridge.getHostContext();
    if (ctx?.theme) document.documentElement.dataset.theme = ctx.theme;
    applyHostContext(ctx ?? {});
  } catch {
    onError(
      "The MCP host could not connect to the viewer. Open the local web app to continue.",
    );
  }
}
export async function loadReview(
  url = "demo",
  token?: string,
): Promise<Review> {
  if (embedded && bridge) {
    const result = await bridge.callServerTool({
      name: "open_review",
      arguments: { url },
    });
    if (result.isError)
      throw new Error(
        "The provider could not load this review. Check the server configuration.",
      );
    return (
      (result._meta?.review as Review) ||
      workspace(result._meta?.review_id as string)
    );
  }
  return url === "demo"
    ? api("/api/demo")
    : api("/api/reviews", {
        method: "POST",
        body: JSON.stringify({ url, token: token || null }),
      });
}

async function workspace(review_id: string): Promise<Review> {
  const result = await bridge!.callServerTool({
    name: "get_workspace",
    arguments: { review_id },
  });
  if (result.isError || !result._meta?.review)
    throw new Error("The host could not load this review workspace.");
  return result._meta.review as Review;
}

export type LoginProvider = "azure" | "github";
const loginNames: Record<LoginProvider, string> = {
  azure: "Microsoft. Configure AZURE_CLIENT_ID and AZURE_TENANT_ID",
  github: "GitHub. Configure GITHUB_CLIENT_ID",
};
export async function providerConnection(
  provider: LoginProvider,
  action: "status" | "start" | "poll" | "logout",
  login_id?: string,
): Promise<any> {
  if (embedded && bridge) {
    const result = await bridge.callServerTool({
      name: "provider_connection",
      arguments: { provider, action, login_id },
    });
    if (result.isError)
      throw new Error(
        `Could not connect to ${loginNames[provider]} on the server.`,
      );
    return result.structuredContent;
  }
  if (action === "status") {
    const config = await api<{ azure: unknown; github_oauth: unknown }>(
      "/api/config",
    );
    return provider === "azure" ? config.azure : config.github_oauth;
  }
  return api(
    `/api/auth/${provider}/${action === "poll" ? `poll/${encodeURIComponent(login_id!)}` : action}`,
    { method: "POST" },
  );
}
export async function progress(
  id: string,
  sections?: string[],
): Promise<string[]> {
  if (embedded && bridge) {
    const result = await bridge.callServerTool({
      name: "review_progress",
      arguments: { review_id: id, ...(sections ? { sections } : {}) },
    });
    if (result.isError) throw new Error("Could not save review progress.");
    const data = result.structuredContent as { sections: string[] } | undefined;
    return data?.sections ?? [];
  }
  const result = await api<{ sections: string[] }>(
    `/api/reviews/${encodeURIComponent(id)}/progress`,
    sections ? { method: "PUT", body: JSON.stringify({ sections }) } : {},
  );
  return result.sections;
}
/** How the chat host shows the app: inline in the conversation, or fullscreen. */
export type HostView = {
  displayMode: string;
  canExpand: boolean;
  canMessage: boolean;
};
let hostView: HostView = {
  displayMode: "inline",
  canExpand: false,
  canMessage: false,
};
const viewListeners = new Set<(view: HostView) => void>();
function applyHostContext(ctx: {
  displayMode?: string;
  availableDisplayModes?: string[];
}) {
  hostView = {
    displayMode: ctx.displayMode ?? hostView.displayMode,
    canExpand:
      (ctx.availableDisplayModes ?? []).includes("fullscreen") ||
      hostView.canExpand,
    canMessage: !!bridge?.getHostCapabilities()?.message || hostView.canMessage,
  };
  viewListeners.forEach((listener) => listener(hostView));
}
export function onHostView(listener: (view: HostView) => void) {
  viewListeners.add(listener);
  listener(hostView);
  return () => {
    viewListeners.delete(listener);
  };
}
/** Ask the host to show the app fullscreen or back inline. */
export async function setDisplayMode(mode: "inline" | "fullscreen") {
  if (!bridge) return;
  const result = await bridge.requestDisplayMode({ mode });
  applyHostContext({ displayMode: result.mode });
}
/** Put a review request into the chat, as if the user typed it. */
export async function askInChat(text: string) {
  if (!bridge) throw new Error("Not running inside a chat host.");
  await bridge.sendMessage({ role: "user", content: [{ type: "text", text }] });
}
export async function tellHost(review: Review, sectionId: string) {
  if (bridge)
    await bridge.updateModelContext({
      content: [
        {
          type: "text",
          text: `The user is reviewing section ${sectionId} in review ${review.id} at head ${review.head_sha}. Use read_section for evidence.`,
        },
      ],
    });
}
