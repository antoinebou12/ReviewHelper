import {
  test,
  expect,
  type Page,
  type APIRequestContext,
} from "@playwright/test";

/**
 * A minimal MCP Apps host. With `inline`, the tool result carries the whole review in _meta
 * (older servers). Otherwise it carries only review_id, and the viewer must call the
 * app-only get_workspace tool, which is how the Python server behaves today.
 */
async function mountHost(
  page: Page,
  request: APIRequestContext,
  inline: boolean,
) {
  const review = await (await request.get("/api/demo")).json();
  const encoded = JSON.stringify(review).replace(/</g, "\\u003c");
  await page.route("**/test-host", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: `<!doctype html><html lang="en"><head><title>Test MCP host</title></head><body><iframe title="Review Helper" src="/" style="width:100%;height:1000px;border:0"></iframe><script>
    const review = ${encoded};
    const inline = ${inline};
    window.hostCalls = [];
    window.addEventListener('message', event => {
      const message = event.data;
      const frame = document.querySelector('iframe');
      if (event.source !== frame.contentWindow || message?.jsonrpc !== '2.0') return;
      const send = value => frame.contentWindow.postMessage({jsonrpc:'2.0', ...value}, location.origin);
      if (message.method === 'ui/initialize') {
        send({id:message.id, result:{protocolVersion:message.params.protocolVersion, hostInfo:{name:'Test host',version:'1'},hostCapabilities:{serverTools:{},updateModelContext:{},message:{}},hostContext:{theme:'light',displayMode:'inline',availableDisplayModes:['inline','fullscreen']}}});
      } else if (message.method === 'ui/notifications/initialized') {
        send({method:'ui/notifications/tool-result', params:{content:[{type:'text',text:'Demo review'}],structuredContent:{id:'demo'},_meta: inline ? {review} : {review_id:'demo'}}});
      } else if (message.method === 'ui/request-display-mode') {
        window.hostCalls.push({name:'display-mode', mode:message.params.mode});
        send({id:message.id,result:{mode:message.params.mode}});
      } else if (message.method === 'ui/message') {
        window.hostCalls.push({name:'message', text:message.params.content[0].text});
        send({id:message.id,result:{}});
      } else if (message.method === 'tools/call') {
        window.hostCalls.push(message.params);
        if (message.params.name === 'get_workspace') {
          send({id:message.id,result:{content:[{type:'text',text:'Workspace'}],structuredContent:{id:'demo'},_meta:{review}}});
        } else {
          send({id:message.id,result:{content:[{type:'text',text:'Saved'}],structuredContent:{sections:message.params.arguments.sections || []}}});
        }
      } else if (message.id !== undefined) send({id:message.id,result:{}});
    });
  </script></body></html>`,
    }),
  );
  const rest: string[] = [];
  page.on("request", (req) => {
    if (req.url().includes("/api/")) rest.push(req.url());
  });
  await page.goto("/test-host");
  return { frame: page.frameLocator("iframe"), rest };
}

const hostCalls = (page: Page) =>
  page.evaluate(() => (window as any).hostCalls as any[]);

test("embedded app initializes through MCP Apps and uses host tools without REST fetches", async ({
  page,
  request,
}) => {
  const { frame, rest } = await mountHost(page, request, true);
  await expect(
    frame.getByRole("heading", { name: "Give saved articles a home" }),
  ).toBeVisible();
  await frame
    .getByRole("button", { name: "Mark reviewed", exact: true })
    .click();
  await expect(
    frame.getByRole("button", { name: "Reviewed", exact: true }),
  ).toBeVisible();
  expect(rest).toEqual([]);
  expect(
    (await hostCalls(page)).some(
      (c) =>
        c.name === "review_progress" &&
        c.arguments.sections?.includes("collections"),
    ),
  ).toBe(true);
});

test("compact tool result loads the snapshot through the app-only get_workspace tool", async ({
  page,
  request,
}) => {
  const { frame, rest } = await mountHost(page, request, false);
  await expect(
    frame.getByRole("heading", { name: "Give saved articles a home" }),
  ).toBeVisible();
  await expect(
    frame.getByRole("group", { name: "Project change map" }),
  ).toBeVisible();
  expect(rest).toEqual([]);
  const calls = await hostCalls(page);
  expect(calls.find((c) => c.name === "get_workspace")?.arguments).toEqual({
    review_id: "demo",
  });
});

test("inside a chat the app is a compact card that can expand and ask the model", async ({
  page,
  request,
}) => {
  const { frame } = await mountHost(page, request, false);
  await expect(
    frame.getByRole("heading", { name: "Give saved articles a home" }),
  ).toBeVisible();
  // No web-app chrome and no side inspector inline; the map comes first.
  await expect(frame.getByRole("button", { name: "Open a PR" })).toHaveCount(0);
  await expect(
    frame.getByRole("complementary", { name: "Section details" }),
  ).toHaveCount(0);
  await expect(
    frame.getByRole("group", { name: "Project change map" }),
  ).toBeVisible();
  await frame.getByRole("button", { name: "Ask to review" }).click();
  await frame.getByRole("button", { name: "Expand to fullscreen" }).click();
  await expect(
    frame.getByRole("complementary", { name: "Section details" }),
  ).toBeVisible();
  await frame.getByRole("button", { name: "Back to chat" }).click();
  const calls = await hostCalls(page);
  expect(calls.find((c) => c.name === "message")?.text).toContain(
    "read_section",
  );
  expect(
    calls.filter((c) => c.name === "display-mode").map((c) => c.mode),
  ).toEqual(["fullscreen", "inline"]);
});

test("host preview runs the real MCP server end to end", async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 1000 });
  await page.goto("/mcp-preview");
  const frame = page.frameLocator("iframe");
  await expect(
    frame.getByRole("heading", { name: "Give saved articles a home" }),
  ).toBeVisible();
  await expect(page.locator("#reply")).toContainText("4 feature sections");
  await expect(page.locator("#log")).toContainText("app called get_workspace");
  await page.screenshot({ path: "docs/screenshots/mcp-inline.png" });
  await page.getByRole("button", { name: "Dark host" }).click();
  await page.getByRole("button", { name: "Fullscreen" }).click();
  await expect(
    frame.getByRole("complementary", { name: "Section details" }),
  ).toBeVisible();
  await page.screenshot({ path: "docs/screenshots/mcp-fullscreen-dark.png" });
});
